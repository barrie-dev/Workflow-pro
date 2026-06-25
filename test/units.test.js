"use strict";
// Unit-tests voor pure businesslogica (geen store/HTTP nodig).
const { test } = require("node:test");
const assert = require("node:assert");

const { lookupKbo, normalizeVat } = require("../src/modules/kbo");
const {
  buildSupportGrant, issueSupportToken, supportGrantStatus, slideSupportGrant,
  assertSupportWrite, SUPPORT_IDLE_MS, SUPPORT_HARD_MS
} = require("../src/lib/auth");
const { Store } = require("../src/lib/store");
const { runSupportAccessReview } = require("../src/modules/support-access");
const { verifyStripeSignature } = require("../src/modules/stripe-webhook");
const { peppolTransportReadiness, buildUbl, validatePeppol } = require("../src/modules/peppol-invoice");
const { liveServiceReadiness } = require("../src/modules/live-services");
const { importEmployees } = require("../src/modules/imports");
const { productionConfigRisk } = require("../src/modules/production");
const crypto = require("node:crypto");

class MemAdapter {
  constructor(data) { this.data = data; }
  load() { return JSON.parse(JSON.stringify(this.data)); }
  save(data) { this.data = JSON.parse(JSON.stringify(data)); }
  status() { return { adapter: "memory", mode: "test" }; }
}
function reviewStore(tenants) {
  return new Store(new MemAdapter({
    schemaVersion: 6, tenants, users: [], roles: [], venues: [], customers: [], shifts: [],
    workorders: [], clocks: [], expenses: [], stock: [], vehicles: [], leaves: [], messages: [],
    notifications: [], integrations: [], invoices: [], paymentMethods: [], files: [], secrets: [],
    auditLogs: [], errorEvents: [], apiKeys: [], salesLeads: [], partners: [], migrationHistory: []
  }));
}

test("normalizeVat voegt BE-prefix toe en strijkt opmaak glad", () => {
  assert.equal(normalizeVat("0123456789"), "BE0123456789");
  assert.equal(normalizeVat("BE0123456789"), "BE0123456789");
  assert.equal(normalizeVat("be 0123.456.789"), "BE0123456789");
  assert.equal(normalizeVat(""), "");
});

test("lookupKbo fixture geeft volledige bedrijfsgegevens", () => {
  const r = lookupKbo("BE0123456789");
  assert.equal(r.name, "Demo Bouwgroep NV");
  assert.equal(r.companyNumber, "0123456789");
  assert.ok(r.street && r.city, "fixture moet straat + stad bevatten");
});

test("lookupKbo fallback: companyNumber afgeleid, adres leeg", () => {
  const r = lookupKbo("BE0999999999");
  assert.equal(r.companyNumber, "0999999999");
  assert.equal(r.street, "");
  assert.equal(r.city, "");
  // bevestigt waarom de golden-path KBO-stap (street||city vereist) faalt op fallback
});

// ── GDPR support-impersonatie: grant-levenscyclus (pure logica) ──
test("support-grant: vorm + scope-normalisatie + token-exp = harde limiet", () => {
  const now = Date.UTC(2026, 5, 1, 9, 0, 0);
  const g = buildSupportGrant({ impersonatedUserId: "u1", agent: "agent@wf.be", scope: "rommel", now });
  assert.equal(g.scope, "read", "onbekende scope valt terug op read");
  assert.ok(g.grantId.startsWith("support_"));
  assert.equal(new Date(g.expiresAt).getTime(), now + SUPPORT_IDLE_MS, "idle-venster");
  assert.equal(new Date(g.hardExpiresAt).getTime(), now + SUPPORT_HARD_MS, "harde limiet");
  assert.ok(new Date(g.expiresAt) < new Date(g.hardExpiresAt));

  const token = issueSupportToken({ ...g, scope: "write" }, "t1");
  const body = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
  assert.equal(body.support, true);
  assert.equal(body.scope, "write");
  assert.equal(body.grantId, g.grantId);
  assert.equal(body.exp, new Date(g.hardExpiresAt).getTime(), "token verloopt op de harde limiet");
});

test("support-grant: status valid / idle-verlopen / hard-verlopen / mismatch / beëindigd", () => {
  const now = Date.UTC(2026, 5, 1, 9, 0, 0);
  const g = buildSupportGrant({ impersonatedUserId: "u1", agent: "a", scope: "read", now });
  const ok = supportGrantStatus(g, { grantId: g.grantId }, now + 60_000);
  assert.equal(ok.ok, true, "binnen idle + hard → geldig");

  const idle = supportGrantStatus(g, { grantId: g.grantId }, now + SUPPORT_IDLE_MS + 1);
  assert.equal(idle.ok, false, "na inactiviteit verlopen");

  const hard = supportGrantStatus(g, { grantId: g.grantId }, now + SUPPORT_HARD_MS + 1);
  assert.equal(hard.ok, false, "na harde limiet verlopen");

  const mismatch = supportGrantStatus(g, { grantId: "ander" }, now + 1000);
  assert.equal(mismatch.ok, false, "grantId moet matchen");

  const ended = supportGrantStatus({ ...g, endedAt: new Date(now).toISOString() }, { grantId: g.grantId }, now + 1000);
  assert.equal(ended.ok, false, "beëindigde grant is ongeldig");
});

