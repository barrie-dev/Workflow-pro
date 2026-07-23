"use strict";

// ── Commission ledger · pure boekhoudlogica (CTO2-10) ────────────────────────
// Een IMMUTABLE, append-only grootboek van commissie-events per reseller. Een
// event wordt NOOIT gewijzigd of verwijderd: een correctie is een TEGENBOEKING
// (een nieuw event dat een eerder event geheel of deels terugdraait). Payouts
// bundelen niet-uitbetaalde events en volgen een state-machine met goedkeuring,
// betaalreferentie, dispute en clawback. Geen SQL, geen I/O · los testbaar.

// Event-types. Bedragen zijn GETEKEND: accrual positief, correction/clawback
// negatief · de som over alle events is het lopende saldo.
const EVENT_TYPES = ["accrual", "correction", "clawback"];

// Payout-lifecycle (h7 · CTO2-10). draft → pending_approval → approved → paid.
// Een dispute kan vanaf pending_approval/approved/paid; een clawback boekt een
// negatief event ná paid (niet op de payout zelf, maar in het grootboek).
// 23.11 · additief op het bestaande grootboek (geen herbouw): een uitbetaling
// kan mislukken (approved → failed, met herpoging failed → pending_approval)
// of ná betaling teruggedraaid worden (paid → reversed). failed is een open,
// onopgeloste toestand · reversed is terminaal, net als cancelled.
const PAYOUT_STATES = ["draft", "pending_approval", "approved", "paid", "disputed", "cancelled", "failed", "reversed"];
const PAYOUT_TRANSITIONS = {
  draft: ["pending_approval", "cancelled"],
  pending_approval: ["approved", "disputed", "cancelled"],
  approved: ["paid", "disputed", "cancelled", "failed"],
  paid: ["disputed", "reversed"],
  disputed: ["approved", "paid", "cancelled"],
  cancelled: [],
  failed: ["pending_approval"],
  reversed: [],
};

function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function isPeriod(p) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p || "")); }

/** Valideer een event vóór het geboekt wordt (append-only). */
function validateEvent(ev) {
  if (!ev || typeof ev !== "object") throw err(400, "EVENT_INVALID", "event ontbreekt");
  if (!EVENT_TYPES.includes(ev.type)) throw err(400, "EVENT_TYPE_INVALID", `onbekend type ${ev.type}`);
  if (!ev.resellerId) throw err(400, "EVENT_RESELLER_REQUIRED", "resellerId is verplicht");
  if (!isPeriod(ev.period)) throw err(400, "EVENT_PERIOD_INVALID", "period moet YYYY-MM zijn");
  if (typeof ev.amount !== "number" || !Number.isFinite(ev.amount)) throw err(400, "EVENT_AMOUNT_INVALID", "amount moet een getal zijn");
  if (ev.type === "accrual" && ev.amount < 0) throw err(400, "EVENT_AMOUNT_SIGN", "een accrual is niet-negatief");
  if ((ev.type === "correction" || ev.type === "clawback")) {
    if (ev.amount > 0) throw err(400, "EVENT_AMOUNT_SIGN", "een correctie/clawback is niet-positief");
    if (!ev.correctsEventId) throw err(400, "EVENT_CORRECTS_REQUIRED", "correctie/clawback verwijst naar een bron-event");
    if (!clean(ev.reason)) throw err(400, "EVENT_REASON_REQUIRED", "correctie/clawback vereist een reden");
  }
  return true;
}
function clean(v) { return String(v == null ? "" : v).trim(); }

/** Bereken het commissiebedrag uit een basis + tarief (server-side bron). */
function commissionAmount(basisAmount, ratePct) {
  return round2((Number(basisAmount) || 0) * (Number(ratePct) || 0) / 100);
}

/**
 * Bouw de accrual-events voor één periode uit een commission-overview (de
 * billing-afgeleide MRR × tarief per klant). Enkel GEPRIJSDE klanten (mrr != null)
 * leveren een event · een prijs-op-aanvraag levert geen commissie. Idempotent te
 * maken door de aanroeper (dedup op resellerId+period+clientTenantId+type=accrual).
 */
function accrualEventsForPeriod(overview, { resellerId, period }) {
  if (!isPeriod(period)) throw err(400, "EVENT_PERIOD_INVALID", "period moet YYYY-MM zijn");
  const rows = (overview && overview.rows) || [];
  return rows
    .filter(r => r.mrr != null && r.mrr > 0)
    .map(r => ({
      type: "accrual",
      resellerId,
      period,
      clientTenantId: r.tenantId,
      basisAmount: round2(r.mrr),
      ratePct: Number(r.commissionPct) || 0,
      amount: commissionAmount(r.mrr, r.commissionPct),
      sourceRef: { kind: "subscription", id: r.tenantId },
    }));
}

/** Een tegenboeking die (een deel van) een bron-event terugdraait. */
function counterEvent(sourceEvent, { amount = null, reason, type = "correction", createdBy = null }) {
  if (!sourceEvent) throw err(404, "SOURCE_EVENT_NOT_FOUND", "bron-event niet gevonden");
  const full = -Math.abs(round2(sourceEvent.amount));
  const amt = amount == null ? full : -Math.abs(round2(amount));
  if (amt < full) throw err(400, "CORRECTION_TOO_LARGE", "de correctie is groter dan het bron-event");
  return {
    type, resellerId: sourceEvent.resellerId, period: sourceEvent.period,
    clientTenantId: sourceEvent.clientTenantId || null,
    basisAmount: sourceEvent.basisAmount, ratePct: sourceEvent.ratePct,
    amount: amt, correctsEventId: sourceEvent.id, reason: clean(reason), createdBy,
    sourceRef: sourceEvent.sourceRef || null,
  };
}

/** Dwing een geldige payout-statusovergang af. */
function assertPayoutTransition(from, to) {
  if (!PAYOUT_STATES.includes(to)) throw err(400, "PAYOUT_STATE_INVALID", `onbekende status ${to}`);
  if (from === to) return;
  if (!(PAYOUT_TRANSITIONS[from] || []).includes(to)) throw err(409, "PAYOUT_TRANSITION_INVALID", `overgang ${from} → ${to} niet toegestaan`);
}

/**
 * Saldo van een reseller uit het grootboek:
 *  - accrued: som van ALLE events (netto na correcties/clawbacks);
 *  - payable: events die (nog) niet in een uitbetaalde payout zitten;
 *  - paid:    events in een betaalde payout;
 *  - clawedBack: som van clawback-events (informatief).
 */
function resellerBalance(events, payouts = []) {
  const paidPayoutIds = new Set(payouts.filter(p => p.status === "paid").map(p => p.id));
  let accrued = 0, payable = 0, paid = 0, clawedBack = 0;
  for (const ev of events || []) {
    accrued = round2(accrued + ev.amount);
    if (ev.type === "clawback") clawedBack = round2(clawedBack + ev.amount);
    if (ev.payoutId && paidPayoutIds.has(ev.payoutId)) paid = round2(paid + ev.amount);
    else payable = round2(payable + ev.amount);
  }
  return { accrued, payable, paid, clawedBack };
}

module.exports = {
  EVENT_TYPES, PAYOUT_STATES, PAYOUT_TRANSITIONS,
  validateEvent, commissionAmount, accrualEventsForPeriod, counterEvent,
  assertPayoutTransition, resellerBalance, round2, isPeriod,
};
