"use strict";
// h23.5/23.6 · Reseller-rechten en scopes (pure beslislaag). Dekt de negatieve
// matrix uit het security-charter: reseller A vs B, sales vs commissie,
// admin vs eigen tier, self-approval, verlopen delegatie, gesuspendeerd.
const { test } = require("node:test");
const assert = require("node:assert");
const A = require("../src/platform/reseller-authz");

// Resellergebruikers van organisatie A · systeemrol blijft "reseller",
// de kanaalrol zit in resellerRole (roleOf pakt die).
const u = (resellerRole, extra = {}) => ({
  email: `${resellerRole}@resA`, role: "reseller", resellerRole,
  resellerId: "resA", permissions: [], ...extra,
});
const ownerA = u("reseller_owner");
const salesA = u("reseller_sales");
const opsA = u("reseller_operations");
const supportA = u("reseller_support");
const financeA = u("reseller_finance");
const adminA = u("reseller_admin");
// Monargo-zijde
const pm = { email: "pm@monargo", role: "monargo_partner_manager", permissions: [] };
const pf = { email: "pf@monargo", role: "monargo_partner_finance", permissions: [] };

// Assignment-records (23.9/23.15): expliciete, actieve tenantkoppeling.
const ASSIGN = [
  { tenantId: "T-A", resellerId: "resA", status: "active" },
  { tenantId: "T-A2", resellerId: "resA", status: "active", endDate: "2999-01-01T00:00:00Z" },
  { tenantId: "T-OLD", resellerId: "resA", status: "active", endDate: "2020-01-01T00:00:00Z" },
  { tenantId: "T-REQ", resellerId: "resA", status: "requested" },
  { tenantId: "T-B", resellerId: "resB", status: "active" },
];

// ── Rechtendomein en grants ──────────────────────────────────────────────────

test("RESELLER_PERMISSIONS · bevat het volledige 23.6-domein plus aanvullingen", () => {
  for (const p of [
    "reseller.organization.view", "reseller.organization.edit", "reseller.users.manage",
    "reseller.deals.create", "reseller.deals.view", "reseller.tenants.request",
    "reseller.tenants.view", "reseller.licenses.request", "reseller.support.view",
    "reseller.commissions.view", "reseller.commissions.dispute", "reseller.delegated_admin.use",
    "reseller.payout.manage", "reseller.payout.approve", "reseller.tier.manage",
    "reseller.deals.approve", "reseller.commissions.manage",
  ]) assert.ok(A.RESELLER_PERMISSIONS.includes(p), `${p} ontbreekt`);
});

test("grantFor · 23.5-defaults per rol", () => {
  assert.equal(A.grantFor(salesA, "reseller.deals.create"), "own");
  assert.equal(A.grantFor(salesA, "reseller.tenants.view"), "assigned");
  assert.equal(A.grantFor(supportA, "reseller.deals.create"), null, "support registreert geen deals");
  assert.equal(A.grantFor(financeA, "reseller.payout.manage"), "own");
  assert.equal(A.grantFor(ownerA, "reseller.users.manage"), "own");
  assert.equal(A.grantFor(pm, "reseller.tier.manage"), "all");
});

test("grantFor · onbekend recht of ontbrekende gebruiker = null", () => {
  assert.equal(A.grantFor(salesA, "reseller.niet.bestaand"), null);
  assert.equal(A.grantFor(salesA, "forms.approve"), null, "vreemd domein hoort hier niet");
  assert.equal(A.grantFor(null, "reseller.deals.view"), null);
});

test("parseGrant · 23.6-suffixnotatie, forms-prefixnotatie en kale default own", () => {
  assert.deepEqual(A.parseGrant("reseller.tenants.view:assigned"), { key: "reseller.tenants.view", scope: "assigned" });
  assert.deepEqual(A.parseGrant("assigned:reseller.tenants.view"), { key: "reseller.tenants.view", scope: "assigned" });
  assert.deepEqual(A.parseGrant("reseller.deals.view"), { key: "reseller.deals.view", scope: "own" });
});

