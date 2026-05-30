const { Store } = require("../src/lib/store");
const { hashPassword } = require("../src/lib/security");
const { createModuleRow } = require("../src/modules/crud");
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
    tenants: [{ id: "t_planning", name: "Planning Test BV", plan: "business", status: "trial" }],
    users: [
      {
        id: "u_admin",
        tenantId: "t_planning",
        name: "Planning Admin",
        email: "planning.admin@example.test",
        passwordHash: hashPassword("admin123"),
        role: "tenant_admin",
        permissions: ["planning"],
        mfaEnabled: true,
        mfaEnforced: true,
        mfaSecret: "preflight-mfa-enabled",
        active: true
      },
      {
        id: "u_worker",
        tenantId: "t_planning",
        name: "Sofie Janssens",
        email: "sofie@example.test",
        passwordHash: hashPassword("worker123"),
        role: "field_worker",
        permissions: [],
        active: true
      }
    ],
    roles: [],
    venues: [{ id: "v_yard", tenantId: "t_planning", name: "Werf De Keyser" }],
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

function tryCreate(store, actor, payload) {
  return createModuleRow(store, actor, "planning", "t_planning", payload);
}

const jsonMode = process.argv.includes("--json");
const store = new Store(new MemoryAdapter(baseData()));
const actor = store.getUserByEmail("planning.admin@example.test");
let overlapError = null;

tryCreate(store, actor, {
  userId: "u_worker",
  venueId: "v_yard",
  date: "2026-05-12",
  start: "08:00",
  end: "12:00"
});

try {
  tryCreate(store, actor, {
    userId: "u_worker",
    venueId: "v_yard",
    date: "2026-05-12",
    start: "11:30",
    end: "13:00"
  });
} catch (error) {
  overlapError = error;
}

const adjacent = tryCreate(store, actor, {
  userId: "u_worker",
  venueId: "v_yard",
  date: "2026-05-12",
  start: "12:00",
  end: "16:00"
});

store.insert("shifts", {
  id: "shift_seeded_conflict",
  tenantId: "t_planning",
  userId: "u_worker",
  venueId: "v_yard",
  date: "2026-05-12",
  start: "15:30",
  end: "17:00"
});

const report = managementReport(store, "t_planning");
const payload = {
  ok: overlapError?.status === 409 && !!adjacent?.id && report.planning.conflictCount === 1,
  overlapStatus: overlapError?.status || null,
  overlapMessage: overlapError?.message || null,
  adjacentShiftId: adjacent?.id || null,
  planningConflicts: report.planning.conflictCount,
  plannedHours: report.planning.plannedHours,
  capacityDays: report.planning.capacity.length
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.ok ? 0 : 1);
}

console.log("WorkFlow Pro planning rules preflight");
console.log(`Overlap blocked: ${overlapError?.status === 409 ? "yes" : "no"}`);
console.log(`Adjacent shift accepted: ${adjacent?.id ? "yes" : "no"}`);
console.log(`Report planning conflicts: ${report.planning.conflictCount}`);

if (!payload.ok) {
  console.error("Planning rules check faalt: conflictvalidatie of rapportage werkt niet correct.");
  process.exit(1);
}

console.log("\nPlanning rules OK.");
