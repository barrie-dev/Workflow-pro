"use strict";
// Unit-tests voor pure businesslogica (geen store/HTTP nodig).
const { test } = require("node:test");
const assert = require("node:assert");

const { lookupKbo, lookupKboResolve, parseViesAddress, normalizeVat } = require("../src/modules/kbo");
const {
  buildSupportGrant, issueSupportToken, supportGrantStatus, slideSupportGrant,
  assertSupportWrite, SUPPORT_IDLE_MS, SUPPORT_HARD_MS, can, canWrite
} = require("../src/lib/auth");
const { Store } = require("../src/lib/store");
const { runSupportAccessReview } = require("../src/modules/support-access");
const { verifyStripeSignature } = require("../src/modules/stripe-webhook");
const { peppolTransportReadiness, buildUbl, validatePeppol } = require("../src/modules/peppol-invoice");
const { liveServiceReadiness } = require("../src/modules/live-services");
const { importEmployees } = require("../src/modules/imports");
const { productionConfigRisk } = require("../src/modules/production");
const { clockIn, clockOut } = require("../src/modules/operations");
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

// Nep-transport dat één VIES-antwoord teruggeeft (geen echt netwerk).
function fakeViesTransport(responseJson, { fail = false } = {}) {
  const { EventEmitter } = require("node:events");
  return {
    request(_options, cb) {
      const req = new EventEmitter();
      req.setTimeout = () => {};
      req.write = () => {};
      req.destroy = () => {};
      req.end = () => {
        process.nextTick(() => {
          if (fail) return req.emit("error", new Error("netwerk stuk"));
          const res = new EventEmitter();
          cb(res);
          res.emit("data", JSON.stringify(responseJson));
          res.emit("end");
        });
      };
      return req;
    }
  };
}

test("parseViesAddress: BE-adres → straat/postcode/gemeente", () => {
  assert.deepEqual(parseViesAddress("STATIONSSTRAAT 44\n2800 MECHELEN"),
    { street: "STATIONSSTRAAT 44", zip: "2800", city: "MECHELEN" });
});

test("lookupKboResolve: geldige VIES-hit geeft echte naam + adres", async () => {
  const t = fakeViesTransport({ valid: true, name: "ACME BOUW", address: "NIJVERHEIDSLAAN 5\n3600 GENK" });
  const c = await lookupKboResolve("BE0417497106", { transport: t });
  assert.equal(c.source, "vies");
  assert.equal(c.name, "ACME BOUW");
  assert.equal(c.street, "NIJVERHEIDSLAAN 5");
  assert.equal(c.zip, "3600");
  assert.equal(c.city, "GENK");
  assert.equal(c.companyNumber, "0417497106");
});

test("lookupKboResolve: ongeldig VIES-antwoord → mock-fallback zonder throw", async () => {
  const t = fakeViesTransport({ valid: false });
  const c = await lookupKboResolve("BE0417497106", { transport: t });
  assert.equal(c.companyNumber, "0417497106");
  assert.equal(c.street, "");
});

test("lookupKboResolve: VIES onbereikbaar → mock-fallback zonder throw", async () => {
  const t = fakeViesTransport(null, { fail: true });
  const c = await lookupKboResolve("BE0417497106", { transport: t });
  assert.equal(c.source, "mock-kbo-fallback");
});

// ── Lees/schrijf-permissieniveaus ───────────────────────────────────────────────
test("rechten: read:X geeft lezen maar niet schrijven; own:/vol = schrijven", () => {
  const u = { role: "employee", permissions: ["read:workorders", "own:expenses", "invoicing"] };
  assert.equal(can(u, "workorders"), true, "read:X → mag zien");
  assert.equal(canWrite(u, "workorders"), false, "read:X → mag niet wijzigen");
  assert.equal(can(u, "expenses"), true);
  assert.equal(canWrite(u, "expenses"), true, "own:X → mag (eigen) schrijven");
  assert.equal(canWrite(u, "invoicing"), true, "vol recht → schrijven");
  assert.equal(can(u, "leaves"), false, "geen recht → geen toegang");
  assert.equal(canWrite({ role: "super_admin", permissions: [] }, "workorders"), true);
});

test("lookupKboResolve: fixture sluit kort vóór het netwerk", async () => {
  let touched = false;
  const t = { request() { touched = true; throw new Error("netwerk mag niet geraakt worden"); } };
  const c = await lookupKboResolve("BE0123456789", { transport: t });
  assert.equal(c.name, "Demo Bouwgroep NV");
  assert.equal(c.zip, "9000");
  assert.equal(touched, false);
});

// ── Automatische betaalherinneringen ────────────────────────────────────────────
const { reminderDue, MAX_REMINDERS } = require("../src/modules/payment-reminders");

