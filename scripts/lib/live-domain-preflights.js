const { Store } = require("../../src/lib/store");
const { hashPassword } = require("../../src/lib/security");
const { createModuleRow, updateModuleRow } = require("../../src/modules/crud");
const { createInvoice } = require("../../src/modules/billing");
const { attachWorkorderPhoto, completeWorkorder, signWorkorder } = require("../../src/modules/mobile");
const { approveExpense, clockIn, clockOut, managementReport } = require("../../src/modules/operations");
const { securityHeaders } = require("../../src/lib/http");

class MemoryAdapter {
  constructor(data) {
    this.data = data;
  }

  load() {
    return JSON.parse(JSON.stringify(this.data));
  }

  save(data) {
    this.data = JSON.parse(JSON.stringify(data));
  }

  status() {
    return { adapter: "memory", mode: "test" };
  }
}

function capture(fn) {
  try {
    return { result: fn(), error: null };
  } catch (error) {
    return { result: null, error };
  }
}

function emptyData(id, name) {
  return {
    schemaVersion: 6,
    tenants: [{ id, name, plan: "business", status: "trial", invoiceProfile: { peppolId: "9908:BE0123456789" }, billingOps: { invoiceHistory: [] } }],
    users: [],
    roles: [],
    venues: [],
    customers: [],
    shifts: [],
    workorders: [],
    clocks: [],
    expenses: [],
    stock: [],
    vehicles: [],
    leaves: [],
    messages: [],
    notifications: [],
    integrations: [],
    invoices: [],
    paymentMethods: [],
    files: [],
    secrets: [],
    auditLogs: [],
    errorEvents: [],
    apiKeys: [],
    supportTickets: [],
    salesLeads: [],
    partners: [],
    migrationHistory: []
  };
}

function admin(id, tenantId, permissions) {
  return {
    id,
    tenantId,
    name: "Preflight Admin",
    email: `${id}@example.test`,
    passwordHash: hashPassword("AdminPassword123!"),
    role: "tenant_admin",
    permissions,
    mfaEnabled: true,
    mfaEnforced: true,
    mfaSecret: "preflight-mfa-enabled",
    active: true
  };
}

function gate(key, label, ok, detail, payload = {}) {
  return { key, label, ok: !!ok, detail, payload };
}

function securityGate() {
  const data = emptyData("t_security", "Security Test BV");
  data.users.push(admin("u_admin", "t_security", ["employees"]));
  const store = new Store(new MemoryAdapter(data));
  const actor = store.getUserByEmail("u_admin@example.test");
  const weakCreate = capture(() => createModuleRow(store, actor, "users", "t_security", {
    name: "Weak User",
    email: "weak@example.test",
    password: "Welkom123!",
    role: "field_worker"
  }));
  const headers = securityHeaders();
  return gate(
    "security",
    "Security hardening",
    weakCreate.error?.status === 400 && headers["X-Content-Type-Options"] === "nosniff" && headers["X-Frame-Options"] === "DENY",
    "Wachtwoordpolicy en security headers zijn actief.",
    { weakCreateStatus: weakCreate.error?.status || null }
  );
}

function planningGate() {
  const data = emptyData("t_planning", "Planning Test BV");
  data.users.push(admin("u_admin", "t_planning", ["planning"]));
  data.users.push({ id: "u_worker", tenantId: "t_planning", name: "Worker", email: "worker@example.test", passwordHash: hashPassword("Worker12345!"), role: "field_worker", permissions: [], active: true });
  data.venues.push({ id: "v_1", tenantId: "t_planning", name: "Werf" });
  const store = new Store(new MemoryAdapter(data));
  const actor = store.getUserByEmail("u_admin@example.test");
  createModuleRow(store, actor, "planning", "t_planning", { userId: "u_worker", venueId: "v_1", date: "2026-05-12", start: "08:00", end: "12:00" });
  const overlap = capture(() => createModuleRow(store, actor, "planning", "t_planning", { userId: "u_worker", venueId: "v_1", date: "2026-05-12", start: "11:00", end: "13:00" }));
  return gate("planning", "Planning conflict rules", overlap.error?.status === 409, "Overlappende planning wordt geblokkeerd.", { overlapStatus: overlap.error?.status || null });
}

function clockingGate() {
  const data = emptyData("t_clocking", "Clocking Test BV");
  data.users.push({ id: "u_worker", tenantId: "t_clocking", name: "Worker", email: "worker@example.test", passwordHash: hashPassword("Worker12345!"), role: "field_worker", permissions: ["clockings"], active: true });
  data.venues.push({ id: "v_1", tenantId: "t_clocking", name: "Werf" });
  data.shifts.push({ id: "shift_1", tenantId: "t_clocking", userId: "u_worker", venueId: "v_1", date: "2026-05-13", start: "08:00", end: "16:00" });
  const store = new Store(new MemoryAdapter(data));
  const tenant = store.get("tenants", "t_clocking");
  const actor = store.getUserByEmail("worker@example.test");
  const first = clockIn(store, tenant, { date: "2026-05-13", clockIn: "08:05" }, actor);
  const duplicate = capture(() => clockIn(store, tenant, { date: "2026-05-13", clockIn: "09:00" }, actor));
  const closed = clockOut(store, tenant, { date: "2026-05-13", clockOut: "16:10" }, actor);
  return gate("clocking", "Clocking rules", first.shiftId === "shift_1" && duplicate.error?.status === 409 && closed.status === "ready_for_approval", "Clocking koppelt aan planning en blokkeert dubbele actieve registraties.", { duplicateStatus: duplicate.error?.status || null });
}

