"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const admin = fs.readFileSync(path.join(__dirname, "..", "public", "js", "platforms", "admin.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "admin.css"), "utf8");

test("planning resolveert venueId naar een leesbare locatie", () => {
  assert.match(admin, /const venueById = Object\.fromEntries/);
  assert.match(admin, /locationLabel: shift\.location \|\| venue\?\.name/);
  assert.match(admin, /allShifts\.map\(shift => shift\.locationLabel\)/);
  assert.match(admin, /shift\.locationLabel === _planningLocation/);
});

test("shiftformulier bewaart een echte venueId en exposeert geen niet-opgeslagen locatie", () => {
  assert.match(admin, /name="venueId" id="shiftVenue"/);
  assert.match(admin, /body\.venueId = body\.venueId \|\| null/);
  assert.match(admin, /planning-legacy-location/);
  const shiftSection = admin.slice(admin.indexOf("function openShiftDrawer"), admin.indexOf("// ── Clocking"));
  assert.doesNotMatch(shiftSection, /name="location"/);
});

test("werkbon neemt de werfkoppeling mee naar de planning", () => {
  assert.match(admin, /name="venueId" id="woVenueSel"/);
  assert.match(admin, /name="location" id="woLocation"/);
  assert.match(admin, /venueId: body\.venueId \|\| ""/);
  assert.match(admin, /workorderId: savedWorkorder\?\.id \|\| ""/);
});

test("week kopiëren bewaart werkbon- en werfidentiteit", () => {
  assert.match(admin, /venueId: s\.venueId \|\| null/);
  assert.match(admin, /workorderId: s\.workorderId \|\| null/);
});

test("planning- en locatieformulieren zijn geen smalle sidepanels", () => {
  assert.match(css, /\.adm-drawer:has\(#admShiftForm\)/);
  assert.match(css, /\.adm-drawer:has\(#venForm\)/);
  assert.match(css, /width:min\(980px,calc\(100vw - 72px\)\)/);
  assert.match(css, /\.wo-location-row/);
});
