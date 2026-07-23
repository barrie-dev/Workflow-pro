"use strict";
// CTO3-01 · bootflush fail-closed + startup-state-machine.
//
// Bewijst dat de bootgate businessverkeer PAS opent wanneer de staat geladen EN
// de verplichte bootflush geslaagd is (state=ready), en dat een mislukte
// bootflush een HARDE, zichtbare startupfout is (state=failed, exit 1) i.p.v.
// een stil genegeerde best-effort. Draait in JSON-modus (geen DB nodig): de
// startup-state-machine en de fail-closed-semantiek zijn adapteronafhankelijk.
const { test, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");

const ROOT = path.join(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfp-boot01-"));
const spawned = [];

function baseEnv(port, extra) {
  return {
    ...process.env,
    PORT: String(port),
    STORAGE_ADAPTER: "json",
    // Eigen (niet-bestaand) datafile · verse demo-seed, deterministisch.
    WORKFLOWPRO_DATA_FILE: path.join(dataDir, `seed-${port}.json`),
    SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
    WORKFLOWPRO_INITIAL_ADMIN_PASSWORD: "Demo2026!",
    REQUIRE_ADMIN_MFA: "false",
    NODE_ENV: "test", APP_ENV: "test", RELEASE_CHANNEL: "pilot",
    RATE_LIMIT_DISABLED: "true",
    ...extra,
  };
}
function boot(port, extra) {
  const proc = spawn(process.execPath, ["src/server.js"], { cwd: ROOT, env: baseEnv(port, extra), stdio: "pipe" });
  proc.slog = "";
  proc.exitInfo = null;
  proc.stdout.on("data", d => { proc.slog += d.toString(); });
  proc.stderr.on("data", d => { proc.slog += d.toString(); });
  proc.on("exit", (code, signal) => { proc.exitInfo = { code, signal }; });
  spawned.push(proc);
  return proc;
}
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
async function get(port, pathname) {
  try { const r = await fetch(`http://127.0.0.1:${port}${pathname}`); return { status: r.status, body: await r.json().catch(() => ({})) }; }
  catch (e) { return { status: 0, error: e.message }; }
}
async function until(fn, ms, step = 150) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() >= end) return null; await new Promise(r => setTimeout(r, step)); } }
const waitExit = (proc, ms = 8000) => until(() => proc.exitInfo, ms, 100);
function stop(proc) { return new Promise(res => { if (!proc || proc.exitInfo) return res(); proc.once("exit", () => res()); try { proc.kill("SIGKILL"); } catch (_) {} setTimeout(res, 3000).unref(); }); }

after(async () => { for (const p of spawned) await stop(p); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {} });

test("een mislukte bootflush is fail-closed: state wordt nooit ready, proces eindigt non-zero", async () => {
  const port = await freePort();
  const proc = boot(port, { WFP_FAULT_BOOTFLUSH: "1" });

  // Zolang het proces leeft mag /api/ready NOOIT 200 geven, en een businessroute
  // wordt geweigerd. We pollen kort; het proces hoort daarna hard te stoppen.
  let sawReady200 = false;
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline && !proc.exitInfo) {
    const ready = await get(port, "/api/ready");
    if (ready.status === 200) sawReady200 = true;
    await new Promise(r => setTimeout(r, 80));
  }

  const exit = await waitExit(proc, 8000);
  assert.ok(exit, `proces had moeten stoppen bij een mislukte bootflush:\n${proc.slog.slice(-500)}`);
  assert.notEqual(exit.code, 0, `exitcode moet non-zero zijn bij een fail-closed bootflush (kreeg ${exit.code})`);
  assert.equal(sawReady200, false, "/api/ready mag nooit 200 worden bij een mislukte bootflush");
  assert.match(proc.slog, /STARTUP_FAILED/, "de startupfout is zichtbaar gelogd met een vaste foutcode");
  assert.match(proc.slog, /BOOTFLUSH_FAILED/, "de foutcode van de mislukte bootflush staat in het log");
});

test("de gate weigert businessverkeer tot state=ready; liveness blijft wel 200", async () => {
  const port = await freePort();
  // Houd de boot ~1,5 s in state=flushing zodat het niet-ready venster observeerbaar is.
  const proc = boot(port, { WFP_FAULT_BOOTDELAY_MS: "1500" });

  // Wacht tot het proces luistert (liveness 200), maar nog niet ready.
  const live = await until(async () => { const h = await get(port, "/api/health"); return h.status === 200 ? h : null; }, 8000);
  assert.ok(live, `liveness had 200 moeten geven tijdens het opstarten:\n${proc.slog.slice(-400)}`);
  assert.notEqual(live.body.status, "ready", "tijdens het opstarten is de status nog niet ready");

  // In hetzelfde venster: readiness 503 en een businessroute 503 (geweigerd).
  const ready = await get(port, "/api/ready");
  assert.equal(ready.status, 503, "readiness moet 503 zijn tot de boot klaar is");
  assert.equal(ready.body.code, "NOT_READY");
  const business = await get(port, "/api/tenants/t_demo/customers");
  assert.equal(business.status, 503, "een businessroute wordt geweigerd vóór ready");
  assert.equal(business.body.code, "BOOTING");

  // Na het venster wordt de server ready en bedient hij verkeer.
  const nowReady = await until(async () => { const r = await get(port, "/api/ready"); return r.status === 200 ? r : null; }, 8000);
  assert.ok(nowReady, `server had ready moeten worden na het boot-venster:\n${proc.slog.slice(-400)}`);
});

test("normale boot zonder fout wordt gewoon ready", async () => {
  const port = await freePort();
  const proc = boot(port, {});
  const ready = await until(async () => { const r = await get(port, "/api/ready"); return r.status === 200 ? r : null; }, 10000);
  assert.ok(ready, `een normale boot had ready moeten worden:\n${proc.slog.slice(-400)}`);
  assert.ok(!proc.exitInfo, "een gezonde server blijft draaien");
});
