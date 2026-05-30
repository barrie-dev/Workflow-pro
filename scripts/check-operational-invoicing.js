const { Store } = require("../src/lib/store");
const { hashPassword } = require("../src/lib/security");
const { createInvoice } = require("../src/modules/billing");

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
    tenants: [{
      id: "t_invoice",
      name: "Invoice Test BV",
      plan: "business",
      status: "trial",
      invoiceProfile: { peppolId: "9908:BE0123456789" },
      billingOps: { invoiceHistory: [] }
    }],
    users: [{
      id: "u_admin",
      tenantId: "t_invoice",
      name: "Finance Admin",
      email: "finance.admin@example.test",
      passwordHash: hashPassword("admin123"),
      role: "tenant_admin",
      permissions: ["billing"],
      mfaEnabled: true,
      mfaEnforced: true,
      mfaSecret: "preflight-mfa-enabled",
      active: true
    }],
    roles: [],
    venues: [],
    customers: [],
    shifts: [],
    workorders: [
      {
        id: "wo_ready_1",
        tenantId: "t_invoice",
        title: "Onderhoud HVAC",
        status: "Voltooid",
        billableStatus: "ready_for_invoice",
        billableAmount: 450
      },
      {
        id: "wo_ready_2",
        tenantId: "t_invoice",
        title: "Interventie werf",
        status: "Voltooid",
        billableStatus: "ready_for_invoice",
        billableHours: 2.5,
        hourlyRate: 80
      },
      {
        id: "wo_missing_amount",
        tenantId: "t_invoice",
        title: "Gratis nazorg",
        status: "Voltooid",
        billableStatus: "ready_for_invoice"
      }
    ],
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
const tenant = store.get("tenants", "t_invoice");
const actor = store.getUserByEmail("finance.admin@example.test");

const missingAmount = capture(() => createInvoice(store, tenant, {
  fromWorkorders: true,
  workorderIds: ["wo_missing_amount"]
}, actor));
const result = createInvoice(store, tenant, {
  fromWorkorders: true,
  workorderIds: ["wo_ready_1", "wo_ready_2"]
}, actor);
const duplicate = capture(() => createInvoice(store, store.get("tenants", "t_invoice"), {
  fromWorkorders: true,
  workorderIds: ["wo_ready_1", "wo_ready_2"]
}, actor));

const first = store.get("workorders", "wo_ready_1");
const second = store.get("workorders", "wo_ready_2");
const payload = {
  ok:
    missingAmount.error?.status === 422 &&
    result.invoice.source === "workorders" &&
    result.invoice.gross === 650 &&
    result.invoice.net === 650 &&
    result.invoice.lines.length === 2 &&
    first.billableStatus === "invoiced" &&
    second.invoiceId === result.invoice.id &&
    duplicate.error?.status === 422,
  missingAmountStatus: missingAmount.error?.status || null,
  invoiceId: result.invoice.id,
  gross: result.invoice.gross,
  net: result.invoice.net,
  lineCount: result.invoice.lines.length,
  firstWorkorderStatus: first.billableStatus,
  secondWorkorderInvoiceId: second.invoiceId,
  duplicateStatus: duplicate.error?.status || null
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.ok ? 0 : 1);
}

console.log("WorkFlow Pro operational invoicing preflight");
console.log(`Missing amount blocked: ${missingAmount.error?.status === 422 ? "yes" : "no"}`);
console.log(`Invoice from workorders: ${result.invoice.source === "workorders" ? "yes" : "no"}`);
console.log(`Workorders marked invoiced: ${first.billableStatus === "invoiced" && second.invoiceId === result.invoice.id ? "yes" : "no"}`);
console.log(`Duplicate invoicing blocked: ${duplicate.error?.status === 422 ? "yes" : "no"}`);

if (!payload.ok) {
  console.error("Operational invoicing check faalt: facturatielogica werkt niet correct.");
  process.exit(1);
}

console.log("\nOperational invoicing OK.");
