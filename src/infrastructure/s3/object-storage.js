"use strict";
/**
 * S3-compatibele adapter voor de ObjectStorageProvider-poort (CTO P0-08).
 *
 * Het S3-protocol is de de-facto open standaard voor objectopslag: dezelfde
 * API draait bij AWS, Cloudflare R2, Backblaze B2, OVH, Scaleway, Hetzner en
 * zelfgehost via MinIO. Door tegen het PROTOCOL te bouwen in plaats van tegen
 * een leverancier blijft de platformonafhankelijkheid (ADR-001) intact: een
 * andere aanbieder is een andere endpoint-URL, geen andere code.
 *
 * Bewust zonder SDK: de hele koppeling is HTTP + HMAC (Signature V4) op de
 * Node-kernmodules. Geen dependency betekent geen supply-chain-risico en geen
 * versie-lock aan één aanbieder. De handtekeningberekening is geverifieerd
 * tegen de officiële testvectoren uit de protocolspecificatie (zie de tests).
 *
 * Beveiliging (zelfde lat als de lokale adapter, handover 4.2):
 *  - Keys worden server-side gebouwd; elke operatie controleert de tenant in
 *    de key (assertTenantOwnsKey) zodat cross-tenant toegang onmogelijk is.
 *  - Geen publieke bucket: toegang loopt via kortlevende, ondertekende URL's
 *    die rechtstreeks bij de opslag terechtkomen (de app zit niet in het
 *    datapad van grote bestanden).
 *  - Metadata (originele bestandsnaam, checksum, scanstatus) leeft in een
 *    apart sidecar-object `<key>.meta.json`, zodat het gedrag op elke
 *    S3-compatibele opslag identiek is; besmette bestanden worden nooit
 *    uitgeleverd.
 */

const crypto = require("crypto");
const { Readable } = require("stream");

const {
  buildObjectKey, assertTenantOwnsKey, validateUpload, SCAN_STATUSES,
  DEFAULT_ALLOWED_MIME, DEFAULT_MAX_BYTES,
} = require("../../ports/object-storage");

const DEFAULT_URL_TTL_SECONDS = 900;   // 15 minuten · kortlevend per handover
const UNSIGNED = "UNSIGNED-PAYLOAD";
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function clean(v) { return String(v == null ? "" : v).trim(); }
function sha256hex(data) { return crypto.createHash("sha256").update(data).digest("hex"); }
function hmac(key, data) { return crypto.createHmac("sha256", key).update(data, "utf8").digest(); }

/**
 * Percent-encoding volgens de protocolregels: alleen A-Za-z0-9 - _ . ~ blijven
 * staan; al de rest wordt per UTF-8-byte gecodeerd. encodeURIComponent volgt
 * andere regels (laat ! * ' ( ) staan), dus die is hier bewust niet genoeg.
 */
