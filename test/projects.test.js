"use strict";
// Project-aggregate (master-spec h22/E04): normalisatie, statemachine, repository.
const { test } = require("node:test");
const assert = require("node:assert");

const { normalizeProject, canTransition, makeProjectRepository, PROJECT_STATUSES } = require("../src/platform/projects");

function fakeStore(rows = []) {
  const data = { projects: rows.slice() };
  return {
    data,
    list(col, tid) { return (data[col] || []).filter(r => r.tenantId === tid); },
    insert(col, row) { data[col].push(row); return row; },
    update(col, id, patch) { data[col] = data[col].map(r => r.id === id ? { ...r, ...patch } : r); return data[col].find(r => r.id === id); },
    remove(col, id) { data[col] = data[col].filter(r => r.id !== id); },
    save() {},
  };
}

test("projecten: normalizeProject valideert en normaliseert", () => {
  const p = normalizeProject({
    name: "  Nieuwbouw Gent ", customerId: "cust_1", customerName: "Bouw NV",
    type: "project", startDate: "2026-08-01", endDate: "2026-12-01",
    venueId: "venue_1", budgetAmount: 50000,
    phases: [{ title: "Ruwbouw", order: 2 }, { title: "Afwerking", order: 1 }],
    parties: [{ role: "architect", name: "Studio X" }, {}],
  });
  assert.equal(p.name, "Nieuwbouw Gent");
  assert.equal(p.status, "preparation");
  assert.equal(p.financialStatus, "open");
  assert.deepEqual(p.venueIds, ["venue_1"]);
  assert.equal(p.budgetAmount, 50000);
  // Fasen gesorteerd op order; lege partij weggefilterd.
  assert.deepEqual(p.phases.map(ph => ph.title), ["Afwerking", "Ruwbouw"]);
  assert.equal(p.parties.length, 1);
  assert.match(p.parties[0].id, /^pp_/);

  assert.throws(() => normalizeProject({ name: "" }), /Projectnaam/);
  assert.throws(() => normalizeProject({ name: "X" }), /Klant/);
  assert.throws(() => normalizeProject({ name: "X", customerId: "c", startDate: "2026-05-01", endDate: "2026-01-01" }), /Einddatum/);
});

test("projecten: statemachine dekt de toegestane overgangen", () => {
  assert.equal(canTransition("preparation", "active"), true);
  assert.equal(canTransition("active", "technically_done"), true);
  assert.equal(canTransition("technically_done", "to_invoice"), true);
  assert.equal(canTransition("to_invoice", "closed"), true);
  assert.equal(canTransition("closed", "active"), true, "heropening mag");
  assert.equal(canTransition("cancelled", "active"), false, "geannuleerd is eindpunt");
  assert.equal(canTransition("preparation", "closed"), false, "geen sprong naar closed");
  assert.ok(PROJECT_STATUSES.includes("paused"));
});

test("projecten: repository nummert, versioneert en handhaaft optimistic locking", () => {
  const store = fakeStore();
  const repo = makeProjectRepository(store);
  const year = new Date().getFullYear();

  const p1 = repo.insert("t1", { name: "P1", customerId: "c1" }, "a@x.be");
  const p2 = repo.insert("t1", { name: "P2", customerId: "c1" }, "a@x.be");
  assert.equal(p1.number, `PRJ-${year}-001`);
  assert.equal(p2.number, `PRJ-${year}-002`);
  assert.match(p1.id, /^prj_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(p1.version, 1);

  const up = repo.update("t1", p1.id, { notes: "kickoff" }, "b@x.be", 1);
  assert.equal(up.version, 2);
  assert.equal(up.notes, "kickoff");
  try { repo.update("t1", p1.id, { notes: "x" }, "c@x.be", 1); assert.fail("verwacht conflict"); }
  catch (e) { assert.equal(e.status, 409); assert.equal(e.code, "VERSION_CONFLICT"); }

  // PATCH mag status niet forceren.
  const patched = repo.update("t1", p1.id, { status: "closed", notes: "poging" }, "d@x.be");
  assert.equal(patched.status, "preparation", "status blijft; wijzigt alleen via transition");
});

test("projecten: transition valideert de statemachine en eist reden bij heropening", () => {
  const store = fakeStore();
  const repo = makeProjectRepository(store);
  const p = repo.insert("t1", { name: "P", customerId: "c1" }, "a@x.be");

  const active = repo.transition("t1", p.id, "active", "a@x.be");
  assert.equal(active.status, "active");
  assert.equal(active.version, 2);

  try { repo.transition("t1", p.id, "closed", "a@x.be"); assert.fail("ongeldige sprong"); }
  catch (e) { assert.equal(e.code, "INVALID_TRANSITION"); assert.equal(e.status, 409); }

  repo.transition("t1", p.id, "technically_done", "a@x.be");
  repo.transition("t1", p.id, "to_invoice", "a@x.be");
  const closed = repo.transition("t1", p.id, "closed", "a@x.be");
  assert.equal(closed.status, "closed");

  // Heropening vereist reden.
  try { repo.transition("t1", p.id, "active", "a@x.be"); assert.fail("reden verplicht"); }
  catch (e) { assert.equal(e.code, "REASON_REQUIRED"); }
  const reopened = repo.transition("t1", p.id, "active", "a@x.be", "Klant wil extra werken");
  assert.equal(reopened.status, "active");
  assert.equal(reopened.lastTransitionReason, "Klant wil extra werken");

  // Idempotent: zelfde status → geen wijziging, geen fout.
  assert.equal(repo.transition("t1", p.id, "active", "a@x.be").status, "active");
});
