"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "public", "js", "platforms", "admin.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "css", "admin.css"), "utf8");

test("integratiecentrum toont gezondheid, catalogus en één leesbaar detail", () => {
  assert.match(source, /adm-integration-health/);
  assert.match(source, /Koppelingen zonder giswerk/);
  assert.match(source, /data-provider-select/);
  assert.match(source, /Recente synchronisaties/);
  assert.match(css, /\.adm-integration-layout/);
  assert.match(css, /grid-template-columns:minmax\(360px,\.8fr\) minmax\(520px,1\.35fr\)/);
});

test("connectorconfiguratie gebruikt de ruime editor en geen browserprompt", () => {
  assert.match(source, /function openIntegrationEditor\(provider, conn\)/);
  assert.match(source, /id="integrationEditorForm"/);
  assert.match(source, /id="integrationMappingRows"/);
  assert.doesNotMatch(source, /window\.prompt\(`Nieuwe \$\{p\.label/);
  assert.match(source, /Laat leeg om de huidige sleutel te behouden/);
});

test("mapping en mislukte synchronisaties hebben echte vervolgacties", () => {
  assert.match(source, /data-retry-sync/);
  assert.match(source, /\/integrations\/\$\{btn\.dataset\.retrySync\}\/retry/);
  assert.match(source, /fieldMapping\.some\(row => !row\.local \|\| !row\.remote\)/);
  assert.match(css, /\.adm-integration-map-row/);
  assert.match(css, /@media \(max-width:560px\)[\s\S]*\.adm-integration-map-row/);
});
