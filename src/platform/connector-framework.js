"use strict";

// ── Gedeeld connectorframework · pure model- en vertaallaag (INT-01) ──────────
// Sectie 4 + 17.1 van de handover "Integraties, Usage & Billing". Alle
// integraties (Peppol, boekhouding, payroll, SSO, ...) gebruiken DEZELFDE
// platformcomponenten. Een provideradapter introduceert GEEN eigen losse
// credentials-, mapping-, logging- of retryimplementatie (A09) en vertaalt
// UITSLUITEND tussen het canonieke Monargo-model en het providercontract (A10).
//
// Deze module is bewust PUUR: geen store, geen I/O, geen netwerk. Ze levert het
// canonieke model (enums), de validatoren (die veldfouten teruggeven), de
// statusmachines (connection-status en sync-job-status) met assertTransition,
// de mappingresolutie op versie + geldigheidsperiode, en de architectuurbewaking.
// Businessregels, rechten, usagebilling en source-of-truth-beslissingen horen
// NIET hier maar in de platform- en domeinlaag.

// ── Canoniek model · enums ───────────────────────────────────────────────────

// Categorieen van connectoren in de platformcatalogus (manifest · A01).
const CONNECTOR_CATEGORIES = [
  "peppol",        // e-facturatie via een Access Point
  "accounting",    // boekhoudpakket (bv. Exact Online)
  "payroll",       // sociaal secretariaat / loonverwerking
  "identity",      // SSO / tenant-IdP
  "productivity",  // Microsoft 365 en aanverwant
  "compliance",    // wettelijke aangiften (bv. Checkin@Work, Dimona)
  "developer",     // developer API en tenant-webhooks
  "generic",       // generieke REST-koppeling
];

// Authenticatietypes die een connector kan vereisen (manifest · A01).
const AUTH_TYPES = ["oauth2", "apikey", "basic", "certificate", "mtls", "secret_reference", "none"];

// Syncmodi die een connector ondersteunt (manifest · A01).
const SYNC_MODES = ["push", "pull", "bidirectional", "scheduled", "webhook", "manual"];

// Sandboxstatus van een connector (manifest · A01).
const SANDBOX_STATES = ["available", "required", "certified", "unavailable"];

// Omgeving van een concrete connection (A02). Sandbox of productie.
const ENVIRONMENTS = ["sandbox", "production"];

// Toegestane acties in een capability-sleutel object.actie (A03).
// Voorbeelden: customers.read, invoices.write, payroll.export.
const CAPABILITY_ACTIONS = ["read", "write", "list", "export", "import", "sync", "delete"];

// Richting van een sync job (A05) en van een mapping (A04).
const SYNC_DIRECTIONS = ["push", "pull", "bidirectional"];

// Mappingstatus per sync item (A06).
const MAPPING_STATUSES = ["mapped", "unmapped", "skipped", "error"];

// Reconciliatiestatus per sync item (A06).
const RECONCILIATION_STATUSES = ["pending", "matched", "unmatched", "conflict", "resolved"];

// Health-signaal van een connection (A02). Geen lifecycle maar een
// monitoringssignaal: het mag vrij tussen bekende waarden verspringen.
const HEALTH_STATES = ["unknown", "healthy", "degraded", "down"];

// ── Statusmachines ───────────────────────────────────────────────────────────
// Connection-status (A02) en sync-job-status (A05) zijn WEL echte lifecycles.
// "revoked" (connection) en "succeeded"/"cancelled" (sync job) zijn terminaal.

const CONNECTION_STATES = ["draft", "pending", "connected", "error", "disconnected", "revoked"];
const CONNECTION_TRANSITIONS = {
  draft: ["pending", "connected", "revoked"],
  pending: ["connected", "error", "disconnected", "revoked"],
  connected: ["error", "disconnected", "revoked"],
  error: ["connected", "disconnected", "revoked"],
  disconnected: ["pending", "connected", "revoked"],
  revoked: [], // terminaal · credentials ingetrokken, opnieuw verbinden = nieuwe connection
};

const SYNC_JOB_STATES = ["queued", "running", "succeeded", "partial", "failed", "retrying", "cancelled"];
const SYNC_JOB_TRANSITIONS = {
  queued: ["running", "cancelled"],
  running: ["succeeded", "partial", "failed", "cancelled"],
  partial: ["retrying", "cancelled"], // deels geslaagd · openstaande items opnieuw
  failed: ["retrying", "cancelled"],
  retrying: ["running", "cancelled"],
  succeeded: [], // terminaal
  cancelled: [], // terminaal
};

