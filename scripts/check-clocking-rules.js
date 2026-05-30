const { Store } = require("../src/lib/store");
const { hashPassword } = require("../src/lib/security");
const { clockIn, clockOut, managementReport } = require("../src/modules/operations");

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
    tenants: [{ id: "t_clocking", name: "Clocking Test BV", plan: "business", status: "trial" }],
    users: [{
      id: "u_worker",
      tenantId: "t_clocking",
      name: "Sofie Janssens",
      email: "sofie@example.test",
      passwordHash: hashPassword("worker123"),
      role: "field_worker",
      permissions: ["clockings"],
      active: true
    }],
    roles: [],
    venues: [{ id: "v_yard", tenantId: "t_clocking", name: "Werf De Keyser" }],
    customers: [],
    shifts: [{
      id: "shift_day",
      tenantId: "t_clocking",
      userId: "u_worker",
      venueId: "v_yard",
      date: "2026-05-13",
      start: "08:00",
      end: "16:00"
    }],
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
const tenant = store.get("tenants", "t_clocking");
const actor = store.getUserByEmail("sofie@example.test");

const firstClock = clockIn(store, tenant, { date: "2026-05-13", clockIn: "08:05" }, actor);
const duplicate = capture(() => clockIn(store, tenant, { date: "2026-05-13", clockIn: "09:00" }, actor));
const badClockOut = capture(() => clockOut(store, tenant, { date: "2026-05-13", clockOut: "07:55" }, actor));
const closed = clockOut(store, tenant, { date: "2026-05-13", clockOut: "16:10" }, actor);
const overlappingClosed = capture(() => {
  store.insert("clocks", {
    id: "clock_existing",
    tenantId: "t_clocking",
    userId: "u_worker",
    venueId: "v_yard",
    shiftId: "shift_day",
    date: "2026-05-13",
    clockIn: "15:00",
    clockOut: null,
    status: "active"
  });
  return clockOut(store, tenant, { date: "2026-05-13", clockOut: "17:30" }, actor);
});
const report = managementReport(store, "t_clocking");

const payload = {
  ok:
    firstClock.shiftId === "shift_day" &&
    duplicate.error?.status === 409 &&
    badClockOut.error?.status === 400 &&
    closed.status === "ready_for_approval" &&
    overlappingClosed.error?.status === 409 &&
    report.clocking.openCount === 1 &&
    report.clocking.payrollReady === false,
  matchedShiftId: firstClock.shiftId,
  duplicateStatus: duplicate.error?.status || null,
  badClockOutStatus: badClockOut.error?.status || null,
  closedStatus: closed.status,
  overlappingClosedStatus: overlappingClosed.error?.status || null,
  clocking: report.clocking
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.ok ? 0 : 1);
}

console.log("WorkFlow Pro clocking rules preflight");
console.log(`Planning gekoppeld: ${firstClock.shiftId === "shift_day" ? "yes" : "no"}`);
console.log(`Dubbele actieve registratie geblokkeerd: ${duplicate.error?.status === 409 ? "yes" : "no"}`);
console.log(`Uitklok voor inklok geblokkeerd: ${badClockOut.error?.status === 400 ? "yes" : "no"}`);
console.log(`Overlappende gesloten registratie geblokkeerd: ${overlappingClosed.error?.status === 409 ? "yes" : "no"}`);
console.log(`Payroll ready: ${report.clocking.payrollReady ? "yes" : "no"}`);

if (!payload.ok) {
  console.error("Clocking rules check faalt: tijdregistratielogica werkt niet correct.");
  process.exit(1);
}

console.log("\nClocking rules OK.");
