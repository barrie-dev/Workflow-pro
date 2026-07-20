"use strict";
/**
 * Betalingen + allocatie (h45 · sluitstuk van lead-to-cash).
 *
 * Een betaling is een eigen registratie (datum, bedrag, methode, referentie)
 * die aan één of meer facturen wordt TOEGEWEZEN. De factuurstatus volgt uit de
 * allocaties: pas als het openstaande saldo nul is, is de factuur betaald.
 * Daarmee vervangt dit het alles-of-niets "status: paid"-schakelen:
 *
 *  - deelbetalingen: een factuur kan door meerdere betalingen gedekt worden;
 *  - één betaling kan meerdere facturen dekken (bv. een verzamelbetaling);
 *  - een toewijzing wordt nooit verwijderd maar TERUGGEDRAAID met reden
 *    (compensatie, h41: rollback vereist historiek) · een factuur die daardoor
 *    weer open valt, gaat aantoonbaar terug naar "open";
 *  - overallocatie is onmogelijk: niet boven het betalingsbedrag en niet boven
 *    het openstaande saldo van de factuur.
 *
 * Bedragen zijn euro's in de store (consistent met de rest); alle rekenwerk
 * gebeurt intern in centen zodat 0.1+0.2-drift geen saldo's kan vervuilen.
 */

const COLLECTION = "payments";
const METHODS = ["bank", "cash", "card", "online", "other"];

const toCents = v => Math.round(Number(v || 0) * 100);
const toEuros = c => c / 100;

function fail(status, code, message, extra) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  if (extra) Object.assign(e, extra);
  throw e;
}

function activeAllocations(payment) {
  return (payment.allocations || []).filter(a => !a.reversedAt);
}
function allocatedCents(payment) {
  return activeAllocations(payment).reduce((s, a) => s + toCents(a.amount), 0);
}

/** Som van actieve toewijzingen aan een factuur, over ALLE betalingen heen. */
function invoiceAllocatedCents(store, tenantId, invoiceId) {
  return store.list(COLLECTION, tenantId)
    .reduce((s, p) => s + activeAllocations(p).filter(a => a.invoiceId === invoiceId).reduce((x, a) => x + toCents(a.amount), 0), 0);
}

function invoiceOutstandingCents(store, invoice) {
  return toCents(invoice.total) - invoiceAllocatedCents(store, invoice.tenantId, invoice.id);
}

/** Leesmodel per betaling: afgeleide bedragen en status, nooit opgeslagen. */
function decorate(store, payment) {
  const alloc = allocatedCents(payment);
  const total = toCents(payment.amount);
  return {
    ...payment,
    allocatedAmount: toEuros(alloc),
    unallocatedAmount: toEuros(total - alloc),
    status: alloc <= 0 ? "unallocated" : (alloc < total ? "partial" : "allocated"),
  };
}

