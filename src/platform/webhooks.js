"use strict";
/**
 * Webhooks & delivery-runtime (master-spec h41/E19, R6 · API).
 *
 * Bezorgt de domeinevents uit de transactionele outbox aan geregistreerde
 * endpoints van een tenant. De outbox blijft de bron van waarheid; deze module
 * is de UITLEVERAAR.
 *
 * Business rules (h41):
 *  - Webhooks zijn ONDERTEKEND en worden AT-LEAST-ONCE geleverd.
 *  - De ontvanger dedupliceert op event-ID: we sturen dat als expliciete header
 *    én in de payload, zodat een herhaalde levering geen duplicaat oplevert.
 *  - Retry met exponentiële backoff; na maxAttempts gaat het event naar de
 *    dead-letter (markEventFailed regelt beide).
 *  - Integratiebeheer toont laatste succes, laatste fout en achterstand
 *    (acceptatie h41) · zie buildDeliveryHealth.
 *  - Een endpoint met te veel opeenvolgende fouten gaat op status "error" en
 *    kan handmatig gepauzeerd of hervat worden.
 *
 * Handtekening (verifieerbaar met signing secret + event-ID, acceptatie h41):
 *   signatureHeader = "t=<unix>,v1=<hex hmac-sha256 van `${t}.${body}`>"
 * De ontvanger herberekent de HMAC met zijn signing secret en vergelijkt in
 * constante tijd; de timestamp begrenst replay.
 *
 * Cloudblind (ADR-001): deze module importeert GEEN https/SDK. De transport
 * wordt geïnjecteerd (deliverPending({ transport })), zodat de runtime testbaar
 * is zonder netwerk en de adapter vervangbaar blijft.
 */

const crypto = require("crypto");
const { newUlid, listOutbox, markEventDelivered, markEventFailed } = require("./events");

const ENDPOINT_STATUSES = ["active", "error", "paused"];
const MAX_ATTEMPTS = 8;                  // daarna dead-letter (h41)
// Circuit breaker per endpoint. BEWUST hoger dan MAX_ATTEMPTS: anders zou een
// kapot endpoint uitgeschakeld worden vóór een event zijn eigen levenscyclus
// (8 pogingen → dead-letter) kan afmaken, en bleven events eeuwig hangen.
const ERROR_THRESHOLD = 10;              // opeenvolgende fouten → endpoint "error"
const SIGNATURE_TOLERANCE_S = 300;       // replaywindow voor de ontvanger

function clean(v) { return String(v == null ? "" : v).trim(); }

// ── Handtekening ────────────────────────────────────────────────────────────
/** Bereken de handtekeningwaarde voor een body + secret op tijdstip t (sec). */
function computeSignature(body, secret, timestampSec) {
  const payload = `${timestampSec}.${typeof body === "string" ? body : JSON.stringify(body)}`;
  return crypto.createHmac("sha256", String(secret)).update(payload).digest("hex");
}

/** Volledige headerwaarde: "t=<unix>,v1=<hex>". */
function signatureHeader(body, secret, timestampSec = Math.floor(Date.now() / 1000)) {
  return `t=${timestampSec},v1=${computeSignature(body, secret, timestampSec)}`;
}

/**
 * Verifieer een ontvangen handtekening (dezelfde routine die een ontvanger
 * gebruikt · meegeleverd zodat integrators en onze eigen tests hem kunnen delen).
 * Vergelijkt in constante tijd en weigert te oude timestamps.
 */
