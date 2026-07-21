"use strict";
/**
 * Backfill + reconciliatie van CRM naar genormaliseerde tabellen
 * (handover 5.4 stap 3 en 4).
 *
 * Vertaalt de legacy-klantrecords naar customers/customer_contacts/
 * customer_addresses. IDEMPOTENT: meermaals draaien geeft exact hetzelfde
 * resultaat, want elke rij gaat via een UPSERT op de bestaande id. Die id's
 * blijven identiek aan de legacybron, anders is reconciliatie onmogelijk.
 *
 * De backfill maakt NIETS leeg en verwijdert nooit: legacy blijft de bron tot
 * de cutover (5.4 stap 7). Rijen die alleen in Postgres bestaan worden gemeld,
 * niet stilzwijgend opgeruimd.
 */

const crypto = require("crypto");
const { withTenant } = require("./pg-customer-repository");

function clean(v) { return String(v == null ? "" : v).trim(); }
function nullable(v) { const s = clean(v); return s || null; }

// ── Typemappings legacy ↔ genormaliseerd ────────────────────────────────────
// Legacy-adres: billing|site|postal · schema: main|invoice|delivery|site.
const ADDRESS_TYPE_TO_PG = { billing: "invoice", site: "site", postal: "main" };
const ADDRESS_TYPE_FROM_PG = { invoice: "billing", site: "site", main: "postal", delivery: "site" };

