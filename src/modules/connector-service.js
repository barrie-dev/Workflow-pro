"use strict";

// ── Connector-service · store-gebonden integratielaag (INT-01) ───────────────
// Materialiseert het PURE connectorframework (src/platform/connector-framework.js)
// op de platform-store. Alle integraties (Peppol, boekhouding, payroll, SSO, ...)
// delen dezelfde bouwstenen: catalogus (manifest), connections per tenant en
// onderneming, credentials als secret-referentie, mappings met versie/geldigheid,
// sync jobs + sync items met correlation-id en retry/reconciliatie, en een
// audit/technisch eventspoor. Een provideradapter introduceert GEEN eigen losse
// credentials-, mapping-, logging- of retryimplementatie (A09) en vertaalt enkel
// tussen het canonieke Monargo-model en het providercontract (A10).
//
// Harde regels die deze laag afdwingt:
//  - Elke tenantquery draagt tenantId en waar relevant companyId; cross-tenant
//    lezen of muteren is onmogelijk (get + expliciete tenant-check, A14).
//  - Credentials worden versleuteld of als secret-referentie bewaard, NOOIT in
//    gewone data of logs, en komen NOOIT terug in een read/GET (A13). De
//    ontsleutelde waarde is enkel server-side beschikbaar (resolveCredentialSecret).
//  - Providerwebhooks lopen via het bestaande src/platform/webhooks.js (signing,
//    delivery, DLQ, replay) · hier NIET gedupliceerd (A15).
//
// Deze module vervangt src/modules/integrations.js niet: die blijft de bestaande
// snelkoppel-UI voor Robaws/Exact. connector-service is het gegeneraliseerde
// INT-01-framework waar de nieuwe P0-connectoren op landen.

const crypto = require("crypto");
const F = require("../platform/connector-framework");
const { encryptSecret, decryptSecret } = require("../lib/security");
const { maskSecret } = require("../ports/secret-provider");
const { makeWebhookRepository } = require("../platform/webhooks");

// ── Collecties (registreren in REQUIRED_COLLECTIONS · zie return-nota) ────────
const C_CONNECTORS = "integrationConnectors";   // platformcatalogus (tenantId: null)
const C_CONNECTIONS = "integrationConnections";  // tenant/company-verbinding
const C_CREDENTIALS = "integrationCredentials";  // versleutelde secret-referenties
const C_MAPPINGS = "integrationMappings";        // veld/code -> providerwaarde (versie/geldigheid)
const C_SYNC_JOBS = "integrationSyncJobs";       // batch/geplande sync
const C_SYNC_ITEMS = "integrationSyncItems";     // resultaat per bronrecord
const C_EVENTS = "integrationEvents";            // audit + technische events (A08)

const RETRY_MAX_ATTEMPTS = 8;

// ── Kleine helpers (repo-conventie) ──────────────────────────────────────────
function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
function id(prefix) { return `${prefix}_${crypto.randomBytes(9).toString("hex")}`; }
function nowIso() { return new Date().toISOString(); }
function clean(v) { return String(v == null ? "" : v).trim(); }
function actorEmail(actor) { return (actor && actor.email) || "system"; }
function tenantIdOf(tenant) {
  const t = typeof tenant === "string" ? tenant : (tenant && tenant.id);
  if (!clean(t)) throw err(400, "TENANT_REQUIRED", "tenant is verplicht");
  return clean(t);
}
function retryBackoffMs(attempts) { return Math.min(60000 * 2 ** (Math.max(1, attempts) - 1), 6 * 3600000); }

// Verwijder secret-achtige velden uit metadata voordat ze in een event/audit
// belanden · laatste verdedigingslijn tegen een gelekte sleutel (A13).
function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object") return meta == null ? {} : { value: String(meta) };
  const out = Array.isArray(meta) ? [] : {};
  for (const [k, v] of Object.entries(meta)) {
    if (F.RAW_SECRET_FIELDS.includes(k)) { out[k] = "[REDACTED]"; continue; }
    out[k] = v && typeof v === "object" ? sanitizeMeta(v) : v;
  }
  return out;
}

