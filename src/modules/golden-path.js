const { lookupKbo } = require("./kbo");
const { createInvoice } = require("./billing");

function readiness(store, tenantId) {
  const scoped = store.tenantScoped(tenantId);
  const tenant = scoped.tenant || {};
  const invoiceProfile = tenant.invoiceProfile || {};
  const steps = [
    { key: "tenant", done: !!tenant.id },
    { key: "kbo", done: !!(invoiceProfile.vat && invoiceProfile.companyNumber && (invoiceProfile.street || invoiceProfile.city)) },
    { key: "employees", done: scoped.users.some(u => u.role !== "tenant_admin") },
    { key: "planning", done: scoped.shifts.length > 0 },
    { key: "workorders", done: scoped.workorders.length > 0 },
    { key: "clockings", done: scoped.clocks.some(c => c.clockOut) },
    { key: "invoice", done: (tenant.billingOps?.invoiceHistory || []).length > 0 || scoped.invoices.length > 0 }
  ];
  return {
    tenant,
    percent: Math.round((steps.filter(step => step.done).length / steps.length) * 100),
    steps
  };
}

function applyKbo(store, tenant, vat, actor) {
  const result = lookupKbo(vat);
  const next = store.updateTenant(tenant.id, {
    name: result.name,
    invoiceProfile: {
      ...(tenant.invoiceProfile || {}),
      vat: result.vat,
      companyNumber: result.companyNumber,
      street: result.street,
      postalCode: result.postalCode,
      city: result.city,
      country: result.country,
      kboSyncedAt: new Date().toISOString()
    },
    onboarding: { ...(tenant.onboarding || {}), company: true }
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "kbo_lookup", area: "tenants", detail: result.vat });
  return next;
}

function createDemoGoldenPath(store, tenant, actor) {
  // Vervolledig KBO-onboarding zodat de golden-path "kbo"-stap echt slaagt
  // (vereist vat + companyNumber + straat/stad in invoiceProfile).
  const ip = tenant.invoiceProfile || {};
  const kboComplete = !!(ip.vat && ip.companyNumber && (ip.street || ip.city));
  if (!kboComplete) {
    // Gebruik bestaande VAT als die een volledige fixture-match geeft, anders de demo-fixture.
    const candidate = ip.vat && lookupKbo(ip.vat).street ? ip.vat : "BE0123456789";
    applyKbo(store, tenant, candidate, actor);
    tenant = (store.data.tenants || []).find(t => t.id === tenant.id) || tenant;
  }
  const venue = store.insert("venues", {
    id: `venue_${Date.now()}`,
    tenantId: tenant.id,
    name: "Eerste werf",
    code: "EW",
    address: tenant.invoiceProfile?.street || "Nog aan te vullen",
    active: true
  });
  const employee = store.insert("users", {
    id: `user_${Date.now()}`,
    tenantId: tenant.id,
    name: "Eerste medewerker",
    email: `medewerker@${tenant.name.toLowerCase().replace(/[^a-z0-9]/g, "")}.be`,
    role: "employee",
    permissions: ["workorders", "expenses", "leaves", "messages"],
    active: true
  });
  store.insert("shifts", {
    id: `shift_${Date.now()}`,
    tenantId: tenant.id,
    userId: employee.id,
    venueId: venue.id,
    date: new Date().toISOString().slice(0, 10),
    start: "08:00",
    end: "16:30",
    project: "Eerste klantopdracht",
    client: "Demo klant",
    billable: true
  });
  store.insert("workorders", {
    id: `wo_${Date.now()}`,
    tenantId: tenant.id,
    userId: employee.id,
    venueId: venue.id,
    title: "Eerste werkbon",
    client: "Demo klant",
    status: "Bezig",
    checklist: [{ label: "Werk controleren", done: false }]
  });
  store.insert("clocks", {
    id: `clock_${Date.now()}`,
    tenantId: tenant.id,
    userId: employee.id,
    venueId: venue.id,
    date: new Date().toISOString().slice(0, 10),
    clockIn: "08:00",
    clockOut: "16:30"
  });
  const { invoice } = createInvoice(store, tenant, { line: "Eerste jaarlicentie Monargo One", amount: 12 * Math.max(tenant.mrr || 1, 1) }, actor);
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "golden_path_demo_created", area: "golden_path" });
  return { venue, employee, invoice, readiness: readiness(store, tenant.id) };
}

module.exports = { readiness, applyKbo, createDemoGoldenPath };