const MACHINES = {
  connection: { code: "CONNECTION", states: CONNECTION_STATES, transitions: CONNECTION_TRANSITIONS },
  sync_job: { code: "SYNC_JOB", states: SYNC_JOB_STATES, transitions: SYNC_JOB_TRANSITIONS },
};

// ── Bewaking van de architectuurregel (A09/A10) ──────────────────────────────
// Een adapter mag GEEN platform-verantwoordelijkheden naar zich toe trekken.
// Deze concerns horen in het gedeelde framework of in de domeinlaag, nooit in
// een provideradapter-descriptor.
const FORBIDDEN_ADAPTER_CONCERNS = [
  "pricing", "billing", "credits", "usage", "usageBilling",
  "permissions", "rights", "roles", "entitlements",
  "businessRules", "sourceOfTruth",
  "retry", "retryPolicy",
  "credentialStore", "credentialsStore", "secretStore", "secrets",
  "auditSink", "logger", "logging",
];

// Inline secret-velden die NOOIT in gewone connection-data mogen staan (A13);
// credentials horen als secret-referentie in integration_credentials.
const RAW_SECRET_FIELDS = ["apiKey", "secret", "password", "clientSecret", "privateKey", "credentials", "token"];

// ── Foutpatroon (repo-conventie) ─────────────────────────────────────────────
function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
function clean(v) { return String(v == null ? "" : v).trim(); }

// ── Capability · object + actie (A03) ────────────────────────────────────────
const CAP_RE = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;

/** Parse "object.actie" naar { object, action, key }; gooit bij ongeldige vorm. */
function parseCapability(raw) {
  const m = CAP_RE.exec(clean(raw));
  if (!m) throw err(400, "CAPABILITY_INVALID", `capability moet 'object.actie' zijn, kreeg ${clean(raw) || "(leeg)"}`);
  const [, object, action] = m;
  if (!CAPABILITY_ACTIONS.includes(action)) {
    throw err(400, "CAPABILITY_ACTION_INVALID", `onbekende capability-actie ${action}`);
  }
  return { object, action, key: `${object}.${action}` };
}

/** Is dit een geldige capability-sleutel? (nooit gooiend) */
function isCapability(raw) { try { parseCapability(raw); return true; } catch (_) { return false; } }

/** Bouw een capability-sleutel uit object + actie (gevalideerd). */
function capabilityKey(object, action) { return parseCapability(`${clean(object)}.${clean(action)}`).key; }

// ── Validatoren · geven een lijst veldfouten terug (leeg = geldig) ───────────
// Elke fout is { field, code, message }. De assert-varianten gooien de eerste
// fout als Error met .status/.code, handig in de router.

/** Connector manifest (A01). */
function validateManifest(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return [{ field: "manifest", code: "MANIFEST_INVALID", message: "manifest ontbreekt" }];
  if (!clean(obj.name)) errors.push({ field: "name", code: "NAME_REQUIRED", message: "naam is verplicht" });
  if (!CONNECTOR_CATEGORIES.includes(obj.category)) {
    errors.push({ field: "category", code: "CATEGORY_INVALID", message: `categorie moet een van ${CONNECTOR_CATEGORIES.join(", ")} zijn` });
  }
  if (!Array.isArray(obj.capabilities) || obj.capabilities.length === 0) {
    errors.push({ field: "capabilities", code: "CAPABILITIES_REQUIRED", message: "minstens een capability is verplicht" });
  } else {
    obj.capabilities.forEach((c, i) => {
      if (!isCapability(c)) errors.push({ field: `capabilities[${i}]`, code: "CAPABILITY_INVALID", message: `ongeldige capability ${clean(c) || "(leeg)"}` });
    });
  }
  if (!AUTH_TYPES.includes(obj.authType)) {
    errors.push({ field: "authType", code: "AUTH_TYPE_INVALID", message: `authenticatietype moet een van ${AUTH_TYPES.join(", ")} zijn` });
  }
  if (!Array.isArray(obj.scopes)) errors.push({ field: "scopes", code: "SCOPES_INVALID", message: "scopes moet een lijst zijn" });
  if (!Array.isArray(obj.syncModes) || obj.syncModes.length === 0) {
    errors.push({ field: "syncModes", code: "SYNC_MODES_REQUIRED", message: "minstens een syncmodus is verplicht" });
  } else {
    obj.syncModes.forEach((mode, i) => {
      if (!SYNC_MODES.includes(mode)) errors.push({ field: `syncModes[${i}]`, code: "SYNC_MODE_INVALID", message: `onbekende syncmodus ${mode}` });
    });
  }
  if (typeof obj.webhookSupport !== "boolean") {
    errors.push({ field: "webhookSupport", code: "WEBHOOK_SUPPORT_INVALID", message: "webhookondersteuning moet true of false zijn" });
  }
  if (!SANDBOX_STATES.includes(obj.sandboxStatus)) {
    errors.push({ field: "sandboxStatus", code: "SANDBOX_STATUS_INVALID", message: `sandboxstatus moet een van ${SANDBOX_STATES.join(", ")} zijn` });
  }
  if (!clean(obj.entitlement)) errors.push({ field: "entitlement", code: "ENTITLEMENT_REQUIRED", message: "entitlement is verplicht" });
  return errors;
}

