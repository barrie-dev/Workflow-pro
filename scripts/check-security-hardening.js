const { Store } = require("../src/lib/store");
const { createMfaSetup } = require("../src/lib/auth");
const { securityHeaders } = require("../src/lib/http");
const { assertStrongPassword, hashPassword, verifyPassword } = require("../src/lib/security");
const { createModuleRow } = require("../src/modules/crud");

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
    tenants: [{ id: "t_security", name: "Security Test BV", plan: "business", status: "trial" }],
    users: [{
      id: "u_admin",
      tenantId: "t_security",
      name: "Security Admin",
      email: "security.admin@example.test",
      passwordHash: hashPassword("AdminPassword123!"),
      role: "tenant_admin",
      permissions: ["employees"],
      mfaEnabled: true,
      mfaEnforced: true,
      mfaSecret: "preflight-mfa-enabled",
      active: true
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

function capture(fn) {
  try {
    return { result: fn(), error: null };
  } catch (error) {
    return { result: null, error };
  }
}

const jsonMode = process.argv.includes("--json");
const store = new Store(new MemoryAdapter(baseData()));
const actor = store.getUserByEmail("security.admin@example.test");

const weakPassword = capture(() => assertStrongPassword("Welkom123!"));
const strongPassword = capture(() => assertStrongPassword("Welkom12345!"));
const storedPassword = hashPassword("Welkom12345!");
const weakCreate = capture(() => createModuleRow(store, actor, "users", "t_security", {
  name: "Weak User",
  email: "weak@example.test",
  password: "Welkom123!",
  role: "field_worker"
}));
const strongCreate = capture(() => createModuleRow(store, actor, "users", "t_security", {
  name: "Strong User",
  email: "strong@example.test",
  password: "Welkom12345!",
  role: "field_worker"
}));
const headers = securityHeaders({ "X-Test": "ok" });
const mfaSetup = createMfaSetup(store, actor);

const payload = {
  ok:
    weakPassword.error?.status === 400 &&
    !strongPassword.error &&
    verifyPassword("Welkom12345!", storedPassword) === true &&
    verifyPassword("Wrong12345!", storedPassword) === false &&
    weakCreate.error?.status === 400 &&
    !!strongCreate.result?.id &&
    headers["X-Content-Type-Options"] === "nosniff" &&
    headers["X-Frame-Options"] === "DENY" &&
    headers["X-Test"] === "ok" &&
    !!mfaSetup.secret &&
    !Object.prototype.hasOwnProperty.call(mfaSetup, "demoCode"),
  weakPasswordStatus: weakPassword.error?.status || null,
  strongPasswordAccepted: !strongPassword.error,
  weakCreateStatus: weakCreate.error?.status || null,
  strongCreateId: strongCreate.result?.id || null,
  timingSafeVerifyOk: verifyPassword("Welkom12345!", storedPassword) === true,
  securityHeaders: {
    contentTypeOptions: headers["X-Content-Type-Options"],
    frameOptions: headers["X-Frame-Options"],
    permissionsPolicy: headers["Permissions-Policy"]
  },
  mfaSetupHasDemoCode: Object.prototype.hasOwnProperty.call(mfaSetup, "demoCode")
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.ok ? 0 : 1);
}

console.log("WorkFlow Pro security hardening preflight");
console.log(`Weak password blocked: ${weakPassword.error?.status === 400 ? "yes" : "no"}`);
console.log(`Strong password accepted: ${!strongPassword.error ? "yes" : "no"}`);
console.log(`User CRUD password policy enforced: ${weakCreate.error?.status === 400 && strongCreate.result?.id ? "yes" : "no"}`);
console.log(`Security headers present: ${headers["X-Content-Type-Options"] === "nosniff" && headers["X-Frame-Options"] === "DENY" ? "yes" : "no"}`);
console.log(`MFA setup hides demo code: ${!Object.prototype.hasOwnProperty.call(mfaSetup, "demoCode") ? "yes" : "no"}`);

if (!payload.ok) {
  console.error("Security hardening check faalt.");
  process.exit(1);
}

console.log("\nSecurity hardening OK.");
