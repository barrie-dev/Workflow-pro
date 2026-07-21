"use strict";
/**
 * Finance-repository op genormaliseerde PostgreSQL-tabellen (CTO P0-01,
 * handover 5.4 · derde en zwaarste domein na CRM en identity).
 *
 * Zelfde kernprincipe als identity: de pg-representatie is een VERLIESVRIJE
 * projectie van het legacy-object. Kernvelden en bedragen worden kolommen
 * (querybaar, som-baar), al het overige reist verbatim mee in 'attributes'.
 * projectInvoice(legacy) en projectInvoiceRow(rijen) leveren dezelfde
 * canonieke vorm, dus reconciliatie en shadow-vergelijking zijn exact.
 *
 * Wat finance zwaarder maakt dan identity:
 *  - factuurREGELS en betalingsTOEWIJZINGEN zijn eigen rijen (geen document),
 *    zodat het factuurtotaal en het openstaande saldo SOMMEN over echte rijen
 *    zijn · een rekenfout in de applicatie valt dan op als database-afwijking;
 *  - legacyregels hebben geen eigen id · hun VOLGORDE (line_no) is hun
 *    identiteit, en de synthetische sleutel is deterministisch zodat de sync
 *    idempotent blijft;
 *  - bedragen worden op beide kanten naar 2 decimalen genormaliseerd, zodat
 *    float-ruis (0.1+0.2) nooit een valse afwijking geeft.
 *
 * Money-conventie: euro's als numeric(14,2), consistent met 002. Datums en
 * currency krijgen eigen kolommen PUUR voor query/index · ze worden nooit
 * teruggelezen (attributes is hun bron van waarheid), zodat de round-trip
 * verliesvrij blijft ongeacht het oorspronkelijke datumformaat.
 */

const crypto = require("crypto");

function clean(v) { return String(v == null ? "" : v).trim(); }
function money(v) { return Math.round(Number(v || 0) * 100) / 100; }
function qty(v) { return Math.round(Number(v || 0) * 1000) / 1000; }

