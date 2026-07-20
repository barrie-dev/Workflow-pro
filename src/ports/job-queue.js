"use strict";
/**
 * JobQueueProvider-PORT (handover 4.6).
 *
 * Contract:
 *   publish(job)              → void   (idempotent op idempotencyKey)
 *   reserve(workerId, limit)  → Job[]  (exclusief gereserveerd, met timeout)
 *   acknowledge(jobId)        → void   (klaar)
 *   retry(jobId, reason)      → void   (terug in de wachtrij met backoff)
 *   deadLetter(jobId, reason) → void   (definitief geparkeerd)
 *
 * Regels uit de handover:
 *  - IEDERE job draagt tenantId, type, payloadVersion, correlationId en
 *    idempotencyKey. Zonder die velden geen publish: een job zonder
 *    idempotencyKey kan bij een herstart dubbel uitgevoerd worden, en een job
 *    zonder correlationId is bij een incident niet te traceren.
 *  - Start met PostgresJobQueue voor portability; Azure Service Bus is een
 *    latere adapter, geen P0-verplichting.
 *  - De transactional outbox (platform/events.js) blijft de bron voor
 *    domeinevents; de queue is voor UITVOERWERK (bezorging, rapporten,
 *    achtergrondtaken), niet een tweede eventbus.
 *
 * Cloudblind: geen SDK, geen SQL, geen omgevingsvariabelen hier.
 */

const JOB_STATUSES = ["pending", "reserved", "done", "dead"];
const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_VISIBILITY_SECONDS = 60;

function clean(v) { return String(v == null ? "" : v).trim(); }

/**
 * Backoff in seconden voor poging n (1-gebaseerd): 5s, 20s, 45s, … capped.
 * Kwadratisch in plaats van exponentieel: achtergrondwerk mag best snel
 * opnieuw, maar niet in een strakke lus.
 */
function backoffSeconds(attempt) {
  const n = Math.max(1, Number(attempt) || 1);
  return Math.min(5 * n * n, 3600);
}

/**
 * Valideer en normaliseer een job-envelope. Faalt luid op ontbrekende
 * verplichte velden (handover 4.6) in plaats van stil defaults te verzinnen.
 */
function normalizeEnvelope(input = {}) {
  const tenantId = clean(input.tenantId);
  const type = clean(input.type);
  const idempotencyKey = clean(input.idempotencyKey);
  const missing = [];
  if (!tenantId) missing.push("tenantId");
  if (!type) missing.push("type");
  if (!idempotencyKey) missing.push("idempotencyKey");
  if (missing.length) {
    const e = new Error(`Job-envelope mist verplichte velden: ${missing.join(", ")}`);
    e.status = 400; e.code = "ENVELOPE_INCOMPLETE"; e.missing = missing;
    throw e;
  }
  if (!/^[a-z][a-z0-9_.-]*$/i.test(type)) {
    const e = new Error(`Ongeldig jobtype '${type}'`); e.status = 400; e.code = "INVALID_JOB_TYPE"; throw e;
  }
  return {
    tenantId,
    type,
    payload: input.payload && typeof input.payload === "object" ? input.payload : {},
    payloadVersion: Number.isFinite(Number(input.payloadVersion)) ? Number(input.payloadVersion) : 1,
    correlationId: clean(input.correlationId) || null,
    idempotencyKey,
    maxAttempts: Number.isFinite(Number(input.maxAttempts)) ? Math.max(1, Number(input.maxAttempts)) : DEFAULT_MAX_ATTEMPTS,
    runAt: input.runAt || null,          // uitgesteld werk; null = nu
  };
}

const REQUIRED_METHODS = ["publish", "reserve", "acknowledge", "retry", "deadLetter"];
function isJobQueueProvider(candidate) {
  return !!candidate && REQUIRED_METHODS.every(m => typeof candidate[m] === "function");
}

module.exports = {
  JOB_STATUSES, DEFAULT_MAX_ATTEMPTS, DEFAULT_VISIBILITY_SECONDS, REQUIRED_METHODS,
  backoffSeconds, normalizeEnvelope, isJobQueueProvider,
};
