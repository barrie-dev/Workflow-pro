"use strict";
/**
 * Genormaliseerd CRM + compatibility repository (master-spec E03, h7;
 * infra-handover E3, M1 · R0-d).
 *
 * Canoniek klantmodel: customer met genest contacts[] en addresses[], plus
 * type, taal, betaaltermijn en kredietstatus (h7). Locaties blijven een
 * gedeeld kernobject (venues) en worden hier alleen gerelateerd, niet
 * gedupliceerd (ontwikkelprincipe "location is een gedeeld object").
 *
 * Compatibility repository (migratiefase M1): leest eerst genormaliseerde
 * records en valt gecontroleerd terug op legacy platte klantrecords, die het
 * on-the-fly naar het canonieke model tilt (upgradeLegacy). Schrijven gaat
 * altijd via dit ene punt en produceert genormaliseerde records met
 * schemaVersion, version (optimistic locking) en de generieke technische
 * velden. Zo is de latere PostgreSQL-repository (E1/E3) een adapterwissel:
 * dezelfde interface, andere opslag. Geen SQL of vendor-SDK hier (ADR-001).
 *
 * NB: dit werkt bewust op de bestaande store-collectie "customers" zolang de
 * PostgreSQL-laag er niet is; het is de compatibility-stap, geen nieuwe
 * opslagsilo. tenant_records wordt niet uitgebreid (infra-handover h5.1).
 */

const { newUlid } = require("./events");

const CUSTOMER_SCHEMA_VERSION = 2;   // 1 = legacy plat; 2 = genormaliseerd
const CUSTOMER_TYPES = ["company", "individual"];
const CREDIT_STATUS = ["ok", "watch", "blocked"];

function clean(v) { return String(v == null ? "" : v).trim(); }

function normalizeContact(raw, existing = null) {
  const src = { ...(existing || {}), ...(raw || {}) };
  const name = clean(src.name || src.contactName);
  if (!name && !clean(src.email) && !clean(src.phone)) return null;
  return {
    id: src.id || `ct_${newUlid()}`,
    name,
    role: clean(src.role),
    email: clean(src.email).toLowerCase(),
    phone: clean(src.phone),
    isPrimary: !!src.isPrimary,
  };
}

function normalizeAddress(raw, existing = null) {
  const src = { ...(existing || {}), ...(raw || {}) };
  const line = clean(src.line || src.street || src.address);
  if (!line && !clean(src.city) && !clean(src.zip)) return null;
  return {
    id: src.id || `ad_${newUlid()}`,
    type: ["billing", "site", "postal"].includes(src.type) ? src.type : "billing",
    line,
    zip: clean(src.zip),
    city: clean(src.city),
    country: clean(src.country) || "BE",
  };
}

/**
 * Zet elk (nieuw of legacy) klantpayload om naar het canonieke model.
 * Blijft achterwaarts compatibel: platte velden (name, email, phone, address,
 * vatNumber, contactName) worden behouden EN in contacts[]/addresses[] gespiegeld.
 */