test("betaalherinnering: enkel vervallen open facturen, met interval en maximum", () => {
  const today = "2026-07-09";
  const base = { status: "open", dueDate: "2026-07-01", paidAt: null };
  assert.equal(reminderDue({ ...base }, today), true, "vervallen zonder eerdere herinnering");
  assert.equal(reminderDue({ ...base, dueDate: "2026-07-20" }, today), false, "nog niet vervallen");
  assert.equal(reminderDue({ ...base, paidAt: "2026-07-02" }, today), false, "betaald");
  assert.equal(reminderDue({ ...base, status: "draft" }, today), false, "concept niet herinneren");
  const gisteren = new Date(Date.now() - 1 * 86400000).toISOString();
  assert.equal(reminderDue({ ...base, reminders: [{ at: gisteren }] }, today), false, "interval van 7 dagen respecteren");
  const langGeleden = new Date(Date.now() - 10 * 86400000).toISOString();
  assert.equal(reminderDue({ ...base, reminders: [{ at: langGeleden }] }, today), true, "na interval opnieuw");
  const max = Array.from({ length: MAX_REMINDERS }, () => ({ at: langGeleden }));
  assert.equal(reminderDue({ ...base, reminders: max }, today), false, "maximum bereikt");
});

// ── Klantfacturatie: gedeelde logica + werkbon→factuur ──────────────────────────
const { createCustomerInvoice, workorderInvoicePayload } = require("../src/modules/customer-invoicing");
function fakeInvoiceStore() {
  const data = { invoices: [] };
  return {
    _data: data,
    list: (coll, tid) => (data[coll] || []).filter(r => r.tenantId === tid),
    insert: (coll, row) => { (data[coll] = data[coll] || []).push(row); return row; },
    audit: () => {},
  };
}

test("createCustomerInvoice: cent-afronding + gestructureerde mededeling", () => {
  const store = fakeInvoiceStore();
  const inv = createCustomerInvoice(store, { id: "t1" }, { email: "a@b.be" },
    { customerName: "Klant A", lines: [{ description: "Uren", qty: 3, unitPrice: 33.33, vatRate: 21 }] });
  assert.equal(inv.subtotal, 99.99);
  assert.equal(inv.vatAmount, 21);
  assert.equal(inv.total, 120.99);
  assert.match(inv.structuredComm, /^\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+$/);
  assert.match(inv.number, /^\d{4}-001$/);
});

test("createCustomerInvoice: medecontractant → btw verlegd (0%)", () => {
  const store = fakeInvoiceStore();
  const inv = createCustomerInvoice(store, { id: "t1" }, { email: "a@b.be" },
    { customerName: "BE Aannemer", vatRegime: "medecontractant", lines: [{ description: "Ruwbouw", qty: 1, unitPrice: 5000, vatRate: 21 }] });
  assert.equal(inv.vatAmount, 0);
  assert.equal(inv.total, 5000);
  assert.match(inv.vatNote, /medecontractant/i);
});

test("workorderInvoicePayload: uren × standaardtarief → één lijn", () => {
  const payload = workorderInvoicePayload({}, { id: "t1", defaultHourlyRate: 50 },
    { id: "wo1", number: "WO-2026-007", title: "Dakwerk", clientName: "Klant X", billableHours: 4 });
  assert.equal(payload.lines.length, 1);
  assert.equal(payload.lines[0].qty, 4);
  assert.equal(payload.lines[0].unitPrice, 50);
  assert.equal(payload.customerName, "Klant X");
  assert.equal(payload.workorderId, "wo1");
});

test("workorderInvoicePayload: vast bedrag → één lijn qty 1", () => {
  const payload = workorderInvoicePayload({}, { id: "t1" },
    { id: "wo2", number: "WO-2026-008", title: "Forfait", billableAmount: 1500 });
  assert.equal(payload.lines.length, 1);
  assert.equal(payload.lines[0].qty, 1);
  assert.equal(payload.lines[0].unitPrice, 1500);
});

test("workorderInvoicePayload: niets factureerbaar → 422", () => {
  assert.throws(() => workorderInvoicePayload({}, { id: "t1" }, { id: "wo3", title: "Leeg" }),
    e => e.status === 422);
});

test("workorderInvoicePayload: uren + materiaal → uren-lijn + materiaallijnen", () => {
  const payload = workorderInvoicePayload({}, { id: "t1", defaultHourlyRate: 50 }, {
    id: "wo4", number: "WO-2026-010", title: "Badkamer", clientName: "Klant Y", billableHours: 3,
    materials: [
      { description: "Tegels", qty: 20, unitPrice: 4.5 },
      { description: "Voegsel", qty: 2, unitPrice: 12 },
      { description: "Ongeldig", qty: 0, unitPrice: 5 },   // wordt genegeerd
    ],
  });
  assert.equal(payload.lines.length, 3, "1 uren + 2 geldige materiaallijnen");
  assert.equal(payload.lines[0].qty, 3);
  assert.equal(payload.lines[1].description, "Tegels");
  assert.equal(payload.lines[2].unitPrice, 12);
});

test("workorderInvoicePayload: enkel materiaal (geen uren) blijft factureerbaar", () => {
  const payload = workorderInvoicePayload({}, { id: "t1" }, {
    id: "wo5", title: "Levering", materials: [{ description: "Kraan", qty: 1, unitPrice: 89 }],
  });
  assert.equal(payload.lines.length, 1);
  assert.equal(payload.lines[0].description, "Kraan");
});

