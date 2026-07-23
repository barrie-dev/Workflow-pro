"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const P = require("../src/modules/peppol-usage");

// ── Hand-rolled fake store (stijl 1 · geen migratie, geen I/O) ───────────────
function makeStore() {
  const data = {
    usageEvents: [], usagePriceRules: [], usageCostRules: [],
    usageBillingPeriods: [], usageBillingLines: [], peppolActivations: [],
    platformConfig: [], auditLogs: [],
  };
  return {
    data,
    audit(e) { data.auditLogs.push(e); },
    save() {},
    insert(c, row) { (data[c] = data[c] || []).push(row); return row; },
    list(c, tenantId) { const a = data[c] || []; return tenantId ? a.filter(r => r.tenantId === tenantId) : a; },
    get(c, id) { return (data[c] || []).find(r => r.id === id); },
    update(c, id, patch) { const a = data[c] || []; const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...patch }; return a[i]; } return null; },
    remove(c, id) { data[c] = (data[c] || []).filter(r => r.id !== id); },
  };
}

const ACTOR = { email: "admin@monargo.one" };
const ACTOR2 = { email: "second@monargo.one" };

function withMonargo(store, tenantId = "t1", companyId = "c1") {
  P.activatePeppol(store, { tenantId, companyId, mode: "monargo", vatNumber: "BE0403170701", participantId: "9925:BE0403170701" }, ACTOR);
  return { tenantId, companyId };
}

function rec(store, over = {}) {
  return P.recordPeppolUsage(store, {
    usageType: "peppol.outbound_invoice", tenantId: "t1", companyId: "c1",
    documentId: "INV-1", providerReference: "AP-1", billableAt: "2026-03-05T10:00:00.000Z",
    idempotencyKey: "billit:INV-1:send", provider: "billit", sandbox: false,
    ...over,
  }, ACTOR);
}

// ── 1. Owner-mode ────────────────────────────────────────────────────────────

test("owner mode monargo: metert en boekt exact 1 billable event", () => {
  const store = makeStore();
  withMonargo(store);
  const r = rec(store);
  assert.strictEqual(r.metered, true);
  assert.strictEqual(r.billable, true);
  assert.strictEqual(r.created, true);
  assert.strictEqual(store.data.usageEvents.length, 1);
});

test("owner mode boekhoudpakket: Monargo meet NIET", () => {
  const store = makeStore();
  P.activatePeppol(store, { tenantId: "t3", companyId: "c1", mode: "accounting_package" }, ACTOR);
  const r = P.recordPeppolUsage(store, {
    usageType: "peppol.outbound_invoice", tenantId: "t3", companyId: "c1",
    documentId: "INV-9", billableAt: "2026-03-05T10:00:00.000Z", idempotencyKey: "k9", provider: "billit",
  }, ACTOR);
  assert.strictEqual(r.metered, false);
  assert.strictEqual(r.reason, "owner_mode_accounting_package");
  assert.strictEqual(r.event, null);
  assert.strictEqual(store.data.usageEvents.length, 0);
});

test("geen activatie: niet actief, geen metering", () => {
  const store = makeStore();
  const r = P.recordPeppolUsage(store, {
    usageType: "peppol.outbound_invoice", tenantId: "t4", companyId: "c1",
    documentId: "INV-4", billableAt: "2026-03-05T10:00:00.000Z", idempotencyKey: "k4", provider: "billit",
  }, ACTOR);
  assert.strictEqual(r.metered, false);
  assert.strictEqual(r.reason, "peppol_not_active");
  assert.strictEqual(store.data.usageEvents.length, 0);
});

test("monargoOwnsPeppol: correcte boolean per onderneming", () => {
  const store = makeStore();
  withMonargo(store, "t1", "c1");
  P.activatePeppol(store, { tenantId: "t1", companyId: "c2", mode: "accounting_package" }, ACTOR);
  assert.strictEqual(P.monargoOwnsPeppol(store, "t1", "c1"), true);
  assert.strictEqual(P.monargoOwnsPeppol(store, "t1", "c2"), false);
  assert.strictEqual(P.monargoOwnsPeppol(store, "t1", "onbekend"), false);
});

