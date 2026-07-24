/* ============================================================
   IA-runtime · Router (IA handover §6)

   Hier houdt de contractlaag op abstract te zijn. Dit bestand koppelt
   het routemodel (IA-02), de guards (IA-02), de registry (IA-01) en de
   shell (IA-03) aan de echte browser.

   STRANGLER (D-11). De schermen leven vandaag nog in admin.js en worden
   getekend door switchView(). Die functie blijft de renderer; de router
   neemt alleen over WIE bepaalt welk scherm getoond wordt en WAT er in de
   adresbalk staat. Zo wint de gebruiker meteen wat de handover vraagt -
   deelbare links, werkende terugknop, veilige refresh - zonder dat er één
   scherm herschreven hoeft te worden.

   Pas als een scherm naar een eigen werkruimtebestand verhuist, neemt de
   router ook het tekenen over. Tot die tijd is dit een dunne laag boven
   de monoliet, en dat is precies de bedoeling.

   Dit is het enige bestand in public/js/app/ dat de DOM en history mag
   aanraken. De rest blijft puur; daar is de architectuurtest streng op.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory(
    typeof require === "function" ? require("../navigation/route-map") : (root.wfpNav && root.wfpNav.routeMap),
    typeof require === "function" ? require("./guards") : (root.wfpNav && root.wfpNav.guards)
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpRouting = root.wfpRouting || {}; root.wfpRouting.router = api; }
})(typeof window !== "undefined" ? window : null, function (routeMap, guards) {
  "use strict";

  /**
   * Van registry-id naar de oude data-view die admin.js kent.
   *
   * Dit is de brug, en ze is bewust expliciet: elke regel is een scherm
   * dat nog niet gemigreerd is. Naarmate schermen verhuizen, krimpt deze
   * tabel. Staat een route er niet in, dan is er nog niets om te tonen en
   * zegt de router dat eerlijk in plaats van een leeg scherm te tekenen.
   */
  const LEGACY_VIEW_BY_ROUTE = {
    "customers": "customers",
    "customers.contacts": "customers",
    "customers.locations": "venues",
    "customers.requests": "inbox",
    "sales": "offertes",
    "sales.pipeline": "offertes",
    "sales.quotes": "offertes",
    "sales.contracts": "contracts",
    "sales.catalogue": "catalog",
    "projects": "projects",
    "projects.active": "projects",
    "projects.worksites": "worksites",
    "planning": "planning",
    "planning.calendar": "planning",
    "planning.unassigned": "appointments",
    "work-orders": "workorders",
    "work-orders.open": "workorders",
    "work-orders.review": "workos",
    "team": "employees",
    "team.people": "employees",
    "team.time": "clocking",
    "team.leave": "leaves",
    "team.expenses": "expenses",
    "team.safety": "incidents",
    "finance": "facturen",
    "finance.invoices": "facturen",
    "finance.payments": "payments",
    "finance.purchase": "purchasing",
    "finance.peppol": "facturen",
    "finance.progress-claims": "progress-claims",
    "resources": "stock",
    "resources.stock": "stock",
    "resources.fleet": "vehicles",
    "resources.assets": "assets",
    "insights": "reports",
    "insights.reports": "reports",
    "insights.capacity": "portfolio",
    "automation": "integrations",
    "automation.forms": "workos",
    "automation.workflows": "integrations",
    "automation.integrations": "integrations",
    "automation.fields": "integrations",
  };

  const state = { mounted: false, current: null, onRender: null, ctx: null, telemetry: null };

  function legacyViewFor(routeId) {
    return LEGACY_VIEW_BY_ROUTE[routeId] || null;
  }

  /** De omgekeerde richting: welke IA-route hoort bij een oude data-view? */
  function routeIdForLegacyView(view) {
    for (const [routeId, legacy] of Object.entries(LEGACY_VIEW_BY_ROUTE)) {
      if (legacy === view && !routeId.includes(".")) return routeId;
    }
    for (const [routeId, legacy] of Object.entries(LEGACY_VIEW_BY_ROUTE)) {
      if (legacy === view) return routeId;
    }
    return null;
  }

  /**
   * Bepaal wat er moet gebeuren voor een gegeven URL. PUUR · geen DOM,
   * geen history. Dit is het deel dat te testen valt zonder browser.
   *
   * @returns {{ action, route?, view?, code?, url? }}
   *   action "render"   · toon dit scherm
   *          "redirect" · stuur door naar deze URL (legacy of fallback)
   *          "deny"     · weiger, met code
   *          "notfound" · onbekende route
   */
  function resolve(pathname, search, ctx = {}) {
    const url = search ? `${pathname}${search}` : pathname;
    const route = routeMap.parse(url);

    if (!route) {
      // Misschien is het een oude data-view die nog rondslingert in een
      // bookmark of een e-mail · die leiden we om in plaats van te weigeren.
      const legacy = (ctx.legacyView || "").trim();
      if (legacy) {
        const doel = routeMap.legacyRedirect(legacy, { recordId: ctx.recordId, query: ctx.query });
        if (doel) return { action: "redirect", url: doel, reason: "LEGACY_VIEW" };
      }
      return { action: "notfound", code: "ROUTE_NOT_FOUND" };
    }

    const beslissing = guards.canEnter(route, ctx);
    if (!beslissing.ok) return { action: "deny", code: beslissing.code, route };

    const view = legacyViewFor(route.id);
    if (!view) return { action: "notfound", code: "NO_RENDERER", route };

    // Een deeplink naar een RECORD kan al iets nuttigs doen zolang de
    // recordwerkruimte nog niet bestaat: de domeinlijst openen en het
    // bestaande detailpaneel erbij. Beter dan de gebruiker op een lijst
    // achterlaten waar hij zijn record zelf mag terugzoeken.
    const record = route.kind === "record" ? recordFor(route) : null;
    return { action: "render", route, view, record };
  }

  /** Welke drawer hoort bij dit recordpad, en met welk id? */
  const DRAWER_BY_ROUTE = {
    customers: "customer", "customers.locations": "venue", "customers.requests": "inquiry",
    sales: "offerte", "sales.quotes": "offerte",
    projects: "project", "projects.worksites": "worksite",
    "planning.unassigned": "appointment",
    "work-orders": "workorder",
    team: "employee", "team.people": "employee", "team.safety": "incident",
    finance: "factuur", "finance.invoices": "factuur",
    "resources.stock": "stock", "resources.fleet": "vehicle",
  };

  function recordFor(route) {
    const drawer = DRAWER_BY_ROUTE[route.id];
    const id = route.params && Object.values(route.params)[0];
    return drawer && id ? { drawer, id, tab: (route.params && route.params.tab) || null } : null;
  }

  // ── Vanaf hier raakt het de browser ────────────────────────────────────────

  function currentUrl() {
    return typeof location === "undefined" ? "/" : location.pathname + location.search;
  }

  /**
   * Navigeer naar een registry-route. Dit is de enige manier waarop de app
   * van scherm wisselt; alles loopt hierlangs zodat de adresbalk, de
   * geschiedenis en het scherm nooit uiteen kunnen lopen.
   */
  function navigate(routeId, params, query, opts = {}) {
    const url = routeMap.build(routeId, params, query);
    if (!url) return false;
    return navigateUrl(url, opts);
  }

  function navigateUrl(url, opts = {}) {
    if (typeof history === "undefined") return false;
    if (url === currentUrl() && !opts.force) return true;

    // Onopgeslagen wijzigingen: pas waarschuwen bij ECHTE wijzigingen (IA-02).
    const guard = state.ctx && state.ctx.unsavedGuard;
    if (guard && !opts.skipUnsavedCheck) {
      const check = guard.beforeLeave();
      if (check.block && !opts.confirmed) return { blocked: true, reason: check.reason };
    }

    if (opts.replace) history.replaceState({ ia: true }, "", url);
    else history.pushState({ ia: true }, "", url);
    render(opts.source || "click");
    return true;
  }

  /** Teken het scherm dat bij de huidige URL hoort. */
  function render(source) {
    const start = typeof performance !== "undefined" ? performance.now() : 0;
    const uitkomst = resolve(
      typeof location === "undefined" ? "/" : location.pathname,
      typeof location === "undefined" ? "" : location.search,
      state.ctx || {}
    );

    if (uitkomst.action === "redirect") { navigateUrl(uitkomst.url, { replace: true, source: "legacy" }); return uitkomst; }
    state.current = uitkomst.route || null;

    if (typeof state.onRender === "function") state.onRender(uitkomst);

    if (uitkomst.action === "render" && typeof state.telemetry === "function") {
      const duur = typeof performance !== "undefined" ? performance.now() - start : 0;
      state.telemetry(guards.navigationTelemetry({
        routeId: uitkomst.route.id,
        portal: (state.ctx && state.ctx.portal) || null,
        tenantHash: (state.ctx && state.ctx.tenantHash) || null,
        source: source || "load",
        durationMs: duur,
      }));
    }
    return uitkomst;
  }

  /**
   * Start de router.
   *
   * @param {object} o {
   *   ctx        · rechten, entitlements, tenant · zoals guards.canEnter verwacht
   *   onRender   · krijgt de uitkomst en tekent · in de strangler-fase is dat
   *                een aanroep van switchView()
   *   telemetry  · optioneel, krijgt navigatie-events
   *   homeRoute  · waar / naartoe gaat
   * }
   */
  function mount(o = {}) {
    if (state.mounted) return state;
    state.ctx = o.ctx || {};
    state.onRender = o.onRender || null;
    state.telemetry = o.telemetry || null;
    state.mounted = true;

    if (typeof window !== "undefined") {
      window.addEventListener("popstate", () => render("history"));
      // Elke link naar /app/... loopt via de router · zo blijft de shell staan
      // en verliest de gebruiker zijn scrollpositie en zijn sessie-state niet
      // door een volledige pagina-herlaad.
      document.addEventListener("click", e => {
        const a = e.target && e.target.closest && e.target.closest("a[href^='/app/']");
        if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        navigateUrl(a.getAttribute("href"), { source: "click" });
      });
    }

    // Landen op / betekent naar de startbestemming, met replace zodat de
    // terugknop niet in een lus belandt.
    if (typeof location !== "undefined" && location.pathname === "/" && o.homeRoute) {
      const url = routeMap.build(o.homeRoute, {}, {});
      if (url) { history.replaceState({ ia: true }, "", url); }
    }
    render("load");
    return state;
  }

  function updateContext(patch) {
    state.ctx = { ...(state.ctx || {}), ...(patch || {}) };
  }

  function currentRoute() { return state.current; }

  return {
    LEGACY_VIEW_BY_ROUTE,
    legacyViewFor, routeIdForLegacyView, resolve,
    DRAWER_BY_ROUTE, recordFor,
    mount, navigate, navigateUrl, render, updateContext, currentRoute,
    _state: state,
  };
});