function normalizeCustomer(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  const name = clean(merged.name);
  if (!name) { const e = new Error("Naam is verplicht"); e.status = 400; throw e; }

  const email = clean(merged.email).toLowerCase();
  if (email && !email.includes("@")) { const e = new Error("Geldig e-mailadres is vereist"); e.status = 400; throw e; }

  // Contacts: expliciete lijst, anders afgeleid uit platte contactName/email/phone.
  let contacts = Array.isArray(merged.contacts)
    ? merged.contacts.map(c => normalizeContact(c)).filter(Boolean)
    : [];
  if (!contacts.length) {
    const derived = normalizeContact({ name: merged.contactName, email, phone: merged.phone, isPrimary: true });
    if (derived) contacts = [derived];
  }
  if (contacts.length && !contacts.some(c => c.isPrimary)) contacts[0].isPrimary = true;

  // Addresses: expliciete lijst, anders afgeleid uit platte adresvelden.
  let addresses = Array.isArray(merged.addresses)
    ? merged.addresses.map(a => normalizeAddress(a)).filter(Boolean)
    : [];
  if (!addresses.length) {
    const derived = normalizeAddress({ line: merged.address, zip: merged.zip, city: merged.city, type: "billing" });
    if (derived) addresses = [derived];
  }

  const primaryContact = contacts.find(c => c.isPrimary) || contacts[0] || null;
  const billing = addresses.find(a => a.type === "billing") || addresses[0] || null;

  return {
    type: CUSTOMER_TYPES.includes(merged.type) ? merged.type : "company",
    name,
    vatNumber: clean(merged.vatNumber || merged.vat),
    language: ["nl", "fr", "en"].includes(merged.language) ? merged.language : (merged.language ? clean(merged.language) : "nl"),
    paymentTermsDays: Number.isFinite(Number(merged.paymentTermsDays)) ? Math.max(0, Math.min(120, Number(merged.paymentTermsDays))) : 30,
    creditStatus: CREDIT_STATUS.includes(merged.creditStatus) ? merged.creditStatus : "ok",
    creditLimit: merged.creditLimit != null ? Math.max(0, Number(merged.creditLimit) || 0) : null,
    contacts,
    addresses,
    notes: clean(merged.notes),
    // Legacy-spiegel: behoud de platte velden die de rest van de app leest.
    email: primaryContact ? primaryContact.email : email,
    phone: primaryContact ? primaryContact.phone : clean(merged.phone),
    contactName: primaryContact ? primaryContact.name : clean(merged.contactName),
    address: billing ? billing.line : clean(merged.address),
    zip: billing ? billing.zip : clean(merged.zip),
    city: billing ? billing.city : clean(merged.city),
    // Custom fields (E10): al gevalideerd door de config-service in de route.
    ...(merged.customFields && typeof merged.customFields === "object" ? { customFields: merged.customFields } : {}),
    schemaVersion: CUSTOMER_SCHEMA_VERSION,
  };
}

/** Til een legacy plat klantrecord naar het canonieke model (compatibility read). */
function upgradeLegacy(row) {
  if (!row) return row;
  if (row.schemaVersion === CUSTOMER_SCHEMA_VERSION && Array.isArray(row.contacts)) return row;
  // Behoud id/tenantId/timestamps; herbereken de canonieke structuur.
  const normalized = normalizeCustomer(row, null);
  return { ...row, ...normalized };
}

// ── Repository (compatibility over de store; latere pg-adapter = zelfde API) ──
function makeCustomerRepository(store) {
  const col = "customers";
  return {
    list(tenantId) {
      return (store.list(col, tenantId) || []).map(upgradeLegacy);
    },
    findById(tenantId, id) {
      const row = (store.list(col, tenantId) || []).find(c => c.id === id);
      return row ? upgradeLegacy(row) : null;
    },
    insert(tenantId, payload, actor) {
      const normalized = normalizeCustomer(payload, null);
      const now = new Date().toISOString();
      return store.insert(col, {
        id: `cust_${newUlid()}`,
        tenantId,
        ...normalized,
        version: 1,
        createdAt: now,
        createdBy: actor || null,
        updatedAt: now,
        updatedBy: actor || null,
      });
    },
    /**
     * PATCH met optimistic locking (h7): als expectedVersion is meegegeven en
     * niet klopt → 409 conflict. Bestaande callers zonder version blijven werken.
     */
    update(tenantId, id, patch, actor, expectedVersion) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Klant niet gevonden"); e.status = 404; throw e; }
      if (expectedVersion != null && Number(existing.version || 1) !== Number(expectedVersion)) {
        const e = new Error("De klant is intussen gewijzigd. Herlaad en probeer opnieuw.");
        e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = existing.version || 1;
        throw e;
      }
      const normalized = normalizeCustomer(patch, existing);
      return store.update(col, id, {
        ...normalized,
        version: Number(existing.version || 1) + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: actor || null,
      });
    },
    remove(tenantId, id) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Klant niet gevonden"); e.status = 404; throw e; }
      store.remove(col, id);
      return { ok: true };
    },
  };
}

module.exports = {
  CUSTOMER_SCHEMA_VERSION,
  CUSTOMER_TYPES,
  CREDIT_STATUS,
  normalizeContact,
  normalizeAddress,
  normalizeCustomer,
  upgradeLegacy,
  makeCustomerRepository,
};
