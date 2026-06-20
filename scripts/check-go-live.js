const { Store } = require("../src/lib/store");
const { goLiveReadiness } = require("../src/modules/go-live");

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

const payload = goLiveReadiness(store, tenant, { minPilotScore, strictProduction });
const { production, liveServices, pilot, sales, customerStart } = payload.gates;

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.ok ? 0 : 1);
}

console.log(`WorkFlow Pro go-live gate voor ${tenant.name}`);
console.log(`Overall: ${payload.ok ? "OK" : "OPEN"}`);
console.log(`Production: ${production.score}% - P0 ${production.p0}, P1 ${production.p1}`);
console.log(`Live services: ${liveServices.ready}/${liveServices.total} - P0 ${liveServices.p0}, P1 ${liveServices.p1}`);
console.log(`Pilot: ${pilot.score}% - open KPI's ${pilot.openCount}`);
console.log(`Sales: ${sales.score}% - open checks ${sales.openChecks.length}`);
console.log(`Customer start: ${customerStart.ok ? "OK" : "OPEN"} - ${customerStart.label}`);

printActionRows("Production P0 blockers", production.openP0, row => `[P0] ${row.label}: ${row.detail}`);
if (strictProduction) printActionRows("Production P1 warnings", production.openP1, row => `[P1] ${row.label}: ${row.detail}`);
printActionRows("Live service P0 blockers", liveServices.openP0, row => `[P0] ${row.label}: ${row.value} - ${row.action}`);
if (strictProduction) printActionRows("Live service P1 warnings", liveServices.openP1, row => `[P1] ${row.label}: ${row.value} - ${row.action}`);
printActionRows("Pilot actions", pilot.openKpis, row => `[OPEN] ${row.label}: ${row.action}`);
printActionRows("Sales actions", sales.openChecks, row => `[OPEN] ${row.label}: ${row.action}`);
printActionRows("Customer start blockers", customerStart.blockers || [], row => `[OPEN] ${row}`);

if (!payload.ok) process.exit(1);
console.log("\nGo-live gate OK.");
