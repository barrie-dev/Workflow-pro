const { Store } = require("../src/lib/store");
const { salesLaunchReadiness } = require("../src/modules/sales");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function formatValue(check) {
  return `${check.value}${check.unit || ""} / ${check.target}${check.unit || ""}`;
}

const tenantId = argValue("--tenant", "t_demo");
const jsonMode = process.argv.includes("--json");
const store = new Store();
const tenant = store.data.tenants.find(row => row.id === tenantId);

if (!tenant) {
  const payload = { ok: false, tenantId, error: "Tenant niet gevonden" };
  if (jsonMode) console.log(JSON.stringify(payload, null, 2));
  else console.error(`Tenant niet gevonden: ${tenantId}`);
  process.exit(1);
}

const readiness = salesLaunchReadiness(store, tenantId);
const payload = {
  ok: readiness.ok,
  tenant: { id: tenant.id, name: tenant.name },
  score: readiness.score,
  generatedAt: readiness.generatedAt,
  openChecks: readiness.openChecks,
  checks: readiness.checks
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(readiness.ok ? 0 : 1);
}

console.log(`WorkFlow Pro commercial launch readiness voor ${tenant.name}: ${readiness.score}%`);
console.log(`Open checks: ${readiness.openChecks.length}`);
if (readiness.openChecks.length) {
  console.log("\nOpen commercial launch checks");
  readiness.openChecks.forEach(check => {
    console.log(`[OPEN] ${check.label}: ${formatValue(check)}`);
    console.log(`      actie: ${check.action}`);
  });
}
if (!readiness.ok) process.exit(1);
console.log("\nCommercial launch preflight OK.");
