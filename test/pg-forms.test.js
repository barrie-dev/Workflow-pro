"use strict";
// Forms F1 · pg-integratie: canonieke lifecycle end-to-end tegen echte PostgreSQL.
// Bewijst FORM-01 (datamodel + RLS), FORM-02 (immutable publish, oude instances
// blijven op hun versie), FORM-04 (instance lifecycle, idempotente submit,
// validatie) en FORM-07 (segregation of duties). Slaat over zonder DATABASE_URL.
const { test } = require("node:test");
const assert = require("node:assert");

const LIVE = process.env.DATABASE_URL || "";
if (!LIVE || !/^postgres/.test(LIVE)) {
  test("pg-forms: DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  const { Pool } = require("pg");
  const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
  const { makePgFormsRepository } = require("../src/infrastructure/postgres/pg-forms-repository");

  const ssl = /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: LIVE, ssl });
  const repo = makePgFormsRepository(pool);
  const T = "t_forms_a", T2 = "t_forms_b";

  async function clean() {
    for (const t of [T, T2]) await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [t]); // CASCADE ruimt de rest
  }

  test("setup", async () => {
    await runMigrations(pool);
    for (const t of [T, T2]) await pool.query("INSERT INTO tenants (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [t, "Forms " + t]);
    await clean();
  });

  const STRUCT = {
    sections: [{ key: "main", title: { nl: "Hoofd" } }],
    fields: [
      { field_key: "reason", section_key: "main", field_type: "text", required: "required", label: { nl: "Reden" } },
      { field_key: "amount", section_key: "main", field_type: "number", required: "optional", validation: { min: 0 }, reporting_allowed: true },
      { field_key: "cost_price", section_key: "main", field_type: "number", data_classification: "financial", view_permission: "field.cost_price.view" },
    ],
  };

  test("FORM-02: definitie → structuur → publiceren = immutable; current_version gezet", async () => {
    await clean();
    const def = await repo.createDefinition(T, { key: "PUR-001", name: "Aankoopaanvraag", form_type: "workflow", domain_object: "purchase" }, "admin@a");
    assert.ok(def.id && def.draftVersionId);
    await repo.setDraftStructure(T, def.id, STRUCT, "admin@a");
    const pub = await repo.publishVersion(T, def.id, "admin@a");
    assert.equal(pub.published, true);
    const d = await repo.getDefinition(T, def.id);
    assert.equal(d.current_version, 1);
    // Na publicatie is er geen draft meer → structuur bewerken faalt tot nieuwe versie.
    await assert.rejects(() => repo.setDraftStructure(T, def.id, STRUCT, "admin@a"), e => e.code === "NO_DRAFT_VERSION");
    // Nieuwe versie kan wel.
    const v2 = await repo.createNewVersion(T, def.id, "admin@a");
    assert.equal(v2.versionNumber, 2);
    await assert.rejects(() => repo.createNewVersion(T, def.id, "admin@a"), e => e.code === "DRAFT_ALREADY_OPEN");
  });

  test("FORM-04: instance lifecycle · draft → submit (422 zonder verplicht) → idempotent", async () => {
    await clean();
    const def = await repo.createDefinition(T, { key: "PUR-002", name: "Aankoop 2", form_type: "workflow" }, "u1");
    await repo.setDraftStructure(T, def.id, STRUCT, "u1");
    await repo.publishVersion(T, def.id, "u1");
    // Instance kan pas na publicatie.
    const inst = await repo.createInstance(T, { definition_id: def.id, subject_type: "purchase", subject_id: "po_1" }, "emp");
    assert.equal(inst.status, "draft");
    await repo.saveDraft(T, inst.id, { answers: { amount: 50 }, expectedVersion: 1 }, "emp");
    // Submit zonder verplichte 'reason' → 422 met fieldErrors.
    await assert.rejects(() => repo.submitInstance(T, inst.id, {}, "emp"), e => e.code === "VALIDATION_FAILED" && e.fieldErrors.reason === "verplicht");
    // Met reason → submitted.
    const s = await repo.submitInstance(T, inst.id, { answers: { reason: "nieuwe boormachine" }, idempotencyKey: "k1" }, "emp");
    assert.equal(s.status, "submitted");
    // Idempotent: tweede submit met dezelfde sleutel maakt geen tweede submit.
    const s2 = await repo.submitInstance(T, inst.id, { idempotencyKey: "k1" }, "emp");
    assert.equal(s2.idempotent, true);
    // Typed index gevuld voor reporting.
    const idx = await pool.query("SELECT field_key, value_num, reporting_allowed FROM form_answer_index WHERE tenant_id=$1 AND instance_id=$2", [T, inst.id]);
    const amt = idx.rows.find(r => r.field_key === "amount");
    assert.ok(amt && Number(amt.value_num) === 50 && amt.reporting_allowed === true);
  });

  test("FORM-07: approval met segregation of duties · geen zelfgoedkeuring", async () => {
    await clean();
    const def = await repo.createDefinition(T, { key: "PUR-003", name: "Aankoop 3", form_type: "workflow" }, "u1");
    await repo.setDraftStructure(T, def.id, STRUCT, "u1");
    await repo.publishVersion(T, def.id, "u1");
    const inst = await repo.createInstance(T, { definition_id: def.id }, "emp"); // created_by = emp
    await repo.submitInstance(T, inst.id, { answers: { reason: "x" } }, "emp");
    // De indiener mag niet zelf goedkeuren.
    await assert.rejects(() => repo.actOnApproval(T, inst.id, { decision: "approved", hasApproveRight: true }, "emp"), e => e.code === "SOD_SELF_APPROVAL");
    // CTO2-04: zonder goedkeuringsrecht komt zelfs een andere actor er niet in.
    await assert.rejects(() => repo.actOnApproval(T, inst.id, { decision: "approved" }, "mgr"), e => e.code === "APPROVAL_RIGHT_REQUIRED");
    // Een andere actor mag wel → approved.
    const a = await repo.actOnApproval(T, inst.id, { decision: "approved", note: "akkoord", hasApproveRight: true }, "mgr");
    assert.equal(a.status, "approved");
    // approved → completed via de state-machine.
    const c = await repo.transition(T, inst.id, "completed", "mgr");
    assert.equal(c.status, "completed");
    const events = await repo.listEvents(T, inst.id);
    assert.ok(events.some(e => e.event_type === "submitted") && events.some(e => e.event_type === "approved") && events.some(e => e.event_type === "completed"));
  });

  test("FORM-02: bestaande instance blijft op zijn originele versie na nieuwe publicatie", async () => {
    await clean();
    const def = await repo.createDefinition(T, { key: "PUR-004", name: "Aankoop 4", form_type: "workflow" }, "u1");
    await repo.setDraftStructure(T, def.id, STRUCT, "u1");
    await repo.publishVersion(T, def.id, "u1");
    const inst = await repo.createInstance(T, { definition_id: def.id }, "emp");
    const v1 = (await repo.getInstance(T, inst.id)).version_id;
    // Nieuwe versie + publiceren.
    await repo.createNewVersion(T, def.id, "u1");
    await repo.publishVersion(T, def.id, "u1");
    const still = (await repo.getInstance(T, inst.id)).version_id;
    assert.equal(still, v1, "de instance blijft aan versie 1 gekoppeld");
    const d = await repo.getDefinition(T, def.id);
    assert.equal(d.current_version, 2, "nieuwe instances gebruiken versie 2");
  });

  test("FORM-01: RLS-tenantisolatie · tenant B ziet de definitie van A niet", async () => {
    await clean();
    const def = await repo.createDefinition(T, { key: "ISO-001", name: "Iso", form_type: "survey" }, "u1");
    // Via de repo (RLS-scope B): niet zichtbaar.
    const listB = await repo.listDefinitions(T2);
    assert.equal(listB.some(d => d.id === def.id), false, "tenant B ziet A's definitie niet");
    const getB = await repo.getDefinition(T2, def.id);
    assert.equal(getB, null);
    // Binnen A wél.
    assert.ok((await repo.listDefinitions(T)).some(d => d.id === def.id));
    await clean();
    await pool.end();
  });
}
