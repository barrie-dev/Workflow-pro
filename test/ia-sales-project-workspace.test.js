"use strict";
// IA-08 · Verkoopdomein · acceptatie: "Accepted quote version immutable;
//         project creation traceable."
// IA-09 · Projectwerkruimte · acceptatie: "Worksite/location relationship
//         migration; actuals source-linked."
const { test } = require("node:test");
const assert = require("node:assert");
const sales = require("../public/js/app/workspaces/sales/definition");
const project = require("../public/js/app/workspaces/project/definition");
const tabs = require("../public/js/app/shared/record-tabs");

// ── IA-08 · offerteversies ───────────────────────────────────────────────────

test("IA-08 1· een GEACCEPTEERDE offerteversie is onveranderlijk", () => {
  const uit = sales.canEditVersion({ status: "accepted" });
  assert.equal(uit.ok, false);
  assert.equal(uit.code, "ACCEPTED_VERSION_IMMUTABLE");
  assert.equal(sales.canEditVersion({ status: "signed" }).code, "ACCEPTED_VERSION_IMMUTABLE",
    "wat de klant tekende blijft staan");
});

test("IA-08 2· een VERSTUURDE versie is ook al vast", () => {
  assert.equal(sales.canEditVersion({ status: "sent" }).code, "SENT_VERSION_IMMUTABLE");
  assert.equal(sales.canEditVersion({ status: "draft" }).ok, true, "alleen een concept is nog eerlijk te bewerken");
  assert.equal(sales.canEditVersion(null).code, "UNKNOWN_VERSION");
});

test("IA-08 3· wie niet mag bewerken krijgt een UITWEG, geen doodlopende fout", () => {
  assert.deepEqual(sales.alternativesFor({ status: "accepted" }),
    ["quote.new_change_order", "quote.duplicate_as_new_version"]);
  assert.deepEqual(sales.alternativesFor({ status: "sent" }), ["quote.duplicate_as_new_version"]);
  assert.deepEqual(sales.alternativesFor({ status: "draft" }), [], "wie mag bewerken heeft geen alternatief nodig");
});

test("IA-08 4· een project uit een offerte draagt de exacte VERSIE", () => {
  const goed = sales.checkProjectProvenance({ origin: "quote", sourceQuoteId: "q_1", sourceQuoteVersionId: "qv_3" });
  assert.equal(goed.ok, true);

  // Alleen de offerte is niet genoeg: die kan vijf versies met andere bedragen hebben.
  const zonderVersie = sales.checkProjectProvenance({ origin: "quote", sourceQuoteId: "q_1" });
  assert.equal(zonderVersie.ok, false);
  assert.deepEqual(zonderVersie.violations, [{ field: "sourceQuoteVersionId", reason: "MISSING_SOURCE_VERSION" }]);
});

test("IA-08 5· elk project benoemt zijn herkomst", () => {
  assert.deepEqual(sales.checkProjectProvenance({}).violations, [{ field: "origin", reason: "MISSING_ORIGIN" }]);
  assert.equal(sales.checkProjectProvenance({ origin: "manual" }).ok, true, "handmatig is een geldige herkomst");
  assert.equal(sales.checkProjectProvenance({ origin: "verzonnen" }).violations[0].reason, "UNKNOWN_ORIGIN");
});

test("IA-08 6· de herkomst is aanklikbaar tot op de versie", () => {
  const l = sales.provenanceLink({ origin: "quote", sourceQuoteId: "q_1", sourceQuoteVersionId: "qv_3" });
  assert.equal(l.route, "/app/sales/quotes/q_1/versions");
  assert.equal(l.versionId, "qv_3");
  assert.equal(sales.provenanceLink({ origin: "manual" }), null, "een handmatig project heeft geen offertelink");
});

// ── IA-09 · werf versus locatie ──────────────────────────────────────────────

test("IA-09 7· een werf VERWIJST naar een locatie, hij kopieert er geen adres van", () => {
  const goed = project.checkWorksite({ projectId: "p_1", locationId: "loc_2", name: "Fase 1" });
  assert.equal(goed.ok, true);

  const kopie = project.checkWorksite({ projectId: "p_1", locationId: "loc_2", address: "Dorpsstraat 1", city: "Gent" });
  assert.equal(kopie.ok, false);
  assert.deepEqual(kopie.violations.map(v => v.field).sort(), ["address", "city"]);
  assert.equal(kopie.violations.every(v => v.reason === "DUPLICATED_LOCATION_DATA"), true);
});

test("IA-09 8· een werf op de locatie van een ANDERE klant wordt afgekeurd", () => {
  const uit = project.checkWorksite(
    { projectId: "p_1", locationId: "loc_9" },
    { project: { customerId: "c_1" }, locations: { loc_9: { customerId: "c_2" } } });
  assert.equal(uit.ok, false);
  assert.deepEqual(uit.violations, [{ field: "locationId", reason: "LOCATION_OTHER_CUSTOMER" }]);

  const onbekend = project.checkWorksite({ projectId: "p_1", locationId: "loc_x" },
    { project: { customerId: "c_1" }, locations: {} });
  assert.equal(onbekend.violations[0].reason, "UNKNOWN_LOCATION");
});

