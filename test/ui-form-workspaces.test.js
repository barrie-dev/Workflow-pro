const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "admin.css"), "utf8");

test("create- en editflows gebruiken een ruime werkruimte", () => {
  assert.match(css, /\.adm-drawer \{[^}]*width:min\(820px,calc\(100vw - 72px\)\)/);
  assert.doesNotMatch(css, /\.adm-drawer \{[^}]*width:420px/);
});

test("document- en medewerkerflows krijgen extra werkbreedte", () => {
  for (const id of ["invForm", "qForm", "woForm", "admEmpForm"]) {
    assert.match(css, new RegExp(`\\.adm-drawer:has\\(#${id}\\)`));
  }
  assert.match(css, /width:min\(1080px,calc\(100vw - 72px\)\)/);
});

test("formulieren worden op mobiel een fullscreenflow", () => {
  assert.match(css, /height:100dvh/);
  assert.match(css, /width:100vw/);
  assert.match(css, /\.adm-drawer-header h2 \{ font-size:18px/);
});
