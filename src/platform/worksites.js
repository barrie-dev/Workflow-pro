"use strict";
/**
 * Worksites (werven) + projectpartijen · Construction Core (master-spec h43, E12, R2-a).
 *
 * Een worksite is de bouwlocatie van een project: adres, toegang, werfverant-
 * woordelijke, geo en compliancecontext. De locatie zelf blijft het gedeelde
 * venue-object (ontwikkelprincipe "location is een gedeeld object"); de worksite
 * voegt de bouwspecifieke context toe en verwijst naar venueId + projectId.
 *
 * Projectpartijen (h43.3): bouwheer, eindklant, architect, hoofdaannemer,
 * onderaannemer, veiligheidscoördinator, leverancier · elk met rol en contact.
 *
 * Zelfde compatibility-repository-patroon als CRM/projects (ULID, version,
 * generieke technische velden). Geen vendor/SQL hier (ADR-001).
 */

const { newUlid } = require("./events");

// Projectpartij-types (h43.3). Codes canoniek; labels in de i18n-laag.
const PARTY_TYPES = [
  "principal",        // bouwheer (opdrachtgever/eigenaar)
  "end_customer",     // eindklant
  "architect",
  "main_contractor",  // hoofdaannemer
  "subcontractor",    // onderaannemer
  "safety_coordinator", // veiligheidscoördinator
  "supplier",         // leverancier
];

const WORKSITE_STATUSES = ["preparation", "active", "on_hold", "completed", "closed"];

function clean(v) { return String(v == null ? "" : v).trim(); }

function normalizeParty(raw) {
  const type = PARTY_TYPES.includes(raw && raw.type) ? raw.type : "subcontractor";
  const name = clean(raw && raw.name);
  if (!name && !(raw && (raw.customerId || raw.supplierId))) return null;
  return {
    id: (raw && raw.id) || `pty_${newUlid()}`,
    type,
    name,
    customerId: (raw && raw.customerId) || null,
    supplierId: (raw && raw.supplierId) || null,
    contactName: clean(raw && raw.contactName),
    contactEmail: clean(raw && raw.contactEmail).toLowerCase(),
    contactPhone: clean(raw && raw.contactPhone),
  };
}

function normalizeWorksite(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  const name = clean(merged.name);
  if (!name) { const e = new Error("Werfnaam is verplicht"); e.status = 400; throw e; }
  if (!existing && !merged.projectId) { const e = new Error("Project is verplicht"); e.status = 400; throw e; }

  const geo = merged.geo && typeof merged.geo === "object"
    ? { lat: Number(merged.geo.lat) || null, lng: Number(merged.geo.lng) || null }
    : null;

  const parties = (Array.isArray(merged.parties) ? merged.parties : [])
    .map(normalizeParty).filter(Boolean);

  return {
    name,
    projectId: merged.projectId || null,
    venueId: merged.venueId || null,               // gedeeld locatieobject
    status: WORKSITE_STATUSES.includes(merged.status) ? merged.status : "preparation",
    address: clean(merged.address),
    zip: clean(merged.zip),
    city: clean(merged.city),
    accessInfo: clean(merged.accessInfo),           // toegang/sleutel/afspraken
    siteManagerId: merged.siteManagerId || null,    // werfverantwoordelijke
    geo: geo && (geo.lat || geo.lng) ? geo : null,
    parties,
    notes: clean(merged.notes),
  };
}

function makeWorksiteRepository(store) {
  const col = "worksites";
  return {
    list(tenantId, opts = {}) {
      let rows = (store.list(col, tenantId) || []).slice();
      if (opts.projectId) rows = rows.filter(w => w.projectId === opts.projectId);
      return rows;
    },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(w => w.id === id) || null; },
    insert(tenantId, payload, actor) {
      const normalized = normalizeWorksite(payload, null);
      const now = new Date().toISOString();
      return store.insert(col, {
        id: `ws_${newUlid()}`, tenantId, ...normalized,
        version: 1, createdAt: now, createdBy: actor || null, updatedAt: now, updatedBy: actor || null,
      });
    },
    update(tenantId, id, patch, actor, expectedVersion) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Werf niet gevonden"); e.status = 404; throw e; }
      if (expectedVersion != null && Number(existing.version || 1) !== Number(expectedVersion)) {
        const e = new Error("De werf is intussen gewijzigd. Herlaad en probeer opnieuw.");
        e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = existing.version || 1; throw e;
      }
      const normalized = normalizeWorksite(patch, existing);
      return store.update(col, id, { ...normalized, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
    },
    remove(tenantId, id) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Werf niet gevonden"); e.status = 404; throw e; }
      store.remove(col, id);
      return { ok: true };
    },
  };
}

module.exports = { PARTY_TYPES, WORKSITE_STATUSES, normalizeParty, normalizeWorksite, makeWorksiteRepository };
