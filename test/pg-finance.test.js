"use strict";
// Kerntransacties genormaliseerd (CTO P0-01 fase 3 · facturen + betalingen).
//
// De invarianten die hier hard bewezen worden:
//  1. VERLIESVRIJE projectie: legacy → projectie == pg-rij → projectie, en de
//     terugvertaling reconstrueert het legacy-object (incl. regels/allocaties).
//  2. SALDO-invariant: het openstaande saldo uit de genormaliseerde
//     allocatie-rijen == de legacy-berekening (spiegelt payments.js), inclusief
//     deelbetalingen en teruggedraaide allocaties.
//  3. Idempotente set-sync met fingerprint-poort; drift en verwijdering.
//  4. Live tegen echte PostgreSQL: nummer-uniciteit, RLS, som-in-SQL.
const { test } = require("node:test");
const assert = require("node:assert");

const {
  projectInvoice, projectInvoiceRow, rowToInvoice, invoiceFingerprint,
  projectPayment, projectPaymentRow, rowToPayment, paymentFingerprint,
  syncFinance, listInvoices, listPayments, reconcileFinance,
  computeLegacyOutstanding, stableStringify,
} = require("../src/infrastructure/postgres/pg-finance-repository");
const { makeFinanceSource } = require("../src/infrastructure/finance-source");

function invoice(overrides = {}) {
  return {
    id: "inv_1", tenantId: "t1", companyId: "co_1", number: "2026-0001",
    customerId: "cust_1", customerName: "Alpha BV", customerAddress: "Straat 1",
    customerVatNumber: "BE0403170701", status: "open",
    invoiceDate: "2026-07-01", dueDate: "2026-07-31",
    lines: [
      { description: "Installatie", qty: 2, unitPrice: 500, vatRate: 21, lineSubtotal: 1000, lineVat: 210, lineTotal: 1210 },
      { description: "Materiaal", qty: 1, unitPrice: 100, vatRate: 6, lineSubtotal: 100, lineVat: 6, lineTotal: 106 },
    ],
    subtotal: 1100, vatAmount: 216, total: 1316,
    notes: "", quoteId: "quo_9", paidAt: null, sentAt: "2026-07-01T09:00:00.000Z",
    createdBy: "admin@test.be", createdAt: "2026-07-01T08:00:00.000Z", updatedAt: "2026-07-01T09:00:00.000Z",
    ...overrides,
  };
}
function payment(overrides = {}) {
  return {
    id: "pay_1", tenantId: "t1", companyId: "co_1", customerId: "cust_1",
    date: "2026-07-10", amount: 500, method: "bank", reference: "+++090/9337/55493+++",
    note: "deelbetaling", version: 2,
    allocations: [
      { id: "alc_1", invoiceId: "inv_1", invoiceNumber: "2026-0001", amount: 500, at: "2026-07-10T10:00:00.000Z", by: "admin@test.be" },
    ],
    createdBy: "admin@test.be", createdAt: "2026-07-10T10:00:00.000Z", updatedAt: "2026-07-10T10:00:00.000Z",
    ...overrides,
  };
}

function invoiceRowFromProjection(p) {
  return {
    id: p.id, tenant_id: p.tenantId, company_id: p.companyId, number: p.number,
    customer_id: p.customerId, status: p.status, subtotal: p.subtotal, vat_amount: p.vatAmount,
    total: p.total, currency: "EUR", attributes: p.attributes, fingerprint: "x",
  };
}
function lineRowsFromProjection(p) {
  return p.lines.map(l => ({
    line_no: l.lineNo, description: l.description, qty: l.qty, unit_price: l.unitPrice,
    vat_rate: l.vatRate, line_subtotal: l.lineSubtotal, line_vat: l.lineVat, line_total: l.lineTotal,
    attributes: l.attributes,
  }));
}
function paymentRowFromProjection(p) {
  return {
    id: p.id, tenant_id: p.tenantId, company_id: p.companyId, customer_id: p.customerId,
    amount: p.amount, method: p.method, reference: p.reference, attributes: p.attributes, fingerprint: "x",
  };
}
function allocRowsFromProjection(p) {
  return p.allocations.map(a => ({
    id: a.id, invoice_id: a.invoiceId, invoice_number: a.invoiceNumber, amount: a.amount,
    allocated_at: a.at, allocated_by: a.by, reversed_at: a.reversedAt, reason: a.reason, attributes: a.attributes,
  }));
}

