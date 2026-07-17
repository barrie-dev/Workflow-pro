"use strict";
/**
 * Assets + onderhoudsschema's · Service & Assets (master-spec h33/h34/h44, E16, R3).
 *
 * Generiek assetmodel (h44: "replaces vehicle-only thinking"): types vehicle,
 * machine, tool, installation (bij klant) en component. Een installatie draagt
 * klant, locatie, serienummer, garantie en servicehistoriek.
 *
 * Onderhoudsschema (maintenance plan): kalender- of uitvoeringsgebaseerde
 * cyclus met volgende datum. `generateDueJob` is idempotent (h44: "generate
 * next service job idempotently"): per plan + duedatum ontstaat maximaal één
 * beurt. Locatie-/statuswijzigingen zijn gebeurtenissen met historiek (h33).
 *
 * Zelfde compatibility-repository-patroon (ULID, version). Geen vendor/SQL.
 */

const { newUlid } = require("./events");

const ASSET_TYPES = ["vehicle", "machine", "tool", "installation", "component"];
// h44.1-statussen.
const ASSET_STATUSES = ["in_stock", "assigned", "installed", "active", "maintenance", "defective", "retired", "sold"];
const PLAN_STATUSES = ["draft", "active", "paused", "ended"];
const FREQUENCIES = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12, biennial: 24 };

function clean(v) { return String(v == null ? "" : v).trim(); }
function isoDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : null; }

function addMonths(dateStr, months) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function normalizeAsset(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  const name = clean(merged.name);
  if (!name) { const e = new Error("Assetnaam is verplicht"); e.status = 400; throw e; }
  const type = ASSET_TYPES.includes(merged.type) ? merged.type : "machine";
  const status = ASSET_STATUSES.includes(merged.status) ? merged.status : (type === "installation" ? "installed" : "in_stock");
  return {
    name,
    type,
    status,
    serial: clean(merged.serial),
    brand: clean(merged.brand),
    model: clean(merged.model),
    customerId: merged.customerId || null,     // bij installatie bij klant
    venueId: merged.venueId || null,           // gedeeld locatieobject
    worksiteId: merged.worksiteId || null,
    projectId: merged.projectId || null,
    assignedToId: merged.assignedToId || null, // in gebruik door
    purchaseDate: isoDate(merged.purchaseDate),
    warrantyUntil: isoDate(merged.warrantyUntil),
    meterReading: merged.meterReading != null ? Math.max(0, Number(merged.meterReading) || 0) : null,
    notes: clean(merged.notes),
  };
}

function normalizeMaintenancePlan(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  if (!existing && !merged.assetId) { const e = new Error("Asset is verplicht"); e.status = 400; throw e; }
  const frequency = Object.keys(FREQUENCIES).includes(merged.frequency) ? merged.frequency : "annual";
  const nextDue = isoDate(merged.nextDue);
  if (!existing && !nextDue) { const e = new Error("Volgende onderhoudsdatum (nextDue) is verplicht"); e.status = 400; throw e; }
  return {
    assetId: merged.assetId || null,
    title: clean(merged.title) || "Periodiek onderhoud",
    frequency,
    // Vaste kalenderbasis of vanaf werkelijke uitvoering (h34-business rule).
    basis: ["calendar", "execution"].includes(merged.basis) ? merged.basis : "calendar",
    nextDue: nextDue || (existing && existing.nextDue) || null,
    status: PLAN_STATUSES.includes(merged.status) ? merged.status : "active",
    checklist: (Array.isArray(merged.checklist) ? merged.checklist : []).map(c => clean(typeof c === "string" ? c : c && c.label)).filter(Boolean).slice(0, 30),
    contractId: merged.contractId || null,
    notes: clean(merged.notes),
  };
}

function makeAssetRepository(store) {
  const col = "assets";
  return {
    list(tenantId, opts = {}) {
      let rows = (store.list(col, tenantId) || []).slice();
      if (opts.type) rows = rows.filter(a => a.type === opts.type);
      if (opts.customerId) rows = rows.filter(a => a.customerId === opts.customerId);
      return rows;
    },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(a => a.id === id) || null; },
    insert(tenantId, payload, actor) {
      const normalized = normalizeAsset(payload, null);
      // Serienummer uniek binnen de tenant (h33) wanneer opgegeven.
      if (normalized.serial && this.list(tenantId).some(a => a.serial && a.serial === normalized.serial)) {
        const e = new Error(`Serienummer '${normalized.serial}' bestaat al`); e.status = 409; e.code = "DUPLICATE_SERIAL"; throw e;
      }
      const now = new Date().toISOString();
      return store.insert(col, {
        id: `ast_${newUlid()}`, tenantId, ...normalized,
        history: [{ at: now, by: actor || null, event: "created", status: normalized.status }],
        version: 1, createdAt: now, createdBy: actor || null, updatedAt: now, updatedBy: actor || null,
      });
    },
    update(tenantId, id, patch, actor, expectedVersion) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Asset niet gevonden"); e.status = 404; throw e; }
      if (expectedVersion != null && Number(existing.version || 1) !== Number(expectedVersion)) {
        const e = new Error("Het asset is intussen gewijzigd."); e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = existing.version || 1; throw e;
      }
      // Meterstand mag niet dalen zonder correctieprocedure (h33).
      if (patch && patch.meterReading != null && existing.meterReading != null
        && Number(patch.meterReading) < Number(existing.meterReading) && !patch.meterCorrection) {
        const e = new Error("Meterstand mag niet dalen · gebruik een correctie (meterCorrection: true) met reden");
        e.status = 409; e.code = "METER_DECREASE"; throw e;
      }
      const normalized = normalizeAsset(patch, existing);
      // Status-/locatie-/gebruikerswijzigingen zijn gebeurtenissen met historiek (h33).
      const history = Array.isArray(existing.history) ? existing.history.slice(-49) : [];
      const changes = [];
      if (normalized.status !== existing.status) changes.push(`status: ${existing.status} → ${normalized.status}`);
      if ((normalized.venueId || null) !== (existing.venueId || null)) changes.push("locatie gewijzigd");
      if ((normalized.customerId || null) !== (existing.customerId || null)) changes.push("klant gewijzigd");
      if ((normalized.assignedToId || null) !== (existing.assignedToId || null)) changes.push("gebruiker gewijzigd");
      if (patch && patch.meterCorrection) changes.push(`meterstand gecorrigeerd: ${clean(patch.meterCorrectionReason) || "geen reden"}`);
      if (changes.length) history.push({ at: new Date().toISOString(), by: actor || null, event: changes.join(" · "), status: normalized.status });
      return store.update(col, id, { ...normalized, history, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
    },
    remove(tenantId, id) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Asset niet gevonden"); e.status = 404; throw e; }
      store.remove(col, id);
      return { ok: true };
    },
  };
}

