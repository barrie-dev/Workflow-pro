/* ============================================================
   IA-02 · Routemodel + legacy redirects (IA handover §6)

   Routes zijn URL-first en tenant-veilig (besluit D-03). Dit
   bestand is de PURE kern: parsen, bouwen en omleiden. De
   browserkoppeling (history, popstate) zit in router.js zodat
   dit contract zonder DOM getest kan worden.

   Eisen uit §6 die hier landen:
     - deep links en refresh geven exact dezelfde bestemming;
     - lijstfilters staan in de querystring en zijn deelbaar;
     - oude data-view-bestemmingen leiden om naar de nieuwe route
       MET behoud van de record-id (strangler · D-11);
     - een route die een record van een ANDERE tenant noemt geeft
       een generieke weigering, zonder te verraden of het bestaat.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory(
    typeof require === "function" ? require("./registry") : (root && root.wfpNav && root.wfpNav.registry)
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpNav = root.wfpNav || {}; root.wfpNav.routeMap = api; }
})(typeof window !== "undefined" ? window : null, function (registry) {
  "use strict";

  const APP_PREFIX = "/app/";

  /** Alle routepatronen uit de registry: lijstpaden én recordpaden. */
  function patterns(entries) {
    const out = [];
    const add = (id, pattern, kind) => { if (pattern) out.push({ id, pattern, kind }); };
    for (const d of entries || registry.ENTRIES) {
      add(d.id, d.path, "list");
      add(d.id, d.recordPath, "record");
      for (const c of d.children || []) add(c.id, c.path, "list");
    }
    // Langste patroon eerst: /app/customers/:id/overview wint van /app/customers.
    return out.sort((a, b) => b.pattern.split("/").length - a.pattern.split("/").length);
  }

  function segsOf(p) { return String(p || "").split("?")[0].replace(/\/+$/, "").split("/").filter(Boolean); }

  /** Match één patroon tegen een pad. Geeft de params of null. */
  function matchPattern(pattern, pathname) {
    const ps = segsOf(pattern), as = segsOf(pathname);
    if (ps.length !== as.length) return null;
    const params = {};
    for (let i = 0; i < ps.length; i++) {
      if (ps[i].startsWith(":")) { params[ps[i].slice(1)] = decodeURIComponent(as[i]); continue; }
      if (ps[i] !== as[i]) return null;
    }
    return params;
  }

  /** Querystring → object. Lijstfilters zijn zo deelbaar (§6). */
  function parseQuery(search) {
    const q = {};
    const raw = String(search || "").replace(/^\?/, "");
    if (!raw) return q;
    for (const part of raw.split("&")) {
      if (!part) continue;
      const i = part.indexOf("=");
      const k = decodeURIComponent(i === -1 ? part : part.slice(0, i));
      const v = i === -1 ? "" : decodeURIComponent(part.slice(i + 1).replace(/\+/g, " "));
      if (k) q[k] = v;
    }
    return q;
  }

  /** Object → querystring met VASTE sleutelvolgorde, zodat URL's stabiel zijn. */
  function buildQuery(query) {
    const keys = Object.keys(query || {}).filter(k => query[k] !== undefined && query[k] !== null && query[k] !== "").sort();
    if (!keys.length) return "";
    return "?" + keys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join("&");
  }

  /**
   * Parse een URL naar een routebeschrijving.
   * @returns {{id, kind, params, query, path}|null} null = onbekende route
   */
  function parse(url, entries) {
    const [pathname, search] = String(url || "").split("?");
    if (!pathname.startsWith(APP_PREFIX)) return null;
    for (const p of patterns(entries)) {
      const params = matchPattern(p.pattern, pathname);
      if (params) return { id: p.id, kind: p.kind, params, query: parseQuery(search), path: pathname };
    }
    return null;
  }

  /** Bouw een URL uit een registry-id + params + filters. */
  function build(id, params = {}, query = {}, entries) {
    const p = patterns(entries).find(x => x.id === id && (x.kind === "record" ? Object.keys(params).length : true))
      || patterns(entries).find(x => x.id === id);
    if (!p) return null;
    const path = p.pattern.split("/").map(seg => {
      if (!seg.startsWith(":")) return seg;
      const v = params[seg.slice(1)];
      return v === undefined ? seg : encodeURIComponent(v);
    }).join("/");
    return path + buildQuery(query);
  }

  // ── Legacy redirects (D-11 · strangler) ───────────────────────────────────
  // De oude shell navigeerde met data-view="<naam>". Die bestemmingen blijven
  // werken en leiden om naar de nieuwe route, MET behoud van de record-id.
  const LEGACY_VIEW_MAP = {
    customers: "customers", inbox: "customers.requests",
    offertes: "sales.quotes", contracts: "sales.contracts", catalog: "sales.catalogue",
    projects: "projects", worksites: "projects.worksites",
    planning: "planning.calendar",
    workorders: "work-orders", workorderReview: "work-orders.review",
    employees: "team.people", clockings: "team.time", leaves: "team.leave",
    expenses: "team.expenses", incidents: "team.safety",
    facturen: "finance.invoices", payments: "finance.payments",
    purchase: "finance.purchase", progressClaims: "finance.progress-claims",
    stock: "resources.stock", vehicles: "resources.fleet", assets: "resources.assets",
    reports: "insights.reports",
    integrations: "automation.integrations", forms: "automation.forms",
  };

  /**
   * Zet een oude bestemming om naar de nieuwe route.
   * @param {string} view  de oude data-view-naam
   * @param {object} opts  { recordId, query } · de record-id blijft behouden
   * @returns {string|null} nieuw pad, of null wanneer de view onbekend is
   */
  function legacyRedirect(view, opts = {}, entries) {
    const id = LEGACY_VIEW_MAP[String(view || "").trim()];
    if (!id) return null;
    // Met een record-id proberen we eerst het recordpad van het DOMEIN.
    if (opts.recordId) {
      const domainId = id.split(".")[0];
      const rec = patterns(entries).find(x => x.id === domainId && x.kind === "record");
      if (rec) {
        const key = (rec.pattern.match(/:([A-Za-z0-9_]+)/) || [])[1];
        if (key) return build(domainId, { [key]: opts.recordId }, opts.query || {}, entries);
      }
    }
    return build(id, {}, opts.query || {}, entries);
  }

  return {
    APP_PREFIX, LEGACY_VIEW_MAP,
    patterns, parse, build, parseQuery, buildQuery, matchPattern, legacyRedirect,
  };
});
