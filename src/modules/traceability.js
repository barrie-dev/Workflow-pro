"use strict";

// ── DEV-01 · Roadmap-traceability als technische bron van waarheid ───────────
// De oude roadmap.js meet vijf commerciële fasen. Deze module meet de ECHTE
// baseline uit docs/spec/developer-requirements.json: R0-R7, E01-E22, de 761
// requirements en de Definition of Done - en leidt de status af uit BEWIJS dat
// werkelijk in de repo bestaat, niet uit handmatige "line(true)"-claims.
//
// Kernprincipe (CTO-eis): een epic kan niet "verified" zijn zonder gekoppelde
// implementatie én test die op schijf bestaan. Wie een gekoppelde test
// verwijdert, maakt de epic rood. Wat niet gekoppeld is, is "unmapped" en telt
// als NIET-bewezen. Zo kan de matrix niet groener zijn dan de code bewijst.

const fs = require("fs");
const path = require("path");

const SPEC_PATH = "docs/spec/developer-requirements.json";
const GATE_ISSUE = "https://github.com/barrie-dev/Workflow-pro/issues/40"; // CTO Gate R0

// Evidence-map: epic → echte bestanden + gedekte requirement-domeinen + risico.
// Paden zijn repo-relatief; de engine controleert bestaan met fs. Fout gelinkt
// = rood, dus deze map kan niet liegen over aanwezigheid.
const EVIDENCE = {
  E01: { impl: ["src/platform/companies.js"], migrations: ["001_core.sql", "007_company_fingerprint.sql"], tests: ["test/companies.test.js", "test/pg-company.test.js"], e2e: ["test/e2e/company-smoke.js"], reqDomains: ["PLT"], risk: "platform_state-singleton nog leidend voor schrijven" },
  E02: { impl: ["src/platform/policy.js"], migrations: [], tests: ["test/policy.test.js", "test/nav-gating.test.js"], e2e: ["test/e2e/policy-smoke.js"], reqDomains: ["SEC"], risk: "volledige padenscan (UI/API/export/search) nog niet uitputtend" },
  E03: { impl: ["src/platform/crm.js", "src/infrastructure/crm-source.js", "src/infrastructure/postgres/pg-customer-repository.js"], migrations: ["002_crm.sql"], tests: ["test/crm.test.js", "test/pg-crm.test.js", "test/crm-source.test.js"], e2e: ["test/e2e/crm-smoke.js"], reqDomains: ["CRM", "SUP"], risk: "read source staat standaard op legacy; cutover nog niet vrijgegeven" },
  E04: { impl: ["src/platform/projects.js"], migrations: [], tests: ["test/projects.test.js"], e2e: ["test/e2e/projects-smoke.js"], reqDomains: ["PRJ"], risk: "project nog niet genormaliseerd als primaire runtime" },
  E05: { impl: ["src/platform/quote-versions.js", "src/modules/quote-signing.js"], migrations: [], tests: ["test/quote-versions.test.js", "test/quote-signing.test.js"], e2e: ["test/e2e/quoteversion-smoke.js", "test/e2e/signing-smoke.js"], reqDomains: ["QOT"], risk: "" },
  E06: { impl: ["src/platform/planning.js", "src/modules/planning-rules.js"], migrations: [], tests: ["test/planning-unified.test.js"], e2e: ["test/e2e/planning-smoke.js"], reqDomains: ["CAL"], risk: "" },
  E07: { impl: ["src/platform/work-orders.js", "src/modules/workorder-rules.js", "src/modules/mobile.js"], migrations: ["003_jobs.sql"], tests: ["test/work-orders.test.js"], e2e: ["test/e2e/workorder-smoke.js", "test/e2e/mobile-offline-smoke.js"], reqDomains: ["WBO", "DOC"], risk: "offline foto-upload/duplicaat/conflict nog niet volledig E2E bewezen" },
  E08: { impl: ["src/modules/customer-invoicing.js", "src/infrastructure/finance-source.js", "src/infrastructure/postgres/pg-finance-repository.js", "src/modules/payments.js"], migrations: ["006_finance.sql"], tests: ["test/pg-finance.test.js", "test/payments.test.js", "test/financial-reconciliation.test.js", "test/credit-notes.test.js"], e2e: ["test/e2e/finance-smoke.js", "test/e2e/payments-smoke.js", "test/e2e/credit-smoke.js", "test/e2e/reconciliation-smoke.js"], reqDomains: ["SIV", "PIV", "PPL"], risk: "kritieke financiële mutaties nog niet aantoonbaar via pg TransactionManager (DEV-04)" },
  E09: { impl: ["src/platform/work-inbox.js", "src/platform/grid.js", "src/modules/inbox.js"], migrations: [], tests: ["test/work-inbox.test.js", "test/inbox.test.js", "test/grid.test.js"], e2e: ["test/e2e/grid-smoke.js"], reqDomains: ["GRD"], risk: "" },
  E10: { impl: ["src/platform/config-platform.js"], migrations: [], tests: ["test/config-platform.test.js"], e2e: [], reqDomains: ["CFG", "SET"], risk: "" },
  E11: { impl: ["src/platform/automation.js"], migrations: [], tests: ["test/automation.test.js"], e2e: [], reqDomains: ["AUT"], risk: "" },
  E12: { impl: ["src/platform/worksites.js", "src/platform/change-orders.js", "src/platform/progress-claims.js", "src/platform/compliance.js"], migrations: [], tests: ["test/construction.test.js", "test/progress-claims.test.js", "test/compliance-overview.test.js"], e2e: ["test/e2e/construction-smoke.js", "test/e2e/claims-smoke.js"], reqDomains: ["PRG", "NAC"], risk: "mobiele bewijsflow en project-financekoppeling verder te bewijzen" },
  E13: { impl: ["src/platform/catalog.js", "src/modules/catalog.js"], migrations: [], tests: ["test/catalog.test.js"], e2e: ["test/e2e/catalog-smoke.js"], reqDomains: ["ART"], risk: "" },
  E14: { impl: ["src/platform/project-finance.js", "src/platform/portfolio.js"], migrations: [], tests: ["test/project-finance.test.js", "test/portfolio.test.js"], e2e: ["test/e2e/portfolio-smoke.js"], reqDomains: ["PRG"], risk: "commitments/actuals/forecast nog niet genormaliseerd transactioneel" },
  E15: { impl: ["src/platform/contracts.js"], migrations: [], tests: ["test/contracts.test.js"], e2e: ["test/e2e/contracts-smoke.js"], reqDomains: ["RNT", "SUB"], risk: "" },
  E16: { impl: ["src/platform/assets.js"], migrations: [], tests: ["test/assets.test.js"], e2e: ["test/e2e/assets-smoke.js"], reqDomains: ["AST", "SRV"], risk: "" },
  E17: { impl: ["src/platform/inventory.js", "src/modules/stock.js"], migrations: [], tests: ["test/inventory-procurement.test.js", "test/inventory-reads.test.js"], e2e: [], reqDomains: ["STK", "DLV"], risk: "immutable stock nog niet volledig database-native" },
  E18: { impl: ["src/platform/procurement.js"], migrations: [], tests: ["test/inventory-procurement.test.js"], e2e: ["test/e2e/proc-smoke.js"], reqDomains: ["PUR", "PRQ", "ORD"], risk: "purchase-to-project-cost nog niet volledig database-native" },
  E19: { impl: ["src/platform/events.js", "src/platform/webhooks.js", "src/modules/integrations.js"], migrations: ["004_outbox.sql"], tests: ["test/events.test.js", "test/webhooks.test.js", "test/outbox-durable.test.js"], e2e: ["test/e2e/events-smoke.js", "test/e2e/webhook-smoke.js"], reqDomains: ["API"], risk: "echte connectorhealth en parallel run nog af te ronden" },
  E20: { impl: ["src/platform/robaws-import.js", "src/modules/imports.js"], migrations: [], tests: ["test/robaws-import.test.js"], e2e: ["test/e2e/robaws-smoke.js"], reqDomains: ["API"], risk: "" },
  E21: { impl: ["src/modules/boden.js", "src/platform/mona-prepare.js", "src/platform/mona-signals.js"], migrations: [], tests: ["test/boden.test.js", "test/mona-prepare.test.js", "test/mona-signals.test.js"], e2e: ["test/e2e/mona-prepare-smoke.js", "test/e2e/signals-smoke.js"], reqDomains: [], risk: "AI-governance (bron/confidence/confirmatie) verder te hardenen (DEV-12)" },
  E22: { impl: ["src/platform/insights.js", "src/modules/dashboards.js", "src/modules/reports.js"], migrations: [], tests: ["test/insights.test.js"], e2e: [], reqDomains: ["BI"], risk: "" },
};

