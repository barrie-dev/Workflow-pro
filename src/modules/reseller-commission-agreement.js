"use strict";

// ── Reseller-commissie: agreement, staten en payout-governance (23.11) ───────
// Bouwt VOORT op het bestaande immutable grootboek:
//  - src/platform/commission-ledger.js  = pure boekhoudlogica (CTO2-10);
//  - src/modules/commission-service.js  = append-only events + payouts.
// Deze laag voegt toe wat 23.11 extra eist:
//  - commission agreements met IMMUTABLE versies: een wijziging is een
//    NIEUWE versie, nooit een aanpassing van een bestaande;
//  - commissie wordt pas verdiend na het contractueel bepaalde verdienmoment
//    (default: ontvangen klantbetaling) en elk event legt de gebruikte
//    rule version vast (bron, tenant, periode, eligible base);
//  - commissiestaten zijn REPRODUCEERBAAR uit de events · handmatige
//    bedragen zonder berekeningsbasis zijn verboden;
//  - resellerfinance mag een dispuut openen maar wijzigt NOOIT zelf de
//    onderliggende berekening;
//  - payoutgegevens (IBAN) vragen wijzigingsaudit, MFA en vier-ogencontrole
//    en blijven buiten algemene resellerexports (23.15).
//
// Collecties (platform-niveau, tenantId null): resellerCommissionAgreements,
// resellerCommissionStatements, resellerCommissionDisputes,
// resellerPayoutChanges · events/payouts blijven in het bestaande grootboek.

const crypto = require("crypto");
const L = require("../platform/commission-ledger");
const D = require("../platform/reseller-domain");
const A = require("../platform/reseller-authz");
const svc = require("./commission-service");

function id(prefix) { return `${prefix}_${crypto.randomBytes(9).toString("hex")}`; }
function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
function nowIso() { return new Date().toISOString(); }
function clean(v) { return String(v == null ? "" : v).trim(); }

// Contractuele verdienmomenten (23.11): default pas bij ontvangen betaling.
const EARNING_TRIGGERS = ["payment_received", "invoice_issued"];

// Redenen die contractueel een clawback kunnen creeren (23.11).
const CLAWBACK_REASONS = ["credit_note", "refund", "fraud", "contract_cancellation", "non_payment"];

// Bedragvelden die een aanroeper NOOIT zelf mag aanleveren (23.11: geen
// handmatige bedragen zonder berekeningsbasis).
const STATEMENT_AMOUNT_FIELDS = ["opening", "eventsTotal", "adjustmentsTotal", "subtotal", "tax", "total", "amount"];

// Velden die bij een agreement-wijziging in een NIEUWE versie mogen landen.
const AGREEMENT_CHANGE_FIELDS = [
  "model", "percentage", "fixed_amount", "eligible_products", "earning_trigger",
  "caps", "clawback_rules", "start_date", "end_date", "renewal", "notice_period",
];

// 23.15 · payout- en contractgegevens blijven veldmatig buiten algemene
// resellerexports. Expliciete lijst + patroon (deny wint altijd).
const EXPORT_DENYLIST = [
  "payout_account", "payoutAccount", "payout_currency", "payoutCurrency",
  "payout_method", "iban", "bank_account", "bankAccount", "passwordHash",
  "commission_model", "contract_id", "agreement_version", "accepted_at",
  "dpa_accepted_at", "nda_accepted_at",
];
const EXPORT_DENY_RE = /payout|iban|bank/i;

const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;
function normalizeIban(v) { return clean(v).replace(/\s+/g, "").toUpperCase(); }

// ── Autorisatie-ankers ───────────────────────────────────────────────────────

/**
 * 23.11: "Resellerfinance mag een dispuut openen, maar niet zelf de
 * onderliggende berekening wijzigen." Berekeningswijzigingen (agreements,
 * events, staten, dispuutafhandeling) vereisen all-scope op
 * reseller.commissions.manage EN een gebruiker die NIET aan een
 * partnerorganisatie hangt · een expliciete grant op een partnergebruiker
 * verruimt dit nooit (hard, niet configureerbaar).
 */
function assertCalcAuthority(actor, code) {
  const c = code || "CALCULATION_CHANGE_FORBIDDEN";
  if (!actor || actor.resellerId) throw A.forbiddenError(c);
  if (A.grantFor(actor, "reseller.commissions.manage") !== "all") throw A.forbiddenError(c);
}

/** MFA-plicht (23.11/23.15 · DoD-8): payout-acties enkel met sterke authenticatie. */
function assertMfa(actor) {
  if (!actor || !(actor.mfaEnabled === true || actor.mfaVerified === true)) {
    throw err(403, "MFA_REQUIRED", "Sterke authenticatie (MFA) is vereist voor payoutgegevens");
  }
}

// ── Collectie-helpers (platform-scoped: filter op resellerId, nooit tenantId) ─
function agreementsFor(store, resellerId) {
  return (store.data.resellerCommissionAgreements || []).filter(a => a.resellerId === resellerId);
}
function statementsFor(store, resellerId) {
  return (store.data.resellerCommissionStatements || []).filter(s => s.resellerId === resellerId);
}
function eventsFor(store, resellerId) {
  return (store.data.commissionEvents || []).filter(e => e.resellerId === resellerId);
}
function findEvent(store, eventId) {
  const ev = (store.data.commissionEvents || []).find(e => e.id === eventId);
  if (!ev) throw err(404, "SOURCE_EVENT_NOT_FOUND", "bron-event niet gevonden");
  return ev;
}

