"use strict";
// Azure Blob-objectopslag (P0-08 · productiekeuze van de eigenaar).
//
// Twee lagen bewijs, zelfde lat als de s3-adapter:
//  1. GEDRAG: het volledige poortcontract tegen een fake transport, inclusief
//     tenantisolatie, Shared Key-headers, SAS-parameters, sidecar-metadata en
//     de virusscan-blokkade. Contractpariteit met de andere adapters is de
//     kern: wisselen = configuratie, geen gedragsverschil.
//  2. LIVE: hetzelfde contract tegen Azurite, de officiële opslag-emulator
//     met exact dezelfde handtekeningvalidatie als de echte dienst · alleen
//     als AZURE_TEST_ENDPOINT gezet is (CI start die emulator).
const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

const { AzureBlobObjectStorage, API_VERSION } = require("../src/infrastructure/azure/object-storage");
const { isObjectStorageProvider } = require("../src/ports/object-storage");

// Publiek gedocumenteerde emulator-account (geen geheim).
const EMULATOR_ACCOUNT = "devstoreaccount1";
const EMULATOR_KEY = "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";

// ── Fake transport: minimale blob-opslag in het geheugen ────────────────────
function fakeStore() {
  const objects = new Map();
  const requests = [];
  const transport = async ({ url, method, headers, body }) => {
    const u = new URL(url);
    requests.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers, body });
    const key = decodeURIComponent(u.pathname);
    if (u.searchParams.get("restype") === "container") {
      if (method === "PUT") { objects.set(key, Buffer.alloc(0)); return { status: 201, headers: {}, body: Buffer.alloc(0) }; }
      return objects.has(key)
        ? { status: 200, headers: {}, body: Buffer.alloc(0) }
        : { status: 404, headers: {}, body: Buffer.alloc(0) };
    }
    if (method === "PUT") { objects.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body || "")); return { status: 201, headers: {}, body: Buffer.alloc(0) }; }
    if (method === "GET" || method === "HEAD") {
      if (!objects.has(key)) return { status: 404, headers: {}, body: Buffer.alloc(0) };
      const b = objects.get(key);
      return { status: 200, headers: { "content-length": String(b.length) }, body: method === "GET" ? b : Buffer.alloc(0) };
    }
    if (method === "DELETE") {
      // Blob-gedrag: een ontbrekende blob verwijderen is een 404, geen 204.
      if (!objects.has(key)) return { status: 404, headers: {}, body: Buffer.alloc(0) };
      objects.delete(key);
      return { status: 202, headers: {}, body: Buffer.alloc(0) };
    }
    return { status: 400, headers: {}, body: Buffer.alloc(0) };
  };
  return { objects, requests, transport };
}

function makeAdapter(store, overrides = {}) {
  return new AzureBlobObjectStorage({
    endpoint: "http://storage.local:10000/testaccount", container: "monargo-files",
    accountName: "testaccount", accountKey: Buffer.from("testsleutel-32-bytes-lang!!!").toString("base64"),
    transport: store.transport, ...overrides,
  });
}

test("azure-adapter: implementeert de poort en weigert onvolledige of kapotte configuratie", () => {
  assert.ok(isObjectStorageProvider(makeAdapter(fakeStore())));
  assert.throws(() => new AzureBlobObjectStorage({ endpoint: "http://x" }),
    e => e.code === "OBJECT_STORAGE_MISCONFIGURED" && /container/.test(e.message));
  assert.throws(() => new AzureBlobObjectStorage({
    endpoint: "http://x", container: "c", accountName: "a", accountKey: "@@geen-base64@@",
  }), e => e.code === "OBJECT_STORAGE_MISCONFIGURED" && /base64/.test(e.message));
});

