"use strict";
// Forms F1 · API-dispatcher (HTTP-grammatica) end-to-end over de echte pg-repo.
// Bewijst de engine-convergentie (FORM-01): de canonieke engine hangt nu aan de
// HTTP-routes form-definitions/* + form-instances/*. Test de routegrammatica,
// statuscodes, ETag/If-Match, Idempotency-Key-header, veldredactie op GET en de
// segregation of duties via approve. Slaat over zonder DATABASE_URL.
const { test } = require("node:test");
const assert = require("node:assert");

const LIVE = process.env.DATABASE_URL || "";
if (!LIVE || !/^postgres/.test(LIVE)) {
  test("forms-api: DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  const { Pool } = require("pg");
  const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
  const { makePgFormsRepository } = require("../src/infrastructure/postgres/pg-forms-repository");
  const { handleFormsRoute, isFormsAction } = require("../src/modules/forms-api");

  const ssl = /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: LIVE, ssl });
  const repo = makePgFormsRepository(pool);
  const T = "t_formsapi";

  // Acteurs: een beheerder (ziet alles), een indiener en een goedkeurder.
  const admin = { email: "admin@a", role: "tenant_admin", permissions: [] };
  const emp = { email: "emp@a", role: "employee", permissions: ["read:projects"] };
  const mgr = { email: "mgr@a", role: "employee", permissions: ["read:projects"] };

  // Minimale req-stub met headers voor If-Match/Idempotency-Key.
  const reqWith = (headers = {}) => ({ headers, method: "GET", url: "/" });
  const call = (user, method, action, body = {}, headers = {}) =>
    handleFormsRoute(repo, { user, tenantId: T, method, action, body, req: reqWith(headers) });

  const STRUCT = {
    sections: [{ key: "main", title: { nl: "Hoofd" } }],
    fields: [
      { field_key: "reason", section_key: "main", field_type: "text", required: "required", label: { nl: "Reden" } },
      { field_key: "amount", section_key: "main", field_type: "number", required: "optional", reporting_allowed: true },
      { field_key: "cost_price", section_key: "main", field_type: "number", data_classification: "financial", view_permission: "field.cost_price.view" },
    ],
  };

  test("setup", async () => {
    await runMigrations(pool);
    await pool.query("INSERT INTO tenants (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [T, "Forms API"]);
    await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [T]);
  });

  test("isFormsAction herkent canonieke paden, niet de legacy work-os paden", () => {
    assert.equal(isFormsAction("form-definitions"), true);
    assert.equal(isFormsAction("form-definitions/x/publish"), true);
    assert.equal(isFormsAction("form-instances/x/submit"), true);
    assert.equal(isFormsAction("forms/templates"), false, "legacy blijft bij de oude engine");
    assert.equal(isFormsAction("forms/instances/x"), false);
  });

  test("definitie-lifecycle over HTTP · aanmaken → structuur → publiceren", async () => {
    const create = await call(admin, "POST", "form-definitions", { key: "API-001", name: "Aankoop", form_type: "workflow", domain_object: "purchase" });
    assert.equal(create.status, 201);
    assert.equal(create.payload.ok, true);
    const id = create.payload.form.id;
    assert.ok(id);

    // Onbekende definitie → 404 met code.
    const missing = await call(admin, "GET", "form-definitions/nope_123");
    assert.equal(missing.status, 404);
    assert.equal(missing.payload.code, "FORM_NOT_FOUND");

    await call(admin, "PUT", `form-definitions/${id}/structure`, STRUCT);
    const pub = await call(admin, "POST", `form-definitions/${id}/publish`);
    assert.equal(pub.status, 200);
    assert.equal(pub.payload.version.published, true);

    const get = await call(admin, "GET", `form-definitions/${id}`);
    assert.equal(get.payload.form.current_version, 1);
    return { id };
  });

  test("instance-lifecycle over HTTP · start (ETag) → 422 → submit idempotent → veldredactie", async () => {
    // Verse definitie voor deze test.
    const c = await call(admin, "POST", "form-definitions", { key: "API-002", name: "Aankoop 2", form_type: "workflow" });
    const defId = c.payload.form.id;
    await call(admin, "PUT", `form-definitions/${defId}/structure`, STRUCT);
    await call(admin, "POST", `form-definitions/${defId}/publish`);

    // Instance starten → 201 + ETag "1".
    const start = await call(emp, "POST", `form-definitions/${defId}/instances`, { subject_type: "purchase", subject_id: "po_9" });
    assert.equal(start.status, 201);
    assert.equal(start.headers.ETag, '"1"');
    const instId = start.payload.instance.id;

    // Concept opslaan met If-Match (kosttarief zichtbaar voor wie mag opslaan).
    const save = await call(emp, "PATCH", `form-instances/${instId}`, { answers: { amount: 40, cost_price: 12 } }, { "if-match": '"1"' });
    assert.equal(save.status, 200);
    assert.ok(save.headers.ETag);

    // Submit zonder verplichte 'reason' → 422 met fieldErrors.
    const bad = await call(emp, "POST", `form-instances/${instId}/submit`, {});
    assert.equal(bad.status, 422);
    assert.equal(bad.payload.code, "VALIDATION_FAILED");
    assert.equal(bad.payload.fieldErrors.reason, "verplicht");

    // Submit met reason + Idempotency-Key-header → 200.
    const okSub = await call(emp, "POST", `form-instances/${instId}/submit`, { answers: { reason: "boormachine" } }, { "idempotency-key": "idem-1" });
    assert.equal(okSub.status, 200);
    assert.equal(okSub.payload.result.status, "submitted");
    // Tweede submit met dezelfde sleutel → idempotent, geen dubbele.
    const again = await call(emp, "POST", `form-instances/${instId}/submit`, {}, { "idempotency-key": "idem-1" });
    assert.equal(again.payload.result.idempotent, true);

    // GET als employee zonder field.cost_price.view → cost_price is geredigeerd weg.
    const getEmp = await call(emp, "GET", `form-instances/${instId}`);
    assert.equal(getEmp.status, 200);
    assert.equal("cost_price" in getEmp.payload.instance.answers, false, "employee ziet geen financieel veld");
    assert.equal("amount" in getEmp.payload.instance.answers, true);
    assert.ok(getEmp.headers.ETag, "GET levert ETag voor If-Match");

    // GET als beheerder → cost_price wél zichtbaar.
    const getAdmin = await call(admin, "GET", `form-instances/${instId}`);
    assert.equal(getAdmin.payload.instance.answers.cost_price, 12, "beheerder ziet het financiële veld");

    return { instId };
  });

  test("F2/F3 · activatie, externe token en handtekening over HTTP", async () => {
    const c = await call(admin, "POST", "form-definitions", { key: "API-004", name: "Werfbon", form_type: "domain" });
    const defId = c.payload.form.id;
    await call(admin, "PUT", `form-definitions/${defId}/structure`, STRUCT);

    // Nog niet gepubliceerd → status 'available' → activatie blokkeert op tenant.
    const act1 = await call(admin, "GET", `form-definitions/${defId}/activation`);
    assert.equal(act1.payload.activation.active, false);
    assert.equal(act1.payload.activation.blockedBy, "tenant");

    await call(admin, "POST", `form-definitions/${defId}/publish`);
    await call(admin, "PATCH", `form-definitions/${defId}/status`, { status: "enabled" });
    const act2 = await call(admin, "GET", `form-definitions/${defId}/activation`);
    assert.equal(act2.payload.activation.active, true, "gepubliceerd + enabled → actief");

    // Externe token-assignment → ruw token éénmalig terug.
    const asg = await call(admin, "POST", `form-definitions/${defId}/assignments`, { scope_type: "external", scope_id: "klant@x" });
    assert.equal(asg.status, 201);
    assert.ok(asg.payload.assignment.token, "ruw token wordt teruggegeven");
    const list = await call(admin, "GET", `form-definitions/${defId}/assignments`);
    assert.ok(list.payload.assignments.some(a => a.scope_type === "external" && a.has_token && !a.token));

    // Handtekening op een ingediende instance → status 'signed', gebonden hash.
    const inst = await call(emp, "POST", `form-definitions/${defId}/instances`, {});
    const instId = inst.payload.instance.id;
    await call(emp, "POST", `form-instances/${instId}/submit`, { answers: { reason: "opgeleverd" } });
    const sig = await call(admin, "POST", `form-instances/${instId}/sign`, { signer_name: "Jan Klant", signer_ref: "klant@x" });
    assert.equal(sig.status, 200);
    assert.equal(sig.payload.result.status, "signed");
    assert.ok(sig.payload.result.boundHash);

    // Toewijzing intrekken.
    const rev = await call(admin, "DELETE", `form-definitions/${defId}/assignments/${asg.payload.assignment.id}`);
    assert.equal(rev.payload.result.revoked, true);
  });

  test("F4 · standaardformulieren-seed (h25+h23) is volledig en idempotent", async () => {
    const { STANDARD_FORMS } = require("../src/platform/forms-catalog");
    assert.equal(STANDARD_FORMS.length, 35, "25 kern + 10 reseller");
    const seed1 = await call(admin, "POST", "form-definitions/seed");
    assert.equal(seed1.status, 200);
    assert.equal(seed1.payload.result.created.length, 35, "eerste seed maakt alles");
    // Idempotent: tweede seed maakt niets nieuw.
    const seed2 = await call(admin, "POST", "form-definitions/seed");
    assert.equal(seed2.payload.result.created.length, 0);
    assert.equal(seed2.payload.result.skipped.length, 35);
    // Spot-check: system_required + security-classificatie + reseller-entitlement.
    const list = (await call(admin, "GET", "form-definitions")).payload.forms;
    const sec = list.find(f => f.key === "SEC-001");
    assert.equal(sec.status, "system_required");
    assert.equal(sec.data_classification, "security_sensitive");
    const res3 = list.find(f => f.key === "RES-003");
    assert.equal(res3.attributes.requires_entitlement, "reseller_program");
    // Reseller-formulier zonder entitlement → activatie blokkeert op entitlement.
    const act = await call(admin, "GET", `form-definitions/${res3.id}/activation`);
    assert.equal(act.payload.activation.blockedBy, "entitlement");
    // Verlofformulier draagt zijn module-entitlement (enabled when leave module).
    const hr1 = list.find(f => f.key === "HR-001");
    assert.equal(hr1.attributes.requires_entitlement, "leave");
    assert.equal(hr1.data_classification, "special_category");

    // Velddictionary (h6-h24): CRM-001 krijgt zijn normatieve h8-structuur en
    // is daarna publiceerbaar · de spec-velden zijn de ECHTE structuur.
    const dict = require("../src/platform/field-dictionary");
    const crm1 = list.find(f => f.key === "CRM-001");
    assert.equal(crm1.attributes.dictionary_chapter, 8);
    const applied = await call(admin, "POST", `form-definitions/${crm1.id}/structure/dictionary`);
    assert.equal(applied.status, 200);
    const expect = dict.structureFor(8);
    assert.equal(applied.payload.result.fields, expect.fields.length, "alle h8-velden staan op de draft");
    const pub = await call(admin, "POST", `form-definitions/${crm1.id}/publish`);
    assert.equal(pub.payload.version.published, true, "dictionary-structuur is publiceerbaar");
  });

  test("approve over HTTP · segregation of duties dwingt af (geen zelfgoedkeuring)", async () => {
    const c = await call(admin, "POST", "form-definitions", { key: "API-003", name: "Aankoop 3", form_type: "workflow" });
    const defId = c.payload.form.id;
    await call(admin, "PUT", `form-definitions/${defId}/structure`, STRUCT);
    await call(admin, "POST", `form-definitions/${defId}/publish`);
    const start = await call(emp, "POST", `form-definitions/${defId}/instances`, {});
    const instId = start.payload.instance.id;
    await call(emp, "POST", `form-instances/${instId}/submit`, { answers: { reason: "x" } });

    // De indiener mag niet zelf goedkeuren → 403 SOD_SELF_APPROVAL.
    const self = await call(emp, "POST", `form-instances/${instId}/approve`, { decision: "approved" });
    assert.equal(self.status, 403);
    assert.equal(self.payload.code, "SOD_SELF_APPROVAL");

    // Een andere actor mag → approved, en de lifecycle-events zijn opvraagbaar.
    const ok = await call(mgr, "POST", `form-instances/${instId}/approve`, { decision: "approved", note: "akkoord" });
    assert.equal(ok.status, 200);
    assert.equal(ok.payload.result.status, "approved");
    const events = await call(mgr, "GET", `form-instances/${instId}/events`);
    assert.ok(events.payload.events.some(e => e.event_type === "submitted"));
    assert.ok(events.payload.events.some(e => e.event_type === "approved"));

    await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [T]);
    await pool.end();
  });
}
