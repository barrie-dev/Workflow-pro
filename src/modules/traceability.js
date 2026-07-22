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
const { loadEvidence, evidencePath } = require("./evidence");

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

// Per-requirement-ID mapping (docs/traceability/requirement-map.json), of leeg.
function loadRequirementMap(repoRoot) {
  try {
    const obj = JSON.parse(fs.readFileSync(path.join(repoRoot, "docs/traceability/requirement-map.json"), "utf8"));
    return obj && obj.map && typeof obj.map === "object" ? obj.map : {};
  } catch (_) { return {}; }
}

// Geversioneerde accepted-blockers-baseline: bewust aanvaarde rode punten met
// eigenaar/reden/deadline. Een blocker die HIER staat blokkeert CI niet; een
// NIEUWE blocker wel. Vervangt de "|| true"-truc (CTO PR #41).
function loadAcceptedBlockers(repoRoot) {
  try {
    const obj = JSON.parse(fs.readFileSync(path.join(repoRoot, "docs/traceability/accepted-blockers.json"), "utf8"));
    const list = Array.isArray(obj.accepted) ? obj.accepted : [];
    return new Set(list.map(b => `${b.type}:${b.id}`));
  } catch (_) { return new Set(); }
}

// PO-acceptatie is een GOVERNANCE-artefact, geen per-commit bewijs: een
// ondertekende aanvaarding blijft geldig over commits heen tot ze wordt
// INGETROKKEN (bestand verwijderen/leegmaken). Daarom NIET commit-gebonden,
// maar op inhoud gevalideerd: wie aanvaardde, wanneer, welke scope, en wie het
// autoriseerde. Zonder ondertekend bestand blijft DoD #15 terecht rood.
function loadAcceptance(repoRoot) {
  try {
    const obj = JSON.parse(fs.readFileSync(path.join(repoRoot, "docs/traceability/po-acceptance.json"), "utf8"));
    const ok = obj && obj.acceptedBy && obj.acceptedAt && obj.scope && obj.authorizedBy;
    if (!ok) return { ok: false, reason: "onvolledige acceptatie (acceptedBy/acceptedAt/scope/authorizedBy vereist)" };
    return { ok: true, acceptance: obj };
  } catch (_) { return { ok: false, reason: "geen ondertekende acceptatie (docs/traceability/po-acceptance.json ontbreekt)" }; }
}

// Target-release-semantiek: welke releases moeten groen zijn voor welk doel.
const TARGETS = { pilot: "R2", commercial: "R6" };
function releasesUpTo(releaseRows, targetId) {
  const idx = releaseRows.findIndex(r => r.id === targetId);
  return idx === -1 ? releaseRows : releaseRows.slice(0, idx + 1);
}

