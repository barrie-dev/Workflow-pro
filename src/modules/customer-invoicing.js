"use strict";
/**
 * Klantfacturatie · één plek voor het opbouwen van een klantfactuur, zodat het
 * handmatige facturatiescherm, de offerte→factuur-conversie en de nieuwe
 * werkbon→factuur-knop exact dezelfde logica delen (nummering, btw-regime,
 * cent-afronding, gestructureerde mededeling).
 */

const { round2, structuredCommunication } = require("./be-locale");
const { emitDomainEvent } = require("../platform/events");
const { issueNumber } = require("../platform/companies");

// Btw-regimes met verlegging (0% btw) + de wettelijk verplichte vermelding.
const REGIME_NOTES = {
  intracom: "Btw verlegd · intracommunautaire handeling (art. 21 §2 / art. 39bis W.Btw).",
  medecontractant: "Btw verlegd · medecontractant (KB nr. 1, art. 20 W.Btw).",
};

// Nummering loopt via de persistente reeks per onderneming (E01/PLT-BR-005);
// zie platform/companies.js. Geen hergebruik van nummers na een delete.

// Normaliseer ruwe lijnen → factuurlijnen + totalen, rekening houdend met btw-regime.
function computeLines(rawLines, reverseCharge) {
  const lines = rawLines.map(l => {
    const qty = Number(l.qty || 1);
    const unitPrice = Number(l.unitPrice || 0);
    const vatRate = reverseCharge ? 0 : Number(l.vatRate ?? 21);
    const lineSubtotal = round2(qty * unitPrice);
    const lineVat = round2(lineSubtotal * vatRate / 100);
    // Bronlijn-traceerbaarheid (E08/h30): elke lijn is herleidbaar tot bron of
    // expliciet "manual". sourceType/sourceId komen van de conversieroutes.
    return {
      description: l.description || "", qty, unitPrice, vatRate,
      lineSubtotal, lineVat, lineTotal: round2(lineSubtotal + lineVat),
      sourceType: ["quote", "workorder", "contract", "credit", "manual"].includes(l.sourceType) ? l.sourceType : "manual",
      sourceId: l.sourceId || null,
    };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.lineSubtotal, 0));
  const vatAmount = round2(lines.reduce((s, l) => s + l.lineVat, 0));
  const total = round2(subtotal + vatAmount);
  return { lines, subtotal, vatAmount, total };
}

