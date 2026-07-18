"use strict";
// Work Inbox (master-spec E09/GRID): consolidatie + rechten-scoping + prioriteit.
const { test } = require("node:test");
const assert = require("node:assert");

const { buildWorkInbox } = require("../src/platform/work-inbox");

function fakeStore(data = {}) {
  const d = { bundles: [], notifications: [], leaves: [], expenses: [], purchaseOrders: [], inquiries: [], workorders: [], quotes: [], invoices: [], projects: [], shifts: [], stock: [], changeOrders: [], postedWorkers: [], incidents: [], worksites: [], ...data };
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

test("work-inbox: consolideert goedkeuringen, klantvragen en achterstallige werkbonnen", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const store = fakeStore({
    leaves: [{ id: "l1", tenantId: "t1", status: "aangevraagd", userName: "Jan", startDate: "2026-08-01" }],
    expenses: [{ id: "e1", tenantId: "t1", status: "ingediend", userName: "An", amount: 45, category: "materiaal" }],
    purchaseOrders: [{ id: "po1", tenantId: "t1", number: "PO-2026-001", status: "for_approval", lines: [{ orderedQty: 10, unitPrice: 5 }] }],
    inquiries: [{ id: "q1", tenantId: "t1", status: "nieuw", fromName: "Klant", subject: "Vraag" }],
    workorders: [{ id: "wo1", tenantId: "t1", number: "WO-2026-001", status: "open", date: "2026-07-01" }],
  });
  const inbox = buildWorkInbox(store, TENANT, ADMIN, now);
  const types = inbox.items.map(i => i.type);
  assert.ok(types.includes("leave_approval"));
  assert.ok(types.includes("expense_approval"));
  assert.ok(types.includes("po_approval"));
  assert.ok(types.includes("inquiry"));
  assert.ok(types.includes("overdue_workorder"));
  // Elk item genormaliseerd met acties.
  const leave = inbox.items.find(i => i.type === "leave_approval");
  assert.deepEqual(leave.actions, ["approve", "reject"]);
  assert.equal(leave.targetView, "leaves");
});

test("work-inbox: kritieke signals krijgen prioriteit vooraan", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const store = fakeStore({
    invoices: [{ id: "i1", tenantId: "t1", number: "2026-001", total: 1000, status: "open", dueDate: "2026-01-01" }], // vervallen = kritiek
    inquiries: [{ id: "q1", tenantId: "t1", status: "nieuw", subject: "X" }],
  });
  const inbox = buildWorkInbox(store, TENANT, ADMIN, now);
  assert.equal(inbox.items[0].priority, "critical", "kritiek eerst");
  assert.ok(inbox.items[0].type.startsWith("signal_"));
  assert.equal(inbox.counts.total, inbox.items.length);
});

test("work-inbox: rechten-scoping · medewerker ziet geen admin-goedkeuringen", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const store = fakeStore({
    leaves: [{ id: "l1", tenantId: "t1", status: "aangevraagd", userName: "Jan" }],
    expenses: [{ id: "e1", tenantId: "t1", status: "ingediend", amount: 45 }],
    notifications: [{ id: "n1", tenantId: "t1", audience: "u2", title: "Voor jou", body: "hoi" }],
  });
  const employee = { id: "u2", tenantId: "t1", role: "employee", permissions: ["own:leaves", "own:expenses"] };
  const inbox = buildWorkInbox(store, TENANT, employee, now);
  assert.equal(inbox.items.filter(i => i.type === "leave_approval").length, 0);
  assert.equal(inbox.items.filter(i => i.type === "expense_approval").length, 0);
  // Eigen notificatie ziet hij wel.
  assert.ok(inbox.items.some(i => i.type === "notification" && i.refId === "n1"));
});

test("work-inbox: notificatie voor admins alleen voor beheerders + al gelezen wordt overgeslagen", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const store = fakeStore({
    notifications: [
      { id: "n1", tenantId: "t1", audience: "admins", title: "Admin-melding" },
      { id: "n2", tenantId: "t1", audience: "admins", title: "Gelezen", readAt: "2026-07-16T10:00:00Z" },
    ],
  });
  const admin = buildWorkInbox(store, TENANT, ADMIN, now);
  assert.ok(admin.items.some(i => i.refId === "n1"));
  assert.ok(!admin.items.some(i => i.refId === "n2"), "gelezen melding niet in inbox");
  const emp = buildWorkInbox(store, TENANT, { id: "u2", tenantId: "t1", role: "employee", permissions: [] }, now);
  assert.ok(!emp.items.some(i => i.refId === "n1"), "admin-melding niet voor medewerker");
});
