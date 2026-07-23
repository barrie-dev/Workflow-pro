"use strict";
// INT-03 · usage-event ledger (pure laag). Immutable Peppol- en AI-verbruik met
// idempotency/dedup, vastgeklikte prijzen (prospectief), tegengestelde
// correcties, de billing_period-statemachine en aggregatie naar billing_lines.
const { test } = require("node:test");
const assert = require("node:assert");
const L = require("../src/platform/usage-ledger");

// Basis-event-fabriek voor Peppol · overschrijf per test.
function peppolEvent(over = {}) {
  return {
    id: "u1",
    usageType: "peppol.outbound_invoice",
    tenantId: "t1",
    companyId: "c1",
    documentId: "INV-001",
    providerReference: "AP-REF-1",
    billableAt: "2026-07-10T09:00:00.000Z",
    quantity: 1,
    customerUnitPrice: 0.5,
    providerUnitCost: 0.2,
    idempotencyKey: "billit:INV-001:send",
    billingPeriodId: "bp-2026-07",
    correctionOf: null,
    ...over,
  };
}

// ── 1. Types + veldcontract ──────────────────────────────────────────────────
test("USAGE_TYPES · drie Peppol-types en generiek AI-verbruik in dezelfde ledger", () => {
  assert.deepEqual(L.PEPPOL_USAGE_TYPES, ["peppol.outbound_invoice", "peppol.outbound_credit_note", "peppol.inbound_invoice"]);
  assert.ok(L.USAGE_TYPES.includes("ai.usage"));
  assert.equal(L.isPeppolUsage("peppol.inbound_invoice"), true);
  assert.equal(L.isAiUsage("ai.usage"), true);
});

test("validateUsageEvent · verplichte velden en tekens", () => {
  assert.throws(() => L.validateUsageEvent(peppolEvent({ usageType: "peppol.unknown" })), e => e.code === "USAGE_TYPE_INVALID");
  assert.throws(() => L.validateUsageEvent(peppolEvent({ tenantId: "" })), e => e.code === "USAGE_TENANT_REQUIRED");
  assert.throws(() => L.validateUsageEvent(peppolEvent({ companyId: "" })), e => e.code === "USAGE_COMPANY_REQUIRED");
  assert.throws(() => L.validateUsageEvent(peppolEvent({ documentId: "" })), e => e.code === "USAGE_DOCUMENT_REQUIRED");
  assert.throws(() => L.validateUsageEvent(peppolEvent({ idempotencyKey: "" })), e => e.code === "USAGE_IDEMPOTENCY_REQUIRED");
  assert.throws(() => L.validateUsageEvent(peppolEvent({ quantity: 0 })), e => e.code === "USAGE_QUANTITY_INVALID");
  assert.throws(() => L.validateUsageEvent(peppolEvent({ customerUnitPrice: -1 })), e => e.code === "USAGE_PRICE_INVALID");
  assert.throws(() => L.validateUsageEvent(peppolEvent({ billableAt: "" })), e => e.code === "USAGE_BILLABLE_AT_REQUIRED");
});

test("validateUsageEvent · geldig event én AI-event zonder company", () => {
  assert.equal(L.validateUsageEvent(peppolEvent()), true);
  // AI-verbruik vereist géén companyId.
  assert.equal(L.validateUsageEvent({ usageType: "ai.usage", tenantId: "t1", documentId: "req-9", idempotencyKey: "ai:req-9", billableAt: "2026-07-10T09:00:00Z", quantity: 1 }), true);
});

// ── 2. Billable-regels (6.4) ─────────────────────────────────────────────────
test("isBillable · een geaccepteerd productie-event is billable", () => {
  assert.equal(L.isBillable(peppolEvent(), { existingEvents: [] }), true);
  assert.equal(L.billableReason(peppolEvent(), { existingEvents: [] }), null);
});

test("isBillable · sandbox-document is NOOIT billable", () => {
  assert.equal(L.isBillable(peppolEvent({ environment: "sandbox" })), false);
  assert.equal(L.billableReason(peppolEvent({ environment: "sandbox" })), "sandbox_or_test");
});

test("isBillable · testdocument is NOOIT billable", () => {
  assert.equal(L.isBillable(peppolEvent({ test: true })), false);
  assert.equal(L.isBillable(peppolEvent(), { isTest: true }), false);
});

