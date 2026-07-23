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
  // CTO3-04: elk van scenario 3/6/7/8/9 is nu ÉÉN doorlopende keten (positieve
  // output + negatieve autorisatie + idempotentie + audit + teruglezing), niet
  // langer een verzameling losse route-smokes.
  { n: 3, title: "Offline werkbon met materiaal + handtekening + dubbel queue-item", smokes: ["offline-workorder-chain-smoke.js"], fullChain: true },
  { n: 4, title: "Servicecontract → onderhoudsbeurt → assethistoriek → facturatie", smokes: ["contracts-smoke.js", "assets-smoke.js"], fullChain: true },
  { n: 5, title: "Inkooporder deelontvangst + projectverplichting zonder dubbele kost", smokes: ["proc-smoke.js"], fullChain: true },
  { n: 6, title: "Factuurnummering + UBL-reconciliatie + Peppol-fout/retry + één billable event", smokes: ["peppol-billing-chain-smoke.js"], fullChain: true },
  { n: 7, title: "Cross-tenant aanvalsmatrix: lezen/wijzigen/exporteren/attachments/transitions", smokes: ["cross-tenant-chain-smoke.js"], fullChain: true },
  { n: 8, title: "Veldrechtketen: verborgen kostprijs in UI, API, export, zoeken, rapport, Mona", smokes: ["field-rights-chain-smoke.js"], fullChain: true },
  { n: 9, title: "Legacy-import → external IDs → attachments → operationeel record", smokes: ["legacy-import-chain-smoke.js"], fullChain: true },
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

// ── CTO3-04 · restart-persistentie ("scenario's overleven een containerrestart
// waar persistentie relevant is"). Echt bewijs: schrijf records, stop de server
// NET (SIGTERM · de shutdownflush landt), start OPNIEUW tegen HETZELFDE
// databestand en lees de records terug. Geen store.data-truc · alles via HTTP.
async function api(method, pathname, body, token) {
  const r = await fetch(`http://localhost:${PORT}${pathname}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({}));
}
function gracefulStop(server) {
  return new Promise(resolve => {
    if (!server || server.exitCode !== null) return resolve();
    server.once("exit", () => resolve());
    try { server.kill("SIGTERM"); } catch (_) {}
    setTimeout(() => { try { server.kill("SIGKILL"); } catch (_) {} resolve(); }, 8000).unref();
  });
}
async function proveRestartPersistence() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mona-e2e-restart-"));
  const dataFile = path.join(dir, "data.json");
  const env = { ...process.env, PORT, NODE_ENV: "development", STORAGE_ADAPTER: "json", WORKFLOWPRO_DATA_FILE: dataFile, WORKFLOWPRO_INITIAL_ADMIN_PASSWORD: "Demo2026!", REQUIRE_ADMIN_MFA: "false" };
  delete env.DATABASE_URL;
  const boot = () => spawn(process.execPath, [path.join(ROOT, "src", "server.js")], { env, stdio: "ignore" });
  const out = { proven: false };
  let server = boot();
  try {
    await waitForHealth();
    const tok = (await api("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" })).token;
    const tid = (await api("GET", "/api/me", null, tok)).user.tenantId;
    const cust = (await api("POST", `/api/tenants/${tid}/customers`, { name: "Restart Bewijs BV", email: "restart@x.be" }, tok)).customer;
    const wo = (await api("POST", `/api/tenants/${tid}/workorders`, { title: "Restart WO", date: "2026-09-20" }, tok)).workorder;
    out.tid = tid; out.custId = cust && cust.id; out.woNumber = wo && wo.number;
  } finally { await gracefulStop(server); }
  await new Promise(r => setTimeout(r, 500));
  server = boot();
  try {
    await waitForHealth();
    const tok = (await api("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" })).token;
    const custs = (await api("GET", `/api/tenants/${out.tid}/customers`, null, tok)).customers || [];
    const wos = (await api("GET", `/api/tenants/${out.tid}/workorders`, null, tok)).workorders || [];
    out.customerSurvived = custs.some(c => c.id === out.custId);
    out.workorderSurvived = wos.some(w => w.number === out.woNumber);
    out.proven = out.customerSurvived && out.workorderSurvived;
  } finally { await gracefulStop(server); fs.rmSync(dir, { recursive: true, force: true }); }
  return out;
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

  // CTO3-04 · restart-persistentie: één echt server-restartbewijs (records
  // overleven een stop+herstart tegen hetzelfde databestand).
  let restart = { proven: false };
  try { restart = await proveRestartPersistence(); }
  catch (e) { restart = { proven: false, error: e.message }; }
  console.log(`  ${restart.proven ? "✔" : "✖"} restart-persistentie (records overleven stop+herstart)`);
  if (!restart.proven) failures.push({ scenario: "restart", title: "restart-persistentie", detail: restart.error || `customer=${restart.customerSurvived} workorder=${restart.workorderSurvived}` });
  // Ketenstatus is metadata, geen smoke-regressie; markeer het maar laat het de
  // job niet 'falen' als de smokes zelf groen zijn.
  const partial = scenarios.filter(s => !s.fullChain).map(s => s.n);

  const status = allGreen && allFull && restart.proven ? "pass" : "fail";
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
      ? (allFull ? (restart.proven ? "9 verplichte scenario's groen ÉN als keten bewezen, restart-persistentie bewezen" : "9 scenario's als keten groen, maar restart-persistentie niet bewezen") : `alle scenario-smokes groen; nog ${partial.length} scenario('s) per schakel i.p.v. één keten (${partial.join(",")})`)
      : "één of meer verplichte scenario's rood",
  });
  ev.scenarios = scenarios; // volledige mapping meeschrijven voor transparantie
  ev.restartPersistence = restart;
  ev.generatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(ev, null, 2) + "\n");

  console.log(`\ne2e-manifest → ${path.relative(ROOT, OUT)} · status=${status} · groen=${scenarios.filter(s => s.green).length}/9 · keten=${scenarios.filter(s => s.fullChain).length}/9 · restart=${restart.proven ? "ok" : "fout"} · commit=${ev.commitSha}`);
  if (!allGreen) { console.error("::error::niet alle verplichte E2E-scenario's zijn groen"); process.exit(1); }
  if (!allFull) { console.error(`::error::niet alle scenario's zijn als één keten bewezen (per schakel: ${partial.join(", ")})`); process.exit(1); }
  if (!restart.proven) { console.error("::error::restart-persistentie niet bewezen (records overleefden de herstart niet)"); process.exit(1); }
  console.log("Alle negen verplichte scenario's groen én als keten bewezen · restart-persistentie bewezen.");
}

main().catch((e) => { console.error(e); process.exit(1); });