test("activatePeppol: onbekende modus en ontbrekende onderneming falen", () => {
  const store = makeStore();
  assert.throws(() => P.activatePeppol(store, { tenantId: "t1", companyId: "c1", mode: "iets" }, ACTOR), e => e.code === "PEPPOL_MODE_INVALID");
  assert.throws(() => P.activatePeppol(store, { tenantId: "t1", mode: "monargo" }, ACTOR), e => e.code === "PEPPOL_COMPANY_REQUIRED");
});

// ── 2. Idempotentie (23: duplicate webhook + retry) ──────────────────────────

test("duplicate webhook: eenzelfde document maakt exact 1 billable event", () => {
  const store = makeStore();
  withMonargo(store);
  const first = rec(store);
  const second = rec(store); // zelfde idempotency_key = dubbele webhook
  assert.strictEqual(first.created, true);
  assert.strictEqual(second.duplicate, true);
  assert.strictEqual(second.created, false);
  assert.strictEqual(second.event.id, first.event.id);
  assert.strictEqual(store.data.usageEvents.length, 1);
});

test("retry: technische herpoging creeert geen extra klantkost", () => {
  const store = makeStore();
  withMonargo(store);
  P.setPriceRule(store, { level: "platform_default", price: 1.5 }, ACTOR);
  rec(store);
  rec(store); // retry
  rec(store); // nog een retry
  const charged = P.tenantChargedVolume(store, "t1");
  assert.strictEqual(charged.volume, 1);
  assert.strictEqual(charged.amount, 1.5);
});

// ── 3. Billable-regels (23) ──────────────────────────────────────────────────

test("sandbox/test document is nooit billable", () => {
  const store = makeStore();
  withMonargo(store);
  const r = rec(store, { environment: "sandbox" });
  assert.strictEqual(r.billable, false);
  assert.strictEqual(r.reason, "sandbox_or_test");
  assert.strictEqual(store.data.usageEvents.length, 0);
});

test("validatiefout voor provideracceptatie is niet billable", () => {
  const store = makeStore();
  withMonargo(store);
  const r = rec(store, { validationFailed: true });
  assert.strictEqual(r.billable, false);
  assert.strictEqual(r.reason, "validation_failed");
  assert.strictEqual(store.data.usageEvents.length, 0);
});

test("niet aanvaard (geen billable_at) is niet billable", () => {
  const store = makeStore();
  withMonargo(store);
  const r = rec(store, { billableAt: "" });
  assert.strictEqual(r.billable, false);
  assert.strictEqual(r.reason, "not_accepted");
  assert.strictEqual(store.data.usageEvents.length, 0);
});

test("recordPeppolUsage weigert een niet-Peppol usage_type", () => {
  const store = makeStore();
  withMonargo(store);
  assert.throws(() => rec(store, { usageType: "ai.usage" }), e => e.code === "USAGE_TYPE_INVALID");
});

// ── 4. Pricing (23: price change) ────────────────────────────────────────────

test("price change is prospectief: oud event houdt oude prijs, nieuw event nieuwe prijs", () => {
  const store = makeStore();
  withMonargo(store);
  P.setPriceRule(store, { level: "platform_default", price: 1.0, validFrom: "2026-01-01T00:00:00.000Z" }, ACTOR);
  const a = rec(store, { documentId: "INV-A", idempotencyKey: "k-A", billableAt: "2026-06-15T10:00:00.000Z" });
  P.setPriceRule(store, { level: "platform_default", price: 2.0, validFrom: "2026-07-01T00:00:00.000Z" }, ACTOR);
  const b = rec(store, { documentId: "INV-B", idempotencyKey: "k-B", billableAt: "2026-08-15T10:00:00.000Z" });
  assert.strictEqual(a.event.customerUnitPrice, 1.0);
  assert.strictEqual(b.event.customerUnitPrice, 2.0);
  // Het oude event in de store is niet herschreven.
  assert.strictEqual(store.get("usageEvents", a.event.id).customerUnitPrice, 1.0);
});