/** Connection (A02). Bewaakt ook dat er nooit een ruw secret in de data staat (A13). */
function validateConnection(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return [{ field: "connection", code: "CONNECTION_INVALID", message: "connection ontbreekt" }];
  if (!clean(obj.tenantId)) errors.push({ field: "tenantId", code: "TENANT_REQUIRED", message: "tenant_id is verplicht" });
  if (!clean(obj.provider)) errors.push({ field: "provider", code: "PROVIDER_REQUIRED", message: "provider is verplicht" });
  if (!ENVIRONMENTS.includes(obj.environment)) {
    errors.push({ field: "environment", code: "ENVIRONMENT_INVALID", message: `environment moet een van ${ENVIRONMENTS.join(", ")} zijn` });
  }
  if (!CONNECTION_STATES.includes(obj.status)) {
    errors.push({ field: "status", code: "STATUS_INVALID", message: `status moet een van ${CONNECTION_STATES.join(", ")} zijn` });
  }
  if (obj.health != null && !HEALTH_STATES.includes(obj.health)) {
    errors.push({ field: "health", code: "HEALTH_INVALID", message: `health moet een van ${HEALTH_STATES.join(", ")} zijn` });
  }
  const rawSecret = RAW_SECRET_FIELDS.find(k => clean(obj[k]));
  if (rawSecret) {
    errors.push({ field: rawSecret, code: "RAW_SECRET_FORBIDDEN", message: "credentials horen als secret-referentie (integration_credentials), niet als ruwe waarde in de connection" });
  }
  return errors;
}

/** Mapping (A04): lokaal veld/code naar providerwaarde, versie + geldigheidsperiode. */
function validateMapping(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return [{ field: "mapping", code: "MAPPING_INVALID", message: "mapping ontbreekt" }];
  if (!clean(obj.localField) && !clean(obj.code)) {
    errors.push({ field: "localField", code: "LOCAL_FIELD_REQUIRED", message: "lokaal veld of code is verplicht" });
  }
  if (!clean(obj.providerValue)) errors.push({ field: "providerValue", code: "PROVIDER_VALUE_REQUIRED", message: "providerwaarde is verplicht" });
  if (obj.version != null && !(Number.isInteger(obj.version) && obj.version >= 1)) {
    errors.push({ field: "version", code: "VERSION_INVALID", message: "versie moet een positief geheel getal zijn" });
  }
  if (obj.direction != null && !SYNC_DIRECTIONS.includes(obj.direction)) {
    errors.push({ field: "direction", code: "DIRECTION_INVALID", message: `richting moet een van ${SYNC_DIRECTIONS.join(", ")} zijn` });
  }
  if (obj.validFrom != null && Number.isNaN(Date.parse(obj.validFrom))) {
    errors.push({ field: "validFrom", code: "VALID_FROM_INVALID", message: "validFrom is geen geldige datum" });
  }
  if (obj.validTo != null && Number.isNaN(Date.parse(obj.validTo))) {
    errors.push({ field: "validTo", code: "VALID_TO_INVALID", message: "validTo is geen geldige datum" });
  }
  if (obj.validFrom && obj.validTo && !Number.isNaN(Date.parse(obj.validFrom)) && !Number.isNaN(Date.parse(obj.validTo))
    && Date.parse(obj.validTo) <= Date.parse(obj.validFrom)) {
    errors.push({ field: "validTo", code: "VALIDITY_RANGE_INVALID", message: "validTo moet na validFrom liggen" });
  }
  return errors;
}

