"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const admin = fs.readFileSync(path.join(__dirname, "..", "public", "js", "platforms", "admin.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "admin.css"), "utf8");

test("voorraad-UI gebruikt het actuele backendcontract", () => {
  assert.match(admin, /summary = data\.summary/);
  assert.match(admin, /stockNum\(item\.qty\)/);
  assert.match(admin, /item\.minQty/);
  assert.match(admin, /item\.maxQty/);
  assert.doesNotMatch(admin.slice(admin.indexOf("// ── Stock"), admin.indexOf("// ── Factuur PDF afdrukken")), /item\.quantity|item\.minQuantity|unitPrice/);
});

test("mutaties hebben een expliciet type en bewaren operationele koppelingen", () => {
  assert.match(admin, /name="type" id="mutType"/);
  assert.match(admin, /workorderId: raw\.workorderId \|\| null/);
  assert.match(admin, /venueId: raw\.venueId \|\| null/);
  assert.match(admin, /\/stock\/\$\{item\.id\}\/mutations/);
  assert.match(admin, /\/stock\/mutations\/\$\{button\.dataset\.id\}\/release/);
});

test("artikeldetail en formulieren zijn ruime, leesbare workspaces", () => {
  assert.match(admin, /id="stDetail" class="stock-detail"/);
  assert.match(admin, /Mutatiehistoriek/);
  assert.match(css, /\.adm-drawer:has\(#stDetail\)/);
  assert.match(css, /width:min\(1120px,calc\(100vw - 72px\)\)/);
  assert.match(css, /\.stock-form \.adm-form-group input/);
  assert.match(css, /min-height:46px; font-size:14px/);
});

test("gemengde voorraadeenheden worden niet als fictieve totaalwaarde opgeteld", () => {
  const stockSection = admin.slice(admin.indexOf("// ── Stock"), admin.indexOf("// ── Factuur PDF afdrukken"));
  assert.doesNotMatch(stockSection, /Totale stockwaarde|totalValue|Prijs\/stuk/);
  assert.match(stockSection, /Fysieke voorraad, reservaties en beschikbaarheid/);
});
