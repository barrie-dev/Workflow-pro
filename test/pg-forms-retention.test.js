"use strict";
// F6 reporting + h27 retentie. Bewijst: (1) het rapport bevat enkel
// reporting_allowed-velden en respecteert veldrechten; ai-consumer krijgt enkel
// ai_allowed; (2) de retentie-purge archiveert/anonimiseert/verwijdert volgens
// het beleid en respecteert legal hold. Slaat over zonder DATABASE_URL.
const { test } = require("node:test");
const assert = require("node:assert");

const LIVE = process.env.DATABASE_URL || "";
if (!LIVE || !/^postgres/.test(LIVE)) {
  test("pg-forms-retention: DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  const { Pool } = require("pg");
  const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
  const { makePgFormsRepository } = require("../src/infrastructure/postgres/pg-forms-repository");

  const ssl = /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: LIVE, ssl });
  const repo = makePgFormsRepository(pool);
  const T = "t_formsret";
  const admin = { email: "admin@r", role: "tenant_admin", permissions: [] };
  const emp = { email: "emp@r", role: "employee", permissions: [] };

  const STRUCT = {
    sections: [{ key: "main", title: { nl: "Hoofd" } }],
    fields: [
      { field_key: "reason", section_key: "main", field_type: "text", required: "required", reporting_allowed: true, ai_allowed: true },
      { field_key: "amount", section_key: "main", field_type: "number", reporting_allowed: true, ai_allowed: false },
      { field_key: "cost_price", section_key: "main", field_type: "number", data_classification: "financial", view_permission: "field.cost_price.view", reporting_allowed: true },
      { field_key: "secret_note", section_key: "main", field_type: "text", reporting_allowed: false, ai_allowed: false },
    ],
  };

  let defId, cleanupPolicy;

  test("setup", async () => {
    await runMigrations(pool);
    await pool.query("INSERT INTO tenants (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [T, "Forms retentie"]);
    await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [T]);
    await pool.query("DELETE FROM retention_policies WHERE tenant_id=$1", [T]);
    // Beleid: 30 dagen, anonimiseren.
    await pool.query(
      `INSERT INTO retention_policies (id, tenant_id, key, name, retention_days, keep_minimum, purge_strategy)
       VALUES ('rp_anon',$1,'anon-30','Anonimiseer na 30d',30,0,'anonymize')`, [T]);
    const def = await repo.createDefinition(T, { key: "RET-001", name: "Retentietest", form_type: "survey", retention_policy_id: "rp_anon" }, "admin@r");
    defId = def.id;
    await repo.setDraftStructure(T, defId, STRUCT, "admin@r");
    await repo.publishVersion(T, defId, "admin@r");
  });

  test("F6 · rapport respecteert reporting_allowed + veldrechten; ai-consumer enkel ai_allowed", async () => {
    const inst = await repo.createInstance(T, { definition_id: defId }, "emp@r");
    await repo.submitInstance(T, inst.id, { answers: { reason: "audit", amount: 120, cost_price: 55, secret_note: "prive" } }, "emp@r");
    await repo.transition(T, inst.id, "completed", "mgr@r");

    // Beheerder: reporting_allowed-velden (reason, amount, cost_price) · nooit secret_note.
    const rep = await repo.reportOnDefinition(T, defId, { user: admin });
    const keys = new Set(rep.rows.map(r => r.field_key));
    assert.ok(keys.has("reason") && keys.has("amount") && keys.has("cost_price"));
    assert.equal(keys.has("secret_note"), false, "reporting_allowed=false blijft buiten elk rapport");
    assert.equal(rep.aggregates.amount.sum, 120);

    // Employee zonder veldrecht: cost_price valt weg (zelfde beslissing als het scherm).
    const repEmp = await repo.reportOnDefinition(T, defId, { user: emp });
    assert.equal(new Set(repEmp.rows.map(r => r.field_key)).has("cost_price"), false);

    // AI-consumer: enkel ai_allowed (reason wél, amount niet).
    const repAi = await repo.reportOnDefinition(T, defId, { user: admin, aiConsumer: true });
    const aiKeys = new Set(repAi.rows.map(r => r.field_key));
    assert.ok(aiKeys.has("reason"));
    assert.equal(aiKeys.has("amount"), false, "ai_allowed=false blijft buiten AI");
  });

  test("h27 · retentie anonimiseert verlopen instances; legal hold beschermt", async () => {
    // Maak de bestaande completed-instance kunstmatig oud (40 dagen).
    await pool.query(`UPDATE form_instances SET created_at = now() - interval '40 days' WHERE tenant_id=$1`, [T]);
    // Dry-run toont de kandidaat zonder te wijzigen.
    const dry = await repo.applyRetention(T, { dryRun: true });
    assert.ok(dry.actions.length >= 1);
    assert.equal(dry.actions[0].applied, false);
    // Echte run: geanonimiseerd → antwoorden + index leeg, status archived.
    const run = await repo.applyRetention(T);
    const done = run.actions.find(a => a.applied);
    assert.ok(done && done.strategy === "anonymize");
    const inst = await repo.getInstance(T, done.instance);
    assert.equal(inst.status, "archived");
    assert.deepEqual(inst.answers, {}, "antwoorden geanonimiseerd");
    const idx = await pool.query(`SELECT count(*)::int AS n FROM form_answer_index WHERE tenant_id=$1 AND instance_id=$2`, [T, done.instance]);
    assert.equal(idx.rows[0].n, 0, "typed index leeg");

    // Legal hold: nieuw beleid + instance → geen purge.
    await pool.query(`UPDATE retention_policies SET legal_hold=true WHERE tenant_id=$1 AND id='rp_anon'`, [T]);
    const inst2 = await repo.createInstance(T, { definition_id: defId }, "emp@r");
    await repo.submitInstance(T, inst2.id, { answers: { reason: "hold" } }, "emp@r");
    await repo.transition(T, inst2.id, "completed", "mgr@r");
    await pool.query(`UPDATE form_instances SET created_at = now() - interval '90 days' WHERE tenant_id=$1 AND id=$2`, [T, inst2.id]);
    const held = await repo.applyRetention(T);
    assert.equal(held.actions.length, 0, "legal hold bevriest de purge");

    await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [T]);
    await pool.query("DELETE FROM retention_policies WHERE tenant_id=$1", [T]);
    await pool.end();
  });
}
