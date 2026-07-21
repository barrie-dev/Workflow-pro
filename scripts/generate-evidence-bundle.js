#!/usr/bin/env node
"use strict";
/**
 * Go-live evidence bundle (CTO P0-10).
 *
 * Eén commando dat per release een controleerbaar bewijsdossier maakt:
 * welke commit, welke testresultaten, welke migraties, welke adapters, welke
 * gates. Bedoeld voor de go/no-go-beslissing en voor audits achteraf: het
 * dossier staat in docs/evidence/ en wordt mee gecommit, zodat elk oordeel
 * herleidbaar is naar de exacte code en het exacte bewijs van dat moment.
 *
 *   node scripts/generate-evidence-bundle.js             → volledige run (incl. tests)
 *   node scripts/generate-evidence-bundle.js --no-tests  → alleen verzamelen (snel)
 *
 * Platformonafhankelijk by design: het script kijkt naar het protocol
 * (git, npm test, migratiebestanden, envs), nooit naar een aanbieder.
 */

const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const skipTests = process.argv.includes("--no-tests");

function sh(cmd) {
  try { return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch (_) { return ""; }
}

/** Laatste voorkomen van een node:test-telling in de uitvoer. */
function lastCount(out, label) {
  const matches = [...out.matchAll(new RegExp(`\\u2139 ${label} (\\d+)`, "g"))];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}

// ── 1. Herkomst: exact welke code dit bewijs dekt ───────────────────────────
const sha = sh("git rev-parse HEAD") || "onbekend";
const bundle = {
  generatedAt: new Date().toISOString(),
  commit: { sha, branch: sh("git rev-parse --abbrev-ref HEAD") || "onbekend",
    dirty: !!sh("git status --porcelain"),
    subject: sh("git log -1 --pretty=%s") },
  runtime: { node: process.version, platform: process.platform },
};
if (bundle.commit.dirty) {
  console.warn("LET OP: de werkmap bevat niet-gecommitte wijzigingen · dit bewijs dekt ze niet.");
}

// ── 2. Tests: de suite draait ECHT, de telling komt uit de runner zelf ──────
if (skipTests) {
  bundle.tests = { ran: false, reason: "--no-tests meegegeven" };
} else {
  console.log("Testsuite draait (dit duurt even) ...");
  // De suite beheert haar EIGEN adapters; omgevingspostuur (STORAGE_ADAPTER,
  // OBJECT_STORAGE_*, APP_ENV, CRM_READ_SOURCE) hoort in het rapport, niet in
  // de testrun. Test-specifieke variabelen (DATABASE_URL, S3_TEST_*) blijven
  // wél staan: die schakelen de live-bewijzen in.
  const testEnv = { ...process.env };
  for (const k of Object.keys(testEnv)) {
    if (/^(STORAGE_ADAPTER|OBJECT_STORAGE_|APP_ENV$|CRM_READ_SOURCE$)/.test(k)) delete testEnv[k];
  }
  const run = spawnSync("npm", ["test"], {
    cwd: ROOT, encoding: "utf8", shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024, env: testEnv,
  });
  const out = `${run.stdout || ""}\n${run.stderr || ""}`;
  bundle.tests = {
    ran: true,
    exitCode: run.status,
    total: lastCount(out, "tests"),
    pass: lastCount(out, "pass"),
    fail: lastCount(out, "fail"),
    skipped: lastCount(out, "skipped"),
    databaseTestsIncluded: !/DATABASE_URL niet gezet/.test(out),
    objectStorageTestsIncluded: !/S3_TEST_ENDPOINT niet gezet/.test(out),
    blobStorageTestsIncluded: !/AZURE_TEST_ENDPOINT niet gezet/.test(out),
  };
}

// ── 3. Migraties: wat er in de repo staat en (indien bereikbaar) in de db ───
const migrationDir = path.join(ROOT, "migrations", "sql");
const migrationFiles = fs.existsSync(migrationDir)
  ? fs.readdirSync(migrationDir).filter(f => f.endsWith(".sql")).sort() : [];
bundle.migrations = { files: migrationFiles, count: migrationFiles.length, database: null };
if (process.env.DATABASE_URL) {
  const st = spawnSync(process.execPath, ["scripts/run-migrations.js", "--status", "--json"],
    { cwd: ROOT, encoding: "utf8", env: process.env });
  try {
    const parsed = JSON.parse(st.stdout);
    bundle.migrations.database = { applied: parsed.applied.length, pending: parsed.pending, total: parsed.total };
  } catch (_) { bundle.migrations.database = { error: "status niet leesbaar" }; }
}

// ── 4. Configuratiepostuur: welke adapters deze omgeving draait ─────────────
bundle.posture = {
  appEnv: process.env.APP_ENV || "development",
  storageAdapter: process.env.STORAGE_ADAPTER || "(standaard)",
  objectStorageAdapter: process.env.OBJECT_STORAGE_ADAPTER || "local",
  crmReadSource: process.env.CRM_READ_SOURCE || "(standaard)",
  databaseConfigured: !!process.env.DATABASE_URL,
};

// ── 5. Gates en artefacten die het productiepad dragen ──────────────────────
const artifacts = [
  "Dockerfile", "docker-compose.yml", ".github/workflows/ci.yml", "render.yaml",
  "docs/RUNBOOK.md", "docs/DEPLOY-RUNBOOK.md", "docs/PERFORMANCE-BASELINE.md",
  "docs/LIVE-SECURITY-CHECKLIST.md", "migrations/sql",
];
bundle.artifacts = Object.fromEntries(artifacts.map(a => [a, fs.existsSync(path.join(ROOT, a))]));

// ── 6. Wegschrijven: json (machine) + md (mens), per commit herleidbaar ─────
const outDir = path.join(ROOT, "docs", "evidence");
fs.mkdirSync(outDir, { recursive: true });
const stamp = bundle.generatedAt.slice(0, 10).replace(/-/g, "");
const base = `evidence-${stamp}-${sha.slice(0, 7)}`;
fs.writeFileSync(path.join(outDir, `${base}.json`), JSON.stringify(bundle, null, 2));

const t = bundle.tests;
const md = [
  `# Go-live evidence bundle · ${bundle.generatedAt.slice(0, 10)}`,
  "",
  `- **Commit**: \`${sha.slice(0, 12)}\` (${bundle.commit.branch}) · ${bundle.commit.subject}${bundle.commit.dirty ? " · **LET OP: werkmap was niet schoon**" : ""}`,
  `- **Runtime**: Node ${bundle.runtime.node}`,
  "",
  "## Tests",
  t.ran
    ? `- ${t.pass}/${t.total} geslaagd, ${t.fail} gefaald, ${t.skipped} overgeslagen (exit ${t.exitCode})\n- Database-integratietests meegedraaid: ${t.databaseTestsIncluded ? "ja" : "NEE (geen DATABASE_URL)"}\n- Objectopslag-livetests (s3-compatibel) meegedraaid: ${t.objectStorageTestsIncluded ? "ja" : "NEE (geen S3_TEST_ENDPOINT)"}\n- Blob-opslag-livetests (Azure-pad) meegedraaid: ${t.blobStorageTestsIncluded ? "ja" : "NEE (geen AZURE_TEST_ENDPOINT)"}`
    : `- Niet gedraaid (${t.reason})`,
  "",
  "## Migraties",
  `- ${bundle.migrations.count} migratiebestanden in de repo`,
  bundle.migrations.database
    ? `- Database: ${bundle.migrations.database.applied}/${bundle.migrations.database.total} toegepast, openstaand: ${(bundle.migrations.database.pending || []).length ? bundle.migrations.database.pending.join(", ") : "geen"}`
    : "- Database: niet gecontroleerd (geen DATABASE_URL in deze omgeving)",
  "",
  "## Configuratiepostuur",
  ...Object.entries(bundle.posture).map(([k, v]) => `- ${k}: ${v}`),
  "",
  "## Productiepad-artefacten",
  ...Object.entries(bundle.artifacts).map(([a, ok]) => `- ${ok ? "aanwezig" : "**ONTBREEKT**"} · ${a}`),
  "",
].join("\n");
fs.writeFileSync(path.join(outDir, `${base}.md`), md);

console.log(JSON.stringify({
  ok: !t.ran || t.exitCode === 0,
  bundle: path.join("docs", "evidence", `${base}.md`),
  tests: t.ran ? `${t.pass}/${t.total} (fail ${t.fail})` : "overgeslagen",
}, null, 2));
process.exit(t.ran && t.exitCode !== 0 ? 1 : 0);
