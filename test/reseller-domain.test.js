"use strict";

// Tests voor de pure reseller-domeinlaag (h23 · spec 23.2/23.3/23.7/23.14).
// Focus: ongeldige statusovergangen en ontbrekende verplichte velden.

const { test } = require("node:test");
const assert = require("node:assert");
const D = require("../src/platform/reseller-domain");

// Geldige actieve organisatie als basis · overrides per test.
function validOrg(overrides = {}) {
  return {
    reseller_id: "res_1",
    partner_name: "Acme Partners BV",
    display_name: "Acme",
    partner_type: "reseller",
    status: "active",
    onboarding_status: "active",
    primary_contact: "contact_prim",
    sales_contact: "contact_sales",
    support_contact: "contact_support",
    finance_contact: "contact_fin",
    registered_address: { straat: "Kerkstraat", nummer: "12", postcode: "9000", gemeente: "Gent", land: "BE" },
    billing_email: "finance@acme.be",
    preferred_language: "NL",
    timezone: "Europe/Brussels",
    locale: "nl-BE",
    currency: "EUR",
    delegated_support_allowed: false,
    delegated_tenant_admin_allowed: false,
    account_manager_id: "user_am",
    agreement_version: "v3",
    accepted_at: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

const throwsCode = code => e => e.code === code;

// ── Statusmachines · ongeldige overgangen ────────────────────────────────────

test("resellerOrganization · applicant → active slaat stappen over en gooit", () => {
  assert.throws(() => D.resellerOrganization.assertTransition("applicant", "active"),
    throwsCode("RESELLER_ORG_TRANSITION_INVALID"));
});

test("resellerOrganization · terminated is terminaal", () => {
  assert.throws(() => D.resellerOrganization.assertTransition("terminated", "active"),
    throwsCode("RESELLER_ORG_TRANSITION_INVALID"));
});

test("resellerOrganization · onbekende status gooit STATE_INVALID", () => {
  assert.throws(() => D.resellerOrganization.assertTransition("active", "paused"),
    throwsCode("RESELLER_ORG_STATE_INVALID"));
  assert.throws(() => D.resellerOrganization.assertTransition("nonsense", "active"),
    throwsCode("RESELLER_ORG_STATE_INVALID"));
});

test("resellerOrganization · volledige geldige keten loopt zonder fout", () => {
  const keten = ["applicant", "screening", "contracting", "onboarding", "active", "suspended", "terminated"];
  for (let i = 1; i < keten.length; i++) {
    assert.equal(D.resellerOrganization.assertTransition(keten[i - 1], keten[i]), keten[i]);
  }
});

test("deal · draft → accepted mag niet (review verplicht)", () => {
  assert.throws(() => D.deal.assertTransition("draft", "accepted"), throwsCode("DEAL_TRANSITION_INVALID"));
});

test("deal · rejected is terminaal, geen conversie meer", () => {
  assert.throws(() => D.deal.assertTransition("rejected", "converted"), throwsCode("DEAL_TRANSITION_INVALID"));
});

test("deal · geldig pad draft → ... → converted", () => {
  const pad = ["draft", "submitted", "under_review", "accepted", "converted"];
  for (let i = 1; i < pad.length; i++) D.deal.assertTransition(pad[i - 1], pad[i]);
  assert.ok(D.deal.isTerminal("converted"));
});

test("deal · elke OPEN status mag verlopen (bewuste 23.8-verruiming op 23.14)", () => {
  // De claimtermijn loopt vanaf REGISTRATIE (23.8), dus ook een claim die nooit
  // beoordeeld werd verloopt. Daardoor hoeft de sweep (reseller-deals.
  // expireDeals) de machine niet te omzeilen met een blinde statuspatch.
  for (const van of ["draft", "submitted", "under_review", "accepted"]) {
    assert.equal(D.deal.assertTransition(van, "expired"), "expired", `${van} → expired`);
  }
  // De verruiming is eenrichtingsverkeer: expired blijft terminaal en de
  // beoordelingsstappen blijven verplicht.
  assert.ok(D.deal.isTerminal("expired"));
  assert.throws(() => D.deal.assertTransition("expired", "submitted"), throwsCode("DEAL_TRANSITION_INVALID"));
  assert.throws(() => D.deal.assertTransition("rejected", "expired"), throwsCode("DEAL_TRANSITION_INVALID"));
  assert.throws(() => D.deal.assertTransition("submitted", "accepted"), throwsCode("DEAL_TRANSITION_INVALID"));
});

test("tenantRequest · submitted → provisioning mag niet (klantbevestiging verplicht)", () => {
  assert.throws(() => D.tenantRequest.assertTransition("submitted", "provisioning"),
    throwsCode("TENANT_REQUEST_TRANSITION_INVALID"));
});

test("tenantRequest · active → submitted mag niet terug", () => {
  D.tenantRequest.assertTransition("provisioning", "active");
  assert.throws(() => D.tenantRequest.assertTransition("active", "submitted"),
    throwsCode("TENANT_REQUEST_TRANSITION_INVALID"));
});

test("licenseRequest · approved → applied mag niet (scheduled verplicht)", () => {
  assert.throws(() => D.licenseRequest.assertTransition("approved", "applied"),
    throwsCode("LICENSE_REQUEST_TRANSITION_INVALID"));
});

test("licenseRequest · failed is terminaal", () => {
  D.licenseRequest.assertTransition("applied", "failed");
  assert.throws(() => D.licenseRequest.assertTransition("failed", "submitted"),
    throwsCode("LICENSE_REQUEST_TRANSITION_INVALID"));
});

test("delegatedAccess · requested → active mag niet zonder tenantgoedkeuring", () => {
  assert.throws(() => D.delegatedAccess.assertTransition("requested", "active"),
    throwsCode("DELEGATED_ACCESS_TRANSITION_INVALID"));
});

test("delegatedAccess · revoked blijft ingetrokken", () => {
  assert.throws(() => D.delegatedAccess.assertTransition("revoked", "active"),
    throwsCode("DELEGATED_ACCESS_TRANSITION_INVALID"));
});

test("commissionStatement · draft → approved mag niet (review verplicht)", () => {
  assert.throws(() => D.commissionStatement.assertTransition("draft", "approved"),
    throwsCode("COMMISSION_STATEMENT_TRANSITION_INVALID"));
});

test("commissionStatement · paid/disputed → closed geldig, closed terminaal", () => {
  D.commissionStatement.assertTransition("paid", "closed");
  D.commissionStatement.assertTransition("disputed", "closed");
  assert.throws(() => D.commissionStatement.assertTransition("closed", "draft"),
    throwsCode("COMMISSION_STATEMENT_TRANSITION_INVALID"));
});

test("partnerReview · scheduled → approved mag niet direct", () => {
  assert.throws(() => D.partnerReview.assertTransition("scheduled", "approved"),
    throwsCode("PARTNER_REVIEW_TRANSITION_INVALID"));
});

test("offboarding · initiated → completed mag niet (toegang eerst intrekken)", () => {
  assert.throws(() => D.offboarding.assertTransition("initiated", "completed"),
    throwsCode("OFFBOARDING_TRANSITION_INVALID"));
  const keten = ["initiated", "access_revoked", "tenants_transferred", "finance_closed", "completed"];
  for (let i = 1; i < keten.length; i++) D.offboarding.assertTransition(keten[i - 1], keten[i]);
});

test("commissionAgreement · draft → active mag niet (approval verplicht)", () => {
  assert.throws(() => D.commissionAgreement.assertTransition("draft", "active"),
    throwsCode("AGREEMENT_TRANSITION_INVALID"));
});

test("dispute · open → closed mag niet zonder onderzoek", () => {
  assert.throws(() => D.dispute.assertTransition("open", "closed"),
    throwsCode("DISPUTE_TRANSITION_INVALID"));
});

test("commissionStatus · elke status kan naar disputed, paid → pending niet", () => {
  D.commissionStatus.assertTransition("pending", "disputed");
  D.commissionStatus.assertTransition("approved", "disputed");
  D.commissionStatus.assertTransition("paid", "disputed");
  assert.throws(() => D.commissionStatus.assertTransition("paid", "pending"),
    throwsCode("COMMISSION_STATUS_TRANSITION_INVALID"));
});

test("statusmachines · zelfde status is een no-op (huispatroon payout-ledger)", () => {
  assert.equal(D.resellerOrganization.assertTransition("active", "active"), "active");
  assert.equal(D.deal.assertTransition("submitted", "submitted"), "submitted");
});

test("statusmachines · overgangsfouten dragen status 409, statusfouten 400", () => {
  try { D.deal.assertTransition("draft", "accepted"); assert.fail("had moeten gooien"); }
  catch (e) { assert.equal(e.status, 409); }
  try { D.deal.assertTransition("draft", "bestaat_niet"); assert.fail("had moeten gooien"); }
  catch (e) { assert.equal(e.status, 400); }
});

// ── Kanaaltypen ──────────────────────────────────────────────────────────────

test("CHANNEL_TYPES · vijf typen met doel, bevoegdheden en niet-automatisch", () => {
  assert.deepEqual(Object.keys(D.CHANNEL_TYPES).sort(),
    ["implementation", "referral", "reseller", "support", "technology"]);
  for (const t of Object.values(D.CHANNEL_TYPES)) {
    assert.ok(t.doel && t.bevoegdheden.length > 0 && t.nietAutomatisch.length > 0);
  }
  assert.ok(D.CHANNEL_TYPES.referral.nietAutomatisch.includes("tenantbeheer"));
  assert.ok(D.CHANNEL_TYPES.reseller.nietAutomatisch.includes("superadminrechten"));
});

test("partner_type-veldenum · support is kanaaltype maar geen partner_type", () => {
  assert.deepEqual([...D.PARTNER_TYPES], ["referral", "reseller", "implementation", "technology"]);
  const errors = D.validateResellerOrganization(validOrg({ partner_type: "support" }));
  assert.ok(errors.partner_type, "support hoort geen geldig partner_type te zijn");
});

// ── Veldvalidatie · ontbrekende verplichte velden ────────────────────────────

test("validateResellerOrganization · leeg object rapporteert alle verplichte velden", () => {
  const errors = D.validateResellerOrganization({});
  for (const f of ["partner_name", "display_name", "partner_type", "status", "onboarding_status",
    "primary_contact", "registered_address", "preferred_language", "timezone", "locale", "currency",
    "delegated_support_allowed", "delegated_tenant_admin_allowed"]) {
    assert.ok(errors[f], `verwacht fout voor ${f}`);
  }
});

test("validateResellerOrganization · geldige actieve organisatie geeft geen fouten", () => {
  assert.deepEqual(D.validateResellerOrganization(validOrg()), {});
});

test("validateResellerOrganization · actief zonder finance/contract-velden faalt", () => {
  const errors = D.validateResellerOrganization(validOrg({
    billing_email: "", account_manager_id: null, agreement_version: "", accepted_at: null,
  }));
  for (const f of ["billing_email", "account_manager_id", "agreement_version", "accepted_at"]) {
    assert.ok(errors[f], `verwacht fout voor ${f}`);
  }
});

test("validateResellerOrganization · applicant hoeft nog geen actief-velden te hebben", () => {
  const errors = D.validateResellerOrganization(validOrg({
    status: "applicant", onboarding_status: "applied",
    billing_email: null, account_manager_id: null, agreement_version: null, accepted_at: null,
    sales_contact: null, support_contact: null, finance_contact: null,
  }));
  assert.deepEqual(errors, {});
});

test("validateResellerOrganization · ongeldig billing_email", () => {
  const errors = D.validateResellerOrganization(validOrg({ billing_email: "geen-email" }));
  assert.ok(errors.billing_email);
});

test("validateResellerOrganization · registered_address zonder gemeente/land", () => {
  const errors = D.validateResellerOrganization(validOrg({
    registered_address: { straat: "Kerkstraat", nummer: "12", postcode: "9000" },
  }));
  assert.match(errors.registered_address, /gemeente/);
  assert.match(errors.registered_address, /land/);
});

test("validateResellerOrganization · suspensie vereist reden en datum", () => {
  const zonder = D.validateResellerOrganization(validOrg({ status: "suspended" }));
  assert.ok(zonder.suspension_reason);
  assert.ok(zonder.suspension_date);
  const met = D.validateResellerOrganization(validOrg({
    status: "suspended", suspension_reason: "wanbetaling", suspension_date: "2026-07-22",
  }));
  assert.equal(met.suspension_reason, undefined);
  assert.equal(met.suspension_date, undefined);
});

test("validateResellerOrganization · terminated vereist termination_date", () => {
  const errors = D.validateResellerOrganization(validOrg({ status: "terminated" }));
  assert.ok(errors.termination_date);
});

test("validateResellerOrganization · preferred_language buiten NL/FR/EN", () => {
  const errors = D.validateResellerOrganization(validOrg({ preferred_language: "DE" }));
  assert.ok(errors.preferred_language);
});

test("validateResellerOrganization · partner_tier enum (hoofdletterongevoelig)", () => {
  assert.ok(D.validateResellerOrganization(validOrg({ partner_tier: "platinum" })).partner_tier);
  assert.equal(D.validateResellerOrganization(validOrg({ partner_tier: "Gold" })).partner_tier, undefined);
});

test("validateResellerOrganization · service_scope alleen uit de vaste lijst", () => {
  const errors = D.validateResellerOrganization(validOrg({ service_scope: ["sales", "billing"] }));
  assert.match(errors.service_scope, /billing/);
  assert.equal(D.validateResellerOrganization(validOrg({ service_scope: ["sales", "support"] })).service_scope, undefined);
});

test("validateResellerOrganization · payout_account moet IBAN-vorm hebben", () => {
  assert.ok(D.validateResellerOrganization(validOrg({ payout_account: "1234" })).payout_account);
  assert.equal(D.validateResellerOrganization(validOrg({ payout_account: "BE68 5390 0754 7034" })).payout_account, undefined);
});

test("validateResellerOrganization · max_managed_tenants geheel getal >= 0", () => {
  assert.ok(D.validateResellerOrganization(validOrg({ max_managed_tenants: -1 })).max_managed_tenants);
  assert.ok(D.validateResellerOrganization(validOrg({ max_managed_tenants: 2.5 })).max_managed_tenants);
  assert.equal(D.validateResellerOrganization(validOrg({ max_managed_tenants: 25 })).max_managed_tenants, undefined);
});

test("validateResellerOrganization · commission_model.type uit vaste lijst", () => {
  assert.ok(D.validateResellerOrganization(validOrg({ commission_model: { type: "bonus" } })).commission_model);
  assert.equal(D.validateResellerOrganization(validOrg({ commission_model: { type: "percentage", pct: 10 } })).commission_model, undefined);
});

test("veiligheidsdefaults · flags verplicht boolean, withSecurityDefaults vult false", () => {
  const errors = D.validateResellerOrganization(validOrg({ delegated_support_allowed: "ja" }));
  assert.ok(errors.delegated_support_allowed);
  const org = D.withSecurityDefaults({ display_name: "X" });
  assert.equal(org.delegated_support_allowed, false);
  assert.equal(org.delegated_tenant_admin_allowed, false);
  assert.deepEqual(D.SECURITY_DEFAULTS, { delegated_support_allowed: false, delegated_tenant_admin_allowed: false });
});

test("assertValidResellerOrganization · gooit 400 met fieldErrors", () => {
  try {
    D.assertValidResellerOrganization({ display_name: "X" });
    assert.fail("had moeten gooien");
  } catch (e) {
    assert.equal(e.status, 400);
    assert.equal(e.code, "RESELLER_ORGANIZATION_INVALID");
    assert.ok(e.fieldErrors && e.fieldErrors.partner_type);
  }
});

test("assertOrganizationActive · suspended blokkeert nieuwe acties (403)", () => {
  assert.throws(() => D.assertOrganizationActive(validOrg({ status: "suspended" })),
    e => e.code === "RESELLER_NOT_ACTIVE" && e.status === 403);
  assert.throws(() => D.assertOrganizationActive(null), throwsCode("RESELLER_NOT_FOUND"));
  assert.equal(D.assertOrganizationActive(validOrg()).status, "active");
});

// ── Contract/agreement-model ─────────────────────────────────────────────────

test("validateAgreement · verplichte velden en versienummer", () => {
  const errors = D.validateAgreement({});
  assert.ok(errors.agreement_id);
  assert.ok(errors.version);
  assert.ok(errors.status);
  assert.ok(errors.start_date);
  assert.ok(D.validateAgreement({ agreement_id: "agr_1", version: 0, status: "active", start_date: "2026-01-01" }).version);
  assert.ok(D.validateAgreement({ agreement_id: "agr_1", version: 1, status: "active", start_date: "2026-06-01", end_date: "2026-01-01" }).end_date);
});

test("activeAgreement · kiest actief contract binnen venster, hoogste versie wint", () => {
  const list = [
    { agreement_id: "agr_1", version: 1, status: "expired", start_date: "2025-01-01", end_date: "2025-12-31" },
    { agreement_id: "agr_2", version: 2, status: "active", start_date: "2026-01-01" },
    { agreement_id: "agr_3", version: 3, status: "active", start_date: "2026-06-01" },
    { agreement_id: "agr_4", version: 4, status: "draft", start_date: "2026-06-01" },
  ];
  assert.equal(D.activeAgreement(list, "2026-07-22").agreement_id, "agr_3");
  assert.equal(D.activeAgreement(list, "2026-02-01").agreement_id, "agr_2");
  assert.equal(D.activeAgreement(list, "2025-06-01"), null, "expired telt niet mee");
});

test("assertAgreementActive · gooit 409 zonder actief contract", () => {
  assert.throws(() => D.assertAgreementActive([], "2026-07-22"),
    e => e.code === "AGREEMENT_NOT_ACTIVE" && e.status === 409);
  const list = [{ agreement_id: "agr_1", version: 1, status: "active", start_date: "2026-01-01", end_date: "2026-06-30" }];
  assert.throws(() => D.assertAgreementActive(list, "2026-07-22"), throwsCode("AGREEMENT_NOT_ACTIVE"));
  assert.equal(D.assertAgreementActive(list, "2026-03-15").agreement_id, "agr_1");
});

test("STATE_MACHINES · alle 23.14-machines aanwezig met STATES/TRANSITIONS", () => {
  const verplicht = ["resellerOrganization", "deal", "tenantRequest", "licenseRequest",
    "delegatedAccess", "commissionStatement", "partnerReview", "offboarding"];
  for (const naam of verplicht) {
    const m = D.STATE_MACHINES[naam];
    assert.ok(m, `machine ${naam} ontbreekt`);
    assert.ok(Array.isArray(m.STATES) && m.STATES.length >= 4);
    assert.equal(typeof m.assertTransition, "function");
  }
  // Payout leeft bewust in commission-ledger.js (CTO2-10) · niet gedupliceerd.
  assert.equal(D.STATE_MACHINES.payout, undefined);
});
