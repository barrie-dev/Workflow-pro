"use strict";
// Leescontracten voorraad (frontend-coverage punt 3+4): mutatie- en
// reservatiehistoriek over de bestaande ledger, tenant-gescopet, nieuwste
// eerst, met limiet · geen tweede datalaag.
const { test } = require("node:test");
const assert = require("node:assert");

const inv = require("../src/platform/inventory");

function fakeStore() {
  const d = { stockMovements: [], stockReservations: [] };
  return { data: d, save() {} };
}

test("listMovements: tenant-gescopet, filterbaar, nieuwste eerst, limiet afgedwongen", () => {
  const store = fakeStore();
  inv.bookMovement(store, "t1", { articleId: "a1", locationId: "l1", type: "receipt", qty: 5, unitCost: 2 }, "x");
  inv.bookMovement(store, "t1", { articleId: "a1", locationId: "l1", type: "consumption", qty: 2 }, "x");
  inv.bookMovement(store, "t1", { articleId: "a2", locationId: "l1", type: "receipt", qty: 9 }, "x");
  inv.bookMovement(store, "t2", { articleId: "a1", locationId: "l1", type: "receipt", qty: 7 }, "x");

  const alles = inv.listMovements(store, "t1");
  assert.strictEqual(alles.length, 3, "andere tenant blijft buiten beeld");
  const perArtikel = inv.listMovements(store, "t1", { articleId: "a1" });
  assert.strictEqual(perArtikel.length, 2);
  assert.strictEqual(perArtikel[0].type, "consumption", "nieuwste eerst");
  assert.strictEqual(inv.listMovements(store, "t1", { limit: 1 }).length, 1);
  assert.strictEqual(inv.listMovements(store, "t1", { limit: 9999 }).length, 3, "limiet wordt op 500 geplafonneerd, niet genegeerd");
});

test("listReservations: standaard alleen actief; released via status-filter; 'all' toont alles", () => {
  const store = fakeStore();
  inv.bookMovement(store, "t1", { articleId: "a1", locationId: "l1", type: "receipt", qty: 10 }, "x");
  const r1 = inv.reserve(store, "t1", { articleId: "a1", locationId: "l1", qty: 3 }, "x");
  const r2 = inv.reserve(store, "t1", { articleId: "a1", locationId: "l1", qty: 2 }, "x");
  inv.release(store, "t1", r2.id);

  const actief = inv.listReservations(store, "t1");
  assert.deepStrictEqual(actief.map(r => r.id), [r1.id], "released valt uit de standaardweergave");
  assert.strictEqual(inv.listReservations(store, "t1", { status: "released" }).length, 1);
  assert.strictEqual(inv.listReservations(store, "t1", { status: "all" }).length, 2);
});