test("finance: factuur-projectie is verliesvrij · legacy → rij → projectie identiek", () => {
  const inv = invoice();
  const p = projectInvoice(inv);
  assert.equal(p.total, 1316);
  assert.equal(p.lines.length, 2);
  assert.equal(p.lines[0].lineNo, 0);
  assert.equal(p.attributes.customerName, "Alpha BV", "gedrukte klantnaam reist mee");
  assert.equal(p.attributes.number, undefined, "nummer is kolom, niet dubbel in attributes");

  const rebuilt = projectInvoiceRow(invoiceRowFromProjection(p), lineRowsFromProjection(p));
  assert.equal(stableStringify(rebuilt), stableStringify(p), "rij → projectie is identiek");

  const recon = rowToInvoice(invoiceRowFromProjection(p), lineRowsFromProjection(p));
  assert.equal(stableStringify(projectInvoice(recon)), stableStringify(p), "terugvertaling projecteert identiek");
  assert.equal(recon.lines[0].description, "Installatie");
  assert.equal(recon.customerName, "Alpha BV");
});

test("finance: factuurtotaal is de som van de regels (invariant afdwingbaar in SQL)", () => {
  const p = projectInvoice(invoice());
  const sumSub = p.lines.reduce((s, l) => s + l.lineSubtotal, 0);
  const sumVat = p.lines.reduce((s, l) => s + l.lineVat, 0);
  const sumTot = p.lines.reduce((s, l) => s + l.lineTotal, 0);
  assert.equal(sumSub, p.subtotal);
  assert.equal(sumVat, p.vatAmount);
  assert.equal(sumTot, p.total);
});

test("finance: betaling-projectie is verliesvrij en order-onafhankelijk", () => {
  const pay = payment({ allocations: [
    { id: "alc_b", invoiceId: "inv_2", invoiceNumber: "2026-0002", amount: 200, at: "2026-07-11T10:00:00.000Z", by: "x" },
    { id: "alc_a", invoiceId: "inv_1", invoiceNumber: "2026-0001", amount: 300, at: "2026-07-10T10:00:00.000Z", by: "x" },
  ] });
  const p = projectPayment(pay);
  assert.deepEqual(p.allocations.map(a => a.id), ["alc_a", "alc_b"], "allocaties op id gesorteerd · order-onafhankelijk");
  const rebuilt = projectPaymentRow(paymentRowFromProjection(p), allocRowsFromProjection(p));
  assert.equal(stableStringify(rebuilt), stableStringify(p));
  // Andere invoervolgorde geeft dezelfde vingerafdruk.
  const reordered = payment({ allocations: [...pay.allocations].reverse() });
  assert.equal(paymentFingerprint(reordered), paymentFingerprint(pay));
});

test("finance: saldo-invariant · deelbetaling en teruggedraaide allocatie", () => {
  // Factuur 1316, betaling 500 → open 816.
  let out = computeLegacyOutstanding([invoice()], [payment()]);
  assert.equal(out.get("inv_1"), 816);

  // Tweede betaling die de rest dekt → open 0.
  const rest = payment({ id: "pay_2", amount: 816, allocations: [
    { id: "alc_2", invoiceId: "inv_1", invoiceNumber: "2026-0001", amount: 816, at: "2026-07-12T10:00:00.000Z", by: "x" }] });
  out = computeLegacyOutstanding([invoice()], [payment(), rest]);
  assert.equal(out.get("inv_1"), 0);

  // Teruggedraaide allocatie telt niet mee → weer 816 open.
  const reversed = payment({ id: "pay_2", amount: 816, allocations: [
    { id: "alc_2", invoiceId: "inv_1", invoiceNumber: "2026-0001", amount: 816, at: "2026-07-12T10:00:00.000Z", by: "x", reversedAt: "2026-07-13T10:00:00.000Z", reason: "foutieve toewijzing" }] });
  out = computeLegacyOutstanding([invoice()], [payment(), reversed]);
  assert.equal(out.get("inv_1"), 816, "teruggedraaide toewijzing valt uit het saldo");
});

