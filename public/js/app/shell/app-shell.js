/* ============================================================
   IA-03 · AppShell (IA handover §7)

   Contract: "Tenant/company context, sidebar, topbar, route outlet,
   global overlays and responsive state."

   De shell is de ENIGE plek die registry (IA-01) en router (IA-02)
   samenbrengt. Rolbestanden leveren straks nog schermen, maar geen
   navigatie of routing meer (D-02).

   Responsive pariteit is een releasevereiste (D-12): desktop, tablet
   en mobiel tonen dezelfde bestemmingen, alleen in een andere vorm.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory(
    typeof require === "function" ? require("./sidebar") : (root && root.wfpShell && root.wfpShell.sidebar)
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpShell = root.wfpShell || {}; root.wfpShell.appShell = api; }
})(typeof window !== "undefined" ? window : null, function (sidebar) {
  "use strict";

  // Breekpunten uit het designsysteem. Eén bron, zodat CSS en JS niet
  // uiteenlopen over wat "mobiel" is.
  const BREAKPOINTS = { mobile: 0, tablet: 768, desktop: 1200 };

  /** Welke weergavemodus hoort bij deze breedte? */
  function modeFor(width) {
    const w = Number(width) || 0;
    if (w >= BREAKPOINTS.desktop) return "desktop";
    if (w >= BREAKPOINTS.tablet) return "tablet";
    return "mobile";
  }

  /**
   * Bereken de volledige shell-toestand voor één render.
   * Puur: zelfde invoer geeft zelfde uitvoer, dus testbaar zonder DOM.
   *
   * @param {object} o {
   *   tree,            opgeloste navigatie (IA-01)
   *   route,           geparste route (IA-02) of null
   *   width,           viewportbreedte
   *   tenant,          { id, name, companyName }
   *   supportSession,  { active, tenantId } · toont de geauditeerde banner
   *   badges,          { [badgeSource]: aantal }
   * }
   */
  function shellState(o = {}) {
    const mode = modeFor(o.width);
    const tree = o.tree || [];
    const activeId = o.route ? o.route.id : null;
    const { tabs, more } = sidebar.mobileTabs(tree);

    return {
      mode,
      activeId,
      // Op mobiel is de zijbalk standaard dicht; op desktop altijd zichtbaar.
      sidebarVisible: mode === "desktop",
      sidebarCollapsible: mode !== "desktop",
      // Onderbalk alleen op mobiel · desktop/tablet gebruiken de zijbalk.
      bottomTabs: mode === "mobile" ? tabs.map(d => d.id) : [],
      moreMenuIds: mode === "mobile" ? more.map(d => d.id) : [],
      tenant: {
        id: (o.tenant && o.tenant.id) || null,
        name: (o.tenant && o.tenant.name) || null,
        companyName: (o.tenant && o.tenant.companyName) || null,
      },
      // Support-impersonatie MOET zichtbaar zijn (§6 · geauditeerde banner).
      supportBanner: !!(o.supportSession && o.supportSession.active),
      // De outlet is waar de route zijn scherm rendert.
      outletId: "app-outlet",
      badges: o.badges || {},
    };
  }

  /** Render de zijbalk voor de huidige toestand. */
  function renderNav(tree, state, t) {
    return sidebar.renderSidebar(tree, { activeId: state.activeId, t, badges: state.badges });
  }

  /**
   * Alle bestemmingen zijn op ELKE modus bereikbaar (D-12 · pariteit).
   * Op mobiel via tabs + 'meer', op desktop via de zijbalk. Deze functie
   * bewijst dat er niets wegvalt.
   */
  function reachableIds(tree, state) {
    if (state.mode !== "mobile") return (tree || []).map(d => d.id);
    return [...state.bottomTabs, ...state.moreMenuIds];
  }

  return { BREAKPOINTS, modeFor, shellState, renderNav, reachableIds };
});
