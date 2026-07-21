"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const source = read("public/js/platforms/admin-product-workspaces.js");
const admin = read("public/js/platforms/admin.js");
const css = read("public/css/admin-product-workspaces.css");
const html = read("public/index.html");
const i18n = read("public/js/i18n.js");
const coordination = read("docs/FRONTEND-UI-COORDINATION.md");

const views = ["projects", "worksites", "contracts", "purchasing", "inventory", "assets"];

test("actieve productmodules zijn zichtbaar en registreren een echte werkruimte", () => {
  for (const view of views) {
    assert.match(admin, new RegExp(`data-view="${view}"`), `${view} ontbreekt in de navigatie`);
    assert.match(source, new RegExp(`${view}: render[A-Z]`), `${view} registreert geen renderer`);
  }
  assert.match(html, /\/css\/admin-product-workspaces\.css/);
  assert.match(html, /\/js\/platforms\/admin-product-workspaces\.js/);
});

test("projectdossier verbindt de dagelijkse uitvoeringsflow", () => {
  assert.match(admin, /view:"customers"[\s\S]*view:"projects"[\s\S]*view:"planning"[\s\S]*view:"workorders"[\s\S]*view:"facturen"/);
  assert.match(source, /\/projects\/\$\{id\}\/finance/);
  assert.match(source, /\/projects\/\$\{project\.id\}\/transition/);
  assert.match(source, /A\.drawers\.shift\(\{ projectId: project\.id/);
  assert.match(source, /A\.drawers\.workorder\(\{ projectId: project\.id/);
  assert.match(source, /purchaseProjectPrefill = project\.id/);
});

test("contracten, aankoop en voorraad gebruiken de bestaande domeinacties", () => {
  for (const route of [
    "/contracts/${contract.id}/index",
    "/contracts/${contract.id}/generate",
    "/purchase_orders/${order.id}/transition",
    "/purchase_orders/${order.id}/receive",
    "/inventory/levels",
    "/inventory/movements?limit=200",
    "/inventory/reservations?status=all",
    "/inventory/transfer",
    "/inventory/count",
  ]) assert.ok(source.includes(route), route);
  assert.match(source, /receipts = \[\.\.\.form\.querySelectorAll\("\[data-receipt-line\]"\)\]/);
  assert.match(source, /data\.expectedVersion = order\.version/);
});

test("assets en onderhoud genereren werk via de server", () => {
  for (const route of ["/assets", "/maintenance/plans", "/maintenance/due", "/maintenance/plans/${planId}/generate"]) assert.ok(source.includes(route), route);
  assert.match(source, /result\.alreadyGenerated/);
  assert.match(source, /data\.expectedVersion = plan\.version/);
});

test("werven bevatten de volledige meerwerk- en minderwerkflow", () => {
  for (const route of ["/changeorders", "/changeorders/${change.id}", "/changeorders/${change.id}/transition"]) assert.ok(source.includes(route), route);
  assert.match(source, /const CHANGE_TRANSITIONS =/);
  assert.match(source, /data\.expectedVersion = change\.version/);
  assert.match(source, /Totalen, btw, soort en budgetimpact worden uitsluitend door de backend berekend/);
  assert.match(admin, /drawer: "changeorder"/);
});

test("schrijfflows bewaren serverwaarheid en vermijden browserprompts", () => {
  assert.match(source, /codeOf\(error\) === "VERSION_CONFLICT"/);
  assert.match(source, /currentVersion/);
  assert.match(source, /function openReasonEditor/);
  assert.doesNotMatch(source, /window\.prompt/);
  assert.doesNotMatch(source, /localStorage/);
});

test("werkruimtes blijven ruim op desktop en schermvullend op mobiel", () => {
  assert.match(css, /\.pws-workspace\{width:min\(1540px,100%\)/);
  assert.match(css, /data-editor-kind="product-wide"\]\{width:min\(1280px/);
  assert.match(css, /\.pws-line\.pws-change-line/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /width:100vw;height:100dvh/);
  assert.match(css, /@media\(max-width:480px\)/);
});

test("nieuwe navigatielabels zijn beschikbaar in drie talen", () => {
  for (const view of views) {
    const occurrences = [...i18n.matchAll(new RegExp(`"nav\\.${view}"`, "g"))].length;
    assert.equal(occurrences, 3, `nav.${view} moet NL, FR en EN hebben`);
  }
});

test("backendgrenzen en overdracht zijn gedocumenteerd", () => {
  assert.match(coordination, /## Productwerkruimtes voor actieve backendmodules - frontendintegratie 2026-07-21/);
  assert.match(coordination, /voorraadcorrecties onveranderlijk/);
  assert.match(coordination, /allowedTransitions/);
  assert.match(coordination, /klant -> project -> planning -> werkbon -> factuur/);
});
