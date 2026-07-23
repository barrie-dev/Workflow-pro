"use strict";

// Tests voor src/modules/reseller-lifecycle.js (h23 · 23.2/23.4/23.14/23.15):
// onboarding, activatiegates, suspensie, partnerreview, offboarding,
// tenantplafond en accreditaties. Fake-store-patroon zoals
// test/commission-ledger.test.js · assertions op e.code, niet op de boodschap.

const { test } = require("node:test");
const assert = require("node:assert");
const svc = require("../src/modules/reseller-lifecycle");

function fakeStore(seed = {}) {
  const data = {
    resellers: [], users: [], tenants: [], apiKeys: [],
    resellerAgreements: [], resellerTenantLinks: [], resellerAccessGrants: [],
    resellerReviews: [], resellerOffboardings: [], resellerLifecycleEvents: [],
    commissionEvents: [], commissionPayouts: [],
    audit: [],
    ...seed,
  };
  return {
    data,
    insert(coll, row) { (data[coll] = data[coll] || []).push(row); return row; },
    update(coll, id, patch) {
      data[coll] = (data[coll] || []).map(r => (r.id === id ? { ...r, ...patch } : r));
      return (data[coll] || []).find(r => r.id === id);
    },
    get(coll, id) { return (data[coll] || []).find(r => r.id === id); },
    audit(e) { data.audit.push(e); },
  };
}

const admin = { email: "partner-admin@monargo.one" };

// Volledig geldige organisatie, klaar voor activatie (status onboarding,
// onboarding_status training, contract aanvaard).
function baseOrg(overrides = {}) {
  return {
    id: "r1",
    partner_name: "Acme Partners BV",
    display_name: "Acme",
    partner_type: "reseller",
    status: "onboarding",
    onboarding_status: "training",
    preferred_language: "NL",
    timezone: "Europe/Brussels", locale: "nl-BE", currency: "EUR",
    primary_contact: "c_prim", sales_contact: "c_sales",
    support_contact: "c_sup", finance_contact: "c_fin",
    registered_address: { straat: "Kerkstraat", nummer: "1", postcode: "9000", gemeente: "Gent", land: "BE" },
    billing_email: "finance@acme.be",
    account_manager_id: "u_am",
    agreement_version: "2026-01", accepted_at: "2026-01-10T10:00:00.000Z",
    delegated_support_allowed: false, delegated_tenant_admin_allowed: false,
    ...overrides,
  };
}

function storeWithOrg(overrides = {}, seed = {}) {
  const store = fakeStore(seed);
  store.insert("resellers", baseOrg(overrides));
  return store;
}

// ── Activatie (23.4) ─────────────────────────────────────────────────────────

test("activate · happy path zet status en onboarding_status op active", () => {
  const store = storeWithOrg();
  const org = svc.activate(store, { resellerId: "r1" }, admin);
  assert.equal(org.status, "active");
  assert.equal(org.onboarding_status, "active");
  assert.ok(org.activated_at);
  const log = store.data.resellerLifecycleEvents.find(e => e.action === "activated");
  assert.ok(log, "lifecycle-log met before/after verwacht");
  assert.equal(log.before.status, "onboarding");
  assert.equal(log.after.status, "active");
  assert.ok(store.data.audit.some(a => a.action === "permission_reseller_activated"));
});

test("activate · zonder agreement_version geweigerd (geen actief contract)", () => {
  const store = storeWithOrg({ agreement_version: null });
  assert.throws(() => svc.activate(store, { resellerId: "r1" }, admin),
    e => e.status === 409 && e.code === "RESELLER_ACTIVATION_BLOCKED" && !!e.fieldErrors.agreement_version);
  assert.equal(store.get("resellers", "r1").status, "onboarding", "status mag niet wijzigen");
});

test("activate · zonder accepted_at geweigerd", () => {
  const store = storeWithOrg({ accepted_at: null });
  assert.throws(() => svc.activate(store, { resellerId: "r1" }, admin),
    e => e.code === "RESELLER_ACTIVATION_BLOCKED" && !!e.fieldErrors.accepted_at);
});