function verifySignature(body, secret, header, { now = Math.floor(Date.now() / 1000), toleranceS = SIGNATURE_TOLERANCE_S } = {}) {
  const parts = String(header || "").split(",").reduce((acc, kv) => {
    const [k, v] = kv.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now - t) > toleranceS) return false;
  const expected = computeSignature(body, secret, t);
  const got = String(parts.v1 || "");
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// ── Endpoint-repository ─────────────────────────────────────────────────────
function normalizeEndpoint(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  const url = clean(merged.url);
  if (!/^https:\/\/[^\s]+$/i.test(url)) {
    const e = new Error("Een webhook-URL moet met https:// beginnen"); e.status = 400; e.code = "INVALID_URL"; throw e;
  }
  const eventTypes = (Array.isArray(merged.eventTypes) ? merged.eventTypes : [])
    .map(clean).filter(t => /^[a-z][a-z_]*\.([a-z][a-z_]*|\*)$/.test(t)).slice(0, 50);
  if (!eventTypes.length) {
    const e = new Error("Kies minstens één eventtype (bv. invoice.created of invoice.*)"); e.status = 400; e.code = "NO_EVENT_TYPES"; throw e;
  }
  return {
    url,
    eventTypes,
    description: clean(merged.description),
    status: ENDPOINT_STATUSES.includes(merged.status) ? merged.status : "active",
  };
}

/** Matcht een eventtype tegen een abonnement (exact of "resource.*"). */
function matchesEventType(subscribed, eventType) {
  return subscribed.some(s => s === eventType || (s.endsWith(".*") && eventType.startsWith(s.slice(0, -1))));
}

function makeWebhookRepository(store) {
  const col = "webhookEndpoints";
  return {
    list(tenantId) {
      // Het signing secret verlaat de server nooit in leesacties (h8.2).
      return (store.list(col, tenantId) || []).map(e => ({ ...e, secret: undefined, secretHint: `whsec_…${String(e.secret || "").slice(-4)}` }));
    },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(e => e.id === id) || null; },
    insert(tenantId, payload, actor) {
      const normalized = normalizeEndpoint(payload, null);
      const now = new Date().toISOString();
      const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
      const row = store.insert(col, {
        id: `whe_${newUlid()}`, tenantId, ...normalized, secret,
        health: { lastSuccessAt: null, lastErrorAt: null, lastError: null, consecutiveFailures: 0, delivered: 0, failed: 0 },
        version: 1, createdAt: now, createdBy: actor || null, updatedAt: now, updatedBy: actor || null,
      });
      // Het volledige secret wordt EENMALIG teruggegeven bij aanmaak.
      return row;
    },
    update(tenantId, id, patch, actor) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Webhook-endpoint niet gevonden"); e.status = 404; throw e; }
      const normalized = normalizeEndpoint(patch, existing);
      return store.update(col, id, { ...normalized, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
    },
    /** Secret roteren (h41-gebruikersactie); geeft het nieuwe secret eenmalig terug. */
    rotateSecret(tenantId, id, actor) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Webhook-endpoint niet gevonden"); e.status = 404; throw e; }
      const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
      const row = store.update(col, id, { secret, rotatedAt: new Date().toISOString(), updatedBy: actor || null, version: Number(existing.version || 1) + 1 });
      return row;
    },
    remove(tenantId, id) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Webhook-endpoint niet gevonden"); e.status = 404; throw e; }
      store.remove(col, id);
      return { ok: true };
    },
  };
}

// ── Delivery-runtime ────────────────────────────────────────────────────────
/**
 * Bezorg openstaande outbox-events aan de abonnerende endpoints.
 *
 * @param {object} store
 * @param {object} opts
 * @param {(args:{url:string, body:string, headers:object}) => Promise<{statusCode:number, text?:string}>} opts.transport
 *        Geïnjecteerde HTTP-transport (cloudblind: deze module kent geen https).
 * @param {number} [opts.limit] max aantal (event × endpoint)-leveringen per run
 * @param {string} [opts.tenantId] beperk tot één tenant
 * @returns rapport met per poging het resultaat
 */
async function deliverPending(store, { transport, limit = 25, tenantId = null, now = new Date() } = {}) {
  if (typeof transport !== "function") throw new Error("deliverPending vereist een transport-functie");
  // Alle endpoints (elke status) tellen mee voor het MATCHEN; alleen actieve
  // krijgen effectief een levering. Zo wordt een event voor een gepauzeerd of
  // fout endpoint niet stilzwijgend weggegooid, maar blijft het als achterstand
  // staan tot het endpoint hervat wordt.
  const endpoints = store.list("webhookEndpoints", tenantId) || [];
  if (!endpoints.length) return { attempted: 0, delivered: 0, failed: 0, results: [] };

  const nowIso = now.toISOString();
  const pending = listOutbox(store, { status: "pending", tenantId, limit: 200 })
    // Respecteer de backoff: nog niet toe aan een nieuwe poging → overslaan.
    .filter(e => !e.delivery.nextAttemptAt || e.delivery.nextAttemptAt <= nowIso)
    .reverse();                        // oudste eerst: volgorde zo veel mogelijk bewaren

  const results = [];
  let delivered = 0, failed = 0;
  for (const event of pending) {
    const subscribed = endpoints.filter(ep => ep.tenantId === event.tenantId && matchesEventType(ep.eventTypes, event.eventType));
    if (!subscribed.length) {
      // Niemand luistert: markeer als bezorgd zodat de outbox niet volloopt.
      markEventDelivered(store, event.id);
      results.push({ eventId: event.id, endpointId: null, status: "no_subscribers" });
      continue;
    }
    const targets = subscribed.filter(ep => ep.status === "active");
    if (!targets.length) {
      // Wel abonnees, maar geen enkele actief: laat het event PENDING staan zodat
      // het zichtbaar blijft als achterstand en alsnog vertrekt na hervatting.
      results.push({ eventId: event.id, endpointId: null, status: "endpoint_inactive" });
      continue;
    }
    for (const ep of targets) {
      if (delivered + failed >= limit) break;
      // Envelope zonder delivery-metadata en zonder actor-PII (h46).
      const payload = {
        id: event.id, eventType: event.eventType, tenantId: event.tenantId, companyId: event.companyId,
        aggregateType: event.aggregateType, aggregateId: event.aggregateId,
        occurredAt: event.occurredAt, correlationId: event.correlationId, version: event.version, data: event.data,
      };
      const body = JSON.stringify(payload);
      const ts = Math.floor(now.getTime() / 1000);
      const headers = {
        "Content-Type": "application/json",
        // De ontvanger dedupliceert op deze event-ID (at-least-once, h41).
        "X-Monargo-Event-Id": event.id,
        "X-Monargo-Event-Type": event.eventType,
        "X-Monargo-Signature": signatureHeader(body, ep.secret, ts),
        "X-Monargo-Delivery-Attempt": String((event.delivery.attempts || 0) + 1),
      };
      let ok = false, errorText = null, statusCode = 0;
      try {
        const res = await transport({ url: ep.url, body, headers });
        statusCode = Number(res && res.statusCode) || 0;
        ok = statusCode >= 200 && statusCode < 300;
        if (!ok) errorText = `HTTP ${statusCode}${res && res.text ? ` · ${String(res.text).slice(0, 120)}` : ""}`;
      } catch (e) {
        errorText = String((e && e.message) || e).slice(0, 200);
      }
      recordEndpointResult(store, ep, ok, errorText, nowIso);
      if (ok) { markEventDelivered(store, event.id); delivered++; }
      else { markEventFailed(store, event.id, errorText, MAX_ATTEMPTS); failed++; }
      results.push({ eventId: event.id, endpointId: ep.id, status: ok ? "delivered" : "failed", statusCode, error: errorText });
    }
    if (delivered + failed >= limit) break;
  }
  return { attempted: delivered + failed, delivered, failed, results };
}

