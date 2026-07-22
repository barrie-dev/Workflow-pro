"use strict";

// ── Forms assignment-triggers (Forms handover h26 · F3/F4) ───────────────────
// "Form assignment kan worden getriggerd bij objectaanmaak, statuswijziging,
// datum, bedrag, risico, integratie-event of handmatige actie." Een definitie
// draagt haar triggers in attributes.triggers:
//   [{ event: "workorder.completed",          // domeinevent-type; '*' als suffix-wildcard
//      conditions: [{ field, op, value }],    // tegen event.data (zelfde OPS als activatie)
//      assign_to: "creator" | "<email>",      // wie de instance krijgt (default: event-actor)
//      subject_type?, subject_id_field? }]    // subject-override (default: aggregate)
// Puur · de repository maakt de instance idempotent aan (dedup op event+definitie).

const { OPS } = require("./forms-activation");

function eventMatches(pattern, eventType) {
  const p = String(pattern || "");
  if (!p) return false;
  if (p.endsWith("*")) return String(eventType).startsWith(p.slice(0, -1));
  return p === eventType;
}

function conditionsHold(conditions, data) {
  for (const c of conditions || []) {
    const op = OPS[c.op] || OPS.eq;
    if (!op((data || {})[c.field], c.value)) return false;
  }
  return true;
}

/** Alle triggers van een definitie die op dit event afgaan. */
function matchTriggers(def, event) {
  const triggers = (def && def.attributes && def.attributes.triggers) || [];
  return triggers.filter(t => eventMatches(t.event, event.eventType) && conditionsHold(t.conditions, event.data));
}

/** Bouw de instance-payload voor een afgegane trigger (deterministische dedup-sleutel). */
function instancePayloadFor(def, trigger, event) {
  const assignTo = trigger.assign_to === "creator" || !trigger.assign_to ? (event.actor || null) : trigger.assign_to;
  return {
    definition_id: def.id,
    subject_type: trigger.subject_type || event.aggregateType || null,
    subject_id: trigger.subject_id_field ? String((event.data || {})[trigger.subject_id_field] || "") || event.aggregateId : event.aggregateId || null,
    assigned_to: assignTo,
    source: "automation",
    // Idempotent per (event, definitie): een her-bezorgd event maakt nooit een tweede instance.
    idempotency_key: `trig_${event.id}_${def.id}`,
  };
}

module.exports = { eventMatches, conditionsHold, matchTriggers, instancePayloadFor };
