"use strict";
// IA-15 · Insights-domein · acceptatie: "Every aggregate links to source;
//         permissions match API/export."
// IA-16 · Automation-domein · acceptatie: "Provider-global settings excluded;
//         connector health and mappings tenant-scoped."
const { test } = require("node:test");
const assert = require("node:assert");
const insights = require("../public/js/app/workspaces/insights/definition");
const automation = require("../public/js/app/workspaces/automation/definition");
const tabs = require("../public/js/app/shared/record-tabs");

// ── IA-15 · elk totaal klikt door ────────────────────────────────────────────

test("IA-15 1· elk kengetal klikt door naar zijn bronrijen", () => {
  const uit = insights.drilldown({
    metric: "revenue", filters: { from: "2026-01-01", to: "2026-06-30", status: "paid" },
  });
  assert.equal(uit, "/app/finance/invoices?from=2026-01-01&status=paid&to=2026-06-30");
});

test("IA-15 2· de dimensie van een staaf reist mee in de doorklik", () => {
  // Klik op de balk 'Acme Bouw' in een omzetgrafiek per klant.
  const uit = insights.drilldown({
    metric: "revenue", filters: { from: "2026-01-01" },
    dimensionKey: "customerId", dimensionValue: "c_42",
  });
  assert.equal(uit, "/app/finance/invoices?customerId=c_42&from=2026-01-01");
});

test("IA-15 3· een onderwerp ZONDER doorklik faalt · liever geen kengetal", () => {
  assert.equal(insights.drilldown({ metric: "verzonnen" }), null);
  const uit = insights.checkAggregates([{ metric: "margin" }, { metric: "verzonnen" }]);
  assert.equal(uit.ok, false);
  assert.deepEqual(uit.violations, [{ metric: "verzonnen", reason: "NO_SOURCE_LINK" }]);
});

test("IA-15 4· elk geregistreerd onderwerp heeft een geldige bronroute", () => {
  for (const metric of Object.keys(insights.DRILLDOWN_ROUTES)) {
    const r = insights.drilldown({ metric });
    assert.ok(r && r.startsWith("/app/"), `${metric} heeft geen bruikbare bronroute`);
  }
});

test("IA-15 5· lege filters vervuilen de doorklik niet", () => {
  assert.equal(insights.drilldown({ metric: "hours", filters: { from: "", employee: null } }), "/app/team/time");
});

// ── IA-15 · export is geen achterdeur ────────────────────────────────────────

const VELDRECHTEN = { salary: "costs.view", costRate: "costs.view", nationalNumber: "employees.hr", name: null };

test("IA-15 6· EXPORT IS GEEN ACHTERDEUR: afgeschermde kolommen vallen weg", () => {
  const uit = insights.projectColumns(["name", "salary", "nationalNumber"],
    { permissions: ["reports.view"] }, VELDRECHTEN);
  assert.deepEqual(uit.allowed, ["name"]);
  assert.deepEqual(uit.denied, ["salary", "nationalNumber"]);
});

test("IA-15 7· een export met geweigerde kolommen gaat NIET stil door", () => {
  const uit = insights.exportDecision({ columns: ["name", "salary"] },
    { permissions: ["reports.view", "reports.export"] }, VELDRECHTEN);
  assert.equal(uit.ok, false);
  assert.equal(uit.code, "COLUMNS_DENIED");
  assert.deepEqual(uit.denied, ["salary"],
    "de gebruiker hoort te weten dat er iets ontbreekt, niet een half bestand te krijgen");
});

test("IA-15 8· exporteren vereist een eigen recht", () => {
  const uit = insights.exportDecision({ columns: ["name"] }, { permissions: ["reports.view"] }, VELDRECHTEN);
  assert.equal(uit.code, "NO_EXPORT_RIGHT", "mogen kijken is niet mogen meenemen");

  const mag = insights.exportDecision({ columns: ["name", "salary"] },
    { permissions: ["reports.export", "costs.view"] }, VELDRECHTEN);
  assert.equal(mag.ok, true, "met het veldrecht mag de kolom wel mee");
});

test("IA-15 9· een opgeslagen lijst bewaart FILTERS, geen gegevens", () => {
  assert.equal(insights.checkSavedView({ routeId: "finance.invoices", filters: { status: "open" } }).ok, true);

  const metData = insights.checkSavedView({ routeId: "finance.invoices", rows: [{ id: "i_1", total: 100 }] });
  assert.equal(metData.ok, false);
  assert.deepEqual(metData.violations, [{ field: "rows", reason: "SAVED_VIEW_STORES_DATA" }],
    "bewaarde rijen omzeilen morgen de rechten van wie de lijst opent");
  assert.equal(insights.checkSavedView({ routeId: "x", snapshot: {} }).ok, false);
  assert.equal(insights.checkSavedView({}).violations[0].reason, "MISSING_ROUTE");
});

// ── IA-16 · platform versus tenant ───────────────────────────────────────────

const CONFIG = {
  enabled: true, fieldMapping: { customerName: "naam" }, lastSyncAt: "2026-07-24T04:12:00Z",
  lastSyncStatus: "error", errorCount: 3, webhookUrl: "https://klant.be/hook",
  providerName: "Billit", providerEndpoint: "https://api.billit.be", providerApiKey: "geheim",
  providerUnitCost: 0.14, providerContractRef: "CTR-2026-01",
};

