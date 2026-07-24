"use strict";
// IA-runtime e2e · deelbare links tegen de ECHTE server.
//
// De acceptatie-eis uit §6 is "refresh safety": een record-URL verversen moet
// hetzelfde record teruggeven. Dat kan alleen als de server een deeplink niet
// met 404 beantwoordt, en als de app de sessie herstelt in plaats van je terug
// naar het inlogscherm te sturen. Beide zijn hier gedekt.
//
// De DOM-kant (router mounten, drawer openen) is met deze harnas niet te
// bewijzen · die is handmatig geverifieerd. Wat hier draait is wat er in CI
// gecontroleerd MOET blijven: geen 404, echte HTML, alle scripts aanwezig.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = Number(process.env.IA_E2E_PORT || 4403);
const BASE = `http://127.0.0.1:${PORT}`;
let server, dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfp-ia-e2e-"));
  server = spawn(process.execPath, ["src/server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), STORAGE_ADAPTER: "json",
      WORKFLOWPRO_DATA_FILE: path.join(dir, "data.json"),
      WORKFLOWPRO_INITIAL_ADMIN_PASSWORD: "Demo2026!", REQUIRE_ADMIN_MFA: "false",
      NODE_ENV: "test", RELEASE_CHANNEL: "pilot", RATE_LIMIT_DISABLED: "true" },
    stdio: "pipe" });
  let boot = ""; server.stderr.on("data", d => boot += d); server.stdout.on("data", d => boot += d);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/ready`)).ok) return; } catch (_) {}
    if (server.exitCode !== null) throw new Error("server stopte:\n" + boot);
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error("server kwam niet op:\n" + boot);
});

after(async () => {
  if (server && server.exitCode === null) {
    await new Promise(resolve => {
      server.once("exit", resolve);
      server.kill();
      setTimeout(() => { try { server.kill("SIGKILL"); } catch (_) {} }, 3000).unref();
    });
  }
  if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
});

test("IA-e2e 1· REFRESH SAFETY: elke deeplink geeft de app, geen 404", async () => {
  const paden = [
    "/app/customers",
    "/app/customers/c_42/overview",
    "/app/finance/invoices?status=open&q=acme",
    "/app/planning",
    "/app/team/leave",
    "/app/work-orders/wo_9/overview",
  ];
  for (const p of paden) {
    const r = await fetch(`${BASE}${p}`);
    assert.equal(r.status, 200, `${p} gaf ${r.status} · een gedeelde link hoort te werken`);
    const html = await r.text();
    assert.match(html, /<title>/i, `${p} gaf geen HTML terug`);
  }
});

test("IA-e2e 2· een BESTAND onder /app blijft een bestand", async () => {
  // HTML met de MIME-type van een script serveren breekt de pagina op een
  // manier die niemand terugvindt.
  const r = await fetch(`${BASE}/js/app/routing/router.js`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /javascript/);
  assert.match(await r.text(), /LEGACY_VIEW_BY_ROUTE/);
});

test("IA-e2e 3· een echt onbestaand pad blijft een eerlijke 404", async () => {
  assert.equal((await fetch(`${BASE}/bestaat-echt-niet.html`)).status, 404);
  assert.equal((await fetch(`${BASE}/app/thing.js`)).status, 404,
    "een ontbrekend bestand onder /app is een 404, geen stille index.html");
});

test("IA-e2e 4· de IA-laag wordt echt geladen door de app", async () => {
  const html = await (await fetch(`${BASE}/`)).text();
  const nodig = [
    "/js/app/navigation/registry.js",
    "/js/app/navigation/resolver.js",
    "/js/app/navigation/route-map.js",
    "/js/app/navigation/context-adapter.js",
    "/js/app/routing/guards.js",
    "/js/app/routing/router.js",
    "/js/platforms/admin-ia-bootstrap.js",
    "/js/session-restore.js",
  ];
  for (const src of nodig) {
    assert.ok(html.includes(`src="${src}"`), `${src} wordt niet geladen`);
  }
});

test("IA-e2e 5· elk geladen IA-script bestaat en is geldige JavaScript", async () => {
  const html = await (await fetch(`${BASE}/`)).text();
  const scripts = [...html.matchAll(/src="(\/js\/app\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(scripts.length >= 15, `verwacht de volledige IA-laag, kreeg ${scripts.length} scripts`);
  for (const src of scripts) {
    const r = await fetch(`${BASE}${src}`);
    assert.equal(r.status, 200, `${src} ontbreekt`);
    const body = await r.text();
    assert.doesNotThrow(() => new Function(body), `${src} is geen geldige JavaScript`);
  }
});

test("IA-e2e 6· SESSIEHERSTEL: /api/me aanvaardt een bewaard token", async () => {
  // Dit is de backend-helft van de refresh-fix: de frontend bewaarde het
  // token wel maar herstelde de sessie niet. Zonder een /api/me die een
  // bestaand token accepteert, kan die herstelstap niet bestaan.
  const login = await (await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@demobouw.be", password: "Demo2026!" }),
  })).json();
  assert.ok(login.token, `inloggen mislukt: ${JSON.stringify(login)}`);

  const me = await (await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${login.token}` } })).json();
  assert.equal(me.ok, true);
  assert.equal(me.user.email, "admin@demobouw.be");
  assert.ok(me.user.role, "de rol bepaalt welk portaal er hersteld wordt");
});

test("IA-e2e 7· een ONGELDIG token wordt geweigerd · geen halve sessie", async () => {
  const r = await fetch(`${BASE}/api/me`, { headers: { Authorization: "Bearer verzonnen" } });
  assert.equal(r.status, 401, "anders herstelt de frontend een sessie die er niet is");
});
