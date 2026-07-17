"use strict";
/**
 * Unified planning (master-spec h24/E06, R1-c).
 *
 * De spec voegt afspraken en shifts samen tot jobs + planning items. Deze
 * module levert het GEUNIFICEERDE READ-MODEL bovenop de bestaande "shifts"- en
 * "appointments"-collecties (compatibility, geen breaking change): één canoniek
 * planningitem met gemeenschappelijke velden, ongeacht de bron.
 *
 * Multi-resource (business rule h24: "een planningitem kan meerdere medewerkers
 * bevatten"): een shift-item exposeert resourceIds = [userId, ...assigneeIds].
 * Bestaande shifts met alleen userId blijven werken.
 *
 * Conflictdetectie (overlap/verlof) leeft al op de schrijf-routes; dit model is
 * puur lezen. Geen vendor/SQL hier (ADR-001).
 */

// Canonieke planningstatussen (h24). Bronstatussen worden hierop gemapt.
const PLANNING_STATUSES = [
  "unplanned", "tentative", "confirmed", "en_route", "started",
  "paused", "done", "no_show", "cancelled",
];

// Afspraakstatus (nl) → canonieke planningstatus.
const APPOINTMENT_STATUS_MAP = {
  gepland: "confirmed",
  bevestigd: "confirmed",
  uitgevoerd: "done",
  geannuleerd: "cancelled",
};

function shiftToPlanningItem(shift) {
  const resourceIds = [shift.userId, ...(Array.isArray(shift.assigneeIds) ? shift.assigneeIds : [])]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
  return {
    id: shift.id,
    source: "shift",
    type: shift.type || "shift",
    date: shift.date || null,
    start: shift.start || null,
    end: shift.end || null,
    title: shift.note || shift.title || "Shift",
    resourceIds,
    primaryResourceId: shift.userId || resourceIds[0] || null,
    venueId: shift.venueId || null,
    jobId: shift.workorderId || null,       // een shift alloceert tijd voor een job(=werkbon)
    projectId: shift.projectId || null,
    customerName: shift.customerName || null,
    status: PLANNING_STATUSES.includes(shift.status) ? shift.status : "confirmed",
    note: shift.note || "",
  };
}

function appointmentToPlanningItem(apt) {
  return {
    id: apt.id,
    source: "appointment",
    type: "appointment",
    date: apt.date || null,
    start: apt.start || null,
    end: apt.end || null,
    title: apt.customerName ? `Afspraak · ${apt.customerName}` : "Afspraak",
    resourceIds: [],                        // afspraken zijn (nog) klantgericht, niet resource-gebonden
    primaryResourceId: null,
    venueId: apt.venueId || null,
    jobId: apt.workorderId || null,
    projectId: apt.projectId || null,
    customerName: apt.customerName || null,
    customerEmail: apt.customerEmail || null,
    status: APPOINTMENT_STATUS_MAP[apt.status] || "confirmed",
    note: apt.note || "",
  };
}

/** Canoniek: map elk bronrecord naar een planningitem. */
function toPlanningItem(row, source) {
  return source === "appointment" ? appointmentToPlanningItem(row) : shiftToPlanningItem(row);
}

/**
 * Geünificeerde tijdlijn: shifts + afspraken als planning items, gesorteerd op
 * datum+start. Optioneel gefilterd op [from, to] (YYYY-MM-DD, inclusief) en op
 * één resource (resourceId) of job (jobId).
 */
function listPlanningItems(store, tenantId, opts = {}) {
  const { from, to, resourceId, jobId } = opts;
  const shifts = (store.list("shifts", tenantId) || []).map(shiftToPlanningItem);
  // Afspraken-collectie kan afwezig zijn als de module uit staat; defensief.
  const appts = (typeof store.list === "function" ? store.list("appointments", tenantId) || [] : []).map(appointmentToPlanningItem);
  let items = [...shifts, ...appts];
  if (from) items = items.filter(i => i.date && i.date >= from);
  if (to) items = items.filter(i => i.date && i.date <= to);
  if (resourceId) items = items.filter(i => i.resourceIds.includes(resourceId));
  if (jobId) items = items.filter(i => i.jobId === jobId);
  return items.sort((a, b) => `${a.date || ""} ${a.start || ""}`.localeCompare(`${b.date || ""} ${b.start || ""}`));
}

/**
 * Overlap-detectie over de geünificeerde planning voor één resource (h24:
 * conflictdetectie controleert overlap). Excludeert een item-id (bij bewerken).
 */
function planningOverlap(store, tenantId, resourceId, date, start, end, excludeId) {
  return listPlanningItems(store, tenantId, { from: date, to: date, resourceId })
    .find(i => i.id !== excludeId
      && String(start) < String(i.end || "24:00")
      && String(end) > String(i.start || "00:00")) || null;
}

module.exports = {
  PLANNING_STATUSES,
  toPlanningItem,
  shiftToPlanningItem,
  appointmentToPlanningItem,
  listPlanningItems,
  planningOverlap,
};