test("azure-adapter: put → metadata → get → delete, met sidecar en Shared Key-headers", async () => {
  const store = fakeStore();
  const az = makeAdapter(store);
  const content = Buffer.from("werkbon-bijlage");

  const stored = await az.put({ tenantId: "t1", scope: "workorders", id: "w1", extension: "pdf", content, mimeType: "application/pdf", fileName: "bon.pdf" });
  assert.equal(stored.key, "t/t1/workorders/w1.pdf");
  assert.equal(stored.checksum, crypto.createHash("sha256").update(content).digest("hex"));
  // Object + sidecar, allebei onder het container-pad (emulatorvorm: account in het pad).
  assert.ok(store.objects.has("/testaccount/monargo-files/t/t1/workorders/w1.pdf"));
  assert.ok(store.objects.has("/testaccount/monargo-files/t/t1/workorders/w1.pdf.meta.json"));
  // Elk verzoek draagt de Shared Key-autorisatie en de protocolheaders.
  const putReq = store.requests.find(r => r.method === "PUT" && r.path.endsWith("w1.pdf"));
  assert.match(putReq.headers.authorization, /^SharedKey testaccount:[A-Za-z0-9+/]+=*$/);
  assert.equal(putReq.headers["x-ms-blob-type"], "BlockBlob");
  assert.equal(putReq.headers["x-ms-version"], API_VERSION);
  assert.ok(putReq.headers["x-ms-date"], "x-ms-date aanwezig");

  const meta = await az.metadata(stored.key, { tenantId: "t1" });
  assert.equal(meta.fileName, "bon.pdf");
  assert.equal(meta.scanStatus, "pending");

  const stream = await az.get(stored.key, { tenantId: "t1" });
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  assert.equal(Buffer.concat(chunks).toString(), "werkbon-bijlage");

  await az.delete(stored.key, { tenantId: "t1" });
  assert.equal(store.objects.size, 0, "object én sidecar verwijderd");
  // Nogmaals verwijderen is geen fout (idempotent), ondanks de 404 van de opslag.
  await assert.doesNotReject(() => az.delete(stored.key, { tenantId: "t1" }));
  await assert.rejects(() => az.metadata(stored.key, { tenantId: "t1" }), e => e.code === "NOT_FOUND");
});

test("azure-adapter: tenantisolatie op elke operatie", async () => {
  const az = makeAdapter(fakeStore());
  await az.put({ tenantId: "t1", scope: "docs", id: "d1", extension: "pdf", content: "x", mimeType: "application/pdf" });
  for (const op of [
    () => az.get("t/t1/docs/d1.pdf", { tenantId: "t2" }),
    () => az.metadata("t/t1/docs/d1.pdf", { tenantId: "t2" }),
    () => az.delete("t/t1/docs/d1.pdf", { tenantId: "t2" }),
    () => az.createDownloadUrl({ tenantId: "t2", key: "t/t1/docs/d1.pdf" }),
    () => az.put({ tenantId: "t2", key: "t/t1/docs/d1.pdf", content: "x", mimeType: "application/pdf" }),
    () => az.registerUpload({ tenantId: "t2", key: "t/t1/docs/d1.pdf", mimeType: "application/pdf" }),
  ]) {
    await assert.rejects(op, e => e.code === "CROSS_TENANT_KEY", "operatie op andermans key geweigerd");
  }
});

test("azure-adapter: uploadslot valideert vooraf en geeft een SAS rechtstreeks naar de opslag", async () => {
  const az = makeAdapter(fakeStore());
  await assert.rejects(
    () => az.createUploadUrl({ tenantId: "t1", scope: "docs", mimeType: "application/x-msdownload", size: 100 }),
    e => e.code === "MIME_NOT_ALLOWED");

  const slot = await az.createUploadUrl({ tenantId: "t1", scope: "docs", id: "d9", extension: "pdf", mimeType: "application/pdf", size: 1000 });
  const u = new URL(slot.url);
  assert.equal(u.host, "storage.local:10000", "upload gaat rechtstreeks naar de opslag, niet via de app");
  assert.equal(u.pathname, "/testaccount/monargo-files/t/t1/docs/d9.pdf");
  assert.equal(u.searchParams.get("sp"), "cw", "alleen aanmaken/schrijven, niet lezen of verwijderen");
  assert.equal(u.searchParams.get("sr"), "b", "precies één blob");
  assert.equal(u.searchParams.get("sv"), API_VERSION);
  assert.ok(u.searchParams.get("sig"), "ondertekend");
  assert.ok(u.searchParams.get("se") > u.searchParams.get("st"), "geldigheidsvenster klopt");
  assert.equal(slot.headers["x-ms-blob-type"], "BlockBlob", "client krijgt het verplichte blobtype mee");
});

test("azure-adapter: registerUpload sluit een rechtstreekse upload af; zonder registratie geen download", async () => {
  const store = fakeStore();
  const az = makeAdapter(store);
  const key = "t/t1/docs/direct1.pdf";
  store.objects.set(`/testaccount/monargo-files/${key}`, Buffer.from("direct geupload"));

  await assert.rejects(() => az.createDownloadUrl({ tenantId: "t1", key }), e => e.code === "NOT_FOUND",
    "geen metadata → geen scanstatus → geen uitlevering");

  const reg = await az.registerUpload({ tenantId: "t1", key, mimeType: "application/pdf", fileName: "upload.pdf" });
  assert.equal(reg.size, Buffer.from("direct geupload").length, "grootte uit de opslag zelf, niet uit clientinput");
  const dl = await az.createDownloadUrl({ tenantId: "t1", key });
  assert.equal(new URL(dl.url).searchParams.get("sp"), "r", "download-SAS is alleen-lezen");
  assert.match(dl.url, /rscd=/, "download draagt de originele bestandsnaam");
});

