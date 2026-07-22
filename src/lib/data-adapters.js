const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { config } = require("./config");

const dbPath = process.env.WORKFLOWPRO_DATA_FILE
  ? path.resolve(process.env.WORKFLOWPRO_DATA_FILE)
  : path.join(config.root, "data", "workflowpro-fullstack.json");
const supabaseBridgePath = path.join(config.root, "src", "lib", "supabase-rest-bridge.js");

class JsonDataAdapter {
  constructor(filePath = dbPath) {
    this.name = "json";
    this.filePath = filePath;
    // Gebufferde modus (alleen door de SERVER aangezet): save() markeert dan
    // enkel vuil en flush() schrijft gecoalesced. Losse scripts blijven
    // synchroon schrijven zodat "script klaar" ook "bestand geschreven" blijft.
    // Loadtest-bevinding 2026-07-21: met een grote dataset kostte de
    // synchrone volledige-staat-write per mutatie 300-460 ms en stapelden
    // 10 gelijktijdige schrijvers op tot 3-4 s.
    this.buffered = false;
    this.pending = null;
    this.flushing = null;
  }

  exists() {
    return fs.existsSync(this.filePath);
  }

  load(seed) {
    if (!this.exists()) return seed();
    return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
  }

  serialize(data) {
    // Compact zodra het bestand groot wordt: pretty-print maakt de staat
    // 2-3x groter en de stringify evenredig trager. Kleine (dev-)bestanden
    // blijven leesbaar.
    const compact = JSON.stringify(data);
    return compact.length < 2_000_000 ? JSON.stringify(data, null, 2) : compact;
  }

  save(data) {
    if (this.buffered) { this.pending = data; return; }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, this.serialize(data));
  }

  isDirty() {
    return this.pending !== null;
  }

  /** Gecoalescede flush: één schrijfactie voor alle mutaties tot nu toe. */
  async flush() {
    if (!this.pending) return { written: false };
    if (this.flushing) {
      await this.flushing;
      if (!this.pending) return { written: true };
    }
    const run = async () => {
      while (this.pending) {
        const data = this.pending;
        this.pending = null;
        const text = this.serialize(data);
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        await fs.promises.writeFile(this.filePath, text);
      }
    };
    this.flushing = run().finally(() => { this.flushing = null; });
    await this.flushing;
    return { written: true };
  }

  status() {
    return {
      adapter: this.name,
      mode: "local",
      path: this.filePath,
      online: this.exists()
    };
  }
}

class SupabasePostgresAdapter {
  constructor(databaseUrl = config.databaseUrl) {
    this.name = "postgres";
    this.databaseUrl = databaseUrl;
    this.supabaseUrl = config.supabase.url;
    this.serviceRoleKey = config.supabase.serviceRoleKey;
  }

  assertConfigured() {
    if (!this.supabaseUrl || !this.serviceRoleKey) {
      const error = new Error("SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn nodig voor de Supabase adapter");
      error.status = 500;
      throw error;
    }
  }

  runBridge(action, input = null) {
    this.assertConfigured();
    const output = execFileSync(process.execPath, [supabaseBridgePath, action], {
      cwd: config.root,
      input: input ? JSON.stringify(input) : "",
      encoding: "utf8",
      env: {
        ...process.env,
        SUPABASE_URL: this.supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: this.serviceRoleKey
      },
      maxBuffer: 25 * 1024 * 1024
    });
    return output ? JSON.parse(output) : null;
  }

  load(seed) {
    const data = this.runBridge("load");
    return data || seed();
  }

  save(data) {
    this.runBridge("save", data);
  }

  status() {
    return {
      adapter: this.name,
      mode: "supabase-postgres",
      configured: !!this.supabaseUrl && !!this.serviceRoleKey,
      bridge: "supabase-rest",
      pooled: /pooler\.supabase\.com|:6543\//.test(this.databaseUrl)
    };
  }
}

/**
 * Kies de opslagadapter (vendor-handover F-01/F-02).
 *
 *   STORAGE_ADAPTER=postgres  → standaard PostgreSQL (draait overal)
 *   STORAGE_ADAPTER=json      → lokaal bestand (dev/zelf-host zonder database)
 *   STORAGE_ADAPTER=supabase  → LEGACY, alleen om bestaande data te migreren
 *
 * "postgres" wijst bewust naar de standaard-adapter, niet meer naar Supabase:
 * de app mag in geen enkele omgeving nog van een provider-specifieke REST-bridge
 * afhangen. De Supabase-adapter blijft enkel bereikbaar via de expliciete
 * legacy-waarde, zodat een eenmalige migratie mogelijk blijft.
 */
function createDataAdapter() {
  const kind = String(config.storageAdapter || "json").toLowerCase();
  if (kind === "postgres") {
    // Lazy require: de pg-driver wordt alleen geladen als hij echt gebruikt
    // wordt, zodat een JSON-only omgeving geen database-dependency nodig heeft.
    const { PostgresDataAdapter } = require("../infrastructure/postgres/pg-data-adapter");
    // Cutover zonder dataverlies: staat er nog een geconfigureerde legacy
    // Supabase-bridge naast (SUPABASE_URL + service key), dan wordt die
    // dataset ÉÉN keer overgenomen wanneer platform_state nog leeg is. De
    // bridge blijft daarbij onaangeroerd (alleen lezen) · rollback is dus
    // STORAGE_ADAPTER=supabase terugzetten.
    const legacy = new SupabasePostgresAdapter();
    const initialImport = (legacy.supabaseUrl && legacy.serviceRoleKey)
      ? async () => legacy.load(() => null)
      : null;
    return new PostgresDataAdapter({
      connectionString: config.database.url,
      // CTO-13: volledige ssl-opties (verify-full in productie) i.p.v. boolean.
      ssl: require("./config").databaseSslOptions(),
      maxConnections: config.database.maxConnections,
      statementTimeoutMs: config.database.statementTimeoutMs,
      initialImport,
    });
  }
  if (kind === "supabase") return new SupabasePostgresAdapter();
  return new JsonDataAdapter();
}

module.exports = { JsonDataAdapter, SupabasePostgresAdapter, createDataAdapter, dbPath };
