"use strict";
// IA-05 · Command palette & global search (IA handover §7/§8).
// Acceptatiebewijs uit de handover: "Field-right E2E through API, search,
// export and Mona." Dit dekt de zoekkant: rechten, veldrechten en tenant
// filteren HIER even hard als op de API, en er lekt geen bestaan.
const { test } = require("node:test");
const assert = require("node:assert");
const palette = require("../public/js/app/shell/command-palette");
const resolver = require("../public/js/app/navigation/resolver");
const registry = require("../public/js/app/navigation/registry");

const volleBoom = () => resolver.resolve(registry.ENTRIES, {
  portal: "tenant-admin", permissions: ["*"],
  entitlements: ["customers", "quotes", "projects", "planning", "workorders", "employees", "invoices", "inventory", "reports", "automation", "construction", "progress_claims"],
});

const RECORDS = [
  { id: "c_1", routeId: "customers", route: "/app/customers/c_1/overview", label: "Acme Bouw", subtitle: "Klant", tenantId: "t_mij" },
  { id: "i_9", routeId: "finance.invoices", route: "/app/finance/invoices/i_9", label: "F2026-0042", subtitle: "Acme Bouw", tenantId: "t_mij" },
];
const COMMANDS = [
  { id: "cmd.new-quote", label: "Nieuwe offerte", route: "/app/sales/quotes/new", permission: "quotes.create", entitlement: "quotes" },
  { id: "cmd.export", label: "Exporteer klanten", route: "/app/customers?export=1", permission: "customers.export", entitlement: "customers" },
];
const CTX = {
  tenantId: "t_mij", permissions: ["quotes.create", "customers.export"],
  entitlements: ["quotes", "customers"],
  allowedRouteIds: ["customers", "finance.invoices"],
};

test("IA-05 1· één zoekveld brengt pagina's, records en commando's samen", () => {
  const pages = palette.pageIndex(volleBoom(), k => k);
  const uit = palette.search("acme", { pages, records: RECORDS, commands: COMMANDS, ctx: CTX });
  const types = new Set(uit.results.map(r => r.type));
  assert.ok(types.has("record"), "records ontbreken");
  assert.equal(uit.results.some(r => r.label === "Acme Bouw"), true);
  // De factuur matcht via zijn subtitel (de klantnaam).
  assert.equal(uit.results.some(r => r.label === "F2026-0042"), true);

  const cmd = palette.search("offerte", { pages, records: RECORDS, commands: COMMANDS, ctx: CTX });
  assert.equal(cmd.results[0].type, "command", "een exact commando hoort bovenaan");
});

test("IA-05 2· CROSS-TENANT record bestaat niet in het palet", () => {
  const vreemd = [{ id: "c_x", routeId: "customers", route: "/app/customers/c_x/overview", label: "Acme Bouw", tenantId: "t_ander" }];
  const uit = palette.search("acme", { records: vreemd, ctx: CTX });
  assert.deepEqual(uit.results, [], "een record van een andere tenant mag niet verschijnen");
});

test("IA-05 3· GEEN existence leak · geen telling van wat je niet mag zien", () => {
  const vreemd = [{ id: "c_x", routeId: "customers", route: "/app/customers/c_x/overview", label: "Geheim", tenantId: "t_ander" }];
  const leeg = palette.search("geheim", { records: [], ctx: CTX });
  const gefilterd = palette.search("geheim", { records: vreemd, ctx: CTX });
  // De uitvoer is BYTE-IDENTIEK aan "er bestaat niets": geen hint, geen teller.
  assert.deepEqual(gefilterd, leeg);
  assert.equal(JSON.stringify(gefilterd).includes("Geheim"), false);
});

test("IA-05 4· commando's zonder recht of entitlement verschijnen niet", () => {
  const zonderRecht = palette.search("offerte", {
    commands: COMMANDS, ctx: { ...CTX, permissions: ["customers.export"] },
  });
  assert.deepEqual(zonderRecht.results, [], "geen recht → geen commando");

  const zonderEntitlement = palette.search("offerte", {
    commands: COMMANDS, ctx: { ...CTX, entitlements: ["customers"] },
  });
  assert.deepEqual(zonderEntitlement.results, [], "module niet vrijgegeven → geen commando");
});

