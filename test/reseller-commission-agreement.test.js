"use strict";
// h23.11 · commission agreement (immutable versies), events met rule version,
// reproduceerbare periodestaten, dispuutflow en payout-governance (MFA +
// vier-ogen). Bouwt op het bestaande grootboek (commission-ledger/-service).
const { test } = require("node:test");
const assert = require("node:assert");
const M = require("../src/modules/reseller-commission-agreement");
const svc = require("../src/modules/commission-service");

function fakeStore() {
  const data = {
    resellers: [{ id: "r1", status: "active", display_name: "Partner BV", payout_account: null, payout_currency: "EUR" }],
    commissionEvents: [], commissionPayouts: [],
    resellerCommissionAgreements: [], resellerCommissionStatements: [],
    resellerCommissionDisputes: [], resellerPayoutChanges: [],
    // Centrale bron voor de berekeningsbasis (finding 5 · CTO-09): accrueFromSource
    // neemt base + tenant serverzijdig uit een bestaand payment-/invoice-record.
    payments: [], invoices: [],
    audit: [],
  };
  return {
    data,
    insert(coll, row) { (data[coll] = data[coll] || []).push(row); return row; },
    update(coll, id, patch) { data[coll] = data[coll].map(r => (r.id === id ? { ...r, ...patch } : r)); return data[coll].find(r => r.id === id); },
    get(coll, id) { return (data[coll] || []).find(r => r.id === id); },
    audit(e) { data.audit.push(e); },
  };
}

// Monargo-zijde (all-scope) en partnerzijde (own/assigned) uit reseller-authz.
const mFin = { email: "mfin@monargo", resellerRole: "monargo_partner_finance", mfaEnabled: true, permissions: [] };
const mFin2 = { email: "mfin2@monargo", resellerRole: "monargo_partner_finance", mfaEnabled: true, permissions: [] };
const pFin = { email: "fin@partner.be", resellerRole: "reseller_finance", resellerId: "r1", mfaEnabled: true, permissions: [] };
const pSales = { email: "sales@partner.be", resellerRole: "reseller_sales", resellerId: "r1", mfaEnabled: true, permissions: [] };

function makeActiveAgreement(store, overrides = {}) {
  const a = M.createAgreement(store, {
    resellerId: "r1", model: "percentage", percentage: 10, start_date: "2026-01-01", ...overrides,
  }, mFin);
  M.transitionAgreement(store, { agreementId: a.id, to: "approved" }, mFin2);
  return M.transitionAgreement(store, { agreementId: a.id, to: "active" }, mFin2);
}
// Seed een ECHT betalings-/factuurrecord in de store en geef de bronreferentie
// terug. accrueFromSource neemt base EN tenant serverzijdig uit dat record
// (finding 5 · CTO-09): de aanroeper levert nooit een vrij bedrag aan. Zonder
// bijhorend record volgt 422 SOURCE_RECORD_NOT_FOUND.
function paySrc(store, srcId, base, extra = {}) {
  const kind = extra.kind || "payment";
  const tenantId = "tenantId" in extra ? extra.tenantId : "t1";
  if (kind === "payment") store.insert("payments", { id: srcId, tenantId, amount: base });
  else store.insert("invoices", { id: srcId, tenantId, total: base });
  const src = { kind, id: srcId, period: extra.period || "2026-07" };
  if ("product" in extra) src.product = extra.product;
  return src;
}

// ── Agreements · immutable versies ──

test("createAgreement · valideert model, percentage en startdatum", () => {
  const store = fakeStore();
  assert.throws(() => M.createAgreement(store, { resellerId: "r1", model: "bonus", start_date: "2026-01-01" }, mFin),
    e => e.code === "AGREEMENT_INVALID" && !!e.fieldErrors.model);
  assert.throws(() => M.createAgreement(store, { resellerId: "r1", model: "percentage", start_date: "2026-01-01" }, mFin),
    e => e.code === "AGREEMENT_INVALID" && !!e.fieldErrors.percentage);
  assert.throws(() => M.createAgreement(store, { resellerId: "r1", model: "percentage", percentage: 10 }, mFin),
    e => e.code === "AGREEMENT_INVALID" && !!e.fieldErrors.start_date);
  const a = M.createAgreement(store, { resellerId: "r1", model: "percentage", percentage: 10, start_date: "2026-01-01" }, mFin);
  assert.equal(a.version, 1);
  assert.equal(a.status, "draft");
  assert.equal(a.earning_trigger, "payment_received"); // contractuele default
});