test("support-grant: sliding renew schuift op maar nooit voorbij de harde limiet", () => {
  const now = Date.UTC(2026, 5, 1, 9, 0, 0);
  const g = buildSupportGrant({ impersonatedUserId: "u1", agent: "a", scope: "read", now });

  const slidEarly = slideSupportGrant(g, now + 5 * 60_000);
  assert.equal(new Date(slidEarly.expiresAt).getTime(), now + 5 * 60_000 + SUPPORT_IDLE_MS, "verschuift mee met activiteit");

  // activiteit vlak voor de harde limiet → idle-venster wordt afgekapt op hard
  const nearHard = now + SUPPORT_HARD_MS - 60_000;
  const slidLate = slideSupportGrant(g, nearHard);
  assert.equal(new Date(slidLate.expiresAt).getTime(), now + SUPPORT_HARD_MS, "afgekapt op harde limiet");
});

test("support-scope: read-sessie blokkeert schrijven, write mag, GET altijd, gewone user vrij", () => {
  const read = { isSupportSession: true, support: { scope: "read" } };
  const write = { isSupportSession: true, support: { scope: "write" } };
  assert.doesNotThrow(() => assertSupportWrite(read, "GET"), "read mag lezen");
  assert.throws(() => assertSupportWrite(read, "POST"), e => e.status === 403, "read blokkeert schrijven");
  assert.throws(() => assertSupportWrite(read, "DELETE"), e => e.status === 403);
  assert.doesNotThrow(() => assertSupportWrite(write, "POST"), "write mag schrijven");
  assert.doesNotThrow(() => assertSupportWrite({}, "DELETE"), "niet-support-user onaangeroerd");
});

test("support-toegang: jaarlijkse mededeling stuurt notice + verschuift review (auto-renew)", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const store = reviewStore([{ id: "t1", name: "T1 BV", supportAccess: { allowed: true, autoRenew: true, allowedAt: "2025-06-01T00:00:00.000Z", reviewDueAt: past } }]);
  const res = runSupportAccessReview(store, Date.now());
  assert.deepEqual(res.notified, ["t1"]);
  const sa = store.data.tenants[0].supportAccess;
  assert.ok(new Date(sa.reviewDueAt).getTime() > Date.now(), "review verschoven naar de toekomst");
  assert.ok(sa.lastReviewNoticeAt, "laatste-mededeling gemarkeerd");
  const notes = store.list("notifications", "t1");
  assert.ok(notes.some(n => /staat nog steeds aan/i.test(n.title || "")), "informatieve mededeling aangemaakt");
});

test("support-toegang: geen mededeling als niet verstreken / autoRenew uit / niet toegestaan", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const future = new Date(Date.now() + 1e9).toISOString();
  const store = reviewStore([
    { id: "a", name: "A", supportAccess: { allowed: true, autoRenew: true, reviewDueAt: future } },   // nog niet verstreken
    { id: "b", name: "B", supportAccess: { allowed: true, autoRenew: false, reviewDueAt: past } },     // auto-renew uit
    { id: "c", name: "C", supportAccess: { allowed: false, autoRenew: true, reviewDueAt: past } }      // geen consent
  ]);
  const res = runSupportAccessReview(store, Date.now());
  assert.equal(res.notified.length, 0, "geen enkele tenant krijgt een mededeling");
});

test("stripe-webhook: unsigned alleen toegestaan buiten productie", () => {
  const local = verifyStripeSignature("{}", "", { webhookSecret: "", requireSignature: false });
  assert.equal(local.ok, true);
  assert.equal(local.mode, "unsigned-testmode");

  const prod = verifyStripeSignature("{}", "", { webhookSecret: "", requireSignature: true });
  assert.equal(prod.ok, false);
  assert.equal(prod.mode, "missing-webhook-secret");
});

test("peppol-transport: mock alleen toegestaan buiten productie", () => {
  const local = peppolTransportReadiness({ peppol: { provider: "mock", apiKey: "" } }, false);
  assert.equal(local.ok, true);
  assert.equal(local.transport, "mock");

  const prod = peppolTransportReadiness({ peppol: { provider: "mock", apiKey: "" } }, true);
  assert.equal(prod.ok, false);
  assert.equal(prod.errorCode, "peppol_provider_not_configured");
});

test("peppol-transport: productie vereist echte provider en sleutel", () => {
  const missingKey = peppolTransportReadiness({ peppol: { provider: "billit", apiKey: "replace_me" } }, true);
  assert.equal(missingKey.ok, false);
  assert.equal(missingKey.errorCode, "peppol_api_key_not_configured");

  const live = peppolTransportReadiness({ peppol: { provider: "billit", apiKey: "live_peppol_secret_123456789" } }, true);
  assert.equal(live.ok, true);
  assert.equal(live.transport, "billit");
  assert.equal(live.mode, "live");
});

