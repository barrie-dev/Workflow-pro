"use strict";

// ── Deployment-evidence + P0 pilotgate (CTO3-06) ─────────────────────────────
// Eén automatisch gegenereerde, SHA-specifieke evidencebundle waaruit de CTO de
// volledige releasebeslissing kan nemen: welke SHA draait, is ze ready, bewaart
// ze data (canary overleeft een echte restart), en gebruikt ze de verwachte
// adapters/TLS/writer-lock/bronnen. Geen handmatig "production verified"-tekst ·
// alles is machineleesbaar en fail-closed.
//
// De P0 pilotgate wordt AUTOMATISCH berekend uit CTO3-01 t/m CTO3-06.

const N = (v) => String(v == null ? "" : v).toLowerCase().trim();

// Vergelijk twee commit-SHA's op de kortste gemeenschappelijke lengte (kort vs
// lang). Exacte match vereist ≥7 tekens · een lege of te korte SHA faalt.
function shaMatches(a, b) {
  const x = String(a || ""), y = String(b || "");
  const n = Math.min(x.length, y.length, 40);
  return n >= 7 && x.slice(0, n) === y.slice(0, n);
}

/**
 * Evalueer de deploy-gate uit runtime-observaties. Alle inputs zijn NIET-geheim
 * (afgeleid uit /api/ready + /api/health + de canary + de storage-proof).
 *
 * @param {object} o
 *  @param o.candidateSha  de kandidaat-release-SHA (git HEAD / tag)
 *  @param o.ready         /api/ready-body: { ok, status, commitSha, deploymentId, checks{...} }
 *  @param o.health        /api/health-body: { status, commitSha, deploymentId } (liveness)
 *  @param o.canary        { created, readBack, mutationSurvivedRestart, tenantId, id }
 *  @param o.storageProof  { ok, key, bytes, isolatedFromCustomers }
 *  @param o.expected      gewenste waarden uit het contract: { objectStorageAdapters[], databaseSslMode, singleWriter }
 *  @param o.backup        { ok, ... } backup/restore-status (optioneel)
 * @returns {{ ok, checks, failures, summary }}
 */
function evaluateDeployGate(o = {}) {
  const ready = o.ready || {};
  const checksIn = ready.checks || {};
  const expected = o.expected || {};
  const canary = o.canary || {};
  const storage = o.storageProof || {};
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: !!ok, detail });

  // 1. SHA-koppeling: de gerapporteerde commit MOET exact de kandidaat zijn.
  add("sha_match", shaMatches(ready.commitSha, o.candidateSha),
    `runtime=${ready.commitSha || "?"} candidate=${o.candidateSha || "?"}`);

  // 2. Readiness: alleen een echte 200/ready telt (nooit een half-opgestarte).
  add("readiness", ready.ok === true && N(ready.status) === "ready", `ok=${ready.ok} status=${ready.status}`);

  // 3. Liveness aanwezig + SHA-gekoppeld.
  add("liveness", !!(o.health && shaMatches(o.health.commitSha, o.candidateSha)), `health.commitSha=${o.health && o.health.commitSha}`);

  // 4. Objectopslag-adapter is de verwachte adapter. In productie sluit het
  //    contract 'local' uit (wantAdapters = s3|azure-blob), dus lidmaatschap van
  //    de verwachte set dwingt "nooit local in productie" al af.
  const adapter = N(checksIn.objectStorageAdapter);
  const wantAdapters = (expected.objectStorageAdapters || ["s3", "azure-blob"]).map(N);
  add("object_storage_adapter", !!adapter && wantAdapters.includes(adapter), `adapter=${adapter || "?"} verwacht=${wantAdapters.join("|")}`);

  // 5. DB-TLS: verwachte modus + CA-presentie bij verify-full.
  const sslMode = N(checksIn.databaseSslMode);
  const wantSsl = N(expected.databaseSslMode || "verify-full");
  const caOk = sslMode !== "verify-full" || checksIn.databaseCaCertPresent === true;
  add("db_tls_mode", sslMode === wantSsl, `ssl=${sslMode} verwacht=${wantSsl}`);
  add("db_ca_present", caOk, `sslMode=${sslMode} caPresent=${!!checksIn.databaseCaCertPresent}`);

  // 6. Single-writer-lock actief.
  const wantWriter = expected.singleWriter !== false;
  add("writer_lock", (checksIn.singleWriter === true) === wantWriter, `singleWriter=${checksIn.singleWriter}`);

  // 7. Canary: een mutatie in een gereserveerde systeem/canarytenant overleeft
  //    een ECHTE restart/deploy (create → read → restart → read).
  add("canary_survived_restart", canary.mutationSurvivedRestart === true, `created=${!!canary.created} readBack=${!!canary.readBack} tenant=${canary.tenantId || "?"}`);

  // 8. Objectopslag put/get NA deploy, geïsoleerd van klantbestanden.
  add("object_storage_roundtrip", storage.ok === true && storage.isolatedFromCustomers !== false, `ok=${storage.ok} isolated=${storage.isolatedFromCustomers}`);

  // 9. Backup/restore-status (indien meegegeven · anders informatief).
  if (o.backup) add("backup_status", o.backup.ok === true, `ok=${o.backup.ok}`);

  const failures = checks.filter(c => !c.ok).map(c => ({ check: c.id, detail: c.detail }));
  return {
    ok: failures.length === 0,
    checks,
    failures,
    summary: safeSummary(o),
  };
}

