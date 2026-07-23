"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const M = require("../src/modules/mona-ai-metering");

// ── Hand-rolled fake store (patroon test/roles.test.js) ──────────────────────
function makeStore() {
  const data = {
    usageEvents: [], usageAdjustments: [], aiFeatureCreditRates: [], aiProviderUsage: [],
    tenantUsageLimits: [], tenantCreditAllocations: [], platformUsageBudgets: [],
    usageAlertRules: [], usageAlerts: [], tenants: [], auditLogs: [],
  };
  return {
    data,
    audit(e) { data.auditLogs.push(e); },
    save() {},
    insert(c, row) { (data[c] = data[c] || []).push(row); return row; },
    list(c, tenantId) { const a = data[c] || []; return tenantId ? a.filter(r => r.tenantId === tenantId) : a; },
    get(c, idv) { return (data[c] || []).find(r => r.id === idv); },
    update(c, idv, patch) { const a = data[c] || []; const i = a.findIndex(x => x.id === idv); if (i >= 0) { a[i] = { ...a[i], ...patch }; return a[i]; } return null; },
  };
}

// Standaard credit-rates: assistant klein=1, middel=3, groot=8 credits.
function seedRates(store) {
  store.insert("aiFeatureCreditRates", { id: "r1", feature: "assistant", model: null, sizeClass: "small", credits: 1 });
  store.insert("aiFeatureCreditRates", { id: "r2", feature: "assistant", model: null, sizeClass: "medium", credits: 3 });
  store.insert("aiFeatureCreditRates", { id: "r3", feature: "assistant", model: null, sizeClass: "large", credits: 8 });
}

const T = "tenant_a";
const PERIOD = "2026-07";
const AT = "2026-07-15T10:00:00.000Z";
const ADMIN = { email: "admin@monargo.one" };

// ── 1. Creditmodel: grootteklasse en rate-resolutie ──────────────────────────

test("resolveSizeClass leidt de klasse uit tokens af en respecteert een expliciete klasse", () => {
  assert.equal(M.resolveSizeClass({ inputTokens: 500, outputTokens: 500 }), "small");
  assert.equal(M.resolveSizeClass({ inputTokens: 5000, outputTokens: 1000 }), "medium");
  assert.equal(M.resolveSizeClass({ inputTokens: 30000, outputTokens: 5000 }), "large");
  assert.equal(M.resolveSizeClass({ inputTokens: 999999, sizeClass: "small" }), "small");
});

test("resolveCreditRate kiest de meest specifieke actieve regel en sluit mismatch uit", () => {
  const rates = [
    { feature: "assistant", model: null, sizeClass: null, credits: 2 },
    { feature: "assistant", model: "gpt", sizeClass: "large", credits: 9 },
    { feature: "assistant", model: "gpt", sizeClass: null, credits: 5 },
    { feature: "assistant", model: "other", sizeClass: "large", credits: 99 },
  ];
  assert.equal(M.resolveCreditRate(rates, { feature: "assistant", model: "gpt", sizeClass: "large" }).credits, 9);
  assert.equal(M.resolveCreditRate(rates, { feature: "assistant", model: "gpt", sizeClass: "small" }).credits, 5);
  assert.equal(M.resolveCreditRate(rates, { feature: "assistant", model: "unknown", sizeClass: "small" }).credits, 2);
  assert.equal(M.resolveCreditRate(rates, { feature: "onbekend", model: "x", sizeClass: "small" }), undefined);
});

test("computeCredits zet units om naar credits; zonder regel 0 credits met resolved:false", () => {
  const store = makeStore(); seedRates(store);
  const cc = M.computeCredits(store.data.aiFeatureCreditRates, { feature: "assistant", providerUnits: { inputTokens: 6000 } });
  assert.equal(cc.sizeClass, "medium");
  assert.equal(cc.credits, 3);
  assert.equal(cc.resolved, true);
  const miss = M.computeCredits(store.data.aiFeatureCreditRates, { feature: "geen", providerUnits: {} });
  assert.equal(miss.credits, 0);
  assert.equal(miss.resolved, false);
});

