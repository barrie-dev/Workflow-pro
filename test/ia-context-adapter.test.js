"use strict";
// IA-runtime · Contextadapter.
// De draaiende app en de registry spreken vandaag niet dezelfde taal. Deze
// tests leggen de vertaling vast ÉN maken zichtbaar wat er nog uit de pas
// loopt · zodra unmapped() leeg is en de API registry-identifiers levert,
// mag dit bestand weg (handover §10).
const { test } = require("node:test");
const assert = require("node:assert");
const ad = require("../public/js/app/navigation/context-adapter");
const registry = require("../public/js/app/navigation/registry");
const resolver = require("../public/js/app/navigation/resolver");

// Wat een echte tenant_admin in de draaiende app meekrijgt.
const APP_PERMISSIONS = ["tenants", "employees", "venues", "customers", "planning", "workorders",
  "clockings", "expenses", "billing", "settings", "audit", "messages", "alerts", "integrations",
  "stock", "vehicles", "leaves", "incidents", "projects", "construction", "service_assets",
  "contracts", "procurement", "inventory", "catalog", "price_rules", "progress_claims"];
const APP_VIEWS = ["dashboard", "lists", "employees", "employee_records", "billing", "customers",
  "venues", "offertes", "facturen", "planning", "workorders", "projects", "worksites", "stock",
  "vehicles", "clocking", "leaves", "expenses", "incidents", "reports", "integrations"];

test("CA 1· app-rechten worden registry-rechten", () => {
  const p = ad.permissions(["customers", "planning"]);
  assert.deepEqual(p, ["customers.view", "planning.view"]);
  // Eén app-recht kan meerdere registry-rechten ontsluiten.
  assert.deepEqual(ad.permissions(["workorders"]), ["workorders.review", "workorders.view"]);
});

test("CA 2· fail-closed: een onbekend recht geeft niets", () => {
  assert.deepEqual(ad.permissions(["verzonnen"]), []);
  assert.deepEqual(ad.permissions([]), []);
  assert.deepEqual(ad.permissions(null), []);
  assert.deepEqual(ad.permissions(undefined), []);
});

test("CA 3· het superrecht blijft het superrecht", () => {
  assert.deepEqual(ad.permissions(["*"]), ["*"]);
  assert.deepEqual(ad.permissions(["*", "customers"]), ["*"], "wie alles mag, mag alles");
});

test("CA 4· vrijgegeven views worden registry-modules", () => {
  assert.deepEqual(ad.entitlements(["customers", "venues"], []), ["customers"],
    "meerdere schermen kunnen op dezelfde module uitkomen");
  assert.deepEqual(ad.entitlements(["facturen", "payments"], []), ["invoices"]);
  assert.deepEqual(ad.entitlements(["verzonnen"], []), [], "fail-closed");
});

test("CA 5· alles vrijgegeven levert de volledige registry-modulelijst", () => {
  assert.deepEqual(ad.entitlements("*", registry.ALL_ENTITLEMENTS), registry.ALL_ENTITLEMENTS);
});

test("CA 6· rollen worden portalen, onbekend valt terug op het smalste", () => {
  assert.equal(ad.portal("tenant_admin"), "tenant-admin");
  assert.equal(ad.portal("super_admin"), "super-admin");
  assert.equal(ad.portal("manager"), "manager");
  assert.equal(ad.portal("reseller"), "reseller");
  assert.equal(ad.portal("employee"), "employee");
  assert.equal(ad.portal("verzonnen"), "employee", "onbekend krijgt het minste, niet het meeste");
  assert.equal(ad.portal(undefined), "employee");
});

test("CA 7· ECHTE tenant_admin-context levert een bruikbare navigatie op", () => {
  // Dit is de test die de integratiekloof dichthoudt: de vertaling moet
  // niet alleen kloppen, ze moet ook daadwerkelijk een menu opleveren.
  const tree = resolver.resolve(registry.ENTRIES, {
    portal: ad.portal("tenant_admin"),
    permissions: ad.permissions(APP_PERMISSIONS),
    entitlements: ad.entitlements(APP_VIEWS, registry.ALL_ENTITLEMENTS),
  });
  const ids = resolver.flatten(tree).map(r => r.id);
  assert.ok(ids.length >= 30, `een tenant-admin hoort een volle navigatie te krijgen, kreeg ${ids.length}`);
  for (const domein of ["customers", "sales", "projects", "planning", "work-orders", "team", "finance", "resources", "insights"]) {
    assert.ok(ids.includes(domein), `${domein} ontbreekt in het menu van een tenant-admin`);
  }
});

test("CA 8· een EMPLOYEE krijgt aantoonbaar minder dan een admin", () => {
  const admin = resolver.flatten(resolver.resolve(registry.ENTRIES, {
    portal: "tenant-admin",
    permissions: ad.permissions(APP_PERMISSIONS),
    entitlements: ad.entitlements(APP_VIEWS, registry.ALL_ENTITLEMENTS),
  })).map(r => r.id);
  const medewerker = resolver.flatten(resolver.resolve(registry.ENTRIES, {
    portal: "employee",
    permissions: ad.permissions(["planning", "workorders", "clockings", "leaves", "expenses"]),
    entitlements: ad.entitlements(["planning", "workorders", "clocking", "leaves", "expenses"], registry.ALL_ENTITLEMENTS),
  })).map(r => r.id);
  assert.ok(medewerker.length > 0, "een medewerker hoort wel iets te zien");
  assert.ok(medewerker.length < admin.length);
  assert.equal(medewerker.includes("finance"), false, "een medewerker ziet de boekhouding niet");
});

test("CA 9· de adapter maakt zichtbaar wat er NOG NIET vertaald is", () => {
  // Dit is bewust een rapport en geen fout: het is de openstaande schuld.
  // Loopt hij leeg, dan spreekt de API de taal van de registry.
  const rest = ad.unmapped(APP_PERMISSIONS, APP_VIEWS);
  assert.deepEqual(rest.permissions, ["alerts", "messages", "tenants"],
    "deze app-rechten hebben (nog) geen registry-tegenhanger");
  assert.deepEqual(rest.entitlements, ["dashboard"],
    "het dashboard is geen domeinmodule in de IA · het is de startpagina");
});

test("CA 10· elk doel van de vertaling bestaat echt in de registry", () => {
  const perms = new Set(), ents = new Set(registry.ALL_ENTITLEMENTS);
  for (const e of registry.ENTRIES) {
    (e.permissions || []).forEach(p => perms.add(p));
    for (const c of e.children || []) (c.permissions || []).forEach(p => perms.add(p));
  }
  const kapotteRechten = [...new Set(Object.values(ad.PERMISSION_MAP).flat())].filter(p => !perms.has(p));
  assert.deepEqual(kapotteRechten, [], `vertaalt naar onbekende rechten: ${kapotteRechten.join(", ")}`);
  const kapotteModules = [...new Set(Object.values(ad.ENTITLEMENT_MAP))].filter(m => !ents.has(m));
  assert.deepEqual(kapotteModules, [], `vertaalt naar onbekende modules: ${kapotteModules.join(", ")}`);
});
