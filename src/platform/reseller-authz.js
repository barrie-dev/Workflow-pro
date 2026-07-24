"use strict";

// ── Reseller-rechten en scopes (h23.5/23.6 · pure beslislaag) ────────────────
// Rechten combineren action + scope + tenantrelatie en worden server-side
// afgedwongen (23.6). Een reseller-token bevat geen impliciete toegang tot
// alle door hem verkochte klanten. Pure module: geen store, geen I/O · de
// router laadt de records (reseller, assignment, delegatie) en vraagt hier
// de beslissing, voor elke repository-call.
//
// Scopes (SCOPE_ORDER own < assigned < all):
//   own      = de eigen resellerorganisatie (deals, commissies, profiel)
//   assigned = uitsluitend expliciet toegewezen tenants (actief assignment-
//              record vereist · reseller_id op de tenant alleen is NOOIT
//              genoeg, 23.15)
//   all      = Monargo-zijde (partner management/finance) over alle partners
//
// Expliciete rechten (samenstelbare profielen) dragen een scope als suffix
// zoals in 23.6 ("reseller.tenants.view:assigned") of als prefix in de
// huisstijl van forms-authz ("assigned:reseller.tenants.view"). Zonder scope
// geldt "own" · bewust smaller dan forms-authz (daar tenant-breed), want in
// het kanaaldomein is deny-by-default de norm (23.15).
//
// De kolom "Gevoelige beperkingen" uit 23.5 is letterlijk overgenomen in
// SENSITIVE_DENY en is NIET verruimbaar via expliciete rechten of "*".

const RESELLER_PERMISSIONS = [
  // Rechtendomein uit 23.6
  "reseller.organization.view", "reseller.organization.edit",
  "reseller.users.manage",
  "reseller.deals.create", "reseller.deals.view",
  "reseller.tenants.request", "reseller.tenants.view",
  "reseller.licenses.request",
  "reseller.support.view",
  "reseller.commissions.view", "reseller.commissions.dispute",
  "reseller.delegated_admin.use",
  // Aanvullingen die 23.5/23.8/23.11 eisen (Monargo-zijde + payout)
  "reseller.deals.approve",      // dealclaim/attributie beoordelen · vier-ogen (23.8)
  "reseller.commissions.manage", // commissiemodel, validatie, correcties (23.11)
  "reseller.payout.manage",      // payoutgegevens beheren · MFA + vier-ogen (23.11)
  "reseller.payout.approve",     // uitbetaling goedkeuren · vier-ogen (23.11)
  "reseller.tier.manage",        // partner tier/contracttype · alleen Monargo (23.2)
];

const SCOPES = ["own", "assigned", "all"];
const SCOPE_ORDER = { own: 1, assigned: 2, all: 3 };

// 23.5-defaults per rol: recht → scope. Afwezig = geen recht (deny-by-default).
const BUILTIN_GRANTS = {
  reseller_owner: {
    "reseller.organization.view": "own", "reseller.organization.edit": "own",
    "reseller.users.manage": "own",
    "reseller.deals.view": "own",
    "reseller.tenants.view": "assigned",
    "reseller.support.view": "assigned",
    "reseller.commissions.view": "own",
  },
  reseller_sales: {
    "reseller.organization.view": "own",
    "reseller.deals.create": "own", "reseller.deals.view": "own",
    "reseller.tenants.request": "own", "reseller.tenants.view": "assigned",
    "reseller.licenses.request": "assigned",
    "reseller.commissions.view": "own", // eigen samenvatting (23.6-matrix)
  },
  reseller_operations: {
    "reseller.organization.view": "own",
    "reseller.tenants.view": "assigned",
    "reseller.support.view": "assigned",
    "reseller.delegated_admin.use": "assigned", // werkt alleen met actieve delegatie (23.12)
  },
  reseller_support: {
    "reseller.organization.view": "own",
    "reseller.tenants.view": "assigned",
    "reseller.support.view": "assigned",
  },
  reseller_finance: {
    "reseller.organization.view": "own",
    "reseller.deals.view": "own", // read-only (23.6-matrix)
    "reseller.commissions.view": "own", "reseller.commissions.dispute": "own",
    "reseller.payout.manage": "own", // MFA + vier-ogen blijven verplicht (23.11)
  },
  reseller_admin: {
    "reseller.organization.view": "own", "reseller.organization.edit": "own",
    "reseller.users.manage": "own",
  },
  monargo_partner_manager: {
    "reseller.organization.view": "all", "reseller.organization.edit": "all",
    "reseller.tier.manage": "all",
    "reseller.deals.view": "all", "reseller.deals.approve": "all",
    "reseller.tenants.view": "all", "reseller.tenants.request": "all",
    "reseller.licenses.request": "all",
    "reseller.commissions.view": "all",
    "reseller.support.view": "all",
  },
  monargo_partner_finance: {
    "reseller.organization.view": "all",
    "reseller.deals.view": "all",
    "reseller.deals.approve": "all", // enkel met vier-ogencontrole (23.5)
    "reseller.commissions.view": "all", "reseller.commissions.manage": "all",
    "reseller.payout.manage": "all", "reseller.payout.approve": "all",
  },
};

