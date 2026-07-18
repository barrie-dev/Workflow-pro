"use strict";
/**
 * Werkbonnen v2 · mobiele uitvoering (master-spec h25/E07, R1 · WBO).
 *
 * Canoniek werkbon-aggregaat BOVENOP de bestaande workorders-collectie
 * (compatibility repository / strangler M1): legacy-rijen worden bij het lezen
 * opgewaardeerd (upgradeLegacy) zodat oude werkbonnen blijven werken terwijl
 * nieuwe velden beschikbaar komen. Geen big-bang, geen parallelle collectie.
 *
 * Business rules (h25):
 *  - Offline-first: de mobiele client houdt een lokale mutatiewachtrij bij en
 *    synchroniseert met een baseVersion. Conflicten worden NOOIT stilzwijgend
 *    overschreven (acceptatie): bij een versieverschil geeft sync 409 met de
 *    serverstaat terug, zodat de client kan samenvoegen.
 *  - Een medewerker mag alleen EIGEN uren wijzigen, tenzij ploegleiderrecht.
 *  - Verplichte formulieren blokkeren inzending.
 *  - Na goedkeuring kunnen uren en materiaal alleen nog via een CORRECTIEBOEKING
 *    wijzigen; die blijft auditbaar (immutable correctie-ledger).
 *  - Materiaalverbruik draagt een kost-snapshot en kan voorraad boeken vanaf een
 *    ingestelde voorraadlocatie (E17).
 *  - Kosttarief wordt bepaald op de UITVOERINGSDATUM (niet op factuurdatum).
 *  - Handtekening wordt gekoppeld aan de exacte werkbonversie.
 *  - Facturatiestrategieën: detail, gegroepeerd of één totaalregel.
 *  - Garantiewerk versus factureerbaar werk wordt per regel onderscheiden.
 *
 * Cloudblind (ADR-001): geen SDK, geen SQL, geen omgevingsvariabelen.
 */

const crypto = require("crypto");
const { newUlid } = require("./events");
const { round2 } = require("../modules/be-locale");

// Statusmodel h25 (+ cancelled voor legacy-compatibiliteit).
const STATUSES = [
  "draft", "mobile_busy", "pending_sync", "submitted", "to_review",
  "approved", "rejected_for_correction", "locked", "partially_invoiced", "invoiced", "cancelled",
];
const TRANSITIONS = {
  draft: ["mobile_busy", "submitted", "cancelled"],
  mobile_busy: ["pending_sync", "submitted", "draft", "cancelled"],
  pending_sync: ["submitted", "mobile_busy", "cancelled"],
  submitted: ["to_review", "rejected_for_correction", "approved", "cancelled"],
  to_review: ["approved", "rejected_for_correction", "cancelled"],
  rejected_for_correction: ["mobile_busy", "submitted", "cancelled"],
  approved: ["locked", "partially_invoiced", "invoiced"],
  locked: ["partially_invoiced", "invoiced"],
  partially_invoiced: ["invoiced", "locked"],
  invoiced: [],
  cancelled: [],
};
// Vanaf deze statussen zijn uren/materiaal bevroren: enkel nog correctieboekingen.
const FROZEN_STATUSES = ["approved", "locked", "partially_invoiced", "invoiced"];
// Legacy-statussen → canoniek (strangler: oude rijen blijven leesbaar).
const LEGACY_STATUS_MAP = {
  open: "draft", gepland: "draft", planned: "draft", nieuw: "draft",
  in_progress: "mobile_busy", bezig: "mobile_busy",
  voltooid: "submitted", afgewerkt: "submitted", klaar: "submitted",
  geannuleerd: "cancelled", cancelled: "cancelled",
};
const MOBILITY_TYPES = ["none", "car", "van", "truck", "public", "bike"];
const INVOICE_STRATEGIES = ["detail", "grouped", "single"];