test("createCustomerInvoice + werkbon-payload werken samen (uren-flow)", () => {
  const store = fakeInvoiceStore();
  const payload = workorderInvoicePayload(store, { id: "t1", defaultHourlyRate: 45 },
    { id: "wo9", number: "WO-2026-009", title: "Onderhoud", clientName: "Klant Z", clockedHours: 2 });
  const inv = createCustomerInvoice(store, { id: "t1" }, { email: "a@b.be" }, payload);
  assert.equal(inv.subtotal, 90);
  assert.equal(inv.total, 108.9);          // 90 + 21%
  assert.equal(inv.workorderId, "wo9");
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

  // Sinds de P0-01-cutover is de database-gereedheid provider-neutraal: enkel
  // STORAGE_ADAPTER=postgres + een geldige DATABASE_URL. GEEN Supabase-vars meer
  // (die zijn legacy). Dit bewijst dat de go-live-gate productie niet langer
  // vals blokkeert op ontbrekende SUPABASE_URL.
  const ready = liveServiceReadiness({
    storageAdapter: "postgres",
    supabase: { url: "", serviceRoleKey: "" },   // bewust leeg · niet meer vereist
    databaseUrl: "postgresql://user:pass@aws-0-eu-west-1.pooler.supabase.com:6543/postgres",
    stripe: { secretKey: "sk_live_12345678901234567890", webhookSecret: "whsec_12345678901234567890" },
    email: { provider: "resend", apiKey: "re_live_12345678901234567890", from: "WorkFlow Pro <noreply@workflowpro.be>" },
    peppol: { provider: "billit", apiKey: "live_peppol_secret_123456789" },
    appUrl: "https://app.workflowpro.be",
    releaseChannel: "production",
    commitSha: "b2f721cc0ffee"
  });
  assert.equal(ready.ok, true, "postgres + DATABASE_URL volstaat, zonder Supabase-vars");
  assert.equal(ready.blockers.length, 0);
  assert.equal(ready.warnings.length, 0);

  // Een provider-neutrale (niet-Supabase) productie-URL, bv. Azure, is óók klaar.
  const azureReady = liveServiceReadiness({
    storageAdapter: "postgres",
    supabase: { url: "", serviceRoleKey: "" },
    databaseUrl: "postgresql://mon:pw@monargo.postgres.database.azure.com:5432/monargo?sslmode=require",
    stripe: { secretKey: "sk_live_12345678901234567890", webhookSecret: "whsec_12345678901234567890" },
    email: { provider: "resend", apiKey: "re_live_12345678901234567890", from: "Monargo <noreply@monargo.one>" },
    peppol: { provider: "billit", apiKey: "live_peppol_secret_123456789" },
    appUrl: "https://app.monargo.one",
    releaseChannel: "production",
    commitSha: "b2f721cc0ffee"
  });
  const dbBlocker = azureReady.blockers.find(r => r.key === "database_url" || r.key === "storage_adapter");
  assert.equal(dbBlocker, undefined, "Azure-Postgres zonder pooler blokkeert de database-gereedheid niet");
  const poolWarn = azureReady.warnings.find(r => r.key === "database_pooling");
  assert.ok(poolWarn, "directe (niet-pooler) verbinding geeft enkel een P1-aanbeveling, geen blocker");
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
  assert.equal(validInsz("93.05.18-223.61"), true);
  assert.equal(validInsz("123"), false);
  const tenant = { compliance: { rszEmployerId: "12345678" } };
  const user = { name: "Jan", insz: "93051822361" };
  const venue = { id: "v1", name: "Werf A" };
  const ok = buildCheckinDeclaration({ tenant, clock: { id: "c1", date: "2026-06-25", clockIn: "08:00" }, user, venue, action: "in" });
  assert.equal(ok.valid, true);
  assert.equal(ok.declaration.action, "IN");
  assert.equal(ok.declaration.worker.insz, "93051822361");
  // ontbrekend RSZ-nummer + INSZ → errors
  const bad = buildCheckinDeclaration({ tenant: {}, clock: { id: "c2", date: "2026-06-25" }, user: {}, venue: null, action: "in" });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.length >= 2);
});