// ── Audit + technisch eventspoor (A08 · integration_events) ──────────────────
/**
 * Schrijf een integratie-event (A08): actor, tenant, company, connector, actie,
 * resultaat en metadata. Legt zowel het domeinspoor (integrationEvents) als de
 * platform-audittrail (store.audit) vast. Metadata wordt van secrets ontdaan.
 */
function recordEvent(store, { tenantId = null, companyId = null, connector = "", actor, action, result = "ok", metadata = {} }) {
  const safeMeta = sanitizeMeta(metadata);
  const row = {
    id: id("ievt"), tenantId: tenantId || null, companyId: companyId || null,
    connector: clean(connector), actor: actorEmail(actor), action: clean(action),
    result: clean(result) || "ok", metadata: safeMeta, at: nowIso(),
  };
  store.insert(C_EVENTS, row);
  store.audit({
    actor: row.actor, tenantId: row.tenantId, area: "integrations",
    action: `integration_${row.action}`,
    detail: `${row.connector || "-"} result=${row.result}`,
  });
  return row;
}

/** Integratie-events opvragen (tenant-scoped of platformbreed met tenantId:null). */
function listEvents(store, tenantId, { connector = null, action = null, result = null, limit = 100 } = {}) {
  return (store.data[C_EVENTS] || [])
    .filter(e => (tenantId == null ? true : e.tenantId === tenantId)
      && (!connector || e.connector === connector)
      && (!action || e.action === action)
      && (!result || e.result === result))
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, Math.min(Number(limit) || 100, 1000));
}

// ── Catalogus · connector-manifests (Super Admin / platformscope) ────────────
/**
 * Registreer of werk een connector-manifest bij (A01). Platformbreed
 * (tenantId: null). Idempotent op de manifest-sleutel: dezelfde key werkt het
 * bestaande manifest bij i.p.v. te dupliceren. Bewaakt tegelijk de
 * architectuurregel (A09/A10): een manifest mag geen platform-concerns smokkelen.
 */
function registerConnector(store, manifest, actor) {
  F.assertManifest(manifest);
  F.assertAdapterBoundary(manifest);
  const key = clean(manifest.key) || clean(manifest.name).toLowerCase().replace(/\s+/g, "_");
  const existing = (store.data[C_CONNECTORS] || []).find(c => c.key === key);
  const base = {
    key,
    name: clean(manifest.name),
    category: manifest.category,
    capabilities: manifest.capabilities.map(c => F.parseCapability(c).key),
    authType: manifest.authType,
    scopes: Array.isArray(manifest.scopes) ? manifest.scopes.map(clean).filter(Boolean) : [],
    syncModes: manifest.syncModes.slice(),
    webhookSupport: !!manifest.webhookSupport,
    sandboxStatus: manifest.sandboxStatus,
    entitlement: clean(manifest.entitlement),
    updatedAt: nowIso(), updatedBy: actorEmail(actor),
  };
  let row;
  if (existing) {
    row = store.update(C_CONNECTORS, existing.id, base);
  } else {
    row = store.insert(C_CONNECTORS, { id: id("conn"), tenantId: null, createdAt: nowIso(), createdBy: actorEmail(actor), ...base });
  }
  recordEvent(store, { tenantId: null, connector: key, actor, action: existing ? "connector_updated" : "connector_registered", metadata: { category: base.category } });
  return row;
}

