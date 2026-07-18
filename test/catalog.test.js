"use strict";
// Catalogus & materiaal (master-spec h20/E13): kost/verkoop apart, prijsprioriteit,
// document-snapshot, samenstelling-kostopbouw, eenheidsconversie, statusmodel.
const { test } = require("node:test");
const assert = require("node:assert");

const {
  normalizeArticle, resolvePrice, snapshotForLine, explodeComposition, convertQuantity, makeCatalogRepository,
} = require("../src/platform/catalog");

function fakeStore(data = {}) {
  const d = { articles: [], priceRules: [], numberSequences: [], ...data };
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
const TENANT = { id: "t1", name: "Demo" };

test("catalog: kost- en verkoopprijs worden afzonderlijk bewaard", () => {
  const a = normalizeArticle({ name: "Kabel 3x2.5", costPrice: 1.2, salesPrice: 2.5, unit: "m", vatRate: 21 });
  assert.equal(a.costPrice, 1.2);
  assert.equal(a.salesPrice, 2.5);
  assert.equal(a.stockTracked, true, "materiaal is standaard voorraadgevolgd");
  const svc = normalizeArticle({ name: "Montage-uur", type: "labor", costPrice: 30, salesPrice: 55 });
  assert.equal(svc.stockTracked, false, "arbeid is niet-voorraad");
  assert.equal(svc.lineType, "service");
});

test("catalog: margin_on_cost rekent marge op de verkoopprijs, niet als opslag", () => {
  // Kost 60, gewenste marge 40% van de VERKOOPPRIJS → verkoop = 100 (marge 40).
  const a = normalizeArticle({ name: "Dienst", type: "labor", costPrice: 60, salesStrategy: "margin_on_cost", marginPct: 40 });
  const store = fakeStore();
  const r = resolvePrice(store, TENANT, { ...a, id: "x" });
  assert.equal(r.unitPrice, 100, "60 / (1-0.40) = 100");
  assert.equal(r.source, "article_strategy");
  // Opslag (markup) 40% op kost → 84 · bewust anders dan marge.
  const b = normalizeArticle({ name: "Dienst2", type: "labor", costPrice: 60, salesStrategy: "markup_on_cost", marginPct: 40 });
  assert.equal(resolvePrice(store, TENANT, { ...b, id: "y" }).unitPrice, 84);
});

test("catalog: prijsprioriteit klant > groep > regel > handmatig > strategie", () => {
  const store = fakeStore();
  const repo = makeCatalogRepository(store);
  const art = repo.insert("t1", { name: "Plaat", costPrice: 10, salesPrice: 20 }, "admin");
  repo.addPriceRule("t1", { articleId: art.id, scope: "all", price: 18 }, "admin");
  repo.addPriceRule("t1", { articleId: art.id, scope: "price_group", priceGroup: "goud", price: 16 }, "admin");
  repo.addPriceRule("t1", { articleId: art.id, scope: "customer", customerId: "c1", price: 14 }, "admin");
  assert.equal(resolvePrice(store, TENANT, art, { customerId: "c1", priceGroup: "goud" }).source, "customer");
  assert.equal(resolvePrice(store, TENANT, art, { customerId: "c1", priceGroup: "goud" }).unitPrice, 14);
  assert.equal(resolvePrice(store, TENANT, art, { priceGroup: "goud" }).unitPrice, 16);
  assert.equal(resolvePrice(store, TENANT, art, {}).unitPrice, 18, "algemene prijsregel");
  // Zonder regels valt hij op strategie/stamprijs terug.
  const bare = repo.insert("t1", { name: "Bout", costPrice: 1, salesPrice: 3 }, "admin");
  assert.equal(resolvePrice(store, TENANT, bare, {}).source, "article_strategy");
  assert.equal(resolvePrice(store, TENANT, bare, {}).unitPrice, 3);
});

test("catalog: prijsregel met geldigheidsdatum in de toekomst geldt nog niet", () => {
  const store = fakeStore();
  const repo = makeCatalogRepository(store);
  const art = repo.insert("t1", { name: "Buis", salesPrice: 20 }, "admin");
  repo.addPriceRule("t1", { articleId: art.id, scope: "all", price: 25, validFrom: "2099-01-01" }, "admin");
  assert.equal(resolvePrice(store, TENANT, art, { at: "2026-07-18" }).unitPrice, 20, "toekomstige regel telt niet");
  assert.equal(resolvePrice(store, TENANT, art, { at: "2099-06-01" }).unitPrice, 25);
});

test("catalog: document-snapshot klikt prijs/kost/eenheid vast (stamwijziging verandert doc niet)", () => {
  const store = fakeStore();
  const repo = makeCatalogRepository(store);
  const art = repo.insert("t1", { name: "Kraan", unit: "st", costPrice: 100, salesPrice: 150, vatRate: 21 }, "admin");
  const line = snapshotForLine(store, TENANT, art, { qty: 2 });
  assert.equal(line.unitPrice, 150);
  assert.equal(line.costPrice, 100);
  assert.equal(line.lineTotal, 300);
  assert.equal(line.lineCost, 200);
  assert.equal(line.priceSource, "article_strategy");
  assert.ok(line.priceDate, "prijsdatum zichtbaar");
  // Stamprijs wijzigt → de snapshot blijft gelijk (business rule h20).
  repo.update("t1", art.id, { name: "Kraan", unit: "st", costPrice: 120, salesPrice: 175, vatRate: 21 }, "admin", 1);
  assert.equal(line.unitPrice, 150, "bestaande documentlijn ongewijzigd na stamwijziging");
});

test("catalog: samengesteld artikel levert controleerbare kostopbouw", () => {
  const store = fakeStore();
  const repo = makeCatalogRepository(store);
  const kabel = repo.insert("t1", { name: "Kabel", unit: "m", costPrice: 2 }, "admin");
  const stekker = repo.insert("t1", { name: "Stekker", unit: "st", costPrice: 5 }, "admin");
  const set = repo.insert("t1", { name: "Verlengset", type: "composite", composition: [
    { articleId: kabel.id, qty: 10 }, { articleId: stekker.id, qty: 2 },
  ] }, "admin");
  const build = explodeComposition(store, TENANT, set, 3);
  assert.equal(build.unitCost, 30, "10*2 + 2*5 = 30 per set");
  assert.equal(build.totalCost, 90, "3 sets");
  assert.equal(build.components.length, 2);
});

test("catalog: samenstelling met cyclus wordt geweigerd", () => {
  const store = fakeStore();
  const repo = makeCatalogRepository(store);
  const a = repo.insert("t1", { name: "A", costPrice: 1 }, "admin");
  const b = repo.insert("t1", { name: "B", type: "composite", composition: [{ articleId: a.id, qty: 1 }] }, "admin");
  // Maak A samengesteld met B → cyclus.
  store.update("articles", a.id, { type: "composite", composition: [{ articleId: b.id, qty: 1 }] });
  assert.throws(() => explodeComposition(store, TENANT, store.get("articles", b.id)), /cyclus|COMPOSITION_CYCLE/);
});

test("catalog: eenheidsconversie via vaste factor met afronding", () => {
  const art = normalizeArticle({ name: "Kabel", unit: "m", altUnits: [{ unit: "rol", factor: 100, rounding: "up" }] });
  // 250 m → rollen (up) = 3 (250/100 = 2.5 → 3)
  assert.equal(convertQuantity(art, 250, "m", "rol"), 3);
  // 3 rol → m = 300
  assert.equal(convertQuantity(art, 3, "rol", "m"), 300);
  assert.throws(() => convertQuantity(art, 1, "m", "kg"), /Geen conversie/);
});

test("catalog: statusmodel · uitgefaseerd blijft in lijst, niet selecteerbaar; archief blokkeert edit", () => {
  const store = fakeStore();
  const repo = makeCatalogRepository(store);
  const art = repo.insert("t1", { name: "Oud artikel", salesPrice: 5 }, "admin");
  repo.transition("t1", art.id, "active", "admin");
  repo.transition("t1", art.id, "phased_out", "admin");
  assert.ok(repo.list("t1").some(a => a.id === art.id), "uitgefaseerd zichtbaar in overzicht");
  assert.ok(!repo.list("t1", { selectableOnly: true }).some(a => a.id === art.id), "niet standaard selecteerbaar");
  repo.transition("t1", art.id, "archived", "admin");
  assert.throws(() => repo.update("t1", art.id, { name: "x", salesPrice: 5 }, "admin"), /gearchiveerd/);
});

test("catalog: optimistic locking bij gelijktijdige wijziging", () => {
  const store = fakeStore();
  const repo = makeCatalogRepository(store);
  const art = repo.insert("t1", { name: "Item", salesPrice: 10 }, "admin");
  repo.update("t1", art.id, { name: "Item v2", salesPrice: 11 }, "admin", 1);
  assert.throws(() => repo.update("t1", art.id, { name: "Item v3", salesPrice: 12 }, "admin", 1), /VERSION_CONFLICT|intussen gewijzigd/);
});

test("catalog: artikelnummers zijn continu (ART-nnnn), niet jaargebonden", () => {
  const store = fakeStore();
  const repo = makeCatalogRepository(store);
  const a1 = repo.insert("t1", { name: "Een", salesPrice: 1 }, "admin");
  const a2 = repo.insert("t1", { name: "Twee", salesPrice: 1 }, "admin");
  assert.match(a1.number, /^ART-\d{4}$/);
  assert.equal(a2.number, "ART-0002");
});
