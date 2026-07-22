"use strict";
// Retentiebeleid (h5/h27 · FORM-05). Bewijst normalisatie, purge-geschiktheid
// (termijn, legal hold, keep_minimum, onbepaalde termijn) en de purge-set.
const { test } = require("node:test");
const assert = require("node:assert");
const R = require("../src/modules/retention-policy");

const NOW = Date.parse("2026-07-22T00:00:00Z");
const daysAgo = n => new Date(NOW - n * R.DAY_MS).toISOString();

test("normalizePolicy · veilige defaults + camel/snake-tolerantie", () => {
  const p = R.normalizePolicy({ key: "gdpr", retentionDays: 30, keepMinimum: 2, legalHold: true, purgeStrategy: "anonymize" });
  assert.equal(p.retentionDays, 30);
  assert.equal(p.keepMinimum, 2);
  assert.equal(p.legalHold, true);
  assert.equal(p.purgeStrategy, "anonymize");
  // Onbekende strategie valt terug op soft_archive; ontbrekende termijn = onbepaald.
  const d = R.normalizePolicy({ purge_strategy: "zap" });
  assert.equal(d.purgeStrategy, "soft_archive");
  assert.equal(d.retentionDays, null);
});

test("isPurgeEligible · termijn verstreken, maar legal hold en keep_minimum beschermen", () => {
  const policy = { retentionDays: 90, keepMinimum: 1 };
  const oud = { id: "a", created_at: daysAgo(200) };
  const jong = { id: "b", created_at: daysAgo(10) };
  assert.equal(R.isPurgeEligible(oud, policy, { now: NOW, rank: 5 }), true, "200 dagen oud > 90d termijn");
  assert.equal(R.isPurgeEligible(jong, policy, { now: NOW, rank: 5 }), false, "10 dagen oud < termijn");
  // keep_minimum: het nieuwste object (rank 0 < keepMinimum 1) wordt nooit gepurged.
  assert.equal(R.isPurgeEligible(oud, policy, { now: NOW, rank: 0 }), false, "onder keep_minimum blijft bewaard");
  // Legal hold op het beleid of het object bevriest purge.
  assert.equal(R.isPurgeEligible(oud, { ...policy, legalHold: true }, { now: NOW, rank: 5 }), false);
  assert.equal(R.isPurgeEligible({ ...oud, legal_hold: true }, policy, { now: NOW, rank: 5 }), false);
  // Onbepaalde termijn → nooit purgen.
  assert.equal(R.isPurgeEligible(oud, { retentionDays: null }, { now: NOW, rank: 9 }), false);
});

test("computePurgeSet · sorteert nieuw→oud, respecteert keep_minimum, geeft strategie", () => {
  const rows = [
    { id: "n", created_at: daysAgo(5) },
    { id: "m", created_at: daysAgo(120) },
    { id: "o", created_at: daysAgo(400) },
  ];
  const { eligible, kept, strategy } = R.computePurgeSet(rows, { retentionDays: 90, keepMinimum: 1, purgeStrategy: "hard_delete" }, { now: NOW });
  assert.equal(strategy, "hard_delete");
  // 'n' te jong + nieuwste (kept), 'm' en 'o' verlopen maar rank 0 (n) is beschermd.
  assert.deepEqual(eligible.map(r => r.id).sort(), ["m", "o"]);
  assert.ok(kept.some(r => r.id === "n"));
});

test("policySummary · telbaar overzicht voor UI/audit", () => {
  const rows = [{ id: "1", created_at: daysAgo(400) }, { id: "2", created_at: daysAgo(1) }];
  const s = R.policySummary({ key: "f", retentionDays: 90, keepMinimum: 0 }, rows, NOW);
  assert.equal(s.total, 2);
  assert.equal(s.eligible, 1);
  assert.equal(s.kept, 1);
});
