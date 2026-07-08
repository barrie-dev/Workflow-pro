"use strict";
/**
 * Klantfacturatie · één plek voor het opbouwen van een klantfactuur, zodat het
 * handmatige facturatiescherm, de offerte→factuur-conversie en de nieuwe
 * werkbon→factuur-knop exact dezelfde logica delen (nummering, btw-regime,
 * cent-afronding, gestructureerde mededeling).
 */

const { round2, structuredCommunication } = require("./be-locale");

// Btw-regimes met verlegging (0% btw) + de wettelijk verplichte vermelding.
const REGIME_NOTES = {
  intracom: "Btw verlegd · intracommunautaire handeling (art. 21 §2 / art. 39bis W.Btw).",
  medecontractant: "Btw verlegd · medecontractant (KB nr. 1, art. 20 W.Btw).",
};

function nextInvoiceNumber(store, tenantId) {
  const existing = store.list("invoices", tenantId);
  const year = new Date().getFullYear();
  const seq = existing.filter(i => String(i.number || "").startsWith(String(year))).length + 1;
  return `${year}-${String(seq).padStart(3, "0")}`;
}

// Normaliseer ruwe lijnen → factuurlijnen + totalen, rekening houdend met btw-regime.
function computeLines(rawLines, reverseCharge) {
  const lines = rawLines.map(l => {
    const qty = Number(l.qty || 1);
    const unitPrice = Number(l.unitPrice || 0);
    const vatRate = reverseCharge ? 0 : Number(l.vatRate ?? 21);
    const lineSubtotal = round2(qty * unitPrice);
    const lineVat = round2(lineSubtotal * vatRate / 100);
    return { description: l.description || "", qty, unitPrice, vatRate, lineSubtotal, lineVat, lineTotal: round2(lineSubtotal + lineVat) };
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
  const number = nextInvoiceNumber(store, tenant.id);
  const invoice = store.insert("invoices", {
    id: `inv_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    tenantId: tenant.id,
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
  return invoice;
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
    lines,
  };
}

module.exports = { createCustomerInvoice, workorderInvoicePayload, computeLines, nextInvoiceNumber, REGIME_NOTES };