// ── 2. Metering: immutable event + saldo-aftrek + idempotency ────────────────

test("meterRequest boekt provider-meter + immutable usage-event en trekt van het saldo af", () => {
  const store = makeStore(); seedRates(store);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 100 }, ADMIN);

  const res = M.meterRequest(store, { tenantId: T, feature: "assistant", model: "gpt", providerUnits: { inputTokens: 6000, outputTokens: 500, providerCost: 0.42 }, requestId: "req-1", userId: "u1", at: AT }, ADMIN);
  assert.equal(res.duplicate, false);
  assert.equal(res.credits, 3);
  assert.equal(store.data.aiProviderUsage.length, 1);
  assert.equal(store.data.usageEvents.length, 1);
  const ev = store.data.usageEvents[0];
  assert.equal(ev.usageType, "ai.usage");
  assert.equal(ev.tenantId, T);
  assert.equal(ev.credits, 3);
  assert.equal(ev.providerUnitCost, 0.42);

  const bal = M.creditBalance(store, T, PERIOD, { now: AT });
  assert.equal(bal.consumed, 3);
  assert.equal(bal.remaining, 97);
});

test("meterRequest is idempotent op requestId: retry maakt geen nieuw event of dubbel verbruik", () => {
  const store = makeStore(); seedRates(store);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 100 }, ADMIN);
  M.meterRequest(store, { tenantId: T, feature: "assistant", providerUnits: { inputTokens: 6000 }, requestId: "req-1", at: AT }, ADMIN);
  const again = M.meterRequest(store, { tenantId: T, feature: "assistant", providerUnits: { inputTokens: 6000 }, requestId: "req-1", at: AT }, ADMIN);
  assert.equal(again.duplicate, true);
  assert.equal(store.data.usageEvents.length, 1);
  assert.equal(M.creditBalance(store, T, PERIOD, { now: AT }).consumed, 3);
});

test("meterRequest valideert verplichte velden", () => {
  const store = makeStore();
  assert.throws(() => M.meterRequest(store, { feature: "assistant", requestId: "r" }, ADMIN), e => e.code === "AI_TENANT_REQUIRED");
  assert.throws(() => M.meterRequest(store, { tenantId: T, requestId: "r" }, ADMIN), e => e.code === "AI_FEATURE_REQUIRED");
  assert.throws(() => M.meterRequest(store, { tenantId: T, feature: "assistant" }, ADMIN), e => e.code === "AI_REQUEST_REQUIRED");
});

// ── 3. Adjustment verandert balance zonder usagehistoriek te herschrijven ────

test("AI adjustment verandert het saldo zonder de usage-events te herschrijven", () => {
  const store = makeStore(); seedRates(store);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 100 }, ADMIN);
  M.meterRequest(store, { tenantId: T, feature: "assistant", providerUnits: { inputTokens: 30000 }, requestId: "req-1", at: AT }, ADMIN);
  const before = M.creditBalance(store, T, PERIOD, { now: AT });
  assert.equal(before.consumed, 8);
  assert.equal(before.remaining, 92);
  const eventsSnapshot = JSON.stringify(store.data.usageEvents);

  M.addAdjustment(store, { tenantId: T, period: PERIOD, amount: 500, kind: "grant", reason: "extra bundel" }, ADMIN);
  const after = M.creditBalance(store, T, PERIOD, { now: AT });
  assert.equal(after.available, 600);
  assert.equal(after.remaining, 592);          // saldo omhoog
  assert.equal(after.consumed, 8);             // verbruik ONgewijzigd
  assert.equal(JSON.stringify(store.data.usageEvents), eventsSnapshot); // historiek intact
});