const RESELLER_ROLES = Object.keys(BUILTIN_GRANTS);

// "Gevoelige beperkingen" 23.5 · hard deny, NIET verruimbaar via expliciete
// rechten of "*". Sales mag geen commissie-uitbetaling wijzigen en geen
// klantdata buiten deals; finance geen operationele klantdata; reseller_admin
// en owner kunnen eigen contracttype/tier niet aanpassen; partner manager
// wijzigt payout nooit zonder financecontrole.
const SENSITIVE_DENY = {
  reseller_sales: [
    "reseller.payout.manage", "reseller.payout.approve",
    "reseller.commissions.manage", "reseller.delegated_admin.use",
  ],
  reseller_finance: ["reseller.support.view", "reseller.delegated_admin.use"],
  reseller_admin: ["reseller.tier.manage"],
  reseller_owner: ["reseller.tier.manage"],
  monargo_partner_manager: ["reseller.payout.manage", "reseller.payout.approve"],
};

// Vier-ogencontrole (23.8 attribution · 23.11 payout · 23.5 dealclaim finance).
const FOUR_EYES_PERMISSIONS = [
  "reseller.deals.approve",
  "reseller.payout.manage", "reseller.payout.approve",
  "reseller.commissions.manage",
];

// Suspensie (23.4): nieuwe deals, tenantaanvragen en beheeracties geblokkeerd,
// historische rapportering blijft. Alleen deze view-rechten blijven werken.
const SUSPENSION_ALLOWED = [
  "reseller.organization.view", "reseller.deals.view", "reseller.tenants.view",
  "reseller.commissions.view", "reseller.support.view",
];

// MFA verplicht voor reselleradmins, finance en gedelegeerde tenanttoegang (23.15).
const MFA_REQUIRED_ROLES = [
  "reseller_owner", "reseller_admin", "reseller_finance",
  "monargo_partner_manager", "monargo_partner_finance",
];

function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }

/** Effectieve kanaalrol: sub-rol op de gebruiker wint op de systeemrol. */
function roleOf(user) { return (user && (user.resellerRole || user.role)) || null; }

/** Parse een expliciete recht-string → { key, scope }. Zonder scope: own. */
function parseGrant(raw) {
  const p = String(raw || "");
  const first = p.indexOf(":");
  const last = p.lastIndexOf(":");
  if (last > 0) {
    const suffix = p.slice(last + 1);
    if (SCOPE_ORDER[suffix]) return { key: p.slice(0, last), scope: suffix }; // 23.6-notatie
    const prefix = p.slice(0, first);
    if (SCOPE_ORDER[prefix]) return { key: p.slice(first + 1), scope: prefix }; // huisstijl forms-authz
  }
  return { key: p, scope: "own" };
}

/**
 * Effectieve scope van een gebruiker voor een reseller-recht, of null.
 * Volgorde: (1) onbekend recht = null · (2) gevoelige beperking 23.5 = hard
 * null, ook bij expliciete rechten of "*" · (3) hoogste van ingebouwde
 * default en expliciete grants wint.
 */
function grantFor(user, permission) {
  if (!user || !RESELLER_PERMISSIONS.includes(permission)) return null;
  const role = roleOf(user);
  if ((SENSITIVE_DENY[role] || []).includes(permission)) return null;
  let best = (BUILTIN_GRANTS[role] || {})[permission] || null;
  for (const raw of user.permissions || []) {
    const g = raw === "*" ? { key: permission, scope: "all" } : parseGrant(raw);
    if (g.key !== permission) continue;
    if (!best || SCOPE_ORDER[g.scope] > SCOPE_ORDER[best]) best = g.scope;
  }
  return best;
}

function toMs(now) {
  if (now == null) return Date.now();
  return typeof now === "number" ? now : Date.parse(now);
}

/**
 * Valt deze tenant binnen de scope van de resellergebruiker? Vereist een
 * ACTIEF assignment-record (status "active", binnen start/einddatum) dat de
 * eigen reseller expliciet aan de tenant koppelt. reseller_id op de tenant
 * alleen is nooit genoeg (23.15) · ongeldig geformatteerde datums falen dicht.
 */
