"use strict";
// Trial-to-paid conversietrechter · de afleiding van proefstatus + schrijf-gate.
// Kern: een tenant zonder deadline wordt NOOIT geblokkeerd (pilot/demo veilig),
// betalend = volledige toegang, en pas ná proef + respijt blokkeren we muteren.
const { test } = require("node:test");
const assert = require("node:assert");

const { billingAccess, trialNudge, GRACE_DAYS, NUDGE_DAYS } = require("../src/modules/billing-access");

// Vaste "nu" zodat alles deterministisch is.
const NOW = new Date("2026-07-21T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
function inDays(n) { return new Date(NOW.getTime() + n * DAY).toISOString(); }

test("betalende tenant: volledige toegang, geen banner", () => {
  for (const status of ["active", "paid"]) {
    const a = billingAccess({ status, plan: "business", trialEndsAt: inDays(-30) }, NOW);
    assert.equal(a.converted, true);
    assert.equal(a.state, "active");
    assert.equal(a.writeBlocked, false);
    assert.equal(a.expired, false);
  }
});

test("trial zonder deadline (demo/pilot): nooit geblokkeerd", () => {
  const a = billingAccess({ status: "trial", plan: "business" }, NOW);
  assert.equal(a.state, "trial_open");
  assert.equal(a.writeBlocked, false);
  assert.equal(a.daysLeft, null);
  assert.equal(a.trialEndsAt, null);
});

test("ongeldige trialEndsAt wordt als geen-deadline behandeld", () => {
  const a = billingAccess({ status: "trial", trialEndsAt: "niet-een-datum" }, NOW);
  assert.equal(a.state, "trial_open");
  assert.equal(a.writeBlocked, false);
});

test("actieve proef: dagen over, niet geblokkeerd", () => {
  const a = billingAccess({ status: "trial", trialEndsAt: inDays(10) }, NOW);
  assert.equal(a.state, "trial");
  assert.equal(a.daysLeft, 10);
  assert.equal(a.expired, false);
  assert.equal(a.writeBlocked, false);
});

test("laatste dag toont nog 1 dag (ceil, nooit 0 terwijl actief)", () => {
  const a = billingAccess({ status: "trial", trialEndsAt: inDays(0.4) }, NOW);
  assert.equal(a.state, "trial");
  assert.equal(a.daysLeft, 1);
  assert.equal(a.writeBlocked, false);
});

test("proef net voorbij: respijt, nog volledige toegang", () => {
  const a = billingAccess({ status: "trial", trialEndsAt: inDays(-1) }, NOW);
  assert.equal(a.state, "grace");
  assert.equal(a.expired, true);
  assert.equal(a.inGrace, true);
  assert.equal(a.writeBlocked, false);
  assert.equal(a.daysLeft, 0);
  assert.ok(a.graceDaysLeft >= 1 && a.graceDaysLeft <= GRACE_DAYS);
});

test("proef + respijt voorbij: schrijven geblokkeerd", () => {
  const a = billingAccess({ status: "trial", trialEndsAt: inDays(-(GRACE_DAYS + 1)) }, NOW);
  assert.equal(a.state, "expired");
  assert.equal(a.writeBlocked, true);
  assert.equal(a.graceDaysLeft, 0);
});

test("grens: exact op graceEnds is geblokkeerd (>=)", () => {
  const a = billingAccess({ status: "trial", trialEndsAt: inDays(-GRACE_DAYS) }, NOW);
  assert.equal(a.writeBlocked, true);
});

// ── Nudges ────────────────────────────────────────────────────────────────
test("nudge: vuurt op elke pre-expiry mijlpaal en nergens anders", () => {
  for (const d of NUDGE_DAYS) {
    const n = trialNudge({ status: "trial", trialEndsAt: inDays(d) }, NOW);
    assert.ok(n, `verwacht nudge op dag ${d}`);
    assert.equal(n.stage, `d${d}`);
  }
  // Een niet-mijlpaal (bv. 5 dagen) geeft geen nudge.
  assert.equal(trialNudge({ status: "trial", trialEndsAt: inDays(5) }, NOW), null);
});

test("nudge: verlopen (respijt) en geblokkeerd hebben eigen stage", () => {
  const grace = trialNudge({ status: "trial", trialEndsAt: inDays(-1) }, NOW);
  assert.equal(grace.stage, "expired");
  const blocked = trialNudge({ status: "trial", trialEndsAt: inDays(-(GRACE_DAYS + 2)) }, NOW);
  assert.equal(blocked.stage, "blocked");
});

test("nudge: betalende of deadline-loze tenant krijgt niets", () => {
  assert.equal(trialNudge({ status: "active", trialEndsAt: inDays(1) }, NOW), null);
  assert.equal(trialNudge({ status: "trial" }, NOW), null);
});
