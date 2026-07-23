"use strict";

// Spec 23.8 · dealregistratie en commerciele attributie.
// Dekt: afgeleide reseller_id, verplicht gestructureerd bewijs, dedup met
// conflict_case (geen first click), 23.14-statusmachine met rejection_reason,
// vier-ogen zonder self-approval, attributie 0-100, expiry-sweep, traceerbare
// conversie ZONDER tenanttoegang, en de negatieve scope-matrix (A ziet B niet).

const { test } = require("node:test");
const assert = require("node:assert");
const svc = require("../src/modules/reseller-deals");
const A = require("../src/platform/reseller-authz");

function fakeStore() {
  const data = {
    resellers: [
      { id: "resA", name: "Partner A", status: "active" },
      { id: "resB", name: "Partner B", status: "active" },
      { id: "resC", name: "Partner C", status: "active" },
      { id: "resS", name: "Partner S", status: "suspended" },
    ],
    resellerDeals: [], resellerDealConflicts: [], resellerTenantLinks: [], audit: [],
  };
  return {
    data,
    insert(coll, row) { (data[coll] = data[coll] || []).push(row); return row; },
    update(coll, id, patch) {
      data[coll] = data[coll].map(r => (r.id === id ? { ...r, ...patch } : r));
      return data[coll].find(r => r.id === id);
    },
    get(coll, id) { return (data[coll] || []).find(r => r.id === id); },
    audit(e) { data.audit.push(e); },
  };
}

// Gebruikers · kanaalrol via resellerRole (integratienoot reseller-authz).
const salesA = { email: "sales@a.be", role: "reseller", resellerRole: "reseller_sales", resellerId: "resA", permissions: [] };
const salesB = { email: "sales@b.be", role: "reseller", resellerRole: "reseller_sales", resellerId: "resB", permissions: [] };
const salesS = { email: "sales@s.be", role: "reseller", resellerRole: "reseller_sales", resellerId: "resS", permissions: [] };
const financeA = { email: "fin@a.be", role: "reseller", resellerRole: "reseller_finance", resellerId: "resA", permissions: [] };
const pm = { email: "pm@monargo.com", role: "super_admin", resellerRole: "monargo_partner_manager", permissions: [] };
const pm2 = { email: "pm2@monargo.com", role: "super_admin", resellerRole: "monargo_partner_manager", permissions: [] };
// Hybride: mag registreren (expliciet recht) EN goedkeuren · voor self-approvaltests.
const hybrid = { email: "hybrid@monargo.com", role: "super_admin", resellerRole: "monargo_partner_manager", permissions: ["reseller.deals.create:all"] };

const evidence = { type: "email", reference: "msg-2026-07-001" };
function basePayload(extra = {}) {
  return {
    prospectCompany: "Bouwbedrijf Janssens", country: "BE",
    enterpriseOrVatNumber: "BE0123456789", sourceEvidence: evidence, ...extra,
  };
}
const DAY = 86400000;

// ── Registratie ──────────────────────────────────────────────────────────────

test("registerDeal · velden, afgeleide reseller_id, expiry en audit met before/after", () => {
  const store = fakeStore();
  const deal = svc.registerDeal(store, basePayload({ estimatedValue: 1200, currency: "eur", products: ["core", "planning"] }), salesA);
  assert.equal(deal.resellerId, "resA");
  assert.equal(deal.status, "submitted");
  assert.equal(deal.version, 1);
  assert.equal(deal.currency, "EUR");
  assert.ok(deal.registeredAt && deal.expiryAt);
  const days = (Date.parse(deal.expiryAt) - Date.parse(deal.registeredAt)) / DAY;
  assert.ok(Math.abs(days - svc.DEFAULT_CLAIM_VALIDITY_DAYS) < 0.01, "geldigheidsduur = standaardvenster");
  const entry = store.data.audit.find(a => a.action === "deal_registered");
  assert.ok(entry, "audit geschreven");
  const detail = JSON.parse(entry.detail);
  assert.equal(detail.before, null);
  assert.equal(detail.after.status, "submitted");
  assert.ok(detail.reason, "reden aanwezig in audit");
});