/** Stabiele serialisatie: objectsleutels gesorteerd, undefined → null. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .filter(k => value[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}
function hashOf(projection) {
  return crypto.createHash("sha256").update(stableStringify(projection)).digest("hex");
}

/** Datum → YYYY-MM-DD voor de query-kolom (nooit teruggelezen). */
function dateOnly(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// ── Facturen ────────────────────────────────────────────────────────────────
const INVOICE_CORE = ["id", "tenantId", "companyId", "number", "customerId", "status",
  "subtotal", "vatAmount", "total"];
const LINE_CORE = ["description", "qty", "unitPrice", "vatRate", "lineSubtotal", "lineVat", "lineTotal"];

/** Eén factuurregel → canonieke vorm (bedragen genormaliseerd, rest verbatim). */
function projectLine(line, index) {
  const attributes = {};
  for (const [k, v] of Object.entries(line || {})) {
    if (LINE_CORE.includes(k)) continue;
    attributes[k] = v === undefined ? null : v;
  }
  return {
    lineNo: index,
    description: line && line.description != null ? String(line.description) : null,
    qty: qty(line && line.qty),
    unitPrice: money(line && line.unitPrice),
    vatRate: money(line && line.vatRate),
    lineSubtotal: money(line && line.lineSubtotal),
    lineVat: money(line && line.lineVat),
    lineTotal: money(line && line.lineTotal),
    attributes,
  };
}

/** Legacy-factuur → canonieke projectie. */
function projectInvoice(invoice) {
  const attributes = {};
  for (const [k, v] of Object.entries(invoice || {})) {
    if (INVOICE_CORE.includes(k) || k === "lines") continue;
    attributes[k] = v === undefined ? null : v;
  }
  return {
    id: clean(invoice.id),
    tenantId: clean(invoice.tenantId) || null,
    companyId: clean(invoice.companyId) || null,
    number: invoice.number != null && clean(invoice.number) ? clean(invoice.number) : null,
    customerId: clean(invoice.customerId) || null,
    status: clean(invoice.status) || "concept",
    subtotal: money(invoice.subtotal),
    vatAmount: money(invoice.vatAmount),
    total: money(invoice.total),
    lines: (Array.isArray(invoice.lines) ? invoice.lines : []).map(projectLine),
    attributes,
  };
}

/** pg-rijen → dezelfde canonieke projectie. */
function projectInvoiceRow(row, lineRows = []) {
  return {
    id: row.id,
    tenantId: row.tenant_id || null,
    companyId: row.company_id || null,
    number: row.number || null,
    customerId: row.customer_id || null,
    status: row.status,
    subtotal: money(row.subtotal),
    vatAmount: money(row.vat_amount),
    total: money(row.total),
    lines: lineRows
      .slice()
      .sort((a, b) => a.line_no - b.line_no)
      .map(l => ({
        lineNo: l.line_no,
        description: l.description != null ? String(l.description) : null,
        qty: qty(l.qty), unitPrice: money(l.unit_price), vatRate: money(l.vat_rate),
        lineSubtotal: money(l.line_subtotal), lineVat: money(l.line_vat), lineTotal: money(l.line_total),
        attributes: l.attributes || {},
      })),
    attributes: row.attributes || {},
  };
}
function invoiceFingerprint(invoice) { return hashOf(projectInvoice(invoice)); }

/** Projectie → legacy-vormig factuurobject (verliesvrije terugvertaling). */
function rowToInvoice(row, lineRows = []) {
  const p = projectInvoiceRow(row, lineRows);
  const invoice = {
    ...p.attributes,
    id: p.id, tenantId: p.tenantId, companyId: p.companyId, number: p.number,
    customerId: p.customerId, status: p.status,
    subtotal: p.subtotal, vatAmount: p.vatAmount, total: p.total,
    lines: p.lines.map(l => ({ ...l.attributes, description: l.description, qty: l.qty,
      unitPrice: l.unitPrice, vatRate: l.vatRate, lineSubtotal: l.lineSubtotal,
      lineVat: l.lineVat, lineTotal: l.lineTotal })),
  };
  return invoice;
}

// ── Betalingen ──────────────────────────────────────────────────────────────
const PAYMENT_CORE = ["id", "tenantId", "companyId", "customerId", "amount", "method", "reference"];
const ALLOC_CORE = ["id", "invoiceId", "invoiceNumber", "amount", "at", "by", "reversedAt", "reason"];

function projectAllocation(alloc) {
  const attributes = {};
  for (const [k, v] of Object.entries(alloc || {})) {
    if (ALLOC_CORE.includes(k)) continue;
    attributes[k] = v === undefined ? null : v;
  }
  return {
    id: clean(alloc.id) || null,
    invoiceId: clean(alloc.invoiceId) || null,
    invoiceNumber: alloc.invoiceNumber != null ? String(alloc.invoiceNumber) : null,
    amount: money(alloc.amount),
    at: alloc.at || null,
    by: alloc.by || null,
    reversedAt: alloc.reversedAt || null,
    reason: alloc.reason || null,
    attributes,
  };
}

// Toewijzingen dragen een eigen id; door de projectie ALTIJD op id te sorteren
// is de vorm order-onafhankelijk · legacy-volgorde en pg-volgorde vallen samen,
// dus geen synthetische volgordesleutel nodig en geen valse afwijkingen.
function byAllocId(a, b) { return String(a.id).localeCompare(String(b.id)); }

function projectPayment(payment) {
  const attributes = {};
  for (const [k, v] of Object.entries(payment || {})) {
    if (PAYMENT_CORE.includes(k) || k === "allocations") continue;
    attributes[k] = v === undefined ? null : v;
  }
  return {
    id: clean(payment.id),
    tenantId: clean(payment.tenantId) || null,
    companyId: clean(payment.companyId) || null,
    customerId: clean(payment.customerId) || null,
    amount: money(payment.amount),
    method: clean(payment.method) || null,
    reference: payment.reference != null ? String(payment.reference) : null,
    allocations: (Array.isArray(payment.allocations) ? payment.allocations : []).map(projectAllocation).sort(byAllocId),
    attributes,
  };
}

function projectPaymentRow(row, allocRows = []) {
  return {
    id: row.id,
    tenantId: row.tenant_id || null,
    companyId: row.company_id || null,
    customerId: row.customer_id || null,
    amount: money(row.amount),
    method: row.method || null,
    reference: row.reference != null ? String(row.reference) : null,
    allocations: allocRows
      .map(a => ({
        id: a.id, invoiceId: a.invoice_id, invoiceNumber: a.invoice_number != null ? String(a.invoice_number) : null,
        amount: money(a.amount),
        at: a.allocated_at ? new Date(a.allocated_at).toISOString() : null,
        by: a.allocated_by || null,
        reversedAt: a.reversed_at ? new Date(a.reversed_at).toISOString() : null,
        reason: a.reason || null,
        attributes: a.attributes || {},
      }))
      .sort(byAllocId),
    attributes: row.attributes || {},
  };
}
function paymentFingerprint(payment) { return hashOf(projectPayment(payment)); }

function rowToPayment(row, allocRows = []) {
  const p = projectPaymentRow(row, allocRows);
  return {
    ...p.attributes,
    id: p.id, tenantId: p.tenantId, companyId: p.companyId, customerId: p.customerId,
    amount: p.amount, method: p.method, reference: p.reference,
    allocations: p.allocations.map(a => ({ ...a.attributes, id: a.id, invoiceId: a.invoiceId,
      invoiceNumber: a.invoiceNumber, amount: a.amount, at: a.at, by: a.by,
      ...(a.reversedAt ? { reversedAt: a.reversedAt } : {}),
      ...(a.reason ? { reason: a.reason } : {}) })),
  };
}

const INVOICE_COLS = "id, tenant_id, company_id, number, customer_id, status, subtotal, vat_amount, total, currency, attributes, fingerprint";
const PAYMENT_COLS = "id, tenant_id, company_id, customer_id, amount, method, reference, attributes, fingerprint";

/**
 * Volledige platform-sync in één transactie: facturen (+ regels) en betalingen
 * (+ toewijzingen), dan set-sync-delete van wat uit de bron verdween. De
 * children worden per ouder volledig herschreven (delete + upsert) · dat mag
 * omdat de ouder de volledige waarheid draagt. Idempotent via de fingerprint.
 */
async function syncFinance(pool, { invoices = [], payments = [] }) {
  const client = await pool.connect();
  const result = { invoicesUpserted: 0, invoicesDeleted: 0, paymentsUpserted: 0, paymentsDeleted: 0 };
  try {
    await client.query("BEGIN");

    // Tenant-ANKER (FK-vereiste, geen autoriteit): finance mag niet afhangen
    // van de volgorde waarin andere domeinen migreren. Net als de CRM-mirror
    // plaatsen we een minimale tenantrij als die nog niet bestaat; de
    // identity-sync vult naam/attributen later gezaghebbend in.
    const tenantIds = new Set();
    for (const inv of invoices) if (inv && inv.tenantId) tenantIds.add(clean(inv.tenantId));
    for (const pay of payments) if (pay && pay.tenantId) tenantIds.add(clean(pay.tenantId));
    for (const tid of tenantIds) {
      if (!tid) continue;
      await client.query(
        `INSERT INTO tenants (id, name, fingerprint) VALUES ($1,$1,'anchor') ON CONFLICT (id) DO NOTHING`, [tid]);
    }

    // Set-sync VERWIJDERT EERST, dan pas upserten. Een factuurnummer is uniek
    // binnen de tenant; verwijderen we een oude factuur en voert een nieuwe
    // (ander id) hetzelfde nummer, dan zou insert-vóór-delete op die uniciteit
    // botsen. Verwijderen-eerst maakt de set-sync robuust voor elke overlap in
    // een unieke sleutel.
    const projectedInvoices = invoices.map(projectInvoice).filter(p => p.id && p.tenantId);
    const invoiceIds = projectedInvoices.map(p => p.id);
    const delInv = await client.query(
      invoiceIds.length ? `DELETE FROM invoices WHERE NOT (id = ANY($1::text[])) RETURNING id`
                        : `DELETE FROM invoices RETURNING id`,
      invoiceIds.length ? [invoiceIds] : []);
    result.invoicesDeleted = delInv.rows.length;

    for (const p of projectedInvoices) {
      const fp = hashOf(p);   // p is de projectie · fingerprint is haar hash
      const up = await client.query(
        `INSERT INTO invoices (${INVOICE_COLS})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           tenant_id=excluded.tenant_id, company_id=excluded.company_id, number=excluded.number,
           customer_id=excluded.customer_id, status=excluded.status, subtotal=excluded.subtotal,
           vat_amount=excluded.vat_amount, total=excluded.total, currency=excluded.currency,
           attributes=excluded.attributes, fingerprint=excluded.fingerprint, version=invoices.version+1
         WHERE invoices.fingerprint IS DISTINCT FROM excluded.fingerprint
         RETURNING id`,
        [p.id, p.tenantId, p.companyId, p.number, p.customerId, p.status,
          p.subtotal, p.vatAmount, p.total, clean(p.attributes.currency) || "EUR", p.attributes, fp]);
      // Regels alleen herschrijven als de kop wijzigde (fingerprint dekt de regels mee).
      if (up.rows.length) {
        result.invoicesUpserted += 1;
        await client.query(`DELETE FROM invoice_lines WHERE tenant_id=$1 AND invoice_id=$2`, [p.tenantId, p.id]);
        for (const line of p.lines) {
          await client.query(
            `INSERT INTO invoice_lines (id, tenant_id, invoice_id, line_no, description, qty, unit_price, vat_rate, line_subtotal, line_vat, line_total, attributes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [`${p.id}::L${line.lineNo}`, p.tenantId, p.id, line.lineNo, line.description,
              line.qty, line.unitPrice, line.vatRate, line.lineSubtotal, line.lineVat, line.lineTotal, line.attributes]);
        }
        // Datum-kolommen (query-only) bijwerken uit attributes.
        await client.query(
          `UPDATE invoices SET invoice_date=$2, due_date=$3 WHERE id=$1`,
          [p.id, dateOnly(p.attributes.invoiceDate), dateOnly(p.attributes.dueDate)]);
      }
    }

    // Betalingen: idem · verwijderen-eerst, dan upserten.
    const projectedPayments = payments.map(projectPayment).filter(p => p.id && p.tenantId);
    const paymentIds = projectedPayments.map(p => p.id);
    const delPay = await client.query(
      paymentIds.length ? `DELETE FROM payments WHERE NOT (id = ANY($1::text[])) RETURNING id`
                        : `DELETE FROM payments RETURNING id`,
      paymentIds.length ? [paymentIds] : []);
    result.paymentsDeleted = delPay.rows.length;

    for (const p of projectedPayments) {
      const fp = hashOf(p);
      const up = await client.query(
        `INSERT INTO payments (${PAYMENT_COLS})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           tenant_id=excluded.tenant_id, company_id=excluded.company_id, customer_id=excluded.customer_id,
           amount=excluded.amount, method=excluded.method, reference=excluded.reference,
           attributes=excluded.attributes, fingerprint=excluded.fingerprint, version=payments.version+1
         WHERE payments.fingerprint IS DISTINCT FROM excluded.fingerprint
         RETURNING id`,
        [p.id, p.tenantId, p.companyId, p.customerId, p.amount, p.method, p.reference, p.attributes, fp]);
      if (up.rows.length) {
        result.paymentsUpserted += 1;
        await client.query(`DELETE FROM payment_allocations WHERE tenant_id=$1 AND payment_id=$2`, [p.tenantId, p.id]);
        let seq = 0;
        for (const a of p.allocations) {
          // Ontbreekt een id (oude data), dan een deterministische synthetische
          // sleutel; de projectie sorteert toch op id, dus volgorde is geen ruis.
          const allocId = a.id || `${p.id}::A${seq}`;
          await client.query(
            `INSERT INTO payment_allocations (id, tenant_id, payment_id, invoice_id, invoice_number, amount, allocated_at, allocated_by, reversed_at, reason, attributes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [allocId, p.tenantId, p.id, a.invoiceId, a.invoiceNumber, a.amount,
              a.at, a.by, a.reversedAt, a.reason, a.attributes]);
          seq += 1;
        }
        await client.query(`UPDATE payments SET paid_on=$2 WHERE id=$1`, [p.id, dateOnly(p.attributes.date)]);
      }
    }

    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Regels bij een set facturen ophalen, gegroepeerd op invoice_id. */
async function linesByInvoice(client, tenantId, invoiceIds) {
  if (!invoiceIds.length) return new Map();
  const { rows } = await client.query(
    `SELECT * FROM invoice_lines WHERE tenant_id=$1 AND invoice_id = ANY($2::text[])`, [tenantId, invoiceIds]);
  const map = new Map();
  for (const r of rows) { if (!map.has(r.invoice_id)) map.set(r.invoice_id, []); map.get(r.invoice_id).push(r); }
  return map;
}

/**
 * Facturenlijst met het openstaande saldo als SOM over echte allocatie-rijen.
 * De tenantcontext (RLS) wordt binnen de transactie gezet · defense in depth.
 */
async function listInvoices(pool, tenantId, { customerId = null, status = null } = {}) {
  const t = clean(tenantId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [t]);
    const where = ["tenant_id = $1"];
    const params = [t];
    if (customerId) { params.push(customerId); where.push(`customer_id = $${params.length}`); }
    if (status) { params.push(status); where.push(`status = $${params.length}`); }
    const { rows } = await client.query(
      `SELECT ${INVOICE_COLS},
         total - coalesce((
           SELECT sum(amount) FROM payment_allocations pa
           WHERE pa.tenant_id = i.tenant_id AND pa.invoice_id = i.id AND pa.reversed_at IS NULL
         ), 0) AS outstanding
       FROM invoices i WHERE ${where.join(" AND ")} ORDER BY number NULLS LAST, id`, params);
    const lineMap = await linesByInvoice(client, t, rows.map(r => r.id));
    await client.query("COMMIT");
    return rows.map(r => ({
      ...rowToInvoice(r, lineMap.get(r.id) || []),
      outstanding: money(r.outstanding),
    }));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function findInvoiceById(pool, tenantId, id) {
  const rows = await listInvoices(pool, tenantId, {});
  return rows.find(r => r.id === clean(id)) || null;
}

/** Betalingenlijst met toewijzingen. */
async function listPayments(pool, tenantId, { customerId = null } = {}) {
  const t = clean(tenantId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [t]);
    const where = ["tenant_id = $1"];
    const params = [t];
    if (customerId) { params.push(customerId); where.push(`customer_id = $${params.length}`); }
    const { rows } = await client.query(
      `SELECT ${PAYMENT_COLS} FROM payments WHERE ${where.join(" AND ")} ORDER BY id`, params);
    const allocs = rows.length
      ? (await client.query(`SELECT * FROM payment_allocations WHERE tenant_id=$1 AND payment_id = ANY($2::text[])`,
          [t, rows.map(r => r.id)])).rows
      : [];
    await client.query("COMMIT");
    const byPayment = new Map();
    for (const a of allocs) { if (!byPayment.has(a.payment_id)) byPayment.set(a.payment_id, []); byPayment.get(a.payment_id).push(a); }
    return rows.map(r => rowToPayment(r, byPayment.get(r.id) || []));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reconciliatie: vergelijk het volledige legacy-snapshot met de tabellen op
 * canonieke projectie (facturen én betalingen), beide richtingen. Plus de
 * financiële INVARIANT: het openstaande saldo per factuur, berekend uit de
 * genormaliseerde allocatie-rijen, moet gelijk zijn aan de legacy-berekening.
 */
async function reconcileFinance(pool, { invoices = [], payments = [] }) {
  const invRows = (await pool.query(`SELECT ${INVOICE_COLS} FROM invoices`)).rows;
  const lineRows = (await pool.query(`SELECT * FROM invoice_lines`)).rows;
  const payRows = (await pool.query(`SELECT ${PAYMENT_COLS} FROM payments`)).rows;
  const allocRows = (await pool.query(`SELECT * FROM payment_allocations`)).rows;

  const linesBy = new Map();
  for (const l of lineRows) { if (!linesBy.has(l.invoice_id)) linesBy.set(l.invoice_id, []); linesBy.get(l.invoice_id).push(l); }
  const allocsBy = new Map();
  for (const a of allocRows) { if (!allocsBy.has(a.payment_id)) allocsBy.set(a.payment_id, []); allocsBy.get(a.payment_id).push(a); }

  const invById = new Map(invRows.map(r => [r.id, r]));
  const payById = new Map(payRows.map(r => [r.id, r]));

  const invoiceMismatches = [], invoiceMissing = [];
  const legacyInvoiceIds = new Set();
  for (const inv of invoices) {
    const id = clean(inv.id); legacyInvoiceIds.add(id);
    const row = invById.get(id);
    if (!row) { invoiceMissing.push(id); continue; }
    if (hashOf(projectInvoice(inv)) !== hashOf(projectInvoiceRow(row, linesBy.get(id) || []))) invoiceMismatches.push(id);
  }
  const invoiceExtra = invRows.map(r => r.id).filter(id => !legacyInvoiceIds.has(id));

  const paymentMismatches = [], paymentMissing = [];
  const legacyPaymentIds = new Set();
  for (const pay of payments) {
    const id = clean(pay.id); legacyPaymentIds.add(id);
    const row = payById.get(id);
    if (!row) { paymentMissing.push(id); continue; }
    if (paymentFingerprint(pay) !== hashOf(projectPaymentRow(row, allocsBy.get(id) || []))) paymentMismatches.push(id);
  }
  const paymentExtra = payRows.map(r => r.id).filter(id => !legacyPaymentIds.has(id));

  // Saldo-invariant: per factuur legacy-outstanding vs pg-outstanding (som van
  // actieve allocaties). Dit is de echte financiële poortwachter.
  const legacyOutstanding = computeLegacyOutstanding(invoices, payments);
  const saldoMismatches = [];
  for (const [invId, legacyOut] of legacyOutstanding) {
    const row = invById.get(invId);
    if (!row) continue;
    const pgAllocated = allocRows
      .filter(a => a.invoice_id === invId && !a.reversed_at)
      .reduce((s, a) => s + money(a.amount), 0);
    const pgOut = money(money(row.total) - pgAllocated);
    if (pgOut !== money(legacyOut)) saldoMismatches.push({ invoiceId: invId, legacy: money(legacyOut), pg: pgOut });
  }

  return {
    ok: invoiceMismatches.length === 0 && invoiceMissing.length === 0 && invoiceExtra.length === 0
      && paymentMismatches.length === 0 && paymentMissing.length === 0 && paymentExtra.length === 0
      && saldoMismatches.length === 0,
    invoices: { checked: invoices.length, mismatches: invoiceMismatches, missingInPg: invoiceMissing, extraInPg: invoiceExtra },
    payments: { checked: payments.length, mismatches: paymentMismatches, missingInPg: paymentMissing, extraInPg: paymentExtra },
    saldoMismatches,
  };
}

/** Openstaand saldo per factuur uit het legacy-snapshot (spiegelt payments.js). */
function computeLegacyOutstanding(invoices, payments) {
  const allocatedByInvoice = new Map();
  for (const pay of payments) {
    for (const a of (pay.allocations || [])) {
      if (a.reversedAt) continue;
      allocatedByInvoice.set(a.invoiceId, (allocatedByInvoice.get(a.invoiceId) || 0) + money(a.amount));
    }
  }
  const out = new Map();
  for (const inv of invoices) {
    out.set(clean(inv.id), money(money(inv.total) - (allocatedByInvoice.get(inv.id) || 0)));
  }
  return out;
}

module.exports = {
  projectInvoice, projectInvoiceRow, rowToInvoice, invoiceFingerprint,
  projectPayment, projectPaymentRow, rowToPayment, paymentFingerprint,
  syncFinance, listInvoices, findInvoiceById, listPayments, reconcileFinance,
  computeLegacyOutstanding, stableStringify,
};
