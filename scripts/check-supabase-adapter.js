const { SupabasePostgresAdapter } = require("../src/lib/data-adapters");
const { config } = require("../src/lib/config");
const fs = require("fs");
const path = require("path");

function migrationCount() {
  const dir = path.join(config.root, "database", "migrations");
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(name => /^\d+_.*\.sql$/.test(name)).length;
}

function finish(payload) {
  if (payload.jsonMode) {
    const { jsonMode, ...rest } = payload;
    console.log(JSON.stringify(rest, null, 2));
  } else if (payload.ok) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.error(payload.error || "Supabase adapter check mislukt");
    if (payload.actions?.length) {
      payload.actions.forEach(action => console.error(`- ${action}`));
    }
  }
  process.exit(payload.ok ? 0 : 1);
}

const jsonMode = process.argv.includes("--json");
const writeProbe = process.argv.includes("--write-probe");
const allowUnselected = process.argv.includes("--allow-unselected");
const adapter = new SupabasePostgresAdapter();
const status = adapter.status();
const expectedMigrations = migrationCount();

if (config.storageAdapter !== "postgres" && !allowUnselected) {
  finish({
    ok: false,
    jsonMode,
    error: "STORAGE_ADAPTER staat niet op postgres.",
    adapter: config.storageAdapter,
    actions: ["Zet STORAGE_ADAPTER=postgres voor een production Supabase run.", "Gebruik --allow-unselected alleen om credentials/schema los te testen."]
  });
}

if (!status.configured) {
  finish({
    ok: false,
    jsonMode,
    error: "Supabase adapter niet geconfigureerd.",
    adapter: status.adapter,
    configured: status.configured,
    actions: ["Zet SUPABASE_URL server-side.", "Zet SUPABASE_SERVICE_ROLE_KEY als server-only secret."]
  });
}

try {
  const result = adapter.runBridge("ping");
  const tables = result.tables || {};
  const missing = Object.entries(tables).filter(([, ok]) => !ok).map(([name]) => name);
  const latestVersion = Number(result.latestMigration?.version || 0);
  const migrationGap = Math.max(0, expectedMigrations - latestVersion);
  let probe = null;
  if (writeProbe) probe = adapter.runBridge("probe-write");
  const ok = !missing.length && migrationGap === 0 && (!writeProbe || probe?.ok);
  finish({
    jsonMode,
    ok,
    adapter: status.adapter,
    bridge: status.bridge,
    storageSelected: config.storageAdapter === "postgres",
    checkedAt: result.checkedAt,
    expectedMigrations,
    latestMigration: result.latestMigration,
    missingTables: missing,
    migrationGap,
    writeProbe: writeProbe ? probe : "skipped",
    actions: [
      ...(missing.length ? [`Run database/migrations SQL in Supabase: ${missing.join(", ")} ontbreekt.`] : []),
      ...(migrationGap ? [`Supabase heeft migratie v${latestVersion}; verwacht minstens v${expectedMigrations}.`] : []),
      ...(writeProbe && !probe?.ok ? ["Service-role write probe faalde; controleer RLS policies voor global_records."] : [])
    ]
  });
} catch (error) {
  finish({
    ok: false,
    jsonMode,
    error: error.message,
    adapter: status.adapter,
    bridge: status.bridge,
    expectedMigrations,
    actions: ["Controleer SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY en of de migraties zijn uitgevoerd."]
  });
}
