"use strict";
/**
 * Domain events + outbox (master-spec h5.3, h6.2, h46 · R0/E-platform).
 *
 * Elke belangrijke statusovergang genereert een domeinevent met de canonieke
 * envelope uit hoofdstuk 46: event_id (ULID), event_type ("resource.action"),
 * tenant/company, aggregate, occurred_at, correlation_id en data. Events
 * bevatten geen secrets en zo weinig mogelijk persoonsgegevens.
 *
 * Opslag: outbox-collectie in dezelfde store-mutatie als de domain-write.
 * In de huidige storage-laag (JSON/bridge) is dat best-effort atomair; de
 * echte transactional outbox komt met migratiefase M0 (genormaliseerde
 * tabellen). De emitter-API is vanaf nu het enige kanaal, zodat domeincode
 * niet hoeft te wijzigen bij de cutover.
 *
 * Delivery (webhooks, signature, retries, dead-letter) volgt in E19; tot dan
 * is de outbox de bron voor ops-inzicht en event replay. Consumers
 * dedupliceren op event_id (at-least-once).
 */

const crypto = require("crypto");

// ── ULID (Crockford base32, 48-bit tijd + 80-bit random) ────────────────────
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32(value, length) {
  let out = "";
  for (let i = length - 1; i >= 0; i--) {
    out = B32[Number((value >> BigInt(i * 5)) & 31n)] + out;
  }
  return out;
}

function newUlid(now = Date.now()) {
  const time = encodeBase32(BigInt(now), 10);
  const rand = crypto.randomBytes(10);
  let value = 0n;
  for (const byte of rand) value = (value << 8n) | BigInt(byte);
  return time + encodeBase32(value, 16);
}

// ── Envelope ─────────────────────────────────────────────────────────────────
const EVENT_TYPE_RE = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;
const OUTBOX_LIMIT = 2000; // ring-buffer tot M0 echte retentie brengt

function ensureOutbox(store) {
  // Defensief: een event-emissie mag een domain-write nooit laten crashen,
  // ook niet bij minimale (test)stores. Echte stores garanderen de collectie
  // via REQUIRED_COLLECTIONS.
  if (!store.data || typeof store.data !== "object") store.data = {};
  if (!Array.isArray(store.data.outbox)) store.data.outbox = [];
  return store.data.outbox;
}

// ── Event-listeners (in-process, best-effort) ───────────────────────────────
// De automation-engine (E11) registreert zich hier. Deze module blijft
// cloudblind: geen import van automation · enkel een callback-contract.
const listeners = [];
function registerEventListener(fn) { if (typeof fn === "function") listeners.push(fn); }
function notifyListeners(store, event) {
  for (const fn of listeners) {
    try { fn(store, event); } catch (_) { /* een listener mag de domain-write nooit breken */ }
  }
}

// ── Duurzame outbox-sink (CTO P0-05) ────────────────────────────────────────
// De server injecteert hier de pg-adapter-koppeling: elk nieuw event en elke
// statuswijziging gaat óók naar de duurzame outbox-tabel, die in DEZELFDE
// transactie als de staat commit. Deze module blijft cloudblind: alleen een
// callback-contract, geen SQL of adapterkennis. Zonder sink (json-adapter,
// tests) verandert er niets.
let outboxSink = null;
function registerOutboxSink(sink) {
  outboxSink = sink && typeof sink.append === "function" && typeof sink.status === "function" ? sink : null;
}
function sinkAppend(event) {
  if (outboxSink) { try { outboxSink.append(event); } catch (_) { /* sink mag de write nooit breken */ } }
}
function sinkStatus(update) {
  if (outboxSink) { try { outboxSink.status(update); } catch (_) { /* idem */ } }
}

/**
 * Emit een domeinevent naar de outbox.
 * @param {object} store
 * @param {{ tenantId:string, companyId?:string|null, eventType:string,
 *           aggregateType:string, aggregateId:string, actor?:string,
 *           correlationId?:string|null, causationId?:string|null,
 *           data?:object }} input
 * @returns het opgeslagen event (envelope + delivery-metadata)
 */