function uriEncode(value, encodeSlash) {
  let out = "";
  for (const ch of String(value)) {
    if (/[A-Za-z0-9\-_.~]/.test(ch)) { out += ch; continue; }
    if (ch === "/" && !encodeSlash) { out += "/"; continue; }
    for (const b of Buffer.from(ch, "utf8")) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

function amzTimestamp(now) {
  const d = new Date(now);
  const p = n => String(n).padStart(2, "0");
  const dateStamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  return { dateStamp, amzDate: `${dateStamp}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z` };
}

function canonicalQueryString(query) {
  return Object.keys(query)
    .map(k => [uriEncode(k, true), uriEncode(query[k], true)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/** Standaard-HTTP-transport op de kernmodules; injecteerbaar voor tests. */
function defaultTransport({ url, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "http:" ? require("http") : require("https");
    // Content-Length is verplicht bij uploads; hoort niet bij de ondertekende
    // headers, dus hier zetten (transportlaag) is correct én voldoende.
    const withLength = body != null
      ? { ...headers, "content-length": String(Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body))) }
      : headers;
    const req = mod.request(u, { method, headers: withLength }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("Opslag-endpoint antwoordt niet (timeout)")));
    if (body != null) req.write(body);
    req.end();
  });
}

class S3CompatibleObjectStorage {
  /**
   * @param {object} opts
   * @param {string} opts.endpoint         basis-URL van de opslag (http(s)://host[:poort])
   * @param {string} opts.bucket           bucketnaam (vooraf aangemaakt in productie)
   * @param {string} opts.accessKeyId      toegangssleutel
   * @param {string} opts.secretAccessKey  geheime sleutel
   * @param {string} [opts.region]         regionaam voor de handtekening
   * @param {boolean} [opts.forcePathStyle] pad-stijl (/bucket/key) i.p.v. host-stijl; pad-stijl werkt overal
   * @param {Function} [opts.transport]    injecteerbaar transport voor tests
   */
  constructor({ endpoint, bucket, accessKeyId, secretAccessKey, region = "us-east-1",
    forcePathStyle = true, urlTtlSeconds = DEFAULT_URL_TTL_SECONDS,
    allowedMime = DEFAULT_ALLOWED_MIME, maxBytes = DEFAULT_MAX_BYTES, transport = null } = {}) {
    const missing = [
      !clean(endpoint) && "endpoint", !clean(bucket) && "bucket",
      !clean(accessKeyId) && "accessKeyId", !clean(secretAccessKey) && "secretAccessKey",
    ].filter(Boolean);
    if (missing.length) {
      const e = new Error(`Objectopslag-configuratie onvolledig: ${missing.join(", ")} ontbreekt`);
      e.status = 500; e.code = "OBJECT_STORAGE_MISCONFIGURED"; throw e;
    }
    this.name = "s3";
    this.endpointUrl = new URL(clean(endpoint));
    this.bucket = clean(bucket);
    this.accessKeyId = clean(accessKeyId);
    this.secretAccessKey = clean(secretAccessKey);
    this.region = clean(region) || "us-east-1";
    this.forcePathStyle = forcePathStyle !== false;
    this.urlTtlSeconds = Number(urlTtlSeconds) || DEFAULT_URL_TTL_SECONDS;
    this.allowedMime = allowedMime;
    this.maxBytes = maxBytes;
    this.transport = transport || defaultTransport;
  }

  hostFor() {
    return this.forcePathStyle ? this.endpointUrl.host : `${this.bucket}.${this.endpointUrl.host}`;
  }

  /** Canoniek pad voor een objectkey ("" = de bucket zelf). */
  uriFor(key) {
    const enc = key ? `/${uriEncode(key, false)}` : "/";
    if (!this.forcePathStyle) return enc;
    return `/${uriEncode(this.bucket, true)}${key ? enc : ""}`;
  }

  signingKeyFor(dateStamp) {
    return hmac(hmac(hmac(hmac(`AWS4${this.secretAccessKey}`, dateStamp), this.region), "s3"), "aws4_request");
  }

  signatureFor({ method, uri, query, headers, signedHeaderNames, payloadHash, amzDate, dateStamp }) {
    const canonicalHeaders = signedHeaderNames.map(h => `${h}:${clean(headers[h])}\n`).join("");
    const canonicalRequest = [
      method, uri, canonicalQueryString(query),
      canonicalHeaders, signedHeaderNames.join(";"), payloadHash,
    ].join("\n");
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
    return crypto.createHmac("sha256", this.signingKeyFor(dateStamp)).update(stringToSign, "utf8").digest("hex");
  }

  /**
   * Onderteken een serverzijdige operatie met headers (voor put/get/delete).
   * Geeft { url, headers } terug; de payloadhash zit in de handtekening zodat
   * een gemanipuleerde body door de opslag zelf geweigerd wordt.
   */
  signRequest({ method, key, headers = {}, payload = null, query = {}, now = Date.now() }) {
    const { amzDate, dateStamp } = amzTimestamp(now);
    const host = this.hostFor();
    const payloadHash = payload == null ? EMPTY_SHA256 : sha256hex(payload);
    const allHeaders = {};
    for (const [k, v] of Object.entries(headers)) allHeaders[k.toLowerCase()] = clean(v);
    allHeaders.host = host;
    allHeaders["x-amz-date"] = amzDate;
    allHeaders["x-amz-content-sha256"] = payloadHash;
    const signedHeaderNames = Object.keys(allHeaders).sort();

    const uri = this.uriFor(key);
    const signature = this.signatureFor({ method, uri, query, headers: allHeaders, signedHeaderNames, payloadHash, amzDate, dateStamp });
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    allHeaders.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`;

    const qs = canonicalQueryString(query);
    const url = `${this.endpointUrl.protocol}//${host}${uri}${qs ? `?${qs}` : ""}`;
    return { url, headers: allHeaders };
  }

  /**
   * Vooraf ondertekende URL (query-authenticatie): de client praat rechtstreeks
   * en kortlevend met de opslag, zonder dat de app in het datapad zit en zonder
   * dat er ooit een sleutel naar de client gaat.
   */
  presignUrl({ method, key, ttlSeconds = null, query = {}, now = Date.now() }) {
    const { amzDate, dateStamp } = amzTimestamp(now);
    const host = this.hostFor();
    const expires = Math.min(Math.max(Number(ttlSeconds) || this.urlTtlSeconds, 1), 7 * 86400);
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const fullQuery = {
      ...query,
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.accessKeyId}/${scope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expires),
      "X-Amz-SignedHeaders": "host",
    };
    const uri = this.uriFor(key);
    const signature = this.signatureFor({
      method, uri, query: fullQuery, headers: { host }, signedHeaderNames: ["host"],
      payloadHash: UNSIGNED, amzDate, dateStamp,
    });
    const url = `${this.endpointUrl.protocol}//${host}${uri}?${canonicalQueryString(fullQuery)}&X-Amz-Signature=${signature}`;
    return { url, expiresAt: Math.floor(now / 1000) + expires };
  }

  /** Lage-niveau-verzoek naar de opslag; vertaalt foutstatussen naar poortfouten. */
  async send(method, key, { body = null, headers = {}, query = {} } = {}) {
    const signed = this.signRequest({ method, key, headers, payload: body, query });
    const res = await this.transport({ url: signed.url, method, headers: signed.headers, body });
    if (res.status === 404) {
      const e = new Error("Object niet gevonden"); e.status = 404; e.code = "NOT_FOUND"; throw e;
    }
    if (res.status < 200 || res.status >= 300) {
      const detail = res.body ? String(res.body).slice(0, 300) : "";
      const e = new Error(`Opslag weigerde ${method} (${res.status})${detail ? `: ${detail}` : ""}`);
      e.status = res.status >= 500 ? 502 : res.status; e.code = "OBJECT_STORAGE_ERROR"; throw e;
    }
    return res;
  }

  metaKeyFor(key) { return `${key}.meta.json`; }

  async writeMeta(key, meta) {
    const body = Buffer.from(JSON.stringify(meta, null, 2));
    await this.send("PUT", this.metaKeyFor(key), { body, headers: { "content-type": "application/json" } });
  }

  /** Bewaar een object + zijn metadata. Key wordt server-side gebouwd. */
  async put({ tenantId, scope, id, extension, key = null, content, mimeType, size, checksum = null, fileName = "", scanStatus = "pending" }) {
    const objectKey = key || buildObjectKey({ tenantId, scope, id, extension });
    assertTenantOwnsKey(tenantId, objectKey);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content == null ? "" : content));
    const validated = validateUpload(
      { mimeType, size: size != null ? Number(size) : buf.length, content: buf, checksum },
      { allowedMime: this.allowedMime, maxBytes: this.maxBytes });

    await this.send("PUT", objectKey, { body: buf, headers: { "content-type": validated.mimeType } });
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
    // DELETE is idempotent in het protocol: een al verwijderd object geeft
    // gewoon een lege 204, dus geen aparte 404-afhandeling nodig.
    await this.send("DELETE", key);
    await this.send("DELETE", this.metaKeyFor(key));
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
    const { url, expiresAt } = this.presignUrl({ method: "PUT", key, ttlSeconds });
    return { key, expiresAt, method: "PUT", url, headers: { "Content-Type": mimeType } };
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
    const query = meta.fileName
      ? { "response-content-disposition": `attachment; filename="${meta.fileName.replace(/["\\]/g, "")}"` }
      : {};
    const { url, expiresAt } = this.presignUrl({ method: "GET", key, ttlSeconds, query });
    return { key, expiresAt, method: "GET", url, fileName: meta.fileName || null, mimeType: meta.mimeType };
  }

  /**
   * Zorg dat de bucket bestaat (dev/test/CI). In productie wordt de bucket
   * vooraf aangemaakt met het juiste retentie- en versiebeleid; dit is bewust
   * geen productie-pad zodat een typefout in de bucketnaam daar hard faalt.
   */
  async ensureBucket() {
    const probe = this.signRequest({ method: "HEAD", key: "" });
    const res = await this.transport({ url: probe.url, method: "HEAD", headers: probe.headers, body: null });
    if (res.status >= 200 && res.status < 300) return { created: false };
    if (res.status !== 404) {
      const e = new Error(`Bucketcontrole faalde (${res.status})`); e.status = 502; e.code = "OBJECT_STORAGE_ERROR"; throw e;
    }
    await this.send("PUT", "");
    return { created: true };
  }

  /** Bereikbaarheidscheck voor readiness: bestaat de bucket en mogen we erin? */
  async healthCheck() {
    try {
      const probe = this.signRequest({ method: "HEAD", key: "" });
      const res = await this.transport({ url: probe.url, method: "HEAD", headers: probe.headers, body: null });
      return { ok: res.status >= 200 && res.status < 300, status: res.status };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err).slice(0, 200) };
    }
  }

  status() {
    // Bewust zonder sleutels en zonder volledige endpoint-URL met credentials.
    return {
      adapter: this.name, mode: "s3-compatible",
      endpoint: `${this.endpointUrl.protocol}//${this.endpointUrl.host}`,
      bucket: this.bucket, region: this.region,
      pathStyle: this.forcePathStyle, urlTtlSeconds: this.urlTtlSeconds,
    };
  }
}

module.exports = { S3CompatibleObjectStorage, DEFAULT_URL_TTL_SECONDS, uriEncode, canonicalQueryString };
