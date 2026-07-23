"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const html = read("public/index.html");
const css = read("public/css/monargo-design-system.css");

test("designsysteem wordt na de bestaande platformstijlen geladen", () => {
  const legacy = html.indexOf("/css/admin-product-ui.css");
  const designSystem = html.indexOf("/css/monargo-design-system.css");
  assert.ok(legacy >= 0, "bestaande platformstijl staat in index.html");
  assert.ok(designSystem > legacy, "canonieke designlaag wordt als laatste geladen");
});

test("Monargo Blue en de vaste SaaS-ruimte zijn canonieke tokens", () => {
  assert.match(css, /--mn-brand:\s*#0071e3;/i);
  assert.match(css, /--mn-page-padding:\s*32px;/);
  assert.match(css, /--mn-space-6:\s*24px;/);
  assert.match(css, /--mn-sidebar:\s*#0b1320;/i);
  assert.match(css, /--wf-blue:\s*var\(--mn-brand\);/);
  assert.match(css, /--wf-purple:\s*var\(--mn-brand\);/);
});

test("gedeelde componentcontracten dekken werkpagina, kaarten, tabellen en status", () => {
  for (const component of [
    ".mn-page",
    ".mn-card",
    ".mn-btn-primary",
    ".mn-field",
    ".mn-table",
    ".mn-status",
    ".mn-empty",
    ".mn-workspace-overlay"
  ]) {
    assert.ok(css.includes(component), `${component} ontbreekt`);
  }
});

test("alle vijf platformen zijn op de gedeelde visuele laag aangesloten", () => {
  for (const platform of [
    "#platform-admin",
    "#platform-manager",
    "#platform-employee",
    "#platform-reseller",
    "#platform-superadmin"
  ]) {
    assert.ok(css.includes(platform), `${platform} ontbreekt in de platformbrug`);
  }
});

test("alle platformshells gebruiken het officiële Monargo-symbool", () => {
  for (const file of [
    "public/js/platforms/admin.js",
    "public/js/platforms/manager.js",
    "public/js/platforms/employee.js",
    "public/js/platforms/reseller.js",
    "public/js/platforms/superadmin.js"
  ]) {
    assert.match(read(file), /\/brand\/one-symbol\.svg/, file);
  }
  assert.doesNotMatch(read("public/js/platforms/manager.js"), /class="mgr-logo-mark">M</);
  assert.doesNotMatch(read("public/js/platforms/reseller.js"), /class="rsp-mark">M</);
  assert.doesNotMatch(read("public/js/platforms/superadmin.js"), /class="sa-brand-mark">SA</);
});

test("designsysteem respecteert mobiel en verminderde beweging", () => {
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /--mn-control-height-touch:\s*44px;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
