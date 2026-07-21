"use strict";
// Migratie-orchestrator (CTO P0-01 sluitstuk): dependency-volgorde, aggregatie
// van reconciliatie over alle domeinen, en het faalgedrag (één afwijkend
// domein maakt het geheel niet-cutover-gereed).
const { test } = require("node:test");
const assert = require("node:assert");

const { makeMigrationOrchestrator } = require("../src/infrastructure/migration-orchestrator");

/** Fake bron die syncs/reconciles registreert in een gedeeld logboek. */
function fakeSource(name, { reconcileOk = true, log } = {}) {
  return {
    mode: "shadow",
    async syncNow({ force } = {}) { log.push(`sync:${name}${force ? ":force" : ""}`); return { synced: name }; },
    async reconcile() { log.push(`reconcile:${name}`); return { ok: reconcileOk, checked: 1 }; },
    status() { return { mode: "shadow", name }; },
  };
}

test("orchestrator: synct en reconcilieert in dependency-volgorde", async () => {
  const log = [];
  const orch = makeMigrationOrchestrator({
    domains: [
      { name: "finance", source: fakeSource("finance", { log }), dependsOn: ["identity", "company"] },
      { name: "company", source: fakeSource("company", { log }), dependsOn: ["identity"] },
      { name: "identity", source: fakeSource("identity", { log }) },
    ],
  });
  assert.deepEqual(orch.order, ["identity", "company", "finance"], "topologische volgorde ongeacht invoervolgorde");

  const rec = await orch.reconcileAll();
  assert.equal(rec.ok, true);
  assert.deepEqual(rec.order, ["identity", "company", "finance"]);
  // Elk domein: eerst force-sync, dan reconcile · en identity vóór company vóór finance.
  assert.deepEqual(log, [
    "sync:identity:force", "reconcile:identity",
    "sync:company:force", "reconcile:company",
    "sync:finance:force", "reconcile:finance",
  ]);
  assert.equal(rec.domains.finance.ok, true);
});

test("orchestrator: één afwijkend domein maakt het geheel niet-gereed", async () => {
  const log = [];
  const orch = makeMigrationOrchestrator({
    domains: [
      { name: "identity", source: fakeSource("identity", { log }) },
      { name: "company", source: fakeSource("company", { reconcileOk: false, log }), dependsOn: ["identity"] },
      { name: "finance", source: fakeSource("finance", { log }), dependsOn: ["company"] },
    ],
  });
  const rec = await orch.reconcileAll();
  assert.equal(rec.ok, false, "company wijkt af → geheel niet-cutover-gereed");
  assert.equal(rec.domains.company.ok, false);
  assert.equal(rec.domains.identity.ok, true, "de andere domeinen worden nog steeds gerapporteerd");
  assert.equal(rec.domains.finance.ok, true);
});

test("orchestrator: een gooiende bron degradeert netjes tot ok:false", async () => {
  const log = [];
  const broken = { mode: "pg",
    async syncNow() { throw new Error("pg weg"); },
    async reconcile() { return { ok: true }; },
    status() { return { mode: "pg" }; } };
  const orch = makeMigrationOrchestrator({
    domains: [
      { name: "identity", source: fakeSource("identity", { log }) },
      { name: "finance", source: broken, dependsOn: ["identity"] },
    ],
  });
  const rec = await orch.reconcileAll();
  assert.equal(rec.ok, false);
  assert.match(rec.domains.finance.error, /pg weg/);
  assert.equal(rec.domains.identity.ok, true);
});

test("orchestrator: info-domeinen (CRM) worden informatief meegenomen", async () => {
  const log = [];
  const orch = makeMigrationOrchestrator({
    domains: [{ name: "identity", source: fakeSource("identity", { log }) }],
    info: { crm: () => ({ source: "shadow", dualWrite: true }) },
  });
  const st = orch.status();
  assert.equal(st.info.crm.source, "shadow");
  const rec = await orch.reconcileAll();
  assert.equal(rec.info.crm.dualWrite, true, "info-status reist mee in het reconciliatierapport");
});

test("orchestrator: syncAll respecteert de volgorde en geeft per-domein resultaat", async () => {
  const log = [];
  const orch = makeMigrationOrchestrator({
    domains: [
      { name: "company", source: fakeSource("company", { log }), dependsOn: ["identity"] },
      { name: "identity", source: fakeSource("identity", { log }) },
    ],
  });
  const res = await orch.syncAll({ force: true });
  assert.deepEqual(log, ["sync:identity:force", "sync:company:force"]);
  assert.equal(res.identity.synced, "identity");
  assert.equal(res.company.synced, "company");
});