function tenantInScope(user, tenantId, assignments, now) {
  if (!user || !user.resellerId || !tenantId) return false;
  const nowMs = toMs(now);
  return (Array.isArray(assignments) ? assignments : []).some(a =>
    a && a.tenantId === tenantId && a.resellerId === user.resellerId
    && a.status === "active"
    && (!a.startDate || Date.parse(a.startDate) <= nowMs)
    && (!a.endDate || Date.parse(a.endDate) > nowMs));
}

/**
 * Centrale beslisfunctie: mag deze gebruiker deze actie in deze context?
 * ctx: { resellerId, tenantId, assignments, resellerStatus, now }
 * - all-scope (Monargo-zijde) mag altijd, ook op gesuspendeerde partners
 *   (die moeten beheerd blijven);
 * - suspensie van de eigen organisatie blokkeert alles behalve views (23.4);
 * - own vereist dat de context-reseller de eigen organisatie is · een
 *   expliciet vreemde resellerId is een harde weigering, nooit stil
 *   herfilteren (23.6);
 * - assigned vereist bovendien een actieve tenantkoppeling (23.15).
 */
function canResellerAction(user, permission, ctx = {}) {
  const scope = grantFor(user, permission);
  if (!scope) return false;
  if (scope === "all") return true;
  if (ctx.resellerStatus && ctx.resellerStatus !== "active" && suspensionBlocks(permission)) return false;
  if (!user.resellerId) return false;
  if (ctx.resellerId && ctx.resellerId !== user.resellerId) return false;
  if (scope === "own") return true;
  return tenantInScope(user, ctx.tenantId, ctx.assignments, ctx.now);
}

/** Vier-ogencontrole vereist voor attributie, payout en dealclaim? */
function requiresFourEyes(permission) { return FOUR_EYES_PERMISSIONS.includes(permission); }

/**
 * Geen self-approval (23.10/23.11): goedkeurder en indiener moeten
 * verschillende personen zijn. Ontbrekende identiteit faalt dicht.
 */
function assertNotSelfApproval(actorId, submittedById) {
  const a = String(actorId || "").trim().toLowerCase();
  const b = String(submittedById || "").trim().toLowerCase();
  if (!a || !b || a === b) {
    throw err(403, "SELF_APPROVAL_FORBIDDEN", "Vier-ogencontrole vereist: goedkeurder en indiener moeten verschillen");
  }
  return true;
}

/**
 * Blokkeert suspensie deze actie? (23.4) Nieuwe deals, tenantaanvragen en
 * beheeracties: ja. Historische rapportering (views): nee. Onbekende acties
 * falen dicht.
 */
function suspensionBlocks(action) { return !SUSPENSION_ALLOWED.includes(action); }

/** MFA verplicht? Reselleradmins, finance, gedelegeerde toegang en vier-ogenacties (23.15). */
function requiresMfa(user, permission) {
  if (MFA_REQUIRED_ROLES.includes(roleOf(user))) return true;
  if (permission === "reseller.delegated_admin.use") return true;
  return requiresFourEyes(permission);
}

/**
 * Beslis over een gedelegeerde-toegangsrecord (23.12/23.14). Het record is
 * strikt per tenant; een grant van tenant X telt nooit op tenant Y (die
 * mismatch geeft REQUIRED, geen bevestiging dat elders wel een grant bestaat).
 * requiredScope wordt exact gematcht: read impliceert nooit write.
 * ctx: { tenantId, now }
 */
function delegationDecision(grant, requiredScope, ctx = {}) {
  if (!grant) return { ok: false, status: 403, code: "DELEGATED_ACCESS_REQUIRED" };
  if (ctx.tenantId && grant.tenantId !== ctx.tenantId) {
    return { ok: false, status: 403, code: "DELEGATED_ACCESS_REQUIRED" };
  }
  if (grant.status === "revoked") return { ok: false, status: 403, code: "DELEGATED_ACCESS_REVOKED" };
  // Een record dat al op "expired" staat houdt dezelfde weigercode als een
  // record dat nog "active" is maar voorbij zijn einddatum: de statusflip
  // (sweep of weigermoment) mag de beslissing niet van kleur laten verschieten.
  if (grant.status === "expired") return { ok: false, status: 403, code: "DELEGATED_ACCESS_EXPIRED" };
  if (grant.status !== "active") return { ok: false, status: 403, code: "DELEGATED_ACCESS_NOT_ACTIVE" };
  const nowMs = toMs(ctx.now);
  if (grant.startDate && !(Date.parse(grant.startDate) <= nowMs)) {
    return { ok: false, status: 403, code: "DELEGATED_ACCESS_NOT_ACTIVE" };
  }
  if (grant.endDate && !(Date.parse(grant.endDate) > nowMs)) {
    return { ok: false, status: 403, code: "DELEGATED_ACCESS_EXPIRED" };
  }
  const scopes = Array.isArray(grant.scope) ? grant.scope : [grant.scope].filter(Boolean);
  if (requiredScope && !scopes.includes(requiredScope)) {
    return { ok: false, status: 403, code: "DELEGATED_SCOPE_EXCEEDED" };
  }
  return { ok: true };
}

