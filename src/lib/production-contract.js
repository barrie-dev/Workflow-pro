"use strict";

// ── Production config-contract (CTO3-05) ─────────────────────────────────────
// Eén niet-geheim, versieerbaar contract legt vast WELKE bron, adapter,
// securitymode en featureflag in productie actief hoort te zijn. Secrets blijven
// extern (Render dashboard / secret-store) · dit bestand bevat NOOIT secret-
// WAARDEN, alleen key-NAMEN en gewenste niet-geheime waarden.
//
// De evaluatie is fail-closed: bij elke afwijking (drift), ontbrekende
// verplichte env-key of een niet-toegestane bron faalt de preflight. Zo blijft
// geen kritieke productie-flag een ongedocumenteerde dashboardinstelling.

const fs = require("fs");
const path = require("path");

const CONTRACT_PATH = path.join(__dirname, "..", "..", "deploy", "production-contract.json");

function loadContract(p = CONTRACT_PATH) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function present(v) { return v !== undefined && v !== null && String(v).trim() !== ""; }
function norm(v) { return String(v == null ? "" : v).toLowerCase().trim(); }

/**
 * Evalueer de EFFECTIEVE runtime tegen het contract.
 * @param {object} contract   geladen production-contract.json
 * @param {object} actual     effectieve runtime-waarden (uit config, niet ruwe env):
 *   { STORAGE_ADAPTER, OBJECT_STORAGE_ADAPTER, DATABASE_SSL_MODE, SINGLE_WRITER(bool),
 *     RELEASE_CHANNEL, CRM_READ_SOURCE, IDENTITY_READ_SOURCE, FINANCE_READ_SOURCE,
 *     COMPANY_READ_SOURCE, FORMS_SOURCE, DATABASE_CA_CERT_PRESENT(bool) }
 * @param {object} opts
 *   @param {object} opts.env                 map voor aanwezigheid van verplichte env-keys
 *   @param {boolean} opts.formsReconcileReady of de Forms-reconcile aantoonbaar groen is
 *   @param {string}  opts.now                ISO-datum voor het verlopen van uitzonderingen
 * @returns {{ ok, drift, missingEnv, forbidden, formsGuard, sources, summary }}
 */
function evaluateRuntime(contract, actual, opts = {}) {
  const env = opts.env || {};
  const now = opts.now ? Date.parse(opts.now) : null;
  const desired = contract.desired || {};
  const drift = [];
  const forbidden = [];
  const sources = {};
  const exceptions = activeExceptions(contract, now);

  for (const [key, rule] of Object.entries(desired)) {
    const got = actual[key];
    if (rule.sourceOfTruth) sources[key] = norm(got) || "legacy";
    // Verboden waarden (bv. OBJECT_STORAGE_ADAPTER=local) · harde weigering.
    if (Array.isArray(rule.forbidden) && rule.forbidden.map(norm).includes(norm(got))) {
      forbidden.push({ key, value: got == null ? null : String(got), reason: rule.reason || "verboden waarde in productie" });
      continue;
    }
    let acceptable;
    if (rule.equals !== undefined) acceptable = matches(got, rule.equals);
    else if (rule.in) acceptable = rule.in.map(norm).includes(norm(got));
    else acceptable = true; // enkel source_of_truth-rapportage
    if (!acceptable && exceptions[key]) continue; // gedekt door een geldige, tijdgebonden uitzondering
    if (!acceptable) drift.push({ key, actual: got == null ? null : String(got), desired: rule.equals !== undefined ? rule.equals : rule.in, reason: rule.reason });
  }

  // Verplichte env-keys aanwezig (op NAAM · nooit de waarde loggen).
  const missingEnv = [];
  for (const key of contract.requiredEnvKeys || []) if (!present(env[key])) missingEnv.push(key);
  for (const c of contract.conditionalEnvKeys || []) {
    const [wk, wv] = String(c.when || "").split("=");
    const activeCond = wk && norm(resolveWhen(wk, actual, env)) === norm(wv);
    if (activeCond && !present(env[c.key])) missingEnv.push(c.key);
  }

  // Forms-cutover-poortwachter: FORMS_SOURCE=pg mag pas na een groene reconcile.
  const formsGuard = [];
  if (norm(actual.FORMS_SOURCE) === "pg" && !opts.formsReconcileReady) {
    formsGuard.push("FORMS_SOURCE=pg vereist een aantoonbaar groene Forms-reconcile (legacy writes 410) · draai eerst `node scripts/forms-cutover.js reconcile`");
  }

  const ok = !drift.length && !missingEnv.length && !forbidden.length && !formsGuard.length;
  return {
    ok, drift, missingEnv, forbidden, formsGuard, sources,
    exceptionsApplied: Object.keys(exceptions),
    summary: safeSummary(actual, sources),
  };
}

