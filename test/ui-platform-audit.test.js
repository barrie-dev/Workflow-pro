const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const styles = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
const admin = fs.readFileSync(path.join(__dirname, "..", "public", "css", "admin.css"), "utf8");
const manager = fs.readFileSync(path.join(__dirname, "..", "public", "js", "platforms", "manager.js"), "utf8");
const employee = fs.readFileSync(path.join(__dirname, "..", "public", "js", "platforms", "employee.js"), "utf8");

test("tenantplatformen hebben een vangnet tegen legacy microtekst", () => {
  assert.match(styles, /:is\(#platform-admin,#platform-manager,#platform-employee\)/);
  assert.match(styles, /\[style\*="font-size:7px"\]/);
  assert.match(styles, /font-size:12px !important/);
  assert.match(styles, /font-size:12\.5px !important/);
});

test("kleine inline acties behouden een bruikbaar touchdoel", () => {
  assert.match(styles, /button:is\(/);
  assert.match(styles, /min-height:36px !important/);
});

test("alle primaire rolworkspaces hebben hun expliciete leesbaarheidsschaal", () => {
  assert.match(admin, /Monargo leesbaarheidsschaal/);
  assert.match(manager, /\.mgr-table td \{[^}]*font-size:14px/);
  assert.match(employee, /\.emp-form-group label \{[^}]*font-size: 14px/);
});
