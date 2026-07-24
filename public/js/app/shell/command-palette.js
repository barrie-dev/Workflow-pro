/* ============================================================
   IA-05 · Command palette & global search (IA handover §7/§8)

   Contract: "Search and commands with permission, field-right and
   tenant filters." Eén invoerveld dat drie bronnen samenbrengt:

     pages     · bestemmingen uit de opgeloste registry (IA-01)
     records   · treffers van het zoek-endpoint
     commands  · acties die de gebruiker hier mag uitvoeren

   Twee harde regels uit §9 en §10:

   1. GEEN existence leak. Een record dat de gebruiker niet mag zien
      bestaat voor het palet niet. Er komt nooit een telling, hint of
      "geen toegang"-rij terug · dat verraadt dat het record bestaat.
   2. GEEN veldlek. Het endpoint projecteert serverzijdig, maar het
      palet rendert alleen een expliciet toegestane samenvatting. Een
      onbekend veld wordt niet getoond, ook niet als de server het
      per ongeluk meestuurt.

   Telemetrie draagt lengte en rang, nooit de zoekterm zelf (§11).
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpShell = root.wfpShell || {}; root.wfpShell.commandPalette = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  // Volgorde bij gelijke score. Commando's eerst: wie typt en al weet wat
  // hij wil doen, wil niet eerst door bestemmingen scrollen.
  const TYPE_ORDER = { command: 0, page: 1, record: 2 };
  const MAX_RESULTS = 20;

  // Velden die een resultaatrij mag tonen. Alles daarbuiten valt weg,
  // ook wanneer de server het meestuurt (§9 · "no hidden fields").
  const SUMMARY_FIELDS = ["type", "label", "subtitle", "route", "id", "status"];

  function norm(s) { return String(s == null ? "" : s).trim().toLowerCase(); }

  /**
   * Score van een treffer. Hoger is beter, 0 betekent geen treffer.
   *   100 · exacte gelijkenis
   *    80 · begint met de zoekterm
   *    60 · een woord begint met de zoekterm
   *    40 · bevat de zoekterm
   */
  function score(text, query) {
    const t = norm(text), q = norm(query);
    if (!q || !t) return 0;
    if (t === q) return 100;
    if (t.startsWith(q)) return 80;
    if (t.split(/[\s\-_/.]+/).some(w => w.startsWith(q))) return 60;
    if (t.includes(q)) return 40;
    return 0;
  }

  /**
   * Bouw de pagina-index uit de OPGELOSTE navigatieboom. Die is al
   * rechten- en entitlement-gefilterd (IA-01), dus wat hier binnenkomt
   * mag de gebruiker ook zien. Het palet filtert niet zelf op rechten:
   * het krijgt alleen wat toegestaan is.
   */
  function pageIndex(tree, t) {
    const vertaal = typeof t === "function" ? t : (k => k);
    const uit = [];
    for (const d of tree || []) {
      uit.push({ type: "page", id: d.id, label: vertaal(d.labelKey), route: d.path, keywords: d.searchKeywords || [] });
      for (const c of d.children || []) {
        uit.push({
          type: "page", id: c.id, label: vertaal(c.labelKey), route: c.path,
          subtitle: vertaal(d.labelKey), keywords: c.searchKeywords || [],
        });
      }
    }
    return uit;
  }

  /** Beperk een rij tot de toegestane samenvattingsvelden. */
  function permittedSummary(row) {
    const uit = {};
    for (const f of SUMMARY_FIELDS) if (row[f] !== undefined && row[f] !== null) uit[f] = row[f];
    return uit;
  }

  /**
   * Mag deze rij getoond worden?
   *  · records buiten de eigen tenant bestaan niet;
   *  · een rij zonder route is niet aanklikbaar en hoort er dus niet;
   *  · een route die niet in de opgeloste navigatie zit is geweigerd;
   *  · een commando zonder het vereiste recht bestaat niet.
   */
  function visible(row, ctx) {
    const c = ctx || {};
    if (row.tenantId && c.tenantId && row.tenantId !== c.tenantId) return false;
    if (!row.route) return false;
    if (row.type === "command") {
      if (row.permission && !(c.permissions || []).includes(row.permission) && !(c.permissions || []).includes("*")) return false;
      if (row.entitlement && !(c.entitlements || []).includes(row.entitlement)) return false;
    }
    if (row.type === "record" && Array.isArray(c.allowedRouteIds) && row.routeId) {
      if (!c.allowedRouteIds.includes(row.routeId)) return false;
    }
    return true;
  }

  /**
   * Zoek over de drie bronnen.
   *
   * @param {string} query
   * @param {object} o { pages, records, commands, ctx, limit }
   * @returns {{query_length:number, results:Array, truncated:boolean}}
   *
   * De uitvoer draagt bewust GEEN totaaltelling van weggefilterde rijen:
   * dat zou verraden dat er iets bestaat wat je niet mag zien.
   */
  function search(query, o = {}) {
    const q = norm(query);
    const ctx = o.ctx || {};
    const limit = o.limit || MAX_RESULTS;
    const bronnen = [
      ...(o.commands || []).map(r => ({ ...r, type: "command" })),
      ...(o.pages || []).map(r => ({ ...r, type: "page" })),
      ...(o.records || []).map(r => ({ ...r, type: "record" })),
    ];

    const treffers = [];
    for (const rij of bronnen) {
      if (!visible(rij, ctx)) continue;
      let s = Math.max(score(rij.label, q), score(rij.subtitle, q));
      for (const k of rij.keywords || []) s = Math.max(s, score(k, q) - 5);
      // Zonder zoekterm tonen we de bestemmingen als startlijst, geen records:
      // een leeg palet mag geen recordinhoud uitstallen.
      if (!q) { if (rij.type === "record") continue; s = 1; }
      if (s <= 0) continue;
      treffers.push({ row: rij, s });
    }

    treffers.sort((a, b) =>
      b.s - a.s
      || TYPE_ORDER[a.row.type] - TYPE_ORDER[b.row.type]
      || norm(a.row.label).localeCompare(norm(b.row.label))
      || String(a.row.id).localeCompare(String(b.row.id)));

    return {
      query_length: q.length,
      results: treffers.slice(0, limit).map(x => permittedSummary(x.row)),
      truncated: treffers.length > limit,
    };
  }

  /**
   * Telemetrie bij een selectie (§11 · search.select).
   * Draagt result_type, rank en query_length · nooit de zoekterm.
   */
  function selectTelemetry(o = {}) {
    return {
      event: "search.select",
      result_type: o.resultType || null,
      rank: Number.isFinite(o.rank) ? o.rank : null,
      query_length: Number.isFinite(o.queryLength) ? o.queryLength : 0,
    };
  }

  return { search, pageIndex, permittedSummary, selectTelemetry, score, visible, SUMMARY_FIELDS, MAX_RESULTS };
});