/** Catalogus opvragen (publiek · manifests dragen geen secrets). */
function listConnectors(store, { category = null, entitlement = null } = {}) {
  return (store.data[C_CONNECTORS] || [])
    .filter(c => (!category || c.category === category) && (!entitlement || c.entitlement === entitlement))
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Eén manifest opvragen op id of key. */
function getConnector(store, connectorRef) {
  const ref = clean(connectorRef);
  const row = (store.data[C_CONNECTORS] || []).find(c => c.id === ref || c.key === ref);
  if (!row) throw err(404, "CONNECTOR_NOT_FOUND", "connector niet gevonden");
  return row;
}

// ── Connections · tenant + onderneming (A02) ─────────────────────────────────
function connectionsOf(store, tenantId) {
  return (store.data[C_CONNECTIONS] || []).filter(c => c.tenantId === tenantId);
}

/**
 * Haal een connection op en dwing tenant-eigenaarschap af. Cross-tenant lezen of
 * muteren is onmogelijk: een vreemde tenant krijgt 404 (niet 403, om het bestaan
 * niet te lekken). store.get scoopt NIET op tenant · daarom deze check (A14).
 */
function requireConnection(store, tenant, connectionId) {
  const tenantId = tenantIdOf(tenant);
  const row = store.get(C_CONNECTIONS, clean(connectionId));
  if (!row || row.tenantId !== tenantId) throw err(404, "CONNECTION_NOT_FOUND", "connection niet gevonden");
  return row;
}

/**
 * Maak een nieuwe connection aan (A02). Start altijd als "draft" met health
 * "unknown". Verwerpt inline ruwe secrets (A13, via assertConnection); credentials
 * horen apart in integration_credentials. Eén source of truth per onderneming:
 * een tweede niet-ingetrokken connection voor dezelfde tenant+company+provider+
 * environment wordt geweigerd (A11/A12).
 */
function createConnection(store, tenant, payload, actor) {
  const tenantId = tenantIdOf(tenant);
  const companyId = clean(payload.companyId) || null;
  let connectorId = null, entitlement = null;
  let provider = clean(payload.provider);
  if (clean(payload.connectorId) || (!provider && clean(payload.connector))) {
    const connector = getConnector(store, payload.connectorId || payload.connector);
    connectorId = connector.id;
    entitlement = connector.entitlement || null;
    provider = provider || connector.key;
  }
  const connection = {
    tenantId, companyId, connectorId, provider,
    environment: payload.environment,
    status: "draft",
    externalAccount: clean(payload.externalAccount) || null,
    health: "unknown",
    entitlement,
    ...pickForbiddenSecretProbe(payload), // laat assertConnection een smokkelpoging zien
  };
  F.assertConnection(connection);
  // Dedup: nooit twee actieve eigenaars voor hetzelfde object/onderneming.
  const dup = connectionsOf(store, tenantId).find(c =>
    c.provider === provider && (c.companyId || null) === companyId
    && c.environment === connection.environment && c.status !== "revoked");
  if (dup) throw err(409, "CONNECTION_EXISTS", "er bestaat al een actieve connection voor deze onderneming, provider en omgeving");
  const row = store.insert(C_CONNECTIONS, {
    id: id("icx"), createdAt: nowIso(), createdBy: actorEmail(actor), updatedAt: nowIso(),
    lastHealthAt: null, ...connection,
  });
  recordEvent(store, { tenantId, companyId, connector: provider, actor, action: "connection_created", metadata: { environment: connection.environment } });
  return publicConnection(row);
}

// Alleen de secret-probevelden doorlaten zodat assertConnection een ruwe-secret-
// smokkelpoging op de connection zelf kan afvangen (A13), zonder ze op te slaan.
function pickForbiddenSecretProbe(payload) {
  const probe = {};
  for (const k of F.RAW_SECRET_FIELDS) if (payload && clean(payload[k])) probe[k] = payload[k];
  return probe;
}

/** Connections van een tenant, optioneel gefilterd op onderneming (A14). */
function listConnections(store, tenant, { companyId = null, status = null } = {}) {
  const tenantId = tenantIdOf(tenant);
  return connectionsOf(store, tenantId)
    .filter(c => (companyId == null || (c.companyId || null) === (clean(companyId) || null))
      && (!status || c.status === status))
    .map(publicConnection);
}

/** Eén connection opvragen (tenant-scoped, publiek). */
function getConnection(store, tenant, connectionId) {
  return publicConnection(requireConnection(store, tenant, connectionId));
}

/** Generieke statusovergang op een connection (A02 · lifecycle via het framework). */
function setConnectionStatus(store, tenant, connectionId, to, actor) {
  const row = requireConnection(store, tenant, connectionId);
  F.assertConnectionTransition(row.status, to);
  const patch = { status: to, updatedAt: nowIso() };
  // Bij intrekken vervallen de actieve credentials mee (secret niet meer bruikbaar).
  if (to === "revoked") {
    for (const cr of credentialsOf(store, row.id).filter(c => c.status === "active")) {
      store.update(C_CREDENTIALS, cr.id, { status: "revoked", updatedAt: nowIso() });
    }
  }
  const next = store.update(C_CONNECTIONS, row.id, patch);
  recordEvent(store, { tenantId: row.tenantId, companyId: row.companyId, connector: row.provider, actor, action: `connection_${to}`, metadata: { from: row.status } });
  return publicConnection(next);
}
function activateConnection(store, tenant, connectionId, actor) { return setConnectionStatus(store, tenant, connectionId, "connected", actor); }
function pauseConnection(store, tenant, connectionId, actor) { return setConnectionStatus(store, tenant, connectionId, "disconnected", actor); }
function revokeConnection(store, tenant, connectionId, actor) { return setConnectionStatus(store, tenant, connectionId, "revoked", actor); }

/** Health-signaal registreren (A02 · monitoringssignaal, geen lifecycle). */
function recordConnectionHealth(store, tenant, connectionId, health, actor) {
  const row = requireConnection(store, tenant, connectionId);
  F.assertHealth(health);
  const next = store.update(C_CONNECTIONS, row.id, { health, lastHealthAt: nowIso(), updatedAt: nowIso() });
  recordEvent(store, { tenantId: row.tenantId, companyId: row.companyId, connector: row.provider, actor, action: "connection_health", result: health, metadata: { health } });
  return publicConnection(next);
}

// Publieke connection-weergave · draagt nooit een secret (secrets leven apart).
function publicConnection(row) {
  return {
    id: row.id, tenantId: row.tenantId, companyId: row.companyId || null,
    connectorId: row.connectorId || null, provider: row.provider,
    environment: row.environment, status: row.status,
    externalAccount: row.externalAccount || null,
    health: row.health || "unknown", lastHealthAt: row.lastHealthAt || null,
    entitlement: row.entitlement || null,
    createdAt: row.createdAt, updatedAt: row.updatedAt || row.createdAt,
  };
}

// ── Credentials · secret-referentie (A13) ────────────────────────────────────
function credentialsOf(store, connectionId) {
  return (store.data[C_CREDENTIALS] || []).filter(c => c.connectionId === connectionId);
}

/**
 * Sla een credential op voor een connection. Twee vormen, allebei nooit plain:
 *  - value            → symmetrisch versleuteld (AES-256-GCM) opgeslagen;
 *  - secretReference  → externe vault-referentie (secret leeft buiten Monargo).
 * De ontsleutelde waarde komt NOOIT terug in een read. Bij aanmaak wordt enkel
 * een hint (laatste tekens) EENMALIG bevestigd; elke latere read geeft dezelfde
 * hint maar nooit de waarde. Nieuwe versie superseedt de vorige (rotatie).
 */
function storeCredential(store, tenant, connectionId, payload, actor) {
  const connection = requireConnection(store, tenant, connectionId);
  const value = clean(payload.value);
  const secretReference = clean(payload.secretReference);
  if (!value && !secretReference) throw err(400, "CREDENTIAL_REQUIRED", "een secret-waarde of een secret-referentie is verplicht");
  const existing = credentialsOf(store, connection.id);
  const version = existing.reduce((m, c) => Math.max(m, Number(c.version) || 0), 0) + 1;
  // Vorige actieve credential markeren als superseded (rotatiehistoriek blijft).
  for (const c of existing.filter(c => c.status === "active")) {
    store.update(C_CREDENTIALS, c.id, { status: "superseded", updatedAt: nowIso() });
  }
  const hint = value ? maskSecret(value) : `ref:${maskSecret(secretReference)}`;
  const row = store.insert(C_CREDENTIALS, {
    id: id("icred"), tenantId: connection.tenantId, companyId: connection.companyId || null,
    connectionId: connection.id,
    // Precies één van beide is gevuld; de andere blijft leeg. Nooit de plain waarde.
    encryptedSecret: value ? encryptSecret(value) : "",
    secretReference: secretReference || "",
    authType: clean(payload.authType) || connection.authType || "secret_reference",
    hint, version, status: "active",
    createdAt: nowIso(), createdBy: actorEmail(actor), updatedAt: nowIso(),
  });
  recordEvent(store, { tenantId: connection.tenantId, companyId: connection.companyId, connector: connection.provider, actor, action: version > 1 ? "credential_rotated" : "credential_stored", metadata: { version } });
  // EENMALIGE bevestiging bij aanmaak: hint + versie, NOOIT de waarde.
  return publicCredential(row);
}

/** Actieve credential van een connection, publiek (nooit de waarde). */
function getCredential(store, tenant, connectionId) {
  const connection = requireConnection(store, tenant, connectionId);
  const active = credentialsOf(store, connection.id).find(c => c.status === "active");
  if (!active) throw err(404, "CREDENTIAL_NOT_FOUND", "geen actieve credential voor deze connection");
  return publicCredential(active);
}

/** Volledige (publieke) credential-historiek van een connection · geen waarden. */
function listCredentials(store, tenant, connectionId) {
  const connection = requireConnection(store, tenant, connectionId);
  return credentialsOf(store, connection.id)
    .slice().sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0))
    .map(publicCredential);
}

