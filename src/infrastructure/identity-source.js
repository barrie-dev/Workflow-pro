"use strict";
/**
 * Identity-bronschakelaar (CTO P0-01 · zelfde strangler-route als CRM 5.4).
 *
 * Drie standen via IDENTITY_READ_SOURCE:
 *
 *   legacy  (default)  lezen op de bestaande store · gedrag van vandaag
 *   shadow             legacy blijft leidend; pg leest MEE en afwijkingen
 *                      gaan naar telemetrie (identity.shadow.mismatch)
 *   pg                 de geschakelde leesroutes lezen uit PostgreSQL
 *
 * Schrijven blijft in ALLE standen bij de legacy-store (de write-owner): de
 * spiegel-lus projecteert het volledige platform-snapshot idempotent naar de
 * genormaliseerde tabellen. Eén choke-point in plaats van spiegels op elk van
 * de verspreide schrijfpaden (wachtwoordreset, MFA, teller-updates bij login):
 * de lus vangt ze ALLEMAAL, binnen één interval. Fase 1 bewust: ook de
 * wachtwoordverificatie bij login blijft op de legacy-store; pas wanneer het
 * schrijfpad zelf migreert (stap 8) wordt pg daar de waarheid.
 *
 * Faalgedrag: een spiegel- of schaduwfout breekt nooit een verzoek in
 * legacy/shadow (telemetrie + status); in pg-stand faalt een leesroute eerlijk
 * met 503 in plaats van stil terug te vallen · een rollback is een flag-flip.
 */

const {
  syncIdentity, reconcileIdentity, listUsers, findUserByEmail,
  projectUser, stableStringify,
} = require("./postgres/pg-identity-repository");
const crypto = require("crypto");

const MODES = ["legacy", "shadow", "pg"];

function clean(v) { return String(v == null ? "" : v).trim(); }

/**
 * @param {object} deps
 * @param {"legacy"|"shadow"|"pg"} deps.mode
 * @param {object} deps.store        legacy-store (write-owner)
 * @param {object|null} deps.pool    pg-pool · verplicht buiten legacy
 * @param {object|null} deps.telemetry
 */
