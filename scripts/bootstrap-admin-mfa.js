const { Store } = require("../src/lib/store");
const { enforceMfa } = require("../src/lib/auth");
const { hashPassword } = require("../src/lib/security");

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

function testData() {
  return {
    schemaVersion: 6,
    tenants: [{ id: "t_mfa", name: "MFA Test BV", plan: "business", status: "trial" }],
    users: [
      {
        id: "u_admin_missing",
        tenantId: "t_mfa",
        name: "Missing MFA Admin",
        email: "missing@example.test",
        passwordHash: hashPassword("AdminPassword123!"),
        role: "tenant_admin",
        permissions: ["settings"],
        active: true,
        mfaEnabled: false,
        mfaEnforced: false
      },
      {
        id: "u_admin_ready",
        tenantId: "t_mfa",
        name: "Ready MFA Admin",
        email: "ready@example.test",
        passwordHash: hashPassword("AdminPassword123!"),
        role: "tenant_admin",
        permissions: ["settings"],
        active: true,
        mfaEnabled: true,
        mfaEnforced: true,
        mfaSecret: "encrypted"
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
    stockMutations: [],
    vehicles: [],
    mileageLogs: [],
    leaves: [],
    messages: [],
    notifications: [],
    integrations: [],
    platformConfig: [],
    quotes: [],
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
    bundles: [],
    migrationHistory: []
  };
}

function hasArg(name) {
  return process.argv.includes(name);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function adminUsers(store) {
  return (store.data.users || []).filter(user => ["super_admin", "tenant_admin"].includes(user.role));
}

function mfaReady(user) {
  return !!(user.mfaEnabled && user.mfaEnforced && user.mfaSecret);
}

function run(store, options = {}) {
  const emailFilter = String(options.email || "").toLowerCase();
  const admins = adminUsers(store).filter(user => !emailFilter || String(user.email || "").toLowerCase() === emailFilter);
  const missing = admins.filter(user => !mfaReady(user));
  const bootstrap = [];

  if (options.apply) {
    for (const user of missing) {
      bootstrap.push(enforceMfa(store, user));
    }
  }

  return {
    ok: missing.length === 0 || options.apply,
    apply: !!options.apply,
    totalAdmins: admins.length,
    readyAdmins: admins.filter(mfaReady).length + bootstrap.length,
    missingAdmins: options.apply ? 0 : missing.length,
    missing: options.apply ? [] : missing.map(user => ({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId || null
    })),
    bootstrap
  };
}

const jsonMode = hasArg("--json");
const apply = hasArg("--apply");
const selfTest = hasArg("--self-test");
const email = argValue("--email");
const store = selfTest ? new Store(new MemoryAdapter(testData())) : new Store();
const payload = run(store, { apply, email });

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.ok ? 0 : 1);
}

console.log("WorkFlow Pro admin MFA bootstrap");
console.log(`Admins klaar: ${payload.readyAdmins}/${payload.totalAdmins}`);
console.log(`Ontbrekend: ${payload.missingAdmins}`);

if (payload.missing.length) {
  console.log("\nAdmins zonder MFA");
  payload.missing.forEach(user => console.log(`- ${user.email} (${user.role}, tenant ${user.tenantId || "platform"})`));
  console.log("\nGebruik --apply om eenmalige TOTP secrets en recovery codes te genereren.");
}

if (payload.bootstrap.length) {
  console.log("\nEenmalige MFA bootstrapgegevens");
  payload.bootstrap.forEach(row => {
    console.log(`\n${row.email}`);
    console.log(`TOTP secret: ${row.secret}`);
    console.log(`otpauth: ${row.otpauth}`);
    console.log(`Recovery codes: ${row.recoveryCodes.join(", ")}`);
  });
  console.log("\nBewaar deze gegevens veilig. Ze worden niet opnieuw in plaintext opgeslagen.");
}

if (!payload.ok) process.exit(1);