test("activate · contractrecords aanwezig maar geen actief record = geweigerd", () => {
  const store = storeWithOrg();
  store.insert("resellerAgreements", {
    id: "a1", resellerId: "r1", agreement_id: "AG-1", version: 1,
    status: "expired", start_date: "2025-01-01", end_date: "2025-12-31",
  });
  assert.throws(() => svc.activate(store, { resellerId: "r1" }, admin),
    e => e.code === "RESELLER_ACTIVATION_BLOCKED" && !!e.fieldErrors.agreement);
  // Met een actief record binnen het venster lukt de activatie wel.
  store.insert("resellerAgreements", {
    id: "a2", resellerId: "r1", agreement_id: "AG-1", version: 2,
    status: "active", start_date: "2026-01-01", end_date: null,
  });
  assert.equal(svc.activate(store, { resellerId: "r1" }, admin).status, "active");
});

test("activate · vanaf verkeerde organisatiestatus geweigerd door de machine", () => {
  const store = storeWithOrg({ status: "contracting" });
  assert.throws(() => svc.activate(store, { resellerId: "r1" }, admin),
    e => e.status === 409 && e.code === "RESELLER_ORG_TRANSITION_INVALID");
});

test("activate · onboarding_status nog niet bij training = geweigerd", () => {
  const store = storeWithOrg({ onboarding_status: "contracting" });
  assert.throws(() => svc.activate(store, { resellerId: "r1" }, admin),
    e => e.status === 409 && e.code === "ONBOARDING_STATUS_TRANSITION_INVALID");
});

test("activate · dpa-gate: klantdataverwerking mogelijk zonder dpa_accepted_at = geweigerd", () => {
  const store = storeWithOrg({ delegated_support_allowed: true });
  assert.throws(() => svc.activate(store, { resellerId: "r1" }, admin),
    e => e.code === "RESELLER_ACTIVATION_BLOCKED" && !!e.fieldErrors.dpa_accepted_at);
  store.update("resellers", "r1", { dpa_accepted_at: "2026-01-11T09:00:00.000Z" });
  assert.equal(svc.activate(store, { resellerId: "r1" }, admin).status, "active");
});

test("activate · nda-gate: vertrouwelijke toegang (tier gold) zonder nda_accepted_at = geweigerd", () => {
  const store = storeWithOrg({ partner_tier: "gold" });
  assert.throws(() => svc.activate(store, { resellerId: "r1" }, admin),
    e => e.code === "RESELLER_ACTIVATION_BLOCKED" && !!e.fieldErrors.nda_accepted_at);
});

// ── Onboarding-statusveld (23.2) ─────────────────────────────────────────────

test("advanceOnboarding · volgt de machine en weigert stappen overslaan", () => {
  const store = storeWithOrg({ onboarding_status: "applied" });
  assert.equal(svc.advanceOnboarding(store, { resellerId: "r1", to: "screening" }, admin).onboarding_status, "screening");
  assert.throws(() => svc.advanceOnboarding(store, { resellerId: "r1", to: "training" }, admin),
    e => e.status === 409 && e.code === "ONBOARDING_STATUS_TRANSITION_INVALID");
});

test("advanceOnboarding · naar active kan alleen via activate()", () => {
  const store = storeWithOrg();
  assert.throws(() => svc.advanceOnboarding(store, { resellerId: "r1", to: "active" }, admin),
    e => e.status === 409 && e.code === "ACTIVATION_VIA_ACTIVATE");
});

// ── Organisatiemachine (23.14) ───────────────────────────────────────────────

test("transitionOrganization · applicant naar onboarding stap voor stap, terugspringen geweigerd", () => {
  const store = storeWithOrg({ status: "applicant", onboarding_status: "applied" });
  svc.transitionOrganization(store, { resellerId: "r1", to: "screening" }, admin);
  svc.transitionOrganization(store, { resellerId: "r1", to: "contracting" }, admin);
  const org = svc.transitionOrganization(store, { resellerId: "r1", to: "onboarding" }, admin);
  assert.equal(org.status, "onboarding");
  assert.throws(() => svc.transitionOrganization(store, { resellerId: "r1", to: "screening" }, admin),
    e => e.status === 409 && e.code === "RESELLER_ORG_TRANSITION_INVALID");
});

