"use strict";
/**
 * Aankoop-foundation · leveranciers + inkooporders (master-spec h27/E18, R5).
 *
 * Business rules (h27):
 *  - besteld / ontvangen / gefactureerd worden PER LIJN afzonderlijk bijgehouden;
 *  - een bestelling is een VERPLICHTING (commitment), geen gerealiseerde kost
 *    → voedt de projectforecast (E14);
 *  - ontvangst kan in delen en per locatie; ontvangstpercentage is
 *    reproduceerbaar (niet louter visueel);
 *  - een bestelling kan niet volledig worden afgesloten met open hoeveelheden
 *    zonder expliciete reden;
 *  - prijs-/hoeveelheidafwijkingen boven tolerantie vereisen goedkeuring (later).
 *
 * Ontvangst boekt een voorraadmutatie (receipt) via platform/inventory.
 * Zelfde compatibility-repository-patroon (ULID, version, statemachine).
 */

const { newUlid } = require("./events");
const { round2 } = require("../modules/be-locale");
const { bookMovement } = require("./inventory");

const PO_STATUSES = ["draft", "for_approval", "approved", "sent", "confirmed", "partially_received", "received", "partially_invoiced", "invoiced", "closed", "cancelled"];
const PO_TRANSITIONS = {
  draft: ["for_approval", "approved", "cancelled"],
  for_approval: ["approved", "draft", "cancelled"],
  approved: ["sent", "cancelled"],
  sent: ["confirmed", "cancelled"],
  confirmed: ["partially_received", "received", "cancelled"],
  partially_received: ["received", "cancelled"],
  received: ["partially_invoiced", "invoiced", "closed"],
  partially_invoiced: ["invoiced", "closed"],
  invoiced: ["closed"],
  closed: [],
  cancelled: [],
};
const PO_TYPES = ["material", "subcontract", "rental", "transport"];

function clean(v) { return String(v == null ? "" : v).trim(); }
function isoDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : null; }
function canTransition(from, to) { return (PO_TRANSITIONS[from] || []).includes(to); }

// ── Leveranciers ─────────────────────────────────────────────────────────────
function normalizeSupplier(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  const name = clean(merged.name);
  if (!name) { const e = new Error("Leveranciersnaam is verplicht"); e.status = 400; throw e; }
  const email = clean(merged.email).toLowerCase();
  if (email && !email.includes("@")) { const e = new Error("Geldig e-mailadres is vereist"); e.status = 400; throw e; }
  return {
    name,
    type: ["supplier", "subcontractor"].includes(merged.type) ? merged.type : "supplier",
    vatNumber: clean(merged.vatNumber || merged.vat),
    email,
    phone: clean(merged.phone),
    iban: clean(merged.iban),                 // gevoelig veld (h8.2)
    paymentTermsDays: Number.isFinite(Number(merged.paymentTermsDays)) ? Math.max(0, Math.min(120, Number(merged.paymentTermsDays))) : 30,
    notes: clean(merged.notes),
  };
}

function makeSupplierRepository(store) {
  const col = "suppliers";
  return {
    list(tenantId) { return (store.list(col, tenantId) || []).slice(); },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(s => s.id === id) || null; },
    insert(tenantId, payload, actor) {
      const normalized = normalizeSupplier(payload, null);
      const now = new Date().toISOString();
      return store.insert(col, { id: `sup_${newUlid()}`, tenantId, ...normalized, version: 1, createdAt: now, createdBy: actor || null, updatedAt: now, updatedBy: actor || null });
    },
    update(tenantId, id, patch, actor, expectedVersion) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Leverancier niet gevonden"); e.status = 404; throw e; }
      if (expectedVersion != null && Number(existing.version || 1) !== Number(expectedVersion)) { const e = new Error("De leverancier is intussen gewijzigd."); e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = existing.version || 1; throw e; }
      const normalized = normalizeSupplier(patch, existing);
      return store.update(col, id, { ...normalized, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
    },
    remove(tenantId, id) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Leverancier niet gevonden"); e.status = 404; throw e; }
      store.remove(col, id);
      return { ok: true };
    },
  };
}

