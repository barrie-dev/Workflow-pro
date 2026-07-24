/* ============================================================
   IA-07 · RecordTabs (IA handover §7)

   Contract: "Route-backed tabs; hidden when unauthorised; counts
   loaded lazily."

   Drie regels die deze module afdwingt:

   1. Elk tabblad is een ROUTE. Terug, vooruit, verversen en een gedeelde
      link komen allemaal op hetzelfde tabblad uit. Een tabblad dat alleen
      in het geheugen bestaat overleeft geen F5.
   2. Geen recht betekent GEEN TABBLAD. Niet een tabblad dat leeg is of
      "geen toegang" toont · dat verraadt nog steeds dat er iets is.
   3. Tellingen komen apart. Het openen van een dossier mag niet wachten
      op het tellen van zes relaties.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpShared = root.wfpShared || {}; root.wfpShared.recordTabs = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  function heeftRecht(ctx, nodig) {
    if (!nodig) return true;
    const p = (ctx && ctx.permissions) || [];
    return p.includes("*") || p.includes(nodig);
  }

  /**
   * Bepaal de zichtbare tabbladen van een werkruimte.
   *
   * @param {object} def  werkruimtedefinitie { recordPath, tabs:[...] }
   * @param {object} ctx  { permissions, entitlements, params, activeTab }
   * @returns {Array} [{ id, labelKey, route, isActive, hasCount, countSource }]
   */
  function tabsFor(def, ctx = {}) {
    const params = ctx.params || {};
    const recordId = params[def.idParam];
    return (def.tabs || [])
      .filter(t => heeftRecht(ctx, t.permission))
      .filter(t => !t.entitlement || (ctx.entitlements || []).includes(t.entitlement))
      .map(t => ({
        id: t.id,
        labelKey: t.labelKey,
        // Route-backed: het tabblad IS een URL, geen geheugentoestand.
        route: recordId ? `${def.recordBase}/${recordId}/${t.id}` : null,
        isActive: t.id === (ctx.activeTab || def.defaultTab),
        // Tellingen worden apart geladen · het dossier opent niet trager
        // omdat er zes relaties geteld moeten worden.
        hasCount: !!t.countSource,
        countSource: t.countSource || null,
      }));
  }

  /**
   * Is dit tabblad bereikbaar voor deze gebruiker? Wordt gebruikt door de
   * routeguard: een directe deeplink naar een verborgen tabblad moet net zo
   * hard weigeren als een verborgen menu-item.
   */
  function tabAllowed(def, tabId, ctx = {}) {
    return tabsFor(def, ctx).some(t => t.id === tabId);
  }

  /**
   * Waar landt een gebruiker die geen recht heeft op het gevraagde tabblad?
   * Het eerste toegestane tabblad · niet de foutpagina, want het RECORD mag
   * hij wel zien. Zonder enig toegestaan tabblad is er niets: null.
   */
  function fallbackTab(def, ctx = {}) {
    const zichtbaar = tabsFor(def, ctx);
    if (!zichtbaar.length) return null;
    const standaard = zichtbaar.find(t => t.id === def.defaultTab);
    return (standaard || zichtbaar[0]).id;
  }

  /** Welke tellingen moeten er geladen worden voor de zichtbare tabbladen? */
  function countSources(def, ctx = {}) {
    return tabsFor(def, ctx).filter(t => t.hasCount).map(t => t.countSource);
  }

  return { tabsFor, tabAllowed, fallbackTab, countSources };
});
