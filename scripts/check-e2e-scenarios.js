#!/usr/bin/env node
"use strict";

// ── DEV-02 · Executing evidence-job: de 9 verplichte E2E-scenario's (h51.1) ───
// CTO-regel: bewijs = de OUTPUT van een draaiende job. Deze job start per smoke
// een VERSE server (eigen dataset) en draait de smokes die de negen verplichte
// horizontale scenario's dekken. Elke smoke faalt met exitcode ≠ 0; één rode
// smoke → exit 1 (CI faalt). Schrijft docs/traceability/evidence/
// e2e-scenarios.json (evidenceType "e2e-manifest"), commit-gebonden aan HEAD.
//
// EERLIJKHEID (geen vals-groen): het artefact markeert per scenario of het als
// ÉÉN doorlopende keten bewezen is (fullChain) dan wel per schakel. status=pass
// vereist dat ALLE smokes groen zijn ÉN alle negen scenario's fullChain zijn.
// Zolang scenario's alleen per schakel bewezen zijn, blijft het manifest 'fail'
// en blijft R1.horizontal_e2e (terecht) rood - maar de smokes draaien wél echt.

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { execSync } = require("child_process");
const { makeEvidence } = require("../src/modules/evidence");

const ROOT = path.join(__dirname, "..");
const E2E_DIR = path.join(ROOT, "test", "e2e");
const OUT = path.join(ROOT, "docs", "traceability", "evidence", "e2e-scenarios.json");
const PORT = process.env.E2E_PORT || "4299";

// De negen verplichte scenario's (h51.1) → dekkende smokes + ketenstatus.
const SCENARIOS = [
  { n: 1, title: "Offerte → project → planning → werkbon → factuur → marge", smokes: ["chain-smoke.js"], fullChain: true },
  { n: 2, title: "Meerwerk met gedeeltelijke acceptatie + aparte factuurbron", smokes: ["construction-smoke.js", "claims-smoke.js"], fullChain: true },
  { n: 3, title: "Offline werkbon met materiaal + handtekening + dubbel queue-item", smokes: ["workorder-smoke.js", "mobile-offline-smoke.js"], fullChain: false },
  { n: 4, title: "Servicecontract → onderhoudsbeurt → assethistoriek → facturatie", smokes: ["contracts-smoke.js", "assets-smoke.js"], fullChain: true },
  { n: 5, title: "Inkooporder deelontvangst + projectverplichting zonder dubbele kost", smokes: ["proc-smoke.js"], fullChain: true },
  { n: 6, title: "Factuurnummering + UBL-reconciliatie + Peppol-fout/retry", smokes: ["credit-smoke.js", "finance-smoke.js", "reconciliation-smoke.js"], fullChain: false },
  { n: 7, title: "Tenant A probeert elk pad naar data van tenant B", smokes: ["policy-smoke.js"], fullChain: false },
  { n: 8, title: "Rol zonder kostprijsrecht: UI, API, export, zoeken, Mona", smokes: ["roles-smoke.js", "policy-smoke.js", "grid-smoke.js", "signals-smoke.js"], fullChain: false },
  { n: 9, title: "Legacy-migratie klant/project/werkbon met external ID + bestanden", smokes: ["robaws-smoke.js"], fullChain: false },
];

function commitSha() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); }
  catch (_) { return (process.env.GITHUB_SHA || "unknown").slice(0, 12); }
}

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

function runNode(file, extraEnv) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [file], { cwd: ROOT, env: { ...process.env, ...extraEnv }, shell: false });
    let out = "";
    child.stdout.on("data", d => { out += d; });
    child.stderr.on("data", d => { out += d; });
    child.on("close", code => resolve({ code, out }));
  });
}

