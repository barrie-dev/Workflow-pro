"use strict";
// SQL-migratierunner (handover 5.4 · F-04): precies één keer, in volgorde, per
// migratie één transactie, advisory lock voor meerdere replicas, en luid falen
// wanneer de historie niet meer klopt.
const { test } = require("node:test");
const assert = require("node:assert");
const os = require("os");
const fs = require("fs");
const path = require("path");

const { runMigrations, migrationStatus, loadMigrations, checksumOf, MIGRATIONS_TABLE, LOCK_KEY } = require("../src/infrastructure/postgres/migration-runner");

/** Maakt een tijdelijke map met migratiebestanden. */
function makeDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mona-mig-"));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

/**
 * pg-pool-dubbel dat toegepaste migraties onthoudt. `failOn` laat een
 * specifieke migratie falen om de transactiegrens te testen.
 */
function fakePool({ appliedRows = [], failOn = null } = {}) {
  const log = [];
  const rows = [...appliedRows];
  const client = {
    released: false,
    async query(sql, params) {
      const flat = String(sql).replace(/\s+/g, " ").trim();
      log.push({ sql: flat, params });
      if (/pg_advisory_lock/.test(flat)) return { rows: [] };
      if (/pg_advisory_unlock/.test(flat)) return { rows: [] };
      if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(flat)) return { rows: [] };
      if (/^SELECT version, name, checksum FROM/i.test(flat)) return { rows };
      if (/^BEGIN|^COMMIT|^ROLLBACK/i.test(flat)) return { rows: [] };
      if (/^INSERT INTO schema_migrations/i.test(flat)) {
        rows.push({ version: params[0], name: params[1], checksum: params[2] });
        return { rows: [] };
      }
      if (failOn && flat.includes(failOn)) throw new Error("syntaxfout in migratie");
      return { rows: [] };
    },
    release() { this.released = true; },
  };
  return {
    log, rows, client,
    async connect() { return client; },
    async query(sql) {
      const flat = String(sql).replace(/\s+/g, " ").trim();
      if (/^SELECT version, name, applied_at/i.test(flat)) return { rows: rows.map(r => ({ ...r, applied_at: "2026-07-18" })) };
      return { rows: [] };
    },
  };
}

const MIGRATIES = {
  "001_core.sql": "CREATE TABLE tenants (id text PRIMARY KEY);",
  "002_crm.sql": "CREATE TABLE customers (id text PRIMARY KEY);",
};