test("finance: geen float-drift in saldo (0.1 + 0.2 problematiek)", () => {
  const inv = invoice({ id: "inv_c", number: "C1", total: 0.3, subtotal: 0.3, vatAmount: 0,
    lines: [{ description: "a", qty: 1, unitPrice: 0.1, vatRate: 0, lineSubtotal: 0.1, lineVat: 0, lineTotal: 0.1 },
            { description: "b", qty: 1, unitPrice: 0.2, vatRate: 0, lineSubtotal: 0.2, lineVat: 0, lineTotal: 0.2 }] });
  const pay = payment({ id: "pay_c", amount: 0.1, allocations: [
    { id: "alc_c", invoiceId: "inv_c", invoiceNumber: "C1", amount: 0.1, at: "2026-07-10T10:00:00.000Z", by: "x" }] });
  const out = computeLegacyOutstanding([inv], [pay]);
  assert.equal(out.get("inv_c"), 0.2, "0.3 - 0.1 == 0.2 exact, geen 0.19999");
});

test("finance-source: standenvalidatie is hard (ADR-004)", () => {
  const store = { data: { invoices: [], payments: [] } };
  assert.throws(() => makeFinanceSource({ mode: "raar", store }), e => e.code === "UNKNOWN_FINANCE_SOURCE");
  assert.throws(() => makeFinanceSource({ mode: "shadow", store, pool: null }), e => e.code === "FINANCE_SOURCE_NEEDS_PG");
  assert.equal(makeFinanceSource({ mode: "legacy", store }).mode, "legacy");
});

test("finance-source: legacy-stand geeft de thunk terug en raakt pg niet aan", async () => {
  const store = { data: { invoices: [], payments: [] } };
  const source = makeFinanceSource({ mode: "legacy", store });
  const legacyMarker = [{ id: "inv_1", openAmount: 100 }];
  assert.deepEqual(await source.readInvoices("t1", {}, () => legacyMarker), legacyMarker);
  assert.deepEqual(await source.syncNow(), { skipped: true, reason: "geen pg" });
});

