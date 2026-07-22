"use strict";
// DEV-01/04/05/07 · De traceability-gate is de bron van waarheid, dus zwaar
// getest. Kern na de CTO-review PR #41: de gate kan NIET vals-groen worden.
// Bewijs wordt INHOUDELIJK gevalideerd (schema + status + commit-SHA), niet op
// bestandsaanwezigheid; requirements tellen per-ID; alle 15 DoD-criteria staan
// afzonderlijk; en een niet-aanvaarde blocker laat de harde gate falen.
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { buildTraceability, evaluateEpic, EVIDENCE } = require("../src/modules/traceability");
const { makeEvidence, validateEvidence } = require("../src/modules/evidence");

const ROOT = path.join(__dirname, "..");
const EVID_DIR = path.join(ROOT, "docs", "traceability", "evidence");

function withTempEvidence(name, obj, fn) {
  fs.mkdirSync(EVID_DIR, { recursive: true });
  const p = path.join(EVID_DIR, `${name}.json`);
  const existed = fs.existsSync(p);
  const backup = existed ? fs.readFileSync(p) : null;
  try { fs.writeFileSync(p, JSON.stringify(obj)); return fn(); }
  finally { if (existed) fs.writeFileSync(p, backup); else fs.rmSync(p, { force: true }); }
}

test("matrix: 8 releases, 22 epics, 761 requirements uit de spec", () => {
  const m = buildTraceability({ repoRoot: ROOT, commitSha: "test" });
  assert.equal(m.releases.length, 8);
  assert.equal(m.epics.length, 22);
  assert.equal(m.requirements.total, 761);
});

test("alle 22 epics evidence-verified (impl + test bestaan)", () => {
  const m = buildTraceability({ repoRoot: ROOT, commitSha: "test" });
  assert.deepEqual(m.epics.filter(e => e.status !== "verified").map(e => e.id), []);
});

test("readiness eerlijk: pilot en commercieel zijn NIET klaar", () => {
  const m = buildTraceability({ repoRoot: ROOT, commitSha: "test" });
  assert.equal(m.gate.pilotReady, false, "geen cutover/tx/e2e-bewijs → niet pilot-ready");
  assert.equal(m.gate.commercialReady, false);
  const r0 = m.releases.find(r => r.id === "R0");
  assert.equal(r0.evidenceGreen, true);   // dekking bestaat
  assert.equal(r0.gateGreen, false);       // maar cutover niet bewezen
});

test("harde CI-gate is groen op de accepted-blockers-baseline", () => {
  // Met de gecommitte baseline zijn alle bekende reds aanvaard → geen regressie.
  const m = buildTraceability({ repoRoot: ROOT, commitSha: "test" });
  assert.equal(m.gate.ok, true, "geen niet-aanvaarde blocker met de baseline");
  assert.equal(m.gate.unaccepted.length, 0);
  assert.ok(m.gate.acceptedCount >= 10, "baseline dekt de bekende reds");
});

test("alle 15 DoD-criteria zijn afzonderlijk gemodelleerd", () => {
  const m = buildTraceability({ repoRoot: ROOT, commitSha: "test" });
  assert.equal(m.definitionOfDone.length, 15);
  assert.deepEqual(m.definitionOfDone.map(d => d.index), Array.from({ length: 15 }, (_, i) => i + 1));
  // Kwaliteitscriteria zijn evidence-gebonden en dus rood zonder bewijs.
  const testsPass = m.definitionOfDone.find(d => d.key === "tests_pass");
  assert.equal(testsPass.ok, false, "tests_pass vereist een test-suite-bewijsartefact");
});

test("requirements tellen PER-ID, niet op domein-associatie", () => {
  const m = buildTraceability({ repoRoot: ROOT, commitSha: "test" });
  // Slechts de individueel gemapte requirements zijn bewezen; de rest unproven.
  assert.ok(m.requirements.proven >= 1 && m.requirements.proven < 50, `bewezen=${m.requirements.proven}`);
  assert.ok(m.requirements.levels.unproven > 700, "de overgrote meerderheid blijft unproven");
});