test("isBillable · validatiefout vóór provideracceptatie is niet billable", () => {
  assert.equal(L.billableReason(peppolEvent(), { validationFailed: true }), "validation_failed");
});

test("isBillable · zonder provideracceptatie (geen billable_at) niet billable", () => {
  assert.equal(L.billableReason(peppolEvent({ billableAt: "x" }), { providerAccepted: false }), "not_accepted");
});

test("dubbele webhook · dedup op idempotency_key levert 1 event", () => {
  const first = peppolEvent({ id: "u1" });
  // Tweede webhook voor hetzelfde document/operatie (zelfde idempotency_key).
  const second = peppolEvent({ id: "u2" });
  assert.equal(L.isBillable(second, { existingEvents: [first] }), false);
  assert.equal(L.billableReason(second, { existingEvents: [first] }), "duplicate");
  assert.equal(L.isDuplicate([first], second.idempotencyKey), true);
  // Simuleer boeking: enkel het eerste event blijft over.
  const ledger = [first];
  if (L.isBillable(second, { existingEvents: ledger })) ledger.push(second);
  assert.equal(ledger.length, 1);
});

test("Peppol retry · zelfde idempotency_key creëert geen extra klantkost", () => {
  const booked = peppolEvent({ id: "u1" });
  const retry = peppolEvent({ id: "u2", providerReference: "AP-REF-1-retry" });
  const ledger = [booked];
  if (L.isBillable(retry, { existingEvents: ledger })) ledger.push(retry);
  const lines = L.calculate(ledger, []);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].amount, 0.5, "de retry telt niet dubbel");
  assert.equal(lines[0].providerCost, 0.2);
});

// ── 3. Prijs-resolutie (sectie 7) ────────────────────────────────────────────
const priceRules = [
  { id: "pr-def", level: "platform_default", usageType: "peppol.outbound_invoice", price: 0.5, validFrom: "2026-01-01" },
  { id: "pr-ovr", level: "tenant_override", tenantId: "t1", usageType: "peppol.outbound_invoice", price: 0.3, validFrom: "2026-01-01" },
  { id: "pr-pkg", level: "tenant_package", tenantId: "t2", usageType: "peppol.outbound_invoice", price: 0.4, includedVolume: 2, validFrom: "2026-01-01" },
];

test("effectiveCustomerPrice · tenantoverride wint van platform default", () => {
  const r = L.effectiveCustomerPrice(priceRules, { tenantId: "t1", at: "2026-07-10", usageType: "peppol.outbound_invoice" });
  assert.equal(r.id, "pr-ovr");
  assert.equal(r.price, 0.3);
});

test("effectiveCustomerPrice · tenantpakket wint van platform default (included volume)", () => {
  const r = L.effectiveCustomerPrice(priceRules, { tenantId: "t2", at: "2026-07-10", usageType: "peppol.outbound_invoice" });
  assert.equal(r.id, "pr-pkg");
  assert.equal(r.includedVolume, 2);
});

test("effectiveCustomerPrice · platform default zonder override", () => {
  const r = L.effectiveCustomerPrice(priceRules, { tenantId: "t9", at: "2026-07-10", usageType: "peppol.outbound_invoice" });
  assert.equal(r.id, "pr-def");
});

test("effectiveCustomerPrice · verlopen override telt niet meer (validTo)", () => {
  const rules = [
    { id: "pr-def", level: "platform_default", usageType: "peppol.outbound_invoice", price: 0.5, validFrom: "2026-01-01" },
    { id: "pr-old", level: "tenant_override", tenantId: "t1", usageType: "peppol.outbound_invoice", price: 0.2, validFrom: "2026-01-01", validTo: "2026-06-30" },
  ];
  const r = L.effectiveCustomerPrice(rules, { tenantId: "t1", at: "2026-07-10", usageType: "peppol.outbound_invoice" });
  assert.equal(r.id, "pr-def", "de verlopen override valt weg, default blijft over");
});

