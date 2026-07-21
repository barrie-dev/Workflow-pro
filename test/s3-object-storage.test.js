"use strict";
// S3-compatibele objectopslag (CTO P0-08 · handover 4.2 F-08).
//
// Drie lagen bewijs:
//  1. GOUDSTANDAARD: de handtekeningberekening tegen de officiële testvectoren
//     uit de protocolspecificatie (bekende sleutels, bekende datum, bekende
//     uitkomst). Als deze kloppen, accepteert elke s3-compatibele opslag ons.
//  2. GEDRAG: het volledige poortcontract tegen een fake transport, inclusief
//     tenantisolatie, sidecar-metadata en de virusscan-blokkade.
//  3. LIVE: hetzelfde contract tegen een echte s3-compatibele server (MinIO),
//     alleen als S3_TEST_ENDPOINT gezet is · CI start die server.
const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

const { S3CompatibleObjectStorage } = require("../src/infrastructure/s3/object-storage");
const { isObjectStorageProvider } = require("../src/ports/object-storage");

// Vaste waarden uit de officiële voorbeeldset van de protocolspecificatie.
const VECTOR_KEY = "AKIAIOSFODNN7EXAMPLE";
const VECTOR_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const VECTOR_NOW = Date.UTC(2013, 4, 24, 0, 0, 0);   // 20130524T000000Z

function vectorAdapter() {
  return new S3CompatibleObjectStorage({
    endpoint: "https://s3.amazonaws.com", bucket: "examplebucket",
    accessKeyId: VECTOR_KEY, secretAccessKey: VECTOR_SECRET,
    region: "us-east-1", forcePathStyle: false,
  });
}

test("sigv4 goudstandaard: vooraf ondertekende GET-URL komt exact overeen met de spec-vector", () => {
  const s3 = vectorAdapter();
  const { url } = s3.presignUrl({ method: "GET", key: "test.txt", ttlSeconds: 86400, now: VECTOR_NOW });
  const u = new URL(url);
  assert.equal(u.host, "examplebucket.s3.amazonaws.com");
  assert.equal(u.pathname, "/test.txt");
  assert.equal(u.searchParams.get("X-Amz-Expires"), "86400");
  assert.equal(u.searchParams.get("X-Amz-Date"), "20130524T000000Z");
  assert.equal(u.searchParams.get("X-Amz-SignedHeaders"), "host");
  // De bekende uitkomst uit de specificatie · dit is de hele kern van P0-08:
  // klopt deze, dan verifieert elke s3-compatibele opslag onze URL's.
  assert.equal(u.searchParams.get("X-Amz-Signature"),
    "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
});

test("sigv4 goudstandaard: header-ondertekende GET met Range komt exact overeen met de spec-vector", () => {
  const s3 = vectorAdapter();
  const { headers } = s3.signRequest({ method: "GET", key: "test.txt", headers: { Range: "bytes=0-9" }, payload: null, now: VECTOR_NOW });
  assert.equal(headers["x-amz-date"], "20130524T000000Z");
  assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request, /);
  assert.match(headers.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, /);
  assert.match(headers.authorization,
    /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
});

// ── Fake transport: een minimale s3-compatibele opslag in het geheugen ───────
function fakeStore() {
  const objects = new Map();
  const requests = [];
  const transport = async ({ url, method, headers, body }) => {
    const u = new URL(url);
    requests.push({ method, path: u.pathname, headers, body });
    const key = decodeURIComponent(u.pathname);
    if (method === "PUT") { objects.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body || "")); return { status: 200, headers: {}, body: Buffer.alloc(0) }; }
    if (method === "GET" || method === "HEAD") {
      if (!objects.has(key)) return { status: 404, headers: {}, body: Buffer.alloc(0) };
      const b = objects.get(key);
      return { status: 200, headers: { "content-length": String(b.length) }, body: method === "GET" ? b : Buffer.alloc(0) };
    }
    if (method === "DELETE") { objects.delete(key); return { status: 204, headers: {}, body: Buffer.alloc(0) }; }
    return { status: 400, headers: {}, body: Buffer.alloc(0) };
  };
  return { objects, requests, transport };
}

function makeAdapter(store, overrides = {}) {
  return new S3CompatibleObjectStorage({
    endpoint: "http://storage.local:9000", bucket: "monargo-files",
    accessKeyId: "testkey", secretAccessKey: "testsecret",
    region: "local", transport: store.transport, ...overrides,
  });
}

test("s3-adapter: implementeert de poort en weigert onvolledige configuratie", () => {
  assert.ok(isObjectStorageProvider(makeAdapter(fakeStore())));
  assert.throws(() => new S3CompatibleObjectStorage({ endpoint: "http://x" }),
    e => e.code === "OBJECT_STORAGE_MISCONFIGURED" && /bucket/.test(e.message));
});

