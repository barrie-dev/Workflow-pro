#!/usr/bin/env node
"use strict";
/**
 * Voer de SQL-migraties uit tegen de geconfigureerde PostgreSQL.
 *
 *   npm run db:migrate:sql          → openstaande migraties toepassen
 *   npm run db:migrate:sql:dry      → tonen wat er zou draaien
 *   npm run db:migrate:status       → toegepast versus openstaand
 *
 * Bewust een APART commando naast het opstarten van de app: bij een deploy met
 * meerdere replicas wil je migraties één keer, gecontroleerd, vóór de rollout
 * draaien. De advisory lock in de runner maakt het ook veilig als het toch
 * tegelijk gebeurt.
 */

const { Pool } = require("pg");
const { config } = require("../src/lib/config");
const { runMigrations, migrationStatus } = require("../src/infrastructure/postgres/migration-runner");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const statusOnly = args.includes("--status");
const asJson = args.includes("--json");

async function main() {
  const url = config.database.url;
  if (!/^postgres(ql)?:\/\//.test(url)) {
    console.error("DATABASE_URL ontbreekt of is geen PostgreSQL-URL.");
    console.error("Lokaal:  docker compose up -d db");
    console.error("         DATABASE_URL=postgresql://monargo:monargo@localhost:5432/monargo npm run db:migrate:sql");
    process.exit(2);
  }
  const pool = new Pool({
    connectionString: url,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined,
    max: 2,
  });
  try {
    if (statusOnly) {
      const st = await migrationStatus(pool);
      if (asJson) { console.log(JSON.stringify(st, null, 2)); return; }
      console.log(`Toegepast : ${st.applied.length}/${st.total}`);
      st.applied.forEach(a => console.log(`  ✓ ${String(a.version).padStart(3, "0")} ${a.name}`));
      st.pending.forEach(p => console.log(`  · ${String(p.version).padStart(3, "0")} ${p.name} (openstaand)`));
      return;
    }
    const res = await runMigrations(pool, { dryRun, log: msg => console.log(msg.trim()) });
    if (asJson) { console.log(JSON.stringify(res, null, 2)); return; }
    if (dryRun) {
      console.log(`Dry-run · ${res.alreadyApplied} toegepast, ${res.pending.length} openstaand`);
      res.pending.forEach(p => console.log(`  · ${String(p.version).padStart(3, "0")} ${p.name}`));
      return;
    }
    if (!res.applied.length) console.log(`Niets te doen · ${res.alreadyApplied} migratie(s) al toegepast.`);
    else console.log(`${res.applied.length} migratie(s) toegepast.`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(`Migratie mislukt: ${err.message}`);
  if (err.code) console.error(`Code: ${err.code}`);
  process.exit(1);
});
