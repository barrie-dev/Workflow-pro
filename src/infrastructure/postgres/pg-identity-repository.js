"use strict";
/**
 * Identity-repository op genormaliseerde PostgreSQL-tabellen (CTO P0-01,
 * handover 5.4 · tweede domein na CRM).
 *
 * Kernprincipe: de pg-rij is een VERLIESVRIJE projectie van het legacy-object.
 * Kernvelden worden kolommen (querybaar, geïndexeerd), authenticatie-internals
 * gaan als 'security'-document mee en alle overige velden verbatim in
 * 'attributes'. rowToUser() reconstrueert daaruit het volledige object.
 *
 * Vergelijken gebeurt ALTIJD op de canonieke projectie (projectUser), nooit op
 * het rauwe legacy-object: null-versus-afwezig en tijdstempelformaten zouden
 * anders valse afwijkingen geven. Legacy → projectie en pg-rij → projectie
 * moeten identiek uitkomen; dat is de reconciliatie-eis.
 *
 * De sync is een SET-SYNC over het volledige platform-snapshot: upsert wat
 * er is, verwijder wat er niet meer is. Dat mag hier · de legacy-store IS het
 * volledige platform · en het maakt de sync idempotent herhaalbaar. De
 * 'fingerprint'-kolom voorkomt dat ongewijzigde rijen een UPDATE (en
 * updated_at-ruis) opleveren.
 */

const crypto = require("crypto");

function clean(v) { return String(v == null ? "" : v).trim(); }

/** Stabiele serialisatie: objectsleutels gesorteerd, undefined weggelaten. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .filter(k => value[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}
function hashOf(projection) {
  return crypto.createHash("sha256").update(stableStringify(projection)).digest("hex");
}

// Kernvelden die eigen kolommen krijgen; al de rest reist mee in documenten.
const CORE_FIELDS = ["id", "tenantId", "email", "name", "role", "active", "passwordHash", "lastLoginAt", "mfaEnabled"];
// Authenticatie-internals: apart document, zodat een latere kolomsplitsing of
// strenger toegangsbeleid één plek raakt.
const SECURITY_FIELDS = ["mfaSecret", "mfaPendingSecret", "mfaEnforced", "recoveryCodes",
  "failedLoginCount", "failedLogins", "loginAttempts", "lockedUntil"];

function isoOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Legacy-object → canonieke projectie (de vorm die de tabel draagt). */
function projectUser(user) {
  const security = {};
  const attributes = {};
  for (const [k, v] of Object.entries(user)) {
    if (CORE_FIELDS.includes(k)) continue;
    if (SECURITY_FIELDS.includes(k)) security[k] = v === undefined ? null : v;
    else attributes[k] = v === undefined ? null : v;
  }
  return {
    id: clean(user.id),
    tenantId: clean(user.tenantId) || null,
    email: clean(user.email),
    name: clean(user.name),
    role: clean(user.role),
    active: user.active !== false,
    passwordHash: user.passwordHash || null,
    lastLoginAt: isoOrNull(user.lastLoginAt),
    mfaEnabled: user.mfaEnabled === true,
    security, attributes,
  };
}

/** pg-rij → dezelfde canonieke projectie (voor reconciliatie en shadow-read). */
function projectRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id || null,
    email: row.email,
    name: row.name,
    role: row.role,
    active: row.active === true,
    passwordHash: row.password_hash || null,
    lastLoginAt: isoOrNull(row.last_login_at),
    mfaEnabled: row.mfa_enabled === true,
    security: row.security || {},
    attributes: row.attributes || {},
  };
}

function userFingerprint(user) { return hashOf(projectUser(user)); }

/** Rij → legacy-vormig object (documentvelden verbatim, kernvelden uit kolommen). */
function rowToUser(row) {
  if (!row) return null;
  const p = projectRow(row);
  return {
    ...p.attributes,
    ...p.security,
    id: p.id, tenantId: p.tenantId, email: p.email, name: p.name, role: p.role,
    active: p.active, passwordHash: p.passwordHash, lastLoginAt: p.lastLoginAt,
    mfaEnabled: p.mfaEnabled,
  };
}

function projectTenant(tenant) {
  const { id, name, plan, status, billingEmail, ...rest } = tenant || {};
  const attributes = {};
  for (const [k, v] of Object.entries(rest)) attributes[k] = v === undefined ? null : v;
  return {
    id: clean(id),
    name: clean(name) || clean(id),
    plan: clean(plan) || "starter",
    status: ["active", "suspended", "archived"].includes(clean(status)) ? clean(status) : "active",
    billingEmail: clean(billingEmail) || null,
    attributes,
  };
}
function tenantFingerprint(tenant) { return hashOf(projectTenant(tenant)); }

function rowToTenant(row) {
  if (!row) return null;
  const tenant = { ...row.attributes, id: row.id, name: row.name, plan: row.plan, status: row.status };
  if (row.billing_email != null) tenant.billingEmail = row.billing_email;
  return tenant;
}

const USER_COLUMNS = "id, tenant_id, email, name, role, active, password_hash, last_login_at, mfa_enabled, security, attributes, fingerprint";

