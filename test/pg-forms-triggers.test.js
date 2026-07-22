"use strict";
// h26 · assignment-triggers: domeinevent → automatische form-instance, met
// voorwaarden (bedrag), idempotente her-bezorging en veilige overslag van
// ongepubliceerde definities. Slaat over zonder DATABASE_URL.
const { test } = require("node:test");
const assert = require("node:assert");

// Pure matching-logica draait altijd (geen pg nodig).
const TR = require("../src/platform/forms-triggers");

test("puur · eventpatroon (exact + wildcard) en voorwaarden", () => {
  assert.equal(TR.eventMatches("workorder.completed", "workorder.completed"), true);
  assert.equal(TR.eventMatches("workorder.*", "workorder.completed"), true);
  assert.equal(TR.eventMatches("workorder.*", "invoice.created"), false);
  assert.equal(TR.conditionsHold([{ field: "amount", op: "gte", value: 500 }], { amount: 700 }), true);
  assert.equal(TR.conditionsHold([{ field: "amount", op: "gte", value: 500 }], { amount: 100 }), false);
  const def = { id: "d1", attributes: { triggers: [{ event: "invoice.created", conditions: [{ field: "amount", op: "gte", value: 1000 }] }] } };
  assert.equal(TR.matchTriggers(def, { eventType: "invoice.created", data: { amount: 2000 } }).length, 1);
  assert.equal(TR.matchTriggers(def, { eventType: "invoice.created", data: { amount: 10 } }).length, 0);
  const p = TR.instancePayloadFor(def, def.attributes.triggers[0], { id: "evt_1", eventType: "invoice.created", aggregateType: "invoice", aggregateId: "inv_9", actor: "boekhouding@x", data: {} });
  assert.equal(p.idempotency_key, "trig_evt_1_d1");
  assert.equal(p.subject_id, "inv_9");
  assert.equal(p.assigned_to, "boekhouding@x");
  assert.equal(p.source, "automation");
});

const LIVE = process.env.DATABASE_URL || "";
if (!LIVE || !/^postgres/.test(LIVE)) {
  test("pg-forms-triggers: DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  const { Pool } = require("pg");
  const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
  const { makePgFormsRepository } = require("../src/infrastructure/postgres/pg-forms-repository");

  const ssl = /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: LIVE, ssl });
  const repo = makePgFormsRepository(pool);
  const T = "t_formstrig";

  const STRUCT = { sections: [{ key: "main", title: { nl: "Hoofd" } }], fields: [{ field_key: "note", section_key: "main", field_type: "text", required: "optional" }] };
  const EVENT = (id, amount) => ({ id, eventType: "workorder.completed", aggregateType: "workorder", aggregateId: "wo_7", actor: "uitvoerder@x", data: { amount } });

  test("setup", async () => {
    await runMigrations(pool);
    await pool.query("INSERT INTO tenants (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [T, "Forms triggers"]);
    await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [T]);
    // Gepubliceerde definitie met trigger op werkbon-afronding boven 500.
    const def = await repo.createDefinition(T, {
      key: "TRG-001", name: "Opleveringscheck", form_type: "evidence", status: "enabled",
      attributes: { triggers: [{ event: "workorder.completed", conditions: [{ field: "amount", op: "gte", value: 500 }], assign_to: "creator" }] },
    }, "admin@x");
    await repo.setDraftStructure(T, def.id, STRUCT, "admin@x");
    await repo.publishVersion(T, def.id, "admin@x");
    // Ongepubliceerde definitie met dezelfde trigger → wordt netjes overgeslagen.
    await repo.createDefinition(T, {
      key: "TRG-002", name: "Nooit gepubliceerd", form_type: "evidence", status: "enabled",
      attributes: { triggers: [{ event: "workorder.completed" }] },
    }, "admin@x");
  });

  test("event boven drempel → instance (toegewezen aan de actor); herlevering dedupt", async () => {
    const r1 = await repo.processDomainEvent(T, EVENT("evt_a", 900));
    assert.equal(r1.created.length, 1, "TRG-001 vuurt");
    assert.equal(r1.created[0].assignedTo, "uitvoerder@x");
    assert.ok(r1.skipped.some(s => s.definition === "TRG-002" && s.reason === "FORM_NOT_PUBLISHED"), "ongepubliceerd veilig overgeslagen");
    const inst = await repo.getInstance(T, r1.created[0].instance);
    assert.equal(inst.subject_type, "workorder");
    assert.equal(inst.subject_id, "wo_7");
    assert.equal(inst.source, "automation");
    // Zelfde event opnieuw bezorgd → geen tweede instance.
    const r2 = await repo.processDomainEvent(T, EVENT("evt_a", 900));
    assert.equal(r2.created.length, 0);
    assert.ok(r2.skipped.some(s => s.reason === "duplicate"));
  });

  test("event onder de drempel → geen instance", async () => {
    const r = await repo.processDomainEvent(T, EVENT("evt_b", 100));
    assert.equal(r.created.length, 0, "voorwaarde amount>=500 niet voldaan");

    await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [T]);
    await pool.end();
  });
}
