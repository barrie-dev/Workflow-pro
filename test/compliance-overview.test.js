"use strict";
// Compliance-overzicht (master-spec h43.5): aggregatie over A1, CIAW en incidenten.
const { test } = require("node:test");
const assert = require("node:assert");

const { buildComplianceOverview, COMPLIANCE_STATES } = require("../src/platform/compliance");

// Store met bundels zodat isModuleEnabled echt werkt (enterprise = alles).
function fakeStore(data = {}) {
  const d = { bundles: [], tenants: [], postedWorkers: [], clocks: [], incidents: [], worksites: [], ...data };
  return {
    data: d,
    list(col, tid) { return (d[col] || []).filter(r => r.tenantId === tid); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    update() {}, save() {}, audit() {},
  };
}
const TENANT = { id: "t1", plan: "enterprise", compliance: { rszEmployerId: "123456789" } };

test("compliance: telt A1-statussen en verzamelt aandachtspunten", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const store = fakeStore({ postedWorkers: [
    { id: "pw1", tenantId: "t1", workerName: "Jan", documentRef: "doc", validTo: "2027-01-01" },   // valid
    { id: "pw2", tenantId: "t1", workerName: "Piotr", documentRef: "doc", validTo: "2026-07-30" }, // expiring (<30d)
    { id: "pw3", tenantId: "t1", workerName: "Marek", documentRef: "doc", validTo: "2026-01-01" }, // expired
    { id: "pw4", tenantId: "t1", workerName: "Zonder", documentRef: null },                        // missing
  ] });
  const ov = buildComplianceOverview(store, TENANT, now);
  const a1 = ov.categories.find(c => c.key === "posted_workers");
  assert.equal(a1.enabled, true);
  assert.equal(a1.counts.valid, 1);
  assert.equal(a1.counts.expiring, 1);
  assert.equal(a1.counts.expired, 1);
  assert.equal(a1.counts.missing, 1);
  assert.equal(a1.attention.length, 3, "expiring+expired+missing vragen actie");
  assert.ok(a1.attention.every(x => COMPLIANCE_STATES.includes(x.status)));
});

test("compliance: CIAW-configuratie en mislukte aangiftes", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  // Zonder RSZ-nummer → missing.
  const store1 = fakeStore();
  const ov1 = buildComplianceOverview(store1, { id: "t1", plan: "enterprise" }, now);
  const ciaw1 = ov1.categories.find(c => c.key === "ciaw");
  assert.equal(ciaw1.counts.missing, 1);
  assert.equal(ciaw1.attention[0].type, "ciaw_config");

  // Met RSZ + één mislukte aangifte → valid config + rejected.
  const store2 = fakeStore({ clocks: [
    { id: "c1", tenantId: "t1", date: "2026-07-16", ciaw: { status: "failed", error: "timeout" } },
    { id: "c2", tenantId: "t1", date: "2026-07-16", ciaw: { status: "ok", reference: "REF1" } },
  ] });
  const ov2 = buildComplianceOverview(store2, TENANT, now);
  const ciaw2 = ov2.categories.find(c => c.key === "ciaw");
  assert.equal(ciaw2.counts.valid, 1);
  assert.equal(ciaw2.counts.rejected, 1);
  assert.equal(ciaw2.attention.find(a => a.type === "ciaw_declaration").id, "c1");
});

test("compliance: incidenten mappen op deadline-status", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const store = fakeStore({ incidents: [
    { id: "i1", tenantId: "t1", date: "2026-07-16", severity: "licht", insurerReportedAt: "2026-07-17" }, // valid (gemeld)
    { id: "i2", tenantId: "t1", date: "2026-07-16", severity: "ernstig", insurerReportedAt: null },      // pending (7d over)
    { id: "i3", tenantId: "t1", date: "2026-07-01", severity: "licht", insurerReportedAt: null },        // expired (te laat)
  ] });
  const ov = buildComplianceOverview(store, TENANT, now);
  const inc = ov.categories.find(c => c.key === "incidents");
  assert.equal(inc.counts.valid, 1);
  assert.equal(inc.counts.pending, 1);
  assert.equal(inc.counts.expired, 1);
  assert.ok(inc.attention.some(a => a.id === "i3" && a.status === "expired"));
});

test("compliance: modules buiten het pakket tellen niet mee + werven-context", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const starterTenant = { id: "t1", plan: "starter" };   // geen ciaw/posted_workers
  const store = fakeStore({ worksites: [
    { id: "w1", tenantId: "t1", status: "active" },
    { id: "w2", tenantId: "t1", status: "closed" },
  ] });
  const ov = buildComplianceOverview(store, starterTenant, now);
  assert.equal(ov.categories.find(c => c.key === "posted_workers").enabled, false);
  assert.equal(ov.categories.find(c => c.key === "ciaw").enabled, false);
  assert.equal(ov.activeWorksites, 1);
  assert.ok(ov.generatedAt.includes("T"));
});