test("live-services: externe productieafhankelijkheden zijn expliciet gegated", () => {
  const blocked = liveServiceReadiness({
    storageAdapter: "json",
    supabase: { url: "", serviceRoleKey: "" },
    databaseUrl: "",
    stripe: { secretKey: "sk_test_x", webhookSecret: "" },
    email: { provider: "log", apiKey: "", from: "" },
    peppol: { provider: "mock", apiKey: "" },
    appUrl: "http://localhost:4280",
    releaseChannel: "development",
    commitSha: "local-dev"
  });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.blockers.some(row => row.key === "storage_adapter"));
  assert.ok(blocked.blockers.some(row => row.key === "stripe_secret"));
  assert.ok(blocked.blockers.some(row => row.key === "email_provider"));
  assert.ok(blocked.blockers.some(row => row.key === "peppol_provider"));

  const ready = liveServiceReadiness({
    storageAdapter: "postgres",
    supabase: {
      url: "https://workflowpro.supabase.co",
      serviceRoleKey: `${"a".repeat(40)}.${"b".repeat(40)}.${"c".repeat(40)}`
    },
    databaseUrl: "postgresql://user:pass@aws-0-eu-west-1.pooler.supabase.com:6543/postgres",
    stripe: { secretKey: "sk_live_12345678901234567890", webhookSecret: "whsec_12345678901234567890" },
    email: { provider: "resend", apiKey: "re_live_12345678901234567890", from: "WorkFlow Pro <noreply@workflowpro.be>" },
    peppol: { provider: "billit", apiKey: "live_peppol_secret_123456789" },
    appUrl: "https://app.workflowpro.be",
    releaseChannel: "production",
    commitSha: "b2f721cc0ffee"
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.blockers.length, 0);
  assert.equal(ready.warnings.length, 0);
});

test("employee-import: nieuwe gebruikers krijgen activatieflow zonder gedeeld wachtwoord", () => {
  const store = reviewStore([{ id: "t1", name: "Tenant BV" }]);
  const tenant = store.data.tenants[0];
  const actor = { email: "admin@tenant.be" };
  const provisioned = [];
  const result = importEmployees(store, tenant, {
    csv: "naam;email;rol;telefoon\nNieuwe Medewerker;nieuw@tenant.be;employee;+32470000000"
  }, actor, base => {
    const user = store.insert("users", {
      ...base,
      passwordHash: "",
      active: false,
      activation: { tokenHash: "hashed-token", expiresAt: "2026-06-27T00:00:00.000Z" }
    });
    provisioned.push(user);
    return { user, activationLink: "http://localhost:4280/?activate=test" };
  });

  assert.equal(result.created.length, 1);
  assert.equal(provisioned.length, 1);
  assert.equal(provisioned[0].active, false);
  assert.equal(provisioned[0].passwordHash, "");
  assert.ok(provisioned[0].activation.tokenHash);
  assert.equal(result.created[0].passwordHash, undefined);
  assert.equal(result.created[0].activation, undefined);
  assert.equal(result.created[0].email, "nieuw@tenant.be");
});

test("production-config: e-mailactivatie is P0 voor productie", () => {
  const previous = {
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    EMAIL_FROM: process.env.EMAIL_FROM,
    RESEND_API_KEY: process.env.RESEND_API_KEY
  };
  try {
    process.env.EMAIL_PROVIDER = "log";
    delete process.env.EMAIL_FROM;
    delete process.env.RESEND_API_KEY;
    const blocked = productionConfigRisk().rows.find(row => row.key === "email_provider");
    assert.equal(blocked.ok, false);

    process.env.EMAIL_PROVIDER = "resend";
    process.env.EMAIL_FROM = "WorkFlow Pro <noreply@workflowpro.be>";
    process.env.RESEND_API_KEY = "re_live_12345678901234567890";
    const ready = productionConfigRisk().rows.find(row => row.key === "email_provider");
    assert.equal(ready.ok, true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("stripe-webhook: HMAC signature valideert exact", () => {
  const body = JSON.stringify({ id: "evt_123", type: "invoice.payment_succeeded" });
  const secret = "whsec_test_secret_123456789";
  const timestamp = "1781845000";
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const ok = verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, { webhookSecret: secret, requireSignature: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.mode, "signed");

  const bad = verifyStripeSignature(body, `t=${timestamp},v1=${signature.slice(0, -1)}0`, { webhookSecret: secret, requireSignature: true });
  assert.equal(bad.ok, false);
  assert.equal(bad.mode, "signed");
});

// ── Notificatie-bezorging per e-mail ─────────────────────────
const { shouldEmailNotification, emailRecipients } = require("../src/modules/notifications");

test("notificaties: e-mail enkel bij hoge prioriteit / e-mailkanaal en niet als tenant uitzet", () => {
  assert.equal(shouldEmailNotification({ priority: "high" }, {}), true);
  assert.equal(shouldEmailNotification({ channel: "email", priority: "normal" }, {}), true);
  assert.equal(shouldEmailNotification({ email: true, priority: "normal" }, {}), true);
  assert.equal(shouldEmailNotification({ priority: "normal" }, {}), false);
  assert.equal(shouldEmailNotification({ priority: "high" }, { notificationPrefs: { emailEnabled: false } }), false);
});

test("notificaties: ontvangers volgen audience/userId en respecteren opt-out", () => {
  const store = { data: { users: [
    { id: "a1", tenantId: "t1", role: "tenant_admin", active: true, email: "a1@t1.be" },
    { id: "m1", tenantId: "t1", role: "manager", active: true, email: "m1@t1.be" },
    { id: "e1", tenantId: "t1", role: "employee", active: true, email: "e1@t1.be" },
    { id: "e2", tenantId: "t1", role: "employee", active: true, email: "e2@t1.be", notifyEmail: false },
    { id: "x1", tenantId: "t2", role: "tenant_admin", active: true, email: "x@t2.be" },
  ] } };
  assert.deepEqual(emailRecipients(store, "t1", { audience: "admins" }).map(u => u.id), ["a1"]);
  assert.deepEqual(emailRecipients(store, "t1", { audience: "managers" }).map(u => u.id), ["m1"]);
  assert.deepEqual(emailRecipients(store, "t1", { audience: "all" }).map(u => u.id), ["a1", "m1", "e1"]); // e2 opt-out
  assert.deepEqual(emailRecipients(store, "t1", { userId: "e1" }).map(u => u.id), ["e1"]);
});

// ── Stripe-abonnementen: pure status-mapper ──────────────────
const { applySubscriptionEvent } = require("../src/modules/subscriptions");

test("subscriptions: webhook-status mapt naar tenant-status + plan", () => {
  const t = { id: "t1" };
  const created = applySubscriptionEvent(t, { type: "customer.subscription.created", data: { object: { id: "sub_1", status: "active", metadata: { wfp_plan: "business" } } } });
  assert.equal(created.status, "active");
  assert.equal(created.plan, "business");
  assert.equal(created.stripeSubscriptionId, "sub_1");
  assert.equal(created.pendingPlan, null);

  assert.equal(applySubscriptionEvent(t, { type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "past_due" } } }).status, "past_due");
  assert.equal(applySubscriptionEvent(t, { type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "trialing" } } }).status, "trial");
  assert.equal(applySubscriptionEvent(t, { type: "customer.subscription.deleted", data: { object: { id: "sub_1" } } }).status, "canceled");
  assert.equal(applySubscriptionEvent(t, { type: "invoice.paid", data: { object: {} } }), null);
});

