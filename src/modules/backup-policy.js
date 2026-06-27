"use strict";
/**
 * Backup-bewaarbeleid (retention) per tenant — GDPR/Belgisch conform.
 *
 * Onderscheid (belangrijk, juridisch):
 *  - DISASTER-RECOVERY BACKUPS (dit bestand) = operationele herstelmomenten.
 *    GDPR art. 5(1)(e) "opslagbeperking": niet langer bewaren dan nodig. Een
 *    DR-venster van enkele weken tot maanden is gebruikelijk; oneindig bewaren
 *    mag niet. Daarom: configureerbare bewaartermijn met onder-/bovengrens.
 *  - WETTELIJKE ARCHIVERING van de onderliggende records (facturen 7 jaar,
 *    sociale/loon- en arbeidstijddocumenten 5 jaar) is een APARTE verplichting
 *    die op de live-data rust, niet op de DR-backups. Die termijnen tonen we
 *    informatief zodat de beheerder een bewuste keuze maakt.
 *
 * Veiligheidsprincipes:
 *  - `keepMinimum`: behoud altijd de N nieuwste backups, ook al zijn ze ouder
 *    dan de bewaartermijn → er is altijd een herstelpunt.
 *  - `legalHold`: zet alle opruiming stil (bv. tijdens geschil/audit/DPA-verzoek).
 *  - Pure functies: geen I/O, volledig testbaar.
 */

const DAY = 86400000;

// Grenzen aan het DR-bewaarvenster (in dagen).
const MIN_RETENTION_DAYS = 7;     // korter dan een week is geen bruikbaar DR-venster
const MAX_RETENTION_DAYS = 3650;  // 10 jaar absolute bovengrens
const DEFAULT_RETENTION_DAYS = 90;
const RETENTION_PRESETS = [30, 60, 90, 180, 365, 730, 2555]; // 2555 = ~7 jaar
const FREQUENCIES = ["daily", "weekly"];
const DEFAULT_KEEP_MINIMUM = 3;
const MAX_KEEP_MINIMUM = 30;

// Belgische wettelijke bewaartermijnen van de RECORDS (informatief, in dagen).
const LEGAL_RETENTION = [
  { key: "accounting", label: "Boekhouding & facturen", days: 2555, note: "7 jaar (W.Venn./WIB 92, art. 315)" },
  { key: "social", label: "Sociale & loondocumenten", days: 1825, note: "5 jaar (RSZ/sociale wetgeving)" },
  { key: "worktime", label: "Arbeidstijd & aanwezigheid (Dimona/CIAW)", days: 1825, note: "5 jaar" },
  { key: "personnel", label: "Personeelsdossier (na uitdiensttreding)", days: 1825, note: "tot 5 jaar afh. van stuk" },
];

const DEFAULTS = Object.freeze({
  retentionDays: DEFAULT_RETENTION_DAYS,
  frequency: "daily",
  keepMinimum: DEFAULT_KEEP_MINIMUM,
  legalHold: false,
});

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Maak een geldig beleid van ruwe (gebruikers)invoer. Onbekende velden vallen
 * terug op de defaults; getallen worden geklemd binnen de toegestane grenzen.
 */
function normalizePolicy(raw) {
  const r = raw || {};
  const policy = {
    retentionDays: clampInt(r.retentionDays, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS, DEFAULT_RETENTION_DAYS),
    frequency: FREQUENCIES.includes(r.frequency) ? r.frequency : DEFAULTS.frequency,
    keepMinimum: clampInt(r.keepMinimum, 1, MAX_KEEP_MINIMUM, DEFAULT_KEEP_MINIMUM),
    legalHold: r.legalHold === true,
  };
  if (r.updatedAt) policy.updatedAt = r.updatedAt;
  if (r.updatedBy) policy.updatedBy = r.updatedBy;
  return policy;
}

/** Het effectieve beleid voor een tenant (opgeslagen beleid over de defaults heen). */
function resolvePolicy(tenant) {
  return normalizePolicy((tenant && tenant.backupPolicy) || {});
}

/**
 * Verdeel een (op datum gesorteerde, nieuwste eerst) lijst backups in te
 * behouden en op te ruimen. Een backup wordt enkel opgeruimd als:
 *   - hij ouder is dan retentionDays, EN
 *   - hij niet bij de `keepMinimum` nieuwste hoort, EN
 *   - er geen legalHold actief is.
 * `backups` items moeten {id, createdAt} hebben.
 */
function classifyBackups(backups, policy, now = Date.now()) {
  const p = normalizePolicy(policy);
  const sorted = [...(backups || [])].sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const cutoff = now - p.retentionDays * DAY;
  const keep = [];
  const prune = [];
  sorted.forEach((b, idx) => {
    const ts = b.createdAt ? new Date(b.createdAt).getTime() : NaN;
    const tooOld = Number.isFinite(ts) && ts < cutoff;
    const withinKeepMin = idx < p.keepMinimum;
    if (p.legalHold || withinKeepMin || !tooOld) keep.push(b);
    else prune.push(b);
  });
  return { keep, prune, policy: p };
}

/** Compacte samenvatting voor API/UI. */
function policySummary(tenant, backups, now = Date.now()) {
  const { keep, prune, policy } = classifyBackups(backups, resolvePolicy(tenant), now);
  const sorted = [...(backups || [])].sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const latest = sorted[0] || null;
  const oldestKept = keep.length ? keep[keep.length - 1] : null;
  return {
    policy,
    presets: RETENTION_PRESETS,
    limits: { min: MIN_RETENTION_DAYS, max: MAX_RETENTION_DAYS, maxKeepMinimum: MAX_KEEP_MINIMUM },
    frequencies: FREQUENCIES,
    legalReference: LEGAL_RETENTION,
    counts: { total: sorted.length, toKeep: keep.length, toPrune: prune.length },
    latestBackupAt: latest ? latest.createdAt : null,
    oldestKeptAt: oldestKept ? oldestKept.createdAt : null,
    prunableIds: prune.map(b => b.id),
  };
}

module.exports = {
  DAY,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  DEFAULT_RETENTION_DAYS,
  RETENTION_PRESETS,
  FREQUENCIES,
  DEFAULT_KEEP_MINIMUM,
  LEGAL_RETENTION,
  DEFAULTS,
  normalizePolicy,
  resolvePolicy,
  classifyBackups,
  policySummary,
};
