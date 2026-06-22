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
  // Acties vereisen de AI-acties-add-on.
  const tenantAI = { id: "t1", name: "Demo NV", plan: "business", moduleOverrides: { add: ["ai_actions"], remove: [] } };
  const proposals = [];
  const r = runTool(store, tenantAI, EMPLOYEE, "propose_action", { action: "create_leave", params: { startDate: "2027-02-01", endDate: "2027-02-03" } }, proposals);
  assert.ok(r.ok, "voorstel ok");
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].path, "me/leaves");
  assert.equal(proposals[0].method, "POST");
  // employee zonder onkost-recht → geen voorstel (ook met add-on)
  const denyProp = [];
  const bad = runTool(store, tenantAI, { id: "u_x", role: "employee", permissions: [] }, "propose_action", { action: "create_expense", params: {} }, denyProp);
  assert.ok(bad.error, "geen recht → geen voorstel");
  assert.equal(denyProp.length, 0);
});

// ── Slimmere Boden: aggregatie + KPI's, strikt rechten-gescoped ──────────────
test("boden aggregate: som/count/groupBy met rechten-scoping", () => {
  const store = mkStore(); seedDefaults(store);
  store.data.invoices.push(
    { id: "i2", tenantId: "t1", number: "F-2", customerName: "Klant B", total: 200, status: "paid" },
    { id: "i3", tenantId: "t1", number: "F-3", customerName: "Klant C", total: 50, status: "open" },
  );
  store.data.expenses.push(
    { id: "e1", tenantId: "t1", userId: "u_jan", amount: 50, category: "reizen", status: "ingediend", userName: "Jan" },
    { id: "e2", tenantId: "t1", userId: "u_jan", amount: 30, category: "reizen", status: "ingediend", userName: "Jan" },
    { id: "e3", tenantId: "t1", userId: "u_piet", amount: 20, category: "eten", status: "ingediend", userName: "Piet" },
  );

  // Admin: totaal factuurbedrag = 350; enkel open = 150
  assert.equal(runTool(store, TENANT, ADMIN, "aggregate", { type: "invoices", metric: "sum", field: "bedrag" }, []).waarde, 350);
  assert.equal(runTool(store, TENANT, ADMIN, "aggregate", { type: "invoices", metric: "sum", field: "bedrag", status: "open" }, []).waarde, 150);
  assert.equal(runTool(store, TENANT, ADMIN, "aggregate", { type: "invoices", metric: "count" }, []).waarde, 3);

  // Groeperen: onkosten per categorie
  const grp = runTool(store, TENANT, ADMIN, "aggregate", { type: "expenses", metric: "sum", field: "bedrag", groupBy: "categorie" }, []);
  assert.deepEqual(grp.groepen, { reizen: 80, eten: 20 });

  // Employee ziet ENKEL eigen onkosten in de aggregatie (own-scoping)
  const empSum = runTool(store, TENANT, EMPLOYEE, "aggregate", { type: "expenses", metric: "sum", field: "bedrag" }, []);
  assert.equal(empSum.waarde, 80, "employee aggregeert enkel eigen onkosten");

  // Employee mag geen facturen aggregeren (geen recht)
  assert.ok(runTool(store, TENANT, EMPLOYEE, "aggregate", { type: "invoices", metric: "sum", field: "bedrag" }, []).error);

  // sum zonder geldig veld → nette foutmelding i.p.v. verzonnen getal
  assert.ok(runTool(store, TENANT, ADMIN, "aggregate", { type: "invoices", metric: "sum" }, []).error);
});

test("boden get_kpis: levert rechten-gefilterde kerncijfers", () => {
  const store = mkStore(); seedDefaults(store);
  const admin = runTool(store, TENANT, ADMIN, "get_kpis", {}, []);
  assert.ok(admin.aantal > 0 && Array.isArray(admin.kpis), "admin krijgt KPI's");
  assert.ok(admin.kpis.every(k => "label" in k && "waarde" in k), "elke KPI heeft label+waarde");
  // Employee krijgt enkel persoonlijke KPI's (geen org-totalen zoals teamgrootte)
  const emp = runTool(store, TENANT, EMPLOYEE, "get_kpis", {}, []);
  assert.ok(!emp.kpis.some(k => /teamgrootte/i.test(k.label)), "employee ziet geen org-KPI's");
});

// ── AI-acties achter add-on + rechten-scoping ───────────────────────────────
const TENANT_AI = { id: "t1", name: "Demo NV", plan: "business", moduleOverrides: { add: ["ai_actions"], remove: [] } };

test("boden acties: zonder add-on geen uitvoer, navigate blijft vrij", () => {
  const store = mkStore(); seedDefaults(store);
  const leave = runTool(store, TENANT, EMPLOYEE, "propose_action", { action: "create_leave", params: { startDate: "2026-07-01", endDate: "2026-07-02", type: "vakantie" } }, []);
  assert.ok(leave.error && /actions_addon_uit/.test(leave.error), "zonder add-on → geen actie-uitvoer");
  // navigate is gratis UX en blijft werken
  const props = [];
  const nav = runTool(store, TENANT, EMPLOYEE, "propose_action", { action: "navigate", params: { view: "leaves" } }, props);
  assert.ok(nav.ok && props.length === 1, "navigate blijft beschikbaar zonder add-on");
});

test("boden acties: met add-on uitvoeren, met rol-rechten-scoping", () => {
  const store = mkStore(); seedDefaults(store);
  // Admin met add-on mag een klant voorstellen (beheer-actie, full perm)
  let props = [];
  const cust = runTool(store, TENANT_AI, ADMIN, "propose_action", { action: "create_customer", params: { name: "Nieuwe Klant", email: "n@k.be" } }, props);
  assert.ok(cust.ok && props[0].path === "customers", "admin: klant-actie voorgesteld + uitvoerbaar");

  // Employee mag beheer-actie (create_workorder, full) NIET — ook met add-on
  const wo = runTool(store, TENANT_AI, EMPLOYEE, "propose_action", { action: "create_workorder", params: { title: "x" } }, []);
  assert.ok(wo.error && /Geen toegang/.test(wo.error), "employee zonder volledig werkbonrecht → geweigerd");

  // Maar een persoonlijke actie (verlof) mag de employee wél met add-on
  props = [];
  const leave = runTool(store, TENANT_AI, EMPLOYEE, "propose_action", { action: "create_leave", params: { startDate: "2026-07-01", endDate: "2026-07-02", type: "vakantie" } }, props);
  assert.ok(leave.ok && props[0].path === "me/leaves", "employee: eigen verlof-actie mag met add-on");
});