test("tenantoverride wint van platform default", () => {
  const store = makeStore();
  withMonargo(store, "t1", "c1");
  withMonargo(store, "t2", "c1");
  P.setPriceRule(store, { level: "platform_default", price: 1.0 }, ACTOR);
  P.setPriceRule(store, { level: "tenant_override", subjectTenantId: "t1", price: 0.5 }, ACTOR);
  const a = rec(store, { tenantId: "t1", documentId: "INV-T1", idempotencyKey: "k-t1" });
  const b = rec(store, { tenantId: "t2", documentId: "INV-T2", idempotencyKey: "k-t2" });
  assert.strictEqual(a.event.customerUnitPrice, 0.5);
  assert.strictEqual(b.event.customerUnitPrice, 1.0);
});

test("tenant_override zonder subjectTenantId faalt", () => {
  const store = makeStore();
  assert.throws(() => P.setPriceRule(store, { level: "tenant_override", price: 0.5 }, ACTOR), e => e.code === "PRICE_TENANT_REQUIRED");
});

// ── Vier-ogen op tarieven (sectie 7 · maker-checker) ─────────────────────────
test("vier-ogen op tarieven: een voorgestelde prijs is pas effectief NA goedkeuring", () => {
  const store = makeStore();
  const proposed = P.proposePriceRule(store, { level: "platform_default", usageType: "peppol.outbound_invoice", price: 0.4 }, ACTOR);
  // De maker is geregistreerd, de regel is nog niet actief.
  assert.strictEqual(proposed.active, false);
  assert.strictEqual(proposed.status, "pending_approval");
  assert.strictEqual(proposed.proposedById, "admin@monargo.one");
  // Zolang niet goedgekeurd telt de regel NIET mee in de prijs-resolutie.
  assert.strictEqual(P.resolvePeppolPrice(store, { usageType: "peppol.outbound_invoice", at: "2026-07-10T10:00:00.000Z" }), null);
  // Een tweede Super Admin (checker) keurt goed -> actief en effectief.
  const approved = P.approvePriceRule(store, { ruleId: proposed.id }, ACTOR2);
  assert.strictEqual(approved.active, true);
  assert.strictEqual(approved.status, "active");
  assert.strictEqual(approved.approvedById, "second@monargo.one");
  const eff = P.resolvePeppolPrice(store, { usageType: "peppol.outbound_invoice", at: "2026-07-10T10:00:00.000Z" });
  assert.ok(eff && eff.price === 0.4, "na goedkeuring is de nieuwe prijs effectief");
});

test("approvePriceRule is idempotent: nogmaals goedkeuren maakt geen duplicaat", () => {
  const store = makeStore();
  const p = P.proposePriceRule(store, { level: "platform_default", usageType: "peppol.outbound_invoice", price: 0.4 }, ACTOR);
  const a1 = P.approvePriceRule(store, { ruleId: p.id }, ACTOR2);
  const a2 = P.approvePriceRule(store, { ruleId: p.id }, ACTOR2);
  assert.strictEqual(a2.active, true);
  assert.strictEqual(a2.approvedById, a1.approvedById);
  assert.strictEqual(store.data.usagePriceRules.length, 1, "geen duplicaat door herhaalde goedkeuring");
  assert.throws(() => P.approvePriceRule(store, { ruleId: "nope" }, ACTOR2), e => e.code === "PRICE_RULE_NOT_FOUND");
});

test("included volume: de eerste N eenheden zijn gratis in de aggregatie", () => {
  const store = makeStore();
  withMonargo(store);
  P.setPriceRule(store, { level: "platform_default", price: 1.0, includedVolume: 2 }, ACTOR);
  rec(store, { documentId: "D1", idempotencyKey: "k1", billableAt: "2026-03-01T10:00:00.000Z" });
  rec(store, { documentId: "D2", idempotencyKey: "k2", billableAt: "2026-03-02T10:00:00.000Z" });
  rec(store, { documentId: "D3", idempotencyKey: "k3", billableAt: "2026-03-03T10:00:00.000Z" });
  const period = P.listPeriods(store, { tenantId: "t1" })[0];
  const { lines } = P.calculatePeriod(store, { periodId: period.id }, ACTOR);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].quantity, 3);
  assert.strictEqual(lines[0].amount, 1.0); // (3 - 2) * 1.0
});

// ── 5. Provider cost + Super Admin-only ──────────────────────────────────────

