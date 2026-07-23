"use strict";

// Cluster C · klantzichtbaarheid en exportafscherming van het resellerdomein.
//
// 1. 23.15/DoD-1: geen enkele query toont tenants op basis van ALLEEN
//    reseller_id zodra er een koppelingsadministratie bestaat. Een ingetrokken
//    koppeling laat de klant meteen verdwijnen uit het portaaloverzicht EN uit
//    de accrual-basis; een tenant zonder link-record (legacy data van voor h23)
//    blijft zichtbaar via het commerciele veld op de tenant.
// 2. 23.15/DoD-2: payout- en contractgegevens zitten NOOIT in een algemene
//    reseller-export (publicReseller) · alleen in de aparte finance-projectie.

const { test } = require("node:test");
const assert = require("node:assert");
const { clientsOfReseller, commissionOverview, publicReseller, payoutDetails } = require("../src/modules/resellers");
const commissionSvc = require("../src/modules/commission-service");

const reseller = { id: "r1", name: "Partner A", defaultCommissionPct: 10 };

function fakeStore(seed = {}) {
  const data = {
    tenants: [], resellerTenantLinks: [], commissionEvents: [], commissionPayouts: [],
    audit: [], ...seed,
  };
  return {
    data,
    // billing.tenantMrr telt billable seats via store.list("users", tenantId).
    list: (coll, tid) => (coll === "users" ? [{ id: `u_${tid}`, role: "employee", active: true }] : []),
    insert(coll, row) { (data[coll] = data[coll] || []).push(row); return row; },
    update(coll, id, patch) {
      data[coll] = (data[coll] || []).map(r => (r.id === id ? { ...r, ...patch } : r));
      return (data[coll] || []).find(r => r.id === id);
    },
    get(coll, id) { return (data[coll] || []).find(r => r.id === id); },
    audit(e) { data.audit.push(e); return e; },
  };
}

function link(overrides = {}) {
  return {
    id: "rtl_1", resellerId: "r1", tenantId: "t_link", relationType: "commercial",
    status: "active", startAt: "2026-01-01T00:00:00.000Z", startDate: "2026-01-01T00:00:00.000Z",
    endAt: null, endDate: null, revokedAt: null, ...overrides,
  };
}

function storeWithBoth(linkOverrides = {}) {
  return fakeStore({
    tenants: [
      // Klant MET assignment-record (nieuwe 23.9-weg).
      { id: "t_link", name: "Klant met koppeling", status: "active", plan: "business", resellerId: "r1" },
      // Legacy klant ZONDER enig link-record (data van voor h23).
      { id: "t_legacy", name: "Legacy klant", status: "active", plan: "business", resellerId: "r1" },
    ],
    resellerTenantLinks: [link(linkOverrides)],
  });
}

test("clientsOfReseller · actieve koppeling telt, legacy tenant zonder record blijft zichtbaar", () => {
  const store = storeWithBoth();
  const ids = clientsOfReseller(store, "r1").map(t => t.id);
  assert.deepEqual(ids.sort(), ["t_legacy", "t_link"]);
});

test("clientsOfReseller · ingetrokken koppeling wint van tenant.resellerId (23.15)", () => {
  const store = storeWithBoth({ status: "revoked", revokedAt: "2026-07-01T00:00:00.000Z" });
  const ids = clientsOfReseller(store, "r1").map(t => t.id);
  assert.deepEqual(ids, ["t_legacy"], "de ingetrokken klant verdwijnt, ook al staat resellerId nog op de tenant");
});

test("clientsOfReseller · beeindigde (ended) en verlopen koppelingen tellen niet mee", () => {
  const ended = storeWithBoth({ status: "ended", endDate: "2026-07-01T00:00:00.000Z" });
  assert.ok(!clientsOfReseller(ended, "r1").some(t => t.id === "t_link"), "offboarding-einde telt niet");
  const expired = storeWithBoth({ endAt: "2020-01-01T00:00:00.000Z", endDate: "2020-01-01T00:00:00.000Z" });
  assert.ok(!clientsOfReseller(expired, "r1").some(t => t.id === "t_link"), "verlopen venster telt niet");
  const none = storeWithBoth({ relationType: "none" });
  assert.ok(!clientsOfReseller(none, "r1").some(t => t.id === "t_link"), "geen relatie = geen koppeling");
});

test("commissionOverview + accrual · ingetrokken klant valt uit de commissiebasis", () => {
  const actief = storeWithBoth();
  const voor = commissionOverview(actief, reseller);
  assert.equal(voor.clientCount, 2);
  const geboekt = commissionSvc.accruePeriod(actief, { resellerId: "r1", period: "2026-07", overview: voor }, { email: "finance@monargo.one" });
  assert.equal(geboekt.created, 2, "beide klanten leveren een accrual");

  const ingetrokken = storeWithBoth({ status: "revoked", revokedAt: "2026-07-01T00:00:00.000Z" });
  const na = commissionOverview(ingetrokken, reseller);
  assert.equal(na.clientCount, 1);
  assert.ok(!na.rows.some(r => r.tenantId === "t_link"));
  const naBoeking = commissionSvc.accruePeriod(ingetrokken, { resellerId: "r1", period: "2026-07", overview: na }, { email: "finance@monargo.one" });
  assert.equal(naBoeking.created, 1, "de ingetrokken klant accrueert niet meer");
  assert.ok(!ingetrokken.data.commissionEvents.some(e => e.clientTenantId === "t_link"));
  assert.ok(na.totalMrr < voor.totalMrr, "ook de MRR-basis krimpt");
});

test("publicReseller · export bevat NOOIT payout- of contractgegevens (DoD-2)", () => {
  const rij = {
    id: "r1", name: "Partner A", status: "active", defaultCommissionPct: 10,
    passwordHash: "geheim", payout_account: "BE68539007547034", payout_currency: "EUR",
    payoutAccount: "BE68539007547034", bank_account: "123", iban: "BE68",
    commission_model: "percentage", contract_id: "c-1", agreement_version: "2026-01",
    accepted_at: "2026-01-10", dpa_accepted_at: "2026-01-10", nda_accepted_at: "2026-01-10",
  };
  for (const safe of [publicReseller(rij), publicReseller(rij, storeWithBoth())]) {
    const json = JSON.stringify(safe);
    for (const veld of ["payout_account", "payoutAccount", "payout_currency", "passwordHash",
      "bank_account", "iban", "commission_model", "contract_id", "agreement_version",
      "accepted_at", "dpa_accepted_at", "nda_accepted_at"]) {
      assert.equal(safe[veld], undefined, `${veld} hoort niet in een algemene reseller-export`);
    }
    assert.ok(!json.includes("BE68539007547034"), "de IBAN mag nergens in de payload staan");
    assert.equal(safe.name, "Partner A", "commerciele velden blijven wel bestaan");
    assert.equal(safe.status, "active");
  }
});

test("payoutDetails · de aparte finance-projectie toont de payoutgegevens wel", () => {
  const d = payoutDetails({ id: "r1", payout_account: "BE68539007547034", payout_currency: "EUR", passwordHash: "geheim" });
  assert.equal(d.payout_account, "BE68539007547034");
  assert.equal(d.payout_currency, "EUR");
  assert.equal(d.passwordHash, undefined, "ook hier nooit meer dan de expliciete velden");
  assert.equal(payoutDetails(null), null);
});
