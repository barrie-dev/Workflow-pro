const { SupabasePostgresAdapter } = require("../src/lib/data-adapters");

function fail(message) {
  console.error(message);
  process.exit(1);
}

const adapter = new SupabasePostgresAdapter();
const status = adapter.status();

if (!status.configured) {
  fail("Supabase adapter niet geconfigureerd. Zet SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY server-side.");
}

try {
  const result = adapter.runBridge("ping");
  const tables = result.tables || {};
  const missing = Object.entries(tables).filter(([, ok]) => !ok).map(([name]) => name);
  if (missing.length) fail(`Supabase schema mist tabellen: ${missing.join(", ")}`);
  console.log(JSON.stringify({
    ok: true,
    adapter: status.adapter,
    bridge: status.bridge,
    checkedAt: result.checkedAt,
    latestMigration: result.latestMigration
  }, null, 2));
} catch (error) {
  fail(error.message);
}