function makeMaintenancePlanRepository(store) {
  const col = "maintenancePlans";
  return {
    list(tenantId, opts = {}) {
      let rows = (store.list(col, tenantId) || []).slice();
      if (opts.assetId) rows = rows.filter(p => p.assetId === opts.assetId);
      if (opts.status) rows = rows.filter(p => p.status === opts.status);
      return rows;
    },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(p => p.id === id) || null; },
    insert(tenantId, payload, actor) {
      const normalized = normalizeMaintenancePlan(payload, null);
      const now = new Date().toISOString();
      return store.insert(col, {
        id: `mp_${newUlid()}`, tenantId, ...normalized, generatedFor: [],
        version: 1, createdAt: now, createdBy: actor || null, updatedAt: now, updatedBy: actor || null,
      });
    },
    update(tenantId, id, patch, actor, expectedVersion) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Onderhoudsschema niet gevonden"); e.status = 404; throw e; }
      if (expectedVersion != null && Number(existing.version || 1) !== Number(expectedVersion)) {
        const e = new Error("Het schema is intussen gewijzigd."); e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = existing.version || 1; throw e;
      }
      const normalized = normalizeMaintenancePlan(patch, existing);
      return store.update(col, id, { ...normalized, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
    },
    /** Schema's die (bijna) due zijn: nextDue <= horizon. */
    listDue(tenantId, horizonDays = 14, today = new Date().toISOString().slice(0, 10)) {
      const horizon = addMonths(today, 0); // start vandaag
      const limit = new Date(`${today}T12:00:00Z`);
      limit.setUTCDate(limit.getUTCDate() + horizonDays);
      const limitStr = limit.toISOString().slice(0, 10);
      return this.list(tenantId, { status: "active" }).filter(p => p.nextDue && p.nextDue >= "1970-01-01" && p.nextDue <= limitStr)
        .map(p => ({ ...p, overdue: p.nextDue < horizon }));
    },
    /**
     * Genereer idempotent een onderhoudsbeurt (werkbon) voor de huidige nextDue
     * (h44: "generate next service job idempotently"). Tweede aanroep voor
     * dezelfde duedatum geeft de bestaande beurt terug. Na generatie schuift
     * nextDue één frequentie op (kalenderbasis).
     * @param {function} createJob (plan, dueDate) → { id } · maakt de werkbon
     */
    generateDueJob(tenantId, id, actor, createJob) {
      const plan = this.findById(tenantId, id);
      if (!plan) { const e = new Error("Onderhoudsschema niet gevonden"); e.status = 404; throw e; }
      if (plan.status !== "active") { const e = new Error("Schema is niet actief"); e.status = 409; e.code = "PLAN_NOT_ACTIVE"; throw e; }
      const dueDate = plan.nextDue;
      const generated = Array.isArray(plan.generatedFor) ? plan.generatedFor : [];
      const already = generated.find(g => g.dueDate === dueDate);
      if (already) return { job: { id: already.jobId }, dueDate, alreadyGenerated: true, plan };
      const job = createJob(plan, dueDate);
      const months = FREQUENCIES[plan.frequency] || 12;
      const updated = store.update(col, id, {
        generatedFor: [...generated, { dueDate, jobId: job.id, at: new Date().toISOString() }].slice(-24),
        nextDue: addMonths(dueDate, months),
        version: Number(plan.version || 1) + 1,
        updatedAt: new Date().toISOString(), updatedBy: actor || null,
      });
      return { job, dueDate, alreadyGenerated: false, plan: updated };
    },
    remove(tenantId, id) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Onderhoudsschema niet gevonden"); e.status = 404; throw e; }
      store.remove(col, id);
      return { ok: true };
    },
  };
}

module.exports = {
  ASSET_TYPES, ASSET_STATUSES, PLAN_STATUSES, FREQUENCIES,
  addMonths, normalizeAsset, normalizeMaintenancePlan,
  makeAssetRepository, makeMaintenancePlanRepository,
};
