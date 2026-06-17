"use strict";

const DONE_STATUSES = new Set(["Voltooid", "Afgewerkt"]);

function isoDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function stableSuffix(value) {
  return String(value || "start").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "start";
}

function nextId(collection, prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function nextWorkorderNumber(workorders, year) {
  const count = workorders.filter(row => String(row.number || "").startsWith(`WO-${year}-`)).length;
  return `WO-${year}-${String(count + 1).padStart(3, "0")}`;
}

function selectFieldUser(users) {
  return users.find(user => user.active !== false && user.role === "employee")
    || users.find(user => user.active !== false && user.role === "manager")
    || users.find(user => user.active !== false && user.role !== "tenant_admin");
}

function previewCustomerStart(store, tenantId, options = {}) {
  const tenant = store.get("tenants", tenantId);
  if (!tenant) {
    const error = new Error(`Tenant niet gevonden: ${tenantId}`);
    error.status = 404;
    throw error;
  }

  const scoped = store.tenantScoped(tenantId);
  const date = options.date || isoDate();
  const targetWorkorders = Math.max(1, Number(options.targetWorkorders || 1));
  const fieldUser = selectFieldUser(scoped.users);
  const venue = scoped.venues.find(row => row.active !== false);
  const customer = scoped.customers.find(row => row.active !== false);
  const openWorkorders = scoped.workorders.filter(row => !DONE_STATUSES.has(row.status));
  const dayShifts = scoped.shifts.filter(row => row.date === date);
  const blockers = [
    fieldUser ? "" : "Geen actieve veldmedewerker of manager gevonden",
    dayShifts.length ? "" : "Geen planning op de klantstartdatum",
    openWorkorders.length >= targetWorkorders ? "" : `${targetWorkorders - openWorkorders.length} open werkbon(nen) nodig`
  ].filter(Boolean);

  const planned = [];
  if (!venue) {
    planned.push({
      collection: "venues",
      action: "create",
      label: "Eerste werf aanmaken",
      reason: "Customer-start heeft minstens een werf nodig voor planning en werkbonnen."
    });
  }
  if (!customer) {
    planned.push({
      collection: "customers",
      action: "create",
      label: "Eerste klantfiche aanmaken",
      reason: "Werkbonnen moeten aan een klant of opdrachtgever gekoppeld kunnen worden."
    });
  }
  if (fieldUser && dayShifts.length === 0) {
    planned.push({
      collection: "shifts",
      action: "create",
      label: "Eerste planning aanmaken",
      reason: "De klant moet op dag 1 een echte medewerker op locatie zien.",
      date,
      userId: fieldUser.id
    });
  }
  const missingWorkorders = Math.max(0, targetWorkorders - openWorkorders.length);
  for (let index = 0; index < missingWorkorders; index += 1) {
    planned.push({
      collection: "workorders",
      action: "create",
      label: index === 0 ? "Eerste werkbon aanmaken" : "Extra pilotwerkbon aanmaken",
      reason: "Open werkbonnen zijn nodig voor uitvoering op de werf en pilotbewijs.",
      userId: fieldUser?.id || null
    });
  }

  return {
    tenant: { id: tenant.id, name: tenant.name },
    date,
    targetWorkorders,
    readyBefore: dayShifts.length > 0 && openWorkorders.length >= targetWorkorders,
    fieldUser: fieldUser ? { id: fieldUser.id, name: fieldUser.name, role: fieldUser.role } : null,
    existing: {
      venues: scoped.venues.length,
      customers: scoped.customers.length,
      dayShifts: dayShifts.length,
      openWorkorders: openWorkorders.length
    },
    blockers,
    planned
  };
}

function applyCustomerStart(store, tenantId, options = {}) {
  const before = previewCustomerStart(store, tenantId, options);
  const tenant = store.get("tenants", tenantId);
  const scoped = store.tenantScoped(tenantId);
  const date = before.date;
  const actor = options.actor || { email: "customer-start@workflowpro.be" };
  const created = [];

  let fieldUser = selectFieldUser(scoped.users);
  if (!fieldUser) {
    return { ...before, applied: false, created, after: before };
  }

  let venue = scoped.venues.find(row => row.active !== false);
  if (!venue) {
    venue = store.insert("venues", {
      id: nextId("venues", "venue"),
      tenantId,
      name: "Eerste werf",
      code: `START-${stableSuffix(tenantId).slice(0, 8)}`,
      address: tenant.invoiceProfile?.street || "",
      city: tenant.invoiceProfile?.city || "",
      active: true,
      customerStart: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    created.push({ collection: "venues", id: venue.id, label: venue.name });
  }

  let customer = scoped.customers.find(row => row.active !== false);
  if (!customer) {
    customer = store.insert("customers", {
      id: nextId("customers", "customer"),
      tenantId,
      name: tenant.name,
      vat: tenant.invoiceProfile?.vat || "",
      email: tenant.billingEmail || "",
      active: true,
      customerStart: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    created.push({ collection: "customers", id: customer.id, label: customer.name });
  }

  const dayShifts = store.list("shifts", tenantId).filter(row => row.date === date);
  if (dayShifts.length === 0) {
    const shift = store.insert("shifts", {
      id: nextId("shifts", "shift"),
      tenantId,
      userId: fieldUser.id,
      userName: fieldUser.name,
      venueId: venue.id,
      venueName: venue.name,
      customerId: customer.id,
      date,
      start: "08:00",
      end: "16:30",
      project: "Eerste klantopdracht",
      client: customer.name,
      billable: true,
      status: "planned",
      customerStart: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    created.push({ collection: "shifts", id: shift.id, label: `${shift.date} ${shift.start}-${shift.end}` });
  }

  let workorders = store.list("workorders", tenantId);
  let openWorkorders = workorders.filter(row => !DONE_STATUSES.has(row.status));
  const targetWorkorders = before.targetWorkorders;
  while (openWorkorders.length < targetWorkorders) {
    const year = new Date(date).getFullYear();
    const number = nextWorkorderNumber(workorders, year);
    const sequence = openWorkorders.length + 1;
    const workorder = store.insert("workorders", {
      id: nextId("workorders", "wo"),
      tenantId,
      number,
      userId: fieldUser.id,
      userName: fieldUser.name,
      venueId: venue.id,
      venueName: venue.name,
      customerId: customer.id,
      client: customer.name,
      title: sequence === 1 ? "Eerste werkbon klantstart" : `Pilotwerkbon ${sequence}`,
      status: "Te starten",
      scheduledDate: date,
      billable: true,
      checklist: [
        { label: "Opdracht bevestigd met klant", done: false },
        { label: "Bewijs of foto toevoegen op locatie", done: false }
      ],
      customerStart: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    created.push({ collection: "workorders", id: workorder.id, label: `${workorder.number} ${workorder.title}` });
    workorders = store.list("workorders", tenantId);
    openWorkorders = workorders.filter(row => !DONE_STATUSES.has(row.status));
  }

  if (created.length) {
    store.audit({
      actor: actor.email,
      tenantId,
      action: "customer_start_bootstrapped",
      area: "customer_start",
      detail: `${created.length} item(s) aangemaakt voor ${date}`
    });
  }

  return {
    ...before,
    applied: true,
    created,
    after: previewCustomerStart(store, tenantId, options)
  };
}

module.exports = { previewCustomerStart, applyCustomerStart };
