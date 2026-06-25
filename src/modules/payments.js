"use strict";
/**
 * Klantfactuur-betalingen.
 *
 * - Echte Stripe-sleutel in de console → maakt een Stripe Checkout Session
 *   (betaallink) aan; betaling wordt bevestigd via de Stripe-webhook.
 * - Geen/dummy sleutel → mock-betaallink (/betaal/:token) die de factuur
 *   lokaal als betaald markeert. Zo werkt de volledige flow ook zonder account.
 */
const { httpsRequest } = require("../lib/http-client");
const crypto = require("crypto");
const { config } = require("../lib/config");
const { loadPlatformConfig } = require("./platform-config");

function isRealStripeKey(k) {
  return !!k && /^sk_(live|test)_/.test(k) && !/DUMMY|replace/i.test(k);
}

// Form-encode (Stripe verwacht application/x-www-form-urlencoded)
function formEncode(obj, prefix, pairs = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === "object") formEncode(v, key, pairs);
    else pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return pairs;
}

async function stripePost(secretKey, path, payload) {
  const data = formEncode(payload).join("&");
  const res = await httpsRequest({
    hostname: "api.stripe.com", path, method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: data,
  });
  const json = res.json || {};
  if (res.statusCode >= 200 && res.statusCode < 300) return json;
  throw new Error(json.error?.message || `Stripe ${res.statusCode}`);
}

/**
 * Maak (of hergebruik) een betaallink voor een factuur.
 * @returns {Promise<{url:string, provider:"stripe"|"mock"}>}
 */
async function createPaymentLink(store, tenant, invoice) {
  if (invoice.status === "paid") throw Object.assign(new Error("Factuur is al betaald"), { status: 400 });
  const cfg = loadPlatformConfig(store);
  const key = cfg.stripe && cfg.stripe.secretKey;
  const base = config.appUrl.replace(/\/+$/, "");

  if (isRealStripeKey(key)) {
    const session = await stripePost(key, "/v1/checkout/sessions", {
      mode: "payment",
      success_url: `${base}/?betaald=${invoice.id}`,
      cancel_url: `${base}/?geannuleerd=${invoice.id}`,
      client_reference_id: invoice.id,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: Math.round(Number(invoice.total || 0) * 100),
          product_data: { name: `Factuur ${invoice.number || invoice.id}` },
        },
      }],
      metadata: { wfp_invoice_id: invoice.id, wfp_tenant_id: tenant.id },
    });
    store.update("invoices", invoice.id, {
      paymentProvider: "stripe", paymentRef: session.id,
      paymentLinkUrl: session.url, updatedAt: new Date().toISOString(),
    });
    return { url: session.url, provider: "stripe" };
  }

  // Mock-fallback
  const token = invoice.payToken || crypto.randomBytes(16).toString("hex");
  store.update("invoices", invoice.id, {
    paymentProvider: "mock", payToken: token,
    paymentLinkUrl: `${base}/betaal/${token}`, updatedAt: new Date().toISOString(),
  });
  return { url: `${base}/betaal/${token}`, provider: "mock" };
}

/** Markeer een klantfactuur als betaald (gedeeld door mock-pay en webhook). */
function markInvoicePaidById(store, invoiceId, source = "betaling") {
  const inv = store.get("invoices", invoiceId);
  if (!inv) return null;
  if (inv.status === "paid") return inv;
  const updated = store.update("invoices", invoiceId, {
    status: "paid", paidAt: new Date().toISOString(), paymentSource: source, updatedAt: new Date().toISOString(),
  });
  store.audit({ actor: source, tenantId: inv.tenantId, action: "invoice_paid", area: "facturen", detail: `${inv.number} via ${source}` });
  return updated;
}

module.exports = { createPaymentLink, markInvoicePaidById, isRealStripeKey, stripePost, formEncode };