test("addAdjustment vereist een reden, een niet-nul bedrag en een geldig type", () => {
  const store = makeStore();
  assert.throws(() => M.addAdjustment(store, { tenantId: T, period: PERIOD, amount: 5 }, ADMIN), e => e.code === "AI_ADJUSTMENT_REASON");
  assert.throws(() => M.addAdjustment(store, { tenantId: T, period: PERIOD, amount: 0, reason: "x" }, ADMIN), e => e.code === "AI_ADJUSTMENT_AMOUNT");
  assert.throws(() => M.addAdjustment(store, { tenantId: T, period: PERIOD, amount: 5, kind: "weird", reason: "x" }, ADMIN), e => e.code === "AI_ADJUSTMENT_KIND");
});

// ── 4. Limieten en hard block (spec 9.1) ─────────────────────────────────────

test("checkAllowed blokkeert bij ai_disabled met de functionele boodschap", () => {
  const store = makeStore();
  M.setTenantLimits(store, T, { aiDisabled: true }, ADMIN);
  const r = M.checkAllowed(store, { tenantId: T, feature: "assistant" });
  assert.equal(r.allowed, false);
  assert.equal(r.scope, "ai");
  assert.equal(r.reason, "ai_disabled");
  assert.equal(r.message, M.MONA_UNAVAILABLE_MESSAGE);
});

test("checkAllowed dwingt allowedFeatures en allowedModels af", () => {
  const store = makeStore();
  M.setTenantLimits(store, T, { allowedFeatures: ["assistant"], allowedModels: ["gpt"] }, ADMIN);
  assert.equal(M.checkAllowed(store, { tenantId: T, feature: "estimator", model: "gpt" }).reason, "feature_not_allowed");
  assert.equal(M.checkAllowed(store, { tenantId: T, feature: "assistant", model: "andere" }).reason, "model_not_allowed");
  assert.equal(M.checkAllowed(store, { tenantId: T, feature: "assistant", model: "gpt" }).allowed, true);
});

test("soft limit laat requests DOORgaan; enkel de hard limit blokkeert", () => {
  const store = makeStore(); seedRates(store);
  M.setTenantLimits(store, T, { softLimit: 5, hardLimit: 100 }, ADMIN);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 100 }, ADMIN);
  // Verbruik 8 credits (> soft 5, < hard 100).
  M.meterRequest(store, { tenantId: T, feature: "assistant", providerUnits: { inputTokens: 30000 }, requestId: "req-1", at: AT }, ADMIN);
  const r = M.checkAllowed(store, { tenantId: T, feature: "assistant", at: AT });
  assert.equal(r.allowed, true); // soft limit blokkeert niet
});

test("AI 100% hard limit blokkeert nieuwe requests en raakt ALLEEN AI (scope ai)", () => {
  const store = makeStore(); seedRates(store);
  M.setTenantLimits(store, T, { hardLimit: 8 }, ADMIN);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 8 }, ADMIN);
  M.meterRequest(store, { tenantId: T, feature: "assistant", providerUnits: { inputTokens: 30000 }, requestId: "req-1", at: AT }, ADMIN); // 8 credits = 100%

  const auditBefore = store.data.auditLogs.length;
  const r = M.checkAllowed(store, { tenantId: T, feature: "assistant", at: AT });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "hard_limit_reached");
  assert.equal(r.scope, "ai"); // de blokkering is tot AI beperkt
  assert.equal(r.message, M.MONA_UNAVAILABLE_MESSAGE);
  // checkAllowed heeft geen neveneffect (rest van het platform onaangeroerd).
  assert.equal(store.data.auditLogs.length, auditBefore);
  assert.equal(store.data.usageEvents.length, 1);
});

test("unlimited omzeilt het krediet-plafond (na expliciete Super Admin-keuze)", () => {
  const store = makeStore(); seedRates(store);
  M.setTenantLimits(store, T, { unlimited: true, hardLimit: 1 }, ADMIN);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 0 }, ADMIN);
  M.meterRequest(store, { tenantId: T, feature: "assistant", providerUnits: { inputTokens: 30000 }, requestId: "req-1", at: AT }, ADMIN);
  assert.equal(M.checkAllowed(store, { tenantId: T, feature: "assistant", at: AT }).allowed, true);
});

