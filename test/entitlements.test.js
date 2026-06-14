"use strict";
// Unit-tests voor de entitlement-laag (catalogus, bundels, resolver, handhaving).
const { test } = require("node:test");
const assert = require("node:assert");

const { gateableKeys, moduleForAction, moduleByKey } = require("../src/modules/catalog");
const { seedDefaults, listBundles, getBundle, saveBundle, deleteBundle } = require("../src/modules/bundles");
const { resolveTenantModules, isModuleEnabled, assertModuleEnabled, grantablePermissions } = require("../src/modules/entitlements");

// Minimale in-memory store die de gebruikte methods nabootst.
function mkStore() {
  return {
    data: { bundles: [], tenants: [] },
    audit() {},
    insert(c, r) { this.data[c].push(r); return r; },
    update(c, id, p) { this.data[c] = this.data[c].map(x => x.id === id ? { ...x, ...p } : x); return this.data[c].find(x => x.id === id); },
    remove(c, id) { const n = this.data[c].length; this.data[c] = this.data[c].filter(x => x.id !== id); return n !== this.data[c].length; },
    get(c, id) { return (this.data[c] || []).find(x => x.id === id); },
    updateTenant(id, p) { this.data.tenants = this.data.tenants.map(t => t.id === id ? { ...t, ...p } : t); return this.data.tenants.find(t => t.id === id); },
  };
}

test("catalogus: moduleForAction mapt action-prefix → gateable module", () => {
  assert.equal(moduleForAction("facturen/123/peppol").key, "invoices");
  assert.equal(moduleForAction("workorders").key, "workorders");
  assert.equal(moduleForAction("clock").key, "clockings");
  assert.equal(moduleForAction("settings"), null, "kern-action is niet gated");
  assert.equal(moduleForAction("search"), null);
});

test("bundels: seed levert starter/business/enterprise", () => {
  const store = mkStore();
  seedDefaults(store);
  const keys = listBundles(store).map(b => b.key);
  assert.deepEqual(keys, ["starter", "business", "enterprise"]);
  assert.equal(getBundle(store, "enterprise").modules.length, gateableKeys().length, "enterprise = alle modules");
  assert.ok(!getBundle(store, "starter").modules.includes("workorders"), "starter zonder werkbonnen");
});

test("resolver: bundel-baseline + overrides (add/remove)", () => {
  const store = mkStore();
  seedDefaults(store);
  const base = resolveTenantModules(store, { plan: "starter" });
  assert.ok(base.modules.includes("planning"));
  assert.ok(!base.modules.includes("workorders"));

  const ov = resolveTenantModules(store, { plan: "starter", moduleOverrides: { add: ["workorders"], remove: ["messages"] } });
  assert.ok(ov.modules.includes("workorders"), "override add werkt");
  assert.ok(!ov.modules.includes("messages"), "override remove werkt");
});

test("resolver: kernmodules altijd actief, views bevat kern", () => {
  const store = mkStore();
  seedDefaults(store);
  const r = resolveTenantModules(store, { plan: "starter" });
  assert.ok(r.views.includes("dashboard"));
  assert.ok(r.views.includes("settings"));
  assert.ok(isModuleEnabled(store, { plan: "starter" }, "settings"), "settings (core) altijd aan");
});

test("handhaving: gated module → 403, kern → ok, super_admin → bypass", () => {
  const store = mkStore();
  seedDefaults(store);
  const tenant = { id: "t1", plan: "starter" };
  assert.throws(
    () => assertModuleEnabled(store, { role: "tenant_admin" }, tenant, "workorders"),
    e => e.status === 403 && e.code === "module_disabled"
  );
  assert.doesNotThrow(() => assertModuleEnabled(store, { role: "tenant_admin" }, tenant, "planning"));
  assert.doesNotThrow(() => assertModuleEnabled(store, { role: "tenant_admin" }, tenant, "settings"));
  assert.doesNotThrow(() => assertModuleEnabled(store, { role: "super_admin" }, tenant, "workorders"));
});

test("bundels CRUD: aanmaken, bijwerken, beschermd verwijderen", () => {
  const store = mkStore();
  seedDefaults(store);
  const created = saveBundle(store, { key: "pro", label: "Pro", modules: ["planning", "workorders", "nonexistent"] }, { email: "su@x" });
  assert.equal(created.key, "pro");
  assert.deepEqual(created.modules, ["planning", "workorders"], "onbekende module-key gefilterd");

  saveBundle(store, { key: "pro", label: "Pro+", modules: ["planning"] }, { email: "su@x" });
  assert.equal(getBundle(store, "pro").label, "Pro+", "upsert werkt");

  // In gebruik → kan niet verwijderd worden
  store.data.tenants.push({ id: "t1", plan: "pro" });
  assert.throws(() => deleteBundle(store, "pro", { email: "su@x" }), e => e.status === 409);
  // Niet in gebruik → wel
  store.data.tenants = [];
  assert.deepEqual(deleteBundle(store, "pro", { email: "su@x" }), { ok: true, key: "pro" });
  assert.equal(getBundle(store, "pro"), null);
});

test("bundels: ongeldige key wordt geweigerd", () => {
  const store = mkStore();
  assert.throws(() => saveBundle(store, { key: "Bad Key!", label: "x" }, { email: "su@x" }), e => e.status === 400);
});

test("grantablePermissions: enkel operationele rechten ∩ tenant-entitlements", () => {
  const store = mkStore();
  seedDefaults(store);
  const starter = grantablePermissions(store, { plan: "starter" }).map(p => p.key);
  assert.ok(starter.includes("planning"), "starter heeft planning");
  assert.ok(!starter.includes("workorders"), "starter zonder werkbonnen → niet toewijsbaar");
  assert.ok(!starter.includes("clockings"), "prikklok is geen per-user toggle (altijd-aan)");
  // Nooit admin-rechten toewijsbaar, ook niet bij enterprise.
  const ent = grantablePermissions(store, { plan: "enterprise" }).map(p => p.key);
  for (const admin of ["settings", "billing", "audit", "tenants", "employees", "integrations"]) {
    assert.ok(!ent.includes(admin), `${admin} mag niet toewijsbaar zijn per user`);
  }
});
