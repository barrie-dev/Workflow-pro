"use strict";

// Tests voor src/modules/reseller-licensing.js (spec 23.10) · licenties,
// pricing en commerciele uitzonderingen. Prijzen komen uit de centrale
// billingbron (business: 1290 basis + 180 per extra seat boven 5 inbegrepen).

const { test } = require("node:test");
const assert = require("node:assert");
const svc = require("../src/modules/reseller-licensing");

function fakeStore(extra = {}) {
  const data = {
    resellers: [
      { id: "r1", name: "Partner BV", status: "active" },
      { id: "r2", name: "Stil BV", status: "suspended" },
      { id: "r3", name: "Ander BV", status: "active" },
    ],
    tenants: [
      { id: "t1", name: "Klant A", plan: "business", status: "active", billingStatus: "active" },
      { id: "t2", name: "Klant B", plan: "enterprise", status: "active", billingStatus: "active" },
      { id: "t3", name: "Klant C", plan: "business", status: "active", billingStatus: "trial", trialEndsAt: "2026-08-15" },
      { id: "t4", name: "Klant D", plan: "business", status: "active", billingStatus: "canceled" },
      { id: "t9", name: "Vreemde", plan: "business", status: "active", billingStatus: "active" },
    ],
    // 6 factureerbare medewerkers voor t1 → business: 1290 + 1x180 = 1470/jaar.
    users: [1, 2, 3, 4, 5, 6].map(n => ({ id: `u${n}`, tenantId: "t1", role: "employee", active: true })),
    bundles: [
      { id: "b1", key: "starter", label: "Starter", active: true, custom: false, modules: ["planning"] },
      { id: "b2", key: "business", label: "Business", active: true, custom: false, modules: ["planning", "workorders", "invoices"] },
      { id: "b3", key: "enterprise", label: "Enterprise", active: true, custom: true, modules: ["planning"] },
      { id: "b4", key: "oldpack", label: "Oud pakket", active: false, custom: false, modules: ["planning"] },
    ],
    resellerTenantLinks: [
      { id: "lnk1", tenantId: "t1", resellerId: "r1", status: "active" },
      { id: "lnk2", tenantId: "t2", resellerId: "r1", status: "active" },
      { id: "lnk3", tenantId: "t3", resellerId: "r1", status: "active" },
      { id: "lnk4", tenantId: "t4", resellerId: "r1", status: "active" },
    ],
    resellerLicenseRequests: [],
    resellerPriceExceptions: [],
    resellerPriceAgreements: [],
    audit: [],
    ...extra,
  };
  return {
    data,
    insert(coll, row) { (data[coll] = data[coll] || []).push(row); return row; },
    update(coll, id, patch) {
      data[coll] = data[coll].map(r => (r.id === id ? { ...r, ...patch } : r));
      return data[coll].find(r => r.id === id);
    },
    get(coll, id) { return (data[coll] || []).find(r => r.id === id); },
    list(coll, tenantId = null) {
      const rows = data[coll] || [];
      return tenantId == null ? rows : rows.filter(r => r.tenantId === tenantId);
    },
    audit(e) { data.audit.push(e); },
  };
}

const partnerSales = { email: "sales@partner.be", role: "reseller", resellerId: "r1", resellerRole: "reseller_sales" };
const partnerAnder = { email: "sales@ander.be", role: "reseller", resellerId: "r3", resellerRole: "reseller_sales" };
const partnerSuspended = { email: "sales@stil.be", role: "reseller", resellerId: "r2" };
const ops = { email: "ops@monargo.com", role: "super_admin" };
const finance = { email: "finance@monargo.com", role: "super_admin" };

const validOrder = {
  tenantId: "t1", plan: "business", modules: ["planning"], seats: 8,
  effectiveDate: "2026-09-01", term: "annual", externalRef: "PO-1",
};

// ── License order ────────────────────────────────────────────────────────────

