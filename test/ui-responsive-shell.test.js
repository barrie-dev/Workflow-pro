"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
// Regel-eindes normaliseren: op Windows checkt git CRLF uit, waardoor regexen
// met een letterlijke \n niet matchen terwijl ze op de Linux-CI wel slagen.
const read = file => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

const html = read("public/index.html");
const css = read("public/css/monargo-design-system.css");
const shell = read("public/js/ui/responsive-shell.js");

test("de responsieve shell wordt na alle rolplatformen geladen", () => {
  const reseller = html.indexOf("/js/platforms/reseller.js");
  const responsive = html.indexOf("/js/ui/responsive-shell.js");
  assert.ok(reseller >= 0, "resellerplatform staat in index");
  assert.ok(responsive > reseller, "responsieve gedragslaag wordt als laatste geladen");
});

test("admin, manager, reseller en superadmin delen hetzelfde mobiele navigatiegedrag", () => {
  for (const selector of [
    "#platform-admin",
    "#platform-manager",
    "#platform-reseller",
    "#platform-superadmin",
    "#admSidebar",
    "#mgrSidebar",
    "#rspSidebar",
    "#saSidebar"
  ]) {
    assert.ok(shell.includes(selector), `${selector} ontbreekt in de responsieve shell`);
  }
  assert.match(shell, /aria-expanded/);
  assert.match(shell, /event\.key !== "Escape"/);
  assert.match(shell, /mn-navigation-locked/);
  assert.match(shell, /mn-nav-scrim/);
});

test("het designcontract dekt mobiel, tablet, laptop en desktop", () => {
  assert.match(css, /@media \(max-width: 1180px\)/);
  assert.match(css, /@media \(min-width: 821px\)/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /min-height: 100dvh/);
  assert.match(css, /overflow-x: clip/);
});

test("kernbediening en formulieren blijven leesbaar en touchvriendelijk", () => {
  assert.match(css, /min-height: 44px;\n  font-size: 16px;/);
  assert.match(css, /font-size: clamp\(23px, 2vw, 30px\)/);
  assert.match(css, /\[style\*="font-size:8px"\]/);
  assert.match(css, /font-size: 13px !important/);
  assert.match(css, /font-size: 14px !important/);
});

test("tabellen scrollen binnen hun module en verbreden nooit het platform", () => {
  assert.match(css, /overscroll-behavior-inline: contain/);
  assert.match(css, /-webkit-overflow-scrolling: touch/);
  assert.match(css, /\.rsp-table-wrap/);
  assert.match(css, /\.sa-tbl-wrap/);
  assert.match(css, /\.adm-table-wrap/);
});