test("s3-adapter: put → metadata → get → delete, met sidecar en ondertekende verzoeken", async () => {
  const store = fakeStore();
  const s3 = makeAdapter(store);
  const content = Buffer.from("factuurinhoud");

  const stored = await s3.put({ tenantId: "t1", scope: "invoices", id: "f1", extension: "pdf", content, mimeType: "application/pdf", fileName: "factuur.pdf" });
  assert.equal(stored.key, "t/t1/invoices/f1.pdf");
  assert.equal(stored.checksum, crypto.createHash("sha256").update(content).digest("hex"));
  // Object + sidecar-metadata, allebei onder het bucketpad.
  assert.ok(store.objects.has("/monargo-files/t/t1/invoices/f1.pdf"));
  assert.ok(store.objects.has("/monargo-files/t/t1/invoices/f1.pdf.meta.json"));
  // Elk verzoek is ondertekend en draagt de payloadhash.
  const putReq = store.requests.find(r => r.method === "PUT" && r.path.endsWith("f1.pdf"));
  assert.match(putReq.headers.authorization, /^AWS4-HMAC-SHA256 Credential=testkey\//);
  assert.equal(putReq.headers["x-amz-content-sha256"], stored.checksum);

  const meta = await s3.metadata(stored.key, { tenantId: "t1" });
  assert.equal(meta.fileName, "factuur.pdf");
  assert.equal(meta.scanStatus, "pending");

  const stream = await s3.get(stored.key, { tenantId: "t1" });
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  assert.equal(Buffer.concat(chunks).toString(), "factuurinhoud");

  await s3.delete(stored.key, { tenantId: "t1" });
  assert.equal(store.objects.size, 0, "object én sidecar verwijderd");
  await assert.rejects(() => s3.metadata(stored.key, { tenantId: "t1" }), e => e.code === "NOT_FOUND");
});

test("s3-adapter: tenantisolatie op elke operatie", async () => {
  const s3 = makeAdapter(fakeStore());
  await s3.put({ tenantId: "t1", scope: "docs", id: "d1", extension: "pdf", content: "x", mimeType: "application/pdf" });
  for (const op of [
    () => s3.get("t/t1/docs/d1.pdf", { tenantId: "t2" }),
    () => s3.metadata("t/t1/docs/d1.pdf", { tenantId: "t2" }),
    () => s3.delete("t/t1/docs/d1.pdf", { tenantId: "t2" }),
    () => s3.createDownloadUrl({ tenantId: "t2", key: "t/t1/docs/d1.pdf" }),
    () => s3.put({ tenantId: "t2", key: "t/t1/docs/d1.pdf", content: "x", mimeType: "application/pdf" }),
  ]) {
    await assert.rejects(op, e => e.code === "CROSS_TENANT_KEY", "operatie op andermans key geweigerd");
  }
});

test("s3-adapter: uploadslot valideert vooraf en wijst rechtstreeks naar de opslag", async () => {
  const s3 = makeAdapter(fakeStore());
  await assert.rejects(
    () => s3.createUploadUrl({ tenantId: "t1", scope: "docs", mimeType: "application/x-msdownload", size: 100 }),
    e => e.code === "MIME_NOT_ALLOWED");
  await assert.rejects(
    () => s3.createUploadUrl({ tenantId: "t1", scope: "docs", mimeType: "application/pdf", size: 999 * 1024 * 1024 }),
    e => e.code === "FILE_TOO_LARGE");

  const slot = await s3.createUploadUrl({ tenantId: "t1", scope: "docs", id: "d9", extension: "pdf", mimeType: "application/pdf", size: 1000 });
  const u = new URL(slot.url);
  assert.equal(u.host, "storage.local:9000", "upload gaat rechtstreeks naar de opslag, niet via de app");
  assert.equal(u.pathname, "/monargo-files/t/t1/docs/d9.pdf");
  assert.ok(u.searchParams.get("X-Amz-Signature"), "ondertekend");
  assert.equal(u.searchParams.get("X-Amz-Expires"), "900", "kortlevend (standaard-TTL)");
});

test("s3-adapter: registerUpload sluit een rechtstreekse upload af; zonder registratie geen download", async () => {
  const store = fakeStore();
  const s3 = makeAdapter(store);
  // Simuleer een client die via het uploadslot rechtstreeks heeft geüpload:
  // het object staat er, maar er is nog geen metadata.
  const key = "t/t1/docs/direct1.pdf";
  store.objects.set(`/monargo-files/${key}`, Buffer.from("direct geupload"));

  await assert.rejects(() => s3.createDownloadUrl({ tenantId: "t1", key }), e => e.code === "NOT_FOUND",
    "geen metadata → geen scanstatus → geen uitlevering");

  const reg = await s3.registerUpload({ tenantId: "t1", key, mimeType: "application/pdf", fileName: "upload.pdf" });
  assert.equal(reg.size, Buffer.from("direct geupload").length, "grootte uit de opslag zelf, niet uit clientinput");
  const dl = await s3.createDownloadUrl({ tenantId: "t1", key });
  assert.match(dl.url, /response-content-disposition=/, "download draagt de originele bestandsnaam");
});

test("s3-adapter: besmette bestanden worden nooit uitgeleverd", async () => {
  const s3 = makeAdapter(fakeStore());
  const stored = await s3.put({ tenantId: "t1", scope: "docs", id: "v1", extension: "pdf", content: "x", mimeType: "application/pdf" });
  await s3.setScanStatus(stored.key, "infected", { tenantId: "t1" });
  await assert.rejects(() => s3.createDownloadUrl({ tenantId: "t1", key: stored.key }), e => e.code === "FILE_INFECTED");
});

test("s3-adapter: ensureBucket maakt de bucket alleen aan als hij ontbreekt", async () => {
  const store = fakeStore();
  const s3 = makeAdapter(store);
  const first = await s3.ensureBucket();
  assert.equal(first.created, true);
  assert.ok(store.objects.has("/monargo-files"), "bucket aangemaakt");
  const second = await s3.ensureBucket();
  assert.equal(second.created, false, "bestaande bucket blijft ongemoeid");
});

test("s3-adapter: status bevat geen sleutels of geheimen", () => {
  const s3 = makeAdapter(fakeStore());
  const flat = JSON.stringify(s3.status());
  assert.ok(!flat.includes("testsecret") && !flat.includes("testkey"), "geen credentials in status");
  assert.equal(s3.status().adapter, "s3");
});

// ── Live tegen een echte s3-compatibele server (MinIO in CI) ────────────────
//   S3_TEST_ENDPOINT=http://localhost:9000 S3_TEST_ACCESS_KEY=... S3_TEST_SECRET_KEY=... npm test
const LIVE_ENDPOINT = process.env.S3_TEST_ENDPOINT || "";
test("s3-adapter live: volledig contract tegen een echte s3-compatibele opslag",
  { skip: !LIVE_ENDPOINT && "S3_TEST_ENDPOINT niet gezet" }, async () => {
    const s3 = new S3CompatibleObjectStorage({
      endpoint: LIVE_ENDPOINT,
      bucket: process.env.S3_TEST_BUCKET || "monargo-test",
      accessKeyId: process.env.S3_TEST_ACCESS_KEY || "monargo",
      secretAccessKey: process.env.S3_TEST_SECRET_KEY || "monargo123",
      region: process.env.S3_TEST_REGION || "us-east-1",
    });
    await s3.ensureBucket();

    const marker = `live_${Date.now().toString(36)}`;
    const content = Buffer.from(`live-bewijs ${marker}`);
    const stored = await s3.put({ tenantId: "t_live", scope: "proof", id: marker, extension: "txt", content, mimeType: "text/plain", fileName: "bewijs.txt" });
    try {
      // Rondje door het volledige contract tegen de echte server.
      const meta = await s3.metadata(stored.key, { tenantId: "t_live" });
      assert.equal(meta.checksum, stored.checksum);

      const stream = await s3.get(stored.key, { tenantId: "t_live" });
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      assert.equal(Buffer.concat(chunks).toString(), `live-bewijs ${marker}`);

      // De vooraf ondertekende download-URL werkt ZONDER onze sleutels: dit is
      // het echte bewijs dat de handtekening door de server geaccepteerd wordt.
      const dl = await s3.createDownloadUrl({ tenantId: "t_live", key: stored.key });
      const res = await fetch(dl.url);
      assert.equal(res.status, 200, "opslag accepteert de vooraf ondertekende URL");
      assert.equal(Buffer.from(await res.arrayBuffer()).toString(), `live-bewijs ${marker}`);

      // Upload-slot: rechtstreeks PUT'en met alleen de ondertekende URL.
      const slot = await s3.createUploadUrl({ tenantId: "t_live", scope: "proof", id: `${marker}_up`, extension: "txt", mimeType: "text/plain", size: 9 });
      const up = await fetch(slot.url, { method: "PUT", body: "direct-up", headers: slot.headers });
      assert.equal(up.status, 200, "opslag accepteert de ondertekende upload");
      const reg = await s3.registerUpload({ tenantId: "t_live", key: slot.key, mimeType: "text/plain", fileName: "up.txt" });
      assert.equal(reg.size, 9);
      await s3.delete(slot.key, { tenantId: "t_live" });

      const health = await s3.healthCheck();
      assert.equal(health.ok, true);
    } finally {
      await s3.delete(stored.key, { tenantId: "t_live" }).catch(() => {});
    }
  });