function listPayments(store, tenantId, { customerId, invoiceId } = {}) {
  let rows = store.list(COLLECTION, tenantId);
  if (customerId) rows = rows.filter(p => p.customerId === customerId);
  if (invoiceId) rows = rows.filter(p => activeAllocations(p).some(a => a.invoiceId === invoiceId));
  return rows
    .map(p => decorate(store, p))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

function getPayment(store, tenantId, id) {
  const p = store.get(COLLECTION, id);
  if (!p || p.tenantId !== tenantId) fail(404, "NOT_FOUND", "Betaling niet gevonden");
  return p;
}

function registerPayment(store, tenant, user, payload) {
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) fail(400, "INVALID_AMOUNT", "Bedrag moet groter zijn dan nul");
  const method = String(payload.method || "bank").toLowerCase();
  if (!METHODS.includes(method)) fail(400, "INVALID_METHOD", `Methode moet één van ${METHODS.join(", ")} zijn`);
  const date = String(payload.date || new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, "INVALID_DATE", "Datum moet YYYY-MM-DD zijn");
  if (payload.customerId) {
    const cust = store.get("customers", String(payload.customerId));
    if (!cust || cust.tenantId !== tenant.id) fail(404, "CUSTOMER_NOT_FOUND", "Klant niet gevonden");
  }
  const payment = store.insert(COLLECTION, {
    id: `pay_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    tenantId: tenant.id,
    companyId: payload.companyId || null,
    customerId: payload.customerId || null,
    date,
    amount: toEuros(toCents(amount)),
    method,
    reference: String(payload.reference || "").trim(),
    note: String(payload.note || "").trim(),
    allocations: [],
    version: 1,
    createdBy: user.email,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  store.audit({ actor: user.email, tenantId: tenant.id, action: "payment_registered", area: "facturen", detail: `${payment.id} · €${payment.amount.toFixed(2)} · ${method}` });
  return decorate(store, payment);
}

/**
 * Wijs (een deel van) een betaling toe aan één of meer facturen.
 * Retourneert { payment, invoicesPaid } zodat de route events kan uitsturen.
 */
function allocatePayment(store, tenant, user, paymentId, allocations) {
  const payment = getPayment(store, tenant.id, paymentId);
  const items = Array.isArray(allocations) ? allocations : [];
  if (!items.length) fail(400, "ALLOCATIONS_REQUIRED", "Minimaal één toewijzing vereist");

  let remaining = toCents(payment.amount) - allocatedCents(payment);
  const invoicesPaid = [];
  const newAllocations = [];

  for (const item of items) {
    const invoice = store.get("invoices", String(item.invoiceId || ""));
    if (!invoice || invoice.tenantId !== tenant.id) fail(404, "INVOICE_NOT_FOUND", `Factuur '${item.invoiceId}' niet gevonden`);
    if (invoice.status === "gecrediteerd") fail(409, "INVOICE_CREDITED", `Factuur ${invoice.number} is volledig gecrediteerd`);
    const cents = toCents(item.amount);
    if (cents <= 0) fail(400, "INVALID_AMOUNT", "Toewijzingsbedrag moet groter zijn dan nul");
    // Dubbele factuur binnen één call: outstanding telt de eerdere regel mee.
    const pendingSame = newAllocations.filter(a => a.invoiceId === invoice.id).reduce((s, a) => s + toCents(a.amount), 0);
    const outstanding = invoiceOutstandingCents(store, invoice) - pendingSame;
    if (cents > outstanding) {
      fail(409, "OVER_ALLOCATION", `Toewijzing €${toEuros(cents).toFixed(2)} overschrijdt het openstaande saldo €${toEuros(outstanding).toFixed(2)} van factuur ${invoice.number}`,
        { invoiceId: invoice.id, outstanding: toEuros(outstanding) });
    }
    if (cents > remaining) {
      fail(409, "PAYMENT_EXHAUSTED", `Toewijzing €${toEuros(cents).toFixed(2)} overschrijdt het niet-toegewezen deel €${toEuros(remaining).toFixed(2)} van de betaling`,
        { unallocated: toEuros(remaining) });
    }
    remaining -= cents;
    newAllocations.push({
      id: `alc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amount: toEuros(cents),
      at: new Date().toISOString(),
      by: user.email,
    });
    if (outstanding - cents === 0) invoicesPaid.push(invoice);
  }

  const updated = store.update(COLLECTION, payment.id, {
    allocations: [...(payment.allocations || []), ...newAllocations],
    version: (payment.version || 1) + 1,
    updatedAt: new Date().toISOString(),
  });
  // Factuurstatus volgt de allocaties · volledig gedekt = betaald.
  for (const invoice of invoicesPaid) {
    store.update("invoices", invoice.id, { status: "paid", paidAt: new Date().toISOString(), paymentMethod: payment.method });
  }
  store.audit({ actor: user.email, tenantId: tenant.id, action: "payment_allocated", area: "facturen",
    detail: `${payment.id} → ${newAllocations.map(a => `${a.invoiceNumber} €${a.amount.toFixed(2)}`).join(", ")}` });
  return { payment: decorate(store, updated), allocations: newAllocations, invoicesPaid };
}

/**
 * Draai een toewijzing terug (compensatie, nooit verwijderen). Een factuur die
 * daardoor niet meer volledig gedekt is, valt terug naar "open".
 */