// Requirement-domeinen die (nog) niet aan een epic hangen → eerlijk "uncovered".
// EMP/LVE/SUB/DPL etc. leven deels in legacy-modules zonder genormaliseerd epic.
const UNMAPPED_NOTE = "Geen genormaliseerd epic; dekking via legacy-module, niet individueel bewezen.";

function readSpec(repoRoot) {
  const raw = fs.readFileSync(path.join(repoRoot, SPEC_PATH), "utf8");
  return JSON.parse(raw);
}

function exists(repoRoot, rel) {
  try { return fs.existsSync(path.join(repoRoot, rel)); }
  catch (_) { return false; }
}

// Migraties staan onder migrations/sql/. Controleer daar.
function migrationExists(repoRoot, name) {
  return exists(repoRoot, path.join("migrations", "sql", name));
}

function fileContains(repoRoot, rel, regex) {
  try { return regex.test(fs.readFileSync(path.join(repoRoot, rel), "utf8")); }
  catch (_) { return false; }
}

// Diepere release-condities die de ECHTE kern-sluiting meten (niet enkel dat er
// bestanden bestaan). Elk is evidence-gedreven: de cutover- en E2E-condities
// vragen een gecommit bewijsartefact (zoals de CTO verplicht bewijs eist), de
// transactie-conditie leidt af uit de code. Zolang die er niet zijn, is de
// betrokken P0-release eerlijk ROOD - precies de "gedeeltelijk"-status uit het
// CTO-oordeel, in plaats van vals-groen op bestandsaanwezigheid.
function releaseConditions(repoRoot) {
  const cutoverProof = (domain) => exists(repoRoot, `docs/traceability/cutover-${domain}.json`);
  const e2eManifest = exists(repoRoot, "docs/traceability/e2e-scenarios.json");
  const financeTx = fileContains(repoRoot, "src/infrastructure/finance-source.js", /TransactionManager|pgTx|ambientClient/)
    || fileContains(repoRoot, "src/infrastructure/postgres/pg-finance-repository.js", /TransactionManager|pgTx|ambientClient/);
  return {
    R0: [
      { key: "identity_cutover", label: "Identity read-cutover naar pg bewezen", ok: cutoverProof("identity"), detail: "cutover-identity.json ontbreekt · read source staat standaard op legacy (DEV-03)." },
      { key: "company_cutover", label: "Company read-cutover naar pg bewezen", ok: cutoverProof("company"), detail: "cutover-company.json ontbreekt (DEV-03)." },
      { key: "crm_cutover", label: "CRM read-cutover naar pg bewezen", ok: cutoverProof("crm"), detail: "cutover-crm.json ontbreekt (DEV-03)." },
    ],
    R1: [
      { key: "horizontal_e2e", label: "9 verplichte E2E-scenario's volledig", ok: e2eManifest, detail: "e2e-scenarios.json ontbreekt · doorlopende klant→betaling-flow nog niet als één scenario (DEV-02)." },
      { key: "finance_tx", label: "Finance-mutaties via pg TransactionManager", ok: financeTx, detail: "finance-source/pg-finance-repository gebruikt de pg TransactionManager nog niet (DEV-04)." },
      { key: "finance_cutover", label: "Finance read-cutover naar pg bewezen", ok: cutoverProof("finance"), detail: "cutover-finance.json ontbreekt (DEV-03)." },
    ],
    R4: [
      { key: "pfi_tx", label: "Projectfinance database-native transactioneel", ok: financeTx, detail: "commitments/actuals/forecast nog niet database-native transactioneel (DEV-04)." },
    ],
  };
}

