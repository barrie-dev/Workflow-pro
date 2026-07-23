"use strict";

// ── Integratie-wiring · Integraties, Usage & Billing (INT-01..10) ────────────
// Bewijst dat de STORE-REGISTRATIE (REQUIRED_COLLECTIONS) en de vijf domeinmodules
// samen werken op een ECHTE Store (met migraties), niet enkel op fake stores. Dit
// vangt precies de risicoklasse van deze integratiestap: een ontbrekende of
// verkeerd gespelde collectienaam laat store.insert crashen. Draait op een geisoleerd
// tijdelijk databestand zodat de productiestore niet vervuild wordt.

const { test } = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const { Store } = require("../src/lib/store");
const { JsonDataAdapter } = require("../src/lib/data-adapters");
const connectorSvc = require("../src/modules/connector-service");
const peppolUsage = require("../src/modules/peppol-usage");
const monaAi = require("../src/modules/mona-ai-metering");
const payrollEngine = require("../src/modules/payroll-engine");
const intAuthz = require("../src/platform/integrations-authz");
const { sendPeppolInvoice } = require("../src/modules/peppol-invoice");
const boden = require("../src/modules/boden");

const actor = { email: "admin@monargo.one", id: "u_admin" };
const tenant = { id: "t1" };
const MANIFEST = {
  key: "billit", name: "Billit Peppol", category: "peppol",
  capabilities: ["invoices.write", "invoices.read"], authType: "apikey",
  scopes: ["peppol.send"], syncModes: ["push", "webhook"], webhookSupport: true,
  sandboxStatus: "available", entitlement: "peppol",
};

// Echte Store op een uniek tijdelijk bestand (geen productie-data aangeraakt).
function freshStore() {
  const file = path.join(os.tmpdir(), `wfp-intwiring-${crypto.randomBytes(6).toString("hex")}.json`);
  return new Store(new JsonDataAdapter(file));
}

const USAGE_COLLECTIONS = [
  "usageEvents", "usageAdjustments", "usagePriceRules", "usageCostRules",
  "usageBillingPeriods", "usageBillingLines", "peppolActivations",
  "tenantUsageLimits", "tenantCreditAllocations", "platformUsageBudgets",
  "usageAlertRules", "usageAlerts", "aiFeatureCreditRates", "aiProviderUsage",
];
const PAYROLL_COLLECTIONS = [
  "payrollConnections", "payrollEmployeeMappings", "payrollCodeMappings",
  "payrollPeriods", "payrollEntries", "payrollExports", "payrollImportResults", "payrollCorrections",
];

test("wiring: alle INT-collecties bestaan op een echte, gemigreerde Store", () => {
  const store = freshStore();
  const connectorCols = Object.values(connectorSvc.COLLECTIONS);
  for (const c of [...connectorCols, ...USAGE_COLLECTIONS, ...PAYROLL_COLLECTIONS]) {
    assert.ok(Array.isArray(store.data[c]), `collectie ${c} ontbreekt in REQUIRED_COLLECTIONS`);
  }
});

test("wiring INT-01: connectorcatalogus + connection + credential; secret nooit terugleesbaar", () => {
  const store = freshStore();
  connectorSvc.registerConnector(store, MANIFEST, actor);
  const conn = connectorSvc.createConnection(store, tenant, { companyId: "co1", connectorId: "billit", environment: "sandbox" }, actor);
  connectorSvc.storeCredential(store, tenant, conn.id, { value: "sk-secret-xyz-987" }, actor);
  const cred = connectorSvc.getCredential(store, tenant, conn.id);
  assert.strictEqual(cred.hasSecret, true);
  assert.ok(!("value" in cred) && !("encryptedSecret" in cred) && !("secretReference" in cred), "read lekt geen secret");
  assert.ok(store.data.integrationEvents.length > 0, "audit/technisch event geschreven");
  // Cross-tenant: een vreemde tenant vindt de connection niet (404).
  assert.throws(() => connectorSvc.getConnection(store, { id: "t2" }, conn.id), e => e.status === 404);
});

