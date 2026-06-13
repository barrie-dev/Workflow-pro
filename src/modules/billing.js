const { config } = require("../lib/config");

const PLAN_PACKAGES = {
  starter: {
    label: "Starter",
    baseAnnual: 590,
    seatAnnual: 96,
    includedSeats: 3,
    features: ["Planning", "Tijdregistratie", "Berichten", "Basis klanten/venues"]
  },
  business: {
    label: "Business",
    baseAnnual: 1290,
    seatAnnual: 180,
    includedSeats: 5,
    features: ["Werkbonnen", "Onkosten", "Rollen/rechten", "Rapportage", "Datahub export"]
  },
  enterprise: {
    label: "Enterprise",
    baseAnnual: 0,
    seatAnnual: 0,
    includedSeats: 0,
    features: ["Custom pricing", "Jaarcontract", "Peppol afspraken", "Integraties", "Support SLA"]
  }
};

const SYSTEM_ACTOR = { email: "stripe-webhook@workflowpro.local" };

const CONTRACT_TRANSITIONS = {
  start_trial: { from: ["new", "canceled"], to: "trial", label: "Trial gestart" },
  send_quote: { from: ["trial", "quote_sent", "past_due"], to: "quote_sent", label: "Offerte verzonden" },
  activate: { from: ["trial", "quote_sent", "past_due", "paid"], to: "active", label: "Contract actief" },
  mark_past_due: { from: ["active", "paid"], to: "past_due", label: "Betaling achterstallig" },
  cancel: { from: ["trial", "quote_sent", "active", "past_due", "paid"], to: "canceled", label: "Contract stopgezet" },
  renew: { from: ["active", "paid"], to: "active", label: "Contract vernieuwd" }
};

function createSetupIntent(tenant) {
  return {
    provider: "stripe",
    mode: "test",
    tenantId: tenant.id,
    clientSecret: `seti_mock_${tenant.id}_${Date.now()}_secret_mock`,
    status: "requires_payment_method"
  };
}

// Publieke plan-catalogus voor de klant-zelfbediening (prijzen server-bepaald).
function planCatalog() {
  return Object.entries(PLAN_PACKAGES).map(([key, p]) => ({
    key,
    label: p.label,
    baseAnnual: p.baseAnnual,
    baseMonthly: p.baseAnnual ? Math.round(p.baseAnnual / 12) : null,
    seatAnnual: p.seatAnnual,
    includedSeats: p.includedSeats,
    features: p.features,
    custom: key === "enterprise",
  }));
}

// Klant kiest zelf een bundel. Prijs komt uit PLAN_PACKAGES (niet door klant
// te beïnvloeden). Enterprise = op aanvraag (geen directe self-select).
function selectPlan(store, tenant, planKey, actor) {
  const key = String(planKey || "").toLowerCase();
  if (!PLAN_PACKAGES[key]) { const e = new Error("Onbekend plan"); e.status = 400; throw e; }
  if (key === "enterprise") { const e = new Error("Enterprise verloopt via een offerte op maat — neem contact op."); e.status = 400; throw e; }
  const next = store.updateTenant(tenant.id, { plan: key });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "plan_selected", area: "billing", detail: key });
  return billingSummary(next);
}

function billableSeats(store, tenantId) {
  return store.list("users", tenantId).filter(user => user.active !== false && user.role !== "tenant_admin" && user.role !== "super_admin").length;
}

function billingQuote(store, tenant) {
  const planKey = String(tenant.plan || "business").toLowerCase();
  const plan = PLAN_PACKAGES[planKey] || PLAN_PACKAGES.business;
  const seats = billableSeats(store, tenant.id);
  const extraSeats = Math.max(seats - plan.includedSeats, 0);
  const annualSubtotal = planKey === "enterprise" ? null : plan.baseAnnual + extraSeats * plan.seatAnnual;
  const vatRate = 0.21;
  const annualVat = annualSubtotal == null ? null : +(annualSubtotal * vatRate).toFixed(2);
  const annualTotal = annualSubtotal == null ? null : +(annualSubtotal + annualVat).toFixed(2);
  return {
    tenantId: tenant.id,
    planKey,
    planLabel: plan.label,
    seats,
    includedSeats: plan.includedSeats,
    extraSeats,
    seatAnnual: plan.seatAnnual,
    baseAnnual: plan.baseAnnual,
    annualSubtotal,
    annualVat,
    annualTotal,
    currency: "EUR",
    vatRate,
    enterpriseCustom: planKey === "enterprise",
    features: plan.features
  };
}

