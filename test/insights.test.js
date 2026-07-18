"use strict";
// Insights read-models (master-spec h40/E22): KPI's met formule/bron + scoping.
const { test } = require("node:test");
const assert = require("node:assert");

const { buildInsights } = require("../src/platform/insights");

function fakeStore(data = {}) {
  const d = { bundles: [], invoices: [], quotes: [], projects: [], users: [], workorders: [], shifts: [], stock: [], changeOrders: [], expenses: [], purchaseOrders: [], postedWorkers: [], incidents: [], worksites: [], appointments: [], inquiries: [], notifications: [], ...data };
  return {
    data: d,
    list(col, tid) { return tid == null ? (d[col] || []) : (d[col] || []).filter(r => r.tenantId === tid); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    update(col, id, patch) { d[col] = (d[col] || []).map(r => r.id === id ? { ...r, ...patch } : r); return (d[col] || []).find(r => r.id === id); },
    save() {},
  };
}
const TENANT = { id: "t1", plan: "enterprise" };
const ADMIN = { id: "u1", tenantId: "t1", role: "tenant_admin", permissions: ["*"] };

test("insights: elke KPI draagt formule en bron (herleidbaarheid)", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const store = fakeStore({
    invoices: [
      { id: "i1", tenantId: "t1", number: "2026-001", total: 1210, status: "open", dueDate: "2026-06-01", invoiceDate: "2026-05-01" },
      { id: "i2", tenantId: "t1", number: "2026-002", total: 605, status: "paid", subtotal: 500, invoiceDate: "2026-04-01" },
    ],
    quotes: [{ id: "q1", tenantId: "t1", total: 5000, status: "verzonden" }, { id: "q2", tenantId: "t1", total: 2000, status: "aanvaard" }],
    users: [{ id: "u1", tenantId: "t1", role: "tenant_admin" }, { id: "u2", tenantId: "t1", role: "employee" }],
  });
  const ins = buildInsights(store, TENANT, ADMIN, now);
  assert.ok(ins.kpis.length > 0);
  for (const k of ins.kpis) {
    assert.ok(k.formula && k.formula.length > 3, `KPI ${k.key} heeft een formule`);
    assert.ok(k.source, `KPI ${k.key} heeft een bron`);
  }
  const open = ins.kpis.find(k => k.key === "open_invoices_amount");
  assert.equal(open.value, 1210);
  assert.ok(Array.isArray(open.drilldown) && open.drilldown[0].number === "2026-001", "drill-down naar bronrecords");
  const overdue = ins.kpis.find(k => k.key === "overdue_invoices_amount");
  assert.equal(overdue.value, 1210, "vervallen = open met dueDate < vandaag");
  const rev = ins.kpis.find(k => k.key === "revenue_ytd");
  assert.equal(rev.value, 500, "omzet = subtotaal betaalde facturen dit jaar");
  const pipe = ins.kpis.find(k => k.key === "pipeline_open_value");
  assert.equal(pipe.value, 5000);
  const won = ins.kpis.find(k => k.key === "quotes_won_value");
  assert.equal(won.value, 2000);
  assert.equal(ins.consistency, "eventual");
});

test("insights: projectmarge aggregeert per project met drill-down", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const store = fakeStore({
    projects: [{ id: "p1", tenantId: "t1", number: "PRJ-2026-001", name: "Nieuwbouw", status: "active", budgetAmount: 10000 }],
    quotes: [{ id: "q1", tenantId: "t1", projectId: "p1" }],
    invoices: [{ id: "i1", tenantId: "t1", quoteId: "q1", subtotal: 8000, total: 9680, status: "open" }],
    expenses: [{ id: "e1", tenantId: "t1", projectId: "p1", status: "approved", amount: 2000 }],
  });
  const ins = buildInsights(store, TENANT, ADMIN, now);
  const margin = ins.kpis.find(k => k.key === "project_margin_total");
  assert.equal(margin.value, 6000, "8000 gefactureerd − 2000 kost");
  assert.equal(ins.projectMargins.length, 1);
  assert.equal(ins.projectMargins[0].margin, 6000);
  assert.equal(ins.projectMargins[0].number, "PRJ-2026-001");
});

test("insights: rechten-scoping · medewerker ziet geen financiële KPI's", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const store = fakeStore({
    invoices: [{ id: "i1", tenantId: "t1", total: 1000, status: "open", dueDate: "2026-01-01" }],
    projects: [{ id: "p1", tenantId: "t1", status: "active", budgetAmount: 100 }],
  });
  const employee = { id: "u2", tenantId: "t1", role: "employee", permissions: ["own:workorders"] };
  const ins = buildInsights(store, TENANT, employee, now);
  assert.equal(ins.kpis.find(k => k.key === "open_invoices_amount"), undefined, "geen billing-recht → geen financiële KPI");
  assert.equal(ins.kpis.find(k => k.key === "project_margin_total"), undefined, "geen admin → geen marge");
  assert.deepEqual(ins.projectMargins, [], "geen projectmarges voor niet-beheerder");
  // Wel de exceptions-KPI (algemeen).
  assert.ok(ins.kpis.some(k => k.key === "open_exceptions"));
});
