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

// ── CTO3-03 · VOLLEDIGE disaster recovery ────────────────────────────────────
// De drill hierboven bewijst enkel platform_state. CTO3-03 eist herstel van de
// VOLLEDIGE dataset (alle genormaliseerde tabellen) plus een objectmanifest.

function sslFor(connectionString) {
  return /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false };
}

async function listPublicTables(client) {
  const r = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`);
  return r.rows.map(x => x.table_name);
}

// Orde-onafhankelijke fingerprint per tabel: rijtelling + checksum over de
// gesorteerde rij-hashes, zodat de fysieke rijvolgorde niet meetelt.
async function tableFingerprint(client, table) {
  const rows = (await client.query(`SELECT to_jsonb(t) AS r FROM "${table}" t`)).rows;
  const hashes = rows.map(x => sha256(Buffer.from(JSON.stringify(x.r)))).sort();
  return { count: rows.length, checksum: sha256(Buffer.from(hashes.join(""))) };
}

/**
 * Volledige logische restore-drill: kopieer ALLE public-tabellen naar een verse
 * scratch-database (schema via de echte migraties), en vergelijk rijtotalen +
 * checksums per tabel. Voert daarna functionele steekproeven uit op de herstelde
 * dataset. Meet RPO (versheid van platform_state) en RTO (hersteltijd).
 */
async function pgFullRestoreDrill({ pool, connectionString, scratchDb = "wfp_full_restore_drill", now = Date.now() }) {
  const { Pool } = require("pg");
  const { runMigrations, MIGRATIONS_TABLE } = require("../infrastructure/postgres/migration-runner");
  const t0 = Date.now();
  const ssl = sslFor(connectionString);
  // De migratie-boekhoudtabel wordt door runMigrations zelf gevuld met eigen
  // tijdstempels · niet vergelijken (dat is schema-metadata, geen businessdata).
  const EXCLUDE = new Set([MIGRATIONS_TABLE]);

  // RPO: leeftijd van de nieuwste platform_state (proxy voor backup-versheid).
  const snap = (await pool.query(`SELECT updated_at FROM ${STATE_TABLE} ORDER BY updated_at DESC LIMIT 1`)).rows[0];
  const rpoSeconds = snap ? Math.max(0, Math.round((now - new Date(snap.updated_at).getTime()) / 1000)) : null;

  const tables = (await listPublicTables(pool)).filter(t => !EXCLUDE.has(t));
  const source = {};
  for (const t of tables) source[t] = await tableFingerprint(pool, t);

  const adminUrl = connectionString.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
  const admin = new Pool({ connectionString: adminUrl, ssl });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${scratchDb} WITH (FORCE)`).catch(() => admin.query(`DROP DATABASE IF EXISTS ${scratchDb}`).catch(() => {}));
    await admin.query(`CREATE DATABASE ${scratchDb}`);
  } finally { await admin.end(); }

  const scratchUrl = connectionString.replace(/\/[^/?]+(\?|$)/, `/${scratchDb}$1`);
  const scratch = new Pool({ connectionString: scratchUrl, ssl });
  const restored = {}; const mismatches = []; let functional = {}; let migrationsOk = false;
  try {
    // Reproduceer de VOLLEDIGE productie-schemabootstrap op een leeg schema:
    // eerst de document-tabel (SCHEMA_SQL · platform_state), dan de genummerde
    // SQL-migraties (het genormaliseerde schema). Precies wat de app bij een
    // verse database doet · dit is de schema-/migratievalidatie.
    await scratch.query(SCHEMA_SQL);
    await runMigrations(scratch);
    migrationsOk = true;
    // Data FK-veilig kopiëren (session_replication_role omzeilt FK/trigger-checks).
    // We kopiëren via jsonb (to_jsonb → jsonb_populate_record) i.p.v. via de
    // driver-kolomwaarden: zo passeren timestamptz-waarden nooit een JS Date
    // (die microseconden afkapt) en blijft de tekstrepresentatie byte-identiek
    // aan de bron · exact wat de checksum-vergelijking hieronder toetst.
    await scratch.query("SET session_replication_role = replica");
    for (const t of tables) {
      const rows = (await pool.query(`SELECT to_jsonb(x) AS r FROM "${t}" x`)).rows;
      for (const row of rows) {
        await scratch.query(
          `INSERT INTO "${t}" SELECT * FROM jsonb_populate_record(NULL::"${t}", $1::jsonb) ON CONFLICT DO NOTHING`,
          [row.r]);
      }
    }
    await scratch.query("SET session_replication_role = origin");

    for (const t of tables) {
      restored[t] = await tableFingerprint(scratch, t);
      if (restored[t].count !== source[t].count || restored[t].checksum !== source[t].checksum) mismatches.push(t);
    }

    // Functionele steekproeven op de HERSTELDE dataset (tenants/users/facturen/
    // audit). De strangler-migratie verplaatst businessdata van het platform_state-
    // document naar genormaliseerde tabellen · we tellen dus BEIDE en nemen het
    // maximum, zodat de steekproef klopt voor een pg-cutover DB (tabellen gevuld,
    // document leeg) én voor een JSON-mode snapshot (document gevuld).
    const countTable = async (table) => {
      try { return Number((await scratch.query(`SELECT count(*)::int AS c FROM "${table}"`)).rows[0].c); }
      catch (_) { return 0; }
    };
    const st = (await scratch.query(`SELECT data FROM ${STATE_TABLE} ORDER BY updated_at DESC LIMIT 1`)).rows[0];
    const doc = (st && st.data) || {};
    const docLen = (k) => Array.isArray(doc[k]) ? doc[k].length : 0;
    const invoiceCount = Math.max(await countTable("invoices"), docLen("invoices"));
    functional = {
      tenants: Math.max(await countTable("tenants"), docLen("tenants")),
      users: Math.max(await countTable("users"), docLen("users")),
      customers: Math.max(await countTable("customers"), docLen("customers")),
      invoices: invoiceCount,
      hasInvoices: invoiceCount > 0 || Array.isArray(doc.invoices),
      hasAudit: Array.isArray(doc.audit) || Array.isArray(doc.auditLog) || Array.isArray(doc.auditTrail)
        || (await countTable("audit_log")) > 0 || (await countTable("audit")) > 0,
    };
  } finally {
    await scratch.end();
    const admin2 = new Pool({ connectionString: adminUrl, ssl });
    try { await admin2.query(`DROP DATABASE IF EXISTS ${scratchDb} WITH (FORCE)`).catch(() => admin2.query(`DROP DATABASE IF EXISTS ${scratchDb}`).catch(() => {})); }
    finally { await admin2.end(); }
  }
  const rtoSeconds = Math.round((Date.now() - t0) / 1000 * 100) / 100;
  const ok = migrationsOk && mismatches.length === 0 && functional.tenants > 0;
  return { ok, tableCount: tables.length, tables: source, restored, mismatches, functional, migrationsOk, rpoSeconds, rtoSeconds };
}

