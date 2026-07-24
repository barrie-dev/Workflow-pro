"use strict";

// ── Publieke statusroute (CTO3-10 · eerste extractie) ────────────────────────
// Bewust de kleinste, volledig zelfstandige route als eerste bewijs dat het
// routercontract werkt: GEEN gedragswijziging, byte-equivalente respons. De
// router bevat geen businesslogica · publicStatus() blijft de service.

module.exports = (ctx) => [
  {
    method: "GET",
    path: "/api/status",
    handler: (req, res) => {
      ctx.sendJson(res, 200, ctx.publicStatus(ctx.store));
    },
  },
];
