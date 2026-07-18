"use strict";
// Contracten + recurring (master-spec h35/E15): prijsversies, pro rata,
// idempotente periodegeneratie, indexatie, statemachine.
const { test } = require("node:test");
const assert = require("node:assert");

const { normalizeContract, makeContractRepository, periodKey, periodBounds, priceOn, proRata, canTransition } = require("../src/platform/contracts");

function fakeStore(data = {}) {
  const d = { contracts: [], ...data };
  return {
    data: d,
    list(col, tid) { return (d[col] || []).filter(r => r.tenantId === tid); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    update(col, id, patch) { d[col] = d[col].map(r => r.id === id ? { ...r, ...patch } : r); return d[col].find(r => r.id === id); },
    remove(col, id) { d[col] = d[col].filter(r => r.id !== id); },
    save() {},
  };
}
function makeActive(repo, overrides = {}) {
  const c = repo.insert("t1", { customerId: "c1", title: "Onderhoudscontract", startDate: "2026-01-01", amount: 300, frequency: "monthly", ...overrides }, "a@x.be");
  repo.transition("t1", c.id, "active", "a@x.be");
  return repo.findById("t1", c.id);
}

test("contracten: periodesleutels en -grenzen zijn deterministisch", () => {
  assert.equal(periodKey("monthly", "2026-08-15"), "2026-08");
  assert.equal(periodKey("quarterly", "2026-08-15"), "2026-Q3");
  assert.equal(periodKey("semiannual", "2026-08-15"), "2026-H2");
  assert.equal(periodKey("annual", "2026-08-15"), "2026");
  assert.deepEqual(periodBounds("monthly", "2026-08-15"), { start: "2026-08-01", end: "2026-09-01" });
  assert.deepEqual(periodBounds("quarterly", "2026-08-15"), { start: "2026-07-01", end: "2026-10-01" });
});

test("contracten: prijsversies op ingangsdatum · historiek onaangetast", () => {
  const contract = { priceVersions: [
    { id: "pv1", effectiveFrom: "2026-01-01", amount: 300 },
    { id: "pv2", effectiveFrom: "2026-07-01", amount: 330 },
  ] };
  assert.equal(priceOn(contract, "2026-03-15").amount, 300);
  assert.equal(priceOn(contract, "2026-07-01").amount, 330);
  assert.equal(priceOn(contract, "2025-12-31"), null, "vóór eerste versie geen prijs");
});

test("contracten: pro rata is expliciet en reproduceerbaar", () => {
  // Start midden in de maand: 17 t/m 31 aug = 15 van 31 dagen.
  const r = proRata("monthly", "2026-08-01", "2026-08-17", null);
  assert.equal(r.daysTotal, 31);
  assert.equal(r.daysCovered, 15);
  assert.equal(r.from, "2026-08-17");
  // Volledige dekking → factor 1.
  assert.equal(proRata("monthly", "2026-08-01", "2026-01-01", null).factor, 1);
  // Einde midden in de periode.
  const eind = proRata("monthly", "2026-08-01", "2026-01-01", "2026-08-10");
  assert.equal(eind.daysCovered, 10);
});

test("contracten: statemachine + activeren zet nextRun", () => {
  assert.equal(canTransition("draft", "active"), true);
  assert.equal(canTransition("active", "paused"), true);
  assert.equal(canTransition("ended", "active"), false, "ended is eindpunt");
  const repo = makeContractRepository(fakeStore());
  const c = makeActive(repo);
  assert.equal(c.status, "active");
  assert.equal(c.nextRun, "2026-01-01");
  assert.match(c.number, /^CT-\d{4}-001$/);
});

test("contracten: idempotente generatie + nextRun schuift + einddatum-guard", () => {
  const repo = makeContractRepository(fakeStore());
  const c = makeActive(repo, { endDate: "2026-02-15" });
  let docs = 0;
  const mkDoc = (contract, ctx) => ({ id: `doc_${++docs}`, number: `N-${docs}`, ctx });

  const r1 = repo.generateForPeriod("t1", c.id, "a@x.be", {}, mkDoc);
  assert.equal(r1.alreadyGenerated, false);
  assert.equal(r1.periodKey, "2026-01");
  assert.equal(r1.amount, 300, "volledige januari");
  assert.equal(r1.contract.nextRun, "2026-02-01");

  // Zelfde periode nogmaals (handmatig, met reden) → bestaand document.
  const again = repo.generateForPeriod("t1", c.id, "a@x.be", { date: "2026-01-15", reason: "controle" }, mkDoc);
  assert.equal(again.alreadyGenerated, true);
  assert.equal(docs, 1, "geen dubbel document (h35: nooit tweemaal)");

  // Februari: pro rata t/m 15 feb (15/28 dagen).
  const r2 = repo.generateForPeriod("t1", c.id, "a@x.be", {}, mkDoc);
  assert.equal(r2.periodKey, "2026-02");
  assert.equal(r2.prorata.daysCovered, 15);
  assert.equal(r2.amount, 160.71, "300 × factor 0,5357 (15/28 · reproduceerbaar)");

  // Maart valt volledig na de einddatum → 409 AFTER_END.
  try { repo.generateForPeriod("t1", c.id, "a@x.be", {}, mkDoc); assert.fail("verwacht AFTER_END"); }
  catch (e) { assert.equal(e.code, "AFTER_END"); }
});

test("contracten: buiten schema vereist reden · indexatie maakt nieuwe prijsversie", () => {
  const repo = makeContractRepository(fakeStore());
  const c = makeActive(repo);
  const mkDoc = () => ({ id: "doc_x", number: "N-x" });

  // Buiten schema (andere periode dan nextRun) zonder reden → 400.
  try { repo.generateForPeriod("t1", c.id, "a@x.be", { date: "2026-05-10" }, mkDoc); assert.fail("reden verwacht"); }
  catch (e) { assert.equal(e.code, "REASON_REQUIRED"); }
  const manual = repo.generateForPeriod("t1", c.id, "a@x.be", { date: "2026-05-10", reason: "Klant vroeg vervroegde facturatie" }, mkDoc);
  assert.equal(manual.periodKey, "2026-05");
  const entry = manual.contract.generatedFor.find(g => g.periodKey === "2026-05");
  assert.equal(entry.outOfSchedule, true);
  assert.match(entry.reason, /vervroegde/);
  assert.equal(manual.contract.nextRun, "2026-01-01", "schema schuift NIET bij handmatige generatie");

  // Indexatie: +5% vanaf 1 juli → nieuwe versie met berekening.
  const idx = repo.applyIndexation("t1", c.id, { pct: 5, sourceIndex: "Agoria 2026-06", effectiveFrom: "2026-07-01" }, "a@x.be");
  const latest = priceOn(idx, "2026-07-01");
  assert.equal(latest.amount, 315);
  assert.equal(latest.indexation.baseAmount, 300);
  assert.match(latest.indexation.calculation, /300 × \(1 \+ 5\/100\) = 315/);
  assert.equal(priceOn(idx, "2026-06-30").amount, 300, "historische periode onaangetast");
});

test("contracten: verwijderen geblokkeerd met generatiehistoriek · niet-actief genereert niet", () => {
  const repo = makeContractRepository(fakeStore());
  const c = makeActive(repo);
  repo.generateForPeriod("t1", c.id, "a@x.be", {}, () => ({ id: "d1" }));
  try { repo.remove("t1", c.id); assert.fail("delete-block verwacht"); }
  catch (e) { assert.equal(e.status, 409); }

  repo.transition("t1", c.id, "paused", "a@x.be");
  try { repo.generateForPeriod("t1", c.id, "a@x.be", {}, () => ({ id: "d2" })); assert.fail("niet-actief"); }
  catch (e) { assert.equal(e.code, "CONTRACT_NOT_ACTIVE"); }

  assert.throws(() => normalizeContract({ customerId: "c1", title: "X", startDate: "2026-01-01" }), /Prijs/);
});