/**
 * SERVER-SIDE ONTSLEUTELING · UITSLUITEND voor adaptergebruik binnen de server.
 * Geeft de bruikbare waarde of externe referentie terug. Deze functie mag NOOIT
 * aan een HTTP-response worden gekoppeld · ze bestaat zodat een adapter kan
 * verbinden zonder de secret elders te dupliceren.
 */
function resolveCredentialSecret(store, tenant, connectionId) {
  const connection = requireConnection(store, tenant, connectionId);
  const active = credentialsOf(store, connection.id).find(c => c.status === "active");
  if (!active) throw err(404, "CREDENTIAL_NOT_FOUND", "geen actieve credential voor deze connection");
  return {
    connectionId: connection.id,
    authType: active.authType,
    version: active.version,
    value: active.encryptedSecret ? decryptSecret(active.encryptedSecret) : "",
    secretReference: active.secretReference || "",
  };
}

// Publieke credential-weergave · strippt encryptedSecret/secretReference/value.
function publicCredential(row) {
  return {
    id: row.id, connectionId: row.connectionId, tenantId: row.tenantId, companyId: row.companyId || null,
    authType: row.authType, version: row.version, status: row.status,
    hint: row.hint, hasSecret: !!(row.encryptedSecret || row.secretReference),
    createdAt: row.createdAt, createdBy: row.createdBy,
  };
}

