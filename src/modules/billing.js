const { config } = require("../lib/config");
const { listBundles, getBundle } = require("./bundles");
const { moduleByKey } = require("./catalog");
const { peppolTransportReadiness } = require("./peppol-invoice");

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

// Features van een bundel = de labels van de inbegrepen modules (DB-bundels),
// met val-terug op de statische PLAN_PACKAGES-featurelijst.
function bundleFeatures(bundle, fallbackKey) {
  if (bundle && Array.isArray(bundle.modules) && bundle.modules.length) {
    return bundle.modules.map(k => (moduleByKey(k) || {}).label).filter(Boolean);
  }
  return (PLAN_PACKAGES[fallbackKey] || {}).features || [];
}

// Vaste prijs voor een bundel-key (enkel de standaardbundels hebben een prijs).
// Een bundel zónder bekende prijs is "op aanvraag" en niet zelf te kiezen.
// Superadmin-bewerkbare prijs-overrides (uit platform-config), overschrijven de
// PLAN_PACKAGES-defaults per plan-key (baseAnnual/seatAnnual/includedSeats).
let PRICE_OVERRIDES = {};
function setPlanPriceOverrides(overrides) { PRICE_OVERRIDES = (overrides && typeof overrides === "object") ? overrides : {}; }
function effectivePackage(key) {
  const k = String(key || "").toLowerCase();
  const base = PLAN_PACKAGES[k];
  if (!base) return null;
  const ov = PRICE_OVERRIDES[k] || {};
  return {
    ...base,
    baseAnnual: ov.baseAnnual != null ? Number(ov.baseAnnual) : base.baseAnnual,
    seatAnnual: ov.seatAnnual != null ? Number(ov.seatAnnual) : base.seatAnnual,
    includedSeats: ov.includedSeats != null ? Number(ov.includedSeats) : base.includedSeats,
  };
}
// Effectieve prijzen + defaults voor de superadmin-editor.
function planPricing() {
  return Object.keys(PLAN_PACKAGES).map(k => {
    const eff = effectivePackage(k);
    return { key: k, label: PLAN_PACKAGES[k].label, baseAnnual: eff.baseAnnual, seatAnnual: eff.seatAnnual, includedSeats: eff.includedSeats,
      defaults: { baseAnnual: PLAN_PACKAGES[k].baseAnnual, seatAnnual: PLAN_PACKAGES[k].seatAnnual, includedSeats: PLAN_PACKAGES[k].includedSeats } };
  });
}
function pricingFor(key) {
  const p = effectivePackage(key);
  return p && p.baseAnnual > 0 ? p : null;
}

// CTO-09 · DE canonieke MRR-berekening: één bron voor superadmin-billing én
// resellercommissie. Prijs = de effectieve (superadmin-bewerkbare) bundelprijs:
// (baseAnnual + seatAnnual × seats boven includedSeats) / 12. Enkel actieve
// tenants tellen mee; een onbekend plan valt terug op 'business'. Vaste
// prijsconstanten buiten deze module zijn verboden (CTO-review 2026-07-22).
function tenantMrr(store, tenant) {
  if (!tenant || tenant.status !== "active") return 0;
  const pkg = effectivePackage(tenant.plan) || effectivePackage("business");
  if (!pkg || !(pkg.baseAnnual > 0)) return 0;
  const seats = store.list("users", tenant.id).length;
  const extraSeats = Math.max(0, seats - (pkg.includedSeats || 0));
  const annual = pkg.baseAnnual + (pkg.seatAnnual || 0) * extraSeats;
  return Math.round((annual / 12) * 100) / 100;
}

// Publieke plan-catalogus voor de klant-zelfbediening (prijzen server-bepaald).
// Leest de samenstelbare bundels uit de DB; prijzen uit PLAN_PACKAGES per key.
// Bundels zonder bekende prijs (bv. door superadmin nieuw aangemaakt) worden als
// 'custom' (op aanvraag) gemarkeerd zodat ze niet voor €0 kiesbaar zijn.
function planCatalog(store) {
  const bundles = store ? listBundles(store).filter(b => b.active !== false) : [];
  if (!bundles.length) {
    return Object.entries(PLAN_PACKAGES).map(([key, p], i) => {
      const priced = p.baseAnnual > 0;
      return {
        key, label: p.label, order: i + 1, popular: key === "business",
        baseAnnual: priced ? p.baseAnnual : null,
        baseMonthly: priced ? Math.round(p.baseAnnual / 12) : null,
        seatAnnual: priced ? p.seatAnnual : null,
        includedSeats: priced ? p.includedSeats : null,
        features: p.features, custom: !priced,
      };
    });
  }
  return bundles.map(b => {
    const price = pricingFor(b.key);
    const priced = !!price;
    return {
      key: b.key,
      label: b.label,
      description: b.description || "",
      order: b.order ?? 99,
      popular: !!b.popular,
      baseAnnual: priced ? price.baseAnnual : null,
      baseMonthly: priced ? Math.round(price.baseAnnual / 12) : null,
      seatAnnual: priced ? price.seatAnnual : null,
      includedSeats: priced ? price.includedSeats : null,
      features: bundleFeatures(b, b.key),
      modules: b.modules,
      custom: !!b.custom || !priced, // geen prijs → op aanvraag
    };
  }).sort((a, b) => (a.order - b.order));
}