/**
 * Objectmanifest-drill: bouw een manifest (tenant, key, size, checksum) van alle
 * objecten via storage.list(), verifieer dat elk object er echt is (roundtrip),
 * en meld missing (meta zonder databestand) en orphan (databestand zonder meta).
 * @param {object} opts.storage   object-storage-adapter met list()/get()
 */
async function objectManifestDrill({ storage, now = Date.now() }) {
  const t0 = Date.now();
  if (typeof storage.list !== "function") {
    return { ok: false, error: "OBJECT_LIST_UNSUPPORTED", supported: false };
  }
  const { objects, orphans } = await storage.list();
  const manifest = [];
  const missing = [];
  for (const o of objects) {
    if (!o.hasObject) { missing.push(o.key); continue; }
    // Roundtrip + checksumcontrole (bewijst dat het object echt leesbaar is).
    let roundtripOk = false;
    try {
      const stream = await storage.get(o.key, { tenantId: o.tenantId });
      const chunks = []; for await (const c of stream) chunks.push(c);
      roundtripOk = !o.checksum || sha256(Buffer.concat(chunks)) === o.checksum;
    } catch (_) { roundtripOk = false; }
    if (!roundtripOk) missing.push(o.key);
    manifest.push({ tenantId: o.tenantId, key: o.key, size: o.size, checksum: o.checksum });
  }
  const rtoSeconds = Math.round((Date.now() - t0) / 1000 * 100) / 100;
  const ok = missing.length === 0 && orphans.length === 0;
  return { ok, objectCount: manifest.length, manifest, missing, orphans, generatedAt: new Date(now).toISOString(), rtoSeconds };
}

module.exports = { pgRestoreDrill, objectStorageRestoreDrill, pgFullRestoreDrill, objectManifestDrill, tableFingerprint, listPublicTables };