test("grantFor · expliciete grant verruimt, hoogste scope wint", () => {
  const ops = u("reseller_operations", { permissions: ["reseller.commissions.view:own"] });
  assert.equal(A.grantFor(ops, "reseller.commissions.view"), "own", "aparte scope kan financiele data ontsluiten (23.5)");
  const wide = u("reseller_support", { permissions: ["all:reseller.support.view"] });
  assert.equal(A.grantFor(wide, "reseller.support.view"), "all", "expliciet all wint van builtin assigned");
});

test("grantFor · '*' geeft all voor platformrollen zonder deny", () => {
  const god = { email: "god@monargo", role: "super_admin", permissions: ["*"] };
  assert.equal(A.grantFor(god, "reseller.payout.manage"), "all");
});

// ── Gevoelige beperkingen 23.5 · hard en niet verruimbaar ────────────────────

test("sales mag GEEN commissie-uitbetaling wijzigen, ook niet met expliciete grant", () => {
  assert.equal(A.grantFor(salesA, "reseller.payout.manage"), null);
  assert.equal(A.grantFor(salesA, "reseller.commissions.manage"), null);
  const salesPlus = u("reseller_sales", { permissions: ["all:reseller.payout.manage", "*"] });
  assert.equal(A.grantFor(salesPlus, "reseller.payout.manage"), null, "SENSITIVE_DENY wint van elke grant");
});

test("sales · geen klantdata buiten deals: delegated_admin hard dicht", () => {
  const salesPlus = u("reseller_sales", { permissions: ["assigned:reseller.delegated_admin.use"] });
  assert.equal(A.grantFor(salesPlus, "reseller.delegated_admin.use"), null);
});

test("finance · geen operationele klantdata (support/delegated), commissie wel", () => {
  assert.equal(A.grantFor(financeA, "reseller.support.view"), null);
  assert.equal(A.grantFor(financeA, "reseller.delegated_admin.use"), null);
  const finPlus = u("reseller_finance", { permissions: ["all:reseller.support.view"] });
  assert.equal(A.grantFor(finPlus, "reseller.support.view"), null, "niet verruimbaar");
  assert.equal(A.grantFor(financeA, "reseller.commissions.dispute"), "own");
});

test("reseller_admin en owner · eigen contracttype/partner tier niet aanpasbaar", () => {
  assert.equal(A.grantFor(adminA, "reseller.tier.manage"), null);
  assert.equal(A.grantFor(ownerA, "reseller.tier.manage"), null);
  const adminPlus = u("reseller_admin", { permissions: ["*"] });
  assert.equal(A.grantFor(adminPlus, "reseller.tier.manage"), null, "zelfs '*' verruimt eigen tier niet");
});

test("partner manager · geen payoutwijziging zonder financecontrole", () => {
  assert.equal(A.grantFor(pm, "reseller.payout.manage"), null);
  assert.equal(A.grantFor(pm, "reseller.payout.approve"), null);
  assert.equal(A.grantFor(pm, "reseller.deals.approve"), "all", "dealbeoordeling wel");
});

test("partner finance · dealclaim kan, maar uitsluitend met vier-ogencontrole", () => {
  assert.equal(A.grantFor(pf, "reseller.deals.approve"), "all");
  assert.equal(A.requiresFourEyes("reseller.deals.approve"), true);
});

// ── Tenantscope: assignment verplicht (23.15) ────────────────────────────────

test("tenantInScope · actieve assignment ja, andermans tenant nee (ISO-04)", () => {
  assert.equal(A.tenantInScope(salesA, "T-A", ASSIGN), true);
  assert.equal(A.tenantInScope(salesA, "T-B", ASSIGN), false, "assignment hoort bij reseller B");
});

test("tenantInScope · reseller_id alleen is nooit genoeg: zonder record geen scope", () => {
  assert.equal(A.tenantInScope(salesA, "T-A", []), false, "geen assignment-record = geen toegang");
  assert.equal(A.tenantInScope(salesA, "T-A", null), false);
});

