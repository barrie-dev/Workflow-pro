const { Store } = require("../src/lib/store");
const { roadmapStatus } = require("../src/modules/roadmap");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function printPhase(row) {
  const marker = row.go ? "GO" : "NO-GO";
  console.log(`[${marker}] ${row.label}: ${row.score}% (${row.openCount} open)`);
  const firstActions = (row.actions || []).slice(0, 3);
  firstActions.forEach(action => {
    console.log(`      [${action.priority || "P1"}] ${action.label}: ${action.action}`);
  });
}

const tenantId = argValue("--tenant", "t_demo");
const phaseFilter = argValue("--phase", "");
const jsonMode = process.argv.includes("--json");
const blockAllPhases = process.argv.includes("--all-phases");

const store = new Store();
const tenant = store.data.tenants.find(row => row.id === tenantId);
if (!tenant) {
  const payload = { ok: false, tenantId, error: "Tenant niet gevonden" };
  if (jsonMode) console.log(JSON.stringify(payload, null, 2));
  else console.error(`Tenant niet gevonden: ${tenantId}`);
  process.exit(1);
}

const roadmap = roadmapStatus(store, tenant);
const selectedPhase = phaseFilter
  ? roadmap.phases.find(row => row.key === phaseFilter)
  : null;

if (phaseFilter && !selectedPhase) {
  const payload = {
    ok: false,
    tenant: { id: tenant.id, name: tenant.name },
    phase: phaseFilter,
    error: "Onbekende roadmapfase"
  };
  if (jsonMode) console.log(JSON.stringify(payload, null, 2));
  else console.error(`Onbekende roadmapfase: ${phaseFilter}`);
  process.exit(1);
}

const blockingPhases = phaseFilter
  ? [selectedPhase].filter(row => !row.go)
  : roadmap.phases.filter(row => !row.go && (blockAllPhases || row.key === roadmap.currentPhase));
const ok = blockingPhases.length === 0;

const payload = {
  ok,
  tenant: { id: tenant.id, name: tenant.name },
  generatedAt: roadmap.generatedAt,
  currentPhase: roadmap.currentPhase,
  summary: roadmap.summary,
  blockingPhases,
  phases: phaseFilter ? [selectedPhase] : roadmap.phases
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(ok ? 0 : 1);
}

console.log(`WorkFlow Pro roadmap preflight voor ${tenant.name}`);
console.log(`Current phase: ${roadmap.currentPhase}`);
console.log(`Fases groen: ${roadmap.summary.go}/${roadmap.summary.total}`);
console.log(`Open acties: ${roadmap.summary.openActions}`);
console.log("");
(phaseFilter ? [selectedPhase] : roadmap.phases).forEach(printPhase);

if (!ok) {
  console.log("");
  console.log(`Roadmap preflight blokkeert op ${blockingPhases.map(row => row.label).join(", ")}.`);
  process.exit(1);
}

console.log("\nRoadmap preflight OK.");
