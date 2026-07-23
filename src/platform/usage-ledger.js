"use strict";

// ── Usage-event ledger · pure boekhoud- en prijslogica (INT-03) ──────────────
// Een IMMUTABLE, append-only grootboek van verbruiks-events: Peppol-documenten
// en Mona AI-verbruik in DEZELFDE ledger (spec 6.3/6.4/7 + datamodel 17.2).
// Geen store, geen I/O · zuiver testbaar, naar het model van commission-ledger.js.
//
// Grondregels (niet-onderhandelbaar):
//  - 1 document = exact 1 billable event. Retries en dubbele webhooks maken GEEN
//    nieuw event (dedup op idempotency_key). Validatiefouten vóór provider-
//    acceptatie en sandbox/test-documenten zijn NOOIT billable (6.4).
//  - De customer_unit_price wordt op het event VASTGEKLIKT bij boeking en is
//    daarna immutable. Prijswijzigingen werken alleen PROSPECTIEF: een bestaand
//    event behoudt zijn prijs; een nieuw event krijgt de nieuwe tariefregel.
//  - Een correctie is een TEGENGESTELD event (correction_of), nooit een
//    overschrijving van historie.
//  - provider_unit_cost en marge zijn UITSLUITEND Super Admin-data · een
//    tenant-view strippt ze (net zoals publicIntegration secrets strippt).
//  - billing_period: Open -> Calculated -> Review -> Approved -> Invoiced ->
//    Closed. Closed is immutable; latere correcties gaan naar een volgende
//    periode.

// Usage-types (6.3 + B01): de drie Peppol-documenttypes plus generiek AI-verbruik.
const PEPPOL_USAGE_TYPES = ["peppol.outbound_invoice", "peppol.outbound_credit_note", "peppol.inbound_invoice"];
const AI_USAGE_TYPES = ["ai.usage"];
const USAGE_TYPES = [...PEPPOL_USAGE_TYPES, ...AI_USAGE_TYPES];

// Prijsregel-niveaus (sectie 7). Klantprijs-resolutievolgorde is de array-volgorde:
// 1) actieve tenantoverride, 2) actief tenantpakket met inbegrepen volume,
// 3) platform default.
const CUSTOMER_PRICE_LEVELS = ["tenant_override", "tenant_package", "platform_default"];
// Providerkost-resolutievolgorde: 1) actieve provider cost rule, 2) handmatige
// cost adjustment. Provider-only.
const PROVIDER_COST_LEVELS = ["provider_cost", "manual_adjustment"];

// billing_period-statemachine (sectie 7). Voorwaartse keten; beperkte terugkeer
// voor herberekening is toegestaan zolang de periode nog niet is goedgekeurd.
// Closed = terminaal en immutable.
const PERIOD_STATES = ["Open", "Calculated", "Review", "Approved", "Invoiced", "Closed"];
const PERIOD_TRANSITIONS = {
  Open: ["Calculated"],
  Calculated: ["Review", "Open"],       // herberekenen of terug naar open
  Review: ["Approved", "Calculated"],   // terug voor herberekening kan
  Approved: ["Invoiced"],
  Invoiced: ["Closed"],
  Closed: [],                           // immutable
};