// ── Mappings · versie + geldigheidsperiode (A04) ─────────────────────────────
function mappingsOf(store, connectionId) {
  return (store.data[C_MAPPINGS] || []).filter(m => m.connectionId === connectionId);
}

/**
 * Voeg een mapping toe (A04). Versie is optioneel: ontbreekt ze, dan wordt de
 * hoogste bestaande versie voor hetzelfde veld/code + 1 genomen. Historische
 * mappings blijven staan · resolveMapping kiest de geldige, hoogste versie.
 */
function addMapping(store, tenant, connectionId, payload, actor) {
  const connection = requireConnection(store, tenant, connectionId);
  const key = clean(payload.localField) || clean(payload.code);
  let version = payload.version;
  if (version == null) {
    version = mappingsOf(store, connection.id)
      .filter(m => (m.localField || m.code) === key)
      .reduce((mx, m) => Math.max(mx, Number(m.version) || 0), 0) + 1;
  }
  const candidate = {
    connectionId: connection.id, tenantId: connection.tenantId, companyId: connection.companyId || null,
    localField: clean(payload.localField) || null, code: clean(payload.code) || null,
    providerValue: payload.providerValue,
    direction: payload.direction || null,
    version,
    validFrom: payload.validFrom || null, validTo: payload.validTo || null,
  };
  F.assertMapping(candidate);
  const row = store.insert(C_MAPPINGS, { id: id("imap"), createdAt: nowIso(), createdBy: actorEmail(actor), ...candidate });
  recordEvent(store, { tenantId: connection.tenantId, companyId: connection.companyId, connector: connection.provider, actor, action: "mapping_added", metadata: { key, version } });
  return row;
}

