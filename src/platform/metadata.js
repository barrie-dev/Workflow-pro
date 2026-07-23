"use strict";

// ── Universele objectmetadata (Forms handover h5 · FORM-05) ──────────────────
// Elk object draagt dezelfde beheer-metadata. Deze module is de PURE bron van de
// canonieke enums en van de metadata-stempel die de Store bij elke insert zet.
// Geen SQL, geen I/O · los testbaar en bruikbaar door zowel de JSON-store als de
// pg-repositories.

// De zeven classificaties (h1/h5). Oplopend in gevoeligheid; alles boven
// 'internal' vraagt strengere logging, retentie en exportcontrole.
const CLASSIFICATIONS = ["public", "internal", "confidential", "personal", "special_category", "financial", "security_sensitive"];
const CLASSIFICATION_RANK = CLASSIFICATIONS.reduce((m, c, i) => (m[c] = i, m), {});
// Classificaties die standaard NIET vrij zichtbaar zijn (rechten-gedreven).
const SENSITIVE_CLASSIFICATIONS = new Set(["confidential", "personal", "special_category", "financial", "security_sensitive"]);

// Herkomst van een object (h5): via welke weg het is ontstaan.
const SOURCES = ["ui", "import", "api", "integration", "automation", "migration"];

// Wat er bij het verstrijken van de bewaartermijn gebeurt (h5/h27).
const PURGE_STRATEGIES = ["soft_archive", "anonymize", "hard_delete"];

// Standaardclassificatie per canonieke collectie · gevoelige domeinen krijgen
// meteen de juiste strengheid, de rest valt terug op 'internal'.
const COLLECTION_CLASSIFICATION = {
  users: "personal",
  employees: "personal",
  customers: "confidential",
  contacts: "personal",
  invoices: "financial",
  payments: "financial",
  quotes: "financial",
  expenses: "financial",
  leaves: "special_category",     // kan medische grondslag bevatten
  workAccidents: "special_category",
  apiKeys: "security_sensitive",
  secrets: "security_sensitive",
  resellers: "confidential",
  supportGrants: "confidential",
  // Integraties, Usage & Billing (INT-01..10). Credentials zijn secretreferenties;
  // usage/credits/kosten/limieten zijn financiele gegevens (provider_unit_cost en
  // marge blijven bovendien Super Admin-only in de servicelaag).
  integrationCredentials: "security_sensitive",
  usageEvents: "financial",
  usageAdjustments: "financial",
  usagePriceRules: "financial",
  usageCostRules: "financial",
  usageBillingPeriods: "financial",
  usageBillingLines: "financial",
  tenantUsageLimits: "financial",
  tenantCreditAllocations: "financial",
  platformUsageBudgets: "financial",
  aiProviderUsage: "financial",
  aiFeatureCreditRates: "financial",
};

function isClassification(v) { return CLASSIFICATIONS.includes(v); }
function isSource(v) { return SOURCES.includes(v); }

/** De strengste van twee classificaties (voor afgeleide/samengestelde objecten). */
function maxClassification(a, b) {
  const ra = CLASSIFICATION_RANK[a] ?? -1, rb = CLASSIFICATION_RANK[b] ?? -1;
  return ra >= rb ? a : b;
}

function defaultClassificationFor(collection) {
  return COLLECTION_CLASSIFICATION[collection] || "internal";
}

/**
 * Stempel de universele beheer-metadata op een object · ADDITIEF: bestaande
 * waarden worden nooit overschreven, alleen ontbrekende systeemvelden ingevuld.
 * Zo blijft bestaande data en bestaand gedrag intact, terwijl elk NIEUW object de
 * canonieke velden krijgt (h5): data_classification, source, version.
 *
 * @param {string} collection  logische collectie (voor de standaardclassificatie)
 * @param {object} row         het in te voegen object (wordt gemuteerd + geretourneerd)
 * @param {{source?:string, classification?:string}} [opts]
 */
function stampMetadata(collection, row, opts = {}) {
  if (!row || typeof row !== "object") return row;
  if (row.data_classification == null) {
    const c = opts.classification && isClassification(opts.classification) ? opts.classification : defaultClassificationFor(collection);
    row.data_classification = c;
  }
  if (row.source == null) {
    row.source = opts.source && isSource(opts.source) ? opts.source : "ui";
  }
  if (row.version == null) row.version = 1;
  return row;
}

module.exports = {
  CLASSIFICATIONS, CLASSIFICATION_RANK, SENSITIVE_CLASSIFICATIONS,
  SOURCES, PURGE_STRATEGIES, COLLECTION_CLASSIFICATION,
  isClassification, isSource, maxClassification, defaultClassificationFor, stampMetadata,
};
