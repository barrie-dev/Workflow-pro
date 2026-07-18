"use strict";
/**
 * Project-aggregate: het centrale uitvoeringsdossier (master-spec h22/E04, R1-a).
 *
 * Project = de centrale context voor projectgedreven werk (ontwikkelprincipe):
 * het bindt klant, werf(location), onderneming, projectleider, fasen, partijen
 * en - via source-relaties - offertes, jobs, werkbonnen en facturen. Commerciële
 * en financiële status zijn afzonderlijk (business rule).
 *
 * Genormaliseerd via hetzelfde compatibility-repository-patroon als CRM: één
 * schrijfpunt, optimistic locking (version), generieke technische velden en
 * ULID-id's. Statemachine met expliciete overgangen; elke transition genereert
 * een domain event. Geen SQL/vendor hier (ADR-001); de latere PostgreSQL-
 * repository is een adapterwissel op dezelfde interface.
 */

const { newUlid } = require("./events");

// Statusmodel (h22). Codes zijn Engels/canoniek; labels leven in de i18n-laag.
const PROJECT_STATUSES = [
  "preparation", "planned", "active", "paused",
  "technically_done", "to_invoice", "closed", "cancelled",
];

// Toegestane overgangen (statemachine). Afsluiten en annuleren zijn eindpunten;
// heropening (h22 edge case) mag alleen vanaf closed → active met reden.
const PROJECT_TRANSITIONS = {
  preparation: ["planned", "active", "cancelled"],
  planned: ["active", "paused", "cancelled"],
  active: ["paused", "technically_done", "cancelled"],
  paused: ["active", "cancelled"],
  technically_done: ["to_invoice", "active", "cancelled"],
  to_invoice: ["closed", "active"],
  closed: ["active"],           // heropening na afsluiting (reden verplicht)
  cancelled: [],
};

const PROJECT_TYPES = ["project", "service", "maintenance", "internal"];

function clean(v) { return String(v == null ? "" : v).trim(); }
function isoDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : null; }

function canTransition(from, to) {
  return (PROJECT_TRANSITIONS[from] || []).includes(to);
}

