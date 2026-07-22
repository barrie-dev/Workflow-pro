"use strict";

// ── Forms-objectautorisatie (CTO2-01/02 · h3-rolmatrix) ──────────────────────
// Tenantisolatie is GEEN objectautorisatie: binnen een tenant beslist deze
// module per actie én per record wie wat mag. Pure beslislaag · de router laadt
// de instance en vraagt hier de beslissing, vóór elke repository-call.
//
// Rechtendomein (h3 + CTO2-02):
//   forms.definition.view|manage|publish
//   forms.instance.create|view|edit|submit|withdraw
//   forms.approve · forms.sign · forms.assign · forms.report · forms.export
//   forms.retention.manage
// Expliciete rechten (samenstelbare profielen) dragen een scope-prefix
// (own:|team:|tenant-breed zonder prefix). Ingebouwde rollen krijgen de
// h3-defaults: medewerker = own/assigned, teamleider = team + goedkeuren,
// tenant_admin = alles. Superadmin volgt de platformregel (geen automatische
// klantdata · alleen expliciet, hier: gelijk aan tenant_admin binnen support).

const FORMS_PERMISSIONS = [
  "forms.definition.view", "forms.definition.manage", "forms.definition.publish",
  "forms.instance.create", "forms.instance.view", "forms.instance.edit",
  "forms.instance.submit", "forms.instance.withdraw",
  "forms.approve", "forms.sign", "forms.assign", "forms.report", "forms.export",
  "forms.retention.manage",
];

// h3-defaults per ingebouwde rol: recht → scope (own = eigen/toegewezen,
// team = eigen team, tenant = alles binnen de tenant). Afwezig = geen recht.
const BUILTIN_GRANTS = {
  tenant_admin: Object.fromEntries(FORMS_PERMISSIONS.map(p => [p, "tenant"])),
  super_admin: Object.fromEntries(FORMS_PERMISSIONS.map(p => [p, "tenant"])),
  manager: {
    "forms.definition.view": "tenant",
    "forms.instance.create": "own", "forms.instance.view": "team",
    "forms.instance.edit": "own", "forms.instance.submit": "own",
    "forms.instance.withdraw": "own",
    "forms.approve": "team", "forms.sign": "own",
  },
  employee: {
    "forms.definition.view": "tenant", // de LIJST wordt op activatie gefilterd
    "forms.instance.create": "own", "forms.instance.view": "own",
    "forms.instance.edit": "own", "forms.instance.submit": "own",
    "forms.instance.withdraw": "own",
  },
};

const SCOPE_ORDER = { own: 1, team: 2, tenant: 3 };

/** Parse een expliciete recht-string → { key, scope }. */
function parseGrant(raw) {
  const p = String(raw || "");
  if (p.startsWith("own:")) return { key: p.slice(4), scope: "own" };
  if (p.startsWith("team:")) return { key: p.slice(5), scope: "team" };
  if (p.startsWith("read:")) return { key: p.slice(5), scope: "tenant" };
  return { key: p, scope: "tenant" };
}

/**
 * De effectieve scope van een gebruiker voor één forms-recht, of null.
 * Expliciete rechten (profielen) verruimen de ingebouwde default; de hoogste wint.
 */
function grantFor(user, permission) {
  if (!user) return null;
  let best = (BUILTIN_GRANTS[user.role] || {})[permission] || null;
  for (const raw of user.permissions || []) {
    if (raw === "*") return "tenant";
    const g = parseGrant(raw);
    if (g.key !== permission) continue;
    if (!best || SCOPE_ORDER[g.scope] > SCOPE_ORDER[best]) best = g.scope;
  }
  return best;
}

/** Valt deze instance binnen de scope van de gebruiker? ctx.teamEmails = Set. */
function instanceInScope(scope, user, inst, ctx = {}) {
  if (!scope || !inst) return false;
  if (scope === "tenant") return true;
  const mine = e => e && user && e === user.email;
  if (mine(inst.created_by) || mine(inst.assigned_to)) return true;
  if (scope === "team") {
    const team = ctx.teamEmails instanceof Set ? ctx.teamEmails : new Set();
    return team.has(inst.created_by) || team.has(inst.assigned_to);
  }
  return false;
}

/** Mag de gebruiker deze actie op deze instance? (actie zonder forms.-prefix) */
function canInstance(user, inst, action, ctx = {}) {
  const perm = action.startsWith("forms.") ? action : `forms.instance.${action}`;
  const scope = grantFor(user, perm);
  if (!scope) return false;
  return instanceInScope(scope, user, inst, ctx);
}

/** Mag de gebruiker definities beheren? (aanmaken/structuur/status/toewijzen) */
function canManageDefinitions(user) { return !!grantFor(user, "forms.definition.manage"); }
function canPublish(user) { return !!(grantFor(user, "forms.definition.publish") || grantFor(user, "forms.definition.manage")); }

// Welke statusovergang vraagt welk recht (CTO2-01: transition is geen vrije actie).
const TRANSITION_RIGHT = {
  withdrawn: "forms.instance.withdraw",
  in_review: "forms.approve", approved: "forms.approve", rejected: "forms.approve",
  changes_requested: "forms.approve", completed: "forms.approve",
  signed: "forms.sign",
  void: "forms.definition.manage", archived: "forms.definition.manage",
  draft: "forms.instance.edit", resubmitted: "forms.instance.submit", not_started: "forms.instance.edit",
};

function rightForTransition(toStatus) { return TRANSITION_RIGHT[toStatus] || "forms.definition.manage"; }

module.exports = {
  FORMS_PERMISSIONS, BUILTIN_GRANTS, grantFor, instanceInScope, canInstance,
  canManageDefinitions, canPublish, rightForTransition,
};
