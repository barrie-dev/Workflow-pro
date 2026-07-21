#!/usr/bin/env node
"use strict";

// ── DEV-06 · Executing evidence-job: finance multi-write ATOMair ─────────────
// CTO-regel: bewijs = de OUTPUT van een draaiende job, niet een bestand dat er
// staat. Deze job draait ECHT tegen PostgreSQL: hij commit een volledige
// finance-flow (nummeruitgifte + factuur + betaling + allocatie + outbox), en
// laat daarna DRIE varianten middenin falen. Slaagt elke rollback (niets blijft
// half staan, het nummer komt vrij), dan - en alleen dan - schrijft hij
// docs/traceability/evidence/finance-tx.json, commit-gebonden aan HEAD.
//
// Zelf een harde gate: elke niet-atomaire uitkomst → exit 1 (CI faalt). Draait
// in de test-job (die een echte pg heeft). Zonder DATABASE_URL: exit 1 met
// uitleg (in CI staat de URL, dus dit kan niet stil overslaan).

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Pool } = require("pg");
const { makePgTransactionManager } = require("../src/infrastructure/postgres/pg-transaction-manager");
const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
const { postInvoiceAtomically } = require("../src/infrastructure/postgres/finance-transaction");
const { makeEvidence } = require("../src/modules/evidence");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "traceability", "evidence", "finance-tx.json");
const T = "t_fintx_evidence";

function commitSha() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); }
  catch (_) { return (process.env.GITHUB_SHA || "unknown").slice(0, 12); }
}

function flowData(n, suffix = "") {
  return {
    tenantId: T,
    invoice: { id: `inv-${n}${suffix}`, number: `F-EV-${n}`, total: 121, subtotal: 100, vatAmount: 21, customerId: "cust-ev" },
    payment: { id: `pay-${n}${suffix}`, amount: 121, method: "transfer", customerId: "cust-ev" },
    allocation: { id: `alloc-${n}${suffix}`, amount: 121 },
    event: { id: `evt-${n}${suffix}`, eventType: "invoice.posted", data: { number: `F-EV-${n}` } },
  };
}

async function main() {
  const LIVE = process.env.DATABASE_URL || "";
  if (!LIVE || !/^postgres/.test(LIVE)) {
    console.error("check-finance-tx: DATABASE_URL ontbreekt · dit bewijs vereist een echte PostgreSQL.");
    process.exit(1);
  }
  const ssl = /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: LIVE, ssl });
  const txm = makePgTransactionManager(pool);
  const failures = [];
  let committed = 0, rollbacks = 0;

  const q = (sql, params) => pool.query(sql, params);
  const clean = async () => {
    await q("DELETE FROM payment_allocations WHERE tenant_id=$1", [T]);
    await q("DELETE FROM payments WHERE tenant_id=$1", [T]);
    await q("DELETE FROM outbox_events WHERE tenant_id=$1", [T]);
    await q("DELETE FROM invoices WHERE tenant_id=$1", [T]);
  };
  const counts = async () => {
    const c = async (sql) => Number((await q(sql, [T])).rows[0].c);
    return {
      inv: await c("SELECT count(*)::int c FROM invoices WHERE tenant_id=$1"),
      pay: await c("SELECT count(*)::int c FROM payments WHERE tenant_id=$1"),
      alloc: await c("SELECT count(*)::int c FROM payment_allocations WHERE tenant_id=$1"),
      outbox: await c("SELECT count(*)::int c FROM outbox_events WHERE tenant_id=$1"),
    };
  };
  const expect = (label, actual, want) => {
    const ok = JSON.stringify(actual) === JSON.stringify(want);
    if (!ok) failures.push({ scenario: label, expected: want, actual });
    console.log(`  ${ok ? "✓" : "✗"} ${label} · ${JSON.stringify(actual)}`);
    return ok;
  };

  try {
    await runMigrations(pool);
    await pool.query("INSERT INTO tenants (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [T, "FinTx Evidence"]);
    await clean();

    // 1. Volledige commit: alle vier de writes samen aanwezig.
    await postInvoiceAtomically(txm, flowData("1"));
    if (expect("commit-samen", await counts(), { inv: 1, pay: 1, alloc: 1, outbox: 1 })) committed++;

    // 2. Fout NA outbox: alles terug.
    await clean();
    await postInvoiceAtomically(txm, flowData("2"), { failAfter: "outbox" }).then(
      () => failures.push({ scenario: "fail-na-outbox", reason: "flow slaagde onverwacht" }),
      () => {}
    );
    if (expect("rollback-na-outbox", await counts(), { inv: 0, pay: 0, alloc: 0, outbox: 0 })) rollbacks++;

    // 3. Fout NA factuur: het uitgegeven nummer verdwijnt óók.
    await clean();
    await postInvoiceAtomically(txm, flowData("3"), { failAfter: "invoice" }).then(
      () => failures.push({ scenario: "fail-na-factuur", reason: "flow slaagde onverwacht" }),
      () => {}
    );
    if (expect("rollback-na-factuur", await counts(), { inv: 0, pay: 0, alloc: 0, outbox: 0 })) rollbacks++;

    // 4. Nummerlock: dubbel nummer botst en rolt de tweede flow volledig terug.
    await clean();
    await postInvoiceAtomically(txm, flowData("4"));
    const dup = flowData("4", "-b"); dup.invoice.number = "F-EV-4";
    await postInvoiceAtomically(txm, dup).then(
      () => failures.push({ scenario: "dubbel-nummer", reason: "dubbel nummer werd toegelaten" }),
      () => {}
    );
    if (expect("nummerlock-rollback", await counts(), { inv: 1, pay: 1, alloc: 1, outbox: 1 })) rollbacks++;

    await clean();
  } catch (err) {
    failures.push({ scenario: "onverwachte-fout", reason: String(err && err.message || err) });
  } finally {
    await pool.end();
  }

  const status = failures.length === 0 ? "pass" : "fail";
  const evidence = makeEvidence({
    evidenceType: "finance-tx-rollback",
    status,
    commitSha: commitSha(),
    branch: process.env.GITHUB_REF_NAME || null,
    environment: "ci-postgres",
    executedBy: process.env.GITHUB_ACTIONS ? "ci" : "local",
    counts: { committed, rollbacks, scenarios: 4, mismatches: failures.length },
    failures,
    result: status === "pass"
      ? "finance multi-write commit-samen + 3 rollbackvarianten bewezen via pg TransactionManager"
      : "finance-atomiciteit NIET bewezen",
  });
  evidence.generatedAt = new Date().toISOString();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2) + "\n");
  console.log(`\nfinance-tx evidence → ${path.relative(ROOT, OUT)} · status=${status} · commit=${evidence.commitSha}`);
  if (status !== "pass") { console.error("::error::finance multi-write is NIET atomair"); process.exit(1); }
  console.log("Finance multi-write is atomair bewezen (commit-samen + rollback-samen).");
}

main().catch((e) => { console.error(e); process.exit(1); });
