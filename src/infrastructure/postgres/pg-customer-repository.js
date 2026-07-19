"use strict";
/**
 * CRM-repository op genormaliseerde PostgreSQL-tabellen (handover 4.1 + 5.4).
 *
 * Eerste domein van de strangler-migratie. Implementeert hetzelfde contract als
 * de compatibility repository in src/platform/crm.js, zodat de cutover een
 * bronwissel is en geen herschrijving van aanroepende code.
 *
 * ── Tenantisolatie in twee lagen (handover 5.3) ─────────────────────────────
 * 1. Elke query draagt tenant_id in het predicate (repository-laag).
 * 2. Elke transactie zet `app.tenant_id`, waarop de RLS-policies filteren
 *    (database-laag).
 * Beide, niet één van beide: 5.5 verbiedt expliciet "RLS vervangen door
 * uitsluitend backendfilters", en een predicate alleen is kwetsbaar voor een
 * vergeten WHERE.
 *
 * Updates gebruiken optimistic locking op `version` (4.1). Meerdere writes
 * binnen één use case lopen in één transactie.
 */

const { newUlid } = require("../../platform/events");

function clean(v) { return String(v == null ? "" : v).trim(); }
function nullable(v) { const s = clean(v); return s || null; }

/** Rij → canoniek klantobject (zelfde vorm als de compatibility repository). */
function rowToCustomer(row, contacts = [], addresses = []) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    companyId: row.company_id || null,
    customerNumber: row.customer_number || null,
    name: row.name,
    email: row.email || "",
    phone: row.phone || "",
    vatNumber: row.vat_number || "",
    language: row.language,
    status: row.status,
    creditLimit: row.credit_limit == null ? null : Number(row.credit_limit),
    paymentTermsDays: Number(row.payment_terms_days),
    priceGroup: row.price_group || null,
    notes: row.notes || "",
    customFields: row.custom_fields || {},
    contacts: contacts.map(c => ({
      id: c.id, firstName: c.first_name || "", lastName: c.last_name || "",
      email: c.email || "", phone: c.phone || "", role: c.role || "", isPrimary: c.is_primary === true,
    })),
    addresses: addresses.map(a => ({
      id: a.id, type: a.type, street: a.street || "", number: a.number || "",
      postalCode: a.postal_code || "", city: a.city || "", country: a.country, isPrimary: a.is_primary === true,
    })),
    version: Number(row.version),
    createdAt: row.created_at, createdBy: row.created_by,
    updatedAt: row.updated_at, updatedBy: row.updated_by,
    archivedAt: row.archived_at, archivedBy: row.archived_by,
  };
}

/**
 * Voer werk uit binnen één transactie MET tenantcontext, zodat de RLS-policies
 * grijpen. SET LOCAL geldt alleen binnen de transactie en lekt dus nooit naar
 * een volgende query op dezelfde pooled connectie.
 */