/** Mappings van een connection (tenant-scoped). */
function listMappings(store, tenant, connectionId) {
  const connection = requireConnection(store, tenant, connectionId);
  return mappingsOf(store, connection.id).slice();
}

/**
 * Resolveer de geldige mapping voor een veld/code op een moment `at` via de pure
 * framework-resolutie (hoogste versie binnen [validFrom, validTo)). Geen match =
 * null.
 */
function resolveMapping(store, tenant, connectionId, key, at) {
  const connection = requireConnection(store, tenant, connectionId);
  return F.resolveMapping(mappingsOf(store, connection.id), key, at);
}

// ── Sync jobs + sync items (A05 / A06) ───────────────────────────────────────
function jobsOf(store, tenantId) {
  return (store.data[C_SYNC_JOBS] || []).filter(j => j.tenantId === tenantId);
}
function itemsOf(store, jobId) {
  return (store.data[C_SYNC_ITEMS] || []).filter(i => i.syncJobId === jobId);
}
function requireSyncJob(store, tenant, jobId) {
  const tenantId = tenantIdOf(tenant);
  const row = store.get(C_SYNC_JOBS, clean(jobId));
  if (!row || row.tenantId !== tenantId) throw err(404, "SYNC_JOB_NOT_FOUND", "sync job niet gevonden");
  return row;
}

/**
 * Start een sync job (A05). Correlation-id is verplicht voor traceerbaarheid;
 * ontbreekt hij, dan genereren we er een. Tweerichtingssync vereist een expliciet
 * conflictbeleid (A11, afgedwongen door assertSyncJob).
 */
function startSyncJob(store, tenant, connectionId, payload, actor) {
  const connection = requireConnection(store, tenant, connectionId);
  const correlationId = clean(payload.correlationId) || id("corr");
  const job = {
    connectionId: connection.id, tenantId: connection.tenantId, companyId: connection.companyId || null,
    provider: connection.provider,
    direction: payload.direction,
    schedule: clean(payload.schedule) || null,
    cursor: payload.cursor != null ? payload.cursor : null,
    status: "queued",
    correlationId,
    conflictPolicy: payload.conflictPolicy || null,
    counts: { processed: 0, succeeded: 0, failed: 0 },
    retry: { attempts: 0, maxAttempts: Number(payload.maxAttempts) || RETRY_MAX_ATTEMPTS, lastAttemptAt: null, nextAttemptAt: null },
  };
  F.assertSyncJob(job);
  const row = store.insert(C_SYNC_JOBS, { id: id("isj"), createdAt: nowIso(), createdBy: actorEmail(actor), updatedAt: nowIso(), ...job });
  recordEvent(store, { tenantId: connection.tenantId, companyId: connection.companyId, connector: connection.provider, actor, action: "syncjob_started", metadata: { correlationId, direction: job.direction } });
  return publicSyncJob(row);
}

/** Statusovergang op een sync job (A05 · lifecycle via het framework). */
function transitionSyncJob(store, tenant, jobId, to, patch = {}, actor) {
  const row = requireSyncJob(store, tenant, jobId);
  F.assertSyncJobTransition(row.status, to);
  const next = {
    status: to, updatedAt: nowIso(),
    counts: patch.counts ? { ...row.counts, ...patch.counts } : row.counts,
    cursor: patch.cursor !== undefined ? patch.cursor : row.cursor,
  };
  if (patch.error !== undefined) next.lastError = clean(patch.error) || null;
  const saved = store.update(C_SYNC_JOBS, row.id, next);
  recordEvent(store, { tenantId: row.tenantId, companyId: row.companyId, connector: row.provider, actor, action: `syncjob_${to}`, result: to === "failed" ? "error" : "ok", metadata: { from: row.status, correlationId: row.correlationId } });
  return publicSyncJob(saved);
}