test("providerkost wordt vastgeklikt; marge enkel in Super Admin-view", () => {
  const store = makeStore();
  withMonargo(store);
  P.setPriceRule(store, { level: "platform_default", price: 1.0 }, ACTOR);
  P.setCostRule(store, { provider: "billit", unitCost: 0.3 }, ACTOR);
  const r = rec(store);
  assert.strictEqual(r.event.providerUnitCost, 0.3);
  const admin = P.listUsageEvents(store)[0];
  assert.strictEqual(admin.providerUnitCost, 0.3);
  assert.strictEqual(admin.margin, 0.7);
});

test("secret exposure equivalent: provider_unit_cost/marge NOOIT in tenant-response", () => {
  const store = makeStore();
  withMonargo(store);
  P.setPriceRule(store, { level: "platform_default", price: 1.0 }, ACTOR);
  P.setCostRule(store, { provider: "billit", unitCost: 0.3 }, ACTOR);
  rec(store);
  for (const v of P.listTenantPeppolUsage(store, "t1")) {
    assert.ok(!("providerUnitCost" in v), "providerUnitCost mag niet in tenant-view");
    assert.ok(!("costRuleId" in v), "costRuleId mag niet in tenant-view");
    assert.ok(!("margin" in v), "margin mag niet in tenant-view");
    assert.strictEqual(v.customerUnitPrice, 1.0); // eigen prijs is wel zichtbaar
    assert.strictEqual(v.amount, 1.0);
  }
  const charged = P.tenantChargedVolume(store, "t1");
  assert.ok(!("providerCost" in charged));
  assert.ok(!("margin" in charged));
  assert.deepStrictEqual(Object.keys(charged).sort(), ["amount", "count", "tenantId", "volume"]);
});

test("super admin overview aggregeert volume/omzet/providerkost/marge", () => {
  const store = makeStore();
  withMonargo(store);
  P.setPriceRule(store, { level: "platform_default", price: 1.0 }, ACTOR);
  P.setCostRule(store, { provider: "billit", unitCost: 0.3 }, ACTOR);
  rec(store, { documentId: "O1", idempotencyKey: "o1" });
  rec(store, { documentId: "O2", idempotencyKey: "o2", billableAt: "2026-03-06T10:00:00.000Z" });
  const ov = P.peppolUsageOverview(store);
  assert.strictEqual(ov.volume, 2);
  assert.strictEqual(ov.revenue, 2.0);
  assert.strictEqual(ov.providerCost, 0.6);
  assert.strictEqual(ov.margin, 1.4);
});

// ── 6. Cross-tenant isolatie (23) ────────────────────────────────────────────

test("cross-tenant isolation: een tenant ziet geen usage van een andere tenant", () => {
  const store = makeStore();
  withMonargo(store, "t1", "c1");
  withMonargo(store, "t2", "c1");
  rec(store, { tenantId: "t1", documentId: "T1-DOC", idempotencyKey: "t1k" });
  rec(store, { tenantId: "t2", documentId: "T2-DOC", idempotencyKey: "t2k" });
  const t1 = P.listTenantPeppolUsage(store, "t1");
  assert.strictEqual(t1.length, 1);
  assert.strictEqual(t1[0].documentId, "T1-DOC");
  assert.ok(!t1.some(e => e.documentId === "T2-DOC"));
});

// ── 7. Billing-periode state machine (spec 7) ────────────────────────────────

test("billing period: Open -> Calculated -> Review -> Approved -> Invoiced -> Closed", () => {
  const store = makeStore();
  withMonargo(store);
  P.setPriceRule(store, { level: "platform_default", price: 1.0 }, ACTOR);
  rec(store);
  const period = P.listPeriods(store, { tenantId: "t1" })[0];
  assert.strictEqual(period.status, "Open");
  assert.strictEqual(P.calculatePeriod(store, { periodId: period.id }, ACTOR).period.status, "Calculated");
  assert.strictEqual(P.transitionPeriod(store, { periodId: period.id, to: "Review" }, ACTOR).status, "Review");
  assert.strictEqual(P.approvePeriod(store, { periodId: period.id }, ACTOR).status, "Approved");
  assert.strictEqual(P.transitionPeriod(store, { periodId: period.id, to: "Invoiced" }, ACTOR).status, "Invoiced");
  assert.strictEqual(P.transitionPeriod(store, { periodId: period.id, to: "Closed" }, ACTOR).status, "Closed");
});

