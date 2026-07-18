"use strict";
// Automation engine (master-spec h13/E11): condities, veilige acties, versioning,
// idempotentie, lusdetectie, goedkeuring-guard.
const { test } = require("node:test");
const assert = require("node:assert");

const { normalizeFlow, evaluateConditions, executeFlow, makeAutomationRepository, makeDispatcher } = require("../src/platform/automation");

function fakeStore(data = {}) {
  const d = { automationFlows: [], automationRuns: [], notifications: [], customers: [], tenants: [{ id: "t1", name: "Demo" }], ...data };
  return {
    data: d,
    list(col, tid) { return (d[col] || []).filter(r => r.tenantId === tid); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    update(col, id, patch) { d[col] = (d[col] || []).map(r => r.id === id ? { ...r, ...patch } : r); return (d[col] || []).find(r => r.id === id); },
    remove(col, id) { d[col] = (d[col] || []).filter(r => r.id !== id); },
    save() {},
  };
}
const TENANT = { id: "t1", name: "Demo" };

test("automation: voorwaardenboom evalueert operatoren", () => {
  const ev = { eventType: "invoice.created", data: { source: "workorder", total: 500 } };
  assert.equal(evaluateConditions([{ field: "data.source", op: "eq", value: "workorder" }], ev), true);
  assert.equal(evaluateConditions([{ field: "data.total", op: "gt", value: 100 }], ev), true);
  assert.equal(evaluateConditions([{ field: "data.total", op: "lt", value: 100 }], ev), false);
  assert.equal(evaluateConditions([{ field: "data.source", op: "in", value: ["quote", "workorder"] }], ev), true);
  assert.equal(evaluateConditions([], ev), true, "lege boom = altijd waar");
});

test("automation: normalizeFlow valideert trigger en acties", () => {
  const f = normalizeFlow({ name: "Melding bij factuur", trigger: "invoice.created", actions: [{ type: "notify", params: { title: "Nieuwe factuur" } }] });
  assert.equal(f.trigger, "invoice.created");
  assert.equal(f.repeat, "idempotent");
  assert.throws(() => normalizeFlow({ name: "X", trigger: "geenpunt", actions: [{ type: "notify" }] }), /eventtype/);
  assert.throws(() => normalizeFlow({ name: "X", trigger: "a.b", actions: [] }), /actiestap/);
});

test("automation: notify-actie maakt een melding; guarded-actie vereist goedkeuring", () => {
  const store = fakeStore();
  const flow = { id: "f1", version: 2, name: "Meld", trigger: "quote.accepted", conditions: [], actions: [{ type: "notify", params: { title: "Offerte aanvaard" } }, { type: "send_email", params: {} }] };
  const ev = { eventType: "quote.accepted", tenantId: "t1", aggregateType: "quote", aggregateId: "q1", data: {} };
  const run = executeFlow(store, TENANT, flow, ev);
  assert.equal(run.status, "success");
  assert.equal(run.flowVersion, 2, "run draagt de flowversie (h13-audit)");
  assert.equal(store.data.notifications.length, 1);
  assert.equal(run.steps.find(s => s.type === "send_email").status, "requires_approval", "financiële/verzendactie niet auto-uitgevoerd");
});

test("automation: set_field respecteert de whitelist", () => {
  const store = fakeStore({ customers: [{ id: "c1", tenantId: "t1", name: "Bouw NV", creditStatus: "ok" }] });
  const ev = { eventType: "customer.updated", tenantId: "t1", aggregateType: "customer", aggregateId: "c1", data: {} };
  const okFlow = { id: "f1", version: 1, actions: [{ type: "set_field", params: { field: "creditStatus", value: "watch" } }] };
  executeFlow(store, TENANT, okFlow, ev);
  assert.equal(store.data.customers[0].creditStatus, "watch");
  // Niet-toegestaan veld → skipped.
  const badFlow = { id: "f2", version: 1, actions: [{ type: "set_field", params: { field: "vatNumber", value: "HACK" } }] };
  const run = executeFlow(store, TENANT, badFlow, ev);
  assert.equal(run.steps[0].status, "skipped");
  assert.equal(store.data.customers[0].vatNumber, undefined);
});

test("automation: conditie niet voldaan → run cancelled; lusdetectie bij diepte", () => {
  const store = fakeStore();
  const flow = { id: "f1", version: 1, conditions: [{ field: "data.total", op: "gt", value: 1000 }], actions: [{ type: "notify" }] };
  const low = executeFlow(store, TENANT, flow, { eventType: "invoice.created", tenantId: "t1", aggregateType: "invoice", aggregateId: "i1", data: { total: 500 } });
  assert.equal(low.status, "cancelled");
  assert.equal(low.reason, "conditions_not_met");
  // Lusdetectie: depth >= 3.
  const deep = executeFlow(store, TENANT, { id: "f2", version: 1, conditions: [], actions: [{ type: "notify" }] }, { eventType: "x.y", tenantId: "t1", aggregateType: "a", aggregateId: "1", data: { _automationDepth: 3 } });
  assert.equal(deep.reason, "loop_guard");
});

test("automation: versioning + dispatcher met idempotentie", () => {
  const store = fakeStore();
  const repo = makeAutomationRepository(store);
  const flow = repo.insert("t1", { name: "Meld nieuwe klant", trigger: "customer.created", actions: [{ type: "notify", params: { title: "Nieuwe klant" } }] }, "admin@x.be");
  assert.equal(flow.version, 1);
  const up = repo.update("t1", flow.id, { name: "Meld nieuwe klant (v2)" }, "admin@x.be");
  assert.equal(up.version, 2, "definitiewijziging verhoogt de versie");
  repo.transition("t1", flow.id, "active", "admin@x.be");

  const dispatch = makeDispatcher(store);
  const ev = { eventType: "customer.created", tenantId: "t1", aggregateType: "customer", aggregateId: "c9", data: {} };
  dispatch(store, ev);
  dispatch(store, ev); // zelfde aggregate → idempotent, niet nogmaals
  const runs = repo.listRuns("t1", { flowId: flow.id });
  assert.equal(runs.length, 1, "idempotent: max één run per bron-aggregate");
  assert.equal(store.data.notifications.length, 1);

  // Ander aggregate → wel een run.
  dispatch(store, { ...ev, aggregateId: "c10" });
  assert.equal(repo.listRuns("t1", { flowId: flow.id }).length, 2);
});
