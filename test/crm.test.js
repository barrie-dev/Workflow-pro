"use strict";
// Genormaliseerd CRM + compatibility repository (master-spec E03, h7; infra E3/M1).
const { test } = require("node:test");
const assert = require("node:assert");

const { normalizeCustomer, upgradeLegacy, makeCustomerRepository, CUSTOMER_SCHEMA_VERSION } = require("../src/platform/crm");

function fakeStore(rows = []) {
  const data = { customers: rows.slice() };
  return {
    data,
    list(col, tid) { return (data[col] || []).filter(r => r.tenantId === tid); },
    insert(col, row) { data[col].push(row); return row; },
    update(col, id, patch) { data[col] = data[col].map(r => r.id === id ? { ...r, ...patch } : r); return data[col].find(r => r.id === id); },
    remove(col, id) { data[col] = data[col].filter(r => r.id !== id); },
    save() {},
  };
}

test("crm: normalizeCustomer bouwt canoniek model + legacy-spiegel", () => {
  const c = normalizeCustomer({ name: "  Bouw NV ", vatNumber: "BE0123", email: "INFO@bouw.be", phone: "0470", contactName: "Jan", address: "Dorpstraat 1", city: "Gent", zip: "9000", paymentTermsDays: 45, language: "fr" });
  assert.equal(c.name, "Bouw NV");
  assert.equal(c.type, "company");
  assert.equal(c.language, "fr");
  assert.equal(c.paymentTermsDays, 45);
  assert.equal(c.creditStatus, "ok");
  assert.equal(c.schemaVersion, CUSTOMER_SCHEMA_VERSION);
  // Contact afgeleid + primair
  assert.equal(c.contacts.length, 1);
  assert.equal(c.contacts[0].name, "Jan");
  assert.equal(c.contacts[0].email, "info@bouw.be");
  assert.equal(c.contacts[0].isPrimary, true);
  // Adres afgeleid
  assert.equal(c.addresses.length, 1);
  assert.equal(c.addresses[0].line, "Dorpstraat 1");
  assert.equal(c.addresses[0].country, "BE");
  // Legacy-spiegel blijft leesbaar voor de rest van de app
  assert.equal(c.email, "info@bouw.be");
  assert.equal(c.contactName, "Jan");
  assert.equal(c.address, "Dorpstraat 1");
  assert.equal(c.city, "Gent");

  assert.throws(() => normalizeCustomer({ name: "" }), /Naam/);
  assert.throws(() => normalizeCustomer({ name: "X", email: "geen-mail" }), /e-mailadres/);
  // Betaaltermijn geklemd; onbekende taal blijft; ongeldige type → company.
  assert.equal(normalizeCustomer({ name: "X", paymentTermsDays: 999 }).paymentTermsDays, 120);
});

test("crm: expliciete contacts en addresses worden gerespecteerd", () => {
  const c = normalizeCustomer({
    name: "Multi BV",
    contacts: [{ name: "Piet", role: "zaakvoerder" }, { name: "An", email: "an@x.be", isPrimary: true }],
    addresses: [{ type: "site", line: "Werf 5", city: "Aalst" }, { type: "billing", line: "HQ 1", city: "Gent" }],
  });
  assert.equal(c.contacts.length, 2);
  const primary = c.contacts.find(x => x.isPrimary);
  assert.equal(primary.name, "An");
  assert.equal(c.contactName, "An", "spiegel = primair contact");
  assert.equal(c.address, "HQ 1", "spiegel = facturatieadres");
  assert.equal(c.addresses.find(a => a.type === "site").line, "Werf 5");
});

test("crm: upgradeLegacy tilt een plat record naar canoniek", () => {
  const legacy = { id: "cust_1", tenantId: "t1", name: "Oud BV", email: "oud@x.be", phone: "011", address: "Straat 9", city: "Hasselt", createdAt: "2026-01-01" };
  const up = upgradeLegacy(legacy);
  assert.equal(up.id, "cust_1", "id/tenant/timestamps behouden");
  assert.equal(up.createdAt, "2026-01-01");
  assert.equal(up.schemaVersion, CUSTOMER_SCHEMA_VERSION);
  assert.equal(up.contacts[0].email, "oud@x.be");
  assert.equal(up.addresses[0].city, "Hasselt");
  // Idempotent: al genormaliseerd blijft ongemoeid.
  assert.strictEqual(upgradeLegacy(up), up);
});

test("crm: repository schrijft genormaliseerd met technische velden", () => {
  const store = fakeStore();
  const repo = makeCustomerRepository(store);
  const c = repo.insert("t1", { name: "Repo NV", email: "r@x.be" }, "admin@x.be");
  assert.match(c.id, /^cust_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(c.version, 1);
  assert.equal(c.createdBy, "admin@x.be");
  assert.equal(c.schemaVersion, CUSTOMER_SCHEMA_VERSION);
  assert.equal(repo.list("t1").length, 1);
  assert.equal(repo.findById("t1", c.id).name, "Repo NV");
});

test("crm: repository update met optimistic locking (h7)", () => {
  const store = fakeStore();
  const repo = makeCustomerRepository(store);
  const c = repo.insert("t1", { name: "Lock NV" }, "a@x.be");

  const up1 = repo.update("t1", c.id, { phone: "0470" }, "b@x.be", 1);
  assert.equal(up1.version, 2);
  assert.equal(up1.phone, "0470");
  assert.equal(up1.updatedBy, "b@x.be");
  assert.equal(up1.name, "Lock NV", "merge behoudt bestaande velden");

  // Stale expectedVersion → 409 VERSION_CONFLICT.
  try { repo.update("t1", c.id, { phone: "999" }, "c@x.be", 1); assert.fail("verwacht conflict"); }
  catch (e) { assert.equal(e.status, 409); assert.equal(e.code, "VERSION_CONFLICT"); assert.equal(e.currentVersion, 2); }

  // Zonder expectedVersion blijft het werken (backwards compatible).
  assert.equal(repo.update("t1", c.id, { phone: "111" }, "d@x.be").version, 3);

  assert.throws(() => repo.update("t1", "bestaatniet", {}, "x"), /niet gevonden/);
});

test("crm: repository leest legacy records via compatibility (upgrade on read)", () => {
  const store = fakeStore([{ id: "cust_old", tenantId: "t1", name: "Legacy BV", email: "l@x.be", city: "Brugge" }]);
  const repo = makeCustomerRepository(store);
  const list = repo.list("t1");
  assert.equal(list.length, 1);
  assert.equal(list[0].schemaVersion, CUSTOMER_SCHEMA_VERSION);
  assert.equal(list[0].contacts[0].email, "l@x.be");
  assert.equal(list[0].addresses[0].city, "Brugge");
});