test("maxPerDay en maxPerUser vormen optionele veiligheidsgrenzen", () => {
  const store = makeStore(); seedRates(store);
  M.setTenantLimits(store, T, { maxPerDay: 8, maxPerUser: 8, hardLimit: 1000 }, ADMIN);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 1000 }, ADMIN);
  M.meterRequest(store, { tenantId: T, feature: "assistant", providerUnits: { inputTokens: 30000 }, requestId: "req-1", userId: "u1", at: AT }, ADMIN); // 8 credits vandaag
  assert.equal(M.checkAllowed(store, { tenantId: T, feature: "assistant", userId: "u1", at: AT }).reason, "daily_limit_reached");
  // Andere dag, andere gebruiker -> daggrens weg, maar gebruikersgrens (periode) blijft.
  assert.equal(M.checkAllowed(store, { tenantId: T, feature: "assistant", userId: "u1", at: "2026-07-16T09:00:00.000Z" }).reason, "user_limit_reached");
  assert.equal(M.checkAllowed(store, { tenantId: T, feature: "assistant", userId: "u2", at: "2026-07-16T09:00:00.000Z" }).allowed, true);
});

test("metering-only: zonder limiet en zonder toegekend krediet blokkeert niets", () => {
  const store = makeStore(); seedRates(store);
  M.meterRequest(store, { tenantId: T, feature: "assistant", providerUnits: { inputTokens: 30000 }, requestId: "req-1", at: AT }, ADMIN);
  assert.equal(M.checkAllowed(store, { tenantId: T, feature: "assistant", at: AT }).allowed, true);
});

test("setTenantLimits weigert een hard limit onder de soft limit", () => {
  const store = makeStore();
  assert.throws(() => M.setTenantLimits(store, T, { softLimit: 100, hardLimit: 50 }, ADMIN), e => e.code === "AI_LIMIT_ORDER");
});

test("tempbundel-allocatie vervalt na de vervaldatum en telt dan niet meer mee", () => {
  const store = makeStore(); seedRates(store);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 50, expiresAt: "2026-07-10T00:00:00.000Z" }, ADMIN);
  assert.equal(M.creditBalance(store, T, PERIOD, { now: "2026-07-05T00:00:00.000Z" }).available, 50); // nog geldig
  assert.equal(M.creditBalance(store, T, PERIOD, { now: "2026-07-20T00:00:00.000Z" }).available, 0);  // vervallen
});

// ── 5. Tenant-grens: geen monitoring lekt naar de tenant ─────────────────────

test("tenantBlockNotice bevat uitsluitend de functionele boodschap, geen cijfers", () => {
  const n = M.tenantBlockNotice();
  assert.deepEqual(Object.keys(n).sort(), ["available", "message"]);
  assert.equal(n.available, false);
  assert.equal(n.message, M.MONA_UNAVAILABLE_MESSAGE);
  assert.equal(/\d/.test(n.message), false); // geen enkel cijfer in de tenantmelding
});

test("checkAllowed lekt geen usage-, credit-, kost- of limietcijfers naar de tenantgrens", () => {
  const store = makeStore(); seedRates(store);
  M.setTenantLimits(store, T, { hardLimit: 8 }, ADMIN);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 8 }, ADMIN);
  M.meterRequest(store, { tenantId: T, feature: "assistant", providerUnits: { inputTokens: 30000, providerCost: 5 }, requestId: "req-1", at: AT }, ADMIN);
  const r = M.checkAllowed(store, { tenantId: T, feature: "assistant", at: AT });
  // Enkel toegestane sleutels; geen credit/kost/limiet/verbruik-velden.
  for (const k of Object.keys(r)) assert.ok(["allowed", "scope", "reason", "message"].includes(k), `onverwacht veld ${k}`);
  assert.equal(/credit|cost|limit|consum|remain|percent|pct|usage|budget/i.test(Object.keys(r).join(",")), false);
});