test("licenseOrder · maakt submitted order met prijssnapshot uit de centrale billingbron", () => {
  const store = fakeStore();
  const order = svc.licenseOrder(store, { ...validOrder }, partnerSales);
  assert.equal(order.status, "submitted");
  assert.equal(order.kind, "order");
  assert.equal(order.resellerId, "r1");
  assert.equal(order.clientTenantId, "t1");
  assert.equal(order.tenantId, null); // platform-niveau record
  // business 8 seats: 1290 + 3x180 = 1830/jaar → 152.5/maand (geen eigen constanten)
  assert.equal(order.payload.pricing.unpriced, false);
  assert.equal(order.payload.pricing.monthly, 152.5);
  assert.equal(store.data.audit.at(-1).action, "license_order_created");
});

test("licenseOrder · idempotent: zelfde externe referentie geeft zelfde order, geen duplicaat", () => {
  const store = fakeStore();
  const eerste = svc.licenseOrder(store, { ...validOrder }, partnerSales);
  const tweede = svc.licenseOrder(store, { ...validOrder }, partnerSales);
  assert.equal(tweede.id, eerste.id);
  assert.equal(store.data.resellerLicenseRequests.length, 1);
});

test("licenseOrder · zelfde referentie voor een andere order is een conflict", () => {
  const store = fakeStore();
  svc.licenseOrder(store, { ...validOrder }, partnerSales);
  assert.throws(() => svc.licenseOrder(store, { ...validOrder, tenantId: "t3" }, partnerSales),
    e => e.code === "EXTERNAL_REF_CONFLICT" && e.status === 409);
});

test("licenseOrder · alleen actieve catalogusitems: inactieve bundel en onbekend plan geweigerd", () => {
  const store = fakeStore();
  assert.throws(() => svc.licenseOrder(store, { ...validOrder, plan: "oldpack", externalRef: "PO-X" }, partnerSales),
    e => e.code === "CATALOG_ITEM_INACTIVE" && e.status === 409);
  assert.throws(() => svc.licenseOrder(store, { ...validOrder, plan: "bestaatniet", externalRef: "PO-Y" }, partnerSales),
    e => e.code === "PLAN_UNKNOWN" && e.status === 400);
});

test("licenseOrder · onbekende module in de bestelling geweigerd", () => {
  const store = fakeStore();
  assert.throws(() => svc.licenseOrder(store, { ...validOrder, modules: ["nonsens"], externalRef: "PO-M" }, partnerSales),
    e => e.code === "MODULE_UNKNOWN");
});

test("licenseOrder · reseller kan geen prijzen aanleveren (catalogus/prijs is van het platform)", () => {
  const store = fakeStore();
  assert.throws(() => svc.licenseOrder(store, { ...validOrder, listPrice: 1, externalRef: "PO-P" }, partnerSales),
    e => e.code === "PRICE_INPUT_FORBIDDEN");
});

test("licenseOrder · gesuspendeerde reseller wordt geblokkeerd (suspensie blokkeert nieuwe aanvragen)", () => {
  const store = fakeStore();
  assert.throws(() => svc.licenseOrder(store, { ...validOrder }, partnerSuspended),
    e => e.code === "RESELLER_NOT_ACTIVE" && e.status === 403);
});

test("licenseOrder · niet-toegewezen tenant leest byte-identiek als onbestaand (anti-probing)", () => {
  const store = fakeStore();
  let vreemd, onbestaand;
  try { svc.licenseOrder(store, { ...validOrder, tenantId: "t9" }, partnerSales); } catch (e) { vreemd = e; }
  try { svc.licenseOrder(store, { ...validOrder, tenantId: "t404" }, partnerSales); } catch (e) { onbestaand = e; }
  assert.equal(vreemd.code, "TENANT_NOT_FOUND");
  assert.equal(onbestaand.code, "TENANT_NOT_FOUND");
  assert.equal(vreemd.message, onbestaand.message);
  assert.equal(vreemd.status, 404);
});

test("licenseOrder · expliciet vreemde resellerId is een harde scope-schending", () => {
  const store = fakeStore();
  assert.throws(() => svc.licenseOrder(store, { ...validOrder, resellerId: "r2" }, partnerSales),
    e => e.code === "RESELLER_SCOPE_VIOLATION" && e.status === 403);
});

// ── Seat change ──────────────────────────────────────────────────────────────

