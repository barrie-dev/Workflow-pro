"use strict";
// Strangler-bronschakelaar (finale CTO-directive · één engine). Boot de echte
// server met FORMS_SOURCE=pg op een JSON-store en bewijst:
//  1. het legacy work-os SCHRIJFPAD (forms/templates|instances) is bevroren (410);
//  2. legacy LEZEN blijft werken voor historiek (200);
//  3. de canonieke paden antwoorden eerlijk 503 zonder PostgreSQL (geen stille
//     terugval naar een tweede engine).
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = Number(process.env.STRANGLER_PORT || 4437);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflowpro-strangler-"));
  server = spawn(process.execPath, ["src/server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(PORT),
      STORAGE_ADAPTER: "json",
      DATABASE_URL: "",
      FORMS_SOURCE: "pg", // ← de cutover-stand die het legacy schrijfpad bevriest
      WORKFLOWPRO_DATA_FILE: path.join(dir, "strangler.json"),
      WORKFLOWPRO_INITIAL_ADMIN_PASSWORD: "Demo2026!",
      REQUIRE_ADMIN_MFA: "false",
      NODE_ENV: "test",
      RELEASE_CHANNEL: "pilot",
      RATE_LIMIT_DISABLED: "true",
    },
    stdio: "pipe",
  });
  let bootLog = "";
  server.stderr.on("data", d => { bootLog += d.toString(); });
  server.stdout.on("data", d => { bootLog += d.toString(); });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch (_) {}
    if (server.exitCode !== null) throw new Error("server stopte tijdens boot:\n" + bootLog);
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error("server kwam niet op binnen 20s:\n" + bootLog);
});

after(() => {
  if (server && server.exitCode === null) server.kill();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

let token, tenantId;
async function loginAdmin() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@demobouw.be", password: "Demo2026!" }),
  });
  const d = await r.json();
  assert.equal(d.ok, true, "admin-login moet slagen");
  token = d.token; tenantId = d.user.tenantId;
}
const H = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });

test("legacy schrijfpad is bevroren met FORMS_SOURCE=pg (410)", async () => {
  await loginAdmin();
  const r = await fetch(`${BASE}/api/tenants/${tenantId}/forms/templates`, {
    method: "POST", headers: H(), body: JSON.stringify({ name: "Mag niet meer" }),
  });
  assert.equal(r.status, 410);
  const d = await r.json();
  assert.equal(d.code, "FORMS_LEGACY_FROZEN");
  assert.match(d.error, /form-definitions/);
  // Instance-schrijfpad eveneens bevroren.
  const r2 = await fetch(`${BASE}/api/tenants/${tenantId}/forms/instances`, {
    method: "POST", headers: H(), body: JSON.stringify({}),
  });
  assert.equal(r2.status, 410);
});

test("legacy LEZEN blijft werken voor historiek (200)", async () => {
  const r = await fetch(`${BASE}/api/tenants/${tenantId}/forms/templates`, { headers: H() });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.ok(Array.isArray(d.templates));
});

test("canonieke paden antwoorden eerlijk 503 zonder PostgreSQL", async () => {
  const r = await fetch(`${BASE}/api/tenants/${tenantId}/form-definitions`, { headers: H() });
  assert.equal(r.status, 503);
  const d = await r.json();
  assert.equal(d.code, "FORMS_REQUIRES_PG");
});