test("het providerkost-cijfer verschijnt nooit in een audit-detail", () => {
  const store = makeStore(); seedRates(store);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 100 }, ADMIN);
  M.meterRequest(store, { tenantId: T, feature: "assistant", providerUnits: { inputTokens: 30000, providerCost: 12.34 }, requestId: "req-1", at: AT }, ADMIN);
  for (const a of store.data.auditLogs) assert.equal(String(a.detail).includes("12.34"), false);
});

// ── 6. 95%-waarschuwing: bepaling, dedup, herinnering, e-mailvelden ──────────

function seedRecipients(store) {
  store.insert("usageAlertRules", { id: "ar1", level: "all", thresholdPct: 95, recipients: ["ops@monargo.one"], channel: "email", active: true });
}
// Verbruik precies `credits` voor een tenant door zoveel large-requests te boeken.
function consume(store, credits, tenantId = T) {
  const n = credits / 8; // large = 8 credits
  for (let i = 0; i < n; i++) M.meterRequest(store, { tenantId, feature: "assistant", providerUnits: { inputTokens: 30000 }, requestId: `${tenantId}-req-${store.data.usageEvents.length}-${i}`, at: AT }, ADMIN);
}

test("AI 95% tenant: exact een alert met alle verplichte e-mailvelden (9.3)", () => {
  const store = makeStore(); seedRates(store); seedRecipients(store);
  store.insert("tenants", { id: T, name: "Bouwbedrijf A" });
  M.setTenantLimits(store, T, { hardLimit: 80 }, ADMIN);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 80 }, ADMIN);
  consume(store, 80); // 100% > 95%

  const det = M.detectAlerts(store, { period: PERIOD, now: AT, baseUrl: "https://app.monargo.one" });
  assert.equal(det.newAlerts.length, 1);
  const email = det.newAlerts[0].email;
  for (const f of ["level", "tenantId", "tenantName", "period", "limit", "used", "remaining", "percentage",
    "averageDailyUsage", "estimatedExhaustionDate", "topFeatures", "topUsers", "secureLink", "recipients"]) {
    assert.ok(f in email, `verplicht e-mailveld ontbreekt: ${f}`);
  }
  assert.equal(email.tenantName, "Bouwbedrijf A");
  assert.deepEqual(email.recipients, ["ops@monargo.one"]);
  assert.ok(email.secureLink.includes("/admin/usage/mona"));
});

test("dedup: een tweede detect/raise binnen de periode maakt geen tweede alert", () => {
  const store = makeStore(); seedRates(store); seedRecipients(store);
  M.setTenantLimits(store, T, { hardLimit: 80 }, ADMIN);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 80 }, ADMIN);
  consume(store, 80);

  const first = M.raiseAlerts(store, { period: PERIOD, now: AT, baseUrl: "" }, ADMIN);
  assert.equal(first.created.length, 1);
  assert.equal(first.emails.length, 1);
  const second = M.raiseAlerts(store, { period: PERIOD, now: AT, baseUrl: "" }, ADMIN);
  assert.equal(second.created.length, 0);       // deduped
  assert.equal(second.reminders.length, 0);     // nog geen 24u
  assert.equal(store.data.usageAlerts.length, 1);
});

test("herinnering: na 24u zonder acknowledgement wordt de alert opnieuw aangeboden", () => {
  const store = makeStore(); seedRates(store); seedRecipients(store);
  M.setTenantLimits(store, T, { hardLimit: 80 }, ADMIN);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 80 }, ADMIN);
  consume(store, 80);
  M.raiseAlerts(store, { period: PERIOD, now: AT, baseUrl: "" }, ADMIN);
  // Backdate de alert 25u.
  store.data.usageAlerts[0].createdAt = "2026-07-14T09:00:00.000Z";
  const later = M.raiseAlerts(store, { period: PERIOD, now: "2026-07-15T11:00:00.000Z", baseUrl: "" }, ADMIN);
  assert.equal(later.reminders.length, 1);
  assert.equal(later.emails.filter(e => e.kind === "reminder").length, 1);
  assert.ok(store.data.usageAlerts[0].reminderAt); // reminderAt gezet
});

