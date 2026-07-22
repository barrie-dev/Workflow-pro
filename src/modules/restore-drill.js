"use strict";

// ── Restore-drill (CTO2-12) ──────────────────────────────────────────────────
// Praktisch herstelbewijs: kan de database ÉN de objectopslag echt worden
// teruggezet, en hoeveel data/tijd kost dat? Twee onafhankelijke drills:
//
//  1. PostgreSQL: neem een snapshot van platform_state (de backup-bron), herstel
//     die naar een VERSE scratch-database en verifieer dat het document exact
//     terugkomt (deep-equal op revisie + inhoud). Meet RTO (hersteltijd) en RPO
//     (hoe oud is de snapshot t.o.v. nu).
//  2. Objectopslag: schrijf een sentinel via de geconfigureerde adapter, maak
//     dan een VERS adapter-exemplaar (procesherstart-equivalent) en lees hem
//     terug · bewijst dat bestanden onafhankelijk van het app-proces bestaan
//     (precies wat 'local' NIET deed).
//
// Geen pg_dump-binary nodig · draait overal waar de app draait (dev/CI/prod).

const crypto = require("crypto");
const { SCHEMA_SQL, STATE_TABLE } = require("../infrastructure/postgres/pg-data-adapter");

function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/**
 * PostgreSQL restore-drill: snapshot → verse scratch-db → verifieer.
 * @param {object} opts.pool           pg-Pool op de bron-database
 * @param {string} opts.connectionString  basis-URL (om de scratch-db op te maken)
 * @param {string} [opts.scratchDb]    naam van de tijdelijke herstel-database
 */
async function pgRestoreDrill({ pool, connectionString, scratchDb = "wfp_restore_drill", now = Date.now() }) {
  const { Pool } = require("pg");
  const t0 = Date.now();
  // 1) Snapshot van de bron (de "backup").
  const snap = (await pool.query(`SELECT id, data, revision, updated_at FROM ${STATE_TABLE} ORDER BY updated_at DESC LIMIT 1`)).rows[0];
  if (!snap) throw Object.assign(new Error("Geen platform_state om te herstellen (lege bron-database)."), { code: "NO_SNAPSHOT" });
  const snapshotAt = new Date(snap.updated_at).getTime();
  const rpoSeconds = Math.max(0, Math.round((now - snapshotAt) / 1000));

  // 2) Verse scratch-database opmaken (drop+create via de maintenance-db).
  const adminUrl = connectionString.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
  const ssl = /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false };
  const admin = new Pool({ connectionString: adminUrl, ssl });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${scratchDb} WITH (FORCE)`).catch(async () => {
      await admin.query(`DROP DATABASE IF EXISTS ${scratchDb}`).catch(() => {});
    });
    await admin.query(`CREATE DATABASE ${scratchDb}`);
  } finally { await admin.end(); }

  // 3) Herstel de snapshot in de scratch-db en lees hem terug (het echte werk).
  const scratchUrl = connectionString.replace(/\/[^/?]+(\?|$)/, `/${scratchDb}$1`);
  const scratch = new Pool({ connectionString: scratchUrl, ssl });
  let restored, matches;
  try {
    await scratch.query(SCHEMA_SQL);
    await scratch.query(`INSERT INTO ${STATE_TABLE} (id, data, revision) VALUES ($1,$2,$3)`, [snap.id, snap.data, snap.revision]);
    restored = (await scratch.query(`SELECT data, revision FROM ${STATE_TABLE} WHERE id=$1`, [snap.id])).rows[0];
    matches = Number(restored.revision) === Number(snap.revision) && deepEqual(restored.data, snap.data);
  } finally {
    await scratch.end();
    // Opruimen: de scratch-db is wegwerp.
    const admin2 = new Pool({ connectionString: adminUrl, ssl });
    try { await admin2.query(`DROP DATABASE IF EXISTS ${scratchDb} WITH (FORCE)`).catch(() => admin2.query(`DROP DATABASE IF EXISTS ${scratchDb}`).catch(() => {})); }
    finally { await admin2.end(); }
  }
  const rtoSeconds = Math.round((Date.now() - t0) / 1000 * 100) / 100;
  const collections = restored && restored.data ? Object.keys(restored.data).length : 0;
  return { ok: !!matches, revision: Number(snap.revision), collections, rpoSeconds, rtoSeconds, snapshotAt: new Date(snapshotAt).toISOString() };
}

/**
 * Objectopslag restore-drill: schrijf een sentinel, maak een VERS adapter-
 * exemplaar en lees hem terug (bewijst persistentie over een procesherstart).
 * @param {function} opts.makeStorage  () => nieuw storage-adapter-exemplaar
 */
async function objectStorageRestoreDrill({ makeStorage, tenantId = "t_restore_drill", now = Date.now() }) {
  const t0 = Date.now();
  const writer = makeStorage();
  const payload = Buffer.from(`restore-drill sentinel ${now}`);
  const checksum = sha256(payload);
  const put = await writer.put({
    tenantId, scope: "restore-drill", id: `sentinel_${now}`, extension: "txt",
    content: payload, mimeType: "text/plain", size: payload.length, fileName: "sentinel.txt", scanStatus: "clean",
  });
  // VERS adapter-exemplaar = het app-proces is als het ware herstart.
  const reader = makeStorage();
  const stream = await reader.get(put.key, { tenantId });
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const roundtrip = Buffer.concat(chunks);
  const ok = sha256(roundtrip) === checksum;
  // Opruimen.
  try { await reader.delete(put.key, { tenantId }); } catch (_) { /* best-effort */ }
  const rtoSeconds = Math.round((Date.now() - t0) / 1000 * 100) / 100;
  return { ok, key: put.key, bytes: payload.length, checksum, rtoSeconds };
}

module.exports = { pgRestoreDrill, objectStorageRestoreDrill };