// ── Inkooporders ─────────────────────────────────────────────────────────────
function normalizePurchaseOrder(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  if (!existing && !merged.supplierId) { const e = new Error("Leverancier is verplicht"); e.status = 400; throw e; }
  const rawLines = Array.isArray(merged.lines) ? merged.lines : [];
  const lines = rawLines.map(l => {
    const orderedQty = Math.max(0, Number(l.orderedQty ?? l.qty ?? 0));
    const unitPrice = Math.max(0, Number(l.unitPrice ?? 0));
    return {
      id: l.id || `pol_${newUlid()}`,
      description: clean(l.description),
      articleId: l.articleId || null,
      orderedQty: round2(orderedQty),
      unit: clean(l.unit) || "st",
      unitPrice: round2(unitPrice),
      vatRate: [0, 6, 12, 21].includes(Number(l.vatRate)) ? Number(l.vatRate) : 21,
      // Per-lijn tracking (h27): behoud bestaande received/invoiced bij merge.
      receivedQty: round2(Math.max(0, Number(l.receivedQty ?? (existing && (existing.lines || []).find(x => x.id === l.id) || {}).receivedQty ?? 0))),
      invoicedQty: round2(Math.max(0, Number(l.invoicedQty ?? (existing && (existing.lines || []).find(x => x.id === l.id) || {}).invoicedQty ?? 0))),
      lineTotal: round2(orderedQty * unitPrice),
    };
  }).filter(l => l.description || l.articleId);
  if (!existing && !lines.length) { const e = new Error("Minimaal 1 bestellijn vereist"); e.status = 400; throw e; }
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  return {
    supplierId: merged.supplierId || null,
    type: PO_TYPES.includes(merged.type) ? merged.type : "material",
    projectId: merged.projectId || null,
    locationId: merged.locationId || null,        // ontvangstlocatie (voorraad)
    orderDate: isoDate(merged.orderDate) || new Date().toISOString().slice(0, 10),
    expectedDate: isoDate(merged.expectedDate),
    deliveryAddress: clean(merged.deliveryAddress),
    lines,
    subtotal,
    notes: clean(merged.notes),
  };
}

/** Ontvangstpercentage per lijn en totaal (reproduceerbaar, h27). */
function receiptProgress(po) {
  const totalOrdered = (po.lines || []).reduce((s, l) => s + Number(l.orderedQty || 0), 0);
  const totalReceived = (po.lines || []).reduce((s, l) => s + Number(l.receivedQty || 0), 0);
  return {
    orderedQty: round2(totalOrdered),
    receivedQty: round2(totalReceived),
    pct: totalOrdered ? round2(totalReceived / totalOrdered * 100) : 0,
    fullyReceived: totalOrdered > 0 && totalReceived >= totalOrdered,
    openQty: round2(Math.max(0, totalOrdered - totalReceived)),
  };
}

/** Openstaande verplichting = niet-ontvangen besteld bedrag (commitment, E14). */
function commitmentAmount(po) {
  return round2((po.lines || []).reduce((s, l) => s + Math.max(0, Number(l.orderedQty || 0) - Number(l.receivedQty || 0)) * Number(l.unitPrice || 0), 0));
}