// Bouwt en bewaart een klantfactuur in de "invoices"-collectie.
function createCustomerInvoice(store, tenant, user, payload) {
  const rawLines = Array.isArray(payload.lines) ? payload.lines : [];
  if (!rawLines.length) { const e = new Error("Minimaal 1 factuurregel vereist"); e.status = 400; throw e; }
  const regime = ["intracom", "medecontractant"].includes(payload.vatRegime) ? payload.vatRegime : "binnen";
  const reverseCharge = regime !== "binnen";
  const vatNote = reverseCharge ? REGIME_NOTES[regime] : "";
  const { lines, subtotal, vatAmount, total } = computeLines(rawLines, reverseCharge);
  const issued = issueNumber(store, { tenant, docType: "invoice" });
  const number = issued.number;
  const invoice = store.insert("invoices", {
    id: `inv_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    tenantId: tenant.id,
    companyId: issued.companyId,
    number,
    customerId: payload.customerId || null,
    customerName: payload.customerName || "",
    customerAddress: payload.customerAddress || "",
    customerVatNumber: payload.customerVatNumber || "",
    status: "open",
    invoiceDate: payload.invoiceDate || new Date().toISOString().slice(0, 10),
    dueDate: payload.dueDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    lines, subtotal, vatAmount, total,
    vatRegime: regime, vatNote,
    structuredComm: structuredCommunication(number),
    notes: payload.notes || "",
    workorderId: payload.workorderId || null,
    paidAt: null, sentAt: null,
    createdBy: user.email,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  store.audit({ actor: user.email, tenantId: tenant.id, action: "invoice_created", area: "facturen", detail: `${number} · €${total.toFixed(2)}` });
  emitDomainEvent(store, { tenantId: tenant.id, eventType: "invoice.created", aggregateType: "invoice", aggregateId: invoice.id, actor: user.email, data: { source: payload.workorderId ? "workorder" : "manual" } });
  return invoice;
}

/**
 * Creditnota op een bestaande factuur (E08/h30): verwijst naar het origineel,
 * keert de gekozen (of alle) lijnen om en corrigeert btw + openstaand saldo.
 * Idempotent: een reeds volledig gecrediteerde factuur wordt niet nog eens
 * gecrediteerd. Definitieve facturen blijven onveranderlijk; correctie loopt
 * uitsluitend via deze creditnota + eventueel een nieuwe factuur.
 */
function createCreditNote(store, tenant, user, invoice, opts = {}) {
  if (!invoice) { const e = new Error("Factuur niet gevonden"); e.status = 404; throw e; }
  if (invoice.creditNoteId) { const e = new Error("Deze factuur is al volledig gecrediteerd"); e.status = 409; e.code = "ALREADY_CREDITED"; throw e; }
  // Welke lijnen crediteren? Standaard alle; anders de meegegeven index-set.
  const idx = Array.isArray(opts.lineIndexes) && opts.lineIndexes.length ? new Set(opts.lineIndexes.map(Number)) : null;
  const creditLines = (invoice.lines || [])
    .filter((_, i) => !idx || idx.has(i))
    .map(l => ({
      description: `Credit: ${l.description || ""}`.slice(0, 200),
      qty: -Math.abs(Number(l.qty || 0)),
      unitPrice: Number(l.unitPrice || 0),
      vatRate: Number(l.vatRate || 0),
      sourceType: "credit",
      sourceId: invoice.id,
    }));
  if (!creditLines.length) { const e = new Error("Geen factuurlijnen om te crediteren"); e.status = 400; throw e; }

  const issued = issueNumber(store, { tenant, docType: "credit_note" });
  const number = issued.number;
  const { lines, subtotal, vatAmount, total } = computeLines(creditLines, invoice.vatRegime && invoice.vatRegime !== "binnen");
  const now = new Date().toISOString();
  const credit = store.insert("invoices", {
    id: `cn_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    tenantId: tenant.id,
    companyId: issued.companyId || invoice.companyId || null,
    number,
    docType: "credit_note",
    creditOf: invoice.id,
    creditOfNumber: invoice.number,
    customerId: invoice.customerId || null,
    customerName: invoice.customerName || "",
    customerAddress: invoice.customerAddress || "",
    customerVatNumber: invoice.customerVatNumber || "",
    status: "open",
    invoiceDate: now.slice(0, 10),
    dueDate: now.slice(0, 10),
    lines, subtotal, vatAmount, total,
    vatRegime: invoice.vatRegime || "binnen",
    vatNote: invoice.vatNote || "",
    structuredComm: structuredCommunication(number),
    notes: `Creditnota bij factuur ${invoice.number}` + (opts.reason ? ` · ${opts.reason}` : ""),
    reason: opts.reason || "",
    paidAt: null, sentAt: null,
    createdBy: user.email, createdAt: now, updatedAt: now,
  });
  // Origineel markeren: volledige credit → "gecrediteerd" en gelinkt.
  const fullCredit = !idx;
  store.update("invoices", invoice.id, {
    ...(fullCredit ? { status: "gecrediteerd", creditNoteId: credit.id } : {}),
    creditNotes: [...(invoice.creditNotes || []), credit.id],
    updatedAt: now,
  });
  store.audit({ actor: user.email, tenantId: tenant.id, action: "credit_note_created", area: "facturen", detail: `${number} bij ${invoice.number} · €${total.toFixed(2)}` });
  emitDomainEvent(store, { tenantId: tenant.id, eventType: "invoice.credited", aggregateType: "invoice", aggregateId: invoice.id, actor: user.email, data: { creditNoteId: credit.id, full: fullCredit } });
  return credit;
}

