#!/usr/bin/env node
"use strict";

// ── DoD #10 · Executing evidence-job: de testsuite is groen ───────────────────
// CTO-regel: bewijs = de OUTPUT van een draaiende job. Deze job leest de
// uitvoer van de (zojuist gedraaide) suite - of draait ze zelf - en schrijft
// docs/traceability/evidence/test-suite.json (evidenceType "test-suite"),
// commit-gebonden aan HEAD. status=pass enkel als er GEEN falende tests zijn,
// er echt tests draaiden, én er - met DATABASE_URL gezet - geen db-tests stil
// werden overgeslagen. Zo opent dit DoD-criterium tests_pass eerlijk.
//
// Gebruik:
//   node scripts/check-tests.js [pad/naar/test-output.txt]
// Zonder pad draait de job zelf `npm test` (lokaal handig).

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const { makeEvidence } = require("../src/modules/evidence");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "traceability", "evidence", "test-suite.json");

function commitSha() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); }
  catch (_) { return (process.env.GITHUB_SHA || "unknown").slice(0, 12); }
}

// Parse de node:test-samenvatting (regels als "ℹ pass 1053" / "ℹ fail 0").
function parseCounts(text) {
  const counts = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^[^A-Za-z0-9]*\s*(tests|pass|fail|skipped|cancelled|todo)\s+(\d+)$/);
    if (m) counts[m[1]] = Number(m[2]); // laatste voorkomen wint (de eindsamenvatting)
  }
  return counts;
}

function main() {
  const fileArg = process.argv[2];
  let text;
  if (fileArg) {
    if (!fs.existsSync(fileArg)) { console.error(`check-tests: outputbestand niet gevonden: ${fileArg}`); process.exit(1); }
    text = fs.readFileSync(fileArg, "utf8");
  } else {
    // Zelf draaien (lokaal). CI geeft het reeds getee'de bestand mee.
    const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["test"], { cwd: ROOT, encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
    text = (r.stdout || "") + (r.stderr || "");
  }

  const counts = parseCounts(text);
  const failures = [];
  if (counts.pass == null || counts.fail == null) failures.push({ reason: "kon test-samenvatting niet lezen" });
  if ((counts.fail || 0) > 0) failures.push({ reason: `${counts.fail} falende test(s)` });
  if ((counts.pass || 0) <= 0) failures.push({ reason: "geen enkele test draaide" });
  // Met een echte database mogen db-/opslagtests niet stil zijn overgeslagen.
  if (process.env.DATABASE_URL && /DATABASE_URL niet gezet/.test(text)) failures.push({ reason: "db-tests overgeslagen terwijl DATABASE_URL gezet is" });

  const status = failures.length === 0 ? "pass" : "fail";
  const ev = makeEvidence({
    evidenceType: "test-suite",
    status,
    commitSha: commitSha(),
    branch: process.env.GITHUB_REF_NAME || null,
    environment: process.env.DATABASE_URL ? "ci-postgres" : "local",
    executedBy: process.env.GITHUB_ACTIONS ? "ci" : "local",
    counts: { tests: counts.tests || 0, pass: counts.pass || 0, fail: counts.fail || 0, skipped: counts.skipped || 0 },
    failures,
    result: status === "pass" ? `${counts.pass} tests groen, 0 falend` : "testsuite niet groen",
  });
  ev.generatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(ev, null, 2) + "\n");
  console.log(`test-suite evidence → ${path.relative(ROOT, OUT)} · status=${status} · pass=${counts.pass || 0} fail=${counts.fail || 0} · commit=${ev.commitSha}`);
  if (status !== "pass") { console.error("::error::testsuite is niet groen"); process.exit(1); }
}

main();
