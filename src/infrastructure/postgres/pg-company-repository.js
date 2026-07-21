"use strict";
/**
 * Company-repository op de genormaliseerde companies-tabel (CTO P0-01 fase 4,
 * handover 5.4 · vierde domein na CRM, identity en finance).
 *
 * companies en number_sequences bestaan al sinds migratie 001 (E01-laag); dit
 * brengt ze in de runtime-strangler. Zelfde kernprincipe als de andere
 * domeinen: de pg-rij is een VERLIESVRIJE projectie van het legacy-object.
 * Kernvelden worden kolommen, tijdstempels en overige velden reizen verbatim
 * mee in 'attributes' (de tabel heeft eigen timestamp-kolommen, maar die zijn
 * query-only · attributes is de bron van waarheid voor de round-trip).
 *
 * Twee samenhangende sets in één transactie: companies eerst (FK-anker voor
 * number_sequences), dan de nummerreeksen. Beide idempotent via fingerprint.
 * De nummerreeks is financieel gevoelig (uitgifte is definitief, PLT-BR-005),
 * dus de reconciliatie vergelijkt next_seq exact.
 */

const crypto = require("crypto");

function clean(v) { return String(v == null ? "" : v).trim(); }

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

// ── Companies ────────────────────────────────────────────────────────────────
const COMPANY_CORE = ["id", "tenantId", "legalName", "vat", "companyNumber", "iban", "peppolId", "isDefault"];

function projectCompany(company) {
  const attributes = {};
  for (const [k, v] of Object.entries(company || {})) {
    if (COMPANY_CORE.includes(k)) continue;
    attributes[k] = v === undefined ? null : v;
  }
  return {
    id: clean(company.id),
    tenantId: clean(company.tenantId) || null,
    legalName: company.legalName != null ? String(company.legalName) : "",
    vat: company.vat != null ? String(company.vat) : null,
    companyNumber: company.companyNumber != null ? String(company.companyNumber) : null,
    iban: company.iban != null ? String(company.iban) : null,
    peppolId: company.peppolId != null ? String(company.peppolId) : null,
    isDefault: company.isDefault === true,
    attributes,
  };
}

function projectCompanyRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id || null,
    legalName: row.legal_name != null ? String(row.legal_name) : "",
    vat: row.vat != null ? String(row.vat) : null,
    companyNumber: row.company_number != null ? String(row.company_number) : null,
    iban: row.iban != null ? String(row.iban) : null,
    peppolId: row.peppol_id != null ? String(row.peppol_id) : null,
    isDefault: row.is_default === true,
    attributes: row.attributes || {},
  };
}
function companyFingerprint(company) { return hashOf(projectCompany(company)); }

function rowToCompany(row) {
  const p = projectCompanyRow(row);
  return {
    ...p.attributes,
    id: p.id, tenantId: p.tenantId, legalName: p.legalName, vat: p.vat,
    companyNumber: p.companyNumber, iban: p.iban, peppolId: p.peppolId, isDefault: p.isDefault,
  };
}

// ── Nummerreeksen (PLT-BR-005: definitieve, monotone uitgifte) ─────────────
const SEQ_CORE = ["id", "tenantId", "companyId", "docType", "year", "nextSeq"];

function projectSequence(seq) {
  const attributes = {};
  for (const [k, v] of Object.entries(seq || {})) {
    if (SEQ_CORE.includes(k)) continue;
    attributes[k] = v === undefined ? null : v;
  }
  return {
    id: clean(seq.id),
    tenantId: clean(seq.tenantId) || null,
    companyId: clean(seq.companyId) || null,
    docType: clean(seq.docType) || null,
    year: Number(seq.year) || null,
    nextSeq: Number(seq.nextSeq) || 1,
    attributes,
  };
}
function projectSequenceRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id || null,
    companyId: row.company_id || null,
    docType: row.doc_type || null,
    year: Number(row.year) || null,
    nextSeq: Number(row.next_seq) || 1,
    attributes: row.attributes || {},
  };
}
function sequenceFingerprint(seq) { return hashOf(projectSequence(seq)); }
function rowToSequence(row) {
  const p = projectSequenceRow(row);
  return { ...p.attributes, id: p.id, tenantId: p.tenantId, companyId: p.companyId,
    docType: p.docType, year: p.year, nextSeq: p.nextSeq };
}

const COMPANY_COLS = "id, tenant_id, legal_name, vat, company_number, iban, peppol_id, is_default, attributes, fingerprint";
const SEQ_COLS = "id, tenant_id, company_id, doc_type, year, next_seq, attributes, fingerprint";

/**
 * Volledige sync van companies + number_sequences in één transactie.
 * VERWIJDEREN-EERST, dan upserten · robuust voor overlap in de unieke sleutels
 * (één default per tenant; uniek tenant+company+doctype+jaar). Companies vóór
 * sequences (FK-anker). Tenants worden minimaal geankerd (finance-patroon).
 */
