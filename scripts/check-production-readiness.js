const { Store } = require("../src/lib/store");
const { productionReadiness } = require("../src/modules/production");
const { runLiveDomainPreflights } = require("./lib/live-domain-preflights");

const jsonMode = process.argv.includes("--json");
const strictMode = process.argv.includes("--strict");

function printCheck(row) {
  const marker = row.ok ? "OK" : row.priority;
  console.log(`[${marker}] ${row.label}: ${row.detail}`);
}

const store = new Store();
const readiness = productionReadiness(store);
const liveDomainPreflights = runLiveDomainPreflights();
const openP0 = readiness.checks.filter(row => !row.ok && row.priority === "P0");
const openP1 = readiness.checks.filter(row => !row.ok && row.priority === "P1");
const failedLiveDomainPreflights = liveDomainPreflights.filter(row => !row.ok);
const shouldFail = openP0.length > 0 || failedLiveDomainPreflights.length > 0 || (strictMode && openP1.length > 0);

if (jsonMode) {
  console.log(JSON.stringify({
    ok: !shouldFail,
    strict: strictMode,
    score: readiness.score,
    blockers: openP0.length,
    warnings: openP1.length,
    liveDomainPreflights,
    failedLiveDomainPreflights,
    generatedAt: readiness.generatedAt,
    openP0,
    openP1
  }, null, 2));
  process.exit(shouldFail ? 1 : 0);
}

console.log(`WorkFlow Pro production readiness: ${readiness.score}%`);
console.log(`P0 blockers: ${openP0.length}`);
console.log(`P1 warnings: ${openP1.length}`);
console.log(`Live domain preflights: ${liveDomainPreflights.filter(row => row.ok).length}/${liveDomainPreflights.length}`);
console.log(`Gate: ${strictMode ? "strict P0+P1" : "P0 only"}`);

if (openP0.length) {
  console.log("\nP0 blockers");
  openP0.forEach(printCheck);
}

if (openP1.length) {
  console.log("\nP1 warnings");
  openP1.forEach(printCheck);
}

if (failedLiveDomainPreflights.length) {
  console.log("\nLive domain preflight failures");
  failedLiveDomainPreflights.forEach(row => console.log(`[P0] ${row.label}: ${row.detail}`));
}

if (shouldFail) {
  process.exit(1);
}

console.log(strictMode
  ? "\nProduction preflight OK: geen P0 blockers, geen P1 warnings en alle live domain preflights groen."
  : "\nProduction preflight OK: geen P0 blockers en alle live domain preflights groen.");