test("registerDeal · expliciet vreemde resellerId is een harde weigering", () => {
  const store = fakeStore();
  assert.throws(() => svc.registerDeal(store, basePayload({ resellerId: "resB" }), salesA),
    e => e.code === "RESELLER_SCOPE_VIOLATION" && e.status === 403);
  assert.equal(store.data.resellerDeals.length, 0, "niets geregistreerd");
});

test("registerDeal · zonder recht deals.create geweigerd (reseller_finance)", () => {
  const store = fakeStore();
  assert.throws(() => svc.registerDeal(store, basePayload(), financeA),
    e => e.code === "RESELLER_FORBIDDEN" && e.status === 403);
});

test("registerDeal · suspensie blokkeert nieuwe deals; onbekende organisatie is 404", () => {
  const store = fakeStore();
  assert.throws(() => svc.registerDeal(store, basePayload(), salesS),
    e => e.code === "RESELLER_NOT_ACTIVE" && e.status === 403);
  const ghost = { ...salesA, resellerId: "resX" };
  assert.throws(() => svc.registerDeal(store, basePayload(), ghost),
    e => e.code === "RESELLER_NOT_FOUND" && e.status === 404);
});

test("registerDeal · source_evidence is verplicht", () => {
  const store = fakeStore();
  assert.throws(() => svc.registerDeal(store, basePayload({ sourceEvidence: null }), salesA),
    e => e.code === "DEAL_EVIDENCE_REQUIRED");
  assert.throws(() => svc.registerDeal(store, basePayload({ sourceEvidence: {} }), salesA),
    e => e.code === "DEAL_EVIDENCE_REQUIRED");
});

test("registerDeal · claim op enkel vrije tekst of ongeldig bewijstype is ongeldig", () => {
  const store = fakeStore();
  assert.throws(() => svc.registerDeal(store, basePayload({ sourceEvidence: "we spraken hen op een beurs" }), salesA),
    e => e.code === "DEAL_EVIDENCE_INVALID");
  assert.throws(() => svc.registerDeal(store, basePayload({ sourceEvidence: { type: "gerucht", reference: "x" } }), salesA),
    e => e.code === "DEAL_EVIDENCE_INVALID");
  assert.throws(() => svc.registerDeal(store, basePayload({ sourceEvidence: { type: "email", reference: "  " } }), salesA),
    e => e.code === "DEAL_EVIDENCE_INVALID");
});

test("registerDeal · waarde/valuta/products gevalideerd", () => {
  const store = fakeStore();
  assert.throws(() => svc.registerDeal(store, basePayload({ estimatedValue: -5, currency: "EUR" }), salesA),
    e => e.code === "DEAL_VALUE_INVALID");
  assert.throws(() => svc.registerDeal(store, basePayload({ estimatedValue: 10, currency: "euros" }), salesA),
    e => e.code === "DEAL_CURRENCY_INVALID");
  assert.throws(() => svc.registerDeal(store, basePayload({ estimatedValue: 10 }), salesA),
    e => e.code === "DEAL_CURRENCY_INVALID", "valuta verplicht bij waarde");
  assert.throws(() => svc.registerDeal(store, basePayload({ products: ["core", ""] }), salesA),
    e => e.code === "DEAL_PRODUCTS_INVALID");
});

test("registerDeal · prospect_company en land verplicht (dedupsleutel)", () => {
  const store = fakeStore();
  assert.throws(() => svc.registerDeal(store, basePayload({ country: "" }), salesA),
    e => e.code === "DEAL_PROSPECT_REQUIRED");
  assert.throws(() => svc.registerDeal(store, basePayload({ prospectCompany: "  " }), salesA),
    e => e.code === "DEAL_PROSPECT_REQUIRED");
});

// ── Deduplicatie en conflict_case ────────────────────────────────────────────

test("dedup · tweede claim van dezelfde reseller op dezelfde prospect = 409", () => {
  const store = fakeStore();
  svc.registerDeal(store, basePayload(), salesA);
  assert.throws(() => svc.registerDeal(store, basePayload({ prospectCompany: "Andere Naam" }), salesA),
    e => e.code === "DEAL_DUPLICATE" && e.status === 409, "vat-match binnen eigen reseller");
});

