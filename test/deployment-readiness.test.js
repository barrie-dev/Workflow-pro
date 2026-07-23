"use strict";
// CTO3-02 · deployment readiness. Liveness en readiness zijn verschillende,
// machineleesbare signalen: liveness (/api/health, /api/live) meldt dat het
// proces leeft; readiness (/api/ready) is pas 200 wanneer de staat geladen en de
// verplichte bootflush geslaagd is. Alleen readiness bepaalt of businessverkeer
// wordt toegelaten. Elke respons draagt commitSha + deploymentId (SHA-gekoppeld).
const { test, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");

const ROOT = path.join(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfp-ready02-"));
const spawned = [];

function boot(port, extra) {
  const env = {
    ...process.env, PORT: String(port), STORAGE_ADAPTER: "json",
    WORKFLOWPRO_DATA_FILE: path.join(dataDir, `seed-${port}.json`),
    SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
    WORKFLOWPRO_INITIAL_ADMIN_PASSWORD: "Demo2026!", REQUIRE_ADMIN_MFA: "false",
    NODE_ENV: "test", APP_ENV: "test", RELEASE_CHANNEL: "pilot", RATE_LIMIT_DISABLED: "true",
    // Vaste deployment-identiteit zodat we de SHA-koppeling deterministisch toetsen.
    DEPLOYMENT_ID: "test-deploy-xyz", APP_COMMIT_SHA: "abc1234",
    ...extra,
  };
  const proc = spawn(process.execPath, ["src/server.js"], { cwd: ROOT, env, stdio: "pipe" });
  proc.slog = ""; proc.exitInfo = null;
  proc.stdout.on("data", d => { proc.slog += d.toString(); });
  proc.stderr.on("data", d => { proc.slog += d.toString(); });
  proc.on("exit", (code) => { proc.exitInfo = { code }; });
  spawned.push(proc);
  return proc;
}
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
async function get(port, pathname) {
  try { const r = await fetch(`http://127.0.0.1:${port}${pathname}`); return { status: r.status, body: await r.json().catch(() => ({})) }; }
  catch (e) { return { status: 0, error: e.message }; }
}
async function until(fn, ms, step = 150) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() >= end) return null; await new Promise(r => setTimeout(r, step)); } }
function stop(proc) { return new Promise(res => { if (!proc || proc.exitInfo) return res(); proc.once("exit", () => res()); try { proc.kill("SIGKILL"); } catch (_) {} setTimeout(res, 3000).unref(); }); }
after(async () => { for (const p of spawned) await stop(p); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {} });

test("readiness-contract: ready draagt SHA + deploymentId en een machineleesbare checkset", async () => {
  const port = await freePort();
  boot(port, {});
  const ready = await until(async () => { const r = await get(port, "/api/ready"); return r.status === 200 ? r : null; }, 10000);
  assert.ok(ready, "server had ready moeten worden");
  assert.equal(ready.body.ok, true);
  assert.equal(ready.body.status, "ready");
  assert.equal(ready.body.commitSha, "abc1234", "readiness is SHA-gekoppeld");
  assert.equal(ready.body.deploymentId, "test-deploy-xyz", "readiness draagt de deployment-identiteit");
  assert.equal(ready.body.checks.state, true, "state geladen + bootflush geslaagd");
  assert.equal(ready.body.checks.storage, true);
  assert.ok("objectStorageAdapter" in ready.body.checks, "checkset noemt de objectstorage-adapter");
  assert.ok("databaseSslMode" in ready.body.checks, "checkset noemt de DB TLS-modus");
});

test("liveness vs readiness: /api/health en /api/live zijn 200 terwijl readiness nog 503 is", async () => {
  const port = await freePort();
  // Houd de boot ~1,5 s in state=flushing.
  boot(port, { WFP_FAULT_BOOTDELAY_MS: "1500" });

  // Liveness is 200 zodra het proces luistert, ook vóór ready.
  const health = await until(async () => { const h = await get(port, "/api/health"); return h.status === 200 ? h : null; }, 8000);
  assert.ok(health, "liveness /api/health had 200 moeten geven tijdens het opstarten");
  assert.notEqual(health.body.status, "ready", "status is nog niet ready");
  assert.equal(health.body.commitSha, "abc1234", "ook liveness is SHA-gekoppeld");
  assert.equal(health.body.deploymentId, "test-deploy-xyz");

  const live = await get(port, "/api/live");
  assert.equal(live.status, 200, "/api/live is een liveness-alias en geeft 200 tijdens boot");
  assert.equal(live.body.deploymentId, "test-deploy-xyz");

  // In hetzelfde venster is readiness 503 · businessverkeer wordt niet toegelaten.
  const ready = await get(port, "/api/ready");
  assert.equal(ready.status, 503, "readiness is 503 tot de boot klaar is");
  assert.equal(ready.body.code, "NOT_READY");

  // Na het venster wordt readiness 200.
  const nowReady = await until(async () => { const r = await get(port, "/api/ready"); return r.status === 200 ? r : null; }, 8000);
  assert.ok(nowReady, "server had ready moeten worden na het boot-venster");
});

test("render.yaml stuurt traffic op readiness en claimt geen zero-downtime", () => {
  const yaml = fs.readFileSync(path.join(ROOT, "render.yaml"), "utf8").replace(/\r\n/g, "\n");
  assert.match(yaml, /healthCheckPath:\s*\/api\/ready/, "de traffic-healthcheck staat op readiness");
  const runbook = fs.readFileSync(path.join(ROOT, "docs/DEPLOY-RUNBOOK.md"), "utf8").replace(/\r\n/g, "\n");
  assert.match(runbook, /stop-first\s*\/?\s*recreate is de officiele productiestrategie/i, "het runbook maakt stop-first officieel");
});
