"use strict";
// Werknemers, teams, vaardigheden en capaciteit (master-spec h16/EMP):
// datumgebonden kosttarieven, beschikbaarheid, uit dienst, attesten, koppeling.
const { test } = require("node:test");
const assert = require("node:assert");

const {
  normalizeEmployee, rateOn, availabilityOn, withSkill, expiringCertificates,
  weekdayOf, makeEmployeeRepository,
} = require("../src/platform/employees");

function fakeStore(data = {}) {
  const d = { employees: [], leaves: [], ...data };
  return {
    data: d,
    list(col, tid) { const r = d[col] || []; return tid == null ? r : r.filter(x => x.tenantId === tid); },
    get(col, id) { return (d[col] || []).find(x => x.id === id); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    update(col, id, patch) { d[col] = (d[col] || []).map(x => x.id === id ? { ...x, ...patch } : x); return (d[col] || []).find(x => x.id === id); },
    remove(col, id) { d[col] = (d[col] || []).filter(x => x.id !== id); },
    save() {},
  };
}

const SCHEDULE = {
  mon: { start: "08:00", end: "17:00" }, tue: { start: "08:00", end: "17:00" },
  wed: { start: "08:00", end: "17:00" }, thu: { start: "08:00", end: "17:00" },
  fri: { start: "08:00", end: "16:00" },
};

function seed() {
  const store = fakeStore();
  const repo = makeEmployeeRepository(store);
  const emp = repo.insert("t1", {
    name: "Jan Peeters", employeeNumber: "P001", userId: "u2", teamId: "team-noord",
    activeFrom: "2025-01-01", workSchedule: SCHEDULE,
    costRates: [{ validFrom: "2025-01-01", costRate: 28, salesRate: 50 }],
    skills: [{ key: "hvac", label: "HVAC", level: "expert" }, { label: "Elektriciteit" }],
  }, "admin@x.be");
  return { store, repo, emp };
}

test("werknemer: kosttarief is datumgebonden · historische nacalculatie blijft correct", () => {
  const { repo, emp } = seed();
  // Tarief verhoogt vanaf 1 juli.
  repo.addRate("t1", emp.id, { validFrom: "2026-07-01", costRate: 32, salesRate: 58 }, "admin@x.be");
  const updated = repo.findById("t1", emp.id);

  // Werkbon van vóór de wijziging rekent nog met het oude tarief.
  assert.equal(rateOn(updated, "2026-06-30").costRate, 28, "tarief op uitvoeringsdatum vóór de wijziging");
  assert.equal(rateOn(updated, "2026-07-01").costRate, 32, "vanaf de ingangsdatum het nieuwe tarief");
  assert.equal(rateOn(updated, "2026-12-31").costRate, 32);
  assert.equal(rateOn(updated, "2026-06-30").salesRate, 50);
  // Vóór de allereerste versie: geen tarief gevonden (expliciet, geen stille 0).
  assert.equal(rateOn(updated, "2024-01-01").found, false);
  // De oude versie is ONGEWIJZIGD blijven staan.
  assert.equal(updated.costRates.length, 2);
  assert.ok(updated.costRates.some(r => r.validFrom === "2025-01-01" && r.costRate === 28));
});

test("werknemer: dubbele tariefversie op dezelfde datum wordt geweigerd", () => {
  const { repo, emp } = seed();
  assert.throws(() => repo.addRate("t1", emp.id, { validFrom: "2025-01-01", costRate: 99 }, "admin@x.be"), /bestaat al|RATE_EXISTS/);
  assert.throws(() => repo.addRate("t1", emp.id, { costRate: 99 }, "admin@x.be"), /ingangsdatum|VALID_FROM_REQUIRED/);
});

test("werknemer: beschikbaarheid toetst rooster, afwezigheid en dienstperiode", () => {
  const { repo, emp } = seed();
  const e = repo.findById("t1", emp.id);
  // 2026-07-20 is een maandag → binnen rooster.
  assert.equal(weekdayOf("2026-07-20"), "mon");
  const ok = availabilityOn(e, "2026-07-20");
  assert.equal(ok.available, true);
  assert.deepEqual(ok.schedule, { start: "08:00", end: "17:00" });

  // Zaterdag valt buiten het rooster → waarschuwing, geen blokkering.
  const sat = availabilityOn(e, "2026-07-25");
  assert.equal(sat.available, false);
  assert.ok(sat.reasons.some(r => r.code === "OFF_SCHEDULE"));
  assert.equal(sat.blocking, false, "buiten rooster is een waarschuwing");

  // Goedgekeurd verlof → harde blokkering.
  const onLeave = availabilityOn(e, "2026-07-21", { leaves: [
    { employeeId: e.id, status: "approved", startDate: "2026-07-21", endDate: "2026-07-25", type: "vakantie" },
  ] });
  assert.equal(onLeave.available, false);
  assert.ok(onLeave.reasons.some(r => r.code === "ON_LEAVE"));
  assert.equal(onLeave.blocking, true);

  // Niet-goedgekeurd verlof blokkeert niet.
  const pending = availabilityOn(e, "2026-07-21", { leaves: [
    { employeeId: e.id, status: "pending", startDate: "2026-07-21", endDate: "2026-07-25" },
  ] });
  assert.equal(pending.available, true);

  // Vóór indiensttreding.
  const before = availabilityOn(e, "2024-06-03");
  assert.ok(before.reasons.some(r => r.code === "BEFORE_START"));
  assert.equal(before.blocking, true);
});

test("werknemer: uit dienst behoudt historiek maar is niet plannbaar", () => {
  const { repo, emp } = seed();
  const left = repo.transition("t1", emp.id, "left", "admin@x.be");
  assert.equal(left.status, "left");
  assert.equal(left.mobileAccess, false, "toegang vervalt bij einddatum");
  assert.ok(left.activeTo, "einddatum vastgelegd");
  assert.equal(left.costRates.length, 1, "tariefhistoriek blijft intact");

  const avail = availabilityOn(left, "2026-07-20");
  assert.equal(avail.available, false);
  assert.ok(avail.reasons.some(r => r.code === "OUT_OF_SERVICE"));
  assert.equal(avail.blocking, true);
  // Historiek blijft opvraagbaar.
  assert.ok(repo.findById("t1", emp.id), "medewerker blijft bestaan");
  // Verwijderen mag niet · archiveren wel.
  assert.throws(() => repo.remove("t1", emp.id), /gearchiveerd|ARCHIVE_INSTEAD/);
});

test("werknemer: mobiele toegang staat los van kantoortoegang", () => {
  const { repo } = seed();
  const veld = repo.insert("t1", { name: "Veldwerker", mobileAccess: true, workSchedule: SCHEDULE }, "admin@x.be");
  assert.equal(veld.mobileAccess, true);
  assert.equal(veld.userId, null, "geen kantoorgebruiker gekoppeld");
  const kantoor = repo.insert("t1", { name: "Backoffice", userId: "u9", mobileAccess: false }, "admin@x.be");
  assert.equal(kantoor.mobileAccess, false);
  assert.equal(kantoor.userId, "u9");
});

test("werknemer: gebruiker en werknemer zijn aparte entiteiten met 1-1 koppeling", () => {
  const { repo } = seed();
  assert.throws(() => repo.insert("t1", { name: "Dubbel", userId: "u2" }, "admin@x.be"), /al aan een werknemer gekoppeld|USER_ALREADY_LINKED/);
  assert.ok(repo.findByUserId("t1", "u2"), "werknemer vindbaar via gebruiker");
  assert.equal(repo.findByUserId("t1", "onbekend"), null);
});

test("werknemer: externe medewerker vereist een leverancier", () => {
  const { repo } = seed();
  assert.throws(() => repo.insert("t1", { name: "Onderaannemer", external: true }, "admin@x.be"), /leverancier|SUPPLIER_REQUIRED/);
  const ext = repo.insert("t1", { name: "Onderaannemer", external: true, supplierId: "sup1" }, "admin@x.be");
  assert.equal(ext.supplierId, "sup1");
  assert.equal(ext.external, true);
});

test("werknemer: meerdere vaardigheden en planningsgroepen; zoeken op vaardigheid", () => {
  const { repo, emp } = seed();
  const e = repo.findById("t1", emp.id);
  assert.equal(e.skills.length, 2);
  assert.equal(e.skills[1].key, "elektriciteit", "sleutel afgeleid uit het label");
  repo.update("t1", emp.id, { ...e, planningGroups: ["ploeg-a", "wachtdienst"] }, "admin@x.be", e.version);
  assert.deepEqual(repo.findById("t1", emp.id).planningGroups, ["ploeg-a", "wachtdienst"]);
  assert.equal(withSkill(repo.list("t1"), "HVAC").length, 1, "zoeken op vaardigheid is hoofdletterongevoelig");
  assert.equal(withSkill(repo.list("t1"), "loodgieterij").length, 0);
});

test("werknemer: vervallende attesten worden gesignaleerd", () => {
  const { repo } = seed();
  const now = new Date("2026-07-18T12:00:00Z");
  const e = repo.insert("t1", { name: "Attesthouder", certificates: [
    { label: "VCA", expiresAt: "2026-08-01" },
    { label: "Heftruck", expiresAt: "2026-07-01" },
    { label: "EHBO", expiresAt: "2027-12-31" },
  ] }, "admin@x.be");
  const exp = expiringCertificates(e, { now, horizonDays: 60 });
  assert.equal(exp.length, 2, "EHBO valt buiten de horizon");
  assert.equal(exp.find(c => c.label === "Heftruck").expired, true);
  assert.equal(exp.find(c => c.label === "VCA").expired, false);
  assert.equal(exp.find(c => c.label === "VCA").daysLeft, 14);
  const perEmployee = repo.expiringCertificates("t1", { now, horizonDays: 60 });
  assert.equal(perEmployee.length, 1);
  assert.equal(perEmployee[0].name, "Attesthouder");
});

test("werknemer: statusovergangen en optimistic locking", () => {
  const { repo, emp } = seed();
  assert.throws(() => repo.transition("t1", emp.id, "candidate", "admin@x.be"), /INVALID_TRANSITION|Ongeldige statusovergang/);
  repo.transition("t1", emp.id, "temporarily_absent", "admin@x.be");
  assert.equal(repo.findById("t1", emp.id).status, "temporarily_absent");
  const e = repo.findById("t1", emp.id);
  repo.update("t1", emp.id, { ...e, jobTitle: "Ploegbaas" }, "admin@x.be", e.version);
  assert.throws(() => repo.update("t1", emp.id, { ...e, jobTitle: "X" }, "admin@x.be", e.version), /VERSION_CONFLICT|intussen gewijzigd/);
});

test("werknemer: ongeldige dienstperiode wordt geweigerd", () => {
  assert.throws(() => normalizeEmployee({ name: "X", activeFrom: "2026-05-01", activeTo: "2026-01-01" }), /Einddatum|INVALID_PERIOD/);
  assert.throws(() => normalizeEmployee({ name: "" }), /Naam is verplicht/);
});
