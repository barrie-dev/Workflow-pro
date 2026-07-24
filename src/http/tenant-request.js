"use strict";
/**
 * Gedeelde preambule voor elke /api/tenants/:tenantId/<actie>-route (CTO3-10).
 *
 * In server.js staat deze reeks controles ÉÉN keer, bovenaan een if-blok met
 * 238 acties eronder. Dat is precies waarom die 238 acties niet los te trekken
 * waren: wie er één uit tilt, tilt de beveiliging niet mee.
 *
 * Deze module maakt die preambule herbruikbaar. De volgorde is LETTERLIJK
 * dezelfde als in server.js en dat is geen toeval:
 *
 *   1. authenticatie      · geen sessie, geen verder verhaal
 *   2. MFA voor beheerders
 *   3. tenantlidmaatschap · vóór de tenant-lookup, zodat een vreemde tenant
 *                           niet via een 404-vs-403-verschil te ontdekken is
 *   4. bestaat de tenant
 *   5. API-sleutel mag schrijven
 *   6. module vrijgegeven (entitlement)
 *   7. gebruiker is niet read-only
 *   8. proefperiode niet verlopen
 *   9. idempotentie: herhaalde mutatie geeft de eerdere response terug
 *
 * Elke stap die je hier weglaat, valt weg voor ELKE route die deze helper
 * gebruikt. Daarom staat de volgorde ook in de test vastgelegd.
 */

/**
 * @returns {{ok:true, user, tenantId, tenant, action}} als de route door mag,
 *          of {ok:false} wanneer er al een antwoord verstuurd is.
 *
 * Gooit dezelfde fouten als voorheen · de bestaande handleError vangt ze op.
 */
function resolveTenantRequest(req, res, url, ctx, action) {
  const {
    store, sendJson, actor, assertAdminMfa, assertTenant, assertApiKeyWriteAllowed,
    assertModuleEnabled, assertNotReadOnly, assertTrialActive, idempotency,
  } = ctx;

  const m = url.pathname.match(/^\/api\/tenants\/([^/]+)\/(.+)$/);
  if (!m) return { ok: false };
  const tenantId = m[1];
  const actie = action || m[2];

  const user = actor(req);
  if (!user) { sendJson(res, 401, { ok: false, error: "Unauthorized" }); return { ok: false }; }
  assertAdminMfa(user);
  assertTenant(user, tenantId);
  const tenant = store.data.tenants.find(t => t.id === tenantId);
  if (!tenant) { sendJson(res, 404, { ok: false, error: "Tenant not found" }); return { ok: false }; }
  assertApiKeyWriteAllowed(user, req);
  // Entitlement-handhaving: gated modules die niet in het pakket zitten → 403.
  assertModuleEnabled(store, user, tenant, actie);
  // Alleen-lezen-handhaving: read:X-gebruikers kunnen niets muteren.
  assertNotReadOnly(user, actie, req.method);
  // Trial-to-paid-handhaving: verlopen proef (na respijt) blokkeert muteren.
  assertTrialActive(user, tenant, actie, req.method);

  // ── Idempotency-Key (h41): herhaalde mutatie met dezelfde sleutel
  //    creëert geen duplicaat maar krijgt de eerdere response terug ──
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    const idemKey = idempotency.idempotencyKeyFrom(req);
    if (idemKey) {
      const cacheKey = idempotency.cacheKeyFor({ tenantId, actorId: user.id, method: req.method, path: url.pathname, key: idemKey });
      const replay = idempotency.findReplay(store, cacheKey);
      if (replay) {
        // Een via /v1 vastgelegde response is al v1-getransformeerd; de
        // hook moet uit, anders zouden centen dubbel geconverteerd worden.
        res.wfpV1 = null;
        sendJson(res, replay.status, JSON.parse(replay.body), { "Idempotency-Replayed": "true" });
        return { ok: false };
      }
      // Arm de response: sendJson legt een 2xx-resultaat vast onder deze sleutel.
      res.wfpIdem = { store, cacheKey };
    }
  }

  return { ok: true, user, tenantId, tenant, action: actie };
}

/**
 * Maak een routepad voor één tenant-actie.
 * De actie staat als LETTERLIJKE tekst in de regex: geen jokertekens, zodat
 * een nieuwe actie nooit per ongeluk door een bestaande route wordt gevangen.
 */
function tenantActionPath(action) {
  return new RegExp(`^/api/tenants/([^/]+)/${action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

/**
 * Bouw een routedefinitie voor één tenant-actie. De handler krijgt de
 * opgeloste context mee, zodat hij nooit zelf hoeft te authenticeren · en dus
 * ook niet kan vergeten het te doen.
 */
function tenantRoute(action, method, handler) {
  return {
    path: tenantActionPath(action),
    method: Array.isArray(method) ? method : [method],
    async handler(req, res, arg) {
      const c = resolveTenantRequest(req, res, arg.url, arg.ctx, action);
      if (!c.ok) return;
      await handler(req, res, { ...arg, ...c });
    },
  };
}

module.exports = { resolveTenantRequest, tenantActionPath, tenantRoute };
