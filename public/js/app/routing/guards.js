/* ============================================================
   IA-02 · Route guards (IA handover §6)

   Poortwachters die VOOR elke navigatie draaien. Alles faalt
   dicht: bij twijfel weigeren, nooit doorlaten.

   Eisen uit §6:
     - Tenant safety · een route met een record van een andere
       tenant geeft een GENERIEKE weigering zonder te verraden of
       dat record bestaat (geen existence leak);
     - Refresh safety · een onbekende of niet-toegestane route
       geeft een permission-safe not-found, geen crash;
     - Unsaved edits · waarschuw ALLEEN bij echte wijzigingen; een
       geslaagde save wist de guard;
     - Support session · de route blijft binnen de gedelegeerde
       tenant en toont de geauditeerde supportbanner;
     - Route telemetry · registry-id, portaal, tenant, bron en duur.
       NOOIT gevoelige inhoud.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpNav = root.wfpNav || {}; root.wfpNav.guards = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  // Eén vaste weigering. Byte-identiek voor "bestaat niet" en "mag niet",
  // zodat de body nooit verraadt welk van de twee het is.
  const DENIED = Object.freeze({ ok: false, code: "ROUTE_DENIED", message: "Geen toegang" });
  const NOT_FOUND = Object.freeze({ ok: false, code: "ROUTE_NOT_FOUND", message: "Niet gevonden" });
  const ALLOWED = Object.freeze({ ok: true });

  /**
   * Mag deze route betreden worden?
   * @param {object|null} route  uitkomst van routeMap.parse()
   * @param {object} ctx {
   *   tenantId,            de tenant waarin de gebruiker werkt
   *   routeTenantId,       tenant van het gevraagde record (indien bekend)
   *   allowedRouteIds,     Set/array van registry-ids die deze gebruiker mag zien
   *   supportSession       { active, tenantId } bij gedelegeerde toegang
   * }
   */
  function canEnter(route, ctx = {}) {
    if (!route || !route.id) return NOT_FOUND;

    // 1. Tenantveiligheid gaat VOOR rechten: een vreemd record mag nooit
    //    bevestigd worden, ook niet met de juiste rechten.
    const recordTenant = ctx.routeTenantId;
    if (recordTenant && ctx.tenantId && recordTenant !== ctx.tenantId) return DENIED;

    // 2. Supportsessie blijft binnen de gedelegeerde tenant.
    const s = ctx.supportSession;
    if (s && s.active) {
      if (!s.tenantId || (ctx.tenantId && s.tenantId !== ctx.tenantId)) return DENIED;
    }

    // 3. Rechten: de route moet in de opgeloste navigatie van deze gebruiker
    //    zitten. Onbekend = weigeren (fail-closed).
    const allowed = ctx.allowedRouteIds instanceof Set
      ? ctx.allowedRouteIds
      : new Set(Array.isArray(ctx.allowedRouteIds) ? ctx.allowedRouteIds : []);
    if (!allowed.has(route.id)) return DENIED;

    return ALLOWED;
  }

  /**
   * Onopgeslagen wijzigingen. Waarschuwt ALLEEN wanneer er echt iets veranderd
   * is · een guard die altijd waarschuwt leert gebruikers hem weg te klikken.
   */
  function createUnsavedGuard() {
    let dirty = false;
    return {
      markDirty() { dirty = true; },
      markSaved() { dirty = false; },      // geslaagde save wist de guard
      isDirty() { return dirty; },
      /** @returns {{block:boolean, reason?:string}} */
      beforeLeave() {
        return dirty
          ? { block: true, reason: "UNSAVED_CHANGES" }
          : { block: false };
      },
    };
  }

  /**
   * Bouw een telemetrieregel voor een navigatie. Draagt UITSLUITEND
   * identifiers en meetwaarden · nooit record-inhoud, namen of filters.
   */
  function navigationTelemetry({ routeId, portal, tenantHash, source, durationMs } = {}) {
    return {
      event: "navigation",
      routeId: routeId || null,        // registry-id, niet het label
      portal: portal || null,
      tenant: tenantHash || null,      // gehasht · nooit het tenant-id zelf
      source: source || "unknown",     // sidebar | palette | deep-link | redirect
      durationMs: Number.isFinite(durationMs) ? Math.round(durationMs) : null,
    };
  }

  return { DENIED, NOT_FOUND, ALLOWED, canEnter, createUnsavedGuard, navigationTelemetry };
});