// Diepere release-condities die de ECHTE kern-sluiting meten. Elke conditie
// hangt aan een INHOUDELIJK gevalideerd bewijsartefact dat door een uitvoerende
// job is geschreven (schema + status=pass + commitSha == huidige commit). Geen
// bestandsaanwezigheid, geen broncode-regex: een leeg/oud/handmatig bestand
// maakt de conditie NIET groen (CTO-review PR #41).
function releaseConditions(repoRoot, commitSha) {
  // Bewijs voor een cutover-reconciliatie per domein.
  const cutover = (domain) => {
    const r = loadEvidence(repoRoot, evidencePath(`cutover-${domain}`), { commitSha, evidenceType: "cutover-reconcile" });
    return { ok: r.ok, detail: r.ok ? `reconciliatie sluitend (${domain})` : `cutover-${domain}: ${r.reason} (DEV-03)` };
  };
  // Bewijs dat de finance multi-write-rollback-integratietest slaagde.
  const financeTxEv = loadEvidence(repoRoot, evidencePath("finance-tx"), { commitSha, evidenceType: "finance-tx-rollback" });
  const financeTx = { ok: financeTxEv.ok, detail: financeTxEv.ok ? "pg-rollback-integratietest bewezen" : `finance-tx: ${financeTxEv.reason} (DEV-06)` };
  // Bewijs dat de 9 verplichte horizontale scenario's als keten slaagden.
  const e2eEv = loadEvidence(repoRoot, evidencePath("e2e-scenarios"), { commitSha, evidenceType: "e2e-manifest" });
  const e2eNine = { ok: e2eEv.ok, detail: e2eEv.ok ? "9 scenario's als keten bewezen" : `e2e-scenarios: ${e2eEv.reason} (DEV-03)` };

  const cId = cutover("identity"), cCo = cutover("company"), cCrm = cutover("crm"), cFin = cutover("finance");
  return {
    R0: [
      { key: "identity_cutover", label: "Identity read-cutover naar pg bewezen", ok: cId.ok, detail: cId.detail },
      { key: "company_cutover", label: "Company read-cutover naar pg bewezen", ok: cCo.ok, detail: cCo.detail },
      { key: "crm_cutover", label: "CRM read-cutover naar pg bewezen", ok: cCrm.ok, detail: cCrm.detail },
    ],
    R1: [
      { key: "horizontal_e2e", label: "9 verplichte E2E-scenario's volledig", ok: e2eNine.ok, detail: e2eNine.detail },
      { key: "finance_tx", label: "Finance multi-write rollback bewezen (pg-integratietest)", ok: financeTx.ok, detail: financeTx.detail },
      { key: "finance_cutover", label: "Finance read-cutover naar pg bewezen", ok: cFin.ok, detail: cFin.detail },
    ],
    R4: [
      { key: "pfi_tx", label: "Projectfinance database-native transactioneel", ok: financeTx.ok, detail: financeTx.detail },
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

  // Requirement-traceability PER ID (CTO PR #41): domein-associatie is GEEN
  // bewijs. Elk requirement-ID moet individueel gemapt zijn naar implementatie +
  // test in docs/traceability/requirement-map.json. De map onderscheidt de
  // niveaus mapped → implemented → tested → accepted. Elk niveau vraagt dat de
  // gelinkte bestanden bestaan; een requirement zonder eigen mapping blijft
  // 'unproven'. Zo telt niets als gedekt zonder individueel bewijs.
  const reqMap = loadRequirementMap(repoRoot);
  const requirements = spec.requirements.map(q => {
    const m = reqMap[q.id];
    let level = "unproven";
    if (m) {
      const implOk = (m.impl || []).length > 0 && (m.impl || []).every(f => exists(repoRoot, f));
      const testOk = (m.tests || []).length > 0 && (m.tests || []).every(f => exists(repoRoot, f));
      const e2eOk = (m.e2e || []).length > 0 && (m.e2e || []).every(f => exists(repoRoot, f));
      if (m.accepted === true && testOk) level = "accepted";
      else if (testOk || e2eOk) level = "tested";
      else if (implOk) level = "implemented";
      else level = "mapped";
    }
    return { id: q.id, priority: q.priority, module: q.module, level };
  });
  const reqLevels = { unproven: 0, mapped: 0, implemented: 0, tested: 0, accepted: 0 };
  requirements.forEach(q => { reqLevels[q.level]++; });
  const reqProven = reqLevels.tested + reqLevels.accepted;   // individueel bewezen = getest of aanvaard

  // Definition of Done: alle 15 criteria afzonderlijk, evidence-gebonden waar het
  // om kwaliteit gaat.
  const dod = buildDodChecks(repoRoot, spec, epics, commitSha);

  // Release-rollup in twee lagen:
  //  · evidenceGreen = alle epics hebben impl + test op schijf (dekking bestaat);
  //  · gateGreen     = evidenceGreen ÉN diepe condities (cutover/tx/e2e) ÉN alle
  //                    lagere releases zijn gateGreen (dependencyvolgorde).
  // Zo blijft niets bóven het fundament groen tot het fundament sluit - exact de
  // "R0 gedeeltelijk, hoger nog niet" die de CTO beschrijft.
  const conditions = releaseConditions(repoRoot, commitSha);
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

  const dodGreen = dod.every(d => d.ok);

  // Alles wat groen-worden in de weg staat, met concrete reden.
  const blocking = [
    ...releaseRows.filter(r => !r.gateGreen && r.epicCount > 0).flatMap(r => {
      if (!r.evidenceGreen) return [{ type: "release", id: r.id, reason: `${r.verified}/${r.epicCount} epics evidence-verified` }];
      if (r.blockedBy.length) return [{ type: "release", id: r.id, reason: `geblokkeerd door ${r.blockedBy.join(", ")} (dependencyvolgorde)` }];
      return r.conditions.filter(c => !c.ok).map(c => ({ type: "condition", id: `${r.id}.${c.key}`, reason: c.detail }));
    }),
    ...epics.filter(e => e.status === "missing_evidence").map(e => ({ type: "epic", id: e.id, reason: `ontbrekend bewijs: ${e.evidence.missing.join(", ")}` })),
    ...dod.filter(d => !d.ok).map(d => ({ type: "dod", id: d.key, reason: d.detail })),
  ];

  // Target-release-semantiek: een target is READY als alle releases t/m dat
  // target gate-groen zijn ÉN de DoD groen is (pilot t/m R2, commercieel t/m R6).
  const targets = {};
  for (const [name, relId] of Object.entries(TARGETS)) {
    const scope = releasesUpTo(releaseRows, relId);
    const releasesOk = scope.length > 0 && scope.every(r => r.gateGreen);
    targets[name] = { upTo: relId, releasesOk, dodGreen, ready: releasesOk && dodGreen };
  }

  // Accepted-blockers-baseline (vervangt || true): bekende, bewust aanvaarde rode
  // punten. Een NIEUWE blocker die NIET in de baseline staat, laat de harde
  // CI-gate falen. Zo houdt branch protection regressies tegen zonder dat de
  // (terecht rode) kern-status de PR blokkeert.
  const accepted = loadAcceptedBlockers(repoRoot);
  const unaccepted = blocking.filter(b => !accepted.has(`${b.type}:${b.id}`));

  return {
    generatedAt: opts.now || null, // stempel na afloop; script vult in
    commitSha,
    gateIssue: GATE_ISSUE,
    summary: {
      releases: releaseRows.length,
      releasesGateGreen: releaseRows.filter(r => r.gateGreen).length,
      releasesEvidenceGreen: releaseRows.filter(r => r.evidenceGreen).length,
      epics: epics.length,
      epicsVerified: epics.filter(e => e.status === "verified").length,
      epicsMissingEvidence: epics.filter(e => e.status === "missing_evidence").length,
      epicsUnmapped: epics.filter(e => e.status === "unmapped").length,
      requirements: requirements.length,
      requirementsProven: reqProven,
      requirementLevels: reqLevels,
      dodTotal: dod.length,
      dodGreen: dod.filter(d => d.ok).length,
      blocking: blocking.length,
      unacceptedBlockers: unaccepted.length,
    },
    targets,
    // HARDE CI-gate = geen niet-aanvaarde blocker. READINESS = per target.
    gate: {
      ok: unaccepted.length === 0,
      pilotReady: targets.pilot.ready,
      commercialReady: targets.commercial.ready,
      dodGreen,
      acceptedCount: accepted.size,
      blocking,
      unaccepted,
    },
    releases: releaseRows,
    epics,
    definitionOfDone: dod,
    requirements: { total: requirements.length, proven: reqProven, levels: reqLevels, items: requirements },
  };
}

// Definition of Done: ALLE 15 master-criteria afzonderlijk gemodelleerd (CTO
// PR #41). Structurele/documentatie-criteria toetsen op de aanwezigheid van het
// artefact (legitiem voor "gedocumenteerd"); kwaliteits-criteria (tests slagen,
// tenant-isolatie, acceptatie) hangen aan een INHOUDELIJK gevalideerd
// bewijsartefact van een uitvoerende job (schema + pass + commitSha). Zolang die
// er niet zijn, is het criterium eerlijk ROOD.
function buildDodChecks(repoRoot, spec, epics, commitSha) {
  const ciPath = path.join(repoRoot, ".github", "workflows", "ci.yml");
  let ci = ""; try { ci = fs.readFileSync(ciPath, "utf8"); } catch (_) {}
  const hasE2eInCi = /test:e2e|run-e2e/.test(ci);
  const migrationCount = fs.existsSync(path.join(repoRoot, "migrations", "sql"))
    ? fs.readdirSync(path.join(repoRoot, "migrations", "sql")).filter(f => f.endsWith(".sql")).length : 0;
  const anyTest = (glob) => { try { return fs.readdirSync(path.join(repoRoot, "test")).some(f => glob.test(f)); } catch (_) { return false; } };
  // Evidence-gebonden criteria (uitvoerende job vereist).
  const testSuite = loadEvidence(repoRoot, evidencePath("test-suite"), { commitSha, evidenceType: "test-suite" });
  const security = loadEvidence(repoRoot, evidencePath("security-matrix"), { commitSha, evidenceType: "security-matrix" });
  const acceptance = loadAcceptance(repoRoot); // governance-artefact, niet commit-gebonden

  const dodText = Array.isArray(spec.definition_of_done) ? spec.definition_of_done : [];
  const C = (n, key, ok, detail) => ({ index: n, key, criterion: dodText[n - 1] || "", ok: !!ok, detail });
  const CHECKS = [
    C(1, "purpose_documented", spec.requirements && spec.requirements.length > 0 && spec.epics && spec.epics.length > 0, "requirements + epics met outcome in spec."),
    C(2, "entities_constraints", migrationCount >= 7, `${migrationCount} SQL-migraties met constraints in migrations/sql/.`),
    C(3, "state_machine", exists(repoRoot, "test/policy.test.js") && (anyTest(/status|state|workorder|quote-version/i)), "status/transitie-permissies server-side getest."),
    C(4, "ui_states", anyTest(/^ui-.*\.test\.js$/), "UI empty/loading/error/conflict/archived via ui-*-tests."),
    C(5, "api_versioned", exists(repoRoot, "docs/API-V1.md") && exists(repoRoot, "test/api-v1.test.js"), "gedocumenteerd + versioneerd /v1-contract."),
    C(6, "audit_events", exists(repoRoot, "test/audit-log.test.js") && exists(repoRoot, "test/events.test.js"), "audit + domeinevents getest."),
    C(7, "search_export_policy", exists(repoRoot, "test/grid.test.js") && exists(repoRoot, "test/policy.test.js"), "search/filter/export respecteren policies."),
    C(8, "workos_integrated", exists(repoRoot, "test/work-os.test.js") && exists(repoRoot, "test/config-platform.test.js"), "custom fields/files/tasks/timeline geïntegreerd."),
    C(9, "idempotency_concurrency", exists(repoRoot, "test/idempotency.test.js") && exists(repoRoot, "test/pg-data-adapter.test.js"), "idempotentie + concurrency (flush-coalescing) getest."),
    // #10/#11/#15 zijn EVIDENCE-gebonden (uitvoerende job, geen bestandspresentie).
    C(10, "tests_pass", testSuite.ok, testSuite.ok ? "unit+integratie+e2e bewezen groen (evidence)." : `test-suite-bewijs: ${testSuite.reason}`),
    C(11, "tenant_isolation", security.ok, security.ok ? "tenant-isolatie + privilege-matrix bewezen (evidence)." : `security-matrix-bewijs: ${security.reason}`),
    C(12, "a11y_localization", exists(repoRoot, "public/js/i18n.js") && exists(repoRoot, "test/ui-readability.test.js"), "NL/FR/EN + accessibility-review."),
    C(13, "observability", exists(repoRoot, "src/modules/errors.js") && exists(repoRoot, "docs/DEPLOY-RUNBOOK.md") && exists(repoRoot, "src/platform/audit-log.js"), "logs/metrics/foutcodes/runbook."),
    C(14, "migration_rollback", exists(repoRoot, "docs/DEPLOY-RUNBOOK.md") && /rollback/i.test(safeRead(repoRoot, "docs/DEPLOY-RUNBOOK.md")), "migratie + rollback gedocumenteerd."),
    C(15, "po_acceptance", acceptance.ok, acceptance.ok ? "PO-acceptatie ondertekend (governance-artefact)." : `acceptatie: ${acceptance.reason}`),
  ];
  return CHECKS;
}

function safeRead(repoRoot, rel) { try { return fs.readFileSync(path.join(repoRoot, rel), "utf8"); } catch (_) { return ""; } }

module.exports = { buildTraceability, evaluateEpic, EVIDENCE, GATE_ISSUE };