function clean(v) { return String(v == null ? "" : v).trim(); }
function num(v, dflt = 0) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }
function isoDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : null; }
function canTransition(from, to) { return (TRANSITIONS[from] || []).includes(to); }
function isFrozen(status) { return FROZEN_STATUSES.includes(status); }

/** Canonieke status uit een (mogelijk legacy) statuswaarde. */
function canonicalStatus(raw) {
  const s = clean(raw);
  if (STATUSES.includes(s)) return s;
  return LEGACY_STATUS_MAP[s.toLowerCase()] || "draft";
}

// ── Uren per medewerker (ploeg met verschillende uren · h25 edge case) ──────
/** Netto minuten van een werkblok minus pauzes. */
function workedMinutes(worker) {
  const start = clean(worker.start), end = clean(worker.end);
  if (!start || !end) return 0;
  const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
  const s = toMin(start), e = toMin(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  const breaks = (Array.isArray(worker.breaks) ? worker.breaks : []).reduce((sum, b) => {
    const bs = toMin(clean(b.start)), be = toMin(clean(b.end));
    return Number.isFinite(bs) && Number.isFinite(be) && be > bs ? sum + (be - bs) : sum;
  }, 0);
  return Math.max(0, e - s - breaks);
}

function normalizeWorker(w, executionDate) {
  const userId = clean(w && (w.userId || w.id));
  if (!userId) return null;
  const breaks = (Array.isArray(w.breaks) ? w.breaks : [])
    .map(b => ({ start: clean(b.start), end: clean(b.end) }))
    .filter(b => b.start && b.end).slice(0, 10);
  const base = { userId, name: clean(w.name), start: clean(w.start), end: clean(w.end), breaks };
  const minutes = workedMinutes(base);
  // Handmatige uren mogen de berekening overschrijven (bv. offline ingetikt).
  const hours = w.hours != null ? round2(Math.max(0, num(w.hours))) : round2(minutes / 60);
  return {
    ...base,
    hours,
    hourCode: clean(w.hourCode) || "normaal",
    activity: clean(w.activity),
    // Kosttarief wordt bepaald op de UITVOERINGSDATUM en vastgeklikt (h25).
    costRate: round2(Math.max(0, num(w.costRate, 0))),
    costRateDate: isoDate(w.costRateDate) || executionDate || null,
    salesRate: round2(Math.max(0, num(w.salesRate, 0))),
    billable: w.billable !== false,       // garantie versus factureerbaar (h25)
    warranty: w.warranty === true,
  };
}

// ── Materiaal & materieel ───────────────────────────────────────────────────
function normalizeMaterial(m) {
  const description = clean(m && (m.description || m.name));
  const articleId = clean(m && m.articleId);
  if (!description && !articleId) return null;
  const qty = round2(Math.max(0, num(m.qty, 0)));
  const unitPrice = round2(Math.max(0, num(m.unitPrice, 0)));
  const costPrice = round2(Math.max(0, num(m.costPrice, 0)));
  return {
    id: clean(m.id) || `wom_${newUlid()}`,
    articleId: articleId || null,
    articleNumber: clean(m.articleNumber) || null,
    description,
    qty,
    unit: clean(m.unit) || "st",
    unitPrice,
    costPrice,                            // kost-snapshot (voedt projectkost)
    vatRate: [0, 6, 12, 21].includes(Number(m.vatRate)) ? Number(m.vatRate) : 21,
    lineTotal: round2(qty * unitPrice),
    lineCost: round2(qty * costPrice),
    stockLocationId: clean(m.stockLocationId) || null,   // voorraadboeking (E17)
    stockBooked: m.stockBooked === true,
    billable: m.billable !== false,
    warranty: m.warranty === true,
  };
}

function normalizeEquipment(e) {
  const description = clean(e && (e.description || e.name));
  if (!description) return null;
  const hours = round2(Math.max(0, num(e.hours, 0)));
  const rate = round2(Math.max(0, num(e.rate, 0)));
  return {
    id: clean(e.id) || `woe_${newUlid()}`,
    assetId: clean(e.assetId) || null,
    description, hours, rate,
    lineTotal: round2(hours * rate),
    billable: e.billable !== false,
  };
}

// ── Formulieren (verplichte vragen blokkeren inzending · h25) ────────────────
function normalizeForms(input) {
  return (Array.isArray(input) ? input : [])
    .map(f => {
      const id = clean(f && f.id) || `wof_${newUlid()}`;
      const label = clean(f && (f.label || f.question));
      if (!label) return null;
      return {
        id, label,
        type: ["text", "number", "bool", "choice"].includes(f.type) ? f.type : "text",
        required: f.required === true,
        answer: f.answer === undefined ? null : f.answer,
        options: Array.isArray(f.options) ? f.options.map(clean).filter(Boolean).slice(0, 20) : [],
      };
    })
    .filter(Boolean)
    .slice(0, 100);
}

/** Onbeantwoorde verplichte vragen · blokkeert indienen (acceptatie h25). */
function missingRequiredAnswers(forms) {
  return (forms || [])
    .filter(f => f.required && (f.answer === null || f.answer === undefined || clean(f.answer) === ""))
    .map(f => ({ id: f.id, label: f.label }));
}

// ── Handtekening gekoppeld aan de exacte werkbonversie (h25) ────────────────
/** Inhoudshash over de factureerbare kern; bindt een handtekening aan die staat. */
function contentHash(wo) {
  const material = { workers: wo.workers, materials: wo.materials, equipment: wo.equipment, forms: wo.forms, description: wo.description, date: wo.date };
  return crypto.createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 32);
}

