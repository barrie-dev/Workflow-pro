"use strict";
// F4 · domeincommands: een domeinformulier schrijft transactioneel naar het
// canonieke domeinobject bij submit; een workflowformulier pas na goedkeuring;
// een falend command draait de submit terug (transactioneel, F4-DoD).
// Slaat over zonder DATABASE_URL.
const { test } = require("node:test");
const assert = require("node:assert");

const LIVE = process.env.DATABASE_URL || "";
if (!LIVE || !/^postgres/.test(LIVE)) {
  test("pg-forms-domain: DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  const { Pool } = require("pg");
  const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
  const { makePgFormsRepository } = require("../src/infrastructure/postgres/pg-forms-repository");
  const { makeDomainCommandRouter, mapAnswersToDomain, dispatchMomentFor } = require("../src/platform/forms-domain-commands");

  const ssl = /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: LIVE, ssl });
  const T = "t_formsdom";

  // Router: 'customer' schrijft echt naar de canonieke customers-tabel;
  // 'boobytrap' faalt altijd (bewijst de rollback).
  const router = makeDomainCommandRouter();
  router.register("customer", async ({ client, tenantId, payload, actor }) => {
    const cid = "cus_test_" + Math.abs(payload.name.length * 7919) + "_" + payload.name.replace(/\W/g, "");
    await client.query(
      `INSERT INTO customers (id, tenant_id, name, email, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$5)`,
      [cid, tenantId, payload.name, payload.email || null, actor || null]);
    return { domainId: cid };
  });
  router.register("boobytrap", async () => { throw new Error("domein weigert"); });

  const repo = makePgFormsRepository(pool, { domainCommands: router });

  const STRUCT = {
    sections: [{ key: "main", title: { nl: "Hoofd" } }],
    fields: [
      { field_key: "customer_name", section_key: "main", field_type: "text", required: "required" },
      { field_key: "customer_email", section_key: "main", field_type: "text", required: "optional" },
    ],
  };
  // Mapping: antwoordvelden → canonieke domeinvelden.
  const MAPPING = { customer_name: "name", customer_email: "email" };

  async function makeDef(key, form_type, domain_object) {
    const def = await repo.createDefinition(T, { key, name: key, form_type, domain_object, attributes: { domain_mapping: MAPPING } }, "admin@t");
    await repo.setDraftStructure(T, def.id, STRUCT, "admin@t");
    await repo.publishVersion(T, def.id, "admin@t");
    return def;
  }

  test("setup", async () => {
    await runMigrations(pool);
    await pool.query("INSERT INTO tenants (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [T, "Forms domain"]);
    await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [T]);
    await pool.query("DELETE FROM customers WHERE tenant_id=$1", [T]);
  });

  test("mapAnswersToDomain + dispatchMomentFor · pure regels", () => {
    const def = { attributes: { domain_mapping: MAPPING } };
    assert.deepEqual(mapAnswersToDomain(def, { customer_name: "Bax BV", extra: 1 }), { name: "Bax BV", extra: 1 });
    assert.equal(dispatchMomentFor("domain"), "submit");
    assert.equal(dispatchMomentFor("workflow"), "approve");
    assert.equal(dispatchMomentFor("evidence"), null);
    assert.equal(dispatchMomentFor("survey"), null);
  });

  test("domeinformulier · submit schrijft naar de canonieke customers-tabel", async () => {
    const def = await makeDef("DOM-CRM", "domain", "customer");
    const inst = await repo.createInstance(T, { definition_id: def.id }, "emp@t");
    const r = await repo.submitInstance(T, inst.id, { answers: { customer_name: "Bax BV", customer_email: "bax@x.be" } }, "emp@t");
    assert.equal(r.status, "submitted");
    assert.ok(r.domain && r.domain.domainId, "submit geeft het domeinresultaat terug");
    const c = await pool.query("SELECT name, email FROM customers WHERE tenant_id=$1 AND id=$2", [T, r.domain.domainId]);
    assert.equal(c.rows[0].name, "Bax BV");
    assert.equal(c.rows[0].email, "bax@x.be");
    // Het domeincommand is gelogd in de lifecycle-events.
    const events = await repo.listEvents(T, inst.id);
    assert.ok(events.some(e => e.event_type === "domain.command.applied"));
  });

  test("workflowformulier · submit schrijft NIET, approve wél", async () => {
    const def = await makeDef("WFL-CRM", "workflow", "customer");
    const inst = await repo.createInstance(T, { definition_id: def.id }, "emp@t");
    const sub = await repo.submitInstance(T, inst.id, { answers: { customer_name: "Later BV" } }, "emp@t");
    assert.equal(sub.domain, undefined, "workflow schrijft niet bij submit");
    const before = await pool.query("SELECT count(*)::int AS n FROM customers WHERE tenant_id=$1 AND name='Later BV'", [T]);
    assert.equal(before.rows[0].n, 0);
    // Goedkeuring door een ander → domeinschrijf.
    const ok = await repo.actOnApproval(T, inst.id, { decision: "approved", hasApproveRight: true }, "mgr@t");
    assert.equal(ok.status, "approved");
    assert.ok(ok.domain && ok.domain.domainId, "approve dispatcht het domeincommand");
    const after = await pool.query("SELECT count(*)::int AS n FROM customers WHERE tenant_id=$1 AND name='Later BV'", [T]);
    assert.equal(after.rows[0].n, 1);
  });

  test("transactioneel · falend domeincommand draait de submit terug", async () => {
    const def = await makeDef("DOM-TRAP", "domain", "boobytrap");
    const inst = await repo.createInstance(T, { definition_id: def.id }, "emp@t");
    await assert.rejects(
      () => repo.submitInstance(T, inst.id, { answers: { customer_name: "Nooit BV" } }, "emp@t"),
      /domein weigert/);
    // De hele transactie is teruggedraaid: de instance staat nog op draft.
    const still = await repo.getInstance(T, inst.id);
    assert.equal(still.status, "draft", "status niet doorgeschoven");
    assert.equal(still.submitted_at, null);

    await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [T]);
    await pool.query("DELETE FROM customers WHERE tenant_id=$1", [T]);
    await pool.end();
  });
}
