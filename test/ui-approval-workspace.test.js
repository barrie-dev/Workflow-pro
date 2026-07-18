const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "admin.css"), "utf8");

test("approval workspace blijft beperkt tot onkosten en verlof", () => {
  assert.match(css, /Monargo approval workspace/);
  assert.match(css, /\.adm-main\[data-view="leaves"\]/);
  assert.match(css, /\.adm-main\[data-view="expenses"\]/);
});

test("openstaande beslissingen krijgen visuele prioriteit", () => {
  assert.match(css, /#admLeaveTable tbody tr:has\(\.adm-leave-action\)/);
  assert.match(css, /#admExpTable tbody tr:has\(\.adm-exp-review\)/);
  assert.match(css, /box-shadow:inset 3px 0 #e6aa35/);
});

test("approval workspace blijft leesbaar op tablet en mobiel", () => {
  assert.match(css, /@media \(max-width:900px\)/);
  assert.match(css, /@media \(max-width:600px\)/);
  assert.match(css, /#admLeaveBody div\[style\*="font-size:10px"\] \{ font-size:12px !important/);
  assert.match(css, /\.adm-main\[data-view="expenses"\] \.adm-kpis \{ grid-template-columns:1fr; \}/);
});