test("agreement-lifecycle · vier-ogen bij goedkeuring, geen sprongen", () => {
  const store = fakeStore();
  const a = M.createAgreement(store, { resellerId: "r1", model: "percentage", percentage: 10, start_date: "2026-01-01" }, mFin);
  // Opsteller keurt nooit zelf goed.
  assert.throws(() => M.transitionAgreement(store, { agreementId: a.id, to: "approved" }, mFin),
    e => e.code === "SELF_APPROVAL_FORBIDDEN");
  // draft → active zonder approval is geen geldige overgang.
  assert.throws(() => M.transitionAgreement(store, { agreementId: a.id, to: "active" }, mFin2),
    e => e.status === 409 && e.code === "AGREEMENT_TRANSITION_INVALID");
  const ok = M.transitionAgreement(store, { agreementId: a.id, to: "approved" }, mFin2);
  assert.equal(ok.approved_by, "mfin2@monargo");
  assert.equal(M.transitionAgreement(store, { agreementId: a.id, to: "active" }, mFin2).status, "active");
});

test("amendAgreement · wijziging = nieuwe versie, oude blijft byte-identiek", () => {
  const store = fakeStore();
  const v1 = makeActiveAgreement(store);
  const snapshot = JSON.stringify(store.get("resellerCommissionAgreements", v1.id));
  assert.throws(() => M.amendAgreement(store, { agreementId: v1.id, changes: { percentage: 12 } }, mFin),
    e => e.code === "REASON_REQUIRED");
  assert.throws(() => M.amendAgreement(store, { agreementId: v1.id, changes: { resellerId: "r2" }, reason: "x" }, mFin),
    e => e.code === "AGREEMENT_FIELD_IMMUTABLE");
  const v2 = M.amendAgreement(store, { agreementId: v1.id, changes: { percentage: 12 }, reason: "tariefherziening 2026" }, mFin);
  assert.equal(v2.version, 2);
  assert.equal(v2.status, "draft");
  assert.equal(v2.percentage, 12);
  assert.equal(v2.agreement_id, v1.agreement_id);
  // Before/after + reden + actor zitten op het nieuwe record zelf (23.15).
  assert.deepEqual(v2.amendment.before, { percentage: 10 });
  assert.deepEqual(v2.amendment.after, { percentage: 12 });
  assert.equal(v2.amendment.supersedes, v1.id);
  // De bronversie is met geen byte veranderd (immutable versions).
  assert.equal(JSON.stringify(store.get("resellerCommissionAgreements", v1.id)), snapshot);
});

test("activeAgreementFor · venster telt en hoogste actieve versie wint", () => {
  const store = fakeStore();
  const v1 = makeActiveAgreement(store);
  assert.equal(M.activeAgreementFor(store, "r1", "2025-12-01"), null, "voor de startdatum is er geen contract");
  assert.equal(M.activeAgreementFor(store, "r1", "2026-07-01").id, v1.id);
  const v2 = M.amendAgreement(store, { agreementId: v1.id, changes: { percentage: 12 }, reason: "herziening" }, mFin);
  M.transitionAgreement(store, { agreementId: v2.id, to: "approved" }, mFin2);
  M.transitionAgreement(store, { agreementId: v2.id, to: "active" }, mFin2);
  assert.equal(M.activeAgreementFor(store, "r1", "2026-07-01").version, 2);
});

test("partnerzijde beheert nooit agreements · ook niet met expliciete grant", () => {
  const store = fakeStore();
  assert.throws(() => M.createAgreement(store, { resellerId: "r1", model: "percentage", percentage: 10, start_date: "2026-01-01" }, pFin),
    e => e.code === "AGREEMENT_MANAGE_FORBIDDEN");
  const pFinPlus = { ...pFin, permissions: ["reseller.commissions.manage:all"] };
  assert.throws(() => M.createAgreement(store, { resellerId: "r1", model: "percentage", percentage: 10, start_date: "2026-01-01" }, pFinPlus),
    e => e.code === "AGREEMENT_MANAGE_FORBIDDEN");
});

