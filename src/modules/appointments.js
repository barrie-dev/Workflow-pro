"use strict";
/**
 * Afspraken-agenda + automatische klantreminder.
 *
 * Een afspraak legt vast wanneer de werken bij een klant worden uitgevoerd
 * (datum + tijdvenster), optioneel gekoppeld aan een werkbon. De reminder-sweep
 * stuurt de klant `reminderDays` dagen vooraf één e-mail (idempotent via
 * reminderSentAt) — zelfde patroon als de betaalherinneringen.
 *
 * Gating: module "appointments" (catalogus) + submodule "reminders" voor de
 * automatische mails. E-mail loopt via de mailer (dev/test loggen enkel).
 */

const { sendMail, wrapHtml } = require("../lib/mailer");
const { isModuleEnabled, isSubmoduleEnabled } = require("./entitlements");

const STATUSES = ["gepland", "bevestigd", "uitgevoerd", "geannuleerd"];
const REMINDER_DAY_CHOICES = [0, 1, 2, 3, 7]; // 0 = geen reminder

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  throw e;
}

function hhmm(v) {
  const m = String(v || "").match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

function normalizeAppointment(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  if (!String(merged.customerName || "").trim()) badRequest("Klantnaam is verplicht");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(merged.date || ""))) badRequest("Geldige datum is verplicht");
  const start = hhmm(merged.start);
  const end = hhmm(merged.end);
  if (!start) badRequest("Starttijd is verplicht");
  if (end && end <= start) badRequest("Eindtijd moet na de starttijd liggen");
  const email = String(merged.customerEmail || "").trim();
  if (email && !email.includes("@")) badRequest("Geldig e-mailadres van de klant is vereist");
  const status = STATUSES.includes(merged.status) ? merged.status : "gepland";
  let reminderDays = Number(merged.reminderDays);
  if (!Number.isFinite(reminderDays) || !REMINDER_DAY_CHOICES.includes(reminderDays)) reminderDays = 1;
  return {
    customerId: merged.customerId || null,
    customerName: String(merged.customerName).trim(),
    customerEmail: email || null,
    workorderId: merged.workorderId || null,
    date: merged.date,
    start,
    end: end || null,
    note: String(merged.note || "").trim(),
    status,
    reminderDays,
  };
}

function fmtDateNl(iso) {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch { return iso; }
}

// Klantgerichte reminder-mail (NL · Belgische markt; afzender = tenant via mailer).
function appointmentMail({ tenant, appointment }) {
  const when = fmtDateNl(appointment.date);
  const window = appointment.end ? `tussen ${appointment.start} en ${appointment.end}` : `vanaf ${appointment.start}`;
  const who = tenant.name || "Monargo One";
  const subject = `Herinnering: afspraak op ${appointment.date} · ${who}`;
  const html = wrapHtml(subject, `
    <h2>Uw afspraak nadert</h2>
    <p>Beste ${appointment.customerName},</p>
    <p>Een korte herinnering: <strong>${who}</strong> komt langs op
    <strong>${when}</strong>, ${window}.</p>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Datum</span><span class="detail-value">${when}</span></div>
      <div class="detail-row"><span class="detail-label">Tijd</span><span class="detail-value">${appointment.start}${appointment.end ? ` – ${appointment.end}` : ""}</span></div>
      ${appointment.note ? `<div class="detail-row"><span class="detail-label">Opmerking</span><span class="detail-value">${appointment.note}</span></div>` : ""}
    </div>
    <p style="margin-top:14px">Past dit moment toch niet? Neem dan even contact met ons op.</p>
    <p>Met vriendelijke groeten,<br>${who}</p>`);
  const text = `Herinnering: ${who} komt langs op ${when}, ${window}.`
    + (appointment.note ? `\nOpmerking: ${appointment.note}` : "")
    + `\n\nPast dit moment niet? Neem contact met ons op.`;
  return { subject, html, text };
}

/**
 * Moet deze afspraak nú een reminder krijgen?
 * - status gepland/bevestigd, nog niet verstuurd, klant heeft e-mail
 * - reminderDays > 0 en de afspraak valt binnen dat venster (maar niet in het verleden)
 */
function appointmentReminderDue(apt, today = new Date().toISOString().slice(0, 10)) {
  if (!apt || apt.reminderSentAt) return false;
  if (!["gepland", "bevestigd"].includes(apt.status)) return false;
  if (!apt.customerEmail || !apt.date) return false;
  const days = Number(apt.reminderDays);
  if (!Number.isFinite(days) || days <= 0) return false;
  if (apt.date < today) return false;
  const diffDays = Math.round((new Date(`${apt.date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
  return diffDays <= days;
}

/**
 * Eén ronde over alle tenants; verstuurt afspraak-reminders die due zijn.
 * @returns {{ checked:number, sent:number, skipped:string[] }}
 */
async function runAppointmentReminders(store, config, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  let checked = 0, sent = 0;
  const skipped = [];
  for (const tenant of store.data.tenants || []) {
    if (!tenant || tenant.id == null) continue;
    if (!isModuleEnabled(store, tenant, "appointments")) continue;
    if (!isSubmoduleEnabled(store, tenant, "appointments", "reminders")) { skipped.push(`${tenant.id}:submodule`); continue; }
    for (const apt of store.list("appointments", tenant.id)) {
      checked += 1;
      if (!appointmentReminderDue(apt, today)) continue;
      const mail = appointmentMail({ tenant, appointment: apt });
      try {
        await sendMail({ to: apt.customerEmail, ...mail });
        store.update("appointments", apt.id, { reminderSentAt: now.toISOString(), updatedAt: now.toISOString() });
        store.audit({ actor: "system", tenantId: tenant.id, action: "appointment_reminder_sent", area: "appointments", detail: `${apt.date} ${apt.start} · ${apt.customerName} · naar ${apt.customerEmail}` });
        sent += 1;
      } catch (e) {
        skipped.push(`${apt.id}:${e.message}`);
      }
    }
  }
  return { checked, sent, skipped };
}

module.exports = {
  STATUSES,
  REMINDER_DAY_CHOICES,
  normalizeAppointment,
  appointmentMail,
  appointmentReminderDue,
  runAppointmentReminders,
};