test("dedup · cross-reseller vat-botsing opent conflict_case met beide claims, geen first click", () => {
  const store = fakeStore();
  const dealA = svc.registerDeal(store, basePayload(), salesA);
  const dealB = svc.registerDeal(store, basePayload({ prospectCompany: "Janssens Bouw NV" }), salesB);
  assert.equal(store.data.resellerDealConflicts.length, 1);
  const c = store.data.resellerDealConflicts[0];
  assert.equal(c.status, "open");
  assert.equal(c.matchReason, "vat_match");
  assert.deepEqual([...c.dealIds].sort(), [dealA.id, dealB.id].sort(), "beide claims in de case");
  // Geen automatische toekenning: beide claims blijven open in hun eigen workflow.
  const freshA = store.get("resellerDeals", dealA.id);
  const freshB = store.get("resellerDeals", dealB.id);
  assert.equal(freshA.status, "submitted");
  assert.equal(freshB.status, "submitted");
  assert.equal(freshA.conflictCaseId, c.id);
  assert.equal(freshB.conflictCaseId, c.id);
  assert.ok(store.data.audit.some(a => a.action === "deal_conflict_opened"));
});

test("dedup · prospect+land matcht genormaliseerd (hoofdletters/spaties tellen niet)", () => {
  const store = fakeStore();
  svc.registerDeal(store, basePayload({ enterpriseOrVatNumber: null }), salesA);
  const dealB = svc.registerDeal(store, {
    prospectCompany: "  bouwbedrijf   JANSSENS ", country: "be", sourceEvidence: evidence,
  }, salesB);
  assert.equal(store.data.resellerDealConflicts.length, 1);
  assert.equal(store.data.resellerDealConflicts[0].matchReason, "company_country_match");
  assert.ok(dealB.conflictCaseId);
});

test("dedup · afgewezen of verlopen claims blokkeren niet", () => {
  const store = fakeStore();
  const dealA = svc.registerDeal(store, basePayload(), salesA);
  svc.transitionDeal(store, { dealId: dealA.id, to: "under_review" }, pm);
  svc.transitionDeal(store, { dealId: dealA.id, to: "rejected", reason: "geen aantoonbare oorsprong" }, pm);
  const dealB = svc.registerDeal(store, basePayload({ prospectCompany: "Janssens Bouw NV" }), salesB);
  assert.equal(dealB.conflictCaseId, null, "geen conflict met een afgewezen claim");
  assert.equal(store.data.resellerDealConflicts.length, 0);
});

test("dedup · derde claim sluit aan bij de bestaande open case", () => {
  const store = fakeStore();
  const dealA = svc.registerDeal(store, basePayload(), salesA);
  const dealB = svc.registerDeal(store, basePayload({ prospectCompany: "Variant B" }), salesB);
  const hybridDeal = svc.registerDeal(store, basePayload({ resellerId: "resC", prospectCompany: "Variant C" }), hybrid);
  // Derde partij (resC) botst op dezelfde vat met de al conflicterende claims.
  assert.equal(store.data.resellerDealConflicts.length, 1, "een (1) case, geen tweede");
  const c = store.data.resellerDealConflicts[0];
  assert.ok(c.dealIds.includes(dealA.id) && c.dealIds.includes(dealB.id) && c.dealIds.includes(hybridDeal.id));
});

// ── Statusmachine en vier-ogen ───────────────────────────────────────────────

test("transition · reseller mag zijn eigen claim niet beoordelen", () => {
  const store = fakeStore();
  const deal = svc.registerDeal(store, basePayload(), salesA);
  assert.throws(() => svc.transitionDeal(store, { dealId: deal.id, to: "under_review" }, salesA),
    e => e.code === "RESELLER_FORBIDDEN" && e.status === 403);
});

test("transition · machine afgedwongen: submitted kan niet direct naar accepted", () => {
  const store = fakeStore();
  const deal = svc.registerDeal(store, basePayload(), salesA);
  assert.throws(() => svc.transitionDeal(store, { dealId: deal.id, to: "accepted" }, pm),
    e => e.code === "DEAL_TRANSITION_INVALID" && e.status === 409);
  assert.throws(() => svc.transitionDeal(store, { dealId: deal.id, to: "niet_bestaand" }, pm),
    e => e.code === "DEAL_STATE_INVALID" && e.status === 400);
});

