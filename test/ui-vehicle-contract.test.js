"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const admin = fs.readFileSync(path.join(__dirname, "..", "public", "js", "platforms", "admin.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "admin.css"), "utf8");
const section = admin.slice(admin.indexOf("// ── Voertuigen"), admin.indexOf("// ── Stock"));

test("wagenpark-UI gebruikt model, nummerplaat en canonieke statussen", () => {
  assert.match(section, /name="model"/);
  assert.match(section, /name="plate"/);
  assert.match(section, /value="actief"/);
  assert.match(section, /value="in_onderhoud"/);
  assert.match(section, /value="buiten_dienst"/);
  assert.match(section, /value="verkocht"/);
  assert.doesNotMatch(section, /value="active"|value="maintenance"|value="inactive"/);
});

test("kilometerregistratie verstuurt het backendveld mileage", () => {
  assert.match(section, /name="mileage"/);
  assert.match(section, /mileage: Number\(raw\.mileage\)/);
  assert.match(section, /\/vehicles\/\$\{vehicle\.id\}\/mileage/);
  assert.doesNotMatch(section, /startKm|endKm/);
});

test("service, keuring en verzekering zijn volwaardige voertuigflows", () => {
  assert.match(section, /\/vehicles\/\$\{vehicle\.id\}\/service/);
  assert.match(section, /name="inspectionDate"/);
  assert.match(section, /name="insuranceExpiry"/);
  assert.match(section, /name="insuranceCompany"/);
  assert.match(section, /vehicle\.mileageLogs/);
});

test("voertuigformulieren en detail zijn ruime leesbare workspaces", () => {
  assert.match(section, /id="vehDetail"/);
  assert.match(css, /\.adm-drawer:has\(#vehDetail\)/);
  assert.match(css, /width:min\(1120px,calc\(100vw - 72px\)\)/);
  assert.match(css, /\.vehicle-form \.adm-form-group input/);
  assert.match(css, /min-height:46px; font-size:14px/);
});
