"use strict";
/**
 * Werkongevallen-register (arbeidsongevallen).
 *
 * Wettelijk kader (BE, Arbeidsongevallenwet 10/04/1971):
 *  - aangifte bij de arbeidsongevallenverzekeraar binnen 8 kalenderdagen
 *    na de dag van het ongeval (art. 62);
 *  - ernstig arbeidsongeval: omstandig verslag aan de inspectie
 *    (Toezicht op het Welzijn op het Werk) binnen 10 dagen;
 *  - dodelijk of zeer ernstig ongeval: onmiddellijk melden.
 *
 * Deze module registreert (wie/wanneer/waar/wat/ernst/getuigen), bewaakt de
 * aangifte-deadline en exporteert het register als CSV voor de verzekeraar.
 */

const SEVERITIES = ["licht", "werkverlet", "ernstig", "dodelijk"];
const STATUSES = ["open", "gemeld", "gesloten"];

// Aangifte-termijn verzekeraar: 8 kalenderdagen na de dag van het ongeval.
const INSURER_DEADLINE_DAYS = 8;

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  throw e;
}

function hhmm(v) {
  const m = String(v || "").match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

function isoDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null;
}

function normalizeIncident(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  if (!String(merged.employeeName || "").trim()) badRequest("Naam van de medewerker is verplicht");
  const date = isoDate(merged.date);
  if (!date) badRequest("Geldige ongevalsdatum is verplicht");
  if (!String(merged.description || "").trim()) badRequest("Omschrijving van het ongeval is verplicht");
  const severity = SEVERITIES.includes(merged.severity) ? merged.severity : null;
  if (!severity) badRequest("Ernst is verplicht (licht, werkverlet, ernstig of dodelijk)");
  const status = STATUSES.includes(merged.status) ? merged.status : "open";
  const reportedAt = isoDate(merged.insurerReportedAt);
  return {
    employeeId: merged.employeeId || null,
    employeeName: String(merged.employeeName).trim(),
    date,
    time: hhmm(merged.time),
    venueId: merged.venueId || null,
    location: String(merged.location || "").trim(),
    description: String(merged.description).trim(),
    severity,
    witnesses: String(merged.witnesses || "").trim(),
    status,
    insurerReportedAt: reportedAt,
  };
}

/**
 * Deadline-status voor de aangifte bij de verzekeraar.
 * @returns {{ deadline:string, daysLeft:number, overdue:boolean, reported:boolean, serious:boolean, immediate:boolean }}
 *  - serious   → ernstig/dodelijk: omstandig verslag aan de inspectie vereist
 *  - immediate → dodelijk: onmiddellijk melden aan de inspectie
 */
function incidentDeadline(incident, today = new Date().toISOString().slice(0, 10)) {
  const d = new Date(`${incident.date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + INSURER_DEADLINE_DAYS);
  const deadline = d.toISOString().slice(0, 10);
  const daysLeft = Math.round((new Date(`${deadline}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
  const reported = !!incident.insurerReportedAt;
  return {
    deadline,
    daysLeft,
    overdue: !reported && daysLeft < 0,
    reported,
    serious: ["ernstig", "dodelijk"].includes(incident.severity),
    immediate: incident.severity === "dodelijk",
  };
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/** CSV-register voor de verzekeraar (vaste kolomvolgorde, kolomkoppen NL). */
function incidentsToCsv(incidents) {
  const header = ["Datum", "Tijd", "Medewerker", "Locatie", "Ernst", "Omschrijving",
    "Getuigen", "Status", "Gemeld aan verzekeraar", "Geregistreerd door", "Geregistreerd op"];
  const lines = [header.map(csvCell).join(",")];
  for (const i of incidents || []) {
    lines.push([
      i.date, i.time || "", i.employeeName, i.location || "", i.severity, i.description,
      i.witnesses || "", i.status, i.insurerReportedAt || "",
      i.createdBy || "", String(i.createdAt || "").slice(0, 10),
    ].map(csvCell).join(","));
  }
  return lines.join("\n");
}

module.exports = {
  SEVERITIES,
  STATUSES,
  INSURER_DEADLINE_DAYS,
  normalizeIncident,
  incidentDeadline,
  incidentsToCsv,
};
