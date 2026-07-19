"use strict";
/**
 * Lokale filesystem-adapter voor de ObjectStorageProvider-poort (handover 4.2).
 *
 * Draait overal waar een schijf is: je laptop, een CI-runner, een container met
 * een volume, een VPS. Geen account, geen netwerk, geen SDK. Dit is de adapter
 * waartegen het contract standaard getest wordt; een Azure Blob- of
 * S3-adapter moet exact hetzelfde contract halen (handover 4.2).
 *
 * Beveiliging:
 *  - De key wordt naar een pad onder de basismap vertaald en daarna
 *    GEVERIFIEERD: een key met ".." of een absoluut pad kan nooit buiten de
 *    basismap schrijven of lezen (path traversal).
 *  - Elke operatie controleert de tenant in de key (assertTenantOwnsKey).
 *  - Er is geen publieke map: downloads lopen via een ondertekende, kortlevende
 *    URL met een HMAC over key + vervaltijd.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");

const {
  buildObjectKey, assertTenantOwnsKey, validateUpload, SCAN_STATUSES,
  DEFAULT_ALLOWED_MIME, DEFAULT_MAX_BYTES,
} = require("../../ports/object-storage");

const DEFAULT_URL_TTL_SECONDS = 900;   // 15 minuten · kortlevend per handover

function clean(v) { return String(v == null ? "" : v).trim(); }

class LocalObjectStorage {
  /**
   * @param {object} opts
   * @param {string} opts.basePath     map waar objecten en metadata landen
   * @param {string} opts.signingKey   HMAC-sleutel voor ondertekende URL's
   */
  constructor({ basePath, signingKey, urlTtlSeconds = DEFAULT_URL_TTL_SECONDS, allowedMime = DEFAULT_ALLOWED_MIME, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    this.name = "local";
    this.basePath = path.resolve(basePath || path.join(process.cwd(), "data", "files"));
    if (!signingKey) {
      const e = new Error("Een signingKey is vereist voor ondertekende URL's");
      e.status = 500; e.code = "SIGNING_KEY_MISSING"; throw e;
    }
    this.signingKey = String(signingKey);
    this.urlTtlSeconds = Number(urlTtlSeconds) || DEFAULT_URL_TTL_SECONDS;
    this.allowedMime = allowedMime;
    this.maxBytes = maxBytes;
  }

  /**
   * Vertaal een objectkey naar een pad ONDER de basismap. Gooit bij elke poging
   * om eruit te breken; dit is de enige plek waar een key een pad wordt.
   */
  resolvePath(key) {
    const k = clean(key);
    if (!k || k.startsWith("/") || k.includes("\\") || /(^|\/)\.\.(\/|$)/.test(k)) {
      const e = new Error("Ongeldige objectkey"); e.status = 400; e.code = "INVALID_KEY"; throw e;
    }
    const target = path.resolve(this.basePath, k);
    const root = this.basePath.endsWith(path.sep) ? this.basePath : this.basePath + path.sep;
    if (target !== this.basePath && !target.startsWith(root)) {
      const e = new Error("Objectkey wijst buiten de opslagmap"); e.status = 400; e.code = "PATH_TRAVERSAL"; throw e;
    }
    return target;
  }

  metaPathFor(key) { return `${this.resolvePath(key)}.meta.json`; }

  /** Bewaar een object + zijn metadata. Key wordt server-side gebouwd. */
  async put({ tenantId, scope, id, extension, key = null, content, mimeType, size, checksum = null, fileName = "", scanStatus = "pending" }) {
    const objectKey = key || buildObjectKey({ tenantId, scope, id, extension });
    assertTenantOwnsKey(tenantId, objectKey);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content == null ? "" : content));
    const validated = validateUpload(
      { mimeType, size: size != null ? Number(size) : buf.length, content: buf, checksum },
      { allowedMime: this.allowedMime, maxBytes: this.maxBytes });

    const target = this.resolvePath(objectKey);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, buf);

    const meta = {
      key: objectKey,
      tenantId: clean(tenantId),
      fileName: clean(fileName),
      mimeType: validated.mimeType,
      size: validated.size,
      checksum: validated.checksum,
      // Malwarestatus apart vastgelegd (handover 4.2), niet afgeleid.
      scanStatus: SCAN_STATUSES.includes(scanStatus) ? scanStatus : "pending",
      scannedAt: null,
      createdAt: new Date().toISOString(),
    };
    await fsp.writeFile(this.metaPathFor(objectKey), JSON.stringify(meta, null, 2));
    return { key: objectKey, size: meta.size, checksum: meta.checksum, mimeType: meta.mimeType, scanStatus: meta.scanStatus };
  }

  /** Leesstroom van een object. */
  async get(key, { tenantId = null } = {}) {
    if (tenantId) assertTenantOwnsKey(tenantId, key);
    const target = this.resolvePath(key);
    if (!fs.existsSync(target)) { const e = new Error("Object niet gevonden"); e.status = 404; e.code = "NOT_FOUND"; throw e; }
    return Readable.from(await fsp.readFile(target));
  }

  async delete(key, { tenantId = null } = {}) {
    if (tenantId) assertTenantOwnsKey(tenantId, key);
    const target = this.resolvePath(key);
    await fsp.rm(target, { force: true });
    await fsp.rm(this.metaPathFor(key), { force: true });
  }

  async metadata(key, { tenantId = null } = {}) {
    if (tenantId) assertTenantOwnsKey(tenantId, key);
    const metaPath = this.metaPathFor(key);
    if (!fs.existsSync(metaPath)) { const e = new Error("Object niet gevonden"); e.status = 404; e.code = "NOT_FOUND"; throw e; }
    return JSON.parse(await fsp.readFile(metaPath, "utf8"));
  }

  /** Leg de uitkomst van een virusscan vast (apart van de upload). */
  async setScanStatus(key, status, { tenantId = null } = {}) {
    if (tenantId) assertTenantOwnsKey(tenantId, key);
    if (!SCAN_STATUSES.includes(status)) { const e = new Error(`Onbekende scanstatus '${status}'`); e.status = 400; throw e; }
    const meta = await this.metadata(key);
    const next = { ...meta, scanStatus: status, scannedAt: new Date().toISOString() };
    await fsp.writeFile(this.metaPathFor(key), JSON.stringify(next, null, 2));
    return next;
  }

  // ── Ondertekende URL's ────────────────────────────────────────────────────
  sign(key, op, expiresAt) {
    return crypto.createHmac("sha256", this.signingKey).update(`${op}:${key}:${expiresAt}`).digest("hex");
  }

  /**
   * Verifieer een ondertekende URL. Constante-tijd-vergelijking en een harde
   * vervaltijd; een verlopen of gemanipuleerde link geeft nooit toegang.
   */
  verifySignature({ key, op, expiresAt, signature, now = Math.floor(Date.now() / 1000) }) {
    const exp = Number(expiresAt);
    if (!Number.isFinite(exp) || exp < now) { const e = new Error("Deze link is vervallen"); e.status = 410; e.code = "URL_EXPIRED"; throw e; }
    const expected = this.sign(key, op, exp);
    const got = clean(signature);
    if (got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
      const e = new Error("Ongeldige handtekening"); e.status = 403; e.code = "INVALID_SIGNATURE"; throw e;
    }
    return true;
  }

  async createUploadUrl({ tenantId, scope, id, extension, mimeType, size, ttlSeconds = null }) {
    // Valideer vóór we een uploadslot uitgeven, zodat een te groot of verkeerd
    // bestandstype niet eerst geüpload hoeft te worden.
    validateUpload({ mimeType, size }, { allowedMime: this.allowedMime, maxBytes: this.maxBytes });
    const key = buildObjectKey({ tenantId, scope, id, extension });
    const expiresAt = Math.floor(Date.now() / 1000) + (Number(ttlSeconds) || this.urlTtlSeconds);
    return {
      key, expiresAt,
      method: "PUT",
      url: `/api/storage/upload?key=${encodeURIComponent(key)}&expires=${expiresAt}&sig=${this.sign(key, "put", expiresAt)}`,
      headers: { "Content-Type": mimeType },
    };
  }

  async createDownloadUrl({ tenantId, key, ttlSeconds = null }) {
    assertTenantOwnsKey(tenantId, key);
    const meta = await this.metadata(key);
    // Niet-schone objecten worden nooit uitgeleverd (handover 4.2).
    if (meta.scanStatus === "infected") {
      const e = new Error("Dit bestand is geblokkeerd door de virusscan"); e.status = 403; e.code = "FILE_INFECTED"; throw e;
    }
    const expiresAt = Math.floor(Date.now() / 1000) + (Number(ttlSeconds) || this.urlTtlSeconds);
    return {
      key, expiresAt,
      method: "GET",
      url: `/api/storage/download?key=${encodeURIComponent(key)}&expires=${expiresAt}&sig=${this.sign(key, "get", expiresAt)}`,
      fileName: meta.fileName || null,
      mimeType: meta.mimeType,
    };
  }

  status() {
    return { adapter: this.name, mode: "filesystem", basePath: this.basePath, urlTtlSeconds: this.urlTtlSeconds };
  }
}

module.exports = { LocalObjectStorage, DEFAULT_URL_TTL_SECONDS };
