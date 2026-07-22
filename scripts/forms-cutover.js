#!/usr/bin/env node
"use strict";

// ── scripts/forms-cutover.js (CTO2-08) ───────────────────────────────────────
// CLI voor de Forms-cutover: inventariseer de legacy work-os formulieren,
// migreer ze naar de canonieke pg-engine en reconcilieer. Poortwachter voor
// FORMS_SOURCE=pg · de flip mag pas nadat reconcile GROEN is.
//
// Gebruik (vereist STORAGE_ADAPTER=postgres + DATABASE_URL):
//   node scripts/forms-cutover.js inventory [tenantId]
//   node scripts/forms-cutover.js migrate   [tenantId]
//   node scripts/forms-cutover.js reconcile  [tenantId]   # exit 1 als niet ready

const path = require("path");
const ROOT = path.join(__dirname, "..");
const { config } = require(path.join(ROOT, "src/lib/config"));
const cutover = require(path.join(ROOT, "src/modules/forms-cutover"));

async function main() {
  const [cmd, tenantArg] = process.argv.slice(2);
  if (!["inventory", "migrate", "reconcile"].includes(cmd)) {
    console.error("Gebruik: node scripts/forms-cutover.js <inventory|migrate|reconcile> [tenantId]");
    process.exit(2);
  }
  if (config.storageAdapter !== "postgres") {
    console.error("Deze cutover vereist STORAGE_ADAPTER=postgres + DATABASE_URL (de canonieke engine draait op PostgreSQL).");
    process.exit(2);
  }
  const { createDataAdapter } = require(path.join(ROOT, "src/lib/data-adapters"));
  const { Store } = require(path.join(ROOT, "src/lib/store"));
  const { makePgFormsRepository } = require(path.join(ROOT, "src/infrastructure/postgres/pg-forms-repository"));
  const { runMigrations } = require(path.join(ROOT, "src/infrastructure/postgres/migration-runner"));

  const adapter = createDataAdapter();
  const store = new Store(adapter, { defer: typeof adapter.loadAsync === "function" });
  if (typeof store.initAsync === "function") await store.initAsync();
  await runMigrations(adapter.pool);
  const repo = makePgFormsRepository(adapter.pool);

  const tenants = tenantArg ? [{ id: tenantArg }] : (store.data.tenants || []);
  let notReady = 0;
  for (const t of tenants) {
    if (cmd === "inventory") {
      console.log(JSON.stringify(cutover.inventoryLegacyForms(store, t.id)));
    } else if (cmd === "migrate") {
      const r = await cutover.migrateLegacyForms({ store, repo, tenantId: t.id });
      console.log(JSON.stringify(r));
    } else if (cmd === "reconcile") {
      const r = await cutover.reconcileForms({ store, repo, tenantId: t.id });
      console.log(JSON.stringify(r));
      if (!r.ready) notReady++;
    }
  }
  if (typeof adapter.close === "function") await adapter.close({ force: true }).catch(() => {});
  if (cmd === "reconcile" && notReady > 0) {
    console.error(`Cutover NIET veilig: ${notReady} tenant(s) nog niet volledig gemigreerd. FORMS_SOURCE=pg blijft uit.`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