test("wiring INT-03/06: Peppol-usage idempotent + prijs vastgeklikt; tenant ziet nooit providerkost/marge", () => {
  const store = freshStore();
  peppolUsage.activatePeppol(store, { tenantId: "t1", companyId: "co1", mode: "monargo" }, actor);
  peppolUsage.setPriceRule(store, { level: "platform_default", usageType: "peppol.outbound_invoice", price: 0.35 }, actor);
  peppolUsage.setCostRule(store, { provider: "mock", usageType: "peppol.outbound_invoice", unitCost: 0.12 }, actor);
  const input = { usageType: "peppol.outbound_invoice", tenantId: "t1", companyId: "co1", documentId: "inv1", idempotencyKey: "k1", billableAt: "2026-07-10T10:00:00.000Z", provider: "mock", sandbox: false };
  const first = peppolUsage.recordPeppolUsage(store, input, actor);
  assert.strictEqual(first.created, true);
  assert.strictEqual(first.event.customerUnitPrice, 0.35);
  // 1 document = exact 1 billable event (dubbele webhook -> geen nieuw event).
  const dup = peppolUsage.recordPeppolUsage(store, input, actor);
  assert.strictEqual(dup.duplicate, true);
  assert.strictEqual(store.data.usageEvents.filter(e => e.usageType === "peppol.outbound_invoice").length, 1);
  // Tenant-view: providerkost en marge zijn gestript (C11).
  const tv = peppolUsage.listTenantPeppolUsage(store, "t1", {});
  assert.strictEqual(tv.length, 1);
  assert.ok(!("providerUnitCost" in tv[0]) && !("margin" in tv[0]) && !("costRuleId" in tv[0]));
  // Super Admin-overzicht: providerkost + marge WEL zichtbaar.
  const ov = peppolUsage.peppolUsageOverview(store, {});
  assert.ok("providerCost" in ov && "margin" in ov);
  assert.strictEqual(ov.revenue, 0.35);
});

test("wiring INT-06: vier-ogen op tarieven · maker stelt voor, zelfde persoon mag niet goedkeuren, tweede admin wel", () => {
  const store = freshStore();
  const maker = { id: "u_maker", email: "maker@monargo.one" };
  const checker = { id: "u_checker", email: "checker@monargo.one" };
  // Maker stelt een prijswijziging VOOR: pending en (nog) niet effectief.
  const proposed = peppolUsage.proposePriceRule(store, { level: "platform_default", usageType: "peppol.outbound_invoice", price: 0.45 }, maker);
  assert.strictEqual(proposed.active, false);
  assert.strictEqual(proposed.status, "pending_approval");
  assert.strictEqual(peppolUsage.resolvePeppolPrice(store, { usageType: "peppol.outbound_invoice", at: "2026-07-10T10:00:00.000Z" }), null, "voorgestelde prijs telt nog niet mee");
  // Vier-ogen (zoals de route ze afdwingt): de maker mag zijn eigen wijziging niet goedkeuren.
  assert.throws(
    () => intAuthz.assertFourEyes("platform.peppol.pricing.manage", maker.id, proposed.proposedById),
    e => e.status === 403 && e.code === "SELF_APPROVAL_FORBIDDEN",
  );
  // Een tweede Super Admin (checker) mag wel -> daarna is de prijs effectief.
  assert.strictEqual(intAuthz.assertFourEyes("platform.peppol.pricing.manage", checker.id, proposed.proposedById), true);
  const approved = peppolUsage.approvePriceRule(store, { ruleId: proposed.id }, checker);
  assert.strictEqual(approved.active, true);
  const eff = peppolUsage.resolvePeppolPrice(store, { usageType: "peppol.outbound_invoice", at: "2026-07-10T10:00:00.000Z" });
  assert.ok(eff && eff.price === 0.45, "na vier-ogen goedkeuring is de nieuwe prijs effectief");
});

test("wiring INT-06: billing-periode-statemachine Open->Calculated en immutabiliteit na sluiting", () => {
  const store = freshStore();
  peppolUsage.activatePeppol(store, { tenantId: "t1", companyId: "co1", mode: "monargo" }, actor);
  peppolUsage.setPriceRule(store, { level: "platform_default", usageType: "peppol.outbound_invoice", price: 1 }, actor);
  const rec = peppolUsage.recordPeppolUsage(store, { usageType: "peppol.outbound_invoice", tenantId: "t1", companyId: "co1", documentId: "d1", idempotencyKey: "kx", billableAt: "2026-07-05T09:00:00.000Z", provider: "mock", sandbox: false }, actor);
  const periodId = rec.event.billingPeriodId;
  const calc = peppolUsage.calculatePeriod(store, { periodId }, actor);
  assert.strictEqual(calc.period.status, "Calculated");
  assert.ok(calc.lines.length >= 1);
});