test("transition · rejection_reason verplicht bij afwijzing", () => {
  const store = fakeStore();
  const deal = svc.registerDeal(store, basePayload(), salesA);
  svc.transitionDeal(store, { dealId: deal.id, to: "under_review" }, pm);
  assert.throws(() => svc.transitionDeal(store, { dealId: deal.id, to: "rejected" }, pm),
    e => e.code === "DEAL_REJECTION_REASON_REQUIRED");
  const next = svc.transitionDeal(store, { dealId: deal.id, to: "rejected", reason: "bestaande klantrelatie met Monargo" }, pm);
  assert.equal(next.status, "rejected");
  assert.equal(next.rejectionReason, "bestaande klantrelatie met Monargo");
  const entry = store.data.audit.find(a => a.action === "deal_status_rejected");
  const detail = JSON.parse(entry.detail);
  assert.equal(detail.before.status, "under_review");
  assert.equal(detail.after.status, "rejected");
});

test("transition · self-approval geweigerd: indiener kan eigen claim niet aanvaarden", () => {
  const store = fakeStore();
  const deal = svc.registerDeal(store, basePayload({ resellerId: "resA" }), hybrid);
  svc.transitionDeal(store, { dealId: deal.id, to: "under_review" }, pm);
  assert.throws(() => svc.transitionDeal(store, { dealId: deal.id, to: "accepted" }, hybrid),
    e => e.code === "SELF_APPROVAL_FORBIDDEN" && e.status === 403);
  const next = svc.transitionDeal(store, { dealId: deal.id, to: "accepted" }, pm2);
  assert.equal(next.status, "accepted");
  assert.equal(next.acceptedBy, pm2.email);
});

test("transition · acceptatie bij open conflict vereist gedocumenteerde reden en sluit de case", () => {
  const store = fakeStore();
  const dealA = svc.registerDeal(store, basePayload(), salesA);
  svc.registerDeal(store, basePayload({ prospectCompany: "Janssens Bouw NV" }), salesB);
  svc.transitionDeal(store, { dealId: dealA.id, to: "under_review" }, pm);
  assert.throws(() => svc.transitionDeal(store, { dealId: dealA.id, to: "accepted" }, pm),
    e => e.code === "DEAL_CONFLICT_REASON_REQUIRED");
  const next = svc.transitionDeal(store, { dealId: dealA.id, to: "accepted", reason: "sterkste bewijs en oudste actieve relatie" }, pm);
  assert.equal(next.status, "accepted");
  const c = store.data.resellerDealConflicts[0];
  assert.equal(c.status, "resolved");
  assert.equal(c.resolution.wonDealId, dealA.id);
  assert.ok(store.data.audit.some(a => a.action === "deal_conflict_resolved"));
});

test("transition · acceptatie vernieuwt de geldigheidsperiode (conversievenster)", () => {
  const store = fakeStore();
  const deal = svc.registerDeal(store, basePayload(), salesA);
  svc.transitionDeal(store, { dealId: deal.id, to: "under_review" }, pm);
  const at = Date.now() + 30 * DAY;
  const next = svc.transitionDeal(store, { dealId: deal.id, to: "accepted", now: at }, pm);
  const windowDays = (Date.parse(next.expiryAt) - at) / DAY;
  assert.ok(Math.abs(windowDays - svc.DEFAULT_CLAIM_VALIDITY_DAYS) < 0.01, "nieuw venster vanaf acceptatie");
});

// ── Attributie ───────────────────────────────────────────────────────────────

test("setAttribution · buiten 0-100 of niet-numeriek geweigerd", () => {
  const store = fakeStore();
  const deal = svc.registerDeal(store, basePayload(), salesA);
  svc.transitionDeal(store, { dealId: deal.id, to: "under_review" }, pm);
  for (const bad of [-1, 100.5, Number.NaN, "50"]) {
    assert.throws(() => svc.setAttribution(store, { dealId: deal.id, attributionPercent: bad, reason: "x" }, pm),
      e => e.code === "DEAL_ATTRIBUTION_INVALID", `waarde ${bad} geweigerd`);
  }
});