function makePurchaseOrderRepository(store) {
  const col = "purchaseOrders";
  return {
    list(tenantId, opts = {}) {
      let rows = (store.list(col, tenantId) || []).slice();
      if (opts.supplierId) rows = rows.filter(p => p.supplierId === opts.supplierId);
      if (opts.projectId) rows = rows.filter(p => p.projectId === opts.projectId);
      if (opts.status) rows = rows.filter(p => p.status === opts.status);
      return rows.map(p => ({ ...p, progress: receiptProgress(p), commitment: commitmentAmount(p) }));
    },
    findById(tenantId, id) {
      const p = (store.list(col, tenantId) || []).find(x => x.id === id);
      return p ? { ...p, progress: receiptProgress(p), commitment: commitmentAmount(p) } : null;
    },
    nextNumber(tenantId) {
      const year = new Date().getFullYear();
      const existing = (store.list(col, tenantId) || []).map(p => Number(String(p.number || "").split("-").pop())).filter(Number.isFinite);
      return `PO-${year}-${String((existing.length ? Math.max(...existing) : 0) + 1).padStart(3, "0")}`;
    },
    insert(tenantId, payload, actor) {
      const normalized = normalizePurchaseOrder(payload, null);
      const now = new Date().toISOString();
      const row = store.insert(col, { id: `po_${newUlid()}`, tenantId, number: this.nextNumber(tenantId), ...normalized, status: "draft", version: 1, createdAt: now, createdBy: actor || null, updatedAt: now, updatedBy: actor || null });
      return { ...row, progress: receiptProgress(row), commitment: commitmentAmount(row) };
    },
    update(tenantId, id, patch, actor, expectedVersion) {
      const existing = (store.list(col, tenantId) || []).find(x => x.id === id);
      if (!existing) { const e = new Error("Bestelling niet gevonden"); e.status = 404; throw e; }
      // Onveranderlijk zodra verzonden (h27: dan is het een externe verplichting).
      if (!["draft", "for_approval", "approved"].includes(existing.status)) { const e = new Error("Een verzonden bestelling kan niet meer worden bewerkt"); e.status = 409; e.code = "PO_LOCKED"; throw e; }
      if (expectedVersion != null && Number(existing.version || 1) !== Number(expectedVersion)) { const e = new Error("De bestelling is intussen gewijzigd."); e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = existing.version || 1; throw e; }
      const { status, ...rest } = patch || {};
      const normalized = normalizePurchaseOrder(rest, existing);
      const row = store.update(col, id, { ...normalized, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
      return { ...row, progress: receiptProgress(row), commitment: commitmentAmount(row) };
    },
    transition(tenantId, id, toStatus, actor, opts = {}) {
      const existing = (store.list(col, tenantId) || []).find(x => x.id === id);
      if (!existing) { const e = new Error("Bestelling niet gevonden"); e.status = 404; throw e; }
      if (!PO_STATUSES.includes(toStatus)) { const e = new Error(`Ongeldige status '${toStatus}'`); e.status = 400; throw e; }
      if (existing.status === toStatus) return this.findById(tenantId, id);
      if (!canTransition(existing.status, toStatus)) { const e = new Error(`Overgang van '${existing.status}' naar '${toStatus}' is niet toegestaan`); e.status = 409; e.code = "INVALID_TRANSITION"; throw e; }
      // Afsluiten met open hoeveelheden vereist een reden (h27).
      if (toStatus === "closed" && !receiptProgress(existing).fullyReceived && !clean(opts.reason)) {
        const e = new Error("Afsluiten met open hoeveelheden vereist een reden"); e.status = 400; e.code = "REASON_REQUIRED"; throw e;
      }
      const row = store.update(col, id, { status: toStatus, ...(clean(opts.reason) ? { closeReason: clean(opts.reason) } : {}), version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
      return { ...row, progress: receiptProgress(row), commitment: commitmentAmount(row) };
    },
    /**
     * Boek een (deel)ontvangst (h27: per lijn, in delen). Verhoogt receivedQty
     * per lijn, boekt een voorraadmutatie (receipt) op de locatie, en zet de
     * PO-status op partially_received / received.
     * @param receipts [{ lineId, qty }]
     */
    receive(tenantId, id, receipts, actor, receiptLocationId) {
      const existing = (store.list(col, tenantId) || []).find(x => x.id === id);
      if (!existing) { const e = new Error("Bestelling niet gevonden"); e.status = 404; throw e; }
      if (!["confirmed", "partially_received", "sent", "approved"].includes(existing.status)) {
        const e = new Error("Er kan pas worden ontvangen op een bevestigde bestelling"); e.status = 409; e.code = "PO_NOT_RECEIVABLE"; throw e;
      }
      const locationId = receiptLocationId || existing.locationId;
      const byLine = new Map((Array.isArray(receipts) ? receipts : []).map(r => [r.lineId, Math.abs(Number(r.qty) || 0)]));
      const movements = [];
      const newLines = existing.lines.map(l => {
        const recv = byLine.get(l.id) || 0;
        if (recv <= 0) return l;
        const openQty = Number(l.orderedQty || 0) - Number(l.receivedQty || 0);
        if (recv > openQty + 0.0001) { const e = new Error(`Ontvangst (${recv}) overschrijdt de openstaande hoeveelheid (${openQty}) voor lijn '${l.description}'`); e.status = 409; e.code = "OVER_RECEIPT"; throw e; }
        if (l.articleId && locationId) {
          movements.push(bookMovement(store, tenantId, { articleId: l.articleId, locationId, type: "receipt", qty: recv, unitCost: l.unitPrice, sourceType: "purchase_order", sourceId: id }, actor));
        }
        return { ...l, receivedQty: round2(Number(l.receivedQty || 0) + recv) };
      });
      const progress = receiptProgress({ lines: newLines });
      const nextStatus = progress.fullyReceived ? "received" : "partially_received";
      const row = store.update(col, id, { lines: newLines, status: nextStatus, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
      return { purchaseOrder: { ...row, progress, commitment: commitmentAmount(row) }, movements, progress };
    },
    remove(tenantId, id) {
      const existing = (store.list(col, tenantId) || []).find(x => x.id === id);
      if (!existing) { const e = new Error("Bestelling niet gevonden"); e.status = 404; throw e; }
      if (!["draft", "for_approval", "cancelled"].includes(existing.status)) { const e = new Error("Alleen een concept of geannuleerde bestelling kan worden verwijderd"); e.status = 409; throw e; }
      store.remove(col, id);
      return { ok: true };
    },
  };
}

module.exports = {
  PO_STATUSES, PO_TRANSITIONS, PO_TYPES, canTransition,
  normalizeSupplier, normalizePurchaseOrder, receiptProgress, commitmentAmount,
  makeSupplierRepository, makePurchaseOrderRepository,
};