function billingSummary(tenant) {
  const billingOps = tenant.billingOps || {};
  const resolvedStatus = tenant.billingStatus || tenant.status || "trial";
  const paymentMethod = billingOps.paymentMethodRef ? (billingOps.paymentMethodRef.startsWith("card_") ? `Kaart ••••${billingOps.last4||""}` : billingOps.paymentMethodRef) : null;
  return {
    tenantId: tenant.id,
    plan: tenant.plan || "business",
    status: resolvedStatus,            // voor admin UI
    billingStatus: resolvedStatus,     // alias
    monthlyAmount: billingOps.monthlyAmount || 0,
    paymentMethod,                     // voor admin UI
    paymentMethodTokenized: !!billingOps.paymentMethodTokenized,
    autoCharge: !!billingOps.autoCharge,
    paymentMethodRef: billingOps.paymentMethodRef ? "tokenized" : "",
    dpaAccepted: !!tenant.compliance?.dpaAcceptedAt,
    dpaAcceptedAt: tenant.compliance?.dpaAcceptedAt || null,
    gdprRequests: tenant.compliance?.gdprRequests || [],
    invoices: billingOps.invoiceHistory || [],
    failedPayments: billingOps.failedPayments || [],
    contractEvents: billingOps.contractEvents || [],
    peppolProvider: config.peppol.provider || "mock",
    peppolEvents: billingOps.peppolEvents || [],
    stripeEvents: billingOps.stripeEvents || []
  };
}

function transitionContract(store, tenant, payload, actor) {
  const action = payload.action || "";
  const transition = CONTRACT_TRANSITIONS[action];
  if (!transition) {
    const error = new Error("Onbekende contractactie");
    error.status = 400;
    throw error;
  }
  const current = tenant.billingStatus || "trial";
  if (!transition.from.includes(current)) {
    const error = new Error(`Contract kan niet van ${current} naar ${transition.to}`);
    error.status = 400;
    throw error;
  }
  const event = {
    id: `contract_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    action,
    label: transition.label,
    from: current,
    to: transition.to,
    reason: payload.reason || "",
    at: new Date().toISOString(),
    by: actor.email
  };
  const billingOps = tenant.billingOps || {};
  const next = store.updateTenant(tenant.id, {
    billingStatus: transition.to,
    billingOps: {
      ...billingOps,
      contractEvents: [...(billingOps.contractEvents || []), event]
    }
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "contract_transition", area: "billing", detail: `${current} -> ${transition.to}` });
  return { tenant: next, event };
}

function attachPaymentMethod(store, tenant, paymentMethodRef, actor) {
  const next = store.updateTenant(tenant.id, {
    paymentMethod: "Card token opgeslagen",
    billingStatus: "paid",
    billingOps: {
      ...(tenant.billingOps || {}),
      paymentMethodTokenized: true,
      paymentMethodRef,
      autoCharge: true
    }
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "payment_method_attached", area: "billing" });
  return next;
}

function workorderLine(workorder) {
  const explicit = workorder.billableAmount ?? workorder.amount ?? workorder.fixedPrice;
  const amount = explicit != null
    ? Number(explicit)
    : Number(workorder.billableHours || workorder.hours || 0) * Number(workorder.hourlyRate || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    const error = new Error(`Werkbon ${workorder.id} mist een positief factureerbaar bedrag`);
    error.status = 422;
    throw error;
  }
  return {
    type: "workorder",
    workorderId: workorder.id,
    description: workorder.title || `Werkbon ${workorder.id}`,
    quantity: Number(workorder.billableHours || workorder.hours || 1),
    unitPrice: Number(workorder.hourlyRate || amount),
    amount: +amount.toFixed(2)
  };
}

function invoiceLinesFromWorkorders(store, tenant, payload) {
  if (!payload.fromWorkorders) return null;
  const requestedIds = Array.isArray(payload.workorderIds) ? new Set(payload.workorderIds) : null;
  const rows = store.list("workorders", tenant.id)
    .filter(row => row.billableStatus === "ready_for_invoice")
    .filter(row => !requestedIds || requestedIds.has(row.id));
  if (!rows.length) {
    const error = new Error("Geen facturatieklare werkbonnen gevonden");
    error.status = 422;
    throw error;
  }
  return rows.map(workorderLine);
}

function createInvoice(store, tenant, payload, actor) {
  const billingOps = tenant.billingOps || {};
  const operationalLines = invoiceLinesFromWorkorders(store, tenant, payload) || [];
  const gross = operationalLines.length
    ? operationalLines.reduce((sum, line) => sum + line.amount, 0)
    : Number(payload.amount || tenant.mrr * 12 || 0);
  const discountPct = Number(payload.discountPct || billingOps.discountPct || 0);
  const net = +(gross * (1 - discountPct / 100)).toFixed(2);
  if (!Number.isFinite(gross) || gross <= 0) {
    const error = new Error("Factuurbedrag moet groter zijn dan 0");
    error.status = 422;
    throw error;
  }
  const invoice = {
    id: `INV-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    at: new Date().toISOString().slice(0, 10),
    dueDate: payload.dueDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    line: payload.line || "WorkFlow Pro licentie",
    lines: operationalLines.length ? operationalLines : [{ type: "manual", description: payload.line || "WorkFlow Pro licentie", amount: gross }],
    gross,
    discountPct,
    net,
    status: "draft",
    peppolStatus: tenant.invoiceProfile?.peppolId ? "ready" : "missing_peppol",
    enterpriseContract: tenant.plan === "enterprise",
    source: operationalLines.length ? "workorders" : "manual"
  };
  const next = store.updateTenant(tenant.id, {
    billingOps: {
      ...billingOps,
      invoiceHistory: [...(billingOps.invoiceHistory || []), invoice]
    }
  });
  for (const line of operationalLines) {
    store.update("workorders", line.workorderId, {
      billableStatus: "invoiced",
      invoiceId: invoice.id,
      invoicedAt: new Date().toISOString(),
      invoicedBy: actor.email
    });
  }
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "invoice_created", area: "billing", detail: invoice.id });
  return { tenant: next, invoice };
}

