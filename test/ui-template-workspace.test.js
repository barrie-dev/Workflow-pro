"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const admin = fs.readFileSync(path.join(__dirname, "..", "public", "js", "platforms", "admin.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "admin.css"), "utf8");
const section = admin.slice(admin.indexOf("// ── Documentsjablonen"), admin.indexOf("// ── Compliance: Checkin@Work"));

test("nieuw documentontwerp start met geldige Monargo-kleur", () => {
  assert.match(section, /accentColor: "#0071E3"/);
  assert.match(section, /d\.accentColor : "#0071E3"/);
  assert.doesNotMatch(section, /value="\$\{esc\(d\.accentColor \|\| "var\(--wf-blue\)"\)\}"/);
});

test("documentsjablonen hebben een ruime editor met live voorbeeld", () => {
  assert.match(section, /class="adm-grid-2 template-editor-grid"/);
  assert.match(section, /class="adm-card template-editor-form"/);
  assert.match(section, /class="adm-card template-preview-card"/);
  assert.match(section, /class="template-preview-frame"/);
  assert.match(section, /title="Live documentvoorbeeld"/);
});

test("documenteditor blijft leesbaar op desktop en mobiel", () => {
  assert.match(css, /\.template-editor-grid \{ grid-template-columns:minmax\(420px,.88fr\) minmax\(520px,1.12fr\)/);
  assert.match(css, /\.template-editor-form \.adm-input \{ min-height:46px; font-size:14px/);
  assert.match(css, /\.template-preview-frame \{ display:block; width:100%; height:720px/);
  assert.match(css, /@media \(max-width:1100px\)/);
  assert.match(css, /\.template-editor-grid \{ grid-template-columns:1fr; \}/);
});