// ── Accrual · verdienmoment + rule version ──

test("accrueFromSource · zonder actief contract wordt niets verdiend", () => {
  const store = fakeStore();
  assert.throws(() => M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200) }, mFin),
    e => e.status === 409 && e.code === "AGREEMENT_NOT_ACTIVE");
});

test("accrueFromSource · event legt bron, tenant, periode, base en rule version vast", () => {
  const store = fakeStore();
  const ag = makeActiveAgreement(store);
  const r = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200) }, mFin);
  assert.equal(r.created, true);
  const ev = r.event;
  assert.equal(ev.amount, 20); // 10% van 200
  assert.equal(ev.eligibleBase, 200);
  assert.equal(ev.clientTenantId, "t1");
  assert.equal(ev.period, "2026-07");
  assert.deepEqual(ev.sourceRef, { kind: "payment", id: "pay1" });
  assert.deepEqual(ev.ruleVersion, { agreementId: ag.agreement_id, version: 1, rowId: ag.id });
  assert.equal(ev.lifecycle, "generated");
});

test("verdienmoment · factuur telt niet bij payment_received, wel bij invoice_issued", () => {
  const store = fakeStore();
  makeActiveAgreement(store); // default: payment_received
  assert.throws(() => M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store, "inv1", 200, { kind: "invoice" }) }, mFin),
    e => e.status === 409 && e.code === "EARNING_TRIGGER_NOT_MET");
  const store2 = fakeStore();
  makeActiveAgreement(store2, { earning_trigger: "invoice_issued" });
  const r = M.accrueFromSource(store2, { resellerId: "r1", source: paySrc(store2, "inv1", 200, { kind: "invoice" }) }, mFin);
  assert.equal(r.created, true);
  assert.equal(r.event.amount, 20);
});

test("accrueFromSource · idempotent op de bron, nooit dubbel geboekt", () => {
  const store = fakeStore();
  makeActiveAgreement(store);
  const r1 = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200) }, mFin);
  const r2 = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200) }, mFin);
  assert.equal(r1.created, true);
  assert.equal(r2.created, false);
  assert.equal(r2.event.id, r1.event.id);
  assert.equal(store.data.commissionEvents.length, 1);
});

test("eligible products · niet-geschikt product wordt een excluded 0-event", () => {
  const store = fakeStore();
  makeActiveAgreement(store, { eligible_products: ["core"] });
  const rx = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200, { product: "addon" }) }, mFin);
  assert.equal(rx.excluded, true);
  assert.equal(rx.event.amount, 0);
  assert.equal(rx.event.lifecycle, "excluded");
  assert.equal(rx.event.excludedReason, "product_not_eligible");
  const ok = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay2", 200, { product: "core" }) }, mFin);
  assert.equal(ok.excluded, false);
  assert.equal(ok.event.amount, 20);
});

test("caps · per_event en per_period begrenzen de commissie contractueel", () => {
  const store = fakeStore();
  makeActiveAgreement(store, { caps: { per_event: 15, per_period: 25 } });
  const a = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200) }, mFin); // 20 → 15
  assert.equal(a.event.amount, 15);
  assert.equal(a.event.capApplied, true);
  const b = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay2", 300) }, mFin); // 30 → 15 → ruimte 10
  assert.equal(b.event.amount, 10);
  assert.equal(b.event.capApplied, true);
});

test("fixed model · vast bedrag per bron-event, base blijft vastgelegd", () => {
  const store = fakeStore();
  makeActiveAgreement(store, { model: "fixed", fixed_amount: 50, percentage: null });
  const r = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 999) }, mFin);
  assert.equal(r.event.amount, 50);
  assert.equal(r.event.eligibleBase, 999);
  assert.equal(r.event.ratePct, null);
});

// ── Adjustment/exclusie · nooit overschrijven ──

