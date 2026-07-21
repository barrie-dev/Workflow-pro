#!/usr/bin/env node
"use strict";

// ── DEV-03 · Executing evidence-job: read-cutover-reconciliatie per domein ────
// CTO-regel: bewijs = de OUTPUT van een draaiende job. Deze job laadt de ECHTE
// dataset, spiegelt elk genormaliseerd domein (identity, company, finance) naar
// PostgreSQL via de snapshot-lus, en bewijst daarna dat legacy-snapshot en
// pg-projectie SLUITEND zijn (beide richtingen, nul afwijkingen). CRM volgt zijn
// eigen backfill/reconcile-route. Alleen bij een sluitende reconciliatie schrijft
// hij docs/traceability/evidence/cutover-<domein>.json (evidenceType
// "cutover-reconcile"), commit-gebonden aan HEAD.
//
// Zelf een harde gate: elke openstaande afwijking → exit 1 (CI faalt). Draait in
// de test-job (echte pg). Zonder DATABASE_URL: exit 1 (kan niet stil overslaan).

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Pool } = require("pg");

const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
const { makeMigrationOrchestrator } = require("../src/infrastructure/migration-orchestrator");
const { makeIdentitySource } = require("../src/infrastructure/identity-source");
const { makeCompanySource } = require("../src/infrastructure/company-source");
const { makeFinanceSource } = require("../src/infrastructure/finance-source");
const { backfillCustomers, reconcileCustomers } = require("../src/infrastructure/postgres/crm-backfill");
const { makeEvidence } = require("../src/modules/evidence");

const ROOT = path.join(__dirname, "..");
const EVID_DIR = path.join(ROOT, "docs", "traceability", "evidence");
// R0 vereist identity/company/crm; R1 vereist finance. We bewijzen alle vier.
const R0_DOMAINS = ["identity", "company", "crm"];

// Representatieve CRM-fixture (wegwerp-tenant): oefent de verliesvrije projectie
// van contacts + addresses, meertaligheid en null-creditlimiet écht uit.
const CRM_FIXTURE_TENANT = "t_cutover_crm";
const CRM_FIXTURE = [
  {
    id: "cust_cut_1", name: "Bouwwerken De Meyer BV", email: "info@demeyer.be", vatNumber: "BE0123456789",
    status: "active", language: "nl", creditLimit: 5000, paymentTermsDays: 30,
    contacts: [{ id: "ct_cut_1_1", name: "Piet De Meyer", email: "piet@demeyer.be", phone: "+32470111222", role: "owner", isPrimary: true }],
    addresses: [
      { id: "ad_cut_1_1", type: "billing", line: "Industrieweg 12", zip: "9000", city: "Gent", country: "BE" },
      { id: "ad_cut_1_2", type: "site", line: "Werfstraat 3", zip: "9050", city: "Gentbrugge", country: "BE" },
    ],
  },
  {
    id: "cust_cut_2", name: "Sanitair Janssens", email: "contact@janssens.be", vatNumber: "BE0987654321",
    status: "prospect", language: "fr", creditLimit: null, paymentTermsDays: 14,
    contacts: [
      { id: "ct_cut_2_1", name: "Marie Janssens", email: "marie@janssens.be", phone: "+32470333444", role: "purchasing", isPrimary: true },
      { id: "ct_cut_2_2", name: "Luc Janssens", email: "luc@janssens.be", phone: "", role: "technical", isPrimary: false },
    ],
    addresses: [{ id: "ad_cut_2_1", type: "billing", line: "Rue Haute 45", zip: "1000", city: "Bruxelles", country: "BE" }],
  },
];

function commitSha() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); }
  catch (_) { return (process.env.GITHUB_SHA || "unknown").slice(0, 12); }
}

function writeEvidence(domain, status, counts, failures) {
  const ev = makeEvidence({
    evidenceType: "cutover-reconcile",
    status,
    commitSha: commitSha(),
    branch: process.env.GITHUB_REF_NAME || null,
    environment: "ci-postgres",
    executedBy: process.env.GITHUB_ACTIONS ? "ci" : "local",
    counts,
    failures,
    result: status === "pass"
      ? `read-cutover reconciliatie sluitend (${domain})`
      : `read-cutover reconciliatie NIET sluitend (${domain})`,
  });
  ev.generatedAt = new Date().toISOString();
  fs.mkdirSync(EVID_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVID_DIR, `cutover-${domain}.json`), JSON.stringify(ev, null, 2) + "\n");
  console.log(`  cutover-${domain}: status=${status} · ${JSON.stringify(counts)}`);
}

