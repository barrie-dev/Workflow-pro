"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const {
  normalizePolicy, resolvePolicy, classifyBackups, policySummary,
  MIN_RETENTION_DAYS, MAX_RETENTION_DAYS, DEFAULT_RETENTION_DAYS, DEFAULT_KEEP_MINIMUM, DAY,
} = require("../src/modules/backup-policy");

test("normalizePolicy: defaults bij lege invoer", () => {
  const p = normalizePolicy({});
  assert.equal(p.retentionDays, DEFAULT_RETENTION_DAYS);
  assert.equal(p.frequency, "daily");
  assert.equal(p.keepMinimum, DEFAULT_KEEP_MINIMUM);
  assert.equal(p.legalHold, false);
});

test("normalizePolicy: klemt retentie binnen grenzen", () => {
  assert.equal(normalizePolicy({ retentionDays: 1 }).retentionDays, MIN_RETENTION_DAYS);
  assert.equal(normalizePolicy({ retentionDays: 999999 }).retentionDays, MAX_RETENTION_DAYS);
  assert.equal(normalizePolicy({ retentionDays: "120" }).retentionDays, 120);
});

test("normalizePolicy: ongeldige frequentie valt terug op daily; keepMinimum >= 1", () => {
  assert.equal(normalizePolicy({ frequency: "hourly" }).frequency, "daily");
  assert.equal(normalizePolicy({ keepMinimum: 0 }).keepMinimum, 1);
  assert.equal(normalizePolicy({ keepMinimum: 99 }).keepMinimum, 30);
});

test("resolvePolicy: leest tenant.backupPolicy", () => {
  const p = resolvePolicy({ backupPolicy: { retentionDays: 30, legalHold: true } });
  assert.equal(p.retentionDays, 30);
  assert.equal(p.legalHold, true);
});

function mkBackups(ageDaysList, now) {
  return ageDaysList.map((age, i) => ({ id: "b" + i, createdAt: new Date(now - age * DAY).toISOString() }));
}

test("classifyBackups: ruimt backups ouder dan retentie op", () => {
  const now = Date.now();
  const backups = mkBackups([1, 10, 40, 100], now); // dagen oud
  const { keep, prune } = classifyBackups(backups, { retentionDays: 30, keepMinimum: 1 }, now);
  assert.deepEqual(prune.map(b => b.id).sort(), ["b2", "b3"]);
  assert.deepEqual(keep.map(b => b.id).sort(), ["b0", "b1"]);
});

test("classifyBackups: behoudt altijd de keepMinimum nieuwste, ook als te oud", () => {
  const now = Date.now();
  const backups = mkBackups([100, 200, 300], now); // allemaal ouder dan retentie
  const { keep, prune } = classifyBackups(backups, { retentionDays: 30, keepMinimum: 2 }, now);
  // 2 nieuwste behouden (100, 200d), oudste (300d) opgeruimd
  assert.equal(keep.length, 2);
  assert.deepEqual(prune.map(b => b.id), ["b2"]);
});

test("classifyBackups: legalHold legt opruiming volledig stil", () => {
  const now = Date.now();
  const backups = mkBackups([100, 200, 300], now);
  const { prune } = classifyBackups(backups, { retentionDays: 7, keepMinimum: 1, legalHold: true }, now);
  assert.equal(prune.length, 0);
});

test("policySummary: telt en geeft prunableIds", () => {
  const now = Date.now();
  const tenant = { backupPolicy: { retentionDays: 30, keepMinimum: 1 } };
  const s = policySummary(tenant, mkBackups([1, 40, 50], now), now);
  assert.equal(s.counts.total, 3);
  assert.equal(s.counts.toPrune, 2);
  assert.equal(s.prunableIds.length, 2);
  assert.ok(Array.isArray(s.legalReference) && s.legalReference.length > 0);
});
