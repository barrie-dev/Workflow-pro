"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const time = require("../public/js/time-utils");

test("tijdnormalisatie: ISO-prikkingen geven datum, tijd en duur", () => {
  const row = { clockedIn: "2026-07-18T08:00:00+02:00", clockedOut: "2026-07-18T16:30:00+02:00" };
  assert.equal(time.clockDate(row), "2026-07-18");
  assert.equal(time.clockMinutes(row), 510);
  assert.equal(time.clockHours(row), 8.5);
  assert.equal(time.isActive(row), false);
});

test("tijdnormalisatie: datum + HH:MM gebruikt hetzelfde rapportcontract", () => {
  const row = { date: "2026-07-18", clockIn: "08:15", clockOut: "12:45" };
  assert.equal(time.clockDate(row), "2026-07-18");
  assert.equal(time.clockTime(row, "in"), "08:15");
  assert.equal(time.clockTime(row, "out"), "12:45");
  assert.equal(time.clockMinutes(row), 270);
});

test("tijdnormalisatie: durationMinutes blijft bron van waarheid", () => {
  const row = { date: "2026-07-18", clockIn: "08:00", clockOut: "17:00", durationMinutes: 450 };
  assert.equal(time.clockMinutes(row), 450);
  assert.equal(time.clockHours(row), 7.5);
});

test("tijdnormalisatie: lopende prikking telt niet als afgesloten uren", () => {
  const row = { date: "2026-07-18", clockIn: "08:00" };
  assert.equal(time.isActive(row), true);
  assert.equal(time.clockMinutes(row), 0);
  assert.equal(time.clockTime(row, "out"), "");
});
