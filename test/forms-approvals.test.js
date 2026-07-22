"use strict";
// h26 · goedkeuringsbeleid (pure engine): serial, parallel, any-of/all-of.
const { test } = require("node:test");
const assert = require("node:assert");
const E = require("../src/platform/forms-engine");

test("zonder beleid · één goedkeuring volstaat, één afwijzing beslist", () => {
  assert.equal(E.evaluateApprovals(null, []).status, "pending");
  assert.equal(E.evaluateApprovals(null, [{ step_no: 1, actor: "a", decision: "approved" }]).status, "approved");
  assert.equal(E.evaluateApprovals(null, [{ step_no: 1, actor: "a", decision: "rejected" }]).status, "rejected");
});

test("serial · stap 2 pas na stap 1; pendingStep wijst de open stap aan", () => {
  const policy = { steps: [{ step_no: 1, mode: "any_of" }, { step_no: 2, mode: "any_of" }] };
  const s0 = E.evaluateApprovals(policy, []);
  assert.deepEqual([s0.status, s0.pendingStep], ["pending", 1]);
  const s1 = E.evaluateApprovals(policy, [{ step_no: 1, actor: "a", decision: "approved" }]);
  assert.deepEqual([s1.status, s1.pendingStep], ["pending", 2]);
  const s2 = E.evaluateApprovals(policy, [
    { step_no: 1, actor: "a", decision: "approved" },
    { step_no: 2, actor: "b", decision: "approved" },
  ]);
  assert.equal(s2.status, "approved");
  // Afwijzing op stap 2 beslist de hele flow.
  const r = E.evaluateApprovals(policy, [
    { step_no: 1, actor: "a", decision: "approved" },
    { step_no: 2, actor: "b", decision: "rejected" },
  ]);
  assert.equal(r.status, "rejected");
});

test("all_of · alle genoemde goedkeurders moeten tekenen (parallel binnen de stap)", () => {
  const policy = { steps: [{ step_no: 1, mode: "all_of", approvers: ["fin@x", "hr@x"] }] };
  const half = E.evaluateApprovals(policy, [{ step_no: 1, actor: "fin@x", decision: "approved" }]);
  assert.equal(half.status, "pending", "één van twee is niet genoeg");
  const full = E.evaluateApprovals(policy, [
    { step_no: 1, actor: "fin@x", decision: "approved" },
    { step_no: 1, actor: "hr@x", decision: "approved" },
  ]);
  assert.equal(full.status, "approved");
});

test("any_of met min · quorum in plaats van één", () => {
  const policy = { steps: [{ step_no: 1, mode: "any_of", min: 2 }] };
  assert.equal(E.evaluateApprovals(policy, [{ step_no: 1, actor: "a", decision: "approved" }]).status, "pending");
  assert.equal(E.evaluateApprovals(policy, [
    { step_no: 1, actor: "a", decision: "approved" },
    { step_no: 1, actor: "b", decision: "approved" },
  ]).status, "approved");
});

test("actorAllowedForStep · goedkeurderslijst op e-mail of rol", () => {
  const step = { step_no: 1, approvers: ["fin@x", "manager"] };
  assert.equal(E.actorAllowedForStep(step, "fin@x", "employee"), true, "op e-mail");
  assert.equal(E.actorAllowedForStep(step, "jan@x", "manager"), true, "op rol");
  assert.equal(E.actorAllowedForStep(step, "jan@x", "employee"), false);
  assert.equal(E.actorAllowedForStep({ step_no: 1 }, "iedereen@x", null), true, "geen lijst = geen beperking");
});
