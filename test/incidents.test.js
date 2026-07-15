"use strict";
// Werkongevallen: validatie, aangifte-deadline en CSV-export (pure functies).
const { test } = require("node:test");
const assert = require("node:assert");

const { normalizeIncident, incidentDeadline, incidentsToCsv, INSURER_DEADLINE_DAYS } = require("../src/modules/incidents");

test("werkongevallen: normalizeIncident valideert en normaliseert", () => {
  const ok = normalizeIncident({
    employeeName: "  Jan Peeters ", date: "2026-07-10", time: "09:15:00",
    location: " Werf Gent ", description: " Val van ladder ", severity: "werkverlet",
    witnesses: "Piet, Karel", insurerReportedAt: "2026-07-12"
  });
  assert.equal(ok.employeeName, "Jan Peeters");
  assert.equal(ok.time, "09:15");
  assert.equal(ok.location, "Werf Gent");
  assert.equal(ok.description, "Val van ladder");
  assert.equal(ok.severity, "werkverlet");
  assert.equal(ok.status, "open");
  assert.equal(ok.insurerReportedAt, "2026-07-12");

  // Ongeldige meldingsdatum valt terug op null; tijd is optioneel.
  const b = normalizeIncident({ employeeName: "X", date: "2026-07-10", description: "y", severity: "licht", insurerReportedAt: "12/07" });
  assert.equal(b.insurerReportedAt, null);
  assert.equal(b.time, null);

  assert.throws(() => normalizeIncident({ date: "2026-07-10", description: "y", severity: "licht" }), /medewerker/);
  assert.throws(() => normalizeIncident({ employeeName: "X", date: "10-07-2026", description: "y", severity: "licht" }), /datum/);
  assert.throws(() => normalizeIncident({ employeeName: "X", date: "2026-07-10", severity: "licht" }), /Omschrijving/);
  assert.throws(() => normalizeIncident({ employeeName: "X", date: "2026-07-10", description: "y", severity: "catastrofaal" }), /Ernst/);
});

test("werkongevallen: PATCH-merge behoudt bestaande velden", () => {
  const existing = { employeeName: "Jan", date: "2026-07-10", time: "09:00", location: "Werf Gent", description: "Val", severity: "ernstig", witnesses: "", status: "open", insurerReportedAt: null };
  const merged = normalizeIncident({ status: "gemeld", insurerReportedAt: "2026-07-14" }, existing);
  assert.equal(merged.employeeName, "Jan");
  assert.equal(merged.severity, "ernstig");
  assert.equal(merged.status, "gemeld");
  assert.equal(merged.insurerReportedAt, "2026-07-14");
});

test("werkongevallen: incidentDeadline rekent 8 dagen en vlagt ernst", () => {
  assert.equal(INSURER_DEADLINE_DAYS, 8);
  const base = { date: "2026-07-10", severity: "licht", insurerReportedAt: null };

  const d1 = incidentDeadline(base, "2026-07-15");
  assert.equal(d1.deadline, "2026-07-18");
  assert.equal(d1.daysLeft, 3);
  assert.equal(d1.overdue, false);
  assert.equal(d1.serious, false);
  assert.equal(d1.immediate, false);

  const d2 = incidentDeadline(base, "2026-07-20");
  assert.equal(d2.overdue, true, "na de deadline zonder aangifte = te laat");

  const d3 = incidentDeadline({ ...base, insurerReportedAt: "2026-07-12" }, "2026-07-20");
  assert.equal(d3.overdue, false, "gemeld = nooit te laat");
  assert.equal(d3.reported, true);

  const d4 = incidentDeadline({ ...base, severity: "ernstig" }, "2026-07-15");
  assert.equal(d4.serious, true);
  assert.equal(d4.immediate, false);

  const d5 = incidentDeadline({ ...base, severity: "dodelijk" }, "2026-07-15");
  assert.equal(d5.serious, true);
  assert.equal(d5.immediate, true);

  // Maandwissel: 2026-07-28 + 8 dagen = 2026-08-05.
  const d6 = incidentDeadline({ ...base, date: "2026-07-28" }, "2026-07-30");
  assert.equal(d6.deadline, "2026-08-05");
});

test("werkongevallen: CSV bevat kop, rijen en escapet aanhalingstekens", () => {
  const csv = incidentsToCsv([
    { date: "2026-07-10", time: "09:15", employeeName: 'Jan "JP" Peeters', location: "Werf Gent", severity: "werkverlet", description: "Val van ladder,\nlichte kneuzing", witnesses: "Piet", status: "gemeld", insurerReportedAt: "2026-07-12", createdBy: "admin@demobouw.be", createdAt: "2026-07-10T10:00:00Z" },
    { date: "2026-07-11", employeeName: "An", severity: "licht", description: "Snijwonde", status: "open" },
  ]);
  const lines = csv.split("\n");
  assert.match(lines[0], /^"Datum","Tijd","Medewerker"/);
  assert.match(csv, /"Jan ""JP"" Peeters"/, "dubbele quotes worden verdubbeld");
  assert.match(csv, /"2026-07-12"/);
  // 1 kop + 1 rij + (1 rij met newline in omschrijving = 2 fysieke regels)
  assert.equal(lines.length, 4);
  assert.equal(incidentsToCsv([]).split("\n").length, 1, "leeg register = enkel de kop");
});
