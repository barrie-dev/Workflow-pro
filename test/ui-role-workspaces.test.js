const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manager = fs.readFileSync(path.join(__dirname, "..", "public", "js", "platforms", "manager.js"), "utf8");
const employee = fs.readFileSync(path.join(__dirname, "..", "public", "js", "platforms", "employee.js"), "utf8");

test("managercockpit gebruikt leesbare dagelijkse informatie", () => {
  assert.match(manager, /\.mgr-focus-btn strong \{[^}]*font-size:14px/);
  assert.match(manager, /\.mgr-kpi-label \{[^}]*font-size:12px/);
  assert.match(manager, /\.mgr-table td \{[^}]*font-size:14px/);
  assert.doesNotMatch(manager, /\.mgr-focus-btn small \{[^}]*font-size:7\.5px/);
});

test("managerformulieren openen als ruime workspaces", () => {
  assert.match(manager, /#mgrShiftModal>div[^\n]*width:min\(760px/);
  assert.match(manager, /max-height:calc\(100dvh - 24px\)/);
});

test("medewerkerflows blijven leesbaar en touchvriendelijk", () => {
  assert.match(employee, /\.emp-wo-flow span \{[^}]*font-size:12px/);
  assert.match(employee, /\.emp-form-group label \{[^}]*font-size: 14px/);
  assert.match(employee, /width: min\(720px, calc\(100vw - 64px\)\)/);
  assert.match(employee, /\.emp-tab \{ min-height:42px/);
});
