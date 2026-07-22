"use strict";
// CTO2-01..07 · Forms-objectautorisatie en security-sluiting. De DoD eist
// negatieve HTTP-tests waarin twee medewerkers binnen DEZELFDE tenant elkaars
// instance-ID kennen. Draait op de route-laag (handleFormsRoute) tegen echte pg.
// Slaat over zonder DATABASE_URL.
const { test } = require("node:test");
const assert = require("node:assert");

const LIVE = process.env.DATABASE_URL || "";
if (!LIVE || !/^postgres/.test(LIVE)) {
  test("pg-forms-security: DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  const { Pool } = require("pg");
  const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
  const { makePgFormsRepository } = require("../src/infrastructure/postgres/pg-forms-repository");
  const { handleFormsRoute } = require("../src/modules/forms-api");

  const ssl = /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: LIVE, ssl });
  const repo = makePgFormsRepository(pool);
  const T = "t_formsec";

  const admin = { email: "admin@s", role: "tenant_admin", permissions: [] };
  const alice = { email: "alice@s", role: "employee", permissions: [] };
  const bob = { email: "bob@s", role: "employee", permissions: [] };
  const lead = { email: "lead@s", role: "manager", permissions: [] };
  const LEAD_CTX = { teamEmails: new Set(["alice@s", "lead@s"]) };

  const call = (user, method, action, body = {}, ctx = {}) =>
    handleFormsRoute(repo, { user, tenantId: T, method, action, body, req: { headers: {}, url: "/" }, ctx });

  const STRUCT = {
    sections: [{ key: "main", title: { nl: "Hoofd" } }],
    fields: [
      { field_key: "reason", section_key: "main", field_type: "text", required: "required" },
      { field_key: "salary", section_key: "main", field_type: "number", data_classification: "special_category", view_permission: "field.salary.view" },
    ],
  };

  let defId, aliceInst;

  test("setup", async () => {
    await runMigrations(pool);
    await pool.query("INSERT INTO tenants (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [T, "Forms security"]);
    await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [T]);
    const def = await call(admin, "POST", "form-definitions", { key: "SEC-T1", name: "HR-formulier", form_type: "workflow" });
    defId = def.payload.form.id;
    await call(admin, "PUT", `form-definitions/${defId}/structure`, STRUCT);
    await call(admin, "POST", `form-definitions/${defId}/publish`);
    await call(admin, "PATCH", `form-definitions/${defId}/status`, { status: "enabled" });
    const started = await call(alice, "POST", `form-definitions/${defId}/instances`, {});
    assert.equal(started.status, 201, "medewerker start zonder settings-recht (matrix hersteld)");
    aliceInst = started.payload.instance.id;
    await call(alice, "PATCH", `form-instances/${aliceInst}`, { answers: { reason: "opleiding" } });
  });

  test("CTO2-01 · zelfde tenant, ander persoon: Bob komt NIET in Alice haar dossier", async () => {
    for (const [method, path, body] of [
      ["GET", `form-instances/${aliceInst}`, {}],
      ["PATCH", `form-instances/${aliceInst}`, { answers: { reason: "gekaapt" } }],
      ["POST", `form-instances/${aliceInst}/submit`, {}],
      ["POST", `form-instances/${aliceInst}/transition`, { status: "withdrawn" }],
      ["POST", `form-instances/${aliceInst}/approve`, { decision: "approved" }],
      ["POST", `form-instances/${aliceInst}/sign`, { signer_name: "Bob" }],
      ["GET", `form-instances/${aliceInst}/events`, {}],
      ["GET", `form-instances/${aliceInst}/attachments`, {}],
      ["POST", `form-instances/${aliceInst}/attachments`, { file_name: "x.jpg", mime_type: "image/jpeg", size_bytes: 5 }],
    ]) {
      const r = await call(bob, method, path, body);
      assert.equal(r.status, 403, `${method} ${path} moet 403 zijn voor Bob`);
      assert.equal(r.payload.code, "FORMS_FORBIDDEN", "generieke weigering zonder detaillek");
    }
    // Alice zelf mag haar dossier wél zien.
    const own = await call(alice, "GET", `form-instances/${aliceInst}`);
    assert.equal(own.status, 200);
  });

  test("CTO2-01/02 · definities: eindgebruiker ziet enkel actieve; beheer geweigerd", async () => {
    // Bob (geen beheer) mag geen definities aanmaken, structuren zetten of seeden.
    assert.equal((await call(bob, "POST", "form-definitions", { key: "X", name: "X" })).status, 403);
    assert.equal((await call(bob, "PUT", `form-definitions/${defId}/structure`, STRUCT)).status, 403);
    assert.equal((await call(bob, "POST", "form-definitions/seed")).status, 403);
    assert.equal((await call(bob, "POST", `form-definitions/${defId}/assignments`, { scope_type: "external" })).status, 403);
    assert.equal((await call(bob, "GET", `form-definitions/${defId}/report`)).status, 403);
    assert.equal((await call(bob, "POST", "form-retention/apply")).status, 403);
    // De lijst voor Bob bevat alleen actieve formulieren (hier: SEC-T1 enabled).
    const list = await call(bob, "GET", "form-definitions");
    assert.equal(list.status, 200);
    assert.ok(list.payload.forms.every(f => f.id === defId), "enkel het actieve formulier zichtbaar");
    // Een gepauzeerde definitie verdwijnt uit Bob zijn lijst.
    await call(admin, "PATCH", `form-definitions/${defId}/status`, { status: "paused" });
    const hidden = await call(bob, "GET", "form-definitions");
    assert.equal(hidden.payload.forms.length, 0, "gepauzeerd = onzichtbaar voor eindgebruiker");
    assert.equal((await call(bob, "POST", `form-definitions/${defId}/instances`, {})).status, 403, "starten geblokkeerd (FORM_NOT_ACTIVE of 403)");
    await call(admin, "PATCH", `form-definitions/${defId}/status`, { status: "enabled" });
  });

  test("CTO2-04/05 · approve vraagt recht + scope; sign vraagt forms.sign of extern token", async () => {
    await call(alice, "POST", `form-instances/${aliceInst}/submit`, {});
    // Teamleider BUITEN het team (lege ctx) → 403; mét teamcontext → approved.
    assert.equal((await call(lead, "POST", `form-instances/${aliceInst}/approve`, { decision: "approved" })).status, 403);
    const ok = await call(lead, "POST", `form-instances/${aliceInst}/approve`, { decision: "approved" }, LEAD_CTX);
    assert.equal(ok.status, 200);
    assert.equal(ok.payload.result.status, "approved");
    // Interne handtekening: medewerker zonder forms.sign → 403; beheerder wél.
    assert.equal((await call(alice, "POST", `form-instances/${aliceInst}/sign`, { signer_name: "Alice" })).status, 403);
    const signed = await call(admin, "POST", `form-instances/${aliceInst}/sign`, { signer_name: "Bevoegde" });
    assert.equal(signed.status, 200);
    assert.equal(signed.payload.result.status, "signed");
    // Repo-laag: tekenen ZONDER evidence is altijd verboden (geen sluiproute).
    await assert.rejects(() => repo.captureSignature(T, aliceInst, { signer_name: "Spook" }, "x@s"),
      e => e.code === "SIGNATURE_EVIDENCE_REQUIRED");
  });

  test("CTO2-05 · extern token: geldig token tekent mét evidence, vervalst token niet", async () => {
    const def2 = await call(admin, "POST", "form-definitions", { key: "SEC-T2", name: "Klantbevestiging", form_type: "evidence" });
    const d2 = def2.payload.form.id;
    await call(admin, "PUT", `form-definitions/${d2}/structure`, { sections: STRUCT.sections, fields: [STRUCT.fields[0]] });
    await call(admin, "POST", `form-definitions/${d2}/publish`);
    await call(admin, "PATCH", `form-definitions/${d2}/status`, { status: "enabled" });
    const inst = await call(alice, "POST", `form-definitions/${d2}/instances`, {});
    const iid = inst.payload.instance.id;
    await call(alice, "POST", `form-instances/${iid}/submit`, { answers: { reason: "opgeleverd" } });
    const asg = await call(admin, "POST", `form-definitions/${d2}/assignments`, { scope_type: "external", scope_id: "klant@x" });
    const token = asg.payload.assignment.token;
    // Vervalst token → geen grant.
    assert.equal(await repo.resolveExternalToken(T, d2, "vervalst"), null);
    // Geldig token → grant → handtekening met token-evidence.
    const grant = await repo.resolveExternalToken(T, d2, token);
    assert.ok(grant && grant.id);
    const r = await repo.captureSignature(T, iid, {
      signer_name: "Jan Klant", transitionToSigned: true,
      evidence: { type: "external_token", assignmentId: grant.id, ip: "203.0.113.7", userAgent: "test" },
    }, "extern:klant@x");
    assert.equal(r.status, "signed");
    assert.match(r.signerRef, /^token:/, "signer_ref draagt de tokenbinding");
    const events = await repo.listEvents(T, iid);
    const ev = events.find(e => e.event_type === "signed");
    assert.equal(ev.data.evidence.type, "external_token");
    assert.equal(ev.data.evidence.ip, "203.0.113.7");
  });

  test("CTO2-06/07 · attachment-gate, legal hold en hard_delete-grondslag", async () => {
    // Attachment-gate: pending blokkeert submit (bewezen in pg-forms-f5); hier
    // het retentiedeel. Beleid ZONDER grondslag mag nooit hard verwijderen.
    await pool.query(`DELETE FROM retention_policies WHERE tenant_id=$1`, [T]);
    await pool.query(`INSERT INTO retention_policies (id, tenant_id, key, name, retention_days, purge_strategy)
                      VALUES ('rp_hd',$1,'hd-30','Hard 30d',30,'hard_delete')`, [T]);
    const def3 = await call(admin, "POST", "form-definitions", { key: "SEC-T3", name: "Wegwerp", form_type: "survey" });
    const d3 = def3.payload.form.id;
    await call(admin, "PUT", `form-definitions/${d3}/structure`, { sections: STRUCT.sections, fields: [STRUCT.fields[0]] });
    await call(admin, "POST", `form-definitions/${d3}/publish`);
    await call(admin, "PATCH", `form-definitions/${d3}/status`, { status: "enabled" });
    const i1 = (await call(alice, "POST", `form-definitions/${d3}/instances`, { retention_policy_id: "rp_hd" })).payload.instance.id;
    await call(alice, "POST", `form-instances/${i1}/submit`, { answers: { reason: "klaar" } });
    await repo.transition(T, i1, "completed", "admin@s");
    await pool.query(`UPDATE form_instances SET created_at = now() - interval '60 days' WHERE tenant_id=$1 AND id=$2`, [T, i1]);
    // Zonder legal_basis: geweigerd met reden, instance blijft bestaan.
    const run1 = await repo.applyRetention(T, { executor: "admin@s" });
    const refused = run1.actions.find(a => a.instance === i1);
    assert.equal(refused.applied, false);
    assert.equal(refused.reason, "LEGAL_BASIS_REQUIRED");
    assert.ok(await repo.getInstance(T, i1), "instance niet verwijderd zonder grondslag");
    // Mét grondslag maar onder legal hold op de INSTANCE: eveneens beschermd.
    await pool.query(`UPDATE retention_policies SET legal_basis='Bewijsplicht art. X' WHERE tenant_id=$1 AND id='rp_hd'`, [T]);
    await pool.query(`UPDATE form_instances SET legal_hold=true, legal_hold_reason='lopend geschil' WHERE tenant_id=$1 AND id=$2`, [T, i1]);
    const run2 = await repo.applyRetention(T, { executor: "admin@s" });
    assert.ok(!run2.actions.some(a => a.instance === i1 && a.applied), "legal hold op de instance bevriest de purge");
    // Hold eraf → purge slaagt, met executor en jobId in het rapport.
    await pool.query(`UPDATE form_instances SET legal_hold=false WHERE tenant_id=$1 AND id=$2`, [T, i1]);
    const run3 = await repo.applyRetention(T, { executor: "admin@s" });
    const done = run3.actions.find(a => a.instance === i1);
    assert.equal(done.applied, true);
    assert.equal(run3.executor, "admin@s");
    assert.ok(run3.jobId, "job-ID voor purge-audit");
    assert.equal(await repo.getInstance(T, i1), null);

    await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [T]);
    await pool.query("DELETE FROM retention_policies WHERE tenant_id=$1", [T]);
    await pool.end();
  });
}
