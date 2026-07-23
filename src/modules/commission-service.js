"use strict";

// ── Commission-service · store-gebonden grootboek (CTO2-10) ──────────────────
// Materialiseert de pure ledger-logica op de platform-store (collecties
// commissionEvents + commissionPayouts). Events zijn append-only: nooit update,
// nooit delete · een correctie is een tegenboeking, een clawback een negatief
// event ná uitbetaling. Elke actie schrijft een auditregel (grondslag herleidbaar).

const crypto = require("crypto");
const L = require("../platform/commission-ledger");
const A = require("../platform/reseller-authz"); // vier-ogen (assertNotSelfApproval)

function id(prefix) { return `${prefix}_${crypto.randomBytes(9).toString("hex")}`; }
function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
function nowIso() { return new Date().toISOString(); }

function eventsOf(store, resellerId) {
  return (store.data.commissionEvents || []).filter(e => e.resellerId === resellerId);
}
function payoutsOf(store, resellerId) {
  return (store.data.commissionPayouts || []).filter(p => p.resellerId === resellerId);
}

/** Boek één event (na validatie) · immutable append + audit. */
function appendEvent(store, ev, actor) {
  L.validateEvent(ev);
  const row = {
    id: id("cev"), tenantId: null, createdAt: nowIso(), createdBy: (actor && actor.email) || "system",
    payoutId: null, ...ev,
  };
  store.insert("commissionEvents", row);
  store.audit({ actor: row.createdBy, tenantId: null, area: "commission", action: `commission_${ev.type}`,
    detail: `${ev.resellerId} ${ev.period} ${ev.amount}` });
  return row;
}

/**
 * Genereer de accrual-events voor een reseller/periode uit het commission-
 * overview (billing-afgeleide MRR × tarief). IDEMPOTENT: bestaat er al een
 * accrual voor (reseller, period, client), dan wordt die overgeslagen · een
 * herberekening dupliceert niets en overschrijft geen geboekt verleden.
 */
function accruePeriod(store, { resellerId, period, overview }, actor) {
  const existing = new Set(eventsOf(store, resellerId)
    .filter(e => e.type === "accrual" && e.period === period)
    .map(e => e.clientTenantId));
  const candidates = L.accrualEventsForPeriod(overview, { resellerId, period });
  const created = [];
  for (const ev of candidates) {
    if (existing.has(ev.clientTenantId)) continue;
    created.push(appendEvent(store, ev, actor));
  }
  return { resellerId, period, created: created.length, skipped: candidates.length - created.length, events: created };
}

/** Corrigeer een geboekt event via tegenboeking (geen mutatie). */
function correctEvent(store, { eventId, amount = null, reason }, actor) {
  const src = (store.data.commissionEvents || []).find(e => e.id === eventId);
  if (!src) throw err(404, "SOURCE_EVENT_NOT_FOUND", "bron-event niet gevonden");
  // Niet méér terugboeken dan het netto al niet gecorrigeerde bedrag.
  const already = eventsOf(store, src.resellerId)
    .filter(e => e.correctsEventId === eventId)
    .reduce((s, e) => s + e.amount, 0);
  const netRemaining = L.round2(src.amount + already); // src positief, already negatief
  const ce = L.counterEvent(src, { amount, reason, type: "correction", createdBy: (actor && actor.email) || "system" });
  if (L.round2(-ce.amount) > netRemaining + 1e-9) throw err(400, "CORRECTION_TOO_LARGE", "de correctie overschrijdt het resterende bedrag");
  return appendEvent(store, ce, actor);
}

/**
 * Maak een payout uit alle nog niet-uitbetaalde events van een reseller
 * (payable = niet aan een betaalde payout gekoppeld en niet aan een lopende
 * open payout). Reserveert de events door hun payoutId te zetten.
 */
function createPayout(store, { resellerId, period = null }, actor) {
  // Ook een mislukte (failed) payout houdt zijn events gereserveerd: die kan
  // via failed → pending_approval opnieuw worden aangeboden (23.11), dus de
  // events mogen niet in een nieuwe payout belanden.
  const open = payoutsOf(store, resellerId).filter(p => ["draft", "pending_approval", "approved", "failed"].includes(p.status));
  const reserved = new Set(open.flatMap(p => p.eventIds || []));
  const paidIds = new Set(payoutsOf(store, resellerId).filter(p => p.status === "paid").flatMap(p => p.eventIds || []));
  const includable = eventsOf(store, resellerId).filter(e =>
    !reserved.has(e.id) && !paidIds.has(e.id) && (!period || e.period === period));
  if (!includable.length) throw err(409, "NO_PAYABLE_EVENTS", "geen uitbetaalbare events voor deze reseller/periode");
  const amount = L.round2(includable.reduce((s, e) => s + e.amount, 0));
  if (amount <= 0) throw err(409, "PAYOUT_NON_POSITIVE", "het uit te betalen saldo is niet positief (open correcties/clawbacks)");
  const payout = {
    id: id("cpo"), resellerId, status: "draft",
    period: period || null, eventIds: includable.map(e => e.id), amount,
    paymentRef: null, approvedBy: null, approvedAt: null, paidAt: null, dispute: null,
    createdAt: nowIso(), createdBy: (actor && actor.email) || "system",
  };
  store.insert("commissionPayouts", payout);
  for (const e of includable) store.update("commissionEvents", e.id, { payoutId: payout.id });
  store.audit({ actor: payout.createdBy, tenantId: null, area: "commission", action: "payout_created", detail: `${resellerId} ${amount} (${includable.length} events)` });
  return payout;
}

