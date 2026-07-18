"use strict";
/**
 * Gedeelde, geharde HTTPS-client voor uitgaande provider-calls (Stripe, Peppol,
 * CIAW, Limosa, Robaws …). Vóór dit had elke module zijn eigen https.request
 * zónder timeout · een hangende provider liet zo de hele API-request vasthangen.
 *
 * - Altijd een timeout (default 15s) met nette afbreek-fout.
 * - Eén plek voor netwerkfout-afhandeling en statuscode-interpretatie.
 * - Geen body-parsing-aannames: caller kiest JSON of ruwe tekst.
 */

const https = require("https");

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Voer een HTTPS-request uit met timeout. Resolved met {statusCode, text, json}.
 * Rejected bij netwerkfout of timeout (error.code === "ETIMEDOUT").
 */
function httpsRequest({ hostname, port, path, method = "POST", headers = {}, body = "", timeoutMs = DEFAULT_TIMEOUT_MS, transport = https }) {
  return new Promise((resolve, reject) => {
    const data = typeof body === "string" ? body : JSON.stringify(body || {});
    const finalHeaders = { ...headers };
    if (data && finalHeaders["Content-Length"] === undefined) finalHeaders["Content-Length"] = Buffer.byteLength(data);

    // Poort is optioneel (default 443). Klant-webhooks draaien soms op een
    // afwijkende poort · zonder dit ging elk verzoek stilzwijgend naar 443.
    const options = { hostname, path, method, headers: finalHeaders };
    if (port) options.port = Number(port);
    const req = transport.request(options, res => {
      let raw = "";
      res.on("data", c => (raw += c));
      res.on("end", () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : {}; } catch (_) { json = null; }
        resolve({ statusCode: res.statusCode, text: raw, json });
      });
    });
    req.on("error", reject);
    // Harde timeout: breek de socket af en geef een duidelijke, herkenbare fout.
    req.setTimeout(timeoutMs, () => {
      req.destroy(Object.assign(new Error(`Provider reageerde niet binnen ${timeoutMs}ms`), { code: "ETIMEDOUT" }));
    });
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Gemaksfunctie voor JSON-POST: stuurt JSON, verwacht JSON terug, en gooit een
 * duidelijke fout bij niet-2xx of onleesbaar antwoord.
 */
async function postJson(hostname, path, headers, body, { timeoutMs, transport } = {}) {
  const res = await httpsRequest({ hostname, path, method: "POST", headers: { "Content-Type": "application/json", ...headers }, body, timeoutMs, transport });
  const j = res.json || {};
  if (res.statusCode >= 200 && res.statusCode < 300) return j;
  throw new Error(j.error?.message || j.message || `HTTP ${res.statusCode}`);
}

module.exports = { httpsRequest, postJson, DEFAULT_TIMEOUT_MS };