test("transitionOrganization · onbekende reseller = 404 RESELLER_NOT_FOUND", () => {
  const store = fakeStore();
  assert.throws(() => svc.transitionOrganization(store, { resellerId: "geen", to: "screening" }, admin),
    e => e.status === 404 && e.code === "RESELLER_NOT_FOUND");
});

// ── Suspensie (23.2/23.4) ────────────────────────────────────────────────────

test("suspend · reden verplicht", () => {
  const store = storeWithOrg({ status: "active", onboarding_status: "active" });
  assert.throws(() => svc.suspend(store, { resellerId: "r1", reason: "  " }, admin),
    e => e.status === 400 && e.code === "SUSPENSION_REASON_REQUIRED");
});

test("suspend · zet reden + datum, trekt gedelegeerde toegang in en logt before/after", () => {
  const store = storeWithOrg({ status: "active", onboarding_status: "active" });
  store.insert("resellerAccessGrants", { id: "g1", resellerId: "r1", tenantId: "t1", status: "active" });
  const org = svc.suspend(store, { resellerId: "r1", reason: "wanbetaling" }, admin);
  assert.equal(org.status, "suspended");
  assert.equal(org.suspension_reason, "wanbetaling");
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(org.suspension_date));
  assert.equal(store.get("resellerAccessGrants", "g1").status, "revoked");
  const log = store.data.resellerLifecycleEvents.find(e => e.action === "suspended");
  assert.equal(log.before.status, "active");
  assert.equal(log.after.status, "suspended");
  assert.ok(store.data.audit.some(a => a.action === "permission_reseller_suspended"));
});

test("suspensie blokkeert nieuw werk: assertOperational en linkTenant weigeren", () => {
  const store = storeWithOrg({ status: "active", onboarding_status: "active" });
  store.insert("tenants", { id: "t1", name: "Klant 1" });
  svc.suspend(store, { resellerId: "r1", reason: "onderzoek" }, admin);
  assert.throws(() => svc.assertOperational(store, "r1"),
    e => e.status === 403 && e.code === "RESELLER_NOT_ACTIVE");
  assert.throws(() => svc.linkTenant(store, { resellerId: "r1", tenantId: "t1" }, admin),
    e => e.status === 403 && e.code === "RESELLER_NOT_ACTIVE");
});

test("suspensie bewaart historische rapportering: bestaande data blijft leesbaar", () => {
  const store = storeWithOrg({ status: "active", onboarding_status: "active" });
  store.insert("commissionEvents", { id: "cev_1", resellerId: "r1", type: "accrual", period: "2026-06", amount: 25 });
  store.insert("commissionEvents", { id: "cev_2", resellerId: "r1", type: "accrual", period: "2026-07", amount: 30 });
  svc.suspend(store, { resellerId: "r1", reason: "onderzoek" }, admin);
  const overview = svc.historicalOverview(store, "r1");
  assert.equal(overview.organization.status, "suspended");
  assert.equal(overview.commissionEvents.length, 2, "historische commissiedata blijft zichtbaar");
});

test("terminate · alleen vanaf suspended, zet termination_date", () => {
  const store = storeWithOrg({ status: "active", onboarding_status: "active" });
  assert.throws(() => svc.terminate(store, { resellerId: "r1" }, admin),
    e => e.status === 409 && e.code === "RESELLER_ORG_TRANSITION_INVALID");
  svc.suspend(store, { resellerId: "r1", reason: "einde samenwerking" }, admin);
  const org = svc.terminate(store, { resellerId: "r1", reason: "contract afgelopen" }, admin);
  assert.equal(org.status, "terminated");
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(org.termination_date));
  assert.ok(org.exit_status);
});

// ── Partnerreview (23.14) ────────────────────────────────────────────────────