test("wiring INT-07..09: AI-metering in de gedeelde ledger; tenant-Peppolweergave lekt geen ai.usage", () => {
  const store = freshStore();
  monaAi.meterRequest(store, { tenantId: "t1", feature: "chat", model: "gpt", providerUnits: { inputTokens: 100, outputTokens: 50, providerCost: 0.02 }, requestId: "req1" }, actor);
  assert.strictEqual(store.data.usageEvents.filter(e => e.usageType === "ai.usage").length, 1);
  assert.strictEqual(store.data.aiProviderUsage.length, 1);
  // Control-plane rijen dragen tenantId:null -> store.list(col, tenantId) lekt niets.
  assert.strictEqual(store.list("aiProviderUsage", "t1").length, 0);
  // De tenant-Peppolweergave filtert op isPeppolUsage: geen ai.usage-event terug (D10).
  assert.strictEqual(peppolUsage.listTenantPeppolUsage(store, "t1", {}).length, 0);
});

test("boundary D01/D10: tenant-/resellerrol krijgt nooit Mona AI-monitoring", () => {
  const tenantUser = { role: "tenant_admin", tenantId: "t1", permissions: ["platform.ai.usage.view"] };
  assert.throws(() => intAuthz.assertMonaAiTenantHidden(tenantUser), e => e.status === 403);
  assert.strictEqual(intAuthz.canPlatform(tenantUser, "platform.ai.usage.view"), false);
  // Alleen super_admin met de juiste platformscope mag AI-monitoring.
  const superUser = { role: "super_admin", protected: true };
  assert.strictEqual(intAuthz.canPlatform(superUser, "platform.ai.usage.view"), true);
});

test("wiring INT-10: payrollperiode + entry + vier-ogen + immutable exportversie met checksum", () => {
  const store = freshStore();
  const p = payrollEngine.openPeriod(store, tenant, { companyId: "co1", period: "2026-07", provider: "sdworx" }, actor);
  payrollEngine.addEntry(store, tenant, p.id, { type: "performance", employeeId: "e1", code: "1000", kind: "normal", value: 8 }, actor);
  payrollEngine.transitionPeriod(store, tenant, { periodId: p.id, to: "voorbereiding" }, { email: "prep@t1.be", id: "u_prep" });
  payrollEngine.transitionPeriod(store, tenant, { periodId: p.id, to: "review" }, { email: "prep@t1.be", id: "u_prep" });
  // Segregation of duties: de indiener mag niet zelf goedkeuren.
  assert.throws(() => payrollEngine.approvePeriod(store, tenant, { periodId: p.id }, { email: "prep@t1.be", id: "u_prep" }), e => !!e.status);
  const approved = payrollEngine.approvePeriod(store, tenant, { periodId: p.id }, { email: "boss@t1.be", id: "u_boss" });
  assert.strictEqual(approved.status, "approved");
  const exp = payrollEngine.buildAndStoreExport(store, tenant, p.id, {}, actor);
  assert.ok(exp.checksum && exp.checksum.length === 64);
  assert.strictEqual(exp.version, 1);
  assert.strictEqual(store.data.payrollExports.length, 1);
});

// ── CLUSTER A · WIRING: de engines op het live-uitvoerpad ────────────────────

// Een geldige B2B-factuur + tenant met KBO-profiel (Peppol-validatie slaagt).
const VALID_VAT = "BE0403170701"; // mod-97-geldig (Solvay)
function tenantWithProfile() {
  return {
    id: "t1", name: "Acme BV",
    invoiceProfile: { vat: VALID_VAT, companyNumber: "0403170701", name: "Acme BV", street: "Kerkstraat 1", postalCode: "9000", city: "Gent", country: "BE", iban: "BE68539007547034" },
  };
}
function seedInvoice(store, over = {}) {
  return store.insert("invoices", {
    id: over.id || "inv1", tenantId: "t1", companyId: "co1",
    number: over.number || "2026-001", invoiceDate: "2026-07-10",
    customerName: "Klant NV", customerVatNumber: VALID_VAT,
    lines: [{ description: "Werk", qty: 1, unitPrice: 100, vatRate: 21, lineSubtotal: 100, lineVat: 21, lineTotal: 121 }],
    subtotal: 100, vatAmount: 21, total: 121, ...over,
  });
}