/**
 * Retry van een sync job. Enkel vanuit failed/partial: de openstaande items
 * worden opnieuw aangeboden (failed/partial -> retrying), de retry-teller loopt op
 * en er wordt een backoff gezet. IDEMPOTENT: staat de job al te wachten of te
 * lopen (queued/running/retrying), dan gebeurt er niets nieuws en komt de
 * bestaande job terug met duplicate:true. Terminale jobs (succeeded/cancelled)
 * kunnen niet opnieuw.
 */
function retrySyncJob(store, tenant, jobId, actor) {
  const row = requireSyncJob(store, tenant, jobId);
  if (F.isTerminal("sync_job", row.status)) throw err(409, "SYNC_JOB_TERMINAL", `een ${row.status} sync job kan niet opnieuw`);
  if (["queued", "running", "retrying"].includes(row.status)) {
    return { job: publicSyncJob(row), duplicate: true };
  }
  const attempts = (row.retry && row.retry.attempts || 0) + 1;
  if (attempts > (row.retry && row.retry.maxAttempts || RETRY_MAX_ATTEMPTS)) {
    throw err(409, "SYNC_JOB_RETRY_EXHAUSTED", "maximaal aantal retries bereikt · dead-letter");
  }
  F.assertSyncJobTransition(row.status, "retrying");
  const retry = { ...(row.retry || {}), attempts, lastAttemptAt: nowIso(), nextAttemptAt: new Date(Date.now() + retryBackoffMs(attempts)).toISOString() };
  const saved = store.update(C_SYNC_JOBS, row.id, { status: "retrying", retry, updatedAt: nowIso() });
  recordEvent(store, { tenantId: row.tenantId, companyId: row.companyId, connector: row.provider, actor, action: "syncjob_retried", metadata: { attempts, correlationId: row.correlationId } });
  return { job: publicSyncJob(saved), duplicate: false };
}

/**
 * Registreer één sync item (A06): bronrecord, doelrecord, mappingstatus,
 * foutcode en reconciliatiestatus. Werkt meteen de tellers van de job bij.
 * Een item met mappingstatus "error" vereist een foutcode (framework).
 */
function recordSyncItem(store, tenant, jobId, payload, actor) {
  const job = requireSyncJob(store, tenant, jobId);
  const item = {
    syncJobId: job.id, tenantId: job.tenantId, companyId: job.companyId || null,
    sourceRecord: payload.sourceRecord,
    targetRecord: payload.targetRecord != null ? payload.targetRecord : null,
    mappingStatus: payload.mappingStatus,
    errorCode: clean(payload.errorCode) || null,
    reconciliationStatus: payload.reconciliationStatus || "pending",
    correlationId: job.correlationId,
  };
  F.assertSyncItem(item);
  const row = store.insert(C_SYNC_ITEMS, { id: id("isi"), createdAt: nowIso(), ...item });
  const failed = item.mappingStatus === "error";
  const counts = {
    processed: (job.counts && job.counts.processed || 0) + 1,
    succeeded: (job.counts && job.counts.succeeded || 0) + (failed ? 0 : 1),
    failed: (job.counts && job.counts.failed || 0) + (failed ? 1 : 0),
  };
  store.update(C_SYNC_JOBS, job.id, { counts, updatedAt: nowIso() });
  return row;
}

/**
 * Werk de reconciliatiestatus van een sync item bij (A06). Alleen een geldige
 * reconciliatiestatus wordt aanvaard; historische bron/doel blijven staan.
 */
function reconcileSyncItem(store, tenant, itemId, reconciliationStatus, actor) {
  const tenantId = tenantIdOf(tenant);
  const row = store.get(C_SYNC_ITEMS, clean(itemId));
  if (!row || row.tenantId !== tenantId) throw err(404, "SYNC_ITEM_NOT_FOUND", "sync item niet gevonden");
  if (!F.RECONCILIATION_STATUSES.includes(reconciliationStatus)) {
    throw err(400, "RECONCILIATION_STATUS_INVALID", `reconciliatiestatus moet een van ${F.RECONCILIATION_STATUSES.join(", ")} zijn`);
  }
  const saved = store.update(C_SYNC_ITEMS, row.id, { reconciliationStatus, reconciledAt: nowIso() });
  recordEvent(store, { tenantId: row.tenantId, companyId: row.companyId, connector: "", actor, action: "syncitem_reconciled", metadata: { reconciliationStatus } });
  return saved;
}