test("IA-16 10· een tenant ziet zijn EIGEN koppeling, niet onze provider", () => {
  const tenant = automation.projectSettings(CONFIG, { portal: "tenant-admin" });
  assert.equal(tenant.enabled, true);
  assert.equal(tenant.lastSyncStatus, "error", "zijn eigen fout mag hij gewoon zien");
  for (const veld of automation.PROVIDER_GLOBAL_SETTINGS) {
    assert.equal(veld in tenant, false, `${veld} lekt naar de tenant`);
  }
  assert.equal(JSON.stringify(tenant).includes("Billit"), false, "ook de waarde niet");
});

test("IA-16 11· platformvelden worden weggelaten, niet genuld", () => {
  const tenant = automation.projectSettings(CONFIG, { portal: "tenant-admin" });
  assert.equal(Object.keys(tenant).some(k => k.startsWith("provider")), false,
    "een leeg providerEndpoint verraadt nog steeds dat er een provider tussen zit");
});

test("IA-16 12· Super Admin ziet de volledige configuratie", () => {
  const sa = automation.projectSettings(CONFIG, { portal: "super-admin" });
  assert.equal(sa.providerName, "Billit");
  assert.equal(sa.providerUnitCost, 0.14);
});

test("IA-16 13· een platformveld wijzigen wordt hard geweigerd", () => {
  const admin = { portal: "tenant-admin", permissions: ["integrations.manage"] };
  for (const veld of automation.PROVIDER_GLOBAL_SETTINGS) {
    const uit = automation.canEditSetting(veld, admin);
    assert.equal(uit.ok, false, `${veld} is wijzigbaar door een tenant`);
    assert.equal(uit.code, "PLATFORM_SCOPED_SETTING", "eigen code · dit raakt ALLE tenants");
  }
  assert.equal(automation.canEditSetting("providerEndpoint", { portal: "super-admin" }).ok, true);
});

test("IA-16 14· tenantinstellingen vragen het beheerrecht", () => {
  assert.equal(automation.canEditSetting("fieldMapping", { permissions: ["integrations.manage"] }).ok, true);
  assert.equal(automation.canEditSetting("fieldMapping", { permissions: ["integrations.view"] }).code, "NO_MANAGE_RIGHT");
  assert.equal(automation.canEditSetting("verzonnen", { permissions: ["*"] }).code, "UNKNOWN_SETTING",
    "een onbekende instelling wordt geweigerd, niet doorgelaten");
});

test("IA-16 15· de gezondheidsweergave is tenant-gescoped en geeft een volgende stap", () => {
  const h = automation.health(CONFIG, { portal: "tenant-admin" });
  assert.equal(h.status, "failing");
  assert.equal(h.errorCount, 3);
  assert.equal(h.actionKey, "integration.action.check_credentials", "een fout zonder volgende stap laat de klant bellen");
  // De weergave draagt geen platforminformatie mee.
  assert.deepEqual(Object.keys(h).sort(), ["actionKey", "errorCount", "lastSyncAt", "status"]);
});

test("IA-16 16· elke gezondheidstoestand is onderscheiden", () => {
  const ctx = { portal: "tenant-admin" };
  assert.equal(automation.health({ enabled: false }, ctx).status, "disabled");
  assert.equal(automation.health({ enabled: true }, ctx).status, "never_run");
  assert.equal(automation.health({ enabled: true, lastSyncAt: "2026-07-24" }, ctx).status, "healthy");
  assert.equal(automation.health({ enabled: true, lastSyncAt: "2026-07-24", errorCount: 2 }, ctx).status, "degraded");
});

test("IA-16 17· een halve veldafbeelding wordt opgemerkt", () => {
  const uit = automation.checkMapping({ customerName: "naam", email: "" }, ["customerName", "email", "vatNumber"]);
  assert.equal(uit.ok, false);
  assert.deepEqual(uit.missing.sort(), ["email", "vatNumber"],
    "een halve afbeelding levert stille datafouten op bij de klant van de klant");
});

test("IA-16 18· twee doelvelden uit dezelfde bron is meestal een kopieerfout", () => {
  const uit = automation.checkMapping({ name: "naam", legalName: "naam" }, ["name", "legalName"]);
  assert.equal(uit.ok, true, "het is geen blokkade");
  assert.deepEqual(uit.duplicates, [{ source: "naam", targets: ["legalName", "name"] }], "maar wel een waarschuwing");
});

test("IA-15+16 19· beide domeinen voldoen aan het gedeelde tabcontract", () => {
  for (const def of [insights.DEFINITION, automation.DEFINITION]) {
    const t = tabs.tabsFor(def, { permissions: ["*"], entitlements: [], params: { [def.idParam]: "r_1" } });
    assert.equal(t.filter(x => x.isActive).length, 1, `${def.id} heeft niet precies één actief tabblad`);
    for (const tab of t) {
      assert.equal(tab.route, `${def.recordBase}/r_1/${tab.id}`, `${def.id}/${tab.id} is niet route-backed`);
      assert.match(tab.labelKey, /^[a-z_]+\.tab\.[a-z_]+$/, `${def.id}/${tab.id} heeft geen i18n-sleutel`);
    }
  }
});

test("IA-16 20· de koppelingsgegevens zitten achter het beheerrecht", () => {
  const kijker = tabs.tabsFor(automation.DEFINITION, {
    permissions: ["integrations.view"], params: { integrationId: "i_1" },
  });
  assert.equal(kijker.some(t => t.id === "credentials"), false, "meekijken is geen sleutels zien");
  assert.equal(kijker.some(t => t.id === "mapping"), false);
  assert.ok(kijker.some(t => t.id === "health"), "de gezondheid mag hij wel zien");
});
