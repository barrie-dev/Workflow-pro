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

function clientsOfReseller(store, resellerId) {
  return (store.data.tenants || []).filter(t => t.resellerId === resellerId);
}

// Commissie-% voor een klant: per-klant-override of het standaardtarief van de reseller.
function commissionPctFor(tenant, reseller) {
  if (typeof tenant.commissionPct === "number") return tenant.commissionPct;
  return Number(reseller.defaultCommissionPct || 0);
}

// Overzicht van de klanten + commissie van één reseller (enkel commerciële velden).
function commissionOverview(store, reseller) {
  const rows = clientsOfReseller(store, reseller.id).map(t => {
    const mrr = tenantMrr(store, t);
    const pct = commissionPctFor(t, reseller);
    return {
      tenantId: t.id, name: t.name, plan: t.plan, status: t.status,
      mrr, commissionPct: pct, commission: Math.round(mrr * pct) / 100
    };
  });
  return {
    clientCount: rows.length,
    totalMrr: rows.reduce((s, r) => s + r.mrr, 0),
    totalCommission: Math.round(rows.reduce((s, r) => s + r.commission * 100, 0)) / 100,
    rows
  };
}

function publicReseller(reseller, store) {
  const { passwordHash, ...safe } = reseller;
  const ov = store ? commissionOverview(store, reseller) : null;
  return ov
    ? { ...safe, clientCount: ov.clientCount, totalMrr: ov.totalMrr, totalCommission: ov.totalCommission }
    : safe;
}

module.exports = { tenantMrr, clientsOfReseller, commissionPctFor, commissionOverview, publicReseller };
