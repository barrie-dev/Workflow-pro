"use strict";
// CTO2-08 · Forms-cutover: inventaris → migratie → reconciliatie. Bewijst dat de
// legacy work-os forms FAITHFUL naar de canonieke engine gaan, idempotent, en
// dat reconcile de cutover poortwachtert (ready pas als alles gemigreerd is).
// Slaat over zonder DATABASE_URL.
const { test } = require("node:test");
const assert = require("node:assert");
const cutover = require("../src/modules/forms-cutover");

// ── Pure mapping (draait altijd) ──
test("structureFromTemplate · secties + velden + type/required-mapping", () => {
  const tpl = { sections: [
    { id: "s1", title: "Veiligheid", questions: [
      { id: "q1", label: "Naam", type: "text", required: true },
      { id: "q2", label: "Aantal", type: "number" },
      { id: "q3", label: "Datum", type: "date" },
      { id: "q4", label: "Handtekening", type: "signature" },
    ] },
  ] };
  const s = cutover.structureFromTemplate(tpl);
  assert.equal(s.sections.length, 1);
  assert.equal(s.sections[0].key, "s1");
  const byKey = Object.fromEntries(s.fields.map(f => [f.field_key, f]));
  assert.equal(byKey.q1.field_type, "text");
  assert.equal(byKey.q1.required, "required");
  assert.equal(byKey.q2.field_type, "number");
  assert.equal(byKey.q3.field_type, "date");
  assert.equal(byKey.q4.field_type, "text", "signature → text");
  assert.equal(byKey.q2.required, "optional");
});

const LIVE = process.env.DATABASE_URL || "";
if (!LIVE || !/^postgres/.test(LIVE)) {
  test("pg-forms-cutover: DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  const { Pool } = require("pg");
  const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
  const { makePgFormsRepository } = require("../src/infrastructure/postgres/pg-forms-repository");

  const ssl = /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: LIVE, ssl });
  const repo = makePgFormsRepository(pool);
  const T = "t_cutover";

  // Mini-store-dubbel met legacy formTemplates + formInstances.
  function legacyStore() {
    const data = {
      formTemplates: [
        { id: "tpl_1", tenantId: T, key: "veiligheidscheck", name: "Veiligheidscheck", status: "published",
          sections: [{ id: "s1", title: "Check", questions: [
            { id: "q_ok", label: "Alles in orde?", type: "bool", required: true },
            { id: "q_opm", label: "Opmerking", type: "text" },
          ] }] },
        { id: "tpl_2", tenantId: T, key: "oud", name: "Oud formulier", status: "archived",
          sections: [{ id: "s1", title: "X", questions: [{ id: "q1", label: "V", type: "text" }] }] },
      ],
      formInstances: [
        { id: "fi_1", tenantId: T, templateId: "tpl_1", status: "submitted",
          context: { entityType: "workorder", entityId: "wo_9" },
          answers: { q_ok: true, q_opm: "niets", q_verdwenen: "onbekend veld" }, // laatste is unmapped
          createdBy: "jan@t", submittedAt: "2026-07-01T10:00:00Z" },
        { id: "fi_2", tenantId: T, templateId: "tpl_1", status: "draft",
          context: { entityType: "workorder", entityId: "wo_9" }, answers: { q_ok: false } },
      ],
    };
    return { data, list: (coll, tid) => (data[coll] || []).filter(r => !tid || r.tenantId === tid) };
  }

  test("setup", async () => {
    await runMigrations(pool);
    await pool.query("INSERT INTO tenants (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [T, "Cutover"]);
    await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [T]);
  });

  test("inventory telt legacy templates + instances per status", () => {
    const inv = cutover.inventoryLegacyForms(legacyStore(), T);
    assert.equal(inv.templates.total, 2);
    assert.equal(inv.templates.byStatus.published, 1);
    assert.equal(inv.templates.byStatus.archived, 1);
    assert.equal(inv.instances.total, 2);
    assert.equal(inv.instances.byStatus.submitted, 1);
    assert.equal(inv.instances.byStatus.draft, 1);
  });

  test("reconcile vóór migratie · NIET ready (alle legacy-rijen ontbreken)", async () => {
    const rec = await cutover.reconcileForms({ store: legacyStore(), repo, tenantId: T });
    assert.equal(rec.ready, false);
    assert.equal(rec.templates.missing.length, 2);
    assert.equal(rec.instances.missing.length, 2);
  });

  test("migratie · faithful (antwoorden + status + unmapped), dan reconcile GROEN", async () => {
    const store = legacyStore();
    const r = await cutover.migrateLegacyForms({ store, repo, tenantId: T });
    assert.equal(r.definitions.created, 2);
    assert.equal(r.instances.created, 2);
    assert.equal(r.instances.unmappedFields, 1, "q_verdwenen is niet gemapt maar niet verloren");

    // De submitted-invulling is canoniek 'submitted' met de gemapte antwoorden.
    const refs = await repo.externalRefs(T);
    const canonInstId = refs.instances.get("fi_1");
    assert.ok(canonInstId);
    const inst = await repo.getInstance(T, canonInstId);
    assert.equal(inst.status, "submitted");
    assert.equal(inst.subject_type, "workorder");
    assert.equal(inst.answers.q_ok, true);
    assert.equal("q_verdwenen" in inst.answers, false, "onbekend veld niet als antwoord geschreven");
    // Het unmapped veld staat in het legacy.imported-event (controlled note).
    const events = await repo.listEvents(T, canonInstId);
    const ev = events.find(e => e.event_type === "legacy.imported");
    assert.ok(ev.data.unmapped && ev.data.unmapped.q_verdwenen === "onbekend veld");

    // Reconcile is nu GROEN.
    const rec = await cutover.reconcileForms({ store, repo, tenantId: T });
    assert.equal(rec.ready, true);
    assert.equal(rec.templates.missing.length, 0);
    assert.equal(rec.instances.missing.length, 0);
  });

  test("migratie is IDEMPOTENT · tweede run maakt niets nieuw", async () => {
    const store = legacyStore();
    const r = await cutover.migrateLegacyForms({ store, repo, tenantId: T });
    assert.equal(r.definitions.created, 0);
    assert.equal(r.definitions.skipped, 2);
    assert.equal(r.instances.created, 0);
    assert.equal(r.instances.skipped, 2);
    // Geen duplicaten in de database.
    const defs = await pool.query("SELECT count(*)::int AS n FROM form_definitions WHERE tenant_id=$1", [T]);
    assert.equal(defs.rows[0].n, 2);
    const insts = await pool.query("SELECT count(*)::int AS n FROM form_instances WHERE tenant_id=$1", [T]);
    assert.equal(insts.rows[0].n, 2);

    await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [T]);
    await pool.end();
  });
}