test("scheduleReview · review_date verplicht, daarna scheduled", () => {
  const store = storeWithOrg({ status: "active", onboarding_status: "active" });
  assert.throws(() => svc.scheduleReview(store, { resellerId: "r1", reviewDate: "" }, admin),
    e => e.status === 400 && e.code === "REVIEW_DATE_REQUIRED");
  const review = svc.scheduleReview(store, { resellerId: "r1", reviewDate: "2026-09-01" }, admin);
  assert.equal(review.status, "scheduled");
  assert.equal(review.reviewDate, "2026-09-01");
});

test("transitionReview · machinevolgorde afgedwongen, approved legt beslisser vast", () => {
  const store = storeWithOrg({ status: "active", onboarding_status: "active" });
  const review = svc.scheduleReview(store, { resellerId: "r1", reviewDate: "2026-09-01" }, admin);
  assert.throws(() => svc.transitionReview(store, { reviewId: review.id, to: "approved" }, admin),
    e => e.status === 409 && e.code === "PARTNER_REVIEW_TRANSITION_INVALID");
  svc.transitionReview(store, { reviewId: review.id, to: "in_review" }, admin);
  svc.transitionReview(store, { reviewId: review.id, to: "action_required" }, admin);
  const done = svc.transitionReview(store, { reviewId: review.id, to: "approved", reason: "alles in orde" }, admin);
  assert.equal(done.status, "approved");
  assert.equal(done.decidedBy, admin.email);
});

test("transitionReview · suspended-uitkomst suspendeert de organisatie met reden", () => {
  const store = storeWithOrg({ status: "active", onboarding_status: "active" });
  const review = svc.scheduleReview(store, { resellerId: "r1", reviewDate: "2026-09-01" }, admin);
  svc.transitionReview(store, { reviewId: review.id, to: "in_review" }, admin);
  svc.transitionReview(store, { reviewId: review.id, to: "action_required" }, admin);
  assert.throws(() => svc.transitionReview(store, { reviewId: review.id, to: "suspended", reason: " " }, admin),
    e => e.status === 400 && e.code === "SUSPENSION_REASON_REQUIRED");
  svc.transitionReview(store, { reviewId: review.id, to: "suspended", reason: "auditfalen" }, admin);
  const org = store.get("resellers", "r1");
  assert.equal(org.status, "suspended");
  assert.match(org.suspension_reason, /auditfalen/);
});

test("transitionReview · onbekende review = 404 REVIEW_NOT_FOUND", () => {
  const store = fakeStore();
  assert.throws(() => svc.transitionReview(store, { reviewId: "geen", to: "in_review" }, admin),
    e => e.status === 404 && e.code === "REVIEW_NOT_FOUND");
});

// ── Offboarding (23.14/23.15) ────────────────────────────────────────────────

function suspendedStore(extraSeed = {}) {
  const store = storeWithOrg({ status: "active", onboarding_status: "active" }, extraSeed);
  svc.suspend(store, { resellerId: "r1", reason: "einde samenwerking" }, admin);
  return store;
}

test("startOffboarding · vereist een gesuspendeerde of beeindigde organisatie", () => {
  const store = storeWithOrg({ status: "active", onboarding_status: "active" });
  assert.throws(() => svc.startOffboarding(store, { resellerId: "r1" }, admin),
    e => e.status === 409 && e.code === "OFFBOARDING_REQUIRES_SUSPENSION");
});

test("startOffboarding · maximaal een lopend traject per reseller", () => {
  const store = suspendedStore();
  svc.startOffboarding(store, { resellerId: "r1", reason: "opzegging" }, admin);
  assert.throws(() => svc.startOffboarding(store, { resellerId: "r1" }, admin),
    e => e.status === 409 && e.code === "OFFBOARDING_ALREADY_OPEN");
});

test("offboarding · stappen overslaan geweigerd door de machine", () => {
  const store = suspendedStore();
  const ob = svc.startOffboarding(store, { resellerId: "r1" }, admin);
  assert.throws(() => svc.transitionOffboarding(store, { offboardingId: ob.id, to: "tenants_transferred" }, admin),
    e => e.status === 409 && e.code === "OFFBOARDING_TRANSITION_INVALID");
});