test("seatChange · negatieve seats geweigerd, niet-gehele seats geweigerd", () => {
  const store = fakeStore();
  assert.throws(() => svc.seatChange(store, { tenantId: "t1", requestedSeats: -1, effectiveDate: "2026-09-01" }, partnerSales),
    e => e.code === "SEATS_NEGATIVE" && e.status === 400);
  assert.throws(() => svc.seatChange(store, { tenantId: "t1", requestedSeats: 2.5, effectiveDate: "2026-09-01" }, partnerSales),
    e => e.code === "SEATS_INVALID");
});

test("seatChange · audit bevat oude EN nieuwe waarde, proration uit de centrale seatprijs", () => {
  const store = fakeStore();
  const req = svc.seatChange(store, { tenantId: "t1", requestedSeats: 8, effectiveDate: "2026-09-01" }, partnerSales);
  assert.equal(req.payload.currentSeats, 6);
  assert.equal(req.payload.requestedSeats, 8);
  // 2 extra seats x 180/jaar = 30/maand
  assert.equal(req.payload.proration.monthlyDelta, 30);
  const auditRow = store.data.audit.at(-1);
  assert.equal(auditRow.action, "license_seat_change_requested");
  const detail = JSON.parse(auditRow.detail);
  assert.equal(detail.van, 6);
  assert.equal(detail.naar, 8);
});

test("seatChange · op-aanvraag plan: proration is null, niet 0 (null-vs-nul, CTO2-09)", () => {
  const store = fakeStore();
  const req = svc.seatChange(store, { tenantId: "t2", requestedSeats: 3, effectiveDate: "2026-09-01" }, partnerSales);
  assert.strictEqual(req.payload.proration.monthlyDelta, null);
  assert.strictEqual(req.payload.proration.seatAnnual, null);
});

// ── Upgrade/downgrade ────────────────────────────────────────────────────────

test("upgradeDowngrade · entitlementverlies vereist expliciete bevestiging", () => {
  const store = fakeStore();
  assert.throws(() => svc.upgradeDowngrade(store, { tenantId: "t1", toPlan: "starter", effectiveDate: "2026-09-01" }, partnerSales),
    e => e.code === "ENTITLEMENT_LOSS_UNCONFIRMED" && e.status === 409);
  const req = svc.upgradeDowngrade(store, { tenantId: "t1", toPlan: "starter", effectiveDate: "2026-09-01", confirmEntitlementLoss: true }, partnerSales);
  assert.ok(req.payload.entitlementDelta.removed.includes("workorders"));
  // billingimpact uit de centrale prijzen: business 6 seats 122.5 → starter 73.17
  assert.equal(req.payload.billingImpact.fromMonthly, 122.5);
  assert.equal(req.payload.billingImpact.toMonthly, 73.17);
  assert.equal(req.payload.billingImpact.deltaMonthly, -49.33);
});

test("upgradeDowngrade · contractcontrole: geannuleerd contract en ongewijzigd plan geweigerd", () => {
  const store = fakeStore();
  assert.throws(() => svc.upgradeDowngrade(store, { tenantId: "t4", toPlan: "starter", effectiveDate: "2026-09-01", confirmEntitlementLoss: true }, partnerSales),
    e => e.code === "CONTRACT_CANCELED" && e.status === 409);
  assert.throws(() => svc.upgradeDowngrade(store, { tenantId: "t1", toPlan: "business", effectiveDate: "2026-09-01" }, partnerSales),
    e => e.code === "PLAN_UNCHANGED");
});

// ── Price exception ──────────────────────────────────────────────────────────

test("priceException · korting en marge uit de centrale lijstprijs; onder drempel 1 goedkeuring", () => {
  const store = fakeStore();
  const ex = svc.priceException(store, { tenantId: "t1", requestedPrice: 1300, reason: "concurrentiedruk", expiry: "2099-01-01" }, partnerSales);
  assert.equal(ex.listPrice, 1470); // 1290 + 1x180 · centrale bron, niet aangeleverd
  assert.equal(ex.discount, 170);
  assert.equal(ex.discountPct, 11.56);
  assert.equal(ex.marginPct, 88.44);
  assert.equal(ex.escalated, false);
  assert.equal(ex.requiredApprovals, 1);
  const goedgekeurd = svc.approvePriceException(store, { exceptionId: ex.id }, ops);
  assert.equal(goedgekeurd.status, "approved");
});

