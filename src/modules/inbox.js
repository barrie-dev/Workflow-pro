"use strict";
/**
 * E-mail-intake: klantvragen in het platform.
 *
 * Elke organisatie krijgt een uniek intake-adres (<token>@<intake-domein>).
 * De klant stuurt (of het kantoor stuurt door) naar dat adres; de mailprovider
 * (Mailgun/Postmark/SendGrid inbound) POST de mail naar
 * /api/webhooks/inbound-mail. Wij normaliseren provider-agnostisch, zoeken de
 * tenant via het ontvangstadres en maken een klantvraag aan, automatisch
 * gekoppeld aan de klant via het afzendadres.
 *
 * Zo komt al het klantcontact op één plek binnen (Inbox in het admin-portaal);
 * telefonische vragen kunnen handmatig worden toegevoegd.
 */

const crypto = require("crypto");

const INQUIRY_STATUSES = ["nieuw", "in_behandeling", "beantwoord", "gesloten"];

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  throw e;
}

function newIntakeToken() {
  return crypto.randomBytes(6).toString("hex"); // 12 tekens, lowercase hex
}

/** Zorg dat de tenant een intake-token heeft; persisteert bij eerste gebruik. */
function ensureIntake(store, tenant) {
  if (!tenant.intake || !tenant.intake.token) {
    const intake = { token: newIntakeToken(), enabled: true, createdAt: new Date().toISOString() };
    store.updateTenant(tenant.id, { intake });
    tenant.intake = intake;
  }
  return tenant.intake;
}

function intakeAddress(tenant, config) {
  const domain = (config && config.inboundMail && config.inboundMail.domain) || "in.monargo.com";
  return tenant.intake && tenant.intake.token ? `${tenant.intake.token}@${domain}` : null;
}

// "Jan Peeters <jan@bouw.be>" → { name: "Jan Peeters", email: "jan@bouw.be" }
function splitAddress(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: s.toLowerCase() };
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Provider-agnostische normalisatie van een inbound-mail-payload.
 * Ondersteunt de veldnamen van Mailgun (from/recipient/subject/body-plain),
 * Postmark (From/ToFull/Subject/TextBody) en SendGrid (from/to/subject/text).
 */
function parseInboundPayload(body) {
  const b = body || {};
  const rawFrom = b.from || b.From || b.sender || b.Sender || (b.envelope && b.envelope.from) || "";
  const from = splitAddress(rawFrom);
  if (!from.email || !from.email.includes("@")) badRequest("Inbound mail mist een geldig afzendadres");

  let rawTo = b.recipient || b.to || b.To || "";
  if (!rawTo && Array.isArray(b.ToFull) && b.ToFull[0]) rawTo = b.ToFull[0].Email || "";
  if (!rawTo && b.envelope && Array.isArray(b.envelope.to)) rawTo = b.envelope.to[0] || "";
  const to = splitAddress(String(rawTo).split(",")[0]);
  if (!to.email || !to.email.includes("@")) badRequest("Inbound mail mist een ontvangstadres");

  const subject = String(b.subject || b.Subject || "").trim() || "(geen onderwerp)";
  let text = String(b.text || b["body-plain"] || b.TextBody || b.plain || "").trim();
  if (!text) text = stripHtml(b.html || b["body-html"] || b.HtmlBody || "");
  const messageId = String(b["Message-Id"] || b["message-id"] || b.MessageID || b.messageId || "").trim() || null;

  return {
    fromEmail: from.email,
    fromName: from.name,
    to: to.email,
    subject,
    text,
    messageId,
  };
}

/** Vind de tenant bij een intake-ontvangstadres (lokaal deel = token). */
function resolveIntakeTenant(store, toAddress) {
  const local = String(toAddress || "").split("@")[0].toLowerCase().trim();
  if (!local) return null;
  return (store.data.tenants || []).find(t =>
    t.intake && t.intake.token === local && t.intake.enabled !== false
  ) || null;
}

/**
 * Maak een klantvraag aan uit een (genormaliseerde) mail.
 * - koppelt de klant via het afzendadres (case-insensitief)
 * - idempotent op provider-Message-Id (per tenant)
 */
function createInquiry(store, tenant, mail, source = "email") {
  if (mail.messageId) {
    const dup = store.list("inquiries", tenant.id).find(q => q.messageId === mail.messageId);
    if (dup) return { inquiry: dup, duplicate: true };
  }
  const customer = (store.list("customers", tenant.id) || []).find(c =>
    String(c.email || "").toLowerCase() === mail.fromEmail
  ) || null;
  const now = new Date().toISOString();
  const inquiry = store.insert("inquiries", {
    id: `inq_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    tenantId: tenant.id,
    source,
    fromEmail: mail.fromEmail,
    fromName: mail.fromName || "",
    subject: mail.subject,
    text: mail.text || "",
    messageId: mail.messageId || null,
    customerId: customer ? customer.id : null,
    customerName: customer ? customer.name : null,
    status: "nieuw",
    receivedAt: now,
    createdAt: now,
  });
  store.audit({ actor: "inbound-mail", tenantId: tenant.id, action: "inquiry_received", area: "inbox", detail: `${mail.fromEmail} · ${mail.subject}` });
  return { inquiry, duplicate: false };
}

module.exports = {
  INQUIRY_STATUSES,
  newIntakeToken,
  ensureIntake,
  intakeAddress,
  splitAddress,
  stripHtml,
  parseInboundPayload,
  resolveIntakeTenant,
  createInquiry,
};
