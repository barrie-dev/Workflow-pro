"use strict";
/**
 * Billit Peppol Access Point · transport-client (h47, connector P0).
 *
 * Bewust SMAL gehouden: Billit is hier uitsluitend het Peppol-TRANSPORT.
 * Monargo genereert en valideert zelf de Peppol BIS 3.0 UBL
 * (src/modules/peppol-invoice.js); Billit bezorgt hem op het netwerk.
 * Het facturatieproduct van Billit (JSON-orders e.d.) gebruiken we niet.
 *
 * API (docs.billit.be):
 *  - Auth: headers `ApiKey` (geheime sleutel) + `PartyID` (bedrijfscontext).
 *    Sandbox en productie hebben een VERSCHILLENDE PartyID.
 *  - Verzenden: POST /v1/peppol/sendxml met body { "XML": "<ubl...>" }
 *    (platte tekst, geen base64). 200 → InboxItemID als referentie.
 *  - Preflight: GET /v1/peppol/participantInformation/{identifier}
 *    → { Registered, DocumentTypes[...] }. Registered alleen is niet genoeg:
 *    de ontvanger moet BIS v3 Invoice/CreditNote ondersteunen.
 *  - Sandbox: zelfde API op api.sandbox.billit.be.
 *
 * De transportfunctie is injecteerbaar zodat unittests geen netwerk raken.
 */

const { httpsRequest } = require("../lib/http-client");

const HOSTS = { production: "api.billit.be", sandbox: "api.sandbox.billit.be" };

function billitHost(peppolCfg = {}) {
  return peppolCfg.sandbox ? HOSTS.sandbox : HOSTS.production;
}

function billitHeaders(peppolCfg = {}) {
  const headers = {
    // Headernaam instelbaar (PEPPOL_AUTH_HEADER) voor het geval de sandbox
    // een andere naam blijkt te verwachten · dan is het een env-flip, geen deploy.
    [String(peppolCfg.authHeader || "ApiKey")]: String(peppolCfg.apiKey || ""),
    "Content-Type": "application/json",
  };
  if (peppolCfg.partyId) headers.PartyID = String(peppolCfg.partyId);
  return headers;
}

async function callBillit(peppolCfg, { method, path, body }, transport = httpsRequest) {
  const res = await transport({
    hostname: billitHost(peppolCfg),
    path,
    method,
    headers: billitHeaders(peppolCfg),
    body: body === undefined ? "" : JSON.stringify(body),
  });
  let data = null;
  try { data = res.body ? JSON.parse(res.body) : null; } catch (_) { data = { raw: res.body }; }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const e = new Error(`Billit ${method} ${path} → ${res.statusCode}: ${summarizeError(data) || res.body || "onbekende fout"}`);
    e.status = res.statusCode === 401 || res.statusCode === 403 ? 502 : 502;
    e.code = res.statusCode === 401 || res.statusCode === 403 ? "PEPPOL_AUTH_FAILED" : "PEPPOL_PROVIDER_ERROR";
    e.providerStatus = res.statusCode;
    e.providerBody = data;
    throw e;
  }
  return data;
}

/** Billit-foutantwoorden komen in wisselende vormen · maak er één regel van. */
function summarizeError(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (data.Message || data.message) return data.Message || data.message;
  if (Array.isArray(data.Errors || data.errors)) return (data.Errors || data.errors).map(e => e.Message || e.message || JSON.stringify(e)).join(" · ");
  if (data.raw) return String(data.raw).slice(0, 300);
  return "";
}

/**
 * Verzend een kant-en-klare UBL over het Peppol-netwerk.
 * @returns {{reference:string, status:string, transport:string}}
 */
async function sendUbl(peppolCfg, ubl, transport = httpsRequest) {
  const data = await callBillit(peppolCfg, {
    method: "POST",
    path: "/v1/peppol/sendxml",
    body: { XML: String(ubl) },
  }, transport);
  const reference = String(
    (data && (data.InboxItemID || data.inboxItemID || data.InboxItemId || data.ID || data.id)) ||
    `billit_${Date.now().toString(36)}`
  );
  return { reference, status: "sent", transport: peppolCfg.sandbox ? "billit-sandbox" : "billit" };
}

/**
 * Preflight: kan deze ontvanger BIS v3-facturen ontvangen via Peppol?
 * `identifier` mag een BTW-nummer (BE0403170701), KBO-nummer of een
 * scheme-gekwalificeerd id (9925:BE0403170701) zijn.
 */
async function participantInfo(peppolCfg, identifier, transport = httpsRequest) {
  const data = await callBillit(peppolCfg, {
    method: "GET",
    path: `/v1/peppol/participantInformation/${encodeURIComponent(String(identifier).trim())}`,
  }, transport);
  const documentTypes = Array.isArray(data && data.DocumentTypes) ? data.DocumentTypes : [];
  const supports = want => documentTypes.some(d => String(d).toLowerCase().includes(want));
  return {
    identifier: (data && data.Identifier) || String(identifier),
    registered: !!(data && (data.Registered === true || data.registered === true)),
    documentTypes,
    // Registered alléén is niet genoeg (Billit-doc): factuurtype moet erbij zijn.
    canReceiveInvoice: !!(data && data.Registered === true) && (documentTypes.length === 0 || supports("invoice")),
    raw: data,
  };
}

module.exports = { billitHost, billitHeaders, sendUbl, participantInfo, summarizeError, HOSTS };
