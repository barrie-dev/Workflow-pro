"use strict";

// ── DEV-06 · pg-integratietest: finance multi-write is ATOMair ───────────────
// De CTO-review verwierp de vorige "bewijs" (broncode-regex). Dit is het echte
// bewijs: een ECHTE PostgreSQL, een multi-write flow (nummeruitgifte + factuur +
// betaling + allocatie + outbox) door de pg TransactionManager, en een fout
// MIDDENIN die aantoont dat ALLES samen rollbackt - inclusief het nummer.
//
// Slaat over zonder DATABASE_URL (lokale unit-run); in CI staat DATABASE_URL en
// draait dit dus ECHT (de "geen overgeslagen db-tests"-gate bewaakt dat).

const { test } = require("node:test");
const assert = require("node:assert");

const LIVE = process.env.DATABASE_URL || "";

if (!LIVE || !/^postgres/.test(LIVE)) {
  test("finance-transaction (pg-integratie): DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  const { Pool } = require("pg");
  const { makePgTransactionManager } = require("../src/infrastructure/postgres/pg-transaction-manager");
  const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
  const { postInvoiceAtomically } = require("../src/infrastructure/postgres/finance-transaction");

  const ssl = /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: LIVE, ssl });
  const txm = makePgTransactionManager(pool);
  const T = "t_fintx_test";

  async function cleanup() {
    await pool.query("DELETE FROM payment_allocations WHERE tenant_id=$1", [T]);
    await pool.query("DELETE FROM payments WHERE tenant_id=$1", [T]);
    await pool.query("DELETE FROM outbox_events WHERE tenant_id=$1", [T]);
    await pool.query("DELETE FROM invoices WHERE tenant_id=$1", [T]);
  }

  async function counts() {
    const one = async (sql) => (await pool.query(sql, [T])).rows[0].c;
    return {
      inv: await one("SELECT count(*)::int c FROM invoices WHERE tenant_id=$1"),
      pay: await one("SELECT count(*)::int c FROM payments WHERE tenant_id=$1"),
      alloc: await one("SELECT count(*)::int c FROM payment_allocations WHERE tenant_id=$1"),
      outbox: await one("SELECT count(*)::int c FROM outbox_events WHERE tenant_id=$1"),
    };
  }

  function flowData(n, suffix = "") {
    return {
      tenantId: T,
      invoice: { id: `inv-${n}${suffix}`, number: `F-2026-${n}`, total: 121, subtotal: 100, vatAmount: 21, customerId: "cust-1" },
      payment: { id: `pay-${n}${suffix}`, amount: 121, method: "transfer", customerId: "cust-1" },
      allocation: { id: `alloc-${n}${suffix}`, amount: 121 },
      event: { id: `evt-${n}${suffix}`, eventType: "invoice.posted", data: { number: `F-2026-${n}` } },
    };
  }

  test("setup: schema + testtenant", async () => {
    await runMigrations(pool);
    await pool.query("INSERT INTO tenants (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [T, "FinTx Test"]);
    await cleanup();
  });

  test("commit: factuur + betaling + allocatie + outbox staan er SAMEN", async () => {
    await cleanup();
    const res = await postInvoiceAtomically(txm, flowData("1"));
    assert.equal(res.number, "F-2026-1");
    assert.deepEqual(await counts(), { inv: 1, pay: 1, alloc: 1, outbox: 1 });
    // De allocatie verwijst echt naar de uitgegeven factuur + nummer.
    const a = await pool.query("SELECT invoice_id, invoice_number FROM payment_allocations WHERE tenant_id=$1", [T]);
    assert.equal(a.rows[0].invoice_id, "inv-1");
    assert.equal(a.rows[0].invoice_number, "F-2026-1");
  });

  test("rollback: fout NA de outbox rolt ALLES terug (state + nummer + outbox)", async () => {
    await cleanup();
    await assert.rejects(
      () => postInvoiceAtomically(txm, flowData("2"), { failAfter: "outbox" }),
      (e) => e.code === "INJECTED_FAILURE"
    );
    // Niets mag half blijven staan: geen factuur, geen nummer, geen outbox.
    assert.deepEqual(await counts(), { inv: 0, pay: 0, alloc: 0, outbox: 0 }, "gedeeltelijke commit = corruptie");
  });

  test("rollback: fout NA de factuur laat óók het uitgegeven nummer verdwijnen", async () => {
    await cleanup();
    await assert.rejects(
      () => postInvoiceAtomically(txm, flowData("3"), { failAfter: "invoice" }),
      (e) => e.code === "INJECTED_FAILURE"
    );
    const n = await pool.query("SELECT count(*)::int c FROM invoices WHERE tenant_id=$1 AND number=$2", [T, "F-2026-3"]);
    assert.equal(n.rows[0].c, 0, "het nummer F-2026-3 mag na rollback opnieuw uitgeefbaar zijn");
    assert.deepEqual(await counts(), { inv: 0, pay: 0, alloc: 0, outbox: 0 });
  });

  test("nummerlock: dubbel nummer in een tweede flow botst en rolt die flow volledig terug", async () => {
    await cleanup();
    await postInvoiceAtomically(txm, flowData("4"));                 // geeft F-2026-4 uit
    const dup = flowData("4", "-b"); dup.invoice.number = "F-2026-4"; // probeert hetzelfde nummer
    await assert.rejects(() => postInvoiceAtomically(txm, dup));      // UNIQUE(tenant_id, number) botst
    // Enkel de eerste, geldige flow overleeft; de tweede liet niets achter.
    assert.deepEqual(await counts(), { inv: 1, pay: 1, alloc: 1, outbox: 1 });
    await cleanup();
    await pool.end();
  });
}
