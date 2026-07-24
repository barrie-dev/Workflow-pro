/* ============================================================
   IA-runtime · Bootstrap (strangler-koppeling)

   Dit is de enige plek waar de nieuwe IA-laag en de oude admin-monoliet
   elkaar kennen. Bewust één bestand, bewust klein.

   Wat het doet:
     · leest de navigatiecontext (rechten, entitlements, portaal, tenant);
     · lost de navigatieboom op uit de registry;
     · start de router en laat die switchView() aansturen;
     · zet de adresbalk bij elke schermwissel, ook als die nog via het oude
       menu gebeurt.

   Wat het NIET doet: schermen tekenen. Dat blijft admin.js tot een scherm
   naar zijn eigen werkruimtebestand verhuist.

   Vlag: window.WFP_IA_ROUTER. Standaard AAN, maar uitzetbaar zonder deploy
   (localStorage `wfp_ia_router=off`). Een migratie zonder terugweg is geen
   migratie maar een sprong · IA-22 vraagt daar expliciet om.
   ============================================================ */
(function () {
  "use strict";

  const A = window.wfpAdmin;
  if (!A) return;

  function routerEnabled() {
    try {
      if (localStorage.getItem("wfp_ia_router") === "off") return false;
    } catch (_) { /* private mode · dan gewoon aan */ }
    return window.WFP_IA_ROUTER !== false;
  }

  /** Hash de tenant voor telemetrie · nooit het echte id in een event. */
  function tenantHash(tenantId) {
    if (!tenantId) return null;
    let h = 0;
    for (let i = 0; i < tenantId.length; i += 1) h = (h * 31 + tenantId.charCodeAt(i)) | 0;
    return "t#" + Math.abs(h).toString(16).padStart(8, "0");
  }

  /**
   * Bouw de context die de guards en de resolver verwachten uit wat de app
   * al weet. Fail-closed: onbekend betekent geen rechten, geen modules.
   */
  function buildContext() {
    const user = window._wfpCurrentUser || {};
    const ent = window._wfpEnt || null;
    const nav = window.wfpNav || {};
    const ad = nav.contextAdapter;
    // De app spreekt een ander rechten-vocabulaire dan de registry · de
    // adapter vertaalt, en houdt zichtbaar wat er nog niet vertaald is.
    const appPerms = Array.isArray(user.permissions) ? user.permissions
      : user.role === "super_admin" ? ["*"] : [];
    const appViews = !ent ? [] : ent.views;
    const allEnt = (nav.registry && nav.registry.ALL_ENTITLEMENTS) || [];
    return {
      portal: ad ? ad.portal(user.role) : "employee",
      permissions: ad ? ad.permissions(appPerms) : [],
      entitlements: ad ? ad.entitlements(appViews, allEnt) : [],
      tenantId: user.tenantId || null,
      tenantHash: tenantHash(user.tenantId),
      supportSession: window._wfpSupportSession || null,
      unsavedGuard: nav.guards ? nav.guards.createUnsavedGuard() : null,
    };
  }

  /**
   * De verzameling routes die deze gebruiker mag openen. De guard gebruikt
   * hem om een deeplink net zo hard te weigeren als een verborgen menu-item.
   */
  function allowedRouteIds(ctx) {
    const nav = window.wfpNav;
    if (!nav || !nav.registry || !nav.resolver) return { tree: [], ids: [] };
    const tree = nav.resolver.resolve(nav.registry.ENTRIES, {
      portal: ctx.portal,
      permissions: ctx.permissions,
      entitlements: ctx.entitlements,
    });
    return { tree, ids: nav.resolver.flatten(tree).map(r => r.id) };
  }

  function start() {
    if (!routerEnabled()) return;
    const router = window.wfpRouting && window.wfpRouting.router;
    if (!router || !A.switchView) return;

    const ctx = buildContext();
    const nav = allowedRouteIds(ctx);
    ctx.allowedRouteIds = nav.ids || [];

    router.mount({
      ctx,
      homeRoute: null, // de app start op het dashboard · dat is nog geen IA-route
      onRender(uitkomst) {
        if (uitkomst.action === "render") {
          // De monoliet tekent nog · de router bepaalt alleen WAT.
          A.switchView(uitkomst.view);
          openRecordDrawer(uitkomst.record);
          return;
        }
        if (uitkomst.action === "deny" || uitkomst.action === "notfound") {
          // Byte-identieke weigering: de gebruiker leert niet of het record
          // bestaat of dat hij er alleen niet bij mag (IA-02).
          A.switchView("dashboard");
        }
      },
      telemetry(event) {
        if (window.wfpTelemetry && typeof window.wfpTelemetry.track === "function") {
          window.wfpTelemetry.track(event);
        }
      },
    });

    syncUrlOnLegacyNav(router);
  }

  /**
   * Een deeplink naar een record opent het bestaande detailpaneel.
   *
   * De recordwerkruimtes uit de handover bestaan nog niet, maar de drawers
   * wel · dan is de gebruiker beter af met zijn record open dan met een
   * lijst waarin hij het zelf mag terugzoeken. Bestaat de drawer niet, dan
   * gebeurt er niets: de lijst staat er al, dat is geen fout.
   *
   * Kleine vertraging omdat switchView eerst zijn lijst moet laden; zonder
   * data heeft het paneel niets om te tonen.
   */
  function openRecordDrawer(record) {
    if (!record || !A.drawers) return;
    const open = A.drawers[record.drawer];
    if (typeof open !== "function") return;
    setTimeout(() => { try { open(record.id); } catch (_) { /* lijst blijft staan */ } }, 250);
  }

  /**
   * Het oude menu blijft werken en houdt de adresbalk bij.
   *
   * Waarom een observer en geen wrapper om A.switchView: de menuklikken in
   * admin.js roepen de LOKALE switchView aan, niet de geëxporteerde. Een
   * wrapper zou dus precies de belangrijkste helft missen en dat pas laat
   * opvallen. switchView zet wél altijd data-view op #admMain · dat is een
   * signaal dat elke aanroep afgeeft, van binnen én van buiten.
   *
   * Zo krijgt de gebruiker deelbare links zonder dat er één menu-item
   * verbouwd is en zonder één regel wijziging in de monoliet.
   */
  function syncUrlOnLegacyNav(router) {
    const main = document.getElementById("admMain");
    if (!main || typeof MutationObserver === "undefined") return;
    let vorige = main.getAttribute("data-view");
    new MutationObserver(() => {
      const view = main.getAttribute("data-view");
      if (!view || view === vorige) return;
      vorige = view;

      // Toont de HUIDIGE url dit scherm al? Dan niets doen.
      //
      // Dit is geen detail. De router tekent zelf ook via switchView, en
      // meerdere routes leiden naar hetzelfde scherm: /app/finance en
      // /app/finance/invoices tonen allebei de facturenlijst. Zonder deze
      // check duwt de observer er een tweede geschiedenisstap bij, en moet
      // de gebruiker twee keer op terug drukken om één stap te zetten.
      const huidig = window.wfpNav.routeMap.parse(location.pathname);
      if (huidig && router.legacyViewFor(huidig.id) === view) return;

      const routeId = router.routeIdForLegacyView(view);
      const url = routeId && window.wfpNav.routeMap.build(routeId, {}, {});
      if (url && location.pathname !== url) history.pushState({ ia: true }, "", url);
    }).observe(main, { attributes: true, attributeFilter: ["data-view"] });
  }

  /**
   * Wacht tot de ADMIN-SHELL bestaat, niet tot de pagina geladen is.
   *
   * Het verschil is wezenlijk: bij het laden staat er nog een inlogscherm.
   * De shell verschijnt pas ná authenticatie, en pas dan bestaan #admMain,
   * de gebruikerscontext en de views. Te vroeg starten levert een router op
   * die netjes de juiste route berekent en vervolgens niets kan tekenen ·
   * precies het soort fout dat er in de code goed uitziet.
   *
   * Geen eindeloos wachten: na tien seconden stopt de poging. Een gebruiker
   * die niet inlogt hoort geen timer te houden.
   */
  function whenShellReady(fn) {
    const deadline = Date.now() + 10000;
    const timer = setInterval(() => {
      // data-view staat er pas ZODRA admin zijn eerste switchView heeft
      // gedaan. Wachten we daar niet op, dan mounten we ertussenin en
      // overschrijft de dashboard-render van admin meteen onze route.
      const main = document.getElementById("admMain");
      const gereed = main && main.getAttribute("data-view")
        && window.wfpAdmin && typeof window.wfpAdmin.switchView === "function"
        && window._wfpCurrentUser;
      if (gereed) { clearInterval(timer); fn(); return; }
      if (Date.now() > deadline) clearInterval(timer);
    }, 120);
  }

  whenShellReady(start);
})();