test("acknowledge stopt de herinneringen", () => {
  const store = makeStore(); seedRates(store); seedRecipients(store);
  M.setTenantLimits(store, T, { hardLimit: 80 }, ADMIN);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 80 }, ADMIN);
  consume(store, 80);
  M.raiseAlerts(store, { period: PERIOD, now: AT, baseUrl: "" }, ADMIN);
  M.acknowledgeAlert(store, store.data.usageAlerts[0].id, ADMIN);
  store.data.usageAlerts[0].createdAt = "2026-07-14T09:00:00.000Z";
  const later = M.raiseAlerts(store, { period: PERIOD, now: "2026-07-16T09:00:00.000Z", baseUrl: "" }, ADMIN);
  assert.equal(later.reminders.length, 0);
});

test("limietverhoging: opnieuw 95% van de HOGERE limiet geeft een nieuwe alert (geen dedup)", () => {
  const store = makeStore(); seedRates(store); seedRecipients(store);
  M.setTenantLimits(store, T, { hardLimit: 80 }, ADMIN);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 400 }, ADMIN);
  consume(store, 80); // 100% van 80
  M.raiseAlerts(store, { period: PERIOD, now: AT, baseUrl: "" }, ADMIN);
  assert.equal(store.data.usageAlerts.length, 1);

  // Super Admin verhoogt de hard limit; verbruik klimt naar 95% van de nieuwe limiet.
  M.setTenantLimits(store, T, { hardLimit: 160 }, ADMIN);
  consume(store, 72); // totaal 152 = 95% van 160
  const again = M.raiseAlerts(store, { period: PERIOD, now: AT, baseUrl: "" }, ADMIN);
  assert.equal(again.created.length, 1);
  assert.equal(store.data.usageAlerts.length, 2);
});

test("AI global 95%: kritieke platformmelding met topverbruikers en prognose", () => {
  const store = makeStore(); seedRates(store); seedRecipients(store);
  store.insert("tenants", { id: T, name: "Bouwbedrijf A" });
  store.insert("tenants", { id: "tenant_b", name: "Bouwbedrijf B" });
  M.setPlatformBudget(store, { period: PERIOD, budget: 1000, basis: "credits" }, ADMIN);
  consume(store, 800, T);           // tenant A
  consume(store, 160, "tenant_b");  // tenant B -> totaal 960 = 96% > 95%

  const det = M.detectAlerts(store, { period: PERIOD, now: AT, baseUrl: "https://app.monargo.one" });
  const platform = det.newAlerts.find(a => a.level === "platform");
  assert.ok(platform, "platform-alert verwacht");
  assert.equal(platform.email.level, "platform");
  assert.ok(Array.isArray(platform.email.topTenants) && platform.email.topTenants.length >= 2);
  assert.equal(platform.email.topTenants[0].tenantId, T); // grootste verbruiker eerst
  assert.ok("estimatedExhaustionDate" in platform.email);
  assert.ok("averageDailyUsage" in platform.email);
});

test("onder de drempel: geen enkele waarschuwing", () => {
  const store = makeStore(); seedRates(store); seedRecipients(store);
  M.setTenantLimits(store, T, { hardLimit: 800 }, ADMIN);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 800 }, ADMIN);
  consume(store, 80); // 10%
  assert.equal(M.detectAlerts(store, { period: PERIOD, now: AT }).newAlerts.length, 0);
});