/** Legacy-contactnaam (één veld) → first/last · laatste woord = achternaam. */
function splitName(name) {
  const parts = clean(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: null, lastName: parts[0] };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/**
 * Vergelijkbare vingerafdruk van een klant, INCLUSIEF de inhoud van de
 * kinderen (P0-07: alleen aantallen tellen bewijst geen sluitende migratie).
 * Wordt aan beide kanten identiek berekend; kinderen worden gesorteerd zodat
 * volgorde geen afwijking veroorzaakt.
 */
function customerFingerprint(c) {
  const contactsKey = (c.contacts || [])
    .map(ct => [clean(ct.name).toLowerCase(), clean(ct.email).toLowerCase(), clean(ct.phone), clean(ct.role).toLowerCase(), ct.isPrimary ? "1" : "0"].join("~"))
    .sort().join("#");
  const addressesKey = (c.addresses || [])
    .map(a => [clean(a.type) || "billing", clean(a.line).toLowerCase(), clean(a.zip), clean(a.city).toLowerCase(), (clean(a.country) || "BE").toUpperCase()].join("~"))
    .sort().join("#");
  const canoniek = [
    clean(c.name).toLowerCase(),
    clean(c.email).toLowerCase(),
    clean(c.vatNumber).toLowerCase(),
    clean(c.status) || "active",
    clean(c.language) || "nl",
    c.creditLimit == null || c.creditLimit === "" ? "" : String(Number(c.creditLimit)),
    contactsKey,
    addressesKey,
  ].join("|");
  return crypto.createHash("sha256").update(canoniek).digest("hex").slice(0, 16);
}

/** Legacy-record → kolomwaarden. Tolerant: oude rijen missen soms velden. */
function toRow(legacy, tenantId) {
  return {
    id: clean(legacy.id),
    tenantId,
    companyId: nullable(legacy.companyId),
    customerNumber: nullable(legacy.customerNumber || legacy.number),
    name: clean(legacy.name),
    email: nullable(legacy.email),
    phone: nullable(legacy.phone),
    vatNumber: nullable(legacy.vatNumber || legacy.vat),
    language: ["nl", "fr", "en"].includes(clean(legacy.language)) ? clean(legacy.language) : "nl",
    status: ["prospect", "active", "on_hold", "blocked", "archived"].includes(clean(legacy.status)) ? clean(legacy.status) : "active",
    creditLimit: legacy.creditLimit == null || legacy.creditLimit === "" ? null : Number(legacy.creditLimit),
    paymentTermsDays: Number.isFinite(Number(legacy.paymentTermsDays)) ? Number(legacy.paymentTermsDays) : 30,
    priceGroup: nullable(legacy.priceGroup),
    notes: nullable(legacy.notes),
    customFields: legacy.customFields && typeof legacy.customFields === "object" ? legacy.customFields : {},
    createdAt: legacy.createdAt || null,
    createdBy: nullable(legacy.createdBy),
    version: Number.isFinite(Number(legacy.version)) ? Number(legacy.version) : 1,
  };
}

/** Rijen die niet migreerbaar zijn worden OVERGESLAGEN en gerapporteerd. */
function validateLegacy(legacy) {
  const problems = [];
  if (!clean(legacy.id)) problems.push("id ontbreekt");
  if (!clean(legacy.name)) problems.push("naam ontbreekt (NOT NULL in het schema)");
  return problems;
}

/**
 * Voer de backfill uit voor één tenant.
 * @param {object} pool
 * @param {string} tenantId
 * @param {Array} legacyCustomers
 * @param {{dryRun?:boolean, actor?:string}} opts
 */
async function backfillCustomers(pool, tenantId, legacyCustomers, { dryRun = false, actor = "backfill" } = {}) {
  const rows = [], skipped = [];
  for (const legacy of legacyCustomers || []) {
    const problems = validateLegacy(legacy);
    if (problems.length) { skipped.push({ id: legacy.id || "(geen id)", reasons: problems }); continue; }
    rows.push(toRow(legacy, tenantId));
  }
  if (dryRun) return { tenantId, wouldMigrate: rows.length, skipped, migrated: 0, dryRun: true };

  let migrated = 0, contactRows = 0, addressRows = 0;
  const byId = new Map((legacyCustomers || []).map(c => [clean(c.id), c]));
  await withTenant(pool, tenantId, async client => {
    for (const r of rows) {
      // UPSERT op de bestaande id · dit maakt de backfill idempotent.
      // version wordt NIET opgehoogd: een backfill is geen inhoudelijke
      // wijziging en mag optimistic locking van de app niet verstoren.
      await client.query(
        `INSERT INTO customers (id, tenant_id, company_id, customer_number, name, email, phone, vat_number,
           language, status, credit_limit, payment_terms_days, price_group, notes, custom_fields,
           created_at, created_by, updated_by, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,coalesce($16::timestamptz, now()),$17,$18,$19)
         ON CONFLICT (id) DO UPDATE SET
           company_id = EXCLUDED.company_id, customer_number = EXCLUDED.customer_number,
           name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone,
           vat_number = EXCLUDED.vat_number, language = EXCLUDED.language, status = EXCLUDED.status,
           credit_limit = EXCLUDED.credit_limit, payment_terms_days = EXCLUDED.payment_terms_days,
           price_group = EXCLUDED.price_group, notes = EXCLUDED.notes,
           custom_fields = EXCLUDED.custom_fields, updated_by = EXCLUDED.updated_by
         WHERE customers.tenant_id = EXCLUDED.tenant_id`,
        [r.id, r.tenantId, r.companyId, r.customerNumber, r.name, r.email, r.phone, r.vatNumber,
          r.language, r.status, r.creditLimit, r.paymentTermsDays, r.priceGroup, r.notes,
          JSON.stringify(r.customFields), r.createdAt, r.createdBy, actor, r.version]);
      migrated++;

      // ── Child-records (P0-07): contacts + addresses als SET-SYNC ──
      // Kinderen zijn onderdeel van het klant-aggregaat en hebben geen eigen
      // leven: de genormaliseerde set spiegelt exact de legacy-set. Dit is de
      // ENIGE plek waar de backfill rijen verwijdert · bewuste afwijking van
      // "verwijdert nooit", anders kan een in legacy geschrapt contact de
      // reconciliatie eeuwig laten falen. Legacy blijft de bron.
      const legacy = byId.get(r.id) || {};
      const contacts = Array.isArray(legacy.contacts) ? legacy.contacts.filter(ct => clean(ct.id)) : [];
      const addresses = Array.isArray(legacy.addresses) ? legacy.addresses.filter(a => clean(a.id)) : [];

      await client.query(
        `DELETE FROM customer_contacts WHERE tenant_id = $1 AND customer_id = $2 AND NOT (id = ANY($3::text[]))`,
        [tenantId, r.id, contacts.map(ct => clean(ct.id))]);
      let primarySeen = false;
      for (const ct of contacts) {
        const { firstName, lastName } = splitName(ct.name);
        // Hoogstens één primair (unieke index) · de eerste primaire wint.
        const isPrimary = !!ct.isPrimary && !primarySeen;
        if (isPrimary) primarySeen = true;
        await client.query(
          `INSERT INTO customer_contacts (id, tenant_id, customer_id, first_name, last_name, email, phone, role, is_primary, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
           ON CONFLICT (id) DO UPDATE SET
             first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
             email = EXCLUDED.email, phone = EXCLUDED.phone, role = EXCLUDED.role,
             is_primary = EXCLUDED.is_primary, updated_by = EXCLUDED.updated_by, updated_at = now()
           WHERE customer_contacts.tenant_id = EXCLUDED.tenant_id`,
          [clean(ct.id), tenantId, r.id, firstName, lastName, nullable(clean(ct.email).toLowerCase()), nullable(ct.phone), nullable(ct.role), isPrimary, actor]);
        contactRows++;
      }

      await client.query(
        `DELETE FROM customer_addresses WHERE tenant_id = $1 AND customer_id = $2 AND NOT (id = ANY($3::text[]))`,
        [tenantId, r.id, addresses.map(a => clean(a.id))]);
      let primaryAddrSeen = false;
      for (const a of addresses) {
        const type = ADDRESS_TYPE_TO_PG[clean(a.type)] || "main";
        const isPrimary = !primaryAddrSeen;   // eerste adres = primair (legacy kent geen vlag)
        primaryAddrSeen = true;
        await client.query(
          `INSERT INTO customer_addresses (id, tenant_id, customer_id, type, street, postal_code, city, country, is_primary, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
           ON CONFLICT (id) DO UPDATE SET
             type = EXCLUDED.type, street = EXCLUDED.street, postal_code = EXCLUDED.postal_code,
             city = EXCLUDED.city, country = EXCLUDED.country, is_primary = EXCLUDED.is_primary,
             updated_by = EXCLUDED.updated_by, updated_at = now()
           WHERE customer_addresses.tenant_id = EXCLUDED.tenant_id`,
          [clean(a.id), tenantId, r.id, type, nullable(a.line), nullable(a.zip), nullable(a.city), (clean(a.country) || "BE").slice(0, 2).toUpperCase(), isPrimary, actor]);
        addressRows++;
      }
    }
  });
  return { tenantId, migrated, contactRows, addressRows, skipped, wouldMigrate: rows.length, dryRun: false };
}

/**
 * Reconciliatie (5.4 stap 4). Vergelijkt legacy en genormaliseerd op:
 *  - aantallen per tenant
 *  - ontbrekende en extra id's (referentie-integriteit)
 *  - inhoudelijke afwijkingen via een vingerafdruk
 *
 * Een lege `differences`-lijst is de voorwaarde om aan cutover te beginnen.
 */
async function reconcileCustomers(pool, tenantId, legacyCustomers) {
  const legacy = new Map();
  for (const c of legacyCustomers || []) {
    if (clean(c.id) && clean(c.name)) legacy.set(clean(c.id), c);
  }

  const { target, contactsByCustomer, addressesByCustomer } = await withTenant(pool, tenantId, async client => {
    const { rows } = await client.query(
      `SELECT c.id, c.name, c.email, c.vat_number, c.status, c.language, c.credit_limit
         FROM customers c WHERE c.tenant_id = $1`, [tenantId]);
    // Kind-INHOUD ophalen (P0-07): aantallen alleen bewijzen niets.
    const { rows: cts } = await client.query(
      `SELECT customer_id, first_name, last_name, email, phone, role, is_primary
         FROM customer_contacts WHERE tenant_id = $1`, [tenantId]);
    const { rows: ads } = await client.query(
      `SELECT customer_id, type, street, postal_code, city, country
         FROM customer_addresses WHERE tenant_id = $1`, [tenantId]);
    const groupBy = (list, fn) => {
      const m = new Map();
      for (const row of list) { const k = row.customer_id; if (!m.has(k)) m.set(k, []); m.get(k).push(fn(row)); }
      return m;
    };
    return {
      target: rows,
      contactsByCustomer: groupBy(cts, r => ({
        name: [r.first_name, r.last_name].filter(Boolean).join(" "),
        email: r.email, phone: r.phone, role: r.role, isPrimary: r.is_primary === true,
      })),
      addressesByCustomer: groupBy(ads, r => ({
        type: ADDRESS_TYPE_FROM_PG[r.type] || "billing",
        line: r.street, zip: r.postal_code, city: r.city, country: r.country,
      })),
    };
  });

  const targetById = new Map(target.map(r => [r.id, r]));
  const missing = [...legacy.keys()].filter(id => !targetById.has(id));
  const extra = [...targetById.keys()].filter(id => !legacy.has(id));

  const differences = [];
  for (const [id, src] of legacy) {
    const dst = targetById.get(id);
    if (!dst) continue;
    const bron = customerFingerprint(src);
    const doel = customerFingerprint({
      name: dst.name, email: dst.email, vatNumber: dst.vat_number, status: dst.status,
      language: dst.language, creditLimit: dst.credit_limit,
      contacts: contactsByCustomer.get(id) || [],
      addresses: addressesByCustomer.get(id) || [],
    });
    if (bron !== doel) differences.push({ id, name: src.name, legacyFingerprint: bron, targetFingerprint: doel });
  }

  return {
    tenantId,
    legacyCount: legacy.size,
    targetCount: target.length,
    countsMatch: legacy.size === target.length,
    missing,          // in legacy, niet in Postgres → backfill is onvolledig
    extra,            // alleen in Postgres → NIET automatisch opruimen
    differences,      // zelfde id, andere inhoud
    // Cutover mag pas als alles klopt (5.4 stap 6/7).
    readyForCutover: legacy.size === target.length && !missing.length && !extra.length && !differences.length,
  };
}

module.exports = { backfillCustomers, reconcileCustomers, customerFingerprint, toRow, validateLegacy, splitName, ADDRESS_TYPE_TO_PG, ADDRESS_TYPE_FROM_PG };
