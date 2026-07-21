"use strict";
/**
 * Azure Blob-adapter voor de ObjectStorageProvider-poort (P0-08 · Azure-infra).
 *
 * De gebruiker kiest Azure als productie-infrastructuur; Blob Storage spreekt
 * geen s3-protocol, dus dit is de tweede productie-adapter achter DEZELFDE
 * poort. De onafhankelijkheid (ADR-001) blijft intact doordat de wissel tussen
 * deze adapter en de s3-compatibele adapter een configuratiewijziging is
 * (OBJECT_STORAGE_ADAPTER) en geen codewijziging: contract, sleutelconventie,
 * sidecar-metadata en beveiligingsgedrag zijn identiek.
 *
 * Bewust zonder SDK: pure REST op de Node-kernmodules.
 *  - Serverzijdige operaties: Shared Key-autorisatie (HMAC-SHA256 over de
 *    canonieke request, sleutel = base64-gedecodeerde accountsleutel).
 *  - Kortlevende URL's: service-SAS (handtekening over permissies, venster en
 *    canonieke resource) · de client praat rechtstreeks met de opslag, er
 *    gaat nooit een accountsleutel naar buiten.
 * Het live-bewijs draait tegen Azurite, de officiële opslag-emulator, die
 * exact dezelfde handtekeningvalidatie doet als de echte dienst.
 *
 * Configuratie hergebruikt de generieke variabelen (geen nieuwe envs):
 *   endpoint  → https://<account>.blob.core.windows.net
 *               of de emulator: http://127.0.0.1:10000/devstoreaccount1
 *   bucket    → containernaam
 *   accessKeyId / secretAccessKey → accountnaam / accountsleutel (base64)
 */

const crypto = require("crypto");
const { Readable } = require("stream");

const {
  buildObjectKey, assertTenantOwnsKey, validateUpload, SCAN_STATUSES,
  DEFAULT_ALLOWED_MIME, DEFAULT_MAX_BYTES,
} = require("../../ports/object-storage");
const { defaultTransport } = require("../http-transport");

const DEFAULT_URL_TTL_SECONDS = 900;   // 15 minuten · kortlevend per handover
const API_VERSION = "2021-08-06";

function clean(v) { return String(v == null ? "" : v).trim(); }