// Klant kiest zelf een bundel. Custom/enterprise of prijsloze bundel = op aanvraag.
function selectPlan(store, tenant, planKey, actor) {
  const key = String(planKey || "").toLowerCase();
  const bundle = getBundle(store, key);
  if (!bundle && !PLAN_PACKAGES[key]) { const e = new Error("Onbekend plan"); e.status = 400; throw e; }
  const onRequest = (bundle && bundle.custom) || key === "enterprise" || !pricingFor(key);
  if (onRequest) { const e = new Error("Dit pakket verloopt via een offerte op maat · neem contact op."); e.status = 400; throw e; }
  const next = store.updateTenant(tenant.id, { plan: key });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "plan_selected", area: "billing", detail: key });
  return billingSummary(next);
}

function billableSeats(store, tenantId) {
  return store.list("users", tenantId).filter(user => user.active !== false && user.role !== "tenant_admin" && user.role !== "super_admin").length;
}

function billingQuote(store, tenant) {
  const planKey = String(tenant.plan || "business").toLowerCase();
  const price = pricingFor(planKey);
  const seats = billableSeats(store, tenant.id);
  // Geen bekende prijs (enterprise/custom/nieuwe bundel) → bedrag op aanvraag (null),
  // NIET stilletjes terugvallen op de business-prijs.
  const custom = !price;
  const includedSeats = price ? price.includedSeats : 0;
  const extraSeats = price ? Math.max(seats - includedSeats, 0) : 0;
  const annualSubtotal = custom ? null : price.baseAnnual + extraSeats * price.seatAnnual;
  const vatRate = 0.21;
  const annualVat = annualSubtotal == null ? null : +(annualSubtotal * vatRate).toFixed(2);
  const annualTotal = annualSubtotal == null ? null : +(annualSubtotal + annualVat).toFixed(2);
  const labelSource = PLAN_PACKAGES[planKey] || {};
  return {
    tenantId: tenant.id,
    planKey,
    planLabel: labelSource.label || tenant.plan || "-",
    seats,
    includedSeats,
    extraSeats,
    seatAnnual: price ? price.seatAnnual : null,
    baseAnnual: price ? price.baseAnnual : null,
    annualSubtotal,
    annualVat,
    annualTotal,
    currency: "EUR",
    vatRate,
    enterpriseCustom: custom,
    features: (labelSource.features) || []
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
    paymentMethod: paymentMethod || tenant.paymentMethod || null, // voor admin UI
    trialEndsAt: tenant.trialEndsAt || null,
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

function workorderLine(workorder, defaultHourlyRate = 0) {
  const explicit = workorder.billableAmount ?? workorder.amount ?? workorder.fixedPrice;
  const hours = Number(workorder.billableHours || workorder.hours || 0);
  const rate = Number(workorder.hourlyRate || defaultHourlyRate || 0);
  const amount = explicit != null ? Number(explicit) : hours * rate;
  if (!Number.isFinite(amount) || amount <= 0) {
    // Duidelijke, bruikbare melding i.p.v. een generieke fout: zeg WAT ontbreekt.
    const reason = explicit != null ? "het vaste bedrag is 0"
      : hours <= 0 ? "er zijn geen (geklokte of ingevulde) uren"
      : "er is geen uurtarief ingesteld (op de werkbon of als standaardtarief)";
    const error = new Error(`Werkbon "${workorder.title || workorder.id}" kan niet gefactureerd worden: ${reason}.`);
    error.status = 422;
    throw error;
  }
  return {
    type: "workorder",
    workorderId: workorder.id,
    description: workorder.title || `Werkbon ${workorder.id}`,
    quantity: explicit != null ? 1 : hours,
    unitPrice: explicit != null ? +amount.toFixed(2) : rate,
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
  const defaultRate = Number(tenant.defaultHourlyRate || (tenant.billingOps && tenant.billingOps.defaultHourlyRate) || 0);
  return rows.map(w => workorderLine(w, defaultRate));
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
    line: payload.line || "Monargo One licentie",
    lines: operationalLines.length ? operationalLines : [{ type: "manual", description: payload.line || "Monargo One licentie", amount: gross }],
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
  const readiness = peppolTransportReadiness({ peppol: config.peppol }, config.isProduction);
  const provider = readiness.provider || config.peppol.provider || "mock";
  if (!readiness.ok) {
    return {
      ok: false,
      provider,
      status: "failed",
      errorCode: readiness.errorCode,
      message: readiness.message
    };
  }
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
  tenantMrr,
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
  processStripeWebhook,
  setPlanPriceOverrides,
  planPricing
};