// Waar de conditionele 'when' naar een effectieve waarde of env-key verwijst.
function resolveWhen(key, actual, env) {
  if (actual[key] !== undefined) return actual[key];
  return env[key];
}

function matches(got, want) {
  if (typeof want === "boolean") return (norm(got) === "true") === want || got === want;
  return norm(got) === norm(want);
}

// Alleen niet-verlopen uitzonderingen tellen (tijdgebonden · Geen default legacy
// in productie zonder expliciete, tijdgebonden uitzondering).
function activeExceptions(contract, now) {
  const out = {};
  for (const ex of contract.exceptions || []) {
    if (!ex.key) continue;
    if (ex.expiresAt && now != null) {
      const exp = Date.parse(ex.expiresAt);
      if (Number.isFinite(exp) && exp < now) continue; // verlopen
    }
    out[ex.key] = ex;
  }
  return out;
}

// Veilige runtime-samenvatting: bronstatus + adapters + modi · NOOIT secrets.
function safeSummary(actual, sources) {
  return {
    releaseChannel: actual.RELEASE_CHANNEL || null,
    storageAdapter: actual.STORAGE_ADAPTER || null,
    objectStorageAdapter: actual.OBJECT_STORAGE_ADAPTER || null,
    databaseSslMode: actual.DATABASE_SSL_MODE || null,
    databaseCaCertPresent: !!actual.DATABASE_CA_CERT_PRESENT,
    singleWriter: actual.SINGLE_WRITER === true || norm(actual.SINGLE_WRITER) === "true",
    sourceOfTruth: sources,
    formsSource: norm(actual.FORMS_SOURCE) || "legacy",
  };
}

/**
 * Bouw de EFFECTIEVE actual-map uit het geladen config-object (src/lib/config).
 * Dit is de brug tussen de runtime en het contract · afgeleide waarden (bv.
 * singleWriter default-true in productie) komen zo correct mee.
 */
function actualFromConfig(config) {
  return {
    STORAGE_ADAPTER: config.storageAdapter,
    OBJECT_STORAGE_ADAPTER: config.objectStorage && config.objectStorage.adapter,
    DATABASE_SSL_MODE: config.database && config.database.sslMode,
    DATABASE_CA_CERT_PRESENT: !!(config.database && config.database.caCert),
    SINGLE_WRITER: !!config.singleWriter,
    RELEASE_CHANNEL: config.releaseChannel,
    CRM_READ_SOURCE: config.crm && config.crm.readSource,
    IDENTITY_READ_SOURCE: config.identity && config.identity.readSource,
    FINANCE_READ_SOURCE: config.finance && config.finance.readSource,
    COMPANY_READ_SOURCE: config.company && config.company.readSource,
    FORMS_SOURCE: config.forms && config.forms.source,
  };
}

/**
 * Blueprint-dekking: elke verplichte env-key EN elke gewenste flag moet in
 * render.yaml gedeclareerd zijn (met een waarde of sync:false). Zo blijft geen
 * kritieke flag een ongedocumenteerde dashboardinstelling.
 */
function evaluateBlueprintCoverage(contract, renderYaml) {
  const declared = new Set([...renderYaml.matchAll(/^\s*-\s*key:\s*([A-Z0-9_]+)\s*$/gim)].map(m => m[1]));
  const needed = new Set([
    ...Object.keys(contract.desired || {}),
    ...(contract.requiredEnvKeys || []),
    ...(contract.conditionalEnvKeys || []).map(c => c.key),
  ]);
  // Afgeleide/niet-env flags die niet als losse Render-key hoeven (ze komen uit
  // NODE_ENV/APP_ENV of zijn geen env-var): laat ze buiten de dekkingseis.
  const derived = new Set(contract.derivedKeys || []);
  const missing = [...needed].filter(k => !declared.has(k) && !derived.has(k)).sort();
  return { ok: missing.length === 0, missing, declaredCount: declared.size };
}

module.exports = {
  CONTRACT_PATH, loadContract, evaluateRuntime, actualFromConfig,
  evaluateBlueprintCoverage, safeSummary,
};