// ── Configureerbare dashboards: rechten-gating ───────────────
const { hasFull, hasAny } = require("../src/modules/dashboards");

test("dashboards: org-widget vereist VOLLEDIG recht, eigen-widget ook own:", () => {
  const employee = { role: "employee", permissions: ["own:workorders", "own:clockings"] };
  const manager = { role: "manager", permissions: ["workorders", "employees", "clockings"] };
  // Eigen-data: employee mag (own:), manager ook
  assert.equal(hasAny(employee, "workorders"), true);
  assert.equal(hasAny(manager, "workorders"), true);
  // Org-breed: employee mag NIET (enkel own:), manager wel
  assert.equal(hasFull(employee, "workorders"), false, "employee ziet geen org-totalen");
  assert.equal(hasFull(manager, "workorders"), true);
  // super_admin en wildcard mogen alles
  assert.equal(hasFull({ role: "super_admin" }, "facturen"), true);
  assert.equal(hasFull({ role: "tenant_admin", permissions: ["*"] }, "facturen"), true);
});

// ── Betaalde add-ons in de catalogus ─────────────────────────
const { listAddons } = require("../src/modules/catalog");

test("catalog: add-ons hebben prijs + omschrijving (sso, ai_actions)", () => {
  const addons = listAddons();
  const keys = addons.map(a => a.key);
  assert.ok(keys.includes("sso") && keys.includes("ai_actions"), "sso + ai_actions zijn add-ons");
  assert.ok(addons.every(a => typeof a.monthly === "number" && a.monthly > 0 && a.description), "elke add-on heeft prijs + omschrijving");
});

// ── Add-on-overrides (superadmin-bewerkbare naam/prijs/actief) ───────────────
test("catalog: add-on-overrides overschrijven naam/prijs/actief, defaults bewaard", () => {
  const base = listAddons({}, true);
  assert.ok(base.find(a => a.key === "ai_actions") && base.find(a => a.key === "sso"), "add-ons aanwezig");
  const ov = listAddons({ ai_actions: { label: "AI Pro", monthly: 99, active: false } }, true);
  const ai = ov.find(a => a.key === "ai_actions");
  assert.equal(ai.label, "AI Pro");
  assert.equal(ai.monthly, 99);
  assert.equal(ai.active, false);
  assert.ok(ai.defaults.label && ai.defaults.label !== "AI Pro", "standaardwaarde blijft beschikbaar voor reset");
  // Zonder includeInactive verdwijnt een gedeactiveerde add-on uit het aanbod.
  assert.ok(!listAddons({ ai_actions: { active: false } }).find(a => a.key === "ai_actions"), "inactieve add-on niet in publiek aanbod");
});

// ── Sector-terminologie ──────────────────────────────────────
const { terminologyFor, isValidSector } = require("../src/modules/sectors");

test("sectors: terminologie per sector met nette fallback", () => {
  assert.deepEqual(terminologyFor({ sector: "zorg" }), { venue: "Cliëntadres", venuePlural: "Cliëntadressen", job: "Bezoek", jobPlural: "Bezoeken" });
  assert.equal(terminologyFor({ sector: "hvac" }).jobPlural, "Interventies");
  assert.equal(terminologyFor({}).jobPlural, "Werkbonnen");
  assert.equal(terminologyFor({ sector: "bestaat-niet" }).venue, "Locatie");
  assert.equal(isValidSector("bouw"), true);
  assert.equal(isValidSector("xyz"), false);
});

// ── SAML SSO (add-on) ────────────────────────────────────────
const saml = require("../src/modules/saml");

