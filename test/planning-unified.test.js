"use strict";
// Unified planning read-model (master-spec h24/E06): merge shifts + afspraken.
const { test } = require("node:test");
const assert = require("node:assert");

const { shiftToPlanningItem, appointmentToPlanningItem, listPlanningItems, planningOverlap, PLANNING_STATUSES } = require("../src/platform/planning");

function fakeStore(shifts = [], appointments = []) {
  const data = { shifts, appointments };
  return { data, list(col, tid) { return (data[col] || []).filter(r => r.tenantId === tid); } };
}

test("planning: shiftToPlanningItem exposeert multi-resource", () => {
  const item = shiftToPlanningItem({ id: "s1", tenantId: "t1", userId: "u1", assigneeIds: ["u2", "u1"], date: "2026-08-01", start: "08:00", end: "12:00", venueId: "v1", workorderId: "wo1", note: "Montage" });
  assert.equal(item.source, "shift");
  assert.deepEqual(item.resourceIds, ["u1", "u2"], "primair + assignees, gededupliceerd");
  assert.equal(item.primaryResourceId, "u1");
  assert.equal(item.jobId, "wo1");
  assert.equal(item.title, "Montage");
  assert.equal(item.status, "confirmed");
});

test("planning: appointmentToPlanningItem mapt status naar canoniek", () => {
  assert.equal(appointmentToPlanningItem({ id: "a1", status: "uitgevoerd", date: "2026-08-01", start: "09:00", end: "10:00", customerName: "Bouw NV" }).status, "done");
  assert.equal(appointmentToPlanningItem({ id: "a2", status: "geannuleerd" }).status, "cancelled");
  const it = appointmentToPlanningItem({ id: "a3", status: "gepland", customerName: "X" });
  assert.equal(it.source, "appointment");
  assert.equal(it.status, "confirmed");
  assert.deepEqual(it.resourceIds, []);
  assert.ok(PLANNING_STATUSES.includes(it.status));
});

test("planning: listPlanningItems mergt en sorteert, met filters", () => {
  const store = fakeStore(
    [
      { id: "s1", tenantId: "t1", userId: "u1", date: "2026-08-02", start: "08:00", end: "12:00", workorderId: "wo1" },
      { id: "s2", tenantId: "t1", userId: "u2", date: "2026-08-01", start: "13:00", end: "17:00" },
    ],
    [
      { id: "a1", tenantId: "t1", status: "gepland", date: "2026-08-01", start: "09:00", end: "10:00", customerName: "K" },
      { id: "a2", tenantId: "ANDERE", status: "gepland", date: "2026-08-01", start: "09:00", customerName: "X" },
    ]
  );
  const all = listPlanningItems(store, "t1");
  assert.equal(all.length, 3, "shifts + afspraken van t1, niet van andere tenant");
  assert.deepEqual(all.map(i => i.id), ["a1", "s2", "s1"], "gesorteerd op datum+start");

  assert.equal(listPlanningItems(store, "t1", { from: "2026-08-02", to: "2026-08-02" }).length, 1);
  assert.equal(listPlanningItems(store, "t1", { resourceId: "u1" }).length, 1);
  assert.equal(listPlanningItems(store, "t1", { jobId: "wo1" })[0].id, "s1");
});

test("planning: planningOverlap detecteert conflict per resource, appartementen tellen niet mee", () => {
  const store = fakeStore(
    [{ id: "s1", tenantId: "t1", userId: "u1", assigneeIds: ["u2"], date: "2026-08-01", start: "08:00", end: "12:00" }],
    [{ id: "a1", tenantId: "t1", status: "gepland", date: "2026-08-01", start: "09:00", end: "10:00", customerName: "K" }]
  );
  // u1 overlapt 10-14 met s1 (08-12).
  assert.ok(planningOverlap(store, "t1", "u1", "2026-08-01", "10:00", "14:00", null));
  // u2 (assignee) overlapt ook.
  assert.ok(planningOverlap(store, "t1", "u2", "2026-08-01", "11:00", "13:00", null));
  // u3 heeft geen planning → geen conflict.
  assert.equal(planningOverlap(store, "t1", "u3", "2026-08-01", "10:00", "14:00", null), null);
  // Aansluitend (12-14 na 08-12) → geen overlap.
  assert.equal(planningOverlap(store, "t1", "u1", "2026-08-01", "12:00", "14:00", null), null);
  // excludeId sluit het eigen item uit (bij bewerken).
  assert.equal(planningOverlap(store, "t1", "u1", "2026-08-01", "08:00", "12:00", "s1"), null);
  // Een afspraak veroorzaakt geen resourceconflict (geen resourceIds).
  assert.equal(planningOverlap(store, "t1", "a1", "2026-08-01", "09:00", "10:00", null), null);
});
