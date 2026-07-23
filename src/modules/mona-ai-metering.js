"use strict";

// ── Mona AI metering, credits, limieten en waarschuwingen (INT-07/08/09) ─────
// Store-gebonden service bovenop de pure usage-ledger (src/platform/usage-ledger.js).
// Materialiseert het creditmodel (spec 8.3), de tenantlimieten (9.1) en de
// 95%-waarschuwingen (9.2/9.3) op de platform-store.
//
// NIET-ONDERHANDELBARE PRODUCTREGEL (spec 8):
//   Alle Mona AI-monitoring - credits, verbruik, providerkosten, globale pool,
//   tenantlimieten, prognoses en topgebruikers - is UITSLUITEND zichtbaar in het
//   Super Admin-portaal. Deze module levert GEEN enkele functie die usage,
//   credits, kosten of limieten aan een TENANTROL teruggeeft. De enige uitvoer
//   richting een tenantgebruiker is de functionele blokkade-melding
//   (tenantBlockNotice) · nooit een cijfer, saldo, kost of limiet.
//
// Isolatie-afspraken:
//  - De Mona control-plane-collecties (aiProviderUsage, tenantUsageLimits,
//    tenantCreditAllocations, platformUsageBudgets, usageAlertRules, usageAlerts,
//    usageAdjustments) dragen tenantId:null + subjectTenantId, zodat
//    store.list(collectie, tenantId) ze NOOIT aan een tenant lekt. Enkel
//    store.list(collectie, null) (platformscope) geeft ze terug.
//  - De AI-usage-events leven in de GEDEELDE immutable ledger (usageEvents,
//    usageType "ai.usage") met de echte tenantId (verplicht door het
//    ledger-contract + per-tenant rapportering). De tenant-Peppolweergave MOET
//    daarom filteren op isPeppolUsage (verantwoordelijkheid van de Peppol-stap):
//    er bestaat geen tenant-route die ai.usage-events teruggeeft.
//  - provider_unit_cost en providerkost staan enkel in Super Admin-data · nooit
//    in een audit-detail, nooit in een tenant-uitvoer.

const crypto = require("crypto");
const L = require("../platform/usage-ledger");

// De verplichte functionele boodschap bij blokkering (spec 8.2). Geen em-dash.
const MONA_UNAVAILABLE_MESSAGE =
  "Mona AI is momenteel niet beschikbaar voor jouw organisatie. De overige functies van Monargo blijven beschikbaar.";

const AI_USAGE_TYPE = "ai.usage";
// Soorten adjustment (8.3 / D16): extra credits, correctie of compensatie.
const ADJUSTMENT_KINDS = ["grant", "correction", "compensation"];
const ALERT_LEVELS = ["tenant", "platform"];
const SIZE_CLASSES = ["small", "medium", "large"];
const DEFAULT_ALERT_THRESHOLD_PCT = 95;   // spec 9.2 · de verplichte drempel
const WARN_THRESHOLD_PCT = 80;            // KPI "tenants boven 80%"
const REMINDER_AFTER_MS = 24 * 60 * 60 * 1000; // herinnering na 24u (9.2)
// Standaard grootteklasse-grenzen op totaal aantal tokens (override mogelijk).
const DEFAULT_SIZE_THRESHOLDS = { small: 2000, medium: 20000 };

const round2 = L.round2;
function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
function id(prefix) { return `${prefix}_${crypto.randomBytes(9).toString("hex")}`; }
function nowIso() { return new Date().toISOString(); }
function clean(v) { return String(v == null ? "" : v).trim(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function isPeriod(p) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p || "")); }
function periodOf(iso) { return String(iso || nowIso()).slice(0, 7); }
function dayOf(iso) { return String(iso || "").slice(0, 10); }
function actorEmail(actor) { return (actor && (actor.email || actor.id)) || "system"; }
function isExpired(row, now) {
  if (!row || !row.expiresAt) return false;
  const e = Date.parse(row.expiresAt), t = Date.parse(now);
  return !Number.isNaN(e) && !Number.isNaN(t) && e < t;
}

// ── Tenant-grens: de ENIGE uitvoer richting een tenantgebruiker ──────────────
// Bevat uitsluitend de functionele boodschap · nooit een cijfer, saldo of limiet.
function tenantBlockNotice() { return { available: false, message: MONA_UNAVAILABLE_MESSAGE }; }

// ── 1. Creditmodel (spec 8.3) ────────────────────────────────────────────────

