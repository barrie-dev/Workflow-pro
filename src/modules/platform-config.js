"use strict";
/**
 * Platform-integratieconfiguratie (Stripe, Peppol, e-mail).
 *
 * Bron-volgorde (laag → hoog): DUMMY defaults  ←  env-vars  ←  opgeslagen DB-waarden.
 * De super-admin beheert de echte sleutels via de Integraties-console; die worden
 * in de 'platformConfig'-collectie bewaard en overschrijven de env/dummy-waarden.
 *
 * Geheime waarden worden NOOIT volledig naar de browser gestuurd — gebruik
 * publicPlatformConfig() voor de UI (gemaskeerd + 'configured'-status).
 */

const CONFIG_ID = "platform";

// Duidelijk neppe placeholder-sleutels zodat niets crasht vóór echte config.
const DUMMY = {
  stripe: {
    secretKey: "sk_test_DUMMY000000000000000000",
    webhookSecret: "whsec_DUMMY00000000000000000000",
  },
  peppol: {
    provider: "mock",                 // mock | billit | digiteal | unifiedpost
    apiKey: "peppol_DUMMY_0000000000",
  },
  email: {
    provider: "log",                  // log | resend | sendgrid | smtp
    apiKey: "re_DUMMY_00000000000000",
    from: "WorkFlow Pro <noreply@workflowpro.app>",
  },
  kbo: {
    provider: "mock",                 // mock | cbe-open-data
    apiKey: "",
  },
  ciaw: {
    provider: "mock",                 // mock | rsz | (gateway-provider)
    apiKey: "ciaw_DUMMY_0000000000",
    baseHost: "api.checkinatwork.be",
  },
  openai: {
    apiKey: "sk-DUMMY000000000000000000",   // echte OpenAI-key → Boden AI live; anders mock-modus
    model: "gpt-4o-mini",                    // instelbaar bij go-live (bv. gpt-4o voor meer kwaliteit)
  },
};

function envOverlay() {
  return {
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY || undefined,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || undefined,
    },
    peppol: {
      provider: process.env.PEPPOL_PROVIDER || undefined,
      apiKey: process.env.PEPPOL_API_KEY || undefined,
    },
    email: {
      provider: process.env.EMAIL_PROVIDER || undefined,
      apiKey: process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY || undefined,
      from: process.env.EMAIL_FROM || undefined,
    },
    kbo: {
      provider: process.env.KBO_PROVIDER || undefined,
      apiKey: process.env.KBO_API_KEY || undefined,
    },
    ciaw: {
      provider: process.env.CIAW_PROVIDER || undefined,
      apiKey: process.env.CIAW_API_KEY || undefined,
      baseHost: process.env.CIAW_BASE_HOST || undefined,
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || undefined,
      model: process.env.OPENAI_MODEL || undefined,
    },
  };
}

function deepMerge(base, over) {
  const out = {};
  for (const k of Object.keys(base)) {
    if (base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], (over && over[k]) || {});
    } else {
      const v = over ? over[k] : undefined;
      out[k] = (v === undefined || v === null || v === "") ? base[k] : v;
    }
  }
  return out;
}

function storedRow(store) {
  try { return store.list("platformConfig", null).find(r => r.id === CONFIG_ID) || null; }
  catch (_) { return null; }
}

/** Volledige config (met echte secrets) — uitsluitend server-side gebruiken. */
function loadPlatformConfig(store) {
  const stored = storedRow(store) || {};
  // dummy ← env ← stored
  const withEnv = deepMerge(DUMMY, envOverlay());
  const merged = deepMerge(withEnv, { stripe: stored.stripe, peppol: stored.peppol, email: stored.email, kbo: stored.kbo, openai: stored.openai, ciaw: stored.ciaw });
  // Add-on-overrides (naam/prijs/omschrijving/actief per add-on) — superadmin-bewerkbaar.
  merged.addons = stored.addons || {};
  // Plan-prijs-overrides (baseAnnual/seatAnnual/includedSeats per bundel-key).
  merged.planPrices = stored.planPrices || {};
  // Platform-aankondiging / onderhoudsbanner (getoond aan alle gebruikers).
  merged.announcement = stored.announcement || { active: false, level: "info", message: "" };
  return merged;
}

const PLACEHOLDER = /DUMMY|replace[_-]?me|replace[_-]?this|changeme|xxxx/i;

function mask(value) {
  const s = String(value || "");
  if (!s) return "";
  if (PLACEHOLDER.test(s)) return "(dummy — nog niet ingesteld)";
  if (s.length <= 8) return "••••";
  return s.slice(0, 4) + "••••" + s.slice(-4);
}

function isReal(value) {
  const s = String(value || "");
  return !!s && !PLACEHOLDER.test(s);
}