// ── Commission agreement (23.11) · immutable versies ─────────────────────────

function validateAgreementInput(a) {
  const errors = D.validateAgreement(a); // agreement_id, version, status, start/end
  if (!D.COMMISSION_MODELS.includes(a.model)) {
    errors.model = `model moet een van ${D.COMMISSION_MODELS.join(", ")} zijn`;
  } else if (a.model === "fixed") {
    if (typeof a.fixed_amount !== "number" || !(a.fixed_amount > 0)) {
      errors.fixed_amount = "fixed_amount moet een getal > 0 zijn";
    }
  } else if (typeof a.percentage !== "number" || !(a.percentage > 0) || a.percentage > 100) {
    errors.percentage = "percentage moet > 0 en <= 100 zijn";
  }
  if (!EARNING_TRIGGERS.includes(a.earning_trigger)) {
    errors.earning_trigger = `earning_trigger moet een van ${EARNING_TRIGGERS.join(", ")} zijn`;
  }
  if (a.eligible_products != null && !Array.isArray(a.eligible_products)) {
    errors.eligible_products = "eligible_products moet een lijst zijn (leeg of afwezig = alle producten)";
  }
  if (!Array.isArray(a.clawback_rules) || a.clawback_rules.some(r => !CLAWBACK_REASONS.includes(r))) {
    errors.clawback_rules = `clawback_rules mag enkel ${CLAWBACK_REASONS.join(", ")} bevatten`;
  }
  if (a.caps != null) {
    if (typeof a.caps !== "object" || Array.isArray(a.caps)) errors.caps = "caps moet een object zijn";
    else for (const k of ["per_event", "per_period"]) {
      if (a.caps[k] != null && (typeof a.caps[k] !== "number" || a.caps[k] < 0)) {
        errors.caps = `caps.${k} moet een getal >= 0 zijn`;
      }
    }
  }
  if (Object.keys(errors).length) {
    const e = err(400, "AGREEMENT_INVALID", "commission agreement is ongeldig");
    e.fieldErrors = errors;
    throw e;
  }
}

/** Nieuwe agreement (versie 1, of volgende versie als agreement_id al bestaat). */
function createAgreement(store, input = {}, actor) {
  assertCalcAuthority(actor, "AGREEMENT_MANAGE_FORBIDDEN");
  if (!clean(input.resellerId)) throw err(400, "RESELLER_REQUIRED", "resellerId is verplicht");
  const agreementId = clean(input.agreement_id) || id("agr");
  const version = agreementsFor(store, input.resellerId)
    .filter(a => a.agreement_id === agreementId)
    .reduce((m, a) => Math.max(m, Number(a.version) || 0), 0) + 1;
  const row = {
    id: id("cag"), tenantId: null, resellerId: input.resellerId,
    agreement_id: agreementId, version, status: "draft",
    model: input.model,
    percentage: input.percentage != null ? Number(input.percentage) : null,
    fixed_amount: input.fixed_amount != null ? Number(input.fixed_amount) : null,
    eligible_products: input.eligible_products != null ? input.eligible_products : null,
    earning_trigger: input.earning_trigger || "payment_received",
    caps: input.caps || null,
    clawback_rules: input.clawback_rules || [...CLAWBACK_REASONS],
    start_date: input.start_date || null, end_date: input.end_date || null,
    renewal: input.renewal || null, notice_period: input.notice_period || null,
    amendment: null,
    approved_by: null, approved_at: null, activated_at: null, expired_at: null,
    createdAt: nowIso(), createdBy: (actor && actor.email) || "system",
  };
  validateAgreementInput(row);
  store.insert("resellerCommissionAgreements", row);
  store.audit({ actor: row.createdBy, tenantId: null, area: "commission", action: "commission_agreement_created",
    detail: `${row.resellerId} ${agreementId} v${version} ${row.model}` });
  return row;
}

/** Statusovergang draft → approved → active → expired · goedkeuring met vier-ogen. */
function transitionAgreement(store, { agreementId, to, reason = null }, actor) {
  assertCalcAuthority(actor, "AGREEMENT_MANAGE_FORBIDDEN");
  const row = (store.data.resellerCommissionAgreements || []).find(a => a.id === agreementId);
  if (!row) throw A.notFoundError("agreement");
  D.commissionAgreement.assertTransition(row.status, to);
  if (row.status === to) return row;
  const who = (actor && actor.email) || "system";
  const patch = { status: to };
  if (to === "approved") {
    A.assertNotSelfApproval(who, row.createdBy); // opsteller keurt nooit zelf goed
    patch.approved_by = who; patch.approved_at = nowIso();
  }
  if (to === "active") patch.activated_at = nowIso();
  if (to === "expired") patch.expired_at = nowIso();
  const next = store.update("resellerCommissionAgreements", agreementId, patch);
  store.audit({ actor: who, tenantId: null, area: "commission", action: `commission_agreement_${to}`,
    detail: `${row.resellerId} ${row.agreement_id} v${row.version}${reason ? " · " + clean(reason) : ""}` });
  return next;
}

