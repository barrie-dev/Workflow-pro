"use strict";
// Project 360°-dossier (#76 · module-samenhang). Kern: alle modulesporen van een
// project komen samen in één dossier + één chronologische tijdlijn, en
// betalingen worden via factuur-allocaties correct aan het project gekoppeld.
const { test } = require("node:test");
const assert = require("node:assert");
const { projectDossier } = require("../src/modules/project-dossier");

function makeStore(cols) {
  const data = { ...cols };
  return { data, list(col, tenantId) { return (data[col] || []).filter(r => r.tenantId === tenantId); } };
}

const project = { id: "prj1", tenantId: "t1", number: "P-2026-001", name: "Keten", createdAt: "2026-08-01T08:00:00Z" };

test("dossier: bundelt modulesporen + koppelt betaling via factuur-allocatie", () => {
  const store = makeStore({
    projects: [project],
    quotes: [{ id: "q1", tenantId: "t1", projectId: "prj1", number: "OF-1", createdAt: "2026-08-02T09:00:00Z", sentAt: "2026-08-02T10:00:00Z", acceptance: { at: "2026-08-03T11:00:00Z", name: "Jan" }, status: "aanvaard" }],
    invoices: [{ id: "inv1", tenantId: "t1", projectId: "prj1", number: "F-1", invoiceDate: "2026-08-04", total: 1210, status: "final" }],
    workorders: [{ id: "wo1", tenantId: "t1", projectId: "prj1", number: "WO-1", createdAt: "2026-08-05T08:00:00Z", approvedAt: "2026-08-05T16:00:00Z", status: "approved" }],
    // Betaling zonder projectId, maar toegewezen aan factuur F-1 → moet meetellen.
    payments: [{ id: "pay1", tenantId: "t1", paidOn: "2026-08-06", allocations: [{ invoiceId: "inv1", amount: 1210, reversedAt: null }] }],
    // Een betaling voor een ANDER project mag NIET meetellen.
    changeOrders: [], worksites: [], shifts: [], progressClaims: [], appointments: [], incidents: [], expenses: [],
  });
  // Ruis: betaling toegewezen aan een onbekende factuur.
  store.data.payments.push({ id: "pay2", tenantId: "t1", allocations: [{ invoiceId: "other", amount: 5, reversedAt: null }] });

  const d = projectDossier(store, "t1", project, { finance: { budget: { total: 5000 } } });
  assert.equal(d.counts.quotes, 1);
  assert.equal(d.counts.invoices, 1);
  assert.equal(d.counts.workorders, 1);
  assert.equal(d.counts.payments, 1, "enkel de betaling toegewezen aan een projectfactuur telt mee");
  assert.equal(d.finance.budget.total, 5000, "financiele samenvatting reist mee als toegestaan");

  // Tijdlijn: chronologisch (nieuwste eerst) en over de modules heen.
  const modules = d.timeline.map(e => e.module);
  assert.ok(modules.includes("quotes") && modules.includes("invoices") && modules.includes("payments") && modules.includes("workorders"));
  const times = d.timeline.map(e => e.at);
  for (let i = 1; i < times.length; i++) assert.ok(times[i - 1] >= times[i], "tijdlijn is aflopend gesorteerd");
  // De quote-acceptatie en werkbon-goedkeuring verschijnen als aparte events.
  assert.ok(d.timeline.some(e => e.type === "quote.accepted" && e.by === "Jan"));
  assert.ok(d.timeline.some(e => e.type === "workorder.approved"));
});

test("dossier: teruggedraaide allocatie koppelt de betaling NIET aan het project", () => {
  const store = makeStore({
    projects: [project],
    invoices: [{ id: "inv1", tenantId: "t1", projectId: "prj1", number: "F-1", total: 100 }],
    payments: [{ id: "pay1", tenantId: "t1", allocations: [{ invoiceId: "inv1", amount: 100, reversedAt: "2026-08-07T00:00:00Z" }] }],
  });
  const d = projectDossier(store, "t1", project, {});
  assert.equal(d.counts.payments, 0, "een teruggedraaide toewijzing telt niet");
  assert.equal(d.finance, null, "geen financiele samenvatting als niet toegestaan");
});

test("dossier: leeg project geeft nultellingen en enkel het 'aangemaakt'-event", () => {
  const store = makeStore({ projects: [project] });
  const d = projectDossier(store, "t1", project, {});
  assert.equal(d.counts.quotes, 0);
  assert.equal(d.counts.invoices, 0);
  assert.equal(d.timeline.length, 1);
  assert.equal(d.timeline[0].type, "project.created");
});