test("saml: sanitizeSsoInput normaliseert domeinen, JIT-rol en booleans", () => {
  const out = saml.sanitizeSsoInput({
    enabled: 1, entryPoint: " https://idp/sso ", idpCert: " CERT ",
    domains: ["@Acme.BE", " bedrijf.com ", ""],
    jit: { enabled: 1, defaultRole: "super_admin" }, // mag NOOIT super_admin worden
    attrMap: { email: " mail ", name: "" }
  }, {});
  assert.equal(out.enabled, true);
  assert.equal(out.entryPoint, "https://idp/sso");
  assert.equal(out.idpCert, "CERT");
  assert.deepEqual(out.domains, ["acme.be", "bedrijf.com"]);
  assert.equal(out.jit.enabled, true);
  assert.equal(out.jit.defaultRole, "employee"); // geclampt
  assert.equal(out.attrMap.email, "mail");
});

test("saml: ssoConfigured vereist enabled + entryPoint + idpCert", () => {
  assert.equal(saml.ssoConfigured({ sso: { enabled: true, entryPoint: "x", idpCert: "y" } }), true);
  assert.equal(saml.ssoConfigured({ sso: { enabled: false, entryPoint: "x", idpCert: "y" } }), false);
  assert.equal(saml.ssoConfigured({ sso: { enabled: true, entryPoint: "x" } }), false);
  assert.equal(saml.ssoConfigured({}), false);
});

test("saml: extractIdentity haalt e-mail uit attributen of nameID-fallback", () => {
  const t = { id: "t1", sso: {} };
  assert.equal(saml.extractIdentity({ "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress": "JAN@acme.be" }, t).email, "jan@acme.be");
  assert.equal(saml.extractIdentity({ nameID: "piet@acme.be" }, t).email, "piet@acme.be");
  assert.equal(saml.extractIdentity({ email: "x@y.be", displayName: "X Y" }, t).name, "X Y");
  // attribuut-mapping override
  const t2 = { id: "t2", sso: { attrMap: { email: "customMail" } } };
  assert.equal(saml.extractIdentity({ customMail: "mapped@acme.be" }, t2).email, "mapped@acme.be");
});

test("saml: jitRole clam't naar veilige rollen, publicSsoConfig toont SP-URLs", () => {
  assert.equal(saml.jitRole({ sso: { jit: { defaultRole: "manager" } } }), "manager");
  assert.equal(saml.jitRole({ sso: { jit: { defaultRole: "tenant_admin" } } }), "employee");
  const pub = saml.publicSsoConfig({ id: "t9", sso: { enabled: true, entryPoint: "https://idp/sso", idpCert: "C" } });
  assert.match(pub.acsUrl, /\/api\/auth\/saml\/t9\/acs$/);
  assert.match(pub.metadataUrl, /\/api\/auth\/saml\/t9\/metadata$/);
  assert.equal(pub.configured, true);
});

test("saml: buildLoginUrl produceert een SAMLRequest-redirect; validateAcs weigert rommel", async () => {
  const dummyCert = "-----BEGIN CERTIFICATE-----\nMIIBdummybase64\n-----END CERTIFICATE-----";
  const tenant = { id: "t1", sso: { enabled: true, entryPoint: "https://idp.example/sso", idpCert: dummyCert } };
  const url = await saml.buildLoginUrl(tenant, "");
  assert.match(url, /^https:\/\/idp\.example\/sso\?SAMLRequest=/);
  await assert.rejects(saml.validateAcs(tenant, { SAMLResponse: Buffer.from("<garbage/>").toString("base64") }));
});

// ── Peppol UBL-opbouw + validatie ────────────────────────────
const _peppolTenant = {
  id: "t1", name: "Demo Bouw NV",
  invoiceProfile: { vat: "BE0456789034", street: "Bouwstraat 1", postalCode: "9000", city: "Gent", country: "BE", iban: "BE68539007547034" }
};
const _peppolInvoice = {
  id: "inv1", number: "F2026-001", invoiceDate: "2026-06-01", dueDate: "2026-07-01",
  customerName: "Klant BV", customerVatNumber: "BE0678901218", customerAddress: "Klantlaan 2, Brugge",
  subtotal: 100, vatAmount: 21, total: 121,
  lines: [{ description: "Werkuren", qty: 1, unitPrice: 100, vatRate: 21, lineSubtotal: 100, lineVat: 21 }]
};

test("peppol: validatePeppol vangt ontbrekende/foute verplichte velden", () => {
  assert.equal(validatePeppol(_peppolInvoice, _peppolTenant).ok, true);
  // klant-BTW ontbreekt
  const noVat = validatePeppol({ ..._peppolInvoice, customerVatNumber: "" }, _peppolTenant);
  assert.equal(noVat.ok, false);
  assert.ok(noVat.errors.some(e => /BTW-nummer van de klant/i.test(e)));
  // ongeldig BTW (mod-97)
  const badVat = validatePeppol({ ..._peppolInvoice, customerVatNumber: "BE0000000000" }, _peppolTenant);
  assert.equal(badVat.ok, false);
});

test("peppol: buildUbl produceert geldige BIS 3.0 UBL met kernvelden", () => {
  const xml = buildUbl(_peppolInvoice, _peppolTenant);
  assert.match(xml, /<Invoice/);
  assert.match(xml, /poacc:billing:3\.0/);
  assert.match(xml, /<cbc:ID>F2026-001<\/cbc:ID>/);
  assert.match(xml, /<cbc:PayableAmount currencyID="EUR">121\.00<\/cbc:PayableAmount>/);
  assert.match(xml, /BE0456789034/); // leverancier-BTW
  assert.match(xml, /BE0678901218/); // klant-BTW
  assert.match(xml, /<cbc:Percent>21\.00<\/cbc:Percent>/);
});