test("offboarding · access_revoked trekt tokens, invitations, API-keys en delegaties onmiddellijk in", () => {
  const store = suspendedStore({
    users: [
      { id: "u1", resellerId: "r1", email: "a@acme.be", active: true, activation: null },
      { id: "u2", resellerId: "r1", email: "b@acme.be", active: false, activation: { tokenHash: "x", expiresAt: "2026-08-01" } },
      { id: "u3", resellerId: "ander", email: "c@other.be", active: true, activation: null },
    ],
    apiKeys: [
      { id: "k1", resellerId: "r1", tenantId: null, status: "active" },
      { id: "k2", resellerId: "ander", tenantId: null, status: "active" },
    ],
  });
  // Delegatie die na de suspensie opnieuw is toegekend: offboarding ruimt ook die op.
  store.insert("resellerAccessGrants", { id: "g9", resellerId: "r1", tenantId: "t1", status: "active" });
  const ob = svc.startOffboarding(store, { resellerId: "r1" }, admin);
  const next = svc.transitionOffboarding(store, { offboardingId: ob.id, to: "access_revoked" }, admin);
  assert.equal(next.revoked.users, 1);
  assert.equal(next.revoked.invitations, 1);
  assert.equal(next.revoked.apiKeys, 1);
  assert.equal(next.revoked.delegatedGrants, 1);
  const u1 = store.get("users", "u1");
  assert.equal(u1.active, false, "sessies sterven doordat authenticate inactieve gebruikers weigert");
  assert.equal(store.get("users", "u2").activation, null, "open invitation ingetrokken");
  assert.equal(store.get("users", "u3").active, true, "vreemde reseller blijft onaangeroerd");
  assert.equal(store.get("apiKeys", "k1").status, "revoked");
  assert.equal(store.get("apiKeys", "k2").status, "active");
  assert.equal(store.get("resellerAccessGrants", "g9").status, "revoked");
  assert.ok(store.data.audit.some(a => a.action === "permission_access_revoked"));
});

test("offboarding · tenants_transferred beeindigt actieve koppelingen maar bewaart de records", () => {
  const store = suspendedStore({
    resellerTenantLinks: [{ id: "l1", resellerId: "r1", tenantId: "t1", status: "active", startDate: "2026-01-01", endDate: null }],
  });
  const ob = svc.startOffboarding(store, { resellerId: "r1" }, admin);
  svc.transitionOffboarding(store, { offboardingId: ob.id, to: "access_revoked" }, admin);
  const next = svc.transitionOffboarding(store, { offboardingId: ob.id, to: "tenants_transferred" }, admin);
  assert.equal(next.transferredLinks, 1);
  const link = store.get("resellerTenantLinks", "l1");
  assert.equal(link.status, "ended");
  assert.equal(link.endReason, "offboarding");
  assert.equal(store.data.resellerTenantLinks.length, 1, "record blijft bestaan voor de historiek");
});

test("offboarding · finance_closed geweigerd zolang er open payouts staan", () => {
  const store = suspendedStore({
    commissionPayouts: [{ id: "p1", resellerId: "r1", status: "approved", amount: 100, eventIds: [] }],
  });
  const ob = svc.startOffboarding(store, { resellerId: "r1" }, admin);
  svc.transitionOffboarding(store, { offboardingId: ob.id, to: "access_revoked" }, admin);
  svc.transitionOffboarding(store, { offboardingId: ob.id, to: "tenants_transferred" }, admin);
  assert.throws(() => svc.transitionOffboarding(store, { offboardingId: ob.id, to: "finance_closed" }, admin),
    e => e.status === 409 && e.code === "OFFBOARDING_FINANCE_OPEN");
  store.update("commissionPayouts", "p1", { status: "paid" });
  const next = svc.transitionOffboarding(store, { offboardingId: ob.id, to: "finance_closed" }, admin);
  assert.ok(next.financeClosedAt);
});