test("gesloten periode is immutable: verdere overgang en herberekening falen", () => {
  const store = makeStore();
  withMonargo(store);
  rec(store);
  const period = P.listPeriods(store, { tenantId: "t1" })[0];
  P.calculatePeriod(store, { periodId: period.id }, ACTOR);
  P.transitionPeriod(store, { periodId: period.id, to: "Review" }, ACTOR);
  P.transitionPeriod(store, { periodId: period.id, to: "Approved" }, ACTOR);
  P.transitionPeriod(store, { periodId: period.id, to: "Invoiced" }, ACTOR);
  P.transitionPeriod(store, { periodId: period.id, to: "Closed" }, ACTOR);
  assert.throws(() => P.transitionPeriod(store, { periodId: period.id, to: "Open" }, ACTOR), e => e.code === "PERIOD_TRANSITION_INVALID");
  assert.throws(() => P.calculatePeriod(store, { periodId: period.id }, ACTOR), e => e.code === "USAGE_PERIOD_IMMUTABLE");
});

test("een niet-open periode aanvaardt geen nieuwe events", () => {
  const store = makeStore();
  withMonargo(store);
  rec(store, { documentId: "P1", idempotencyKey: "p1" });
  const period = P.listPeriods(store, { tenantId: "t1" })[0];
  P.calculatePeriod(store, { periodId: period.id }, ACTOR); // periode is nu Calculated
  assert.throws(() => rec(store, { documentId: "P2", idempotencyKey: "p2" }), e => e.code === "USAGE_PERIOD_NOT_OPEN");
});

test("calculate produceert een billing-lijn per tenant/company/usageType", () => {
  const store = makeStore();
  withMonargo(store);
  P.setPriceRule(store, { level: "platform_default", price: 1.0 }, ACTOR);
  rec(store, { documentId: "L1", idempotencyKey: "l1" });
  rec(store, { usageType: "peppol.outbound_credit_note", documentId: "L2", idempotencyKey: "l2", billableAt: "2026-03-06T10:00:00.000Z" });
  const period = P.listPeriods(store, { tenantId: "t1" })[0];
  const { lines } = P.calculatePeriod(store, { periodId: period.id }, ACTOR);
  assert.strictEqual(lines.length, 2); // twee usageTypes
  const tenantLines = P.listTenantBillingLines(store, "t1");
  for (const l of tenantLines) { assert.ok(!("providerCost" in l)); assert.ok(!("margin" in l)); }
});

// ── 8. Correcties (spec 6.4) ─────────────────────────────────────────────────

test("correctie is een tegengesteld event; origineel blijft ongewijzigd, netto 0", () => {
  const store = makeStore();
  withMonargo(store);
  P.setPriceRule(store, { level: "platform_default", price: 1.0 }, ACTOR);
  const r = rec(store);
  const counter = P.correctPeppolUsage(store, { eventId: r.event.id, reason: "verkeerd verzonden" }, ACTOR);
  assert.strictEqual(counter.quantity, -1);
  assert.strictEqual(counter.correctionOf, r.event.id);
  assert.strictEqual(store.get("usageEvents", r.event.id).quantity, 1); // origineel intact
  const period = P.listPeriods(store, { tenantId: "t1" })[0];
  const { lines } = P.calculatePeriod(store, { periodId: period.id }, ACTOR);
  assert.strictEqual(lines[0].quantity, 0);
  assert.strictEqual(lines[0].amount, 0);
});

test("een correctie kan niet zelf gecorrigeerd worden", () => {
  const store = makeStore();
  withMonargo(store);
  const r = rec(store);
  const counter = P.correctPeppolUsage(store, { eventId: r.event.id, reason: "fout" }, ACTOR);
  assert.throws(() => P.correctPeppolUsage(store, { eventId: counter.id, reason: "nogmaals" }, ACTOR), e => e.code === "USAGE_CORRECTION_OF_CORRECTION");
});

test("correctie vereist een reden", () => {
  const store = makeStore();
  withMonargo(store);
  const r = rec(store);
  assert.throws(() => P.correctPeppolUsage(store, { eventId: r.event.id, reason: "" }, ACTOR), e => e.code === "USAGE_REASON_REQUIRED");
});

