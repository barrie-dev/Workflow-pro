"use strict";
/**
 * Policy engine (master-spec E02, h8 · R0-c).
 *
 * Eén centrale plek die rol + permissieniveau vertaalt naar een beslissing
 * (zichtbaar? schrijfbaar?) en een dossierscope. Permissiestrings:
 *
 *   "X"       → tenant-breed schrijven
 *   "team:X"  → schrijven, beperkt tot het eigen team (NIEUW, h8.1)
 *   "own:X"   → schrijven, beperkt tot eigen records
 *   "read:X"  → tenant-breed alleen-lezen
 *   afwezig   → geen toegang
 *
 * Precedentie bij meerdere niveaus: X > team:X > own:X > read:X.
 * super_admin en "*" omzeilen alles (tenant-scope, schrijfbaar).
 *
 * h8.1 kent ook project-, company-, assigned_customers-, reseller_tenants- en
 * support_grant-scopes. reseller en support_grant bestaan al als aparte flows;
 * project- en company-scope volgen met het project-aggregate (E04) en
 * multi-company. Dit model is daarop voorbereid (scope is een string).
 *
 * h8.2 gevoelige velden: redactSensitive() strippt kost-, marge- en bankvelden
 * voor niet-beheerders. Het register dekt ook velden die pas met latere
 * modules (catalogus, leveranciers, projectfinance) ontstaan, zodat de
 * handhaving er al staat op de dag dat de data verschijnt.
 *
 * lib/auth.js delegeert can/canWrite/ownScopeOnly hierheen (compatibiliteit:
 * bestaande signatures en gedrag blijven identiek; team:X komt erbij).
 */

const SCOPE_RANK = { tenant: 3, team: 2, own: 1 };

/** Ontleed één permissiestring naar { key, scope, write }. */
function parsePermission(raw) {
  const p = String(raw || "");
  if (p.startsWith("read:")) return { key: p.slice(5), scope: "tenant", write: false };
  if (p.startsWith("team:")) return { key: p.slice(5), scope: "team", write: true };
  if (p.startsWith("own:")) return { key: p.slice(4), scope: "own", write: true };
  return { key: p, scope: "tenant", write: true };
}

/**
 * Centrale toegangsbeslissing voor één permissiesleutel.
 * @returns {{ visible:boolean, writable:boolean, scope:"tenant"|"team"|"own"|null }}
 */
function resolveAccess(user, permissionKey) {
  if (!user) return { visible: false, writable: false, scope: null };
  if (user.role === "super_admin") return { visible: true, writable: true, scope: "tenant" };
  const perms = user.permissions || [];
  if (perms.includes("*")) return { visible: true, writable: true, scope: "tenant" };

  let best = null;
  for (const raw of perms) {
    const p = parsePermission(raw);
    if (p.key !== permissionKey) continue;
    if (!best) { best = p; continue; }
    // Hoogste scope wint; bij gelijke scope wint schrijven boven lezen.
    const rank = SCOPE_RANK[p.scope] - SCOPE_RANK[best.scope];
    if (rank > 0 || (rank === 0 && p.write && !best.write)) best = p;
  }
  if (!best) return { visible: false, writable: false, scope: null };
  return { visible: true, writable: best.write, scope: best.scope };
}

/** Mag zien (elk niveau)? Zelfde semantiek als het historische can(). */
function can(user, permissionKey) {
  return resolveAccess(user, permissionKey).visible;
}

/** Mag wijzigen (niet bij read:)? Zelfde semantiek als het historische canWrite(). */
function canWrite(user, permissionKey) {
  return resolveAccess(user, permissionKey).writable;
}

/**
 * Dossierscope-beperking voor lijsten: "own", "team" of null (= volledig).
 * ownScopeOnly() uit lib/auth blijft de pure eigen-data-variant.
 */
function scopeOnly(user, permissionKey) {
  const a = resolveAccess(user, permissionKey);
  if (!a.visible) return null; // endpoint-asserts vangen dit; geen dubbele poort
  return a.scope === "tenant" ? null : a.scope;
}

/** Ledenlijst van het team van deze gebruiker (incl. zichzelf). */
function teamMemberIds(store, user) {
  if (!user.teamId) return [user.id];
  return (store.data.users || [])
    .filter(u => u.tenantId === user.tenantId && u.teamId === user.teamId)
    .map(u => u.id);
}

/**
 * Pas de dossierscope toe op rijen (GDPR: rij-niveau, namen blijven leesbaar).
 * @param {string[]} ownerFields velden die eigenaarschap dragen (bv. userId, assignedTo)
 */
function applyScope(store, user, permissionKey, rows, ownerFields = ["userId"]) {
  const scope = scopeOnly(user, permissionKey);
  if (!scope) return rows;
  const allowed = scope === "own" ? new Set([user.id]) : new Set(teamMemberIds(store, user));
  return rows.filter(r => ownerFields.some(f => allowed.has(r[f])));
}

// ── Gevoelige velden (h8.2) ──────────────────────────────────────────────────
// Alleen beheerders (tenant_admin/super_admin) zien deze velden. Het register
// dekt ook toekomstige modules zodat handhaving vóór de data bestaat.
const SENSITIVE_FIELDS = {
  // costRates (meervoud) is de tariefhistoriek op de personeelsfiche (h16):
  // zonder deze regel zou die via het universele grid alsnog zichtbaar zijn.
  employees: ["costRate", "costRates", "hourlyRate", "salary"],
  articles: ["costPrice", "cost"],
  quotes: ["costPrice", "marginPct"],
  suppliers: ["iban", "bankAccount"],
  customers: ["creditLimit"],
  projects: ["margin", "forecast", "budgetCost", "budgetAmount"],
};

function canSeeSensitive(user) {
  if (!user) return false;
  if (["tenant_admin", "super_admin"].includes(user.role)) return true;
  // Samenstelbaar profiel (#75): een expliciet 'costs.view'-recht ontsluit
  // kostprijzen/marges, zodat een organisatie een financieel profiel kan
  // samenstellen zonder het de beheerdersrol te geven. De permissions-set is de
  // EFFECTIEVE set (rol + directe rechten), ingevuld door authenticate().
  return (user.permissions || []).some(p => String(p).replace(/^(read:|team:|own:)/, "") === "costs.view");
}

/** Strip gevoelige velden voor niet-beheerders; accepteert record of array. */
function redactSensitive(user, resource, rowOrRows) {
  const fields = SENSITIVE_FIELDS[resource];
  if (!fields || canSeeSensitive(user)) return rowOrRows;
  const strip = row => {
    if (!row || typeof row !== "object") return row;
    const clean = { ...row };
    for (const f of fields) delete clean[f];
    return clean;
  };
  return Array.isArray(rowOrRows) ? rowOrRows.map(strip) : strip(rowOrRows);
}

module.exports = {
  parsePermission,
  resolveAccess,
  can,
  canWrite,
  scopeOnly,
  teamMemberIds,
  applyScope,
  SENSITIVE_FIELDS,
  canSeeSensitive,
  redactSensitive,
};
