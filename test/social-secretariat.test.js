"use strict";
// Sociaal-secretariaat-integratie · PRESTATIE-EXPORT (geen RSZ-aangifte).
// Focus: correcte aggregatie (uren uit prikklok, verlof per werkdag), de
// INSZ-/open-prikking-waakhond, provider-neutrale CSV, en de gereedheid.
const { test } = require("node:test");
const assert = require("node:assert");

const {
  buildPayrollExport, toCsv, payrollReadiness, workingDaysBetween, PRESTATION_CODES,
} = require("../src/platform/social-secretariat");

const INSZ_OK = "93051822361";      // geldige mod-97
const INSZ_OK2 = "93051822460";

function mkStore(over = {}) {
  const data = {
    tenants: [{ id: "t1", name: "Bouw NV", plan: "business", compliance: {
      rszEmployerId: "0123456-78",
      socialSecretariat: { provider: "securex", affiliateNumber: "SEC-99887", codeMap: {} },
    } }],
    users: [
      { id: "u1", tenantId: "t1", role: "employee", name: "Jan Peeters", insz: INSZ_OK, active: true },
      { id: "u2", tenantId: "t1", role: "employee", name: "Piet Claes", insz: INSZ_OK2, active: true },
      { id: "u3", tenantId: "t1", role: "employee", name: "Zonder INSZ", active: true },
      { id: "usuper", tenantId: "t1", role: "super_admin", name: "Root", insz: INSZ_OK },
    ],
    clocks: [
      // Jan: 2 dagen gewerkt (8u en 7.5u), 1 open prikking.
      { id: "c1", tenantId: "t1", userId: "u1", date: "2026-06-01", clockOut: "16:30", durationMinutes: 480 },
      { id: "c2", tenantId: "t1", userId: "u1", date: "2026-06-02", clockOut: "16:00", durationMinutes: 450 },
      { id: "c3", tenantId: "t1", userId: "u1", date: "2026-06-03", clockOut: null, durationMinutes: 0 },
      // Buiten de periode → telt niet mee.
      { id: "c4", tenantId: "t1", userId: "u1", date: "2026-05-30", clockOut: "16:00", durationMinutes: 480 },
    ],
    leaves: [
      // Piet: goedgekeurd verlof 3-5 juni (wo/do/vr → 3 werkdagen).
      { id: "l1", tenantId: "t1", userId: "u2", startDate: "2026-06-03", endDate: "2026-06-05", type: "vakantie", status: "goedgekeurd", days: 3 },
      // Aangevraagd (niet goedgekeurd) → telt niet.
      { id: "l2", tenantId: "t1", userId: "u2", startDate: "2026-06-08", endDate: "2026-06-08", type: "ziekte", status: "aangevraagd" },
    ],
  };
  Object.assign(data, over);
  return {
    data,
    list: (c, tid) => (data[c] || []).filter(r => !tid || r.tenantId === tid),
    get: (c, id) => (data[c] || []).find(x => x.id === id),
    updateTenant: (id, p) => { data.tenants = data.tenants.map(t => t.id === id ? { ...t, ...p } : t); return data.tenants.find(t => t.id === id); },
    audit() {},
  };
}
const TENANT = () => mkStore().data.tenants[0];

test("export: gewerkte uren uit de prikklok, per werkdag, binnen de periode", () => {
  const store = mkStore();
  const out = buildPayrollExport(store, TENANT(), { from: "2026-06-01", to: "2026-06-30" });
  const jan = out.employees.find(e => e.employeeId === "u1");
  assert.equal(jan.workedHours, 15.5, "8 + 7.5 = 15.5 (mei-prikking valt buiten)");
  assert.equal(jan.workedDays, 2);
  const workLines = jan.lines.filter(l => l.key === "work");
  assert.equal(workLines.length, 2);
  assert.equal(workLines[0].unit, "hours");
  assert.equal(workLines[0].quantity, 8);
});

test("export: goedgekeurd verlof wordt per werkdag een verloflijn (weekend uitgesloten)", () => {
  const store = mkStore();
  const out = buildPayrollExport(store, TENANT(), { from: "2026-06-01", to: "2026-06-30" });
  const piet = out.employees.find(e => e.employeeId === "u2");
  const leaveLines = piet.lines.filter(l => l.key === "vakantie");
  assert.equal(leaveLines.length, 3, "3 werkdagen verlof");
  assert.equal(leaveLines[0].unit, "days");
  assert.equal(leaveLines[0].quantity, 1);
  assert.equal(piet.leaveDays, 3);
  // Aangevraagd verlof (niet goedgekeurd) zit er niet in.
  assert.ok(!piet.lines.some(l => l.date === "2026-06-08"));
});