function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function clean(v) { return String(v == null ? "" : v).trim(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function toTime(v) { if (v == null || v === "") return NaN; const t = Date.parse(v); return Number.isNaN(t) ? NaN : t; }

function isPeppolUsage(usageType) { return PEPPOL_USAGE_TYPES.includes(usageType); }
function isAiUsage(usageType) { return AI_USAGE_TYPES.includes(usageType); }

// ── 1. Veldcontract + validatie (6.3) ───────────────────────────────────────
// Het canonieke usage_event draagt (camelCase, spec-veld tussen haakjes):
//   usageType (usage_type), tenantId (tenant_id), companyId (company_id),
//   documentId (document_id), providerReference (provider_reference),
//   billableAt (billable_at), quantity, providerUnitCost (provider_unit_cost),
//   customerUnitPrice (customer_unit_price), pricingRuleId (pricing_rule_id),
//   idempotencyKey (idempotency_key), billingPeriodId (billing_period_id),
//   correctionOf (correction_of).

/** Valideer de structuur van een event dat geboekt gaat worden (append-only). */
function validateUsageEvent(ev) {
  if (!ev || typeof ev !== "object") throw err(400, "USAGE_EVENT_INVALID", "usage event ontbreekt");
  if (!USAGE_TYPES.includes(ev.usageType)) throw err(400, "USAGE_TYPE_INVALID", `onbekend usage_type ${ev.usageType}`);
  if (!clean(ev.tenantId)) throw err(400, "USAGE_TENANT_REQUIRED", "tenantId is verplicht");
  // Peppol factureert en rapporteert per juridische onderneming · company verplicht.
  if (isPeppolUsage(ev.usageType) && !clean(ev.companyId)) throw err(400, "USAGE_COMPANY_REQUIRED", "companyId is verplicht voor Peppol-verbruik");
  if (!clean(ev.documentId)) throw err(400, "USAGE_DOCUMENT_REQUIRED", "documentId is verplicht");
  if (!clean(ev.idempotencyKey)) throw err(400, "USAGE_IDEMPOTENCY_REQUIRED", "idempotency_key is verplicht");
  const q = ev.quantity == null ? 1 : ev.quantity;
  if (typeof q !== "number" || !Number.isFinite(q) || q === 0) throw err(400, "USAGE_QUANTITY_INVALID", "quantity moet een getal ongelijk aan 0 zijn");
  // De unit-prijs/kost blijft niet-negatief · het teken komt uit quantity (correctie).
  if (ev.customerUnitPrice != null && (!Number.isFinite(ev.customerUnitPrice) || ev.customerUnitPrice < 0)) throw err(400, "USAGE_PRICE_INVALID", "customer_unit_price moet groter of gelijk aan 0 zijn");
  if (ev.providerUnitCost != null && (!Number.isFinite(ev.providerUnitCost) || ev.providerUnitCost < 0)) throw err(400, "USAGE_COST_INVALID", "provider_unit_cost moet groter of gelijk aan 0 zijn");
  if (!clean(ev.billableAt)) throw err(400, "USAGE_BILLABLE_AT_REQUIRED", "billable_at is verplicht (moment van provideracceptatie)");
  return true;
}

// ── 2. Billable-regels als pure predicaten (6.4) ─────────────────────────────
// ctx: { existingEvents, providerAccepted, validationFailed, environment, isTest }.
// Retour van billableReason: een reden-code wanneer NIET billable, anders null.

/** Waarom een (poging tot) event niet billable is · null = wel billable. */
function billableReason(ev, ctx = {}) {
  const env = clean(ctx.environment != null ? ctx.environment : ev.environment).toLowerCase();
  // Sandbox- en testdocumenten zijn NOOIT billable.
  if (env === "sandbox" || env === "test" || ev.test === true || ctx.isTest === true) return "sandbox_or_test";
  // Validatiefouten vóór provideracceptatie zijn niet billable.
  if (ctx.validationFailed === true) return "validation_failed";
  // Alleen een technisch aanvaard document (billable_at gezet) is billable.
  const accepted = ctx.providerAccepted != null ? ctx.providerAccepted : !!clean(ev.billableAt);
  if (!accepted) return "not_accepted";
  // Retries en dubbele webhooks maken GEEN nieuw event · dedup op idempotency_key.
  const existing = ctx.existingEvents || [];
  if (existing.some(e => e && clean(e.idempotencyKey) === clean(ev.idempotencyKey) && clean(ev.idempotencyKey) !== "")) return "duplicate";
  return null;
}

/** Zuiver predicaat: mag dit event als billable in de ledger geboekt worden? */
function isBillable(ev, ctx = {}) { return billableReason(ev, ctx) === null; }

/** Is een idempotency_key al aanwezig in de reeds geboekte events? */
function isDuplicate(existingEvents, idempotencyKey) {
  const key = clean(idempotencyKey);
  if (!key) return false;
  return (existingEvents || []).some(e => e && clean(e.idempotencyKey) === key);
}

// ── 3. Prijs-resolutie (sectie 7) ────────────────────────────────────────────

function ruleActiveAt(rule, at) {
  if (!rule || rule.active === false) return false;
  const t = toTime(at);
  if (!Number.isNaN(t)) {
    if (rule.validFrom && toTime(rule.validFrom) > t) return false;
    if (rule.validTo && toTime(rule.validTo) < t) return false;
  }
  return true;
}
function matchesUsageType(rule, usageType) {
  const t = rule.usageType || rule.documentType;
  return !t || t === usageType;
}
// Bij meerdere kandidaten op hetzelfde niveau: de regel met de laatste validFrom.
function pickLatest(rules) {
  return rules.slice().sort((a, b) => (toTime(b.validFrom) || 0) - (toTime(a.validFrom) || 0))[0];
}

/**
 * Effectieve klantprijs-regel voor een tenant op een moment (sectie 7):
 * 1) actieve tenantoverride, 2) actief tenantpakket met inbegrepen volume,
 * 3) platform default. Retourneert de winnende regel (met .price, .includedVolume,
 * .id, .level) of null wanneer er geen tarief bestaat.
 */
function effectiveCustomerPrice(rules, { tenantId, companyId, at, usageType } = {}) {
  const cands = (rules || []).filter(r => r && r.kind !== "cost" && matchesUsageType(r, usageType) && ruleActiveAt(r, at));
  for (const level of CUSTOMER_PRICE_LEVELS) {
    const atLevel = cands.filter(r => (r.level || "platform_default") === level);
    const scoped = level === "platform_default"
      ? atLevel
      : atLevel.filter(r => r.tenantId === tenantId && (!companyId || !r.companyId || r.companyId === companyId));
    if (scoped.length) return pickLatest(scoped);
  }
  return null;
}

/**
 * Effectieve providerkost-regel (Super Admin-only): 1) actieve provider cost rule,
 * 2) handmatige cost adjustment. Retourneert de regel (met .unitCost, .id) of null.
 */
function effectiveProviderCost(costRules, { provider, at, usageType } = {}) {
  const cands = (costRules || []).filter(r => r && matchesUsageType(r, usageType) && ruleActiveAt(r, at) && (!provider || !r.provider || r.provider === provider));
  for (const level of PROVIDER_COST_LEVELS) {
    const atLevel = cands.filter(r => (r.level || "provider_cost") === level);
    if (atLevel.length) return pickLatest(atLevel);
  }
  return null;
}

/**
 * Klik prijs en providerkost VAST op het event (immutable na boeking). Resolutie
 * gebeurt op billable_at, waardoor een latere prijswijziging het bestaande event
 * NIET raakt (prospectief). Retourneert een NIEUW eventobject.
 */
function priceUsageEvent(ev, { priceRules = [], costRules = [], provider = null } = {}) {
  validateUsageEvent(ev);
  const at = ev.billableAt;
  const priceRule = effectiveCustomerPrice(priceRules, { tenantId: ev.tenantId, companyId: ev.companyId, at, usageType: ev.usageType });
  const costRule = effectiveProviderCost(costRules, { provider: provider || ev.provider, at, usageType: ev.usageType });
  return {
    ...ev,
    quantity: ev.quantity == null ? 1 : ev.quantity,
    customerUnitPrice: priceRule ? round2(priceRule.price) : (ev.customerUnitPrice != null ? round2(ev.customerUnitPrice) : null),
    providerUnitCost: costRule ? round2(costRule.unitCost) : (ev.providerUnitCost != null ? round2(ev.providerUnitCost) : null),
    pricingRuleId: priceRule ? priceRule.id : (ev.pricingRuleId || null),
    costRuleId: costRule ? costRule.id : (ev.costRuleId || null),
  };
}

// ── 4. Correctie via tegengesteld event (6.4 / B18) ──────────────────────────

/**
 * Een tegengesteld adjustment-event dat een origineel event terugdraait. De
 * historie wordt NOOIT overschreven · dit is een nieuw ledger-record met
 * correction_of. De vastgeklikte prijs van het origineel blijft behouden en de
 * quantity wordt getekend omgedraaid, zodat de aggregatie netto verrekent. De
 * aanroeper wijst het toe aan een OPEN periode (Closed is immutable).
 */
function correctionEvent(original, { reason, at = null, idempotencyKey = null, createdBy = null } = {}) {
  if (!original || typeof original !== "object") throw err(404, "USAGE_EVENT_NOT_FOUND", "origineel event niet gevonden");
  if (original.correctionOf) throw err(409, "USAGE_CORRECTION_OF_CORRECTION", "een correctie kan niet zelf gecorrigeerd worden");
  if (!clean(reason)) throw err(400, "USAGE_REASON_REQUIRED", "een correctie vereist een reden");
  const q = original.quantity == null ? 1 : original.quantity;
  return {
    usageType: original.usageType,
    tenantId: original.tenantId,
    companyId: original.companyId || null,
    documentId: original.documentId,
    providerReference: original.providerReference || null,
    billableAt: at || original.billableAt,
    quantity: -q,                                     // tegengesteld
    customerUnitPrice: original.customerUnitPrice,    // vastgeklikte prijs blijft
    providerUnitCost: original.providerUnitCost,
    pricingRuleId: original.pricingRuleId || null,
    costRuleId: original.costRuleId || null,
    idempotencyKey: clean(idempotencyKey) || `${clean(original.idempotencyKey)}:correction`,
    billingPeriodId: null,                            // caller wijst OPEN periode toe
    correctionOf: original.id,
    reason: clean(reason),
    createdBy,
  };
}

// ── 5. Billing-periode-statemachine + aggregatie (sectie 7) ──────────────────

/** Dwing een geldige periode-statusovergang af. */
function assertPeriodTransition(from, to) {
  if (!PERIOD_STATES.includes(to)) throw err(400, "PERIOD_STATE_INVALID", `onbekende status ${to}`);
  if (!PERIOD_STATES.includes(from)) throw err(400, "PERIOD_STATE_INVALID", `onbekende status ${from}`);
  if (from === to) return;
  if (!(PERIOD_TRANSITIONS[from] || []).includes(to)) throw err(409, "PERIOD_TRANSITION_INVALID", `overgang ${from} naar ${to} niet toegestaan`);
}

/** Een gesloten periode is immutable. */
function isPeriodImmutable(state) { return state === "Closed"; }

/** Nieuwe usage events mogen alleen in een OPEN periode geboekt worden (sectie 7). */
function assertPeriodAcceptsEvents(period) {
  const status = period && period.status;
  if (status !== "Open") throw err(409, "USAGE_PERIOD_NOT_OPEN", `periode aanvaardt geen nieuwe events in status ${status || "onbekend"}`);
  return true;
}

/** Het factureerbare bedrag van een enkel event (getekend · correctie is negatief). */
function lineAmount(ev) { return round2(num(ev.quantity == null ? 1 : ev.quantity) * num(ev.customerUnitPrice)); }

function includedVolumeFor(rules, group, at) {
  const rule = effectiveCustomerPrice(rules, { tenantId: group.tenantId, companyId: group.companyId, at, usageType: group.usageType });
  return rule && rule.includedVolume ? Number(rule.includedVolume) : 0;
}

/**
 * Aggregeer geboekte events tot factureerbare lijnen per tenant/company/usageType
 * (usage_billing_lines). Correcties (negatieve quantity) verrekenen netto. Een
 * optioneel inbegrepen volume (uit de klantprijs-regel) maakt de eerste N
 * positieve eenheden gratis. De berekening is TEKEN-SYMMETRISCH: een correctie
 * spiegelt de gratis/betaalde-fractie van haar origineel (via correction_of), zodat
 * het terugdraaien van een GRATIS event netto 0 oplevert i.p.v. onterecht negatief.
 * provider_cost en margin worden meegerekend voor de Super Admin-view; strip ze met
 * tenantBillingLineView voor de tenant.
 */
function calculate(events, rules = [], opts = {}) {
  const groups = new Map();
  for (const ev of events || []) {
    if (!ev || ev.billable === false) continue;
    const tenantId = ev.tenantId;
    const companyId = ev.companyId || null;
    const usageType = ev.usageType;
    const key = `${tenantId}|${companyId || ""}|${usageType}`;
    if (!groups.has(key)) groups.set(key, { tenantId, companyId, usageType, evs: [] });
    groups.get(key).evs.push(ev);
  }
  const lines = [];
  for (const group of groups.values()) {
    const sorted = group.evs.slice().sort((a, b) => (toTime(a.billableAt) || 0) - (toTime(b.billableAt) || 0));
    const at = opts.at || (sorted[0] && sorted[0].billableAt) || null;
    let freeRemaining = includedVolumeFor(rules, group, at);
    let quantity = 0, amount = 0, providerCost = 0;
    // Pas 1 · positieve (originele) events: verbruik het inbegrepen volume in
    // billable_at-volgorde en reken enkel de eenheden BOVEN het gratis volume aan.
    // Onthoud per origineel hoeveel eenheden zijn aangerekend, zodat een latere
    // correctie exact die fractie kan terugdraaien. quantity/providerCost tellen
    // over ALLE events (correcties netto't hier al mee).
    const chargedUnitsById = new Map();
    for (const ev of sorted) {
      const q = num(ev.quantity == null ? 1 : ev.quantity);
      quantity += q;
      providerCost += q * num(ev.providerUnitCost);
      if (q > 0) {
        const free = freeRemaining > 0 ? Math.min(q, freeRemaining) : 0;
        freeRemaining -= free;
        const charged = q - free;
        amount += charged * num(ev.customerUnitPrice);
        if (ev.id != null) chargedUnitsById.set(ev.id, (chargedUnitsById.get(ev.id) || 0) + charged);
      }
    }
    // Pas 2 · correcties (negatieve quantity): spiegel de gratis/betaalde-fractie
    // van het origineel (via correction_of) zodat het terugdraaien van een GRATIS
    // event netto 0 geeft. Ontbreekt het origineel in deze berekening (correctie in
    // een andere/afgesloten periode dan het origineel), draai dan de volledige
    // eenheidsprijs terug · dat is correct voor een aangerekend origineel.
    for (const ev of sorted) {
      const q = num(ev.quantity == null ? 1 : ev.quantity);
      if (q >= 0) continue;
      const origId = ev.correctionOf;
      if (origId != null && chargedUnitsById.has(origId)) {
        const chargedBack = Math.min(-q, chargedUnitsById.get(origId));
        amount -= chargedBack * num(ev.customerUnitPrice);
        chargedUnitsById.set(origId, chargedUnitsById.get(origId) - chargedBack);
      } else {
        amount += q * num(ev.customerUnitPrice);
      }
    }
    amount = round2(amount);
    providerCost = round2(providerCost);
    lines.push({
      billingPeriodId: opts.billingPeriodId || (sorted[0] && sorted[0].billingPeriodId) || null,
      tenantId: group.tenantId,
      companyId: group.companyId,
      usageType: group.usageType,
      quantity: round2(quantity),
      amount,
      providerCost,
      margin: round2(amount - providerCost),
    });
  }
  return lines;
}

// ── 6. Views · providerkost en marge zijn Super Admin-only ───────────────────

/**
 * Tenant-veilige event-view: strip providerkost, kostregel en marge. Voor een
 * AI-usage-event strippen we bovendien de credit-/tariefcijfers (credits,
 * rateResolved) en de interne providerreferentie (het ai_provider_usage-id): een
 * tenant mag NOOIT provider-, credit- of marge-data zien (D10), ongeacht welk pad
 * dit event naar de serializer bracht. De bescherming zit dus in de serializer
 * zelf, niet enkel in een filter vooraf.
 */
function tenantUsageView(ev) {
  if (!ev) return ev;
  const { providerUnitCost, costRuleId, margin, ...rest } = ev;
  if (isAiUsage(ev.usageType)) {
    const { credits, rateResolved, providerReference, ...aiSafe } = rest;
    return { ...aiSafe, amount: lineAmount(ev) };
  }
  return { ...rest, amount: lineAmount(ev) };
}

/** Tenant-veilige billing-lijn: strip providerkost en marge. */
function tenantBillingLineView(line) {
  if (!line) return line;
  const { providerCost, margin, ...rest } = line;
  return rest;
}

/** Volledige Super Admin-view (inclusief providerkost en marge). */
function superAdminUsageView(ev) {
  if (!ev) return ev;
  return { ...ev, amount: lineAmount(ev), margin: round2(lineAmount(ev) - num(ev.quantity == null ? 1 : ev.quantity) * num(ev.providerUnitCost)) };
}

module.exports = {
  USAGE_TYPES, PEPPOL_USAGE_TYPES, AI_USAGE_TYPES,
  CUSTOMER_PRICE_LEVELS, PROVIDER_COST_LEVELS,
  PERIOD_STATES, PERIOD_TRANSITIONS,
  isPeppolUsage, isAiUsage,
  validateUsageEvent, billableReason, isBillable, isDuplicate,
  effectiveCustomerPrice, effectiveProviderCost, priceUsageEvent,
  correctionEvent,
  assertPeriodTransition, isPeriodImmutable, assertPeriodAcceptsEvents,
  lineAmount, calculate,
  tenantUsageView, tenantBillingLineView, superAdminUsageView,
  round2,
};
