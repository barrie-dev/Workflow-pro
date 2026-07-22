"use strict";
// CTO2-10 · commission ledger. Pure engine + de store-gebonden service:
// immutable events, correctie-via-tegenboeking, payout-state-machine met
// betaalreferentie, dispute en clawback, en het lopende saldo.
const { test } = require("node:test");
const assert = require("node:assert");
const L = require("../src/platform/commission-ledger");
const svc = require("../src/modules/commission-service");

// ── Pure engine ──
test("validateEvent · tekens en verplichte velden", () => {
  assert.throws(() => L.validateEvent({ type: "accrual", resellerId: "r", period: "2026-7", amount: 5 }), e => e.code === "EVENT_PERIOD_INVALID");
  assert.throws(() => L.validateEvent({ type: "accrual", resellerId: "r", period: "2026-07", amount: -5 }), e => e.code === "EVENT_AMOUNT_SIGN");
  assert.throws(() => L.validateEvent({ type: "correction", resellerId: "r", period: "2026-07", amount: 5, correctsEventId: "x", reason: "y" }), e => e.code === "EVENT_AMOUNT_SIGN");
  assert.throws(() => L.validateEvent({ type: "correction", resellerId: "r", period: "2026-07", amount: -5, reason: "y" }), e => e.code === "EVENT_CORRECTS_REQUIRED");
  assert.equal(L.validateEvent({ type: "accrual", resellerId: "r", period: "2026-07", amount: 5 }), true);
});

test("commissionAmount + accrualEventsForPeriod · enkel geprijsde klanten", () => {
  assert.equal(L.commissionAmount(100, 12.5), 12.5);
  const overview = { rows: [
    { tenantId: "c1", mrr: 200, commissionPct: 10 },
    { tenantId: "c2", mrr: null, commissionPct: 10 }, // op aanvraag → geen event
    { tenantId: "c3", mrr: 0, commissionPct: 10 },
  ] };
  const evs = L.accrualEventsForPeriod(overview, { resellerId: "r1", period: "2026-07" });
  assert.equal(evs.length, 1);
  assert.equal(evs[0].amount, 20);
  assert.equal(evs[0].clientTenantId, "c1");
});

test("counterEvent · niet groter dan het bron-event", () => {
  const src = { id: "e1", resellerId: "r", period: "2026-07", amount: 20 };
  assert.equal(L.counterEvent(src, { reason: "x" }).amount, -20, "volledige terugboeking");
  assert.equal(L.counterEvent(src, { amount: 5, reason: "x" }).amount, -5, "deelcorrectie");
  assert.throws(() => L.counterEvent(src, { amount: 25, reason: "x" }), e => e.code === "CORRECTION_TOO_LARGE");
});

test("assertPayoutTransition + resellerBalance", () => {
  assert.throws(() => L.assertPayoutTransition("draft", "paid"), e => e.code === "PAYOUT_TRANSITION_INVALID");
  L.assertPayoutTransition("approved", "paid");
  const events = [
    { amount: 20, type: "accrual", payoutId: "p1" },
    { amount: 30, type: "accrual", payoutId: null },
    { amount: -5, type: "clawback", payoutId: "p1" },
  ];
  const payouts = [{ id: "p1", status: "paid" }];
  const b = L.resellerBalance(events, payouts);
  assert.equal(b.accrued, 45);
  assert.equal(b.paid, 15);      // 20 - 5, in de betaalde payout
  assert.equal(b.payable, 30);   // los event
  assert.equal(b.clawedBack, -5);
});

// ── Store-gebonden service ──
function fakeStore() {
  const data = { commissionEvents: [], commissionPayouts: [], audit: [] };
  return {
    data,
    insert(coll, row) { (data[coll] = data[coll] || []).push(row); return row; },
    update(coll, id, patch) { data[coll] = data[coll].map(r => (r.id === id ? { ...r, ...patch } : r)); return data[coll].find(r => r.id === id); },
    get(coll, id) { return (data[coll] || []).find(r => r.id === id); },
    audit(e) { data.audit.push(e); },
  };
}
const admin = { email: "super@x" };
const overview = { rows: [{ tenantId: "c1", mrr: 200, commissionPct: 10 }, { tenantId: "c2", mrr: 100, commissionPct: 15 }] };

test("accruePeriod · idempotent, geen dubbele boekingen", () => {
  const store = fakeStore();
  const r1 = svc.accruePeriod(store, { resellerId: "r1", period: "2026-07", overview }, admin);
  assert.equal(r1.created, 2);
  assert.equal(store.data.commissionEvents.length, 2);
  // Tweede run met dezelfde periode → alles overgeslagen (geen duplicaten).
  const r2 = svc.accruePeriod(store, { resellerId: "r1", period: "2026-07", overview }, admin);
  assert.equal(r2.created, 0);
  assert.equal(r2.skipped, 2);
  assert.equal(store.data.commissionEvents.length, 2);
});

