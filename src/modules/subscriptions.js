"use strict";
/**
 * Stripe-abonnementen (P0): echte terugkerende facturatie.
 *
 * - Echte Stripe-sleutel (console of env) → Checkout Session (mode=subscription)
 *   om een abonnement te starten/betalen, en een Billing Portal-sessie voor
 *   self-service upgrade/downgrade/opzeggen/betaalmethode (proration regelt Stripe).
 * - Geen/dummy sleutel → mock-URL's zodat de hele flow lokaal blijft werken.
 *
 * Abonnementsprijs = bundelprijs (baseMonthly, per gebruiker) × actieve gebruikers,
 * via inline price_data (recurring/maand) — geen vooraf aangemaakte Stripe Prices nodig.
 * Status-sync gebeurt via de webhook met de pure mapper applySubscriptionEvent().
 */
const { config } = require("../lib/config");
const { loadPlatformConfig } = require("./platform-config");
const { getBundle } = require("./bundles");
const { billingQuote } = require("./billing");
const { stripePost, isRealStripeKey } = require("./payments");

function stripeKey(store) {
  const cfg = loadPlatformConfig(store);
  return (cfg.stripe && cfg.stripe.secretKey) || config.stripe.secretKey || "";
}
function baseUrl() { return config.appUrl.replace(/\/+$/, ""); }

// Aantal actieve gebruikers (= betaalde seats) van een tenant.
function activeSeats(store, tenant) {
  return (store.data.users || []).filter(u => u.tenantId === tenant.id && u.active !== false).length || 1;
}

// Maandbedrag (excl. btw, in euro) voor een plan, volgens het echte prijsmodel
// (basis + extra seats) uit billingQuote. null = op aanvraag / geen vaste prijs.
function monthlyAmount(store, tenant, planKey) {
  const q = billingQuote(store, { id: tenant.id, plan: planKey });
  if (q.annualSubtotal == null) return null;
  return +(q.annualSubtotal / 12).toFixed(2);
}

// Maak/hergebruik een Stripe Customer voor de tenant.
async function ensureStripeCustomer(store, tenant, key) {
  if (tenant.stripeCustomerId) return tenant.stripeCustomerId;
  const customer = await stripePost(key, "/v1/customers", {
    name: tenant.name || tenant.id,
    email: tenant.billingEmail || "",
    metadata: { wfp_tenant_id: tenant.id },
  });
  store.updateTenant(tenant.id, { stripeCustomerId: customer.id });
  return customer.id;
}

/**
 * Start een abonnement via Stripe Checkout (mode=subscription).
 * @returns {Promise<{url:string, provider:"stripe"|"mock"}>}
 */
async function createSubscriptionCheckout(store, tenant, planKey, actor) {
  const bundle = getBundle(store, planKey);
  if (!bundle || bundle.active === false) throw Object.assign(new Error("Onbekend of inactief pakket"), { status: 400 });
  if (bundle.custom) throw Object.assign(new Error("Dit pakket is op aanvraag — neem contact op."), { status: 400 });
  const monthly = monthlyAmount(store, tenant, planKey);
  if (monthly == null) throw Object.assign(new Error("Dit pakket verloopt via een offerte op maat — neem contact op."), { status: 400 });
  const key = stripeKey(store);

  if (isRealStripeKey(key)) {
    const seats = activeSeats(store, tenant);
    const customerId = await ensureStripeCustomer(store, tenant, key);
    const session = await stripePost(key, "/v1/checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      success_url: `${baseUrl()}/?abonnement=actief`,
      cancel_url: `${baseUrl()}/?abonnement=geannuleerd`,
      client_reference_id: tenant.id,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: Math.round(monthly * 100),
          recurring: { interval: "month" },
          product_data: { name: `WorkFlow Pro — ${bundle.label} (incl. ${activeSeats(store, tenant)} gebruikers)` },
        },
      }],
      subscription_data: { metadata: { wfp_tenant_id: tenant.id, wfp_plan: planKey } },
      metadata: { wfp_tenant_id: tenant.id, wfp_plan: planKey },
    });
    store.updateTenant(tenant.id, { billingProvider: "stripe", pendingPlan: planKey });
    store.audit({ actor: actor.email, tenantId: tenant.id, action: "subscription_checkout_created", area: "billing", detail: `${planKey} × ${seats}` });
    return { url: session.url, provider: "stripe" };
  }

  // Mock-fallback: markeer het plan meteen als gekozen + actief (geen echte betaling).
  store.updateTenant(tenant.id, { plan: planKey, status: "active", billingProvider: "mock" });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "subscription_checkout_mock", area: "billing", detail: planKey });
  return { url: `${baseUrl()}/?abonnement=mock&plan=${encodeURIComponent(planKey)}`, provider: "mock" };
}

/**
 * Billing Portal-sessie voor self-service beheer (upgrade/downgrade/opzeggen/
 * betaalmethode). Stripe regelt proration. Vereist een bestaande Customer.
 * @returns {Promise<{url:string, provider:"stripe"|"mock"}>}
 */
async function createBillingPortalSession(store, tenant, actor) {
  const key = stripeKey(store);
  if (isRealStripeKey(key)) {
    const customerId = await ensureStripeCustomer(store, tenant, key);
    const session = await stripePost(key, "/v1/billing_portal/sessions", {
      customer: customerId,
      return_url: `${baseUrl()}/?billing=terug`,
    });
    store.audit({ actor: actor.email, tenantId: tenant.id, action: "billing_portal_opened", area: "billing" });
    return { url: session.url, provider: "stripe" };
  }
  return { url: `${baseUrl()}/?billing=mock`, provider: "mock" };
}

// Pure mapper: Stripe-subscription-status → tenant-patch. Gebruikt door de webhook.
// Gooit niet; retourneert null als er niets te doen valt.
const STATUS_MAP = {
  active: "active", trialing: "trial", past_due: "past_due",
  unpaid: "past_due", canceled: "canceled", incomplete_expired: "canceled",
};
function applySubscriptionEvent(tenant, event) {
  const obj = (event && event.data && event.data.object) || {};
  const type = event && event.type;
  if (!type || !type.startsWith("customer.subscription")) return null;
  const patch = { stripeSubscriptionId: obj.id || tenant.stripeSubscriptionId || null };
  if (type === "customer.subscription.deleted") {
    patch.status = "canceled";
  } else {
    const mapped = STATUS_MAP[obj.status];
    if (mapped) patch.status = mapped;
  }
  const plan = obj.metadata && obj.metadata.wfp_plan;
  if (plan) patch.plan = plan;
  if (patch.status === "active") patch.pendingPlan = null;
  return patch;
}

module.exports = {
  createSubscriptionCheckout, createBillingPortalSession, applySubscriptionEvent,
  ensureStripeCustomer, activeSeats, monthlyAmount, STATUS_MAP,
};