test("excludeEvent · tegenboeking + lifecycle, bronbedrag onaangeroerd", () => {
  const store = fakeStore();
  makeActiveAgreement(store);
  const ev = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200) }, mFin).event;
  const { event, counter } = M.excludeEvent(store, { eventId: ev.id, reason: "dubbel aangeleverd" }, mFin);
  assert.equal(counter.amount, -20);
  assert.equal(counter.type, "correction");
  assert.equal(event.lifecycle, "excluded");
  assert.equal(event.amount, 20, "het bronbedrag wordt nooit overschreven");
  assert.equal(svc.ledgerFor(store, "r1").balance.accrued, 0);
  // Een excluded event kan daarna niet meer adjusted worden (statusmodel 23.11).
  assert.throws(() => M.adjustEvent(store, { eventId: ev.id, amount: 5, reason: "x" }, mFin),
    e => e.status === 409 && e.code === "COMMISSION_EVENT_TRANSITION_INVALID");
});

test("resellerfinance wijzigt de berekening NOOIT · ook niet met extra grants", () => {
  const store = fakeStore();
  makeActiveAgreement(store);
  const ev = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200) }, mFin).event;
  assert.throws(() => M.adjustEvent(store, { eventId: ev.id, amount: 5, reason: "x" }, pFin),
    e => e.status === 403 && e.code === "CALCULATION_CHANGE_FORBIDDEN");
  assert.throws(() => M.excludeEvent(store, { eventId: ev.id, reason: "x" }, pFin),
    e => e.code === "CALCULATION_CHANGE_FORBIDDEN");
  // Zelfs een expliciet toegekende all-grant op een partnergebruiker helpt niet.
  const pFinPlus = { ...pFin, permissions: ["reseller.commissions.manage:all"] };
  assert.throws(() => M.adjustEvent(store, { eventId: ev.id, amount: 5, reason: "x" }, pFinPlus),
    e => e.code === "CALCULATION_CHANGE_FORBIDDEN");
  assert.throws(() => M.buildStatement(store, { resellerId: "r1", period: "2026-07" }, pFin),
    e => e.code === "STATEMENT_MANAGE_FORBIDDEN");
});

test("adjustEvent · correctie via tegenboeking, origineel blijft staan", () => {
  const store = fakeStore();
  makeActiveAgreement(store);
  const ev = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200) }, mFin).event;
  const { event, counter } = M.adjustEvent(store, { eventId: ev.id, amount: 5, reason: "verkeerde base" }, mFin);
  assert.equal(counter.amount, -5);
  assert.equal(counter.correctsEventId, ev.id);
  assert.equal(event.lifecycle, "adjusted");
  assert.equal(event.amount, 20);
  assert.equal(svc.ledgerFor(store, "r1").balance.accrued, 15);
});

// ── Statement · reproduceerbaar uit immutable events ──

test("buildStatement · reproduceerbaar: rebuild geeft identieke cijfers", () => {
  const store = fakeStore();
  makeActiveAgreement(store);
  M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200) }, mFin);
  M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay2", 100) }, mFin);
  const st = M.buildStatement(store, { resellerId: "r1", period: "2026-07", taxPct: 21 }, mFin);
  // Onafhankelijke controle rechtstreeks uit de events.
  const expected = store.data.commissionEvents.reduce((s, e) => s + e.amount, 0);
  assert.equal(st.eventsTotal, expected); // 20 + 10 = 30
  assert.equal(st.tax, 6.3);
  assert.equal(st.total, 36.3);
  assert.equal(st.currency, "EUR");
  assert.equal(st.ruleVersions.length, 1);
  // Tweede build voor dezelfde periode is geblokkeerd · rebuild is de weg.
  assert.throws(() => M.buildStatement(store, { resellerId: "r1", period: "2026-07" }, mFin),
    e => e.code === "STATEMENT_EXISTS");
  const re = M.rebuildStatement(store, { statementId: st.id }, mFin);
  for (const k of ["opening", "eventsTotal", "adjustmentsTotal", "tax", "total"]) {
    assert.equal(re[k], st[k], `${k} is reproduceerbaar`);
  }
});

test("handmatige bedragen zijn verboden · geen berekeningsbasis, geen staat", () => {
  const store = fakeStore();
  makeActiveAgreement(store);
  M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200) }, mFin);
  assert.throws(() => M.buildStatement(store, { resellerId: "r1", period: "2026-07", total: 999 }, mFin),
    e => e.code === "MANUAL_AMOUNT_FORBIDDEN");
  assert.throws(() => M.buildStatement(store, { resellerId: "r1", period: "2026-07", opening: 1 }, mFin),
    e => e.code === "MANUAL_AMOUNT_FORBIDDEN");
  const st = M.buildStatement(store, { resellerId: "r1", period: "2026-07" }, mFin);
  assert.throws(() => M.transitionStatement(store, { statementId: st.id, to: "review", total: 999 }, mFin),
    e => e.code === "MANUAL_AMOUNT_FORBIDDEN");
});

