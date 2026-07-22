"use strict";
// h26 · meertraps-goedkeuring end-to-end op de echte pg-repo: serial 2 staps
// beleid met all_of-stap, goedkeurderslijst-handhaving, SoD blijft gelden, en
// het domeincommand vuurt pas bij de FINALE goedkeuring. Slaat over zonder
// DATABASE_URL.
const { test } = require("node:test");
const assert = require("node:assert");

const LIVE = process.env.DATABASE_URL || "";
if (!LIVE || !/^postgres/.test(LIVE)) {
  test("pg-forms-approvals: DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  const { Pool } = require("pg");
  const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
  const { makePgFormsRepository } = require("../src/infrastructure/postgres/pg-forms-repository");
  const { makeDomainCommandRouter } = require("../src/platform/forms-domain-commands");

  const ssl = /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: LIVE, ssl });
  const T = "t_formsappr";

  // Teller bewijst dat het domeincommand exact één keer en pas op het einde vuurt.
  let dispatched = 0;
  const router = makeDomainCommandRouter();
  router.register("purchase", async () => { dispatched += 1; return { domainId: "po_ok" }; });
  const repo = makePgFormsRepository(pool, { domainCommands: router });

  const POLICY = {
    steps: [
      { step_no: 1, mode: "any_of", approvers: ["lead@x", "manager"] },
      { step_no: 2, mode: "all_of", approvers: ["fin@x", "dir@x"] },
    ],
  };
  const STRUCT = {
    sections: [{ key: "main", title: { nl: "Hoofd" } }],
    fields: [{ field_key: "reason", section_key: "main", field_type: "text", required: "required" }],
  };

  let instId;

  test("setup", async () => {
    await runMigrations(pool);
    await pool.query("INSERT INTO tenants (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [T, "Forms approvals"]);
    await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [T]);
    const def = await repo.createDefinition(T, {
      key: "APR-001", name: "Aankoop meertraps", form_type: "workflow", domain_object: "purchase",
      attributes: { approval_policy: POLICY },
    }, "admin@x");
    await repo.setDraftStructure(T, def.id, STRUCT, "admin@x");
    await repo.publishVersion(T, def.id, "admin@x");
    const inst = await repo.createInstance(T, { definition_id: def.id }, "emp@x");
    instId = inst.id;
    await repo.submitInstance(T, instId, { answers: { reason: "nieuwe machine" } }, "emp@x");
  });

  test("stap 1 · niet-gelijste actor geweigerd; rol-match telt; SoD blijft", async () => {
    // Buitenstaander (geen e-mail/rol-match) → 403.
    await assert.rejects(() => repo.actOnApproval(T, instId, { decision: "approved", actorRole: "employee" }, "random@x"),
      e => e.code === "APPROVER_NOT_ALLOWED");
    // De indiener zelf, ook al is die manager → SoD.
    await assert.rejects(() => repo.actOnApproval(T, instId, { decision: "approved", actorRole: "manager" }, "emp@x"),
      e => e.code === "SOD_SELF_APPROVAL");
    // Rol-match (manager) → stap 1 voldaan (any_of), flow wacht op stap 2.
    const r = await repo.actOnApproval(T, instId, { decision: "approved", actorRole: "manager" }, "boss@x");
    assert.equal(r.status, "in_review");
    assert.equal(r.pendingStep, 2);
    assert.equal(dispatched, 0, "geen domeincommand vóór de finale goedkeuring");
  });

  test("stap 2 · all_of: beide goedkeurders nodig; client kan geen stap kiezen", async () => {
    // fin tekent → nog steeds pending (dir moet ook).
    const r1 = await repo.actOnApproval(T, instId, { stepNo: 99, decision: "approved", actorRole: "employee" }, "fin@x");
    assert.equal(r1.status, "in_review");
    assert.equal(r1.step, 2, "de server kiest de stap, niet de client (stepNo 99 genegeerd)");
    assert.equal(dispatched, 0);
    // fin nogmaals → dubbele actie op dezelfde stap geweigerd.
    await assert.rejects(() => repo.actOnApproval(T, instId, { decision: "approved", actorRole: "employee" }, "fin@x"),
      e => e.code === "SOD_DUPLICATE_ACTION");
    // dir tekent → finale goedkeuring + domeincommand exact één keer.
    const r2 = await repo.actOnApproval(T, instId, { decision: "approved", actorRole: "employee" }, "dir@x");
    assert.equal(r2.status, "approved");
    assert.ok(r2.domain && r2.domain.domainId === "po_ok");
    assert.equal(dispatched, 1, "domeincommand exact één keer, pas op het einde");
    // Na afronding is verder beslissen geblokkeerd.
    await assert.rejects(() => repo.actOnApproval(T, instId, { decision: "approved", actorRole: "employee" }, "laat@x"),
      e => e.code === "APPROVALS_ALREADY_DECIDED");
    // Events tonen de tussenstap en de finale.
    const events = await repo.listEvents(T, instId);
    assert.ok(events.some(e => e.event_type === "approval.step"));
    assert.ok(events.some(e => e.event_type === "approved"));

    await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [T]);
    await pool.end();
  });
}
