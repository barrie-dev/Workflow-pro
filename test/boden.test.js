"use strict";
// Unit-tests voor de Boden-tools — focus op de beveiliging: tools mogen nooit
// data teruggeven die de gebruiker niet mag zien (rol-rechten + entitlements + own-scoping).
const { test } = require("node:test");
const assert = require("node:assert");

const { runTool } = require("../src/modules/boden");
const { seedDefaults } = require("../src/modules/bundles");

function mkStore() {
  const data = {
    bundles: [], tenants: [{ id: "t1", name: "Demo NV", plan: "business" }],
    customers: [{ id: "c1", tenantId: "t1", name: "Klant A", email: "a@x.be" }],
    workorders: [
      { id: "w1", tenantId: "t1", userId: "u_jan", number: "WB-1", title: "Job van Jan", status: "open" },
      { id: "w2", tenantId: "t1", userId: "u_piet", number: "WB-2", title: "Job van Piet", status: "open" },
    ],
    invoices: [{ id: "i1", tenantId: "t1", number: "F-1", customerName: "Klant A", total: 100, status: "open" }],
    leaves: [], expenses: [], shifts: [], stock: [], vehicles: [], users: [],
  };
  return {
    data,
    list: (c, tid) => (data[c] || []).filter(r => !tid || r.tenantId === tid),
    insert: (c, r) => { (data[c] = data[c] || []).push(r); return r; },
    update: (c, id, p) => { data[c] = data[c].map(x => x.id === id ? { ...x, ...p } : x); return data[c].find(x => x.id === id); },
    get: (c, id) => (data[c] || []).find(x => x.id === id),
    updateTenant: (id, p) => { data.tenants = data.tenants.map(t => t.id === id ? { ...t, ...p } : t); return data.tenants.find(t => t.id === id); },
    audit() {},
  };
}

const TENANT = { id: "t1", name: "Demo NV", plan: "business" };
const ADMIN = { id: "u_admin", role: "tenant_admin", name: "Admin", permissions: ["*"] };
const EMPLOYEE = { id: "u_jan", role: "employee", name: "Jan", permissions: ["own:workorders", "own:expenses", "own:leaves", "own:planning"] };

test("boden: admin mag klanten opvragen, employee niet", () => {
  const store = mkStore(); seedDefaults(store);
  const okAdmin = runTool(store, TENANT, ADMIN, "query_records", { type: "customers" }, []);
  assert.ok(Array.isArray(okAdmin.resultaten) && okAdmin.resultaten.length === 1, "admin ziet klant");

  const denyEmp = runTool(store, TENANT, EMPLOYEE, "query_records", { type: "customers" }, []);
  assert.ok(denyEmp.error && /toegang/i.test(denyEmp.error), "employee krijgt geen klanten");
});

test("boden: employee ziet enkel zijn eigen werkbonnen (own-scoping)", () => {
  const store = mkStore(); seedDefaults(store);
  const r = runTool(store, TENANT, EMPLOYEE, "query_records", { type: "workorders" }, []);
  assert.equal(r.aantal, 1, "alleen eigen werkbon");
  assert.equal(r.resultaten[0].nummer, "WB-1");
});

test("boden: admin ziet alle werkbonnen", () => {
  const store = mkStore(); seedDefaults(store);
  const r = runTool(store, TENANT, ADMIN, "query_records", { type: "workorders" }, []);
  assert.equal(r.aantal, 2);
});

test("boden: search respecteert rechten (employee vindt geen klanten)", () => {
  const store = mkStore(); seedDefaults(store);
  const r = runTool(store, TENANT, EMPLOYEE, "search", { query: "klant" }, []);
  assert.ok(!r.resultaten.some(x => x.type === "Klanten"), "employee-search lekt geen klanten");
});

test("boden: module uit pakket → geen toegang", () => {
  const store = mkStore(); seedDefaults(store);
  // Zet tenant op starter (geen invoices-module)
  const starterTenant = { id: "t1", name: "Demo NV", plan: "starter" };
  const r = runTool(store, starterTenant, ADMIN, "query_records", { type: "invoices" }, []);
  assert.ok(r.error && /pakket/i.test(r.error), "facturen niet in starter → geweigerd");
});

test("boden: propose_action registreert voorstel zonder uitvoering", () => {
  const store = mkStore(); seedDefaults(store);
  const proposals = [];
  const r = runTool(store, TENANT, EMPLOYEE, "propose_action", { action: "create_leave", params: { startDate: "2027-02-01", endDate: "2027-02-03" } }, proposals);
  assert.ok(r.ok, "voorstel ok");
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].path, "me/leaves");
  assert.equal(proposals[0].method, "POST");
  // employee zonder onkost-recht? employee heeft own:expenses → create_expense mag
  const denyProp = [];
  const bad = runTool(store, TENANT, { id: "u_x", role: "employee", permissions: [] }, "propose_action", { action: "create_expense", params: {} }, denyProp);
  assert.ok(bad.error, "geen recht → geen voorstel");
  assert.equal(denyProp.length, 0);
});