test("IA-05 5· een record buiten de opgeloste navigatie verschijnt niet (fail-closed)", () => {
  const uit = palette.search("F2026", { records: RECORDS, ctx: { ...CTX, allowedRouteIds: ["customers"] } });
  assert.deepEqual(uit.results.map(r => r.id), [], "geen finance-route → geen factuurtreffer");
});

test("IA-05 6· VELDRECHTEN: alleen toegestane samenvattingsvelden bereiken de UI", () => {
  const lek = {
    id: "e_1", routeId: "customers", route: "/app/customers/e_1/overview", label: "Jan",
    tenantId: "t_mij",
    // De server hoort dit nooit te sturen · als het toch gebeurt, stopt het hier.
    nationalNumber: "85.07.30-033.61", costRate: 62.5, iban: "BE68539007547034", salary: 4200,
  };
  const uit = palette.search("jan", { records: [lek], ctx: CTX });
  const rij = uit.results[0];
  assert.equal(rij.label, "Jan");
  for (const verboden of ["nationalNumber", "costRate", "iban", "salary"]) {
    assert.equal(verboden in rij, false, `${verboden} lekt naar het palet`);
  }
  assert.deepEqual(Object.keys(rij).filter(k => !palette.SUMMARY_FIELDS.includes(k)), []);
});

test("IA-05 7· leeg palet toont bestemmingen, nooit recordinhoud", () => {
  const pages = palette.pageIndex(volleBoom(), k => k);
  const uit = palette.search("", { pages, records: RECORDS, commands: COMMANDS, ctx: CTX });
  assert.ok(uit.results.length > 0, "een leeg palet hoort bestemmingen te tonen");
  assert.equal(uit.results.some(r => r.type === "record"), false, "geen records zonder zoekterm");
});

test("IA-05 8· de pagina-index komt uit de registry en is al rechten-gefilterd", () => {
  const beperkt = resolver.resolve(registry.ENTRIES, {
    portal: "tenant-admin", permissions: ["customers.view"], entitlements: ["customers"],
  });
  const pages = palette.pageIndex(beperkt, k => k);
  assert.ok(pages.some(p => p.id === "customers"));
  assert.equal(pages.some(p => p.id.startsWith("finance")), false, "een verborgen domein staat ook niet in het palet");
});

test("IA-05 9· rangschikking is deterministisch en zinnig", () => {
  assert.equal(palette.score("Klanten", "klanten"), 100);
  assert.equal(palette.score("Klanten", "klant"), 80);
  assert.equal(palette.score("Nieuwe offerte", "offerte"), 60);
  assert.equal(palette.score("Nieuweofferte", "fferte"), 40);
  assert.equal(palette.score("Klanten", "zzz"), 0);

  // Zelfde invoer geeft exact dezelfde volgorde · geen willekeur.
  const a = palette.search("a", { records: RECORDS, commands: COMMANDS, ctx: CTX });
  const b = palette.search("a", { records: RECORDS, commands: COMMANDS, ctx: CTX });
  assert.deepEqual(a, b);
});

test("IA-05 10· resultaten worden afgekapt en dat is zichtbaar", () => {
  const veel = Array.from({ length: 40 }, (_, i) => ({
    id: `c_${i}`, routeId: "customers", route: `/app/customers/c_${i}/overview`,
    label: `Acme ${i}`, tenantId: "t_mij",
  }));
  const uit = palette.search("acme", { records: veel, ctx: CTX, limit: 5 });
  assert.equal(uit.results.length, 5);
  assert.equal(uit.truncated, true, "afkappen mag, stil afkappen niet");
});

test("IA-05 11· telemetrie draagt lengte en rang, nooit de zoekterm", () => {
  const t = palette.selectTelemetry({ resultType: "record", rank: 2, queryLength: 4 });
  assert.deepEqual(t, { event: "search.select", result_type: "record", rank: 2, query_length: 4 });
  assert.deepEqual(Object.keys(t).sort(), ["event", "query_length", "rank", "result_type"]);
  // Het zoekresultaat zelf draagt ook alleen de lengte.
  const uit = palette.search("acme bouw", { records: RECORDS, ctx: CTX });
  assert.equal(uit.query_length, 9);
  assert.equal("query" in uit, false, "de zoekterm hoort niet in de uitvoer");
});