/**
 * Wijziging = NIEUWE versie (immutable versions, 23.11). De bronversie blijft
 * byte-identiek staan; de nieuwe versie start als draft en draagt de volledige
 * before/after + reden + actor in het eigen record (23.15 · audit-detail is
 * elders getrunceerd, dit record niet).
 */
function amendAgreement(store, { agreementId, changes = {}, reason }, actor) {
  assertCalcAuthority(actor, "AGREEMENT_MANAGE_FORBIDDEN");
  const src = (store.data.resellerCommissionAgreements || []).find(a => a.id === agreementId);
  if (!src) throw A.notFoundError("agreement");
  if (!clean(reason)) throw err(400, "REASON_REQUIRED", "een commissiewijziging vereist een reden (23.15)");
  const keys = Object.keys(changes || {});
  const illegal = keys.filter(k => !AGREEMENT_CHANGE_FIELDS.includes(k));
  if (illegal.length) throw err(400, "AGREEMENT_FIELD_IMMUTABLE", `niet wijzigbaar via amendement: ${illegal.join(", ")}`);
  const version = agreementsFor(store, src.resellerId)
    .filter(a => a.agreement_id === src.agreement_id)
    .reduce((m, a) => Math.max(m, Number(a.version) || 0), 0) + 1;
  const before = {}; const after = {};
  for (const k of keys) { before[k] = src[k] == null ? null : src[k]; after[k] = changes[k]; }
  const who = (actor && actor.email) || "system";
  const row = {
    ...src, ...changes,
    id: id("cag"), version, status: "draft",
    approved_by: null, approved_at: null, activated_at: null, expired_at: null,
    amendment: { supersedes: src.id, reason: clean(reason), actor: who, at: nowIso(), before, after },
    createdAt: nowIso(), createdBy: who,
  };
  validateAgreementInput(row);
  store.insert("resellerCommissionAgreements", row);
  store.audit({ actor: who, tenantId: null, area: "commission", action: "commission_agreement_amended",
    detail: JSON.stringify({ agreement: src.agreement_id, van: src.version, naar: version, reason: clean(reason) }) });
  return row;
}

/** Het geldende contract op moment `at` · hoogste actieve versie wint (pure laag). */
function activeAgreementFor(store, resellerId, at = new Date()) {
  return D.activeAgreement(agreementsFor(store, resellerId), at);
}

// ── Commission events (23.11) · verdienmoment + rule version ─────────────────

/**
 * Boek een accrual vanuit een bron (betaling of factuur). Het event legt de
 * volledige berekeningsbasis vast: bronreferentie, tenant, periode, eligible
 * base en de GEBRUIKTE rule version · daarmee is elke staat reproduceerbaar.
 * De eligible base en de tenant komen SERVERZIJDIG uit het bestaande
 * betalings-/factuurrecord (CTO-09: centrale bron) · nooit uit de aanroeper.
 * Idempotent op de bron: dezelfde betaling/factuur boekt nooit twee keer, en
 * een door accruePeriod al geboekte klant/maand boekt evenmin dubbel.
 * Zonder actief contract wordt er niets verdiend (409 AGREEMENT_NOT_ACTIVE).
 */
