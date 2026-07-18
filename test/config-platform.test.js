"use strict";
// Configuratieplatform (master-spec h12/E10): custom fields + validatie + lifecycle.
const { test } = require("node:test");
const assert = require("node:assert");

const { normalizeKey, validateValue, makeConfigRepository } = require("../src/platform/config-platform");

function fakeStore(data = {}) {
  const d = { customFields: [], ...data };
  return {
    data: d,
    list(col, tid) { return (d[col] || []).filter(r => r.tenantId === tid); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    update(col, id, patch) { d[col] = d[col].map(r => r.id === id ? { ...r, ...patch } : r); return d[col].find(r => r.id === id); },
    remove(col, id) { d[col] = d[col].filter(r => r.id !== id); },
    save() {},
  };
}

test("config: technische sleutel wordt genormaliseerd", () => {
  assert.equal(normalizeKey("PO Nummer!"), "po_nummer_");
  assert.equal(normalizeKey("123abc"), "abc");
  assert.equal(normalizeKey("Réf Client"), "r_f_client");
});

test("config: validateValue per type", () => {
  assert.equal(validateValue({ type: "text", required: true, labels: { nl: "Naam" } }, ""), "Naam is verplicht");
  assert.equal(validateValue({ type: "text", required: false, labels: { nl: "X" } }, ""), null);
  assert.equal(validateValue({ type: "number", labels: { nl: "N" }, validation: { min: 0, max: 10 } }, 15), "N moet ≤ 10 zijn");
  assert.equal(validateValue({ type: "number", labels: { nl: "N" }, validation: {} }, 5), null);
  assert.equal(validateValue({ type: "date", labels: { nl: "D" }, validation: {} }, "2026-13-01").includes("geldige datum"), true);
  assert.equal(validateValue({ type: "select", labels: { nl: "S" }, options: [{ value: "a" }] }, "b").includes("geen geldige keuze"), true);
  assert.equal(validateValue({ type: "select", labels: { nl: "S" }, options: [{ value: "a" }] }, "a"), null);
  assert.equal(validateValue({ type: "multiselect", labels: { nl: "M" }, options: [{ value: "a" }, { value: "b" }] }, ["a", "c"]).includes("'c'"), true);
});

test("config: sleutel uniek per entiteit, immutable na publicatie", () => {
  const store = fakeStore();
  const repo = makeConfigRepository(store);
  const f = repo.insert("t1", { entity: "customer", key: "segment", type: "select", label: "Segment", options: ["A", "B"] }, "x");
  assert.equal(f.key, "segment");
  assert.equal(f.status, "draft");
  assert.throws(() => repo.insert("t1", { entity: "customer", key: "segment", type: "text", label: "Dubbel" }, "x"), /DUPLICATE_KEY|bestaat al/);

  // In draft mag sleutel nog wijzigen; publiceren; daarna niet meer.
  repo.transition("t1", f.id, "published", "x");
  assert.throws(() => repo.update("t1", f.id, { key: "andere", label: "X", options: ["A", "B"] }, "x"), /KEY_IMMUTABLE|kan na publicatie/);
  assert.throws(() => repo.update("t1", f.id, { type: "text", label: "X" }, "x"), /veldtype kan na publicatie/);
  // Weergavenaam mag wel wijzigen.
  const up = repo.update("t1", f.id, { label: "Klantsegment", options: ["A", "B"] }, "x");
  assert.equal(up.labels.nl, "Klantsegment");
});

test("config: gepubliceerd veld archiveren i.p.v. verwijderen", () => {
  const store = fakeStore();
  const repo = makeConfigRepository(store);
  const f = repo.insert("t1", { entity: "project", key: "risk", type: "text", label: "Risico" }, "x");
  repo.transition("t1", f.id, "published", "x");
  assert.throws(() => repo.remove("t1", f.id), /ARCHIVE_INSTEAD|kan niet worden verwijderd/);
  const arch = repo.transition("t1", f.id, "archived", "x");
  assert.equal(arch.status, "archived");
  // Draft mag wel echt weg.
  const d = repo.insert("t1", { entity: "project", key: "temp", type: "text", label: "Tijdelijk" }, "x");
  assert.deepEqual(repo.remove("t1", d.id), { ok: true });
});

test("config: validateValues tegen gepubliceerde definities", () => {
  const store = fakeStore();
  const repo = makeConfigRepository(store);
  const seg = repo.insert("t1", { entity: "customer", key: "segment", type: "select", label: "Segment", options: ["retail", "b2b"], required: true }, "x");
  const score = repo.insert("t1", { entity: "customer", key: "score", type: "number", label: "Score", validation: { min: 0, max: 100 } }, "x");
  // Draft telt niet mee.
  assert.equal(repo.validateValues("t1", "customer", {}).ok, true, "geen published velden → niets verplicht");
  repo.transition("t1", seg.id, "published", "x");
  repo.transition("t1", score.id, "published", "x");

  const bad = repo.validateValues("t1", "customer", { score: 150 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(e => e.key === "segment" && /verplicht/.test(e.error)));
  assert.ok(bad.errors.some(e => e.key === "score"));

  const good = repo.validateValues("t1", "customer", { segment: "b2b", score: "80", onbekend: "genegeerd" });
  assert.equal(good.ok, true);
  assert.equal(good.values.segment, "b2b");
  assert.equal(good.values.score, 80, "number genormaliseerd");
  assert.equal(good.values.onbekend, undefined, "onbekende sleutel genegeerd");
});
