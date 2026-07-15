"use strict";
// Afspraken: validatie + reminder-due-logica (pure functies, geen store/HTTP).
const { test } = require("node:test");
const assert = require("node:assert");

const { normalizeAppointment, appointmentReminderDue, appointmentMail } = require("../src/modules/appointments");

test("afspraken: normalizeAppointment valideert en normaliseert", () => {
  const ok = normalizeAppointment({
    customerName: "  Bouw NV ", customerEmail: "info@bouw.be",
    date: "2026-08-01", start: "08:00", end: "12:00", note: " ochtend ", reminderDays: "2"
  });
  assert.equal(ok.customerName, "Bouw NV");
  assert.equal(ok.start, "08:00");
  assert.equal(ok.end, "12:00");
  assert.equal(ok.note, "ochtend");
  assert.equal(ok.reminderDays, 2);
  assert.equal(ok.status, "gepland");

  // Seconden worden weggeknipt; onbekende reminderDays vallen terug op 1.
  const b = normalizeAppointment({ customerName: "X", date: "2026-08-01", start: "07:30:00", reminderDays: 5 });
  assert.equal(b.start, "07:30");
  assert.equal(b.reminderDays, 1);

  assert.throws(() => normalizeAppointment({ date: "2026-08-01", start: "08:00" }), /Klantnaam/);
  assert.throws(() => normalizeAppointment({ customerName: "X", date: "1-8-2026", start: "08:00" }), /datum/);
  assert.throws(() => normalizeAppointment({ customerName: "X", date: "2026-08-01" }), /Starttijd/);
  assert.throws(() => normalizeAppointment({ customerName: "X", date: "2026-08-01", start: "10:00", end: "09:00" }), /Eindtijd/);
  assert.throws(() => normalizeAppointment({ customerName: "X", date: "2026-08-01", start: "08:00", customerEmail: "geen-mail" }), /e-mailadres/);
});

test("afspraken: PATCH-merge behoudt bestaande velden", () => {
  const existing = { customerName: "Bouw NV", customerEmail: "info@bouw.be", date: "2026-08-01", start: "08:00", end: null, note: "", status: "bevestigd", reminderDays: 3 };
  const merged = normalizeAppointment({ date: "2026-08-02" }, existing);
  assert.equal(merged.customerName, "Bouw NV");
  assert.equal(merged.date, "2026-08-02");
  assert.equal(merged.status, "bevestigd");
  assert.equal(merged.reminderDays, 3);
});

test("afspraken: appointmentReminderDue respecteert venster en status", () => {
  const today = "2026-07-15";
  const base = { customerEmail: "k@x.be", date: "2026-07-16", start: "08:00", status: "gepland", reminderDays: 1, reminderSentAt: null };

  assert.equal(appointmentReminderDue({ ...base }, today), true, "morgen + 1d vooraf = due");
  assert.equal(appointmentReminderDue({ ...base, date: today }, today), true, "vandaag valt binnen het venster");
  assert.equal(appointmentReminderDue({ ...base, date: "2026-07-20" }, today), false, "buiten het venster");
  assert.equal(appointmentReminderDue({ ...base, date: "2026-07-20", reminderDays: 7 }, today), true, "7d-venster pakt volgende week");
  assert.equal(appointmentReminderDue({ ...base, date: "2026-07-10" }, today), false, "verleden nooit herinneren");
  assert.equal(appointmentReminderDue({ ...base, reminderSentAt: "2026-07-14T10:00:00Z" }, today), false, "idempotent: al verstuurd");
  assert.equal(appointmentReminderDue({ ...base, status: "geannuleerd" }, today), false, "geannuleerd niet herinneren");
  assert.equal(appointmentReminderDue({ ...base, status: "uitgevoerd" }, today), false, "uitgevoerd niet herinneren");
  assert.equal(appointmentReminderDue({ ...base, customerEmail: null }, today), false, "zonder e-mail geen reminder");
  assert.equal(appointmentReminderDue({ ...base, reminderDays: 0 }, today), false, "reminder uit");
  assert.equal(appointmentReminderDue({ ...base, status: "bevestigd" }, today), true, "bevestigd ook herinneren");
});

test("afspraken: reminder-mail bevat datum, tijdvenster en tenantnaam", () => {
  const mail = appointmentMail({
    tenant: { name: "Demo Bouw BV" },
    appointment: { customerName: "Jan", customerEmail: "jan@x.be", date: "2026-07-16", start: "08:00", end: "12:00", note: "Achterdeur open laten" }
  });
  assert.match(mail.subject, /2026-07-16/);
  assert.match(mail.subject, /Demo Bouw BV/);
  assert.match(mail.html, /tussen 08:00 en 12:00/);
  assert.match(mail.html, /Achterdeur open laten/);
  assert.match(mail.text, /Demo Bouw BV/);

  // Zonder eindtijd: "vanaf".
  const open = appointmentMail({ tenant: { name: "X" }, appointment: { customerName: "J", date: "2026-07-16", start: "08:00", end: null, note: "" } });
  assert.match(open.html, /vanaf 08:00/);
});
