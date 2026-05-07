const { Store } = require("../src/lib/store");
const { apiKeyGovernance } = require("../src/modules/api-key-governance");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const jsonMode = process.argv.includes("--json");
const strictMode = process.argv.includes("--strict");
const tenantId = argValue("--tenant", "");
const store = new Store();
const governance = apiKeyGovernance(store, { tenantId, strict: strictMode });

if (jsonMode) {
  console.log(JSON.stringify(governance, null, 2));
  process.exit(governance.ok ? 0 : 1);
}

console.log(`WorkFlow Pro API-key governance: ${governance.checked} keys gecontroleerd`);
console.log(`P0 blockers: ${governance.blockers}`);
console.log(`P1 warnings: ${governance.warnings}`);
console.log(`Gate: ${strictMode ? "strict P0+P1" : "P0 only"}`);

for (const issue of governance.openP0) {
  console.log(`[P0] ${issue.key.label} (${issue.key.prefix}...): ${issue.detail}`);
  console.log(`     Actie: ${issue.action}`);
}
for (const issue of governance.openP1) {
  console.log(`[P1] ${issue.key.label} (${issue.key.prefix}...): ${issue.detail}`);
  console.log(`     Actie: ${issue.action}`);
}

if (!governance.ok) process.exit(1);
console.log(strictMode
  ? "API-key governance OK: geen P0 blockers of P1 warnings."
  : "API-key governance OK: geen P0 blockers.");
