"use strict";
// IA-14 · Resources-domein · acceptatie: "Movement-led stock; no parallel
//         quantity source."
const { test } = require("node:test");
const assert = require("node:assert");
const res = require("../public/js/app/workspaces/resources/definition");
const tabs = require("../public/js/app/shared/record-tabs");

const BEWEGINGEN = [
  { articleId: "a_1", warehouseId: "w_1", type: "receipt", quantity: 100, sourceType: "purchase_order", sourceId: "po_1" },
  { articleId: "a_1", warehouseId: "w_1", type: "consumption", quantity: 20, sourceType: "work_order", sourceId: "wo_7" },
  { articleId: "a_1", warehouseId: "w_1", type: "consumption", quantity: 15, sourceType: "work_order", sourceId: "wo_9" },
  { articleId: "a_1", warehouseId: "w_2", type: "receipt", quantity: 50, sourceType: "purchase_order", sourceId: "po_2" },
  { articleId: "a_2", warehouseId: "w_1", type: "receipt", quantity: 7, sourceType: "purchase_order", sourceId: "po_1" },
];

test("IA-14 1· de voorraad IS de som van de bewegingen", () => {
  assert.equal(res.stockFromMovements(BEWEGINGEN, { articleId: "a_1", warehouseId: "w_1" }), 65);
  assert.equal(res.stockFromMovements(BEWEGINGEN, { articleId: "a_1" }), 115, "over alle magazijnen");
  assert.equal(res.stockFromMovements(BEWEGINGEN, { articleId: "a_2" }), 7);
  assert.equal(res.stockFromMovements([]), 0, "geen bewegingen is nul, niet onbekend");
});

test("IA-14 2· elke bewegingssoort heeft een eenduidig teken", () => {
  const inkomend = Object.entries(res.MOVEMENT_TYPES).filter(([, t]) => t === 1).map(([k]) => k);
  const uitgaand = Object.entries(res.MOVEMENT_TYPES).filter(([, t]) => t === -1).map(([k]) => k);
  assert.ok(inkomend.length >= 3 && uitgaand.length >= 4);
  for (const t of Object.values(res.MOVEMENT_TYPES)) assert.ok(t === 1 || t === -1, "geen halve tekens");
  // Een negatieve hoeveelheid bij een uitgaande beweging telt niet dubbel.
  assert.equal(res.stockFromMovements([
    { articleId: "a", warehouseId: "w", type: "consumption", quantity: -10 },
  ], { articleId: "a" }), -10, "het teken komt van de SOORT, niet van de invoer");
});

test("IA-14 3· een onbekende bewegingssoort telt niet stil mee", () => {
  const met = [...BEWEGINGEN, { articleId: "a_1", warehouseId: "w_1", type: "verzonnen", quantity: 999 }];
  assert.equal(res.stockFromMovements(met, { articleId: "a_1", warehouseId: "w_1" }), 65);
});

test("IA-14 4· GEEN PARALLELLE BRON: een artikel draagt geen eigen hoeveelheid", () => {
  assert.equal(res.checkNoParallelQuantity({ id: "a_1", name: "Kabel" }).ok, true);
  const fout = res.checkNoParallelQuantity({ id: "a_1", quantityOnHand: 65, stockLevel: 65 });
  assert.equal(fout.ok, false);
  assert.deepEqual(fout.violations.map(v => v.field).sort(), ["quantityOnHand", "stockLevel"]);
  assert.equal(fout.violations.every(v => v.reason === "PARALLEL_QUANTITY_SOURCE"), true);
});

test("IA-14 5· elk verboden hoeveelheidsveld staat in het register", () => {
  for (const f of res.FORBIDDEN_QUANTITY_FIELDS) {
    assert.equal(res.checkNoParallelQuantity({ [f]: 1 }).ok, false, `${f} wordt niet gedetecteerd`);
  }
  // Ook de waarde nul is een parallelle bron · juist die verbergt zich goed.
  assert.equal(res.checkNoParallelQuantity({ quantityOnHand: 0 }).ok, false);
});

test("IA-14 6· een cache mag bestaan, maar de SOM wint", () => {
  const uit = res.reconcileStock(70, BEWEGINGEN, { articleId: "a_1", warehouseId: "w_1" });
  assert.equal(uit.calculated, 65);
  assert.equal(uit.cached, 70);
  assert.equal(uit.drift, 5);
  assert.equal(uit.ok, false);
  assert.equal(uit.authoritative, 65, "de UI toont de som, niet de cache");

  const gelijk = res.reconcileStock(65, BEWEGINGEN, { articleId: "a_1", warehouseId: "w_1" });
  assert.equal(gelijk.ok, true);
  assert.equal(gelijk.drift, 0);
});