/** Als delegationDecision, maar gooit bij weigering (vaste boodschap, geen lek). */
function assertDelegation(grant, requiredScope, ctx = {}) {
  const d = delegationDecision(grant, requiredScope, ctx);
  if (!d.ok) throw err(d.status, d.code, "Geen toegang");
  return true;
}

// ── CTO3-07 · centrale gedelegeerde-tenanttoegang ────────────────────────────
// Eén middleware-beslissing voor ELKE tenantinhoudroute: read/write/export/
// support/impersonation zijn AFZONDERLIJKE scopes (read impliceert nooit write).
// Een actieve klant-assignment is NOOIT voldoende · er is altijd een actieve
// delegation grant met de exacte scope nodig. Verlopen/revoked grant faalt dicht.

const DELEGATION_SCOPES = ["read", "write", "export", "support", "impersonation"];

/** Leid de vereiste delegatiescope af uit HTTP-methode + route-actie. */
function scopeForRequest(method, action = "") {
  const a = String(action || "").toLowerCase();
  if (/(^|\/)export($|\/|\?)/.test(a) || a.endsWith("/export")) return "export";
  if (/(^|\/)(impersonat|act-as)/.test(a)) return "impersonation";
  if (/(^|\/)support(\/|$)/.test(a)) return "support";
  const m = String(method || "GET").toUpperCase();
  return (m === "GET" || m === "HEAD") ? "read" : "write";
}

// Gevoelige dataklassen (23.5 + CTO3-07 punt 4): standaard VERBORGEN, ook onder
// een algemene read-grant. Enkel een expliciet toegekende dataklasse ontsluit ze.
const DATA_CLASSES = ["payroll", "bank", "national_number", "medical", "security", "margin"];
const SENSITIVE_FIELD_PATTERNS = {
  payroll: /payroll|salary|wage|loon|nettoloon|brutoloon|gross(pay|salary)|net(pay|salary)/i,
  bank: /iban|(^|_)bic($|_)|bankaccount|accountnumber|rekeningnummer|swift/i,
  national_number: /rijksregister|nationalnumber|national_number|\bssn\b|\bbsn\b|\binsz\b|\bniss\b/i,
  medical: /medical|medisch|health(data)?|gezondheid|diagnos|disability|arbeidsongeval.*medisch/i,
  security: /password|passwordhash|(^|_)secret($|_)|(^|_)token($|_)|mfasecret|mfa_secret|apikey|api_key|privatekey|private_key/i,
  margin: /(^|_)margin($|_)|(^|_)marge($|_)|costprice|cost_price|costrate|cost_rate|kostprijs|inkoopprijs|purchaseprice|providerunitcost|provider_unit_cost/i,
};
const REDACTED = "[REDACTED]";

function classOfKey(key) {
  for (const cls of DATA_CLASSES) if (SENSITIVE_FIELD_PATTERNS[cls].test(String(key))) return cls;
  return null;
}

/**
 * Redigeer gevoelige velden die NIET in allowedClasses zitten (recursief, arrays
 * en geneste objecten). Muteert niet: geeft een gekopieerde, veilige weergave.
 * Standaard (lege allowedClasses) blijft ALLE gevoelige data verborgen.
 */
function redactSensitiveFields(value, allowedClasses = [], seen = new WeakSet()) {
  const allow = new Set(allowedClasses || []);
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      if (seen.has(v)) return v;
      seen.add(v);
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        const cls = classOfKey(k);
        if (cls && !allow.has(cls)) { out[k] = REDACTED; continue; }
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(value);
}