test("IA-09 9· MIGRATIE: een bestaande werf met los adres wordt gekoppeld of gemarkeerd", () => {
  const locaties = [{ id: "loc_1", address: "Dorpsstraat 1" }, { id: "loc_2", address: "Kerkstraat 5" }];

  assert.deepEqual(project.planWorksiteMigration({ address: "dorpsstraat 1" }, locaties),
    { action: "link", locationId: "loc_1" }, "eenduidige match wordt gekoppeld");
  assert.deepEqual(project.planWorksiteMigration({ address: "Nieuwe laan 3" }, locaties),
    { action: "create_location", address: "Nieuwe laan 3" });
  assert.deepEqual(project.planWorksiteMigration({ locationId: "loc_2" }, locaties),
    { action: "none", locationId: "loc_2" }, "al gekoppeld blijft ongemoeid");
});

test("IA-09 10· MIGRATIE raadt nooit stil · twijfel gaat naar handwerk", () => {
  const dubbel = [{ id: "loc_1", address: "Dorpsstraat 1" }, { id: "loc_3", address: "Dorpsstraat 1" }];
  const uit = project.planWorksiteMigration({ address: "Dorpsstraat 1" }, dubbel);
  assert.equal(uit.action, "manual");
  assert.equal(uit.reason, "AMBIGUOUS_MATCH");
  assert.deepEqual(uit.candidates, ["loc_1", "loc_3"]);
  assert.equal(project.planWorksiteMigration({}, dubbel).reason, "NO_ADDRESS");
});

// ── IA-09 · actuals ──────────────────────────────────────────────────────────

test("IA-09 11· ACTUALS ZIJN BRONVERBONDEN · een los getal wordt afgekeurd", () => {
  const goed = project.checkActual({ projectId: "p_1", sourceType: "work_order_line", sourceId: "wol_7", amount: 250 });
  assert.equal(goed.ok, true);

  const los = project.checkActual({ projectId: "p_1", amount: 250 });
  assert.equal(los.ok, false);
  assert.deepEqual(los.violations.map(v => v.field), ["sourceType", "sourceId"]);
});

test("IA-09 12· een onbekende bronsoort wordt geweigerd, niet doorgelaten", () => {
  const uit = project.checkActual({ projectId: "p_1", sourceType: "handmatige_correctie", sourceId: "x" });
  assert.equal(uit.ok, false);
  assert.deepEqual(uit.violations, [{ field: "sourceType", reason: "UNKNOWN_SOURCE" }]);
});

test("IA-09 13· elk bedrag klikt door naar het record waar het ontstond", () => {
  for (const soort of project.ACTUAL_SOURCES) {
    const route = project.sourceRoute({ sourceType: soort, sourceId: "s_1" });
    assert.ok(route && route.startsWith("/app/"), `${soort} heeft geen doorklik`);
  }
  // Een regel leeft in zijn ouder: de werkbon, niet de regel-id.
  assert.equal(project.sourceRoute({ sourceType: "work_order_line", sourceId: "wol_7", sourceParentId: "wo_2" }),
    "/app/work-orders/wo_2/overview");
  assert.equal(project.sourceRoute({ sourceType: "verzonnen", sourceId: "x" }), null);
});

// ── Gedeelde regels over beide werkruimtes ───────────────────────────────────

test("IA-09 14· marge zit achter een EIGEN recht, niet achter projecttoegang", () => {
  const zonder = tabs.tabsFor(project.DEFINITION, {
    permissions: ["projects.view", "planning.view", "workorders.view", "inventory.view"],
    entitlements: ["planning", "workorders", "inventory", "invoices"],
    params: { projectId: "p_1" },
  });
  assert.equal(zonder.some(t => t.id === "finance"), false,
    "een projectleider zonder costs.view ziet geen marge");

  const met = tabs.tabsFor(project.DEFINITION, {
    permissions: ["projects.view", "costs.view"], entitlements: ["invoices"], params: { projectId: "p_1" },
  });
  assert.equal(met.some(t => t.id === "finance"), true);
});

test("IA-08+09 15· beide werkruimtes voldoen aan het gedeelde tabcontract", () => {
  for (const def of [sales.DEFINITION, project.DEFINITION]) {
    const t = tabs.tabsFor(def, { permissions: ["*"], entitlements: ["planning", "workorders", "inventory", "invoices", "quotes"], params: { [def.idParam]: "r_1" } });
    assert.ok(t.length >= 5, `${def.id} heeft te weinig tabbladen`);
    assert.equal(t.filter(x => x.isActive).length, 1, `${def.id} heeft niet precies één actief tabblad`);
    for (const tab of t) {
      assert.equal(tab.route, `${def.recordBase}/r_1/${tab.id}`, `${def.id}/${tab.id} is niet route-backed`);
      assert.match(tab.labelKey, /^[a-z_]+\.tab\.[a-z_]+$/, `${def.id}/${tab.id} heeft geen i18n-sleutel`);
    }
  }
});