function accrueFromSource(store, { resellerId, source = {}, at = null }, actor) {
  if (!clean(resellerId)) throw err(400, "RESELLER_REQUIRED", "resellerId is verplicht");
  const kind = clean(source.kind);
  if (!["payment", "invoice"].includes(kind)) throw err(400, "SOURCE_KIND_INVALID", "source.kind moet payment of invoice zijn");
  if (!clean(source.id)) throw err(400, "SOURCE_REF_REQUIRED", "source.id (factuur- of betalingsreferentie) is verplicht");
  if (!L.isPeriod(source.period)) throw err(400, "EVENT_PERIOD_INVALID", "source.period moet YYYY-MM zijn");
  const existing = eventsFor(store, resellerId).find(e =>
    e.sourceRef && e.sourceRef.kind === kind && String(e.sourceRef.id) === String(source.id));
  if (existing) return { created: false, excluded: existing.lifecycle === "excluded", event: existing };

  // CTO-09 doorgetrokken: de berekeningsbasis komt UITSLUITEND serverzijdig
  // uit het centrale betalings-/factuurrecord. Een vrij aangeleverde
  // eligibleBase zonder bestaand bronrecord is een handmatig bedrag zonder
  // berekeningsbasis en wordt geweigerd (zelfde geest als rejectManualAmounts).
  const record = store.get(kind === "payment" ? "payments" : "invoices", source.id);
  if (!record) {
    throw err(422, "SOURCE_RECORD_NOT_FOUND", "source.id verwijst niet naar een bestaand betalings- of factuurrecord · een vrij aangeleverd bedrag zonder berekeningsbasis is verboden (23.11)");
  }
  const eligibleBase = L.round2(Number(kind === "payment" ? record.amount : record.total) || 0);
  const clientTenantId = record.tenantId || source.tenantId || null;

  // Dedup over de twee accrual-systemen heen: heeft accruePeriod (MRR-pad,
  // sourceRef kind "subscription") deze klant/maand al geboekt, dan boekt het
  // bron-pad NIET nogmaals · net als accruePeriod zelf dedupliceert op
  // (resellerId, period, clientTenantId, type accrual). Zo is de uitkomst
  // volgorde-onafhankelijk en het grootboek reproduceerbaar.
  const periodBooked = eventsFor(store, resellerId).find(e =>
    e.type === "accrual" && e.period === source.period
    && e.clientTenantId === clientTenantId
    && e.sourceRef && e.sourceRef.kind === "subscription");
  if (periodBooked) return { created: false, excluded: false, event: periodBooked };

  const agreement = D.assertAgreementActive(agreementsFor(store, resellerId), at || new Date());
  // Verdienmoment (23.11): default pas bij ontvangen klantbetaling.
  const trigger = agreement.earning_trigger || "payment_received";
  if (trigger === "payment_received" && kind !== "payment") {
    throw err(409, "EARNING_TRIGGER_NOT_MET", `commissie wordt contractueel pas verdiend bij ${trigger} · bron ${kind} telt niet`);
  }
  const base = {
    type: "accrual", resellerId, period: source.period,
    clientTenantId,
    sourceRef: { kind, id: source.id },
    ruleVersion: { agreementId: agreement.agreement_id, version: agreement.version, rowId: agreement.id },
    eligibleBase,
    product: source.product || null,
    lifecycle: "generated",
  };
  // Product buiten eligible_products = expliciet excluded event (bedrag 0),
  // zodat de staat de uitsluiting toont in plaats van ze te verzwijgen.
  const eligible = Array.isArray(agreement.eligible_products) ? agreement.eligible_products : null;
  if (eligible && eligible.length && !eligible.includes(source.product)) {
    const evx = svc.appendEvent(store, {
      ...base, basisAmount: base.eligibleBase, ratePct: 0, amount: 0,
      lifecycle: "excluded", excludedReason: "product_not_eligible",
    }, actor);
    return { created: true, excluded: true, event: evx };
  }
  let amount; let ratePct = null;
  if (agreement.model === "fixed") {
    amount = L.round2(agreement.fixed_amount);
  } else {
    ratePct = Number(agreement.percentage) || 0;
    amount = L.commissionAmount(base.eligibleBase, ratePct);
  }
  // Contractuele caps: per event en per periode (23.11 kernvelden).
  let capApplied = false;
  const caps = agreement.caps || {};
  if (typeof caps.per_event === "number" && amount > caps.per_event) {
    amount = L.round2(caps.per_event); capApplied = true;
  }
  if (typeof caps.per_period === "number") {
    const already = eventsFor(store, resellerId)
      .filter(e => e.type === "accrual" && e.period === source.period)
      .reduce((s, e) => s + e.amount, 0);
    const room = L.round2(Math.max(0, caps.per_period - already));
    if (amount > room) { amount = room; capApplied = true; }
  }
  const ev = svc.appendEvent(store, { ...base, basisAmount: base.eligibleBase, ratePct, amount, capApplied }, actor);
  return { created: true, excluded: false, event: ev };
}

function remainingOf(store, ev) {
  const already = (store.data.commissionEvents || [])
    .filter(e => e.correctsEventId === ev.id)
    .reduce((s, e) => s + e.amount, 0);
  return L.round2(ev.amount + already);
}

/**
 * Event uitsluiten (generated → excluded): het resterende bedrag wordt
 * TEGENGEBOEKT (nooit overschreven) en het bron-event krijgt enkel een
 * lifecycle-markering · bedrag en type blijven onaangeroerd.
 */
function excludeEvent(store, { eventId, reason }, actor) {
  assertCalcAuthority(actor);
  const ev = findEvent(store, eventId);
  if (!clean(reason)) throw err(400, "EVENT_REASON_REQUIRED", "uitsluiten vereist een reden");
  D.commissionEvent.assertTransition(ev.lifecycle || "generated", "excluded");
  const remaining = remainingOf(store, ev);
  const counter = remaining > 0
    ? svc.correctEvent(store, { eventId, amount: remaining, reason: `exclusie: ${clean(reason)}` }, actor)
    : null;
  const who = (actor && actor.email) || "system";
  const next = store.update("commissionEvents", eventId, {
    lifecycle: "excluded", excludedReason: clean(reason), excludedBy: who, excludedAt: nowIso(),
  });
  store.audit({ actor: who, tenantId: null, area: "commission", action: "commission_event_excluded",
    detail: `${eventId} ${clean(reason)}` });
  return { event: next, counter };
}

/**
 * Adjustment (generated → adjusted): correctie via tegenboeking in het
 * bestaande grootboek · het originele event wordt nooit overschreven.
 */
function adjustEvent(store, { eventId, amount = null, reason }, actor) {
  assertCalcAuthority(actor);
  const ev = findEvent(store, eventId);
  D.commissionEvent.assertTransition(ev.lifecycle || "generated", "adjusted");
  const counter = svc.correctEvent(store, { eventId, amount, reason }, actor); // reden-plicht zit in de ledger
  const next = store.update("commissionEvents", eventId, { lifecycle: "adjusted" });
  return { event: next, counter };
}

/**
 * Clawback op contractuele grond (23.11): creditnota, terugbetaling, fraude,
 * contractannulering of wanbetaling. Na uitbetaling wordt het een echte
 * ledger-clawback; ervoor een tegenboeking · zelfde nettoresultaat, het
 * grootboek blijft kloppen. De clawbackregels van de gebruikte contractversie
 * bepalen wat toegestaan is.
 */
