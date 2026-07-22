"use strict";
// CTO-05 DoD · deploymenttest: een write vlak vóór SIGTERM overleeft de restart.
// Boot de ECHTE server op de pg-adapter, schrijft een klant, stuurt SIGTERM,
// boot opnieuw en bewijst dat de klant er nog is. Slaat over zonder
// DATABASE_URL (de JSON-modus schrijft synchroon en heeft dit risico niet).
const { test } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");

const LIVE = process.env.DATABASE_URL || "";
if (!LIVE || !/^postgres/.test(LIVE)) {
  test("sigterm-durability: DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  const PORT = Number(process.env.SIGTERM_PORT || 4461);
  const BASE = `http://127.0.0.1:${PORT}`;
  const ENV = {
    ...process.env,
    PORT: String(PORT),
    STORAGE_ADAPTER: "postgres",
    DATABASE_URL: LIVE,
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

  function boot() {
    const proc = spawn(process.execPath, ["src/server.js"], { cwd: path.join(__dirname, ".."), env: ENV, stdio: "pipe" });
    let log = "";
    proc.stdout.on("data", d => { log += d.toString(); });
    proc.stderr.on("data", d => { log += d.toString(); });
    return { proc, log: () => log };
  }
  async function waitHealthy(handle, ms = 30000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch (_) {}
      if (handle.proc.exitCode !== null) throw new Error("server stopte tijdens boot:\n" + handle.log());
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error("server niet gezond binnen de tijd:\n" + handle.log());
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
    // Boot 1: schrijf een klant en stuur meteen SIGTERM.
    const first = boot();
    await waitHealthy(first);
    const { token, tenantId } = await login();
    const name = `Durability BV ${Date.now()}`;
    const w = await fetch(`${BASE}/api/tenants/${tenantId}/customers`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ name, email: "durability@x.be" }),
    });
    assert.equal(w.status, 201, "write geaccepteerd");
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
    const probe = new Pool({ connectionString: LIVE });
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
