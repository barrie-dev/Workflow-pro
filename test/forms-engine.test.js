"use strict";
// Gedeelde Forms-engine · kernlogica (F1 Foundation). Bewijst de instance-state-
// machine, de immutable-publish-regel, segregation of duties, de veld-/
// classificatierechten en de server-side antwoordvalidatie.
const { test } = require("node:test");
const assert = require("node:assert");
const E = require("../src/platform/forms-engine");

test("state-machine: geldige overgangen toegestaan, ongeldige geweigerd", () => {
  assert.equal(E.canTransition("draft", "submitted"), true);
  assert.equal(E.canTransition("submitted", "approved"), true);
  assert.equal(E.canTransition("changes_requested", "resubmitted"), true);
  assert.equal(E.canTransition("draft", "approved"), false, "niet rechtstreeks van draft naar approved");
  assert.equal(E.canTransition("archived", "draft"), false, "archived is terminaal");
  assert.throws(() => E.assertTransition("draft", "completed"), e => e.code === "INVALID_TRANSITION");
  assert.throws(() => E.assertTransition("draft", "onbekend"), e => e.code === "INVALID_STATUS");
  E.assertTransition("draft", "draft"); // idempotent no-op mag
  E.assertTransition("submitted", "changes_requested"); // geldig
});

test("state-machine: dekt precies de 13 spec-statussen + editable/terminal", () => {
  assert.equal(E.INSTANCE_STATES.length, 13);
  assert.equal(E.isEditable("draft"), true);
  assert.equal(E.isEditable("changes_requested"), true);
  assert.equal(E.isEditable("submitted"), false, "na indienen niet meer bewerkbaar");
  assert.equal(E.isTerminal("void"), true);
  assert.equal(E.isTerminal("completed"), true);
  assert.equal(E.isTerminal("draft"), false);
});

test("FORM-02: gepubliceerde versie is onveranderlijk; volgend versienummer klopt", () => {
  E.assertVersionEditable({ published: false }); // draft mag
  assert.throws(() => E.assertVersionEditable({ published: true }), e => e.code === "VERSION_PUBLISHED_IMMUTABLE");
  assert.equal(E.nextVersionNumber([]), 1);
  assert.equal(E.nextVersionNumber([1, 2, 3]), 4);
  assert.equal(E.nextVersionNumber([1, 5, 2]), 6);
});

test("FORM-04: If-Match optimistic concurrency", () => {
  E.assertIfMatch(3, 3);   // gelijk → ok
  E.assertIfMatch(3, null); // geen If-Match → ok
  assert.throws(() => E.assertIfMatch(4, 3), e => e.code === "VERSION_CONFLICT" && e.currentVersion === 4);
});

test("FORM-07: segregation of duties · geen zelfgoedkeuring, geen dubbele actie", () => {
  E.assertSegregationOfDuties({ actor: "mgr", submitter: "emp", priorActors: [] }); // ok
  assert.throws(() => E.assertSegregationOfDuties({ actor: "emp", submitter: "emp" }), e => e.code === "SOD_SELF_APPROVAL");
  assert.throws(() => E.assertSegregationOfDuties({ actor: "mgr", submitter: "emp", priorActors: ["mgr"] }), e => e.code === "SOD_DUPLICATE_ACTION");
});

test("FORM-05: veldrechten · classificatie + view_permission, parity-basis", () => {
  const emp = { role: "employee", permissions: ["read:projects"] };
  const admin = { role: "tenant_admin", permissions: [] };
  const costViewer = { role: "employee", permissions: ["costs.view", "field.cost_price.view"] };

  const publicField = { field_key: "name", data_classification: "public" };
  const costField = { field_key: "cost_price", data_classification: "financial", view_permission: "field.cost_price.view" };
  const salaryField = { field_key: "salary", data_classification: "special_category", view_permission: "field.salary.view" };
  const sysField = { field_key: "id", data_classification: "internal", required: "system" };

  assert.equal(E.canViewField(emp, publicField), true, "iedereen ziet public");
  assert.equal(E.canViewField(emp, costField), false, "employee zonder recht ziet geen financieel veld");
  assert.equal(E.canViewField(admin, costField), true, "beheerder ziet gevoelig veld");
  assert.equal(E.canViewField(costViewer, costField), true, "expliciet field.cost_price.view ontsluit het");
  assert.equal(E.canViewField(costViewer, salaryField), false, "costs.view geeft geen salaris");
  assert.equal(E.canEditField(emp, sysField), false, "systeemveld nooit bewerkbaar");
  assert.equal(E.canEditField(admin, publicField), true);

  // Redactie strippt onzichtbare velden uit een antwoordenmap.
  const answers = { name: "Piet", cost_price: 120, salary: 3000 };
  const fields = [publicField, costField, salaryField];
  assert.deepEqual(E.redactAnswers(emp, fields, answers), { name: "Piet" });
  assert.deepEqual(E.redactAnswers(costViewer, fields, answers), { name: "Piet", cost_price: 120 });
});

test("server-side antwoordvalidatie · verplicht + patroon/enum/min-max, per-veld errors", () => {
  const fields = [
    { field_key: "email", required: "required", validation: { pattern: "^[^@]+@[^@]+$" } },
    { field_key: "amount", field_type: "number", validation: { min: 0, max: 100 } },
    { field_key: "kind", validation: { enum: ["a", "b"] } },
    { field_key: "note", required: "optional" },
  ];
  const bad = E.validateAnswers(fields, { amount: 200, kind: "x" });
  assert.equal(bad.ok, false);
  assert.equal(bad.fieldErrors.email, "verplicht");
  assert.equal(bad.fieldErrors.amount, "max 100");
  assert.equal(bad.fieldErrors.kind, "ongeldige keuze");
  const good = E.validateAnswers(fields, { email: "a@b.c", amount: 50, kind: "a" });
  assert.equal(good.ok, true);
  assert.deepEqual(good.fieldErrors, {});
});

test("typed answer-index · numeriek/datum/tekst + reporting/ai-vlaggen", () => {
  const fields = [
    { field_key: "amount", field_type: "number", reporting_allowed: true },
    { field_key: "when", field_type: "date" },
    { field_key: "secret", field_type: "text", ai_allowed: false, reporting_allowed: false },
  ];
  const rows = E.buildAnswerIndex(fields, { amount: "42", when: "2026-08-01", secret: "x" });
  const amt = rows.find(r => r.field_key === "amount");
  assert.equal(amt.value_num, 42);
  assert.equal(amt.reporting_allowed, true);
  assert.equal(rows.find(r => r.field_key === "when").value_date, "2026-08-01");
  assert.equal(rows.find(r => r.field_key === "secret").value_text, "x");
});
