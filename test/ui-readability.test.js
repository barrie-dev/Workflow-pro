"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "public/css/admin.css"), "utf8");
const marker = "Monargo leesbaarheidsschaal";
const readable = css.slice(css.indexOf(marker));

test("admin UI eindigt met de goedgekeurde leesbaarheidsschaal", () => {
  assert.ok(css.includes(marker), "afgebakende typografielaag ontbreekt");
  assert.match(readable, /#platform-admin\s*\{\s*font-size:15px;/);
  assert.match(readable, /\.adm-nav-item\s*\{[^}]*font-size:14px;/);
  assert.match(readable, /\.adm-btn\s*\{[^}]*font-size:14px;/);
  assert.match(readable, /\.adm-table td\s*\{[^}]*font-size:14px;/);
  assert.match(readable, /\.adm-form-group input[^}]*font-size:14px;/);
});

test("dagelijkse cockpit en planning gebruiken geen microtekst als hoofdinhoud", () => {
  assert.match(readable, /\.adm-workspace-head p[^}]*font-size:14px;/);
  assert.match(readable, /\.adm-action-copy h4\s*\{\s*font-size:14px;/);
  assert.match(readable, /\.adm-action-copy p\s*\{\s*font-size:12\.5px;/);
  assert.match(readable, /\.adm-board-row\s*\{[^}]*font-size:13px;/);
  assert.match(readable, /\.adm-shift-pill b\s*\{\s*font-size:12\.5px;/);
  assert.match(readable, /\.adm-planner-person b[^}]*font-size:13\.5px;/);
});

test("onboardingvelden en uitleg blijven comfortabel leesbaar", () => {
  assert.match(readable, /\.adm-onboarding-head p\s*\{\s*font-size:14px;/);
  assert.match(readable, /\.adm-onboarding-step-copy p\s*\{\s*font-size:14px;/);
  assert.match(readable, /\.adm-onboarding-form input[^}]*min-height:44px;\s*font-size:14px;/);
  assert.match(readable, /\.adm-onboarding-launch-grid button small\s*\{\s*font-size:12\.5px;/);
});
