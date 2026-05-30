const { Store } = require("../src/lib/store");
const { hashPassword } = require("../src/lib/security");
const { createModuleRow, updateModuleRow } = require("../src/modules/crud");
const { approveExpense, managementReport } = require("../src/modules/operations");

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

function baseData() {
  return {
    schemaVersion: 6,
    tenants: [{ id: "t_expense", name: "Expense Test BV", plan: "business", status: "trial" }],
    users: [
      {
        id: "u_admin",
        tenantId: "t_expense",
        name: "Finance Admin",
        email: "finance.admin@example.test",
        passwordHash: hashPassword("admin123"),
        role: "tenant_admin",
        permissions: ["expenses", "billing"],
        active: true
      },
      {
        id: "u_worker",
        tenantId: "t_expense",
        name: "Sofie Janssens",
        email: "sofie@example.test",
        passwordHash: hashPassword("worker123"),
        role: "field_worker",
        permissions: ["expenses"],
        active: true
      }
    ],
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

function capture(fn) {
  try {
    return { result: fn(), error: null };
  } catch (error) {
    return { result: null, error };
  }
}

const jsonMode = process.argv.includes("--json");
const store = new Store(new MemoryAdapter(baseData()));
const tenant = store.get("tenants", "t_expense");
const admin = store.getUserByEmail("finance.admin@example.test");
const worker = store.getUserByEmail("sofie@example.test");

const missingReceipt = createModuleRow(store, worker, "expenses", tenant.id, {
  title: "Brandstof",
  category: "fuel",
  userId: "u_worker",
  amount: 67.456,
  vatRate: 21
});
const blockedMissingReceipt = capture(() => approveExpense(store, tenant, missingReceipt.id, admin));
const withReceipt = updateModuleRow(store, worker, "expenses", missingReceipt.id, { receiptFileId: "file_receipt_1" });
const selfApproval = capture(() => approveExpense(store, tenant, withReceipt.id, worker));
const approved = approveExpense(store, tenant, withReceipt.id, admin);
const duplicateApproval = capture(() => approveExpense(store, tenant, withReceipt.id, admin));
const crudApprovalBypass = capture(() => createModuleRow(store, worker, "expenses", tenant.id, {
  title: "Materiaal",
  category: "material",
  userId: "u_worker",
  amount: 42,
  receiptFileId: "file_receipt_2",
  status: "approved"
}));
const highAmount = createModuleRow(store, worker, "expenses", tenant.id, {
  title: "Onderaannemer",
  category: "subcontractor",
  userId: "u_worker",
  amount: 750,
  receiptFileId: "file_receipt_3"
});
const report = managementReport(store, tenant.id);

const payload = {
  ok:
    missingReceipt.status === "needs_receipt" &&
    missingReceipt.amount === 67.46 &&
    blockedMissingReceipt.error?.status === 422 &&
    withReceipt.status === "submitted" &&
    selfApproval.error?.status === 403 &&
    approved.status === "approved" &&
    duplicateApproval.error?.status === 409 &&
    crudApprovalBypass.error?.status === 409 &&
    highAmount.requiresFinanceReview === true &&
    report.expenses.counts.needsFinanceReview >= 1,
  missingReceiptStatus: missingReceipt.status,
  normalizedAmount: missingReceipt.amount,
  blockedMissingReceiptStatus: blockedMissingReceipt.error?.status || null,
  selfApprovalStatus: selfApproval.error?.status || null,
  approvedStatus: approved.status,
  duplicateApprovalStatus: duplicateApproval.error?.status || null,
  crudApprovalBypassStatus: crudApprovalBypass.error?.status || null,
  highAmountRequiresFinanceReview: highAmount.requiresFinanceReview,
  expenses: report.expenses
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.ok ? 0 : 1);
}

console.log("WorkFlow Pro expense rules preflight");
console.log(`Receipt policy toegepast: ${missingReceipt.status === "needs_receipt" ? "yes" : "no"}`);
console.log(`Approval zonder bon geblokkeerd: ${blockedMissingReceipt.error?.status === 422 ? "yes" : "no"}`);
console.log(`Self-approval geblokkeerd: ${selfApproval.error?.status === 403 ? "yes" : "no"}`);
console.log(`CRUD approval bypass geblokkeerd: ${crudApprovalBypass.error?.status === 409 ? "yes" : "no"}`);
console.log(`Finance review vlag toegepast: ${highAmount.requiresFinanceReview ? "yes" : "no"}`);

if (!payload.ok) {
  console.error("Expense rules check faalt: onkostenlogica werkt niet correct.");
  process.exit(1);
}

console.log("\nExpense rules OK.");