test("tenantInScope · verlopen of niet-actieve assignment telt niet", () => {
  assert.equal(A.tenantInScope(salesA, "T-OLD", ASSIGN), false, "einddatum verstreken");
  assert.equal(A.tenantInScope(salesA, "T-REQ", ASSIGN), false, "status requested is niet actief");
  assert.equal(A.tenantInScope(salesA, "T-A2", ASSIGN), true, "einddatum in de toekomst wel");
});

test("tenantInScope · gebruiker zonder resellerId of ongeldige datum faalt dicht", () => {
  assert.equal(A.tenantInScope(pm, "T-A", ASSIGN), false, "Monargo-zijde loopt via all-scope, niet via assignment");
  const kapot = [{ tenantId: "T-K", resellerId: "resA", status: "active", endDate: "geen-datum" }];
  assert.equal(A.tenantInScope(salesA, "T-K", kapot), false, "onparseerbare einddatum = dicht");
});

// ── canResellerAction: de charter-matrix ─────────────────────────────────────

test("ISO-03 · expliciete vreemde resellerId is een harde weigering, geen herfilteren", () => {
  assert.equal(A.canResellerAction(salesA, "reseller.deals.view", { resellerId: "resB" }), false);
  assert.equal(A.canResellerAction(financeA, "reseller.commissions.view", { resellerId: "resB" }), false, "ISO-05 statement van B");
  assert.equal(A.canResellerAction(salesA, "reseller.deals.view", { resellerId: "resA" }), true, "eigen scope wel");
});

test("assigned-scope · vereist actieve tenantkoppeling, geen tenant = geen besluit", () => {
  assert.equal(A.canResellerAction(opsA, "reseller.delegated_admin.use", { tenantId: "T-A", assignments: ASSIGN }), true);
  assert.equal(A.canResellerAction(opsA, "reseller.delegated_admin.use", { tenantId: "T-B", assignments: ASSIGN }), false, "tenant van B");
  assert.equal(A.canResellerAction(opsA, "reseller.delegated_admin.use", { assignments: ASSIGN }), false, "zonder tenantId dicht");
});

test("all-scope · Monargo-zijde werkt over elke partner, ook gesuspendeerd", () => {
  assert.equal(A.canResellerAction(pm, "reseller.organization.edit", { resellerId: "resB" }), true);
  assert.equal(A.canResellerAction(pm, "reseller.organization.edit", { resellerId: "resB", resellerStatus: "suspended" }), true,
    "suspensiebeheer moet mogelijk blijven");
});

test("gesuspendeerde reseller · nieuwe deals en beheeracties dicht, rapportering open (23.4)", () => {
  const susp = { resellerStatus: "suspended", resellerId: "resA" };
  assert.equal(A.canResellerAction(salesA, "reseller.deals.create", susp), false);
  assert.equal(A.canResellerAction(salesA, "reseller.tenants.request", susp), false);
  assert.equal(A.canResellerAction(adminA, "reseller.users.manage", susp), false);
  assert.equal(A.canResellerAction(salesA, "reseller.deals.view", susp), true, "historische rapportering blijft");
  assert.equal(A.canResellerAction(financeA, "reseller.commissions.view", susp), true);
});

test("terminated · zelfde blokkade als suspensie voor niet-views", () => {
  const term = { resellerStatus: "terminated", resellerId: "resA" };
  assert.equal(A.canResellerAction(financeA, "reseller.payout.manage", term), false);
  assert.equal(A.canResellerAction(ownerA, "reseller.organization.view", term), true);
});

test("suspensionBlocks · views vrij, al de rest en onbekende acties dicht", () => {
  assert.equal(A.suspensionBlocks("reseller.deals.view"), false);
  assert.equal(A.suspensionBlocks("reseller.commissions.view"), false);
  assert.equal(A.suspensionBlocks("reseller.deals.create"), true);
  assert.equal(A.suspensionBlocks("reseller.commissions.dispute"), true);
  assert.equal(A.suspensionBlocks("reseller.payout.manage"), true);
  assert.equal(A.suspensionBlocks("volstrekt.onbekend"), true, "onbekend = dicht");
});

