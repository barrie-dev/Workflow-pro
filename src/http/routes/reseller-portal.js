"use strict";
/**
 * Resellerportaal-routes (h23.8-23.13) · CTO3-10 increment 4.
 *
 * Letterlijk verplaatst uit server.js: de handlerbodies zijn ongewijzigd,
 * alleen de inspringing verschilt. Autorisatiecode overtypen is precies hoe
 * je een check kwijtraakt zonder dat een test het merkt.
 *
 * Elke route houdt hetzelfde patroon: actor + assertReseller + de eigen
 * organisatieregel, dan de rechtencheck via reseller-authz VOOR de
 * service-call. Weigeren is altijd een generieke 403 zonder ID-probing.
 */

const ROUTES = [
  // Reseller-portaal: eigen grootboek (read-only, enkel commerciële data).
  {
    path: "/api/reseller/commission",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertReseller, foreignResellerParam, commissionSvc } = ctx;
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller || reseller.status !== "active") return sendJson(res, 403, { ok: false, error: "Reseller-account niet actief" });
      if (foreignResellerParam(res, url, reseller)) return;
      return sendJson(res, 200, { ok: true, ...commissionSvc.ledgerFor(store, reseller.id) });
    },
  },
  // ── Reseller-portaal: enkel commerciële data van EIGEN klanten ─────────────
  // De lijst volgt de koppelingsadministratie (resellerTenantLinks): een
  // ingetrokken of beeindigde koppeling laat de klant meteen verdwijnen ·
  // reseller_id op de tenant alleen is nooit genoeg (23.15). Zie
  // clientsOfReseller in src/modules/resellers.js voor de legacy-regel.
  {
    path: "/api/reseller/clients",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller || reseller.status !== "active") return sendJson(res, 403, { ok: false, error: "Reseller-account niet actief" });
        if (foreignResellerParam(res, url, reseller)) return;
        sendJson(res, 200, { ok: true, reseller: { name: reseller.name, defaultCommissionPct: reseller.defaultCommissionPct }, ...commissionOverview(store, reseller) });
        return;
    },
  },
  // Klant aanbrengen = een TENANTAANVRAAG indienen (23.9), nooit zelf een
  // tenant aanmaken. Het oude gedrag (directe tenant-insert met
  // resellerId = eigen id) was een zelf-koppeling buiten 23.4/23.9 om: geen
  // klantbevestiging, geen Monargo-review, geen assignment-record, geen
  // entitlements-validatie en niet transactioneel. Provisioning blijft een
  // platformactie (/api/admin/reseller-tenant-requests/:id/provision).
  {
    path: "/api/reseller/clients",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller || reseller.status !== "active") return sendJson(res, 403, { ok: false, error: "Reseller-account niet actief" });
        const cu = resellerChannelActor(user);
        if (!resellerPortalAllowed(cu, "reseller.tenants.request", reseller)) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          // resellerId komt NOOIT uit de body: een reseller vraagt alleen voor
          // zichzelf aan (geen cross-reseller attributie, geen bestaans-oracle).
          const row = resellerTenantsSvc.requestTenant(store, { ...body, resellerId: reseller.id }, cu);
          return sendJson(res, 202, {
            ok: true, tenantRequest: row,
            message: "Aanvraag ontvangen · Monargo beoordeelt de aanvraag en bevestigt bij de klant voor de tenant wordt aangemaakt."
          });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  // ── Deals (23.8): registratie, opvolging en indienen ─────────────────────
  {
    path: "/api/reseller/deals",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (!resellerPortalAllowed(cu, "reseller.deals.view", reseller)) return resellerForbidden(res);
        if (foreignResellerParam(res, url, reseller)) return;
        try { return sendJson(res, 200, { ok: true, deals: resellerDealsSvc.listDeals(store, cu, {}) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: "/api/reseller/deals",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (!resellerPortalAllowed(cu, "reseller.deals.create", reseller)) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const deal = resellerDealsSvc.registerDeal(store, body, cu);
          return sendJson(res, 201, { ok: true, deal: resellerDealsSvc.projectDeal(deal, "own") });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/reseller\/deals\/([^/]+)\/transition$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
      const rsDealTransMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (!resellerPortalAllowed(cu, "reseller.deals.create", reseller)) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const deal = resellerDealsSvc.transitionDeal(store, {
            dealId: rsDealTransMatch[1], to: body.to, reason: body.reason || null,
            expectedVersion: body.expectedVersion === undefined ? null : body.expectedVersion
          }, cu);
          return sendJson(res, 200, { ok: true, deal: resellerDealsSvc.projectDeal(deal, "own") });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/reseller\/deals\/([^/]+)$/,
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
      const rsDealMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (!resellerPortalAllowed(cu, "reseller.deals.view", reseller)) return resellerForbidden(res);
        try { return sendJson(res, 200, { ok: true, deal: resellerDealsSvc.getDeal(store, cu, rsDealMatch[1]) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  // ── Tenantaanvragen (23.9): aanvragen, indienen of annuleren ─────────────
  {
    path: "/api/reseller/tenant-requests",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (!resellerPortalAllowed(cu, ["reseller.tenants.request", "reseller.tenants.view"], reseller)) return resellerForbidden(res);
        if (foreignResellerParam(res, url, reseller)) return;
        return sendJson(res, 200, { ok: true, requests: resellerTenantsSvc.listTenantRequests(store, { resellerId: reseller.id }) });
    },
  },
  {
    path: "/api/reseller/tenant-requests",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (!resellerPortalAllowed(cu, "reseller.tenants.request", reseller)) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerTenantsSvc.requestTenant(store, { ...body, resellerId: body.resellerId || reseller.id }, cu);
          return sendJson(res, 201, { ok: true, request: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/reseller\/tenant-requests\/([^/]+)\/transition$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
      const rsTrqTransMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (!resellerPortalAllowed(cu, "reseller.tenants.request", reseller)) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerTenantsSvc.transitionTenantRequest(store, {
            requestId: rsTrqTransMatch[1], to: body.to, reason: body.reason || null,
            expectedVersion: body.expectedVersion === undefined ? null : body.expectedVersion
          }, cu);
          return sendJson(res, 200, { ok: true, request: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  // ── Toegewezen tenants (23.4): uitsluitend commerciele metadata ──────────
  {
    path: "/api/reseller/assigned-tenants",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (!resellerPortalAllowed(cu, "reseller.tenants.view", reseller)) return resellerForbidden(res);
        if (foreignResellerParam(res, url, reseller)) return;
        return sendJson(res, 200, { ok: true, tenants: resellerTenantsSvc.assignedTenants(store, reseller.id) });
    },
  },
  // ── Gedelegeerde toegang (23.12): aanvragen, inzien, afstand doen ────────
  {
    path: "/api/reseller/delegated-access",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return sendJson(res, 400, { ok: false, error: "tenantId is verplicht", code: "TENANT_ID_REQUIRED" });
        if (!resellerPortalAllowed(cu, ["reseller.delegated_admin.use", "reseller.support.view", "reseller.tenants.view"], reseller, tenantId)) {
          return resellerForbidden(res);
        }
        if (foreignResellerParam(res, url, reseller)) return;
        return sendJson(res, 200, { ok: true, grants: resellerTenantsSvc.delegatedAccessFor(store, reseller.id, tenantId) });
    },
  },
  {
    path: "/api/reseller/delegated-access",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        if (!resellerPortalAllowed(cu, "reseller.delegated_admin.use", reseller, body.tenantId || null)) return resellerForbidden(res);
        try {
          // 23.15: iedereen met gedelegeerde tenanttoegang heeft MFA nodig.
          assertResellerMfa(cu, "reseller.delegated_admin.use");
          const row = resellerTenantsSvc.requestDelegatedAccess(store, {
            resellerId: body.resellerId || reseller.id, tenantId: body.tenantId,
            scope: body.scope, reason: body.reason, startAt: body.startAt || null, endAt: body.endAt || null
          }, cu);
          return sendJson(res, 201, { ok: true, grant: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/reseller\/delegated-access\/([^/]+)\/revoke$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
      const rsDlgRevokeMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        // Afstand doen van eigen toegang mag ook onder suspensie (veilige actie).
        if (!resellerPortalAllowed(cu, ["reseller.delegated_admin.use", "reseller.organization.view"], reseller)) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          // 23.15: ook afstand doen van gedelegeerde toegang blijft een handeling
          // op dat toegangsrecord · sterke authenticatie vereist.
          assertResellerMfa(cu, "reseller.delegated_admin.use");
          const row = resellerTenantsSvc.revokeDelegatedAccess(store, { grantId: rsDlgRevokeMatch[1], reason: body.reason }, cu);
          return sendJson(res, 200, { ok: true, grant: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  // ── Licentie-aanvragen (23.10): order/seats/plan/trial/opzegging ─────────
  {
    path: "/api/reseller/license-requests",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (!resellerPortalAllowed(cu, ["reseller.licenses.request", "reseller.organization.view"], reseller)) return resellerForbidden(res);
        if (foreignResellerParam(res, url, reseller)) return;
        return sendJson(res, 200, { ok: true, requests: resellerLicensingSvc.requestsOf(store, reseller.id) });
    },
  },
  {
    path: "/api/reseller/license-requests",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        if (!resellerPortalAllowed(cu, "reseller.licenses.request", reseller, body.tenantId || null)) return resellerForbidden(res);
        try { return sendJson(res, 201, { ok: true, request: createResellerLicenseRequest(body, cu) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/reseller\/license-requests\/([^/]+)\/transition$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
      const rsLicTransMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (!resellerPortalAllowed(cu, "reseller.licenses.request", reseller)) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerLicensingSvc.transitionLicenseRequest(store, { requestId: rsLicTransMatch[1], to: body.to, reason: body.reason || null }, cu);
          return sendJson(res, 200, { ok: true, request: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  // ── Prijsuitzonderingen (23.10): aanvragen en inzien · nooit goedkeuren ──
  {
    path: "/api/reseller/price-exceptions",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (!resellerPortalAllowed(cu, ["reseller.licenses.request", "reseller.organization.view"], reseller)) return resellerForbidden(res);
        if (foreignResellerParam(res, url, reseller)) return;
        return sendJson(res, 200, { ok: true, exceptions: resellerLicensingSvc.exceptionsOf(store, reseller.id) });
    },
  },
  {
    path: "/api/reseller/price-exceptions",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        if (!resellerPortalAllowed(cu, "reseller.licenses.request", reseller, body.tenantId || null)) return resellerForbidden(res);
        try { return sendJson(res, 201, { ok: true, exception: resellerLicensingSvc.priceException(store, body, cu) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  // ── Commissie (23.11): eigen contracten, staten, dispuut en payout ───────
  {
    path: "/api/reseller/commission-agreements",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (!resellerPortalAllowed(cu, "reseller.commissions.view", reseller)) return resellerForbidden(res);
        if (foreignResellerParam(res, url, reseller)) return;
        return sendJson(res, 200, { ok: true, agreements: resellerCommissionSvc.agreementsFor(store, reseller.id) });
    },
  },
  {
    path: "/api/reseller/commission-statements",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (!resellerPortalAllowed(cu, "reseller.commissions.view", reseller)) return resellerForbidden(res);
        if (foreignResellerParam(res, url, reseller)) return;
        return sendJson(res, 200, { ok: true, statements: resellerCommissionSvc.statementsFor(store, reseller.id) });
    },
  },
  {
    path: "/api/reseller/commission-disputes",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (!resellerPortalAllowed(cu, "reseller.commissions.dispute", reseller)) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerCommissionSvc.openDispute(store, {
            statementId: body.statementId || null, eventId: body.eventId || null,
            reason: body.reason, disputedAmount: body.disputedAmount === undefined ? null : body.disputedAmount
          }, cu);
          return sendJson(res, 201, { ok: true, dispute: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: "/api/reseller/payout-changes",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertReseller, resellerChannelActor,
        resellerPortalAllowed, resellerForbidden, foreignResellerParam, armResellerIdempotency,
        sendResellerError, commissionOverview, resellerDealsSvc, resellerTenantsSvc,
        resellerLicensingSvc, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertReseller(user);
        const reseller = store.get("resellers", user.resellerId);
        if (!reseller) return resellerForbidden(res);
        const cu = resellerChannelActor(user);
        if (!resellerPortalAllowed(cu, "reseller.payout.manage", reseller)) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerCommissionSvc.requestPayoutChange(store, {
            resellerId: body.resellerId || reseller.id,
            payout_account: body.payout_account === undefined ? null : body.payout_account,
            payout_currency: body.payout_currency === undefined ? null : body.payout_currency,
            reason: body.reason
          }, cu);
          return sendJson(res, 201, { ok: true, change: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
];

// dispatch() geeft ctx al mee als derde argument · geen wrapper nodig.
module.exports = () => ROUTES;