// Niet-geheime samenvatting voor het leesbare rapport (nooit secrets).
function safeSummary(o) {
  const c = (o.ready && o.ready.checks) || {};
  return {
    candidateSha: o.candidateSha || null,
    runtimeSha: (o.ready && o.ready.commitSha) || null,
    deploymentId: (o.ready && o.ready.deploymentId) || null,
    buildTime: o.buildTime || null,
    migrationVersion: c.migrationVersion || null,
    readiness: o.ready ? o.ready.ok === true : false,
    databaseSslMode: c.databaseSslMode || null,
    databaseCaCertPresent: !!c.databaseCaCertPresent,
    singleWriter: c.singleWriter === true,
    objectStorageAdapter: c.objectStorageAdapter || null,
    sources: c.sources || null,
    formsSource: (c.sources && c.sources.forms) || null,
    canary: { tenantId: (o.canary && o.canary.tenantId) || null, survivedRestart: !!(o.canary && o.canary.mutationSurvivedRestart) },
    backup: o.backup || null,
  };
}

/**
 * Bereken de P0 pilotgate uit CTO3-01 t/m CTO3-06. Elk onderdeel komt uit een
 * machineleesbare bron (deploy-gate-checks of een gevalideerd evidence-artefact);
 * ontbrekend bewijs = niet groen (fail-closed).
 *
 * @param {object} deployGate  resultaat van evaluateDeployGate
 * @param {object} sub         { restoreDrillOk, e2eManifestOk, contractOk }
 */
function computePilotGate(deployGate, sub = {}) {
  const byId = Object.fromEntries((deployGate.checks || []).map(c => [c.id, c.ok]));
  const items = [
    { code: "CTO3-01", label: "bootgate / startup-state-machine", ok: byId.readiness === true && byId.canary_survived_restart === true, source: "readiness+canary" },
    { code: "CTO3-02", label: "deployment readiness (SHA-gekoppeld)", ok: byId.readiness === true && byId.sha_match === true && byId.liveness === true, source: "ready/health" },
    { code: "CTO3-03", label: "volledige disaster recovery", ok: sub.restoreDrillOk === true, source: "restore-drill evidence" },
    { code: "CTO3-04", label: "9/9 horizontale E2E-ketens", ok: sub.e2eManifestOk === true, source: "e2e-manifest evidence" },
    { code: "CTO3-05", label: "config-contract conform", ok: sub.contractOk === true && byId.object_storage_adapter === true && byId.db_ca_present === true, source: "production-contract" },
    { code: "CTO3-06", label: "deployment evidence op exacte SHA", ok: deployGate.ok === true, source: "deploy-gate" },
  ];
  const ok = items.every(i => i.ok);
  return { ok, items, blocked: items.filter(i => !i.ok).map(i => i.code) };
}

module.exports = { evaluateDeployGate, computePilotGate, shaMatches, safeSummary };
