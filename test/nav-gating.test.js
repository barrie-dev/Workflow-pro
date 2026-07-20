"use strict";
// Vangnet tegen "onzichtbare features": elk nav-item in een shell moet ofwel een
// bestaande catalogus-view hebben (anders verbergt applyEntitlements het), ofwel
// expliciet in de alwaysShow/alias-uitzondering van die shell staan.
// Dit ving de 'myboard'-bug: een gebouwd scherm dat door de nav-gating verdween.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const catalog = read("src/modules/catalog.js");
// Zowel de hoofdview als extraViews tellen mee: de entitlements-resolver stelt
// beide bloot (zie entitlements.js · viewsOf), dus de nav-gating dekt ze ook.
const catalogViews = new Set([
  ...[...catalog.matchAll(/view:\s*"([a-z_-]+)"/g)].map(m => m[1]),
  ...[...catalog.matchAll(/extraViews:\s*\[([^\]]*)\]/g)].flatMap(m => [...m[1].matchAll(/"([a-z_-]+)"/g)].map(x => x[1])),
]);

function navViews(file, navClass) {
  const re = new RegExp(`${navClass}[^>]*?data-view="([a-z_]+)"`, "g");
  return [...new Set([...read(file).matchAll(re)].map(m => m[1]))];
}
function setFrom(file, name) {
  const m = read(file).match(new RegExp(`${name}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]`));
  return new Set(m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map(x => x[1]) : []);
}
function aliasMap(file) {
  const m = read(file).match(/alias\s*=\s*\{([^}]*)\}/);
  const map = {};
  if (m) for (const a of m[1].matchAll(/(\w+):\s*"([a-z_]+)"/g)) map[a[1]] = a[2];
  return map;
}

test("nav-gating: admin — nav-item zit in catalogus of is een expliciete shell-view", () => {
  const file = "public/js/platforms/admin.js";
  const always = setFrom(file, "CORE_UI_VIEWS");
  const missing = navViews(file, "adm-nav-item").filter(v => !catalogViews.has(v) && !always.has(v));
  assert.deepEqual(missing, [], `admin nav-items zonder dekking: ${missing.join(", ")}`);
});

test("nav-gating: manager — nav-item in catalogus of alwaysShow", () => {
  const file = "public/js/platforms/manager.js";
  const always = setFrom(file, "alwaysShow");
  const missing = navViews(file, "mgr-nav-item").filter(v => !catalogViews.has(v) && !always.has(v));
  assert.deepEqual(missing, [], `manager nav-items zonder dekking: ${missing.join(", ")}`);
});

test("nav-gating: employee — tab in catalogus (via alias) of alwaysShow", () => {
  const file = "public/js/platforms/employee.js";
  const always = setFrom(file, "alwaysShow");
  const alias = aliasMap(file);
  const missing = navViews(file, "emp-tab").filter(v => !catalogViews.has(alias[v] || v) && !always.has(v));
  assert.deepEqual(missing, [], `employee tabs zonder dekking: ${missing.join(", ")}`);
});

test("nav-gating: catalogus-views aanwezig (sanity)", () => {
  assert.ok(catalogViews.has("dashboard"), "kern-view dashboard moet in de catalogus staan");
});
