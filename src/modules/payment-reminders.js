"use strict";
/**
 * Automatische betaalherinneringen voor vervallen klantfacturen.
 *
 * Opt-in per tenant (tenant.autoReminders.enabled) en gated op de
 * invoices/reminders-submodule. Beleid: eerste herinnering zodra de vervaldatum
 * verstreken is, daarna om de REMINDER_INTERVAL_DAYS, met een maximum van
 * MAX_REMINDERS per factuur. Elke verzending wordt op de factuur bijgehouden
 * (reminders[]) en geauditeerd — idempotent over herstarts heen.
 *
 * E-mail loopt via de mailer (dev/test loggen enkel; zie config.guards).
 */

const { sendMail, wrapHtml } = require("../lib/mailer");
const { isSubmoduleEnabled } = require("./entitlements");

const REMINDER_INTERVAL_DAYS = 7;
const MAX_REMINDERS = 3;

function daysAgoIso(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function fmtEur(n) {
  try { return new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" }).format(Number(n || 0)); }
  catch { return `€ ${n}`; }
}

// Bepaal of deze factuur nú een herinnering moet krijgen.
function reminderDue(invoice, today = new Date().toISOString().slice(0, 10)) {
  if (!invoice || invoice.paidAt) return false;
  if (!["open", "overdue"].includes(invoice.status)) return false;
  if (!invoice.dueDate || invoice.dueDate >= today) return false;
  const sent = Array.isArray(invoice.reminders) ? invoice.reminders : [];
  if (sent.length >= MAX_REMINDERS) return false;
  const last = sent[sent.length - 1];
  if (last && last.at > daysAgoIso(REMINDER_INTERVAL_DAYS)) return false;
  return true;
}

function reminderMail({ tenant, invoice, level, appUrl }) {
  const payUrl = invoice.payToken && appUrl ? `${String(appUrl).replace(/\/+$/, "")}/betaal/${invoice.payToken}` : null;
  const urgency = level >= 3 ? "Laatste herinnering" : level === 2 ? "Tweede herinnering" : "Betalingsherinnering";
  const subject = `${urgency}: factuur ${invoice.number} van ${tenant.name || "Monargo One"}`;
  const html = wrapHtml(subject, `
    <h2>${urgency}</h2>
    <p>Beste,</p>
    <p>Volgens onze administratie staat factuur <strong>${invoice.number}</strong> van
    ${fmtEur(invoice.total)} (vervaldatum ${invoice.dueDate}) nog open.</p>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Factuurnummer</span><span class="detail-value">${invoice.number}</span></div>
      <div class="detail-row"><span class="detail-label">Bedrag</span><span class="detail-value">${fmtEur(invoice.total)}</span></div>
      <div class="detail-row"><span class="detail-label">Vervaldatum</span><span class="detail-value">${invoice.dueDate}</span></div>
      ${invoice.structuredComm ? `<div class="detail-row"><span class="detail-label">Mededeling</span><span class="detail-value">${invoice.structuredComm}</span></div>` : ""}
    </div>
    ${payUrl ? `<a class="cta" href="${payUrl}">Betaal online</a>` : ""}
    <p style="margin-top:14px">Is de betaling al onderweg, dan mag u deze herinnering negeren.</p>
    <p>Met vriendelijke groeten,<br>${tenant.name || ""}</p>`);
  const text = `${urgency}\n\nFactuur ${invoice.number} van ${fmtEur(invoice.total)} (vervaldatum ${invoice.dueDate}) staat nog open.`
    + (invoice.structuredComm ? `\nGestructureerde mededeling: ${invoice.structuredComm}` : "")
    + (payUrl ? `\nBetaal online: ${payUrl}` : "");
  return { subject, html, text };
}

/**
 * Eén ronde over alle tenants; verstuurt wat verstuurd moet worden.
 * @returns {{ checked:number, sent:number, skipped:string[] }}
 */
async function runPaymentReminders(store, config, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  let checked = 0, sent = 0;
  const skipped = [];
  for (const tenant of store.data.tenants || []) {
    if (!tenant || tenant.id == null) continue;
    if (!(tenant.autoReminders && tenant.autoReminders.enabled)) continue;           // opt-in
    if (!isSubmoduleEnabled(store, tenant, "invoices", "reminders")) { skipped.push(`${tenant.id}:submodule`); continue; }
    const customersById = Object.fromEntries(store.list("customers", tenant.id).map(c => [c.id, c]));
    for (const inv of store.list("invoices", tenant.id)) {
      checked += 1;
      if (!reminderDue(inv, today)) continue;
      const customer = inv.customerId ? customersById[inv.customerId] : null;
      const to = (customer && customer.email) || inv.customerEmail || null;
      if (!to) { skipped.push(`${inv.number}:geen-email`); continue; }
      const level = (Array.isArray(inv.reminders) ? inv.reminders.length : 0) + 1;
      const mail = reminderMail({ tenant, invoice: inv, level, appUrl: config.appUrl });
      try {
        await sendMail({ to, ...mail });
        store.update("invoices", inv.id, {
          status: "overdue",
          reminders: [...(inv.reminders || []), { at: now.toISOString(), to, level }],
          updatedAt: now.toISOString()
        });
        store.audit({ actor: "system", tenantId: tenant.id, action: "invoice_reminder_sent", area: "facturen", detail: `${inv.number} · herinnering ${level} naar ${to}` });
        sent += 1;
      } catch (e) {
        skipped.push(`${inv.number}:${e.message}`);
      }
    }
  }
  return { checked, sent, skipped };
}

module.exports = { runPaymentReminders, reminderDue, REMINDER_INTERVAL_DAYS, MAX_REMINDERS };