test("effectiveProviderCost · provider cost rule wint van handmatige adjustment", () => {
  const costRules = [
    { id: "cr-1", level: "provider_cost", provider: "billit", usageType: "peppol.outbound_invoice", unitCost: 0.2, validFrom: "2026-01-01" },
    { id: "cr-2", level: "manual_adjustment", provider: "billit", usageType: "peppol.outbound_invoice", unitCost: 0.9, validFrom: "2026-01-01" },
  ];
  const r = L.effectiveProviderCost(costRules, { provider: "billit", at: "2026-07-10", usageType: "peppol.outbound_invoice" });
  assert.equal(r.id, "cr-1");
  assert.equal(r.unitCost, 0.2);
});

// ── 4. Vastklikken + prospectieve prijswijziging ─────────────────────────────
test("priceUsageEvent · klikt klantprijs en providerkost vast op het event", () => {
  const costRules = [{ id: "cr-1", level: "provider_cost", provider: "billit", usageType: "peppol.outbound_invoice", unitCost: 0.2, validFrom: "2026-01-01" }];
  const ev = L.priceUsageEvent(peppolEvent({ customerUnitPrice: null, providerUnitCost: null, provider: "billit" }), { priceRules, costRules });
  assert.equal(ev.customerUnitPrice, 0.3, "tenant t1 override");
  assert.equal(ev.providerUnitCost, 0.2);
  assert.equal(ev.pricingRuleId, "pr-ovr");
  assert.equal(ev.costRuleId, "cr-1");
});

test("Peppol price change · oud event behoudt oude prijs, nieuw event nieuwe prijs (prospectief)", () => {
  const rules = [
    { id: "pr-jun", level: "platform_default", usageType: "peppol.outbound_invoice", price: 0.5, validFrom: "2026-01-01", validTo: "2026-06-30" },
    { id: "pr-jul", level: "platform_default", usageType: "peppol.outbound_invoice", price: 0.7, validFrom: "2026-07-01" },
  ];
  const oud = L.priceUsageEvent(peppolEvent({ tenantId: "t9", customerUnitPrice: null, providerUnitCost: null, billableAt: "2026-06-15T10:00:00Z", documentId: "INV-JUN", idempotencyKey: "k-jun" }), { priceRules: rules });
  const nieuw = L.priceUsageEvent(peppolEvent({ tenantId: "t9", customerUnitPrice: null, providerUnitCost: null, billableAt: "2026-07-15T10:00:00Z", documentId: "INV-JUL", idempotencyKey: "k-jul" }), { priceRules: rules });
  assert.equal(oud.customerUnitPrice, 0.5);
  assert.equal(oud.pricingRuleId, "pr-jun");
  assert.equal(nieuw.customerUnitPrice, 0.7);
  assert.equal(nieuw.pricingRuleId, "pr-jul");
  // Vastgeklikt: het oude event blijft ongewijzigd, ook al bestaat de nieuwe regel.
  assert.equal(oud.customerUnitPrice, 0.5);
});

// ── 5. Correctie via tegenboeking ────────────────────────────────────────────
test("correctionEvent · tegengesteld, vastgeklikte prijs behouden, origineel ongewijzigd", () => {
  const original = peppolEvent({ id: "u1", quantity: 1, customerUnitPrice: 0.5, providerUnitCost: 0.2 });
  const snapshot = { ...original };
  const corr = L.correctionEvent(original, { reason: "document ingetrokken", at: "2026-08-01T09:00:00Z" });
  assert.equal(corr.quantity, -1);
  assert.equal(corr.customerUnitPrice, 0.5, "zelfde vastgeklikte prijs");
  assert.equal(corr.correctionOf, "u1");
  assert.equal(corr.reason, "document ingetrokken");
  assert.equal(corr.billingPeriodId, null, "caller wijst een OPEN periode toe");
  assert.equal(L.lineAmount(corr), -0.5, "netto tegengesteld");
  // Origineel is niet aangeraakt (append-only).
  assert.deepEqual(original, snapshot);
});

test("correctionEvent · reden verplicht en geen correctie-op-correctie", () => {
  const original = peppolEvent({ id: "u1" });
  assert.throws(() => L.correctionEvent(original, { reason: "" }), e => e.code === "USAGE_REASON_REQUIRED");
  const corr = L.correctionEvent(original, { reason: "fout" });
  assert.throws(() => L.correctionEvent({ ...corr, id: "u2" }, { reason: "nogmaals" }), e => e.code === "USAGE_CORRECTION_OF_CORRECTION");
});

