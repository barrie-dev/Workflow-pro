"use strict";
// Construction Core (master-spec h43/E12): worksites + projectpartijen + change orders.
const { test } = require("node:test");
const assert = require("node:assert");

const { normalizeWorksite, makeWorksiteRepository, PARTY_TYPES } = require("../src/platform/worksites");
const { normalizeChangeOrder, makeChangeOrderRepository, canTransition } = require("../src/platform/change-orders");

function fakeStore(data = {}) {
  const d = { worksites: [], changeOrders: [], ...data };
  return {
    data: d,
    list(col, tid) { return (d[col] || []).filter(r => r.tenantId === tid); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    update(col, id, patch) { d[col] = d[col].map(r => r.id === id ? { ...r, ...patch } : r); return d[col].find(r => r.id === id); },
    remove(col, id) { d[col] = d[col].filter(r => r.id !== id); },
    save() {},
  };
}

test("worksites: normalizeWorksite valideert en normaliseert partijen", () => {
  const w = normalizeWorksite({
    name: " Werf Gent Zuid ", projectId: "prj_1", venueId: "venue_1",
    address: "Kaai 5", city: "Gent", accessInfo: "Code 1234, melden bij keet",
    geo: { lat: 51.03, lng: 3.71 },
    parties: [
      { type: "principal", name: "Bouwheer NV", contactEmail: "INFO@BH.be" },
      { type: "architect", name: "Studio A" },
      { type: "onzin", name: "X" },     // onbekend type → subcontractor
      { name: "" },                      // leeg → weggefilterd
    ],
  });
  assert.equal(w.name, "Werf Gent Zuid");
  assert.equal(w.status, "preparation");
  assert.equal(w.venueId, "venue_1", "locatie blijft gedeeld object");
  assert.equal(w.geo.lat, 51.03);
  assert.equal(w.parties.length, 3);
  assert.equal(w.parties[0].contactEmail, "info@bh.be");
  assert.equal(w.parties[2].type, "subcontractor");
  assert.ok(PARTY_TYPES.includes("safety_coordinator"));

  assert.throws(() => normalizeWorksite({ name: "" }), /Werfnaam/);
  assert.throws(() => normalizeWorksite({ name: "X" }), /Project/);
});

test("worksites: repository met versioning en projectfilter", () => {
  const store = fakeStore();
  const repo = makeWorksiteRepository(store);
  const w1 = repo.insert("t1", { name: "Werf A", projectId: "prj_1" }, "a@x.be");
  repo.insert("t1", { name: "Werf B", projectId: "prj_2" }, "a@x.be");
  assert.match(w1.id, /^ws_/);
  assert.equal(repo.list("t1").length, 2);
  assert.equal(repo.list("t1", { projectId: "prj_1" }).length, 1);

  const up = repo.update("t1", w1.id, { city: "Gent" }, "b@x.be", 1);
  assert.equal(up.version, 2);
  try { repo.update("t1", w1.id, { city: "X" }, "c@x.be", 1); assert.fail("conflict verwacht"); }
  catch (e) { assert.equal(e.code, "VERSION_CONFLICT"); }
});

test("change orders: normalisatie, soort en verplichte reden", () => {
  const co = normalizeChangeOrder({ projectId: "prj_1", reason: "Extra stopcontacten", lines: [{ description: "Stopcontact", qty: 6, unitPrice: 45, vatRate: 21 }] });
  assert.equal(co.kind, "increase");
  assert.equal(co.total, 326.7);
  assert.equal(co.title, "Meerwerk");

  const minder = normalizeChangeOrder({ projectId: "prj_1", reason: "Vloer geschrapt", lines: [{ description: "Vloer", qty: -20, unitPrice: 50, vatRate: 21 }] });
  assert.equal(minder.kind, "decrease");
  assert.equal(minder.title, "Minderwerk");
  assert.equal(minder.total, -1210);

  assert.throws(() => normalizeChangeOrder({ reason: "x", lines: [{ description: "y", qty: 1, unitPrice: 1 }] }), /Project/);
  assert.throws(() => normalizeChangeOrder({ projectId: "p", lines: [{ description: "y", qty: 1, unitPrice: 1 }] }), /Reden/);
  assert.throws(() => normalizeChangeOrder({ projectId: "p", reason: "x", lines: [] }), /lijn/);
});

test("change orders: statemachine + budgetdelta bij acceptatie + lock", () => {
  const store = fakeStore();
  const repo = makeChangeOrderRepository(store);
  const co = repo.insert("t1", { projectId: "prj_1", reason: "Extra werk", lines: [{ description: "Werk", qty: 10, unitPrice: 100, vatRate: 21 }] }, "a@x.be");
  assert.match(co.number, /^CO-\d{4}-001$/);
  assert.equal(co.status, "draft");

  assert.equal(canTransition("draft", "sent"), true);
  assert.equal(canTransition("draft", "invoiced"), false);
  assert.equal(canTransition("invoiced", "draft"), false, "invoiced is eindpunt");

  repo.transition("t1", co.id, "sent", "a@x.be");
  const acc = repo.transition("t1", co.id, "accepted", "a@x.be");
  assert.equal(acc.budgetDelta, 1210, "accepted change levert budgetdelta (h43.4)");
  assert.ok(acc.changeOrder.acceptedAt);

  // Na acceptatie: bewerken en verwijderen geblokkeerd.
  try { repo.update("t1", co.id, { reason: "aanpassen" }, "b@x.be"); assert.fail("lock verwacht"); }
  catch (e) { assert.equal(e.code, "CHANGE_LOCKED"); }
  try { repo.remove("t1", co.id); assert.fail("delete-block verwacht"); }
  catch (e) { assert.equal(e.status, 409); }

  // executed → invoiced keten werkt; ongeldige sprong niet.
  repo.transition("t1", co.id, "executed", "a@x.be");
  const inv = repo.transition("t1", co.id, "invoiced", "a@x.be");
  assert.equal(inv.changeOrder.status, "invoiced");
  assert.equal(inv.budgetDelta, 0, "alleen acceptatie geeft delta");
  try { repo.transition("t1", co.id, "draft", "a@x.be"); assert.fail("sprong verwacht fout"); }
  catch (e) { assert.equal(e.code, "INVALID_TRANSITION"); }
});
