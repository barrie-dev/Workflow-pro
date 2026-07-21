"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const source = read("public/js/platforms/admin-automation-workspace.js");
const admin = read("public/js/platforms/admin.js");
const css = read("public/css/admin-automation-workspace.css");
const html = read("public/index.html");
const coordination = read("docs/FRONTEND-UI-COORDINATION.md");

test("automatisaties zijn een volwaardige modus binnen Koppelingen", () => {
  assert.match(admin, /let _integrationMode = "connectors"/);
  assert.match(admin, /window\.wfpAutomationWorkspace\.render/);
  assert.match(admin, /integrationMode: "automations"/);
  assert.match(html, /\/css\/admin-automation-workspace\.css/);
  assert.match(html, /\/js\/platforms\/admin-automation-workspace\.js/);
});

test("flowlijst en uitvoeringshistoriek gebruiken de bestaande backendcontracten", () => {
  for (const route of ["/automation/flows", "/automation/runs?limit=100", "/automation/flows/${flow.id}/transition", "/automation/flows/${flow.id}/simulate"]) assert.ok(source.includes(route), route);
  assert.match(source, /state\.tab === "runs"/);
  assert.match(source, /flowVersion/);
  assert.match(source, /aggregateId/);
});

test("flowbuilder ondersteunt voorwaarden, acties, versiecontrole en goedkeuringsgrenzen", () => {
  assert.match(source, /const CONDITION_OPS/);
  assert.match(source, /const ACTION_TYPES/);
  assert.match(source, /data\.expectedVersion = flow\.version/);
  assert.match(source, /requires_approval/);
  assert.match(source, /Geen productiedata gewijzigd/);
  assert.doesNotMatch(source, /window\.prompt|window\.confirm|localStorage/);
});

test("automation editors zijn ruim en mobiel schermvullend", () => {
  assert.match(css, /data-editor-kind="automation-wide"\]\{width:min\(1320px/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /width:100vw;height:100dvh/);
  assert.match(css, /\.aws-builder-row/);
});

test("frontendgrenzen voor automatisaties zijn gedocumenteerd", () => {
  assert.match(coordination, /## Automatisaties - frontendintegratie 2026-07-21/);
  assert.match(coordination, /lusdetectie/);
  assert.match(coordination, /menselijke goedkeuring/);
});