// ── Canonieke vorm ──────────────────────────────────────────────────────────
/**
 * Waardeer een (legacy of canonieke) rij op tot de canonieke werkbon.
 * Behoudt ALLE bestaande legacy-velden zodat oude schermen blijven werken.
 */
function upgradeLegacy(row) {
  if (!row) return null;
  const executionDate = isoDate(row.date) || null;
  const workers = Array.isArray(row.workers) && row.workers.length
    ? row.workers.map(w => normalizeWorker(w, executionDate)).filter(Boolean)
    : [];
  const status = canonicalStatus(row.status);
  return {
    ...row,                                   // legacy-velden blijven intact
    status,
    legacyStatus: STATUSES.includes(clean(row.status)) ? null : clean(row.status) || null,
    workers,
    materials: (Array.isArray(row.materials) ? row.materials : []).map(normalizeMaterial).filter(Boolean),
    equipment: (Array.isArray(row.equipment) ? row.equipment : []).map(normalizeEquipment).filter(Boolean),
    forms: normalizeForms(row.forms),
    kilometers: round2(Math.max(0, num(row.kilometers, 0))),
    mobilityType: MOBILITY_TYPES.includes(row.mobilityType) ? row.mobilityType : "none",
    signature: row.signature && typeof row.signature === "object" ? row.signature : null,
    review: row.review && typeof row.review === "object" ? row.review : { status: "none", by: null, at: null, note: "" },
    corrections: Array.isArray(row.corrections) ? row.corrections : [],
    sync: row.sync && typeof row.sync === "object" ? row.sync : { clientId: null, clientUpdatedAt: null, lastSyncAt: null },
    version: Number(row.version || 1),
    extraWork: clean(row.extraWork),
  };
}

/** Totalen: kost en verkoop, met garantie/factureerbaar onderscheid (h25). */
function computeTotals(wo) {
  const laborCost = (wo.workers || []).reduce((s, w) => s + w.hours * w.costRate, 0);
  const laborSales = (wo.workers || []).reduce((s, w) => s + (w.billable && !w.warranty ? w.hours * w.salesRate : 0), 0);
  const matCost = (wo.materials || []).reduce((s, m) => s + m.lineCost, 0);
  const matSales = (wo.materials || []).reduce((s, m) => s + (m.billable && !m.warranty ? m.lineTotal : 0), 0);
  const eqSales = (wo.equipment || []).reduce((s, e) => s + (e.billable ? e.lineTotal : 0), 0);
  return {
    hours: round2((wo.workers || []).reduce((s, w) => s + w.hours, 0)),
    billableHours: round2((wo.workers || []).reduce((s, w) => s + (w.billable && !w.warranty ? w.hours : 0), 0)),
    cost: round2(laborCost + matCost),
    sales: round2(laborSales + matSales + eqSales),
    warrantyValue: round2(
      (wo.workers || []).reduce((s, w) => s + (w.warranty ? w.hours * w.salesRate : 0), 0)
      + (wo.materials || []).reduce((s, m) => s + (m.warranty ? m.lineTotal : 0), 0)
    ),
  };
}

