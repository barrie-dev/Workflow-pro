const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "admin.css"), "utf8");

test("operations workspace blijft beperkt tot stock en wagenpark", () => {
  assert.match(css, /Monargo operations workspace · stock en wagenpark/);
  assert.match(css, /\.adm-main\[data-view="stock"\]/);
  assert.match(css, /\.adm-main\[data-view="vehicles"\]/);
});

test("voorraad- en onderhoudsafwijkingen zijn scanbaar", () => {
  assert.match(css, /\.st-row\[style\*="background"\] td:first-child/);
  assert.match(css, /\.veh-row:has\(\.adm-status-maintenance\) td:first-child/);
  assert.match(css, /box-shadow:inset 3px 0 #cf4f60/);
  assert.match(css, /box-shadow:inset 3px 0 #d29a2e/);
});

test("stock en wagenpark blijven leesbaar op mobiel", () => {
  assert.match(css, /#stSearch \{ min-width:280px !important; min-height:42px/);
  assert.match(css, /@media \(max-width:600px\)/);
  assert.match(css, /\.adm-main\[data-view="stock"\] \.adm-kpis \{ grid-template-columns:1fr; \}/);
  assert.match(css, /\.adm-main\[data-view="stock"\] #stSearch \{ width:100%; min-width:0 !important; \}/);
});
