"use strict";
/**
 * Pad → routepatroon voor metriek-dimensies (handover 4.7).
 *
 * Vervangt tenant- en record-id's door plaatshouders. Zonder dit groeit het
 * aantal metriekreeksen mee met het aantal klanten en records: met 500 tenants
 * krijg je 500 keer dezelfde reeks, wat een dashboard onbruikbaar en duur maakt.
 * De tenant zit al als eigen dimensie op logs en securityevents.
 *
 * Apart bestand zodat dit testbaar is zonder de server te starten.
 */

function routePattern(pathname) {
  return String(pathname == null ? "" : pathname)
    .replace(/^\/api\/admin\/tenants\/[^/]+/, "/api/admin/tenants/:tenantId")
    .replace(/^\/api\/tenants\/[^/]+/, "/api/tenants/:tenantId")
    // Onze id's zijn ULID-achtig met een prefix (cust_01H..., art_01H...),
    // of lange hexreeksen.
    .replace(/\/[a-z]{2,6}_[0-9A-Za-z]{8,}/g, "/:id")
    .replace(/\/[0-9a-f]{16,}/gi, "/:id")
    .slice(0, 80);
}

module.exports = { routePattern };
