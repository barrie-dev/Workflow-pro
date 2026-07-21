"use strict";

// ── Bewijsartefact-schema + validatie (CTO-review PR #41, DEV-01) ────────────
// De vorige gate keurde condities groen op BESTANDSAANWEZIGHEID. Een leeg of
// willekeurig JSON-bestand kon zo een release-conditie groen maken. Dat is
// vals-groen en precies wat de CTO blokkeert.
//
// Elk bewijsartefact is nu een gestructureerd document dat door een UITVOERENDE
// job wordt geschreven en INHOUDELIJK wordt gevalideerd. Kernregels:
//   * schemaVersion + evidenceType moeten kloppen;
//   * status moet "pass" zijn;
//   * commitSha moet de HUIDIGE commit zijn (oud bewijs telt niet);
//   * verplichte velden aanwezig (generatedAt, counts, ...).
// Faalt één regel, dan is het bewijs ONGELDIG en blijft de conditie ROOD.

const fs = require("fs");
const path = require("path");

const EVIDENCE_SCHEMA_VERSION = 1;
const EVIDENCE_DIR = "docs/traceability/evidence";
const REQUIRED_FIELDS = ["schemaVersion", "evidenceType", "status", "commitSha", "generatedAt", "counts"];

/** Bouw een bewijsartefact (aanroepers: uitvoerende jobs/scripts). */
function makeEvidence({ evidenceType, status, commitSha, branch = null, environment = null,
  executedBy = "ci", inputset = null, result = null, counts = {}, failures = [], artifactRefs = [] } = {}) {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    evidenceType: String(evidenceType || ""),
    status: status === "pass" ? "pass" : "fail",
    commitSha: String(commitSha || ""),
    branch: branch || null,
    environment: environment || null,
    executedBy: String(executedBy || "ci"),
    generatedAt: null,          // stempel na afloop (Date.now vermijden in pure code); script vult in
    inputset: inputset || null,
    result: result || null,
    counts: counts && typeof counts === "object" ? counts : {},
    failures: Array.isArray(failures) ? failures : [],
    artifactRefs: Array.isArray(artifactRefs) ? artifactRefs : [],
  };
}

/**
 * Valideer een bewijsobject tegen het schema + de verwachte context.
 * @returns {{ok:boolean, reason:string, evidence?:object}}
 */
function validateEvidence(obj, { commitSha = null, evidenceType = null } = {}) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, reason: "geen object" };
  for (const f of REQUIRED_FIELDS) {
    if (!(f in obj)) return { ok: false, reason: `veld ontbreekt: ${f}` };
  }
  if (obj.schemaVersion !== EVIDENCE_SCHEMA_VERSION) return { ok: false, reason: `schemaVersion ${obj.schemaVersion} ≠ ${EVIDENCE_SCHEMA_VERSION}` };
  if (evidenceType && obj.evidenceType !== evidenceType) return { ok: false, reason: `evidenceType '${obj.evidenceType}' ≠ '${evidenceType}'` };
  if (obj.status !== "pass") return { ok: false, reason: `status is '${obj.status}', niet 'pass'` };
  if (!obj.commitSha) return { ok: false, reason: "commitSha leeg" };
  // Oud bewijs mag de huidige gate niet groen maken: SHA moet matchen (korte of
  // lange vorm; we vergelijken op de kortste gemeenschappelijke lengte).
  if (commitSha) {
    const a = String(obj.commitSha), b = String(commitSha);
    const n = Math.min(a.length, b.length, 40);
    if (n < 7 || a.slice(0, n) !== b.slice(0, n)) {
      return { ok: false, reason: `commitSha ${a.slice(0, 12)} hoort niet bij huidige ${b.slice(0, 12)}` };
    }
  }
  if (!obj.generatedAt) return { ok: false, reason: "generatedAt leeg" };
  if (Array.isArray(obj.failures) && obj.failures.length > 0) return { ok: false, reason: `${obj.failures.length} failure(s) in bewijs` };
  return { ok: true, reason: "geldig", evidence: obj };
}

/** Laad + valideer een bewijsbestand. Ontbrekend/onleesbaar = ongeldig (rood). */
function loadEvidence(repoRoot, relPath, ctx = {}) {
  let raw;
  try { raw = fs.readFileSync(path.join(repoRoot, relPath), "utf8"); }
  catch (_) { return { ok: false, reason: "bestand ontbreekt", path: relPath }; }
  let obj;
  try { obj = JSON.parse(raw); }
  catch (_) { return { ok: false, reason: "geen geldige JSON", path: relPath }; }
  const res = validateEvidence(obj, ctx);
  return { ...res, path: relPath };
}

/** Standaardpad voor een bewijstype. */
function evidencePath(name) { return `${EVIDENCE_DIR}/${name}.json`; }

module.exports = {
  EVIDENCE_SCHEMA_VERSION, EVIDENCE_DIR, REQUIRED_FIELDS,
  makeEvidence, validateEvidence, loadEvidence, evidencePath,
};
