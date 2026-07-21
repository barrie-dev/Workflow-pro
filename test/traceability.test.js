"use strict";
// DEV-01 · De traceability-engine is zelf de gate, dus zelf getest. Kern:
// status wordt afgeleid uit BESTAANDE evidence, een ontbrekende koppeling maakt
// de epic rood, en de P0-releases blijven rood zolang de kern niet gesloten is.
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { buildTraceability, evaluateEpic, EVIDENCE } = require("../src/modules/traceability");

const ROOT = path.join(__dirname, "..");

test("matrix: alle 8 releases en 22 epics uit de spec", () => {
  const m = buildTraceability({ repoRoot: ROOT, commitSha: "test" });
  assert.equal(m.releases.length, 8, "R0-R7");
  assert.equal(m.epics.length, 22, "E01-E22");
  assert.equal(m.requirements.total, 761, "761 requirements-baseline");
});

test("epic-evidence bestaat echt: alle 22 epics evidence-verified in deze repo", () => {
  const m = buildTraceability({ repoRoot: ROOT, commitSha: "test" });
  const notVerified = m.epics.filter(e => e.status !== "verified");
  assert.deepEqual(notVerified.map(e => e.id), [], "elke epic heeft bestaande impl + test");
});

test("gate is ROOD tot de kern sluit (cutover/tx/e2e ontbreken)", () => {
  const m = buildTraceability({ repoRoot: ROOT, commitSha: "test" });
  assert.equal(m.gate.ok, false, "gate mag niet groen zijn zonder cutover/tx/e2e-bewijs");
  // R0 heeft de evidence, maar niet de cutover-condities → evidence-groen, gate-rood.
  const r0 = m.releases.find(r => r.id === "R0");
  assert.equal(r0.evidenceGreen, true);
  assert.equal(r0.gateGreen, false);
  // R1 wordt bovendien door R0 geblokkeerd (dependencyvolgorde).
  const r1 = m.releases.find(r => r.id === "R1");
  assert.ok(r1.blockedBy.includes("R0"));
});

test("R7 blijft bewust gated (geen epics gekoppeld)", () => {
  const m = buildTraceability({ repoRoot: ROOT, commitSha: "test" });
  const r7 = m.releases.find(r => r.id === "R7");
  assert.equal(r7.epicCount, 0);
  assert.equal(r7.gateGreen, false);
});

test("een ontbrekende evidence-koppeling maakt de epic ROOD (deleted test → red)", () => {
  // Bouw een lege repo-root met alleen de spec: geen enkel impl/test-bestand.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trace-"));
  fs.mkdirSync(path.join(tmp, "docs", "spec"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "docs/spec/developer-requirements.json"), path.join(tmp, "docs/spec/developer-requirements.json"));
  const ev = evaluateEpic(tmp, "E08");
  assert.equal(ev.status, "missing_evidence", "zonder de gekoppelde bestanden is E08 rood");
  assert.ok(ev.missing.length > 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("DoD is afgeleid, niet statisch: e2e-in-ci is eerlijk rood zolang CI het niet draait", () => {
  const m = buildTraceability({ repoRoot: ROOT, commitSha: "test" });
  const e2e = m.definitionOfDone.find(d => d.key === "e2e_in_ci");
  assert.ok(e2e, "DoD bevat de e2e-in-ci-check");
  // Deze flag flipt automatisch groen zodra ci.yml test:e2e aanroept (DEV-02).
  assert.equal(typeof e2e.ok, "boolean");
});

test("evidence-map dekt precies E01-E22", () => {
  assert.deepEqual(Object.keys(EVIDENCE).sort(), Array.from({ length: 22 }, (_, i) => `E${String(i + 1).padStart(2, "0")}`));
});
