const { productionConfigRisk } = require("../src/modules/production");

const jsonMode = process.argv.includes("--json");
const strictMode = process.argv.includes("--strict");
const configRisk = productionConfigRisk();
const openRows = configRisk.rows.filter(row => !row.ok);
const warnings = strictMode ? openRows : openRows.filter(row => [
  "app_url",
  "release_metadata"
].includes(row.key));
const blockers = strictMode ? [] : openRows.filter(row => ![
  "app_url",
  "release_metadata"
].includes(row.key));
const shouldFail = strictMode ? openRows.length > 0 : blockers.length > 0;

if (jsonMode) {
  console.log(JSON.stringify({
    ok: !shouldFail,
    strict: strictMode,
    ready: configRisk.ready,
    total: configRisk.total,
    missing: configRisk.missing,
    blockers,
    warnings,
    generatedAt: new Date().toISOString()
  }, null, 2));
  process.exit(shouldFail ? 1 : 0);
}

console.log(`WorkFlow Pro production config: ${configRisk.ready}/${configRisk.total} klaar`);
console.log(`Open config-items: ${configRisk.missing}`);
console.log(`Gate: ${strictMode ? "strict alle config" : "deployment blockers"}`);

if (blockers.length) {
  console.log("\nBlockers");
  blockers.forEach(row => {
    console.log(`[P0] ${row.label}: ${row.required} is ${row.value}`);
    console.log(`     Actie: ${row.action}`);
  });
}

if (warnings.length) {
  console.log("\nWarnings");
  warnings.forEach(row => {
    console.log(`[P1] ${row.label}: ${row.required} is ${row.value}`);
    console.log(`     Actie: ${row.action}`);
  });
}

if (shouldFail) process.exit(1);
console.log(strictMode
  ? "Production config OK: alle config-items zijn klaar."
  : "Production config OK: geen deployment blockers.");
