"use strict";
/**
 * CRM-bronschakelaar (handover 5.4 stap 5-7).
 *
 * Eén façade voor de canonieke /customers-routes, met drie standen:
 *
 *   legacy  (default)  lezen + schrijven op de bestaande store · gedrag van vandaag
 *   shadow  stap 6     lezen uit legacy (leidend), pg leest MEE en afwijkingen
 *                      gaan naar telemetrie; elke schrijfactie gaat naar beide
 *   pg      stap 7     lezen uit PostgreSQL; schrijven blijft dual zodat een
 *                      rollback een flag-flip is (legacy wordt pas read-only in
 *                      stap 8, na de afgesproken retentie)
 *
 * Schrijfvolgorde is in ALLE standen dezelfde: eerst de legacy-repository (die
 * bezit de normalisatie en de id-uitgifte), daarna de spiegel naar pg via de
 * idempotente upsert van de backfill. Zo blijven id's identiek · de voorwaarde
 * voor reconciliatie · en is er precies één schrijfpad om te bewaken.
 *
 * Faalgedrag van de spiegel verschilt bewust per stand:
 *  - shadow: legacy is de waarheid · een pg-fout wordt gelogd en gemeten, maar
 *    breekt het verzoek niet. De reconciliatie vangt het verschil.
 *  - pg: de gebruiker LEEST uit pg · een spiegel-fout zou zijn eigen schrijf-
 *    actie onzichtbaar maken. Dan faalt het verzoek met 503; de legacy-rij
 *    staat er al, dus een nieuwe poging of backfill herstelt het.
 *
 * Alleen de /customers-routes schakelen hier. Afgeleide lookups elders
 * (klantnaam op een contract of asset) blijven op de synchrone legacy-repo tot
 * hun eigen domein migreert · dat is de per-domein-strangler van 5.4/5.5, geen
 * vergetelheid.
 */

const MODES = ["legacy", "shadow", "pg"];

function clean(v) { return String(v == null ? "" : v).trim(); }

/**
 * @param {object} deps
 * @param {"legacy"|"shadow"|"pg"} deps.mode
 * @param {object} deps.legacyRepo   synchrone compatibility-repository
 * @param {object|null} deps.pgRepo  async pg-repository (vereist buiten legacy)
 * @param {Function|null} deps.mirror  (tenantId, legacyRow) => Promise · upsert naar pg
 * @param {object} deps.telemetry
 */
function makeCustomerSource({ mode = "legacy", legacyRepo, pgRepo = null, mirror = null, telemetry = null }) {
  const m = clean(mode) || "legacy";
  if (!MODES.includes(m)) {
    const e = new Error(`Onbekende CRM_READ_SOURCE '${m}' · kies legacy, shadow of pg`);
    e.status = 500; e.code = "UNKNOWN_CRM_SOURCE"; throw e;
  }
  if (m !== "legacy" && (!pgRepo || !mirror)) {
    // Hard falen bij het opstarten (ADR-004): stil terugvallen op legacy zou
    // een cutover suggereren die er niet is.
    const e = new Error(`CRM_READ_SOURCE=${m} vereist de PostgreSQL-adapter (STORAGE_ADAPTER=postgres)`);
    e.status = 500; e.code = "CRM_SOURCE_NEEDS_PG"; throw e;
  }
  const metric = (name, attrs) => { try { telemetry && telemetry.metric(name, 1, attrs); } catch (_) {} };
  const warn = (message, attrs) => { try { telemetry && telemetry.log({ level: "warn", message, attributes: attrs }); } catch (_) {} };

  /** Spiegel één legacy-rij naar pg. Gooit alleen in pg-modus. */
  async function mirrorRow(tenantId, row, op) {
    try {
      await mirror(tenantId, row);
    } catch (err) {
      metric("crm.mirror.failed", { op });
      warn(`CRM-spiegel naar pg mislukt (${op}): ${err.message}`, { tenantId, op });
      if (m === "pg") {
        const e = new Error("Opslaan in de nieuwe gegevensbron is mislukt · probeer opnieuw");
        e.status = 503; e.code = "CRM_MIRROR_FAILED"; throw e;
      }
    }
  }

  /** Shadow-vergelijking op een detail-lees · goedkoop en gericht. */
  async function shadowCompare(tenantId, id, legacyRow) {
    try {
      const pgRow = await pgRepo.findById(tenantId, id);
      const mismatch = !!legacyRow !== !!pgRow
        || (legacyRow && pgRow && (clean(legacyRow.name) !== clean(pgRow.name)
          || clean(legacyRow.email || "") !== clean(pgRow.email || "")
          || clean(legacyRow.vatNumber || "") !== clean(pgRow.vatNumber || "")));
      metric(mismatch ? "crm.shadow.mismatch" : "crm.shadow.match", {});
      if (mismatch) warn("Shadow-read wijkt af van legacy", { tenantId, customerId: id, missingInPg: !pgRow });
    } catch (err) {
      metric("crm.shadow.error", {});
    }
  }

  return {
    mode: m,

    async list(tenantId) {
      if (m === "pg") {
        const res = await pgRepo.search(tenantId, { limit: 200, includeArchived: false });
        return res.rows;
      }
      const rows = legacyRepo.list(tenantId);
      if (m === "shadow") {
        // Aantallen vergelijken volstaat op een lijst; de inhoudscontrole zit
        // in de detail-lees en in de reconciliatie-CLI.
        pgRepo.count(tenantId).then(n => {
          if (n !== rows.length) { metric("crm.shadow.mismatch", { op: "list" }); warn("Shadow-lijst wijkt af", { tenantId, legacy: rows.length, pg: n }); }
          else metric("crm.shadow.match", { op: "list" });
        }).catch(() => metric("crm.shadow.error", { op: "list" }));
      }
      return rows;
    },

    async findById(tenantId, id) {
      if (m === "pg") return pgRepo.findById(tenantId, id);
      const row = legacyRepo.findById(tenantId, id);
      if (m === "shadow") await shadowCompare(tenantId, id, row);
      return row;
    },

    async insert(tenantId, payload, actor) {
      const row = legacyRepo.insert(tenantId, payload, actor);
      if (m !== "legacy") await mirrorRow(tenantId, row, "insert");
      return row;
    },

    async update(tenantId, id, patch, actor, expectedVersion) {
      const row = legacyRepo.update(tenantId, id, patch, actor, expectedVersion);
      if (m !== "legacy") await mirrorRow(tenantId, row, "update");
      return row;
    },

    async remove(tenantId, id) {
      const result = legacyRepo.remove(tenantId, id);
      if (m !== "legacy") {
        // Verwijderen spiegelt als archiveren: de pg-kant kent geen harde
        // delete (DoD: historiek blijft). De reconciliatie meldt de rij als
        // "alleen in pg" tot stap 8 het beleid gelijktrekt.
        try { await pgRepo.archive(tenantId, id, "mirror"); }
        catch (_) { metric("crm.mirror.failed", { op: "remove" }); }
      }
      return result;
    },

    status() {
      return { source: m, dualWrite: m !== "legacy" };
    },
  };
}

module.exports = { makeCustomerSource, MODES };