test("setAttribution · reden verplicht en self-approval geweigerd", () => {
  const store = fakeStore();
  const deal = svc.registerDeal(store, basePayload({ resellerId: "resA" }), hybrid);
  svc.transitionDeal(store, { dealId: deal.id, to: "under_review" }, pm);
  assert.throws(() => svc.setAttribution(store, { dealId: deal.id, attributionPercent: 50 }, pm),
    e => e.code === "DEAL_ATTRIBUTION_REASON_REQUIRED");
  assert.throws(() => svc.setAttribution(store, { dealId: deal.id, attributionPercent: 50, reason: "mijn eigen deal" }, hybrid),
    e => e.code === "SELF_APPROVAL_FORBIDDEN");
});

test("setAttribution · zet waarde met audit before/after en versie-increment", () => {
  const store = fakeStore();
  const deal = svc.registerDeal(store, basePayload(), salesA);
  svc.transitionDeal(store, { dealId: deal.id, to: "under_review" }, pm);
  const next = svc.setAttribution(store, { dealId: deal.id, attributionPercent: 40, reason: "gedeelde oorsprong met bestaande lead" }, pm);
  assert.equal(next.attributionPercent, 40);
  assert.equal(next.attribution.setBy, pm.email);
  assert.equal(next.version, 3, "registratie=1, review=2, attributie=3");
  const entry = store.data.audit.find(a => a.action === "deal_attribution_set");
  const detail = JSON.parse(entry.detail);
  assert.equal(detail.before.attributionPercent, null);
  assert.equal(detail.after.attributionPercent, 40);
  assert.ok(detail.reason);
});

test("setAttribution · alleen tijdens beoordeling of na acceptatie", () => {
  const store = fakeStore();
  const deal = svc.registerDeal(store, basePayload(), salesA);
  assert.throws(() => svc.setAttribution(store, { dealId: deal.id, attributionPercent: 40, reason: "x" }, pm),
    e => e.code === "DEAL_ATTRIBUTION_STATE" && e.status === 409);
});

test("setAttribution · expectedVersion-mismatch geeft VERSION_CONFLICT met currentVersion", () => {
  const store = fakeStore();
  const deal = svc.registerDeal(store, basePayload(), salesA);
  svc.transitionDeal(store, { dealId: deal.id, to: "under_review" }, pm);
  assert.throws(() => svc.setAttribution(store, { dealId: deal.id, attributionPercent: 40, reason: "x", expectedVersion: 1 }, pm),
    e => e.code === "VERSION_CONFLICT" && e.status === 409 && e.currentVersion === 2);
  const next = svc.setAttribution(store, { dealId: deal.id, attributionPercent: 40, reason: "x", expectedVersion: 2 }, pm);
  assert.equal(next.attributionPercent, 40);
});

// ── Expiry ───────────────────────────────────────────────────────────────────

test("expireDeals · verlopen claims worden expired, idempotent en geauditeerd", () => {
  const store = fakeStore();
  const d1 = svc.registerDeal(store, basePayload(), salesA);
  const d2 = svc.registerDeal(store, { prospectCompany: "Verse Prospect", country: "BE", sourceEvidence: evidence }, salesB);
  svc.transitionDeal(store, { dealId: d2.id, to: "under_review" }, pm);
  const future = Date.now() + (svc.DEFAULT_CLAIM_VALIDITY_DAYS + 1) * DAY;
  const r1 = svc.expireDeals(store, future);
  assert.equal(r1.expired, 2, "beide open claims voorbij hun venster");
  assert.equal(store.get("resellerDeals", d1.id).status, "expired");
  assert.equal(store.get("resellerDeals", d2.id).status, "expired");
  const r2 = svc.expireDeals(store, future);
  assert.equal(r2.expired, 0, "idempotent");
  assert.equal(store.data.audit.filter(a => a.action === "deal_expired").length, 2);
  // Nog niet verlopen claims blijven staan.
  const store2 = fakeStore();
  const fresh = svc.registerDeal(store2, basePayload(), salesA);
  assert.equal(svc.expireDeals(store2, Date.now() + DAY).expired, 0);
  assert.equal(store2.get("resellerDeals", fresh.id).status, "submitted");
});

// ── Conversie ────────────────────────────────────────────────────────────────