test("statement-goedkeuring · vier-ogen + stale-gate op de events", () => {
  const store = fakeStore();
  makeActiveAgreement(store);
  M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200) }, mFin);
  const st = M.buildStatement(store, { resellerId: "r1", period: "2026-07" }, mFin);
  M.transitionStatement(store, { statementId: st.id, to: "review" }, mFin);
  // Opsteller keurt nooit zelf goed.
  assert.throws(() => M.transitionStatement(store, { statementId: st.id, to: "approved" }, mFin),
    e => e.code === "SELF_APPROVAL_FORBIDDEN");
  // Nieuw event na de opbouw → goedkeuren op verouderde cijfers kan niet.
  M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay2", 100) }, mFin);
  assert.throws(() => M.transitionStatement(store, { statementId: st.id, to: "approved" }, mFin2),
    e => e.status === 409 && e.code === "STATEMENT_STALE");
  M.rebuildStatement(store, { statementId: st.id }, mFin);
  const ok = M.transitionStatement(store, { statementId: st.id, to: "approved" }, mFin2);
  assert.equal(ok.approvedBy, "mfin2@monargo");
  // Na goedkeuring is herrekenen bevroren.
  assert.throws(() => M.rebuildStatement(store, { statementId: st.id }, mFin),
    e => e.code === "STATEMENT_FROZEN");
});

test("statement · opening draagt eerdere periodes, adjustments tellen apart", () => {
  const store = fakeStore();
  makeActiveAgreement(store);
  M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200) }, mFin); // 2026-07: +20
  const ev8 = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay2", 150, { period: "2026-08" }) }, mFin).event; // +15
  M.adjustEvent(store, { eventId: ev8.id, amount: 5, reason: "korting vergeten" }, mFin); // 2026-08: -5
  const st = M.buildStatement(store, { resellerId: "r1", period: "2026-08", taxPct: 21 }, mFin);
  assert.equal(st.opening, 20, "niet-gestate juli-events schuiven door als opening");
  assert.equal(st.eventsTotal, 15);
  assert.equal(st.adjustmentsTotal, -5);
  assert.equal(st.subtotal, 10);
  assert.equal(st.tax, 2.1);
  assert.equal(st.total, 32.1); // opening + subtotal + tax
});

// ── Dispuut · betwisten mag, herrekenen niet ──

test("dispuut · partnerfinance opent, staat schuift naar disputed, sales niet", () => {
  const store = fakeStore();
  makeActiveAgreement(store);
  M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200) }, mFin);
  const st = M.buildStatement(store, { resellerId: "r1", period: "2026-07" }, mFin);
  M.transitionStatement(store, { statementId: st.id, to: "review" }, mFin);
  M.transitionStatement(store, { statementId: st.id, to: "approved" }, mFin2);
  M.transitionStatement(store, { statementId: st.id, to: "invoiced" }, mFin);
  assert.throws(() => M.openDispute(store, { statementId: st.id, reason: "bedrag klopt niet" }, pSales),
    e => e.code === "DISPUTE_FORBIDDEN");
  const d = M.openDispute(store, { statementId: st.id, reason: "bedrag klopt niet", disputedAmount: 5 }, pFin);
  assert.equal(d.status, "open");
  assert.equal(d.openedBy, "fin@partner.be");
  assert.equal(store.get("resellerCommissionStatements", st.id).status, "disputed");
  // Het dispuut raakt de berekening niet: events en totals staan er nog.
  assert.equal(store.get("resellerCommissionStatements", st.id).total, st.total);
  assert.equal(store.data.commissionEvents.length, 1);
});