// ── Platform-ops aggregaties (superadmin Operations) ─────────
const { eventLog, backupSummary } = require("../src/modules/platform-ops");

test("platform-ops: eventLog aggregeert events platformbreed, telt fouten", () => {
  const store = { data: { tenants: [
    { id: "t1", name: "A", billingOps: { stripeEvents: [ { id:"e1", type:"invoice.payment_succeeded", status:"processed", action:"invoice_paid", at:"2026-06-01T10:00:00Z" } ] } },
    { id: "t2", name: "B", billingOps: { stripeEvents: [ { id:"e2", type:"invoice.payment_failed", status:"failed", action:"payment_failed", at:"2026-06-02T10:00:00Z" } ] } },
  ] } };
  const r = eventLog(store, 10);
  assert.equal(r.total, 2);
  assert.equal(r.failed, 1);
  assert.equal(r.events[0].tenant, "B", "nieuwste event eerst");
});

test("platform-ops: backupSummary markeert ontbrekend/oud per tenant", () => {
  const store = { data: { tenants: [{ id:"t1", name:"A" }, { id:"t2", name:"B" }, { id:"t3", name:"C" }] } };
  const old = new Date(Date.now() - 40 * 86400000).toISOString();
  const fresh = new Date().toISOString();
  const stub = tid => tid === "t1" ? [{ createdAt: fresh }] : tid === "t2" ? [{ createdAt: old }] : [];
  const s = backupSummary(store, stub, 7);
  assert.equal(s.tenants, 3);
  assert.equal(s.missing, 1); // t3
  assert.equal(s.stale, 1);   // t2
  assert.equal(s.rows.find(r=>r.tenantId==="t1").status, "ok");
});

// ── Plan-prijs-overrides (superadmin-bewerkbare bundelprijzen) ──
const { setPlanPriceOverrides, planPricing } = require("../src/modules/billing");
const { lifecycle, resellerPayouts } = require("../src/modules/platform-ops");

test("billing: plan-prijs-override overschrijft default, planPricing toont beide", () => {
  setPlanPriceOverrides({ starter: { baseAnnual: 720, includedSeats: 4 } });
  const plans = planPricing();
  const starter = plans.find(p => p.key === "starter");
  assert.equal(starter.baseAnnual, 720, "override actief");
  assert.equal(starter.includedSeats, 4);
  assert.equal(starter.defaults.baseAnnual, 590, "default blijft zichtbaar");
  setPlanPriceOverrides({}); // reset zodat andere tests de defaults zien
  assert.equal(planPricing().find(p => p.key === "starter").baseAnnual, 590);
});

test("platform-ops: lifecycle telt status + trials + conversie", () => {
  const now = Date.now();
  const recent = new Date(now - 5 * 86400000).toISOString();
  const oldTrial = new Date(now - 20 * 86400000).toISOString();
  const store = { data: {
    tenants: [
      { id:"t1", name:"A", status:"active", createdAt: recent },
      { id:"t2", name:"B", status:"trial", createdAt: oldTrial, plan:"business" },
      { id:"t3", name:"C", status:"trial", createdAt: recent },
      { id:"t4", name:"D", status:"canceled", createdAt: "2024-01-01T00:00:00Z" },
    ],
    users: [{ tenantId:"t2", lastLoginAt: recent }],
  } };
  const lc = lifecycle(store, now);
  assert.equal(lc.counts.trial, 2);
  assert.equal(lc.counts.active, 1);
  assert.equal(lc.counts.canceled, 1);
  assert.equal(lc.conversionPct, 25); // 1 active / 4 total
  assert.equal(lc.trials[0].tenant, "B", "oudste trial eerst");
  assert.equal(lc.trials[0].lastActivityAt, recent);
});

test("platform-ops: resellerPayouts sommeert commissie van actieve resellers", () => {
  const store = { data: { resellers: [
    { id:"r1", name:"Partner X", status:"active", contactEmail:"x@p.be" },
    { id:"r2", name:"Inactief", status:"paused" },
  ] } };
  const fakeOverview = (s, r) => r.id === "r1" ? { rows:[{},{}], totalMrr: 400, totalCommission: 60 } : { rows:[], totalMrr:0, totalCommission:0 };
  const po = resellerPayouts(store, fakeOverview);
  assert.equal(po.rows.length, 1, "enkel actieve resellers");
  assert.equal(po.rows[0].clients, 2);
  assert.equal(po.totalMonthly, 60);
});

// ── Governance: security-center + GDPR/DPA-overzicht ──
const { securityCenter, gdprOverview } = require("../src/modules/platform-ops");