test("payout-lifecycle · draft → approved → paid met betaalreferentie", () => {
  const store = fakeStore();
  svc.accruePeriod(store, { resellerId: "r1", period: "2026-07", overview }, admin); // 20 + 15 = 35
  const payout = svc.createPayout(store, { resellerId: "r1", period: "2026-07" }, admin);
  assert.equal(payout.amount, 35);
  assert.equal(payout.status, "draft");
  // De events zijn gereserveerd; een tweede payout vindt niets meer.
  assert.throws(() => svc.createPayout(store, { resellerId: "r1", period: "2026-07" }, admin), e => e.code === "NO_PAYABLE_EVENTS");
  svc.transitionPayout(store, { payoutId: payout.id, to: "pending_approval" }, admin);
  svc.transitionPayout(store, { payoutId: payout.id, to: "approved" }, admin);
  // Uitbetalen zonder referentie → geweigerd.
  assert.throws(() => svc.transitionPayout(store, { payoutId: payout.id, to: "paid" }, admin), e => e.code === "PAYMENT_REF_REQUIRED");
  const paid = svc.transitionPayout(store, { payoutId: payout.id, to: "paid", paymentRef: "SEPA-2026-07-001" }, admin);
  assert.equal(paid.status, "paid");
  assert.equal(paid.paymentRef, "SEPA-2026-07-001");
  const led = svc.ledgerFor(store, "r1");
  assert.equal(led.balance.paid, 35);
  assert.equal(led.balance.payable, 0);
});

test("correctie via tegenboeking · immutable, saldo klopt", () => {
  const store = fakeStore();
  svc.accruePeriod(store, { resellerId: "r1", period: "2026-07", overview }, admin);
  const ev = store.data.commissionEvents.find(e => e.clientTenantId === "c1"); // 20
  const before = { ...ev };
  const corr = svc.correctEvent(store, { eventId: ev.id, amount: 8, reason: "verkeerd tarief" }, admin);
  assert.equal(corr.amount, -8);
  assert.equal(corr.type, "correction");
  // Bron-event ONGEWIJZIGD (append-only).
  const after = store.data.commissionEvents.find(e => e.id === ev.id);
  assert.deepEqual({ amount: after.amount, type: after.type }, { amount: before.amount, type: before.type });
  // Niet méér terugboeken dan het resterende bedrag (20 - 8 = 12).
  assert.throws(() => svc.correctEvent(store, { eventId: ev.id, amount: 15, reason: "te veel" }), e => e.code === "CORRECTION_TOO_LARGE");
  assert.equal(svc.ledgerFor(store, "r1").balance.accrued, 27); // 20-8 + 15
});

test("clawback · enkel op reeds uitbetaald event; dispute-flow", () => {
  const store = fakeStore();
  svc.accruePeriod(store, { resellerId: "r1", period: "2026-07", overview }, admin);
  const ev = store.data.commissionEvents.find(e => e.clientTenantId === "c1");
  // Clawback vóór uitbetaling → geweigerd.
  assert.throws(() => svc.clawback(store, { eventId: ev.id, reason: "refund" }, admin), e => e.code === "CLAWBACK_NOT_PAID");
  const payout = svc.createPayout(store, { resellerId: "r1", period: "2026-07" }, admin);
  svc.transitionPayout(store, { payoutId: payout.id, to: "pending_approval" }, admin);
  // Dispute vanuit pending_approval.
  const disp = svc.transitionPayout(store, { payoutId: payout.id, to: "disputed", reason: "reseller betwist bedrag" }, admin);
  assert.equal(disp.dispute.reason, "reseller betwist bedrag");
  // Terug naar approved en uitbetalen.
  svc.transitionPayout(store, { payoutId: payout.id, to: "approved" }, admin);
  svc.transitionPayout(store, { payoutId: payout.id, to: "paid", paymentRef: "REF-1" }, admin);
  // Nu mag de clawback (deel van de betaalde c1-accrual = 20).
  const cb = svc.clawback(store, { eventId: ev.id, amount: 12, reason: "klant opgezegd binnen maand" }, admin);
  assert.equal(cb.amount, -12);
  assert.equal(cb.type, "clawback");
  const bal = svc.ledgerFor(store, "r1").balance;
  assert.equal(bal.clawedBack, -12);
  assert.equal(bal.accrued, 23); // 35 - 12
});