function clawbackForReason(store, { eventId, reasonCode, amount = null, note = "" }, actor) {
  assertCalcAuthority(actor);
  if (!CLAWBACK_REASONS.includes(reasonCode)) {
    throw err(400, "CLAWBACK_REASON_INVALID", `reasonCode moet een van ${CLAWBACK_REASONS.join(", ")} zijn`);
  }
  const ev = findEvent(store, eventId);
  const ruleRow = ev.ruleVersion
    ? (store.data.resellerCommissionAgreements || []).find(a => a.id === ev.ruleVersion.rowId)
    : null;
  const rules = (ruleRow && ruleRow.clawback_rules)
    || (activeAgreementFor(store, ev.resellerId) || {}).clawback_rules
    || CLAWBACK_REASONS;
  if (!rules.includes(reasonCode)) {
    throw err(409, "CLAWBACK_RULE_NOT_ALLOWED", `clawbackreden ${reasonCode} valt buiten de contractuele clawbackregels`);
  }
  const reason = `${reasonCode}${clean(note) ? ": " + clean(note) : ""}`;
  const payout = ev.payoutId ? (store.data.commissionPayouts || []).find(p => p.id === ev.payoutId) : null;
  return payout && payout.status === "paid"
    ? svc.clawback(store, { eventId, amount, reason }, actor)
    : svc.correctEvent(store, { eventId, amount, reason }, actor);
}

// ── Commission statement (23.11/23.14) · reproduceerbaar uit events ──────────

function rejectManualAmounts(params) {
  const manual = STATEMENT_AMOUNT_FIELDS.filter(k => params && Object.prototype.hasOwnProperty.call(params, k));
  if (manual.length) {
    throw err(400, "MANUAL_AMOUNT_FORBIDDEN", `handmatige bedragen zonder berekeningsbasis zijn verboden (23.11): ${manual.join(", ")}`);
  }
}

/**
 * Openstaand saldo bij aanvang van de periode: netto events van eerdere
 * periodes minus wat al door een eerdere dekkende staat is uitbetaald of
 * toegezegd. Een dekkende staat dekt zijn VOLLEDIGE uit events afgeleide
 * bedrag: opening + subtotal (= total - tax) · niet enkel de subtotal, anders
 * keert een eerder uitbetaalde opening elke volgende periode opnieuw terug.
 * Status "disputed" telt mee als dekkend: een gefactureerde staat die naar
 * disputed schuift dekt zijn events nog steeds (het dispuut raakt de
 * berekening niet). Volledig afgeleid uit de store · nooit handmatig.
 */
const COVERING_STATEMENT_STATUSES = ["approved", "invoiced", "paid", "disputed", "closed"];
function openingFor(store, resellerId, period) {
  const prev = L.round2(eventsFor(store, resellerId)
    .filter(e => String(e.period) < String(period))
    .reduce((s, e) => s + e.amount, 0));
  const stated = statementsFor(store, resellerId)
    .filter(s => String(s.period) < String(period) && COVERING_STATEMENT_STATUSES.includes(s.status))
    .reduce((s, st) => s + (Number(st.opening) || 0) + (Number(st.subtotal) || 0), 0);
  return L.round2(prev - stated);
}

/** Pure herberekening van een staat uit de immutable events (deterministisch). */
function computeStatement(store, { resellerId, period, taxPct = 0 }) {
  const evs = eventsFor(store, resellerId)
    .filter(e => e.period === period)
    .slice()
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
  const lines = evs.map(e => ({
    eventId: e.id, type: e.type, amount: e.amount,
    clientTenantId: e.clientTenantId || null, sourceRef: e.sourceRef || null,
    ruleVersion: e.ruleVersion || null, lifecycle: e.lifecycle || "generated",
  }));
  const eventsTotal = L.round2(evs.filter(e => e.type === "accrual").reduce((s, e) => s + e.amount, 0));
  const adjustmentsTotal = L.round2(evs.filter(e => e.type !== "accrual").reduce((s, e) => s + e.amount, 0));
  const subtotal = L.round2(eventsTotal + adjustmentsTotal);
  const opening = openingFor(store, resellerId, period);
  const tax = L.round2(subtotal * (Number(taxPct) || 0) / 100);
  const total = L.round2(opening + subtotal + tax);
  const ruleVersions = [...new Map(
    lines.filter(l => l.ruleVersion).map(l => [`${l.ruleVersion.agreementId}@${l.ruleVersion.version}`, l.ruleVersion])
  ).values()];
  return {
    lines, eventIds: lines.map(l => l.eventId), eventCount: lines.length,
    eventsTotal, adjustmentsTotal, subtotal, opening,
    taxPct: Number(taxPct) || 0, tax, total, ruleVersions,
  };
}

/**
 * Periodestaat opbouwen · UITSLUITEND berekend uit de events. Elk bedragveld
 * in de invoer is verboden (MANUAL_AMOUNT_FORBIDDEN). Per reseller/periode
 * bestaat maximaal een niet-gesloten staat; herrekenen = rebuildStatement.
 */
