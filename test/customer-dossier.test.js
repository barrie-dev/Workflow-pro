"use strict";
// Klant 360°-dossier (#76 · tweede ruggengraat). Kern: CRM + finance samen in
// één klantbeeld met een correct saldo (gefactureerd vs toegewezen betaald).
const { test } = require("node:test");
const assert = require("node:assert");
const { customerDossier } = require("../src/modules/customer-dossier");

function makeStore(cols) {
  const data = { ...cols };
  return { data, list(col, tenantId) { return (data[col] || []).filter(r => r.tenantId === tenantId); } };
}
const customer = { id: "c1", tenantId: "t1", name: "Keten Bouwheer" };

test("klant-dossier: bundelt sporen + berekent het saldo uit allocaties", () => {
  const store = makeStore({
    customers: [customer],
    projects: [{ id: "p1", tenantId: "t1", customerId: "c1", number: "P-1", createdAt: "2026-08-01T08:00:00Z" }],
    quotes: [{ id: "q1", tenantId: "t1", customerId: "c1", number: "OF-1", createdAt: "2026-08-02T08:00:00Z", acceptance: { at: "2026-08-03T08:00:00Z" } }],
    invoices: [
      { id: "inv1", tenantId: "t1", customerId: "c1", number: "F-1", total: 1210, invoiceDate: "2026-08-04" },
      { id: "inv2", tenantId: "t1", customerId: "c1", number: "F-2", total: 500, invoiceDate: "2026-08-05" },
    ],
    payments: [
      { id: "pay1", tenantId: "t1", customerId: "c1", paidOn: "2026-08-06", amount: 1210, allocations: [{ invoiceId: "inv1", amount: 1210, reversedAt: null }] },
      { id: "pay2", tenantId: "t1", paidOn: "2026-08-07", allocations: [{ invoiceId: "inv2", amount: 200, reversedAt: null }, { invoiceId: "inv2", amount: 50, reversedAt: "2026-08-08T00:00:00Z" }] },
    ],
    appointments: [], contracts: [], worksites: [],
  });
  const d = customerDossier(store, "t1", customer);
  assert.equal(d.counts.projects, 1);
  assert.equal(d.counts.invoices, 2);
  assert.equal(d.counts.payments, 2, "pay2 hangt via allocatie aan een klantfactuur");
  // Saldo: gefactureerd 1710, betaald 1210 + 200 (de teruggedraaide 50 telt niet) = 1410, open 300.
  assert.deepEqual(d.balance, { invoiced: 1710, paid: 1410, outstanding: 300 });
  // Tijdlijn over CRM + finance heen, nieuwste eerst.
  const times = d.timeline.map(e => e.at);
  for (let i = 1; i < times.length; i++) assert.ok(times[i - 1] >= times[i]);
  assert.ok(d.timeline.some(e => e.module === "invoices") && d.timeline.some(e => e.module === "payments") && d.timeline.some(e => e.module === "projects"));
});

test("klant-dossier: betaling van een ANDERE klant lekt niet binnen", () => {
  const store = makeStore({
    customers: [customer],
    invoices: [{ id: "inv1", tenantId: "t1", customerId: "c1", number: "F-1", total: 100 }],
    payments: [{ id: "payX", tenantId: "t1", customerId: "andere", allocations: [{ invoiceId: "vreemd", amount: 999, reversedAt: null }] }],
  });
  const d = customerDossier(store, "t1", customer);
  assert.equal(d.counts.payments, 0);
  assert.deepEqual(d.balance, { invoiced: 100, paid: 0, outstanding: 100 });
});