/**
 * Factuurlijnen volgens strategie (h25): detail (alle regels), grouped
 * (arbeid/materiaal/materieel samengevoegd) of single (één totaalregel).
 * Garantie- en niet-factureerbare regels vallen altijd weg.
 */
function buildInvoiceLines(wo, strategy = "detail") {
  const strat = INVOICE_STRATEGIES.includes(strategy) ? strategy : "detail";
  const workers = (wo.workers || []).filter(w => w.billable && !w.warranty && w.hours > 0);
  const materials = (wo.materials || []).filter(m => m.billable && !m.warranty && m.qty > 0);
  const equipment = (wo.equipment || []).filter(e => e.billable && e.hours > 0);

  if (strat === "single") {
    const t = computeTotals(wo);
    if (t.sales <= 0) return [];
    return [{ description: `Werkbon ${wo.number || ""} · ${wo.title || "uitgevoerde werken"}`.trim(), qty: 1, unitPrice: t.sales, vatRate: 21, sourceType: "workorder", sourceId: wo.id }];
  }
  if (strat === "grouped") {
    const lines = [];
    const laborTotal = round2(workers.reduce((s, w) => s + w.hours * w.salesRate, 0));
    const laborHours = round2(workers.reduce((s, w) => s + w.hours, 0));
    if (laborHours > 0) lines.push({ description: "Werkuren", qty: laborHours, unitPrice: laborHours ? round2(laborTotal / laborHours) : 0, vatRate: 21, sourceType: "workorder", sourceId: wo.id });
    const matTotal = round2(materials.reduce((s, m) => s + m.lineTotal, 0));
    if (matTotal > 0) lines.push({ description: "Materiaal", qty: 1, unitPrice: matTotal, vatRate: 21, sourceType: "workorder", sourceId: wo.id });
    const eqTotal = round2(equipment.reduce((s, e) => s + e.lineTotal, 0));
    if (eqTotal > 0) lines.push({ description: "Materieel", qty: 1, unitPrice: eqTotal, vatRate: 21, sourceType: "workorder", sourceId: wo.id });
    return lines;
  }
  // detail
  return [
    ...workers.map(w => ({ description: `Werkuren${w.name ? ` · ${w.name}` : ""}${w.activity ? ` (${w.activity})` : ""}`, qty: w.hours, unitPrice: w.salesRate, vatRate: 21, sourceType: "workorder", sourceId: wo.id })),
    ...materials.map(m => ({ description: m.description, qty: m.qty, unitPrice: m.unitPrice, vatRate: m.vatRate, sourceType: "workorder", sourceId: wo.id })),
    ...equipment.map(e => ({ description: `Materieel · ${e.description}`, qty: e.hours, unitPrice: e.rate, vatRate: 21, sourceType: "workorder", sourceId: wo.id })),
  ].filter(l => l.qty > 0);
}

/**
 * Mag deze gebruiker de uren van targetUserId wijzigen? (h25-business rule:
 * eigen uren mag altijd; andermans uren enkel met ploegleider-/beheerrecht.)
 */
function canEditWorkerHours(user, targetUserId) {
  if (!user) return false;
  if (String(user.id) === String(targetUserId)) return true;
  const perms = user.permissions || [];
  if (perms.includes("*") || perms.includes("workorders")) return true;
  return ["tenant_admin", "super_admin", "manager"].includes(user.role);
}