function buildStatement(store, params = {}, actor) {
  assertCalcAuthority(actor, "STATEMENT_MANAGE_FORBIDDEN");
  rejectManualAmounts(params);
  const { resellerId, period } = params;
  if (!clean(resellerId)) throw err(400, "RESELLER_REQUIRED", "resellerId is verplicht");
  if (!L.isPeriod(period)) throw err(400, "EVENT_PERIOD_INVALID", "period moet YYYY-MM zijn");
  if (statementsFor(store, resellerId).some(s => s.period === period && s.status !== "closed")) {
    throw err(409, "STATEMENT_EXISTS", "er bestaat al een staat voor deze periode · gebruik rebuildStatement");
  }
  const reseller = store.get("resellers", resellerId);
  const currency = clean(params.currency)
    || (reseller && (reseller.payout_currency || reseller.payoutCurrency)) || "EUR";
  const who = (actor && actor.email) || "system";
  const row = {
    id: id("cst"), tenantId: null, resellerId, period, status: "draft", currency,
    ...computeStatement(store, { resellerId, period, taxPct: params.taxPct }),
    calculationBasis: { source: "commissionEvents", reproducible: true },
    generatedAt: nowIso(), generatedBy: who,
    approvedBy: null, approvedAt: null, invoicedAt: null, paidAt: null,
    dispute: null, closedAt: null,
  };
  store.insert("resellerCommissionStatements", row);
  store.audit({ actor: who, tenantId: null, area: "commission", action: "commission_statement_built",
    detail: `${resellerId} ${period} total=${row.total} ${currency} (${row.eventCount} events)` });
  return row;
}

/** Herrekenen kan enkel zolang de staat draft/review is · daarna is ze bevroren. */
function rebuildStatement(store, { statementId }, actor) {
  assertCalcAuthority(actor, "STATEMENT_MANAGE_FORBIDDEN");
  const st = (store.data.resellerCommissionStatements || []).find(s => s.id === statementId);
  if (!st) throw A.notFoundError("statement");
  if (!["draft", "review"].includes(st.status)) {
    throw err(409, "STATEMENT_FROZEN", "een goedgekeurde staat wordt nooit herrekend · correcties lopen via adjustment/clawback");
  }
  const who = (actor && actor.email) || "system";
  const next = store.update("resellerCommissionStatements", statementId, {
    ...computeStatement(store, { resellerId: st.resellerId, period: st.period, taxPct: st.taxPct }),
    rebuiltAt: nowIso(), rebuiltBy: who,
  });
  store.audit({ actor: who, tenantId: null, area: "commission", action: "commission_statement_rebuilt",
    detail: `${st.resellerId} ${st.period} total=${next.total}` });
  return next;
}

/** Mag deze actor een dispuut openen? Partnerzijde met dispute-recht, of Monargo. */
function assertDisputeAuthority(store, actor, resellerId) {
  const reseller = store.get("resellers", resellerId);
  const ctx = { resellerId, resellerStatus: (reseller && reseller.status) || "active" };
  const mayDispute = A.canResellerAction(actor, "reseller.commissions.dispute", ctx);
  const mayManage = !!actor && !actor.resellerId && A.grantFor(actor, "reseller.commissions.manage") === "all";
  if (!mayDispute && !mayManage) throw A.forbiddenError("DISPUTE_FORBIDDEN");
}

/**
 * Statusmachine 23.14: draft → review → approved → invoiced → paid/disputed →
 * closed. Goedkeuring vereist vier-ogen (opsteller keurt nooit zelf) en een
 * REPRODUCEERBAARHEIDS-gate: wijken de events af van de staat, dan eerst
 * herrekenen (STATEMENT_STALE) · goedkeuren op verouderde cijfers kan niet.
 */
function transitionStatement(store, params = {}, actor) {
  rejectManualAmounts(params);
  const { statementId, to, reason = null } = params;
  const st = (store.data.resellerCommissionStatements || []).find(s => s.id === statementId);
  if (!st) throw A.notFoundError("statement");
  if (to === "disputed") assertDisputeAuthority(store, actor, st.resellerId);
  else assertCalcAuthority(actor, "STATEMENT_MANAGE_FORBIDDEN");
  D.commissionStatement.assertTransition(st.status, to);
  if (st.status === to) return st;
  const who = (actor && actor.email) || "system";
  const patch = { status: to };
  if (to === "approved") {
    A.assertNotSelfApproval(who, st.generatedBy);
    const calc = computeStatement(store, { resellerId: st.resellerId, period: st.period, taxPct: st.taxPct });
    const same = ["opening", "eventsTotal", "adjustmentsTotal", "tax", "total", "eventCount"]
      .every(k => Number(st[k]) === Number(calc[k]));
    if (!same) throw err(409, "STATEMENT_STALE", "de staat wijkt af van de events · eerst herrekenen (rebuildStatement)");
    patch.approvedBy = who; patch.approvedAt = nowIso();
  }
  if (to === "invoiced") patch.invoicedAt = nowIso();
  if (to === "paid") patch.paidAt = nowIso();
  if (to === "disputed") {
    if (!clean(reason)) throw err(400, "DISPUTE_REASON_REQUIRED", "een dispuut vereist een reden");
    patch.dispute = { openedBy: who, openedAt: nowIso(), reason: clean(reason) };
  }
  if (to === "closed") patch.closedAt = nowIso();
  const next = store.update("resellerCommissionStatements", statementId, patch);
  store.audit({ actor: who, tenantId: null, area: "commission", action: `commission_statement_${to}`,
    detail: `${st.resellerId} ${st.period}${reason ? " · " + clean(reason) : ""}` });
  return next;
}

// ── Dispuut (23.11) · betwisten mag, herrekenen nooit ────────────────────────

/**
 * Resellerfinance (of Monargo) opent een dispuut op een staat of event. Het
 * dispuut RAAKT de berekening niet: events en staat blijven onaangeroerd,
 * alleen een gefactureerde staat schuift naar de disputed-status (23.14).
 */
