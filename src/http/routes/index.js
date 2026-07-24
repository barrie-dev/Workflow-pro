"use strict";

// ── HTTP-routercontract (CTO3-10) ────────────────────────────────────────────
// server.js wordt een bootstrap- en registratielaag in plaats van een groeiende
// monoliet. Nieuwe routes horen NOOIT meer rechtstreeks in server.js maar in een
// bounded router hier · de architecture-test (test/architecture.test.js) dwingt
// dat af met een routebudget dat alleen mag DALEN.
//
// Contract per routermodule:
//   module.exports = (ctx) => [{ method, path, handler }]
//     method  "GET" | "POST" | ... (of een array voor meerdere, of "*" voor elke
//             methode · dat laatste bestaat om bestaande, methode-agnostische
//             routes byte-identiek te kunnen extraheren)
//     path    exacte string ("/api/status") of RegExp met capture-groepen
//     handler async (req, res, { url, params, ctx }) => void
//
// Laagindeling (spec punt 4): router → policy → service → repository. Een router
// bevat GEEN businesslogica; hij vertaalt HTTP naar een service-aanroep.
//
// ctx draagt de gedeelde runtime (store, config, helpers) zodat routers geen
// globale singletons importeren en er geen circulaire afhankelijkheden ontstaan.

const ROUTER_MODULES = [
  require("./health"),
  require("./status"),
];

/** Bouw de volledige routetabel één keer bij het opstarten. */
function registerRoutes(ctx) {
  const routes = [];
  for (const mod of ROUTER_MODULES) {
    for (const r of (mod(ctx) || [])) {
      const methods = Array.isArray(r.method) ? r.method : [r.method];
      routes.push({ ...r, methods: methods.map(m => String(m).toUpperCase()) });
    }
  }
  return routes;
}

/**
 * Probeer een request af te handelen met de geregistreerde routers.
 * @returns {Promise<boolean>} true wanneer een router het request afhandelde.
 *
 * 404/405-pariteit: matcht het pad wél maar de methode niet, dan laten we het
 * request BEWUST door naar de bestaande afhandeling in server.js, zodat de
 * extractie geen enkel statusgedrag verandert (byte-equivalent contract).
 */
async function dispatch(routes, req, res, url, ctx) {
  for (const r of routes) {
    let params = null;
    if (typeof r.path === "string") {
      if (url.pathname !== r.path) continue;
      params = {};
    } else {
      const m = url.pathname.match(r.path);
      if (!m) continue;
      params = m.slice(1);
    }
    // "*" = methode-agnostisch · bestaat om routes die vóór de extractie op elke
    // methode antwoordden byte-identiek te houden.
    if (!r.methods.includes("*") && !r.methods.includes(String(req.method).toUpperCase())) continue;
    await r.handler(req, res, { url, params, ctx });
    return true;
  }
  return false;
}

module.exports = { registerRoutes, dispatch, ROUTER_MODULES };
