"use strict";
// Forms-activatie (h2 · F2). Bewijst de 8-lagen cascade: elke laag kan blokkeren
// met blockedBy + reason, en alles-groen levert active:true.
const { test } = require("node:test");
const assert = require("node:assert");
const A = require("../src/platform/forms-activation");

const NOW = Date.parse("2026-07-22T12:00:00Z");
const baseDef = { id: "d1", status: "enabled", attributes: {} };
const user = { role: "employee", companyId: "co1", teamId: "tm1", permissions: [] };

test("alle lagen groen → actief", () => {
  const r = A.resolveActivation(baseDef, { user, now: NOW });
  assert.equal(r.active, true);
  assert.equal(r.blockedBy, null);
});

test("platform → entitlement → tenant blokkeren in volgorde", () => {
  assert.equal(A.resolveActivation(null, {}).blockedBy, "platform");
  const needsEnt = { ...baseDef, attributes: { requires_entitlement: "forms.pro" } };
  assert.equal(A.resolveActivation(needsEnt, { user, entitlements: [] }).blockedBy, "entitlement");
  assert.equal(A.resolveActivation(needsEnt, { user, entitlements: ["forms.pro"] }).active, true);
  // available = nog niet geactiveerd door tenant; paused/archived = niet invulbaar.
  assert.equal(A.resolveActivation({ ...baseDef, status: "available" }, { user }).blockedBy, "tenant");
  assert.equal(A.resolveActivation({ ...baseDef, status: "paused" }, { user }).blockedBy, "tenant");
  assert.equal(A.resolveActivation({ ...baseDef, status: "archived" }, { user }).blockedBy, "tenant");
});

test("scheduled · buiten het venster blokkeert op tenant", () => {
  const sched = { ...baseDef, status: "scheduled", scheduled_from: "2026-08-01T00:00:00Z" };
  assert.equal(A.resolveActivation(sched, { user, now: NOW }).blockedBy, "tenant", "nog niet gestart");
  const past = { ...baseDef, status: "scheduled", scheduled_until: "2026-07-01T00:00:00Z" };
  assert.equal(A.resolveActivation(past, { user, now: NOW }).blockedBy, "tenant", "verlopen");
  const live = { ...baseDef, status: "scheduled", scheduled_from: "2026-07-01T00:00:00Z", scheduled_until: "2026-08-01T00:00:00Z" };
  assert.equal(A.resolveActivation(live, { user, now: NOW }).active, true);
});

test("company/team · toewijzing beperkt tot geselecteerde entiteiten", () => {
  const assignments = [
    { scope_type: "company", scope_id: "co1", active: true },
    { scope_type: "team", scope_id: "tmX", active: true },
  ];
  // company co1 matcht, maar team tm1 zit niet in de toewijzing (enkel tmX) → team blokkeert.
  const r = A.resolveActivation(baseDef, { user, assignments, now: NOW });
  assert.equal(r.blockedBy, "team");
  // Zonder team-assignment (enkel company) → geen teambeperking.
  const r2 = A.resolveActivation(baseDef, { user, assignments: [{ scope_type: "company", scope_id: "co1", active: true }], now: NOW });
  assert.equal(r2.active, true);
  // Ingetrokken/inactieve assignment telt niet als beperking.
  const revoked = [{ scope_type: "company", scope_id: "coX", active: true, revoked_at: "2026-07-20T00:00:00Z" }];
  assert.equal(A.resolveActivation(baseDef, { user, assignments: revoked, now: NOW }).active, true);
});

test("context · conditional voorwaarden (bedrag/objecttype)", () => {
  const def = { ...baseDef, status: "conditional", attributes: { conditions: [{ field: "amount", op: "gte", value: 1000 }] } };
  assert.equal(A.resolveActivation(def, { user, context: { amount: 500 }, now: NOW }).blockedBy, "context");
  assert.equal(A.resolveActivation(def, { user, context: { amount: 1500 }, now: NOW }).active, true);
  const typed = { ...baseDef, status: "conditional", attributes: { conditions: [{ field: "object_type", op: "in", value: ["purchase", "expense"] }] } };
  assert.equal(A.resolveActivation(typed, { user, context: { object_type: "lead" }, now: NOW }).blockedBy, "context");
  assert.equal(A.resolveActivation(typed, { user, context: { object_type: "purchase" }, now: NOW }).active, true);
});

test("rol · role-assignments beperken tot de juiste rol/permissie", () => {
  const assignments = [{ scope_type: "role", scope_id: "manager", active: true }];
  assert.equal(A.resolveActivation(baseDef, { user, assignments, now: NOW }).blockedBy, "role");
  const mgr = { ...user, role: "manager" };
  assert.equal(A.resolveActivation(baseDef, { user: mgr, assignments, now: NOW }).active, true);
  // Ook een expliciete permissie kan de rol-assignment vervullen.
  const permUser = { ...user, permissions: ["manager"] };
  assert.equal(A.resolveActivation(baseDef, { user: permUser, assignments, now: NOW }).active, true);
});
