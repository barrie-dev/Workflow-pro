"use strict";
/**
 * Klantcontracten + terugkerende omzet (master-spec h35/E15, R4-b).
 *
 * Business rules (h35):
 *  - elke geplande generatie is IDEMPOTENT per periode (nooit tweemaal);
 *  - prijswijziging heeft een ingangsdatum en raakt historische periodes niet
 *    (prijsversies); indexatie = nieuwe prijsversie met bronindex + berekening;
 *  - pro rata wordt expliciet en reproduceerbaar berekend bij start/pauze/einde;
 *  - opzegging bewaart de laatste leverings- en facturatieverplichting
 *    (toekomstige periodes stoppen, historiek blijft);
 *  - handmatige generatie buiten schema vereist een reden;
 *  - een contract kan meerdere installaties (assets) dragen.
 *
 * Zelfde compatibility-repository-patroon (ULID, version, statemachine).
 * Geen vendor/SQL (ADR-001).
 */

const { newUlid } = require("./events");
const { round2 } = require("../modules/be-locale");

const CONTRACT_STATUSES = ["draft", "active", "paused", "cancelled", "expired", "ended"];
const CONTRACT_TRANSITIONS = {
  draft: ["active", "ended"],
  active: ["paused", "cancelled", "expired", "ended"],
  paused: ["active", "cancelled", "ended"],
  cancelled: ["ended"],
  expired: ["active", "ended"],   // verlengen = heractiveren met nieuwe einddatum
  ended: [],
};

const FREQUENCIES = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
const GENERATE_TYPES = ["invoice", "job"];

function clean(v) { return String(v == null ? "" : v).trim(); }
function isoDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : null; }
function canTransition(from, to) { return (CONTRACT_TRANSITIONS[from] || []).includes(to); }

function addMonths(dateStr, months) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Deterministische periodesleutel (idempotency-basis, h35). */
function periodKey(frequency, dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  if (frequency === "monthly") return `${y}-${String(m).padStart(2, "0")}`;
  if (frequency === "quarterly") return `${y}-Q${Math.ceil(m / 3)}`;
  if (frequency === "semiannual") return `${y}-H${m <= 6 ? 1 : 2}`;
  return String(y);
}

/** Periodegrenzen [start, endExclusive) voor pro rata. */
function periodBounds(frequency, dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  const months = FREQUENCIES[frequency] || 12;
  const startMonth = frequency === "monthly" ? m
    : frequency === "quarterly" ? (Math.ceil(m / 3) - 1) * 3 + 1
    : frequency === "semiannual" ? (m <= 6 ? 1 : 7)
    : 1;
  const start = `${y}-${String(startMonth).padStart(2, "0")}-01`;
  return { start, end: addMonths(start, months) };
}

/** Actieve prijsversie op een datum (h35: ingangsdatum, historiek onaangetast). */
function priceOn(contract, dateStr) {
  const versions = (contract.priceVersions || [])
    .filter(p => p.effectiveFrom && p.effectiveFrom <= dateStr)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return versions.length ? versions[versions.length - 1] : null;
}

/**
 * Expliciete, reproduceerbare pro rata (h35): dagbasis binnen de periode.
 * @returns {{ factor, daysCovered, daysTotal, from, to }}
 */
function proRata(frequency, periodStartStr, coverFromStr, coverToStr) {
  const { start, end } = periodBounds(frequency, periodStartStr);
  const dayMs = 86400000;
  const pStart = new Date(`${start}T00:00:00Z`).getTime();
  const pEnd = new Date(`${end}T00:00:00Z`).getTime();
  const from = Math.max(pStart, coverFromStr ? new Date(`${coverFromStr}T00:00:00Z`).getTime() : pStart);
  const to = Math.min(pEnd, coverToStr ? new Date(`${coverToStr}T00:00:00Z`).getTime() + dayMs : pEnd);
  const daysTotal = Math.round((pEnd - pStart) / dayMs);
  const daysCovered = Math.max(0, Math.round((to - from) / dayMs));
  return {
    factor: daysTotal ? round2(daysCovered / daysTotal * 100) / 100 : 0,
    daysCovered, daysTotal,
    from: new Date(from).toISOString().slice(0, 10),
    to: new Date(to - dayMs).toISOString().slice(0, 10),
  };
}

