"use strict";
/**
 * Append-only auditlog met eigen retentie en export (handover F-10).
 *
 * Het probleem dat dit vervangt: elke auditmutatie deed `slice(-500)` op één
 * gedeelde lijst. Dat betekende drie dingen tegelijk:
 *  1. auditregels verdwenen STIL zodra er 500 in stonden;
 *  2. de limiet was GLOBAAL, dus één drukke tenant duwde de trail van een
 *     andere tenant eruit · een tenant kon zo andermans bewijs wissen;
 *  3. elke regel triggerde een volledige save.
 *
 * Hier is de audit append-only: schrijven kapt nooit af. Opruimen is een
 * EXPLICIETE retentie-actie die rapporteert wat ze verwijderde, per tenant, en
 * die securitygevoelige regels langer bewaart.
 *
 * Cloudblind (ADR-001): geen SDK, geen SQL, geen omgevingsvariabelen.
 */

const { newUlid } = require("./events");
const { redactSecrets } = require("../ports/secret-provider");

const COLLECTION = "auditLogs";

// Securityrelevante acties hebben een langere ondergrens: die heb je nodig bij
// een incidentonderzoek, ook als de gewone retentie korter is.
const SECURITY_ACTIONS = /^(login|logout|auth|mfa|password|permission|impersonat|support_access|api_key|secret|policy|tenant_|user_(created|deleted|role)|export|backup|gdpr|cross_tenant)/i;

const DEFAULT_POLICY = {
  retentionDays: 400,          // ruim boven een boekjaar
  securityRetentionDays: 1095, // 3 jaar voor securityregels
  maxPerTenant: 50000,         // vangnet tegen ongelimiteerde groei
};

function clean(v) { return String(v == null ? "" : v).trim(); }
function isSecurityAction(action) { return SECURITY_ACTIONS.test(clean(action)); }

/**
 * Voeg een auditregel toe. APPEND-ONLY: er wordt hier NOOIT iets verwijderd.
 * Gevoelige waarden worden uit het detailveld geredigeerd (handover 4.3).
 */
function appendAudit(store, entry = {}) {
  if (!Array.isArray(store.data[COLLECTION])) store.data[COLLECTION] = [];
  const row = {
    id: `audit_${newUlid()}`,
    at: new Date().toISOString(),
    tenantId: entry.tenantId || null,
    actor: clean(entry.actor) || "system",
    action: clean(entry.action) || "unknown",
    area: clean(entry.area) || "general",
    // Detail is vrije tekst en kan per ongeluk een sleutel bevatten.
    detail: redactSecrets(clean(entry.detail)).slice(0, 1000),
    correlationId: clean(entry.correlationId) || null,
    security: isSecurityAction(entry.action),
  };
  store.data[COLLECTION].push(row);
  if (typeof store.save === "function") store.save();
  return row;
}

/** Auditregels opvragen, nieuwste eerst, met filters en paginatie. */
function listAudit(store, tenantId, { action = null, area = null, actor = null, from = null, to = null, securityOnly = false, limit = 100, cursor = 0 } = {}) {
  const all = (store.data[COLLECTION] || []).filter(r =>
    (tenantId == null || r.tenantId === tenantId)
    && (!action || clean(r.action).includes(clean(action)))
    && (!area || r.area === area)
    && (!actor || clean(r.actor).toLowerCase().includes(clean(actor).toLowerCase()))
    && (!from || r.at >= from)
    && (!to || r.at <= to)
    && (!securityOnly || r.security === true));
  const sorted = all.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const start = Math.max(0, Number(cursor) || 0);
  const size = Math.min(Math.max(1, Number(limit) || 100), 1000);
  const page = sorted.slice(start, start + size);
  return { rows: page, total: sorted.length, nextCursor: start + size < sorted.length ? start + size : null };
}