// Bouwt de factuur-payload voor één werkbon: geklokte/factureerbare uren × tarief
// (of een vast bedrag). Gooit 422 met een bruikbare reden als er niets te
// factureren valt. (Materiaal/onkosten worden in een volgende fase toegevoegd.)
function workorderInvoicePayload(store, tenant, workorder, extraLines = []) {
  const defaultRate = Number(tenant.defaultHourlyRate || (tenant.billingOps && tenant.billingOps.defaultHourlyRate) || 0);
  const title = workorder.title || `Werkbon ${workorder.number || workorder.id}`;
  const label = `${workorder.number ? workorder.number + " · " : ""}${title}`;
  const lines = [];
  const fixed = workorder.billableAmount ?? workorder.fixedPrice;
  if (fixed != null && Number(fixed) > 0) {
    lines.push({ description: label, qty: 1, unitPrice: round2(Number(fixed)), vatRate: 21 });
  } else {
    const hours = Number(workorder.billableHours ?? workorder.clockedHours ?? workorder.hours ?? 0);
    const rate = Number(workorder.hourlyRate || defaultRate || 0);
    if (hours > 0 && rate > 0) lines.push({ description: `${label} · uren`, qty: hours, unitPrice: rate, vatRate: 21 });
  }
  // Materiaal/extra lijnen die op de werkbon zelf zijn geregistreerd (het
  // natuurlijke punt: verbruikt materiaal hoort bij de job) + eventuele ad-hoc
  // lijnen uit het request · stromen als aparte factuurregels mee naast de uren.
  const materials = Array.isArray(workorder.materials) ? workorder.materials : [];
  for (const extra of [...materials, ...(Array.isArray(extraLines) ? extraLines : [])]) {
    const qty = Number(extra.qty ?? 1), unitPrice = Number(extra.unitPrice ?? 0);
    if (qty > 0 && unitPrice > 0 && String(extra.description || "").trim()) {
      lines.push({ description: String(extra.description).trim(), qty, unitPrice, vatRate: 21 });
    }
  }
  // Goedgekeurde onkosten gekoppeld aan deze werkbon rekenen mee door aan de
  // klant (tenzij expliciet billable:false of al gefactureerd). De endpoint
  // markeert ze via expenseIds als gefactureerd zodra de factuur bestaat.
  const expenseIds = [];
  const linkedExpenses = (typeof store.list === "function" ? store.list("expenses", tenant.id) : [])
    .filter(e => e.workorderId === workorder.id
      && ["approved", "goedgekeurd"].includes(e.status)
      && !e.invoiceId
      && e.billable !== false
      && Number(e.amount) > 0);
  for (const e of linkedExpenses) {
    lines.push({ description: `Onkost · ${e.description || e.category || "diversen"}`, qty: 1, unitPrice: round2(Number(e.amount)), vatRate: 21 });
    expenseIds.push(e.id);
  }
  if (!lines.length) {
    const reason = (workorder.billableHours ?? workorder.clockedHours ?? workorder.hours)
      ? "er is geen uurtarief (op de werkbon of als standaardtarief)"
      : "er zijn geen factureerbare uren of vast bedrag";
    const e = new Error(`Werkbon "${title}" kan niet gefactureerd worden: ${reason}.`);
    e.status = 422; throw e;
  }
  return {
    customerId: workorder.customerId || null,
    customerName: workorder.clientName || workorder.customerName || "",
    customerAddress: workorder.customerAddress || "",
    customerVatNumber: workorder.customerVatNumber || "",
    vatRegime: workorder.vatRegime || "binnen",
    notes: `Op basis van werkbon ${workorder.number || workorder.id}`,
    workorderId: workorder.id,
    // Bronlijn-traceerbaarheid (E08): alle werkbonlijnen dragen de werkbon-bron.
    lines: lines.map(l => ({ ...l, sourceType: "workorder", sourceId: workorder.id })),
    expenseIds,   // door de endpoint te markeren als gefactureerd
  };
}

module.exports = { createCustomerInvoice, createCreditNote, workorderInvoicePayload, computeLines, REGIME_NOTES };