// ── NEGATIEVE TESTS: de gate mag niet vals-groen worden (CTO PR #41) ─────────
test("negatief: leeg/willekeurig evidence-bestand is ONGELDIG", () => {
  assert.equal(validateEvidence({}, {}).ok, false);
  assert.equal(validateEvidence({ foo: 1 }, {}).ok, false);
  assert.equal(validateEvidence(null, {}).ok, false);
});

test("negatief: evidence van een ANDERE commit maakt de conditie niet groen", () => {
  const fake = makeEvidence({ evidenceType: "cutover-reconcile", status: "pass", commitSha: "0000000badc0ffee", counts: { rows: 5 } });
  fake.generatedAt = "2026-07-21T00:00:00Z";
  withTempEvidence("cutover-identity", fake, () => {
    const m = buildTraceability({ repoRoot: ROOT, commitSha: "deadbee1" });
    const cond = m.releases.find(r => r.id === "R0").conditions.find(c => c.key === "identity_cutover");
    assert.equal(cond.ok, false, "oude/foutieve commit-SHA telt niet");
  });
});

test("negatief: status=fail maakt de conditie niet groen", () => {
  const fail = makeEvidence({ evidenceType: "cutover-reconcile", status: "fail", commitSha: "deadbee1", counts: {} });
  fail.generatedAt = "2026-07-21T00:00:00Z";
  withTempEvidence("cutover-identity", fail, () => {
    const m = buildTraceability({ repoRoot: ROOT, commitSha: "deadbee1" });
    const cond = m.releases.find(r => r.id === "R0").conditions.find(c => c.key === "identity_cutover");
    assert.equal(cond.ok, false);
  });
});

test("positief: geldig, commit-gebonden, geslaagd evidence maakt de conditie WEL groen", () => {
  const good = makeEvidence({ evidenceType: "cutover-reconcile", status: "pass", commitSha: "deadbee1", counts: { legacy: 5, pg: 5, mismatches: 0 } });
  good.generatedAt = "2026-07-21T00:00:00Z";
  withTempEvidence("cutover-identity", good, () => {
    const m = buildTraceability({ repoRoot: ROOT, commitSha: "deadbee1" });
    const cond = m.releases.find(r => r.id === "R0").conditions.find(c => c.key === "identity_cutover");
    assert.equal(cond.ok, true, "correct bewijs hoort de conditie te openen");
  });
});

test("een ontbrekende epic-koppeling maakt de epic ROOD (deleted test → red)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trace-"));
  fs.mkdirSync(path.join(tmp, "docs", "spec"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "docs/spec/developer-requirements.json"), path.join(tmp, "docs/spec/developer-requirements.json"));
  const ev = evaluateEpic(tmp, "E08");
  assert.equal(ev.status, "missing_evidence");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("po_acceptance: ondertekende governance-acceptatie groen; ingetrokken/onvolledig → rood", () => {
  const p = path.join(ROOT, "docs", "traceability", "po-acceptance.json");
  const backup = fs.readFileSync(p);
  const po = () => buildTraceability({ repoRoot: ROOT, commitSha: "test" }).definitionOfDone.find(d => d.key === "po_acceptance");
  try {
    assert.equal(po().ok, true, "ondertekende acceptatie hoort groen te zijn (governance, niet commit-gebonden)");
    fs.rmSync(p);
    assert.equal(po().ok, false, "ingetrokken acceptatie → rood");
    fs.writeFileSync(p, JSON.stringify({ acceptedBy: "x" })); // ontbrekende velden
    assert.equal(po().ok, false, "onvolledige acceptatie → rood");
  } finally { fs.writeFileSync(p, backup); }
});

test("evidence-map dekt precies E01-E22", () => {
  assert.deepEqual(Object.keys(EVIDENCE).sort(), Array.from({ length: 22 }, (_, i) => `E${String(i + 1).padStart(2, "0")}`));
});