test("priceException · drempelapproval: boven de drempel twee verschillende goedkeurders", () => {
  const store = fakeStore();
  const ex = svc.priceException(store, { tenantId: "t1", requestedPrice: 1000, reason: "strategische deal", expiry: "2099-01-01" }, partnerSales);
  assert.equal(ex.escalated, true);
  assert.equal(ex.requiredApprovals, 2);
  const eerste = svc.approvePriceException(store, { exceptionId: ex.id }, ops);
  assert.equal(eerste.status, "pending"); // 1 van 2
  assert.throws(() => svc.approvePriceException(store, { exceptionId: ex.id }, ops),
    e => e.code === "DUPLICATE_APPROVAL");
  const tweede = svc.approvePriceException(store, { exceptionId: ex.id }, finance);
  assert.equal(tweede.status, "approved");
  assert.equal(tweede.approvals.length, 2);
});

test("priceException · self-approval geweigerd (vier-ogen)", () => {
  const store = fakeStore();
  const ex = svc.priceException(store, { tenantId: "t1", resellerId: "r1", requestedPrice: 1300, reason: "deal", expiry: "2099-01-01" }, ops);
  assert.throws(() => svc.approvePriceException(store, { exceptionId: ex.id }, ops),
    e => e.code === "SELF_APPROVAL_FORBIDDEN" && e.status === 403);
});

test("priceException · een reseller keurt nooit zelf goed (prijs blijft van het platform)", () => {
  const store = fakeStore();
  const ex = svc.priceException(store, { tenantId: "t1", requestedPrice: 1300, reason: "deal", expiry: "2099-01-01" }, partnerSales);
  assert.throws(() => svc.approvePriceException(store, { exceptionId: ex.id }, partnerSales),
    e => e.code === "RESELLER_APPROVAL_FORBIDDEN" && e.status === 403);
});

test("priceException · meegestuurde lijstprijs moet de centrale bron matchen; op-aanvraag plan heeft geen lijstprijs", () => {
  const store = fakeStore();
  assert.throws(() => svc.priceException(store, { tenantId: "t1", listPrice: 999, requestedPrice: 900, reason: "x", expiry: "2099-01-01" }, partnerSales),
    e => e.code === "LIST_PRICE_MISMATCH" && e.status === 409);
  assert.throws(() => svc.priceException(store, { tenantId: "t2", requestedPrice: 100, reason: "x", expiry: "2099-01-01" }, partnerSales),
    e => e.code === "PRICE_ON_REQUEST" && e.status === 409);
});

test("priceException · commissievelden reizen nooit mee (aparte goedkeuring, geen dubbele bevoordeling)", () => {
  const store = fakeStore();
  assert.throws(() => svc.priceException(store, { tenantId: "t1", requestedPrice: 1300, commissionPct: 15, reason: "x", expiry: "2099-01-01" }, partnerSales),
    e => e.code === "COMMISSION_COUPLING_FORBIDDEN" && e.status === 400);
});

test("priceException · gevraagde prijs boven lijstprijs of zonder geldigheidsperiode geweigerd", () => {
  const store = fakeStore();
  assert.throws(() => svc.priceException(store, { tenantId: "t1", requestedPrice: 2000, reason: "x", expiry: "2099-01-01" }, partnerSales),
    e => e.code === "REQUESTED_PRICE_INVALID");
  assert.throws(() => svc.priceException(store, { tenantId: "t1", requestedPrice: 1300, reason: "x", expiry: "2000-01-01" }, partnerSales),
    e => e.code === "EXPIRY_INVALID");
});

// ── Trial extension ──────────────────────────────────────────────────────────

test("trialExtension · registreert originele en nieuwe einddatum en telt prior_extensions", () => {
  const store = fakeStore();
  const req = svc.trialExtension(store, { tenantId: "t3", newEnd: "2026-10-01", reason: "pilot loopt uit" }, partnerSales);
  assert.equal(req.kind, "trial_extension");
  assert.equal(req.payload.originalEnd, "2026-08-15");
  assert.equal(req.payload.newEnd, "2026-10-01");
  assert.equal(req.payload.priorExtensions, 0);
  assert.equal(req.payload.exception, false);
});