function reverseAllocation(store, tenant, user, paymentId, allocationId, reason) {
  if (!String(reason || "").trim()) fail(400, "REASON_REQUIRED", "Een reden is verplicht bij het terugdraaien");
  const payment = getPayment(store, tenant.id, paymentId);
  const allocation = (payment.allocations || []).find(a => a.id === allocationId);
  if (!allocation) fail(404, "ALLOCATION_NOT_FOUND", "Toewijzing niet gevonden");
  if (allocation.reversedAt) fail(409, "ALREADY_REVERSED", "Deze toewijzing is al teruggedraaid");

  allocation.reversedAt = new Date().toISOString();
  allocation.reversedBy = user.email;
  allocation.reason = String(reason).trim();
  const updated = store.update(COLLECTION, payment.id, {
    allocations: payment.allocations,
    version: (payment.version || 1) + 1,
    updatedAt: new Date().toISOString(),
  });

  let invoiceReopened = null;
  const invoice = store.get("invoices", allocation.invoiceId);
  if (invoice && invoice.tenantId === tenant.id && invoice.status === "paid" && invoiceOutstandingCents(store, invoice) > 0) {
    invoiceReopened = store.update("invoices", invoice.id, { status: "open", paidAt: null });
  }
  store.audit({ actor: user.email, tenantId: tenant.id, action: "payment_allocation_reversed", area: "facturen",
    detail: `${payment.id} · ${allocation.invoiceNumber} €${Number(allocation.amount).toFixed(2)} · ${allocation.reason}` });
  return { payment: decorate(store, updated), allocation, invoiceReopened };
}

/**
 * Voorstel-toewijzingen voor een betaling: eerst exacte match op de
 * gestructureerde mededeling, dan open facturen van de klant, oudste eerst,
 * tot het niet-toegewezen bedrag op is. Alleen een VOORSTEL · de gebruiker
 * bevestigt (spec h48-lijn: acties tonen een preview).
 */
function suggestAllocations(store, tenant, payment) {
  const p = getPayment(store, tenant.id, payment.id || payment);
  let remaining = toCents(p.amount) - allocatedCents(p);
  if (remaining <= 0) return [];
  const openInvoices = store.list("invoices", tenant.id)
    .filter(inv => inv.status !== "gecrediteerd" && invoiceOutstandingCents(store, inv) > 0)
    .filter(inv => !p.customerId || inv.customerId === p.customerId);

  const ref = String(p.reference || "").replace(/[^0-9]/g, "");
  const byRef = ref ? openInvoices.filter(inv => String(inv.structuredComm || "").replace(/[^0-9]/g, "") === ref) : [];
  const rest = openInvoices.filter(inv => !byRef.includes(inv))
    .sort((a, b) => String(a.invoiceDate || "").localeCompare(String(b.invoiceDate || "")));

  const suggestions = [];
  for (const inv of [...byRef, ...rest]) {
    if (remaining <= 0) break;
    const outstanding = invoiceOutstandingCents(store, inv);
    const amount = Math.min(outstanding, remaining);
    suggestions.push({
      invoiceId: inv.id, invoiceNumber: inv.number, invoiceDate: inv.invoiceDate,
      outstanding: toEuros(outstanding), amount: toEuros(amount),
      matchedBy: byRef.includes(inv) ? "structured_communication" : "oldest_open",
    });
    remaining -= amount;
  }
  return suggestions;
}

/** Leesmodel voor een factuur: gedekt / openstaand + de dekkende betalingen. */
function invoicePaymentState(store, tenantId, invoice) {
  const allocated = invoiceAllocatedCents(store, tenantId, invoice.id);
  return {
    paidAmount: toEuros(allocated),
    openAmount: toEuros(toCents(invoice.total) - allocated),
    payments: store.list(COLLECTION, tenantId)
      .flatMap(p => activeAllocations(p).filter(a => a.invoiceId === invoice.id)
        .map(a => ({ paymentId: p.id, date: p.date, method: p.method, amount: a.amount, allocationId: a.id }))),
  };
}

module.exports = {
  COLLECTION, METHODS,
  listPayments, getPayment, registerPayment, allocatePayment, reverseAllocation,
  suggestAllocations, invoicePaymentState, decorate,
};