/** Sync job (A05). Tweerichtingssync vereist expliciete conflictregels (A11). */
function validateSyncJob(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return [{ field: "syncJob", code: "SYNC_JOB_INVALID", message: "sync job ontbreekt" }];
  if (!SYNC_DIRECTIONS.includes(obj.direction)) {
    errors.push({ field: "direction", code: "DIRECTION_INVALID", message: `richting moet een van ${SYNC_DIRECTIONS.join(", ")} zijn` });
  }
  if (!SYNC_JOB_STATES.includes(obj.status)) {
    errors.push({ field: "status", code: "STATUS_INVALID", message: `status moet een van ${SYNC_JOB_STATES.join(", ")} zijn` });
  }
  if (!clean(obj.correlationId)) {
    errors.push({ field: "correlationId", code: "CORRELATION_ID_REQUIRED", message: "correlation_id is verplicht voor traceerbaarheid" });
  }
  if (obj.direction === "bidirectional" && !hasConflictPolicy(obj)) {
    errors.push({ field: "conflictPolicy", code: "SYNC_CONFLICT_RULES_REQUIRED", message: "tweerichtingssync is alleen toegestaan met expliciet gedefinieerde conflictregels" });
  }
  return errors;
}

/** Sync item (A06): een bronrecord met mappingstatus, foutcode en reconciliatiestatus. */
function validateSyncItem(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return [{ field: "syncItem", code: "SYNC_ITEM_INVALID", message: "sync item ontbreekt" }];
  if (!clean(obj.syncJobId)) errors.push({ field: "syncJobId", code: "SYNC_JOB_ID_REQUIRED", message: "sync_job_id is verplicht" });
  if (obj.sourceRecord == null) errors.push({ field: "sourceRecord", code: "SOURCE_RECORD_REQUIRED", message: "bronrecord is verplicht" });
  if (!MAPPING_STATUSES.includes(obj.mappingStatus)) {
    errors.push({ field: "mappingStatus", code: "MAPPING_STATUS_INVALID", message: `mappingstatus moet een van ${MAPPING_STATUSES.join(", ")} zijn` });
  }
  if (!RECONCILIATION_STATUSES.includes(obj.reconciliationStatus)) {
    errors.push({ field: "reconciliationStatus", code: "RECONCILIATION_STATUS_INVALID", message: `reconciliatiestatus moet een van ${RECONCILIATION_STATUSES.join(", ")} zijn` });
  }
  if (obj.mappingStatus === "error" && !clean(obj.errorCode)) {
    errors.push({ field: "errorCode", code: "ERROR_CODE_REQUIRED", message: "een item met mappingstatus error vereist een foutcode" });
  }
  return errors;
}

function hasConflictPolicy(obj) {
  const c = obj.conflictPolicy;
  if (!c) return false;
  if (typeof c === "string") return !!clean(c);
  if (typeof c === "object") return !!clean(c.strategy);
  return false;
}

// Generieke assert-fabriek: gooit de eerste veldfout van een validator.
function assertValid(validator, obj) {
  const errors = validator(obj);
  if (errors.length) { const first = errors[0]; throw err(400, first.code, first.message); }
  return true;
}
function assertManifest(obj) { return assertValid(validateManifest, obj); }
function assertConnection(obj) { return assertValid(validateConnection, obj); }
function assertMapping(obj) { return assertValid(validateMapping, obj); }
function assertSyncJob(obj) { return assertValid(validateSyncJob, obj); }
function assertSyncItem(obj) { return assertValid(validateSyncItem, obj); }

// ── Statusmachine-overgangen ─────────────────────────────────────────────────

/**
 * Dwing een geldige statusovergang af binnen een machine (connection|sync_job).
 * Gooit CONNECTION_/SYNC_JOB_STATE_INVALID bij onbekende status en
 * CONNECTION_/SYNC_JOB_TRANSITION_INVALID bij een verboden overgang.
 */
function assertTransition(machine, from, to) {
  const m = MACHINES[machine];
  if (!m) throw err(500, "MACHINE_UNKNOWN", `onbekende statusmachine ${machine}`);
  if (!m.states.includes(from)) throw err(400, `${m.code}_STATE_INVALID`, `onbekende bronstatus ${from}`);
  if (!m.states.includes(to)) throw err(400, `${m.code}_STATE_INVALID`, `onbekende doelstatus ${to}`);
  if (from === to) return true;
  if (!(m.transitions[from] || []).includes(to)) {
    throw err(409, `${m.code}_TRANSITION_INVALID`, `overgang ${from} · ${to} niet toegestaan`);
  }
  return true;
}
function assertConnectionTransition(from, to) { return assertTransition("connection", from, to); }
function assertSyncJobTransition(from, to) { return assertTransition("sync_job", from, to); }