test("trialExtension · boven het maximum alleen via een uitzonderingsaanvraag", () => {
  const store = fakeStore({
    resellerLicenseRequests: [
      { id: "x1", kind: "trial_extension", clientTenantId: "t3", resellerId: "r1", status: "applied", payload: {} },
      { id: "x2", kind: "trial_extension", clientTenantId: "t3", resellerId: "r1", status: "approved", payload: {} },
    ],
  });
  assert.throws(() => svc.trialExtension(store, { tenantId: "t3", newEnd: "2026-10-01", reason: "nog eens" }, partnerSales),
    e => e.code === "TRIAL_EXTENSION_LIMIT" && e.status === 409);
  const req = svc.trialExtension(store, { tenantId: "t3", newEnd: "2026-10-01", reason: "nog eens", exceptionRequested: true }, partnerSales);
  assert.equal(req.payload.exception, true);
  assert.equal(req.payload.priorExtensions, 2);
});

test("trialExtension · nieuwe einddatum moet na de originele liggen; zonder trial geen verlenging", () => {
  const store = fakeStore();
  assert.throws(() => svc.trialExtension(store, { tenantId: "t3", newEnd: "2026-08-01", reason: "x" }, partnerSales),
    e => e.code === "TRIAL_END_INVALID");
  assert.throws(() => svc.trialExtension(store, { tenantId: "t1", newEnd: "2026-10-01", reason: "x" }, partnerSales),
    e => e.code === "NO_ACTIVE_TRIAL" && e.status === 409);
});

// ── Cancellation ─────────────────────────────────────────────────────────────

test("cancellation · expliciete scope, datum, reden, data-export en einde toegang; retentie gerespecteerd", () => {
  const store = fakeStore();
  assert.throws(() => svc.cancellation(store, { tenantId: "t1", scope: "full", date: "2026-09-30", reason: "stopt", accessEnd: "2026-10-31" }, partnerSales),
    e => e.code === "DATA_EXPORT_DECISION_REQUIRED");
  assert.throws(() => svc.cancellation(store, { tenantId: "t1", scope: "full", date: "2026-09-30", reason: "stopt", dataExport: true, accessEnd: "2026-09-01" }, partnerSales),
    e => e.code === "ACCESS_END_INVALID");
  const req = svc.cancellation(store, { tenantId: "t1", scope: "full", date: "2026-09-30", reason: "stopt", dataExport: true, accessEnd: "2026-10-31" }, partnerSales);
  assert.equal(req.kind, "cancellation");
  assert.equal(req.payload.retention.dataExportRequested, true);
  assert.equal(req.payload.retention.accessEndAt, "2026-10-31");
  // Tweede open opzegging voor dezelfde tenant is geblokkeerd.
  assert.throws(() => svc.cancellation(store, { tenantId: "t1", scope: "full", date: "2026-09-30", reason: "nogmaals", dataExport: false, accessEnd: "2026-10-31" }, partnerSales),
    e => e.code === "CANCELLATION_ALREADY_OPEN" && e.status === 409);
});

// ── Versieerbare resellerkortingen ───────────────────────────────────────────

test("setResellerDiscount · een reseller wijzigt nooit platformprijzen of catalogus", () => {
  const store = fakeStore();
  assert.throws(() => svc.setResellerDiscount(store, { resellerId: "r1", tier: "silver", discountPct: 10, validFrom: "2026-01-01", validUntil: "2026-12-31" }, partnerSales),
    e => e.code === "CATALOG_CHANGE_FORBIDDEN" && e.status === 403);
});