test("azure-adapter: besmette bestanden worden nooit uitgeleverd", async () => {
  const az = makeAdapter(fakeStore());
  const stored = await az.put({ tenantId: "t1", scope: "docs", id: "v1", extension: "pdf", content: "x", mimeType: "application/pdf" });
  await az.setScanStatus(stored.key, "infected", { tenantId: "t1" });
  await assert.rejects(() => az.createDownloadUrl({ tenantId: "t1", key: stored.key }), e => e.code === "FILE_INFECTED");
});

test("azure-adapter: ensureBucket maakt de container alleen aan als hij ontbreekt", async () => {
  const store = fakeStore();
  const az = makeAdapter(store);
  const first = await az.ensureBucket();
  assert.equal(first.created, true);
  const createReq = store.requests.find(r => r.method === "PUT" && r.query.restype === "container");
  assert.ok(createReq, "container aangemaakt met restype=container");
  const second = await az.ensureBucket();
  assert.equal(second.created, false, "bestaande container blijft ongemoeid");
});

test("azure-adapter: status bevat geen sleutels of geheimen", () => {
  const az = makeAdapter(fakeStore());
  const flat = JSON.stringify(az.status());
  assert.ok(!flat.includes("testsleutel") && !/[A-Za-z0-9+/]{20,}=/.test(flat), "geen credentials in status");
  assert.equal(az.status().adapter, "azure-blob");
});

// ── Live tegen Azurite, de officiële opslag-emulator (CI start die) ─────────
//   AZURE_TEST_ENDPOINT=http://127.0.0.1:10000/devstoreaccount1 npm test
const LIVE_ENDPOINT = process.env.AZURE_TEST_ENDPOINT || "";
test("azure-adapter live: volledig contract tegen de opslag-emulator",
  { skip: !LIVE_ENDPOINT && "AZURE_TEST_ENDPOINT niet gezet" }, async () => {
    const az = new AzureBlobObjectStorage({
      endpoint: LIVE_ENDPOINT,
      container: process.env.AZURE_TEST_CONTAINER || "monargo-test",
      accountName: process.env.AZURE_TEST_ACCOUNT || EMULATOR_ACCOUNT,
      accountKey: process.env.AZURE_TEST_KEY || EMULATOR_KEY,
    });
    await az.ensureBucket();

    const marker = `live_${Date.now().toString(36)}`;
    const content = Buffer.from(`live-bewijs ${marker}`);
    const stored = await az.put({ tenantId: "t_live", scope: "proof", id: marker, extension: "txt", content, mimeType: "text/plain", fileName: "bewijs.txt" });
    try {
      const meta = await az.metadata(stored.key, { tenantId: "t_live" });
      assert.equal(meta.checksum, stored.checksum);

      const stream = await az.get(stored.key, { tenantId: "t_live" });
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      assert.equal(Buffer.concat(chunks).toString(), `live-bewijs ${marker}`);

      // De SAS-download werkt ZONDER onze sleutels: het echte bewijs dat de
      // dienst onze handtekening accepteert.
      const dl = await az.createDownloadUrl({ tenantId: "t_live", key: stored.key });
      const res = await fetch(dl.url);
      assert.equal(res.status, 200, `opslag accepteert de SAS-download (${res.status})`);
      assert.equal(Buffer.from(await res.arrayBuffer()).toString(), `live-bewijs ${marker}`);

      // Upload-slot: rechtstreeks PUT'en met alleen de SAS-URL.
      const slot = await az.createUploadUrl({ tenantId: "t_live", scope: "proof", id: `${marker}_up`, extension: "txt", mimeType: "text/plain", size: 9 });
      const up = await fetch(slot.url, { method: "PUT", body: "direct-up", headers: slot.headers });
      assert.equal(up.status, 201, `opslag accepteert de SAS-upload (${up.status})`);
      const reg = await az.registerUpload({ tenantId: "t_live", key: slot.key, mimeType: "text/plain", fileName: "up.txt" });
      assert.equal(reg.size, 9);
      await az.delete(slot.key, { tenantId: "t_live" });

      const health = await az.healthCheck();
      assert.equal(health.ok, true);
    } finally {
      await az.delete(stored.key, { tenantId: "t_live" }).catch(() => {});
    }
  });