function makeIdentitySource({ mode = "legacy", store, pool = null, telemetry = null }) {
  const m = clean(mode) || "legacy";
  if (!MODES.includes(m)) {
    const e = new Error(`Onbekende IDENTITY_READ_SOURCE '${m}' · kies legacy, shadow of pg`);
    e.status = 500; e.code = "UNKNOWN_IDENTITY_SOURCE"; throw e;
  }
  if (m !== "legacy" && !pool) {
    // Hard falen bij het opstarten (ADR-004): stil terugvallen op legacy zou
    // een cutover suggereren die er niet is.
    const e = new Error(`IDENTITY_READ_SOURCE=${m} vereist de PostgreSQL-adapter (STORAGE_ADAPTER=postgres)`);
    e.status = 500; e.code = "IDENTITY_SOURCE_NEEDS_PG"; throw e;
  }

  const metric = (name, attrs) => { try { telemetry && telemetry.metric(name, 1, attrs); } catch (_) {} };
  const warn = (message, attrs) => { try { telemetry && telemetry.log({ level: "warn", message, attributes: attrs }); } catch (_) {} };

  const state = {
    mode: m,
    lastSyncAt: null,
    lastSyncResult: null,
    lastError: null,
    shadowChecks: 0,
    shadowMismatches: 0,
    // Snapshot-poort: de lus slaat over zolang er niets wijzigde. Goedkoop
    // (identiteit is klein: tientallen rijen, geen documentenberg).
    lastSnapshotHash: null,
  };

  function snapshot() {
    return { tenants: store.data.tenants || [], users: store.data.users || [] };
  }
  function snapshotHash(snap) {
    return crypto.createHash("sha256")
      .update(stableStringify(snap.tenants.map(t => t.id)))
      .update(stableStringify(snap.users.map(projectUser)))
      .digest("hex");
  }

  /** Spiegel het volledige snapshot naar pg; idempotent, met wijzigingspoort. */
  async function syncNow({ force = false } = {}) {
    if (!pool) return { skipped: true, reason: "geen pg" };
    const snap = snapshot();
    const hash = snapshotHash(snap);
    if (!force && hash === state.lastSnapshotHash) return { skipped: true, reason: "ongewijzigd" };
    try {
      const result = await syncIdentity(pool, snap);
      state.lastSnapshotHash = hash;
      state.lastSyncAt = new Date().toISOString();
      state.lastSyncResult = result;
      state.lastError = null;
      return result;
    } catch (err) {
      state.lastError = String(err && err.message || err).slice(0, 300);
      metric("identity.sync.error", { mode: m });
      warn("identity-sync faalde", { error: state.lastError });
      throw err;
    }
  }

  /** Volledige reconciliatie (evidence): elke gebruiker, beide richtingen. */
  async function reconcile() {
    if (!pool) return { ok: false, reason: "geen pg" };
    return reconcileIdentity(pool, { users: snapshot().users });
  }

  /**
   * Schaduwvergelijking van één gebruiker · fire-and-forget vanaf de routes.
   * Eerst syncen, dan vergelijken: de vergelijking toetst of de PROJECTIE
   * klopt (heen-en-terug verliesvrij), niet of de spiegel-lus al gedraaid
   * heeft · dat laatste zou alleen de interval-lag meten en ruis geven.
   */
  function shadowCompareByEmail(email) {
    if (m === "legacy" || !pool) return;
    syncNow().catch(() => {}).then(() => {
      const legacy = (store.data.users || []).find(u => clean(u.email).toLowerCase() === clean(email).toLowerCase()) || null;
      return findUserByEmail(pool, email).then(pgUser => {
        state.shadowChecks += 1;
        const same = stableStringify(legacy ? projectUser(legacy) : null)
          === stableStringify(pgUser ? projectUser(pgUser) : null);
        if (!same) {
          state.shadowMismatches += 1;
          metric("identity.shadow.mismatch", { mode: m, kind: "login_lookup" });
          warn("identity-schaduwlezing wijkt af", { kind: "login_lookup" });
        }
      });
    }).catch(err => {
      metric("identity.shadow.error", { mode: m });
      warn("identity-schaduwlezing faalde", { error: String(err && err.message || err).slice(0, 200) });
    });
  }

  /**
   * Platform-accounts voor de superadmin-console. In pg-stand is PostgreSQL
   * de leesbron; een fout is dan een eerlijke 503, geen stille terugval.
   */
  async function listPlatformUsers() {
    const legacyList = () => (store.data.users || []).filter(u => u.role === "super_admin");
    if (m === "legacy") return legacyList();
    if (m === "shadow") {
      const legacy = legacyList();
      syncNow().catch(() => {}).then(() => listUsers(pool, { role: "super_admin" })).then(pgList => {
        state.shadowChecks += 1;
        const same = stableStringify(legacy.map(projectUser)) === stableStringify(pgList.map(projectUser));
        if (!same) {
          state.shadowMismatches += 1;
          metric("identity.shadow.mismatch", { mode: m, kind: "platform_users" });
          warn("identity-schaduwlezing wijkt af", { kind: "platform_users" });
        }
      }).catch(() => metric("identity.shadow.error", { mode: m }));
      return legacy;
    }
    try {
      // Read-your-writes: schrijven gebeurt nog op legacy (fase 1), dus eerst
      // de · snapshot-gepoorte, dus goedkope · sync, dan lezen uit pg.
      await syncNow();
      return await listUsers(pool, { role: "super_admin" });
    } catch (err) {
      const e = new Error("Identiteitsbron (PostgreSQL) is niet beschikbaar");
      e.status = 503; e.code = "IDENTITY_SOURCE_UNAVAILABLE"; e.cause = err;
      throw e;
    }
  }

  function status() {
    return {
      mode: m,
      pgConnected: !!pool,
      lastSyncAt: state.lastSyncAt,
      lastSyncResult: state.lastSyncResult,
      lastError: state.lastError,
      shadowChecks: state.shadowChecks,
      shadowMismatches: state.shadowMismatches,
    };
  }

  return { mode: m, syncNow, reconcile, shadowCompareByEmail, listPlatformUsers, status };
}

module.exports = { makeIdentitySource };