// Draait één smoke tegen een VERSE server met eigen dataset (identiek aan run-e2e.js).
async function runSmoke(smoke) {
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mona-e2ev-")), "data.json");
  // De smoke-server draait PUUR op de json-adapter met een eigen dataset.
  // DATABASE_URL wordt bewust gestript: in de test-job staat die (echte pg),
  // maar de smokes mogen daar niet naartoe schrijven · STORAGE_ADAPTER=json wint.
  const serverEnv = {
    ...process.env, PORT, NODE_ENV: "development", STORAGE_ADAPTER: "json",
    WORKFLOWPRO_DATA_FILE: dataFile, WORKFLOWPRO_INITIAL_ADMIN_PASSWORD: "Demo2026!",
    REQUIRE_ADMIN_MFA: "false",
    NODE_TLS_REJECT_UNAUTHORIZED: smoke.startsWith("webhook") ? "0" : (process.env.NODE_TLS_REJECT_UNAUTHORIZED || "1"),
  };
  delete serverEnv.DATABASE_URL;
  const server = spawn(process.execPath, [path.join(ROOT, "src", "server.js")], { env: serverEnv, stdio: "ignore" });
  try {
    await waitForHealth();
    const r = await runNode(path.join(E2E_DIR, smoke), {});
    return { smoke, ok: r.code === 0, out: r.out };
  } catch (err) {
    return { smoke, ok: false, out: String(err.message) };
  } finally {
    server.kill();
    fs.rmSync(path.dirname(dataFile), { recursive: true, force: true });
  }
}

async function main() {
  // Unieke smokes over alle scenario's (elke smoke één keer draaien).
  const unique = [...new Set(SCENARIOS.flatMap(s => s.smokes))];
  for (const s of unique) {
    if (!fs.existsSync(path.join(E2E_DIR, s))) { console.error(`::error::ontbrekende smoke: ${s}`); process.exit(1); }
  }

  const smokeResult = {};
  for (const smoke of unique) {
    const r = await runSmoke(smoke);
    smokeResult[smoke] = r.ok;
    console.log(`  ${r.ok ? "✔" : "✖"} ${smoke}`);
    if (!r.ok) console.log(r.out.split("\n").slice(-12).map(l => `      ${l}`).join("\n"));
  }

  const scenarios = SCENARIOS.map(s => ({
    n: s.n, title: s.title, smokes: s.smokes, fullChain: s.fullChain,
    green: s.smokes.every(sm => smokeResult[sm] === true),
  }));
  const allGreen = scenarios.every(s => s.green);
  const allFull = scenarios.every(s => s.fullChain);
  const failures = [];
  for (const s of scenarios) if (!s.green) failures.push({ scenario: s.n, title: s.title, redSmokes: s.smokes.filter(sm => !smokeResult[sm]) });
  // Ketenstatus is metadata, geen smoke-regressie; markeer het maar laat het de
  // job niet 'falen' als de smokes zelf groen zijn.
  const partial = scenarios.filter(s => !s.fullChain).map(s => s.n);

  const status = allGreen && allFull ? "pass" : "fail";
  const ev = makeEvidence({
    evidenceType: "e2e-manifest",
    status,
    commitSha: commitSha(),
    branch: process.env.GITHUB_REF_NAME || null,
    environment: "ci-e2e",
    executedBy: process.env.GITHUB_ACTIONS ? "ci" : "local",
    counts: { scenarios: scenarios.length, green: scenarios.filter(s => s.green).length, fullChain: scenarios.filter(s => s.fullChain).length, smokes: unique.length },
    failures,
    result: allGreen
      ? (allFull ? "9 verplichte scenario's groen ÉN als keten bewezen" : `alle scenario-smokes groen; nog ${partial.length} scenario('s) per schakel i.p.v. één keten (${partial.join(",")})`)
      : "één of meer verplichte scenario's rood",
  });
  ev.scenarios = scenarios; // volledige mapping meeschrijven voor transparantie
  ev.generatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(ev, null, 2) + "\n");

  console.log(`\ne2e-manifest → ${path.relative(ROOT, OUT)} · status=${status} · groen=${scenarios.filter(s => s.green).length}/9 · keten=${scenarios.filter(s => s.fullChain).length}/9 · commit=${ev.commitSha}`);
  if (!allGreen) { console.error("::error::niet alle verplichte E2E-scenario's zijn groen"); process.exit(1); }
  if (!allFull) console.log(`Alle scenario-smokes groen. Nog per schakel (niet als één keten): scenario ${partial.join(", ")}.`);
  else console.log("Alle negen verplichte scenario's groen én als keten bewezen.");
}

main().catch((e) => { console.error(e); process.exit(1); });
