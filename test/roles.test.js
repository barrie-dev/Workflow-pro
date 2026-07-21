"use strict";
// Samenstelbare profielen · custom rollen (#75). Kern: een organisatie stelt
// zelf een profiel samen uit granulaire rechten; de validatie voorkomt
// escalatie (geen platform-/cross-tenant-rechten), de effectieve rechten
// verenigen rol + directe rechten, en alles is tenant-veilig + auditbaar.
const { test } = require("node:test");
const assert = require("node:assert");

const roles = require("../src/modules/roles");
const policy = require("../src/platform/policy");

function makeStore() {
  const data = { roles: [], users: [], tenants: [], bundles: [], auditLogs: [], platformConfig: {} };
  return {
    data,
    audit(e) { data.auditLogs.push(e); },
    save() {},
    insert(c, row) { (data[c] = data[c] || []).push(row); return row; },
    list(c) { return data[c] || []; },
    update(c, id, patch) { const a = data[c] || []; const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...patch }; return a[i]; } return null; },
  };
}
// Tenant met een brede moduleset aan, zodat de geteste rechten toekenbaar zijn.
const MODS = ["planning", "workorders", "customers", "inventory", "stock", "projects", "construction"];
function makeTenant(id = "t1") { return { id, name: "Test " + id, moduleOverrides: { add: MODS } }; }
const tenant = makeTenant("t1");

test("catalog: operationele rechten (tenant-gegated) + delegeerbaar beheer + verboden lijst", () => {
  const store = makeStore();
  const cat = roles.permissionCatalog(store, tenant);
  assert.ok(cat.operational.some(p => p.key === "planning"), "planning is operationeel toekenbaar");
  assert.ok(cat.admin.some(a => a.key === "costs.view" && a.sensitive === true), "costs.view is een gevoelig beheerrecht");
  assert.deepEqual([...cat.forbidden].sort(), ["*", "billing", "reseller_tenants", "support_grant", "tenants"].sort());
});

test("validatie: grantable + delegeerbaar toegestaan; platform-/onzin-rechten geweigerd", () => {
  const store = makeStore();
  const { permissions, rejected } = roles.validateRolePermissions(store, tenant, [
    "planning", "read:customers", "team:workorders", "costs.view", "settings",
    "tenants", "billing", "*", "onzin_recht",
  ]);
  assert.ok(permissions.includes("planning") && permissions.includes("read:customers") && permissions.includes("team:workorders"));
  assert.ok(permissions.includes("costs.view") && permissions.includes("settings"));
  assert.deepEqual(rejected.sort(), ["*", "billing", "onzin_recht", "tenants"].sort(), "escalatie + onzin geweigerd");
});

test("createRole: valideert, dedupt naam, weigert lege/verboden rechten, audit", () => {
  const store = makeStore();
  const r = roles.createRole(store, tenant, "admin@t1", { name: "Werfleider Finance", description: "Planning + margezicht", permissions: ["planning", "workorders", "costs.view"] });
  assert.equal(r.name, "Werfleider Finance");
  assert.deepEqual(r.permissions, ["planning", "workorders", "costs.view"]);
  assert.equal(store.data.roles.length, 1);
  assert.ok(store.data.auditLogs.some(a => a.action === "role.created"), "aanmaak geaudit");
  // Dubbele naam → 409
  assert.throws(() => roles.createRole(store, tenant, "admin@t1", { name: "Werfleider Finance", permissions: ["planning"] }), e => e.code === "ROLE_NAME_TAKEN");
  // Lege rechten → 400
  assert.throws(() => roles.createRole(store, tenant, "admin@t1", { name: "Leeg", permissions: [] }), e => e.code === "ROLE_PERMISSIONS_EMPTY");
  // Verboden recht → 400 (geen stille filtering)
  assert.throws(() => roles.createRole(store, tenant, "admin@t1", { name: "Escalatie", permissions: ["planning", "tenants"] }), e => e.code === "ROLE_PERMISSIONS_REJECTED");
});

