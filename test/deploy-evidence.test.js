"use strict";
// CTO3-06 · deployment-evidence + P0 pilotgate. De gate-evaluatie is puur en dus
// met synthetische runtime-observaties te toetsen. De 6 verplichte scenario's uit
// de handover staan hieronder, plus de pilotgate-aggregatie CTO3-01..06.
const { test } = require("node:test");
const assert = require("node:assert");
const { evaluateDeployGate, computePilotGate, shaMatches } = require("../src/lib/deploy-evidence");

const SHA = "abc1234def";
// Een volledig GEZONDE productie-observatie (alles groen).
function healthy(over = {}) {
  return {
    candidateSha: SHA,
    buildTime: "2026-07-24T10:00:00Z",
    ready: {
      ok: true, status: "ready", commitSha: SHA, deploymentId: "dep-1",
      checks: {
        objectStorageAdapter: "s3", databaseSslMode: "verify-full", databaseCaCertPresent: true,
        singleWriter: true, migrationVersion: { applied: 12, total: 12 },
        sources: { crm: "legacy", identity: "legacy", finance: "legacy", company: "legacy", forms: "legacy" },
      },
    },
    health: { status: "ready", commitSha: SHA, deploymentId: "dep-1" },
    canary: { created: true, readBack: true, mutationSurvivedRestart: true, tenantId: "__canary__", id: "c1" },
    storageProof: { ok: true, key: "__canary__/canary/x.txt", bytes: 12, isolatedFromCustomers: true },
    expected: { objectStorageAdapters: ["s3", "azure-blob"], databaseSslMode: "verify-full", singleWriter: true },
    backup: { ok: true },
    ...over,
  };
}
const deepSet = (base, path, value) => { const o = JSON.parse(JSON.stringify(base)); let t = o; const p = path.split("."); while (p.length > 1) t = t[p.shift()]; t[p[0]] = value; return o; };

test("basislijn: een volledig gezonde observatie is groen", () => {
  const r = evaluateDeployGate(healthy());
  assert.equal(r.ok, true, JSON.stringify(r.failures));
});

test("1· oude SHA terwijl de kandidaat nieuwer is → evidence rood", () => {
  const r = evaluateDeployGate(deepSet(healthy(), "ready.commitSha", "0000oldsha"));
  assert.equal(r.ok, false);
  assert.ok(r.failures.some(f => f.check === "sha_match"), JSON.stringify(r.failures));
});

test("2· readiness 503 → evidence rood", () => {
  let o = deepSet(healthy(), "ready.ok", false);
  o = deepSet(o, "ready.status", "flushing");
  const r = evaluateDeployGate(o);
  assert.equal(r.ok, false);
  assert.ok(r.failures.some(f => f.check === "readiness"), JSON.stringify(r.failures));
});

test("3· s3 verwacht maar runtime meldt local → evidence rood", () => {
  const r = evaluateDeployGate(deepSet(healthy(), "ready.checks.objectStorageAdapter", "local"));
  assert.equal(r.ok, false);
  assert.ok(r.failures.some(f => f.check === "object_storage_adapter"), JSON.stringify(r.failures));
});

test("4· canarymutatie ontbreekt na restart → evidence rood", () => {
  const r = evaluateDeployGate(deepSet(healthy(), "canary.mutationSurvivedRestart", false));
  assert.equal(r.ok, false);
  assert.ok(r.failures.some(f => f.check === "canary_survived_restart"), JSON.stringify(r.failures));
});

test("5· CA-presentie ontbreekt bij verify-full → evidence rood", () => {
  const r = evaluateDeployGate(deepSet(healthy(), "ready.checks.databaseCaCertPresent", false));
  assert.equal(r.ok, false);
  assert.ok(r.failures.some(f => f.check === "db_ca_present"), JSON.stringify(r.failures));
});

test("6· alle checks groen (staging → productie): gate + pilotgate groen", () => {
  const gate = evaluateDeployGate(healthy());
  assert.equal(gate.ok, true);
  const pilot = computePilotGate(gate, { restoreDrillOk: true, e2eManifestOk: true, contractOk: true });
  assert.equal(pilot.ok, true, JSON.stringify(pilot.blocked));
  assert.equal(pilot.items.length, 6);
  assert.ok(pilot.items.every(i => /^CTO3-0[1-6]$/.test(i.code)));
});

test("pilotgate is fail-closed: ontbrekend DR- of e2e-bewijs blokkeert", () => {
  const gate = evaluateDeployGate(healthy());
  const noDR = computePilotGate(gate, { restoreDrillOk: false, e2eManifestOk: true, contractOk: true });
  assert.equal(noDR.ok, false);
  assert.ok(noDR.blocked.includes("CTO3-03"));
  const noE2E = computePilotGate(gate, { restoreDrillOk: true, e2eManifestOk: false, contractOk: true });
  assert.ok(noE2E.blocked.includes("CTO3-04"));
});

test("pilotgate CTO3-06 volgt de deploy-gate; een rode deploy-gate blokkeert de pilot", () => {
  const badGate = evaluateDeployGate(deepSet(healthy(), "canary.mutationSurvivedRestart", false));
  const pilot = computePilotGate(badGate, { restoreDrillOk: true, e2eManifestOk: true, contractOk: true });
  assert.equal(pilot.ok, false);
  assert.ok(pilot.blocked.includes("CTO3-06"));
  // CTO3-01 leunt óók op de canary, dus die blokkeert mee.
  assert.ok(pilot.blocked.includes("CTO3-01"));
});

test("shaMatches: kort vs lang, en te-kort faalt", () => {
  assert.equal(shaMatches("abc1234", "abc1234def567"), true);
  assert.equal(shaMatches("abc1234def567", "abc1234"), true);
  assert.equal(shaMatches("abc", "abc1234"), false);
  assert.equal(shaMatches("", "abc1234"), false);
  assert.equal(shaMatches("abc1234", "xyz9999"), false);
});