/** Gemaskeerde, browser-veilige weergave voor de super-admin console. */
function publicPlatformConfig(store) {
  const cfg = loadPlatformConfig(store);
  return {
    stripe: {
      secretKey: mask(cfg.stripe.secretKey),
      webhookSecret: mask(cfg.stripe.webhookSecret),
      mode: isReal(cfg.stripe.secretKey) ? (String(cfg.stripe.secretKey).startsWith("sk_live_") ? "live" : "test") : "dummy",
      configured: isReal(cfg.stripe.secretKey) && isReal(cfg.stripe.webhookSecret),
    },
    peppol: {
      provider: cfg.peppol.provider,
      apiKey: mask(cfg.peppol.apiKey),
      configured: cfg.peppol.provider !== "mock" && isReal(cfg.peppol.apiKey),
    },
    email: {
      provider: cfg.email.provider,
      apiKey: mask(cfg.email.apiKey),
      from: cfg.email.from,
      configured: cfg.email.provider !== "log" && isReal(cfg.email.apiKey),
    },
    kbo: {
      provider: cfg.kbo.provider,
      apiKey: mask(cfg.kbo.apiKey),
      configured: cfg.kbo.provider !== "mock" && isReal(cfg.kbo.apiKey),
    },
    ciaw: {
      provider: cfg.ciaw.provider,
      apiKey: mask(cfg.ciaw.apiKey),
      baseHost: cfg.ciaw.baseHost,
      configured: cfg.ciaw.provider !== "mock" && isReal(cfg.ciaw.apiKey),
    },
    openai: {
      apiKey: mask(cfg.openai.apiKey),
      model: cfg.openai.model,
      configured: isReal(cfg.openai.apiKey),  // echte key → Boden AI actief (anders mock)
    },
    addons: cfg.addons || {}, // overrides (naam/prijs/omschrijving/actief) — geen secrets
    planPrices: cfg.planPrices || {},
  };
}

/**
 * Sla (deel van de) config op. Lege of gemaskeerde waarden worden genegeerd,
 * zodat de UI veilig de gemaskeerde waarde kan terugsturen zonder te overschrijven.
 */
function savePlatformConfig(store, patch, actor) {
  const current = storedRow(store) || { id: CONFIG_ID, tenantId: null, stripe: {}, peppol: {}, email: {}, kbo: {}, openai: {}, addons: {} };
  const next = {
    id: CONFIG_ID,
    tenantId: null,
    stripe: { ...(current.stripe || {}) },
    peppol: { ...(current.peppol || {}) },
    email: { ...(current.email || {}) },
    kbo: { ...(current.kbo || {}) },
    ciaw: { ...(current.ciaw || {}) },
    openai: { ...(current.openai || {}) },
    addons: { ...(current.addons || {}) },
    planPrices: { ...(current.planPrices || {}) },
    announcement: { ...(current.announcement || {}) },
    updatedAt: new Date().toISOString(),
    updatedBy: actor && actor.email,
  };
  // Add-on-overrides: superadmin past naam/prijs/omschrijving/actief aan per add-on.
  if (patch.addons && typeof patch.addons === "object") {
    for (const [key, ov] of Object.entries(patch.addons)) {
      if (!ov || typeof ov !== "object") continue;
      const cur = { ...(next.addons[key] || {}) };
      if (ov.label !== undefined) cur.label = String(ov.label).trim();
      if (ov.description !== undefined) cur.description = String(ov.description).trim();
      if (ov.monthly !== undefined && ov.monthly !== null && ov.monthly !== "") cur.monthly = Math.max(0, Number(ov.monthly) || 0);
      if (ov.active !== undefined) cur.active = !!ov.active;
      next.addons[key] = cur;
    }
  }
  // Plan-prijs-overrides: numerieke velden per plan-key.
  if (patch.planPrices && typeof patch.planPrices === "object") {
    for (const [key, ov] of Object.entries(patch.planPrices)) {
      if (!ov || typeof ov !== "object") continue;
      const cur = { ...(next.planPrices[key] || {}) };
      for (const f of ["baseAnnual", "seatAnnual", "includedSeats"]) {
        if (ov[f] !== undefined && ov[f] !== null && ov[f] !== "") cur[f] = Math.max(0, Number(ov[f]) || 0);
      }
      next.planPrices[key] = cur;
    }
  }
  // Platform-aankondiging: actief-vlag, niveau (info/warning/maintenance), bericht.
  if (patch.announcement && typeof patch.announcement === "object") {
    const a = patch.announcement;
    const levels = ["info", "warning", "maintenance"];
    next.announcement = {
      active: !!a.active,
      level: levels.includes(a.level) ? a.level : "info",
      message: String(a.message || "").slice(0, 500),
      updatedAt: new Date().toISOString(),
    };
  }
  const isMaskedOrEmpty = v => v === undefined || v === null || v === "" || /••••|dummy — nog niet/.test(String(v));
  const apply = (section, keys) => {
    if (!patch[section]) return;
    for (const k of keys) {
      const v = patch[section][k];
      // 'provider'/'from'/'model' altijd toepasbaar (geen secret); secrets enkel als niet-gemaskeerd
      if (["provider", "from", "model"].includes(k)) { if (v !== undefined && v !== null && v !== "") next[section][k] = v; }
      else if (!isMaskedOrEmpty(v)) next[section][k] = v;
    }
  };
  apply("stripe", ["secretKey", "webhookSecret"]);
  apply("peppol", ["provider", "apiKey"]);
  apply("email", ["provider", "apiKey", "from"]);
  apply("kbo", ["provider", "apiKey"]);
  apply("ciaw", ["provider", "apiKey", "baseHost"]);
  apply("openai", ["apiKey", "model"]);

  const existing = storedRow(store);
  if (existing) store.update("platformConfig", CONFIG_ID, next);
  else store.insert("platformConfig", next);
  if (store.audit) store.audit({ actor: actor && actor.email, tenantId: null, action: "platform_config_updated", area: "integrations", detail: Object.keys(patch || {}).join(",") });
  return publicPlatformConfig(store);
}

module.exports = { loadPlatformConfig, publicPlatformConfig, savePlatformConfig, DUMMY, CONFIG_ID };