// Bevinding 1 · een dubbele/geretryde correctie is idempotent: exact 1 tegenboeking.
test("dubbele correctie is idempotent: exact 1 tegenboeking, netto 0", () => {
  const store = makeStore();
  withMonargo(store);
  P.setPriceRule(store, { level: "platform_default", price: 1.0 }, ACTOR);
  const r = rec(store);
  const c1 = P.correctPeppolUsage(store, { eventId: r.event.id, reason: "verkeerd verzonden" }, ACTOR);
  const c2 = P.correctPeppolUsage(store, { eventId: r.event.id, reason: "verkeerd verzonden (retry)" }, ACTOR);
  assert.strictEqual(c2.id, c1.id, "de retry geeft dezelfde tegenboeking terug i.p.v. een tweede te boeken");
  assert.strictEqual(store.data.usageEvents.length, 2, "1 origineel + 1 correctie · geen derde event");
  const period = P.listPeriods(store, { tenantId: "t1" })[0];
  const { lines } = P.calculatePeriod(store, { periodId: period.id }, ACTOR);
  assert.strictEqual(lines[0].quantity, 0, "netto quantity 0 (1 + -1), niet -1");
  assert.strictEqual(lines[0].amount, 0, "netto amount 0, niet negatief");
});

// Bevinding 7 · een correctie op een event in een reeds afgesloten/berekende
// periode landt in de huidige OPEN periode i.p.v. hard te falen.
test("correctie in een reeds Calculated periode landt in de huidige open periode", () => {
  const store = makeStore();
  withMonargo(store);
  P.setPriceRule(store, { level: "platform_default", price: 1.0 }, ACTOR);
  // Origineel in een oude maand; die periode wordt Calculated (immutable voor events).
  const r = rec(store, { documentId: "OLD-1", idempotencyKey: "old-1", billableAt: "2026-03-05T10:00:00.000Z" });
  const oldPeriod = P.listPeriods(store, { tenantId: "t1" }).find(p => p.period === "2026-03");
  P.calculatePeriod(store, { periodId: oldPeriod.id }, ACTOR); // 2026-03 is nu Calculated
  // De correctie faalt niet meer, maar vloeit naar een OPEN periode (niet 2026-03).
  const corr = P.correctPeppolUsage(store, { eventId: r.event.id, reason: "achteraf ingetrokken" }, ACTOR);
  assert.notStrictEqual(corr.billingPeriodId, oldPeriod.id, "de correctie landt niet in de afgesloten periode");
  const target = P.getPeriod(store, corr.billingPeriodId);
  assert.strictEqual(target.status, "Open", "de correctie landt in een open periode");
  assert.notStrictEqual(target.period, "2026-03", "een volgende periode, niet de originele maand");
});

// Bevinding 5 · het terugdraaien van een GRATIS (included volume) event netto't
// naar 0, niet naar een onterecht negatief bedrag.
test("correctie van een GRATIS event (included volume) netto't naar 0, niet negatief", () => {
  const store = makeStore();
  withMonargo(store);
  P.setPriceRule(store, { level: "platform_default", price: 5.0, includedVolume: 10 }, ACTOR);
  const r = rec(store); // valt binnen het inbegrepen volume -> 0 euro aangerekend
  P.correctPeppolUsage(store, { eventId: r.event.id, reason: "ingetrokken" }, ACTOR);
  const period = P.listPeriods(store, { tenantId: "t1" })[0];
  const { lines } = P.calculatePeriod(store, { periodId: period.id }, ACTOR);
  assert.strictEqual(lines[0].quantity, 0);
  assert.strictEqual(lines[0].amount, 0, "gratis event terugdraaien is 0, niet -5");
});

// ── 9. Tenant status-view ────────────────────────────────────────────────────

test("tenantPeppolStatus toont operationele status zonder kostinformatie", () => {
  const store = makeStore();
  P.activatePeppol(store, { tenantId: "t1", companyId: "c1", mode: "monargo", operationalRights: ["peppol.send", "onzin"] }, ACTOR);
  const st = P.tenantPeppolStatus(store, "t1");
  assert.strictEqual(st.length, 1);
  assert.strictEqual(st[0].mode, "monargo");
  assert.strictEqual(st[0].monargoIsSender, true);
  assert.deepStrictEqual(st[0].operationalRights, ["peppol.send"]); // onbekend recht gefilterd
  assert.ok(!("providerUnitCost" in st[0]));
});
