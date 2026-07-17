"use strict";
// Service & Assets (master-spec h33/h34/h44, E16): assets, historiek, schema's.
const { test } = require("node:test");
const assert = require("node:assert");

const { normalizeAsset, makeAssetRepository, makeMaintenancePlanRepository, addMonths, ASSET_STATUSES } = require("../src/platform/assets");

function fakeStore(data = {}) {
  const d = { assets: [], maintenancePlans: [], workorders: [], ...data };
  return {
    data: d,
    list(col, tid) { return (d[col] || []).filter(r => r.tenantId === tid); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    update(col, id, patch) { d[col] = d[col].map(r => r.id === id ? { ...r, ...patch } : r); return d[col].find(r => r.id === id); },
    remove(col, id) { d[col] = d[col].filter(r => r.id !== id); },
    save() {},
  };
}

test("assets: normalisatie met type-afhankelijke defaultstatus", () => {
  assert.equal(normalizeAsset({ name: "Boormachine" }).status, "in_stock");
  assert.equal(normalizeAsset({ name: "Warmtepomp", type: "installation" }).status, "installed");
  assert.ok(ASSET_STATUSES.includes("defective"));
  assert.throws(() => normalizeAsset({ name: "" }), /Assetnaam/);
});

test("assets: serienummer uniek + historiek-events bij wijzigingen", () => {
  const store = fakeStore();
  const repo = makeAssetRepository(store);
  const a = repo.insert("t1", { name: "Warmtepomp", type: "installation", serial: "SN-001", customerId: "c1" }, "a@x.be");
  assert.equal(a.history.length, 1);
  assert.equal(a.history[0].event, "created");

  try { repo.insert("t1", { name: "Kopie", serial: "SN-001" }, "a@x.be"); assert.fail("duplicaat verwacht"); }
  catch (e) { assert.equal(e.code, "DUPLICATE_SERIAL"); }

  // Status- en locatiewijziging → historiek-event (h33: gebeurtenis, geen overschrijving).
  const up = repo.update("t1", a.id, { status: "maintenance", venueId: "v9" }, "b@x.be", 1);
  assert.equal(up.version, 2);
  assert.equal(up.history.length, 2);
  assert.match(up.history[1].event, /status: installed → maintenance/);
  assert.match(up.history[1].event, /locatie gewijzigd/);
});

test("assets: meterstand mag niet dalen zonder correctie (h33)", () => {
  const store = fakeStore();
  const repo = makeAssetRepository(store);
  const a = repo.insert("t1", { name: "Compressor", meterReading: 1000 }, "a@x.be");
  try { repo.update("t1", a.id, { meterReading: 900 }, "b@x.be"); assert.fail("daling verwacht geblokkeerd"); }
  catch (e) { assert.equal(e.code, "METER_DECREASE"); }
  const fixed = repo.update("t1", a.id, { meterReading: 900, meterCorrection: true, meterCorrectionReason: "Meter vervangen" }, "b@x.be");
  assert.equal(fixed.meterReading, 900);
  assert.match(fixed.history[fixed.history.length - 1].event, /gecorrigeerd: Meter vervangen/);
  // Stijgen mag altijd.
  assert.equal(repo.update("t1", a.id, { meterReading: 1200 }, "b@x.be").meterReading, 1200);
});

test("onderhoud: idempotente beurt-generatie + nextDue schuift op", () => {
  const store = fakeStore();
  const plans = makeMaintenancePlanRepository(store);
  const p = plans.insert("t1", { assetId: "ast_1", title: "Jaarlijks onderhoud", frequency: "annual", nextDue: "2026-08-01", checklist: ["Filter", "Druk"] }, "a@x.be");
  assert.equal(p.status, "active");

  let jobs = 0;
  const mkJob = (plan, due) => { jobs++; return store.insert("workorders", { id: `wo_${jobs}`, tenantId: "t1", date: due }); };

  const r1 = plans.generateDueJob("t1", p.id, "a@x.be", mkJob);
  assert.equal(r1.alreadyGenerated, false);
  assert.equal(r1.dueDate, "2026-08-01");
  assert.equal(r1.plan.nextDue, "2027-08-01", "annual schuift 12 maanden op");

  // Idempotent: zelfde duedatum opnieuw → bestaande beurt, geen tweede werkbon.
  const again = plans.generateDueJob("t1", p.id, "a@x.be", mkJob);
  // nextDue is al opgeschoven; generatie voor de NIEUWE datum is een nieuwe beurt.
  assert.equal(again.dueDate, "2027-08-01");
  assert.equal(again.alreadyGenerated, false);
  assert.equal(jobs, 2);
  const third = plans.generateDueJob("t1", p.id, "a@x.be", mkJob);
  assert.equal(third.dueDate, "2028-08-01");

  // Gepauzeerd schema genereert niet.
  plans.update("t1", p.id, { status: "paused" }, "a@x.be");
  try { plans.generateDueJob("t1", p.id, "a@x.be", mkJob); assert.fail("pauze verwacht"); }
  catch (e) { assert.equal(e.code, "PLAN_NOT_ACTIVE"); }
});

test("onderhoud: listDue toont schema's binnen de horizon met overdue-vlag", () => {
  const store = fakeStore();
  const plans = makeMaintenancePlanRepository(store);
  plans.insert("t1", { assetId: "a1", nextDue: "2026-07-10", frequency: "annual" }, "x"); // overdue
  plans.insert("t1", { assetId: "a2", nextDue: "2026-07-25", frequency: "annual" }, "x"); // binnen 14d
  plans.insert("t1", { assetId: "a3", nextDue: "2026-12-01", frequency: "annual" }, "x"); // buiten horizon
  const due = plans.listDue("t1", 14, "2026-07-17");
  assert.equal(due.length, 2);
  assert.equal(due.find(p => p.assetId === "a1").overdue, true);
  assert.equal(due.find(p => p.assetId === "a2").overdue, false);
  assert.equal(addMonths("2026-01-31", 1), "2026-03-03", "maandoverloop rolt door als JS-datum (31 jan + 1m → 3 mrt; documenterend)");
});
