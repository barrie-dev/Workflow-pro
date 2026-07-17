"use strict";
/**
 * Meerwerk / minderwerk · change orders (master-spec h20/h43.4, E12, R2-b).
 *
 * Een change order is een aparte, traceerbare wijziging op de scope van een
 * project, bovenop de onveranderlijke geaccepteerde offerte (R1-b). Business
 * rules (h43.4):
 *  - de oorspronkelijke accepted quote blijft ongewijzigd;
 *  - een change verwijst naar project, basis-scope, reden en initiator;
 *  - statemachine draft→...→executed→invoiced;
 *  - een accepted change wijzigt het contractbudget (forecast blijft apart);
 *  - een negatieve change mag het reeds gefactureerde bedrag niet stilzwijgend
 *    onder nul brengen (dan verloopt de correctie via de credit flow).
 *
 * Zelfde compatibility-repository-patroon (ULID, version). Geen vendor/SQL.
 */

const { newUlid } = require("./events");
const { round2 } = require("../modules/be-locale");

const CHANGE_STATUSES = ["draft", "internal_review", "sent", "accepted", "rejected", "withdrawn", "executed", "invoiced"];

// Toegestane overgangen (h43.4).
const CHANGE_TRANSITIONS = {
  draft: ["internal_review", "sent", "withdrawn"],
  internal_review: ["draft", "sent", "withdrawn"],
  sent: ["accepted", "rejected", "withdrawn"],
  accepted: ["executed", "withdrawn"],
  rejected: ["draft", "withdrawn"],
  withdrawn: [],
  executed: ["invoiced"],
  invoiced: [],
};

function canTransition(from, to) { return (CHANGE_TRANSITIONS[from] || []).includes(to); }
function clean(v) { return String(v == null ? "" : v).trim(); }

function computeLines(rawLines) {
  const lines = (Array.isArray(rawLines) ? rawLines : []).map(l => {
    const qty = Number(l.qty || 0);
    const unitPrice = Number(l.unitPrice || 0);
    const vatRate = Number(l.vatRate ?? 21);
    const lineSubtotal = round2(qty * unitPrice);
    return { description: clean(l.description), qty, unitPrice, vatRate, lineSubtotal, lineVat: round2(lineSubtotal * vatRate / 100), lineTotal: round2(lineSubtotal * (1 + vatRate / 100)) };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.lineSubtotal, 0));
  const vatAmount = round2(lines.reduce((s, l) => s + l.lineVat, 0));
  return { lines, subtotal, vatAmount, total: round2(subtotal + vatAmount) };
}

function normalizeChangeOrder(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  if (!existing && !merged.projectId) { const e = new Error("Project is verplicht"); e.status = 400; throw e; }
  const reason = clean(merged.reason);
  if (!existing && !reason) { const e = new Error("Reden van het meerwerk/minderwerk is verplicht"); e.status = 400; throw e; }
  const { lines, subtotal, vatAmount, total } = computeLines(merged.lines);
  if (!lines.length) { const e = new Error("Minimaal 1 lijn vereist"); e.status = 400; throw e; }
  return {
    projectId: merged.projectId || null,
    quoteId: merged.quoteId || null,           // basis-scope (geaccepteerde offerte)
    title: clean(merged.title) || (total < 0 ? "Minderwerk" : "Meerwerk"),
    reason,
    // Werk vóór acceptatie: emergency/at-risk-flag + bevoegdheid (h43.4).
    atRisk: !!merged.atRisk,
    lines, subtotal, vatAmount, total,
    kind: total < 0 ? "decrease" : "increase",
  };
}

function makeChangeOrderRepository(store) {
  const col = "changeOrders";
  return {
    list(tenantId, opts = {}) {
      let rows = (store.list(col, tenantId) || []).slice();
      if (opts.projectId) rows = rows.filter(c => c.projectId === opts.projectId);
      return rows;
    },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(c => c.id === id) || null; },
    nextNumber(tenantId) {
      const year = new Date().getFullYear();
      const existing = (store.list(col, tenantId) || []).map(c => Number(String(c.number || "").split("-").pop())).filter(Number.isFinite);
      return `CO-${year}-${String((existing.length ? Math.max(...existing) : 0) + 1).padStart(3, "0")}`;
    },
    insert(tenantId, payload, actor) {
      const normalized = normalizeChangeOrder(payload, null);
      const now = new Date().toISOString();
      return store.insert(col, {
        id: `co_${newUlid()}`, tenantId, number: this.nextNumber(tenantId),
        ...normalized, status: "draft", initiatedBy: actor || null,
        version: 1, createdAt: now, createdBy: actor || null, updatedAt: now, updatedBy: actor || null,
      });
    },
    update(tenantId, id, patch, actor, expectedVersion) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Change order niet gevonden"); e.status = 404; throw e; }
      // Onveranderlijk zodra geaccepteerd of verder (h43.4: accepted wijzigt budget).
      if (["accepted", "executed", "invoiced"].includes(existing.status)) {
        const e = new Error("Een geaccepteerde change order kan niet meer worden bewerkt"); e.status = 409; e.code = "CHANGE_LOCKED"; throw e;
      }
      if (expectedVersion != null && Number(existing.version || 1) !== Number(expectedVersion)) {
        const e = new Error("De change order is intussen gewijzigd."); e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = existing.version || 1; throw e;
      }
      const { status, ...rest } = patch || {};
      const normalized = normalizeChangeOrder({ ...rest }, existing);
      return store.update(col, id, { ...normalized, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
    },
    /** Statusovergang; retourneert { changeOrder, budgetDelta } (delta bij acceptatie). */
    transition(tenantId, id, toStatus, actor) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Change order niet gevonden"); e.status = 404; throw e; }
      if (!CHANGE_STATUSES.includes(toStatus)) { const e = new Error(`Ongeldige status '${toStatus}'`); e.status = 400; throw e; }
      if (existing.status === toStatus) return { changeOrder: existing, budgetDelta: 0 };
      if (!canTransition(existing.status, toStatus)) {
        const e = new Error(`Overgang van '${existing.status}' naar '${toStatus}' is niet toegestaan`); e.status = 409; e.code = "INVALID_TRANSITION"; throw e;
      }
      const row = store.update(col, id, {
        status: toStatus,
        ...(toStatus === "accepted" ? { acceptedAt: new Date().toISOString() } : {}),
        version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null,
      });
      // Accepted change wijzigt het contractbudget (h43.4).
      const budgetDelta = toStatus === "accepted" ? Number(existing.total || 0) : 0;
      return { changeOrder: row, budgetDelta };
    },
    remove(tenantId, id) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Change order niet gevonden"); e.status = 404; throw e; }
      if (["accepted", "executed", "invoiced"].includes(existing.status)) { const e = new Error("Een geaccepteerde change order kan niet worden verwijderd"); e.status = 409; throw e; }
      store.remove(col, id);
      return { ok: true };
    },
  };
}

module.exports = { CHANGE_STATUSES, CHANGE_TRANSITIONS, canTransition, normalizeChangeOrder, makeChangeOrderRepository };
