// Reseller-/partnerprogramma op platform-niveau.
//
// Een reseller (platform-partner) brengt klanten (tenants) aan en verdient een
// terugkerende commissie = % van het abonnement (MRR) van die klant. Resellers
// zien enkel COMMERCIËLE gegevens van hun klanten (plan, status, abonnement,
// commissie) · nooit operationele/persoonsgegevens (GDPR). Zie [[project-support-access]].

// CTO-09 · MRR komt UITSLUITEND uit de centrale billing-/pricingbron
// (billing.tenantMrr op de superadmin-bewerkbare bundelprijzen). Vaste
// prijsconstanten in resellerlogica zijn verboden (CTO-review 2026-07-22):
// die konden afwijken van bewerkbare bundelprijzen, kortingen en seats.
const { tenantMrr } = require("./billing");
// 23.15/DoD-8 · payout- en contractgegevens blijven veldmatig buiten algemene
// resellerexports. EEN denylist voor het hele domein (geen tweede kopie hier).
const { exportSafeReseller } = require("./reseller-commission-agreement");

const LINKS = "resellerTenantLinks";

function toMs(v) {
  if (v == null) return Date.now();
  if (v instanceof Date) return v.getTime();
  return typeof v === "number" ? v : Date.parse(v);
}

// Werkzame koppeling · zelfde regel als reseller-tenants.isLinkActive:
// status active, niet ingetrokken, relatie niet "none" en binnen het venster.
// De lifecycle-offboarding zet koppelingen op "ended", intrekken op "revoked" ·
// beide vallen hier vanzelf af.
function isLinkActive(link, nowMs) {
  return Boolean(link)
    && link.status === "active"
    && !link.revokedAt
    && link.relationType !== "none"
    && (!(link.startAt || link.startDate) || toMs(link.startAt || link.startDate) <= nowMs)
    && (!(link.endAt || link.endDate) || toMs(link.endAt || link.endDate) > nowMs);
}

/**
 * De klanten van een reseller · legacy-compatibele regel (23.15/DoD-1):
 *  - bestaat er voor (reseller, tenant) EEN of meer assignment-records, dan is
 *    DAT bepalend: enkel een ACTIEF record telt · een intrekking, beeindiging
 *    of verlopen venster wint altijd van het commerciele veld op de tenant;
 *  - bestaat er GEEN record (legacy data van voor h23), dan telt
 *    tenant.resellerId als vanouds, zodat bestaande klanten zichtbaar blijven.
 * Zo toont geen enkele query nog tenants op basis van alleen reseller_id
 * zodra er een koppelingsadministratie is.
 */
function clientsOfReseller(store, resellerId, now) {
  const nowMs = toMs(now);
  const linked = new Map(); // tenantId → is er een actieve koppeling?
  for (const l of store.data[LINKS] || []) {
    if (!l || l.resellerId !== resellerId) continue;
    linked.set(l.tenantId, (linked.get(l.tenantId) === true) || isLinkActive(l, nowMs));
  }
  return (store.data.tenants || []).filter(t =>
    linked.has(t.id) ? linked.get(t.id) === true : t.resellerId === resellerId);
}

// Commissie-% voor een klant: per-klant-override of het standaardtarief van de reseller.
function commissionPctFor(tenant, reseller) {
  if (typeof tenant.commissionPct === "number") return tenant.commissionPct;
  return Number(reseller.defaultCommissionPct || 0);
}

// Overzicht van de klanten + commissie van één reseller (enkel commerciële velden).
function commissionOverview(store, reseller) {
  const rows = clientsOfReseller(store, reseller.id).map(t => {
    const mrr = tenantMrr(store, t); // CTO2-09: null = op aanvraag (custom/enterprise)
    const pct = commissionPctFor(t, reseller);
    return {
      tenantId: t.id, name: t.name, plan: t.plan, status: t.status,
      mrr, unpriced: mrr === null,
      commissionPct: pct, commission: mrr === null ? 0 : Math.round(mrr * pct) / 100
    };
  });
  return {
    clientCount: rows.length,
    // Alleen geprijsde klanten tellen in het totaal; op-aanvraag telt niet als 0-omzet.
    totalMrr: Math.round(rows.reduce((s, r) => s + (r.mrr || 0), 0) * 100) / 100,
    unpricedCount: rows.filter(r => r.unpriced).length,
    totalCommission: Math.round(rows.reduce((s, r) => s + r.commission * 100, 0)) / 100,
    rows
  };
}

/**
 * Publieke projectie van een resellerrij. Payout- en contractgegevens (IBAN,
 * valuta, commissiemodel, contract-/DPA-data) vallen hier ALTIJD weg: die zijn
 * uitsluitend zichtbaar op de aparte finance-route met reseller.payout.manage
 * (23.15 · DoD-2/DoD-8). passwordHash zit al in dezelfde denylist.
 */
function publicReseller(reseller, store) {
  const safe = exportSafeReseller(reseller);
  const ov = store ? commissionOverview(store, reseller) : null;
  return ov
    ? { ...safe, clientCount: ov.clientCount, totalMrr: ov.totalMrr, totalCommission: ov.totalCommission }
    : safe;
}

/**
 * Payoutgegevens van EEN reseller · uitsluitend voor de finance-route achter
 * reseller.payout.manage. Bewust een eigen, expliciete projectie: nooit de
 * volledige rij, zodat er geen ander gevoelig veld meelift.
 */
function payoutDetails(reseller) {
  if (!reseller) return null;
  return {
    resellerId: reseller.id,
    payout_account: reseller.payout_account || reseller.payoutAccount || null,
    payout_currency: reseller.payout_currency || reseller.payoutCurrency || null,
    payout_method: reseller.payout_method || null,
    commission_model: reseller.commission_model || null,
    billing_email: reseller.billing_email || reseller.billingEmail || null,
    vat_treatment: reseller.vat_treatment || null,
  };
}

module.exports = {
  tenantMrr, clientsOfReseller, commissionPctFor, commissionOverview,
  publicReseller, payoutDetails,
};