/** Sync jobs van een tenant (tenant-scoped), optioneel per connection/status. */
function listSyncJobs(store, tenant, { connectionId = null, status = null } = {}) {
  const tenantId = tenantIdOf(tenant);
  return jobsOf(store, tenantId)
    .filter(j => (!connectionId || j.connectionId === connectionId) && (!status || j.status === status))
    .slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(publicSyncJob);
}

/** Sync items van een job (tenant-scoped), optioneel gefilterd. */
function listSyncItems(store, tenant, jobId, { mappingStatus = null, reconciliationStatus = null } = {}) {
  const job = requireSyncJob(store, tenant, jobId);
  return itemsOf(store, job.id)
    .filter(i => (!mappingStatus || i.mappingStatus === mappingStatus)
      && (!reconciliationStatus || i.reconciliationStatus === reconciliationStatus))
    .slice();
}

/** Samenvatting van een job: tellers + reconciliatie-verdeling (integratiebeheer). */
function syncJobSummary(store, tenant, jobId) {
  const job = requireSyncJob(store, tenant, jobId);
  const items = itemsOf(store, job.id);
  const recon = {};
  for (const s of F.RECONCILIATION_STATUSES) recon[s] = 0;
  for (const it of items) recon[it.reconciliationStatus] = (recon[it.reconciliationStatus] || 0) + 1;
  return {
    jobId: job.id, status: job.status, correlationId: job.correlationId,
    counts: job.counts, retry: job.retry,
    items: items.length, reconciliation: recon,
    openReconciliation: items.filter(i => ["pending", "unmatched", "conflict"].includes(i.reconciliationStatus)).length,
    needsAttention: job.status === "failed" || items.some(i => ["unmatched", "conflict"].includes(i.reconciliationStatus)),
  };
}

function publicSyncJob(row) {
  return {
    id: row.id, connectionId: row.connectionId, tenantId: row.tenantId, companyId: row.companyId || null,
    provider: row.provider, direction: row.direction, schedule: row.schedule || null,
    cursor: row.cursor != null ? row.cursor : null, status: row.status,
    correlationId: row.correlationId, conflictPolicy: row.conflictPolicy || null,
    counts: row.counts, retry: row.retry, lastError: row.lastError || null,
    createdAt: row.createdAt, updatedAt: row.updatedAt || row.createdAt,
  };
}

// ── Providerwebhooks · hergebruik van de bestaande runtime (A07/A15) ─────────
/**
 * Geef de gedeelde webhook-repository terug (signing, DLQ, replay leven in
 * src/platform/webhooks.js). Connector-webhooks worden NIET hier opnieuw
 * geïmplementeerd · deze haak bestaat zodat de routelaag dezelfde runtime deelt.
 */
function webhookRepository(store) { return makeWebhookRepository(store); }

module.exports = {
  // collecties (voor de store-registratie in de integratiestap)
  COLLECTIONS: {
    connectors: C_CONNECTORS, connections: C_CONNECTIONS, credentials: C_CREDENTIALS,
    mappings: C_MAPPINGS, syncJobs: C_SYNC_JOBS, syncItems: C_SYNC_ITEMS, events: C_EVENTS,
  },
  RETRY_MAX_ATTEMPTS,
  // catalogus
  registerConnector, listConnectors, getConnector,
  // connections
  createConnection, listConnections, getConnection, requireConnection,
  setConnectionStatus, activateConnection, pauseConnection, revokeConnection, recordConnectionHealth,
  // credentials
  storeCredential, getCredential, listCredentials, resolveCredentialSecret,
  // mappings
  addMapping, listMappings, resolveMapping,
  // sync jobs + items
  startSyncJob, transitionSyncJob, retrySyncJob, recordSyncItem, reconcileSyncItem,
  listSyncJobs, listSyncItems, syncJobSummary,
  // events + webhooks
  recordEvent, listEvents, webhookRepository,
  // publieke views (voor hergebruik/tests)
  publicConnection, publicCredential, publicSyncJob,
};