/** Payout-statusovergang met de vereiste velden per doelstatus. */
function transitionPayout(store, { payoutId, to, paymentRef = null, reason = null }, actor) {
  const p = (store.data.commissionPayouts || []).find(x => x.id === payoutId);
  if (!p) throw err(404, "PAYOUT_NOT_FOUND", "payout niet gevonden");
  L.assertPayoutTransition(p.status, to);
  const patch = { status: to };
  const who = (actor && actor.email) || "system";
  // Vier-ogen (23.11): de aanmaker van de payout keurt of betaalt NOOIT zelf ·
  // precies waar geld het systeem verlaat.
  if (to === "approved" || to === "paid") A.assertNotSelfApproval(who, p.createdBy);
  if (to === "approved") { patch.approvedBy = who; patch.approvedAt = nowIso(); }
  if (to === "paid") {
    if (!clean(paymentRef)) throw err(400, "PAYMENT_REF_REQUIRED", "een betaalreferentie is verplicht bij uitbetaling");
    patch.paymentRef = clean(paymentRef); patch.paidAt = nowIso();
  }
  if (to === "disputed") patch.dispute = { openedBy: who, openedAt: nowIso(), reason: clean(reason), resolvedAt: null, resolution: null };
  if (to === "failed") patch.failedAt = nowIso();
  if (to === "reversed") patch.reversedAt = nowIso();
  if (to === "cancelled") {
    // Reservering vrijgeven: de events worden weer payable.
    for (const eid of p.eventIds || []) store.update("commissionEvents", eid, { payoutId: null });
  }
  const next = store.update("commissionPayouts", payoutId, patch);
  store.audit({ actor: who, tenantId: null, area: "commission", action: `payout_${to}`, detail: `${payoutId}${paymentRef ? " ref=" + clean(paymentRef) : ""}` });
  return next;
}

/**
 * Clawback ná uitbetaling: boek een negatief event dat (een deel van) een
 * betaalde accrual terugvordert. Vereist een reden; het grootboek blijft kloppen.
 */
function clawback(store, { eventId, amount = null, reason }, actor) {
  const src = (store.data.commissionEvents || []).find(e => e.id === eventId);
  if (!src) throw err(404, "SOURCE_EVENT_NOT_FOUND", "bron-event niet gevonden");
  const payout = src.payoutId ? (store.data.commissionPayouts || []).find(p => p.id === src.payoutId) : null;
  if (!payout || payout.status !== "paid") throw err(409, "CLAWBACK_NOT_PAID", "clawback kan enkel op een reeds uitbetaald event");
  // Dezelfde cumulatieve grens als correctEvent: ALLE eerdere tegenboekingen
  // (correcties én clawbacks) tellen mee · nooit meer terugvorderen dan het
  // netto resterende bedrag, anders wordt het reseller-saldo negatief.
  const already = eventsOf(store, src.resellerId)
    .filter(e => e.correctsEventId === eventId)
    .reduce((s, e) => s + e.amount, 0);
  const netRemaining = L.round2(src.amount + already); // src positief, already negatief
  const ce = L.counterEvent(src, { amount, reason, type: "clawback", createdBy: (actor && actor.email) || "system" });
  if (L.round2(-ce.amount) > netRemaining + 1e-9) throw err(400, "CORRECTION_TOO_LARGE", "de clawback overschrijdt het resterende bedrag");
  return appendEvent(store, ce, actor);
}

/** Volledig grootboek + saldo van één reseller (voor superadmin/reseller-portaal). */
function ledgerFor(store, resellerId) {
  const events = eventsOf(store, resellerId).slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const payouts = payoutsOf(store, resellerId).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { resellerId, balance: L.resellerBalance(events, payouts), events, payouts };
}

function clean(v) { return String(v == null ? "" : v).trim(); }

module.exports = {
  appendEvent, accruePeriod, correctEvent, createPayout, transitionPayout, clawback, ledgerFor,
};
