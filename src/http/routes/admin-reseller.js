"use strict";
/**
 * Monargo-zijde van het kanaaldomein (/api/admin/reseller-*, h23.8-23.15).
 *
 * Letterlijk verplaatst uit server.js (CTO3-10): de handlerbodies zijn
 * ongewijzigd, alleen de inspringing verschilt. Autorisatiecode overtypen is
 * precies hoe je een check kwijtraakt zonder dat een test het merkt.
 *
 * Wat elke handler uit ctx haalt, is AFGELEID uit zijn eigen body · zo kan er
 * geen naam vergeten worden en blijft zichtbaar waar een route van afhangt.
 */

const ROUTES = [
  // ── Reseller-payouts (superadmin): commissie verschuldigd + CSV-export ────
  {
    path: "/api/admin/reseller-payouts",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, resellerPayouts, commissionOverview } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const payouts = resellerPayouts(store, commissionOverview);
        if (url.searchParams.get("format") === "csv") {
          const head = "reseller,contact,clients,mrr,commissie_maand";
          const lines = payouts.rows.map(r => [r.reseller, r.contactEmail, r.clients, r.mrr, r.commissionMonthly].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
          res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"reseller-payouts.csv\"" });
          res.end([head, ...lines].join("\n"));
          return;
        }
        sendJson(res, 200, { ok: true, ...payouts });
        return;
    },
  },
  // ── Deals (23.8) · beoordeling, attributie, conversie ────────────────────
  {
    path: "/api/admin/reseller-deals",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, sendResellerError, resellerAuthz, resellerDealsSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.deals.view", {})) return resellerForbidden(res);
        try { return sendJson(res, 200, { ok: true, deals: resellerDealsSvc.listDeals(store, cu, { resellerId: url.searchParams.get("resellerId") || null }) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: "/api/admin/reseller-deals",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerDealsSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.deals.create", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try { return sendJson(res, 201, { ok: true, deal: resellerDealsSvc.registerDeal(store, body, cu) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: "/api/admin/reseller-deals/expire",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, sendResellerError, resellerAuthz, resellerDealsSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.deals.approve", {})) return resellerForbidden(res);
        try { return sendJson(res, 200, { ok: true, ...resellerDealsSvc.expireDeals(store) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-deals\/([^/]+)\/transition$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerDealsSvc } = ctx;
      const admDealTransMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.deals.approve", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const deal = resellerDealsSvc.transitionDeal(store, {
            dealId: admDealTransMatch[1], to: body.to, reason: body.reason || null,
            expectedVersion: body.expectedVersion === undefined ? null : body.expectedVersion
          }, cu);
          return sendJson(res, 200, { ok: true, deal });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-deals\/([^/]+)\/attribution$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerDealsSvc } = ctx;
      const admDealAttrMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.deals.approve", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const deal = resellerDealsSvc.setAttribution(store, {
            dealId: admDealAttrMatch[1], attributionPercent: body.attributionPercent,
            reason: body.reason || null,
            expectedVersion: body.expectedVersion === undefined ? null : body.expectedVersion
          }, cu);
          return sendJson(res, 200, { ok: true, deal });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-deals\/([^/]+)\/convert$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerDealsSvc } = ctx;
      const admDealConvertMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.deals.approve", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const deal = resellerDealsSvc.convertDeal(store, {
            dealId: admDealConvertMatch[1], customerId: body.customerId, tenantId: body.tenantId,
            subscriptionId: body.subscriptionId || null, reason: body.reason || null,
            expectedVersion: body.expectedVersion === undefined ? null : body.expectedVersion
          }, cu);
          return sendJson(res, 200, { ok: true, deal });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-deals\/([^/]+)$/,
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, sendResellerError, resellerAuthz, resellerDealsSvc } = ctx;
      const admDealMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.deals.view", {})) return resellerForbidden(res);
        try { return sendJson(res, 200, { ok: true, deal: resellerDealsSvc.getDeal(store, cu, admDealMatch[1]) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  // ── Tenantaanvragen (23.9) · beoordeling en transactionele provisioning ──
  {
    path: "/api/admin/reseller-tenant-requests",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, resellerAuthz, resellerTenantsSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.view", {})) return resellerForbidden(res);
        return sendJson(res, 200, { ok: true, requests: resellerTenantsSvc.listTenantRequests(store, { resellerId: url.searchParams.get("resellerId") || null }) });
    },
  },
  {
    path: /^\/api\/admin\/reseller-tenant-requests\/([^/]+)\/transition$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerTenantsSvc } = ctx;
      const admTrqTransMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.request", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerTenantsSvc.transitionTenantRequest(store, {
            requestId: admTrqTransMatch[1], to: body.to, reason: body.reason || null,
            expectedVersion: body.expectedVersion === undefined ? null : body.expectedVersion
          }, cu);
          return sendJson(res, 200, { ok: true, request: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-tenant-requests\/([^/]+)\/provision$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, config, actor, assertPlatformScope,
        monargoChannelActor, resellerForbidden, armResellerIdempotency, sendResellerError,
        resellerAuthz, resellerTenantsSvc, activationToken, isMailLive } = ctx;
      const admTrqProvisionMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.request", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const result = resellerTenantsSvc.provisionTenant(store, {
            requestId: admTrqProvisionMatch[1], tenantId: body.tenantId || null,
            adminEmail: body.adminEmail || null, adminName: body.adminName || null,
            commissionPct: typeof body.commissionPct === "number" ? body.commissionPct : null
          }, cu);
          // Zelfde beleid als provisionPendingUser: het activatietoken komt
          // NOOIT in een respons zodra er echte mail of productie in het spel is.
          const activationLink = (config.isProduction || isMailLive())
            ? null
            : `${config.appUrl}/?activate=${encodeURIComponent(result.activationToken)}`;
          return sendJson(res, 201, { ok: true, tenant: result.tenant, link: result.link, adminUser: result.adminUser, request: result.request, activationLink });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  // ── Tenantkoppelingen (23.4/23.9/23.15) · assignment-records ─────────────
  {
    path: "/api/admin/reseller-tenant-links",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, resellerAuthz } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.view", {})) return resellerForbidden(res);
        const rid = url.searchParams.get("resellerId");
        const links = resellerTenantsSvc.listTenantLinks(store, { resellerId: rid });
        return sendJson(res, 200, { ok: true, links });
    },
  },
  {
    path: "/api/admin/reseller-tenant-links",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerTenantsSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.request", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerTenantsSvc.linkTenant(store, {
            resellerId: body.resellerId, tenantId: body.tenantId, relationType: body.relationType,
            startAt: body.startAt || null, endAt: body.endAt || null, reason: body.reason
          }, cu);
          return sendJson(res, 201, { ok: true, link: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-tenant-links\/([^/]+)\/revoke$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerTenantsSvc } = ctx;
      const admLinkRevokeMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.request", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerTenantsSvc.revokeTenantLink(store, { linkId: admLinkRevokeMatch[1], reason: body.reason }, cu);
          return sendJson(res, 200, { ok: true, link: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  // ── Gedelegeerde toegang (23.12) · platformbeheer + sweep ────────────────
  {
    path: "/api/admin/reseller-delegated-access",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, resellerAuthz } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.view", {})) return resellerForbidden(res);
        const rid = url.searchParams.get("resellerId");
        const tid = url.searchParams.get("tenantId");
        const grants = resellerTenantsSvc.listDelegatedAccess(store, { resellerId: rid, tenantId: tid });
        return sendJson(res, 200, { ok: true, grants });
    },
  },
  {
    path: "/api/admin/reseller-delegated-access/expire",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, sendResellerError, resellerAuthz, resellerTenantsSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.request", {})) return resellerForbidden(res);
        try { return sendJson(res, 200, { ok: true, ...resellerTenantsSvc.expireDelegatedAccess(store, Date.now()) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-delegated-access\/([^/]+)\/activate$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerTenantsSvc } = ctx;
      const admDlgActivateMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.request", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        try {
          const grant = resellerTenantsSvc.activateDelegatedAccess(store, { grantId: admDlgActivateMatch[1] }, cu);
          return sendJson(res, 200, { ok: true, grant });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-delegated-access\/([^/]+)\/revoke$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerTenantsSvc } = ctx;
      const admDlgRevokeMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.request", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const grant = resellerTenantsSvc.revokeDelegatedAccess(store, { grantId: admDlgRevokeMatch[1], reason: body.reason }, cu);
          return sendJson(res, 200, { ok: true, grant });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  // ── Licenties en prijzen (23.10) · goedkeuring aan Monargo-zijde ─────────
  {
    path: "/api/admin/reseller-license-requests",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, resellerAuthz, resellerLicensingSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.licenses.request", {})) return resellerForbidden(res);
        const rid = url.searchParams.get("resellerId");
        const requests = resellerLicensingSvc.listRequests(store, { resellerId: rid });
        return sendJson(res, 200, { ok: true, requests });
    },
  },
  {
    path: "/api/admin/reseller-license-requests",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.licenses.request", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try { return sendJson(res, 201, { ok: true, request: createResellerLicenseRequest(body, cu) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-license-requests\/([^/]+)\/transition$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerLicensingSvc } = ctx;
      const admLicTransMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.licenses.request", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerLicensingSvc.transitionLicenseRequest(store, { requestId: admLicTransMatch[1], to: body.to, reason: body.reason || null }, cu);
          return sendJson(res, 200, { ok: true, request: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: "/api/admin/reseller-price-exceptions",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, resellerAuthz, resellerLicensingSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.licenses.request", {})) return resellerForbidden(res);
        const rid = url.searchParams.get("resellerId");
        const exceptions = resellerLicensingSvc.listExceptions(store, { resellerId: rid });
        return sendJson(res, 200, { ok: true, exceptions });
    },
  },
  {
    path: /^\/api\/admin\/reseller-price-exceptions\/([^/]+)\/approve$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerLicensingSvc } = ctx;
      const admPexApproveMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.licenses.request", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerLicensingSvc.approvePriceException(store, { exceptionId: admPexApproveMatch[1], note: body.note || null }, cu);
          return sendJson(res, 200, { ok: true, exception: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-price-exceptions\/([^/]+)\/reject$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerLicensingSvc } = ctx;
      const admPexRejectMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.licenses.request", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerLicensingSvc.rejectPriceException(store, { exceptionId: admPexRejectMatch[1], reason: body.reason }, cu);
          return sendJson(res, 200, { ok: true, exception: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: "/api/admin/reseller-discounts",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerLicensingSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.tier.manage", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try { return sendJson(res, 201, { ok: true, discount: resellerLicensingSvc.setResellerDiscount(store, body, cu) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-discounts\/([^/]+)$/,
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, resellerAuthz, resellerLicensingSvc } = ctx;
      const admDiscountMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.tier.manage", {})) return resellerForbidden(res);
        return sendJson(res, 200, {
          ok: true,
          discounts: resellerLicensingSvc.discountsOf(store, admDiscountMatch[1]),
          active: resellerLicensingSvc.resellerDiscountFor(store, admDiscountMatch[1])
        });
    },
  },
  // ── Commissiecontracten, events, staten, dispuut, payout (23.11) ─────────
  {
    path: "/api/admin/reseller-commission-agreements",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, resellerAuthz, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.view", {})) return resellerForbidden(res);
        const rid = url.searchParams.get("resellerId");
        const agreements = rid
          ? resellerCommissionSvc.agreementsFor(store, rid)
          : resellerCommissionSvc.listAgreements(store, {});
        return sendJson(res, 200, { ok: true, agreements });
    },
  },
  {
    path: "/api/admin/reseller-commission-agreements",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try { return sendJson(res, 201, { ok: true, agreement: resellerCommissionSvc.createAgreement(store, body, cu) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-commission-agreements\/([^/]+)\/transition$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerCommissionSvc } = ctx;
      const admCagTransMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerCommissionSvc.transitionAgreement(store, { agreementId: admCagTransMatch[1], to: body.to, reason: body.reason || null }, cu);
          return sendJson(res, 200, { ok: true, agreement: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-commission-agreements\/([^/]+)\/amend$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerCommissionSvc } = ctx;
      const admCagAmendMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerCommissionSvc.amendAgreement(store, { agreementId: admCagAmendMatch[1], changes: body.changes || {}, reason: body.reason }, cu);
          return sendJson(res, 201, { ok: true, agreement: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: "/api/admin/reseller-commission-events/accrue",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const result = resellerCommissionSvc.accrueFromSource(store, { resellerId: body.resellerId, source: body.source || {}, at: body.at || null }, cu);
          return sendJson(res, result.created ? 201 : 200, { ok: true, ...result });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-commission-events\/([^/]+)\/exclude$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerCommissionSvc } = ctx;
      const admCevExcludeMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try { return sendJson(res, 200, { ok: true, ...resellerCommissionSvc.excludeEvent(store, { eventId: admCevExcludeMatch[1], reason: body.reason }, cu) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-commission-events\/([^/]+)\/adjust$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerCommissionSvc } = ctx;
      const admCevAdjustMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const result = resellerCommissionSvc.adjustEvent(store, {
            eventId: admCevAdjustMatch[1], amount: body.amount === undefined ? null : body.amount, reason: body.reason
          }, cu);
          return sendJson(res, 200, { ok: true, ...result });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-commission-events\/([^/]+)\/clawback$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerCommissionSvc } = ctx;
      const admCevClawMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const result = resellerCommissionSvc.clawbackForReason(store, {
            eventId: admCevClawMatch[1], reasonCode: body.reasonCode,
            amount: body.amount === undefined ? null : body.amount, note: body.note || ""
          }, cu);
          return sendJson(res, 200, { ok: true, ...result });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: "/api/admin/reseller-commission-statements",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, resellerAuthz, resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.view", {})) return resellerForbidden(res);
        const rid = url.searchParams.get("resellerId");
        const statements = rid
          ? resellerCommissionSvc.statementsFor(store, rid)
          : resellerCommissionSvc.listStatements(store, {});
        return sendJson(res, 200, { ok: true, statements });
    },
  },
  {
    path: "/api/admin/reseller-commission-statements",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try { return sendJson(res, 201, { ok: true, statement: resellerCommissionSvc.buildStatement(store, body, cu) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-commission-statements\/([^/]+)\/rebuild$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerCommissionSvc } = ctx;
      const admCstRebuildMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        try { return sendJson(res, 200, { ok: true, statement: resellerCommissionSvc.rebuildStatement(store, { statementId: admCstRebuildMatch[1] }, cu) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-commission-statements\/([^/]+)\/transition$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerCommissionSvc } = ctx;
      const admCstTransMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerCommissionSvc.transitionStatement(store, { statementId: admCstTransMatch[1], to: body.to, reason: body.reason || null }, cu);
          return sendJson(res, 200, { ok: true, statement: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: "/api/admin/reseller-commission-disputes",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, resellerAuthz } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.view", {})) return resellerForbidden(res);
        const rid = url.searchParams.get("resellerId");
        const disputes = resellerCommissionSvc.listDisputes(store, { resellerId: rid });
        return sendJson(res, 200, { ok: true, disputes });
    },
  },
  {
    path: /^\/api\/admin\/reseller-commission-disputes\/([^/]+)\/transition$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerCommissionSvc } = ctx;
      const admCdsTransMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerCommissionSvc.transitionDispute(store, { disputeId: admCdsTransMatch[1], to: body.to, resolution: body.resolution || null }, cu);
          return sendJson(res, 200, { ok: true, dispute: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: "/api/admin/reseller-payout-changes",
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, resellerAuthz } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.payout.manage", {})) return resellerForbidden(res);
        const rid = url.searchParams.get("resellerId");
        const changes = resellerCommissionSvc.listPayoutChanges(store, { resellerId: rid });
        return sendJson(res, 200, { ok: true, changes });
    },
  },
  {
    path: "/api/admin/reseller-payout-changes",
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerCommissionSvc } = ctx;
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.payout.manage", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerCommissionSvc.requestPayoutChange(store, {
            resellerId: body.resellerId,
            payout_account: body.payout_account === undefined ? null : body.payout_account,
            payout_currency: body.payout_currency === undefined ? null : body.payout_currency,
            reason: body.reason
          }, cu);
          return sendJson(res, 201, { ok: true, change: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-payout-changes\/([^/]+)\/approve$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerCommissionSvc } = ctx;
      const admPchApproveMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.payout.approve", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        try { return sendJson(res, 200, { ok: true, change: resellerCommissionSvc.approvePayoutChange(store, { changeId: admPchApproveMatch[1] }, cu) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-payout-changes\/([^/]+)\/reject$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerCommissionSvc } = ctx;
      const admPchRejectMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.payout.approve", {})
          && !resellerAuthz.canResellerAction(cu, "reseller.payout.manage", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try { return sendJson(res, 200, { ok: true, change: resellerCommissionSvc.rejectPayoutChange(store, { changeId: admPchRejectMatch[1], reason: body.reason || null }, cu) }); }
        catch (e) { return sendResellerError(res, e); }
    },
  },
  // ── Payoutgegevens inzien (23.15/DoD-2) · APARTE finance-route ───────────
  // Algemene resellerexports (lijst, overview, lifecycle-responses) dragen
  // NOOIT de IBAN: die is uitsluitend hier zichtbaar, achter
  // reseller.payout.manage. Een monargo_partner_manager valt daarmee af
  // (SENSITIVE_DENY 23.5) · alleen partner finance ziet payoutgegevens.
  {
    path: /^\/api\/admin\/reseller-payout-details\/([^/]+)$/,
    method: ["GET"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, resellerAuthz, payoutDetails } = ctx;
      const admPayoutDetailsMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_finance");
        if (!resellerAuthz.canResellerAction(cu, "reseller.payout.manage", {})) return resellerForbidden(res);
        const org = store.get("resellers", admPayoutDetailsMatch[1]);
        if (!org) return sendJson(res, 404, { ok: false, error: "Niet gevonden", code: "RESELLER_NOT_FOUND" });
        store.audit({ actor: user.email, tenantId: null, area: "resellers", action: "payout_details_viewed", detail: org.id });
        return sendJson(res, 200, { ok: true, payout: payoutDetails(org) });
    },
  },
  {
    path: /^\/api\/admin\/reseller-reviews\/([^/]+)\/transition$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerLifecycleSvc } = ctx;
      const admReviewTransMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.organization.edit", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerLifecycleSvc.transitionReview(store, { reviewId: admReviewTransMatch[1], to: body.to, reason: body.reason || null }, cu);
          return sendJson(res, 200, { ok: true, review: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
  {
    path: /^\/api\/admin\/reseller-offboardings\/([^/]+)\/transition$/,
    method: ["POST"],
    async handler(req, res, { url, params, ctx }) {
      const { store, sendJson, readBody, actor, assertPlatformScope, monargoChannelActor,
        resellerForbidden, armResellerIdempotency, sendResellerError, resellerAuthz,
        resellerLifecycleSvc } = ctx;
      const admObTransMatch = [null, ...params];
        const user = actor(req);
        if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        assertPlatformScope(user, "resellers");
        const cu = monargoChannelActor(user, "monargo_partner_manager");
        if (!resellerAuthz.canResellerAction(cu, "reseller.organization.edit", {})) return resellerForbidden(res);
        if (armResellerIdempotency(req, res, url, user)) return;
        const body = await readBody(req);
        try {
          const row = resellerLifecycleSvc.transitionOffboarding(store, { offboardingId: admObTransMatch[1], to: body.to, reason: body.reason || null }, cu);
          return sendJson(res, 200, { ok: true, offboarding: row });
        } catch (e) { return sendResellerError(res, e); }
    },
  },
];

// dispatch() geeft ctx al mee als derde argument · geen wrapper nodig.
module.exports = () => ROUTES;