test("dispuutafhandeling · alleen Monargo, via de statusmachine", () => {
  const store = fakeStore();
  makeActiveAgreement(store);
  const ev = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200) }, mFin).event;
  const d = M.openDispute(store, { eventId: ev.id, reason: "tarief betwist" }, pFin);
  assert.throws(() => M.transitionDispute(store, { disputeId: d.id, to: "investigating" }, pFin),
    e => e.code === "DISPUTE_MANAGE_FORBIDDEN");
  assert.throws(() => M.transitionDispute(store, { disputeId: d.id, to: "accepted" }, mFin),
    e => e.status === 409 && e.code === "DISPUTE_TRANSITION_INVALID");
  M.transitionDispute(store, { disputeId: d.id, to: "investigating" }, mFin);
  const acc = M.transitionDispute(store, { disputeId: d.id, to: "accepted", resolution: "correctie volgt via adjustment" }, mFin);
  assert.equal(acc.resolvedBy, "mfin@monargo");
  assert.equal(M.transitionDispute(store, { disputeId: d.id, to: "closed" }, mFin).status, "closed");
});

// ── Clawback · hergebruik van het grootboek ──

test("clawbackForReason · na betaling wordt het een echte ledger-clawback", () => {
  const store = fakeStore();
  makeActiveAgreement(store);
  const ev = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200) }, mFin).event;
  assert.throws(() => M.clawbackForReason(store, { eventId: ev.id, reasonCode: "faillissement" }, mFin),
    e => e.code === "CLAWBACK_REASON_INVALID");
  const payout = svc.createPayout(store, { resellerId: "r1", period: "2026-07" }, mFin);
  svc.transitionPayout(store, { payoutId: payout.id, to: "pending_approval" }, mFin);
  svc.transitionPayout(store, { payoutId: payout.id, to: "approved" }, mFin2);
  // Vier-ogen (finding 3): de aanmaker (mFin) betaalt niet zelf uit · mFin2 doet dat.
  svc.transitionPayout(store, { payoutId: payout.id, to: "paid", paymentRef: "SEPA-1" }, mFin2);
  const cb = M.clawbackForReason(store, { eventId: ev.id, reasonCode: "refund", amount: 12, note: "klant terugbetaald" }, mFin);
  assert.equal(cb.type, "clawback");
  assert.equal(cb.amount, -12);
  assert.match(cb.reason, /^refund/);
  assert.equal(svc.ledgerFor(store, "r1").balance.clawedBack, -12);
});

test("clawbackForReason · voor betaling tegenboeking; contractregels begrenzen", () => {
  const store = fakeStore();
  makeActiveAgreement(store, { clawback_rules: ["refund"] });
  const ev = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store,"pay1", 200) }, mFin).event;
  // Fraude staat niet in de contractuele clawbackregels van deze versie.
  assert.throws(() => M.clawbackForReason(store, { eventId: ev.id, reasonCode: "fraud" }, mFin),
    e => e.status === 409 && e.code === "CLAWBACK_RULE_NOT_ALLOWED");
  const c = M.clawbackForReason(store, { eventId: ev.id, reasonCode: "refund", amount: 8 }, mFin);
  assert.equal(c.type, "correction", "voor uitbetaling boekt de ledger een tegenboeking");
  assert.equal(c.amount, -8);
  // Partnerzijde mag ook geen clawback aansturen.
  assert.throws(() => M.clawbackForReason(store, { eventId: ev.id, reasonCode: "refund" }, pFin),
    e => e.code === "CALCULATION_CHANGE_FORBIDDEN");
});

// ── Payoutgegevens · MFA + vier-ogen + audit ──

test("payoutwijziging · IBAN-validatie, MFA-plicht en pending record met before/after", () => {
  const store = fakeStore();
  assert.throws(() => M.requestPayoutChange(store, { resellerId: "r1", payout_account: "GEEN-IBAN", reason: "nieuw" }, pFin),
    e => e.code === "PAYOUT_ACCOUNT_INVALID");
  const noMfa = { ...pFin, mfaEnabled: false };
  assert.throws(() => M.requestPayoutChange(store, { resellerId: "r1", payout_account: "BE68 5390 0754 7034", reason: "nieuw" }, noMfa),
    e => e.status === 403 && e.code === "MFA_REQUIRED");
  assert.throws(() => M.requestPayoutChange(store, { resellerId: "r1", payout_account: "BE68 5390 0754 7034" }, pFin),
    e => e.code === "REASON_REQUIRED");
  const chg = M.requestPayoutChange(store, { resellerId: "r1", payout_account: "BE68 5390 0754 7034", reason: "nieuwe bankrelatie" }, pFin);
  assert.equal(chg.status, "pending");
  assert.deepEqual(chg.before, { payout_account: null });
  assert.deepEqual(chg.after, { payout_account: "BE68539007547034" });
  // De resellerrij is nog NIET gewijzigd: eerst vier-ogen.
  assert.equal(store.get("resellers", "r1").payout_account, null);
  const audit = store.data.audit.find(a => a.action === "payout_change_requested");
  assert.ok(audit && audit.detail.includes("BE68539007547034"));
});

