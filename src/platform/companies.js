"use strict";
/**
 * Company-laag + nummerreeksen (master-spec E01, h7, PLT-BR-005/006 · R0-b).
 *
 * Company = de juridische onderneming binnen een tenant (legal_name, btw,
 * ondernemingsnummer, IBAN, Peppol-identiteit). Elke tenant krijgt een
 * default-company (migratie v8 vult die uit tenant.invoiceProfile); juridische
 * en financiële documenten dragen vanaf nu companyId. Multi-company volgt
 * later; de API is er al op gebouwd.
 *
 * Nummerreeksen zijn per onderneming + documenttype + jaar opgeslagen
 * (PLT-BR-005). Dat vervangt het tellen van bestaande documenten (dat na een
 * delete nummers kon hergebruiken) door een monotone, persistente reeks.
 * De eerste uitgifte per jaar seed't vanaf de bestaande documenten zodat de
 * nummering naadloos doorloopt. Nummerformaten blijven identiek aan vandaag;
 * configureerbare formaten komen met het configuratieplatform (E10).
 */

const { newUlid } = require("./events");

// Documenttypes met hun huidige formaat + broncollectie voor de seed.
const DOC_TYPES = {
  invoice: { format: (year, seq) => `${year}-${String(seq).padStart(3, "0")}`, collection: "invoices", matches: (num, year) => String(num || "").startsWith(`${year}-`) },
  quote: { format: (year, seq) => `OFF-${year}-${String(seq).padStart(3, "0")}`, collection: "quotes", matches: (num, year) => String(num || "").startsWith(`OFF-${year}-`) },
  workorder: { format: (year, seq) => `WO-${year}-${String(seq).padStart(3, "0")}`, collection: "workorders", matches: (num, year) => String(num || "").startsWith(`WO-${year}-`) },
  credit_note: { format: (year, seq) => `CN-${year}-${String(seq).padStart(3, "0")}`, collection: "invoices", matches: (num, year) => String(num || "").startsWith(`CN-${year}-`) },
};

function ensureCollections(store) {
  if (!store.data || typeof store.data !== "object") store.data = {};
  if (!Array.isArray(store.data.companies)) store.data.companies = [];
  if (!Array.isArray(store.data.numberSequences)) store.data.numberSequences = [];
}

/** Bouw een default-company uit de bestaande tenantgegevens (invoiceProfile). */
function companyFromTenant(tenant) {
  const ip = (tenant && tenant.invoiceProfile) || {};
  return {
    id: `co_${newUlid()}`,
    tenantId: tenant.id,
    legalName: ip.name || tenant.name || "",
    vat: ip.vat || tenant.vatNumber || "",
    companyNumber: ip.companyNumber || "",
    iban: ip.iban || "",
    peppolId: ip.peppolId || "",
    isDefault: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Default-company van een tenant; maakt er lazily één aan als die ontbreekt. */
function ensureDefaultCompany(store, tenant) {
  ensureCollections(store);
  let company = store.data.companies.find(c => c.tenantId === tenant.id && c.isDefault);
  if (!company) {
    company = companyFromTenant(tenant);
    store.data.companies.push(company);
    if (typeof store.save === "function") store.save();
  }
  return company;
}

/**
 * Geef het volgende documentnummer uit (PLT-BR-005: uitgifte = definitief).
 * Monotoon per onderneming + documenttype + jaar; seed't bij de eerste
 * uitgifte vanaf de hoogste bestaande reeks van de tenant zodat legacy-
 * nummering naadloos doorloopt.
 */
function issueNumber(store, { tenant, companyId, docType, now = new Date() }) {
  ensureCollections(store);
  const def = DOC_TYPES[docType];
  if (!def) throw new Error(`issueNumber: onbekend documenttype '${docType}'`);
  const year = now.getFullYear();
  const company = companyId || ensureDefaultCompany(store, tenant).id;

  let seqRow = store.data.numberSequences.find(s =>
    s.tenantId === tenant.id && s.companyId === company && s.docType === docType && s.year === year);
  if (!seqRow) {
    // Seed: hoogste bestaande volgnummer van dit jaar (legacy telde documenten;
    // wij nemen het maximum zodat gaten door deletes nooit hergebruikt worden).
    const existing = (store.data[def.collection] || [])
      .filter(r => r.tenantId === tenant.id && def.matches(r.number, year))
      .map(r => Number(String(r.number).split("-").pop()))
      .filter(n => Number.isFinite(n));
    seqRow = {
      id: `seq_${newUlid()}`,
      tenantId: tenant.id,
      companyId: company,
      docType,
      year,
      nextSeq: (existing.length ? Math.max(...existing) : 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    store.data.numberSequences.push(seqRow);
  }
  const seq = seqRow.nextSeq;
  seqRow.nextSeq = seq + 1;
  seqRow.updatedAt = new Date().toISOString();
  if (typeof store.save === "function") store.save();
  return { number: def.format(year, seq), companyId: company, seq, year };
}

module.exports = { DOC_TYPES, companyFromTenant, ensureDefaultCompany, issueNumber };
