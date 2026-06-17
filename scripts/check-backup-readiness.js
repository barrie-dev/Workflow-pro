const { Store } = require("../src/lib/store");
const { backupHealth, createBackup } = require("../src/modules/admin");

function hasArg(name) {
  return process.argv.includes(name);
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const jsonMode = hasArg("--json");
const apply = hasArg("--apply");
const tenantFilter = argValue("--tenant");
const store = new Store();
const health = backupHealth(store, tenantFilter || null);
const actor = { email: "backup-operator@workflowpro.local" };
const created = [];
const failed = [];

if (apply) {
  for (const row of health.rows.filter(item => item.count === 0 || item.stale)) {
    const tenant = store.get("tenants", row.tenantId);
    if (!tenant) continue;
    try {
      created.push({ tenantId: tenant.id, tenantName: tenant.name, backup: createBackup(store, tenant, actor) });
    } catch (error) {
      failed.push({ tenantId: tenant.id, tenantName: tenant.name, error: error.message });
    }
  }
}

const nextHealth = apply ? backupHealth(store, tenantFilter || null) : health;
const payload = {
  ok: nextHealth.ok && failed.length === 0,
  apply,
  generatedAt: new Date().toISOString(),
  staleAfterDays: nextHealth.staleAfterDays,
  tenants: nextHealth.tenants,
  missing: nextHealth.missing,
  stale: nextHealth.stale,
  rows: nextHealth.rows,
  created,
  failed
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.ok ? 0 : 1);
}

console.log("WorkFlow Pro backup readiness");
console.log(`Tenants: ${payload.tenants}`);
console.log(`Missing backups: ${payload.missing}`);
console.log(`Stale backups: ${payload.stale}`);
console.log(`Gate: ${payload.ok ? "OK" : "OPEN"}`);

if (health.rows.length) {
  console.log("\nBackup status");
  health.rows.forEach(row => {
    const state = row.count > 0 && !row.stale ? "OK" : "OPEN";
    console.log(`[${state}] ${row.tenantName} (${row.tenantId}) latest=${row.latestBackupAt || "none"} age=${row.ageDays ?? "n/a"}d`);
  });
}

if (created.length) {
  console.log("\nCreated backups");
  created.forEach(row => console.log(`[OK] ${row.tenantName}: ${row.backup.id}`));
}

if (failed.length) {
  console.log("\nFailed backups");
  failed.forEach(row => console.log(`[P0] ${row.tenantName}: ${row.error}`));
}

if (!payload.ok) {
  console.log("\nGebruik --apply om ontbrekende of stale tenantbackups aan te maken.");
  process.exit(1);
}

console.log("\nBackup readiness OK.");