function peppolResponse(tenant, invoice, payload = {}) {
  const provider = config.peppol.provider || "mock";
  if (!tenant.invoiceProfile?.peppolId && !payload.peppolId) {
    return {
      ok: false,
      provider,
      status: "failed",
      errorCode: "missing_peppol_id",
      message: "Peppol ID ontbreekt op het factuurprofiel"
    };
  }
  if (payload.forceError) {
    return {
      ok: false,
      provider,
      status: "failed",
      errorCode: payload.forceError,
      message: payload.message || "Peppol provider fout"
    };
  }
  return {
    ok: true,
    provider,
    status: "sent",
    providerReference: `peppol_${provider}_${invoice.id}_${Date.now()}`,
    message: provider === "mock" ? "Mock provider accepted" : "Provider accepted"
  };
}

function sendPeppol(store, tenant, invoiceId, actor, payload = {}) {
  const billingOps = tenant.billingOps || {};
  const invoice = (billingOps.invoiceHistory || []).find(inv => inv.id === invoiceId);
  if (!invoice) {
    const error = new Error("Factuur niet gevonden");
    error.status = 404;
    throw error;
  }
  const response = peppolResponse(tenant, invoice, payload);
  const event = {
    id: `peppol_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    invoiceId,
    at: new Date().toISOString(),
    by: actor.email,
    ...response
  };
  const invoices = (billingOps.invoiceHistory || []).map(inv => (
    inv.id === invoiceId
      ? {
        ...inv,
        status: response.ok ? "sent" : inv.status,
        peppolStatus: response.status,
        peppolProvider: response.provider,
        peppolReference: response.providerReference || inv.peppolReference || "",
        peppolError: response.ok ? "" : response.message,
        peppolErrorCode: response.ok ? "" : response.errorCode,
        sentAt: response.ok ? event.at : inv.sentAt || null,
        peppolAttempts: Number(inv.peppolAttempts || 0) + 1
      }
      : inv
  ));
  const next = store.updateTenant(tenant.id, {
    billingOps: {
      ...billingOps,
      invoiceHistory: invoices,
      peppolEvents: [...(billingOps.peppolEvents || []), event].slice(-100)
    }
  });
  store.audit({
    actor: actor.email,
    tenantId: tenant.id,
    action: response.ok ? "peppol_sent" : "peppol_failed",
    area: "billing",
    detail: response.ok ? invoiceId : `${invoiceId}:${response.errorCode}`
  });
  return { tenant: next, event };
}

function markPaymentFailed(store, tenant, payload, actor) {
  const billingOps = tenant.billingOps || {};
  const failedPayment = {
    id: `payfail_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    invoiceId: payload.invoiceId || "",
    reason: payload.reason || "Stripe payment failed",
    status: "open",
    dunningStage: 1,
    nextActionAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    events: [{
      at: new Date().toISOString(),
      type: "payment_failed",
      by: actor.email,
      note: payload.reason || "Stripe payment failed"
    }]
  };
  const next = store.updateTenant(tenant.id, {
    billingStatus: "past_due",
    billingOps: {
      ...billingOps,
      failedPayments: [...(billingOps.failedPayments || []), failedPayment]
    }
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "payment_failed", area: "billing", detail: failedPayment.reason });
  return { tenant: next, failedPayment };
}