function expensesGate() {
  const data = emptyData("t_expense", "Expense Test BV");
  data.users.push(admin("u_admin", "t_expense", ["expenses", "billing"]));
  data.users.push({ id: "u_worker", tenantId: "t_expense", name: "Worker", email: "worker@example.test", passwordHash: hashPassword("Worker12345!"), role: "field_worker", permissions: ["expenses"], active: true });
  const store = new Store(new MemoryAdapter(data));
  const tenant = store.get("tenants", "t_expense");
  const actor = store.getUserByEmail("u_admin@example.test");
  const worker = store.getUserByEmail("worker@example.test");
  const row = createModuleRow(store, worker, "expenses", tenant.id, { title: "Brandstof", category: "fuel", userId: "u_worker", amount: 67.456, vatRate: 21 });
  const blocked = capture(() => approveExpense(store, tenant, row.id, actor));
  const withReceipt = updateModuleRow(store, worker, "expenses", row.id, { receiptFileId: "file_1" });
  const approved = approveExpense(store, tenant, withReceipt.id, actor);
  return gate("expenses", "Expense approval rules", row.status === "needs_receipt" && blocked.error?.status === 422 && approved.status === "approved", "Onkostenpolicy blokkeert approval zonder bewijsstuk.", { blockedStatus: blocked.error?.status || null });
}

function workordersGate() {
  const data = emptyData("t_workorder", "Workorder Test BV");
  data.users.push({ id: "u_worker", tenantId: "t_workorder", name: "Worker", email: "worker@example.test", passwordHash: hashPassword("Worker12345!"), role: "field_worker", permissions: ["workorders"], active: true });
  data.workorders.push({ id: "wo_1", tenantId: "t_workorder", userId: "u_worker", title: "Werkbon", status: "Te starten", requiresPhoto: true, requiresSignature: true, checklistRequired: true, checklist: [{ id: "c_1", label: "Check", done: false }], billable: true, files: [] });
  const store = new Store(new MemoryAdapter(data));
  const tenant = store.get("tenants", "t_workorder");
  const actor = store.getUserByEmail("worker@example.test");
  const blocked = capture(() => completeWorkorder(store, tenant, "wo_1", { checklist: [{ id: "c_1", label: "Check", done: false }] }, actor));
  attachWorkorderPhoto(store, tenant, "wo_1", { type: "image/jpeg", size: 1000 }, actor);
  signWorkorder(store, tenant, "wo_1", { signerName: "Jan Klant" }, actor);
  const completed = completeWorkorder(store, tenant, "wo_1", { checklist: [{ id: "c_1", label: "Check", done: true }] }, actor);
  return gate("workorders", "Workorder completion rules", blocked.error?.status === 422 && completed.billableStatus === "ready_for_invoice", "Werkbon vereist checklist, bewijs en handtekening voor facturatie.", { blockedStatus: blocked.error?.status || null });
}

function invoicingGate() {
  const data = emptyData("t_invoice", "Invoice Test BV");
  data.users.push(admin("u_admin", "t_invoice", ["billing"]));
  data.workorders.push({ id: "wo_1", tenantId: "t_invoice", title: "Werkbon 1", status: "Voltooid", billableStatus: "ready_for_invoice", billableAmount: 450 });
  data.workorders.push({ id: "wo_2", tenantId: "t_invoice", title: "Werkbon 2", status: "Voltooid", billableStatus: "ready_for_invoice", billableHours: 2.5, hourlyRate: 80 });
  const store = new Store(new MemoryAdapter(data));
  const tenant = store.get("tenants", "t_invoice");
  const actor = store.getUserByEmail("u_admin@example.test");
  const result = createInvoice(store, tenant, { fromWorkorders: true, workorderIds: ["wo_1", "wo_2"] }, actor);
  const duplicate = capture(() => createInvoice(store, store.get("tenants", "t_invoice"), { fromWorkorders: true, workorderIds: ["wo_1", "wo_2"] }, actor));
  return gate("operational_invoicing", "Operational invoicing", result.invoice.gross === 650 && store.get("workorders", "wo_1").billableStatus === "invoiced" && duplicate.error?.status === 422, "Factuurconcept uit werkbonnen markeert bronnen als gefactureerd.", { invoiceId: result.invoice.id });
}

function runLiveDomainPreflights() {
  return [
    securityGate(),
    planningGate(),
    clockingGate(),
    expensesGate(),
    workordersGate(),
    invoicingGate()
  ];
}

module.exports = { runLiveDomainPreflights };
