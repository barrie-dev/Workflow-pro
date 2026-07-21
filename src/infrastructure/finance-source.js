"use strict";
/**
 * Finance-bronschakelaar (CTO P0-01 · zelfde strangler-route als CRM/identity).
 *
 * Drie standen via FINANCE_READ_SOURCE (legacy | shadow | pg). Net als bij
 * identity blijft SCHRIJVEN in elke stand bij de legacy-store (payments.js en
 * de factuurcreatie bezitten nummering, allocatie en de saldo-invarianten);
 * een spiegel-lus projecteert het volledige platform-snapshot idempotent naar
 * de genormaliseerde tabellen en vangt zo alle schrijfpaden in één choke-point.
 *
 * De leesroutes krijgen een legacy-THUNK mee: in legacy/shadow blijft dat
 * performance-getunede pad de autoriteit (de facturenlijst berekent h45-saldi
 * in één pas); alleen in pg-stand leest de route echt uit de tabellen, waar
 * het openstaande saldo een SOM over allocatie-rijen is. Een pg-leesfout in
 * pg-stand faalt eerlijk met 503 · rollback is een flag-flip.
 */

const {
  syncFinance, reconcileFinance, listInvoices, listPayments,
  projectInvoice, projectPayment, stableStringify,
} = require("./postgres/pg-finance-repository");
const crypto = require("crypto");

const MODES = ["legacy", "shadow", "pg"];

function clean(v) { return String(v == null ? "" : v).trim(); }
function money(v) { return Math.round(Number(v || 0) * 100) / 100; }

