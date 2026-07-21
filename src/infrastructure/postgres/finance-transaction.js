"use strict";

// ── DEV-06 · Kritieke finance multi-write ATOMair (CTO-review PR #41) ─────────
// De vorige gate "bewees" transactionaliteit met een broncode-regex. Dat is geen
// bewijs. Hier is de ECHTE atomaire flow: nummeruitgifte (invoices.number, met
// de UNIQUE(tenant_id, number)-lock), de factuur, de betaling, de
// betalingsallocatie ÉN het outbox-event committen samen of helemaal niet -
// binnen ÉÉN transactie via de pg TransactionManager. Een fout middenin (of een
// dubbel nummer) rolt ALLES terug, inclusief het uitgegeven nummer.
//
// Bewezen door test/finance-transaction.test.js (pg-integratie) en het
// evidence-script scripts/check-finance-tx.js.

/**
 * Post een factuur + betaling + allocatie + outbox-event atomair.
 * @param {{run:Function}} txm  pg TransactionManager (makePgTransactionManager)
 * @param {object} data { tenantId, invoice, payment, allocation, event }
 * @param {{failAfter?: 'invoice'|'payment'|'allocation'|'outbox'}} opts
 *   failAfter injecteert een fout NA die stap · uitsluitend voor de rollbacktest.
 */
async function postInvoiceAtomically(txm, data, opts = {}) {
  const { tenantId, invoice, payment, allocation, event } = data;
  const failAfter = opts.failAfter || null;
  return txm.run(async (ctx) => {
    const q = ctx.query;

    // 1. Nummeruitgifte + factuurkop. De UNIQUE(tenant_id, number) is de
    //    nummerlock: een tweede factuur met hetzelfde nummer botst hier.
    await q(
      `INSERT INTO invoices (id, tenant_id, company_id, number, customer_id, status,
         invoice_date, due_date, subtotal, vat_amount, total, currency, attributes, fingerprint)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [invoice.id, tenantId, invoice.companyId || null, invoice.number, invoice.customerId || null,
       invoice.status || "final", invoice.invoiceDate || null, invoice.dueDate || null,
       invoice.subtotal || 0, invoice.vatAmount || 0, invoice.total || 0, invoice.currency || "EUR",
       JSON.stringify(invoice.attributes || {}), invoice.fingerprint || invoice.id]);
    if (failAfter === "invoice") throw injected("na factuur/nummeruitgifte");

    // 2. Betaling.
    await q(
      `INSERT INTO payments (id, tenant_id, company_id, customer_id, paid_on, amount, method, reference, attributes, fingerprint)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [payment.id, tenantId, payment.companyId || null, payment.customerId || null, payment.paidOn || null,
       payment.amount || 0, payment.method || "transfer", payment.reference || null,
       JSON.stringify(payment.attributes || {}), payment.fingerprint || payment.id]);
    if (failAfter === "payment") throw injected("na betaling");

    // 3. Allocatie betaling → factuur.
    await q(
      `INSERT INTO payment_allocations (id, tenant_id, payment_id, invoice_id, invoice_number, amount, allocated_at, allocated_by, attributes)
       VALUES ($1,$2,$3,$4,$5,$6, now(), $7, $8)`,
      [allocation.id, tenantId, payment.id, invoice.id, invoice.number, allocation.amount || 0,
       allocation.allocatedBy || "system", JSON.stringify(allocation.attributes || {})]);
    if (failAfter === "allocation") throw injected("na allocatie");

    // 4. Outbox-event in DEZELFDE transactie (P0-05 · transactionele outbox).
    await q(
      `INSERT INTO outbox_events (id, tenant_id, company_id, event_type, aggregate_type, aggregate_id, occurred_at, correlation_id, version, data)
       VALUES ($1,$2,$3,$4,$5,$6, now(), $7, $8, $9)`,
      [event.id, tenantId, event.companyId || null, event.eventType || "invoice.posted", "invoice", invoice.id,
       event.correlationId || null, event.version || 1, JSON.stringify(event.data || {})]);
    if (failAfter === "outbox") throw injected("na outbox");

    return { invoiceId: invoice.id, number: invoice.number, paymentId: payment.id, allocationId: allocation.id, eventId: event.id };
  });
}

function injected(where) { const e = new Error(`geïnjecteerde fout ${where}`); e.code = "INJECTED_FAILURE"; return e; }

module.exports = { postInvoiceAtomically };