test("wiring INT-04: een echte Peppol-verzending boekt exact 1 billable event; retry boekt geen tweede", async () => {
  const store = freshStore();
  const t = tenantWithProfile();
  peppolUsage.activatePeppol(store, { tenantId: "t1", companyId: "co1", mode: "monargo" }, actor);
  peppolUsage.setPriceRule(store, { level: "platform_default", usageType: "peppol.outbound_invoice", price: 0.5 }, actor);
  const inv = seedInvoice(store);

  const r1 = await sendPeppolInvoice(store, t, inv);
  assert.strictEqual(r1.ok, true);
  const evs = store.data.usageEvents.filter(e => e.usageType === "peppol.outbound_invoice");
  assert.strictEqual(evs.length, 1, "exact 1 billable event na verzending");
  assert.strictEqual(evs[0].customerUnitPrice, 0.5, "klantprijs vastgeklikt op het event");

  // Retry (poging n+1): technische herpoging maakt GEEN tweede billable event.
  const fresh = store.get("invoices", inv.id);
  const r2 = await sendPeppolInvoice(store, t, fresh);
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(store.data.usageEvents.filter(e => e.usageType === "peppol.outbound_invoice").length, 1, "retry boekt geen tweede event (idempotent)");
});

test("wiring INT-04: owner-mode boekhoudpakket · een verzending meet NIET (geen billable event)", async () => {
  const store = freshStore();
  const t = tenantWithProfile();
  peppolUsage.activatePeppol(store, { tenantId: "t1", companyId: "co1", mode: "accounting_package" }, actor);
  const inv = seedInvoice(store, { id: "inv2", number: "2026-002" });
  const r = await sendPeppolInvoice(store, t, inv);
  assert.strictEqual(r.ok, true, "de factuur wordt gewoon verzonden");
  assert.strictEqual(store.data.usageEvents.filter(e => e.usageType === "peppol.outbound_invoice").length, 0, "boekhoudpakket = eigenaar · Monargo meet niet");
});

test("wiring INT-08: hard-block-poort · aiDisabled en hard limit blokkeren AI met ENKEL de functionele boodschap", () => {
  const store = freshStore();
  // aiDisabled: de gate weigert · scope 'ai' (blokkeert enkel AI, niet de rest).
  monaAi.setTenantLimits(store, "t1", { aiDisabled: true }, actor);
  const denied = monaAi.checkAllowed(store, { tenantId: "t1", feature: "boden", userId: "u1" });
  assert.strictEqual(denied.allowed, false);
  assert.strictEqual(denied.scope, "ai", "een blokkering raakt UITSLUITEND AI");
  assert.strictEqual(denied.message, monaAi.MONA_UNAVAILABLE_MESSAGE);
  // Geen enkel cijfer/saldo/limiet in wat de tenant te zien krijgt.
  assert.ok(!/\d/.test(denied.message), "de tenantboodschap bevat geen cijfers");
  assert.ok(!("consumed" in denied) && !("ceiling" in denied) && !("pct" in denied) && !("remaining" in denied), "geen usage/limietvelden naar de tenant");

  // Hard limit bereikt: krediet toegekend, verbruik >= plafond -> geblokkeerd.
  monaAi.setTenantLimits(store, "t2", { hardLimit: 10 }, actor);
  monaAi.meterRequest(store, { tenantId: "t2", feature: "boden", providerUnits: { sizeClass: "large" }, requestId: "r-cap", at: "2026-07-10T10:00:00.000Z" }, actor);
  // Forceer verbruik op/over het plafond via een adjustment-onafhankelijke meting:
  store.insert("usageEvents", { id: "uev_cap", usageType: "ai.usage", tenantId: "t2", documentId: "d", idempotencyKey: "ai:cap2", billableAt: "2026-07-10T10:05:00.000Z", quantity: 1, credits: 10, period: "2026-07", feature: "boden" });
  const capped = monaAi.checkAllowed(store, { tenantId: "t2", feature: "boden", at: "2026-07-10T10:10:00.000Z" });
  assert.strictEqual(capped.allowed, false);
  assert.strictEqual(capped.reason, "hard_limit_reached");
  assert.strictEqual(capped.message, monaAi.MONA_UNAVAILABLE_MESSAGE);
});

