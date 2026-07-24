"use strict";

// ── Publieke meta-routes (CTO3-10 increment 3) ───────────────────────────────
// Drie zelfstandige, publieke GET-routes zonder auth of tenantcontext:
// het OpenAPI-contract, de release-info en de platform-aankondiging.
// Byte-identiek aan de vorige inline-afhandeling.
//
// De router bevat geen businesslogica: openApiSpec(), releaseInfo() en
// loadPlatformConfig() blijven de services.

module.exports = (ctx) => [
  {
    method: "GET",
    path: "/api/openapi.json",
    handler: (req, res) => ctx.sendJson(res, 200, ctx.openApiSpec()),
  },
  {
    method: "GET",
    path: "/api/releases",
    handler: (req, res) => ctx.sendJson(res, 200, { ok: true, release: ctx.releaseInfo() }),
  },
  {
    // Publieke platform-aankondiging / onderhoudsbanner · getoond aan alle shells.
    method: "GET",
    path: "/api/announcement",
    handler: (req, res) => {
      const a = ctx.loadPlatformConfig(ctx.store).announcement || {};
      ctx.sendJson(res, 200, {
        ok: true,
        announcement: a.active
          ? { active: true, level: a.level || "info", message: a.message || "" }
          : { active: false },
      });
    },
  },
];
