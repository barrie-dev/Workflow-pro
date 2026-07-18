"use strict";
// Mona Signals (master-spec h48/E21): detectie + rechten-scoping.
const { test } = require("node:test");
const assert = require("node:assert");

const { buildMonaSignals } = require("../src/platform/mona-signals");

// Store met enterprise-bundel zodat isModuleEnabled alles aanzet.
function fakeStore(data = {}) {
  const d = { bundles: [], workorders: [], quotes: [], invoices: [], projects: [], shifts: [], appointments: [], stock: [], changeOrders: [], expenses: [], postedWorkers: [], incidents: [], worksites: [], purchaseOrders: [], ...data };
  return {
    data: d,
    list(col, tid) { return tid == null ? (d[col] || []) : (d[col] || []).filter(r => r.tenantId === tid); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },   // bundle-seeding via isModuleEnabled
    update(col, id, patch) { d[col] = (d[col] || []).map(r => r.id === id ? { ...r, ...patch } : r); return (d[col] || []).find(r => r.id === id); },
    save() {},
  };
}
const TENANT = { id: "t1", plan: "enterprise" };
const ADMIN = { id: "u1", tenantId: "t1", role: "tenant_admin", permissions: ["*"] };

test("signals: facturatie-lekkage bij afgewerkte werkbon en aanvaarde offerte", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const store = fakeStore({
    workorders: [
      { id: "wo1", tenantId: "t1", number: "WO-2026-001", title: "Dak", status: "voltooid", billableAmount: 500 },
      { id: "wo2", tenantId: "t1", status: "voltooid", invoiceId: "inv_x", billableAmount: 500 }, // al gefactureerd
      { id: "wo3", tenantId: "t1", status: "open", billableAmount: 500 },                          // niet af
    ],
    quotes: [{ id: "q1", tenantId: "t1", number: "OFF-2026-001", status: "aanvaard", total: 1000 }],
  });
  const sig = buildMonaSignals(store, TENANT, ADMIN, now);
  const leak = sig.signals.filter(s => s.type === "invoice_leakage");
  assert.equal(leak.length, 2, "afgewerkte niet-gefactureerde werkbon + aanvaarde offerte");
  assert.ok(leak.some(s => s.refId === "wo1"));
  assert.ok(leak.some(s => s.refId === "q1"));
});

test("signals: vervallen factuur is kritiek", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const store = fakeStore({ invoices: [
    { id: "i1", tenantId: "t1", number: "2026-001", total: 1210, status: "open", dueDate: "2026-06-01" },
    { id: "i2", tenantId: "t1", number: "2026-002", total: 500, status: "open", dueDate: "2026-12-01" },  // niet vervallen
    { id: "i3", tenantId: "t1", number: "2026-003", total: 100, status: "paid", dueDate: "2026-01-01" },  // betaald
  ] });
  const sig = buildMonaSignals(store, TENANT, ADMIN, now);
  const overdue = sig.signals.filter(s => s.type === "overdue_invoice");
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].severity, "critical");
  assert.equal(overdue[0].refId, "i1");
});

test("signals: planningsconflict bij overlap zelfde resource", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const store = fakeStore({ shifts: [
    { id: "s1", tenantId: "t1", userId: "u9", date: "2026-08-01", start: "08:00", end: "12:00" },
    { id: "s2", tenantId: "t1", userId: "u9", date: "2026-08-01", start: "10:00", end: "14:00" },
    { id: "s3", tenantId: "t1", userId: "u8", date: "2026-08-01", start: "10:00", end: "14:00" }, // andere resource
  ] });
  const sig = buildMonaSignals(store, TENANT, ADMIN, now);
  const conflicts = sig.signals.filter(s => s.type === "planning_conflict");
  assert.equal(conflicts.length, 1);
});

test("signals: margerisico bij (bijna) budgetoverschrijding", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const store = fakeStore({
    projects: [
      { id: "p1", tenantId: "t1", number: "PRJ-2026-001", status: "active", budgetAmount: 1000 },
    ],
    // Arbeid via shifts × tarief zou kosten geven; simuleer via approved expenses.
    expenses: [{ id: "e1", tenantId: "t1", projectId: "p1", status: "approved", amount: 1100 }],
  });
  const sig = buildMonaSignals(store, TENANT, ADMIN, now);
  const risk = sig.signals.filter(s => s.type === "margin_risk");
  assert.equal(risk.length, 1);
  assert.equal(risk[0].severity, "critical", "forecast > budget");
});

test("signals: rechten-scoping · medewerker ziet geen admin-signalen", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const store = fakeStore({
    invoices: [{ id: "i1", tenantId: "t1", total: 100, status: "open", dueDate: "2026-01-01" }],
    projects: [{ id: "p1", tenantId: "t1", status: "active", budgetAmount: 100 }],
    expenses: [{ id: "e1", tenantId: "t1", projectId: "p1", status: "approved", amount: 200 }],
  });
  const employee = { id: "u2", tenantId: "t1", role: "employee", permissions: ["own:clockings", "own:workorders"] };
  const sig = buildMonaSignals(store, TENANT, employee, now);
  assert.equal(sig.signals.filter(s => s.type === "overdue_invoice").length, 0, "geen billing-recht → geen factuur-signalen");
  assert.equal(sig.signals.filter(s => s.type === "margin_risk").length, 0, "geen projects-admin → geen margerisico");
});

test("signals: gesorteerd op ernst + counts kloppen", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const store = fakeStore({
    invoices: [{ id: "i1", tenantId: "t1", total: 100, status: "open", dueDate: "2026-01-01" }],  // critical
    quotes: [{ id: "q1", tenantId: "t1", status: "aanvaard", total: 50 }],                          // info
  });
  const sig = buildMonaSignals(store, TENANT, ADMIN, now);
  assert.equal(sig.signals[0].severity, "critical", "kritiek eerst");
  assert.equal(sig.counts.total, sig.signals.length);
  assert.ok(sig.counts.critical >= 1);
});