test("migratie-runner: leest en sorteert bestanden op versie", () => {
  const dir = makeDir({ "010_later.sql": "SELECT 10;", "002_crm.sql": "SELECT 2;", "001_core.sql": "SELECT 1;", "leesmij.txt": "geen migratie" });
  const list = loadMigrations(dir);
  assert.deepEqual(list.map(m => m.version), [1, 2, 10], "numeriek gesorteerd, niet alfabetisch");
  assert.equal(list.length, 3, "niet-SQL-bestanden worden genegeerd");
  assert.equal(list[0].name, "core");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("migratie-runner: dubbele versienummers zijn een fout", () => {
  const dir = makeDir({ "001_core.sql": "SELECT 1;", "001_ander.sql": "SELECT 2;" });
  assert.throws(() => loadMigrations(dir), e => e.code === "DUPLICATE_MIGRATION_VERSION");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("migratie-runner: past openstaande migraties toe, elk in een transactie", async () => {
  const dir = makeDir(MIGRATIES);
  const pool = fakePool();
  const res = await runMigrations(pool, { dir });

  assert.deepEqual(res.applied.map(a => a.version), [1, 2]);
  assert.equal(res.pending.length, 0);
  // Advisory lock rond het geheel: geen twee replicas tegelijk.
  assert.ok(pool.log.some(l => l.sql.includes("pg_advisory_lock") && l.params[0] === LOCK_KEY));
  assert.ok(pool.log.some(l => l.sql.includes("pg_advisory_unlock")));
  // Per migratie een eigen BEGIN/COMMIT.
  assert.equal(pool.log.filter(l => l.sql === "BEGIN").length, 2);
  assert.equal(pool.log.filter(l => l.sql === "COMMIT").length, 2);
  assert.equal(pool.client.released, true, "connectie altijd teruggegeven");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("migratie-runner: is idempotent · een tweede run doet niets", async () => {
  const dir = makeDir(MIGRATIES);
  const pool = fakePool();
  await runMigrations(pool, { dir });
  const tweede = await runMigrations(pool, { dir });
  assert.equal(tweede.applied.length, 0, "niets opnieuw toegepast");
  assert.equal(tweede.alreadyApplied, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("migratie-runner: een gewijzigde toegepaste migratie stopt de run", async () => {
  const dir = makeDir(MIGRATIES);
  // Doe alsof 001 al draaide met een ANDERE inhoud.
  const pool = fakePool({ appliedRows: [{ version: 1, name: "core", checksum: checksumOf("iets anders") }] });
  await assert.rejects(() => runMigrations(pool, { dir }), e => e.code === "MIGRATION_CHECKSUM_MISMATCH");
  // Er is niets toegepast: de controle gebeurt vóór de eerste BEGIN.
  assert.equal(pool.log.filter(l => l.sql === "BEGIN").length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("migratie-runner: een verdwenen toegepaste migratie stopt de run", async () => {
  const dir = makeDir({ "002_crm.sql": MIGRATIES["002_crm.sql"] });
  const pool = fakePool({ appliedRows: [{ version: 1, name: "core", checksum: checksumOf(MIGRATIES["001_core.sql"]) }] });
  await assert.rejects(() => runMigrations(pool, { dir }), e => e.code === "MIGRATION_FILE_MISSING");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("migratie-runner: een mislukte migratie rolt terug en laat de rest staan", async () => {
  const dir = makeDir(MIGRATIES);
  const pool = fakePool({ failOn: "CREATE TABLE customers" });
  await assert.rejects(() => runMigrations(pool, { dir }), e => e.code === "MIGRATION_FAILED" && e.version === 2);
  assert.ok(pool.log.some(l => l.sql === "ROLLBACK"), "mislukte migratie teruggerold");
  // 001 is wél gecommit: elke migratie staat op zichzelf.
  assert.equal(pool.log.filter(l => l.sql === "COMMIT").length, 1);
  assert.deepEqual(pool.rows.map(r => r.version), [1]);
  assert.equal(pool.client.released, true, "connectie ook bij een fout teruggegeven");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("migratie-runner: dry-run rapporteert zonder toe te passen", async () => {
  const dir = makeDir(MIGRATIES);
  const pool = fakePool();
  const res = await runMigrations(pool, { dir, dryRun: true });
  assert.deepEqual(res.pending.map(p => p.version), [1, 2]);
  assert.equal(res.applied.length, 0);
  assert.equal(pool.log.filter(l => l.sql === "BEGIN").length, 0, "geen enkele wijziging");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("migratie-runner: status toont toegepast en openstaand", async () => {
  const dir = makeDir(MIGRATIES);
  const pool = fakePool({ appliedRows: [{ version: 1, name: "core", checksum: checksumOf(MIGRATIES["001_core.sql"]) }] });
  const st = await migrationStatus(pool, { dir });
  assert.deepEqual(st.applied.map(a => a.version), [1]);
  assert.deepEqual(st.pending.map(p => p.version), [2]);
  assert.equal(st.total, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("migratie-runner: checksum negeert regeleindes (Windows vs Unix)", () => {
  assert.equal(checksumOf("a\r\nb"), checksumOf("a\nb"), "CRLF mag geen valse afwijking geven");
  assert.notEqual(checksumOf("a\nb"), checksumOf("a\nc"));
});

// ── De echte migratiebestanden van dit project ──────────────────────────────
test("migraties: de meegeleverde SQL-bestanden zijn geldig genummerd", () => {
  const dir = path.join(__dirname, "..", "migrations", "sql");
  const list = loadMigrations(dir);
  assert.ok(list.length >= 2, "er zijn migraties");
  assert.deepEqual(list.map(m => m.version), list.map(m => m.version).slice().sort((a, b) => a - b), "oplopend genummerd");
  // Elke tabel met tenantdata moet RLS aan hebben (5.3) en de verplichte
  // technische kolommen dragen (5.2).
  const alles = list.map(m => m.sql).join("\n");
  for (const tabel of ["customers", "customer_contacts", "customer_addresses", "companies"]) {
    assert.match(alles, new RegExp(`ALTER TABLE ${tabel}\\s+ENABLE ROW LEVEL SECURITY`), `${tabel} heeft RLS`);
    assert.match(alles, new RegExp(`CREATE POLICY ${tabel}_isolation`), `${tabel} heeft een isolatiepolicy`);
  }
  // Geen platformextensies die migratie blokkeren (ADR-002).
  assert.ok(!/CREATE EXTENSION/i.test(alles), "geen extensies");
  assert.ok(!/supabase|azure_|rds_/i.test(alles), "geen provider-specifieke objecten");
});

test("migraties: tenant-aware foreign keys op de CRM-tabellen", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", "sql", "002_crm.sql"), "utf8");
  // Een contact/adres verwijst op (tenant_id, customer_id), niet enkel op id:
  // anders kan een gemanipuleerd id naar een andere tenant wijzen.
  assert.match(sql, /FOREIGN KEY \(tenant_id, customer_id\) REFERENCES customers \(tenant_id, id\)/);
  assert.match(sql, /UNIQUE \(tenant_id, customer_number\)/, "zakelijk nummer uniek binnen de tenant");
  assert.match(sql, /version\s+integer NOT NULL DEFAULT 1 CHECK \(version > 0\)/, "optimistic locking-kolom");
});
