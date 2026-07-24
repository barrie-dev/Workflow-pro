"use strict";
// IA-02 · Routemodel + guards (IA handover §6/§8).
// Acceptatiebewijs uit de handover: "Refresh/back/deep-link E2E; cross-tenant
// negative tests." Dit dekt de PURE kern daarvan: parsen, bouwen, filters in de
// URL, legacy redirects met behoud van record-id, en de weigeringen.
const { test } = require("node:test");
const assert = require("node:assert");
const routeMap = require("../public/js/app/navigation/route-map");
const guards = require("../public/js/app/routing/guards");
const resolver = require("../public/js/app/navigation/resolver");
const registry = require("../public/js/app/navigation/registry");

test("IA-02 1· deep link parst naar registry-id, params en filters", () => {
  const r = routeMap.parse("/app/customers/c_123/overview");
  assert.equal(r.id, "customers");
  assert.equal(r.kind, "record");
  assert.equal(r.params.customerId, "c_123");

  const lijst = routeMap.parse("/app/finance/invoices?status=open&q=acme");
  assert.equal(lijst.id, "finance.invoices");
  assert.equal(lijst.kind, "list");
  assert.deepEqual(lijst.query, { status: "open", q: "acme" });
});

test("IA-02 2· refresh geeft exact dezelfde bestemming (parse ∘ build = identiteit)", () => {
  const url = routeMap.build("customers", { customerId: "c_9" }, { tab: "contacts" });
  assert.equal(url, "/app/customers/c_9/overview?tab=contacts");
  const opnieuw = routeMap.parse(url);
  assert.equal(opnieuw.id, "customers");
  assert.equal(opnieuw.params.customerId, "c_9");
  assert.deepEqual(opnieuw.query, { tab: "contacts" });
});

test("IA-02 3· lijstfilters zijn deelbaar en stabiel gesorteerd", () => {
  // Zelfde filters in andere volgorde geven exact dezelfde URL · deelbaar.
  const a = routeMap.build("finance.invoices", {}, { q: "acme", status: "open" });
  const b = routeMap.build("finance.invoices", {}, { status: "open", q: "acme" });
  assert.equal(a, b);
  assert.equal(a, "/app/finance/invoices?q=acme&status=open");
  // Lege waarden vallen weg · geen ?q=&status=
  assert.equal(routeMap.build("finance.invoices", {}, { q: "", status: null }), "/app/finance/invoices");
});

test("IA-02 4· onbekende route geeft null (permission-safe not-found, geen crash)", () => {
  assert.equal(routeMap.parse("/app/bestaat-niet"), null);
  assert.equal(routeMap.parse("/heel/iets/anders"), null);
  assert.equal(routeMap.parse(""), null);
  assert.deepEqual(guards.canEnter(null, {}), guards.NOT_FOUND);
});

test("IA-02 5· CROSS-TENANT record → generieke weigering zonder existence leak", () => {
  const route = routeMap.parse("/app/customers/c_van_iemand_anders/overview");
  const ctx = { tenantId: "t_mijn", routeTenantId: "t_ander", allowedRouteIds: ["customers"] };
  const uit = guards.canEnter(route, ctx);
  assert.equal(uit.ok, false);
  assert.equal(uit.code, "ROUTE_DENIED");
  // Byte-identiek aan een weigering wegens ontbrekend recht: de body verraadt
  // niet of het record bestaat.
  const zonderRecht = guards.canEnter(route, { tenantId: "t_mijn", allowedRouteIds: [] });
  assert.deepEqual(uit, zonderRecht);
});

test("IA-02 6· tenantveiligheid gaat VOOR rechten", () => {
  const route = routeMap.parse("/app/customers/c_1/overview");
  // Alle rechten, maar een vreemd record → nog steeds weigeren.
  const uit = guards.canEnter(route, { tenantId: "t_a", routeTenantId: "t_b", allowedRouteIds: ["customers"] });
  assert.equal(uit.code, "ROUTE_DENIED");
});

test("IA-02 7· route buiten de opgeloste navigatie wordt geweigerd (fail-closed)", () => {
  const tree = resolver.resolve(registry.ENTRIES, {
    portal: "tenant-admin", permissions: ["customers.view"], entitlements: ["customers"],
  });
  const toegestaan = resolver.flatten(tree).map(r => r.id);
  assert.equal(guards.canEnter(routeMap.parse("/app/customers"), { allowedRouteIds: toegestaan }).ok, true);
  // Finance zit niet in de opgeloste navigatie van deze gebruiker.
  assert.equal(guards.canEnter(routeMap.parse("/app/finance/invoices"), { allowedRouteIds: toegestaan }).code, "ROUTE_DENIED");
});

