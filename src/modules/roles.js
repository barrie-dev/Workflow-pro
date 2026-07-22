"use strict";

// ── Samenstelbare profielen · custom rollen (maturiteit #75) ─────────────────
// Een organisatie is niet gebonden aan de drie ingebouwde rollen (tenant_admin,
// manager, employee). Een tenant-admin STELT ZELF een profiel samen uit
// granulaire rechten - ook een rol die wij nooit bedachten (bv. "Werfleider met
// margezicht", "Boekhouder zonder planning", "Preventieadviseur"). Het profiel
// is een benoemde, herbruikbare set rechten (met scope per recht) die aan
// meerdere gebruikers wordt toegekend.
//
// Rechten-gedreven, tenant-veilig en auditbaar (zie [[feedback-een-portaal-rechten]]):
//  - een recht is enkel toekenbaar als de tenant er recht op heeft
//    (operationeel ∩ entitlements) of het een expliciet delegeerbaar
//    beheerrecht is · NOOIT platform-/cross-tenant-rechten (escalatiegrens);
//  - de policy-engine (platform/policy.js) blijft de enige handhaver: een rol
//    levert alleen de effectieve permissions-set aan de gebruiker;
//  - elke wijziging schrijft een auditregel.

const { grantablePermissions } = require("./entitlements");

function unique(arr) { return [...new Set(arr)]; }
function clean(v) { return String(v == null ? "" : v).trim(); }

// Beheerrechten die een tenant-admin MAG delegeren naar een samengesteld profiel.
// Bewust NIET: 'tenants' (platform), 'billing' (abonnement/checkout) en '*'
// (alles) · die blijven bij de primaire beheerder om privilege-escalatie te
// voorkomen. 'costs.view' is een zichtbaarheidsrecht (gevoelige velden), geen
// module: het ontsluit kostprijzen/marges (zie policy.canSeeSensitive).
const ADMIN_DELEGATABLE = [
  { key: "settings", label: "Instellingen", group: "beheer", scopes: ["all", "read"] },
  { key: "audit", label: "Auditlog", group: "beheer", scopes: ["all", "read"] },
  { key: "integrations", label: "Integraties", group: "beheer", scopes: ["all", "read"] },
  { key: "employees", label: "Medewerkers", group: "beheer", scopes: ["all", "team", "read"] },
  { key: "alerts", label: "Meldingen & signalen", group: "beheer", scopes: ["all", "read"] },
  { key: "costs.view", label: "Kostprijzen & marges zichtbaar", group: "financieel", scopes: ["all"], sensitive: true },
  // Canonieke veld-zichtbaarheidsrechten (Forms h3 · FORM-03): granulaire toegang
  // tot gevoelige velden, zodat een organisatie een finance- of HR-profiel kan
  // samenstellen zonder de beheerdersrol. Bijzondere categorieën (salaris/medisch)
  // en secrets zijn NOOIT automatisch zichtbaar - enkel via deze expliciete rechten.
  { key: "field.cost_price.view", label: "Kostprijsveld zichtbaar", group: "financieel", scopes: ["all"], sensitive: true },
  { key: "field.margin.view", label: "Margeveld zichtbaar", group: "financieel", scopes: ["all"], sensitive: true },
  { key: "field.bank_account.view", label: "Bankrekeningveld zichtbaar", group: "financieel", scopes: ["all"], sensitive: true },
  { key: "field.salary.view", label: "Salarisveld zichtbaar", group: "hr", scopes: ["all"], sensitive: true },
  { key: "field.medical.view", label: "Medisch veld zichtbaar", group: "hr", scopes: ["all"], sensitive: true },
  { key: "field.security_secret.view", label: "Beveiligingsgeheim zichtbaar", group: "beveiliging", scopes: ["all"], sensitive: true },
  // Forms-rechtendomein (CTO2-02 · h3): granulaire formulierrechten voor
  // samengestelde profielen. Instance-rechten kennen een scope (own/team/all);
  // beheer-, rapport- en retentierechten zijn tenant-breed.
  { key: "forms.definition.view", label: "Formulierdefinities bekijken", group: "formulieren", scopes: ["all"] },
  { key: "forms.definition.manage", label: "Formulieren beheren (bouwen/toewijzen)", group: "formulieren", scopes: ["all"], sensitive: true },
  { key: "forms.definition.publish", label: "Formulierversies publiceren", group: "formulieren", scopes: ["all"], sensitive: true },
  { key: "forms.instance.create", label: "Formulieren starten", group: "formulieren", scopes: ["all", "team", "own"] },
  { key: "forms.instance.view", label: "Ingevulde formulieren bekijken", group: "formulieren", scopes: ["all", "team", "own"] },
  { key: "forms.instance.edit", label: "Formulieren bewerken", group: "formulieren", scopes: ["all", "team", "own"] },
  { key: "forms.instance.submit", label: "Formulieren indienen", group: "formulieren", scopes: ["all", "team", "own"] },
  { key: "forms.instance.withdraw", label: "Formulieren intrekken", group: "formulieren", scopes: ["all", "team", "own"] },
  { key: "forms.approve", label: "Formulieren goedkeuren", group: "formulieren", scopes: ["all", "team", "own"], sensitive: true },
  { key: "forms.sign", label: "Formulieren ondertekenen", group: "formulieren", scopes: ["all", "team", "own"], sensitive: true },
  { key: "forms.assign", label: "Formulieren toewijzen", group: "formulieren", scopes: ["all"], sensitive: true },
  { key: "forms.report", label: "Formulierrapportage", group: "formulieren", scopes: ["all"] },
  { key: "forms.export", label: "Formulierexport en downloads", group: "formulieren", scopes: ["all"], sensitive: true },
  { key: "forms.retention.manage", label: "Formulierretentie beheren", group: "formulieren", scopes: ["all"], sensitive: true },
];
const ADMIN_DELEGATABLE_KEYS = new Set(ADMIN_DELEGATABLE.map(a => a.key));