// Bepaal de epic-status puur uit bestaan van de gekoppelde artefacten.
function evaluateEpic(repoRoot, epicId) {
  const ev = EVIDENCE[epicId];
  if (!ev) {
    return { status: "unmapped", hasTest: false, implOk: false, testOk: false,
      missing: [], impl: [], tests: [], e2e: [], migrations: [], reqDomains: [], risk: "" };
  }
  const impl = ev.impl.map(f => ({ file: f, ok: exists(repoRoot, f) }));
  const tests = ev.tests.map(f => ({ file: f, ok: exists(repoRoot, f) }));
  const e2e = (ev.e2e || []).map(f => ({ file: f, ok: exists(repoRoot, f) }));
  const migrations = (ev.migrations || []).map(f => ({ file: f, ok: migrationExists(repoRoot, f) }));
  const missing = [...impl, ...tests, ...e2e, ...migrations].filter(x => !x.ok).map(x => x.file);

  const implOk = impl.length > 0 && impl.every(x => x.ok);
  const testOk = tests.length > 0 && tests.every(x => x.ok);
  const anyPresent = [...impl, ...tests].some(x => x.ok);

  let status;
  if (implOk && testOk && missing.length === 0) status = "verified";
  else if (anyPresent) status = "missing_evidence"; // iets gelinkt ontbreekt → rood
  else status = "missing_evidence";

  return { status, hasTest: tests.length > 0, implOk, testOk, missing,
    impl, tests, e2e, migrations, reqDomains: ev.reqDomains || [], risk: ev.risk || "" };
}