test("payoutwijziging · vier-ogen: aanvrager keurt nooit zelf goed", () => {
  const store = fakeStore();
  const chg = M.requestPayoutChange(store, { resellerId: "r1", payout_account: "BE68539007547034", reason: "wissel" }, mFin);
  // Zelfde persoon → geblokkeerd, ondanks geldige grant en MFA.
  assert.throws(() => M.approvePayoutChange(store, { changeId: chg.id }, mFin),
    e => e.code === "SELF_APPROVAL_FORBIDDEN");
  // Partnerfinance heeft geen approve-recht (alleen Monargo-finance).
  assert.throws(() => M.approvePayoutChange(store, { changeId: chg.id }, pFin),
    e => e.code === "PAYOUT_APPROVE_FORBIDDEN");
  const ok = M.approvePayoutChange(store, { changeId: chg.id }, mFin2);
  assert.equal(ok.status, "approved");
  assert.equal(store.get("resellers", "r1").payout_account, "BE68539007547034");
  // Dubbel afhandelen kan niet.
  assert.throws(() => M.approvePayoutChange(store, { changeId: chg.id }, mFin2),
    e => e.code === "PAYOUT_CHANGE_NOT_PENDING");
});

test("payoutwijziging · sales is hard geweigerd (gevoelige beperking 23.5)", () => {
  const store = fakeStore();
  assert.throws(() => M.requestPayoutChange(store, { resellerId: "r1", payout_account: "BE68539007547034", reason: "x" }, pSales),
    e => e.status === 403 && e.code === "PAYOUT_CHANGE_FORBIDDEN");
});

test("exportSafeReseller · payout- en contractvelden blijven buiten de export", () => {
  const row = {
    id: "r1", display_name: "Partner BV", status: "active", partner_type: "reseller",
    payout_account: "BE68539007547034", payout_currency: "EUR", payoutMethod: "sepa",
    iban_backup: "BE00", bank_name: "KBC", commission_model: { type: "percentage" },
    contract_id: "c-1", agreement_version: 3, accepted_at: "2026-01-01",
    dpa_accepted_at: "2026-01-01", nda_accepted_at: "2026-01-01", passwordHash: "x",
  };
  const out = M.exportSafeReseller(row);
  assert.deepEqual(out, { id: "r1", display_name: "Partner BV", status: "active", partner_type: "reseller" });
});

// ── Regressietests · cluster A (financiele integriteit) ──

test("finding 1 · een uitbetaalde opening keert nooit een tweede keer terug", () => {
  // Exact het bewezen scenario: accrual jan 100 zonder eigen staat, accrual
  // feb 50; de staat feb dekt opening 100 + subtotal 50 = 150 en wordt betaald.
  // De staat maart (geen nieuwe events) MOET dan 0 zijn · de januari-commissie
  // mag niet opnieuw uitbetaald worden. Contract 100% zodat commissie == base.
  const store = fakeStore();
  makeActiveAgreement(store, { percentage: 100 });
  M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store, "pjan", 100, { period: "2026-01" }) }, mFin); // jan: +100
  M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store, "pfeb", 50, { period: "2026-02" }) }, mFin);  // feb: +50
  const feb = M.buildStatement(store, { resellerId: "r1", period: "2026-02" }, mFin);
  assert.equal(feb.opening, 100, "januari schuift door als opening");
  assert.equal(feb.subtotal, 50);
  assert.equal(feb.total, 150);
  M.transitionStatement(store, { statementId: feb.id, to: "review" }, mFin);
  M.transitionStatement(store, { statementId: feb.id, to: "approved" }, mFin2);
  M.transitionStatement(store, { statementId: feb.id, to: "invoiced" }, mFin);
  M.transitionStatement(store, { statementId: feb.id, to: "paid" }, mFin);
  const mar = M.buildStatement(store, { resellerId: "r1", period: "2026-03" }, mFin);
  assert.equal(mar.opening, 0, "de al uitbetaalde jan-opening keert niet terug");
  assert.equal(mar.subtotal, 0);
  assert.equal(mar.total, 0);
});

