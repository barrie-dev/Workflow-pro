#!/usr/bin/env node
"use strict";

// DEV-01 · Autoritatieve roadmap-gate.
//
// STANDAARD (release/CI): de VOLLEDIGE traceability-gate over R0-R7, E01-E22 en
// de Definition of Done, afgeleid uit echte evidence. Dit is impliciet
// --all-phases: er is geen deelgate meer voor release-beslissingen.
//   node scripts/check-roadmap-status.js            → gate, exit 1 als rood
//   node scripts/check-roadmap-status.js --json      → machineleesbaar
//
// LOKAAL (alleen development): de oude commerciële 5-fasenweergave als hulp.
//   node scripts/check-roadmap-status.js --commercial [--tenant t_demo] [--phase x]

const path = require("path");
const { buildTraceability } = require("../src/modules/traceability");

const jsonMode = process.argv.includes("--json");
const commercial = process.argv.includes("--commercial");

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] || fallback);
}

// ── Autoritatieve gate: R0-R7 / E01-E22 / DoD ────────────────────────────────
function runGate() {
  const ROOT = path.join(__dirname, "..");
  let commitSha = "unknown";
  try { commitSha = require("child_process").execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); } catch (_) {}
  const m = buildTraceability({ repoRoot: ROOT, commitSha });
  m.generatedAt = new Date().toISOString();

  if (jsonMode) {
    console.log(JSON.stringify({ ok: m.gate.ok, commitSha: m.commitSha, summary: m.summary, gate: m.gate }, null, 2));
    process.exit(m.gate.ok ? 0 : 1);
  }

  console.log(`Monargo One roadmap-gate (R0-R7 / E01-E22 / DoD) · commit ${m.commitSha}`);
  console.log(`Releases gate-groen: ${m.summary.releasesGreen}/${m.summary.releases} (evidence-groen ${m.summary.releasesEvidenceGreen}/${m.summary.releases})`);
  console.log(`Epics evidence-verified: ${m.summary.epicsVerified}/${m.summary.epics} · DoD: ${m.summary.dodGreen}/${m.summary.dodTotal}`);
  console.log(`Requirements gedekt: ${m.summary.requirementsCovered}/${m.summary.requirements}`);
  console.log("");
  m.releases.forEach(r => {
    const mark = r.gateGreen ? "GATE-GO" : (r.evidenceGreen ? "EVID-GO" : "NO-GO");
    console.log(`[${mark}] ${r.id} ${r.title} (${r.verified}/${r.epicCount} epics)`);
  });
  if (!m.gate.ok) {
    console.log("");
    console.log(`Gate ROOD. Blokkerend (${m.gate.blocking.length}):`);
    m.gate.blocking.slice(0, 12).forEach(b => console.log(`   [${b.type}] ${b.id}: ${b.reason}`));
    console.log(`\nZie docs/traceability/matrix.md · CTO-gate ${m.gateIssue}`);
    process.exit(1);
  }
  console.log("\nGate GROEN.");
  process.exit(0);
}

// ── Commerciële hulpweergave (lokaal) ────────────────────────────────────────
function runCommercial() {
  const { Store } = require("../src/lib/store");
  const { roadmapStatus } = require("../src/modules/roadmap");
  const tenantId = argValue("--tenant", "t_demo");
  const phaseFilter = argValue("--phase", "");
  const store = new Store();
  const tenant = store.data.tenants.find(row => row.id === tenantId);
  if (!tenant) {
    if (jsonMode) console.log(JSON.stringify({ ok: false, tenantId, error: "Tenant niet gevonden" }, null, 2));
    else console.error(`Tenant niet gevonden: ${tenantId}`);
    process.exit(1);
  }
  const roadmap = roadmapStatus(store, tenant);
  const selected = phaseFilter ? roadmap.phases.find(r => r.key === phaseFilter) : null;
  const blocking = phaseFilter
    ? [selected].filter(r => r && !r.go)
    : roadmap.phases.filter(r => !r.go);
  const ok = blocking.length === 0;
  if (jsonMode) {
    console.log(JSON.stringify({ ok, view: "commercial", currentPhase: roadmap.currentPhase, summary: roadmap.summary, phases: phaseFilter ? [selected] : roadmap.phases }, null, 2));
    process.exit(ok ? 0 : 1);
  }
  console.log(`Commerciële roadmap (hulpweergave) voor ${tenant.name} · fase ${roadmap.currentPhase}`);
  (phaseFilter ? [selected] : roadmap.phases).forEach(r => r && console.log(`[${r.go ? "GO" : "NO-GO"}] ${r.label}: ${r.score}% (${r.openCount} open)`));
  process.exit(ok ? 0 : 1);
}

commercial ? runCommercial() : runGate();
