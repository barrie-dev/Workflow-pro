"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const source = read("public/js/platforms/reseller.js");
const shell = read("public/js/ui/responsive-shell.js");
const css = read("public/css/monargo-design-system.css");
const i18n = read("public/js/i18n.js");

test("reseller heeft volwaardige modules in plaats van één lange portalpagina", () => {
  for (const view of ["dashboard", "clients", "commission", "onboarding"]) {
    assert.match(source, new RegExp(`data-rsp-view="${view}"`));
    assert.match(source, new RegExp(`${view}: render`, "i"));
  }
  assert.match(source, /function switchView\(view\)/);
  assert.match(source, /rsp-page-head/);
});

test("resellermodules gebruiken uitsluitend bestaande commerciële API-routes", () => {
  assert.match(source, /api\("GET", "\/api\/reseller\/clients"\)/);
  assert.match(source, /api\("GET", "\/api\/reseller\/commission"\)/);
  assert.match(source, /api\("POST", "\/api\/reseller\/clients", payload\)/);
  assert.doesNotMatch(source, /\/api\/tenants\/\$\{/);
  assert.match(source, /operationele klant- of personeelsgegevens/);
});

test("reseller deelt mobiel navigatiegedrag en responsieve schermcontracten", () => {
  for (const marker of [
    "#platform-reseller",
    "#rspSidebar",
    "#rspMenuBtn",
    ".rsp-nav-item[data-rsp-view]"
  ]) assert.ok(shell.includes(marker), `${marker} ontbreekt in de responsieve shell`);
  assert.match(css, /#platform-reseller \.rsp-layout/);
  assert.match(css, /#platform-reseller \.rsp-sidebar\.open/);
  assert.match(css, /#platform-reseller \.rsp-dashboard-grid/);
  assert.match(css, /#platform-reseller \.rsp-onboarding-layout/);
  assert.match(css, /#platform-reseller \.rsp-table-wrap/);
  assert.match(css, /@media \(max-width: 600px\)/);
});

test("nieuwe resellerteksten zijn beschikbaar in NL, FR en EN", () => {
  for (const key of [
    "rsp.dashboard",
    "rsp.partnerWorkspace",
    "rsp.commission",
    "rsp.payableBalance",
    "rsp.clientDetails",
    "rsp.privacyTitle"
  ]) {
    assert.equal((i18n.match(new RegExp(`"${key.replace(".", "\\.")}"`, "g")) || []).length, 3, `${key} ontbreekt in een taal`);
  }
});
