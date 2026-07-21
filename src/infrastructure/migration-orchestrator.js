"use strict";
/**
 * Migratie-orchestrator (CTO P0-01 · sluitstuk).
 *
 * De genormaliseerde runtime-domeinen (identity, company, finance) delen
 * dezelfde snapshot-spiegel-interface: { mode, syncNow, reconcile, status }.
 * Deze orchestrator coördineert ze als één geheel, zodat een cutover-beslissing
 * niet per domein hoeft te worden samengeraapt:
 *
 *  - syncAll() spiegelt alle domeinen in DEPENDENCY-VOLGORDE (tenants/identity
 *    eerst, dan companies, dan finance · finance verwijst naar beide). De
 *    per-domein-sync plaatst zelf tenant-ankers, dus de volgorde is een
 *    optimalisatie, geen harde eis; expliciet houden maakt de intentie leesbaar.
 *  - reconcileAll() bewijst dat ELK domein sluitend is (beide richtingen +
 *    domeinspecifieke invarianten zoals het factuursaldo en de nummerreeks).
 *    Eén `ok:false` ergens maakt het geheel niet-cutover-gereed.
 *
 * De orchestrator kent GEEN SQL en GEEN adapterdetails · alleen het uniforme
 * bron-contract. CRM volgt een eigen (oudere) cutover-route met een eigen
 * reconciliatie-CLI en wordt hier alleen informatief meegenomen.
 */

function clean(v) { return String(v == null ? "" : v).trim(); }

/**
 * @param {object} deps
 * @param {Array<{name:string, source:object, dependsOn?:string[]}>} deps.domains
 *   Elk source-object implementeert { mode, syncNow, reconcile, status }.
 * @param {object} [deps.info] Extra domeinen die alleen een mode/status leveren
 *   (bv. CRM met zijn eigen cutover-route): { name: () => statusObject }.
 */
function makeMigrationOrchestrator({ domains = [], info = {} } = {}) {
  // Stabiele, dependency-bewuste volgorde: een domein komt na alles waar het
  // van afhangt. Simpele topologische sortering over de opgegeven lijst.
  const ordered = topoSort(domains);

  async function syncAll({ force = false } = {}) {
    const results = {};
    for (const d of ordered) {
      try { results[d.name] = await d.source.syncNow({ force }); }
      catch (err) { results[d.name] = { error: String(err && err.message || err).slice(0, 300) }; }
    }
    return results;
  }

  /**
   * Sync + reconcile elk domein. Bewust eerst syncen (force) en dan
   * reconciliëren: het rapport toont of de PIJPLIJN klopt · een blijvende
   * afwijking na een verse sync is een echte bug, geen interval-lag.
   */
  async function reconcileAll() {
    const domainsReport = {};
    let ok = true;
    for (const d of ordered) {
      try {
        await d.source.syncNow({ force: true });
        const rec = await d.source.reconcile();
        domainsReport[d.name] = rec;
        if (!rec || rec.ok !== true) ok = false;
      } catch (err) {
        domainsReport[d.name] = { ok: false, error: String(err && err.message || err).slice(0, 300) };
        ok = false;
      }
    }
    return { ok, order: ordered.map(d => d.name), domains: domainsReport, info: infoStatuses() };
  }

  function infoStatuses() {
    const out = {};
    for (const [name, fn] of Object.entries(info)) {
      try { out[name] = typeof fn === "function" ? fn() : fn; } catch (_) { out[name] = { error: "status niet leesbaar" }; }
    }
    return out;
  }

  function status() {
    const out = {};
    for (const d of ordered) {
      try { out[d.name] = d.source.status(); } catch (_) { out[d.name] = { error: "status niet leesbaar" }; }
    }
    return { order: ordered.map(d => d.name), domains: out, info: infoStatuses() };
  }

  return { syncAll, reconcileAll, status, order: ordered.map(d => d.name) };
}

/** Topologische sortering; valt terug op invoervolgorde bij cycli/ontbrekende deps. */
function topoSort(domains) {
  const byName = new Map(domains.map(d => [d.name, d]));
  const visited = new Set();
  const out = [];
  function visit(d, stack) {
    if (visited.has(d.name) || stack.has(d.name)) return;
    stack.add(d.name);
    for (const dep of (d.dependsOn || [])) {
      const depDomain = byName.get(clean(dep));
      if (depDomain) visit(depDomain, stack);
    }
    stack.delete(d.name);
    visited.add(d.name);
    out.push(d);
  }
  for (const d of domains) visit(d, new Set());
  return out;
}

module.exports = { makeMigrationOrchestrator };