test("convertDeal · vereist accepted-status en volledige traceerdoelen", () => {
  const store = fakeStore();
  const deal = svc.registerDeal(store, basePayload(), salesA);
  assert.throws(() => svc.convertDeal(store, { dealId: deal.id, customerId: "cus1", tenantId: "t9" }, pm),
    e => e.code === "DEAL_TRANSITION_INVALID", "submitted kan niet converteren");
  svc.transitionDeal(store, { dealId: deal.id, to: "under_review" }, pm);
  svc.transitionDeal(store, { dealId: deal.id, to: "accepted" }, pm);
  assert.throws(() => svc.convertDeal(store, { dealId: deal.id, customerId: "cus1" }, pm),
    e => e.code === "DEAL_CONVERSION_TARGET_REQUIRED");
  assert.throws(() => svc.transitionDeal(store, { dealId: deal.id, to: "converted" }, pm),
    e => e.code === "DEAL_USE_CONVERT", "conversie alleen via convertDeal");
});

test("convertDeal · verlopen claim kan niet meer geconverteerd of aanvaard worden", () => {
  const store = fakeStore();
  const deal = svc.registerDeal(store, basePayload(), salesA);
  svc.transitionDeal(store, { dealId: deal.id, to: "under_review" }, pm);
  const past = Date.now() + (svc.DEFAULT_CLAIM_VALIDITY_DAYS + 1) * DAY;
  assert.throws(() => svc.transitionDeal(store, { dealId: deal.id, to: "accepted", now: past }, pm),
    e => e.code === "DEAL_CLAIM_EXPIRED", "aanvaarden na afloop geweigerd");
  svc.transitionDeal(store, { dealId: deal.id, to: "accepted" }, pm);
  const afterWindow = Date.now() + (svc.DEFAULT_CLAIM_VALIDITY_DAYS + 1) * DAY;
  assert.throws(() => svc.convertDeal(store, { dealId: deal.id, customerId: "cus1", tenantId: "t9", now: afterWindow }, pm),
    e => e.code === "DEAL_CLAIM_EXPIRED" && e.status === 409);
});

test("convertDeal · traceerbare conversie maar NOOIT tenanttoegang uit een dealclaim", () => {
  const store = fakeStore();
  const deal = svc.registerDeal(store, basePayload(), salesA);
  svc.transitionDeal(store, { dealId: deal.id, to: "under_review" }, pm);
  svc.transitionDeal(store, { dealId: deal.id, to: "accepted" }, pm);
  const next = svc.convertDeal(store, { dealId: deal.id, customerId: "cus1", tenantId: "t9", subscriptionId: "sub7" }, pm);
  assert.equal(next.status, "converted");
  assert.deepEqual(next.conversion, { customerId: "cus1", tenantId: "t9", subscriptionId: "sub7", convertedBy: pm.email });
  assert.ok(next.convertedAt);
  // Kernregel 23.8/23.15: geen assignment- of toegangsrecord geschreven.
  assert.equal(store.data.resellerTenantLinks.length, 0, "geen tenantkoppeling aangemaakt");
  assert.equal(A.tenantInScope(salesA, "t9", store.data.resellerTenantLinks), false, "claim geeft geen tenant in scope");
  assert.equal(A.canResellerAction(salesA, "reseller.tenants.view", { tenantId: "t9", assignments: store.data.resellerTenantLinks }), false);
});

// ── Scope-matrix en anti-probing ─────────────────────────────────────────────

test("listDeals · reseller A ziet deals van B niet; Monargo ziet alles", () => {
  const store = fakeStore();
  svc.registerDeal(store, basePayload(), salesA);
  svc.registerDeal(store, { prospectCompany: "Prospect Twee", country: "BE", sourceEvidence: evidence }, salesA);
  svc.registerDeal(store, { prospectCompany: "Prospect Drie", country: "FR", sourceEvidence: evidence }, salesB);
  const mine = svc.listDeals(store, salesA);
  assert.equal(mine.length, 2);
  assert.ok(mine.every(d => d.resellerId === "resA"));
  const theirs = svc.listDeals(store, salesB);
  assert.equal(theirs.length, 1);
  const all = svc.listDeals(store, pm);
  assert.equal(all.length, 3);
  assert.equal(svc.listDeals(store, pm, { resellerId: "resB" }).length, 1);
});

