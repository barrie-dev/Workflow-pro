"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const source = read("public/js/platforms/admin-config-fields-workspace.js");
const admin = read("public/js/platforms/admin.js");
const css = read("public/css/admin-automation-workspace.css");
const html = read("public/index.html");
const coordination = read("docs/FRONTEND-UI-COORDINATION.md");

test("eigen velden zijn een aparte configuratiemodus", () => {
  assert.match(admin, /integrationMode: "fields"/);
  assert.match(admin, /window\.wfpConfigFieldsWorkspace\.render/);
  assert.match(admin, /\["automations", "fields"\]/);
  assert.match(html, /\/js\/platforms\/admin-config-fields-workspace\.js/);
});

test("veldbeheer gebruikt lifecycle, servervalidatie en versiecontrole", () => {
  for (const route of ["/config/fields", "/config/fields/${field.id}", "/config/fields/${field.id}/transition"]) assert.ok(source.includes(route), route);
  assert.match(source, /data\.expectedVersion = field\.version/);
  assert.match(source, /const immutable = field && field\.status !== "draft"/);
  assert.match(source, /labels: \{ nl: raw\.labelNl, fr: raw\.labelFr, en: raw\.labelEn \}/);
  assert.doesNotMatch(source, /window\.prompt|window\.confirm|localStorage/);
});

test("gepubliceerde klantvelden werken door in create, edit en detail", () => {
  assert.match(source, /async function published/);
  assert.match(source, /function renderRuntimeFields/);
  assert.match(source, /function collectRuntimeValues/);
  assert.match(source, /function renderRuntimeValues/);
  assert.match(admin, /customFieldRuntime\.published\("customer"\)/);
  assert.match(admin, /\/config\/fields\/validate/);
  assert.match(admin, /body\.expectedVersion = customer\.version/);
  assert.match(admin, /renderRuntimeValues\(customerFieldDefs, customer\.customFields/);
});

test("alle veldtypes hebben veilige native invoer en gerichte fouten", () => {
  for (const type of ["text", "number", "date", "boolean", "select", "multiselect"]) assert.ok(source.includes(`"${type}"`), type);
  assert.match(source, /data-cfw-input/);
  assert.match(source, /selectedOptions/);
  assert.match(source, /showRuntimeErrors/);
  assert.match(admin, /err\.data\?\.fieldErrors/);
});

test("configuratie en runtimevelden zijn breed en mobiel bruikbaar", () => {
  assert.match(css, /data-editor-kind="config-field"\]\{width:min\(1180px/);
  assert.match(css, /\.cfw-runtime-grid\{display:grid;grid-template-columns:repeat\(2/);
  assert.match(css, /\.cfw-runtime-grid\{grid-template-columns:1fr\}/);
  assert.match(css, /width:100vw;height:100dvh/);
});

test("frontendgrenzen van eigen velden zijn gedocumenteerd", () => {
  assert.match(coordination, /## Eigen velden - frontendintegratie 2026-07-21/);
  assert.match(coordination, /klantformulier/);
  assert.match(coordination, /projecten, werkbonnen, offertes, facturen, assets, leveranciers en werven/);
});