function normalizeContract(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  if (!existing && !merged.customerId) { const e = new Error("Klant is verplicht"); e.status = 400; throw e; }
  const title = clean(merged.title);
  if (!title) { const e = new Error("Contracttitel is verplicht"); e.status = 400; throw e; }
  const startDate = isoDate(merged.startDate);
  if (!existing && !startDate) { const e = new Error("Startdatum is verplicht"); e.status = 400; throw e; }
  const endDate = isoDate(merged.endDate);
  if (startDate && endDate && endDate < startDate) { const e = new Error("Einddatum mag niet vóór de startdatum liggen"); e.status = 400; throw e; }
  const frequency = Object.keys(FREQUENCIES).includes(merged.frequency) ? merged.frequency : "monthly";

  // Prijsversies: expliciete lijst of afgeleid van een enkel bedrag bij aanmaak.
  let priceVersions = Array.isArray(merged.priceVersions) ? merged.priceVersions
    .map(p => ({
      id: p.id || `pv_${newUlid()}`,
      effectiveFrom: isoDate(p.effectiveFrom) || startDate || (existing && existing.startDate),
      amount: round2(Math.max(0, Number(p.amount) || 0)),
      note: clean(p.note),
      indexation: p.indexation || null,
    }))
    .filter(p => p.effectiveFrom) : [];
  if (!priceVersions.length && merged.amount != null) {
    priceVersions = [{ id: `pv_${newUlid()}`, effectiveFrom: startDate || (existing && existing.startDate), amount: round2(Math.max(0, Number(merged.amount) || 0)), note: "startprijs", indexation: null }];
  }
  if (!existing && !priceVersions.length) { const e = new Error("Prijs (amount) of priceVersions is verplicht"); e.status = 400; throw e; }

  return {
    customerId: merged.customerId || null,
    projectId: merged.projectId || null,
    title,
    assetIds: Array.isArray(merged.assetIds) ? merged.assetIds.filter(Boolean) : [],
    startDate: startDate || (existing && existing.startDate) || null,
    endDate: endDate || null,
    renewal: ["auto", "manual", "none"].includes(merged.renewal) ? merged.renewal : "manual",
    noticePeriodDays: Number.isFinite(Number(merged.noticePeriodDays)) ? Math.max(0, Math.min(365, Number(merged.noticePeriodDays))) : 60,
    frequency,
    generateType: GENERATE_TYPES.includes(merged.generateType) ? merged.generateType : "invoice",
    billingTiming: ["advance", "arrears"].includes(merged.billingTiming) ? merged.billingTiming : "advance",
    includedHours: merged.includedHours != null ? Math.max(0, Number(merged.includedHours) || 0) : null,
    includedMaterialAmount: merged.includedMaterialAmount != null ? round2(Math.max(0, Number(merged.includedMaterialAmount) || 0)) : null,
    priceVersions,
    vatRate: [0, 6, 12, 21].includes(Number(merged.vatRate)) ? Number(merged.vatRate) : 21,
    notes: clean(merged.notes),
  };
}

