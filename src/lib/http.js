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
  const csp = config.isProduction ? CSP_DIRECTIVES : CSP_DIRECTIVES_DEV;
  return {
    ...SECURITY_HEADERS,
    "Content-Security-Policy": csp,
    ...(config.isProduction ? { "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload" } : {}),
    ...extraHeaders
  };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function readBody(req, maxBytes = 2_000_000) {
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

module.exports = { sendJson, readBody, readRawBody, routeKey, securityHeaders };