test("platformBudgetStatus rekent op basis 'cost' met de providerkost", () => {
  const store = makeStore(); seedRates(store);
  M.setPlatformBudget(store, { period: PERIOD, budget: 10, basis: "cost" }, ADMIN);
  M.meterRequest(store, { tenantId: T, feature: "assistant", providerUnits: { inputTokens: 30000, providerCost: 4 }, requestId: "req-1", at: AT }, ADMIN);
  M.meterRequest(store, { tenantId: T, feature: "assistant", providerUnits: { inputTokens: 30000, providerCost: 3 }, requestId: "req-2", at: AT }, ADMIN);
  const st = M.platformBudgetStatus(store, { period: PERIOD, now: AT });
  assert.equal(st.basis, "cost");
  assert.equal(st.consumed, 7);
  assert.equal(st.remaining, 3);
  assert.equal(st.pct, 70);
});

// ── 7. Super Admin-reads en KPI ──────────────────────────────────────────────

test("tenantsAtOrAbove levert de KPI-tenants boven een percentage", () => {
  const store = makeStore(); seedRates(store);
  M.setTenantLimits(store, T, { hardLimit: 100 }, ADMIN);
  M.setTenantLimits(store, "tenant_b", { hardLimit: 100 }, ADMIN);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 100 }, ADMIN);
  M.grantAllocation(store, { tenantId: "tenant_b", period: PERIOD, creditsGranted: 100 }, ADMIN);
  consume(store, 96, T);            // 96%
  consume(store, 40, "tenant_b");   // 40%
  const at95 = M.tenantsAtOrAbove(store, PERIOD, 95);
  assert.deepEqual(at95, [T]);
  assert.ok(M.tenantsAtOrAbove(store, PERIOD, M.WARN_THRESHOLD_PCT).includes(T));
});

test("de Mona control-plane-rijen dragen tenantId:null en lekken niet via store.list(col, tenantId)", () => {
  const store = makeStore(); seedRates(store);
  M.setTenantLimits(store, T, { hardLimit: 100 }, ADMIN);
  M.grantAllocation(store, { tenantId: T, period: PERIOD, creditsGranted: 100 }, ADMIN);
  M.addAdjustment(store, { tenantId: T, period: PERIOD, amount: 10, reason: "x" }, ADMIN);
  M.meterRequest(store, { tenantId: T, feature: "assistant", providerUnits: { inputTokens: 30000, providerCost: 1 }, requestId: "req-1", at: AT }, ADMIN);
  // Een tenant-gescoopte lijst op de control-plane-collecties geeft NIETS terug.
  for (const col of ["tenantUsageLimits", "tenantCreditAllocations", "usageAdjustments", "aiProviderUsage", "usageAlerts"]) {
    assert.equal(store.list(col, T).length, 0, `${col} lekt naar de tenant`);
  }
  // De ruwe providerkost leeft enkel op de Super Admin-only providermeter.
  assert.equal(store.data.aiProviderUsage[0].providerCost, 1);
});

test("de module exporteert geen tenant-zichtbare monitoring-functie", () => {
  // De enige tenant-gerichte uitvoer is tenantBlockNotice (functionele melding).
  // checkAllowed geeft enkel allowed/scope/reason/message. Alle overige reads
  // (creditBalance, platformBudgetStatus, adminTenantUsage, ...) zijn Super
  // Admin-only en bevatten cijfers -> ze mogen nooit op een tenant-route hangen.
  const tenantSafe = new Set(["tenantBlockNotice", "checkAllowed"]);
  const monitoringReads = ["creditBalance", "platformBudgetStatus", "adminTenantUsage", "detectAlerts"];
  for (const name of monitoringReads) assert.equal(typeof M[name], "function");
  // Geen export met "dashboard" of "tenantUsage"/"tenantCredit"-achtige tenant-getters.
  for (const name of Object.keys(M)) {
    assert.equal(/dashboard/i.test(name), false, `verdachte tenant-export ${name}`);
  }
  assert.ok(tenantSafe.has("tenantBlockNotice"));
});
