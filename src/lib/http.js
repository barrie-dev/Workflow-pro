const { config } = require("./config");

// Content-Security-Policy: strikt in productie, iets losser in dev (eval toestaan voor hot-reload tools)
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",   // inline styles nodig voor component-styling
  "img-src 'self' data: blob:",          // data-URLs voor chart-canvas + blob voor file-previews
  "font-src 'self'",
  "connect-src 'self'",                  // alleen eigen API
  "frame-ancestors 'none'",             // iframes blokkeren (dubbel met X-Frame-Options)
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join("; ");

const CSP_DIRECTIVES_DEV = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",    // dev: eval voor sourcemaps/devtools
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",        // dev: websocket voor hot-reload
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join("; ");

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin"
};

function securityHeaders(extraHeaders = {}) {
  // Prod-like (staging + production) = strikte CSP + HSTS; dev/test = losser voor tooling.
  const strict = config.isProdLike;
  const csp = strict ? CSP_DIRECTIVES : CSP_DIRECTIVES_DEV;
  return {
    ...SECURITY_HEADERS,
    "Content-Security-Policy": csp,
    ...(strict ? { "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload" } : {}),
    ...extraHeaders
  };
}

// ── CORS voor publieke, niet-gevoelige endpoints ──────────────────────────────
// De marketingsite (monargo.com) leest de canonieke prijzen/plannen van deze app
// (monargo.one) zodat beide domeinen nooit uit elkaar lopen. Alleen een strikte
// allowlist van marketing-origins mag cross-origin lezen; standaard monargo.com.
const MARKETING_ORIGINS = String(process.env.MARKETING_ORIGIN || "https://monargo.com,https://www.monargo.com")
  .split(",").map(s => s.trim()).filter(Boolean);

function corsHeaders(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin || !MARKETING_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cross-Origin-Resource-Policy": "cross-origin"
  };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  // Fout-envelope (backend-handoff): elke fout draagt een message-alias en het
  // requestId van deze request, zodat de UI en support niet hoeven te gokken.
  if (status >= 400 && payload && payload.ok === false) {
    if (payload.error !== undefined && payload.message === undefined) payload.message = payload.error;
    if (res.wfpRequestId && payload.requestId === undefined) payload.requestId = res.wfpRequestId;
  }
  // Moderne /v1-API (spec 5.4): een door de v1-laag gearmede response wordt hier
  // getransformeerd (centen, 422-veldfouten, ETag/links) vóór verzending · en
  // vóór de idempotency-vastlegging, zodat een replay de v1-vorm teruggeeft.
  if (res.wfpV1) {
    const t = require("./api-v1").transformResponse(res.wfpV1, status, payload);
    status = t.status; payload = t.payload; extraHeaders = { ...extraHeaders, ...t.headers };
    res.wfpV1 = null;
  }
  const finish = () => {
    res.writeHead(status, {
      ...securityHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    });
    res.end(JSON.stringify(payload));
    // Idempotency-Key (h41): een route die door de server "gearmed" is legt zijn
    // succesvolle response vast, zodat een herhaalde mutatie met dezelfde sleutel
    // deze response teruggespeeld krijgt in plaats van opnieuw uit te voeren.
    if (res.wfpIdem) {
      try { require("./idempotency").recordResponse(res.wfpIdem.store, res.wfpIdem.cacheKey, { status, payload }); }
      catch (err) { /* vastleggen mag een geslaagde request nooit laten falen */ }
      res.wfpIdem = null;
    }
  };
  // CTO-05 · durability-gate: de server kan per (muterende) request een async
  // poort zetten (res.wfpBeforeSend = flush) die AF moet zijn vóór de response
  // vertrekt · een 2xx betekent dan echt "bewaard", ook bij een harde crash
  // direct na het antwoord. Faalt de poort, dan sturen we een eerlijke 503 in
  // plaats van een 2xx die niet waar is.
  const gate = res.wfpBeforeSend;
  if (typeof gate === "function" && !res.wfpGateRan) {
    res.wfpGateRan = true;
    Promise.resolve().then(() => gate(status)).then(finish).catch(err => {
      console.error(`[http] durability-gate faalde: ${err.message}`);
      res.writeHead(503, { ...securityHeaders(), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ ok: false, code: "PERSIST_FAILED", error: "Opslag tijdelijk niet beschikbaar · de wijziging is niet bevestigd en wordt automatisch opnieuw geprobeerd.", requestId: res.wfpRequestId }));
    });
    return;
  }
  finish();
}

function readBody(req, maxBytes = 2_000_000) {
  // De /v1-laag leest en transformeert de body vóór de route dat doet; de
  // stream is dan al leeg, dus de route krijgt de voorgelezen versie.
  if (req.wfpPrereadBody !== undefined) return Promise.resolve(req.wfpPrereadBody);
  return readRawBody(req, maxBytes).then(body => {
    if (!body) return {};
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new Error("Invalid JSON body");
    }
  });
}

function readRawBody(req, maxBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      resolve(body);
    });
    req.on("error", reject);
  });
}

function routeKey(req) {
  const url = new URL(req.url, "http://localhost");
  return `${req.method} ${url.pathname}`;
}

module.exports = { sendJson, readBody, readRawBody, routeKey, securityHeaders, corsHeaders };
