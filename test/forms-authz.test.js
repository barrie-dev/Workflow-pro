"use strict";
// CTO2-01/02 · Forms-objectautorisatie (pure beslislaag). Rolmatrix h3:
// medewerker = eigen/toegewezen, teamleider = team + goedkeuren, admin = alles.
const { test } = require("node:test");
const assert = require("node:assert");
const A = require("../src/platform/forms-authz");

const admin = { email: "admin@t", role: "tenant_admin", permissions: [] };
const emp = { email: "e@t", role: "employee", permissions: [] };
const lead = { email: "l@t", role: "manager", permissions: [] };
const finance = { email: "f@t", role: "employee", permissions: ["forms.approve", "forms.report"] };

const inst = (over = {}) => ({ id: "i1", created_by: "e@t", assigned_to: null, ...over });
const TEAM = { teamEmails: new Set(["e@t", "l@t"]) };

test("grantFor · ingebouwde defaults + expliciete verruiming", () => {
  assert.equal(A.grantFor(admin, "forms.definition.manage"), "tenant");
  assert.equal(A.grantFor(emp, "forms.definition.manage"), null, "medewerker beheert geen definities");
  assert.equal(A.grantFor(emp, "forms.instance.create"), "own");
  assert.equal(A.grantFor(lead, "forms.approve"), "team");
  // Expliciet recht tilt een medewerker naar goedkeuren (tenant-scope).
  assert.equal(A.grantFor(finance, "forms.approve"), "tenant");
});

test("canInstance · eigen dossier ja, andermans dossier nee", () => {
  assert.equal(A.canInstance(emp, inst(), "view"), true, "eigen instance");
  assert.equal(A.canInstance(emp, inst({ created_by: "ander@t" }), "view"), false, "andermans instance");
  assert.equal(A.canInstance(emp, inst({ created_by: "ander@t", assigned_to: "e@t" }), "view"), true, "toegewezen aan mij");
});

test("team-scope · teamleider ziet teamleden, niet daarbuiten", () => {
  assert.equal(A.canInstance(lead, inst({ created_by: "e@t" }), "view", TEAM), true, "teamlid");
  assert.equal(A.canInstance(lead, inst({ created_by: "buiten@t" }), "view", TEAM), false, "buiten het team");
});

test("approve · vraagt forms.approve binnen scope", () => {
  assert.equal(A.canInstance(emp, inst({ created_by: "x@t" }), "forms.approve"), false, "medewerker keurt niet goed");
  assert.equal(A.canInstance(lead, inst({ created_by: "e@t" }), "forms.approve", TEAM), true, "teamleider keurt teamlid goed");
  assert.equal(A.canInstance(finance, inst({ created_by: "wie@t" }), "forms.approve"), true, "expliciet forms.approve = tenant-breed");
});

test("rightForTransition · doelstatus bepaalt het recht", () => {
  assert.equal(A.rightForTransition("withdrawn"), "forms.instance.withdraw");
  assert.equal(A.rightForTransition("approved"), "forms.approve");
  assert.equal(A.rightForTransition("signed"), "forms.sign");
  assert.equal(A.rightForTransition("void"), "forms.definition.manage");
});

test("canManageDefinitions / canPublish", () => {
  assert.equal(A.canManageDefinitions(admin), true);
  assert.equal(A.canManageDefinitions(emp), false);
  assert.equal(A.canPublish(admin), true);
  assert.equal(A.canPublish(emp), false);
  assert.equal(A.canPublish({ role: "employee", permissions: ["forms.definition.publish"] }), true);
});
