const { Store } = require("../src/lib/store");
const { pilotKpis } = require("../src/modules/pilot");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function printKpi(row) {
  const marker = row.ok ? "OK" : "OPEN";
  console.log(`[${marker}] ${row.label}: ${row.value} / target ${row.target}`);
  if (!row.ok && row.action) console.log(`      actie: ${row.action}`);
}

const tenantId = argValue("--tenant", "t_demo");
const minScore = Number(argValue("--min-score", "80"));
const jsonMode = process.argv.includes("--json");

const store = new Store();
const tenant = store.data.tenants.find(row => row.id === tenantId);
if (!tenant) {
  const payload = { ok: false, tenantId, error: "Tenant niet gevonden" };
  if (jsonMode) console.log(JSON.stringify(payload, null, 2));
  else console.error(`Tenant niet gevonden: ${tenantId}`);
  process.exit(1);
}

const report = pilotKpis(store, tenantId);
const openKpis = report.kpis.filter(row => !row.ok);
const ok = report.score >= minScore && openKpis.length === 0;

if (jsonMode) {
  console.log(JSON.stringify({
    ok,
    tenant: { id: tenant.id, name: tenant.name },
    minScore,
    score: report.score,
    generatedAt: report.generatedAt,
    openKpis,
    kpis: report.kpis
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

console.log(`WorkFlow Pro pilot readiness voor ${tenant.name}: ${report.score}%`);
console.log(`Minimum score: ${minScore}%`);
console.log(`Open KPI's: ${openKpis.length}`);
if (openKpis.length) {
  console.log("\nOpen KPI's");
  openKpis.forEach(printKpi);
}
if (!ok) process.exit(1);
console.log("\nPilot preflight OK: KPI targets gehaald.");
