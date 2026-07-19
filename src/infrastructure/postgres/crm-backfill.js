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

/**
 * Vergelijkbare vingerafdruk van een klant. Wordt aan beide kanten identiek
 * berekend, zodat de reconciliatie inhoudelijke afwijkingen vindt en niet enkel
 * ontbrekende rijen (5.4 stap 4: "hashes").
 */
function customerFingerprint(c) {
  const canoniek = [
    clean(c.name).toLowerCase(),
    clean(c.email).toLowerCase(),
    clean(c.vatNumber).toLowerCase(),
    clean(c.status) || "active",
    clean(c.language) || "nl",
    c.creditLimit == null || c.creditLimit === "" ? "" : String(Number(c.creditLimit)),
    String((c.contacts || []).length),
    String((c.addresses || []).length),
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

  let migrated = 0;
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
    }
  });
  return { tenantId, migrated, skipped, wouldMigrate: rows.length, dryRun: false };
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

  const target = await withTenant(pool, tenantId, async client => {
    const { rows } = await client.query(
      `SELECT c.id, c.name, c.email, c.vat_number, c.status, c.language, c.credit_limit,
              (SELECT count(*) FROM customer_contacts ct WHERE ct.tenant_id = c.tenant_id AND ct.customer_id = c.id) AS contact_count,
              (SELECT count(*) FROM customer_addresses ad WHERE ad.tenant_id = c.tenant_id AND ad.customer_id = c.id) AS address_count
         FROM customers c WHERE c.tenant_id = $1`, [tenantId]);
    return rows;
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
      contacts: new Array(Number(dst.contact_count)), addresses: new Array(Number(dst.address_count)),
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

module.exports = { backfillCustomers, reconcileCustomers, customerFingerprint, toRow, validateLegacy };