// ── 6. Periode-statemachine ──────────────────────────────────────────────────
test("assertPeriodTransition · volledige geldige keten Open naar Closed", () => {
  assert.doesNotThrow(() => {
    L.assertPeriodTransition("Open", "Calculated");
    L.assertPeriodTransition("Calculated", "Review");
    L.assertPeriodTransition("Review", "Approved");
    L.assertPeriodTransition("Approved", "Invoiced");
    L.assertPeriodTransition("Invoiced", "Closed");
  });
});

test("assertPeriodTransition · ongeldige overgangen worden geweigerd", () => {
  assert.throws(() => L.assertPeriodTransition("Open", "Approved"), e => e.code === "PERIOD_TRANSITION_INVALID");
  assert.throws(() => L.assertPeriodTransition("Approved", "Open"), e => e.code === "PERIOD_TRANSITION_INVALID");
  assert.throws(() => L.assertPeriodTransition("Closed", "Open"), e => e.code === "PERIOD_TRANSITION_INVALID");
  assert.throws(() => L.assertPeriodTransition("Open", "Betaald"), e => e.code === "PERIOD_STATE_INVALID");
});

test("isPeriodImmutable + assertPeriodAcceptsEvents · Closed immutable, enkel Open aanvaardt events", () => {
  assert.equal(L.isPeriodImmutable("Closed"), true);
  assert.equal(L.isPeriodImmutable("Open"), false);
  assert.equal(L.assertPeriodAcceptsEvents({ status: "Open" }), true);
  assert.throws(() => L.assertPeriodAcceptsEvents({ status: "Closed" }), e => e.code === "USAGE_PERIOD_NOT_OPEN");
  assert.throws(() => L.assertPeriodAcceptsEvents({ status: "Approved" }), e => e.code === "USAGE_PERIOD_NOT_OPEN");
});

// ── 7. Aggregatie naar billing_lines ─────────────────────────────────────────
test("calculate · aggregeert per tenant/company/usageType", () => {
  const events = [
    peppolEvent({ id: "a", tenantId: "t1", companyId: "c1", documentId: "d1", idempotencyKey: "k1", customerUnitPrice: 0.5, providerUnitCost: 0.2 }),
    peppolEvent({ id: "b", tenantId: "t1", companyId: "c1", documentId: "d2", idempotencyKey: "k2", customerUnitPrice: 0.5, providerUnitCost: 0.2 }),
    peppolEvent({ id: "c", tenantId: "t1", companyId: "c2", documentId: "d3", idempotencyKey: "k3", customerUnitPrice: 0.5, providerUnitCost: 0.2 }),
    peppolEvent({ id: "d", tenantId: "t2", companyId: "c9", documentId: "d4", idempotencyKey: "k4", customerUnitPrice: 0.5, providerUnitCost: 0.2 }),
  ];
  const lines = L.calculate(events, []);
  assert.equal(lines.length, 3);
  const t1c1 = lines.find(l => l.tenantId === "t1" && l.companyId === "c1");
  assert.equal(t1c1.quantity, 2);
  assert.equal(t1c1.amount, 1.0);
  assert.equal(t1c1.providerCost, 0.4);
  assert.equal(t1c1.margin, 0.6);
});

test("calculate · correctie verrekent netto in de lijn (tegenboeking)", () => {
  const original = peppolEvent({ id: "a", documentId: "d1", idempotencyKey: "k1", customerUnitPrice: 0.5, providerUnitCost: 0.2 });
  const corr = { ...L.correctionEvent(original, { reason: "ingetrokken" }), id: "a-corr", billingPeriodId: "bp-2026-07" };
  const lines = L.calculate([original, corr], []);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, 0, "1 + (-1)");
  assert.equal(lines[0].amount, 0, "netto verrekend, historie behouden");
});

test("calculate · correctie van een GRATIS (included volume) event netto't naar 0", () => {
  // Eén origineel binnen het inbegrepen volume (0 euro aangerekend) + de tegenboeking.
  const original = peppolEvent({ id: "free-1", tenantId: "t2", companyId: "c9", documentId: "d1", idempotencyKey: "k1", customerUnitPrice: 0.4, providerUnitCost: 0.2 });
  const corr = { ...L.correctionEvent(original, { reason: "ingetrokken" }), id: "free-1-corr", billingPeriodId: "bp-2026-07" };
  // pr-pkg voor t2 heeft includedVolume 2 -> het origineel is gratis; terugdraaien = 0.
  const lines = L.calculate([original, corr], priceRules);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, 0, "1 + (-1)");
  assert.equal(lines[0].amount, 0, "een gratis event terugdraaien is netto 0, niet negatief");
});