/** Werk de health-teller van een endpoint bij; te veel fouten → status "error". */
function recordEndpointResult(store, endpoint, ok, errorText, nowIso) {
  const health = endpoint.health || { lastSuccessAt: null, lastErrorAt: null, lastError: null, consecutiveFailures: 0, delivered: 0, failed: 0 };
  const next = ok
    ? { ...health, lastSuccessAt: nowIso, consecutiveFailures: 0, delivered: (health.delivered || 0) + 1 }
    : { ...health, lastErrorAt: nowIso, lastError: errorText, consecutiveFailures: (health.consecutiveFailures || 0) + 1, failed: (health.failed || 0) + 1 };
  const patch = { health: next };
  if (!ok && next.consecutiveFailures >= ERROR_THRESHOLD) patch.status = "error";
  if (ok && endpoint.status === "error") patch.status = "active";   // zelfherstel
  store.update("webhookEndpoints", endpoint.id, patch);
}

/**
 * Integratiebeheer-overzicht: laatste succes, laatste fout en ACHTERSTAND per
 * endpoint (acceptatie h41), plus de dead-letter-teller van de tenant.
 */
function buildDeliveryHealth(store, tenantId, now = new Date()) {
  const nowIso = now.toISOString();
  const endpoints = store.list("webhookEndpoints", tenantId) || [];
  const pending = listOutbox(store, { status: "pending", tenantId, limit: 200 });
  const deadLetter = listOutbox(store, { status: "dead_letter", tenantId, limit: 200 });
  return {
    generatedAt: nowIso,
    endpoints: endpoints.map(ep => {
      const backlog = pending.filter(e => matchesEventType(ep.eventTypes, e.eventType)).length;
      const h = ep.health || {};
      return {
        id: ep.id, url: ep.url, status: ep.status, eventTypes: ep.eventTypes,
        lastSuccessAt: h.lastSuccessAt || null,
        lastErrorAt: h.lastErrorAt || null,
        lastError: h.lastError || null,
        consecutiveFailures: h.consecutiveFailures || 0,
        delivered: h.delivered || 0,
        failed: h.failed || 0,
        backlog,
      };
    }),
    backlogTotal: pending.length,
    deadLetterTotal: deadLetter.length,
  };
}

/**
 * Handmatige herbezorging (h41 "fout opnieuw verwerken"): zet een dead-letter-
 * of mislukt event terug op pending zodat de volgende run het weer probeert.
 */
function requeueEvent(store, tenantId, eventId) {
  const event = (store.data.outbox || []).find(e => e.id === eventId && e.tenantId === tenantId);
  if (!event) { const e = new Error("Event niet gevonden"); e.status = 404; throw e; }
  event.delivery = { ...event.delivery, status: "pending", attempts: 0, nextAttemptAt: null, lastError: null };
  if (typeof store.save === "function") store.save();
  return event;
}

module.exports = {
  ENDPOINT_STATUSES, MAX_ATTEMPTS, ERROR_THRESHOLD,
  computeSignature, signatureHeader, verifySignature, matchesEventType,
  normalizeEndpoint, makeWebhookRepository,
  deliverPending, buildDeliveryHealth, requeueEvent,
};