/** Valideer en normaliseer een projectpayload (create of merge-patch). */
function normalizeProject(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  const name = clean(merged.name);
  if (!name) { const e = new Error("Projectnaam is verplicht"); e.status = 400; throw e; }
  if (!existing && !merged.customerId) { const e = new Error("Klant is verplicht"); e.status = 400; throw e; }

  const start = isoDate(merged.startDate);
  const end = isoDate(merged.endDate);
  if (start && end && end < start) { const e = new Error("Einddatum mag niet vóór de startdatum liggen"); e.status = 400; throw e; }

  const type = PROJECT_TYPES.includes(merged.type) ? merged.type : "project";
  const status = PROJECT_STATUSES.includes(merged.status) ? merged.status : "preparation";

  // Projectpartijen (h22): klant of leverancier + rol + contact.
  const parties = (Array.isArray(merged.parties) ? merged.parties : [])
    .map(p => {
      const partyName = clean(p && (p.name || p.role));
      if (!partyName && !(p && (p.customerId || p.supplierId))) return null;
      return {
        id: (p && p.id) || `pp_${newUlid()}`,
        role: clean(p && p.role) || "partner",
        name: clean(p && p.name),
        customerId: (p && p.customerId) || null,
        supplierId: (p && p.supplierId) || null,
        contact: clean(p && p.contact),
      };
    })
    .filter(Boolean);

  // Fasen/mijlpalen (h22). De baseline (h38) hoort bij de SERVERSTAAT, niet bij
  // de payload: we halen hem altijd uit de bestaande fase, zodat een client die
  // hem niet meestuurt de vergelijkbaarheid niet stilzwijgend wist.
  const existingPhaseById = new Map(((existing && existing.phases) || []).map(p => [p.id, p]));
  const phases = (Array.isArray(merged.phases) ? merged.phases : [])
    .map((ph, i) => {
      const title = clean(ph && ph.title);
      if (!title) return null;
      const prior = existingPhaseById.get(ph && ph.id) || null;
      return {
        id: (ph && ph.id) || `phase_${newUlid()}`,
        title,
        order: Number.isFinite(Number(ph && ph.order)) ? Number(ph.order) : i + 1,
        startDate: isoDate(ph && ph.startDate),
        endDate: isoDate(ph && ph.endDate),
        status: ["open", "active", "done"].includes(ph && ph.status) ? ph.status : "open",
        milestone: (ph && ph.milestone) === true,
        // Baseline uit de serverstaat; enkel bij een nieuwe fase mag de payload
        // er een meegeven (bv. bij import).
        baseline: (prior && prior.baseline) || ((ph && ph.baseline && typeof ph.baseline === "object") ? ph.baseline : null),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);

  return {
    name,
    type,
    status,
    customerId: merged.customerId || null,
    customerName: clean(merged.customerName),
    venueIds: Array.isArray(merged.venueIds) ? merged.venueIds.filter(Boolean) : (merged.venueId ? [merged.venueId] : []),
    managerId: merged.managerId || null,
    teamIds: Array.isArray(merged.teamIds) ? merged.teamIds.filter(Boolean) : [],
    startDate: start,
    endDate: end,
    // Financiële status apart van projectstatus (business rule).
    budgetAmount: merged.budgetAmount != null ? Math.max(0, Number(merged.budgetAmount) || 0) : null,
    financialStatus: ["open", "invoicing", "settled"].includes(merged.financialStatus) ? merged.financialStatus : "open",
    parties,
    phases,
    notes: clean(merged.notes),
  };
}

// ── Repository (compatibility over de store; latere pg-adapter = zelfde API) ──
function makeProjectRepository(store) {
  const col = "projects";
  return {
    list(tenantId) { return (store.list(col, tenantId) || []).slice(); },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(p => p.id === id) || null; },
    nextNumber(tenantId) {
      const year = new Date().getFullYear();
      const existing = (store.list(col, tenantId) || [])
        .map(p => Number(String(p.number || "").split("-").pop()))
        .filter(n => Number.isFinite(n));
      return `PRJ-${year}-${String((existing.length ? Math.max(...existing) : 0) + 1).padStart(3, "0")}`;
    },
    insert(tenantId, payload, actor) {
      const normalized = normalizeProject(payload, null);
      const now = new Date().toISOString();
      return store.insert(col, {
        id: `prj_${newUlid()}`,
        tenantId,
        number: this.nextNumber(tenantId),
        ...normalized,
        version: 1,
        createdAt: now, createdBy: actor || null,
        updatedAt: now, updatedBy: actor || null,
      });
    },
    update(tenantId, id, patch, actor, expectedVersion) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Project niet gevonden"); e.status = 404; throw e; }
      if (expectedVersion != null && Number(existing.version || 1) !== Number(expectedVersion)) {
        const e = new Error("Het project is intussen gewijzigd. Herlaad en probeer opnieuw.");
        e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = existing.version || 1;
        throw e;
      }
      // Status wijzigt alleen via transition(); patch mag de status niet forceren.
      const { status, ...rest } = patch || {};
      const normalized = normalizeProject({ ...rest, status: existing.status }, existing);
      return store.update(col, id, {
        ...normalized,
        version: Number(existing.version || 1) + 1,
        updatedAt: new Date().toISOString(), updatedBy: actor || null,
      });
    },
    /** Statusovergang met validatie tegen de statemachine (h22). */
    transition(tenantId, id, toStatus, actor, reason) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Project niet gevonden"); e.status = 404; throw e; }
      if (!PROJECT_STATUSES.includes(toStatus)) { const e = new Error(`Ongeldige status '${toStatus}'`); e.status = 400; throw e; }
      if (existing.status === toStatus) return existing;
      if (!canTransition(existing.status, toStatus)) {
        const e = new Error(`Overgang van '${existing.status}' naar '${toStatus}' is niet toegestaan`);
        e.status = 409; e.code = "INVALID_TRANSITION"; throw e;
      }
      // Heropening na afsluiting vereist een reden (h22 edge case).
      if (existing.status === "closed" && toStatus === "active" && !clean(reason)) {
        const e = new Error("Heropening van een afgesloten project vereist een reden"); e.status = 400; e.code = "REASON_REQUIRED"; throw e;
      }
      return store.update(col, id, {
        status: toStatus,
        version: Number(existing.version || 1) + 1,
        updatedAt: new Date().toISOString(), updatedBy: actor || null,
        ...(clean(reason) ? { lastTransitionReason: clean(reason) } : {}),
      });
    },
    remove(tenantId, id) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Project niet gevonden"); e.status = 404; throw e; }
      store.remove(col, id);
      return { ok: true };
    },
  };
}

module.exports = {
  PROJECT_STATUSES,
  PROJECT_TRANSITIONS,
  PROJECT_TYPES,
  canTransition,
  normalizeProject,
  makeProjectRepository,
};
