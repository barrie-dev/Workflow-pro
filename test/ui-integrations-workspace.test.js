const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "admin.css"), "utf8");

test("integraties gebruiken een eigen betrouwbaar Integration Center", () => {
  assert.match(css, /Monargo Integration Center/);
  assert.match(css, /\.adm-main\[data-view="integrations"\]/);
  assert.match(css, /--connect-blue:var\(--wf-blue\)/);
});

test("providerstatus en acties blijven per kaart scanbaar", () => {
  assert.match(css, /\.adm-grid-2>\.adm-card:has\(\.adm-status-active\)/);
  assert.match(css, /form\[data-connect\] \{ height:100%; display:flex; flex-direction:column; \}/);
  assert.match(css, /\.adm-card-body>div\[style\*="display:flex"\] \.adm-btn \{ min-height:37px; \}/);
});

test("integratiekaarten schakelen mobiel naar één kolom", () => {
  assert.match(css, /@media \(max-width:900px\)/);
  assert.match(css, /\.adm-main\[data-view="integrations"\] \.adm-grid-2 \{ grid-template-columns:1fr; \}/);
  assert.match(css, /\.adm-main\[data-view="integrations"\] \.adm-page-title \{ font-size:23px; \}/);
});