test("finding 4 · accruePeriod en accrueFromSource dedupliceren over elkaar heen", () => {
  const store = fakeStore();
  makeActiveAgreement(store);
  // MRR-pad boekt eerst 100 voor t1/2026-07 via accruePeriod.
  const overview = { rows: [{ tenantId: "t1", mrr: 1000, commissionPct: 10 }] };
  const per = svc.accruePeriod(store, { resellerId: "r1", period: "2026-07", overview }, mFin);
  assert.equal(per.created, 1);
  // Bron-pad voor een betaling van DEZELFDE klant/maand boekt NIET nogmaals.
  const r = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store, "pay1", 200) }, mFin);
  assert.equal(r.created, false, "de klant/maand is al door accruePeriod geboekt");
  assert.equal(store.data.commissionEvents.length, 1, "geen dubbele accrual");
});

test("finding 5 · vrij bedrag zonder bestaand bronrecord wordt geweigerd (422)", () => {
  const store = fakeStore();
  makeActiveAgreement(store);
  // Verzonnen betalingsreferentie + vrij aangeleverde base: geen record → 422.
  // Het bedrag wordt nooit overgenomen; er wordt niets geboekt.
  assert.throws(() => M.accrueFromSource(store, {
    resellerId: "r1",
    source: { kind: "payment", id: "verzonnen", period: "2026-07", tenantId: "t-vreemd", eligibleBase: 999999 },
  }, mFin), e => e.status === 422 && e.code === "SOURCE_RECORD_NOT_FOUND");
  assert.equal(store.data.commissionEvents.length, 0);
});

test("finding 6 · openDispute lekt geen bestaan van vreemde statements/events", () => {
  const store = fakeStore();
  makeActiveAgreement(store);
  const ev = M.accrueFromSource(store, { resellerId: "r1", source: paySrc(store, "pay1", 200) }, mFin).event;
  const st = M.buildStatement(store, { resellerId: "r1", period: "2026-07" }, mFin);
  // Actor van een ANDERE reseller (r2).
  const other = { email: "fin@ander.be", resellerRole: "reseller_finance", resellerId: "r2", mfaEnabled: true, permissions: [] };
  const grab = fn => { try { fn(); return null; } catch (e) { return { status: e.status, code: e.code, message: e.message }; } };
  // Vreemd (bestaand, niet van r2) vs onbestaand → byte-identiek.
  const foreignStmt = grab(() => M.openDispute(store, { statementId: st.id, reason: "x" }, other));
  const ghostStmt = grab(() => M.openDispute(store, { statementId: "cst_bestaatniet", reason: "x" }, other));
  assert.deepEqual(foreignStmt, ghostStmt);
  assert.equal(foreignStmt.status, 404);
  const foreignEv = grab(() => M.openDispute(store, { eventId: ev.id, reason: "x" }, other));
  const ghostEv = grab(() => M.openDispute(store, { eventId: "cev_bestaatniet", reason: "x" }, other));
  assert.deepEqual(foreignEv, ghostEv);
  assert.equal(foreignEv.status, 404);
  // Er is geen dispuut aangemaakt en het grootboek is ongewijzigd.
  assert.equal((store.data.resellerCommissionDisputes || []).length, 0);
});

test("finding 7 · requestPayoutChange lekt geen bestaan van andere resellers", () => {
  const store = fakeStore();
  // Partner r1-finance vraagt een wijziging voor reseller r2 (onbestaand). De
  // eigen-scope-check zit VOOR de org-lookup: harde 403, geen 404.
  assert.throws(() => M.requestPayoutChange(store, {
    resellerId: "r2", payout_account: "BE68539007547034", reason: "x",
  }, pFin), e => e.status === 403 && e.code === "PAYOUT_CHANGE_FORBIDDEN");
});