function markInvoicePaid(store, tenant, invoiceId, actor) {
  const billingOps = tenant.billingOps || {};
  const invoices = (billingOps.invoiceHistory || []).map(invoice => (
    invoice.id === invoiceId ? { ...invoice, status: "paid", paidAt: new Date().toISOString() } : invoice
  ));
  const failedPayments = (billingOps.failedPayments || []).map(payment => (
    payment.invoiceId === invoiceId && payment.status !== "resolved"
      ? { ...payment, status: "resolved", resolvedAt: new Date().toISOString(), resolvedBy: actor.email }
      : payment
  ));
  const next = store.updateTenant(tenant.id, {
    billingStatus: "active",
    billingOps: {
      ...billingOps,
      invoiceHistory: invoices,
      failedPayments
    }
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "invoice_paid", area: "billing", detail: invoiceId || "stripe" });
  return next;
}

function tenantFromStripeObject(store, object) {
  const tenantId = object?.metadata?.tenantId || object?.metadata?.tenant_id || object?.client_reference_id || "";
  return store.data.tenants.find(row => row.id === tenantId) || null;
}

function stripeEventId(event) {
  return event.id || `${event.type || "stripe_event"}_${event.data?.object?.id || Date.now()}`;
}

function recordStripeEvent(store, tenant, event, status, action) {
  const billingOps = tenant.billingOps || {};
  const row = {
    id: stripeEventId(event),
    type: event.type || "unknown",
    status,
    action,
    at: new Date().toISOString()
  };
  return store.updateTenant(tenant.id, {
    billingOps: {
      ...billingOps,
      stripeEvents: [row, ...(billingOps.stripeEvents || []).filter(item => item.id !== row.id)].slice(0, 100)
    }
  });
}

function processStripeWebhook(store, event) {
  const type = event.type || "";
  const object = event.data?.object || {};
  const tenant = tenantFromStripeObject(store, object);
  if (!tenant) {
    const error = new Error("Stripe webhook mist geldige tenant metadata");
    error.status = 400;
    throw error;
  }
  const eventId = stripeEventId(event);
  const seen = (tenant.billingOps?.stripeEvents || []).find(row => row.id === eventId && row.status === "processed");
  if (seen) {
    store.audit({ actor: SYSTEM_ACTOR.email, tenantId: tenant.id, action: "stripe_webhook_duplicate", area: "billing", detail: eventId });
    return { handled: true, duplicate: true, action: seen.action, eventId };
  }

  if (type === "setup_intent.succeeded") {
    const paymentMethodRef = object.payment_method || object.metadata?.paymentMethodRef || `pm_webhook_${Date.now()}`;
    const next = attachPaymentMethod(store, tenant, paymentMethodRef, SYSTEM_ACTOR);
    const recorded = recordStripeEvent(store, next, event, "processed", "payment_method_attached");
    return {
      handled: true,
      action: "payment_method_attached",
      eventId,
      tenant: recorded
    };
  }

  if (type === "invoice.payment_failed" || type === "payment_intent.payment_failed") {
    const result = markPaymentFailed(store, tenant, {
      invoiceId: object.metadata?.invoiceId || object.number || object.id || "",
      reason: object.last_payment_error?.message || object.failure_message || "Stripe payment failed"
    }, SYSTEM_ACTOR);
    result.tenant = recordStripeEvent(store, result.tenant, event, "processed", "payment_failed");
    return {
      handled: true,
      action: "payment_failed",
      eventId,
      result
    };
  }

  if (type === "invoice.payment_succeeded" || type === "payment_intent.succeeded") {
    const next = markInvoicePaid(store, tenant, object.metadata?.invoiceId || object.number || object.id || "", SYSTEM_ACTOR);
    const recorded = recordStripeEvent(store, next, event, "processed", "invoice_paid");
    return { handled: true, action: "invoice_paid", eventId, tenant: recorded };
  }

  recordStripeEvent(store, tenant, event, "ignored", "ignored");
  store.audit({ actor: SYSTEM_ACTOR.email, tenantId: tenant.id, action: "stripe_webhook_ignored", area: "billing", detail: type });
  return { handled: false, action: "ignored", eventId, type };
}

