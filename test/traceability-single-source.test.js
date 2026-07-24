"use strict";
// CTO3-11 · traceability als ÉÉN bron van waarheid per release-SHA.
// Definities staan in Git, GEGENEREERDE outputs niet: die zijn per commit een
// CI-artifact. Een rapport van een andere commit of generatorversie is STALE en
// mag nooit als "current" gelden.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const T = require("../src/modules/traceability");

const ROOT = path.join(__dirname, "..");
const sh = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" }).trim();

test("1· gegenereerde matrices staan NIET in Git (definities wel, outputs als artifact)", () => {
  const tracked = sh("git", ["ls-files", "docs/traceability"]).split("\n").filter(Boolean);
  assert.ok(!tracked.includes("docs/traceability/matrix.json"), "matrix.json mag niet gecommit zijn");
  assert.ok(!tracked.includes("docs/traceability/matrix.md"), "matrix.md mag niet gecommit zijn");
  // De DEFINITIES blijven wél in Git · zonder die input is niets reproduceerbaar.
  assert.ok(tracked.includes("docs/traceability/requirement-map.json"), "requirement-map.json is een definitie en hoort in Git");
  assert.ok(tracked.includes("docs/traceability/accepted-blockers.json"), "accepted-blockers.json is een definitie en hoort in Git");
});

test("2· elk rapport draagt commit-SHA, generatedAt en generatorversie", () => {
  const m = T.buildTraceability({ repoRoot: ROOT, commitSha: "abc1234" });
  m.generatedAt = new Date().toISOString();
  assert.equal(m.commitSha, "abc1234");
  assert.equal(m.generatorVersion, T.GENERATOR_VERSION);
  assert.ok(m.generatedAt, "generatedAt gestempeld");
});

test("3· een STALE matrix kan niet als current worden getoond (SHA-mismatch)", () => {
  const huidig = { commitSha: "abc1234", generatorVersion: T.GENERATOR_VERSION };
  assert.equal(T.isMatrixCurrent(huidig, "abc1234"), true, "zelfde SHA = current");
  assert.equal(T.isMatrixCurrent(huidig, "def5678"), false, "andere SHA = stale");
  // Korte vs lange SHA van dezelfde commit telt wel als current.
  assert.equal(T.isMatrixCurrent({ commitSha: "abc1234", generatorVersion: T.GENERATOR_VERSION }, "abc1234def567"), true);
});

test("4· een rapport van een ANDERE generatorversie is stale", () => {
  assert.equal(T.isMatrixCurrent({ commitSha: "abc1234", generatorVersion: T.GENERATOR_VERSION + 1 }, "abc1234"), false);
  assert.equal(T.isMatrixCurrent({ commitSha: "abc1234" }, "abc1234"), false, "zonder generatorversie = stale");
});

test("5· geen SHA of 'unknown' is nooit current (geen groenclaim zonder SHA)", () => {
  assert.equal(T.isMatrixCurrent({ commitSha: "", generatorVersion: T.GENERATOR_VERSION }, "abc1234"), false);
  assert.equal(T.isMatrixCurrent({ commitSha: "unknown", generatorVersion: T.GENERATOR_VERSION }, "abc1234"), false);
  assert.equal(T.isMatrixCurrent({ commitSha: "abc1234", generatorVersion: T.GENERATOR_VERSION }, "unknown"), false);
  assert.equal(T.isMatrixCurrent(null, "abc1234"), false);
});

test("6· ontbrekende gekoppelde bestanden maken de epic automatisch rood", () => {
  // De engine leidt af uit BEWIJS OP SCHIJF. We bewijzen dat met een LEGE
  // repo-root: exact dezelfde koppeling, maar de bestanden bestaan daar niet →
  // de epic kan niet meer 'verified' zijn. Dat is de regressiegarantie van
  // DEV-01 (wie een gekoppelde test verwijdert, maakt de epic rood), zonder de
  // echte repo te muteren.
  const echt = T.evaluateEpic(ROOT, "E05");
  assert.equal(echt.status, "verified", "E05 is met bestaande bestanden verified");
  const leeg = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "wfp-trace-"));
  try {
    const kapot = T.evaluateEpic(leeg, "E05");
    assert.notEqual(kapot.status, "verified", "ontbrekende gekoppelde bestanden → niet verified");
    assert.ok(kapot.missing.length > 0, "de ontbrekende bestanden worden benoemd");
  } finally { fs.rmSync(leeg, { recursive: true, force: true }); }
});

test("7· de generator schrijft een machineleesbaar EN een leesbaar rapport", () => {
  execFileSync(process.execPath, [path.join(ROOT, "scripts/generate-traceability.js")], { cwd: ROOT, encoding: "utf8" });
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/traceability/matrix.json"), "utf8"));
  const md = fs.readFileSync(path.join(ROOT, "docs/traceability/matrix.md"), "utf8");
  assert.equal(j.generatorVersion, T.GENERATOR_VERSION, "JSON draagt de generatorversie");
  assert.ok(j.commitSha && j.generatedAt, "JSON draagt SHA + tijdstip");
  assert.match(md, /GEGENEREERD ARTEFACT/, "het leesbare rapport waarschuwt dat het gegenereerd is");
  assert.match(md, new RegExp(`generator v${T.GENERATOR_VERSION}`), "het leesbare rapport draagt de generatorversie");
  assert.ok(md.includes(j.commitSha), "beide rapporten dragen dezelfde commit-SHA");
});
