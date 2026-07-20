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
const { emitDomainEvent } = require("../platform/events");
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
  // h45: een online betaling is óók een betaling in het betalingsregister,
  // volledig toegewezen aan deze factuur voor het nog OPENSTAANDE deel. Zo
  // vertellen het register en de factuurstatus altijd hetzelfde verhaal, ook
  // als er eerder al een deelbetaling handmatig was toegewezen.
  try {
    const ledger = require("../platform/payments");
    const tenant = { id: inv.tenantId };
    const actor = { email: source };
    const open = ledger.invoicePaymentState(store, inv.tenantId, inv).openAmount;
    if (open > 0) {
      const payment = ledger.registerPayment(store, tenant, actor, {
        amount: open, method: "online", customerId: inv.customerId || undefined,
        reference: inv.structuredComm || inv.number, note: `Online betaling via ${source}`,
      });
      ledger.allocatePayment(store, tenant, actor, payment.id, [{ invoiceId: inv.id, amount: open }]);
    }
  } catch (e) {
    // Het register mag een geslaagde betaling nooit blokkeren; de fallback
    // hieronder zet de factuur hoe dan ook op betaald (gedrag van vóór h45).
    store.audit({ actor: source, tenantId: inv.tenantId, action: "payment_ledger_failed", area: "facturen", detail: `${inv.number}: ${e.message}` });
  }
  const updated = store.update("invoices", invoiceId, {
    status: "paid", paidAt: inv.paidAt || new Date().toISOString(), paymentSource: source, updatedAt: new Date().toISOString(),
  });
  store.audit({ actor: source, tenantId: inv.tenantId, action: "invoice_paid", area: "facturen", detail: `${inv.number} via ${source}` });
  emitDomainEvent(store, { tenantId: inv.tenantId, eventType: "invoice.paid", aggregateType: "invoice", aggregateId: inv.id, actor: source, data: { source } });
  return updated;
}

module.exports = { createPaymentLink, markInvoicePaidById, isRealStripeKey, stripePost, formEncode };
