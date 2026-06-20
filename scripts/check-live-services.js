"use strict";

const { liveServiceReadiness } = require("../src/modules/live-services");

function hasArg(name) {
  return process.argv.includes(name);
}

const jsonMode = hasArg("--json");
const strictMode = hasArg("--strict");
const payload = liveServiceReadiness();
const shouldFail = strictMode ? payload.blockers.length + payload.warnings.length > 0 : payload.blockers.length > 0;

if (jsonMode) {
  console.log(JSON.stringify({ ...payload, strict: strictMode, ok: !shouldFail }, null, 2));
  process.exit(shouldFail ? 1 : 0);
}

console.log(`WorkFlow Pro live services: ${payload.ready}/${payload.total} klaar`);
payload.groups.forEach(group => {
  console.log(`[${group.blockers ? "P0" : group.warnings ? "P1" : "OK"}] ${group.label}`);
  group.items.filter(row => !row.ok).forEach(row => {
    console.log(`  - ${row.label}: ${row.value}`);
    console.log(`    Actie: ${row.action}`);
  });
});

if (shouldFail) process.exit(1);
console.log(strictMode ? "Live services strict OK." : "Live services P0 OK.");