function emitDomainEvent(store, input) {
  const {
    tenantId, companyId = null, eventType, aggregateType, aggregateId,
    actor = "system", correlationId = null, causationId = null, data = {},
  } = input || {};
  if (!tenantId) throw new Error("emitDomainEvent: tenantId is verplicht");
  if (!EVENT_TYPE_RE.test(String(eventType || ""))) throw new Error(`emitDomainEvent: ongeldig eventType '${eventType}' (verwacht "resource.action")`);
  if (!aggregateType || !aggregateId) throw new Error("emitDomainEvent: aggregateType en aggregateId zijn verplicht");

  const event = {
    id: `evt_${newUlid()}`,
    eventType,
    tenantId,
    companyId,
    aggregateType,
    aggregateId,
    occurredAt: new Date().toISOString(),
    correlationId: correlationId || `corr_${newUlid()}`,
    causationId,
    version: 1,
    data: data && typeof data === "object" ? data : {},
    // Delivery-metadata (E19): niet mee-geserialiseerd in de webhook-envelope.
    actor,
    delivery: { status: "pending", attempts: 0, nextAttemptAt: null, lastError: null },
  };
  const outbox = ensureOutbox(store);
  outbox.push(event);
  if (outbox.length > OUTBOX_LIMIT) store.data.outbox = outbox.slice(-OUTBOX_LIMIT);
  if (typeof store.save === "function") store.save();
  // Duurzame kopie: commit samen met de staat (of helemaal niet). De cap
  // hierboven kan oude events uit het WERKGEHEUGEN knippen; de tabel niet.
  sinkAppend(event);
  notifyListeners(store, event);
  return event;
}

/** Outbox-inzage (ops/E19): filter op status/tenant/eventType, nieuwste eerst. */
function listOutbox(store, { status, tenantId, eventType, limit = 50 } = {}) {
  return ensureOutbox(store)
    .filter(e => (!status || e.delivery.status === status)
      && (!tenantId || e.tenantId === tenantId)
      && (!eventType || e.eventType === eventType))
    .slice()
    .reverse()
    .slice(0, Math.min(Number(limit) || 50, 200));
}

/** Markeer bezorgd (E19-dispatcher). */
function markEventDelivered(store, eventId) {
  const e = ensureOutbox(store).find(x => x.id === eventId);
  if (!e) return null;
  e.delivery = { ...e.delivery, status: "delivered", deliveredAt: new Date().toISOString(), lastError: null };
  if (typeof store.save === "function") store.save();
  sinkStatus({ id: eventId, status: "delivered", attempts: e.delivery.attempts });
  return e;
}

/** Markeer mislukt; na maxAttempts → dead-letter (h46). */
function markEventFailed(store, eventId, error, maxAttempts = 8) {
  const e = ensureOutbox(store).find(x => x.id === eventId);
  if (!e) return null;
  const attempts = (e.delivery.attempts || 0) + 1;
  const dead = attempts >= maxAttempts;
  // Exponential backoff: 1m, 2m, 4m, ... (cap 6u).
  const backoffMs = Math.min(60000 * 2 ** (attempts - 1), 6 * 3600000);
  e.delivery = {
    ...e.delivery,
    status: dead ? "dead_letter" : "pending",
    attempts,
    nextAttemptAt: dead ? null : new Date(Date.now() + backoffMs).toISOString(),
    lastError: String(error || "").slice(0, 300),
  };
  if (typeof store.save === "function") store.save();
  if (dead) sinkStatus({ id: eventId, status: "dead_letter", attempts, lastError: e.delivery.lastError });
  return e;
}

module.exports = { newUlid, emitDomainEvent, listOutbox, markEventDelivered, markEventFailed, registerEventListener, registerOutboxSink };
