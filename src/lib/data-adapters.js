const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { config } = require("./config");

const dbPath = path.join(config.root, "data", "workflowpro-fullstack.json");
const supabaseBridgePath = path.join(config.root, "src", "lib", "supabase-rest-bridge.js");

class JsonDataAdapter {
  constructor(filePath = dbPath) {
    this.name = "json";
    this.filePath = filePath;
  }

  exists() {
    return fs.existsSync(this.filePath);
  }

  load(seed) {
    if (!this.exists()) return seed();
    return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
  }

  save(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
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

function createDataAdapter() {
  if (config.storageAdapter === "postgres") return new SupabasePostgresAdapter();
  return new JsonDataAdapter();
}

module.exports = { JsonDataAdapter, SupabasePostgresAdapter, createDataAdapter, dbPath };