test("setResellerDiscount · immutable versies met geldigheidsperiode; hoogste geldige versie wint", () => {
  const store = fakeStore();
  const v1 = svc.setResellerDiscount(store, { resellerId: "r1", tier: "silver", discountPct: 10, validFrom: "2026-01-01", validUntil: "2026-12-31" }, ops);
  const v2 = svc.setResellerDiscount(store, { resellerId: "r1", tier: "silver", discountPct: 15, validFrom: "2026-07-01", validUntil: "2026-12-31" }, ops);
  assert.equal(v1.version, 1);
  assert.equal(v2.version, 2);
  assert.equal(store.data.resellerPriceAgreements.length, 2); // niets overschreven
  assert.equal(svc.resellerDiscountFor(store, "r1", "2026-08-01").discountPct, 15);
  assert.equal(svc.resellerDiscountFor(store, "r1", "2027-02-01"), null);
  assert.throws(() => svc.setResellerDiscount(store, { resellerId: "r1", tier: "silver", discountPct: 10, validFrom: "2026-12-31", validUntil: "2026-01-01" }, ops),
    e => e.code === "VALIDITY_INVALID");
  assert.throws(() => svc.setResellerDiscount(store, { resellerId: "r1", discountPct: 10, validFrom: "2026-01-01", validUntil: "2026-12-31" }, ops),
    e => e.code === "CONTRACT_OR_TIER_REQUIRED");
});

// ── Statusmachine licenseRequest ─────────────────────────────────────────────

test("transition · reseller kan niet goedkeuren; Monargo keurt goed; ongeldige sprong geweigerd", () => {
  const store = fakeStore();
  const order = svc.licenseOrder(store, { ...validOrder }, partnerSales);
  assert.throws(() => svc.transitionLicenseRequest(store, { requestId: order.id, to: "approved" }, partnerSales),
    e => e.code === "RESELLER_APPROVAL_FORBIDDEN" && e.status === 403);
  const approved = svc.transitionLicenseRequest(store, { requestId: order.id, to: "approved" }, ops);
  assert.equal(approved.status, "approved");
  assert.equal(approved.approvedBy, "ops@monargo.com");
  // approved → applied slaat scheduled over: 409 uit de statusmachine (23.14)
  assert.throws(() => svc.transitionLicenseRequest(store, { requestId: order.id, to: "applied" }, ops),
    e => e.code === "LICENSE_REQUEST_TRANSITION_INVALID" && e.status === 409);
  const scheduled = svc.transitionLicenseRequest(store, { requestId: order.id, to: "scheduled" }, ops);
  const applied = svc.transitionLicenseRequest(store, { requestId: scheduled.id, to: "applied" }, ops);
  assert.equal(applied.status, "applied");
  assert.equal(applied.history.length, 4); // draft→submitted→approved→scheduled→applied
});

test("transition · geen self-approval: indiener en goedkeurder moeten verschillen", () => {
  const store = fakeStore();
  const order = svc.licenseOrder(store, { ...validOrder, resellerId: "r1", externalRef: "PO-2" }, ops);
  assert.throws(() => svc.transitionLicenseRequest(store, { requestId: order.id, to: "approved" }, ops),
    e => e.code === "SELF_APPROVAL_FORBIDDEN" && e.status === 403);
  const approved = svc.transitionLicenseRequest(store, { requestId: order.id, to: "approved" }, finance);
  assert.equal(approved.status, "approved");
});

test("transition · vreemde reseller ziet andermans aanvraag als onbestaand (404-pariteit)", () => {
  const store = fakeStore();
  const order = svc.licenseOrder(store, { ...validOrder }, partnerSales);
  let fout;
  try { svc.transitionLicenseRequest(store, { requestId: order.id, to: "submitted" }, partnerAnder); } catch (e) { fout = e; }
  assert.equal(fout.code, "LICENSE_REQUEST_NOT_FOUND");
  assert.equal(fout.status, 404);
  assert.equal(fout.message, "Niet gevonden");
});

test("transition · goedkeuring hercontroleert de catalogus (DoD-6): inactief plan blokkeert", () => {
  const store = fakeStore();
  const order = svc.licenseOrder(store, { ...validOrder }, partnerSales);
  // Superadmin deactiveert de bundel na de bestelling.
  const bundle = store.data.bundles.find(b => b.key === "business");
  bundle.active = false;
  assert.throws(() => svc.transitionLicenseRequest(store, { requestId: order.id, to: "approved" }, ops),
    e => e.code === "CATALOG_ITEM_INACTIVE" && e.status === 409);
});
