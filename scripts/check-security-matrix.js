#!/usr/bin/env node
"use strict";

// ── DoD #11 · Executing evidence-job: tenant-isolatie-matrix ──────────────────
// CTO-regel: bewijs = de OUTPUT van een draaiende job, geen dun briefje. Deze
// job bewijst tenant-isolatie op VIER lagen (defense in depth) tegen een echte
// PostgreSQL + een echte server, en schrijft docs/traceability/evidence/
// security-matrix.json (evidenceType "security-matrix"), commit-gebonden.
//
//   A. Database (RLS)   · elke kern-tenanttabel heeft row level security AAN
//                         én een *_isolation-policy op current_setting('app.tenant_id').
//   B. Repository       · de pg-integratietests (CRM/identity/company/finance)
//                         bewijzen dat cross-tenant lezen/schrijven faalt.
//   C. Policy-engine    · de policy/roles-unittests bewijzen scope + tenant-veiligheid.
//   D. HTTP/API         · policy-smoke bewijst IDOR-fix, team-scope en redactie
//                         tegen de draaiende server.
//
// Eén laag rood → status=fail → exit 1 (CI faalt). Vereist DATABASE_URL.

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, spawnSync, execSync } = require("child_process");
const { Pool } = require("pg");
const { makeEvidence } = require("../src/modules/evidence");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "traceability", "evidence", "security-matrix.json");
const PORT = process.env.E2E_PORT || "4299";

// Kern-tenanttabellen die RLS-geïsoleerd MOETEN zijn (uitbreiden = strenger).
const RLS_TABLES = [
  "tenants", "users", "companies", "customers", "customer_contacts", "customer_addresses",
  "invoices", "invoice_lines", "payments", "payment_allocations", "number_sequences",
];

function commitSha() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); }
  catch (_) { return (process.env.GITHUB_SHA || "unknown").slice(0, 12); }
}

// Draai node:test over bestanden en lees de samenvatting (pass/fail).
function runTests(files) {
  const r = spawnSync(process.execPath, ["--test", ...files], { cwd: ROOT, encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
  const text = (r.stdout || "") + (r.stderr || "");
  const counts = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^[^A-Za-z0-9]*\s*(tests|pass|fail)\s+(\d+)$/);
    if (m) counts[m[1]] = Number(m[2]);
  }
  return { ok: (counts.fail === 0) && (counts.pass > 0), counts };
}

function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => http.get(`http://localhost:${PORT}/api/health`, res => {
      if (res.statusCode === 200) return resolve();
      res.resume(); Date.now() < deadline ? setTimeout(poll, 400) : reject(new Error("health"));
    }).on("error", () => (Date.now() < deadline ? setTimeout(poll, 400) : reject(new Error("server"))));
    poll();
  });
}

async function runSmoke(smoke) {
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mona-sec-")), "data.json");
  const env = { ...process.env, PORT, NODE_ENV: "development", STORAGE_ADAPTER: "json", WORKFLOWPRO_DATA_FILE: dataFile, WORKFLOWPRO_INITIAL_ADMIN_PASSWORD: "Demo2026!", REQUIRE_ADMIN_MFA: "false" };
  delete env.DATABASE_URL;
  const server = spawn(process.execPath, [path.join(ROOT, "src", "server.js")], { env, stdio: "ignore" });
  try {
    await waitForHealth();
    const r = spawnSync(process.execPath, [path.join(ROOT, "test", "e2e", smoke)], { cwd: ROOT, encoding: "utf8", env: process.env });
    return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
  } catch (e) { return { ok: false, out: String(e.message) }; }
  finally { server.kill(); fs.rmSync(path.dirname(dataFile), { recursive: true, force: true }); }
}

