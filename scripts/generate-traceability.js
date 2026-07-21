#!/usr/bin/env node
"use strict";

// DEV-01 · Genereert de traceability-matrix (JSON + Markdown) op de HUIDIGE
// commit. Dit is de enige bron van waarheid voor R0-R7, E01-E22, requirements
// en DoD. De status wordt afgeleid uit bestaande evidence, nooit hand-geclaimd.
//
//   node scripts/generate-traceability.js         → schrijft docs/traceability/*
//   node scripts/generate-traceability.js --stdout → print JSON, schrijft niets

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { buildTraceability } = require("../src/modules/traceability");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "traceability");

function commitSha() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); }
  catch (_) { return "unknown"; }
}

function statusMark(s) {
  return s === "verified" ? "GROEN" : s === "missing_evidence" ? "ROOD" : "GRIJS";
}

function toMarkdown(m) {
  const L = [];
  L.push("# Monargo One · Roadmap-traceability");
  L.push("");
  L.push(`Bron van waarheid (DEV-01). Gegenereerd op commit \`${m.commitSha}\` · ${m.generatedAt}.`);
  L.push(`CTO-gate: ${m.gateIssue}`);
  L.push("");
  L.push("> De status is afgeleid uit evidence die in de repo bestaat (impl + test + migratie). Een verwijderde test maakt de betrokken epic rood. Wat niet gekoppeld is, telt als niet-bewezen.");
  L.push("");
  L.push(`**Gate: ${m.gate.ok ? "GROEN" : "ROOD"}** · P0-releases ${m.gate.p0ReleasesGreen ? "groen" : "rood"} · DoD ${m.gate.dodGreen ? "groen" : "rood"}`);
  L.push("");
  L.push(`- Releases gate-groen: ${m.summary.releasesGreen}/${m.summary.releases} (evidence-groen: ${m.summary.releasesEvidenceGreen}/${m.summary.releases})`);
  L.push(`- Epics evidence-verified: ${m.summary.epicsVerified}/${m.summary.epics} (rood: ${m.summary.epicsMissingEvidence}, ongemapt: ${m.summary.epicsUnmapped})`);
  L.push(`- Requirements gedekt door verified epic: ${m.summary.requirementsCovered}/${m.summary.requirements}`);
  L.push(`- Definition of Done: ${m.summary.dodGreen}/${m.summary.dodTotal}`);
  L.push("");

  L.push("## Releases R0-R7");
  L.push("");
  L.push("Evidence = alle epics hebben impl + test op schijf. Gate = evidence + diepe condities (cutover/tx/e2e) + dependencyvolgorde. Een release kan evidence-groen zijn en gate-rood.");
  L.push("");
  L.push("| Release | Prio | Evidence | Gate | Epics | Open condities / blokkade |");
  L.push("| --- | --- | --- | --- | --- | --- |");
  m.releases.forEach(r => {
    const open = [
      ...(r.blockedBy || []).map(b => `geblokkeerd door ${b}`),
      ...(r.conditions || []).filter(c => !c.ok).map(c => c.label),
    ];
    const detail = r.epicCount === 0 ? r.note : (open.length ? open.join("; ") : "-");
    L.push(`| ${r.id} ${r.title} | ${r.priority} | ${r.evidenceGreen ? "GROEN" : "ROOD"} | ${r.gateGreen ? "GROEN" : "ROOD"} | ${r.verified}/${r.epicCount} | ${detail} |`);
  });
  L.push("");

  L.push("## Epics E01-E22");
  L.push("");
  L.push("| Epic | Release | Prio | Status | Tests | Ontbrekend bewijs | Open risico |");
  L.push("| --- | --- | --- | --- | --- | --- | --- |");
  m.epics.forEach(e => {
    const tests = (e.evidence.tests || []).length + (e.evidence.e2e || []).length;
    L.push(`| ${e.id} ${e.title} | ${e.release} | ${e.priority} | ${statusMark(e.status)} | ${tests} | ${(e.evidence.missing || []).join(", ") || "-"} | ${e.risk || "-"} |`);
  });
  L.push("");

  L.push("## Definition of Done");
  L.push("");
  L.push("| Criterium | Status | Bewijs |");
  L.push("| --- | --- | --- |");
  m.definitionOfDone.forEach(d => {
    L.push(`| ${d.label} | ${d.ok ? "GROEN" : "ROOD"} | ${d.detail} |`);
  });
  L.push("");

  if (m.gate.blocking.length) {
    L.push("## Blokkerend voor de gate");
    L.push("");
    m.gate.blocking.forEach(b => L.push(`- **${b.type} ${b.id}**: ${b.reason}`));
    L.push("");
  }

  L.push("## Requirements");
  L.push("");
  L.push(`761-requirements-baseline uit \`docs/spec/developer-requirements.json\`. ${m.requirements.covered}/${m.requirements.total} vallen onder een evidence-verified epic. De rest is nog niet individueel bewezen: ${m.requirements.byDomainUnmapped}`);
  L.push("");
  return L.join("\n");
}

function main() {
  const t0 = buildTraceability({ repoRoot: ROOT, commitSha: commitSha() });
  t0.generatedAt = new Date().toISOString();

  if (process.argv.includes("--stdout")) {
    console.log(JSON.stringify(t0, null, 2));
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "matrix.json"), JSON.stringify(t0, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "matrix.md"), toMarkdown(t0));
  console.log(`Traceability geschreven naar docs/traceability/ op commit ${t0.commitSha}`);
  console.log(`Gate: ${t0.gate.ok ? "GROEN" : "ROOD"} · releases ${t0.summary.releasesGreen}/${t0.summary.releases} · epics ${t0.summary.epicsVerified}/${t0.summary.epics} · DoD ${t0.summary.dodGreen}/${t0.summary.dodTotal}`);
}

main();