async function main() {
  const LIVE = process.env.DATABASE_URL || "";
  if (!LIVE || !/^postgres/.test(LIVE)) {
    console.error("check-cutover: DATABASE_URL ontbreekt · reconciliatie vereist een echte PostgreSQL.");
    process.exit(1);
  }

  // Legacybron: de dataset READ-ONLY inlezen (rauwe JSON). Bewust GEEN Store:
  // Store.initAsync migreert het schema en schrijft dat terug naar het bestand,
  // wat de gevolgde seed zou muteren. De reconciliatie leest alleen.
  const seedPath = process.env.WORKFLOWPRO_DATA_FILE || path.join(ROOT, "data", "workflowpro-fullstack.json");
  const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const store = { data: seed.data && typeof seed.data === "object" ? seed.data : seed };

  const pool = new Pool({ connectionString: LIVE, ssl: /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false }, max: 4 });
  await runMigrations(pool);

  const identitySource = makeIdentitySource({ mode: "shadow", store, pool });
  const companySource = makeCompanySource({ mode: "shadow", store, pool });
  const financeSource = makeFinanceSource({ mode: "shadow", store, pool });
  const orchestrator = makeMigrationOrchestrator({
    domains: [
      { name: "identity", source: identitySource },
      { name: "company", source: companySource, dependsOn: ["identity"] },
      { name: "finance", source: financeSource, dependsOn: ["identity", "company"] },
    ],
  });

  const results = {}; // domain → { ok, counts, failures }

  try {
    console.log("Reconciliatie identity/company/finance (sync-force → reconcile) ...");
    const rec = await orchestrator.reconcileAll();
    for (const domain of ["identity", "company", "finance"]) {
      const d = rec.domains[domain] || {};
      const failures = summarizeReconcile(d);
      results[domain] = { ok: d.ok === true, counts: reconcileCounts(d), failures };
    }

    // CRM · eigen backfill + reconcile per tenant (legacy-customers → pg). De
    // seed heeft mogelijk geen klanten; daarom voegen we een representatieve
    // fixture toe (contacts + addresses, meertalig, null-creditlimiet) onder een
    // eigen wegwerp-tenant, zodat de reconciliatie de verliesvrije projectie
    // écht uitoefent. reconcileCustomers levert readyForCutover (5.4 stap 6/7).
    console.log("Reconciliatie CRM (backfill → reconcile per tenant + fixture) ...");
    await pool.query("INSERT INTO tenants (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [CRM_FIXTURE_TENANT, "CRM Cutover Fixture"]);
    const crmTargets = [
      ...(store.data.tenants || []).map(t => ({ tenantId: t.id, customers: (store.data.customers || []).filter(c => c.tenantId === t.id) })),
      { tenantId: CRM_FIXTURE_TENANT, customers: CRM_FIXTURE },
    ];
    let crmLegacy = 0, crmPg = 0, crmMissing = 0, crmDiff = 0, crmExtra = 0; const crmFailures = [];
    try {
      for (const tgt of crmTargets) {
        await backfillCustomers(pool, tgt.tenantId, tgt.customers, { dryRun: false, actor: "cutover-evidence" });
        const r = await reconcileCustomers(pool, tgt.tenantId, tgt.customers);
        crmLegacy += r.legacyCount; crmPg += r.targetCount;
        crmMissing += r.missing.length; crmDiff += r.differences.length; crmExtra += r.extra.length;
        if (r.readyForCutover !== true) crmFailures.push({ tenant: tgt.tenantId, missing: r.missing, differences: r.differences, extra: r.extra });
      }
    } finally {
      // Fixture opruimen (CASCADE ruimt contacts/addresses mee).
      await pool.query("DELETE FROM customers WHERE tenant_id=$1", [CRM_FIXTURE_TENANT]).catch(() => {});
      await pool.query("DELETE FROM tenants WHERE id=$1", [CRM_FIXTURE_TENANT]).catch(() => {});
    }
    results.crm = {
      ok: crmFailures.length === 0,
      counts: { legacy: crmLegacy, pg: crmPg, missingInPg: crmMissing, mismatches: crmDiff, onlyInPg: crmExtra, tenants: crmTargets.length },
      failures: crmFailures,
    };
  } catch (err) {
    console.error("Reconciliatie brak af:", err && err.message || err);
    // Schrijf voor elk nog-niet-geschreven domein een fail-artefact.
    for (const domain of ["identity", "company", "finance", "crm"]) {
      if (!results[domain]) results[domain] = { ok: false, counts: {}, failures: [{ error: String(err && err.message || err).slice(0, 300) }] };
    }
  } finally {
    await pool.end();
  }

  // Schrijf per domein een evidence-artefact.
  for (const domain of ["identity", "company", "finance", "crm"]) {
    const r = results[domain] || { ok: false, counts: {}, failures: [{ error: "geen resultaat" }] };
    writeEvidence(domain, r.ok ? "pass" : "fail", r.counts, r.failures);
  }

  // Harde gate: R0-domeinen (identity/company/crm) MOETEN sluiten. finance opent
  // R1 en wordt óók afgedwongen zodra het meedraait.
  const required = [...R0_DOMAINS, "finance"];
  const failed = required.filter(d => !results[d] || !results[d].ok);
  if (failed.length) {
    console.error(`::error::read-cutover NIET sluitend voor: ${failed.join(", ")}`);
    process.exit(1);
  }
  console.log(`\nRead-cutover reconciliatie sluitend voor: ${required.join(", ")} · commit=${commitSha()}`);
}

// Vertaalt een reconcile-rapport naar telbare afwijkingen (velden verschillen
// per domein; we pakken de bekende varianten op).
function reconcileCounts(d) {
  const arr = (x) => Array.isArray(x) ? x.length : 0;
  return {
    legacy: d.legacyCount != null ? d.legacyCount : (d.checked != null ? d.checked : undefined),
    pg: d.pgCount != null ? d.pgCount : undefined,
    missingInPg: arr(d.missingInPg) || arr(d.missing),
    mismatches: arr(d.mismatched) || arr(d.mismatches) || arr(d.drift),
    onlyInPg: arr(d.onlyInPg) || arr(d.extra),
  };
}

function summarizeReconcile(d) {
  const out = [];
  const push = (label, x) => { if (Array.isArray(x) && x.length) out.push({ [label]: x.slice(0, 20) }); };
  push("missingInPg", d.missingInPg || d.missing);
  push("mismatched", d.mismatched || d.mismatches || d.drift);
  push("onlyInPg", d.onlyInPg || d.extra);
  if (d.error) out.push({ error: String(d.error).slice(0, 300) });
  return out;
}

main().catch((e) => { console.error(e); process.exit(1); });
