const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "admin.css"), "utf8");

test("managementrapportage gebruikt een eigen Intelligence-workspace", () => {
  assert.match(css, /Monargo Intelligence workspace · managementrapportage/);
  assert.match(css, /\.adm-main\[data-view="reports"\]/);
  assert.match(css, /--intel-blue:var\(--wf-blue\)/);
});

test("periode, beslissersrapport en KPI's blijven visueel leidend", () => {
  assert.match(css, /#repFrom,/);
  assert.match(css, /#repBeslissers \{ min-height:40px/);
  assert.match(css, /#repKpis \.adm-kpi \{ min-height:126px/);
  assert.match(css, /#repKpis\+div\[style\*="grid-template-columns:1fr 1fr"\]/);
});

test("rapportage herschikt naar één kolom op mobiel", () => {
  assert.match(css, /@media \(max-width:780px\)/);
  assert.match(css, /grid-template-columns:1fr !important/);
  assert.match(css, /#repLoad,/);
  assert.match(css, /#repKpis \{ grid-template-columns:1fr !important; \}/);
});