/**
 * Retentie toepassen. Dit is de ENIGE plek waar auditregels verdwijnen, en ze
 * rapporteert precies wat ze deed · zodat opruimen aantoonbaar is in plaats van
 * onzichtbaar.
 *
 * Per tenant, niet globaal: een drukke tenant mag de trail van een andere nooit
 * beïnvloeden.
 */
function pruneAudit(store, { policy = {}, now = new Date(), dryRun = false } = {}) {
  const p = { ...DEFAULT_POLICY, ...policy };
  const rows = store.data[COLLECTION] || [];
  const cutoff = new Date(now.getTime() - p.retentionDays * 86400000).toISOString();
  const securityCutoff = new Date(now.getTime() - p.securityRetentionDays * 86400000).toISOString();

  // Groepeer per tenant zodat limieten per tenant gelden.
  const perTenant = new Map();
  for (const r of rows) {
    const key = r.tenantId || "__platform__";
    if (!perTenant.has(key)) perTenant.set(key, []);
    perTenant.get(key).push(r);
  }

  const keep = new Set();
  const report = [];
  for (const [tenantKey, tenantRows] of perTenant) {
    // Nieuwste eerst; bij een gelijk tijdstempel op id, zodat het resultaat
    // deterministisch is en niet van de invoegvolgorde afhangt.
    const sorted = tenantRows.slice().sort((a, b) =>
      String(b.at).localeCompare(String(a.at)) || String(b.id).localeCompare(String(a.id)));
    let removedByAge = 0, removedByCap = 0, kept = 0, keptNormal = 0;
    for (const r of sorted) {
      const tooOld = r.security ? r.at < securityCutoff : r.at < cutoff;
      if (tooOld) { removedByAge++; continue; }
      // De cap telt ALLEEN niet-securityregels. Zou hij securityregels
      // meetellen, dan kan een piek aan securityevents de gewone audittrail
      // wegvagen terwijl je ver onder de bedoelde limiet zit.
      if (!r.security) {
        if (keptNormal >= p.maxPerTenant) { removedByCap++; continue; }
        keptNormal++;
      }
      keep.add(r.id);
      kept++;
    }
    if (removedByAge || removedByCap) {
      report.push({ tenantId: tenantKey === "__platform__" ? null : tenantKey, kept, removedByAge, removedByCap });
    }
  }

  const removed = rows.length - keep.size;
  if (!dryRun && removed > 0) {
    store.data[COLLECTION] = rows.filter(r => keep.has(r.id));
    if (typeof store.save === "function") store.save();
  }
  return { removed, kept: keep.size, dryRun, policy: p, perTenant: report };
}

/**
 * Export voor een audittrail-verzoek (GDPR, SOC, klantvraag). Levert
 * gestructureerde rijen; de aanroeper kiest CSV of JSON.
 */
function exportAudit(store, tenantId, filters = {}) {
  const { rows } = listAudit(store, tenantId, { ...filters, limit: 1000000, cursor: 0 });
  return {
    tenantId: tenantId || null,
    generatedAt: new Date().toISOString(),
    count: rows.length,
    filters,
    rows: rows.map(r => ({
      at: r.at, actor: r.actor, action: r.action, area: r.area,
      detail: r.detail, correlationId: r.correlationId, security: r.security,
    })),
  };
}

/** Samenvatting voor ops: omvang en oudste regel per tenant. */
function auditStats(store, tenantId = null) {
  const rows = (store.data[COLLECTION] || []).filter(r => tenantId == null || r.tenantId === tenantId);
  if (!rows.length) return { total: 0, security: 0, oldest: null, newest: null };
  const sorted = rows.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return {
    total: rows.length,
    security: rows.filter(r => r.security).length,
    oldest: sorted[0].at,
    newest: sorted[sorted.length - 1].at,
  };
}

module.exports = {
  COLLECTION, DEFAULT_POLICY, SECURITY_ACTIONS,
  isSecurityAction, appendAudit, listAudit, pruneAudit, exportAudit, auditStats,
};
