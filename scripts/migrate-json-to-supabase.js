/**
 * WorkFlow Pro – Migreer lokale JSON data naar Supabase
 *
 * Laad de huidige data/workflowpro-fullstack.json en push alles naar Supabase
 * via de REST bridge (tenant_records / audit_logs / error_events).
 *
 * Gebruik:
 *   node scripts/migrate-json-to-supabase.js
 *   node scripts/migrate-json-to-supabase.js --dry-run   (telt records, pusht niet)
 *
 * Vereisten in .env:
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *   (STORAGE_ADAPTER hoeft NIET op postgres te staan voor dit script)
 */

require("../src/lib/env").loadEnvFile(require("path").join(__dirname, "..", ".env"));

const fs   = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DRY_RUN     = process.argv.includes("--dry-run");
const SUPABASE_URL      = process.env.SUPABASE_URL || "";
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const JSON_DB_PATH      = path.join(__dirname, "..", "data", "workflowpro-fullstack.json");
const BRIDGE_PATH       = path.join(__dirname, "..", "src", "lib", "supabase-rest-bridge.js");

function abort(msg) {
  console.error(`\n❌  ${msg}\n`);
  process.exit(1);
}

function countRecords(data) {
  const COLLECTIONS = [
    "tenants","users","roles","venues","customers","shifts","workorders","clocks",
    "expenses","stock","stockMutations","vehicles","mileageLogs","leaves","messages",
    "notifications","integrations","invoices","paymentMethods","files","secrets",
    "auditLogs","errorEvents","apiKeys","supportTickets","salesLeads","partners","migrationHistory"
  ];
  const counts = {};
  let total = 0;
  for (const col of COLLECTIONS) {
    const n = Array.isArray(data[col]) ? data[col].length : 0;
    if (n > 0) { counts[col] = n; total += n; }
  }
  return { counts, total };
}

async function main() {
  // 1. Valideer config
  if (!SUPABASE_URL || SUPABASE_URL.includes("your-project")) abort("SUPABASE_URL is niet ingesteld in .env");
  if (!SERVICE_ROLE_KEY || SERVICE_ROLE_KEY === "replace_me_service_role_key") abort("SUPABASE_SERVICE_ROLE_KEY is niet ingesteld in .env");

  // 2. Laad JSON data
  if (!fs.existsSync(JSON_DB_PATH)) abort(`JSON database niet gevonden: ${JSON_DB_PATH}`);
  const raw  = fs.readFileSync(JSON_DB_PATH, "utf8");
  const data = JSON.parse(raw);

  const { counts, total } = countRecords(data);
  console.log(`\nWorkFlow Pro – JSON → Supabase migratie`);
  console.log(`  Bron    : ${JSON_DB_PATH}`);
  console.log(`  Doel    : ${SUPABASE_URL}`);
  console.log(`  Records : ${total} totaal`);
  Object.entries(counts).forEach(([k, v]) => console.log(`    ${k.padEnd(22)}: ${v}`));

  if (DRY_RUN) {
    console.log(`\n  ℹ️  Dry-run: geen data gepusht.\n`);
    process.exit(0);
  }

  // 3. Push via bridge
  console.log(`\n  Bezig met uploaden naar Supabase…`);
  const start = Date.now();
  try {
    execFileSync(process.execPath, [BRIDGE_PATH, "save"], {
      input: raw,
      encoding: "utf8",
      env: { ...process.env, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY },
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["pipe", "pipe", "inherit"]
    });
  } catch (err) {
    abort(`Bridge save mislukt: ${err.message}`);
  }
  const ms = Date.now() - start;
  console.log(`  ✅ Upload voltooid in ${(ms / 1000).toFixed(1)}s`);
  console.log(`\n  Volgende stap: zet STORAGE_ADAPTER=postgres in .env en herstart de server.\n`);
}

main().catch(err => {
  console.error(`\n❌  Onverwachte fout: ${err.message}\n`);
  process.exit(1);
});
