"use strict";
// ObjectStorageProvider-contract (handover 4.2 · F-08).
//
// `objectStorageContract` is een herbruikbare suite die het POORTGEDRAG
// vastlegt. De handover eist dat het adaptercontract tegen LocalStorage én
// AzureBlobStorage getest wordt; deze suite is die gedeelde meetlat. Een
// S3-adapter moet hem net zo goed halen, zonder domeinwijziging.
const { test } = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const {
  buildObjectKey, tenantOfKey, assertTenantOwnsKey, validateUpload,
  isObjectStorageProvider, DEFAULT_MAX_BYTES,
} = require("../src/ports/object-storage");
const { LocalObjectStorage } = require("../src/infrastructure/local/object-storage");

const PDF = "application/pdf";
async function read(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

// ── Poortregels (adapter-onafhankelijk) ─────────────────────────────────────
test("objectkey: draagt tenantcontext en wordt server-side gebouwd", () => {
  const key = buildObjectKey({ tenantId: "t1", scope: "workorder", id: "abc", extension: "pdf" });
  assert.equal(key, "t/t1/workorder/abc.pdf");
  assert.equal(tenantOfKey(key), "t1");
  // Zonder tenant geen key · anders is cross-tenant toegang mogelijk.
  assert.throws(() => buildObjectKey({ scope: "x" }), e => e.code === "TENANT_REQUIRED");
  // De bestandsnaam zit er bewust NIET in (padtekens, PII).
  const gek = buildObjectKey({ tenantId: "t1", scope: "../../etc", id: "x", extension: "p df/" });
  assert.ok(!gek.includes(".."), "scope wordt geschoond");
  assert.match(gek, /^t\/t1\//);
});

test("objectkey: tenanteigendom wordt afgedwongen", () => {
  const key = buildObjectKey({ tenantId: "t1", scope: "invoice" });
  assert.doesNotThrow(() => assertTenantOwnsKey("t1", key));
  assert.throws(() => assertTenantOwnsKey("t2", key), e => e.code === "CROSS_TENANT_KEY" && e.status === 403);
  assert.throws(() => assertTenantOwnsKey("t1", "geen-geldige-key"), e => e.code === "CROSS_TENANT_KEY");
});

test("uploadvalidatie: MIME, grootte en checksum apart vastgelegd", () => {
  const content = Buffer.from("hallo");
  const ok = validateUpload({ mimeType: PDF, size: content.length, content });
  assert.equal(ok.mimeType, PDF);
  assert.equal(ok.size, 5);
  assert.equal(ok.checksum, crypto.createHash("sha256").update(content).digest("hex"));

  assert.throws(() => validateUpload({ mimeType: "application/x-msdownload", size: 10 }), e => e.code === "MIME_NOT_ALLOWED" && e.status === 415);
  assert.throws(() => validateUpload({ mimeType: PDF, size: DEFAULT_MAX_BYTES + 1 }), e => e.code === "FILE_TOO_LARGE" && e.status === 413);
  assert.throws(() => validateUpload({ mimeType: PDF, size: 0 }), e => e.code === "INVALID_SIZE");
  // Een meegestuurde checksum die niet klopt → afgewezen (onderweg gewijzigd).
  assert.throws(() => validateUpload({ mimeType: PDF, size: 5, content, checksum: "deadbeef" }), e => e.code === "CHECKSUM_MISMATCH");
  // Grootte die niet bij de inhoud past → afgewezen.
  assert.throws(() => validateUpload({ mimeType: PDF, size: 99, content }), e => e.code === "SIZE_MISMATCH");
});

/**
 * Gedeeld contract. Elke adapter moet dit halen.
 * @param {string} name
 * @param {() => Promise<{storage: object, cleanup?: Function}>} setup
 */
function objectStorageContract(name, setup) {
  test(`${name}: implementeert de poort`, async () => {
    const { storage, cleanup } = await setup();
    assert.ok(isObjectStorageProvider(storage), "alle poortmethodes aanwezig");
    if (cleanup) await cleanup();
  });

  test(`${name}: put slaat op, get leest terug, metadata klopt`, async () => {
    const { storage, cleanup } = await setup();
    const content = Buffer.from("factuurinhoud");
    const stored = await storage.put({
      tenantId: "t1", scope: "invoice", extension: "pdf",
      content, mimeType: PDF, fileName: "factuur 2026-001.pdf",
    });
    assert.match(stored.key, /^t\/t1\/invoice\//);
    assert.equal(stored.size, content.length);
    assert.equal(stored.scanStatus, "pending", "scanstatus start als pending");

    const back = await read(await storage.get(stored.key, { tenantId: "t1" }));
    assert.equal(back.toString(), "factuurinhoud");

    const meta = await storage.metadata(stored.key, { tenantId: "t1" });
    assert.equal(meta.mimeType, PDF);
    assert.equal(meta.fileName, "factuur 2026-001.pdf");
    assert.equal(meta.checksum, crypto.createHash("sha256").update(content).digest("hex"));
    if (cleanup) await cleanup();
  });

  test(`${name}: een andere tenant kan er niet bij`, async () => {
    const { storage, cleanup } = await setup();
    const stored = await storage.put({ tenantId: "t1", scope: "invoice", extension: "pdf", content: Buffer.from("geheim"), mimeType: PDF });
    await assert.rejects(() => storage.get(stored.key, { tenantId: "t2" }), e => e.code === "CROSS_TENANT_KEY");
    await assert.rejects(() => storage.metadata(stored.key, { tenantId: "t2" }), e => e.code === "CROSS_TENANT_KEY");
    await assert.rejects(() => storage.delete(stored.key, { tenantId: "t2" }), e => e.code === "CROSS_TENANT_KEY");
    await assert.rejects(() => storage.createDownloadUrl({ tenantId: "t2", key: stored.key }), e => e.code === "CROSS_TENANT_KEY");
    if (cleanup) await cleanup();
  });

  test(`${name}: weigert niet-toegestane types en te grote bestanden`, async () => {
    const { storage, cleanup } = await setup();
    await assert.rejects(() => storage.put({ tenantId: "t1", scope: "x", content: Buffer.from("MZ"), mimeType: "application/x-msdownload" }), e => e.code === "MIME_NOT_ALLOWED");
    await assert.rejects(() => storage.createUploadUrl({ tenantId: "t1", scope: "x", mimeType: PDF, size: DEFAULT_MAX_BYTES + 1 }), e => e.code === "FILE_TOO_LARGE");
    if (cleanup) await cleanup();
  });

  test(`${name}: ondertekende URL's zijn kortlevend en manipulatiebestendig`, async () => {
    const { storage, cleanup } = await setup();
    const stored = await storage.put({ tenantId: "t1", scope: "invoice", extension: "pdf", content: Buffer.from("x"), mimeType: PDF });

    const up = await storage.createUploadUrl({ tenantId: "t1", scope: "invoice", extension: "pdf", mimeType: PDF, size: 100 });
    assert.equal(up.method, "PUT");
    assert.ok(up.expiresAt > Math.floor(Date.now() / 1000), "vervaltijd in de toekomst");
    assert.match(up.url, /sig=[0-9a-f]{64}/);

    const down = await storage.createDownloadUrl({ tenantId: "t1", key: stored.key });
    const sig = /sig=([0-9a-f]+)/.exec(down.url)[1];
    assert.equal(storage.verifySignature({ key: stored.key, op: "get", expiresAt: down.expiresAt, signature: sig }), true);
    // Gemanipuleerde handtekening of key → geweigerd. Het laatste teken ECHT
    // wijzigen: blind "0" plakken is geen manipulatie als er al een 0 staat.
    const tampered = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    assert.throws(() => storage.verifySignature({ key: stored.key, op: "get", expiresAt: down.expiresAt, signature: tampered }), e => e.code === "INVALID_SIGNATURE");
    assert.throws(() => storage.verifySignature({ key: "t/t1/invoice/anders.pdf", op: "get", expiresAt: down.expiresAt, signature: sig }), e => e.code === "INVALID_SIGNATURE");
    // Verlopen link → 410, niet stil toestaan.
    assert.throws(() => storage.verifySignature({ key: stored.key, op: "get", expiresAt: down.expiresAt, signature: sig, now: down.expiresAt + 1 }), e => e.code === "URL_EXPIRED" && e.status === 410);
    if (cleanup) await cleanup();
  });

  test(`${name}: besmet bestand wordt niet uitgeleverd`, async () => {
    const { storage, cleanup } = await setup();
    const stored = await storage.put({ tenantId: "t1", scope: "upload", extension: "pdf", content: Buffer.from("x"), mimeType: PDF });
    await storage.setScanStatus(stored.key, "infected", { tenantId: "t1" });
    await assert.rejects(() => storage.createDownloadUrl({ tenantId: "t1", key: stored.key }), e => e.code === "FILE_INFECTED" && e.status === 403);
    // Na een schone herscan mag het weer.
    await storage.setScanStatus(stored.key, "clean", { tenantId: "t1" });
    assert.ok((await storage.createDownloadUrl({ tenantId: "t1", key: stored.key })).url);
    if (cleanup) await cleanup();
  });

  test(`${name}: delete verwijdert object én metadata`, async () => {
    const { storage, cleanup } = await setup();
    const stored = await storage.put({ tenantId: "t1", scope: "x", extension: "pdf", content: Buffer.from("x"), mimeType: PDF });
    await storage.delete(stored.key, { tenantId: "t1" });
    await assert.rejects(() => storage.get(stored.key, { tenantId: "t1" }), e => e.code === "NOT_FOUND");
    await assert.rejects(() => storage.metadata(stored.key, { tenantId: "t1" }), e => e.code === "NOT_FOUND");
    if (cleanup) await cleanup();
  });

  test(`${name}: onbekend object geeft 404, geen lege inhoud`, async () => {
    const { storage, cleanup } = await setup();
    await assert.rejects(() => storage.get("t/t1/x/bestaatniet.pdf", { tenantId: "t1" }), e => e.status === 404);
    if (cleanup) await cleanup();
  });
}

// ── Contract toegepast op de lokale adapter ─────────────────────────────────
function localSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mona-obj-"));
  return {
    storage: new LocalObjectStorage({ basePath: dir, signingKey: "test_signing_key_0123456789" }),
    cleanup: async () => { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
objectStorageContract("local-filesystem", async () => localSetup());

// ── Adapterspecifiek: padbeveiliging van de filesystem-implementatie ────────
test("local-filesystem: path traversal is onmogelijk", async () => {
  const { storage, cleanup } = localSetup();
  for (const bad of ["../buiten.pdf", "/etc/passwd", "t/t1/../../../buiten.pdf", "t\\t1\\x.pdf"]) {
    assert.throws(() => storage.resolvePath(bad), e => ["INVALID_KEY", "PATH_TRAVERSAL"].includes(e.code), `key '${bad}' moet geweigerd worden`);
  }
  // Een geldige key blijft netjes binnen de basismap.
  const ok = storage.resolvePath("t/t1/invoice/abc.pdf");
  assert.ok(ok.startsWith(storage.basePath));
  await cleanup();
});

test("local-filesystem: signingKey is verplicht", () => {
  assert.throws(() => new LocalObjectStorage({ basePath: os.tmpdir() }), e => e.code === "SIGNING_KEY_MISSING");
});

module.exports = { objectStorageContract };
