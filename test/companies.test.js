"use strict";
// Company-laag + nummerreeksen (master-spec E01, PLT-BR-005): default-company,
// monotone nummering, seed vanaf legacy, geen hergebruik na delete.
const { test } = require("node:test");
const assert = require("node:assert");

const { companyFromTenant, ensureDefaultCompany, issueNumber } = require("../src/platform/companies");

function fakeStore(data = {}) {
  return { data: { companies: [], numberSequences: [], invoices: [], quotes: [], workorders: [], ...data }, save() {} };
}
const TENANT = { id: "t1", name: "Demo Bouw BV", invoiceProfile: { name: "Demo Bouw BV", vat: "BE0123456749", companyNumber: "0123.456.749", iban: "BE68539007547034" } };

test("companies: companyFromTenant vult uit invoiceProfile", () => {
  const c = companyFromTenant(TENANT);
  assert.match(c.id, /^co_/);
  assert.equal(c.tenantId, "t1");
  assert.equal(c.legalName, "Demo Bouw BV");
  assert.equal(c.vat, "BE0123456749");
  assert.equal(c.iban, "BE68539007547034");
  assert.equal(c.isDefault, true);
});

test("companies: ensureDefaultCompany is idempotent", () => {
  const store = fakeStore();
  const a = ensureDefaultCompany(store, TENANT);
  const b = ensureDefaultCompany(store, TENANT);
  assert.equal(a.id, b.id);
  assert.equal(store.data.companies.length, 1);
});

test("nummerreeksen: monotoon per documenttype en juiste formaten", () => {
  const store = fakeStore();
  const year = new Date().getFullYear();
  const i1 = issueNumber(store, { tenant: TENANT, docType: "invoice" });
  const i2 = issueNumber(store, { tenant: TENANT, docType: "invoice" });
  const q1 = issueNumber(store, { tenant: TENANT, docType: "quote" });
  const w1 = issueNumber(store, { tenant: TENANT, docType: "workorder" });
  assert.equal(i1.number, `${year}-001`);
  assert.equal(i2.number, `${year}-002`);
  assert.equal(q1.number, `OFF-${year}-001`);
  assert.equal(w1.number, `WO-${year}-001`);
  assert.equal(i1.companyId, i2.companyId, "zelfde default-company");
  assert.throws(() => issueNumber(store, { tenant: TENANT, docType: "bestaatniet" }), /documenttype/);
});

test("nummerreeksen: seed vanaf hoogste legacy-nummer · delete-gat wordt niet hergebruikt", () => {
  const year = new Date().getFullYear();
  // Legacy: 3 facturen bestonden, nr 2 is verwijderd → hoogste is 003.
  const store = fakeStore({ invoices: [
    { tenantId: "t1", number: `${year}-001` },
    { tenantId: "t1", number: `${year}-003` },
    { tenantId: "anders", number: `${year}-009` },   // andere tenant telt niet mee
  ] });
  const next = issueNumber(store, { tenant: TENANT, docType: "invoice" });
  assert.equal(next.number, `${year}-004`, "max+1, nooit het gat van de delete");
});

test("nummerreeksen: reeks per jaar", () => {
  const store = fakeStore();
  const n2026 = issueNumber(store, { tenant: TENANT, docType: "invoice", now: new Date("2026-12-31T12:00:00Z") });
  const n2027 = issueNumber(store, { tenant: TENANT, docType: "invoice", now: new Date("2027-01-01T12:00:00Z") });
  assert.equal(n2026.number, "2026-001");
  assert.equal(n2027.number, "2027-001", "nieuw jaar start een nieuwe reeks");
  assert.equal(store.data.numberSequences.length, 2);
});