test("listDeals · expliciet filter op vreemde reseller is een harde weigering, geen herfiltering", () => {
  const store = fakeStore();
  svc.registerDeal(store, basePayload(), salesA);
  assert.throws(() => svc.listDeals(store, salesA, { resellerId: "resB" }),
    e => e.code === "RESELLER_SCOPE_VIOLATION" && e.status === 403);
});

test("listDeals · partnerprojectie verbergt conflict_case_id (restricted) maar toont inConflict", () => {
  const store = fakeStore();
  svc.registerDeal(store, basePayload(), salesA);
  svc.registerDeal(store, basePayload({ prospectCompany: "Janssens Bouw NV" }), salesB);
  const [mineA] = svc.listDeals(store, salesA);
  assert.equal(mineA.conflictCaseId, undefined, "case-id niet zichtbaar voor de partner");
  assert.equal(mineA.inConflict, true);
  const all = svc.listDeals(store, pm);
  assert.ok(all.every(d => typeof d.conflictCaseId !== "undefined"), "Monargo ziet de case-id wel");
});

test("getDeal · vreemde deal en onbestaande deal geven byte-identieke 404 (anti-probing)", () => {
  const store = fakeStore();
  const dealB = svc.registerDeal(store, basePayload(), salesB);
  let eForeign, eMissing;
  try { svc.getDeal(store, salesA, dealB.id); } catch (e) { eForeign = e; }
  try { svc.getDeal(store, salesA, "deal_bestaat_niet"); } catch (e) { eMissing = e; }
  assert.ok(eForeign && eMissing);
  assert.equal(eForeign.status, 404);
  assert.equal(eForeign.status, eMissing.status);
  assert.equal(eForeign.code, eMissing.code);
  assert.equal(eForeign.message, eMissing.message, "identieke boodschap · bestaan lekt niet");
  // De eigen deal blijft gewoon leesbaar.
  assert.equal(svc.getDeal(store, salesB, dealB.id).id, dealB.id);
});

test("transitionDeal · onbestaande deal geeft dezelfde 404-vorm", () => {
  const store = fakeStore();
  assert.throws(() => svc.transitionDeal(store, { dealId: "deal_niets", to: "under_review" }, pm),
    e => e.code === "DEAL_NOT_FOUND" && e.status === 404 && e.message === "Niet gevonden");
});

test("transitionDeal · vreemde deal en onbestaande deal zijn niet te onderscheiden (ISO-07)", () => {
  const store = fakeStore();
  const dealB = svc.registerDeal(store, basePayload(), salesB);
  const grijp = fn => { try { fn(); return null; } catch (e) { return e; } };
  // Elke gewenste overgang moet dezelfde 404 geven · vroeger lekte 403
  // RESELLER_FORBIDDEN (geen approve-grant) of 400 DEAL_USE_CONVERT dat het
  // dealId van partner B bestond.
  for (const to of ["under_review", "accepted", "rejected", "expired", "submitted", "converted"]) {
    const vreemd = grijp(() => svc.transitionDeal(store, { dealId: dealB.id, to, reason: "x" }, salesA));
    const onbestaand = grijp(() => svc.transitionDeal(store, { dealId: "deal_bestaat_niet", to, reason: "x" }, salesA));
    assert.ok(vreemd && onbestaand, `overgang ${to} moet gooien`);
    assert.equal(vreemd.status, 404, `overgang ${to} geeft 404`);
    assert.equal(vreemd.status, onbestaand.status);
    assert.equal(vreemd.code, onbestaand.code);
    assert.equal(vreemd.message, onbestaand.message);
  }
  // De deal van B is onaangeroerd gebleven.
  assert.equal(store.get("resellerDeals", dealB.id).status, "submitted");
  assert.equal(store.get("resellerDeals", dealB.id).version, 1);
  // Zelfde pariteit op attributie en conversie.
  const attrVreemd = grijp(() => svc.setAttribution(store, { dealId: dealB.id, attributionPercent: 10, reason: "x" }, salesA));
  const attrOnbestaand = grijp(() => svc.setAttribution(store, { dealId: "deal_bestaat_niet", attributionPercent: 10, reason: "x" }, salesA));
  assert.equal(attrVreemd.code, attrOnbestaand.code);
  assert.equal(attrVreemd.status, 404);
  const convVreemd = grijp(() => svc.convertDeal(store, { dealId: dealB.id, customerId: "c1", tenantId: "t1" }, salesA));
  const convOnbestaand = grijp(() => svc.convertDeal(store, { dealId: "deal_bestaat_niet", customerId: "c1", tenantId: "t1" }, salesA));
  assert.equal(convVreemd.code, convOnbestaand.code);
  assert.equal(convVreemd.status, 404);
});