/** ISO 8601 zonder milliseconden, zoals de SAS-velden st/se verwachten. */
function isoSeconds(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z"); }

class AzureBlobObjectStorage {
  /**
   * @param {object} opts
   * @param {string} opts.endpoint         basis-URL van het blob-endpoint (incl. accountpad bij de emulator)
   * @param {string} opts.container        containernaam (vooraf aangemaakt in productie)
   * @param {string} opts.accountName      opslagaccountnaam
   * @param {string} opts.accountKey       accountsleutel (base64)
   * @param {Function} [opts.transport]    injecteerbaar transport voor tests
   */
  constructor({ endpoint, container, accountName, accountKey,
    urlTtlSeconds = DEFAULT_URL_TTL_SECONDS,
    allowedMime = DEFAULT_ALLOWED_MIME, maxBytes = DEFAULT_MAX_BYTES, transport = null } = {}) {
    const missing = [
      !clean(endpoint) && "endpoint", !clean(container) && "container",
      !clean(accountName) && "accountName", !clean(accountKey) && "accountKey",
    ].filter(Boolean);
    if (missing.length) {
      const e = new Error(`Objectopslag-configuratie onvolledig: ${missing.join(", ")} ontbreekt`);
      e.status = 500; e.code = "OBJECT_STORAGE_MISCONFIGURED"; throw e;
    }
    this.name = "azure-blob";
    this.endpointUrl = new URL(clean(endpoint).replace(/\/$/, ""));
    this.container = clean(container);
    this.accountName = clean(accountName);
    // Node's base64-decoder negeert vreemde tekens stilletjes; een verkeerd
    // geplakte sleutel zou dan pas bij het eerste verzoek falen. Hier hard
    // valideren geeft een duidelijke fout bij het opstarten.
    const rawKey = clean(accountKey);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(rawKey)) {
      const e = new Error("De accountsleutel is geen geldige base64-waarde");
      e.status = 500; e.code = "OBJECT_STORAGE_MISCONFIGURED"; throw e;
    }
    this.keyBuffer = Buffer.from(rawKey, "base64");
    this.urlTtlSeconds = Number(urlTtlSeconds) || DEFAULT_URL_TTL_SECONDS;
    this.allowedMime = allowedMime;
    this.maxBytes = maxBytes;
    this.transport = transport || defaultTransport;
  }

  hmac(stringToSign) {
    return crypto.createHmac("sha256", this.keyBuffer).update(stringToSign, "utf8").digest("base64");
  }

  /** Volledige URL van een blob ("" = de container zelf). */
  urlFor(key, query = {}) {
    // origin + pathname apart, want href voegt bij een kaal endpoint een
    // slash toe en dat zou hier een dubbele slash in het pad opleveren.
    const basePath = this.endpointUrl.pathname === "/" ? "" : this.endpointUrl.pathname;
    const base = `${this.endpointUrl.origin}${basePath}/${encodeURIComponent(this.container)}` +
      (key ? `/${key.split("/").map(encodeURIComponent).join("/")}` : "");
    const qs = Object.keys(query).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join("&");
    return qs ? `${base}?${qs}` : base;
  }

  /**
   * Shared Key-autorisatie voor serverzijdige verzoeken. De canonieke resource
   * is "/{account}{pad-van-de-URL}": bij een productie-endpoint staat het
   * account in de hostnaam, bij de emulator al in het pad · in dat laatste
   * geval verschijnt het account dus twee keer, precies zoals de dienst het
   * verwacht.
   */
  signRequest({ method, key = "", headers = {}, contentLength = 0, query = {}, now = Date.now() }) {
    const url = this.urlFor(key, query);
    const all = {};
    for (const [k, v] of Object.entries(headers)) all[k.toLowerCase()] = clean(v);
    all["x-ms-date"] = new Date(now).toUTCString();
    all["x-ms-version"] = API_VERSION;

    const msHeaders = Object.keys(all).filter(h => h.startsWith("x-ms-")).sort()
      .map(h => `${h}:${all[h]}\n`).join("");
    const canonicalResource = `/${this.accountName}${new URL(url).pathname}` +
      Object.keys(query).sort().map(k => `\n${k.toLowerCase()}:${query[k]}`).join("");

    const stringToSign = [
      method,
      "",                                            // Content-Encoding
      "",                                            // Content-Language
      contentLength > 0 ? String(contentLength) : "",
      "",                                            // Content-MD5
      all["content-type"] || "",
      "",                                            // Date (x-ms-date wint)
      "", "", "", "",                                // If-*
      "",                                            // Range
      msHeaders + canonicalResource,
    ].join("\n");
    all.authorization = `SharedKey ${this.accountName}:${this.hmac(stringToSign)}`;
    return { url, headers: all };
  }

  /**
   * Service-SAS: kortlevende, ondertekende URL voor precies één blob en één
   * permissieset. De canonieke resource is "/blob/{account}/{container}/{key}",
   * onafhankelijk van de endpointvorm.
   */
  presignUrl({ permissions, key, ttlSeconds = null, responseHeaders = {}, now = Date.now() }) {
    const expires = Math.min(Math.max(Number(ttlSeconds) || this.urlTtlSeconds, 1), 7 * 86400);
    const st = isoSeconds(now - 5 * 60 * 1000);      // kleine marge voor klokdrift
    const se = isoSeconds(now + expires * 1000);
    const canonicalResource = `/blob/${this.accountName}/${this.container}/${key}`;
    const rs = { rscc: "", rscd: "", rsce: "", rscl: "", rsct: "", ...responseHeaders };

    const stringToSign = [
      permissions, st, se, canonicalResource,
      "",                // signedIdentifier
      "",                // signedIP
      "https,http",      // signedProtocol
      API_VERSION,
      "b",               // signedResource: blob
      "",                // signedSnapshotTime
      "",                // signedEncryptionScope
      rs.rscc, rs.rscd, rs.rsce, rs.rscl, rs.rsct,
    ].join("\n");

    const query = {
      sv: API_VERSION, spr: "https,http", st, se, sr: "b", sp: permissions,
      sig: this.hmac(stringToSign),
    };
    if (rs.rscd) query.rscd = rs.rscd;
    return { url: this.urlFor(key, query), expiresAt: Math.floor((now + expires * 1000) / 1000) };
  }

  /** Lage-niveau-verzoek; vertaalt foutstatussen naar poortfouten. */
  async send(method, key, { body = null, headers = {}, query = {} } = {}) {
    const contentLength = body == null ? 0 : (Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body)));
    const signed = this.signRequest({ method, key, headers, contentLength, query });
    const res = await this.transport({ url: signed.url, method, headers: signed.headers, body });
    if (res.status === 404) {
      const e = new Error("Object niet gevonden"); e.status = 404; e.code = "NOT_FOUND"; throw e;
    }
    if (res.status < 200 || res.status >= 300) {
      const detail = res.body ? String(res.body).slice(0, 300) : "";
      const e = new Error(`Opslag weigerde ${method} (${res.status})${detail ? `: ${detail}` : ""}`);
      e.status = res.status >= 500 ? 502 : res.status; e.code = "OBJECT_STORAGE_ERROR";
      e.storageStatus = res.status;
      throw e;
    }
    return res;
  }

  metaKeyFor(key) { return `${key}.meta.json`; }

  async writeMeta(key, meta) {
    const body = Buffer.from(JSON.stringify(meta, null, 2));
    await this.send("PUT", this.metaKeyFor(key), {
      body, headers: { "content-type": "application/json", "x-ms-blob-type": "BlockBlob" },
    });
  }

  /** Bewaar een object + zijn metadata. Key wordt server-side gebouwd. */
  async put({ tenantId, scope, id, extension, key = null, content, mimeType, size, checksum = null, fileName = "", scanStatus = "pending" }) {
    const objectKey = key || buildObjectKey({ tenantId, scope, id, extension });
    assertTenantOwnsKey(tenantId, objectKey);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content == null ? "" : content));
    const validated = validateUpload(
      { mimeType, size: size != null ? Number(size) : buf.length, content: buf, checksum },
      { allowedMime: this.allowedMime, maxBytes: this.maxBytes });

    await this.send("PUT", objectKey, {
      body: buf, headers: { "content-type": validated.mimeType, "x-ms-blob-type": "BlockBlob" },
    });
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
    await this.writeMeta(objectKey, meta);
    return { key: objectKey, size: meta.size, checksum: meta.checksum, mimeType: meta.mimeType, scanStatus: meta.scanStatus };
  }

  /** Leesstroom van een object. */
  async get(key, { tenantId = null } = {}) {
    if (tenantId) assertTenantOwnsKey(tenantId, key);
    const res = await this.send("GET", key);
    return Readable.from(res.body);
  }

  async delete(key, { tenantId = null } = {}) {
    if (tenantId) assertTenantOwnsKey(tenantId, key);
    // Idempotent verwijderen: een al verdwenen blob is geen fout.
    await this.send("DELETE", key).catch(e => { if (e.code !== "NOT_FOUND") throw e; });
    await this.send("DELETE", this.metaKeyFor(key)).catch(e => { if (e.code !== "NOT_FOUND") throw e; });
  }

  async metadata(key, { tenantId = null } = {}) {
    if (tenantId) assertTenantOwnsKey(tenantId, key);
    const res = await this.send("GET", this.metaKeyFor(key));
    try { return JSON.parse(String(res.body)); }
    catch (_) {
      const e = new Error("Metadata van dit object is beschadigd"); e.status = 500; e.code = "META_CORRUPT"; throw e;
    }
  }

  /** Leg de uitkomst van een virusscan vast (apart van de upload). */
  async setScanStatus(key, status, { tenantId = null } = {}) {
    if (tenantId) assertTenantOwnsKey(tenantId, key);
    if (!SCAN_STATUSES.includes(status)) { const e = new Error(`Onbekende scanstatus '${status}'`); e.status = 400; throw e; }
    const meta = await this.metadata(key);
    const next = { ...meta, scanStatus: status, scannedAt: new Date().toISOString() };
    await this.writeMeta(key, next);
    return next;
  }

  async createUploadUrl({ tenantId, scope, id, extension, mimeType, size, ttlSeconds = null }) {
    // Valideer vóór we een uploadslot uitgeven, zodat een te groot of verkeerd
    // bestandstype niet eerst geüpload hoeft te worden.
    validateUpload({ mimeType, size }, { allowedMime: this.allowedMime, maxBytes: this.maxBytes });
    const key = buildObjectKey({ tenantId, scope, id, extension });
    const { url, expiresAt } = this.presignUrl({ permissions: "cw", key, ttlSeconds });
    return {
      key, expiresAt, method: "PUT", url,
      // De client moet het blobtype meesturen; hoort bij het uploadcontract.
      headers: { "Content-Type": mimeType, "x-ms-blob-type": "BlockBlob" },
    };
  }

  /**
   * Sluit een rechtstreekse upload af: bevestig dat het object bestaat en leg
   * de metadata vast. Zonder deze registratie blijft downloaden geblokkeerd
   * (geen metadata = geen scanstatus = geen uitlevering) · veilig by default.
   */
  async registerUpload({ tenantId, key, mimeType, size, checksum = null, fileName = "" }) {
    assertTenantOwnsKey(tenantId, key);
    const head = await this.send("HEAD", key);
    const actualSize = Number(head.headers["content-length"]);
    const validated = validateUpload(
      { mimeType, size: Number.isFinite(actualSize) && actualSize > 0 ? actualSize : size, checksum },
      { allowedMime: this.allowedMime, maxBytes: this.maxBytes });
    const meta = {
      key, tenantId: clean(tenantId), fileName: clean(fileName),
      mimeType: validated.mimeType, size: validated.size, checksum: validated.checksum,
      scanStatus: "pending", scannedAt: null, createdAt: new Date().toISOString(),
    };
    await this.writeMeta(key, meta);
    return { key, size: meta.size, checksum: meta.checksum, mimeType: meta.mimeType, scanStatus: meta.scanStatus };
  }

  async createDownloadUrl({ tenantId, key, ttlSeconds = null }) {
    assertTenantOwnsKey(tenantId, key);
    const meta = await this.metadata(key);
    // Niet-schone objecten worden nooit uitgeleverd (handover 4.2).
    if (meta.scanStatus === "infected") {
      const e = new Error("Dit bestand is geblokkeerd door de virusscan"); e.status = 403; e.code = "FILE_INFECTED"; throw e;
    }
    const responseHeaders = meta.fileName
      ? { rscd: `attachment; filename="${meta.fileName.replace(/["\\]/g, "")}"` }
      : {};
    const { url, expiresAt } = this.presignUrl({ permissions: "r", key, ttlSeconds, responseHeaders });
    return { key, expiresAt, method: "GET", url, fileName: meta.fileName || null, mimeType: meta.mimeType };
  }

  /**
   * Zorg dat de container bestaat (dev/test/CI). In productie wordt de
   * container vooraf aangemaakt met het juiste retentie- en versiebeleid; dit
   * is bewust geen productie-pad zodat een typefout daar hard faalt.
   */
  async ensureBucket() {
    try {
      await this.send("HEAD", "", { query: { restype: "container" } });
      return { created: false };
    } catch (err) {
      if (err.code !== "NOT_FOUND") throw err;
    }
    await this.send("PUT", "", { query: { restype: "container" } });
    return { created: true };
  }

  /** Bereikbaarheidscheck voor readiness: bestaat de container en mogen we erin? */
  async healthCheck() {
    try {
      await this.send("HEAD", "", { query: { restype: "container" } });
      return { ok: true, status: 200 };
    } catch (err) {
      return { ok: false, status: err.storageStatus || null, error: String(err && err.message || err).slice(0, 200) };
    }
  }

  status() {
    // Bewust zonder sleutels: alleen wat een beheerder nodig heeft.
    return {
      adapter: this.name, mode: "blob",
      endpoint: `${this.endpointUrl.protocol}//${this.endpointUrl.host}`,
      container: this.container, urlTtlSeconds: this.urlTtlSeconds,
    };
  }
}

module.exports = { AzureBlobObjectStorage, DEFAULT_URL_TTL_SECONDS, API_VERSION };
