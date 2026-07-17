"use strict";
// Projectfinance read-model (master-spec h23/E14): budget/actual/invoiced/marge.
const { test } = require("node:test");
const assert = require("node:assert");

const { buildProjectFinance } = require("../src/platform/project-finance");

function fakeStore(data = {}) {
  const d = { changeOrders: [], workorders: [], shifts: [], expenses: [], quotes: [], invoices: [], ...data };
  return { data: d, list(col, tid) { return (d[col] || []).filter(r => r.tenantId === tid); } };
}
const TENANT = { id: "t1", defaultHourlyRate: 50 };
const PROJECT = { id: "prj_1", number: "PRJ-2026-001", budgetAmount: 11210, financialStatus: "open" };

test("projectfinance: aggregatie over arbeid, materiaal, onkosten en facturen", () => {
  const store = fakeStore({
    changeOrders: [
      { id: "co1", tenantId: "t1", projectId: "prj_1", status: "accepted", total: 1210, number: "CO-2026-001" },
      { id: "co2", tenantId: "t1", projectId: "prj_1", status: "draft", total: 999 },   // telt niet mee
    ],
    shifts: [
      { id: "s1", tenantId: "t1", projectId: "prj_1", start: "08:00", end: "12:00" },                    // 4u
      { id: "s2", tenantId: "t1", projectId: "prj_1", start: "08:00", end: "10:00", assigneeIds: ["u2"] }, // 2u × 2 resources
      { id: "s3", tenantId: "t1", projectId: "ANDERS", start: "08:00", end: "18:00" },
    ],
    workorders: [
      { id: "wo1", tenantId: "t1", projectId: "prj_1", materials: [{ description: "Buizen", qty: 10, unitPrice: 20 }] },
    ],
    expenses: [
      { id: "e1", tenantId: "t1", workorderId: "wo1", status: "approved", amount: 75 },
      { id: "e2", tenantId: "t1", projectId: "prj_1", status: "goedgekeurd", amount: 25 },
      { id: "e3", tenantId: "t1", workorderId: "wo1", status: "ingediend", amount: 999 },  // niet goedgekeurd
    ],
    quotes: [{ id: "q1", tenantId: "t1", projectId: "prj_1" }],
    invoices: [
      { id: "i1", tenantId: "t1", quoteId: "q1", subtotal: 2000, total: 2420, status: "paid" },
      { id: "i2", tenantId: "t1", workorderId: "wo1", subtotal: 500, total: 605, status: "open" },
      { id: "cn1", tenantId: "t1", projectId: "prj_1", docType: "credit_note", subtotal: -100, total: -121, status: "open" },
      { id: "ix", tenantId: "t1", subtotal: 9999, status: "open" },   // niet gelinkt
    ],
  });

  const f = buildProjectFinance(store, TENANT, PROJECT);
  // Budget
  assert.equal(f.budget.total, 11210);
  assert.equal(f.budget.acceptedChangeTotal, 1210);
  assert.equal(f.budget.sources.length, 1);
  // Arbeid: 4u + 2u×2 = 8u × €50 = 400 (raming tegen tarief).
  assert.equal(f.actual.labor.hours, 8);
  assert.equal(f.actual.labor.cost, 400);
  assert.equal(f.actual.labor.basis, "rate_estimate");
  // Materiaal 200 + onkosten 100 (alleen goedgekeurd).
  assert.equal(f.actual.material.cost, 200);
  assert.equal(f.actual.expenses.cost, 100);
  assert.equal(f.actual.total, 700);
  // Gefactureerd: 2000 + 500 - 100 = 2400 (excl. btw · creditnota negatief).
  assert.equal(f.invoiced.total, 2400);
  assert.equal(f.invoiced.paid, 2000);
  // Marge en resterend budget.
  assert.equal(f.margin, 1700);
  assert.equal(f.budgetRemaining, 10510);
});

test("projectfinance: leeg project geeft nullen zonder fouten", () => {
  const f = buildProjectFinance(fakeStore(), { id: "t1" }, { id: "prj_x", budgetAmount: null });
  assert.equal(f.actual.total, 0);
  assert.equal(f.invoiced.total, 0);
  assert.equal(f.margin, 0);
  assert.equal(f.budget.total, 0);
});
