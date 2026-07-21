#!/usr/bin/env node
"use strict";

// DEV-05/06 · Live-koppelingscontrole (providerneutraal).
//
// Bewijst dat DEZE runtime praat met de geconfigureerde PostgreSQL EN
// objectopslag - Azure, s3-compatibel of wat dan ook - via exact dezelfde
// config die de app gebruikt. Draai dit in de omgeving waar de echte
// connectie-secrets als env-variabelen staan; het script leest ze daar en
// print NOOIT een connectiestring, sleutel of SAS-token.
//
//   node scripts/check-cloud-connection.js          → leesbaar, exit 1 bij fout
//   node scripts/check-cloud-connection.js --json    → machineleesbaar
//
// Wat het controleert:
//   DB      : verbinden (met autogedetecteerde TLS), SELECT 1, migratiestatus.
//   Opslag  : container/bucket bereikbaar, PUT + GET (bytes kloppen), een
//             signed/SAS-URL ophalen over HTTP, en opruimen (DELETE).

const { config } = require("../src/lib/config");

const jsonMode = process.argv.includes("--json");
const results = [];
function record(name, ok, detail) { results.push({ name, ok: !!ok, detail: detail || "" }); }

// Toon alleen host + database, nooit gebruiker/wachtwoord/query.
function maskDbUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? ":" + u.port : ""}${u.pathname}`;
  } catch (_) { return "(onleesbare DATABASE_URL)"; }
}
function maskEndpoint(url) {
  try { const u = new URL(url); return u.hostname; } catch (_) { return url ? "(endpoint gezet)" : "(geen endpoint)"; }
}

async function checkDatabase() {
  if (config.storageAdapter !== "postgres") {
    record("database", true, `overgeslagen · STORAGE_ADAPTER=${config.storageAdapter} (geen live-DB)`);
    return;
  }
  if (!/^postgres(ql)?:\/\//.test(config.database.url)) {
    record("database", false, "DATABASE_URL ontbreekt of is geen postgres(ql)://-string");
    return;
  }
  const { Pool } = require("pg");
  const { migrationStatus } = require("../src/infrastructure/postgres/migration-runner");
  const pool = new Pool({
    connectionString: config.database.url,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined,
    max: 2,
    connectionTimeoutMillis: 10000,
  });
  try {
    const r = await pool.query("SELECT 1 AS ok");
    if (r.rows[0].ok !== 1) throw new Error("SELECT 1 gaf geen 1 terug");
    record("database.connect", true, `${maskDbUrl(config.database.url)} · TLS ${config.database.ssl ? "aan" : "uit"}`);
    try {
      const st = await migrationStatus(pool);
      const ok = st.pending.length === 0;
      record("database.migrations", ok, `${st.applied.length}/${st.total} toegepast${st.pending.length ? ` · ${st.pending.length} openstaand` : ""}`);
    } catch (e) {
      record("database.migrations", false, `migratiestatus faalde: ${e.message}`);
    }
  } catch (e) {
    record("database.connect", false, `${maskDbUrl(config.database.url)} · ${e.message}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

async function readStream(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

// Eigen HTTP-GET via node:http(s) i.p.v. global fetch: fetch (undici) houdt op
// Windows keep-alive-sockets open die bij process.exit een libuv-assert geven.
// Hier sluiten we de socket expliciet, dus de tool eindigt overal netjes.
function httpGetBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? require("https") : require("http");
    const req = lib.get(url, { agent: false }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("timeout")));
  });
}

async function checkObjectStorage() {
  const adapter = String(config.objectStorage.adapter || "local").toLowerCase();
  if (adapter === "local") {
    record("object_storage", true, "overgeslagen · OBJECT_STORAGE_ADAPTER=local (geen cloudopslag)");
    return;
  }
  const { createObjectStorage } = require("../src/infrastructure/object-storage-factory");
  let store;
  try { store = createObjectStorage(); }
  catch (e) { record("object_storage.init", false, e.message); return; }
  record("object_storage.init", true, `adapter=${adapter} · endpoint=${maskEndpoint(config.objectStorage.endpoint)} · container=${config.objectStorage.bucket || "(geen)"}`);

  // Container/bucket bereikbaar maken (idempotent · maakt hem privé aan als hij
  // nog niet bestaat). Bewijst tegelijk schrijfrecht op containerniveau.
  try {
    if (typeof store.ensureBucket === "function") { await store.ensureBucket(); }
    record("object_storage.container", true, "container bereikbaar/aangemaakt");
  } catch (e) { record("object_storage.container", false, e.message); return; }

  const tenantId = "t_preflight";
  const payload = Buffer.from(`monargo-koppeling-probe ${adapter}`);
  let key = null;
  try {
    const put = await store.put({ tenantId, scope: "preflight", id: "probe", extension: "txt", content: payload, mimeType: "text/plain", fileName: "probe.txt" });
    key = put.key;
    record("object_storage.put", true, `geschreven · ${put.size} bytes`);
  } catch (e) { record("object_storage.put", false, e.message); return; }

  try {
    const got = await readStream(await store.get(key, { tenantId }));
    record("object_storage.get", got.equals(payload), got.equals(payload) ? "bytes komen overeen" : `bytes wijken af (${got.length} vs ${payload.length})`);
  } catch (e) { record("object_storage.get", false, e.message); }

  try {
    // Gebruik de ECHTE download-URL-methode van de adapter (juiste permissie +
    // headers per provider), niet een hand-gemaakte presign. Azure vereist bv.
    // "r", niet "read"; createDownloadUrl doet dat intern goed.
    const dl = await store.createDownloadUrl({ tenantId, key, ttlSeconds: 120 });
    const res = await httpGetBuffer(dl.url);
    const okStatus = res.status >= 200 && res.status < 300;
    record("object_storage.signed_url", okStatus && res.body.equals(payload), okStatus ? (res.body.equals(payload) ? "signed URL levert de juiste bytes" : "signed URL: bytes wijken af") : `signed URL status ${res.status}`);
  } catch (e) { record("object_storage.signed_url", false, e.message); }

  try {
    await store.delete(key, { tenantId });
    record("object_storage.delete", true, "probe opgeruimd");
  } catch (e) { record("object_storage.delete", false, e.message); }
}

(async () => {
  await checkDatabase();
  await checkObjectStorage();

  const ok = results.every(r => r.ok);
  if (jsonMode) {
    console.log(JSON.stringify({ ok, checks: results, appEnv: config.appEnv || process.env.APP_ENV || "unknown" }, null, 2));
    process.exit(ok ? 0 : 1);
  }
  console.log(`Live-koppelingscontrole (APP_ENV=${config.appEnv || process.env.APP_ENV || "unknown"})\n`);
  for (const r of results) console.log(`[${r.ok ? "OK " : "FOUT"}] ${r.name}${r.detail ? " · " + r.detail : ""}`);
  console.log(ok ? "\nKoppeling groen." : "\nKoppeling ROOD · los de fouten hierboven op (geen secrets in deze uitvoer).");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error("CRASH:", e.message); process.exit(1); });
