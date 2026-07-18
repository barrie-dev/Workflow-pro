"use strict";
// Vorderingsstaten, prijsherziening en verlet (master-spec h32/PRG · R7):
// vorige/huidige/cumulatieve waarden per lijn, bevroren stand, contractbewaking,
// transparante herziening/retentie/voorschot, betwiste lijnen doorschuiven.
const { test } = require("node:test");
const assert = require("node:assert");

const {
  computePriceRevision, normalizeLine, assertNoOverrun, computeClaimTotals, makeProgressClaimRepository,
} = require("../src/platform/progress-claims");

function fakeStore(data = {}) {
  const d = {
    progressClaims: [], projects: [{ id: "p1", tenantId: "t1", number: "PRJ-2026-001", name: "Nieuwbouw" }],
    quotes: [], changeOrders: [], ...data,
  };
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

/** Project met een aanvaarde offerte van 2 lijnen + goedgekeurd meerwerk. */
function seed() {
  const store = fakeStore({
    quotes: [{ id: "q1", tenantId: "t1", projectId: "p1", number: "OFF-2026-001", lines: [
      { id: "l1", description: "Ruwbouw", qty: 100, unitPrice: 500, vatRate: 21, unit: "m2" },
      { id: "l2", description: "Dakwerken", qty: 50, unitPrice: 200, vatRate: 21, unit: "m2" },
    ] }],
    changeOrders: [{ id: "co1", tenantId: "t1", projectId: "p1", number: "MW-001", status: "approved", lines: [
      { id: "c1", description: "Extra isolatie", qty: 20, unitPrice: 100, vatRate: 21, unit: "m2" },
    ] }],
  });
  return { store, repo: makeProgressClaimRepository(store) };
}

test("vordering: bronlijnen uit aanvaarde offerte + goedgekeurd meerwerk", () => {
  const { repo } = seed();
  const claim = repo.insert("t1", { projectId: "p1", periodStart: "2026-01-01", periodEnd: "2026-01-31" }, "pl@x.be");
  assert.equal(claim.number, "VS-PRJ-2026-001-001");
  assert.equal(claim.lines.length, 3, "2 offertelijnen + 1 meerwerklijn");
  assert.equal(claim.lines.find(l => l.sourceType === "change_order").description, "Extra isolatie (meerwerk MW-001)");
  assert.equal(claim.status, "draft");
  // Contractwaarde = 100*500 + 50*200 + 20*100 = 62000
  assert.equal(computeClaimTotals(claim).contractAmount, 62000);
});

test("vordering: huidige = cumulatief nieuw min cumulatief vorige, per lijn controleerbaar", () => {
  const { repo } = seed();
  const c1 = repo.insert("t1", { projectId: "p1" }, "pl@x.be");
  const updated = repo.update("t1", c1.id, { lines: c1.lines.map(l => (
    l.description === "Ruwbouw" ? { ...l, cumulativeQty: 40 } : { ...l, cumulativeQty: 0 }
  )) }, "pl@x.be", c1.version);
  const ruwbouw = updated.lines.find(l => l.description === "Ruwbouw");
  assert.equal(ruwbouw.previousQty, 0);
  assert.equal(ruwbouw.currentQty, 40);
  assert.equal(ruwbouw.cumulativeQty, 40);
  assert.equal(ruwbouw.currentAmount, 20000);
  assert.equal(ruwbouw.cumulativePct, 40);
  assert.equal(computeClaimTotals(updated).currentAmount, 20000);
});

test("vordering: volgende staat start vanaf de laatst GOEDGEKEURDE stand (bevroren)", () => {
  const { repo } = seed();
  const c1 = repo.insert("t1", { projectId: "p1" }, "pl@x.be");
  repo.update("t1", c1.id, { lines: c1.lines.map(l => ({ ...l, cumulativeQty: l.description === "Ruwbouw" ? 40 : 0 })) }, "pl@x.be", c1.version);
  repo.transition("t1", c1.id, "internally_checked", "pl@x.be");
  repo.transition("t1", c1.id, "sent", "pl@x.be");
  repo.transition("t1", c1.id, "approved", "klant");

  // Tweede vordering: previousQty komt uit de goedgekeurde stand.
  const c2 = repo.insert("t1", { projectId: "p1" }, "pl@x.be");
  const ruwbouw2 = c2.lines.find(l => l.description === "Ruwbouw");
  assert.equal(ruwbouw2.previousQty, 40, "bevroren vorige stand overgenomen");
  assert.equal(ruwbouw2.cumulativeQty, 40, "start op de vorige stand");
  assert.equal(ruwbouw2.currentQty, 0, "nog geen nieuwe voortgang");
  assert.equal(c2.previousClaimId, c1.id);
  assert.equal(c2.sequence, 2);

  // Voortgang naar 70% → huidige = 30, cumulatief 70.
  const c2b = repo.update("t1", c2.id, { lines: c2.lines.map(l => (l.description === "Ruwbouw" ? { ...l, cumulativeQty: 70 } : l)) }, "pl@x.be", c2.version);
  const r2 = c2b.lines.find(l => l.description === "Ruwbouw");
  assert.equal(r2.previousQty, 40);
  assert.equal(r2.currentQty, 30);
  assert.equal(r2.currentAmount, 15000);
  assert.equal(r2.cumulativeAmount, 35000);
});

test("vordering: goedgekeurde staat is bevroren en niet meer wijzigbaar", () => {
  const { repo } = seed();
  const c1 = repo.insert("t1", { projectId: "p1" }, "pl@x.be");
  repo.transition("t1", c1.id, "internally_checked", "pl@x.be");
  repo.transition("t1", c1.id, "sent", "pl@x.be");
  repo.transition("t1", c1.id, "approved", "klant");
  assert.throws(() => repo.update("t1", c1.id, { retentionPct: 5 }, "pl@x.be"), e => e.code === "CLAIM_FROZEN" && /bevroren/.test(e.message));
  assert.throws(() => repo.remove("t1", c1.id), e => e.code === "CLAIM_FROZEN" && /niet verwijderd/.test(e.message));
});

test("vordering: cumulatief boven contracthoeveelheid vereist goedgekeurde wijziging", () => {
  const { repo } = seed();
  const c1 = repo.insert("t1", { projectId: "p1" }, "pl@x.be");
  const over = c1.lines.map(l => (l.description === "Ruwbouw" ? { ...l, cumulativeQty: 120 } : l));
  assert.throws(() => repo.update("t1", c1.id, { lines: over }, "pl@x.be", c1.version), /overschrijdt|CONTRACT_QTY_EXCEEDED/);
  // Met expliciete toestemming (goedgekeurde wijziging aangewezen) mag het wel.
  const ok = repo.update("t1", c1.id, { lines: over, allowOverrun: true }, "pl@x.be", c1.version);
  assert.equal(ok.lines.find(l => l.description === "Ruwbouw").cumulativeQty, 120);
});

test("prijsherziening: formule p = P × (a·s/S + b·i/I + c) is reproduceerbaar", () => {
  // a=0.40 lonen (index 110/100), b=0.40 materialen (index 105/100), c=0.20 vast.
  const rev = computePriceRevision({
    enabled: true, a: 0.4, b: 0.4, c: 0.2,
    baseLaborIndex: 100, currentLaborIndex: 110,
    baseMaterialIndex: 100, currentMaterialIndex: 105,
    sourceIndexName: "Agoria", indexDate: "2026-03-01",
  }, 10000);
  // factor = 0.4*1.10 + 0.4*1.05 + 0.2 = 0.44 + 0.42 + 0.20 = 1.06
  assert.equal(rev.factor, 1.06);
  assert.equal(rev.amount, 600, "herziening = 10000 × 1.06 − 10000");
  assert.match(rev.formulaText, /p = P × \(0\.4·110\/100 \+ 0\.4·105\/100 \+ 0\.2\)/);
  assert.equal(rev.sourceIndexName, "Agoria");
  // Formule moet optellen tot 1.
  assert.throws(() => computePriceRevision({ enabled: true, a: 0.5, b: 0.4, c: 0.2 }, 100), /optellen tot 1|FORMULA_SUM/);
  // Indexen verplicht wanneer het aandeel > 0 is.
  assert.throws(() => computePriceRevision({ enabled: true, a: 0.8, b: 0, c: 0.2 }, 100), /Loonindexen|INDEX_REQUIRED/);
  // Uitgeschakeld → neutrale factor, geen bedrag.
  assert.deepEqual(computePriceRevision({ enabled: false }, 10000), { enabled: false, factor: 1, amount: 0, formulaText: null });
});

test("vordering: herziening, retentie en voorschot zijn apart en transparant", () => {
  const { repo } = seed();
  const c1 = repo.insert("t1", { projectId: "p1" }, "pl@x.be");
  const withProgress = repo.update("t1", c1.id, {
    lines: c1.lines.map(l => (l.description === "Ruwbouw" ? { ...l, cumulativeQty: 20 } : { ...l, cumulativeQty: 0 })),
    priceRevision: { enabled: true, a: 0.4, b: 0.4, c: 0.2, baseLaborIndex: 100, currentLaborIndex: 110, baseMaterialIndex: 100, currentMaterialIndex: 105 },
    retentionPct: 5,
    advanceSettlementPct: 10,
  }, "pl@x.be", c1.version);
  const t = computeClaimTotals(withProgress);
  assert.equal(t.currentAmount, 10000, "20 × 500");
  assert.equal(t.priceRevision.amount, 600, "apart zichtbaar");
  assert.equal(t.revisedAmount, 10600);
  assert.equal(t.retentionAmount, 530, "5% van 10600, afzonderlijk berekend");
  assert.equal(t.advanceAmount, 1060, "10% van 10600");
  assert.equal(t.netPayable, 9010, "10600 − 530 − 1060");
});

test("vordering: betwiste lijnen tellen niet mee maar schuiven door met historiek", () => {
  const { repo } = seed();
  const c1 = repo.insert("t1", { projectId: "p1" }, "pl@x.be");
  const disputed = repo.update("t1", c1.id, { lines: c1.lines.map(l => (
    l.description === "Ruwbouw" ? { ...l, cumulativeQty: 20 }
      : l.description === "Dakwerken" ? { ...l, cumulativeQty: 10, disputed: true, disputedNote: "Meting betwist door architect" }
        : l
  )) }, "pl@x.be", c1.version);
  const t = computeClaimTotals(disputed);
  assert.equal(t.currentAmount, 10000, "betwiste lijn niet in het te betalen bedrag");
  assert.equal(t.disputedAmount, 2000, "wel apart zichtbaar");
  // Factuur neemt de betwiste lijn niet over.
  repo.transition("t1", c1.id, "internally_checked", "pl@x.be");
  repo.transition("t1", c1.id, "sent", "pl@x.be");
  repo.transition("t1", c1.id, "partially_approved", "klant");
  const payload = repo.invoicePayload("t1", c1.id);
  assert.ok(!payload.lines.some(l => /Dakwerken/.test(l.description)), "betwiste lijn niet gefactureerd");
  assert.ok(payload.lines.some(l => /Ruwbouw/.test(l.description)));
  // Volgende vordering behoudt de betwisting én de historiek.
  repo.markInvoiced("t1", c1.id, "inv1", "fin@x.be");
  const c2 = repo.insert("t1", { projectId: "p1" }, "pl@x.be");
  const dak = c2.lines.find(l => l.description === "Dakwerken");
  assert.equal(dak.disputed, true, "betwisting schuift door");
  assert.equal(dak.disputedNote, "Meting betwist door architect");
  assert.equal(dak.previousQty, 10, "historiek behouden");
});

test("vordering: factuur neemt alleen de goedgekeurde periode en reconcilieert", () => {
  const { repo } = seed();
  const c1 = repo.insert("t1", { projectId: "p1" }, "pl@x.be");
  repo.update("t1", c1.id, {
    lines: c1.lines.map(l => (l.description === "Ruwbouw" ? { ...l, cumulativeQty: 20 } : { ...l, cumulativeQty: 0 })),
    retentionPct: 5,
  }, "pl@x.be", c1.version);
  // Niet goedgekeurd → geen factuur.
  assert.throws(() => repo.invoicePayload("t1", c1.id), /goedgekeurde|NOT_APPROVED/);
  repo.transition("t1", c1.id, "internally_checked", "pl@x.be");
  repo.transition("t1", c1.id, "sent", "pl@x.be");
  repo.transition("t1", c1.id, "approved", "klant");
  const payload = repo.invoicePayload("t1", c1.id);
  // Reconciliatie: som van de factuurlijnen = netto te betalen.
  const sum = payload.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  assert.equal(Math.round(sum * 100) / 100, payload.totals.netPayable, "factuur en vorderingsdocument reconcilieren");
  assert.ok(payload.lines.every(l => l.sourceType === "progress_claim" && l.sourceId === c1.id), "bronallocatie op elke lijn");
  assert.ok(payload.lines.some(l => /Retentie 5%/.test(l.description) && l.unitPrice < 0), "retentie apart en negatief");
  // Dubbel factureren kan niet.
  repo.markInvoiced("t1", c1.id, "inv1", "fin@x.be");
  assert.throws(() => repo.invoicePayload("t1", c1.id), /al gefactureerd|ALREADY_INVOICED/);
});

test("vordering: geen tweede open staat naast een lopende", () => {
  const { repo } = seed();
  repo.insert("t1", { projectId: "p1" }, "pl@x.be");
  assert.throws(() => repo.insert("t1", { projectId: "p1" }, "pl@x.be"), /loopt al een vordering|CLAIM_IN_PROGRESS/);
});

test("vordering: verletstaat (weerverlet) wordt vastgelegd", () => {
  const { repo } = seed();
  const c1 = repo.insert("t1", { projectId: "p1", weatherDelayDays: 3, weatherDelayNote: "Vorst week 3" }, "pl@x.be");
  assert.equal(c1.weatherDelayDays, 3);
  const upd = repo.update("t1", c1.id, { weatherDelayDays: 5, weatherDelayNote: "Vorst week 3 en 4" }, "pl@x.be", c1.version);
  assert.equal(upd.weatherDelayDays, 5);
});

test("vordering: normalizeLine ondersteunt voortgang in procent", () => {
  const line = normalizeLine({ description: "Ruwbouw", contractQty: 100, contractUnitPrice: 500, cumulativePct: 35, previousQty: 20 });
  assert.equal(line.cumulativeQty, 35);
  assert.equal(line.currentQty, 15);
  assert.equal(line.currentAmount, 7500);
  assert.doesNotThrow(() => assertNoOverrun([line]));
});