function makeContractRepository(store) {
  const col = "contracts";
  return {
    list(tenantId, opts = {}) {
      let rows = (store.list(col, tenantId) || []).slice();
      if (opts.customerId) rows = rows.filter(c => c.customerId === opts.customerId);
      if (opts.status) rows = rows.filter(c => c.status === opts.status);
      return rows;
    },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(c => c.id === id) || null; },
    nextNumber(tenantId) {
      const year = new Date().getFullYear();
      const existing = (store.list(col, tenantId) || []).map(c => Number(String(c.number || "").split("-").pop())).filter(Number.isFinite);
      return `CT-${year}-${String((existing.length ? Math.max(...existing) : 0) + 1).padStart(3, "0")}`;
    },
    insert(tenantId, payload, actor) {
      const normalized = normalizeContract(payload, null);
      const now = new Date().toISOString();
      return store.insert(col, {
        id: `ct_${newUlid()}`, tenantId, number: this.nextNumber(tenantId),
        ...normalized, status: "draft", nextRun: null, generatedFor: [],
        version: 1, createdAt: now, createdBy: actor || null, updatedAt: now, updatedBy: actor || null,
      });
    },
    update(tenantId, id, patch, actor, expectedVersion) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Contract niet gevonden"); e.status = 404; throw e; }
      if (expectedVersion != null && Number(existing.version || 1) !== Number(expectedVersion)) {
        const e = new Error("Het contract is intussen gewijzigd."); e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = existing.version || 1; throw e;
      }
      const { status, generatedFor, nextRun, ...rest } = patch || {};
      const normalized = normalizeContract(rest, existing);
      return store.update(col, id, { ...normalized, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
    },
    transition(tenantId, id, toStatus, actor) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Contract niet gevonden"); e.status = 404; throw e; }
      if (!CONTRACT_STATUSES.includes(toStatus)) { const e = new Error(`Ongeldige status '${toStatus}'`); e.status = 400; throw e; }
      if (existing.status === toStatus) return existing;
      if (!canTransition(existing.status, toStatus)) {
        const e = new Error(`Overgang van '${existing.status}' naar '${toStatus}' is niet toegestaan`); e.status = 409; e.code = "INVALID_TRANSITION"; throw e;
      }
      const patch = { status: toStatus, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null };
      // Activeren zet de eerstvolgende generatiedatum (start of hervatting).
      if (toStatus === "active" && !existing.nextRun) patch.nextRun = existing.startDate;
      if (toStatus === "cancelled") patch.cancelledAt = new Date().toISOString();
      return store.update(col, id, patch);
    },
    /** Indexatie = nieuwe prijsversie met bronindex + berekening (h35). */
    applyIndexation(tenantId, id, { pct, sourceIndex, effectiveFrom }, actor) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Contract niet gevonden"); e.status = 404; throw e; }
      const from = isoDate(effectiveFrom);
      if (!from) { const e = new Error("Ingangsdatum (effectiveFrom) is verplicht"); e.status = 400; throw e; }
      const pctNum = Number(pct);
      if (!Number.isFinite(pctNum) || pctNum <= -100 || pctNum > 100) { const e = new Error("Indexatiepercentage is ongeldig"); e.status = 400; throw e; }
      const base = priceOn(existing, from);
      if (!base) { const e = new Error("Geen basisprijs gevonden vóór de ingangsdatum"); e.status = 409; throw e; }
      const newAmount = round2(base.amount * (1 + pctNum / 100));
      const version = {
        id: `pv_${newUlid()}`,
        effectiveFrom: from,
        amount: newAmount,
        note: `Indexatie ${pctNum}%`,
        indexation: { pct: pctNum, sourceIndex: clean(sourceIndex) || null, baseAmount: base.amount, baseVersionId: base.id, calculation: `${base.amount} × (1 + ${pctNum}/100) = ${newAmount}` },
      };
      return store.update(col, id, {
        priceVersions: [...(existing.priceVersions || []), version],
        version: Number(existing.version || 1) + 1,
        updatedAt: new Date().toISOString(), updatedBy: actor || null,
      });
    },
    /**
     * Genereer idempotent het document voor de volgende periode (h35).
     * Handmatig buiten schema (date ≠ nextRun-periode) vereist een reden.
     * @param {function} createDoc (contract, { periodKey, price, prorata, amount }) → { id, number? }
     */
    generateForPeriod(tenantId, id, actor, opts, createDoc) {
      const contract = this.findById(tenantId, id);
      if (!contract) { const e = new Error("Contract niet gevonden"); e.status = 404; throw e; }
      if (contract.status !== "active") { const e = new Error("Contract is niet actief"); e.status = 409; e.code = "CONTRACT_NOT_ACTIVE"; throw e; }
      const runDate = isoDate(opts && opts.date) || contract.nextRun || contract.startDate;
      if (!runDate) { const e = new Error("Geen generatiedatum beschikbaar"); e.status = 409; throw e; }
      const key = periodKey(contract.frequency, runDate);
      const scheduledKey = contract.nextRun ? periodKey(contract.frequency, contract.nextRun) : key;
      const outOfSchedule = key !== scheduledKey;
      if (outOfSchedule && !clean(opts && opts.reason)) {
        const e = new Error("Generatie buiten schema vereist een reden"); e.status = 400; e.code = "REASON_REQUIRED"; throw e;
      }
      // Einddatum: geen nieuwe periodes na het einde (opzegging bewaart de laatste verplichting).
      if (contract.endDate) {
        const { start } = periodBounds(contract.frequency, runDate);
        if (start > contract.endDate) { const e = new Error("Periode valt volledig na de einddatum van het contract"); e.status = 409; e.code = "AFTER_END"; throw e; }
      }
      const generated = Array.isArray(contract.generatedFor) ? contract.generatedFor : [];
      const already = generated.find(g => g.periodKey === key);
      if (already) return { doc: { id: already.resultId, number: already.number }, periodKey: key, alreadyGenerated: true, contract };

      const { start } = periodBounds(contract.frequency, runDate);
      // Prijsdatum = de latere van periodestart en contractstart, zodat de
      // eerste (deel)periode de prijsversie vanaf de contractstart gebruikt en
      // volledige periodes de versie die op de periodestart geldt.
      const priceDate = contract.startDate && start < contract.startDate ? contract.startDate : start;
      const price = priceOn(contract, priceDate);
      if (!price) { const e = new Error("Geen geldige prijsversie voor deze periode"); e.status = 409; throw e; }
      // Pro rata bij start of einde binnen de periode (expliciet, h35).
      const rata = proRata(contract.frequency, runDate, contract.startDate, contract.endDate);
      const amount = round2(price.amount * rata.factor);

      const doc = createDoc(contract, { periodKey: key, price, prorata: rata, amount, periodStart: rata.from, periodEnd: rata.to, outOfSchedule, reason: clean(opts && opts.reason) || null });

      const months = FREQUENCIES[contract.frequency] || 1;
      const patch = {
        generatedFor: [...generated, { periodKey: key, resultId: doc.id, number: doc.number || null, type: contract.generateType, at: new Date().toISOString(), amount, prorata: rata.factor !== 1 ? rata : null, priceVersionId: price.id, outOfSchedule, reason: clean(opts && opts.reason) || null }].slice(-60),
        version: Number(contract.version || 1) + 1,
        updatedAt: new Date().toISOString(), updatedBy: actor || null,
      };
      if (!outOfSchedule) patch.nextRun = addMonths(runDate, months);
      const updated = store.update(col, id, patch);
      return { doc, periodKey: key, amount, prorata: rata, alreadyGenerated: false, contract: updated };
    },
    remove(tenantId, id) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Contract niet gevonden"); e.status = 404; throw e; }
      if ((existing.generatedFor || []).length) { const e = new Error("Een contract met generatiehistoriek kan niet worden verwijderd · beëindig het"); e.status = 409; throw e; }
      store.remove(col, id);
      return { ok: true };
    },
  };
}

module.exports = {
  CONTRACT_STATUSES, CONTRACT_TRANSITIONS, FREQUENCIES, GENERATE_TYPES,
  canTransition, periodKey, periodBounds, priceOn, proRata, normalizeContract,
  makeContractRepository,
};