test("calculate · included volume maakt de eerste N eenheden gratis", () => {
  const events = [
    peppolEvent({ id: "a", tenantId: "t2", companyId: "c9", documentId: "d1", idempotencyKey: "k1", customerUnitPrice: 0.4, providerUnitCost: 0.2, billableAt: "2026-07-01T09:00:00Z" }),
    peppolEvent({ id: "b", tenantId: "t2", companyId: "c9", documentId: "d2", idempotencyKey: "k2", customerUnitPrice: 0.4, providerUnitCost: 0.2, billableAt: "2026-07-02T09:00:00Z" }),
    peppolEvent({ id: "c", tenantId: "t2", companyId: "c9", documentId: "d3", idempotencyKey: "k3", customerUnitPrice: 0.4, providerUnitCost: 0.2, billableAt: "2026-07-03T09:00:00Z" }),
  ];
  // pr-pkg voor t2 heeft includedVolume 2 → van de 3 eenheden zijn er 2 gratis.
  const lines = L.calculate(events, priceRules);
  assert.equal(lines[0].quantity, 3);
  assert.equal(lines[0].amount, 0.4, "1 factureerbare eenheid van 0,40");
  assert.equal(lines[0].providerCost, 0.6, "providerkost telt over alle 3");
});

// ── 8. Views · providerkost/marge zijn Super Admin-only ──────────────────────
test("tenantUsageView · strip providerkost, kostregel en marge", () => {
  const ev = peppolEvent({ customerUnitPrice: 0.5, providerUnitCost: 0.2, costRuleId: "cr-1" });
  const view = L.tenantUsageView({ ...ev, margin: 0.3 });
  assert.equal(view.providerUnitCost, undefined);
  assert.equal(view.costRuleId, undefined);
  assert.equal(view.margin, undefined);
  assert.equal(view.customerUnitPrice, 0.5, "eigen aangerekende prijs blijft zichtbaar");
  assert.equal(view.amount, 0.5);
  // Billing-lijn-view strip eveneens providerkost en marge.
  const line = L.calculate([peppolEvent()], [])[0];
  const tline = L.tenantBillingLineView(line);
  assert.equal(tline.providerCost, undefined);
  assert.equal(tline.margin, undefined);
  assert.equal(tline.amount, 0.5);
});

test("tenantUsageView · een ai.usage-event lekt NOOIT credits/rateResolved/providerkost (D10)", () => {
  // Een compleet AI-usage-event zoals mona-ai-metering het boekt (credits + tarief
  // + interne providerreferentie). De tenant-serializer moet die zelf strippen,
  // ook wanneer een toekomstig pad het event hierheen zou halen.
  const aiEvent = {
    id: "uev1", usageType: "ai.usage", tenantId: "t1", companyId: null,
    documentId: "req-1", providerReference: "aipu_internal_1",
    billableAt: "2026-07-10T09:00:00.000Z", quantity: 1,
    customerUnitPrice: null, providerUnitCost: 0.02, costRuleId: null,
    idempotencyKey: "ai:req-1", feature: "boden", model: "gpt-4o-mini",
    credits: 3.5, rateResolved: { creditsPerUnit: 0.001 }, margin: 0.02,
    period: "2026-07",
  };
  const view = L.tenantUsageView(aiEvent);
  // Provider-, credit- en margecijfers zijn weg.
  assert.equal(view.credits, undefined, "credits gestript");
  assert.equal(view.rateResolved, undefined, "tarief-resolutie gestript");
  assert.equal(view.providerUnitCost, undefined, "providerkost gestript");
  assert.equal(view.providerReference, undefined, "interne provider-referentie gestript");
  assert.equal(view.margin, undefined, "marge gestript");
  // Functioneel-neutrale velden blijven (de tenant mag zijn eigen verbruik zien).
  assert.equal(view.usageType, "ai.usage");
  assert.equal(view.feature, "boden");
  assert.equal(view.amount, 0, "AI is credit-gedenomineerd · geen euro-per-event naar de tenant");
});
