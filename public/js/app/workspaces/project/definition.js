/* ============================================================
   IA-09 · Projectwerkruimte (IA handover §7/§8)

   Contract: "Scope/sites, plan, work, team, materials, finance and
   documents."
   Acceptatie: "Worksite/location relationship migration; actuals
   source-linked."

   Twee dingen die vandaag door elkaar lopen.

   1. WERF versus LOCATIE. Een locatie is een adres dat de KLANT bezit
      (zie IA-07). Een werf is een projectbegrip: de plek waar dit
      project uitgevoerd wordt, met een eigen periode, verantwoordelijke
      en compliance-dossier. Twee projecten kunnen dezelfde locatie
      gebruiken en toch verschillende werven zijn. Een werf VERWIJST dus
      naar een locatie, hij is er geen kopie van.

   2. ACTUALS ZIJN BRONVERBONDEN. Elk gerealiseerd bedrag en elk
      gerealiseerd uur op een project komt ergens vandaan: een
      werkbonregel, een onkost, een inkooporderregel, een prestatie. Een
      actual zonder bron is een getal dat niemand kan narekenen · en
      precies daar sneuvelt het vertrouwen in een margerapport.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpWorkspaces = root.wfpWorkspaces || {}; root.wfpWorkspaces.project = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const DEFINITION = {
    id: "projects",
    recordBase: "/app/projects",
    idParam: "projectId",
    defaultTab: "overview",
    tabs: [
      { id: "overview", labelKey: "project.tab.overview", permission: "projects.view" },
      { id: "worksites", labelKey: "project.tab.worksites", permission: "projects.view", countSource: "project.worksites" },
      { id: "plan", labelKey: "project.tab.plan", permission: "planning.view", entitlement: "planning" },
      { id: "work", labelKey: "project.tab.work", permission: "workorders.view", entitlement: "workorders", countSource: "project.work_orders" },
      { id: "team", labelKey: "project.tab.team", permission: "projects.view", countSource: "project.team" },
      { id: "materials", labelKey: "project.tab.materials", permission: "inventory.view", entitlement: "inventory", countSource: "project.materials" },
      // Financiën zit achter een EIGEN recht: niet elke projectleider mag marge zien.
      { id: "finance", labelKey: "project.tab.finance", permission: "costs.view", entitlement: "invoices" },
      { id: "files", labelKey: "project.tab.files", permission: "projects.view", countSource: "project.files" },
      { id: "activity", labelKey: "project.tab.activity", permission: "projects.view" },
    ],
  };

  // Velden die de LOCATIE beschrijft. Een werf mag ze niet dragen · hij verwijst.
  const LOCATION_OWNED_FIELDS = ["address", "street", "city", "postalCode", "country", "coordinates"];

  /**
   * Controleer de werf-locatierelatie.
   *
   * Een werf hoort te wijzen naar een locatie van DEZELFDE klant als het
   * project. Wijst hij naar de locatie van een andere klant, dan is er
   * ergens gekopieerd of verkeerd gekoppeld.
   *
   * @returns {{ ok, violations:[{field, reason}] }}
   */
  function checkWorksite(worksite, { project, locations } = {}) {
    const overtredingen = [];
    if (!worksite) return { ok: false, violations: [{ field: null, reason: "MISSING_WORKSITE" }] };
    if (!worksite.projectId) overtredingen.push({ field: "projectId", reason: "MISSING_CANONICAL_LINK" });
    if (!worksite.locationId) {
      overtredingen.push({ field: "locationId", reason: "MISSING_LOCATION_LINK" });
    } else if (locations) {
      const loc = locations[worksite.locationId];
      if (!loc) overtredingen.push({ field: "locationId", reason: "UNKNOWN_LOCATION" });
      else if (project && loc.customerId && project.customerId && loc.customerId !== project.customerId) {
        overtredingen.push({ field: "locationId", reason: "LOCATION_OTHER_CUSTOMER" });
      }
    }
    for (const veld of LOCATION_OWNED_FIELDS) {
      if (worksite[veld] !== undefined) overtredingen.push({ field: veld, reason: "DUPLICATED_LOCATION_DATA" });
    }
    return { ok: overtredingen.length === 0, violations: overtredingen };
  }

  /**
   * Migratieplan voor een bestaande werf met een los adresveld.
   * Geeft terug welke locatie eraan gekoppeld moet worden, of dat er een
   * nieuwe klantlocatie aangemaakt moet worden. Nooit stil raden: een werf
   * die op geen enkel adres matcht wordt gemarkeerd voor handwerk.
   */
  function planWorksiteMigration(worksite, klantLocaties) {
    if (worksite.locationId) return { action: "none", locationId: worksite.locationId };
    const adres = String(worksite.address || worksite.street || "").trim().toLowerCase();
    if (!adres) return { action: "manual", reason: "NO_ADDRESS" };
    const match = (klantLocaties || []).filter(l =>
      String(l.address || l.street || "").trim().toLowerCase() === adres);
    if (match.length === 1) return { action: "link", locationId: match[0].id };
    if (match.length > 1) return { action: "manual", reason: "AMBIGUOUS_MATCH", candidates: match.map(l => l.id) };
    return { action: "create_location", address: worksite.address || worksite.street };
  }

  // Waar een gerealiseerd bedrag of uur vandaan mag komen.
  const ACTUAL_SOURCES = ["work_order_line", "expense", "purchase_order_line", "timesheet", "stock_movement", "invoice_line"];

  /**
   * Elke actual draagt zijn bron. Zonder bron is het een getal dat niemand
   * kan narekenen, en dan is het margerapport een mening.
   */
  function checkActual(actual) {
    const overtredingen = [];
    if (!actual || !actual.projectId) overtredingen.push({ field: "projectId", reason: "MISSING_CANONICAL_LINK" });
    if (!actual || !actual.sourceType) overtredingen.push({ field: "sourceType", reason: "MISSING_SOURCE" });
    else if (!ACTUAL_SOURCES.includes(actual.sourceType)) overtredingen.push({ field: "sourceType", reason: "UNKNOWN_SOURCE" });
    if (!actual || !actual.sourceId) overtredingen.push({ field: "sourceId", reason: "MISSING_SOURCE" });
    return { ok: overtredingen.length === 0, violations: overtredingen };
  }

  /**
   * De doorklik van een bedrag naar zijn bronrecord. Elk getal in het
   * financiële tabblad moet aanklikbaar zijn tot op de regel waar het
   * ontstond (IA-15: "every aggregate links to source").
   */
  const SOURCE_ROUTES = {
    work_order_line: id => `/app/work-orders/${id}/overview`,
    expense: id => `/app/finance/expenses/${id}`,
    purchase_order_line: id => `/app/resources/purchasing/${id}`,
    timesheet: id => `/app/team/time/${id}`,
    stock_movement: id => `/app/resources/stock/${id}`,
    invoice_line: id => `/app/finance/invoices/${id}`,
  };

  function sourceRoute(actual) {
    const f = SOURCE_ROUTES[actual && actual.sourceType];
    // Het parentId is de route-drager: een werkbonREGEL leeft in de werkbon.
    const id = actual && (actual.sourceParentId || actual.sourceId);
    return f && id ? f(id) : null;
  }

  return {
    DEFINITION, LOCATION_OWNED_FIELDS, ACTUAL_SOURCES, SOURCE_ROUTES,
    checkWorksite, planWorksiteMigration, checkActual, sourceRoute,
  };
});