test("effectieve rechten: profiel VERENIGD met directe rechten; onbekend profiel valt veilig terug", () => {
  const store = makeStore();
  const role = roles.createRole(store, tenant, "admin@t1", { name: "Boekhouder", permissions: ["read:planning", "costs.view", "settings"] });
  const rawRole = store.data.roles.find(r => r.id === role.id);
  const user = { id: "u1", tenantId: "t1", role: "employee", roleId: rawRole.id, permissions: ["own:clockings"] };
  const eff = roles.effectivePermissions(store, user);
  assert.ok(eff.includes("read:planning") && eff.includes("costs.view") && eff.includes("settings"), "profielrechten toegevoegd");
  assert.ok(eff.includes("own:clockings"), "directe rechten behouden");
  // Onbekend/verwijderd profiel → alleen directe rechten
  assert.deepEqual(roles.effectivePermissions(store, { ...user, roleId: "role_weg" }), ["own:clockings"]);
  // withEffectivePermissions muteert de opgeslagen gebruiker niet
  const cloned = roles.withEffectivePermissions(store, user);
  assert.notStrictEqual(cloned, user);
  assert.deepEqual(user.permissions, ["own:clockings"], "origineel ongewijzigd");
});

test("costs.view ontsluit gevoelige velden voor een samengesteld profiel (geen admin-rol nodig)", () => {
  // Zonder costs.view: employee ziet kostvelden niet.
  const zonder = { role: "employee", permissions: ["read:projects"] };
  assert.equal(policy.canSeeSensitive(zonder), false);
  const geredigeerd = policy.redactSensitive(zonder, "projects", { id: "p1", name: "P", margin: 1200, budgetAmount: 5000 });
  assert.equal(geredigeerd.margin, undefined);
  // Mét costs.view (via profiel, effectief ingevuld): wél zichtbaar.
  const met = { role: "employee", permissions: ["read:projects", "costs.view"] };
  assert.equal(policy.canSeeSensitive(met), true);
  const zichtbaar = policy.redactSensitive(met, "projects", { id: "p1", name: "P", margin: 1200 });
  assert.equal(zichtbaar.margin, 1200, "costs.view maakt marge zichtbaar zonder beheerdersrol");
});

test("tenant-veilig: een profiel van tenant A is onzichtbaar/niet-toekenbaar voor tenant B", () => {
  const store = makeStore();
  const roleA = roles.createRole(store, makeTenant("tA"), "admin@a", { name: "A-profiel", permissions: ["planning"] });
  const listB = roles.listRoles(store, "tB");
  assert.equal(listB.custom.length, 0, "tenant B ziet A-profiel niet");
  assert.throws(() => roles.resolveAssignableRole(store, "tB", roleA.id), e => e.code === "ROLE_NOT_ASSIGNABLE");
  // Binnen tenant A wél toekenbaar
  assert.ok(roles.resolveAssignableRole(store, "tA", roleA.id));
});

test("update/delete: ingebouwd beschermd; verwijderen geblokkeerd zolang toegewezen", () => {
  const store = makeStore();
  const role = roles.createRole(store, tenant, "admin@t1", { name: "Magazijnier", permissions: ["inventory", "stock"] });
  const rawId = store.data.roles[0].id;
  // Toewijzen aan een gebruiker → delete geblokkeerd
  store.data.users.push({ id: "u9", tenantId: "t1", roleId: rawId });
  assert.throws(() => roles.deleteRole(store, tenant, "admin@t1", rawId), e => e.code === "ROLE_IN_USE");
  // Losmaken → delete lukt + geaudit
  store.data.users = [];
  assert.deepEqual(roles.deleteRole(store, tenant, "admin@t1", rawId), { ok: true });
  assert.ok(store.data.auditLogs.some(a => a.action === "role.deleted"));
  // Update propageert nieuwe rechten
  const r2 = roles.createRole(store, tenant, "admin@t1", { name: "Planner", permissions: ["planning"] });
  const upd = roles.updateRole(store, tenant, "admin@t1", store.data.roles[0].id, { permissions: ["planning", "workorders"] });
  assert.deepEqual(upd.permissions, ["planning", "workorders"]);
  assert.equal(upd.version, 2);
});