// ── Draftregistratie (23.14-beginstatus) ─────────────────────────────────────

test("registerDeal · draft: true slaat op als concept en het portaal dient later in", () => {
  const store = fakeStore();
  const deal = svc.registerDeal(store, basePayload({ draft: true }), salesA);
  assert.equal(deal.status, "draft", "beginstatus van de 23.14-machine is bereikbaar");
  assert.ok(deal.expiryAt, "claimtermijn loopt vanaf registratie, ook in draft (23.8)");
  assert.ok(store.data.audit.some(a => a.action === "deal_registered"));

  // Het bestaande portaalpad draft → submitted is daarmee levend.
  const ingediend = svc.transitionDeal(store, { dealId: deal.id, to: "submitted" }, salesA);
  assert.equal(ingediend.status, "submitted");
  assert.equal(ingediend.version, 2);
  // En de gewone beoordeling loopt daarna gewoon door.
  assert.equal(svc.transitionDeal(store, { dealId: deal.id, to: "under_review" }, pm).status, "under_review");
});

test("registerDeal · draft doorloopt dezelfde validatie en dedup; default blijft submitted", () => {
  const store = fakeStore();
  assert.throws(() => svc.registerDeal(store, basePayload({ draft: true, sourceEvidence: null }), salesA),
    e => e.code === "DEAL_EVIDENCE_REQUIRED");
  svc.registerDeal(store, basePayload(), salesA);
  assert.throws(() => svc.registerDeal(store, basePayload({ draft: true, prospectCompany: "Andere Naam" }), salesA),
    e => e.code === "DEAL_DUPLICATE" && e.status === 409);
  // Een draft van een andere partner op dezelfde vat opent gewoon een conflict.
  const draftB = svc.registerDeal(store, basePayload({ draft: true, prospectCompany: "Janssens Bouw NV" }), salesB);
  assert.ok(draftB.conflictCaseId, "dedup geldt onverkort voor een draft");
  // Zonder de vlag verandert er niets voor bestaande callers.
  assert.equal(svc.registerDeal(store, { prospectCompany: "Verse Prospect", country: "BE", sourceEvidence: evidence }, salesA).status, "submitted");
});

test("registerDeal · een reseller kan een draft van een ANDERE partner niet indienen", () => {
  const store = fakeStore();
  const draftB = svc.registerDeal(store, basePayload({ draft: true }), salesB);
  assert.throws(() => svc.transitionDeal(store, { dealId: draftB.id, to: "submitted" }, salesA),
    e => e.code === "DEAL_NOT_FOUND" && e.status === 404);
});

test("expireDeals · sweep loopt via de statusmachine, ook vanuit draft", () => {
  const store = fakeStore();
  const draft = svc.registerDeal(store, basePayload({ draft: true }), salesA);
  const ingediend = svc.registerDeal(store, { prospectCompany: "Prospect Twee", country: "BE", sourceEvidence: evidence }, salesA);
  const inReview = svc.registerDeal(store, { prospectCompany: "Prospect Drie", country: "FR", sourceEvidence: evidence }, salesB);
  svc.transitionDeal(store, { dealId: inReview.id, to: "under_review" }, pm);
  const future = Date.now() + (svc.DEFAULT_CLAIM_VALIDITY_DAYS + 1) * DAY;
  const out = svc.expireDeals(store, future);
  assert.equal(out.expired, 3, "elke open claim verloopt · de termijn loopt vanaf registratie (23.8)");
  for (const d of [draft, ingediend, inReview]) {
    assert.equal(store.get("resellerDeals", d.id).status, "expired");
  }
});