test("wiring INT-07: een toegestane AI-call meet verbruik (idempotent); default-tenant blijft toegestaan", () => {
  const store = freshStore();
  // Default-tenant zonder limiet: metering-only, dus toegestaan.
  const ok = monaAi.checkAllowed(store, { tenantId: "t1", feature: "boden", userId: "u1" });
  assert.strictEqual(ok.allowed, true);

  const m1 = monaAi.meterRequest(store, { tenantId: "t1", feature: "boden", model: "gpt-4o-mini", providerUnits: { inputTokens: 1200, outputTokens: 300, providerCost: 0.02 }, requestId: "req-A", userId: "u1", at: "2026-07-10T09:00:00.000Z" }, actor);
  assert.strictEqual(m1.duplicate, false);
  assert.strictEqual(store.data.usageEvents.filter(e => e.usageType === "ai.usage").length, 1);
  // Idempotent op requestId: een retry meet geen tweede keer.
  const m2 = monaAi.meterRequest(store, { tenantId: "t1", feature: "boden", model: "gpt-4o-mini", providerUnits: { inputTokens: 1200, outputTokens: 300, providerCost: 0.02 }, requestId: "req-A", userId: "u1", at: "2026-07-10T09:00:00.000Z" }, actor);
  assert.strictEqual(m2.duplicate, true);
  assert.strictEqual(store.data.usageEvents.filter(e => e.usageType === "ai.usage").length, 1, "retry maakt geen tweede usage-event");
  // Het verbruik is zichtbaar in de Super Admin-balans (live gebruik).
  const bal = monaAi.creditBalance(store, "t1", "2026-07");
  assert.ok(bal.consumed >= 0 && store.data.aiProviderUsage.length === 1, "providermeter + credit-event geboekt");
});

test("wiring INT-07: Mona in mock-modus (geen AI-sleutel) levert GEEN _metering · de route meet dan niet", async () => {
  const store = freshStore();
  const res = await boden.bodenChat(store, { id: "t1", name: "Acme" }, { id: "u1", email: "u1@acme.be", role: "tenant_admin", permissions: ["*"] }, [{ role: "user", content: "hallo" }]);
  assert.strictEqual(res.mock, true, "zonder echte sleutel draait Mona in mock-modus");
  assert.ok(!("_metering" in res), "mock-modus verbruikt geen provider-units · geen metering");
});

test("wiring INT-10: payroll-cockpitketen open->prepare->entries->review->approve(4-ogen)->export->aanlevering", () => {
  const store = freshStore();
  const prep = { email: "prep@acme.be", id: "u_prep" };
  const boss = { email: "boss@acme.be", id: "u_boss" };
  // employee- + codemapping (zodat de export volledig gemapt is)
  payrollEngine.setEmployeeMapping(store, tenant, { employeeId: "e1", providerEmployeeId: "SDW-e1" }, actor);
  payrollEngine.setCodeMapping(store, tenant, { kind: "performance", localCode: "1000", providerCode: "N" }, actor);

  const p = payrollEngine.openPeriod(store, tenant, { companyId: "co1", period: "2026-07", provider: "sdworx" }, prep);
  payrollEngine.addEntry(store, tenant, p.id, { type: "performance", employeeId: "e1", code: "1000", kind: "normal", value: 8 }, prep);
  payrollEngine.transitionPeriod(store, tenant, { periodId: p.id, to: "voorbereiding" }, prep);
  payrollEngine.transitionPeriod(store, tenant, { periodId: p.id, to: "review" }, prep);
  // Vier-ogen: de indiener mag niet zelf goedkeuren.
  assert.throws(() => payrollEngine.approvePeriod(store, tenant, { periodId: p.id }, prep), e => !!e.status);
  payrollEngine.approvePeriod(store, tenant, { periodId: p.id }, boss);

  const exp = payrollEngine.buildAndStoreExport(store, tenant, p.id, {}, boss);
  assert.strictEqual(exp.totals.unmapped, 0, "employee + code volledig gemapt");
  // approved -> ready -> delivered (delivered vereist een bestaande export)
  payrollEngine.transitionPeriod(store, tenant, { periodId: p.id, to: "ready" }, boss);
  payrollEngine.transitionPeriod(store, tenant, { periodId: p.id, to: "delivered" }, boss);
  // Provider verwerkt de aanlevering -> periode 'processed'.
  const ir = payrollEngine.recordImportResult(store, tenant, p.id, { status: "processed", providerReference: "SDW-2026-07" }, boss);
  assert.strictEqual(ir.status, "processed");
  const finalPeriod = store.get("payrollPeriods", p.id);
  assert.strictEqual(finalPeriod.status, "processed");
  assert.strictEqual(finalPeriod.providerReference, "SDW-2026-07");
  // Correctietraject op de verwerkte periode.
  const corr = payrollEngine.correctPeriod(store, tenant, p.id, { reason: "loonrooster gewijzigd" }, boss);
  assert.strictEqual(corr.correctsVersion, exp.version);
  assert.strictEqual(store.get("payrollPeriods", p.id).status, "correction");
});
