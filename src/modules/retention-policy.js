"use strict";

// ── Retentiebeleid (Forms handover h5/h27 · FORM-05) ─────────────────────────
// Pure beslislaag boven het retention_policies-register. Bepaalt of een object
// mag worden opgeruimd (purge) op basis van bewaartermijn, minimaal te bewaren
// aantal, legal hold en purge-strategie. Geen SQL · de aanroeper levert de rijen.
//
// GDPR-lijn (memory [[feedback-gdpr-werkbaar]]): objecten worden nooit stil
// verwijderd. soft_archive zet archived_at; anonymize maskeert persoonsvelden;
// hard_delete is de enige die echt wist en vraagt een expliciete grondslag.

const { PURGE_STRATEGIES } = require("../platform/metadata");

const DAY_MS = 24 * 60 * 60 * 1000;

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/** Normaliseer een (mogelijk gebruikers-)beleid naar een veilige, volledige vorm. */
function normalizePolicy(raw = {}) {
  const retentionDays = raw.retention_days == null && raw.retentionDays == null
    ? null
    : clampInt(raw.retention_days ?? raw.retentionDays, 0, 100 * 365, null);
  const strategy = PURGE_STRATEGIES.includes(raw.purge_strategy || raw.purgeStrategy)
    ? (raw.purge_strategy || raw.purgeStrategy)
    : "soft_archive";
  return {
    key: String(raw.key || "").trim() || "default",
    name: String(raw.name || raw.key || "Standaardbeleid").trim(),
    appliesToClassification: raw.applies_to_classification || raw.appliesToClassification || null,
    retentionDays,
    keepMinimum: clampInt(raw.keep_minimum ?? raw.keepMinimum, 0, 1e6, 0),
    legalHold: !!(raw.legal_hold ?? raw.legalHold),
    purgeStrategy: strategy,
    legalBasis: raw.legal_basis || raw.legalBasis || null,
    active: raw.active === undefined ? true : !!raw.active,
  };
}

/** Het referentiemoment van een object voor de bewaartermijn (archived > created). */
function anchorTime(row) {
  const t = row.archived_at || row.archivedAt || row.created_at || row.createdAt || null;
  if (!t) return null;
  const ms = typeof t === "number" ? t : Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Is dit object aan purge toe volgens het beleid?
 * - legal hold → nooit;
 * - onbepaalde termijn (retentionDays == null) → nooit;
 * - anders: anchorTime + retentionDays < now.
 * `rank` = positie van nieuw→oud (0 = nieuwste); onder keepMinimum nooit purgen.
 */
function isPurgeEligible(row, policy, { now = Date.now(), rank = Infinity } = {}) {
  const p = normalizePolicy(policy);
  if (p.legalHold) return false;
  if (row && (row.legal_hold || row.legalHold)) return false;
  if (p.retentionDays == null) return false;
  if (rank < p.keepMinimum) return false;
  const anchor = anchorTime(row);
  if (anchor == null) return false;
  return anchor + p.retentionDays * DAY_MS < now;
}

/**
 * Bepaal de purge-set uit een verzameling objecten (nieuwste eerst gesorteerd).
 * Retourneert { eligible, kept, strategy } zodat de aanroeper per strategie
 * kan handelen. Muteert niets · puur.
 */
function computePurgeSet(rows, policy, { now = Date.now() } = {}) {
  const p = normalizePolicy(policy);
  const sorted = [...(rows || [])].sort((a, b) => (anchorTime(b) || 0) - (anchorTime(a) || 0));
  const eligible = [];
  const kept = [];
  sorted.forEach((row, i) => {
    (isPurgeEligible(row, p, { now, rank: i }) ? eligible : kept).push(row);
  });
  return { eligible, kept, strategy: p.purgeStrategy, policy: p };
}

/** Korte samenvatting voor de instellingen-UI / audit. */
function policySummary(policy, rows = [], now = Date.now()) {
  const { eligible, kept, strategy } = computePurgeSet(rows, policy, { now });
  const p = normalizePolicy(policy);
  return {
    key: p.key,
    retentionDays: p.retentionDays,
    legalHold: p.legalHold,
    strategy,
    total: rows.length,
    eligible: eligible.length,
    kept: kept.length,
  };
}

module.exports = {
  DAY_MS, normalizePolicy, anchorTime, isPurgeEligible, computePurgeSet, policySummary,
};