// Bouw de volledige traceability-matrix op een concrete commit.
function buildTraceability(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const commitSha = opts.commitSha || "unknown";
  const spec = readSpec(repoRoot);

  const releases = spec.roadmap.map(r => ({ id: r[0], title: r[1], priority: r[2], detail: r[3] }));
  const epicsRaw = spec.epics;

  // Koppel elk epic aan zijn release. developer-requirements bevat geen directe
  // epic→release-kolom; we leiden af uit de bekende R0-R7-indeling van de spec.
  const EPIC_RELEASE = {
    E01: "R0", E02: "R0", E03: "R0", E10: "R0",
    E04: "R1", E05: "R1", E06: "R1", E07: "R1", E08: "R1", E09: "R1", E22: "R1",
    E12: "R2",
    E16: "R3",
    E14: "R4", E15: "R4",
    E17: "R5", E18: "R5", E13: "R5",
    E11: "R6", E19: "R6", E20: "R6", E21: "R6",
    // R7 (Construction Advanced) heeft geen eigen epic in E01-E22: bewust gated.
  };

  const epics = epicsRaw.map(e => {
    const ev = evaluateEpic(repoRoot, e.id);
    return {
      id: e.id, title: e.title, priority: e.priority, domain: e.domain,
      release: EPIC_RELEASE[e.id] || "R6",
      status: ev.status,
      evidence: {
        impl: ev.impl, tests: ev.tests, e2e: ev.e2e, migrations: ev.migrations,
        missing: ev.missing,
      },
      reqDomains: ev.reqDomains,
      risk: ev.risk,
    };
  });

  // Requirement-dekking: een requirement telt als "covered" wanneer zijn domein
  // aan een VERIFIED epic hangt. Al de rest is eerlijk "uncovered".
  const verifiedDomains = new Set();
  epics.filter(e => e.status === "verified").forEach(e => e.reqDomains.forEach(d => verifiedDomains.add(d)));
  const requirements = spec.requirements.map(q => {
    const domain = q.id.split("-")[0];
    const covered = verifiedDomains.has(domain);
    return { id: q.id, domain, priority: q.priority, module: q.module, covered };
  });
  const reqCovered = requirements.filter(q => q.covered).length;

  // Definition of Done: elk criterium gekoppeld aan een echte, controleerbare
  // check. Geen statische true; de status komt uit werkelijk bewijs.
  const dod = buildDodChecks(repoRoot, spec, epics);

  // Release-rollup in twee lagen:
  //  · evidenceGreen = alle epics hebben impl + test op schijf (dekking bestaat);
  //  · gateGreen     = evidenceGreen ÉN diepe condities (cutover/tx/e2e) ÉN alle
  //                    lagere releases zijn gateGreen (dependencyvolgorde).
  // Zo blijft niets bóven het fundament groen tot het fundament sluit - exact de
  // "R0 gedeeltelijk, hoger nog niet" die de CTO beschrijft.
  const conditions = releaseConditions(repoRoot);
  const releaseRows = [];
  let cascadeBlocked = false;
  let firstRedId = null;
  for (const r of releases) {
    const own = epics.filter(e => e.release === r.id);
    const verified = own.filter(e => e.status === "verified").length;
    const evidenceGreen = own.length > 0 && verified === own.length;
    const conds = conditions[r.id] || [];
    const condsOk = conds.every(c => c.ok);
    const blockedBy = (cascadeBlocked && firstRedId) ? [firstRedId] : [];
    // R7 heeft bewust geen epics: nooit gateGreen (gated tot R0-R6 voldoen).
    const gateGreen = own.length > 0 && evidenceGreen && condsOk && blockedBy.length === 0;
    releaseRows.push({
      ...r,
      epicCount: own.length,
      verified,
      evidenceGreen,
      conditions: conds,
      blockedBy,
      gateGreen,
      epics: own.map(e => e.id),
      note: own.length === 0 ? "Geen epics gekoppeld · bewust gated tot R0-R6 voldoen." : "",
    });
    if (!gateGreen && !cascadeBlocked) { cascadeBlocked = true; firstRedId = r.id; }
  }

  const p0Releases = releaseRows.filter(r => String(r.priority).includes("P0"));
  const p0Green = p0Releases.every(r => r.gateGreen);
  const dodGreen = dod.every(d => d.ok);

  return {
    generatedAt: opts.now || null, // stempel na afloop; script vult in
    commitSha,
    gateIssue: GATE_ISSUE,
    summary: {
      releases: releaseRows.length,
      releasesGreen: releaseRows.filter(r => r.gateGreen).length,
      releasesEvidenceGreen: releaseRows.filter(r => r.evidenceGreen).length,
      epics: epics.length,
      epicsVerified: epics.filter(e => e.status === "verified").length,
      epicsMissingEvidence: epics.filter(e => e.status === "missing_evidence").length,
      epicsUnmapped: epics.filter(e => e.status === "unmapped").length,
      requirements: requirements.length,
      requirementsCovered: reqCovered,
      dodTotal: dod.length,
      dodGreen: dod.filter(d => d.ok).length,
    },
    // De gate: --all-phases-semantiek. P0-releases + DoD moeten groen.
    gate: {
      ok: p0Green && dodGreen,
      p0ReleasesGreen: p0Green,
      dodGreen,
      blocking: [
        ...p0Releases.filter(r => !r.gateGreen).flatMap(r => {
          if (!r.evidenceGreen) return [{ type: "release", id: r.id, reason: `${r.verified}/${r.epicCount} epics evidence-verified` }];
          if (r.blockedBy.length) return [{ type: "release", id: r.id, reason: `geblokkeerd door ${r.blockedBy.join(", ")} (dependencyvolgorde)` }];
          return r.conditions.filter(c => !c.ok).map(c => ({ type: "condition", id: `${r.id}.${c.key}`, reason: c.detail }));
        }),
        ...epics.filter(e => e.status === "missing_evidence").map(e => ({ type: "epic", id: e.id, reason: `ontbrekend bewijs: ${e.evidence.missing.join(", ")}` })),
        ...dod.filter(d => !d.ok).map(d => ({ type: "dod", id: d.key, reason: d.detail })),
      ],
    },
    releases: releaseRows,
    epics,
    definitionOfDone: dod,
    requirements: { total: requirements.length, covered: reqCovered, byDomainUnmapped: UNMAPPED_NOTE },
  };
}