test("IA-14 7· elke beweging draagt zijn herkomst", () => {
  assert.equal(res.checkMovement(BEWEGINGEN[0]).ok, true);
  const los = res.checkMovement({ articleId: "a_1", warehouseId: "w_1", type: "consumption", quantity: 5 });
  assert.equal(los.ok, false);
  assert.deepEqual(los.violations, [{ field: "sourceType", reason: "MISSING_SOURCE" }],
    "waar is die kabel gebleven moet te beantwoorden zijn");
});

test("IA-14 8· een HANDMATIGE CORRECTIE zonder reden wordt geweigerd", () => {
  const zonder = res.checkMovement({
    articleId: "a_1", warehouseId: "w_1", type: "adjustment_out", quantity: 12, sourceType: "manual_correction",
  });
  assert.equal(zonder.ok, false);
  assert.deepEqual(zonder.violations, [{ field: "reason", reason: "CORRECTION_NEEDS_REASON" }],
    "anders is het een getal dat iemand goed uitkwam");

  const met = res.checkMovement({
    articleId: "a_1", warehouseId: "w_1", type: "adjustment_out", quantity: 12,
    sourceType: "manual_correction", reason: "breuk bij transport",
  });
  assert.equal(met.ok, true);
});

test("IA-14 9· een beweging van nul wordt geweigerd", () => {
  const uit = res.checkMovement({ articleId: "a_1", warehouseId: "w_1", type: "receipt", quantity: 0, sourceType: "purchase_order" });
  assert.equal(uit.ok, false);
  assert.ok(uit.violations.some(v => v.reason === "ZERO_QUANTITY"));
});

test("IA-14 10· een beweging zonder magazijn of artikel wordt geweigerd", () => {
  const uit = res.checkMovement({ type: "receipt", quantity: 5, sourceType: "purchase_order" });
  assert.deepEqual(uit.violations.map(v => v.field).sort(), ["articleId", "warehouseId"]);
  assert.equal(res.checkMovement({ articleId: "a", warehouseId: "w", type: "verzonnen", quantity: 1, sourceType: "return" })
    .violations[0].reason, "UNKNOWN_MOVEMENT_TYPE");
});

test("IA-14 11· onderhoud is één berekening voor assets én voertuigen", () => {
  const nu = "2026-07-24T00:00:00Z";
  assert.equal(res.maintenanceState({ nextMaintenanceAt: "2026-07-01" }, nu).state, "overdue");
  assert.equal(res.maintenanceState({ nextMaintenanceAt: "2026-08-10" }, nu).state, "due_soon");
  assert.equal(res.maintenanceState({ nextMaintenanceAt: "2026-12-01" }, nu).state, "ok");
  assert.equal(res.maintenanceState({}, nu).state, "unknown",
    "geen keuringsdatum is onbekend, niet in orde");
});

test("IA-14 12· inkoopprijs en marge zitten achter costs.view", () => {
  const magazijnier = tabs.tabsFor(res.DEFINITION, {
    permissions: ["inventory.view"], entitlements: [], params: { articleId: "a_1" },
  });
  assert.equal(magazijnier.some(t => t.id === "pricing"), false, "een magazijnier ziet geen inkoopprijs");
  assert.ok(magazijnier.some(t => t.id === "movements"), "de bewegingen ziet hij wel");

  const assetKosten = tabs.tabsFor(res.ASSET_DEFINITION, {
    permissions: ["assets.view"], params: { assetId: "as_1" },
  });
  assert.equal(assetKosten.some(t => t.id === "costs"), false);
});

test("IA-14 13· beide werkruimtes voldoen aan het gedeelde tabcontract", () => {
  for (const def of [res.DEFINITION, res.ASSET_DEFINITION]) {
    const t = tabs.tabsFor(def, { permissions: ["*"], entitlements: ["procurement"], params: { [def.idParam]: "r_1" } });
    assert.equal(t.filter(x => x.isActive).length, 1, `${def.id} heeft niet precies één actief tabblad`);
    for (const tab of t) {
      assert.equal(tab.route, `${def.recordBase}/r_1/${tab.id}`, `${def.id}/${tab.id} is niet route-backed`);
      assert.match(tab.labelKey, /^[a-z_]+\.tab\.[a-z_]+$/, `${def.id}/${tab.id} heeft geen i18n-sleutel`);
    }
  }
});