// ── Repository ──────────────────────────────────────────────────────────────
function makeWorkOrderRepository(store) {
  const col = "workorders";
  return {
    list(tenantId, { status, projectId, customerId, assignedTo } = {}) {
      return (store.list(col, tenantId) || [])
        .map(upgradeLegacy)
        .filter(w => (!status || w.status === status)
          && (!projectId || w.projectId === projectId)
          && (!customerId || w.customerId === customerId)
          && (!assignedTo || (w.workers || []).some(x => String(x.userId) === String(assignedTo))))
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    },
    findById(tenantId, id) {
      const row = (store.list(col, tenantId) || []).find(w => w.id === id);
      return row ? upgradeLegacy(row) : null;
    },

    /**
     * Werkbon bijwerken met optimistic locking. `actorUser` bepaalt of
     * andermans uren gewijzigd mogen worden; na goedkeuring is de werkbon
     * bevroren (dan enkel addCorrection).
     */
    update(tenantId, id, patch, actorUser, expectedVersion) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Werkbon niet gevonden"); e.status = 404; throw e; }
      if (expectedVersion != null && Number(existing.version) !== Number(expectedVersion)) {
        const e = new Error("De werkbon is intussen gewijzigd."); e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = existing.version; e.serverState = existing; throw e;
      }
      if (isFrozen(existing.status) && (patch.workers || patch.materials || patch.equipment)) {
        const e = new Error("Deze werkbon is goedgekeurd · wijzig uren of materiaal via een correctieboeking"); e.status = 409; e.code = "CORRECTION_REQUIRED"; throw e;
      }
      const executionDate = isoDate(patch.date) || existing.date || null;

      // Eigen-uren-regel: enkel eigen werkerregel wijzigbaar zonder ploegleiderrecht.
      let workers = existing.workers;
      if (patch.workers) {
        const incoming = patch.workers.map(w => normalizeWorker(w, executionDate)).filter(Boolean);
        for (const w of incoming) {
          const before = existing.workers.find(x => String(x.userId) === String(w.userId));
          const changed = !before || before.hours !== w.hours || before.start !== w.start || before.end !== w.end;
          if (changed && !canEditWorkerHours(actorUser, w.userId)) {
            const e = new Error("Je mag alleen je eigen uren wijzigen"); e.status = 403; e.code = "OWN_HOURS_ONLY"; throw e;
          }
        }
        // Verwijderen van andermans regel vereist eveneens ploegleiderrecht.
        for (const before of existing.workers) {
          if (!incoming.some(w => String(w.userId) === String(before.userId)) && !canEditWorkerHours(actorUser, before.userId)) {
            const e = new Error("Je mag alleen je eigen uren wijzigen"); e.status = 403; e.code = "OWN_HOURS_ONLY"; throw e;
          }
        }
        workers = incoming;
      }

      const next = {
        ...(patch.title !== undefined ? { title: clean(patch.title) } : {}),
        ...(patch.description !== undefined ? { description: clean(patch.description) } : {}),
        ...(patch.extraWork !== undefined ? { extraWork: clean(patch.extraWork) } : {}),
        ...(patch.date !== undefined ? { date: executionDate } : {}),
        ...(patch.kilometers !== undefined ? { kilometers: round2(Math.max(0, num(patch.kilometers))) } : {}),
        ...(patch.mobilityType !== undefined ? { mobilityType: MOBILITY_TYPES.includes(patch.mobilityType) ? patch.mobilityType : "none" } : {}),
        ...(patch.workers ? { workers } : {}),
        ...(patch.materials ? { materials: patch.materials.map(normalizeMaterial).filter(Boolean) } : {}),
        ...(patch.equipment ? { equipment: patch.equipment.map(normalizeEquipment).filter(Boolean) } : {}),
        ...(patch.forms ? { forms: normalizeForms(patch.forms) } : {}),
        version: Number(existing.version) + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: (actorUser && actorUser.email) || null,
      };
      const saved = store.update(col, id, next);
      const upgraded = upgradeLegacy(saved);
      // Handtekening vervalt zodra de ondertekende inhoud wijzigt (h25).
      if (upgraded.signature && upgraded.signature.boundHash && upgraded.signature.boundHash !== contentHash(upgraded)) {
        store.update(col, id, { signature: { ...upgraded.signature, invalidated: true, invalidatedAt: new Date().toISOString() } });
        return this.findById(tenantId, id);
      }
      return upgraded;
    },

    /**
     * Offline-sync: de client stuurt zijn lokale mutaties met de baseVersion
     * waarop hij werkte. Wijkt die af van de server, dan is er een conflict en
     * geven we 409 MET de serverstaat terug · nooit stilzwijgend overschrijven
     * (acceptatiecriterium h25).
     */
    sync(tenantId, id, { baseVersion, patch, clientId, clientUpdatedAt }, actorUser) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Werkbon niet gevonden"); e.status = 404; throw e; }
      if (baseVersion == null) { const e = new Error("baseVersion is verplicht voor sync"); e.status = 400; e.code = "BASE_VERSION_REQUIRED"; throw e; }
      if (Number(existing.version) !== Number(baseVersion)) {
        const e = new Error("De werkbon is op de server gewijzigd sinds je laatste synchronisatie");
        e.status = 409; e.code = "SYNC_CONFLICT"; e.currentVersion = existing.version;
        e.serverState = existing; e.clientPatch = patch || {};
        throw e;
      }
      const updated = this.update(tenantId, id, patch || {}, actorUser, baseVersion);
      const saved = store.update(col, id, {
        sync: { clientId: clean(clientId) || null, clientUpdatedAt: clean(clientUpdatedAt) || null, lastSyncAt: new Date().toISOString() },
      });
      return upgradeLegacy(saved) || updated;
    },

    /** Indienen: verplichte formulieren en handtekeningregel afdwingen (h25). */
    submit(tenantId, id, actorUser, { requireSignature = false } = {}) {
      const wo = this.findById(tenantId, id);
      if (!wo) { const e = new Error("Werkbon niet gevonden"); e.status = 404; throw e; }
      if (!canTransition(wo.status, "submitted")) { const e = new Error(`Indienen kan niet vanuit status ${wo.status}`); e.status = 409; e.code = "INVALID_TRANSITION"; throw e; }
      const missing = missingRequiredAnswers(wo.forms);
      if (missing.length) {
        const e = new Error(`Verplichte vragen zijn nog niet beantwoord: ${missing.map(m => m.label).join(", ")}`);
        e.status = 400; e.code = "REQUIRED_FORMS_MISSING"; e.missing = missing; throw e;
      }
      if (requireSignature && (!wo.signature || wo.signature.invalidated)) {
        const e = new Error("Een geldige handtekening van de klant ontbreekt"); e.status = 400; e.code = "SIGNATURE_REQUIRED"; throw e;
      }
      const saved = store.update(col, id, {
        status: "submitted", version: Number(wo.version) + 1,
        submittedAt: new Date().toISOString(), submittedBy: (actorUser && actorUser.email) || null,
        review: { status: "pending", by: null, at: null, note: "" },
        updatedAt: new Date().toISOString(),
      });
      return upgradeLegacy(saved);
    },

    /** Handtekening vastleggen, gebonden aan de exacte werkbonversie (h25). */
    sign(tenantId, id, { by, dataRef }, actorUser) {
      const wo = this.findById(tenantId, id);
      if (!wo) { const e = new Error("Werkbon niet gevonden"); e.status = 404; throw e; }
      if (isFrozen(wo.status)) { const e = new Error("Een goedgekeurde werkbon kan niet opnieuw ondertekend worden"); e.status = 409; e.code = "FROZEN"; throw e; }
      const signature = {
        by: clean(by) || "klant",
        at: new Date().toISOString(),
        dataRef: clean(dataRef) || null,
        boundVersion: Number(wo.version),
        boundHash: contentHash(wo),
        invalidated: false,
        capturedBy: (actorUser && actorUser.email) || null,
      };
      const saved = store.update(col, id, { signature, version: Number(wo.version) + 1, updatedAt: new Date().toISOString() });
      return upgradeLegacy(saved);
    },

    /** Review: goedkeuren of afwijzen voor correctie. */
    review(tenantId, id, { decision, note }, actorUser) {
      const wo = this.findById(tenantId, id);
      if (!wo) { const e = new Error("Werkbon niet gevonden"); e.status = 404; throw e; }
      const to = decision === "approve" ? "approved" : "rejected_for_correction";
      if (!canTransition(wo.status, to)) { const e = new Error(`Review kan niet vanuit status ${wo.status}`); e.status = 409; e.code = "INVALID_TRANSITION"; throw e; }
      const saved = store.update(col, id, {
        status: to,
        review: { status: to === "approved" ? "approved" : "rejected", by: (actorUser && actorUser.email) || null, at: new Date().toISOString(), note: clean(note) },
        approvedAt: to === "approved" ? new Date().toISOString() : null,
        version: Number(wo.version) + 1, updatedAt: new Date().toISOString(),
      });
      return upgradeLegacy(saved);
    },

    /**
     * Correctieboeking na goedkeuring (h25): wijzigt uren/materiaal NIET stil,
     * maar voegt een onveranderlijke correctie toe die auditbaar blijft.
     */
    addCorrection(tenantId, id, { type, targetId, field, from, to, qty, reason }, actorUser) {
      const wo = this.findById(tenantId, id);
      if (!wo) { const e = new Error("Werkbon niet gevonden"); e.status = 404; throw e; }
      if (!isFrozen(wo.status)) { const e = new Error("Correctieboekingen gelden pas na goedkeuring · wijzig de werkbon rechtstreeks"); e.status = 409; e.code = "NOT_FROZEN"; throw e; }
      if (!clean(reason)) { const e = new Error("Een correctie vereist een reden"); e.status = 400; e.code = "REASON_REQUIRED"; throw e; }
      const entry = {
        id: `wcor_${newUlid()}`,
        type: ["hours", "material", "equipment", "other"].includes(type) ? type : "other",
        targetId: clean(targetId) || null,
        field: clean(field) || null,
        from: from === undefined ? null : from,
        to: to === undefined ? null : to,
        qty: qty == null ? null : round2(num(qty)),
        reason: clean(reason),
        at: new Date().toISOString(),
        by: (actorUser && actorUser.email) || null,
      };
      const saved = store.update(col, id, {
        corrections: [...(wo.corrections || []), entry],
        version: Number(wo.version) + 1, updatedAt: new Date().toISOString(),
      });
      return { workorder: upgradeLegacy(saved), correction: entry };
    },

    transition(tenantId, id, to, actorUser) {
      const wo = this.findById(tenantId, id);
      if (!wo) { const e = new Error("Werkbon niet gevonden"); e.status = 404; throw e; }
      if (wo.status === to) return wo;
      if (!canTransition(wo.status, to)) { const e = new Error(`Ongeldige statusovergang: ${wo.status} → ${to}`); e.status = 409; e.code = "INVALID_TRANSITION"; throw e; }
      const saved = store.update(col, id, { status: to, version: Number(wo.version) + 1, updatedAt: new Date().toISOString(), updatedBy: (actorUser && actorUser.email) || null });
      return upgradeLegacy(saved);
    },
  };
}

module.exports = {
  STATUSES, TRANSITIONS, FROZEN_STATUSES, INVOICE_STRATEGIES, MOBILITY_TYPES,
  canonicalStatus, upgradeLegacy, normalizeWorker, normalizeMaterial, normalizeForms,
  missingRequiredAnswers, workedMinutes, contentHash, computeTotals, buildInvoiceLines,
  canEditWorkerHours, isFrozen, makeWorkOrderRepository,
};