async function withTenant(pool, tenantId, work) {
  const t = clean(tenantId);
  if (!t) { const e = new Error("tenantId is verplicht"); e.status = 400; e.code = "TENANT_REQUIRED"; throw e; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [t]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const CUSTOMER_COLUMNS = `id, tenant_id, company_id, customer_number, name, email, phone, vat_number,
  language, status, credit_limit, payment_terms_days, price_group, notes, custom_fields,
  created_at, updated_at, created_by, updated_by, version, archived_at, archived_by`;

function makePgCustomerRepository(pool) {
  const repo = {
    async findById(tenantId, id) {
      return withTenant(pool, tenantId, async client => {
        const { rows } = await client.query(
          `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
        if (!rows.length) return null;
        const [contacts, addresses] = await Promise.all([
          client.query("SELECT * FROM customer_contacts WHERE tenant_id = $1 AND customer_id = $2 ORDER BY is_primary DESC, last_name", [tenantId, id]),
          client.query("SELECT * FROM customer_addresses WHERE tenant_id = $1 AND customer_id = $2 ORDER BY is_primary DESC, type", [tenantId, id]),
        ]);
        return rowToCustomer(rows[0], contacts.rows, addresses.rows);
      });
    },

    /**
     * Gepagineerd zoeken. Cursor is het laatst geziene id binnen een vaste
     * sortering (naam, id) · stabiel bij tussentijdse inserts, in tegenstelling
     * tot OFFSET.
     */
    async search(tenantId, { query = "", status = null, limit = 50, cursor = null, includeArchived = false } = {}) {
      return withTenant(pool, tenantId, async client => {
        const params = [tenantId];
        const where = ["tenant_id = $1"];
        if (!includeArchived) where.push("archived_at IS NULL");
        if (status) { params.push(status); where.push(`status = $${params.length}`); }
        if (clean(query)) {
          params.push(`%${clean(query).toLowerCase()}%`);
          where.push(`(lower(name) LIKE $${params.length} OR lower(coalesce(email,'')) LIKE $${params.length} OR lower(coalesce(vat_number,'')) LIKE $${params.length})`);
        }
        if (cursor) { params.push(cursor); where.push(`id > $${params.length}`); }
        const size = Math.min(Math.max(1, Number(limit) || 50), 200);
        params.push(size + 1);   // één extra om te weten of er nog een pagina is
        const { rows } = await client.query(
          `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE ${where.join(" AND ")} ORDER BY id ASC LIMIT $${params.length}`, params);
        const page = rows.slice(0, size);
        return {
          rows: page.map(r => rowToCustomer(r)),
          nextCursor: rows.length > size ? page[page.length - 1].id : null,
        };
      });
    },

    async insert(tenantId, payload, actor = null) {
      const id = clean(payload.id) || `cust_${newUlid()}`;
      return withTenant(pool, tenantId, async client => {
        const { rows } = await client.query(
          `INSERT INTO customers (id, tenant_id, company_id, customer_number, name, email, phone, vat_number,
             language, status, credit_limit, payment_terms_days, price_group, notes, custom_fields,
             created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
           RETURNING ${CUSTOMER_COLUMNS}`,
          [id, tenantId, nullable(payload.companyId), nullable(payload.customerNumber), clean(payload.name),
            nullable(payload.email), nullable(payload.phone), nullable(payload.vatNumber),
            clean(payload.language) || "nl", clean(payload.status) || "active",
            payload.creditLimit == null ? null : Number(payload.creditLimit),
            Number.isFinite(Number(payload.paymentTermsDays)) ? Number(payload.paymentTermsDays) : 30,
            nullable(payload.priceGroup), nullable(payload.notes),
            JSON.stringify(payload.customFields || {}), actor]);
        await repo.replaceChildren(client, tenantId, id, payload, actor);
        return repo.loadWithin(client, tenantId, id);
      });
    },

    /**
     * Bijwerken met optimistic locking (4.1). De UPDATE raakt 0 rijen als de
     * versie intussen wijzigde; dat is een expliciet conflict, geen stille
     * overschrijving.
     */
    async update(tenantId, id, payload, actor = null, expectedVersion = null) {
      return withTenant(pool, tenantId, async client => {
        const params = [tenantId, id, nullable(payload.companyId), nullable(payload.customerNumber), clean(payload.name),
          nullable(payload.email), nullable(payload.phone), nullable(payload.vatNumber),
          clean(payload.language) || "nl", clean(payload.status) || "active",
          payload.creditLimit == null ? null : Number(payload.creditLimit),
          Number.isFinite(Number(payload.paymentTermsDays)) ? Number(payload.paymentTermsDays) : 30,
          nullable(payload.priceGroup), nullable(payload.notes),
          JSON.stringify(payload.customFields || {}), actor];
        let versionPredicate = "";
        if (expectedVersion != null) { params.push(Number(expectedVersion)); versionPredicate = ` AND version = $${params.length}`; }
        const { rows } = await client.query(
          `UPDATE customers SET company_id=$3, customer_number=$4, name=$5, email=$6, phone=$7, vat_number=$8,
             language=$9, status=$10, credit_limit=$11, payment_terms_days=$12, price_group=$13, notes=$14,
             custom_fields=$15, updated_by=$16, version = version + 1
           WHERE tenant_id=$1 AND id=$2${versionPredicate}
           RETURNING ${CUSTOMER_COLUMNS}`, params);
        if (!rows.length) {
          // Onderscheid tussen "bestaat niet" en "versieconflict": een
          // aanroeper moet weten of hij moet herladen of een 404 moet tonen.
          const { rows: exists } = await client.query(
            "SELECT version FROM customers WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
          if (!exists.length) { const e = new Error("Klant niet gevonden"); e.status = 404; throw e; }
          const e = new Error("De klant is intussen gewijzigd.");
          e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = Number(exists[0].version); throw e;
        }
        await repo.replaceChildren(client, tenantId, id, payload, actor);
        return repo.loadWithin(client, tenantId, id);
      });
    },

    /** Archiveren in plaats van verwijderen (DoD): historiek blijft. */
    async archive(tenantId, id, actor = null) {
      return withTenant(pool, tenantId, async client => {
        const { rows } = await client.query(
          `UPDATE customers SET archived_at = now(), archived_by = $3, version = version + 1
           WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL RETURNING ${CUSTOMER_COLUMNS}`,
          [tenantId, id, actor]);
        if (!rows.length) { const e = new Error("Klant niet gevonden of al gearchiveerd"); e.status = 404; throw e; }
        return rowToCustomer(rows[0]);
      });
    },

    async count(tenantId, { includeArchived = false } = {}) {
      return withTenant(pool, tenantId, async client => {
        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM customers WHERE tenant_id = $1${includeArchived ? "" : " AND archived_at IS NULL"}`, [tenantId]);
        return rows[0].n;
      });
    },

    // ── Interne helpers (binnen een lopende transactie) ─────────────────────
    async loadWithin(client, tenantId, id) {
      const { rows } = await client.query(
        `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
      const [contacts, addresses] = await Promise.all([
        client.query("SELECT * FROM customer_contacts WHERE tenant_id = $1 AND customer_id = $2 ORDER BY is_primary DESC", [tenantId, id]),
        client.query("SELECT * FROM customer_addresses WHERE tenant_id = $1 AND customer_id = $2 ORDER BY is_primary DESC", [tenantId, id]),
      ]);
      return rowToCustomer(rows[0], contacts.rows, addresses.rows);
    },

    /**
     * Contacten en adressen vervangen. Alleen wanneer de aanroeper ze meestuurt:
     * een patch zonder `contacts` mag bestaande contacten niet wissen.
     */
    async replaceChildren(client, tenantId, customerId, payload, actor) {
      if (Array.isArray(payload.contacts)) {
        await client.query("DELETE FROM customer_contacts WHERE tenant_id = $1 AND customer_id = $2", [tenantId, customerId]);
        for (const [i, c] of payload.contacts.entries()) {
          await client.query(
            `INSERT INTO customer_contacts (id, tenant_id, customer_id, first_name, last_name, email, phone, role, is_primary, created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
            [clean(c.id) || `cont_${newUlid()}`, tenantId, customerId, nullable(c.firstName), nullable(c.lastName),
              nullable(c.email), nullable(c.phone), nullable(c.role), c.isPrimary === true || i === 0 && payload.contacts.length === 1, actor]);
        }
      }
      if (Array.isArray(payload.addresses)) {
        await client.query("DELETE FROM customer_addresses WHERE tenant_id = $1 AND customer_id = $2", [tenantId, customerId]);
        for (const a of payload.addresses) {
          await client.query(
            `INSERT INTO customer_addresses (id, tenant_id, customer_id, type, street, number, postal_code, city, country, is_primary, created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
            [clean(a.id) || `addr_${newUlid()}`, tenantId, customerId, clean(a.type) || "main", nullable(a.street),
              nullable(a.number), nullable(a.postalCode), nullable(a.city), (clean(a.country) || "BE").toUpperCase(),
              a.isPrimary === true, actor]);
        }
      }
    },
  };
  return repo;
}

module.exports = { makePgCustomerRepository, withTenant, rowToCustomer };