async function syncCompanies(pool, { companies = [], numberSequences = [] }) {
  const client = await pool.connect();
  const result = { companiesUpserted: 0, companiesDeleted: 0, sequencesUpserted: 0, sequencesDeleted: 0 };
  try {
    await client.query("BEGIN");

    const tenantIds = new Set();
    for (const c of companies) if (c && c.tenantId) tenantIds.add(clean(c.tenantId));
    for (const s of numberSequences) if (s && s.tenantId) tenantIds.add(clean(s.tenantId));
    for (const tid of tenantIds) {
      if (!tid) continue;
      await client.query(
        `INSERT INTO tenants (id, name, fingerprint) VALUES ($1,$1,'anchor') ON CONFLICT (id) DO NOTHING`, [tid]);
    }

    // Companies: verwijderen-eerst (de partiële unieke index op is_default zou
    // anders kunnen botsen bij een default-wissel), dan upserten.
    const projCompanies = companies.map(projectCompany).filter(p => p.id && p.tenantId);
    const companyIds = projCompanies.map(p => p.id);
    const delC = await client.query(
      companyIds.length ? `DELETE FROM companies WHERE NOT (id = ANY($1::text[])) RETURNING id`
                        : `DELETE FROM companies RETURNING id`,
      companyIds.length ? [companyIds] : []);
    result.companiesDeleted = delC.rows.length;
    for (const p of projCompanies) {
      const up = await client.query(
        `INSERT INTO companies (${COMPANY_COLS})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           tenant_id=excluded.tenant_id, legal_name=excluded.legal_name, vat=excluded.vat,
           company_number=excluded.company_number, iban=excluded.iban, peppol_id=excluded.peppol_id,
           is_default=excluded.is_default, attributes=excluded.attributes,
           fingerprint=excluded.fingerprint, version=companies.version+1
         WHERE companies.fingerprint IS DISTINCT FROM excluded.fingerprint
         RETURNING id`,
        [p.id, p.tenantId, p.legalName, p.vat, p.companyNumber, p.iban, p.peppolId, p.isDefault, p.attributes, hashOf(p)]);
      if (up.rows.length) result.companiesUpserted += 1;
    }

    // Nummerreeksen: idem.
    const projSeqs = numberSequences.map(projectSequence).filter(p => p.id && p.tenantId);
    const seqIds = projSeqs.map(p => p.id);
    const delS = await client.query(
      seqIds.length ? `DELETE FROM number_sequences WHERE NOT (id = ANY($1::text[])) RETURNING id`
                    : `DELETE FROM number_sequences RETURNING id`,
      seqIds.length ? [seqIds] : []);
    result.sequencesDeleted = delS.rows.length;
    for (const p of projSeqs) {
      const up = await client.query(
        `INSERT INTO number_sequences (${SEQ_COLS})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           tenant_id=excluded.tenant_id, company_id=excluded.company_id, doc_type=excluded.doc_type,
           year=excluded.year, next_seq=excluded.next_seq, attributes=excluded.attributes,
           fingerprint=excluded.fingerprint
         WHERE number_sequences.fingerprint IS DISTINCT FROM excluded.fingerprint
         RETURNING id`,
        [p.id, p.tenantId, p.companyId, p.docType, p.year, p.nextSeq, p.attributes, hashOf(p)]);
      if (up.rows.length) result.sequencesUpserted += 1;
    }

    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Companies per tenant (tenantcontext = RLS, defense in depth). */
async function listCompanies(pool, tenantId) {
  const t = clean(tenantId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [t]);
    const { rows } = await client.query(
      `SELECT ${COMPANY_COLS} FROM companies WHERE tenant_id = $1 ORDER BY is_default DESC, id`, [t]);
    await client.query("COMMIT");
    return rows.map(rowToCompany);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function findDefaultCompany(pool, tenantId) {
  const list = await listCompanies(pool, tenantId);
  return list.find(c => c.isDefault) || list[0] || null;
}

/**
 * Reconciliatie: companies én nummerreeksen op canonieke projectie, beide
 * richtingen. De nummerreeks-vergelijking is de financiële poortwachter
 * (next_seq moet exact kloppen · een verkeerde reeks geeft dubbele nummers).
 */
async function reconcileCompanies(pool, { companies = [], numberSequences = [] }) {
  const cRows = (await pool.query(`SELECT ${COMPANY_COLS} FROM companies`)).rows;
  const sRows = (await pool.query(`SELECT ${SEQ_COLS} FROM number_sequences`)).rows;
  const cById = new Map(cRows.map(r => [r.id, r]));
  const sById = new Map(sRows.map(r => [r.id, r]));

  const companyMismatches = [], companyMissing = [];
  const legacyCompanyIds = new Set();
  for (const c of companies) {
    const id = clean(c.id); legacyCompanyIds.add(id);
    const row = cById.get(id);
    if (!row) { companyMissing.push(id); continue; }
    if (hashOf(projectCompany(c)) !== hashOf(projectCompanyRow(row))) companyMismatches.push(id);
  }
  const companyExtra = cRows.map(r => r.id).filter(id => !legacyCompanyIds.has(id));

  const seqMismatches = [], seqMissing = [];
  const legacySeqIds = new Set();
  for (const s of numberSequences) {
    const id = clean(s.id); legacySeqIds.add(id);
    const row = sById.get(id);
    if (!row) { seqMissing.push(id); continue; }
    if (hashOf(projectSequence(s)) !== hashOf(projectSequenceRow(row))) seqMismatches.push(id);
  }
  const seqExtra = sRows.map(r => r.id).filter(id => !legacySeqIds.has(id));

  return {
    ok: companyMismatches.length === 0 && companyMissing.length === 0 && companyExtra.length === 0
      && seqMismatches.length === 0 && seqMissing.length === 0 && seqExtra.length === 0,
    companies: { checked: companies.length, mismatches: companyMismatches, missingInPg: companyMissing, extraInPg: companyExtra },
    numberSequences: { checked: numberSequences.length, mismatches: seqMismatches, missingInPg: seqMissing, extraInPg: seqExtra },
  };
}

module.exports = {
  projectCompany, projectCompanyRow, rowToCompany, companyFingerprint,
  projectSequence, projectSequenceRow, rowToSequence, sequenceFingerprint,
  syncCompanies, listCompanies, findDefaultCompany, reconcileCompanies, stableStringify,
};