/**
 * DE centrale middleware-beslissing (CTO3-07 punt 2/3/4). Combineert:
 *  - scope-afleiding (read/write/export/support/impersonation) uit method+action;
 *  - de delegation grant-beslissing (delegationDecision · tenant-strikt,
 *    exact-scope, fail-closed op verlopen/revoked);
 *  - welke gevoelige dataklassen deze grant expliciet ontsluit (default geen).
 * Een actieve assignment zonder grant → geweigerd. Alles is auditbaar via de
 * teruggegeven auditcontext.
 *
 * @param {object} o { grant, tenantId, method, action, now, requiredScope? }
 * @returns {{ ok, requiredScope, status?, code?, allowedDataClasses, audit }}
 */
function requireDelegatedTenantAccess(o = {}) {
  const requiredScope = o.requiredScope || scopeForRequest(o.method, o.action);
  const decision = delegationDecision(o.grant, requiredScope, { tenantId: o.tenantId, now: o.now });
  const allowedDataClasses = (o.grant && Array.isArray(o.grant.dataClasses))
    ? o.grant.dataClasses.filter(c => DATA_CLASSES.includes(c))
    : [];
  const audit = {
    resellerId: (o.grant && o.grant.resellerId) || null,
    grantId: (o.grant && o.grant.id) || null,
    tenantId: o.tenantId || null,
    scope: requiredScope,
    action: o.action || null,
    method: o.method || null,
    decision: decision.ok ? "allow" : "deny",
    code: decision.ok ? null : decision.code,
  };
  if (!decision.ok) return { ok: false, requiredScope, status: decision.status, code: decision.code, allowedDataClasses: [], audit };
  return { ok: true, requiredScope, allowedDataClasses, audit };
}

// Route-inventaris (CTO3-07 punt 1): welke gevoelige dataklassen kan een
// tenantinhoudroute retourneren. 100% afgevinkt = elke inhoudsfamilie heeft een
// entry; de default (onbekende route) is de striktste (alles verborgen).
const TENANT_CONTENT_DATA_CLASSES = {
  customers: [], projects: [], planning: [], workorders: [],
  facturen: ["margin"], invoices: ["margin"], payments: ["bank"],
  offertes: ["margin"], quotes: ["margin"],
  employees: ["payroll", "national_number", "bank", "margin"],
  me: [], expenses: [], leaves: ["medical"], incidents: ["medical"],
  payroll: ["payroll", "bank", "national_number"],
  "social-secretariat": ["payroll", "bank", "national_number"],
  docfiles: [], forms: [], "api-keys": ["security"], integrations: ["security"],
  finance: ["margin"], dashboard: ["margin"], insights: ["margin"],
};

/** Dataklassen die een route kan lekken (voor de default-redactie bij delegatie). */
function dataClassesForAction(action = "") {
  const head = String(action || "").split(/[/?]/)[0];
  return TENANT_CONTENT_DATA_CLASSES[head] || [];
}

// ── Anti-probing fouten (23.15/23.17 · ISO-07) ───────────────────────────────
// Vaste boodschappen zodat de body voor een vreemd id en een onbestaand id
// byte-identiek is: bestaan van andermans objecten lekt nooit.

/** Generieke 403 · zelfde boodschap ongeacht of het object bestaat. */
function forbiddenError(code) { return err(403, code || "RESELLER_FORBIDDEN", "Geen toegang"); }

/** Expliciete cross-scope-parameter (bv. vreemde resellerId): harde weigering. */
function scopeViolationError() { return err(403, "RESELLER_SCOPE_VIOLATION", "Geen toegang"); }

/** 404 met vaste code per soort ("deal" → DEAL_NOT_FOUND) en vaste boodschap. */
function notFoundError(kind) {
  const k = String(kind || "resource").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return err(404, `${k}_NOT_FOUND`, "Niet gevonden");
}

module.exports = {
  RESELLER_PERMISSIONS, SCOPES, SCOPE_ORDER, BUILTIN_GRANTS, RESELLER_ROLES,
  SENSITIVE_DENY, FOUR_EYES_PERMISSIONS, SUSPENSION_ALLOWED, MFA_REQUIRED_ROLES,
  roleOf, parseGrant, grantFor, tenantInScope, canResellerAction,
  requiresFourEyes, assertNotSelfApproval, suspensionBlocks, requiresMfa,
  delegationDecision, assertDelegation,
  forbiddenError, scopeViolationError, notFoundError,
  // CTO3-07 · centrale gedelegeerde tenanttoegang + veldrechten
  DELEGATION_SCOPES, DATA_CLASSES, SENSITIVE_FIELD_PATTERNS, REDACTED,
  TENANT_CONTENT_DATA_CLASSES,
  scopeForRequest, redactSensitiveFields, requireDelegatedTenantAccess,
  dataClassesForAction, classOfKey,
};
