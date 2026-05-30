const { Store } = require("../src/lib/store");
const { hashPassword } = require("../src/lib/security");
const { attachWorkorderPhoto, completeWorkorder, signWorkorder } = require("../src/modules/mobile");
const { managementReport } = require("../src/modules/operations");

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
    tenants: [{ id: "t_workorder", name: "Workorder Test BV", plan: "business", status: "trial" }],
    users: [{
      id: "u_worker",
      tenantId: "t_workorder",
      name: "Sofie Janssens",
      email: "sofie@example.test",
      passwordHash: hashPassword("worker123"),
      role: "field_worker",
      permissions: ["workorders"],
      active: true
    }],
    roles: [],
    venues: [],
    customers: [],
    shifts: [],
    workorders: [{
      id: "wo_1",
      tenantId: "t_workorder",
      userId: "u_worker",
      title: "Onderhoud HVAC",
      status: "Te starten",
      requiresPhoto: true,
      requiresSignature: true,
      checklistRequired: true,
      checklist: [
        { id: "c_1", label: "Veiligheid gecontroleerd", done: false },
        { id: "c_2", label: "Installatie getest", done: false }
      ],
      billable: true,
      files: []
    }],
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
const tenant = store.get("tenants", "t_workorder");
const actor = store.getUserByEmail("sofie@example.test");

const incompleteChecklist = capture(() => completeWorkorder(store, tenant, "wo_1", {
  checklist: [
    { id: "c_1", label: "Veiligheid gecontroleerd", done: true },
    { id: "c_2", label: "Installatie getest", done: false }
  ]
}, actor));
const invalidPhoto = capture(() => attachWorkorderPhoto(store, tenant, "wo_1", {
  name: "bewijs.pdf",
  type: "application/pdf",
  size: 1000
}, actor));
const photoResult = attachWorkorderPhoto(store, tenant, "wo_1", {
  name: "voor-na.jpg",
  type: "image/jpeg",
  size: 240000
}, actor);
const missingSignature = capture(() => completeWorkorder(store, tenant, "wo_1", {
  checklist: [
    { id: "c_1", label: "Veiligheid gecontroleerd", done: true },
    { id: "c_2", label: "Installatie getest", done: true }
  ]
}, actor));
const badSignature = capture(() => signWorkorder(store, tenant, "wo_1", { signerName: "" }, actor));
const signed = signWorkorder(store, tenant, "wo_1", { signerName: "Jan Klant" }, actor);
const completed = completeWorkorder(store, tenant, "wo_1", {
  checklist: [
    { id: "c_1", label: "Veiligheid gecontroleerd", done: true },
    { id: "c_2", label: "Installatie getest", done: true }
  ],
  note: "Werf afgerond"
}, actor);
const duplicateComplete = capture(() => completeWorkorder(store, tenant, "wo_1", {}, actor));
const report = managementReport(store, tenant.id);

const payload = {
  ok:
    incompleteChecklist.error?.status === 422 &&
    invalidPhoto.error?.status === 415 &&
    !!photoResult.photo?.id &&
    missingSignature.error?.status === 422 &&
    badSignature.error?.status === 422 &&
    signed.signed === true &&
    completed.status === "Voltooid" &&
    completed.billableStatus === "ready_for_invoice" &&
    duplicateComplete.error?.status === 409 &&
    report.workorders.counts.readyForInvoice === 1,
  incompleteChecklistStatus: incompleteChecklist.error?.status || null,
  invalidPhotoStatus: invalidPhoto.error?.status || null,
  photoId: photoResult.photo?.id || null,
  missingSignatureStatus: missingSignature.error?.status || null,
  badSignatureStatus: badSignature.error?.status || null,
  completedStatus: completed.status,
  billableStatus: completed.billableStatus,
  duplicateCompleteStatus: duplicateComplete.error?.status || null,
  workorders: report.workorders
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.ok ? 0 : 1);
}

console.log("WorkFlow Pro workorder rules preflight");
console.log(`Incomplete checklist blocked: ${incompleteChecklist.error?.status === 422 ? "yes" : "no"}`);
console.log(`Invalid photo blocked: ${invalidPhoto.error?.status === 415 ? "yes" : "no"}`);
console.log(`Missing signature blocked: ${missingSignature.error?.status === 422 ? "yes" : "no"}`);
console.log(`Completed ready for invoice: ${completed.billableStatus === "ready_for_invoice" ? "yes" : "no"}`);

if (!payload.ok) {
  console.error("Workorder rules check faalt: werkbonlogica werkt niet correct.");
  process.exit(1);
}

console.log("\nWorkorder rules OK.");
