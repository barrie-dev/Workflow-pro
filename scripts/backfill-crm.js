#!/usr/bin/env node
"use strict";
/**
 * Backfill CRM van de legacy-dataset naar de genormaliseerde tabellen
 * (handover 5.4 stap 3 en 4).
 *
 *   npm run db:backfill:crm -- --dry-run     → tonen wat er zou gebeuren
 *   npm run db:backfill:crm                  → uitvoeren (idempotent)
 *   npm run db:backfill:crm -- --reconcile   → alleen vergelijken
 *
 * De backfill verwijdert nooit iets. Rijen die alleen in Postgres staan worden
 * gemeld zodat een mens beslist, want automatisch opruimen kan echte data
 * kosten wanneer de legacybron onvolledig is ingelezen.
 *
 * Cutover pas wanneer de reconciliatie voor ELKE tenant groen is.
 */

const { Pool } = require("pg");
const { config } = require("../src/lib/config");
const { Store } = require("../src/lib/store");
const { createDataAdapter } = require("../src/lib/data-adapters");
const { backfillCustomers, reconcileCustomers } = require("../src/infrastructure/postgres/crm-backfill");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const reconcileOnly = args.includes("--reconcile");
const asJson = args.includes("--json");
const onlyTenant = (args.find(a => a.startsWith("--tenant=")) || "").split("=")[1] || null;

async function main() {
  if (!/^postgres(ql)?:\/\//.test(config.database.url)) {
    console.error("DATABASE_URL ontbreekt of is geen PostgreSQL-URL.");
    process.exit(2);
  }

  // Legacybron: de huidige dataset, ongeacht welke adapter die serveert.
  const adapter = createDataAdapter();
  const store = new Store(adapter, { defer: typeof adapter.loadAsync === "function" });
  await store.initAsync();

  const tenants = (store.data.tenants || []).filter(t => !onlyTenant || t.id === onlyTenant);
  if (!tenants.length) { console.error(onlyTenant ? `Tenant '${onlyTenant}' niet gevonden.` : "Geen tenants gevonden."); process.exit(2); }

  const pool = new Pool({ connectionString: config.database.url, ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined, max: 4 });
  const rapport = [];
  try {
    for (const tenant of tenants) {
      const legacy = (store.data.customers || []).filter(c => c.tenantId === tenant.id);
      // De tenant moet bestaan in het genormaliseerde schema: alle FK's hangen eraan.
      if (!reconcileOnly && !dryRun) {
        await pool.query(
          `INSERT INTO tenants (id, name, plan) VALUES ($1,$2,$3)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
          [tenant.id, tenant.name || tenant.id, tenant.plan || "starter"]);
      }
      const migratie = reconcileOnly ? null : await backfillCustomers(pool, tenant.id, legacy, { dryRun });
      const reconciliatie = dryRun ? null : await reconcileCustomers(pool, tenant.id, legacy);
      rapport.push({ tenantId: tenant.id, naam: tenant.name, migratie, reconciliatie });
    }
  } finally {
    await pool.end();
  }

  if (asJson) { console.log(JSON.stringify(rapport, null, 2)); return; }

  let geblokkeerd = 0;
  for (const r of rapport) {
    console.log(`\n${r.naam || r.tenantId} (${r.tenantId})`);
    if (r.migratie) {
      console.log(`  Gemigreerd : ${r.migratie.dryRun ? `${r.migratie.wouldMigrate} (dry-run)` : r.migratie.migrated}`);
      r.migratie.skipped.forEach(s => console.log(`  Overgeslagen: ${s.id} · ${s.reasons.join(", ")}`));
    }
    if (r.reconciliatie) {
      const rec = r.reconciliatie;
      console.log(`  Aantallen  : legacy ${rec.legacyCount} · postgres ${rec.targetCount} ${rec.countsMatch ? "" : "AFWIJKING"}`);
      if (rec.missing.length) console.log(`  Ontbreekt  : ${rec.missing.length} (${rec.missing.slice(0, 5).join(", ")}${rec.missing.length > 5 ? ", …" : ""})`);
      if (rec.extra.length) console.log(`  Alleen pg  : ${rec.extra.length} (${rec.extra.slice(0, 5).join(", ")}) · niet automatisch opgeruimd`);
      if (rec.differences.length) console.log(`  Afwijkend  : ${rec.differences.length} (${rec.differences.slice(0, 5).map(d => d.id).join(", ")})`);
      console.log(`  Cutover    : ${rec.readyForCutover ? "GROEN" : "geblokkeerd"}`);
      if (!rec.readyForCutover) geblokkeerd++;
    }
  }
  if (geblokkeerd) {
    console.log(`\n${geblokkeerd} tenant(s) nog niet klaar voor cutover.`);
    process.exit(1);
  }
  if (!dryRun && !reconcileOnly) console.log("\nAlle tenants gereconcilieerd · klaar voor shadow-read.");
}

main().catch(err => { console.error(`Backfill mislukt: ${err.message}`); process.exit(1); });