function updateFailedPayment(store, tenant, failedPaymentId, updater) {
  const billingOps = tenant.billingOps || {};
  const failedPayments = billingOps.failedPayments || [];
  const exists = failedPayments.some(payment => payment.id === failedPaymentId);
  if (!exists) {
    const error = new Error("Failed payment niet gevonden");
    error.status = 404;
    throw error;
  }
  const nextFailedPayments = failedPayments.map(payment => (payment.id === failedPaymentId ? updater(payment) : payment));
  const next = store.updateTenant(tenant.id, {
    billingOps: {
      ...billingOps,
      failedPayments: nextFailedPayments
    }
  });
  return {
    tenant: next,
    failedPayment: (next.billingOps.failedPayments || []).find(payment => payment.id === failedPaymentId)
  };
}

function advanceDunning(store, tenant, failedPaymentId, payload, actor) {
  const action = payload.action || "reminder";
  const allowed = ["reminder", "retry", "resolve"];
  if (!allowed.includes(action)) {
    const error = new Error("Onbekende dunningactie");
    error.status = 400;
    throw error;
  }
  const result = updateFailedPayment(store, tenant, failedPaymentId, payment => {
    const currentStage = Number(payment.dunningStage || 1);
    const event = {
      at: new Date().toISOString(),
      type: action,
      by: actor.email,
      note: payload.note || ""
    };
    if (action === "resolve") {
      return {
        ...payment,
        status: "resolved",
        resolvedAt: event.at,
        resolvedBy: actor.email,
        events: [...(payment.events || []), event]
      };
    }
    return {
      ...payment,
      status: "open",
      dunningStage: Math.min(currentStage + 1, 4),
      nextActionAt: new Date(Date.now() + (action === "retry" ? 2 : 5) * 86400000).toISOString(),
      events: [...(payment.events || []), event]
    };
  });
  const stillOpen = (result.tenant.billingOps?.failedPayments || []).some(payment => payment.status === "open");
  if (!stillOpen && tenant.billingStatus === "past_due") {
    result.tenant = store.updateTenant(tenant.id, { billingStatus: "active" });
  }
  store.audit({ actor: actor.email, tenantId: tenant.id, action: `dunning_${action}`, area: "billing", detail: failedPaymentId });
  return result;
}

function acceptDpa(store, tenant, payload, actor) {
  const compliance = tenant.compliance || {};
  const next = store.updateTenant(tenant.id, {
    compliance: {
      ...compliance,
      dpaAcceptedAt: new Date().toISOString(),
      dpaAcceptedBy: actor.email,
      dpaVersion: payload.version || "2026-04",
      dpaCompanyName: payload.companyName || tenant.name
    }
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "dpa_accepted", area: "compliance", detail: payload.version || "2026-04" });
  return next;
}