test("platform-ops: securityCenter aggregeert MFA, vergrendelde accounts, support-toegang", () => {
  const now = Date.now();
  const future = new Date(now + 3600000).toISOString();
  const fakeMfa = () => ({ totalAdmins: 2, readyAdmins: 1, missingMfa: 1, notEnforced: 0, rows: [{ ready: true }, { ready: false }] });
  const store = { data: {
    users: [
      { id:"u1", email:"a@x.be", lockedUntil: future, failedLogins: 5 },
      { id:"u2", email:"b@x.be" },
    ],
    tenants: [
      { id:"t1", name:"A", supportAccess: { allowed: true, allowedAt: "2026-01-01" } },
      { id:"t2", name:"B", supportAccess: { allowed: false } },
    ],
  } };
  const sc = securityCenter(store, fakeMfa, now);
  assert.equal(sc.mfa.readyAdmins, 1);
  assert.equal(sc.locked.length, 1);
  assert.equal(sc.locked[0].email, "a@x.be");
  assert.equal(sc.supportAccess.length, 1, "enkel tenants met consent");
});

test("platform-ops: gdprOverview telt DPA-ontbreekt + open verzoeken", () => {
  const store = { data: { tenants: [
    { id:"t1", name:"A", compliance: { dpaAcceptedAt: "2026-01-01", gdprRequests: [{ status:"received" }, { status:"processed" }] } },
    { id:"t2", name:"B", compliance: {} },
  ] } };
  const g = gdprOverview(store);
  assert.equal(g.tenants, 2);
  assert.equal(g.dpaMissing, 1);       // t2
  assert.equal(g.openRequests, 1);     // t1 received
  assert.equal(g.rows.find(r=>r.tenantId==="t1").totalRequests, 2);
});

// ── Platform-aankondiging (banner) normalisatie in platform-config ──
const { savePlatformConfig: savePC, loadPlatformConfig: loadPC } = require("../src/modules/platform-config");

test("platform-config: announcement normaliseert niveau + kapt bericht, en kan uit", () => {
  const store = reviewStore([]);
  store.data.platformConfig = [];
  store.insert = store.insert.bind(store);
  // onbekend niveau → info; te lang bericht → 500 tekens
  savePC(store, { announcement: { active: true, level: "rommel", message: "x".repeat(600) } }, { email: "super@wf.be" });
  let a = loadPC(store).announcement;
  assert.equal(a.active, true);
  assert.equal(a.level, "info");
  assert.equal(a.message.length, 500);
  // uitzetten
  savePC(store, { announcement: { active: false, level: "maintenance", message: "Onderhoud" } }, { email: "super@wf.be" });
  a = loadPC(store).announcement;
  assert.equal(a.active, false);
  assert.equal(a.level, "maintenance");
});

// ── Geo-klok (locatie-geverifieerd inklokken) ──
const { verifyClockGeo, distanceMeters, normalizeGeo } = require("../src/modules/geo");

test("geo: distanceMeters ~ haversine (Brussel→Antwerpen ≈ 40km)", () => {
  const d = distanceMeters({ lat: 50.8503, lng: 4.3517 }, { lat: 51.2194, lng: 4.4025 });
  assert.ok(d > 38000 && d < 43000, `verwacht ~40km, kreeg ${d}`);
});

test("geo: verifyClockGeo binnen/buiten geofence + randgevallen", () => {
  const venue = { id: "v1", geo: { lat: 50.85, lng: 4.35, radiusM: 150 } };
  const inside = verifyClockGeo({ lat: 50.8501, lng: 4.3501, accuracy: 10 }, venue);
  assert.equal(inside.verified, true);
  assert.equal(inside.status, "within_fence");
  const outside = verifyClockGeo({ lat: 50.86, lng: 4.36, accuracy: 10 }, venue);
  assert.equal(outside.verified, false);
  assert.equal(outside.status, "outside_fence");
  assert.ok(outside.distanceM > 150);
  // geen toestel-locatie
  assert.equal(verifyClockGeo(null, venue).status, "no_device_location");
  // geen werf-locatie
  assert.equal(verifyClockGeo({ lat: 50.85, lng: 4.35 }, { id: "v2" }).status, "no_venue_location");
  // te onnauwkeurig
  assert.equal(verifyClockGeo({ lat: 50.85, lng: 4.35, accuracy: 500 }, venue).status, "low_accuracy");
});

// ── CIAW / Checkin@Work ──
const { buildCheckinDeclaration, submitCheckin, validInsz } = require("../src/modules/ciaw");

test("ciaw: validInsz + buildCheckinDeclaration valideert verplichte velden", () => {
  assert.equal(validInsz("90.02.01-123.45"), true);
  assert.equal(validInsz("123"), false);
  const tenant = { compliance: { rszEmployerId: "12345678" } };
  const user = { name: "Jan", insz: "90020112345" };
  const venue = { id: "v1", name: "Werf A" };
  const ok = buildCheckinDeclaration({ tenant, clock: { id: "c1", date: "2026-06-25", clockIn: "08:00" }, user, venue, action: "in" });
  assert.equal(ok.valid, true);
  assert.equal(ok.declaration.action, "IN");
  assert.equal(ok.declaration.worker.insz, "90020112345");
  // ontbrekend RSZ-nummer + INSZ → errors
  const bad = buildCheckinDeclaration({ tenant: {}, clock: { id: "c2", date: "2026-06-25" }, user: {}, venue: null, action: "in" });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.length >= 2);
});

test("ciaw: submitCheckin valt terug op mock zonder live provider", async () => {
  const tenant = { compliance: { rszEmployerId: "12345678" } };
  const user = { name: "Jan", insz: "90020112345" };
  const venue = { id: "v1", name: "Werf A" };
  const res = await submitCheckin({ config: {}, tenant, clock: { id: "c1", date: "2026-06-25", clockIn: "08:00" }, user, venue, action: "in" });
  assert.equal(res.ok, true);
  assert.equal(res.live, false);
  assert.equal(res.status, "confirmed");
  assert.match(res.reference, /^MOCK-CIAW-/);
});

