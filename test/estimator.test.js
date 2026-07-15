"use strict";
// AI-estimatie: normalisatie, JSON-parsing, mock-raming en context-opbouw.
const { test } = require("node:test");
const assert = require("node:assert");

const { normalizeEstimate, parseModelJson, mockEstimate, buildEstimationContext } = require("../src/modules/estimator");

test("estimator: normalizeEstimate valideert en klemt regels", () => {
  const out = normalizeEstimate({
    lines: [
      { description: " Werkuren ", qty: "8", unitPrice: "45.5", vatRate: 21 },
      { description: "Materiaal", qty: -3, unitPrice: 250, vatRate: 99 },   // qty→1, vat→21
      { description: "", qty: 1, unitPrice: 10 },                            // weg: geen omschrijving
      { description: "Afvoer", qty: 1, unitPrice: -50, vatRate: 6 },        // prijs→0
    ],
    assumptions: ["Oppervlakte geschat op 40m2", "", 42],
    confidence: "hoog",
  });
  assert.equal(out.lines.length, 3);
  assert.deepEqual(out.lines[0], { description: "Werkuren", qty: 8, unitPrice: 45.5, vatRate: 21 });
  assert.equal(out.lines[1].qty, 1);
  assert.equal(out.lines[1].vatRate, 21);
  assert.equal(out.lines[2].unitPrice, 0);
  assert.equal(out.lines[2].vatRate, 6);
  assert.deepEqual(out.assumptions, ["Oppervlakte geschat op 40m2", "42"]);
  assert.equal(out.confidence, "hoog");

  // Onbekende confidence valt terug op "laag"; lege regels → fout met status.
  assert.equal(normalizeEstimate({ lines: [{ description: "x" }], confidence: "zeker" }).confidence, "laag");
  assert.throws(() => normalizeEstimate({ lines: [] }), /geen bruikbare offerteregels/);
  try { normalizeEstimate({}); } catch (e) { assert.equal(e.status, 502); }
});

test("estimator: parseModelJson haalt JSON uit fences en ruis", () => {
  const obj = { lines: [{ description: "a", qty: 1, unitPrice: 2 }] };
  assert.deepEqual(parseModelJson(JSON.stringify(obj)), obj);
  assert.deepEqual(parseModelJson("```json\n" + JSON.stringify(obj) + "\n```"), obj);
  assert.deepEqual(parseModelJson("Hier is de raming:\n" + JSON.stringify(obj) + "\nSucces!"), obj);
  assert.throws(() => parseModelJson("geen json"), /geen geldig JSON/);
  assert.throws(() => parseModelJson("{kapot"), /geen geldig JSON/);
});

test("estimator: mockEstimate gebruikt het uurtarief en is valide", () => {
  const m1 = normalizeEstimate(mockEstimate("Oprit aanleggen", { hourlyRate: 55, history: [] }));
  assert.equal(m1.lines[0].unitPrice, 55, "uurtarief van de tenant");
  assert.equal(m1.confidence, "laag");
  assert.ok(m1.assumptions.some(a => a.includes("Testmodus")));

  const m2 = normalizeEstimate(mockEstimate("x", { hourlyRate: 0, history: [] }));
  assert.equal(m2.lines[0].unitPrice, 45, "fallback-uurtarief zonder instelling");
});

test("estimator: buildEstimationContext bundelt tarief en compacte historiek", () => {
  const store = {
    list(col, tid) {
      assert.equal(col, "quotes");
      return [
        { tenantId: tid, createdAt: "2026-01-01", total: 100, lines: [{ description: "oud", qty: 1, unitPrice: 100 }] },
        { tenantId: tid, createdAt: "2026-06-01", total: 500, lines: Array.from({ length: 10 }, (_, i) => ({ description: `r${i}`, qty: 1, unitPrice: 50 })) },
      ];
    },
  };
  const ctx = buildEstimationContext(store, { id: "t1", defaultHourlyRate: 48 });
  assert.equal(ctx.hourlyRate, 48);
  assert.equal(ctx.history.length, 2);
  assert.equal(ctx.history[0].totaal, 500, "recentste eerst");
  assert.equal(ctx.history[0].regels.length, 6, "regels per offerte begrensd");
  // billingOps-fallback voor het uurtarief
  assert.equal(buildEstimationContext(store, { id: "t1", billingOps: { defaultHourlyRate: 60 } }).hourlyRate, 60);
});
