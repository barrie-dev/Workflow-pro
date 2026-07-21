#!/usr/bin/env node
"use strict";
/**
 * End-to-end-runner (h51 · teststrategie).
 *
 *   npm run test:e2e                → alle smokes
 *   npm run test:e2e -- catalog     → alleen smokes met "catalog" in de naam
 *
 * Elke smoke krijgt een VERSE server met een eigen tijdelijk databestand:
 *  - geen datavervuiling tussen scenario's;
 *  - de rate-limiter (in-memory per proces) reset mee, dus opeenvolgende
 *    smokes lopen niet tegen 429 aan · dat gebeurde toen alles tegen één
 *    server draaide;
 *  - een crash in de ene smoke laat de volgende onaangetast.
 *
 * De smokes zelf zijn standalone Node-scripts die tegen http://localhost:4299
 * praten en met exitcode ≠ 0 falen. Zie test/e2e/README.md voor de mapping op
 * de negen verplichte scenario's uit h51.1.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const E2E_DIR = path.join(ROOT, "test", "e2e");
const PORT = process.env.E2E_PORT || "4299";
const filter = (process.argv[2] || "").toLowerCase();

function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      http.get(`http://localhost:${PORT}/api/health`, res => {
        if (res.statusCode === 200) return resolve();
        res.resume();
        Date.now() < deadline ? setTimeout(poll, 400) : reject(new Error("health bleef niet-200"));
      }).on("error", () => (Date.now() < deadline ? setTimeout(poll, 400) : reject(new Error("server kwam niet op"))));
    };
    poll();
  });
}

function run(cmd, args, opts) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { ...opts, shell: false });
    let out = "";
    child.stdout.on("data", d => { out += d; });
    child.stderr.on("data", d => { out += d; });
    child.on("close", code => resolve({ code, out }));
  });
}

async function main() {
  const smokes = fs.readdirSync(E2E_DIR)
    .filter(f => f.endsWith("-smoke.js"))
    .filter(f => !filter || f.toLowerCase().includes(filter))
    .sort();
  if (!smokes.length) { console.error(`Geen smokes gevonden${filter ? ` voor filter '${filter}'` : ""}.`); process.exit(2); }

  const results = [];
  for (const smoke of smokes) {
    // Verse dataset per scenario.
    const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mona-e2e-")), "data.json");
    const server = spawn(process.execPath, [path.join(ROOT, "src", "server.js")], {
      env: {
        ...process.env,
        PORT, NODE_ENV: "development",
        STORAGE_ADAPTER: "json",
        WORKFLOWPRO_DATA_FILE: dataFile,
        // Een verse seed genereert standaard een WILLEKEURIG admin-wachtwoord
        // (veilig gedrag). De smokes loggen in met het demo-wachtwoord, dus de
        // runner zet het expliciet · alleen hier, nooit in een echte omgeving.
        WORKFLOWPRO_INITIAL_ADMIN_PASSWORD: "Demo2026!",
        // MFA expliciet UIT voor de smokes · anders geeft assertAdminMfa 403 op
        // elke admin/superadmin-schrijfactie. We pinnen dit hier zodat de suite
        // deterministisch is, ongeacht of de lokale .env het zet (CI heeft geen
        // .env → zonder deze pin faalt bijna elke smoke). Nooit in een echte
        // omgeving; daar blijft MFA verplicht.
        REQUIRE_ADMIN_MFA: "false",
        // De webhook-smoke draait een lokale self-signed https-ontvanger.
        NODE_TLS_REJECT_UNAUTHORIZED: smoke.startsWith("webhook") ? "0" : process.env.NODE_TLS_REJECT_UNAUTHORIZED || "1",
      },
      stdio: "ignore",
    });
    let result;
    try {
      await waitForHealth();
      const started = Date.now();
      const r = await run(process.execPath, [path.join(E2E_DIR, smoke)], { cwd: ROOT, env: { ...process.env } });
      result = { smoke, ok: r.code === 0, ms: Date.now() - started, out: r.out };
    } catch (err) {
      result = { smoke, ok: false, ms: 0, out: String(err.message) };
    } finally {
      server.kill();
      fs.rmSync(path.dirname(dataFile), { recursive: true, force: true });
    }
    results.push(result);
    console.log(`${result.ok ? "✔" : "✖"} ${smoke} (${result.ms}ms)`);
    if (!result.ok) console.log(result.out.split("\n").map(l => `    ${l}`).join("\n"));
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} scenario's groen`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(err => { console.error(err.message); process.exit(1); });