/** Is dit een terminale status in de opgegeven machine? */
function isTerminal(machine, state) {
  const m = MACHINES[machine];
  return !!m && m.states.includes(state) && (m.transitions[state] || []).length === 0;
}

/** Health is een monitoringssignaal: enkel de waarde wordt gevalideerd (A02). */
function assertHealth(state) {
  if (!HEALTH_STATES.includes(state)) throw err(400, "HEALTH_INVALID", `onbekende health ${state}`);
  return true;
}

// ── Mappingresolutie op versie + geldigheidsperiode (A04) ────────────────────

function toMs(at) {
  if (at == null) return Date.now();
  return typeof at === "number" ? at : Date.parse(at);
}

// Geldig op moment t: [validFrom, validTo). Ontbrekende grens = open; een
// onparseerbare grens faalt DICHT (de mapping telt dan niet mee).
function withinValidity(m, t) {
  if (m.validFrom != null) { const f = Date.parse(m.validFrom); if (Number.isNaN(f) || f > t) return false; }
  if (m.validTo != null) { const to = Date.parse(m.validTo); if (Number.isNaN(to) || to <= t) return false; }
  return true;
}
function mappingVersion(m) { return Number.isInteger(m.version) ? m.version : 0; }
function mappingFromMs(m) { const f = m.validFrom != null ? Date.parse(m.validFrom) : 0; return Number.isNaN(f) ? 0 : f; }

/**
 * Kies de geldige mapping voor een lokaal veld/code op een moment `at`.
 * Matcht op localField of code, filtert op geldigheidsperiode en kiest de
 * hoogste versie (tie-break: recentste validFrom). Geen match = null.
 */
function resolveMapping(mappings, key, at) {
  const t = toMs(at);
  if (Number.isNaN(t)) return null;
  const k = clean(key);
  const candidates = (Array.isArray(mappings) ? mappings : []).filter(m =>
    m && (m.localField === k || m.code === k) && withinValidity(m, t));
  if (!candidates.length) return null;
  candidates.sort((a, b) => (mappingVersion(b) - mappingVersion(a)) || (mappingFromMs(b) - mappingFromMs(a)));
  return candidates[0];
}

// ── Architectuurbewaking (A09/A10) ───────────────────────────────────────────

/** Welke verboden platform-concerns declareert deze adapter-descriptor? */
function adapterBoundaryViolations(adapter) {
  if (!adapter || typeof adapter !== "object") return [];
  return FORBIDDEN_ADAPTER_CONCERNS.filter(k => Object.prototype.hasOwnProperty.call(adapter, k) && adapter[k] != null);
}

/**
 * Bewaak de architectuurregel: een adapter vertaalt enkel tussen canoniek model
 * en providercontract. Declareert hij pricing/billing/rechten/retry/secrets/
 * logging/source-of-truth, dan hoort dat in het gedeelde framework of de
 * domeinlaag en gooien we ADAPTER_BOUNDARY_VIOLATION.
 */
function assertAdapterBoundary(adapter) {
  const violations = adapterBoundaryViolations(adapter);
  if (violations.length) {
    throw err(422, "ADAPTER_BOUNDARY_VIOLATION", `een adapter vertaalt enkel; deze declareert platform-verantwoordelijkheden: ${violations.join(", ")}`);
  }
  return true;
}

module.exports = {
  // canoniek model · enums
  CONNECTOR_CATEGORIES, AUTH_TYPES, SYNC_MODES, SANDBOX_STATES, ENVIRONMENTS,
  CAPABILITY_ACTIONS, SYNC_DIRECTIONS, MAPPING_STATUSES, RECONCILIATION_STATUSES, HEALTH_STATES,
  CONNECTION_STATES, CONNECTION_TRANSITIONS, SYNC_JOB_STATES, SYNC_JOB_TRANSITIONS,
  FORBIDDEN_ADAPTER_CONCERNS, RAW_SECRET_FIELDS,
  // capability
  parseCapability, isCapability, capabilityKey,
  // validatoren + assert-varianten
  validateManifest, validateConnection, validateMapping, validateSyncJob, validateSyncItem,
  assertManifest, assertConnection, assertMapping, assertSyncJob, assertSyncItem,
  // statusmachines
  assertTransition, assertConnectionTransition, assertSyncJobTransition, isTerminal, assertHealth,
  // mappingresolutie
  resolveMapping,
  // architectuurbewaking
  adapterBoundaryViolations, assertAdapterBoundary,
};
