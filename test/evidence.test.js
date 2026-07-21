"use strict";
// Bewijsartefact-validatie (CTO-review PR #41). Het bestaan van een bestand is
// geen bewijs: een artefact moet schema-correct zijn, status=pass hebben, bij de
// HUIDIGE commit horen en geen failures dragen.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { makeEvidence, validateEvidence, loadEvidence, EVIDENCE_SCHEMA_VERSION } = require("../src/modules/evidence");

function valid(over = {}) {
  const e = makeEvidence({ evidenceType: "cutover-reconcile", status: "pass", commitSha: "abc1234", counts: { rows: 3 }, ...over });
  e.generatedAt = "2026-07-21T10:00:00Z";
  return e;
}

test("geldig, commit-gebonden, geslaagd artefact wordt aanvaard", () => {
  const r = validateEvidence(valid(), { commitSha: "abc1234", evidenceType: "cutover-reconcile" });
  assert.equal(r.ok, true, r.reason);
});

test("verkeerde schemaVersion → ongeldig", () => {
  const e = valid(); e.schemaVersion = EVIDENCE_SCHEMA_VERSION + 99;
  assert.equal(validateEvidence(e, {}).ok, false);
});

test("verkeerd evidenceType → ongeldig", () => {
  assert.equal(validateEvidence(valid(), { evidenceType: "iets-anders" }).ok, false);
});

test("status=fail → ongeldig", () => {
  assert.equal(validateEvidence(valid({ status: "fail" }), {}).ok, false);
});

test("failures aanwezig → ongeldig", () => {
  const e = valid(); e.failures = [{ test: "x" }];
  assert.equal(validateEvidence(e, {}).ok, false);
});

test("commit-SHA-mismatch → ongeldig (oud bewijs telt niet)", () => {
  assert.equal(validateEvidence(valid({ commitSha: "abc1234" }), { commitSha: "deadbeef" }).ok, false);
  // Korte vs lange vorm van dezelfde commit is wél oké.
  assert.equal(validateEvidence(valid({ commitSha: "abc1234def567" }), { commitSha: "abc1234" }).ok, true);
});

test("ontbrekende verplichte velden → ongeldig", () => {
  const e = valid(); delete e.generatedAt;
  assert.equal(validateEvidence(e, {}).ok, false);
  const e2 = valid(); delete e2.counts;
  assert.equal(validateEvidence(e2, {}).ok, false);
});

test("loadEvidence: ontbrekend of niet-JSON bestand → ongeldig", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ev-"));
  assert.equal(loadEvidence(dir, "weg.json", {}).ok, false);
  fs.writeFileSync(path.join(dir, "rommel.json"), "{ niet: geldig ");
  assert.equal(loadEvidence(dir, "rommel.json", {}).ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
