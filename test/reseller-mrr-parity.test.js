"use strict";
// CTO2-09 · MRR-parity: reseller/admin-MRR gebruikt exact dezelfde billable
// seats en pricing als billingQuote. Geen Business-fallback voor custom plannen.
const { test } = require("node:test");
const assert = require("node:assert");
const billing = require("../src/modules/billing");
const { commissionOverview } = require("../src/modules/resellers");

// Mini-store: enkel wat tenantMrr/billingQuote nodig hebben.
function fakeStore(users) {
  return {
    list: (coll, tid) => (coll === "users" ? (users[tid] || []) : []),
    data: { tenants: [] },
  };
}

test("tenantMrr = billingQuote-basis · zelfde billable seats (admins tellen niet mee)", () => {
  // 3 gebruikers: 1 tenant_admin (niet-billable) + 2 employees (billable).
  const users = { t1: [
    { id: "u1", role: "tenant_admin", active: true },
    { id: "u2", role: "employee", active: true },
    { id: "u3", role: "employee", active: true },
  ] };
  const store = fakeStore(users);
  const tenant = { id: "t1", status: "active", plan: "business" };
  const quote = billing.billingQuote(store, tenant);
  const mrr = billing.tenantMrr(store, tenant);
  // MRR = jaarbasis van de quote / 12 · exact dezelfde seats/prijs.
  assert.equal(mrr, Math.round((quote.annualSubtotal / 12) * 100) / 100);
  assert.equal(quote.seats, 2, "enkel de 2 employees zijn billable");
});

test("custom/enterprise · GEEN Business-fallback: MRR is null (op aanvraag)", () => {
  const store = fakeStore({ t2: [{ id: "u1", role: "employee", active: true }] });
  const ent = { id: "t2", status: "active", plan: "enterprise" };
  assert.equal(billing.tenantMrr(store, ent), null, "enterprise = op aanvraag");
  // Onbekend plan valt óók niet stil terug op Business.
  assert.equal(billing.tenantMrr(store, { id: "t2", status: "active", plan: "zzz-onbekend" }), null);
  // Inactieve tenant = 0.
  assert.equal(billing.tenantMrr(store, { id: "t2", status: "trial", plan: "business" }), 0);
});

test("commissionOverview · unpriced telt niet als 0-omzet, wordt apart geteld", () => {
  const store = {
    list: (coll, tid) => (coll === "users" ? [{ id: "a", role: "employee", active: true }] : []),
    data: { tenants: [
      { id: "c1", status: "active", plan: "business", resellerId: "r1" },
      { id: "c2", status: "active", plan: "enterprise", resellerId: "r1" }, // op aanvraag
    ] },
  };
  const reseller = { id: "r1", defaultCommissionPct: 10 };
  const ov = commissionOverview(store, reseller);
  assert.equal(ov.clientCount, 2);
  assert.equal(ov.unpricedCount, 1, "de enterprise-klant is unpriced");
  const c2 = ov.rows.find(r => r.tenantId === "c2");
  assert.equal(c2.mrr, null);
  assert.equal(c2.commission, 0, "geen commissie op een prijs-op-aanvraag");
  // totaalMRR bevat enkel de geprijsde klant.
  const c1 = ov.rows.find(r => r.tenantId === "c1");
  assert.equal(ov.totalMrr, c1.mrr);
});
