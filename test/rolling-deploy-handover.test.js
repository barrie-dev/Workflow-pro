"use strict";
// CTO-03 DoD · rolling deploy met een single writer (bootgate).
//
// Reproduceert de deadlock die elke productie-deploy liet falen: het platform
// verdraagt maar EEN schrijver op platform_state, en een zero-downtime deploy
// (Render, Kubernetes RollingUpdate) start de nieuwe instantie NAAST de oude en
// stopt de oude pas als de nieuwe gezond is. Wachtte de nieuwe met luisteren
// tot ze de writer-lock had, dan werd ze nooit gezond, stopte de oude nooit en
// kwam de lock nooit vrij ("No open ports detected" op Render).
//
// De bootgate lost dit op: de nieuwe instantie luistert METEEN. Ze is dan
// healthy (health = "booting"), maar weigert ALLE andere verkeer met 503 tot ze
// de lock heeft en de staat geladen is · nooit lezen of schrijven op een half
// geladen staat.
//
// Het loslaten van de lock testen we OS-onafhankelijk: op Windows is
// proc.kill("SIGTERM") een harde kill die de graceful shutdown (en dus
// close() → releaseWriterLock) overslaat. We beeindigen daarom A's
// lock-verbinding server-side met pg_terminate_backend · dat is exact wat
// pool.end() in de graceful shutdown server-side veroorzaakt (de sessie eindigt,
// PostgreSQL geeft de advisory lock vrij).
//
// Slaat over zonder DATABASE_URL · de JSON-modus kent geen writer-lock.
const { test, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");

const LIVE = process.env.DATABASE_URL || "";
if (!LIVE || !/^postgres/.test(LIVE)) {
  test("rolling-deploy handover: DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  const fs = require("node:fs");
  const os = require("node:os");
  const net = require("node:net");
  const { Pool } = require("pg");

  const ROOT = path.join(__dirname, "..");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfp-rolling-"));
  const TEST_DB = "wfp_rolling_e2e";
  const DB_URL = LIVE.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);
  const ADMIN_URL = LIVE.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
  const ssl = /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false };
  // WRITER_LOCK_KEY uit de adapter · de advisory-lock-sleutel is clusterbreed.
  const { WRITER_LOCK_KEY } = require("../src/infrastructure/postgres/pg-data-adapter");

  const spawned = [];
  function boot(port) {
    const env = {
      ...process.env,
      PORT: String(port), STORAGE_ADAPTER: "postgres", DATABASE_URL: DB_URL,
      WORKFLOWPRO_DATA_FILE: path.join(dataDir, "seed.json"),
      SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
      SINGLE_WRITER: "true", SINGLE_WRITER_WAIT_MS: "120000",
      WORKFLOWPRO_INITIAL_ADMIN_PASSWORD: "Demo2026!", REQUIRE_ADMIN_MFA: "false",
      NODE_ENV: "test", RELEASE_CHANNEL: "pilot", RATE_LIMIT_DISABLED: "true",
    };
    const proc = spawn(process.execPath, ["src/server.js"], { cwd: ROOT, env, stdio: "pipe" });
    proc.slog = "";
    proc.stdout.on("data", d => { proc.slog += d.toString(); });
    proc.stderr.on("data", d => { proc.slog += d.toString(); });
    spawned.push(proc);
    return proc;
  }
  const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
  async function get(port, pathname) {
    try { const r = await fetch(`http://127.0.0.1:${port}${pathname}`); return { status: r.status, body: await r.json().catch(() => ({})) }; }
    catch (e) { return { status: 0, error: e.message }; }
  }
  async function until(fn, timeoutMs, stapMs = 300) {
    const deadline = Date.now() + timeoutMs;
    for (;;) { const v = await fn(); if (v) return v; if (Date.now() >= deadline) return null; await new Promise(r => setTimeout(r, stapMs)); }
  }
  function stop(proc) {
    return new Promise(res => {
      if (!proc || proc.exitCode !== null) return res();
      proc.once("exit", () => res());
      try { proc.kill("SIGKILL"); } catch (_) {}
      setTimeout(res, 4000).unref();
    });
  }

  after(async () => {
    for (const p of spawned) await stop(p);
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
    const admin = new Pool({ connectionString: ADMIN_URL, ssl });
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  });

  test("nieuwe instantie is healthy tijdens het wachten, weigert verkeer, en neemt de lock over als de oude vrijkomt", async () => {
    const admin = new Pool({ connectionString: ADMIN_URL, ssl });
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => {});
    await admin.query(`CREATE DATABASE ${TEST_DB}`);

    const portA = await freePort();
    const portB = await freePort();

    // ── Instantie A: de draaiende productie-instantie ────────────────────────
    const a = boot(portA);
    const aReady = await until(async () => {
      const h = await get(portA, "/api/health");
      return h.status === 200 && h.body.status !== "booting" ? h : null;
    }, 90000);
    assert.ok(aReady, `instantie A werd niet volledig gezond:\n${a.slog}`);
    assert.equal(aReady.body.storeReady, true, "A heeft de staat geladen en is de schrijver");

    // ── Instantie B start ERNAAST, zoals een zero-downtime deploy doet ───────
    const b = boot(portB);

    // 1. B luistert METEEN en is healthy · anders stopt het platform de oude
    //    instantie nooit en ontstaat de deadlock opnieuw.
    const bBooting = await until(async () => {
      const h = await get(portB, "/api/health");
      return h.status === 200 ? h : null;
    }, 30000);
    assert.ok(bBooting, `instantie B werd niet gezond terwijl A de lock hield:\n${b.slog}`);
    assert.equal(bBooting.body.status, "booting", "B meldt eerlijk dat ze nog opstart");

    // 2. B mag intussen NIETS anders bedienen: geen lezen/schrijven op een half
    //    geladen staat.
    const geweigerd = await get(portB, "/api/ready");
    assert.equal(geweigerd.status, 503, "B weigert ander verkeer tijdens het opstarten");
    assert.equal(geweigerd.body.code, "BOOTING");

    // 3. A draait ongestoord door: de deploy verstoort de lopende dienst niet.
    const aNog = await get(portA, "/api/health");
    assert.equal(aNog.status, 200);
    assert.notEqual(aNog.body.status, "booting", "A blijft de actieve schrijver");

    // ── Het platform stopt de oude instantie · haar sessie eindigt en de
    //    advisory lock komt vrij. We reproduceren dat server-side (zie kop). ──
    //    KRITISCH: de advisory-lock-sleutel is CLUSTERBREED, niet per database.
    //    We filteren daarom strikt op onze eigen testdatabase (datname), zodat we
    //    nooit de lock-verbinding van een parallel draaiende pg-test beeindigen.
    const held = await admin.query(
      `select l.pid from pg_locks l
         join pg_stat_activity a on a.pid = l.pid
        where l.locktype = 'advisory' and l.objid = $1 and l.granted = true
          and a.datname = $2`,
      [WRITER_LOCK_KEY, TEST_DB]
    );
    assert.ok(held.rows.length >= 1, "er hoort precies een writer-lock actief te zijn (A) op onze testdatabase");
    for (const row of held.rows) await admin.query("select pg_terminate_backend($1)", [row.pid]);
    await admin.end();

    // 4. B neemt de lock over en wordt vanzelf volledig operationeel · precies
    //    wat eerder onmogelijk was.
    const bReady = await until(async () => {
      const h = await get(portB, "/api/health");
      return h.status === 200 && h.body.status !== "booting" ? h : null;
    }, 30000);
    assert.ok(bReady, `instantie B nam de writer-lock niet over nadat A vrijkwam:\n${b.slog}`);
    assert.equal(bReady.body.storeReady, true, "B heeft de staat geladen");
    assert.match(b.slog, /single-writer-lock verkregen/i, "B logt expliciet dat ze de schrijver is");

    // 5. En B bedient nu echt verkeer.
    const bReadyEp = await get(portB, "/api/ready");
    assert.equal(bReadyEp.status, 200, `B moet na de overname readiness melden (kreeg ${bReadyEp.status})`);
  });
}
