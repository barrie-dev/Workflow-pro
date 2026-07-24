/* ============================================================
   IA-15 · Insights-domein (IA handover §7/§8)

   Contract: "Reports, capacity, saved lists and exports."
   Acceptatie: "Every aggregate links to source; permissions match
   API/export."

   Twee eisen die allebei over vertrouwen gaan.

   1. ELK TOTAAL KLIKT DOOR NAAR ZIJN BRON. Een marge van 18% is
      betekenisloos zolang je niet kunt zien uit welke facturen en kosten
      ze bestaat. Zodra iemand het getal niet vertrouwt en het niet kan
      narekenen, is het rapport dood. Elk aggregaat draagt daarom een
      drilldown: dezelfde filters, maar dan naar de onderliggende rijen.

   2. EXPORTEREN IS GEEN ACHTERDEUR. Wat je niet in het scherm mag zien,
      mag je ook niet exporteren, en ook niet via een rapport of een
      opgeslagen lijst binnenhalen. Het is de klassieke ontsnapping:
      loonvelden zijn afgeschermd in de medewerkerslijst, maar de export
      naar Excel bevat ze wel.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpWorkspaces = root.wfpWorkspaces || {}; root.wfpWorkspaces.insights = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const DEFINITION = {
    id: "insights.reports",
    recordBase: "/app/insights/reports",
    idParam: "reportId",
    defaultTab: "overview",
    tabs: [
      { id: "overview", labelKey: "report.tab.overview", permission: "reports.view" },
      { id: "filters", labelKey: "report.tab.filters", permission: "reports.view" },
      { id: "data", labelKey: "report.tab.data", permission: "reports.view", countSource: "report.rows" },
      { id: "schedule", labelKey: "report.tab.schedule", permission: "reports.schedule", countSource: "report.schedules" },
      { id: "activity", labelKey: "report.tab.activity", permission: "reports.view" },
    ],
  };

  /**
   * Waar een aggregaat naartoe drilt. Elk rapportonderwerp wijst naar de
   * lijstroute van zijn onderliggende records; de filters reizen mee zodat
   * je exact dezelfde verzameling ziet.
   */
  const DRILLDOWN_ROUTES = {
    revenue: "/app/finance/invoices",
    outstanding: "/app/finance/invoices",
    margin: "/app/projects",
    hours: "/app/team/time",
    leave: "/app/team/leave",
    expenses: "/app/finance/expenses",
    stock_value: "/app/resources/catalog",
    work_orders: "/app/work-orders",
    capacity: "/app/planning",
  };

  /**
   * Bouw de doorklik van een aggregaat naar zijn bronrijen.
   * Zonder route is er geen doorklik, en dan hoort het getal er niet te
   * staan · liever geen kengetal dan een kengetal dat niemand kan checken.
   */
  function drilldown(aggregate) {
    const basis = DRILLDOWN_ROUTES[aggregate && aggregate.metric];
    if (!basis) return null;
    const filters = { ...(aggregate.filters || {}) };
    if (aggregate.dimensionKey && aggregate.dimensionValue) filters[aggregate.dimensionKey] = aggregate.dimensionValue;
    const sleutels = Object.keys(filters).filter(k => filters[k] !== null && filters[k] !== "").sort();
    const qs = sleutels.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(filters[k])}`).join("&");
    return qs ? `${basis}?${qs}` : basis;
  }

  /**
   * Elk kengetal in een rapport MOET doorklikbaar zijn.
   * Deze controle maakt de acceptatie-eis afdwingbaar in plaats van
   * hoopvol: een nieuw rapportonderwerp zonder drilldown faalt de test.
   */
  function checkAggregates(aggregates) {
    const zonderBron = (aggregates || []).filter(a => !drilldown(a));
    return {
      ok: zonderBron.length === 0,
      violations: zonderBron.map(a => ({ metric: a.metric, reason: "NO_SOURCE_LINK" })),
    };
  }

  /**
   * Rechtenpariteit tussen scherm, rapport en export (D-07).
   *
   * @param {Array} columns  gevraagde kolommen
   * @param {object} ctx     { permissions }
   * @param {object} fieldRights  { kolomnaam: vereistRecht }
   * @returns {{ allowed:[...], denied:[...] }}
   *
   * De geweigerde kolommen worden GENOEMD in de uitvoer, want de gebruiker
   * die een export samenstelt hoort te weten dat er iets ontbreekt. Dat is
   * iets anders dan een lijstresultaat, waar zwijgen juist wél nodig is:
   * hier vraagt hij om een kolom die hij bij naam kent.
   */
  function projectColumns(columns, ctx, fieldRights) {
    const p = (ctx && ctx.permissions) || [];
    const heeft = r => !r || p.includes("*") || p.includes(r);
    const toegestaan = [], geweigerd = [];
    for (const kolom of columns || []) {
      if (heeft((fieldRights || {})[kolom])) toegestaan.push(kolom);
      else geweigerd.push(kolom);
    }
    return { allowed: toegestaan, denied: geweigerd };
  }

  /**
   * Mag deze export doorgaan? Een export met geweigerde kolommen gaat
   * NIET stil door met minder kolommen: dan denkt de gebruiker dat hij een
   * volledig bestand heeft. Hij moet ze eerst weghalen of om rechten vragen.
   */
  function exportDecision(request, ctx, fieldRights) {
    const p = (ctx && ctx.permissions) || [];
    if (!(p.includes("*") || p.includes("reports.export"))) return { ok: false, code: "NO_EXPORT_RIGHT", denied: [] };
    const { denied } = projectColumns(request && request.columns, ctx, fieldRights);
    if (denied.length) return { ok: false, code: "COLUMNS_DENIED", denied };
    return { ok: true, code: null, denied: [] };
  }

  /**
   * Een opgeslagen lijst bewaart FILTERS, geen gegevens. Bewaart hij rijen,
   * dan omzeilt hij morgen de rechten van wie hem opent · en toont hij data
   * die inmiddels veranderd of verwijderd is.
   */
  function checkSavedView(view) {
    const overtredingen = [];
    if (!view || !view.routeId) overtredingen.push({ field: "routeId", reason: "MISSING_ROUTE" });
    if (view && Array.isArray(view.rows)) overtredingen.push({ field: "rows", reason: "SAVED_VIEW_STORES_DATA" });
    if (view && view.snapshot !== undefined) overtredingen.push({ field: "snapshot", reason: "SAVED_VIEW_STORES_DATA" });
    return { ok: overtredingen.length === 0, violations: overtredingen };
  }

  return {
    DEFINITION, DRILLDOWN_ROUTES,
    drilldown, checkAggregates, projectColumns, exportDecision, checkSavedView,
  };
});