test("export: prestatiecode volgt de secretariaat-override (codeMap)", () => {
  const store = mkStore();
  store.data.tenants[0].compliance.socialSecretariat.codeMap = { work: "100", vakantie: "200" };
  const out = buildPayrollExport(store, store.data.tenants[0], { from: "2026-06-01", to: "2026-06-30" });
  const jan = out.employees.find(e => e.employeeId === "u1");
  assert.equal(jan.lines.find(l => l.key === "work").code, "100", "eigen code van het secretariaat");
  const piet = out.employees.find(e => e.employeeId === "u2");
  assert.equal(piet.lines.find(l => l.key === "vakantie").code, "200");
});

test("waakhond: ongeldig INSZ en open prikking worden gemeld, niet stil verzwegen", () => {
  const store = mkStore();
  const out = buildPayrollExport(store, TENANT(), { from: "2026-06-01", to: "2026-06-30" });
  const jan = out.employees.find(e => e.employeeId === "u1");
  assert.ok(jan.warnings.some(w => /niet-afgesloten prikking/i.test(w)), "open prikking gemeld");
  const zonder = out.employees.find(e => e.employeeId === "u3");
  assert.equal(zonder.inszValid, false);
  assert.ok(zonder.warnings.some(w => /INSZ/i.test(w)), "ontbrekend INSZ gemeld");
});

test("export: super-admin telt niet mee als werknemer", () => {
  const store = mkStore();
  const out = buildPayrollExport(store, TENANT(), { from: "2026-06-01", to: "2026-06-30" });
  assert.ok(!out.employees.some(e => e.employeeId === "usuper"));
  assert.equal(out.totals.employees, 3);
});

test("export: totalen en exporteerbaar-telling kloppen", () => {
  const store = mkStore();
  const out = buildPayrollExport(store, TENANT(), { from: "2026-06-01", to: "2026-06-30" });
  assert.equal(out.totals.workedHours, 15.5);
  assert.equal(out.totals.leaveDays, 3);
  // Exporteerbaar = geldig INSZ én prestatielijnen (Jan + Piet; niet 'zonder INSZ').
  assert.equal(out.totals.exportable, 2);
});

test("export: dag met zowel prestaties als verlof → uren winnen + waarschuwing", () => {
  const store = mkStore();
  store.data.clocks.push({ id: "c5", tenantId: "t1", userId: "u2", date: "2026-06-03", clockOut: "12:00", durationMinutes: 240 });
  const out = buildPayrollExport(store, store.data.tenants[0], { from: "2026-06-01", to: "2026-06-30" });
  const piet = out.employees.find(e => e.employeeId === "u2");
  const june3 = piet.lines.find(l => l.date === "2026-06-03");
  assert.equal(june3.key, "work", "prestaties winnen van verlof op dezelfde dag");
  assert.ok(piet.warnings.some(w => /zowel prestaties als afwezigheid/i.test(w)));
});

test("CSV: provider-neutraal, één rij per prestatielijn, veilig geciteerd", () => {
  const store = mkStore();
  const out = buildPayrollExport(store, TENANT(), { from: "2026-06-01", to: "2026-06-30" });
  const csv = toCsv(out);
  const rows = csv.trim().split("\r\n");
  assert.match(rows[0], /rsz_werkgever;aansluitingsnummer;insz;naam;datum;code;omschrijving;aantal;eenheid/);
  assert.ok(rows.some(r => r.includes("93051822361") && r.includes("Gewerkte uren")));
  // Belgische decimaal met komma.
  assert.ok(rows.some(r => /;7,5;uren/.test(r)), "7.5 uur als 7,5");
});

test("gereedheid: meldt ontbrekende configuratie zonder de export te blokkeren", () => {
  const ready = payrollReadiness(TENANT());
  assert.equal(ready.ready, true);
  assert.equal(ready.provider, "securex");
  assert.match(ready.note, /geen RSZ-aangifte/i);

  const store2 = mkStore();
  delete store2.data.tenants[0].compliance.socialSecretariat.affiliateNumber;
  delete store2.data.tenants[0].compliance.rszEmployerId;
  const notReady = payrollReadiness(store2.data.tenants[0]);
  assert.equal(notReady.ready, false);
  assert.deepEqual(notReady.missing.sort(), ["aansluitingsnummer", "rsz_werkgeversnummer"].sort());
});

test("periode: ongeldige of omgekeerde periode faalt netjes", () => {
  const store = mkStore();
  assert.throws(() => buildPayrollExport(store, TENANT(), { from: "x", to: "2026-06-30" }), e => e.code === "INVALID_PERIOD");
  assert.throws(() => buildPayrollExport(store, TENANT(), { from: "2026-06-30", to: "2026-06-01" }), e => e.code === "INVALID_PERIOD");
});

test("hulpfunctie: workingDaysBetween sluit weekends uit", () => {
  // 2026-06-05 = vrijdag, 06-06 za, 07-06 zo, 08-06 ma.
  assert.deepEqual(workingDaysBetween("2026-06-05", "2026-06-08"), ["2026-06-05", "2026-06-08"]);
});