/** Bepaal de grootteklasse uit de providerunits (of neem een expliciete klasse). */
function resolveSizeClass(providerUnits = {}, thresholds = DEFAULT_SIZE_THRESHOLDS) {
  if (providerUnits.sizeClass && SIZE_CLASSES.includes(providerUnits.sizeClass)) return providerUnits.sizeClass;
  const tokens = num(providerUnits.inputTokens) + num(providerUnits.outputTokens);
  if (tokens < num(thresholds.small)) return "small";
  if (tokens < num(thresholds.medium)) return "medium";
  return "large";
}

/**
 * Kies de meest specifieke actieve credit-rate voor (feature, model, grootteklasse).
 * Een regel zonder model/grootteklasse geldt als wildcard; een regel die een
 * ANDER model/klasse noemt sluit zichzelf uit. Meest specifieke match wint.
 */
function resolveCreditRate(rates, { feature, model = null, sizeClass = null } = {}) {
  const cands = (rates || []).filter(r => r && r.feature === feature && r.active !== false);
  let best = null, bestScore = -1;
  for (const r of cands) {
    let score = 0;
    if (r.model) { if (r.model !== model) continue; score += 2; }
    if (r.sizeClass) { if (r.sizeClass !== sizeClass) continue; score += 1; }
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

/**
 * Zet providerunits om naar Monargo Credits via de rate. Retourneert de credits,
 * de gekozen grootteklasse, de toegepaste regel en of er een regel gevonden is.
 * Zonder passende regel: 0 credits met resolved:false (metering blijft mogelijk,
 * de config-leemte is zichtbaar voor Super Admin).
 */
function computeCredits(rates, { feature, model = null, sizeClass = null, providerUnits = {} } = {}) {
  const cls = sizeClass || resolveSizeClass(providerUnits);
  const rate = resolveCreditRate(rates, { feature, model, sizeClass: cls });
  return { credits: round2(rate ? num(rate.credits) : 0), sizeClass: cls, rate: rate || null, resolved: !!rate };
}

/** Interne providerkost (euro) van een request · UITSLUITEND Super Admin-data. */
function providerCostOf(providerUnits = {}) { return round2(num(providerUnits.providerCost)); }

// ── 2. Store-lezers (platformscope) ──────────────────────────────────────────

function aiEventsOf(store, { tenantId = null, period = null } = {}) {
  return (store.data.usageEvents || []).filter(e =>
    e && e.usageType === AI_USAGE_TYPE
    && (!tenantId || e.tenantId === tenantId)
    && (!period || e.period === period));
}

/** Tenantlimieten (of veilige defaults). Super Admin-data. */
function getTenantLimits(store, tenantId) {
  const row = (store.data.tenantUsageLimits || []).find(l => l && l.subjectTenantId === tenantId);
  return row || {
    subjectTenantId: tenantId, aiDisabled: false, unlimited: false,
    monthlyCreditLimit: null, softLimit: null, hardLimit: null,
    maxPerUser: null, maxPerDay: null,
    allowedFeatures: null, allowedModels: null, tempBundleExpiry: null,
  };
}

function topBy(events, key, limit = 5) {
  const m = new Map();
  for (const e of events || []) {
    const k = e[key] == null ? "-" : e[key];
    m.set(k, round2((m.get(k) || 0) + num(e.credits)));
  }
  return [...m.entries()]
    .map(([k, credits]) => ({ [key]: k, credits }))
    .sort((a, b) => b.credits - a.credits)
    .slice(0, limit);
}

/**
 * Prognose (9.3): gemiddeld dagverbruik en geschatte uitputtingsdatum. Pure
 * rekenlaag · gebaseerd op verbruik sinds periodestart tot 'now'.
 */
function forecast({ consumed, remaining, period, now }) {
  const start = Date.parse(`${period}-01T00:00:00.000Z`);
  const t = Date.parse(now || nowIso());
  let daysElapsed = 1;
  if (!Number.isNaN(start) && !Number.isNaN(t)) daysElapsed = Math.max(1, Math.ceil((t - start) / (24 * 3600 * 1000)));
  const averageDailyUsage = round2(num(consumed) / daysElapsed);
  let estimatedExhaustionDate = null;
  if (averageDailyUsage > 0 && num(remaining) > 0) {
    estimatedExhaustionDate = new Date(t + (num(remaining) / averageDailyUsage) * 24 * 3600 * 1000).toISOString();
  }
  return { averageDailyUsage, daysElapsed, estimatedExhaustionDate };
}

/** Het effectieve AI-plafond voor blokkering en alerting (credits). */
function effectiveCeiling(limits, balance) {
  if (!limits || limits.unlimited) return Infinity;
  if (limits.aiDisabled) return 0;
  if (limits.hardLimit != null) return num(limits.hardLimit);
  // Geen expliciete hard limit: het toegekende krediet is het plafond, maar
  // zonder enige toekenning geldt metering-only (niet blokkeren).
  if (num(balance.granted) > 0 || num(balance.adjustments) !== 0) return num(balance.available);
  return Infinity;
}

/**
 * Kredietsaldo van een tenant voor een periode (SUPER ADMIN-only view). Bevat
 * verbruik, prognose en topgebruik · mag nooit aan een tenantrol worden getoond.
 * balance = toegekende credits (niet-verlopen allocaties) + adjustments; consumed
 * = som van de credits op de ai.usage-events; remaining = balance - consumed.
 */
function creditBalance(store, tenantId, period, opts = {}) {
  const now = opts.now || nowIso();
  const allocs = (store.data.tenantCreditAllocations || []).filter(a =>
    a && a.subjectTenantId === tenantId && a.period === period && !isExpired(a, now));
  const granted = round2(allocs.reduce((s, a) => s + num(a.creditsGranted), 0));
  const adjustments = round2((store.data.usageAdjustments || [])
    .filter(a => a && a.subjectTenantId === tenantId && a.period === period && a.usageType === AI_USAGE_TYPE)
    .reduce((s, a) => s + num(a.amount), 0));
  const events = aiEventsOf(store, { tenantId, period });
  const consumed = round2(events.reduce((s, e) => s + num(e.credits), 0));
  const available = round2(granted + adjustments);
  const remaining = round2(available - consumed);
  const limits = getTenantLimits(store, tenantId);
  const ceiling = effectiveCeiling(limits, { granted, adjustments, available });
  const pct = Number.isFinite(ceiling) && ceiling > 0 ? round2((consumed / ceiling) * 100) : null;
  return {
    tenantId, period, granted, adjustments, available, consumed, remaining,
    ceiling: Number.isFinite(ceiling) ? ceiling : null, pct,
    topFeatures: topBy(events, "feature"),
    topUsers: topBy(events, "userId"),
    forecast: forecast({ consumed, remaining, period, now }),
  };
}

// ── 3. Super Admin-configuratiemutaties ──────────────────────────────────────
// Alle mutaties zijn platformacties (tenantId:null in de audit). De HTTP-laag
// dwingt de platformscope af (platform.ai.*); reseller heeft geen toegang.

const LIMIT_FIELDS = ["aiDisabled", "unlimited", "monthlyCreditLimit", "softLimit", "hardLimit",
  "maxPerUser", "maxPerDay", "allowedFeatures", "allowedModels", "tempBundleExpiry"];

/** Stel de tenantlimieten in (platform.ai.tenant_limit.manage / global_limit). */
function setTenantLimits(store, tenantId, patch = {}, actor) {
  if (!clean(tenantId)) throw err(400, "AI_TENANT_REQUIRED", "tenantId is verplicht");
  const existing = (store.data.tenantUsageLimits || []).find(l => l && l.subjectTenantId === tenantId);
  const changes = {};
  for (const k of LIMIT_FIELDS) if (k in patch) changes[k] = patch[k];
  const merged = { ...(existing || {}), ...changes };
  if (merged.hardLimit != null && merged.softLimit != null && num(merged.hardLimit) < num(merged.softLimit)) {
    throw err(400, "AI_LIMIT_ORDER", "hard limit mag niet lager zijn dan soft limit");
  }
  let row;
  if (existing) {
    row = store.update("tenantUsageLimits", existing.id, { ...changes, updatedAt: nowIso(), updatedBy: actorEmail(actor) });
  } else {
    row = {
      id: id("tul"), tenantId: null, subjectTenantId: tenantId,
      aiDisabled: false, unlimited: false, monthlyCreditLimit: null, softLimit: null, hardLimit: null,
      maxPerUser: null, maxPerDay: null, allowedFeatures: null, allowedModels: null, tempBundleExpiry: null,
      ...changes, createdAt: nowIso(), createdBy: actorEmail(actor),
    };
    store.insert("tenantUsageLimits", row);
  }
  store.audit({ actor: actorEmail(actor), tenantId: null, area: "ai", action: "ai_tenant_limit_set",
    detail: `${tenantId} ${JSON.stringify(changes)}` });
  return row;
}

/** Ken credits toe aan een tenant voor een periode (platform.ai.credits.manage). */
function grantAllocation(store, { tenantId, period, creditsGranted, expiresAt = null, reason = null } = {}, actor) {
  if (!clean(tenantId)) throw err(400, "AI_TENANT_REQUIRED", "tenantId is verplicht");
  if (!isPeriod(period)) throw err(400, "AI_PERIOD_INVALID", "period moet YYYY-MM zijn");
  if (!Number.isFinite(Number(creditsGranted)) || Number(creditsGranted) < 0) throw err(400, "AI_CREDITS_INVALID", "creditsGranted moet groter of gelijk aan 0 zijn");
  const row = {
    id: id("tca"), tenantId: null, subjectTenantId: tenantId, period,
    creditsGranted: round2(creditsGranted), expiresAt: expiresAt || null, reason: clean(reason) || null,
    createdAt: nowIso(), createdBy: actorEmail(actor),
  };
  store.insert("tenantCreditAllocations", row);
  store.audit({ actor: actorEmail(actor), tenantId: null, area: "ai", action: "ai_credits_allocated",
    detail: `${tenantId} ${period} +${row.creditsGranted}c${expiresAt ? " temp" : ""}` });
  return row;
}

/**
 * Boek een credit-adjustment (D16): extra credits, correctie of compensatie met
 * reden. Wijzigt het SALDO zonder de usage-historiek te herschrijven · het is een
 * apart record, geen mutatie van een usage-event. Bedrag mag negatief zijn.
 */
function addAdjustment(store, { tenantId, period, amount, kind = "grant", reason, correctsEventId = null } = {}, actor) {
  if (!clean(tenantId)) throw err(400, "AI_TENANT_REQUIRED", "tenantId is verplicht");
  if (!isPeriod(period)) throw err(400, "AI_PERIOD_INVALID", "period moet YYYY-MM zijn");
  if (!ADJUSTMENT_KINDS.includes(kind)) throw err(400, "AI_ADJUSTMENT_KIND", `onbekend adjustment-type ${kind}`);
  if (!Number.isFinite(Number(amount)) || Number(amount) === 0) throw err(400, "AI_ADJUSTMENT_AMOUNT", "amount moet een getal ongelijk aan 0 zijn");
  if (!clean(reason)) throw err(400, "AI_ADJUSTMENT_REASON", "een adjustment vereist een reden");
  const row = {
    id: id("uadj"), tenantId: null, subjectTenantId: tenantId, usageType: AI_USAGE_TYPE, period,
    amount: round2(amount), kind, reason: clean(reason), correctsEventId: correctsEventId || null,
    createdAt: nowIso(), createdBy: actorEmail(actor),
  };
  store.insert("usageAdjustments", row);
  store.audit({ actor: actorEmail(actor), tenantId: null, area: "ai", action: "ai_credit_adjustment",
    detail: `${tenantId} ${period} ${row.amount}c (${kind})` });
  return row;
}

/** Stel de globale AI-pool/budgetgrens in (platform.ai.global_limit.manage). */
function setPlatformBudget(store, { period, budget, basis = "credits", thresholdPct = DEFAULT_ALERT_THRESHOLD_PCT } = {}, actor) {
  if (!isPeriod(period)) throw err(400, "AI_PERIOD_INVALID", "period moet YYYY-MM zijn");
  if (!["credits", "cost"].includes(basis)) throw err(400, "AI_BUDGET_BASIS", "basis moet credits of cost zijn");
  if (!Number.isFinite(Number(budget)) || Number(budget) <= 0) throw err(400, "AI_BUDGET_INVALID", "budget moet groter dan 0 zijn");
  const fields = { period, budget: round2(budget), basis, thresholdPct: num(thresholdPct) || DEFAULT_ALERT_THRESHOLD_PCT };
  const existing = (store.data.platformUsageBudgets || []).find(b => b && b.period === period);
  let row;
  if (existing) row = store.update("platformUsageBudgets", existing.id, { ...fields, updatedAt: nowIso(), updatedBy: actorEmail(actor) });
  else { row = { id: id("pub"), tenantId: null, ...fields, createdAt: nowIso(), createdBy: actorEmail(actor) }; store.insert("platformUsageBudgets", row); }
  store.audit({ actor: actorEmail(actor), tenantId: null, area: "ai", action: "ai_platform_budget_set", detail: `${period} ${row.budget} (${basis})` });
  return row;
}

// ── 4. Metering (INT-07) ─────────────────────────────────────────────────────

/**
 * Meet één AI-request: zet providerunits om naar credits, boek de ruwe
 * providermeter (Super Admin-only) en een IMMUTABLE credit-usage-event in de
 * gedeelde ledger, en trek daarmee van het tenantsaldo af. IDEMPOTENT op
 * requestId: een retry maakt geen nieuw event en dubbel verbruik.
 */
function meterRequest(store, { tenantId, feature, model = null, providerUnits = {}, requestId, userId = null, sizeClass = null, at = null } = {}, actor) {
  if (!clean(tenantId)) throw err(400, "AI_TENANT_REQUIRED", "tenantId is verplicht");
  if (!clean(feature)) throw err(400, "AI_FEATURE_REQUIRED", "feature is verplicht");
  if (!clean(requestId)) throw err(400, "AI_REQUEST_REQUIRED", "requestId is verplicht");
  const idemKey = `ai:${clean(requestId)}`;
  const existing = (store.data.usageEvents || []).find(e => e && e.idempotencyKey === idemKey);
  if (existing) {
    const pu = (store.data.aiProviderUsage || []).find(p => p && p.requestId === clean(requestId)) || null;
    return { event: existing, providerUsage: pu, credits: existing.credits, duplicate: true };
  }
  const now = at || nowIso();
  const period = periodOf(now);
  const cc = computeCredits(store.data.aiFeatureCreditRates || [], { feature, model, sizeClass, providerUnits });
  const providerCost = providerCostOf(providerUnits);

  // 1. Ruwe providermeter (ai_provider_usage) · tenantId:null + subjectTenantId.
  const providerUsage = {
    id: id("aipu"), tenantId: null, subjectTenantId: tenantId,
    requestId: clean(requestId), feature, model: model || null, period,
    inputTokens: num(providerUnits.inputTokens), outputTokens: num(providerUnits.outputTokens),
    images: num(providerUnits.images), docPages: num(providerUnits.docPages),
    providerCost: round2(providerCost), sizeClass: cc.sizeClass,
    createdAt: now, createdBy: actorEmail(actor),
  };
  store.insert("aiProviderUsage", providerUsage);

  // 2. Immutable credit-usage-event in de gedeelde ledger (usageEvents, ai.usage).
  const event = {
    id: id("uev"), usageType: AI_USAGE_TYPE, tenantId, companyId: null,
    documentId: clean(requestId), providerReference: providerUsage.id,
    billableAt: now, quantity: 1,
    customerUnitPrice: null,                // AI is credit-gedenomineerd, geen euro-per-event
    providerUnitCost: round2(providerCost), // Super Admin-only
    pricingRuleId: null, costRuleId: null,
    idempotencyKey: idemKey, billingPeriodId: null, correctionOf: null,
    feature, model: model || null, sizeClass: cc.sizeClass,
    credits: round2(cc.credits), rateResolved: cc.resolved,
    requestId: clean(requestId), userId, period,
    createdAt: now, createdBy: actorEmail(actor),
  };
  L.validateUsageEvent(event); // hergebruik het ledger-contract
  store.insert("usageEvents", event);
  // Geen providerkost in de audit-detail (Super Admin-only, nooit in logs).
  store.audit({ actor: actorEmail(actor), tenantId: null, area: "ai", action: "ai_usage_metered",
    detail: `${tenantId} ${feature} ${event.credits}c req=${clean(requestId)}` });
  return { event, providerUsage, credits: event.credits, duplicate: false };
}

// ── 5. Toegangscontrole / hard block (spec 9.1) ──────────────────────────────

/**
 * Mag deze AI-request door? Retourneert {allowed, scope:"ai", reason, message?}.
 * Een blokkering raakt UITSLUITEND AI (scope "ai") · nooit de rest van Monargo.
 * Het antwoord bevat GEEN usage-, credit- of limietcijfers: 'reason' is een code
 * voor Super Admin-logging, 'message' is de functionele tenantboodschap. De
 * runtime toont de tenant enkel 'message'.
 */
function checkAllowed(store, { tenantId, feature = null, model = null, userId = null, at = null } = {}) {
  if (!clean(tenantId)) throw err(400, "AI_TENANT_REQUIRED", "tenantId is verplicht");
  const now = at || nowIso();
  const period = periodOf(now);
  const limits = getTenantLimits(store, tenantId);
  const deny = reason => ({ allowed: false, scope: "ai", reason, message: MONA_UNAVAILABLE_MESSAGE });

  if (limits.aiDisabled) return deny("ai_disabled");
  if (Array.isArray(limits.allowedFeatures) && limits.allowedFeatures.length && !limits.allowedFeatures.includes(feature)) return deny("feature_not_allowed");
  if (Array.isArray(limits.allowedModels) && limits.allowedModels.length && !limits.allowedModels.includes(model)) return deny("model_not_allowed");
  if (limits.unlimited) return { allowed: true, scope: "ai", reason: null };

  const balance = creditBalance(store, tenantId, period, { now });
  const ceiling = effectiveCeiling(limits, balance);
  // Hard limit: nieuwe requests blokkeren zodra het plafond bereikt is (9.1).
  if (Number.isFinite(ceiling) && balance.consumed >= ceiling) return deny("hard_limit_reached");

  // Optionele veiligheidsgrenzen per dag en per gebruiker (credits).
  if (limits.maxPerDay != null) {
    const day = dayOf(now);
    const usedToday = round2(aiEventsOf(store, { tenantId, period })
      .filter(e => dayOf(e.billableAt) === day).reduce((s, e) => s + num(e.credits), 0));
    if (usedToday >= num(limits.maxPerDay)) return deny("daily_limit_reached");
  }
  if (limits.maxPerUser != null && userId != null) {
    const usedByUser = round2(aiEventsOf(store, { tenantId, period })
      .filter(e => e.userId === userId).reduce((s, e) => s + num(e.credits), 0));
    if (usedByUser >= num(limits.maxPerUser)) return deny("user_limit_reached");
  }
  // Soft limit blokkeert NIET · requests blijven werken (9.1). Enkel signaal.
  return { allowed: true, scope: "ai", reason: null };
}

// ── 6. Platformbudget-status (Super Admin) ───────────────────────────────────

function platformBudgetStatus(store, { period, now = null } = {}) {
  if (!isPeriod(period)) throw err(400, "AI_PERIOD_INVALID", "period moet YYYY-MM zijn");
  const when = now || nowIso();
  const budgetRow = (store.data.platformUsageBudgets || []).find(b => b && b.period === period) || null;
  const basis = budgetRow ? budgetRow.basis : "credits";
  const events = aiEventsOf(store, { period });
  const consumed = round2(events.reduce((s, e) => s + (basis === "cost" ? num(e.providerUnitCost) : num(e.credits)), 0));
  const budget = budgetRow ? num(budgetRow.budget) : null;
  const remaining = budget != null ? round2(budget - consumed) : null;
  const pct = budget && budget > 0 ? round2((consumed / budget) * 100) : null;
  return {
    period, basis, budget, consumed, remaining, pct,
    thresholdPct: budgetRow ? budgetRow.thresholdPct : DEFAULT_ALERT_THRESHOLD_PCT,
    topTenants: topBy(events, "tenantId"),
    topFeatures: topBy(events, "feature"),
    forecast: forecast({ consumed, remaining: remaining == null ? 0 : remaining, period, now: when }),
  };
}

/** Overzicht per tenant voor de Super Admin (GET /admin/ai/tenants). */
function adminTenantUsage(store, { period } = {}) {
  if (!isPeriod(period)) throw err(400, "AI_PERIOD_INVALID", "period moet YYYY-MM zijn");
  const ids = new Set([
    ...(store.data.tenantUsageLimits || []).map(l => l && l.subjectTenantId),
    ...(store.data.tenantCreditAllocations || []).filter(a => a && a.period === period).map(a => a.subjectTenantId),
    ...aiEventsOf(store, { period }).map(e => e.tenantId),
  ].filter(Boolean));
  return [...ids].map(tid => ({ tenantId: tid, limits: getTenantLimits(store, tid), balance: creditBalance(store, tid, period) }));
}

/** Tenants op of boven een percentage van hun plafond (KPI 80% / 95%). */
function tenantsAtOrAbove(store, period, pct) {
  return adminTenantUsage(store, { period }).filter(r => r.balance.pct != null && r.balance.pct >= pct).map(r => r.tenantId);
}

/** Volledige Super Admin-event-view (credits en providerkost blijven zichtbaar). */
function superAdminAiEventView(ev) { return ev ? { ...ev } : ev; }

// ── 7. 95%-waarschuwing: bepaling, dedup, herinnering (spec 9.2/9.3) ──────────

function activeAlertRules(store, level) {
  return (store.data.usageAlertRules || []).filter(r => r && r.active !== false && (!r.level || r.level === level || r.level === "all"));
}
function resolveRecipients(store, level) {
  const set = new Set();
  for (const r of activeAlertRules(store, level)) for (const rec of (r.recipients || [])) if (clean(rec)) set.add(clean(rec));
  return [...set];
}
function thresholdsFor(store, level) {
  const pcts = activeAlertRules(store, level).map(r => num(r.thresholdPct)).filter(p => p > 0);
  return [...new Set(pcts.length ? pcts : [DEFAULT_ALERT_THRESHOLD_PCT])].sort((a, b) => a - b);
}
function dueForReminder(alert, now) {
  const last = Date.parse(alert.reminderAt || alert.createdAt), t = Date.parse(now);
  if (Number.isNaN(last) || Number.isNaN(t)) return false;
  return (t - last) >= REMINDER_AFTER_MS;
}
// Dedup-identiteit: één alert per (niveau, subject, drempel, LIMIET) per periode.
// Door de limiet in de sleutel te nemen ontstaat opnieuw een alert wanneer de
// limiet wordt verhoogd en de nieuwe 95% opnieuw wordt bereikt (9.2).
function matchAlert(a, { level, subjectTenantId, period, thresholdPct, limit }) {
  return a && a.level === level && (a.subjectTenantId || null) === (subjectTenantId || null)
    && a.period === period && a.thresholdPct === thresholdPct && num(a.limit) === num(limit);
}

/** Verplichte e-mailvelden voor een tenant-alert (9.3). */
function buildTenantAlertEmail(store, { tenantId, period, ceiling, balance, pct, thresholdPct, baseUrl }) {
  const tenant = (store.data.tenants || []).find(t => t && t.id === tenantId);
  const recipients = resolveRecipients(store, "tenant");
  return {
    level: "tenant",
    subject: `Mona AI ${thresholdPct}% drempel bereikt · ${(tenant && tenant.name) || tenantId} (${period})`,
    tenantId, tenantName: (tenant && tenant.name) || tenantId,
    period, limit: ceiling, used: balance.consumed, remaining: balance.remaining, percentage: pct,
    averageDailyUsage: balance.forecast.averageDailyUsage,
    estimatedExhaustionDate: balance.forecast.estimatedExhaustionDate,
    topFeatures: balance.topFeatures, topUsers: balance.topUsers,
    secureLink: `${clean(baseUrl)}/admin/usage/mona?tenant=${encodeURIComponent(tenantId)}&period=${encodeURIComponent(period)}`,
    recipients, recipientsConfigured: recipients.length > 0,
    channel: ["email", "in_app"],
  };
}

/** Verplichte e-mailvelden voor een platform-alert (9.3) met topverbruikers. */
function buildPlatformAlertEmail(store, { period, status, pct, thresholdPct, baseUrl }) {
  const recipients = resolveRecipients(store, "platform");
  return {
    level: "platform",
    subject: `Mona AI platformbudget ${thresholdPct}% bereikt (${period})`,
    tenantId: null, tenantName: null,
    period, limit: status.budget, used: status.consumed, remaining: status.remaining, percentage: pct,
    averageDailyUsage: status.forecast.averageDailyUsage,
    estimatedExhaustionDate: status.forecast.estimatedExhaustionDate,
    topTenants: status.topTenants, topFeatures: status.topFeatures,
    secureLink: `${clean(baseUrl)}/admin/usage/mona?period=${encodeURIComponent(period)}`,
    recipients, recipientsConfigured: recipients.length > 0,
    channel: ["email", "in_app"],
  };
}

/**
 * ZUIVERE bepaling: welke nieuwe waarschuwingen en welke herinneringen zijn nodig
 * voor een periode. Leest de store maar SCHRIJFT niet. De integratiestap verstuurt
 * de e-mails via de bestaande mailer en persisteert via raiseAlerts/recordAlert.
 */
function detectAlerts(store, { period, now = null, baseUrl = "" } = {}) {
  if (!isPeriod(period)) throw err(400, "AI_PERIOD_INVALID", "period moet YYYY-MM zijn");
  const when = now || nowIso();
  const existing = (store.data.usageAlerts || []).filter(a => a && a.period === period);
  const newAlerts = [];
  const reminders = [];

  // Tenant-niveau: 95% van de actieve hard limit (plafond).
  const tenantIds = new Set([
    ...(store.data.tenantUsageLimits || []).map(l => l && l.subjectTenantId),
    ...aiEventsOf(store, { period }).map(e => e.tenantId),
  ].filter(Boolean));
  const tThresholds = thresholdsFor(store, "tenant");
  for (const tid of tenantIds) {
    const limits = getTenantLimits(store, tid);
    if (limits.unlimited || limits.aiDisabled) continue;
    const balance = creditBalance(store, tid, period, { now: when });
    const ceiling = effectiveCeiling(limits, balance);
    if (!Number.isFinite(ceiling) || ceiling <= 0) continue;
    const pct = round2((balance.consumed / ceiling) * 100);
    for (const thr of tThresholds) {
      if (pct < thr) continue;
      const key = { level: "tenant", subjectTenantId: tid, period, thresholdPct: thr, limit: ceiling };
      const ex = existing.find(a => matchAlert(a, key));
      const email = buildTenantAlertEmail(store, { tenantId: tid, period, ceiling, balance, pct, thresholdPct: thr, baseUrl });
      if (!ex) newAlerts.push({ ...key, used: balance.consumed, remaining: balance.remaining, pct, email, recipients: resolveRecipients(store, "tenant") });
      else if (!ex.acknowledgedAt && dueForReminder(ex, when)) reminders.push({ alertId: ex.id, level: "tenant", email, recipients: resolveRecipients(store, "tenant") });
    }
  }

  // Platform-niveau: 95% van het globale budget.
  const budgetRow = (store.data.platformUsageBudgets || []).find(b => b && b.period === period);
  if (budgetRow) {
    const status = platformBudgetStatus(store, { period, now: when });
    for (const thr of thresholdsFor(store, "platform")) {
      if (status.pct == null || status.pct < thr) continue;
      const key = { level: "platform", subjectTenantId: null, period, thresholdPct: thr, limit: status.budget };
      const ex = existing.find(a => matchAlert(a, key));
      const email = buildPlatformAlertEmail(store, { period, status, pct: status.pct, thresholdPct: thr, baseUrl });
      if (!ex) newAlerts.push({ ...key, used: status.consumed, remaining: status.remaining, pct: status.pct, email, recipients: resolveRecipients(store, "platform") });
      else if (!ex.acknowledgedAt && dueForReminder(ex, when)) reminders.push({ alertId: ex.id, level: "platform", email, recipients: resolveRecipients(store, "platform") });
    }
  }
  return { newAlerts, reminders };
}

/** Persisteer één gedetecteerde alert (dedup-veilig). */
function recordAlert(store, payload, actor) {
  const ex = (store.data.usageAlerts || []).find(a => matchAlert(a, payload));
  if (ex) return { created: false, alert: ex };
  const row = {
    id: id("alt"), tenantId: null, subjectTenantId: payload.subjectTenantId || null,
    level: payload.level, period: payload.period, thresholdPct: payload.thresholdPct,
    limit: round2(payload.limit), used: round2(payload.used), remaining: round2(payload.remaining), pct: round2(payload.pct),
    channel: (payload.email && payload.email.channel) || ["email", "in_app"],
    recipients: payload.recipients || [], email: payload.email || null,
    acknowledgedAt: null, acknowledgedBy: null, reminderAt: null,
    createdAt: nowIso(), createdBy: actorEmail(actor),
  };
  store.insert("usageAlerts", row);
  store.audit({ actor: actorEmail(actor), tenantId: null, area: "ai", action: "ai_alert_raised",
    detail: `${payload.level} ${payload.subjectTenantId || "platform"} ${payload.period} ${payload.thresholdPct}% (limit ${round2(payload.limit)})` });
  return { created: true, alert: row };
}

/** Bevestig (acknowledge) een waarschuwing · stopt de 24u-herinneringen. */
function acknowledgeAlert(store, alertId, actor) {
  const a = (store.data.usageAlerts || []).find(x => x && x.id === alertId);
  if (!a) throw err(404, "AI_ALERT_NOT_FOUND", "waarschuwing niet gevonden");
  const next = store.update("usageAlerts", alertId, { acknowledgedAt: nowIso(), acknowledgedBy: actorEmail(actor) });
  store.audit({ actor: actorEmail(actor), tenantId: null, area: "ai", action: "ai_alert_acknowledged", detail: `${alertId}` });
  return next;
}

/**
 * Detecteer + persisteer waarschuwingen en markeer herinneringen. Retourneert de
 * e-mailtaken die de integratiestap via de bestaande mailer moet versturen (het
 * echt versturen zit NIET in deze module).
 */
function raiseAlerts(store, { period, now = null, baseUrl = "" } = {}, actor) {
  const det = detectAlerts(store, { period, now, baseUrl });
  const when = now || nowIso();
  const created = [];
  for (const a of det.newAlerts) { const res = recordAlert(store, a, actor); if (res.created) created.push(res.alert); }
  for (const r of det.reminders) {
    store.update("usageAlerts", r.alertId, { reminderAt: when });
    store.audit({ actor: actorEmail(actor), tenantId: null, area: "ai", action: "ai_alert_reminder", detail: `${r.alertId}` });
  }
  const emails = [
    ...created.map(a => ({ kind: "alert", alertId: a.id, ...a.email })),
    ...det.reminders.map(r => ({ kind: "reminder", alertId: r.alertId, ...r.email })),
  ];
  return { created, reminders: det.reminders.map(r => r.alertId), emails };
}

module.exports = {
  // constanten
  MONA_UNAVAILABLE_MESSAGE, AI_USAGE_TYPE, ADJUSTMENT_KINDS, ALERT_LEVELS, SIZE_CLASSES,
  DEFAULT_ALERT_THRESHOLD_PCT, WARN_THRESHOLD_PCT, REMINDER_AFTER_MS,
  // creditmodel (pure)
  resolveSizeClass, resolveCreditRate, computeCredits, providerCostOf, forecast, effectiveCeiling, isPeriod,
  // tenant-grens
  tenantBlockNotice, checkAllowed,
  // metering
  meterRequest,
  // Super Admin-configuratie
  setTenantLimits, grantAllocation, addAdjustment, setPlatformBudget, getTenantLimits,
  // Super Admin-monitoring (platformscope)
  creditBalance, platformBudgetStatus, adminTenantUsage, tenantsAtOrAbove, superAdminAiEventView,
  // waarschuwingen
  resolveRecipients, detectAlerts, recordAlert, acknowledgeAlert, raiseAlerts,
};
