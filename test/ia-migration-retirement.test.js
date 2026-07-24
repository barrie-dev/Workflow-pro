"use strict";
// IA-22 · Migratietelemetrie en uitfasering (IA handover §7/§8).
// Acceptatiebewijs: "No old route retirement before 95% migrated usage and
// green parity suite." Dit is de enige workstream die iets UITZET, dus de
// enige waar een fout eruitziet als "waarom kan ik er niet meer bij".
const { test } = require("node:test");
const assert = require("node:assert");
const mt = require("../public/js/app/routing/migration-telemetry");
const routeMap = require("../public/js/app/navigation/route-map");

const NU = "2026-08-24T00:00:00Z";
const GERIJPT = { legacy: 5, modern: 195, firstSeenAt: "2026-07-01T00:00:00Z" };

test("IA-22 1· de drempels uit de handover staan op één plek", () => {
  assert.equal(mt.RETIREMENT.minMigratedShare, 0.95);
  assert.ok(mt.RETIREMENT.minObservations >= 100);
  assert.ok(mt.RETIREMENT.minObservationDays >= 14);
});

test("IA-22 2· 95% gemigreerd én groene pariteit geeft groen licht", () => {
  const uit = mt.retirementDecision(GERIJPT, { parityGreen: true, now: NU });
  assert.equal(uit.ok, true);
  assert.equal(Math.round(uit.status.migratedShare * 100), 98);
});

test("IA-22 3· een RODE pariteitssuite blokkeert altijd", () => {
  const uit = mt.retirementDecision(GERIJPT, { parityGreen: false, now: NU });
  assert.equal(uit.ok, false);
  assert.equal(uit.code, "PARITY_SUITE_NOT_GREEN");
  // Ook bij 100% gemigreerd gebruik.
  assert.equal(mt.retirementDecision({ legacy: 0, modern: 500, firstSeenAt: "2026-01-01" },
    { parityGreen: false, now: NU }).ok, false);
});

test("IA-22 4· onder 95% blijft de oude route staan", () => {
  const uit = mt.retirementDecision(
    { legacy: 20, modern: 180, firstSeenAt: "2026-07-01T00:00:00Z" }, { parityGreen: true, now: NU });
  assert.equal(uit.ok, false);
  assert.equal(uit.code, "USAGE_NOT_MIGRATED");
  assert.equal(Math.round(uit.status.migratedShare * 100), 90, "90% is dichtbij, en dichtbij is niet genoeg");
});

test("IA-22 5· TE WEINIG METINGEN is ook een nee", () => {
  // Twee van de drie gebruikers via de nieuwe weg is 67% van niets.
  const uit = mt.retirementDecision(
    { legacy: 1, modern: 2, firstSeenAt: "2026-07-01T00:00:00Z" }, { parityGreen: true, now: NU });
  assert.equal(uit.ok, false);
  assert.equal(uit.code, "INSUFFICIENT_DATA");
});

test("IA-22 6· één drukke dag bewijst niets", () => {
  const uit = mt.retirementDecision(
    { legacy: 2, modern: 400, firstSeenAt: "2026-08-22T00:00:00Z" }, { parityGreen: true, now: NU });
  assert.equal(uit.ok, false);
  assert.equal(uit.code, "OBSERVATION_WINDOW_TOO_SHORT");
  assert.equal(uit.status.observationDays, 2);
});

test("IA-22 7· een route zonder enig gebruik wordt niet stil uitgezet", () => {
  const uit = mt.retirementDecision({}, { parityGreen: true, now: NU });
  assert.equal(uit.ok, false);
  assert.equal(uit.code, "INSUFFICIENT_DATA", "nul metingen is geen bewijs van nul gebruik");
  assert.equal(uit.status.migratedShare, 0);
});

test("IA-22 8· uitfaseren gebeurt PER ROUTE, niet per golf", () => {
  const plan = mt.retirementPlan({
    customers: GERIJPT,
    facturen: { legacy: 60, modern: 140, firstSeenAt: "2026-07-01T00:00:00Z" },
    planning: { legacy: 2, modern: 300, firstSeenAt: "2026-07-01T00:00:00Z" },
  }, { parityGreen: true, now: NU });

  assert.deepEqual(plan.retire.map(r => r.routeId), ["customers", "planning"]);
  assert.deepEqual(plan.keep.map(r => r.routeId), ["facturen"],
    "één achterblijver houdt de rest niet tegen, en wordt niet meegesleurd");
});

test("IA-22 9· de wachtlijst staat op volgorde van dichtstbij", () => {
  const plan = mt.retirementPlan({
    ver: { legacy: 150, modern: 50, firstSeenAt: "2026-07-01" },
    dichtbij: { legacy: 15, modern: 185, firstSeenAt: "2026-07-01" },
  }, { parityGreen: true, now: NU });
  assert.deepEqual(plan.keep.map(r => r.routeId), ["dichtbij", "ver"]);
});

test("IA-22 10· zonder aantoonbare TERUGWEG geen uitfasering", () => {
  assert.deepEqual(mt.checkRollback({ flag: "IA_ROUTES", currentValue: "on", verifiedAt: "2026-08-20" }),
    { ok: true, violations: [] });

  const zonderSchakelaar = mt.checkRollback({ verifiedAt: "2026-08-20" });
  assert.equal(zonderSchakelaar.ok, false);
  assert.ok(zonderSchakelaar.violations.some(v => v.reason === "NO_ROLLBACK_SWITCH"));

  const nooitGetest = mt.checkRollback({ flag: "IA_ROUTES", currentValue: "on" });
  assert.deepEqual(nooitGetest.violations, [{ field: "verifiedAt", reason: "ROLLBACK_NEVER_TESTED" }],
    "een terugweg die nooit geprobeerd is, is een aanname");
});

test("IA-22 11· redirect-telemetrie draagt bestemmingen, geen inhoud", () => {
  const e = mt.redirectEvent("facturen", "/app/finance/invoices");
  assert.deepEqual(e, { event: "legacy.redirect", old_view: "facturen", target_route: "/app/finance/invoices" });
  assert.deepEqual(Object.keys(e).sort(), ["event", "old_view", "target_route"]);
});

test("IA-22 12· elke legacy-view die we meten heeft ook echt een nieuwe bestemming", () => {
  // Anders meet je een migratie naar nergens.
  const zonderDoel = Object.keys(routeMap.LEGACY_VIEW_MAP).filter(v => !routeMap.legacyRedirect(v));
  assert.deepEqual(zonderDoel, [], `deze oude views leiden nergens heen: ${zonderDoel.join(", ")}`);
});