test("offboarding · financiele historie overleeft, organisatie eindigt als terminated", () => {
  const store = suspendedStore({
    commissionEvents: [
      { id: "cev_1", resellerId: "r1", type: "accrual", period: "2026-06", amount: 25 },
      { id: "cev_2", resellerId: "r1", type: "clawback", period: "2026-06", amount: -5 },
    ],
    commissionPayouts: [{ id: "p1", resellerId: "r1", status: "paid", amount: 20, eventIds: ["cev_1"] }],
  });
  const ob = svc.startOffboarding(store, { resellerId: "r1" }, admin);
  for (const to of ["access_revoked", "tenants_transferred", "finance_closed", "completed"]) {
    svc.transitionOffboarding(store, { offboardingId: ob.id, to }, admin);
  }
  assert.equal(store.data.commissionEvents.length, 2, "geen event verwijderd of overschreven");
  assert.equal(store.data.commissionPayouts.length, 1, "payout-historiek blijft");
  assert.equal(store.get("commissionPayouts", "p1").status, "paid");
  const org = store.get("resellers", "r1");
  assert.equal(org.status, "terminated");
  assert.ok(org.termination_date);
  assert.equal(org.exit_status, "completed");
  assert.ok(store.get("resellerOffboardings", ob.id).completedAt);
  // Historische rapportering blijft ook na volledige offboarding leesbaar (DoD-10).
  const overview = svc.historicalOverview(store, "r1");
  assert.equal(overview.commissionEvents.length, 2);
});

// ── Tenantkoppelingen + plafond (23.2) ───────────────────────────────────────
// BEWUSTE GEDRAGSWIJZIGING (cluster C, bevinding "lifecycle dupliceert
// linkTenant/endTenantLink"): deze module schreef een eigen, zwakkere rij naar
// resellerTenantLinks (geen relationType, geen approvedBy, reden optioneel,
// geen commercial-conflictcheck). Die tweede schrijfweg is verwijderd; de
// lifecycle delegeert nu naar reseller-tenants.linkTenant/revokeTenantLink.
// Gevolg voor deze tests: een reden is VERPLICHT en intrekken zet de status op
// "revoked" in plaats van "ended" (beide vallen weg uit de actieve koppelingen).

test("linkTenant · plafond max_managed_tenants weigert koppeling boven het contract", () => {
  const store = storeWithOrg({ status: "active", onboarding_status: "active", max_managed_tenants: 1 });
  store.insert("tenants", { id: "t1", name: "Klant 1" });
  store.insert("tenants", { id: "t2", name: "Klant 2" });
  svc.linkTenant(store, { resellerId: "r1", tenantId: "t1", reason: "verkoop" }, admin);
  assert.throws(() => svc.linkTenant(store, { resellerId: "r1", tenantId: "t2", reason: "verkoop" }, admin),
    e => e.status === 409 && e.code === "MAX_MANAGED_TENANTS_REACHED");
});

test("linkTenant · reden verplicht, dubbele koppeling en onbestaande tenant geweigerd", () => {
  const store = storeWithOrg({ status: "active", onboarding_status: "active" });
  store.insert("tenants", { id: "t1", name: "Klant 1" });
  assert.throws(() => svc.linkTenant(store, { resellerId: "r1", tenantId: "t1" }, admin),
    e => e.status === 400 && e.code === "REASON_REQUIRED");
  const link = svc.linkTenant(store, { resellerId: "r1", tenantId: "t1", reason: "verkoop" }, admin);
  assert.equal(link.relationType, "commercial", "koppeling draagt altijd een expliciete beheerrelatie");
  assert.equal(link.approvedBy, admin.email);
  assert.throws(() => svc.linkTenant(store, { resellerId: "r1", tenantId: "t1", reason: "verkoop" }, admin),
    e => e.status === 409 && e.code === "TENANT_LINK_EXISTS");
  assert.throws(() => svc.linkTenant(store, { resellerId: "r1", tenantId: "bestaat-niet", reason: "verkoop" }, admin),
    e => e.status === 404 && e.code === "TENANT_NOT_FOUND");
});