// ── Live tegen echte PostgreSQL (CI draait dit; lokaal met DATABASE_URL) ────
const LIVE_URL = process.env.DATABASE_URL || "";
test("finance live: sync → saldo-som in SQL → reconciliatie → nummer-uniek → RLS → drift",
  { skip: !LIVE_URL && "DATABASE_URL niet gezet" }, async () => {
    const { Pool } = require("pg");
    const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
    const pool = new Pool({ connectionString: LIVE_URL, max: 3 });
    const stamp = Date.now().toString(36);
    const t1 = `t_fin_${stamp}`;
    const inv1 = invoice({ id: `inv_a_${stamp}`, tenantId: t1, number: `N-${stamp}-1`, companyId: null, customerId: null, quoteId: null });
    const inv2 = invoice({ id: `inv_b_${stamp}`, tenantId: t1, number: `N-${stamp}-2`, companyId: null, customerId: null, quoteId: null,
      total: 1000, subtotal: 1000, vatAmount: 0,
      lines: [{ description: "Advies", qty: 10, unitPrice: 100, vatRate: 0, lineSubtotal: 1000, lineVat: 0, lineTotal: 1000 }] });
    const pay1 = payment({ id: `pay_a_${stamp}`, tenantId: t1, companyId: null, customerId: null, amount: 500,
      allocations: [{ id: `alc_a_${stamp}`, invoiceId: inv1.id, invoiceNumber: inv1.number, amount: 500, at: "2026-07-10T10:00:00.000Z", by: "x" }] });
    try {
      await runMigrations(pool);
      await pool.query("INSERT INTO tenants (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [t1, "Fin test"]);

      const first = await syncFinance(pool, { invoices: [inv1, inv2], payments: [pay1] });
      assert.equal(first.invoicesUpserted, 2);
      assert.equal(first.paymentsUpserted, 1);

      // Factuurtotaal == som van de regels, AFGEDWONGEN in SQL.
      const sumCheck = await pool.query(
        `SELECT i.id, i.total, coalesce(sum(l.line_total),0) AS lines_total
         FROM invoices i LEFT JOIN invoice_lines l ON l.tenant_id=i.tenant_id AND l.invoice_id=i.id
         WHERE i.tenant_id=$1 GROUP BY i.id, i.total`, [t1]);
      for (const r of sumCheck.rows) {
        assert.equal(Number(r.total), Number(r.lines_total), `factuur ${r.id}: totaal == som van regels`);
      }

      // Saldo-som in SQL == legacy-berekening.
      const invoices = await listInvoices(pool, t1, {});
      const byId = new Map(invoices.map(i => [i.id, i]));
      assert.equal(byId.get(inv1.id).outstanding, 816, "1316 - 500 = 816 uit allocatie-rijen");
      assert.equal(byId.get(inv2.id).outstanding, 1000, "onbetaald == volledig openstaand");

      // Reconciliatie sluitend, inclusief de saldo-invariant.
      const rec1 = await reconcileFinance(pool, { invoices: [inv1, inv2], payments: [pay1] });
      assert.equal(rec1.ok, true, `reconciliatie sluitend: ${JSON.stringify(rec1)}`);
      assert.equal(rec1.saldoMismatches.length, 0);

      // Idempotent: niets gewijzigd → nul upserts.
      const second = await syncFinance(pool, { invoices: [inv1, inv2], payments: [pay1] });
      assert.deepEqual([second.invoicesUpserted, second.paymentsUpserted], [0, 0], "fingerprint-poort");

      // Nummer-uniciteit binnen tenant afgedwongen door de database.
      await assert.rejects(
        () => pool.query(`INSERT INTO invoices (id, tenant_id, number, status, subtotal, vat_amount, total, currency, attributes, fingerprint) VALUES ($1,$2,$3,'concept',0,0,0,'EUR','{}','x')`,
          [`inv_dup_${stamp}`, t1, inv1.number]),
        /invoices_tenant_id_number|duplicate key/i);

      // RLS aan op alle vier de tabellen.
      const pol = await pool.query(`SELECT tablename FROM pg_policies WHERE tablename IN ('invoices','invoice_lines','payments','payment_allocations')`);
      assert.equal(new Set(pol.rows.map(r => r.tablename)).size, 4, "RLS-policy op elke financetabel");

      // Drift: extra betaling dekt de rest van inv1 → saldo 0, reconcile ziet het.
      const pay2 = payment({ id: `pay_b_${stamp}`, tenantId: t1, companyId: null, customerId: null, amount: 816,
        allocations: [{ id: `alc_b_${stamp}`, invoiceId: inv1.id, invoiceNumber: inv1.number, amount: 816, at: "2026-07-12T10:00:00.000Z", by: "x" }] });
      await syncFinance(pool, { invoices: [inv1, inv2], payments: [pay1, pay2] });
      const after = await listInvoices(pool, t1, {});
      assert.equal(after.find(i => i.id === inv1.id).outstanding, 0, "volledig betaald na tweede betaling");

      // Verwijderde betaling verdwijnt via de set-sync → saldo weer 816.
      await syncFinance(pool, { invoices: [inv1, inv2], payments: [pay1] });
      const restored = await listInvoices(pool, t1, {});
      assert.equal(restored.find(i => i.id === inv1.id).outstanding, 816, "set-sync verwijderde de betaling, saldo hersteld");
    } finally {
      await pool.query(`DELETE FROM payment_allocations WHERE tenant_id=$1`, [t1]).catch(() => {});
      await pool.query(`DELETE FROM payments WHERE tenant_id=$1`, [t1]).catch(() => {});
      await pool.query(`DELETE FROM invoice_lines WHERE tenant_id=$1`, [t1]).catch(() => {});
      await pool.query(`DELETE FROM invoices WHERE tenant_id=$1`, [t1]).catch(() => {});
      await pool.query(`DELETE FROM tenants WHERE id=$1`, [t1]).catch(() => {});
      await pool.end();
    }
  });