// ── A1 / Limosa detachering (DECA-B) ──
const pw = require("../src/modules/posted-workers");

test("posted-workers: a1Status valid/expiring/expired/missing", () => {
  const now = Date.UTC(2026, 5, 25);
  assert.equal(pw.a1Status({ documentRef: "A1-1", validTo: "2027-01-01" }, now), "valid");
  assert.equal(pw.a1Status({ documentRef: "A1-1", validTo: "2026-07-10" }, now), "expiring"); // <30d
  assert.equal(pw.a1Status({ documentRef: "A1-1", validTo: "2026-01-01" }, now), "expired");
  assert.equal(pw.a1Status({ validTo: "2027-01-01" }, now), "missing"); // geen documentRef
});

test("posted-workers: normalizeRecord verplicht naam + land en valideert datums", () => {
  assert.throws(() => pw.normalizeRecord({ country: "PL" }), e => e.status === 400); // geen naam
  assert.throws(() => pw.normalizeRecord({ workerName: "X" }), e => e.status === 400); // geen land
  assert.throws(() => pw.normalizeRecord({ workerName: "X", country: "PL", validFrom: "2026-06-10", validTo: "2026-06-01" }), e => e.status === 400);
  const ok = pw.normalizeRecord({ workerName: " Piotr ", country: "pl", idNumber: "123" });
  assert.equal(ok.workerName, "Piotr");
  assert.equal(ok.country, "PL");
});

test("posted-workers: CRUD + Limosa mock via store", async () => {
  const store = reviewStore([{ id: "t1", name: "Bouw BV", vat: "BE0123" }]);
  store.data.postedWorkers = [];
  const tenant = store.data.tenants[0];
  const actor = { email: "admin@bouw.be" };
  const rec = pw.createPostedWorker(store, tenant, { workerName: "Piotr", country: "PL", documentRef: "A1-77", validFrom: "2026-06-01", validTo: "2027-06-01" }, actor);
  assert.ok(rec.id);
  const list = pw.listPostedWorkers(store, tenant, Date.UTC(2026, 5, 25));
  assert.equal(list.total, 1);
  assert.equal(list.rows[0].a1Status, "valid");
  const lim = await pw.submitLimosa(store, tenant, rec.id, { config: {} }, actor);
  assert.equal(lim.ok, true);
  assert.equal(lim.limosa.live, false);
  assert.match(lim.limosa.reference, /^MOCK-LIMOSA-/);
  pw.deletePostedWorker(store, tenant, rec.id, actor);
  assert.equal(pw.listPostedWorkers(store, tenant).total, 0);
});

test("posted-workers: buildLimosaDeclaration vereist werknemer/land/begindatum", () => {
  const bad = pw.buildLimosaDeclaration({ tenant: { name: "X" }, record: { workerName: "", country: "" } });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.length >= 2);
  const ok = pw.buildLimosaDeclaration({ tenant: { name: "X", vat: "BE1" }, record: { workerName: "Piotr", country: "PL", validFrom: "2026-06-01", idNumber: "1" } });
  assert.equal(ok.valid, true);
  assert.equal(ok.declaration.worker.country, "PL");
});

// ── Verlof-aware planning (DECA-C) ──
const { leaveConflictOn, validatePlanningRules } = require("../src/modules/planning-rules");

test("planning: leaveConflictOn vindt goedgekeurd verlof op datum, negeert rest", () => {
  const store = reviewStore([{ id: "t1", name: "T" }]);
  store.data.leaves = [
    { id: "l1", tenantId: "t1", userId: "u1", status: "goedgekeurd", startDate: "2026-07-01", endDate: "2026-07-05" },
    { id: "l2", tenantId: "t1", userId: "u2", status: "aangevraagd", startDate: "2026-07-01", endDate: "2026-07-05" },
  ];
  assert.ok(leaveConflictOn(store, "t1", "u1", "2026-07-03"), "binnen goedgekeurd verlof → conflict");
  assert.equal(leaveConflictOn(store, "t1", "u1", "2026-07-10"), null, "buiten periode → geen conflict");
  assert.equal(leaveConflictOn(store, "t1", "u2", "2026-07-03"), null, "enkel aangevraagd → geen blok");
  assert.equal(leaveConflictOn(store, "t1", "u3", "2026-07-03"), null, "andere medewerker → geen conflict");
});

test("planning: validatePlanningRules blokkeert shift op goedgekeurd verlof (409)", () => {
  const store = reviewStore([{ id: "t1", name: "T" }]);
  store.data.leaves = [{ id: "l1", tenantId: "t1", userId: "u1", status: "goedgekeurd", startDate: "2026-07-01", endDate: "2026-07-05" }];
  assert.throws(
    () => validatePlanningRules(store, "t1", { userId: "u1", date: "2026-07-03", start: "08:00", end: "17:00" }),
    e => e.status === 409 && /verlof/i.test(e.message)
  );
  // geen verlof → geen worp
  assert.doesNotThrow(() => validatePlanningRules(store, "t1", { userId: "u1", date: "2026-08-01", start: "08:00", end: "17:00" }));
});
