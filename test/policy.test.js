"use strict";
// Policy engine (master-spec E02, h8): niveaus, precedentie, team-scope,
// gevoelige velden en de compatibiliteit van de auth-laag.
const { test } = require("node:test");
const assert = require("node:assert");

const policy = require("../src/platform/policy");
const { can, canWrite, ownScopeOnly } = require("../src/lib/auth");

const T = (perms, extra = {}) => ({ id: "u1", tenantId: "t1", role: "employee", permissions: perms, ...extra });

test("policy: parsePermission ontleedt alle niveaus", () => {
  assert.deepEqual(policy.parsePermission("expenses"), { key: "expenses", scope: "tenant", write: true });
  assert.deepEqual(policy.parsePermission("team:expenses"), { key: "expenses", scope: "team", write: true });
  assert.deepEqual(policy.parsePermission("own:expenses"), { key: "expenses", scope: "own", write: true });
  assert.deepEqual(policy.parsePermission("read:expenses"), { key: "expenses", scope: "tenant", write: false });
});

test("policy: resolveAccess met precedentie X > team > own > read", () => {
  assert.deepEqual(policy.resolveAccess(T(["own:leaves", "leaves"]), "leaves"), { visible: true, writable: true, scope: "tenant" });
  assert.deepEqual(policy.resolveAccess(T(["own:leaves", "team:leaves"]), "leaves"), { visible: true, writable: true, scope: "team" });
  assert.deepEqual(policy.resolveAccess(T(["read:leaves", "own:leaves"]), "leaves"), { visible: true, writable: false, scope: "tenant" }, "read is tenant-breed kijken; schrijven blijft own via canWrite-pad");
  assert.deepEqual(policy.resolveAccess(T([]), "leaves"), { visible: false, writable: false, scope: null });
  assert.equal(policy.resolveAccess({ role: "super_admin" }, "x").writable, true);
  assert.equal(policy.resolveAccess(T(["*"]), "x").scope, "tenant");
});

test("policy: auth-compatibiliteit (can/canWrite/ownScopeOnly identiek gedrag + team)", () => {
  assert.equal(can(T(["own:leaves"]), "leaves"), true);
  assert.equal(can(T(["read:leaves"]), "leaves"), true);
  assert.equal(can(T([]), "leaves"), false);
  assert.equal(canWrite(T(["read:leaves"]), "leaves"), false);
  assert.equal(canWrite(T(["own:leaves"]), "leaves"), true);
  assert.equal(canWrite(T(["team:leaves"]), "leaves"), true, "team-niveau mag schrijven");
  assert.equal(ownScopeOnly(T(["own:leaves"]), "leaves"), true);
  assert.equal(ownScopeOnly(T(["team:leaves"]), "leaves"), false, "team is breder dan own");
  assert.equal(ownScopeOnly(T(["own:leaves", "read:leaves"]), "leaves"), false, "read geeft tenant-breed zicht");
});

test("policy: applyScope filtert own/team/tenant met teamMemberIds", () => {
  const store = { data: { users: [
    { id: "u1", tenantId: "t1", teamId: "team_a" },
    { id: "u2", tenantId: "t1", teamId: "team_a" },
    { id: "u3", tenantId: "t1", teamId: "team_b" },
    { id: "u4", tenantId: "ANDERE", teamId: "team_a" },   // andere tenant: nooit meetellen
  ] } };
  const rows = [
    { id: "r1", userId: "u1" }, { id: "r2", userId: "u2" },
    { id: "r3", userId: "u3" }, { id: "r4", userId: "u4" },
  ];
  const own = policy.applyScope(store, T(["own:expenses"], { teamId: "team_a" }), "expenses", rows);
  assert.deepEqual(own.map(r => r.id), ["r1"]);

  const team = policy.applyScope(store, T(["team:expenses"], { teamId: "team_a" }), "expenses", rows);
  assert.deepEqual(team.map(r => r.id), ["r1", "r2"], "eigen team, niet team_b en nooit een andere tenant");

  const teamless = policy.applyScope(store, T(["team:expenses"]), "expenses", rows);
  assert.deepEqual(teamless.map(r => r.id), ["r1"], "team-scope zonder team valt terug op eigen records");

  const full = policy.applyScope(store, T(["expenses"]), "expenses", rows);
  assert.equal(full.length, 4);

  // Meerdere eigenaarsvelden (workorders: userId of assignedTo).
  const wo = [{ id: "w1", userId: "u9", assignedTo: "u1" }, { id: "w2", userId: "u9" }];
  const mine = policy.applyScope(store, T(["own:workorders"]), "workorders", wo, ["userId", "assignedTo"]);
  assert.deepEqual(mine.map(r => r.id), ["w1"]);
});

test("policy: redactSensitive strippt kostvelden voor niet-beheerders (h8.2)", () => {
  const rows = [{ id: "e1", name: "Jan", hourlyRate: 42, costRate: 30, phone: "0470" }];
  const manager = { role: "manager" };
  const admin = { role: "tenant_admin" };

  const red = policy.redactSensitive(manager, "employees", rows);
  assert.equal(red[0].hourlyRate, undefined);
  assert.equal(red[0].costRate, undefined);
  assert.equal(red[0].name, "Jan", "niet-gevoelige velden blijven");
  assert.equal(rows[0].hourlyRate, 42, "origineel blijft onaangeroerd");

  assert.equal(policy.redactSensitive(admin, "employees", rows)[0].hourlyRate, 42, "beheerder ziet alles");
  const single = policy.redactSensitive(manager, "employees", rows[0]);
  assert.equal(single.costRate, undefined, "werkt ook op één record");
  assert.deepEqual(policy.redactSensitive(manager, "onbekend", rows), rows, "onbekende resource = ongemoeid");
});
