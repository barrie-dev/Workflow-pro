const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "admin.css"), "utf8");

test("instellingen gebruiken een eigen Control Center", () => {
  assert.match(css, /Monargo Control Center · instellingen en security/);
  assert.match(css, /\.adm-main\[data-view="settings"\]/);
  assert.match(css, /--control-blue:var\(--wf-blue\)/);
});

test("security- en toestemmingskaarten hebben een duidelijke hiërarchie", () => {
  assert.match(css, /\.adm-card:has\(#admMfaStatus\)::before/);
  assert.match(css, /\.adm-card:has\(#admSupportStatus\)::before/);
  assert.match(css, /#admBackupPolicy \{ padding:18px !important/);
});

test("rechtenmatrix blijft leesbaar op desktop en mobiel", () => {
  assert.match(css, /#admEmpPerms>label \{ min-height:48px/);
  assert.match(css, /#admEmpPerms \.adm-perm \{ width:132px !important/);
  assert.match(css, /#admEmpPerms \{ grid-template-columns:1fr !important; \}/);
});