// Nooit toekenbaar aan een samengesteld profiel (escalatiegrens).
const FORBIDDEN_KEYS = new Set(["tenants", "billing", "*", "reseller_tenants", "support_grant"]);

// De ingebouwde rollen · als alleen-lezen referentie in de UI (niet bewerkbaar).
const BUILTIN_ROLES = [
  { key: "tenant_admin", name: "Beheerder", description: "Volledige toegang binnen de organisatie.", builtin: true },
  { key: "manager", name: "Teamleider", description: "Team plannen en goedkeuren; geen instellingen/facturatie.", builtin: true },
  { key: "employee", name: "Medewerker", description: "Enkel eigen planning, uren, onkosten en werkbonnen.", builtin: true },
];

const SCOPE_LABELS = { all: "Volledig", team: "Team", own: "Eigen", read: "Alleen lezen" };

/** Ontleed een recht-string naar { scope, key } (scope-prefix losgekoppeld). */
function splitScope(raw) {
  const p = clean(raw);
  if (p.startsWith("read:")) return { scope: "read", key: p.slice(5) };
  if (p.startsWith("team:")) return { scope: "team", key: p.slice(5) };
  if (p.startsWith("own:")) return { scope: "own", key: p.slice(4) };
  return { scope: "all", key: p };
}

/** Herstel de recht-string uit { scope, key }. */
function joinScope(scope, key) {
  if (scope === "read") return `read:${key}`;
  if (scope === "team") return `team:${key}`;
  if (scope === "own") return `own:${key}`;
  return key;
}

/**
 * De rechtencatalogus die de tenant-admin mag samenstellen tot een profiel.
 * Operationeel is beperkt tot wat de tenant heeft (entitlements); beheer is de
 * delegeerbare set. Dit voedt zowel de UI (rol-builder) als de validatie.
 */
function permissionCatalog(store, tenant) {
  const operational = grantablePermissions(store, tenant).map(g => ({
    key: g.key, label: g.label, group: "operationeel", scopes: ["all", "team", "own", "read"],
  }));
  return {
    scopes: SCOPE_LABELS,
    groups: ["operationeel", "beheer", "financieel", "hr", "beveiliging", "formulieren"],
    operational,
    admin: ADMIN_DELEGATABLE,
    forbidden: [...FORBIDDEN_KEYS],
  };
}

/** Set van alle recht-KEYS (zonder scope) die deze tenant in een rol mag zetten. */
function grantableKeySet(store, tenant) {
  const set = new Set(grantablePermissions(store, tenant).map(g => g.key));
  for (const k of ADMIN_DELEGATABLE_KEYS) set.add(k);
  return set;
}