function createGdprRequest(store, tenant, payload, actor) {
  const compliance = tenant.compliance || {};
  const request = {
    id: `gdpr_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type: payload.type === "delete" ? "delete" : "export",
    subjectEmail: payload.subjectEmail || "",
    status: "received",
    requestedBy: actor.email,
    requestedAt: new Date().toISOString()
  };
  const next = store.updateTenant(tenant.id, {
    compliance: {
      ...compliance,
      gdprRequests: [...(compliance.gdprRequests || []), request]
    }
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: `gdpr_${request.type}_requested`, area: "compliance", detail: request.subjectEmail });
  return { tenant: next, request };
}

function subjectMatchesEmail(row, email) {
  return String(row.email || row.subjectEmail || "").toLowerCase() === email;
}

function buildGdprExport(store, tenantId, subjectEmail) {
  const email = String(subjectEmail || "").toLowerCase();
  const scoped = store.tenantScoped(tenantId);
  const users = scoped.users.filter(row => subjectMatchesEmail(row, email));
  const userIds = new Set(users.map(row => row.id));
  return {
    subjectEmail,
    generatedAt: new Date().toISOString(),
    counts: {
      users: users.length,
      planning: scoped.shifts.filter(row => userIds.has(row.userId)).length,
      workorders: scoped.workorders.filter(row => userIds.has(row.userId)).length,
      clockings: scoped.clocks.filter(row => userIds.has(row.userId)).length,
      expenses: scoped.expenses.filter(row => userIds.has(row.userId)).length,
      messages: scoped.messages.filter(row => row.to === subjectEmail || row.from === subjectEmail || row.toUserEmail === subjectEmail || row.fromUserEmail === subjectEmail).length,
      notifications: scoped.notifications.filter(row => row.subjectEmail === subjectEmail || row.audience === subjectEmail).length
    },
    data: {
      users: users.map(({ passwordHash, mfaSecret, recoveryCodes, ...safe }) => safe),
      planning: scoped.shifts.filter(row => userIds.has(row.userId)),
      workorders: scoped.workorders.filter(row => userIds.has(row.userId)),
      clockings: scoped.clocks.filter(row => userIds.has(row.userId)),
      expenses: scoped.expenses.filter(row => userIds.has(row.userId))
    }
  };
}

function anonymizeSubject(store, tenantId, subjectEmail, actor) {
  const email = String(subjectEmail || "").toLowerCase();
  const scoped = store.tenantScoped(tenantId);
  const users = scoped.users.filter(row => subjectMatchesEmail(row, email));
  for (const user of users) {
    store.update("users", user.id, {
      name: "Geanonimiseerde gebruiker",
      email: `deleted-${user.id}@workflowpro.local`,
      phone: "",
      jobTitle: "",
      active: false,
      anonymizedAt: new Date().toISOString(),
      anonymizedBy: actor.email
    });
  }
  return { anonymizedUsers: users.length };
}

function updateGdprRequest(store, tenant, requestId, patch) {
  const compliance = tenant.compliance || {};
  const requests = compliance.gdprRequests || [];
  const exists = requests.some(request => request.id === requestId);
  if (!exists) {
    const error = new Error("GDPR verzoek niet gevonden");
    error.status = 404;
    throw error;
  }
  const gdprRequests = requests.map(request => (request.id === requestId ? { ...request, ...patch } : request));
  return store.updateTenant(tenant.id, {
    compliance: {
      ...compliance,
      gdprRequests
    }
  });
}

function processGdprRequest(store, tenant, requestId, actor) {
  const request = (tenant.compliance?.gdprRequests || []).find(row => row.id === requestId);
  if (!request) {
    const error = new Error("GDPR verzoek niet gevonden");
    error.status = 404;
    throw error;
  }
  if (request.status === "completed") return { tenant, request };

  const exportPayload = buildGdprExport(store, tenant.id, request.subjectEmail);
  const result = request.type === "delete"
    ? { ...anonymizeSubject(store, tenant.id, request.subjectEmail, actor), exportCountsBeforeDelete: exportPayload.counts }
    : { export: exportPayload };

  const next = updateGdprRequest(store, tenant, request.id, {
    status: "completed",
    processedAt: new Date().toISOString(),
    processedBy: actor.email,
    result
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: `gdpr_${request.type}_completed`, area: "compliance", detail: request.subjectEmail });
  return {
    tenant: next,
    request: (next.compliance?.gdprRequests || []).find(row => row.id === request.id)
  };
}

module.exports = {
  createSetupIntent,
  billingQuote,
  planCatalog,
  selectPlan,
  attachPaymentMethod,
  createInvoice,
  sendPeppol,
  billingSummary,
  transitionContract,
  markPaymentFailed,
  advanceDunning,
  acceptDpa,
  createGdprRequest,
  processGdprRequest,
  processStripeWebhook
};