test("endTenantLink · beeindigt en bewaart het record, plafond komt weer vrij", () => {
  const store = storeWithOrg({ status: "active", onboarding_status: "active", max_managed_tenants: 1 });
  store.insert("tenants", { id: "t1", name: "Klant 1" });
  store.insert("tenants", { id: "t2", name: "Klant 2" });
  const link = svc.linkTenant(store, { resellerId: "r1", tenantId: "t1", reason: "verkoop" }, admin);
  svc.endTenantLink(store, { linkId: link.id, reason: "overdracht" }, admin);
  // "revoked" na delegatie naar revokeTenantLink · het record blijft bestaan.
  assert.equal(store.get("resellerTenantLinks", link.id).status, "revoked");
  assert.ok(store.data.resellerLifecycleEvents.some(e => e.action === "tenant_link_ended"));
  // Onder het plafond: een nieuwe koppeling kan weer.
  assert.equal(svc.linkTenant(store, { resellerId: "r1", tenantId: "t2", reason: "nieuwe klant" }, admin).status, "active");
  assert.throws(() => svc.endTenantLink(store, { linkId: "geen", reason: "x" }, admin),
    e => e.status === 404 && e.code === "TENANT_LINK_NOT_FOUND");
});

test("legacyReactivate · zet active terug en legt de omzeiling expliciet vast", () => {
  const store = storeWithOrg({ status: "active", onboarding_status: "active" });
  svc.suspend(store, { resellerId: "r1", reason: "wanbetaling" }, admin);
  const org = svc.legacyReactivate(store, { resellerId: "r1", reason: "betaald" }, admin);
  assert.equal(org.status, "active");
  const log = store.data.resellerLifecycleEvents.find(e => e.action === "legacy_reactivated");
  assert.ok(log, "de heractivatie buiten de machine om staat in het lifecycle-log");
  assert.equal(log.before.status, "suspended");
  assert.equal(log.after.status, "active");
});

test("normalizeLegacyStatus · repareert de niet-bestaande status paused naar suspended", () => {
  const store = storeWithOrg({ status: "paused", onboarding_status: "active" });
  const org = svc.normalizeLegacyStatus(store, "r1", admin);
  assert.equal(org.status, "suspended", "paused bestaat niet in de 23.14-machine");
  assert.ok(store.data.resellerLifecycleEvents.some(e => e.action === "legacy_status_normalized"));
  // En daarna is beeindigen weer mogelijk (voorheen: RESELLER_ORG_STATE_INVALID).
  assert.equal(svc.terminate(store, { resellerId: "r1", reason: "einde" }, admin).status, "terminated");
});

test("historicalOverview · payout- en contractvelden vallen weg (DoD-2)", () => {
  const store = storeWithOrg({
    status: "active", onboarding_status: "active",
    payout_account: "BE68539007547034", payout_currency: "EUR",
  });
  const overview = svc.historicalOverview(store, "r1");
  assert.equal(overview.organization.payout_account, undefined);
  assert.equal(overview.organization.payout_currency, undefined);
  assert.equal(overview.organization.status, "active", "rapportering blijft verder volledig");
});

// ── Accreditaties (23.2) ─────────────────────────────────────────────────────

test("expiredAccreditations · verlopen en dateloze certificaten (fail dicht), geldige niet", () => {
  const store = storeWithOrg({
    accreditations: [
      { name: "Basis", expiresAt: "2025-12-31T00:00:00.000Z" },
      { name: "Advanced", expiresAt: "2099-01-01T00:00:00.000Z" },
      { name: "ZonderDatum" },
      { name: "Kapot", expiresAt: "geen-datum" },
    ],
  });
  const expired = svc.expiredAccreditations(store, "r1", new Date("2026-07-23T00:00:00.000Z"));
  const names = expired.map(a => a.name).sort();
  assert.deepEqual(names, ["Basis", "Kapot", "ZonderDatum"]);
});

test("expiredAccreditations · lege of ontbrekende lijst geeft lege uitkomst", () => {
  const store = storeWithOrg();
  assert.deepEqual(svc.expiredAccreditations(store, "r1"), []);
});
