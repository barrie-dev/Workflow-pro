"use strict";
// Belgisch-marktspecifieke logica: feestdagen, werkdagen, cent-afronding, BTW mod-97.
const { test } = require("node:test");
const assert = require("node:assert");

const { round2, easterSunday, belgianHolidays, isBelgianHoliday, workingDaysBetween, isValidBelgianVat } = require("../src/modules/be-locale");

test("round2: cent-afronding zonder float-artefacten", () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(100 * 0.21), 21);
  assert.equal(round2(12.345), 12.35);
  assert.equal(round2(19.999), 20);
});

test("easterSunday: bekende datums", () => {
  assert.equal(easterSunday(2025).toISOString().slice(0, 10), "2025-04-20");
  assert.equal(easterSunday(2024).toISOString().slice(0, 10), "2024-03-31");
});

test("belgianHolidays: vaste + variabele feestdagen", () => {
  const h = belgianHolidays(2026);
  for (const d of ["2026-01-01", "2026-05-01", "2026-07-21", "2026-08-15", "2026-11-11", "2026-12-25"]) {
    assert.ok(h.has(d), `${d} moet feestdag zijn`);
  }
  // Paasmaandag 2026 = Pasen (5 apr) + 1
  assert.ok(h.has("2026-04-06"), "Paasmaandag 2026");
  assert.ok(isBelgianHoliday("2026-07-21"));
  assert.ok(!isBelgianHoliday("2026-07-22"));
});

test("workingDaysBetween: sluit weekend ÉN feestdag uit", () => {
  // Ma 20/4 – vr 24/4 2026, geen feestdag → 5 werkdagen
  assert.equal(workingDaysBetween("2026-04-20", "2026-04-24"), 5);
  // Ma 27/4 – vr 1/5 2026: 1 mei (vr) is feestdag → 4 werkdagen
  assert.equal(workingDaysBetween("2026-04-27", "2026-05-01"), 4);
  // Volledig weekend → 0
  assert.equal(workingDaysBetween("2026-04-25", "2026-04-26"), 0);
});

test("isValidBelgianVat: mod-97", () => {
  assert.equal(isValidBelgianVat("BE0417497106"), true);   // geldig
  assert.equal(isValidBelgianVat("BE 0417.497.106"), true); // opmaak genegeerd
  assert.equal(isValidBelgianVat("BE0123456789"), false);  // verkeerde controlecijfers
  assert.equal(isValidBelgianVat("BE12345"), false);       // te kort
  assert.equal(isValidBelgianVat("FR12345678901"), true);  // niet-BE → niet hier valideren
});
