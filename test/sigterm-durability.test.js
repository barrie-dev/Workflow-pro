"use strict";
// CTO-05 DoD · deploymenttest: een write vlak vóór SIGTERM overleeft de restart.
// Boot de ECHTE server op de pg-adapter, schrijft een klant, stuurt SIGTERM,
// boot opnieuw en bewijst dat de klant er nog is. Slaat over zonder
// DATABASE_URL (de JSON-modus schrijft synchroon en heeft dit risico niet).
const { test, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");

const LIVE = process.env.DATABASE_URL || "";
if (!LIVE || !/^postgres/.test(LIVE)) {
  test("sigterm-durability: DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  const fs = require("node:fs");
  const os = require("node:os");
  const PORT = Number(process.env.SIGTERM_PORT || 4461);
  const BASE = `http://127.0.0.1:${PORT}`;
  // Hermetisch: een EIGEN (niet-bestaand) legacy-databestand. Zonder dit zou een
  // lege platform_state de eenmalige legacy-import uit data/workflowpro-
  // fullstack.json triggeren, met omgevingsafhankelijke wachtwoordhashes · de
  // demo-login zou dan wel of niet werken naargelang wat er toevallig in dat
  // bestand staat. Nu seedt de server gegarandeerd zijn eigen demo-dataset.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfp-sigterm-"));
  const TEST_DB = "wfp_sigterm_e2e"; // eigen database · zie "Hermetisch (3)" in de test
  const ENV = {
    ...process.env,
    PORT: String(PORT),
    STORAGE_ADAPTER: "postgres",
    DATABASE_URL: LIVE,
    WORKFLOWPRO_DATA_FILE: path.join(dataDir, "sigterm-seed.json"),
    // Hermetisch (2): een lokale shell kan Supabase-legacy-credentials dragen ·
    // dan zou de eenmalige cutover-import de ECHTE legacy-dataset in de test-db
    // trekken (andere wachtwoorden, echte gebruikers). Bridge expliciet uit.
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    // Single-writer AAN: de herstart moet de lock van de gestopte instantie
    // gewoon kunnen overnemen (die komt vrij bij sessie-einde).
    SINGLE_WRITER: "true",
    SINGLE_WRITER_WAIT_MS: "20000",
    WORKFLOWPRO_INITIAL_ADMIN_PASSWORD: "Demo2026!",
    REQUIRE_ADMIN_MFA: "false",
    NODE_ENV: "test",
    RELEASE_CHANNEL: "pilot",
    RATE_LIMIT_DISABLED: "true",
  };

  // Elke gespawnde server wordt geregistreerd en in de after-hook geforceerd
  // opgeruimd · ook wanneer een assert halverwege faalt. Zonder dit houdt een
  // wees-proces de event-loop van node --test open (hang in plaats van rood).
  const spawned = [];
  function boot() {
    const proc = spawn(process.execPath, ["src/server.js"], { cwd: path.join(__dirname, ".."), env: ENV, stdio: "pipe" });
    spawned.push(proc);
    let log = "";
    proc.stdout.on("data", d => { log += d.toString(); });
    proc.stderr.on("data", d => { log += d.toString(); });
    return { proc, log: () => log };
  }
  after(async () => {
    for (const proc of spawned) { if (proc.exitCode === null) { try { proc.kill(); } catch (_) {} } }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
    // Eigen database opruimen (best-effort · een volgende run dropt hem sowieso).
    try {
      const { Pool } = require("pg");
      const admin = new Pool({ connectionString: LIVE });
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => {});
      await admin.end();
    } catch (_) {}
  });
  // Wacht op READINESS, niet op liveness. Sinds de bootgate (CTO-03) geeft
  // /api/health meteen 200 met status "booting" zodat het platform de instantie
  // gezond ziet en de oude durft te stoppen · maar de server bedient pas echt
  // verkeer als /api/ready 200 geeft (staat geladen, writer-lock verkregen).
  async function waitHealthy(handle, ms = 30000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      try { const r = await fetch(`${BASE}/api/ready`); if (r.ok) return; } catch (_) {}
      if (handle.proc.exitCode !== null) throw new Error("server stopte tijdens boot:\n" + handle.log());
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error("server niet klaar binnen de tijd:\n" + handle.log());
  }
  async function login() {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@demobouw.be", password: "Demo2026!" }),
    });
    const d = await r.json();
    assert.equal(d.ok, true, "login moet slagen");
    return { token: d.token, tenantId: d.user.tenantId };
  }
  const waitExit = (proc) => new Promise(res => proc.once("exit", code => res(code)));

  test("write vlak vóór SIGTERM overleeft de herstart (en de writer-lock wisselt netjes)", async () => {
    // Hermetisch (3): een EIGEN database. Testbestanden draaien parallel; in de
    // gedeelde database zou platform_state van andere pg-tests vervuild zijn
    // (boot-crash) of zou onze schoonmaak hún test midscheeps raken. Een eigen
    // database = de server seedt gegarandeerd zijn eigen demo-dataset.
    {
      const { Pool } = require("pg");
      const admin = new Pool({ connectionString: LIVE });
      try { await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`); }
      catch (_) { await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`).catch(() => {}); }
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
      await admin.end();
      ENV.DATABASE_URL = LIVE.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);
    }
    // Boot 1: schrijf een klant en stuur meteen SIGTERM.
    const first = boot();
    await waitHealthy(first);
    const { token, tenantId } = await login();
    const name = `Durability BV ${Date.now()}`;
    const w = await fetch(`${BASE}/api/tenants/${tenantId}/customers`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ name, email: "durability@x.be" }),
    });
    const wBody = await w.json().catch(() => ({}));
    assert.equal(w.status, 201, `write geaccepteerd · kreeg ${w.status}: ${JSON.stringify(wBody).slice(0, 200)}\nserverlog: ${first.log().split("\n").filter(l => /gate|flush|conflict|error|fout/i.test(l)).slice(-5).join(" | ")}`);
    first.proc.kill("SIGTERM");
    const code = await waitExit(first.proc);
    // Op Windows bestaat POSIX-SIGTERM niet: kill() stopt het proces HARD
    // (exit null) zonder graceful handler · dat maakt deze test daar zelfs
    // strenger (de 201 garandeerde de flush al). Op Linux/CI draait de echte
    // graceful shutdown en hoort exit 0 (CTO-05: dirty shutdown = non-zero).
    if (process.platform === "win32") {
      assert.ok(code === null || code === 0, `onverwachte exit ${code} · log:\n${first.log().slice(-800)}`);
    } else {
      assert.equal(code, 0, `nette shutdown hoort exit 0 te geven · log:\n${first.log().slice(-800)}`);
    }

    // Direct db-bewijs (los van elke leesroute): de write staat in PostgreSQL.
    const { Pool } = require("pg");
    const probe = new Pool({ connectionString: ENV.DATABASE_URL });
    const inDb = await probe.query(
      "SELECT (SELECT count(*) FROM jsonb_array_elements(data->'customers') c WHERE c->>'name' = $1)::int AS n FROM platform_state",
      [name]);
    await probe.end();
    assert.equal(inDb.rows[0] && inDb.rows[0].n, 1, "de write staat direct na de kill in platform_state");

    // Boot 2: de klant moet er nog zijn (uit PostgreSQL, geen lokale cache).
    const second = boot();
    try {
      await waitHealthy(second);
      const s2 = await login();
      const r = await fetch(`${BASE}/api/tenants/${s2.tenantId}/customers`, {
        headers: { Authorization: "Bearer " + s2.token },
      });
      const d = await r.json();
      const found = (d.customers || d.rows || []).some(c => c.name === name);
      assert.equal(found, true, "de write van vóór SIGTERM is er na de herstart nog");
    } finally {
      second.proc.kill("SIGTERM");
      await waitExit(second.proc);
    }
  });
}
