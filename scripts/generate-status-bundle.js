const path = require("path");
const { Store } = require("../src/lib/store");
const { generateStatusBundle } = require("../src/modules/reports");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const tenantId = argValue("--tenant", "t_demo");
const minPilotScore = Number(argValue("--min-pilot-score", "80"));
const strictProduction = process.argv.includes("--strict-production");
const store = new Store();
const tenant = store.data.tenants.find(row => row.id === tenantId);
if (!tenant) {
  console.error(`Tenant niet gevonden: ${tenantId}`);
  process.exit(1);
}

const bundle = generateStatusBundle(store, tenant, { email: "status-bundle@workflowpro.be" }, { minPilotScore, strictProduction });

console.log(JSON.stringify({
  ok: true,
  tenantId,
  generated: ["pilot", "sales", "go-live", "roadmap", "report-index"],
  goLiveReady: bundle.manifest.goLiveReady,
  manifest: path.join("data", "reports", `${tenantId}-status-bundle-manifest.json`),
  files: bundle.files.length
}, null, 2));
