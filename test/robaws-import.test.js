"use strict";
// Robaws-importer (master-spec h47.1/E20): validatie + idempotente import.
const { test } = require("node:test");
const assert = require("node:assert");

const { validateImport, runImport, looksLikeBeVat } = require("../src/platform/robaws-import");

function fakeStore(data = {}) {
  const d = { customers: [], suppliers: [], stock: [], venues: [], invoices: [], ...data };
  return {
    data: d,
    list(col, tid) { return (d[col] || []).filter(r => r.tenantId === tid); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    save() {},
  };
}
const TENANT = { id: "t1" };

const SAMPLE = () => ({
  customers: [
    { externalId: "R-C1", name: "Bouw NV", vat: "BE0123456789", email: "INFO@bouw.be" },
    { externalId: "R-C2", name: "An BVBA", vat: "FOUT" },
  ],
  suppliers: [{ externalId: "R-S1", name: "Groothandel", vat: "BE0222333444" }],
  articles: [{ externalId: "R-A1", name: "Buis 32mm", sku: "B32", unitPrice: 12 }],
  locations: [{ externalId: "R-L1", name: "Werf Gent", city: "Gent" }],
  invoices: [{ externalId: "R-I1", number: "2025-050", customerExternalId: "R-C1", total: 1210, finalized: true, paid: true }],
});

test("robaws: btw-structuurcheck", () => {
  assert.equal(looksLikeBeVat("BE0123456789"), true);
  assert.equal(looksLikeBeVat("BE 0123.456.789"), true);
  assert.equal(looksLikeBeVat("FOUT"), false);
  assert.equal(looksLikeBeVat("NL123"), false);
});

test("robaws: validatie telt en signaleert zonder te schrijven", () => {
  const store = fakeStore();
  const rep = validateImport(store, TENANT, SAMPLE());
  assert.equal(rep.ok, true, "geen blokkerende fouten");
  assert.equal(rep.summary.customers.willCreate, 2);
  assert.equal(rep.summary.customers.warnings, 1, "ongeldig btw = waarschuwing");
  assert.equal(rep.summary.invoices.willCreate, 1);
  assert.equal(store.data.customers.length, 0, "validatie schrijft niets");
});

test("robaws: validatie blokkeert bij dubbel id, ontbrekende relatie en ontbrekend id", () => {
  const store = fakeStore();
  const bad = {
    customers: [{ externalId: "R-C1", name: "A" }, { externalId: "R-C1", name: "B" }, { name: "geen id" }],
    invoices: [{ externalId: "R-I9", number: "X", customerExternalId: "ONBEKEND", total: 100 }],
  };
  const rep = validateImport(store, TENANT, bad);
  assert.equal(rep.ok, false);
  const custIssues = rep.entities.customers.issues;
  assert.ok(custIssues.some(i => /dubbel external_id/.test(i.msg)));
  assert.ok(custIssues.some(i => /external_id ontbreekt/.test(i.msg)));
  assert.ok(rep.entities.invoices.issues.some(i => /onbekende klant/.test(i.msg)));
});

test("robaws: import is idempotent op external_id + relatie-mapping + snapshot", () => {
  const store = fakeStore();
  const first = runImport(store, TENANT, SAMPLE(), "admin@x.be");
  assert.equal(first.report.customers.created, 2);
  assert.equal(first.report.suppliers.created, 1);
  assert.equal(first.report.articles.created, 1);
  assert.equal(first.report.locations.created, 1);
  assert.equal(first.report.invoices.created, 1);
  assert.equal(first.report.totals.created, 6);

  // Mapping + externalIds op de records.
  const c1Id = first.mapping.customers["R-C1"];
  assert.ok(c1Id);
  assert.equal(store.data.customers.find(c => c.id === c1Id).externalIds.robaws, "R-C1");

  // Historische factuur = onveranderlijke externe snapshot, gelinkt aan klant.
  const snap = store.data.invoices[0];
  assert.equal(snap.docType, "external_snapshot");
  assert.equal(snap.editable, false);
  assert.equal(snap.customerId, c1Id, "relatie via external→intern mapping");

  // Tweede run met dezelfde data → alles skipped (herstart-veilig).
  const second = runImport(store, TENANT, SAMPLE(), "admin@x.be");
  assert.equal(second.report.totals.created, 0);
  assert.equal(second.report.customers.skipped, 2);
  assert.equal(store.data.customers.length, 2, "geen duplicaten");

  // Nieuw record in een verder identieke set → alleen dat wordt aangemaakt.
  const grow = SAMPLE(); grow.customers.push({ externalId: "R-C3", name: "Nieuw NV" });
  const third = runImport(store, TENANT, grow, "admin@x.be");
  assert.equal(third.report.customers.created, 1);
  assert.equal(third.report.customers.skipped, 2);
});
