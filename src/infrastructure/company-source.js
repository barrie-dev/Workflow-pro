"use strict";
/**
 * Company-bronschakelaar (CTO P0-01 fase 4 · zelfde strangler-route als
 * CRM/identity/finance).
 *
 * Drie standen via COMPANY_READ_SOURCE (legacy | shadow | pg). Schrijven blijft
 * in elke stand bij de legacy-store (companies.js bezit de default-logica en de
 * definitieve nummeruitgifte); een geserialiseerde spiegel-lus projecteert het
 * volledige snapshot (companies + number_sequences) idempotent naar pg.
 *
 * De geschakelde leesroute is de default-company-lookup; in pg-stand komt die
 * uit de tabel, met read-your-writes (sync vóór de lezing). Een pg-leesfout in
 * pg-stand faalt eerlijk met 503, geen stille terugval.
 */

const {
  syncCompanies, reconcileCompanies, findDefaultCompany,
  projectCompany, projectSequence, stableStringify,
} = require("./postgres/pg-company-repository");
const crypto = require("crypto");

const MODES = ["legacy", "shadow", "pg"];

function clean(v) { return String(v == null ? "" : v).trim(); }

function makeCompanySource({ mode = "legacy", store, pool = null, telemetry = null }) {
  const m = clean(mode) || "legacy";
  if (!MODES.includes(m)) {
    const e = new Error(`Onbekende COMPANY_READ_SOURCE '${m}' · kies legacy, shadow of pg`);
    e.status = 500; e.code = "UNKNOWN_COMPANY_SOURCE"; throw e;
  }
  if (m !== "legacy" && !pool) {
    const e = new Error(`COMPANY_READ_SOURCE=${m} vereist de PostgreSQL-adapter (STORAGE_ADAPTER=postgres)`);
    e.status = 500; e.code = "COMPANY_SOURCE_NEEDS_PG"; throw e;
  }

  const metric = (name, attrs) => { try { telemetry && telemetry.metric(name, 1, attrs); } catch (_) {} };
  const warn = (message, attrs) => { try { telemetry && telemetry.log({ level: "warn", message, attributes: attrs }); } catch (_) {} };

  const state = { mode: m, lastSyncAt: null, lastSyncResult: null, lastError: null,
    shadowChecks: 0, shadowMismatches: 0, lastSnapshotHash: null };
  let chain = Promise.resolve();

  function snapshot() {
    return { companies: store.data.companies || [], numberSequences: store.data.numberSequences || [] };
  }
  function snapshotHash(snap) {
    return crypto.createHash("sha256")
      .update(stableStringify(snap.companies.map(projectCompany)))
      .update(stableStringify(snap.numberSequences.map(projectSequence)))
      .digest("hex");
  }

  function syncNow({ force = false } = {}) {
    if (!pool) return Promise.resolve({ skipped: true, reason: "geen pg" });
    // Geserialiseerd: de nummerreeks-uniciteit en de partiële default-index
    // verdragen geen twee tegelijk lopende set-syncs.
    const run = chain.then(async () => {
      const snap = snapshot();
      const hash = snapshotHash(snap);
      if (!force && hash === state.lastSnapshotHash) return { skipped: true, reason: "ongewijzigd" };
      try {
        const result = await syncCompanies(pool, snap);
        state.lastSnapshotHash = hash;
        state.lastSyncAt = new Date().toISOString();
        state.lastSyncResult = result;
        state.lastError = null;
        return result;
      } catch (err) {
        state.lastError = String(err && err.message || err).slice(0, 300);
        metric("company.sync.error", { mode: m });
        warn("company-sync faalde", { error: state.lastError });
        throw err;
      }
    });
    chain = run.catch(() => {});
    return run;
  }

  async function reconcile() {
    if (!pool) return { ok: false, reason: "geen pg" };
    return reconcileCompanies(pool, snapshot());
  }

  /**
   * Default-company met bronschakelaar. legacyThunk levert de bestaande
   * ensureDefaultCompany-uitkomst; in pg-stand komt de company uit de tabel.
   */
  async function readDefaultCompany(tenantId, legacyThunk) {
    if (m === "pg") {
      try {
        await syncNow();   // read-your-writes: schrijven gaat nog naar legacy
        const company = await findDefaultCompany(pool, tenantId);
        // Terugval als de sync (nog) niets opleverde · nooit een lege company
        // teruggeven waar legacy er een zou aanmaken.
        return company || legacyThunk();
      } catch (err) {
        const e = new Error("Company-bron (PostgreSQL) is niet beschikbaar");
        e.status = 503; e.code = "COMPANY_SOURCE_UNAVAILABLE"; e.cause = err; throw e;
      }
    }
    const legacy = legacyThunk();
    if (m === "shadow" && pool) shadowCompareDefault(tenantId, legacy);
    return legacy;
  }

  function shadowCompareDefault(tenantId, legacyCompany) {
    syncNow().catch(() => {}).then(() => findDefaultCompany(pool, tenantId)).then(pgCompany => {
      state.shadowChecks += 1;
      const same = stableStringify(legacyCompany ? projectCompany(legacyCompany) : null)
        === stableStringify(pgCompany ? projectCompany(pgCompany) : null);
      if (!same) {
        state.shadowMismatches += 1;
        metric("company.shadow.mismatch", { mode: m, kind: "default_company" });
        warn("company-schaduwlezing wijkt af", { kind: "default_company" });
      }
    }).catch(err => {
      metric("company.shadow.error", { mode: m });
      warn("company-schaduwlezing faalde", { error: String(err && err.message || err).slice(0, 200) });
    });
  }

  function status() {
    return {
      mode: m, pgConnected: !!pool,
      lastSyncAt: state.lastSyncAt, lastSyncResult: state.lastSyncResult, lastError: state.lastError,
      shadowChecks: state.shadowChecks, shadowMismatches: state.shadowMismatches,
    };
  }

  return { mode: m, syncNow, reconcile, readDefaultCompany, status };
}

module.exports = { makeCompanySource };