function makeFinanceSource({ mode = "legacy", store, pool = null, telemetry = null }) {
  const m = clean(mode) || "legacy";
  if (!MODES.includes(m)) {
    const e = new Error(`Onbekende FINANCE_READ_SOURCE '${m}' · kies legacy, shadow of pg`);
    e.status = 500; e.code = "UNKNOWN_FINANCE_SOURCE"; throw e;
  }
  if (m !== "legacy" && !pool) {
    const e = new Error(`FINANCE_READ_SOURCE=${m} vereist de PostgreSQL-adapter (STORAGE_ADAPTER=postgres)`);
    e.status = 500; e.code = "FINANCE_SOURCE_NEEDS_PG"; throw e;
  }

  const metric = (name, attrs) => { try { telemetry && telemetry.metric(name, 1, attrs); } catch (_) {} };
  const warn = (message, attrs) => { try { telemetry && telemetry.log({ level: "warn", message, attributes: attrs }); } catch (_) {} };

  const state = { mode: m, lastSyncAt: null, lastSyncResult: null, lastError: null,
    shadowChecks: 0, shadowMismatches: 0, lastSnapshotHash: null };
  // Serialiseer syncs via een keten: het leespad (read-your-writes) en de
  // interval-lus kunnen samenvallen, en twee tegelijk lopende set-syncs zouden
  // op de nummer-uniciteit botsen. Nooit twee tegelijk · net als de pg-flush.
  let chain = Promise.resolve();

  function snapshot() {
    return { invoices: store.data.invoices || [], payments: store.data.payments || [] };
  }
  function snapshotHash(snap) {
    return crypto.createHash("sha256")
      .update(stableStringify(snap.invoices.map(projectInvoice)))
      .update(stableStringify(snap.payments.map(projectPayment)))
      .digest("hex");
  }

  function syncNow({ force = false } = {}) {
    if (!pool) return Promise.resolve({ skipped: true, reason: "geen pg" });
    // De hash-check en de sync zitten SAMEN in de kritieke sectie: pas nadat de
    // vorige sync klaar is, lezen we het snapshot en beslissen we of er iets te
    // doen valt. Zo doet een reeks gelijktijdige aanroepen op ongewijzigde data
    // precies één sync, en botsen ze nooit.
    const run = chain.then(async () => {
      const snap = snapshot();
      const hash = snapshotHash(snap);
      if (!force && hash === state.lastSnapshotHash) return { skipped: true, reason: "ongewijzigd" };
      try {
        const result = await syncFinance(pool, snap);
        state.lastSnapshotHash = hash;
        state.lastSyncAt = new Date().toISOString();
        state.lastSyncResult = result;
        state.lastError = null;
        return result;
      } catch (err) {
        state.lastError = String(err && err.message || err).slice(0, 300);
        metric("finance.sync.error", { mode: m });
        warn("finance-sync faalde", { error: state.lastError });
        throw err;
      }
    });
    // De keten mag nooit "vergiftigd" raken door een afwijzing.
    chain = run.catch(() => {});
    return run;
  }

  async function reconcile() {
    if (!pool) return { ok: false, reason: "geen pg" };
    return reconcileFinance(pool, snapshot());
  }

  /** Enrichment identiek aan het legacy-leespad, maar gevoed uit pg-saldi. */
  function enrichFromPg(invoices) {
    const today = new Date().toISOString().slice(0, 10);
    return invoices.map(inv => {
      const paid = money(money(inv.total) - money(inv.outstanding));
      const base = { ...inv, paidAmount: paid, openAmount: money(inv.outstanding) };
      delete base.outstanding;
      if (inv.status === "open" && inv.dueDate && inv.dueDate < today) return { ...base, status: "overdue" };
      return base;
    });
  }

  /**
   * Facturenlijst met bronschakelaar. legacyThunk levert de bestaande
   * (performance-getunede) legacy-uitkomst; in pg-stand komt de lijst uit de
   * tabellen. In shadow vergelijkt een achtergrondlezing beide saldi.
   */
  async function readInvoices(tenantId, filters, legacyThunk) {
    if (m === "pg") {
      try {
        // Read-your-writes: schrijven gaat nog naar legacy (fase 1), dus eerst
        // de snapshot-gepoorte (goedkope) sync, dan lezen uit de tabellen.
        await syncNow();
        const rows = await listInvoices(pool, tenantId, filters || {});
        return enrichFromPg(rows);
      } catch (err) {
        const e = new Error("Financiële bron (PostgreSQL) is niet beschikbaar");
        e.status = 503; e.code = "FINANCE_SOURCE_UNAVAILABLE"; e.cause = err; throw e;
      }
    }
    const legacy = legacyThunk();
    if (m === "shadow" && pool) shadowCompareInvoices(tenantId, legacy);
    return legacy;
  }

  async function readPayments(tenantId, filters, legacyThunk) {
    if (m === "pg") {
      try {
        await syncNow();
        return await listPayments(pool, tenantId, filters || {});
      } catch (err) {
        const e = new Error("Financiële bron (PostgreSQL) is niet beschikbaar");
        e.status = 503; e.code = "FINANCE_SOURCE_UNAVAILABLE"; e.cause = err; throw e;
      }
    }
    return legacyThunk();
  }

  /** Achtergrondvergelijking van het openstaande saldo per factuur (shadow). */
  function shadowCompareInvoices(tenantId, legacyInvoices) {
    syncNow().catch(() => {}).then(() => listInvoices(pool, tenantId, {})).then(pgInvoices => {
      state.shadowChecks += 1;
      const pgOpen = new Map(pgInvoices.map(i => [i.id, money(i.outstanding)]));
      let mismatch = false;
      for (const inv of legacyInvoices) {
        const legacyOpen = money(inv.openAmount != null ? inv.openAmount : inv.total);
        if (pgOpen.has(inv.id) && pgOpen.get(inv.id) !== legacyOpen) { mismatch = true; break; }
      }
      if (mismatch) {
        state.shadowMismatches += 1;
        metric("finance.shadow.mismatch", { mode: m, kind: "invoice_saldo" });
        warn("finance-schaduwlezing wijkt af", { kind: "invoice_saldo" });
      }
    }).catch(err => {
      metric("finance.shadow.error", { mode: m });
      warn("finance-schaduwlezing faalde", { error: String(err && err.message || err).slice(0, 200) });
    });
  }

  function status() {
    return {
      mode: m, pgConnected: !!pool,
      lastSyncAt: state.lastSyncAt, lastSyncResult: state.lastSyncResult, lastError: state.lastError,
      shadowChecks: state.shadowChecks, shadowMismatches: state.shadowMismatches,
    };
  }

  return { mode: m, syncNow, reconcile, readInvoices, readPayments, status };
}

module.exports = { makeFinanceSource };
