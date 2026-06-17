// Deze preflight test expliciet dat de admin-MFA-gate dwingt. Een dev-.env met
// REQUIRE_ADMIN_MFA=false zou de gate uitschakelen en de check vals laten falen;
// forceer 'm hier aan zodat de check deterministisch is (lokaal én in CI).
process.env.REQUIRE_ADMIN_MFA = "true";

const { Store } = require("../src/lib/store");
const { hashPassword } = require("../src/lib/security");
const { loginWithMfa, assertCan } = require("../src/lib/auth");

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
    tenants: [{ id: "t_auth", name: "Auth Test BV", plan: "business", status: "trial" }],
    users: [{
      id: "u_auth_admin",
      tenantId: "t_auth",
      name: "Auth Admin",
      email: "auth.admin@example.test",
      passwordHash: hashPassword("CorrectHorse123!"),
      role: "tenant_admin",
      permissions: ["settings"],
      active: true,
      mfaEnabled: true,
      mfaEnforced: true,
      mfaSecret: "",
      recoveryCodes: [],
      failedLoginCount: 0,
      lockedUntil: null
    }],
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

const jsonMode = process.argv.includes("--json");
const store = new Store(new MemoryAdapter(baseData()));
let lastError = null;

for (let attempt = 0; attempt < 5; attempt += 1) {
  try {
    loginWithMfa(store, "auth.admin@example.test", "CorrectHorse123!", "000000");
  } catch (error) {
    lastError = error;
  }
}

const user = store.getUserByEmail("auth.admin@example.test");
const locked = user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now();
const mfaFailedEvents = store.data.auditLogs.filter(row => row.action === "mfa_failed").length;
let adminMfaGate = false;
try {
  assertCan({ ...user, mfaEnabled: false, mfaEnforced: false, mfaSecret: "" }, "settings");
} catch (error) {
  adminMfaGate = error.status === 403 && /MFA/.test(error.message);
}
const payload = {
  ok: locked && Number(user.failedLoginCount || 0) >= 5 && mfaFailedEvents === 5 && adminMfaGate,
  failedLoginCount: user.failedLoginCount,
  lockedUntil: user.lockedUntil,
  locked: !!locked,
  mfaFailedEvents,
  adminMfaGate,
  lastError: lastError?.message || null
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.ok ? 0 : 1);
}

console.log("WorkFlow Pro auth hardening preflight");
console.log(`MFA failed events: ${mfaFailedEvents}`);
console.log(`Failed login count: ${user.failedLoginCount}`);
console.log(`Locked: ${locked ? "yes" : "no"}`);
console.log(`Admin MFA gate: ${adminMfaGate ? "yes" : "no"}`);

if (!payload.ok) {
  console.error("Auth hardening check faalt: MFA brute-force of admin-MFA gate werkt niet correct.");
  process.exit(1);
}

console.log("\nAuth hardening OK.");
