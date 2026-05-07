const { Store } = require("../src/lib/store");
const { productionReadiness } = require("../src/modules/production");
const { pilotKpis } = require("../src/modules/pilot");
const { salesLaunchReadiness } = require("../src/modules/sales");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function printActionRows(title, rows, formatter) {
  if (!rows.length) return;
  console.log(`\n${title}`);
  rows.forEach(row => console.log(formatter(row)));
}

const tenantId = argValue("--tenant", "t_demo");
const minPilotScore = Number(argValue("--min-pilot-score", "80"));
const strictProduction = process.argv.includes("--strict-production");
const jsonMode = process.argv.includes("--json");

const store = new Store();
const tenant = store.data.tenants.find(row => row.id === tenantId);
if (!tenant) {
  const payload = { ok: false, tenantId, error: "Tenant niet gevonden" };
  if (jsonMode) console.log(JSON.stringify(payload, null, 2));
  else console.error(`Tenant niet gevonden: ${tenantId}`);
  process.exit(1);
}

const production = productionReadiness(store);
const openP0 = production.checks.filter(row => !row.ok && row.priority === "P0");
const openP1 = production.checks.filter(row => !row.ok && row.priority === "P1");
const pilot = pilotKpis(store, tenantId);
const openPilot = pilot.kpis.filter(row => !row.ok);
const sales = salesLaunchReadiness(store, tenantId);
const productionOk = openP0.length === 0 && (!strictProduction || openP1.length === 0);
const pilotOk = pilot.score >= minPilotScore && openPilot.length === 0;
const ok = productionOk && pilotOk && sales.ok;

const payload = {
  ok,
  tenant: { id: tenant.id, name: tenant.name },
  generatedAt: new Date().toISOString(),
  gates: {
    production: {
      ok: productionOk,
      strict: strictProduction,
      score: production.score,
      p0: openP0.length,
      p1: openP1.length,
      openP0,
      openP1
    },
    pilot: {
      ok: pilotOk,
      minScore: minPilotScore,
      score: pilot.score,
      openCount: openPilot.length,
      openKpis: openPilot
    },
    sales: {
      ok: sales.ok,
      score: sales.score,
      openCount: sales.openChecks.length,
      openChecks: sales.openChecks
    }
  }
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(ok ? 0 : 1);
}

console.log(`WorkFlow Pro go-live gate voor ${tenant.name}`);
console.log(`Overall: ${ok ? "OK" : "OPEN"}`);
console.log(`Production: ${production.score}% - P0 ${openP0.length}, P1 ${openP1.length}`);
console.log(`Pilot: ${pilot.score}% - open KPI's ${openPilot.length}`);
console.log(`Sales: ${sales.score}% - open checks ${sales.openChecks.length}`);

printActionRows("Production P0 blockers", openP0, row => `[P0] ${row.label}: ${row.detail}`);
if (strictProduction) printActionRows("Production P1 warnings", openP1, row => `[P1] ${row.label}: ${row.detail}`);
printActionRows("Pilot actions", openPilot, row => `[OPEN] ${row.label}: ${row.action}`);
printActionRows("Sales actions", sales.openChecks, row => `[OPEN] ${row.label}: ${row.action}`);

if (!ok) process.exit(1);
console.log("\nGo-live gate OK.");