/**
 * Valideer + normaliseer de rechten van een profiel tegen wat deze tenant mag
 * toekennen. Onbekende, verboden of niet-geëntitelde rechten worden GEWEIGERD
 * (niet stil genegeerd): de admin krijgt te horen wat niet kon.
 * @returns {{ permissions: string[], rejected: string[] }}
 */
function validateRolePermissions(store, tenant, requested) {
  const allowed = grantableKeySet(store, tenant);
  const out = [], rejected = [];
  for (const raw of Array.isArray(requested) ? requested : []) {
    const { scope, key } = splitScope(raw);
    if (!key || FORBIDDEN_KEYS.has(key)) { rejected.push(clean(raw)); continue; }
    // costs.view is een zichtbaarheidsrecht zonder scope-varianten.
    if (key === "costs.view") { out.push("costs.view"); continue; }
    if (!allowed.has(key)) { rejected.push(clean(raw)); continue; }
    out.push(joinScope(scope, key));
  }
  return { permissions: unique(out), rejected };
}

/**
 * Effectieve rechten van een gebruiker: als hij een samengesteld profiel draagt
 * (roleId), de rechten van dat profiel VERENIGD met zijn directe rechten. Zo
 * blijft een individuele uitzondering bovenop een profiel mogelijk. Een
 * verwijderd/onbekend profiel valt veilig terug op de directe rechten.
 */
function effectivePermissions(store, user) {
  const direct = Array.isArray(user && user.permissions) ? user.permissions : [];
  if (!user || !user.roleId) return direct;
  const role = (store.data.roles || []).find(r => r.id === user.roleId && r.tenantId === user.tenantId && !r.builtin);
  if (!role) return direct;
  return unique([...(role.permissions || []), ...direct]);
}

/**
 * Geef een KLOON van de gebruiker terug met de effectieve rechten ingevuld,
 * zodat de policy-engine (die user.permissions leest) het profiel meeneemt.
 * De opgeslagen gebruiker wordt NIET gemuteerd (roleId + directe rechten blijven).
 */
function withEffectivePermissions(store, user) {
  if (!user) return user;
  const eff = effectivePermissions(store, user);
  if (eff === user.permissions) return user;
  return { ...user, permissions: eff };
}

// ── CRUD op samengestelde profielen (tenant-scoped, auditbaar) ───────────────

function listRoles(store, tenantId) {
  const custom = (store.data.roles || [])
    .filter(r => r.tenantId === tenantId && !r.builtin && !r.locked)
    .map(r => publicRole(r, store, tenantId));
  return { builtin: BUILTIN_ROLES, custom };
}

function publicRole(r, store, tenantId) {
  const assigned = (store.data.users || []).filter(u => u.tenantId === tenantId && u.roleId === r.id).length;
  return {
    id: r.id, key: r.key, name: r.name, description: r.description || "",
    permissions: r.permissions || [], assignedCount: assigned,
    builtin: false, createdAt: r.createdAt, updatedAt: r.updatedAt, version: r.version || 1,
  };
}

function slugify(name) {
  return clean(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "profiel";
}

function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }

/** Maak een samengesteld profiel. `actor` = tekst voor de auditregel. */
function createRole(store, tenant, actor, body = {}) {
  const name = clean(body.name);
  if (name.length < 2) throw err(400, "ROLE_NAME_REQUIRED", "Een profiel heeft een naam nodig (min. 2 tekens).");
  const tenantId = tenant.id;
  const existing = (store.data.roles || []).filter(r => r.tenantId === tenantId && !r.builtin);
  if (existing.some(r => r.name.toLowerCase() === name.toLowerCase())) {
    throw err(409, "ROLE_NAME_TAKEN", `Er bestaat al een profiel met de naam "${name}".`);
  }
  if (BUILTIN_ROLES.some(b => b.name.toLowerCase() === name.toLowerCase() || b.key === slugify(name))) {
    throw err(409, "ROLE_NAME_RESERVED", "Die naam is voorbehouden aan een ingebouwde rol.");
  }
  const { permissions, rejected } = validateRolePermissions(store, tenant, body.permissions);
  if (rejected.length) throw err(400, "ROLE_PERMISSIONS_REJECTED", `Niet-toekenbare rechten: ${rejected.join(", ")}.`);
  if (!permissions.length) throw err(400, "ROLE_PERMISSIONS_EMPTY", "Een profiel moet minstens één recht bevatten.");

  const now = new Date().toISOString();
  let key = slugify(name), n = 1;
  while (existing.some(r => r.key === key)) key = `${slugify(name)}_${++n}`;
  const role = {
    id: `role_${require("crypto").randomBytes(8).toString("hex")}`,
    tenantId, key, name, description: clean(body.description).slice(0, 400),
    permissions, builtin: false, locked: false, createdAt: now, updatedAt: now, version: 1,
  };
  if (!Array.isArray(store.data.roles)) store.data.roles = [];
  store.data.roles.push(role);
  store.audit({ tenantId, actor, action: "role.created", area: "settings", detail: `Profiel "${name}" (${permissions.length} rechten)` });
  if (typeof store.save === "function") store.save();
  return publicRole(role, store, tenantId);
}