/**
 * Volledige platform-sync in één transactie: tenants eerst (FK-anker), dan
 * gebruikers, dan verwijderen wat uit de bron verdween. Idempotent: een
 * tweede run met dezelfde bron doet nul updates (fingerprint-poort).
 */
async function syncIdentity(pool, { tenants = [], users = [] }) {
  const client = await pool.connect();
  const result = { tenantsUpserted: 0, usersUpserted: 0, usersDeleted: 0 };
  try {
    await client.query("BEGIN");

    for (const tenant of tenants) {
      const p = projectTenant(tenant);
      if (!p.id) continue;
      const res = await client.query(
        `INSERT INTO tenants (id, name, plan, status, billing_email, attributes, fingerprint)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name, plan = excluded.plan, status = excluded.status,
           billing_email = excluded.billing_email, attributes = excluded.attributes,
           fingerprint = excluded.fingerprint, version = tenants.version + 1
         WHERE tenants.fingerprint IS DISTINCT FROM excluded.fingerprint
         RETURNING id`,
        [p.id, p.name, p.plan, p.status, p.billingEmail, p.attributes, hashOf(p)]);
      result.tenantsUpserted += res.rows.length;
    }

    const ids = [];
    for (const user of users) {
      const p = projectUser(user);
      // Onvolledige rij: overslaan zodat de sync niet crasht; de reconciliatie
      // meldt hem als missingInPg, dus hij verdwijnt niet stil.
      if (!p.id || !p.email || !p.role) continue;
      ids.push(p.id);
      const res = await client.query(
        `INSERT INTO users (${USER_COLUMNS})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           tenant_id = excluded.tenant_id, email = excluded.email, name = excluded.name,
           role = excluded.role, active = excluded.active, password_hash = excluded.password_hash,
           last_login_at = excluded.last_login_at, mfa_enabled = excluded.mfa_enabled,
           security = excluded.security, attributes = excluded.attributes,
           fingerprint = excluded.fingerprint, version = users.version + 1
         WHERE users.fingerprint IS DISTINCT FROM excluded.fingerprint
         RETURNING id`,
        [p.id, p.tenantId, p.email, p.name, p.role, p.active, p.passwordHash,
          p.lastLoginAt, p.mfaEnabled, p.security, p.attributes, hashOf(p)]);
      result.usersUpserted += res.rows.length;
    }

    // Set-sync: de bron is het VOLLEDIGE platform, dus wat daar niet meer in
    // zit is echt verwijderd. Dit is (naast de CRM-child-backfill) de enige
    // plek waar een sync verwijdert · bewust en gedocumenteerd.
    const del = await client.query(
      ids.length ? `DELETE FROM users WHERE NOT (id = ANY($1::text[])) RETURNING id`
                 : `DELETE FROM users RETURNING id`,
      ids.length ? [ids] : []);
    result.usersDeleted = del.rows.length;

    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Globale login-lookup (geen tenantcontext · e-mail is globaal uniek). */
async function findUserByEmail(pool, email) {
  const e = clean(email).toLowerCase();
  if (!e) return null;
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = $1`, [e]);
  return rows.length ? rowToUser(rows[0]) : null;
}

async function findUserById(pool, id) {
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [clean(id)]);
  return rows.length ? rowToUser(rows[0]) : null;
}

/** Lijst per tenant of per rol (platform-operatie; predicate = eerste linie). */
async function listUsers(pool, { tenantId = null, role = null } = {}) {
  const where = [];
  const params = [];
  if (tenantId) { params.push(tenantId); where.push(`tenant_id = $${params.length}`); }
  if (role) { params.push(role); where.push(`role = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id ASC`, params);
  return rows.map(rowToUser);
}

/**
 * Reconciliatie: vergelijk het volledige legacy-snapshot met de tabellen op
 * canonieke projectie. Geen steekproef: elke gebruiker, beide richtingen
 * (afwijkend, ontbrekend én overtollig). De pg-kant wordt HERBEREKEND uit de
 * kolommen · zo valt ook drift op die buiten de sync om zou ontstaan.
 */
async function reconcileIdentity(pool, { users = [] }) {
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users`);
  const pgById = new Map(rows.map(r => [r.id, r]));
  const legacyIds = new Set();
  const mismatches = [];
  const missingInPg = [];

  for (const user of users) {
    const id = clean(user.id);
    legacyIds.add(id);
    const row = pgById.get(id);
    if (!row) { missingInPg.push(id); continue; }
    if (hashOf(projectUser(user)) !== hashOf(projectRow(row))) mismatches.push(id);
  }
  const extraInPg = rows.map(r => r.id).filter(id => !legacyIds.has(id));

  return {
    ok: mismatches.length === 0 && missingInPg.length === 0 && extraInPg.length === 0,
    checked: users.length,
    mismatches, missingInPg, extraInPg,
  };
}

module.exports = {
  projectUser, projectRow, rowToUser, userFingerprint,
  projectTenant, rowToTenant, tenantFingerprint,
  syncIdentity, findUserByEmail, findUserById, listUsers, reconcileIdentity,
  stableStringify,
};