test("canResellerAction · zonder recht altijd false (support vs commissie)", () => {
  assert.equal(A.canResellerAction(supportA, "reseller.commissions.view", { resellerId: "resA" }), false);
  assert.equal(A.canResellerAction(supportA, "reseller.deals.create", { resellerId: "resA" }), false);
});

// ── Vier-ogen en self-approval ───────────────────────────────────────────────

test("requiresFourEyes · attributie, payout en dealclaim ja, views nee", () => {
  assert.equal(A.requiresFourEyes("reseller.deals.approve"), true);
  assert.equal(A.requiresFourEyes("reseller.payout.approve"), true);
  assert.equal(A.requiresFourEyes("reseller.payout.manage"), true);
  assert.equal(A.requiresFourEyes("reseller.commissions.manage"), true);
  assert.equal(A.requiresFourEyes("reseller.deals.view"), false);
  assert.equal(A.requiresFourEyes("reseller.commissions.view"), false);
});

test("assertNotSelfApproval · zelfde actor gooit 403 SELF_APPROVAL_FORBIDDEN", () => {
  assert.throws(() => A.assertNotSelfApproval("fin@a", "fin@a"),
    e => e.status === 403 && e.code === "SELF_APPROVAL_FORBIDDEN");
});

test("assertNotSelfApproval · hoofdletters en spaties maskeren niets", () => {
  assert.throws(() => A.assertNotSelfApproval(" Fin@A ", "fin@a"),
    e => e.code === "SELF_APPROVAL_FORBIDDEN");
});

test("assertNotSelfApproval · ontbrekende identiteit faalt dicht, verschil is ok", () => {
  assert.throws(() => A.assertNotSelfApproval("", "fin@a"), e => e.code === "SELF_APPROVAL_FORBIDDEN");
  assert.throws(() => A.assertNotSelfApproval("fin@a", null), e => e.code === "SELF_APPROVAL_FORBIDDEN");
  assert.equal(A.assertNotSelfApproval("pm@monargo", "fin@a"), true);
});

// ── Gedelegeerde toegang (23.12/23.14 · DLG-matrix) ──────────────────────────

const grant = (over = {}) => ({
  tenantId: "T-A", resellerId: "resA", status: "active",
  scope: ["config.write"], reason: "onboarding", startDate: "2026-01-01T00:00:00Z",
  endDate: "2999-01-01T00:00:00Z", ...over,
});

test("DLG-01 · geen delegatierecord = DELEGATED_ACCESS_REQUIRED", () => {
  const d = A.delegationDecision(null, "config.write", { tenantId: "T-A" });
  assert.deepEqual(d, { ok: false, status: 403, code: "DELEGATED_ACCESS_REQUIRED" });
});

test("DLG-03 · status active maar einddatum verstreken = EXPIRED", () => {
  const d = A.delegationDecision(grant({ endDate: "2026-07-21T00:00:00Z" }), "config.write",
    { tenantId: "T-A", now: "2026-07-22T12:00:00Z" });
  assert.equal(d.code, "DELEGATED_ACCESS_EXPIRED");
});

test("DLG-04 · ingetrokken delegatie is onmiddellijk REVOKED", () => {
  const d = A.delegationDecision(grant({ status: "revoked" }), "config.write", { tenantId: "T-A" });
  assert.equal(d.code, "DELEGATED_ACCESS_REVOKED");
});

test("DLG-05/DLG-10 · scope-overschrijding: read geeft nooit write", () => {
  const d = A.delegationDecision(grant({ scope: ["read"] }), "config.write", { tenantId: "T-A" });
  assert.equal(d.code, "DELEGATED_SCOPE_EXCEEDED");
  const d2 = A.delegationDecision(grant({ scope: "support.read" }), "users.admin", { tenantId: "T-A" });
  assert.equal(d2.code, "DELEGATED_SCOPE_EXCEEDED", "gebruikersbeheer vereist expliciet user-admin scope");
});