function openDispute(store, { statementId = null, eventId = null, reason, disputedAmount = null }, actor) {
  if (!clean(reason)) throw err(400, "DISPUTE_REASON_REQUIRED", "een dispuut vereist een reden");
  // Anti-probing (ISO-06/07, patroon transitionLicenseRequest): voor
  // partnerzijde leest een VREEMD statement/event byte-identiek als een
  // onbestaand id · het bestaan van andermans objecten lekt nooit via 403.
  const resellerSide = !!(actor && actor.resellerId);
  let resellerId; let st = null;
  if (statementId) {
    st = (store.data.resellerCommissionStatements || []).find(s => s.id === statementId);
    if (!st || (resellerSide && st.resellerId !== actor.resellerId)) throw A.notFoundError("statement");
    resellerId = st.resellerId;
  } else if (eventId) {
    const ev = findEvent(store, eventId); // onbestaand → 404 SOURCE_EVENT_NOT_FOUND
    if (resellerSide && ev.resellerId !== actor.resellerId) {
      throw err(404, "SOURCE_EVENT_NOT_FOUND", "bron-event niet gevonden"); // byte-identiek aan onbestaand
    }
    resellerId = ev.resellerId;
  } else {
    throw err(400, "DISPUTE_TARGET_REQUIRED", "statementId of eventId is verplicht");
  }
  assertDisputeAuthority(store, actor, resellerId);
  if (disputedAmount != null && (typeof disputedAmount !== "number" || !(disputedAmount > 0))) {
    throw err(400, "DISPUTE_AMOUNT_INVALID", "disputedAmount moet een getal > 0 zijn");
  }
  const who = (actor && actor.email) || "system";
  const row = {
    id: id("cds"), tenantId: null, resellerId, statementId, eventId,
    status: "open", reason: clean(reason),
    disputedAmount: disputedAmount == null ? null : L.round2(disputedAmount),
    openedBy: who, openedAt: nowIso(),
    resolution: null, resolvedBy: null, resolvedAt: null,
  };
  store.insert("resellerCommissionDisputes", row);
  if (st && st.status === "invoiced") {
    store.update("resellerCommissionStatements", st.id, {
      status: "disputed",
      dispute: { openedBy: who, openedAt: row.openedAt, reason: row.reason, disputeId: row.id },
    });
  }
  store.audit({ actor: who, tenantId: null, area: "commission", action: "commission_dispute_opened",
    detail: `${resellerId} ${statementId || eventId} ${row.reason}` });
  return row;
}

/**
 * Afhandeling open → investigating → accepted/rejected → closed is Monargo-
 * werk. Een geaccepteerd dispuut leidt tot een adjustment/clawback via de
 * daarvoor bestemde functies · nooit tot het aanpassen van de staat zelf.
 */
function transitionDispute(store, { disputeId, to, resolution = null }, actor) {
  assertCalcAuthority(actor, "DISPUTE_MANAGE_FORBIDDEN");
  const d = (store.data.resellerCommissionDisputes || []).find(x => x.id === disputeId);
  if (!d) throw A.notFoundError("dispute");
  D.dispute.assertTransition(d.status, to);
  if (d.status === to) return d;
  const who = (actor && actor.email) || "system";
  const patch = { status: to };
  if (to === "accepted" || to === "rejected") {
    patch.resolution = clean(resolution) || to;
    patch.resolvedBy = who; patch.resolvedAt = nowIso();
  }
  const next = store.update("resellerCommissionDisputes", disputeId, patch);
  store.audit({ actor: who, tenantId: null, area: "commission", action: `commission_dispute_${to}`,
    detail: `${d.resellerId} ${disputeId}` });
  return next;
}

// ── Payoutgegevens (23.11/23.15) · MFA + vier-ogen + wijzigingsaudit ─────────

/**
 * Wijziging van IBAN/valuta gaat NOOIT rechtstreeks op de resellerrij: er
 * ontstaat een pending wijzigingsrecord met before/after, reden en aanvrager.
 * Vereist reseller.payout.manage (partnerfinance op de eigen organisatie, of
 * Monargo-finance) en MFA. Toepassen gebeurt pas na goedkeuring door een
 * ANDERE gebruiker met reseller.payout.approve.
 */