test("ciaw: submitCheckin valt terug op mock zonder live provider", async () => {
  const tenant = { compliance: { rszEmployerId: "12345678" } };
  const user = { name: "Jan", insz: "93051822361" };
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

// ── Robaws werf-documentatie-sync (DECA-D) ──
const { buildRobawsDocManifest, runRobawsDocSync } = require("../src/modules/integrations");

test("integrations: buildRobawsDocManifest groepeert werkbonnen + documenten per werf", () => {
  const store = reviewStore([{ id: "t1", name: "T" }]);
  store.data.venues = [{ id: "v1", tenantId: "t1", name: "Werf A" }, { id: "v2", tenantId: "t1", name: "Werf B (leeg)" }];
  store.data.workorders = [{ id: "w1", tenantId: "t1", venueId: "v1", title: "Ruwbouw" }];
  store.data.files = [
    { id: "f1", tenantId: "t1", venueId: "v1", name: "plan.pdf" },
    { id: "f2", tenantId: "t1", workorderId: "w1", name: "foto.jpg" },
  ];
  const m = buildRobawsDocManifest(store, store.data.tenants[0]);
  assert.equal(m.totals.projects, 1, "lege werf wordt weggelaten");
  const p = m.projects[0];
  assert.equal(p.venueId, "v1");
  assert.equal(p.workorders, 1);
  assert.equal(p.documents.length, 2, "venue-doc + workorder-doc geteld");
  assert.equal(m.totals.documents, 2);
});

test("integrations: runRobawsDocSync logt mock-sync; weigert niet-Robaws", () => {
  const store = reviewStore([{ id: "t1", name: "T" }]);
  store.data.venues = [{ id: "v1", tenantId: "t1", name: "Werf A" }];
  store.data.workorders = [{ id: "w1", tenantId: "t1", venueId: "v1", title: "X" }];
  store.data.files = [{ id: "f1", tenantId: "t1", venueId: "v1", name: "plan.pdf" }];
  store.data.integrations = [
    { id: "i1", tenantId: "t1", provider: "robaws", syncLogs: [] },
    { id: "i2", tenantId: "t1", provider: "exact", syncLogs: [] },
  ];
  const tenant = store.data.tenants[0];
  const r = runRobawsDocSync(store, tenant, "i1", { email: "a@b.be" });
  assert.equal(r.log.kind, "documents");
  assert.equal(r.log.live, false);
  assert.equal(r.manifest.totals.documents, 1);
  assert.throws(() => runRobawsDocSync(store, tenant, "i2", { email: "a@b.be" }), e => e.status === 400);
});

// ── CIAW leest nationalId van de medewerkersfiche (DECA-A UI-fix) ──
test("ciaw: buildCheckinDeclaration leest user.nationalId als INSZ", () => {
  const { buildCheckinDeclaration } = require("../src/modules/ciaw");
  const r = buildCheckinDeclaration({
    tenant: { compliance: { rszEmployerId: "12345678" } },
    clock: { id: "c1", date: "2026-06-25", clockIn: "08:00" },
    user: { name: "Jan", nationalId: "93.05.18-223.61" },
    venue: { id: "v1", name: "Werf A" }, action: "in"
  });
  assert.equal(r.valid, true, "nationalId wordt als geldig INSZ herkend");
  assert.equal(r.declaration.worker.insz, "93051822361");
});

// ── Kern-flow diepgang: geklokte uren → werkbon → factuur (DEPTH) ──
const wr = require("../src/modules/workorder-rules");
const { createInvoice } = require("../src/modules/billing");

test("workorder-rules: clockedHoursForWorkorder somt enkel afgesloten clocks van die werkbon", () => {
  const clocks = [
    { workorderId: "w1", clockOut: "17:00", durationMinutes: 480 }, // 8u
    { workorderId: "w1", clockOut: "12:00", durationMinutes: 120 }, // 2u
    { workorderId: "w1", clockOut: null, durationMinutes: 0 },        // open → niet meetellen
    { workorderId: "w2", clockOut: "17:00", durationMinutes: 300 },   // andere werkbon
    { workorderId: "w1", clockOut: "10:15", durationMinutes: 75 },    // 1.25u
  ];
  assert.equal(wr.clockedHoursForWorkorder(clocks, "w1"), 11.25);
  assert.equal(wr.clockedHoursForWorkorder(clocks, "w2"), 5);
  assert.equal(wr.clockedHoursForWorkorder(clocks, "onbekend"), 0);
  assert.equal(wr.clockedHoursForWorkorder(clocks, null), 0);
});

test("workorder-rules: completion vult billableHours uit geklokte uren, respecteert handmatig + not_billable", () => {
  const actor = { email: "a@b.be" };
  const base = { id: "w1", status: "Gepland", checklist: [] };
  // auto-fill uit geklokte uren
  const auto = wr.buildCompletionPatch(base, { clockedHours: 7.5 }, actor);
  assert.equal(auto.billableStatus, "ready_for_invoice");
  assert.equal(auto.billableHours, 7.5);
  assert.equal(auto.clockedHours, 7.5);
  // handmatige uren blijven leidend → patch laat billableHours ongemoeid
  const manual = wr.buildCompletionPatch({ ...base, billableHours: 4 }, { clockedHours: 7.5 }, actor);
  assert.equal(manual.billableHours, undefined, "patch overschrijft handmatige uren niet");
  // vaste prijs → geen uren-override
  const fixed = wr.buildCompletionPatch({ ...base, fixedPrice: 500 }, { clockedHours: 7.5 }, actor);
  assert.equal(fixed.billableHours, undefined);
  // niet-factureerbaar
  const nb = wr.buildCompletionPatch({ ...base, billable: false }, { clockedHours: 7.5 }, actor);
  assert.equal(nb.billableStatus, "not_billable");
  assert.equal(nb.billableHours, undefined);
});

test("kern-flow e2e: clock → werkbon afronden → factuur met echte uren × standaardtarief", () => {
  const store = reviewStore([{ id: "t1", name: "T", defaultHourlyRate: 60, billingOps: {} }]);
  store.data.workorders = [{ id: "w1", tenantId: "t1", title: "Interventie A", status: "Gepland", billable: true, checklist: [] }];
  store.data.clocks = [
    { id: "c1", tenantId: "t1", workorderId: "w1", clockOut: "17:00", durationMinutes: 480 },
    { id: "c2", tenantId: "t1", workorderId: "w1", clockOut: "12:00", durationMinutes: 120 },
  ];
  const tenant = store.data.tenants[0];
  // werkbon afronden → uren afgeleid uit 10u geklokt
  const { completeWorkorder } = require("../src/modules/mobile");
  const wo = completeWorkorder(store, tenant, "w1", {}, { email: "mgr@t.be" });
  assert.equal(wo.billableHours, 10);
  assert.equal(wo.hourlyRate, 60, "standaard-uurtarief bevroren op de werkbon");
  assert.equal(wo.billableStatus, "ready_for_invoice");
  // factuur uit werkbonnen → 10u × €60 = €600
  const { invoice } = createInvoice(store, tenant, { fromWorkorders: true, workorderIds: ["w1"] }, { email: "mgr@t.be" });
  const line = invoice.lines.find(l => l.workorderId === "w1");
  assert.equal(line.quantity, 10);
  assert.equal(line.unitPrice, 60);
  assert.equal(line.amount, 600);
});

test("billing: werkbon zonder uren/tarief geeft duidelijke, bruikbare foutmelding", () => {
  const store = reviewStore([{ id: "t1", name: "T", billingOps: {} }]);
  store.data.workorders = [{ id: "w1", tenantId: "t1", title: "Geen uren", billableStatus: "ready_for_invoice" }];
  assert.throws(
    () => createInvoice(store, store.data.tenants[0], { fromWorkorders: true }, { email: "a@b.be" }),
    e => e.status === 422 && /geen .*uren/i.test(e.message)
  );
});

// ── CIAW diepgang: echte INSZ mod-97 + aanwezigheidsregister (DEPTH) ──
const ciaw2 = require("../src/modules/ciaw");

test("ciaw: validInsz controleert het mod-97 controlegetal (echt rijksregisternr)", () => {
  // Geldig voorbeeld (geboren <2000): 93051822361 → 97-(930518223 mod 97)=61
  assert.equal(ciaw2.validInsz("93.05.18-223.61"), true);
  // Verkeerd controlegetal
  assert.equal(ciaw2.validInsz("93051822360"), false);
  // Te kort
  assert.equal(ciaw2.validInsz("930518223"), false);
  // Geldig voorbeeld geboren ≥2000: prepend "2": 00010100135 → 97-(2000101001 mod 97)
  const base = "000101001";
  const r = (() => { const m = 97 - (Number("2" + base) % 97); return m === 0 ? 97 : m; })();
  assert.equal(ciaw2.validInsz(base + String(r).padStart(2, "0")), true);
});

test("ciaw: buildPresenceRegister toont enkel ingeklokte werknemers + CIAW-status", () => {
  const now = new Date("2026-06-25T10:00:00Z");
  const reg = ciaw2.buildPresenceRegister({
    clocks: [
      { userId: "u1", venueId: "v1", date: "2026-06-25", clockIn: "08:00", clockOut: null, ciaw: { status: "confirmed", reference: "MOCK-1" } },
      { userId: "u2", venueId: "v1", date: "2026-06-25", clockIn: "08:30", clockOut: null, ciaw: { status: "rejected" } },
      { userId: "u3", venueId: "v1", date: "2026-06-25", clockIn: "07:00", clockOut: "12:00" }, // uitgeklokt → niet aanwezig
    ],
    users: [
      { id: "u1", name: "Jan", nationalId: "93051822361" },
      { id: "u2", name: "Piet", nationalId: "000" },
    ],
    venues: [{ id: "v1", name: "Werf A" }],
    now,
  });
  assert.equal(reg.present, 2, "enkel niet-uitgeklokte werknemers");
  assert.equal(reg.confirmed, 1);
  assert.equal(reg.issues, 1);
  const jan = reg.rows.find(r => r.name === "Jan");
  assert.equal(jan.inszValid, true);
  assert.equal(jan.ciawStatus, "confirmed");
  assert.equal(reg.rows.find(r => r.name === "Piet").inszValid, false);
});

// ── A1-bestand (DECA-B diepgang): upload-validatie + lijst strip blob ──
test("posted-workers: A1-bestand wordt gevalideerd + niet in de lijst-blob teruggegeven", () => {
  const store = reviewStore([{ id: "t1", name: "T" }]);
  store.data.postedWorkers = [];
  const tenant = store.data.tenants[0]; const actor = { email: "a@b.be" };
  const pdf = "data:application/pdf;base64,JVBERi0xLjQK";
  const rec = pw.createPostedWorker(store, tenant, { workerName: "Piotr", country: "PL", documentFile: pdf, documentFileName: "a1.pdf" }, actor);
  assert.equal(store.get("postedWorkers", rec.id).documentFile, pdf, "blob bewaard in de store");
  const list = pw.listPostedWorkers(store, tenant);
  assert.equal(list.rows[0].hasFile, true);
  assert.equal(list.rows[0].documentFile, undefined, "blob niet in de lijst");
  // verkeerd type → fout
  assert.throws(() => pw.createPostedWorker(store, tenant, { workerName: "X", country: "PL", documentFile: "data:text/plain;base64,QQ==" }, actor), e => e.status === 400);
});

// ── Geharde HTTP-client (DECA #4): timeout + statuscode-afhandeling ──
const { httpsRequest, postJson } = require("../src/lib/http-client");
const { EventEmitter } = require("node:events");

// Fake transport die nooit antwoordt → moet door de timeout afgebroken worden.
function hangingTransport() {
  return { request() { const req = new EventEmitter(); req.setTimeout = (ms, cb) => { req._to = setTimeout(cb, ms); }; req.write = () => {}; req.end = () => {}; req.destroy = err => req.emit("error", err); return req; } };
}
// Fake transport die met een gegeven status + body antwoordt.
function respondingTransport(statusCode, bodyText) {
  return { request(opts, cb) {
    const req = new EventEmitter(); req.setTimeout = () => {}; req.write = () => {}; req.destroy = () => {};
    req.end = () => { const res = new EventEmitter(); res.statusCode = statusCode; cb(res); res.emit("data", bodyText); res.emit("end"); };
    return req;
  } };
}

test("http-client: breekt af met ETIMEDOUT als de provider niet antwoordt", async () => {
  await assert.rejects(
    httpsRequest({ hostname: "x", path: "/", body: "{}", timeoutMs: 50, transport: hangingTransport() }),
    e => e.code === "ETIMEDOUT"
  );
});

test("http-client: postJson geeft JSON bij 2xx en gooit bij 4xx/5xx", async () => {
  const ok = await postJson("x", "/", {}, { a: 1 }, { transport: respondingTransport(200, '{"ref":"R1"}') });
  assert.equal(ok.ref, "R1");
  await assert.rejects(
    postJson("x", "/", {}, {}, { transport: respondingTransport(500, '{"error":{"message":"kapot"}}') }),
    e => /kapot/.test(e.message)
  );
});

// ── Configureerbare documentsjablonen (templates.js) ──
const tplMod = require("../src/modules/templates");

test("templates: mergeFields vervangt + escapet tokens, onbekend → leeg", () => {
  const f = { "bedrijf.naam": "Bouw & Co", "klant.naam": "<x>" };
  assert.equal(tplMod.mergeFields("Van {{bedrijf.naam}} aan {{klant.naam}}", f), "Van Bouw &amp; Co aan &lt;x&gt;");
  assert.equal(tplMod.mergeFields("{{onbekend.veld}}", f), "");
});

test("templates: buildContext vult type-specifieke velden", () => {
  const tenant = { name: "T BV", vatNumber: "BE0123", invoiceProfile: { iban: "BE68..." } };
  const inv = tplMod.buildContext("invoice", { number: "2026-1", invoiceDate: "2026-06-01", dueDate: "2026-07-01", subtotal: 100, vatAmount: 21, total: 121 }, tenant);
  assert.equal(inv.fields["bedrijf.naam"], "T BV");
  assert.equal(inv.fields["bedrijf.iban"], "BE68...");
  assert.ok(inv.fields["document.vervaldatum"].includes("2026"));
  const wo = tplMod.buildContext("workorder", { number: "WO-1", clockedHours: 8, userName: "Jan" }, tenant);
  assert.equal(wo.fields["uren.geklokt"], "8");
  assert.equal(wo.fields["uitvoerder.naam"], "Jan");
});

test("templates: normalizeTemplate filtert kolommen + valideert kleur", () => {
  const t = tplMod.normalizeTemplate({ type: "invoice", name: "  Mijn factuur  ", columns: ["description", "BADCOL", "lineTotal"], accentColor: "geen-hex" });
  assert.equal(t.name, "Mijn factuur");
  assert.deepEqual(t.columns, ["description", "lineTotal"]);
  assert.equal(t.accentColor, "#1e6be6");
});

test("templates: renderDocument factuur toont enkel gekozen kolommen + merge in voettekst", () => {
  const tenant = { name: "Bouw BV", vatNumber: "BE0123", contactEmail: "info@bouw.be" };
  const doc = { number: "2026-9", invoiceDate: "2026-06-01", dueDate: "2026-07-01", customerName: "Acme",
    lines: [{ description: "Werk", qty: 2, unitPrice: 50, vatRate: 21, lineTotal: 121 }], subtotal: 100, vatAmount: 21, total: 121 };
  const t = tplMod.normalizeTemplate({ type: "invoice", columns: ["description", "lineTotal"], footerText: "{{bedrijf.naam}}" });
  const html = tplMod.renderDocument(t, "invoice", doc, tenant);
  assert.match(html, /FACTUUR/);
  assert.match(html, /Omschrijving/);
  assert.match(html, /Totaal<\/th>/);
  assert.ok(!/Eenheidsprijs/.test(html), "uitgeschakelde kolom niet getoond");
  assert.match(html, /Bouw BV/);            // merge in voettekst
  assert.match(html, /TOTAAL/);
});

test("templates: renderDocument werkbon = rapport (checklist + handtekening), geen totalen-tabel", () => {
  const doc = { number: "WO-3", title: "Onderhoud", completedAt: "2026-06-01", userName: "Jan",
    checklist: [{ label: "Filter", done: true }], files: [{ name: "f.jpg" }], signed: true, description: "ok" };
  const html = tplMod.renderDocument(tplMod.defaultTemplate("workorder"), "workorder", doc, { name: "Bouw BV" });
  assert.match(html, /WERKBON/);
  assert.match(html, /Checklist/);
  assert.match(html, /Handtekening klant/);
  assert.ok(!/TOTAAL/.test(html), "rapport heeft geen totalen-tabel");
});

// ── Prikklok: pauzes (breaks) en netto duur ────────────────────────────────────
const { breakMinutes, normalizeClockOut } = require("../src/modules/clocking-rules");

test("breaks: breakMinutes telt afgesloten en lopende pauzes", () => {
  assert.equal(breakMinutes([]), 0);
  assert.equal(breakMinutes([{ start: "10:00", end: "10:15" }]), 15);
  assert.equal(breakMinutes([{ start: "10:00", end: "10:15" }, { start: "12:00", end: "12:30" }]), 45);
  // Lopende pauze telt tot het meegegeven moment (bv. uitklokken om 13:00).
  assert.equal(breakMinutes([{ start: "12:30", end: null }], 13 * 60), 30);
  // Zonder eindmoment telt een lopende pauze niet mee (geen gok).
  assert.equal(breakMinutes([{ start: "12:30", end: null }]), 0);
  // Onzin-invoer wordt genegeerd i.p.v. te crashen.
  assert.equal(breakMinutes([{ start: "geen-tijd", end: "12:00" }]), 0);
});

test("breaks: normalizeClockOut trekt pauzes af en sluit open pauze op uitklokmoment", () => {
  const fakeStore = { list: () => [], get: () => null };
  const active = { userId: "u1", date: "2026-07-10", clockIn: "08:00", breaks: [
    { start: "10:00", end: "10:30" },
    { start: "12:00", end: null }        // lopende pauze bij het uitklokken
  ] };
  const out = normalizeClockOut(fakeStore, "t1", active, { clockOut: "16:00" }, "16:00");
  assert.equal(out.clockOut, "16:00");
  assert.equal(out.breaks[1].end, "16:00", "open pauze afgesloten op uitklokmoment");
  assert.equal(out.breakMinutes, 30 + 240, "30 min + lopende pauze 12:00-16:00");
  assert.equal(out.durationMinutes, 480 - 270, "netto = bruto (8u) - pauze (4u30)");
});

test("breaks: prikking zonder pauzes houdt volledige duur", () => {
  const fakeStore = { list: () => [], get: () => null };
  const active = { userId: "u1", date: "2026-07-10", clockIn: "09:00" };
  const out = normalizeClockOut(fakeStore, "t1", active, { clockOut: "17:00" }, "17:00");
  assert.equal(out.durationMinutes, 480);
  assert.equal(out.breakMinutes, 0);
});

test("breaks: betaalde pauzes (paidBreaks) houden de bruto duur aan", () => {
  const fakeStore = { list: () => [], get: () => null };
  const active = { userId: "u1", date: "2026-07-10", clockIn: "08:00", breaks: [{ start: "12:00", end: "12:30" }] };
  const paid = normalizeClockOut(fakeStore, "t1", active, { clockOut: "16:00" }, "16:00", { paidBreaks: true });
  assert.equal(paid.durationMinutes, 480, "betaald: pauze telt mee als werktijd");
  assert.equal(paid.breakMinutes, 30, "pauze blijft wel geregistreerd");
  const unpaid = normalizeClockOut(fakeStore, "t1", active, { clockOut: "16:00" }, "16:00", { paidBreaks: false });
  assert.equal(unpaid.durationMinutes, 450, "onbetaald: pauze gaat van de duur af");
});

// ── Betaalherinneringen: beleid per bedrijf (interval + maximum) ───────────────
const { reminderDue: remDue, reminderPolicy } = require("../src/modules/payment-reminders");

test("reminders: reminderPolicy begrenst op veilige waarden", () => {
  assert.deepEqual(reminderPolicy(), { intervalDays: 7, maxReminders: 3 });
  assert.deepEqual(reminderPolicy({ intervalDays: 14, maxReminders: 5 }), { intervalDays: 14, maxReminders: 5 });
  assert.deepEqual(reminderPolicy({ intervalDays: 0, maxReminders: 99 }), { intervalDays: 1, maxReminders: 10 });
  assert.deepEqual(reminderPolicy({ intervalDays: "onzin", maxReminders: null }), { intervalDays: 7, maxReminders: 3 });
});

test("reminders: bedrijfsbeleid bepaalt frequentie en maximum", () => {
  const today = "2026-07-10";
  const base = { status: "open", dueDate: "2026-06-01", total: 100 };
  const sentDaysAgo = d => [{ at: new Date(Date.now() - d * 86400000).toISOString(), level: 1 }];
  // Laatste herinnering 10 dagen geleden: due bij interval 7, nog niet bij interval 14.
  assert.equal(remDue({ ...base, reminders: sentDaysAgo(10) }, today, reminderPolicy({ intervalDays: 7 })), true);
  assert.equal(remDue({ ...base, reminders: sentDaysAgo(10) }, today, reminderPolicy({ intervalDays: 14 })), false);
  // Maximum van het bedrijf telt: 1 verzonden bij max 1 → klaar; bij max 3 → nog due.
  assert.equal(remDue({ ...base, reminders: sentDaysAgo(10) }, today, reminderPolicy({ intervalDays: 7, maxReminders: 1 })), false);
  assert.equal(remDue({ ...base, reminders: sentDaysAgo(10) }, today, reminderPolicy({ intervalDays: 7, maxReminders: 3 })), true);
});

// ── Security: privilege-escalatie via generieke module-CRUD geblokkeerd ─────────
const crudMod = require("../src/modules/crud");

test("security: generieke users-CRUD kan geen rol/rechten escaleren", () => {
  const rows = { users: [{ id: "u1", tenantId: "t1", name: "A", email: "a@x.be", role: "tenant_admin", permissions: ["employees"] }] };
  const store = {
    get: (c, id) => rows[c].find(r => r.id === id),
    list: (c, t) => rows[c].filter(r => !t || r.tenantId === t),
    update: (c, id, patch) => { const r = rows[c].find(x => x.id === id); Object.assign(r, patch); return r; },
    insert: (c, row) => { (rows[c] = rows[c] || []).push(row); return row; },
    audit: () => {}
  };
  const admin = { id: "u1", role: "tenant_admin", tenantId: "t1", permissions: ["employees"], mfaEnabled: true, mfaEnforced: true, mfaSecret: "x" };
  // Poging tot escalatie via generieke update
  const updated = crudMod.updateModuleRow(store, admin, "users", "u1", { role: "super_admin", permissions: ["*"], protected: true });
  assert.equal(updated.role, "tenant_admin", "rol mag niet escaleren via generieke CRUD");
  assert.deepEqual(updated.permissions, ["employees"], "rechten mogen niet escaleren via generieke CRUD");
  assert.ok(!updated.protected, "platform-god-vlag mag niet gezet worden");
  // Aanmaak via generieke CRUD levert een minst-geprivilegieerde employee
  const created = crudMod.createModuleRow(store, admin, "users", "t1", { name: "B", email: "b@x.be", role: "super_admin", permissions: ["*"] });
  assert.equal(created.role, "employee", "nieuwe user via generieke CRUD is employee");
  assert.deepEqual(created.permissions, [], "nieuwe user via generieke CRUD heeft geen rechten");
});

// ── Security: lockout beschermt zonder DoS + constante-tijd bij onbekend account ─
const authMod = require("../src/lib/auth");
const { hashPassword: hp } = require("../src/lib/security");

function fakeAuthStore(users) {
  return {
    getUserByEmail: e => users.find(u => u.email === e) || null,
    getUserById: id => users.find(u => u.id === id) || null,
    update: (c, id, patch) => { const u = users.find(x => x.id === id); Object.assign(u, patch); return u; },
    audit: () => {}
  };
}

test("security: correct wachtwoord tijdens lock logt in (geen lockout-DoS)", () => {
  const user = { id: "u1", email: "a@x.be", passwordHash: hp("Correct123!"), active: true,
    failedLoginCount: 5, lockedUntil: new Date(Date.now() + 10 * 60000).toISOString() };
  const store = fakeAuthStore([user]);
  assert.ok(authMod.isLocked(user), "account is gelockt");
  const res = authMod.login(store, "a@x.be", "Correct123!");
  assert.ok(res && res.token, "legitieme gebruiker met juist wachtwoord raakt niet buitengesloten");
});

test("security: fout wachtwoord tijdens lock blijft geweigerd (423)", () => {
  const user = { id: "u1", email: "a@x.be", passwordHash: hp("Correct123!"), active: true,
    failedLoginCount: 5, lockedUntil: new Date(Date.now() + 10 * 60000).toISOString() };
  const store = fakeAuthStore([user]);
  assert.throws(() => authMod.login(store, "a@x.be", "fout"), e => e.status === 423, "gelockt + fout wachtwoord → 423");
});

test("security: onbekend e-mailadres geeft null (geen enumeratie-shortcut)", () => {
  const store = fakeAuthStore([]);
  assert.equal(authMod.login(store, "bestaat-niet@x.be", "wat dan ook"), null);
});

// ── Tijdregistratie: expliciete actiedatum is leidend ─────────────────────────
test("clocking: historische clock-in blijft actief tot de bijhorende clock-out", () => {
  const tenant = { id: "t_clock", name: "Clock test", clockingPrefs: { paidBreaks: false } };
  const actor = { id: "u_clock", name: "Test gebruiker", email: "clock@test.be" };
  const store = reviewStore([tenant]);

  const active = clockIn(store, tenant, {
    userId: actor.id,
    date: "2026-05-13",
    clockIn: "08:05"
  }, actor);

  assert.throws(() => clockIn(store, tenant, {
    userId: actor.id,
    date: "2026-05-13",
    clockIn: "09:00"
  }, actor), error => error.status === 409);
  assert.equal(store.get("clocks", active.id).clockOut, null, "dubbele clock-in mag de actieve rij niet auto-afsluiten");

  const completed = clockOut(store, tenant, {
    userId: actor.id,
    date: "2026-05-13",
    clockOut: "16:10"
  }, actor);
  assert.equal(completed.clockOut, "16:10");
  assert.equal(completed.durationMinutes, 485);
  assert.equal(completed.status, "ready_for_approval");
});
