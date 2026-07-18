"use strict";
/**
 * Projectfinance read-model (master-spec h23/E14, R4-a).
 *
 * Budget / werkelijk / gefactureerd / marge per project, met drill-down naar
 * bronrecords (ontwikkelprincipe: "iedere KPI is herleidbaar tot bronrecords
 * en formule"). Read-model met eventual consistency toegestaan (h5.3); de
 * financiële bron van waarheid blijven de documenten zelf.
 *
 * Bronnen (compatibility: alles wat vandaag aan een project gelinkt is):
 *  - budget: project.budgetAmount (basisbudget + geaccepteerde change orders,
 *    al verwerkt door R2-b) + drill-down naar de change orders
 *  - arbeid: shifts met projectId × uurtarief (werkbon- of standaardtarief);
 *    expliciet gelabeld als raming tegen tarief (er zijn nog geen kostprijzen
 *    per medewerker · dat komt met EMP-cost rates)
 *  - materiaal: workorder.materials van werkbonnen met projectId
 *  - onkosten: expenses gelinkt aan werkbonnen van dit project of direct projectId
 *  - gefactureerd: facturen met projectId of via quote/werkbon van dit project
 *    (creditnota's tellen negatief mee); alleen niet-concept documenten
 */

const { round2 } = require("../modules/be-locale");

function hhmmToMin(t) { const m = String(t || "").match(/^(\d{2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }

function buildProjectFinance(store, tenant, project) {
  const tenantId = tenant.id;
  const defaultRate = Number(tenant.defaultHourlyRate || (tenant.billingOps && tenant.billingOps.defaultHourlyRate) || 0);

  // ── Budget + change orders ─────────────────────────────────────────────────
  const changeOrders = (store.list("changeOrders", tenantId) || []).filter(c => c.projectId === project.id);
  const acceptedChanges = changeOrders.filter(c => ["accepted", "executed", "invoiced"].includes(c.status));
  const budget = {
    total: Number(project.budgetAmount || 0),
    acceptedChangeTotal: round2(acceptedChanges.reduce((s, c) => s + Number(c.total || 0), 0)),
    sources: acceptedChanges.map(c => ({ type: "change_order", id: c.id, number: c.number, amount: c.total })),
  };

  // ── Werkbonnen van dit project ─────────────────────────────────────────────
  const workorders = (store.list("workorders", tenantId) || []).filter(w => w.projectId === project.id);
  const workorderIds = new Set(workorders.map(w => w.id));

  // ── Arbeid: shifts met projectId (raming tegen tarief) ─────────────────────
  const shifts = (store.list("shifts", tenantId) || []).filter(s => s.projectId === project.id);
  let laborMinutes = 0;
  for (const s of shifts) {
    const mins = Math.max(0, hhmmToMin(s.end) - hhmmToMin(s.start));
    const resources = 1 + (Array.isArray(s.assigneeIds) ? s.assigneeIds.length : 0);
    laborMinutes += mins * resources;
  }
  const laborHours = round2(laborMinutes / 60);
  const laborCost = round2(laborHours * defaultRate);

  // ── Materiaal uit werkbonnen ───────────────────────────────────────────────
  let materialCost = 0;
  const materialSources = [];
  for (const w of workorders) {
    for (const m of (Array.isArray(w.materials) ? w.materials : [])) {
      const amount = round2(Number(m.qty || 1) * Number(m.unitPrice || 0));
      if (amount > 0) { materialCost = round2(materialCost + amount); materialSources.push({ type: "workorder_material", workorderId: w.id, description: m.description || "", amount }); }
    }
  }

  // ── Onkosten ───────────────────────────────────────────────────────────────
  const expenses = (store.list("expenses", tenantId) || []).filter(e =>
    (e.projectId === project.id || (e.workorderId && workorderIds.has(e.workorderId)))
    && ["approved", "goedgekeurd"].includes(e.status));
  const expenseCost = round2(expenses.reduce((s, e) => s + Number(e.amount || 0), 0));

  // ── Gefactureerd (excl. concepten; creditnota's negatief) ──────────────────
  const quotes = (store.list("quotes", tenantId) || []).filter(q => q.projectId === project.id);
  const quoteIds = new Set(quotes.map(q => q.id));
  const invoices = (store.list("invoices", tenantId) || []).filter(i =>
    i.projectId === project.id
    || (i.quoteId && quoteIds.has(i.quoteId))
    || (i.workorderId && workorderIds.has(i.workorderId)));
  const invoiced = round2(invoices.reduce((s, i) => s + Number(i.subtotal ?? i.total ?? 0), 0));
  const paid = round2(invoices.filter(i => i.status === "paid").reduce((s, i) => s + Number(i.subtotal ?? i.total ?? 0), 0));

  // ── Openstaande verplichtingen (commitments) uit inkooporders (E18/h27) ─────
  // Een bestelling is een verplichting, geen gerealiseerde kost → voedt de
  // forecast, niet de werkelijke kost.
  const openStatuses = ["approved", "sent", "confirmed", "partially_received", "partially_invoiced"];
  const purchaseOrders = (store.list("purchaseOrders", tenantId) || []).filter(po => po.projectId === project.id && openStatuses.includes(po.status));
  const commitment = round2(purchaseOrders.reduce((s, po) =>
    s + (po.lines || []).reduce((ls, l) => ls + Math.max(0, Number(l.orderedQty || 0) - Number(l.receivedQty || 0)) * Number(l.unitPrice || 0), 0), 0));

  const actualCost = round2(laborCost + materialCost + expenseCost);
  const forecastCost = round2(actualCost + commitment);
  const margin = round2(invoiced - actualCost);

  return {
    projectId: project.id,
    number: project.number,
    financialStatus: project.financialStatus || "open",
    budget,
    actual: {
      total: actualCost,
      labor: { hours: laborHours, rate: defaultRate, cost: laborCost, basis: "rate_estimate", sourceCount: shifts.length },
      material: { cost: materialCost, sources: materialSources.slice(0, 25) },
      expenses: { cost: expenseCost, sourceCount: expenses.length },
    },
    invoiced: { total: invoiced, paid, sourceCount: invoices.length, sources: invoices.slice(0, 25).map(i => ({ id: i.id, number: i.number, docType: i.docType || "invoice", amount: i.subtotal ?? i.total, status: i.status })) },
    commitment: { total: commitment, sourceCount: purchaseOrders.length, sources: purchaseOrders.slice(0, 25).map(po => ({ id: po.id, number: po.number, open: round2((po.lines || []).reduce((ls, l) => ls + Math.max(0, Number(l.orderedQty || 0) - Number(l.receivedQty || 0)) * Number(l.unitPrice || 0), 0)) })) },
    forecastCost,
    margin,
    budgetRemaining: round2(Number(project.budgetAmount || 0) - actualCost),
    forecastBudgetRemaining: round2(Number(project.budgetAmount || 0) - forecastCost),
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { buildProjectFinance };