// Definition of Done als afgeleide, controleerbare checks (geen line(true)).
function buildDodChecks(repoRoot, spec, epics) {
  const ciPath = path.join(repoRoot, ".github", "workflows", "ci.yml");
  let ci = "";
  try { ci = fs.readFileSync(ciPath, "utf8"); } catch (_) { ci = ""; }
  const hasE2eInCi = /test:e2e|run-e2e/.test(ci);
  const migrationCount = fs.existsSync(path.join(repoRoot, "migrations", "sql"))
    ? fs.readdirSync(path.join(repoRoot, "migrations", "sql")).filter(f => f.endsWith(".sql")).length : 0;
  const architectureTest = exists(repoRoot, "test/architecture.test.js");
  const auditTest = exists(repoRoot, "test/audit-log.test.js");
  const eventsTest = exists(repoRoot, "test/events.test.js");
  const policyTest = exists(repoRoot, "test/policy.test.js");
  const i18n = exists(repoRoot, "public/js/i18n.js");
  const runbook = exists(repoRoot, "docs/DEPLOY-RUNBOOK.md");
  const allEpicsVerified = epics.every(e => e.status === "verified");

  // Elk DoD-criterium uit de spec, elk met een concrete evidence-check.
  const CHECKS = [
    { key: "spec_baseline", label: "Spec-baseline aanwezig", ok: Array.isArray(spec.definition_of_done) && spec.definition_of_done.length > 0, detail: "developer-requirements.json bevat de DoD-lijst." },
    { key: "migrations", label: "Migratiepad geïmplementeerd", ok: migrationCount >= 7, detail: `${migrationCount} SQL-migraties in migrations/sql/.` },
    { key: "policy_enforced", label: "Server-side permissies getest", ok: policyTest, detail: "test/policy.test.js aanwezig." },
    { key: "audit_events", label: "Audit + domeinevents getest", ok: auditTest && eventsTest, detail: "test/audit-log.test.js + test/events.test.js aanwezig." },
    { key: "architecture", label: "Cloudblinde architectuurtest", ok: architectureTest, detail: "test/architecture.test.js bewaakt de poort/adapter-grenzen." },
    { key: "e2e_in_ci", label: "E2E draait in CI", ok: hasE2eInCi, detail: hasE2eInCi ? "ci.yml roept test:e2e aan." : "OPEN (DEV-02): test:e2e staat nog niet in ci.yml." },
    { key: "i18n", label: "NL/FR/EN aanwezig", ok: i18n, detail: "public/js/i18n.js met de drie taalblokken." },
    { key: "runbook", label: "Deploy-runbook aanwezig", ok: runbook, detail: "docs/DEPLOY-RUNBOOK.md aanwezig." },
    { key: "all_epics_verified", label: "Alle epics evidence-verified", ok: allEpicsVerified, detail: "Elke E01-E22 heeft bestaande impl + test." },
  ];
  return CHECKS;
}

module.exports = { buildTraceability, evaluateEpic, EVIDENCE, GATE_ISSUE };