test("IA-02 8· supportsessie blijft binnen de gedelegeerde tenant", () => {
  const route = routeMap.parse("/app/customers");
  const basis = { tenantId: "t_klant", allowedRouteIds: ["customers"] };
  assert.equal(guards.canEnter(route, { ...basis, supportSession: { active: true, tenantId: "t_klant" } }).ok, true);
  assert.equal(guards.canEnter(route, { ...basis, supportSession: { active: true, tenantId: "t_ander" } }).code, "ROUTE_DENIED");
  assert.equal(guards.canEnter(route, { ...basis, supportSession: { active: true } }).code, "ROUTE_DENIED", "sessie zonder tenant faalt dicht");
});

test("IA-02 9· legacy data-view leidt om naar de nieuwe route, mét record-id", () => {
  assert.equal(routeMap.legacyRedirect("customers"), "/app/customers");
  assert.equal(routeMap.legacyRedirect("facturen"), "/app/finance/invoices");
  assert.equal(routeMap.legacyRedirect("inbox"), "/app/customers/requests");
  // De record-id blijft behouden en landt op het recordpad van het domein.
  assert.equal(routeMap.legacyRedirect("customers", { recordId: "c_42" }), "/app/customers/c_42/overview");
  // Filters reizen mee.
  assert.equal(routeMap.legacyRedirect("facturen", { query: { status: "open" } }), "/app/finance/invoices?status=open");
  // Onbekende oude view leidt nergens heen · geen stille val naar de homepage.
  assert.equal(routeMap.legacyRedirect("bestaatniet"), null);
});

test("IA-02 10· elke legacy-view wijst naar een BESTAANDE registry-id", () => {
  const geldig = new Set(resolver.flatten(resolver.resolve(registry.ENTRIES, {
    portal: "tenant-admin", permissions: ["*"],
    entitlements: ["customers", "quotes", "projects", "planning", "workorders", "employees", "invoices", "inventory", "reports", "automation", "construction", "progress_claims"],
  })).map(r => r.id));
  const kapot = Object.entries(routeMap.LEGACY_VIEW_MAP).filter(([, id]) => !geldig.has(id));
  assert.deepEqual(kapot, [], `legacy-views wijzen naar onbekende registry-ids: ${kapot.map(x => x.join("→")).join(", ")}`);
});

test("IA-02 11· de onopgeslagen-guard waarschuwt alleen bij ECHTE wijzigingen", () => {
  const g = guards.createUnsavedGuard();
  assert.equal(g.beforeLeave().block, false, "schoon formulier blokkeert niet");
  g.markDirty();
  assert.equal(g.beforeLeave().block, true);
  assert.equal(g.beforeLeave().reason, "UNSAVED_CHANGES");
  g.markSaved();
  assert.equal(g.beforeLeave().block, false, "een geslaagde save wist de guard");
});

test("IA-02 12· routetelemetrie draagt identifiers, nooit inhoud", () => {
  const t = guards.navigationTelemetry({
    routeId: "finance.invoices", portal: "tenant-admin", tenantHash: "t#abc123",
    source: "deep-link", durationMs: 42.7,
  });
  assert.deepEqual(t, {
    event: "navigation", routeId: "finance.invoices", portal: "tenant-admin",
    tenant: "t#abc123", source: "deep-link", durationMs: 43,
  });
  // Geen enkel veld kan recordinhoud of een filterwaarde dragen.
  assert.deepEqual(Object.keys(t).sort(), ["durationMs", "event", "portal", "routeId", "source", "tenant"]);
});

test("IA-02 13· recordpaden winnen van lijstpaden (langste patroon eerst)", () => {
  assert.equal(routeMap.parse("/app/customers").kind, "list");
  assert.equal(routeMap.parse("/app/customers/c_1/overview").kind, "record");
  // /app/customers/contacts is een CHILD-lijst, geen record.
  const kind = routeMap.parse("/app/customers/contacts");
  assert.equal(kind.id, "customers.contacts");
  assert.equal(kind.kind, "list");
});
