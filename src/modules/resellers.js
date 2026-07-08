// Reseller-/partnerprogramma op platform-niveau.
//
// Een reseller (platform-partner) brengt klanten (tenants) aan en verdient een
// terugkerende commissie = % van het abonnement (MRR) van die klant. Resellers
// zien enkel COMMERCIËLE gegevens van hun klanten (plan, status, abonnement,
// commissie) · nooit operationele/persoonsgegevens (GDPR). Zie [[project-support-access]].

// Zelfde MRR-formule als /api/admin/billing (plan × actieve gebruikers).
const MRR_PLAN = { starter: 9, business: 18, enterprise: 29 };

function tenantMrr(store, tenant) {
  if (!tenant || tenant.status !== "active") return 0;
  const users = store.list("users", tenant.id).length;
  const unit = MRR_PLAN[tenant.plan] || 18;
  return unit * Math.max(users, 1);
}

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

module.exports = { MRR_PLAN, tenantMrr, clientsOfReseller, commissionPctFor, commissionOverview, publicReseller };
