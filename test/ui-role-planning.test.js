"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const manager = read("public/js/platforms/manager.js");
const employee = read("public/js/platforms/employee.js");
const css = read("public/css/monargo-design-system.css");
const i18n = read("public/js/i18n.js");

test("managerplanning toont de volledige week en gebruikt echte teamdata", () => {
  assert.match(manager, /\/manager\/planning\?from=\$\{from\}&to=\$\{to\}/);
  assert.match(manager, /\/manager\/dashboard/);
  assert.match(manager, /class="mgr-planner-head"/);
  assert.match(manager, /class="mgr-planner-cell/);
  assert.match(manager, /weekday:"short", day:"numeric", month:"short"/);
});

test("manager kan planning verslepen via de bestaande PATCH-route", () => {
  assert.match(manager, /setAttribute\("draggable", "true"\)|draggable="true"/);
  assert.match(manager, /dataTransfer\.setData\("text\/plain", pill\.dataset\.id\)/);
  assert.match(manager, /api\("PATCH", `\/planning\/\$\{shift\.id\}`, \{ userId, date \}\)/);
  assert.match(manager, /openManagerPlanningWorkspace/);
});

test("medewerkerplanning toont leesbare datums en een schermvullend detail", () => {
  assert.match(employee, /class="emp-day-pill/);
  assert.match(employee, /weekday:"short"/);
  assert.match(employee, /data-emp-shift=/);
  assert.match(employee, /openEmployeePlanningDetail/);
  assert.match(employee, /mn-workspace-overlay emp-planning-detail/);
});

test("planning voor Manager en Medewerker heeft responsive werkruimtecontracten", () => {
  assert.match(css, /#platform-manager \.mgr-planner-scroll/);
  assert.match(css, /\.mgr-planning-workspace \.mgr-planning-detail-grid/);
  assert.match(css, /#platform-employee \.emp-day-strip/);
  assert.match(css, /\.emp-planning-detail \.emp-planning-detail-grid/);
  assert.match(css, /grid-template-columns: 156px repeat\(var\(--mgr-day-count\), minmax\(132px, 1fr\)\)/);
});

test("nieuwe planningteksten zijn in drie talen beschikbaar", () => {
  assert.equal((i18n.match(/"mgr\.plan\.subtitle":/g) || []).length, 3);
  assert.equal((i18n.match(/"emp\.plan\.readyText":/g) || []).length, 3);
});
