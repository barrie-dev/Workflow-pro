"use strict";
// CTO-04 · persistence-concurrency: de conflictmerge zonder verlies of
// resurrectie. Puur op mergeStateInto (geen database nodig): update/update,
// update/delete, delete/delete en gelijktijdige child-mutaties, mét tombstones.
const { test } = require("node:test");
const assert = require("node:assert");
const { mergeStateInto, pruneTombstones, TOMBSTONES_KEY } = require("../src/infrastructure/postgres/pg-data-adapter");

const row = (id, v) => ({ id, value: v });

test("append/append · rijen van beide instanties blijven behouden", () => {
  const ours = { customers: [row("a", 1), row("b", 2)] };
  const theirs = { customers: [row("a", 1), row("c", 3)] };
  mergeStateInto(ours, theirs);
  assert.deepEqual(ours.customers.map(r => r.id).sort(), ["a", "b", "c"]);
});

test("update/update zelfde rij · onze versie wint per rij (gedocumenteerd, single-writer dekt productie)", () => {
  const ours = { customers: [row("a", "onze-wijziging")] };
  const theirs = { customers: [row("a", "hun-wijziging")] };
  mergeStateInto(ours, theirs);
  assert.equal(ours.customers.find(r => r.id === "a").value, "onze-wijziging");
  assert.equal(ours.customers.length, 1, "geen duplicaat van dezelfde id");
});

test("update/delete · ONZE delete blijft (geen resurrectie via hun oude kopie)", () => {
  // Wij verwijderden 'a' (tombstone); de andere instantie heeft 'a' nog.
  const ours = { customers: [row("b", 2)], [TOMBSTONES_KEY]: { customers: { a: new Date().toISOString() } } };
  const theirs = { customers: [row("a", 1), row("b", 2)] };
  mergeStateInto(ours, theirs);
  assert.deepEqual(ours.customers.map(r => r.id), ["b"], "verwijderde rij keert NIET terug");
});

test("delete/update · HUN delete wint van onze gelijktijdige update (delete wint)", () => {
  // De andere instantie verwijderde 'a' (tombstone in de database-staat);
  // wij wijzigden 'a' nog tijdens het overlap-venster.
  const ours = { customers: [row("a", "late-wijziging"), row("b", 2)] };
  const theirs = { customers: [row("b", 2)], [TOMBSTONES_KEY]: { customers: { a: new Date().toISOString() } } };
  mergeStateInto(ours, theirs);
  assert.deepEqual(ours.customers.map(r => r.id), ["b"], "delete wint · geen halfslachtige heropstanding");
});

test("delete/delete · rij blijft weg, tombstones verenigd zonder fout", () => {
  const at = new Date().toISOString();
  const ours = { customers: [], [TOMBSTONES_KEY]: { customers: { a: at } } };
  const theirs = { customers: [], [TOMBSTONES_KEY]: { customers: { a: at, b: at } } };
  mergeStateInto(ours, theirs);
  assert.equal(ours.customers.length, 0);
  assert.deepEqual(Object.keys(ours[TOMBSTONES_KEY].customers).sort(), ["a", "b"], "beide deletes bekend");
});

test("gelijktijdige child-mutaties · andere collecties blijven onafhankelijk", () => {
  const ours = { customers: [row("a", 1)], invoices: [row("i1", 100)] };
  const theirs = { customers: [row("a", 1)], invoices: [row("i2", 200)], payments: [row("p1", 5)] };
  mergeStateInto(ours, theirs);
  assert.deepEqual(ours.invoices.map(r => r.id).sort(), ["i1", "i2"]);
  assert.deepEqual(ours.payments.map(r => r.id), ["p1"], "onbekende collectie overgenomen");
});

test("tombstone-TTL · oude tombstones worden gepruned, verse blijven", () => {
  const old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  const fresh = new Date().toISOString();
  const map = { customers: { oud: old, vers: fresh } };
  pruneTombstones(map);
  assert.deepEqual(Object.keys(map.customers), ["vers"]);
});

test("Store.remove registreert een tombstone (bron van de merge-kennis)", () => {
  const { Store } = require("../src/lib/store");
  const store = Object.create(Store.prototype);
  store.data = { widgets: [{ id: "w1" }, { id: "w2" }] };
  store.save = () => {};
  const removed = store.remove("widgets", "w1");
  assert.equal(removed, true);
  assert.ok(store.data._tombstones.widgets.w1, "tombstone gezet met tijdstip");
  assert.deepEqual(store.data.widgets.map(r => r.id), ["w2"]);
  // Nogmaals verwijderen: geen fout, geen tweede tombstone-drama.
  assert.equal(store.remove("widgets", "w1"), false);
});
