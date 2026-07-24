"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
// Regel-eindes normaliseren: op Windows checkt git CRLF uit, waardoor regexen
// met een letterlijke \n niet matchen terwijl ze op de Linux-CI wel slagen.
const read = file => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

const admin = fs.readFileSync(path.join(root, "public/js/platforms/admin.js"), "utf8");
const css = read("public/css/monargo-design-system.css");
const i18n = read("public/js/i18n.js");

test("Operaties is een echte adminmodule met de goedgekeurde submodules", () => {
  assert.match(admin, /fallback:"Operaties", views:\["operations", "planning", "workorders", "projects", "worksites", "vehicles", "stock"/);
  assert.match(admin, /data-i18n="nav\.operationsOverview"/);
  assert.match(admin, /operations: renderOperationsOverview/);
});

test("het operatieoverzicht gebruikt uitsluitend bestaande backenddomeinen", () => {
  // De eindmarkering was "// ── Dashboard"; dat blok is naar een eigen module
  // verhuisd. Zonder deze correctie loopt de slice tot het einde van het
  // bestand en toetst hij dus heel admin.js in plaats van dit ene scherm ·
  // een test die te veel leest, faalt op andermans code.
  const start = admin.indexOf("async function renderOperationsOverview");
  const eind = admin.indexOf("// ── Clocking", start);
  assert.ok(start > -1 && eind > start, "de operatieoverzicht-sectie is niet af te bakenen");
  const overview = admin.slice(start, eind);
  for (const route of [
    '"/planning"',
    '"/workorders"',
    '"/projects"',
    '"/worksites"',
    '"/vehicles"',
    '"/stock"'
  ]) {
    assert.ok(overview.includes(route), `${route} ontbreekt in het operatieoverzicht`);
  }
  assert.doesNotMatch(overview, /fake|mock/i);
});

test("het operatieoverzicht heeft een ruime desktop- en mobiele compositie", () => {
  assert.match(css, /#platform-admin \.adm-operations-hero/);
  assert.match(css, /#platform-admin \.adm-operation-modules/);
  assert.match(css, /#platform-admin \.adm-operations-detail-grid/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /#platform-admin \.adm-operation-module \{\n    min-height: 112px;/);
});

test("nieuwe operatieteksten bestaan in NL, FR en EN", () => {
  assert.equal((i18n.match(/"adm\.operations\.title":/g) || []).length, 3);
  assert.equal((i18n.match(/"nav\.sec\.team":/g) || []).length, 3);
  assert.equal((i18n.match(/"nav\.operationsOverview":/g) || []).length, 3);
});
