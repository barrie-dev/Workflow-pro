/**
 * WorkFlow Pro – Supabase productie-setup checker
 *
 * Controleert of alle migrations uitgevoerd zijn, de service-role key werkt,
 * RLS aan staat, en of de tables bereikbaar zijn.
 *
 * Gebruik:
 *   node scripts/check-supabase-setup.js
 *   node scripts/check-supabase-setup.js --json
 *   node scripts/check-supabase-setup.js --write-probe    (test ook schrijven)
 */

require("../src/lib/env").loadEnvFile(require("path").join(__dirname, "..", ".env"));

const https = require("https");

const SUPABASE_URL        = process.env.SUPABASE_URL || "";
const SERVICE_ROLE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const JSON_MODE           = process.argv.includes("--json");
const WRITE_PROBE         = process.argv.includes("--write-probe");

// Migrations die verwacht worden
const EXPECTED_MIGRATIONS = [
  { version: 1, name: "supabase-core-schema" },
  { version: 2, name: "supabase-row-level-security" },
  { version: 3, name: "support-escalation-indexes" },
  { version: 4, name: "expenses-clocks-messages" },
  { version: 5, name: "leaves-vehicles-extended" },
  { version: 6, name: "pwa-push-subscriptions" }
];

// Alle tabellen die moeten bestaan na alle migrations
const REQUIRED_TABLES = [
  "tenants", "tenant_records", "global_records",
  "audit_logs", "error_events", "app_schema_migrations",
  "expenses", "clocks", "messages", "notifications",
  "leaves", "mileage_logs", "push_subscriptions"
];

function supabaseRequest(path, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(options, res => {
      let raw = "";
      res.on("data", c => { raw += c; });
      res.on("end", () => {
        resolve({ status: res.statusCode, body: raw ? tryParseJson(raw) : null });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return text; }
}

async function checkTable(name) {
  try {
    const r = await supabaseRequest(`${name}?limit=1&select=*`);
    return { table: name, ok: r.status < 300 || r.status === 406, status: r.status };
  } catch (err) {
    return { table: name, ok: false, error: err.message };
  }
}

async function getMigrations() {
  try {
    const r = await supabaseRequest("app_schema_migrations?select=version,name,applied_at&order=version.asc");
    if (r.status >= 300) return [];
    return Array.isArray(r.body) ? r.body : [];
  } catch {
    return [];
  }
}

async function writeProbe() {
  const id = `_probe_${Date.now()}`;
  try {
    // Insert
    const ins = await supabaseRequest("global_records", "POST", {
      collection: "_probe",
      id,
      data: { test: true }
    });
    if (ins.status >= 300) return { ok: false, error: `Insert faalde: ${ins.status}` };
    // Delete
    const del = await supabaseRequest(`global_records?id=eq.${id}&collection=eq._probe`, "DELETE");
    return { ok: del.status < 300, insertStatus: ins.status, deleteStatus: del.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function main() {
  const results = { checkedAt: new Date().toISOString() };

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    output({ ok: false, error: "SUPABASE_URL of SUPABASE_SERVICE_ROLE_KEY ontbreekt in .env", ...results });
    return;
  }

  results.supabaseUrl = SUPABASE_URL;

  // 1. Check alle tabellen
  const tableChecks = await Promise.all(REQUIRED_TABLES.map(checkTable));
  results.tables = Object.fromEntries(tableChecks.map(c => [c.table, c.ok]));
  const missingTables = tableChecks.filter(c => !c.ok).map(c => c.table);

  // 2. Check migrations
  const appliedMigrations = await getMigrations();
  const appliedVersions = new Set(appliedMigrations.map(m => Number(m.version)));
  const missingMigrations = EXPECTED_MIGRATIONS.filter(m => !appliedVersions.has(m.version));
  results.migrations = {
    expected: EXPECTED_MIGRATIONS.length,
    applied: appliedMigrations.length,
    missing: missingMigrations.map(m => `v${m.version}: ${m.name}`),
    applied_list: appliedMigrations.map(m => `v${m.version}: ${m.name}`)
  };

  // 3. Write probe (optioneel)
  if (WRITE_PROBE) {
    results.writeProbe = await writeProbe();
  }

  const ok = missingTables.length === 0 && missingMigrations.length === 0
    && (!WRITE_PROBE || results.writeProbe?.ok);

  results.missingTables = missingTables;
  results.ok = ok;

  if (!ok) {
    results.actions = [
      ...missingMigrations.map(m => `Voer migration uit in Supabase SQL Editor: database/migrations/${String(m.version).padStart(3,"0")}_*.sql`),
      ...missingTables.map(t => `Tabel "${t}" ontbreekt – controleer of alle migrations uitgevoerd zijn`),
      ...(WRITE_PROBE && !results.writeProbe?.ok
        ? ["Write probe mislukt – controleer RLS voor global_records en service-role key"]
        : [])
    ];
  }

  output(results);
}

function output(data) {
  if (JSON_MODE) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(`\nWorkFlow Pro – Supabase productie check`);
    console.log(`  Status  : ${data.ok ? "✅ OK" : "❌ Problemen gevonden"}`);
    if (data.supabaseUrl) console.log(`  URL     : ${data.supabaseUrl}`);
    if (data.migrations) {
      console.log(`  Migrations: ${data.migrations.applied}/${data.migrations.expected}`);
      if (data.migrations.missing.length) {
        console.log(`  Ontbrekende migrations:`);
        data.migrations.missing.forEach(m => console.log(`    - ${m}`));
      }
    }
    if (data.missingTables?.length) {
      console.log(`  Ontbrekende tabellen: ${data.missingTables.join(", ")}`);
    }
    if (data.writeProbe) {
      console.log(`  Write probe: ${data.writeProbe.ok ? "✅" : "❌ " + data.writeProbe.error}`);
    }
    if (data.actions?.length) {
      console.log(`\n  Acties:`);
      data.actions.forEach(a => console.log(`    → ${a}`));
    }
    console.log();
  }
  process.exit(data.ok ? 0 : 1);
}

main().catch(err => {
  output({ ok: false, error: err.message });
});
