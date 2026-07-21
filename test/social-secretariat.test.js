"use strict";
// Sociaal-secretariaat-integratie · PRESTATIE-EXPORT (geen RSZ-aangifte).
// Focus: correcte aggregatie (uren uit prikklok, verlof per werkdag), de
// INSZ-/open-prikking-waakhond, provider-neutrale CSV, en de gereedheid.
const { test } = require("node:test");
const assert = require("node:assert");

const {
  buildPayrollExport, buildPayrollDigest, toCsv, payrollReadiness, workingDaysBetween,
  nightMinutes, providerList, PRESTATION_CODES,
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

// ── Acerta-pilot: overuren, weekend, nacht, uitgebreide codes, digest ───────
test("overuren: uren boven de dagnorm krijgen een aparte overuren-code", () => {
  const store = mkStore();
  // Jan werkt 10u op een weekdag (di 2 juni) → 8 normaal + 2 overuren.
  store.data.clocks = [{ id: "c1", tenantId: "t1", userId: "u1", date: "2026-06-02", clockIn: "07:00", clockOut: "17:00", durationMinutes: 600 }];
  store.data.leaves = [];
  const out = buildPayrollExport(store, store.data.tenants[0], { from: "2026-06-01", to: "2026-06-30" });
  const jan = out.employees.find(e => e.employeeId === "u1");
  const work = jan.lines.find(l => l.key === "work");
  const ot = jan.lines.find(l => l.key === "overtime");
  assert.equal(work.quantity, 8, "tot de dagnorm normaal");
  assert.equal(ot.quantity, 2, "boven de norm overuren");
  assert.equal(jan.overtimeHours, 2);
});

test("weekend: op zaterdag/zondag gewerkte uren krijgen de weekend-code", () => {
  const store = mkStore();
  // 2026-06-06 = zaterdag.
  store.data.clocks = [{ id: "c1", tenantId: "t1", userId: "u1", date: "2026-06-06", clockIn: "08:00", clockOut: "13:00", durationMinutes: 300 }];
  store.data.leaves = [];
  const out = buildPayrollExport(store, store.data.tenants[0], { from: "2026-06-01", to: "2026-06-30" });
  const jan = out.employees.find(e => e.employeeId === "u1");
  assert.ok(jan.lines.every(l => l.key !== "work"), "geen normale werkcode in het weekend");
  const wk = jan.lines.find(l => l.key === "weekend");
  assert.equal(wk.quantity, 5);
  assert.equal(jan.weekendHours, 5);
});

test("nacht: enkel met een geconfigureerd nachtvenster, als aparte toeslaglijn", () => {
  const store = mkStore();
  store.data.tenants[0].compliance.socialSecretariat.nightWindow = { from: "22:00", to: "06:00" };
  // Weekdag 04:00-09:00 → 5u werk, waarvan 2u nacht (04:00-06:00).
  store.data.clocks = [{ id: "c1", tenantId: "t1", userId: "u1", date: "2026-06-02", clockIn: "04:00", clockOut: "09:00", durationMinutes: 300 }];
  store.data.leaves = [];
  const out = buildPayrollExport(store, store.data.tenants[0], { from: "2026-06-01", to: "2026-06-30" });
  const jan = out.employees.find(e => e.employeeId === "u1");
  const night = jan.lines.find(l => l.key === "night");
  assert.ok(night, "nachttoeslag-lijn aanwezig");
  assert.equal(night.quantity, 2, "04:00-06:00 = 2 nachturen");
  assert.equal(jan.nightHours, 2);
});

test("nacht: nachtvenster over middernacht (22:00-06:00) telt beide zijden", () => {
  assert.equal(nightMinutes("21:00", "23:00", { from: "22:00", to: "06:00" }), 60, "22:00-23:00");
  assert.equal(nightMinutes("04:00", "08:00", { from: "22:00", to: "06:00" }), 120, "04:00-06:00");
  assert.equal(nightMinutes("09:00", "17:00", { from: "22:00", to: "06:00" }), 0, "overdag geen nacht");
});

test("uitgebreide codes: ADV/recup en klein verlet mappen; onbekend type waarschuwt", () => {
  const store = mkStore();
  store.data.clocks = [];
  store.data.leaves = [
    { id: "l1", tenantId: "t1", userId: "u1", startDate: "2026-06-02", endDate: "2026-06-02", type: "recup", status: "goedgekeurd" },
    { id: "l2", tenantId: "t1", userId: "u1", startDate: "2026-06-03", endDate: "2026-06-03", type: "verzonnen_type", status: "goedgekeurd" },
  ];
  const out = buildPayrollExport(store, store.data.tenants[0], { from: "2026-06-01", to: "2026-06-30" });
  const jan = out.employees.find(e => e.employeeId === "u1");
  assert.ok(jan.lines.some(l => l.key === "adv"), "recup → ADV/inhaalrust");
  assert.ok(jan.lines.some(l => l.key === "onbetaald"), "onbekend type → onbetaald");
  assert.ok(jan.warnings.some(w => /onbekend verloftype/i.test(w)), "onbekend type gemeld");
});

test("dagnorm: uit het werkrooster van de werknemer indien aanwezig", () => {
  const store = mkStore();
  store.data.users.find(u => u.id === "u1").workSchedule = { days: { ma: { start: "08:00", end: "14:00" } } };  // 6u-norm
  store.data.clocks = [{ id: "c1", tenantId: "t1", userId: "u1", date: "2026-06-02", clockIn: "08:00", clockOut: "16:00", durationMinutes: 480 }];
  store.data.leaves = [];
  const out = buildPayrollExport(store, store.data.tenants[0], { from: "2026-06-01", to: "2026-06-30" });
  const jan = out.employees.find(e => e.employeeId === "u1");
  assert.equal(jan.dailyNorm, 6, "norm uit het rooster");
  assert.equal(jan.lines.find(l => l.key === "overtime").quantity, 2, "8u - 6u norm = 2 overuren");
});

test("digest: samenvatting van de vorige maand met provider-label", () => {
  const store = mkStore();
  // Zet prikking in mei zodat 'vorige maand' t.o.v. juni data heeft.
  store.data.clocks = [{ id: "c1", tenantId: "t1", userId: "u1", date: "2026-05-15", clockOut: "16:00", durationMinutes: 480 }];
  store.data.leaves = [];
  const dg = buildPayrollDigest(store, store.data.tenants[0], new Date("2026-06-10T00:00:00Z"));
  assert.equal(dg.month, "2026-05");
  assert.equal(dg.workedHours, 8);
  assert.equal(dg.hasData, true);
  assert.equal(dg.providerLabel, "Securex");
});

test("providerlijst: Acerta staat erin met label", () => {
  const list = providerList();
  const acerta = list.find(p => p.key === "acerta");
  assert.ok(acerta && acerta.label === "Acerta");
  assert.ok(list.find(p => p.key === "sdworx" && p.label === "SD Worx"));
});

test("readiness: provider-label + bevestig-de-codes-melding", () => {
  const store = mkStore();
  store.data.tenants[0].compliance.socialSecretariat.provider = "acerta";
  const r = payrollReadiness(store.data.tenants[0]);
  assert.equal(r.providerLabel, "Acerta");
  assert.match(r.codeNote, /Acerta/);
});