function updateRole(store, tenant, actor, roleId, body = {}) {
  const tenantId = tenant.id;
  const role = (store.data.roles || []).find(r => r.id === roleId && r.tenantId === tenantId);
  if (!role) throw err(404, "ROLE_NOT_FOUND", "Profiel niet gevonden.");
  if (role.builtin || role.locked) throw err(409, "ROLE_LOCKED", "Een ingebouwd profiel kan niet worden bewerkt.");

  if (body.name !== undefined) {
    const name = clean(body.name);
    if (name.length < 2) throw err(400, "ROLE_NAME_REQUIRED", "Een profiel heeft een naam nodig (min. 2 tekens).");
    if ((store.data.roles || []).some(r => r.tenantId === tenantId && !r.builtin && r.id !== roleId && r.name.toLowerCase() === name.toLowerCase())) {
      throw err(409, "ROLE_NAME_TAKEN", `Er bestaat al een profiel met de naam "${name}".`);
    }
    role.name = name;
  }
  if (body.description !== undefined) role.description = clean(body.description).slice(0, 400);
  if (body.permissions !== undefined) {
    const { permissions, rejected } = validateRolePermissions(store, tenant, body.permissions);
    if (rejected.length) throw err(400, "ROLE_PERMISSIONS_REJECTED", `Niet-toekenbare rechten: ${rejected.join(", ")}.`);
    if (!permissions.length) throw err(400, "ROLE_PERMISSIONS_EMPTY", "Een profiel moet minstens één recht bevatten.");
    role.permissions = permissions;
  }
  role.updatedAt = new Date().toISOString();
  role.version = (role.version || 1) + 1;
  store.audit({ tenantId, actor, action: "role.updated", area: "settings", detail: `Profiel "${role.name}" (v${role.version})` });
  if (typeof store.save === "function") store.save();
  return publicRole(role, store, tenantId);
}

function deleteRole(store, tenant, actor, roleId) {
  const tenantId = tenant.id;
  const role = (store.data.roles || []).find(r => r.id === roleId && r.tenantId === tenantId);
  if (!role) throw err(404, "ROLE_NOT_FOUND", "Profiel niet gevonden.");
  if (role.builtin || role.locked) throw err(409, "ROLE_LOCKED", "Een ingebouwd profiel kan niet worden verwijderd.");
  const assigned = (store.data.users || []).filter(u => u.tenantId === tenantId && u.roleId === roleId);
  if (assigned.length) throw err(409, "ROLE_IN_USE", `Dit profiel is nog toegewezen aan ${assigned.length} gebruiker(s). Wijs hen eerst een ander profiel toe.`);
  store.data.roles = (store.data.roles || []).filter(r => r.id !== roleId);
  store.audit({ tenantId, actor, action: "role.deleted", area: "settings", detail: `Profiel "${role.name}" verwijderd` });
  if (typeof store.save === "function") store.save();
  return { ok: true };
}

/** Valideer een roleId voor toewijzing aan een gebruiker (bestaat + zelfde tenant). */
function resolveAssignableRole(store, tenantId, roleId) {
  if (!roleId) return null;
  const role = (store.data.roles || []).find(r => r.id === roleId && r.tenantId === tenantId && !r.builtin && !r.locked);
  if (!role) throw err(400, "ROLE_NOT_ASSIGNABLE", "Onbekend of niet-toekenbaar profiel.");
  return role;
}

module.exports = {
  permissionCatalog, validateRolePermissions, effectivePermissions, withEffectivePermissions,
  listRoles, createRole, updateRole, deleteRole, resolveAssignableRole,
  splitScope, joinScope, BUILTIN_ROLES, ADMIN_DELEGATABLE, FORBIDDEN_KEYS,
};
