"use strict";
// Voorraad + aankoop (master-spec h27/h28, E17/E18).
const { test } = require("node:test");
const assert = require("node:assert");

const inv = require("../src/platform/inventory");
const { normalizePurchaseOrder, receiptProgress, commitmentAmount, makePurchaseOrderRepository, makeSupplierRepository } = require("../src/platform/procurement");

function fakeStore(data = {}) {
  const d = { stockMovements: [], stockReservations: [], purchaseOrders: [], suppliers: [], ...data };
  return {
    data: d,
    list(col, tid) { return (d[col] || []).filter(r => r.tenantId === tid); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    update(col, id, patch) { d[col] = d[col].map(r => r.id === id ? { ...r, ...patch } : r); return d[col].find(r => r.id === id); },
    remove(col, id) { d[col] = d[col].filter(r => r.id !== id); },
    save() {},
  };
}

test("voorraad: fysiek uit ledger, beschikbaar = fysiek - reservaties", () => {
  const store = fakeStore();
  inv.bookMovement(store, "t1", { articleId: "a1", locationId: "loc1", type: "receipt", qty: 100, unitCost: 5 }, "x");
  inv.bookMovement(store, "t1", { articleId: "a1", locationId: "loc1", type: "consumption", qty: 30 }, "x");
  let lvl = inv.level(store, "t1", "a1", "loc1");
  assert.equal(lvl.physical, 70);
  assert.equal(lvl.available, 70);

  const r = inv.reserve(store, "t1", { articleId: "a1", locationId: "loc1", qty: 20 }, "x");
  lvl = inv.level(store, "t1", "a1", "loc1");
  assert.equal(lvl.reserved, 20);
  assert.equal(lvl.available, 50);

  // Onvoldoende beschikbaar → 409.
  assert.throws(() => inv.reserve(store, "t1", { articleId: "a1", locationId: "loc1", qty: 60 }, "x"), /INSUFFICIENT_STOCK|Onvoldoende/);
  inv.release(store, "t1", r.id);
  assert.equal(inv.level(store, "t1", "a1", "loc1").available, 70, "vrijgeven verhoogt beschikbaar");
});

test("voorraad: geboekte mutatie is onveranderlijk · correctie = tegenboeking", () => {
  const store = fakeStore();
  const mv = inv.bookMovement(store, "t1", { articleId: "a1", locationId: "loc1", type: "receipt", qty: 50 }, "x");
  const rev = inv.reverseMovement(store, "t1", mv.id, "y", "fout geboekt");
  assert.equal(rev.type, "correction");
  assert.equal(rev.qty, -50);
  assert.equal(inv.level(store, "t1", "a1", "loc1").physical, 0, "tegenboeking heft op");
  assert.equal(store.data.stockMovements.length, 2, "beide mutaties blijven in de historiek");
});

test("voorraad: transfer = twee aparte gebeurtenissen, bestemming pas na ontvangst", () => {
  const store = fakeStore();
  inv.bookMovement(store, "t1", { articleId: "a1", locationId: "loc1", type: "receipt", qty: 40 }, "x");
  const t = inv.transfer(store, "t1", { articleId: "a1", fromLocationId: "loc1", toLocationId: "loc2", qty: 15 }, "x");
  assert.equal(t.out.type, "transfer_out");
  assert.equal(t.in.type, "transfer_in");
  assert.equal(t.out.sourceId, t.in.sourceId, "zelfde transfer-id");
  assert.equal(inv.level(store, "t1", "a1", "loc1").physical, 25);
  assert.equal(inv.level(store, "t1", "a1", "loc2").physical, 15);
});

test("voorraad: telling genereert verschilmutaties, geen overschrijving", () => {
  const store = fakeStore();
  inv.bookMovement(store, "t1", { articleId: "a1", locationId: "loc1", type: "receipt", qty: 100 }, "x");
  const res = inv.bookCount(store, "t1", [{ articleId: "a1", locationId: "loc1", countedQty: 95 }], "x");
  assert.equal(res.count, 1);
  assert.equal(res.adjustments[0].type, "count_adjustment");
  assert.equal(res.adjustments[0].qty, -5);
  assert.equal(inv.level(store, "t1", "a1", "loc1").physical, 95);
  // Geen verschil → geen mutatie.
  assert.equal(inv.bookCount(store, "t1", [{ articleId: "a1", locationId: "loc1", countedQty: 95 }], "x").count, 0);
});

test("aankoop: per-lijn besteld/ontvangen tracking + reproduceerbaar percentage", () => {
  const po = normalizePurchaseOrder({ supplierId: "s1", lines: [
    { description: "Buizen", orderedQty: 100, unitPrice: 10 },
    { description: "Fittingen", orderedQty: 50, unitPrice: 4 },
  ] });
  assert.equal(po.subtotal, 1200);
  assert.equal(receiptProgress(po).pct, 0);
  assert.equal(commitmentAmount(po), 1200, "volledige bestelling is verplichting");

  // Deelontvangst van lijn 1.
  po.lines[0].receivedQty = 40;
  const prog = receiptProgress(po);
  assert.equal(prog.receivedQty, 40);
  assert.equal(prog.pct, round2(40 / 150 * 100));
  assert.equal(prog.fullyReceived, false);
  assert.equal(commitmentAmount(po), round2(60 * 10 + 50 * 4), "openstaande verplichting daalt");
});

test("aankoop: repository ontvangst boekt voorraad + zet status + over-receipt-guard", () => {
  const store = fakeStore();
  const repo = makePurchaseOrderRepository(store);
  const po = repo.insert("t1", { supplierId: "s1", locationId: "loc1", lines: [{ description: "Kabel", articleId: "art1", orderedQty: 100, unitPrice: 2 }] }, "x");
  repo.transition("t1", po.id, "approved", "x");
  repo.transition("t1", po.id, "sent", "x");
  repo.transition("t1", po.id, "confirmed", "x");

  const lineId = repo.findById("t1", po.id).lines[0].id;
  const r1 = repo.receive("t1", po.id, [{ lineId, qty: 60 }], "x");
  assert.equal(r1.purchaseOrder.status, "partially_received");
  assert.equal(r1.progress.pct, 60);
  assert.equal(r1.movements.length, 1);
  assert.equal(inv.level(store, "t1", "art1", "loc1").physical, 60, "ontvangst boekt voorraad");

  // Over-ontvangst → 409.
  assert.throws(() => repo.receive("t1", po.id, [{ lineId, qty: 50 }], "x"), /OVER_RECEIPT|overschrijdt/);

  const r2 = repo.receive("t1", po.id, [{ lineId, qty: 40 }], "x");
  assert.equal(r2.purchaseOrder.status, "received");
  assert.equal(r2.progress.fullyReceived, true);
  assert.equal(inv.level(store, "t1", "art1", "loc1").physical, 100);

  // Afsluiten met open hoeveelheden vereist reden (andere PO).
  const po2 = repo.insert("t1", { supplierId: "s1", lines: [{ description: "X", orderedQty: 10, unitPrice: 1 }] }, "x");
  repo.transition("t1", po2.id, "approved", "x");
  repo.transition("t1", po2.id, "sent", "x");
  repo.transition("t1", po2.id, "confirmed", "x");
  repo.transition("t1", po2.id, "received", "x");
  try { repo.transition("t1", po2.id, "closed", "x"); assert.fail("reden verwacht"); }
  catch (e) { assert.equal(e.code, "REASON_REQUIRED"); }
  assert.equal(repo.transition("t1", po2.id, "closed", "x", { reason: "restant vervalt" }).status, "closed");
});

function round2(n) { return Math.round(n * 100) / 100; }
