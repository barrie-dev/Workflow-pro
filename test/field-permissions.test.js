"use strict";
// Veldrechten-register (Forms h3 · FORM-03). Bewijst de rolmatrix-kernregels:
// bijzondere categorieën + security nooit automatisch (ook niet voor beheerders);
// expliciete veldrechten ontsluiten rechten-gedreven; parity over UI/API/etc.
const { test } = require("node:test");
const assert = require("node:assert");
const F = require("../src/platform/field-permissions");

const admin = { role: "tenant_admin", permissions: [] };
const superadmin = { role: "super_admin", permissions: [] };
const emp = { role: "employee", permissions: ["read:projects"] };
const finance = { role: "employee", permissions: ["field.cost_price.view", "field.bank_account.view"] };
const hr = { role: "employee", permissions: ["field.salary.view", "field.medical.view"] };
const secops = { role: "employee", permissions: ["field.security_secret.view"] };

const V = (u, classification, viewPermission) => F.canViewClassified(u, { classification, viewPermission });

test("het register kent de canonieke veldrechten + het patroon", () => {
  assert.deepEqual(F.FIELD_PERMISSIONS, [
    "field.cost_price.view", "field.salary.view", "field.medical.view",
    "field.bank_account.view", "field.security_secret.view", "field.margin.view",
  ]);
  // h3 noemt voorbeelden; het patroon field.<naam>.view is de echte grens.
  assert.equal(F.isFieldPermission("field.margin.view"), true);
  assert.equal(F.isFieldPermission("costs.view"), true);
  assert.equal(F.isFieldPermission("field.Weird.View"), false);
  assert.equal(F.isFieldPermission("settings"), false);
});

test("public/internal · iedereen ziet, ook zonder gebruiker", () => {
  assert.equal(V(null, "public"), true);
  assert.equal(V(emp, "internal"), true);
});

test("financieel · beheerder ziet automatisch, employee enkel met veldrecht", () => {
  assert.equal(V(admin, "financial"), true, "tenant_admin ziet financieel binnen tenant");
  assert.equal(V(emp, "financial"), false, "employee zonder recht niet");
  assert.equal(V(finance, "financial"), true, "field.cost_price.view ontsluit");
  // costs.view (bestaand samengesteld recht) ontsluit financieel eveneens (parity #75).
  assert.equal(V({ role: "employee", permissions: ["costs.view"] }, "financial"), true);
});

test("bijzondere categorieën · NOOIT automatisch, ook niet voor beheerders (spec-carve-out)", () => {
  assert.equal(V(admin, "special_category", "field.salary.view"), false, "tenant_admin geen automatische salaris");
  assert.equal(V(superadmin, "special_category", "field.medical.view"), false, "superadmin geen automatisch medisch");
  assert.equal(V(hr, "special_category", "field.salary.view"), true, "HR met field.salary.view ziet salaris");
  assert.equal(V(finance, "special_category", "field.salary.view"), false, "financieel recht opent geen salaris");
  // Een medisch veld vraagt field.medical.view, niet field.salary.view.
  assert.equal(V({ role: "employee", permissions: ["field.salary.view"] }, "special_category", "field.medical.view"), false);
});

test("security_sensitive · enkel met field.security_secret.view", () => {
  assert.equal(V(admin, "security_sensitive", "field.security_secret.view"), false, "beheerder niet automatisch");
  assert.equal(V(secops, "security_sensitive", "field.security_secret.view"), true);
  assert.equal(V(secops, "security_sensitive"), true, "klasse-breed recht volstaat");
});

test("confidential/personal · beheerder ziet, employee niet", () => {
  assert.equal(V(admin, "confidential"), true);
  assert.equal(V(admin, "personal"), true);
  assert.equal(V(emp, "confidential"), false);
});

test("hasFieldPermission · scope-prefix-tolerant + wildcard", () => {
  assert.equal(F.hasFieldPermission({ permissions: ["team:field.cost_price.view"] }, "field.cost_price.view"), true);
  assert.equal(F.hasFieldPermission({ permissions: ["*"] }, "field.salary.view"), true);
  assert.equal(F.hasFieldPermission({ permissions: [] }, "field.salary.view"), false);
});