async function checkRls(pool) {
  const { rows } = await pool.query(
    `SELECT t.tablename, c.relrowsecurity AS rls,
            EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = t.tablename AND p.policyname = t.tablename || '_isolation') AS iso
       FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename
      WHERE t.schemaname = 'public' AND t.tablename = ANY($1)`, [RLS_TABLES]);
  const byTable = new Map(rows.map(r => [r.tablename, r]));
  const missing = [];
  for (const tbl of RLS_TABLES) {
    const r = byTable.get(tbl);
    if (!r || r.rls !== true || r.iso !== true) missing.push(tbl);
  }
  return { ok: missing.length === 0, checked: RLS_TABLES.length, missing };
}

async function main() {
  const LIVE = process.env.DATABASE_URL || "";
  if (!LIVE || !/^postgres/.test(LIVE)) {
    console.error("check-security-matrix: DATABASE_URL ontbreekt · de isolatie-matrix vereist een echte PostgreSQL.");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: LIVE, ssl: /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false }, max: 2 });

  const dimensions = {};
  try {
    console.log("A · database RLS ...");
    dimensions.db_rls = await checkRls(pool);
    console.log(`  ${dimensions.db_rls.ok ? "✓" : "✗"} RLS op ${dimensions.db_rls.checked} kern-tabellen${dimensions.db_rls.missing.length ? " · mist: " + dimensions.db_rls.missing.join(", ") : ""}`);
  } finally { await pool.end(); }

  console.log("B · repository cross-tenant (pg-integratietests) ...");
  dimensions.repository = runTests(["test/pg-crm.test.js", "test/pg-identity.test.js", "test/pg-company.test.js", "test/pg-finance.test.js"]);
  console.log(`  ${dimensions.repository.ok ? "✓" : "✗"} ${JSON.stringify(dimensions.repository.counts)}`);

  console.log("C · policy-engine (scope + tenant-veilig) ...");
  dimensions.policy_engine = runTests(["test/policy.test.js", "test/roles.test.js"]);
  console.log(`  ${dimensions.policy_engine.ok ? "✓" : "✗"} ${JSON.stringify(dimensions.policy_engine.counts)}`);

  console.log("D · HTTP/API (policy-smoke: IDOR + team-scope + redactie) ...");
  const smoke = await runSmoke("policy-smoke.js");
  dimensions.http_api = { ok: smoke.ok };
  console.log(`  ${smoke.ok ? "✓" : "✗"} policy-smoke`);
  if (!smoke.ok) console.log(smoke.out.split("\n").slice(-10).map(l => "      " + l).join("\n"));

  const failed = Object.entries(dimensions).filter(([, v]) => !v.ok).map(([k]) => k);
  const status = failed.length === 0 ? "pass" : "fail";
  const ev = makeEvidence({
    evidenceType: "security-matrix",
    status,
    commitSha: commitSha(),
    branch: process.env.GITHUB_REF_NAME || null,
    environment: "ci-postgres",
    executedBy: process.env.GITHUB_ACTIONS ? "ci" : "local",
    counts: { dimensions: Object.keys(dimensions).length, passed: Object.values(dimensions).filter(v => v.ok).length, rlsTables: RLS_TABLES.length },
    failures: failed.map(k => ({ dimension: k, detail: dimensions[k] })),
    result: status === "pass" ? "tenant-isolatie bewezen op DB/RLS + repository + policy-engine + HTTP" : `isolatie NIET sluitend: ${failed.join(", ")}`,
  });
  ev.dimensions = dimensions;
  ev.generatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(ev, null, 2) + "\n");
  console.log(`\nsecurity-matrix → ${path.relative(ROOT, OUT)} · status=${status} · lagen ${ev.counts.passed}/${ev.counts.dimensions} · commit=${ev.commitSha}`);
  if (status !== "pass") { console.error(`::error::tenant-isolatie niet sluitend (${failed.join(", ")})`); process.exit(1); }
  console.log("Tenant-isolatie sluitend op alle vier de lagen.");
}

main().catch((e) => { console.error(e); process.exit(1); });
