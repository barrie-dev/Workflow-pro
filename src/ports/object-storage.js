"use strict";
/**
 * ObjectStorageProvider-PORT (handover 4.2 · F-08).
 *
 * Bestandsopslag los van de aanbieder. De applicatie- en domeinlaag kennen
 * alleen deze poort; adapters (lokaal filesystem nu, Azure Blob of S3 later)
 * implementeren hem. Cloudblind: geen SDK, geen endpoint, geen sleutels hier.
 *
 * Contract (handover 4.2):
 *   put(input)                 → StoredObject
 *   get(key)                   → Readable
 *   delete(key)                → void
 *   createUploadUrl(input)     → SignedUrl
 *   createDownloadUrl(input)   → SignedUrl
 *   metadata(key)              → ObjectMetadata
 *
 * Niet-onderhandelbare regels uit de handover:
 *  - Objectkeys dragen TENANTCONTEXT en worden SERVER-SIDE opgebouwd. Een
 *    client mag nooit een key kiezen: dat zou cross-tenant toegang mogelijk
 *    maken. buildObjectKey() is daarom de enige toegestane bron van keys.
 *  - Geen publieke containers of buckets. Toegang loopt altijd via een
 *    ondertekende, kortlevende URL.
 *  - Uploadvalidatie (grootte, MIME, checksum) en malwarestatus worden apart
 *    vastgelegd, niet afgeleid uit de bestandsnaam.
 */

const crypto = require("crypto");

// Alleen deze MIME-types accepteren we standaard. Bewust een allowlist: een
// blocklist laat altijd iets door.
const DEFAULT_ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg", "image/png", "image/webp", "image/heic",
  "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword", "application/vnd.ms-excel",
];
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
// Scanstatus wordt apart vastgelegd (handover 4.2); "pending" tot een scanner
// uitsluitsel geeft. Downloads van niet-schone objecten worden geweigerd.
const SCAN_STATUSES = ["pending", "clean", "infected", "skipped"];

function clean(v) { return String(v == null ? "" : v).trim(); }

/**
 * Bouw een objectkey. ALTIJD server-side: tenant eerst, daarna scope en een
 * willekeurig id. De oorspronkelijke bestandsnaam zit er bewust niet in (die
 * kan padtekens of PII bevatten); ze leeft in de metadata.
 */
function buildObjectKey({ tenantId, scope = "general", id = null, extension = "" }) {
  const t = clean(tenantId);
  if (!t) { const e = new Error("tenantId is verplicht voor een objectkey"); e.status = 400; e.code = "TENANT_REQUIRED"; throw e; }
  const safeScope = clean(scope).toLowerCase().replace(/[^a-z0-9_-]/g, "") || "general";
  const safeId = clean(id) || crypto.randomBytes(16).toString("hex");
  const ext = clean(extension).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return `t/${t}/${safeScope}/${safeId}${ext ? `.${ext}` : ""}`;
}

/** De tenant uit een key halen · basis voor de isolatiecontrole in adapters. */
function tenantOfKey(key) {
  const m = /^t\/([^/]+)\//.exec(clean(key));
  return m ? m[1] : null;
}

/**
 * Bewaakt dat een key bij de opgegeven tenant hoort. Adapters roepen dit aan
 * vóór ELKE operatie, zodat een gemanipuleerde key nooit data van een andere
 * tenant raakt.
 */
function assertTenantOwnsKey(tenantId, key) {
  const owner = tenantOfKey(key);
  if (!owner || owner !== clean(tenantId)) {
    const e = new Error("Objectkey hoort niet bij deze tenant");
    e.status = 403; e.code = "CROSS_TENANT_KEY";
    throw e;
  }
}

/**
 * Uploadvalidatie: grootte, MIME en checksum. Apart vastgelegd (handover 4.2),
 * dus de aanroeper krijgt expliciet terug wat er gecontroleerd is.
 */
function validateUpload({ mimeType, size, content = null, checksum = null }, {
  allowedMime = DEFAULT_ALLOWED_MIME, maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  const mime = clean(mimeType).toLowerCase();
  const bytes = Number(size);
  if (!allowedMime.includes(mime)) {
    const e = new Error(`Bestandstype '${mime || "onbekend"}' is niet toegestaan`);
    e.status = 415; e.code = "MIME_NOT_ALLOWED"; throw e;
  }
  if (!Number.isFinite(bytes) || bytes <= 0) {
    const e = new Error("Bestandsgrootte ontbreekt of is ongeldig"); e.status = 400; e.code = "INVALID_SIZE"; throw e;
  }
  if (bytes > maxBytes) {
    const e = new Error(`Bestand is te groot (max ${Math.round(maxBytes / 1024 / 1024)} MB)`);
    e.status = 413; e.code = "FILE_TOO_LARGE"; throw e;
  }
  // Checksum over de inhoud; als de client er één meestuurt moet die kloppen,
  // anders is het bestand onderweg gewijzigd.
  let computed = clean(checksum);
  if (content != null) {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
    if (buf.length !== bytes) {
      const e = new Error("Opgegeven grootte komt niet overeen met de inhoud");
      e.status = 400; e.code = "SIZE_MISMATCH"; throw e;
    }
    const actual = crypto.createHash("sha256").update(buf).digest("hex");
    if (computed && computed !== actual) {
      const e = new Error("Checksum komt niet overeen met de inhoud");
      e.status = 400; e.code = "CHECKSUM_MISMATCH"; throw e;
    }
    computed = actual;
  }
  return { mimeType: mime, size: bytes, checksum: computed || null };
}

/** Structurele controle dat een adapter de poort implementeert. */
const REQUIRED_METHODS = ["put", "get", "delete", "createUploadUrl", "createDownloadUrl", "metadata"];
function isObjectStorageProvider(candidate) {
  return !!candidate && REQUIRED_METHODS.every(m => typeof candidate[m] === "function");
}

module.exports = {
  DEFAULT_ALLOWED_MIME, DEFAULT_MAX_BYTES, SCAN_STATUSES, REQUIRED_METHODS,
  buildObjectKey, tenantOfKey, assertTenantOwnsKey, validateUpload, isObjectStorageProvider,
};