test("DLG-06 · delegatie is strikt per tenant: record van T-A telt niet op T-A2", () => {
  const d = A.delegationDecision(grant(), "config.write", { tenantId: "T-A2" });
  assert.equal(d.code, "DELEGATED_ACCESS_REQUIRED", "mismatch lekt niet dat elders wel een grant bestaat");
});

test("DLG-07 · nog niet tenant_approved/active = NOT_ACTIVE", () => {
  assert.equal(A.delegationDecision(grant({ status: "requested" }), "config.write", { tenantId: "T-A" }).code,
    "DELEGATED_ACCESS_NOT_ACTIVE");
  assert.equal(A.delegationDecision(grant({ status: "tenant_approved" }), "config.write", { tenantId: "T-A" }).code,
    "DELEGATED_ACCESS_NOT_ACTIVE");
});

test("delegatie · startdatum in de toekomst is nog niet actief", () => {
  const d = A.delegationDecision(grant({ startDate: "2999-01-01T00:00:00Z" }), "config.write", { tenantId: "T-A" });
  assert.equal(d.code, "DELEGATED_ACCESS_NOT_ACTIVE");
});

test("delegatie · geldig record met juiste scope en tenant = ok", () => {
  assert.deepEqual(A.delegationDecision(grant(), "config.write", { tenantId: "T-A" }), { ok: true });
  assert.equal(A.assertDelegation(grant(), "config.write", { tenantId: "T-A" }), true);
});

test("assertDelegation · gooit met status en code, vaste boodschap", () => {
  assert.throws(() => A.assertDelegation(grant({ status: "revoked" }), "config.write", { tenantId: "T-A" }),
    e => e.status === 403 && e.code === "DELEGATED_ACCESS_REVOKED" && e.message === "Geen toegang");
});

// ── Anti-probing fouten (ISO-07) ─────────────────────────────────────────────

test("notFoundError · vaste code per soort en byte-identieke boodschap", () => {
  const e1 = A.notFoundError("deal");
  const e2 = A.notFoundError("deal");
  assert.equal(e1.status, 404);
  assert.equal(e1.code, "DEAL_NOT_FOUND");
  assert.equal(A.notFoundError("tenant").code, "TENANT_NOT_FOUND");
  assert.equal(A.notFoundError("statement").code, "STATEMENT_NOT_FOUND");
  const shape = e => JSON.stringify({ status: e.status, code: e.code, message: e.message });
  assert.equal(shape(e1), shape(e2), "vreemd id en onbestaand id geven exact dezelfde body");
});

test("forbiddenError en scopeViolationError · generiek, zonder objectdetails", () => {
  const f = A.forbiddenError();
  assert.equal(f.status, 403);
  assert.equal(f.code, "RESELLER_FORBIDDEN");
  assert.equal(f.message, "Geen toegang");
  const s = A.scopeViolationError();
  assert.equal(s.code, "RESELLER_SCOPE_VIOLATION");
  assert.equal(s.message, "Geen toegang", "zelfde boodschap als elke andere weigering");
  assert.equal(A.forbiddenError("TENANT_LINK_FORBIDDEN").code, "TENANT_LINK_FORBIDDEN");
});

// ── MFA (23.15) ──────────────────────────────────────────────────────────────

test("requiresMfa · admins, finance en gedelegeerde toegang ja; sales-view nee", () => {
  assert.equal(A.requiresMfa(adminA, "reseller.users.manage"), true);
  assert.equal(A.requiresMfa(financeA, "reseller.commissions.view"), true);
  assert.equal(A.requiresMfa(pf, "reseller.commissions.manage"), true);
  assert.equal(A.requiresMfa(opsA, "reseller.delegated_admin.use"), true, "gedelegeerde tenanttoegang = MFA");
  assert.equal(A.requiresMfa(salesA, "reseller.deals.view"), false);
  assert.equal(A.requiresMfa(salesA, "reseller.payout.approve"), true, "vier-ogenactie impliceert MFA");
});