function requestPayoutChange(store, { resellerId, payout_account = null, payout_currency = null, reason }, actor) {
  // Eigen-scope-check VOOR de org-lookup (ISO-07): een reseller-side actor
  // met een expliciet vreemde resellerId krijgt dezelfde harde weigering,
  // of het doel-id nu bestaat of niet · het bestaan van andere
  // partnerorganisaties lekt nooit via een 404/403-verschil.
  if (actor && actor.resellerId && String(resellerId) !== String(actor.resellerId)) {
    throw A.forbiddenError("PAYOUT_CHANGE_FORBIDDEN");
  }
  const reseller = store.get("resellers", resellerId);
  if (!reseller) throw A.notFoundError("reseller");
  if (!A.canResellerAction(actor, "reseller.payout.manage", { resellerId, resellerStatus: reseller.status })) {
    throw A.forbiddenError("PAYOUT_CHANGE_FORBIDDEN");
  }
  if (A.requiresMfa(actor, "reseller.payout.manage")) assertMfa(actor);
  if (!clean(reason)) throw err(400, "REASON_REQUIRED", "een payoutwijziging vereist een reden (23.15)");
  if (payout_account == null && payout_currency == null) throw err(400, "PAYOUT_CHANGE_EMPTY", "niets te wijzigen");
  const before = {}; const after = {};
  if (payout_account != null) {
    const iban = normalizeIban(payout_account);
    if (!IBAN_RE.test(iban)) throw err(400, "PAYOUT_ACCOUNT_INVALID", "payout_account is geen geldige IBAN");
    before.payout_account = reseller.payout_account || null;
    after.payout_account = iban;
  }
  if (payout_currency != null) {
    before.payout_currency = reseller.payout_currency || null;
    after.payout_currency = clean(payout_currency).toUpperCase();
  }
  const who = (actor && actor.email) || "system";
  const row = {
    id: id("cpc"), tenantId: null, resellerId, status: "pending",
    before, after, reason: clean(reason),
    requestedBy: who, requestedAt: nowIso(),
    decidedBy: null, decidedAt: null, rejectReason: null,
  };
  store.insert("resellerPayoutChanges", row);
  store.audit({ actor: who, tenantId: null, area: "commission", action: "payout_change_requested",
    detail: JSON.stringify({ resellerId, before, after, reason: row.reason }) });
  return row;
}

/** Vier-ogen: goedkeurder heeft reseller.payout.approve, MFA en is nooit de aanvrager. */
function approvePayoutChange(store, { changeId }, actor) {
  const chg = (store.data.resellerPayoutChanges || []).find(c => c.id === changeId);
  if (!chg) throw A.notFoundError("payout_change");
  if (chg.status !== "pending") throw err(409, "PAYOUT_CHANGE_NOT_PENDING", "deze wijziging is al afgehandeld");
  const reseller = store.get("resellers", chg.resellerId);
  if (!reseller) throw A.notFoundError("reseller");
  if (!A.canResellerAction(actor, "reseller.payout.approve", { resellerId: chg.resellerId, resellerStatus: reseller.status })) {
    throw A.forbiddenError("PAYOUT_APPROVE_FORBIDDEN");
  }
  if (A.requiresMfa(actor, "reseller.payout.approve")) assertMfa(actor);
  const who = (actor && actor.email) || "";
  A.assertNotSelfApproval(who, chg.requestedBy);
  store.update("resellers", chg.resellerId, { ...chg.after });
  const next = store.update("resellerPayoutChanges", changeId, { status: "approved", decidedBy: who, decidedAt: nowIso() });
  store.audit({ actor: who, tenantId: null, area: "commission", action: "payout_change_approved",
    detail: JSON.stringify({ changeId, resellerId: chg.resellerId, before: chg.before, after: chg.after }) });
  return next;
}

/** Afwijzen mag door iedere goedkeurder (ook op eigen aanvraag = intrekken). */
function rejectPayoutChange(store, { changeId, reason = null }, actor) {
  const chg = (store.data.resellerPayoutChanges || []).find(c => c.id === changeId);
  if (!chg) throw A.notFoundError("payout_change");
  if (chg.status !== "pending") throw err(409, "PAYOUT_CHANGE_NOT_PENDING", "deze wijziging is al afgehandeld");
  const reseller = store.get("resellers", chg.resellerId);
  const who = (actor && actor.email) || "";
  const isRequester = who.trim().toLowerCase() === String(chg.requestedBy || "").trim().toLowerCase();
  const mayApprove = A.canResellerAction(actor, "reseller.payout.approve",
    { resellerId: chg.resellerId, resellerStatus: (reseller && reseller.status) || "active" });
  if (!isRequester && !mayApprove) throw A.forbiddenError("PAYOUT_APPROVE_FORBIDDEN");
  const next = store.update("resellerPayoutChanges", changeId, {
    status: "rejected", decidedBy: who, decidedAt: nowIso(), rejectReason: clean(reason) || null,
  });
  store.audit({ actor: who, tenantId: null, area: "commission", action: "payout_change_rejected",
    detail: JSON.stringify({ changeId, resellerId: chg.resellerId, reason: clean(reason) }) });
  return next;
}

// ── Exportafscherming (23.15) ────────────────────────────────────────────────

/**
 * Algemene resellerexports bevatten NOOIT payout- of contractgegevens.
 * Denylist + patroon: elk veld dat op payout/iban/bank lijkt valt weg.
 */
function exportSafeReseller(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (EXPORT_DENYLIST.includes(k) || EXPORT_DENY_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

module.exports = {
  // constanten
  EARNING_TRIGGERS, CLAWBACK_REASONS, STATEMENT_AMOUNT_FIELDS,
  AGREEMENT_CHANGE_FIELDS, EXPORT_DENYLIST,
  // agreements (immutable versies)
  createAgreement, transitionAgreement, amendAgreement, activeAgreementFor, agreementsFor,
  // events (verdienmoment + rule version + adjustment/clawback)
  accrueFromSource, excludeEvent, adjustEvent, clawbackForReason,
  // staten (reproduceerbaar)
  buildStatement, rebuildStatement, transitionStatement, computeStatement, statementsFor,
  // dispuut
  openDispute, transitionDispute,
  // payoutgegevens
  requestPayoutChange, approvePayoutChange, rejectPayoutChange,
  // export
  exportSafeReseller,
};
