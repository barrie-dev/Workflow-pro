"use strict";
/**
 * SQL-migratierunner voor standaard PostgreSQL (handover 5.4 · F-04).
 *
 * Voert genummerde SQL-bestanden precies één keer uit, in volgorde, elk in zijn
 * eigen transactie. Ontworpen voor een omgeving met MEERDERE REPLICAS die
 * tegelijk opstarten:
 *
 *  - Een advisory lock zorgt dat er nooit twee runners tegelijk migreren. De
 *    tweede wacht en ziet daarna dat het werk al gedaan is.
 *  - Elke migratie draait in één transactie: faalt hij halverwege, dan is er
 *    niets toegepast. Geen half schema.
 *  - Van elk toegepast bestand bewaren we een checksum. Wijzigt een bestand dat
 *    al gedraaid heeft, dan STOPT de runner met een duidelijke fout. Stil
 *    doorgaan zou betekenen dat omgevingen ongemerkt uit elkaar lopen.
 *
 * Geen platformextensies: dit werkt op elke standaard PostgreSQL.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Vaste sleutel voor de advisory lock. Willekeurig gekozen maar constant, zodat
// alle replicas van deze app om dezelfde lock vragen.
const LOCK_KEY = 8274531190;
const MIGRATIONS_TABLE = "schema_migrations";
const FILE_PATTERN = /^(\d{3,})_([a-z0-9_-]+)\.sql$/i;

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
  version     integer PRIMARY KEY,
  name        text NOT NULL,
  checksum    text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  duration_ms integer NOT NULL DEFAULT 0
);
`;

function checksumOf(sql) {
  // Regeleindes normaliseren: een checkout op Windows mag geen valse afwijking
  // opleveren.
  return crypto.createHash("sha256").update(String(sql).replace(/\r\n/g, "\n")).digest("hex");
}

/** Lees en sorteer de migratiebestanden. Dubbele versienummers zijn een fout. */
function loadMigrations(dir) {
  if (!fs.existsSync(dir)) return [];
  const seen = new Map();
  const files = fs.readdirSync(dir).filter(f => FILE_PATTERN.test(f)).sort();
  return files.map(file => {
    const [, rawVersion, name] = FILE_PATTERN.exec(file);
    const version = Number(rawVersion);
    if (seen.has(version)) {
      const e = new Error(`Twee migraties met versie ${version}: ${seen.get(version)} en ${file}`);
      e.code = "DUPLICATE_MIGRATION_VERSION"; throw e;
    }
    seen.set(version, file);
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    return { version, name, file, sql, checksum: checksumOf(sql) };
  });
}

/**
 * Voer openstaande migraties uit.
 * @param {object} pool  pg-pool (of een dubbel met connect())
 * @param {object} opts
 * @param {string} [opts.dir]     map met SQL-bestanden
 * @param {boolean} [opts.dryRun] alleen rapporteren wat er zou draaien
 * @param {Function} [opts.log]
 */
async function runMigrations(pool, { dir = null, dryRun = false, log = () => {} } = {}) {
  const directory = dir || path.join(__dirname, "..", "..", "..", "migrations", "sql");
  const migrations = loadMigrations(directory);
  const client = await pool.connect();
  const applied = [];
  try {
    // Serialiseer over alle replicas heen. Blokkeert tot de lock vrij is.
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(BOOTSTRAP_SQL);

    const { rows } = await client.query(`SELECT version, name, checksum FROM ${MIGRATIONS_TABLE} ORDER BY version`);
    const known = new Map(rows.map(r => [Number(r.version), r]));

    // Historie-controle vóór er iets draait: een gewijzigd of verdwenen bestand
    // betekent dat omgevingen uiteenlopen.
    for (const [version, row] of known) {
      const onDisk = migrations.find(m => m.version === version);
      if (!onDisk) {
        const e = new Error(`Migratie ${version} (${row.name}) is toegepast maar het bestand ontbreekt`);
        e.code = "MIGRATION_FILE_MISSING"; throw e;
      }
      if (onDisk.checksum !== row.checksum) {
        const e = new Error(`Migratie ${version} (${row.name}) is gewijzigd nadat ze was toegepast. Maak een nieuwe migratie in plaats van een bestaande aan te passen.`);
        e.code = "MIGRATION_CHECKSUM_MISMATCH"; throw e;
      }
    }

    const pending = migrations.filter(m => !known.has(m.version));
    if (dryRun) return { applied: [], pending: pending.map(m => ({ version: m.version, name: m.name })), alreadyApplied: known.size };

    for (const m of pending) {
      const started = Date.now();
      // Eén transactie per migratie: alles of niets.
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (version, name, checksum, duration_ms) VALUES ($1, $2, $3, $4)`,
          [m.version, m.name, m.checksum, Date.now() - started]);
        await client.query("COMMIT");
        applied.push({ version: m.version, name: m.name, durationMs: Date.now() - started });
        log(`  Migratie  : ${m.version} ${m.name} toegepast`);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        const e = new Error(`Migratie ${m.version} (${m.name}) mislukt: ${err.message}`);
        e.code = "MIGRATION_FAILED"; e.version = m.version; e.cause = err;
        throw e;
      }
    }
    return { applied, pending: [], alreadyApplied: known.size };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

/** Status voor ops: wat is toegepast en wat staat open. */
async function migrationStatus(pool, { dir = null } = {}) {
  const directory = dir || path.join(__dirname, "..", "..", "..", "migrations", "sql");
  const migrations = loadMigrations(directory);
  const { rows } = await pool.query(
    `SELECT version, name, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY version`).catch(() => ({ rows: [] }));
  const known = new Set(rows.map(r => Number(r.version)));
  return {
    applied: rows.map(r => ({ version: Number(r.version), name: r.name, appliedAt: r.applied_at })),
    pending: migrations.filter(m => !known.has(m.version)).map(m => ({ version: m.version, name: m.name })),
    total: migrations.length,
  };
}

module.exports = { runMigrations, migrationStatus, loadMigrations, checksumOf, MIGRATIONS_TABLE, LOCK_KEY };
