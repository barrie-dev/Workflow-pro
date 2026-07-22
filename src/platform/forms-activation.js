"use strict";

// ── Forms-activatie (Forms handover h2 "Activatiemodel" · F2) ────────────────
// Pure cascade over de ACHT activatielagen. Een formulier is pas actief voor een
// gebruiker in een context als ELKE laag slaagt; de eerste die faalt levert
// blockedBy + reason (voor UI en audit). Geen SQL · de aanroeper levert de
// definitie, de assignments, de entitlements en de context.
//
// Lagen (h2): platform → entitlement → tenant → company → team → context → rol →
// gebruiker. Alleen de gebruikerslaag (voorkeur/pin) is door de eindgebruiker
// wijzigbaar; de rest is beheer.

// Statussen waarin een formulier invulbaar kan zijn (definition.status, h2).
const ACTIVE_STATUSES = new Set(["system_required", "enabled", "conditional", "scheduled"]);
// Statussen die invullen expliciet blokkeren (historiek blijft leesbaar).
const BLOCKING_STATUSES = new Set(["available", "paused", "deprecated", "archived"]);

function toSet(v) {
  if (v instanceof Set) return v;
  if (Array.isArray(v)) return new Set(v);
  return new Set();
}
function parseTime(t) {
  if (t == null) return null;
  const ms = typeof t === "number" ? t : Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Slaagt de scope-laag? Zijn er GEEN actieve assignments van dit scope-type, dan
 * geldt geen beperking (→ true). Zijn ze er wél, dan moet `value` in de set van
 * toegewezen scope_ids zitten ("formulier geldt voor geselecteerde teams", h2).
 */
function scopeMatches(assignments, scopeType, value) {
  const ofType = assignments.filter(a => a.scope_type === scopeType);
  if (ofType.length === 0) return true;
  if (value == null) return false;
  return ofType.some(a => a.scope_id === value);
}

// Vergelijkingsoperatoren voor context-voorwaarden (conditional, h2).
const OPS = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  gte: (a, b) => Number(a) >= Number(b),
  lte: (a, b) => Number(a) <= Number(b),
  gt: (a, b) => Number(a) > Number(b),
  lt: (a, b) => Number(a) < Number(b),
  in: (a, b) => Array.isArray(b) && b.includes(a),
};

/**
 * Evalueer de context-voorwaarden (objecttype, status, bedrag, risico). Alle
 * voorwaarden moeten waar zijn (AND). Geen voorwaarden → altijd waar.
 * Voorwaarden staan in def.attributes.conditions = [{ field, op, value }].
 */
function evalConditions(def, context) {
  const conds = (def.attributes && def.attributes.conditions) || [];
  for (const c of conds) {
    const op = OPS[c.op] || OPS.eq;
    if (!op(context[c.field], c.value)) {
      return { ok: false, reason: `voorwaarde niet voldaan: ${c.field} ${c.op} ${JSON.stringify(c.value)}` };
    }
  }
  return { ok: true };
}

/**
 * Slaagt de rollaag? Zijn er role-assignments, dan moet de rol van de gebruiker
 * (of een expliciet toegewezen role-key) matchen. Anders (geen role-assignments)
 * geldt geen rolbeperking op dit niveau; het instance-recht handhaaft nog apart.
 */
function roleAllows(def, user, assignments) {
  const roleAssigns = assignments.filter(a => a.scope_type === "role");
  if (roleAssigns.length === 0) return true;
  if (!user) return false;
  return roleAssigns.some(a => a.scope_id === user.role) ||
    (user.permissions || []).some(p => roleAssigns.some(a => a.scope_id === p));
}

/**
 * Los de activatie op voor een definitie in een context.
 * @param {object} def  form-definitie (met status, scheduled_from/until, attributes)
 * @param {object} ctx  { user, context, entitlements, assignments, now }
 * @returns {{active:boolean, status:string|null, blockedBy:string|null, reason:string}}
 */
function resolveActivation(def, { user = null, context = {}, entitlements = [], assignments = [], now = Date.now() } = {}) {
  const status = def ? def.status : null;
  const block = (layer, reason) => ({ active: false, status, blockedBy: layer, reason });

  // 1) Platform · de capability/definitie bestaat en wordt ondersteund.
  if (!def) return block("platform", "definitie bestaat niet");

  // 2) Entitlement · een vereiste module/add-on moet gelicentieerd zijn.
  const reqEnt = def.attributes && def.attributes.requires_entitlement;
  if (reqEnt && !toSet(entitlements).has(reqEnt)) return block("entitlement", `entitlement '${reqEnt}' niet gelicentieerd`);

  // 3) Tenant · heeft de klant het formulier geactiveerd? (status)
  if (BLOCKING_STATUSES.has(status)) {
    return block("tenant", status === "available" ? "nog niet door de tenant geactiveerd" : `status ${status}: niet invulbaar`);
  }
  if (!ACTIVE_STATUSES.has(status)) return block("tenant", `onbekende/inactieve status ${status}`);
  // scheduled · nu moet binnen het [van, tot]-venster liggen.
  const from = parseTime(def.scheduled_from), until = parseTime(def.scheduled_until);
  if (from && now < from) return block("tenant", "nog niet gestart (scheduled)");
  if (until && now > until) return block("tenant", "verlopen (scheduled)");

  const active = assignments.filter(a => a.active !== false && !a.revoked_at);

  // 4) Onderneming · geldt het formulier voor de juridische entiteit van de user?
  if (!scopeMatches(active, "company", context.company_id != null ? context.company_id : (user && user.companyId)))
    return block("company", "geen toewijzing voor deze onderneming");

  // 5) Team/afdeling · geldt het voor het team van de user?
  if (!scopeMatches(active, "team", context.team_id != null ? context.team_id : (user && user.teamId)))
    return block("team", "geen toewijzing voor dit team");

  // 6) Context · objecttype/status/bedrag/risico voldoet aan de voorwaarden.
  const cond = evalConditions(def, context);
  if (!cond.ok) return block("context", cond.reason);

  // 7) Rol · de rol heeft recht op dit formulier (indien role-assignments bestaan).
  if (!roleAllows(def, user, active)) return block("role", "de rol heeft geen recht op dit formulier");

  // 8) Gebruiker · voorkeuren (favoriet/pin) blokkeren niet; ze verfijnen enkel.
  return { active: true, status, blockedBy: null, reason: "actief" };
}

module.exports = {
  ACTIVE_STATUSES, BLOCKING_STATUSES, OPS,
  scopeMatches, evalConditions, roleAllows, resolveActivation,
};
