"use strict";
// Projectplanning, fasen en capaciteitsforecast (master-spec h38/PPL):
// portfolio met gescheiden pipeline, baseline versus actueel, forecasthistoriek,
// capaciteitstekorten per periode en rol.
const { test } = require("node:test");
const assert = require("node:assert");

const {
  captureBaseline, comparePhases, appendForecast, currentForecast,
  winProbability, buildPortfolio, weeklyHours, periodsBetween, buildCapacityForecast,
} = require("../src/platform/portfolio");

function fakeStore(data = {}) {
  const d = { projects: [], quotes: [], employees: [], shifts: [], ...data };
  return {
    data: d,
    list(col, tid) { const r = d[col] || []; return tid == null ? r : r.filter(x => x.tenantId === tid); },
    get(col, id) { return (d[col] || []).find(x => x.id === id); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    update(col, id, patch) { d[col] = (d[col] || []).map(x => x.id === id ? { ...x, ...patch } : x); return (d[col] || []).find(x => x.id === id); },
    save() {},
  };
}
const TENANT = { id: "t1", name: "Demo" };
const SCHEDULE = {
  mon: { start: "08:00", end: "17:00" }, tue: { start: "08:00", end: "17:00" },
  wed: { start: "08:00", end: "17:00" }, thu: { start: "08:00", end: "17:00" },
  fri: { start: "08:00", end: "16:00" },
};

test("portfolio: projecten en gewogen offertes staan afzonderlijk", () => {
  const store = fakeStore({
    projects: [
      { id: "p1", tenantId: "t1", number: "PRJ-001", name: "Nieuwbouw", status: "active", budgetAmount: 100000, startDate: "2026-01-01", endDate: "2026-12-01" },
      { id: "p2", tenantId: "t1", number: "PRJ-002", name: "Geannuleerd", status: "cancelled", budgetAmount: 50000 },
    ],
    quotes: [
      { id: "q1", tenantId: "t1", number: "OFF-001", total: 20000, status: "verzonden" },
      { id: "q2", tenantId: "t1", number: "OFF-002", total: 10000, status: "concept" },
      { id: "q3", tenantId: "t1", number: "OFF-003", total: 99999, status: "geweigerd" },
    ],
  });
  const pf = buildPortfolio(store, TENANT, { now: new Date("2026-07-18T12:00:00Z") });
  assert.equal(pf.projects.length, 1, "geannuleerd project telt niet mee");
  assert.equal(pf.weightedQuotes.length, 2, "geweigerde offerte valt uit de pipeline");
  // Gewogen: 20000 × 0.5 + 10000 × 0.2 = 12000
  assert.equal(pf.totals.pipelineWeighted, 12000);
  assert.equal(pf.totals.pipelineGross, 30000);
  assert.equal(pf.totals.projectBudget, 100000);
  // De twee totalen worden NOOIT samengevoegd tot één omzetcijfer.
  assert.equal(pf.totals.projectBudget + pf.totals.pipelineWeighted, 112000);
  assert.ok(!("totalRevenue" in pf.totals), "geen misleidend gecombineerd totaal");
  assert.equal(winProbability({ status: "aanvaard" }), 1);
  assert.equal(winProbability({ status: "verzonden", winProbability: 0.9 }), 0.9, "expliciete kans wint");
});

test("portfolio: baseline en actuele planning zijn vergelijkbaar", () => {
  const project = {
    id: "p1", tenantId: "t1", phases: [
      { id: "f1", title: "Ruwbouw", startDate: "2026-01-01", endDate: "2026-03-31", status: "active" },
      { id: "f2", title: "Afwerking", startDate: "2026-04-01", endDate: "2026-06-30", status: "open" },
    ],
  };
  // Zonder baseline valt er niets te vergelijken.
  assert.equal(comparePhases(project).hasBaseline, false);

  const withBaseline = { ...project, ...captureBaseline(project, "pl@x.be") };
  assert.equal(comparePhases(withBaseline).hasBaseline, true);
  assert.equal(comparePhases(withBaseline).maxEndDriftDays, 0, "meteen na vastleggen is er geen drift");

  // Fasen schuiven op; de baseline blijft ongewijzigd.
  const shifted = {
    ...withBaseline,
    phases: withBaseline.phases.map(p => p.id === "f2" ? { ...p, startDate: "2026-05-01", endDate: "2026-07-31" } : p),
  };
  const cmp = comparePhases(shifted);
  const afwerking = cmp.phases.find(p => p.phaseId === "f2");
  assert.equal(afwerking.baselineEnd, "2026-06-30", "baseline onaangetast");
  assert.equal(afwerking.actualEnd, "2026-07-31");
  assert.equal(afwerking.endDriftDays, 31, "uitloop in dagen");
  assert.equal(cmp.maxEndDriftDays, 31);
  assert.equal(cmp.delayedPhases, 1);
});

test("portfolio: de baseline overleeft een fasewijziging via de repository", () => {
  // Regressie: normalizeProject strippte de baseline, waardoor er na het
  // verschuiven van een fase niets meer te vergelijken viel.
  const { makeProjectRepository } = require("../src/platform/projects");
  const store = fakeStore();
  const repo = makeProjectRepository(store);
  const created = repo.insert("t1", {
    name: "Nieuwbouw", customerId: "c1",
    phases: [{ id: "f1", title: "Ruwbouw", startDate: "2026-01-01", endDate: "2026-03-31" }],
  }, "pl@x.be");
  const based = store.update("projects", created.id, captureBaseline(created, "pl@x.be"));
  assert.ok(based.phases[0].baseline, "baseline vastgelegd");

  // Client stuurt de fase terug ZONDER baseline-veld · die mag niet verdwijnen.
  const updated = repo.update("t1", created.id, {
    name: "Nieuwbouw", customerId: "c1",
    phases: [{ id: "f1", title: "Ruwbouw", startDate: "2026-01-01", endDate: "2026-05-15" }],
  }, "pl@x.be", based.version);
  assert.ok(updated.phases[0].baseline, "baseline overleeft de update");
  assert.equal(updated.phases[0].baseline.endDate, "2026-03-31");
  assert.equal(comparePhases(updated).phases[0].endDriftDays, 45);
});

test("portfolio: een fase toegevoegd ná de baseline wordt expliciet gemeld", () => {
  const project = { id: "p1", phases: [{ id: "f1", title: "Ruwbouw", startDate: "2026-01-01", endDate: "2026-03-31" }] };
  const withBaseline = { ...project, ...captureBaseline(project) };
  const extended = { ...withBaseline, phases: [...withBaseline.phases, { id: "f9", title: "Meerwerk", startDate: "2026-08-01", endDate: "2026-09-01" }] };
  const cmp = comparePhases(extended);
  const nieuw = cmp.phases.find(p => p.phaseId === "f9");
  assert.equal(nieuw.newSinceBaseline, true);
  assert.equal(nieuw.endDriftDays, null, "geen drift zonder baseline, niet stil 0");
});

test("portfolio: conversie van offerte naar project behoudt forecasthistoriek", () => {
  let project = { id: "p1", forecastHistory: [] };
  // Stap 1: de offerte staat gewogen in de pipeline.
  project = { ...project, ...appendForecast(project, { amount: 20000, probability: 0.5, source: "quote", sourceId: "q1", reason: "Offerte verzonden" }) };
  assert.equal(currentForecast(project).weighted, 10000);
  // Stap 2: offerte aanvaard → project; de vorige stand blijft bewaard.
  project = { ...project, ...appendForecast(project, { amount: 20000, probability: 1, source: "quote_accepted", sourceId: "q1", reason: "Omgezet naar project" }) };
  assert.equal(project.forecastHistory.length, 2, "historiek behouden");
  assert.equal(project.forecastHistory[0].weighted, 10000, "eerdere stand ongewijzigd");
  assert.equal(currentForecast(project).amount, 20000);
  assert.equal(currentForecast(project).source, "quote_accepted");
  // Stap 3: fasewijziging actualiseert de forecast, opnieuw zonder wissen.
  project = { ...project, ...appendForecast(project, { amount: 23500, probability: 1, source: "phase_change", reason: "Meerwerk fase Afwerking" }) };
  assert.equal(project.forecastHistory.length, 3);
  assert.equal(project.forecastAmount, 23500);
  assert.equal(project.forecastHistory[1].amount, 20000, "tussenliggende stand nog opvraagbaar");
});

test("capaciteit: weekuren uit het werkrooster", () => {
  assert.equal(weeklyHours({ workSchedule: { days: SCHEDULE } }), 44, "4×9u + 1×8u");
  assert.equal(weeklyHours({}), 0);
});

test("capaciteit: perioden per maand en per week", () => {
  const maanden = periodsBetween("2026-01-15", "2026-03-10", "month");
  assert.deepEqual(maanden.map(p => p.key), ["2026-01", "2026-02", "2026-03"]);
  assert.equal(maanden[1].start, "2026-02-01");
  assert.equal(maanden[1].end, "2026-02-28");
  const weken = periodsBetween("2026-01-01", "2026-01-20", "week");
  assert.equal(weken.length, 3);
  assert.equal(weken[0].weeks, 1);
});

test("capaciteit: tekorten zichtbaar per periode én per rol", () => {
  const store = fakeStore({
    employees: [
      { id: "e1", tenantId: "t1", userId: "u1", name: "Tech A", jobTitle: "Technieker", status: "active", activeFrom: "2025-01-01", workSchedule: { days: SCHEDULE } },
      { id: "e2", tenantId: "t1", userId: "u2", name: "Tech B", jobTitle: "Technieker", status: "active", activeFrom: "2025-01-01", workSchedule: { days: SCHEDULE } },
      { id: "e3", tenantId: "t1", userId: "u3", name: "Elek", jobTitle: "Elektricien", status: "active", activeFrom: "2025-01-01", workSchedule: { days: SCHEDULE } },
      { id: "e4", tenantId: "t1", userId: "u4", name: "Weg", jobTitle: "Technieker", status: "left", activeFrom: "2025-01-01", activeTo: "2025-12-31", workSchedule: { days: SCHEDULE } },
    ],
    // Juli 2026: elektricien wordt zwaar overvraagd, techniekers niet.
    shifts: [
      ...Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, tenantId: "t1", userId: "u3", date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, start: "08:00", end: "18:00" })),
      { id: "sa", tenantId: "t1", userId: "u1", date: "2026-07-06", start: "08:00", end: "12:00" },
    ],
  });
  const fc = buildCapacityForecast(store, TENANT, { from: "2026-07-01", to: "2026-07-31", bucket: "month", now: new Date("2026-07-01T00:00:00Z") });
  assert.equal(fc.periods.length, 1);
  const juli = fc.periods[0];
  const elek = juli.roles.find(r => r.role === "Elektricien");
  const tech = juli.roles.find(r => r.role === "Technieker");

  // Aanbod elektricien: 44u × (31/7) ≈ 194.9u; vraag 25 × 10u = 250u → tekort.
  assert.ok(elek.plannedHours === 250, `vraag elektricien ${elek.plannedHours}`);
  assert.ok(elek.shortfallHours > 0, "tekort bij de elektricien");
  assert.ok(elek.utilizationPct > 100);
  // Techniekers: 2 actieve medewerkers, ruim voldoende → geen tekort.
  assert.equal(tech.plannedHours, 4);
  assert.equal(tech.shortfallHours, 0);
  assert.ok(tech.slackHours > 0);
  // Uit dienst telt niet mee in het aanbod.
  assert.ok(tech.availableHours < 3 * 44 * (31 / 7), "vertrokken medewerker niet meegeteld");

  // De tekortenlijst wijst meteen periode + rol aan.
  assert.equal(fc.shortfalls.length, 1);
  assert.equal(fc.shortfalls[0].role, "Elektricien");
  assert.equal(fc.shortfalls[0].period, "2026-07");
  assert.ok(fc.totals.shortfallHours > 0);
});

test("capaciteit: planning op iemand zonder personeelsfiche valt onder 'onbekend'", () => {
  const store = fakeStore({
    employees: [{ id: "e1", tenantId: "t1", userId: "u1", jobTitle: "Technieker", status: "active", workSchedule: { days: SCHEDULE } }],
    shifts: [{ id: "s1", tenantId: "t1", userId: "u-onbekend", date: "2026-07-06", start: "08:00", end: "16:00" }],
  });
  const fc = buildCapacityForecast(store, TENANT, { from: "2026-07-01", to: "2026-07-31", now: new Date("2026-07-01T00:00:00Z") });
  const onbekend = fc.periods[0].roles.find(r => r.role === "onbekend");
  assert.ok(onbekend, "gat in de stamdata wordt zichtbaar gemaakt");
  assert.equal(onbekend.plannedHours, 8);
  assert.equal(onbekend.availableHours, 0);
  assert.equal(onbekend.shortfallHours, 8);
  assert.equal(onbekend.utilizationPct, null, "geen deling door nul");
});
