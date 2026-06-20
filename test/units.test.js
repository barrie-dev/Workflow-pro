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
const { peppolTransportReadiness } = require("../src/modules/peppol-invoice");
const { liveServiceReadiness } = require("../src/modules/live-services");
const { importEmployees } = require("../src/modules/imports");
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
    peppol: { provider: "mock", apiKey: "" },
    appUrl: "http://localhost:4280",
    releaseChannel: "development",
    commitSha: "local-dev"
  });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.blockers.some(row => row.key === "storage_adapter"));
  assert.ok(blocked.blockers.some(row => row.key === "stripe_secret"));
  assert.ok(blocked.blockers.some(row => row.key === "peppol_provider"));

  const ready = liveServiceReadiness({
    storageAdapter: "postgres",
    supabase: {
      url: "https://workflowpro.supabase.co",
      serviceRoleKey: `${"a".repeat(40)}.${"b".repeat(40)}.${"c".repeat(40)}`
    },
    databaseUrl: "postgresql://user:pass@aws-0-eu-west-1.pooler.supabase.com:6543/postgres",
    stripe: { secretKey: "sk_live_12345678901234567890", webhookSecret: "whsec_12345678901234567890" },
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
