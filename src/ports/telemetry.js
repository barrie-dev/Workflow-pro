"use strict";
/**
 * TelemetryProvider-PORT (handover 4.7).
 *
 * Contract:
 *   log(event)                    → gestructureerde logregel
 *   security(event)               → securityevent (apart kanaal)
 *   metric(name, value, attrs)    → meetwaarde
 *   span(name, work, attrs)       → duur + uitkomst van een stuk werk
 *
 * Regels uit de handover:
 *  - OpenTelemetry is de implementatiestandaard; Azure Monitor is een EXPORTER,
 *    geen applicatiecontract. Daarom hangt deze poort nergens aan vast.
 *  - PII en secrets worden VÓÓR export gefilterd. Dat gebeurt hier, in de poort,
 *    zodat geen enkele adapter het kan vergeten.
 *  - correlationId, requestId, tenantId en actorId volgen iedere use case.
 */

const { redactSecrets, isSecretName } = require("./secret-provider");

const LEVELS = ["debug", "info", "warn", "error"];
const SECURITY_KINDS = [
  "auth_success", "auth_failure", "mfa_challenge", "permission_denied",
  "cross_tenant_denied", "rate_limited", "secret_rotated", "impersonation",
  "export_performed", "policy_changed",
];

// Veldnamen die persoonsgegevens dragen. De WAARDE gaat niet mee naar
// telemetrie; we bewaren enkel of het veld gevuld was.
const PII_FIELDS = new Set([
  "email", "phone", "mobile", "name", "firstname", "lastname", "fullname",
  "address", "street", "city", "postalcode", "vatnumber", "iban", "birthdate",
  "nationalnumber", "rrn", "ip", "useragent",
]);
const MAX_STRING = 500;

function clean(v) { return String(v == null ? "" : v).trim(); }

/**
 * Maak attributen exportklaar: secrets en PII eruit, diepte begrensd.
 * Een gefilterd veld verdwijnt niet stilzwijgend maar wordt "[PII]" of
 * "[REDACTED]", zodat je in een onderzoek nog ziet dát er iets stond.
 */
function sanitizeAttributes(attrs, depth = 0) {
  if (attrs == null || typeof attrs !== "object" || depth > 4) return {};
  const out = {};
  for (const [key, value] of Object.entries(attrs)) {
    const lower = key.toLowerCase();
    if (isSecretName(key)) { out[key] = "[REDACTED]"; continue; }
    if (PII_FIELDS.has(lower)) { out[key] = value == null || value === "" ? null : "[PII]"; continue; }
    if (value == null) { out[key] = null; continue; }
    if (typeof value === "string") { out[key] = redactSecrets(value).slice(0, MAX_STRING); continue; }
    if (typeof value === "number" || typeof value === "boolean") { out[key] = value; continue; }
    if (Array.isArray(value)) { out[key] = value.slice(0, 20).map(v => (typeof v === "object" ? sanitizeAttributes(v, depth + 1) : v)); continue; }
    if (typeof value === "object") { out[key] = sanitizeAttributes(value, depth + 1); continue; }
  }
  return out;
}

/**
 * Correlatievelden die iedere use case meedraagt (handover 4.7). Ze worden
 * apart gehouden van de vrije attributen zodat een exporter ze als
 * eerste-klas dimensies kan gebruiken.
 */
function normalizeContext(ctx = {}) {
  return {
    correlationId: clean(ctx.correlationId) || null,
    requestId: clean(ctx.requestId) || null,
    tenantId: clean(ctx.tenantId) || null,
    // actorId is een intern id, geen e-mailadres: dat laatste is PII.
    actorId: clean(ctx.actorId) || null,
  };
}

function normalizeLogEvent(event = {}) {
  return {
    level: LEVELS.includes(event.level) ? event.level : "info",
    message: redactSecrets(clean(event.message)).slice(0, MAX_STRING),
    ...normalizeContext(event),
    attributes: sanitizeAttributes(event.attributes),
    at: event.at || new Date().toISOString(),
  };
}

function normalizeSecurityEvent(event = {}) {
  const kind = SECURITY_KINDS.includes(event.kind) ? event.kind : "policy_changed";
  return {
    kind,
    // Securityevents zijn per definitie interessant: standaard warn.
    level: LEVELS.includes(event.level) ? event.level : "warn",
    outcome: ["allowed", "denied"].includes(event.outcome) ? event.outcome : "denied",
    message: redactSecrets(clean(event.message)).slice(0, MAX_STRING),
    ...normalizeContext(event),
    attributes: sanitizeAttributes(event.attributes),
    at: event.at || new Date().toISOString(),
  };
}

const REQUIRED_METHODS = ["log", "security", "metric", "span"];
function isTelemetryProvider(candidate) {
  return !!candidate && REQUIRED_METHODS.every(m => typeof candidate[m] === "function");
}

module.exports = {
  LEVELS, SECURITY_KINDS, PII_FIELDS, REQUIRED_METHODS,
  sanitizeAttributes, normalizeContext, normalizeLogEvent, normalizeSecurityEvent, isTelemetryProvider,
};
