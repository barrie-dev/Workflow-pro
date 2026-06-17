const path = require("path");
const pkg = require("../../package.json");
const { loadEnvFile } = require("./env");

const root = path.join(__dirname, "..", "..");
const envStatus = loadEnvFile(path.join(root, ".env"));

const config = {
  root,
  port: Number(process.env.PORT || 4280),
  isProduction: process.env.NODE_ENV === "production" || process.env.RELEASE_CHANNEL === "production",
  allowDemoData: process.env.WORKFLOWPRO_ALLOW_DEMO_DATA === "true",
  appUrl: process.env.APP_URL || "http://localhost:4280",
  appVersion: process.env.APP_VERSION || pkg.version,
  releaseChannel: process.env.RELEASE_CHANNEL || "pilot",
  // Render vult RENDER_GIT_COMMIT automatisch per deploy → bron van waarheid.
  // COMMIT_SHA blijft als handmatige override; "local-dev" lokaal.
  commitSha: (process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || "local-dev").slice(0, 7),
  jwtSecret: process.env.JWT_SECRET || "dev_only_replace_this_secret",
  encryptionKey: process.env.ENCRYPTION_KEY || "dev_only_replace_this_encryption_key_32",
  databaseUrl: process.env.DATABASE_URL || "",
  storageAdapter: process.env.STORAGE_ADAPTER || "json",
  supabase: {
    url: process.env.SUPABASE_URL || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  },
  env: {
    loaded: envStatus.loaded,
    keys: envStatus.keys,
    path: envStatus.path
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || ""
  },
  peppol: {
    provider: process.env.PEPPOL_PROVIDER || "mock",
    apiKey: process.env.PEPPOL_API_KEY || ""
  },
  kbo: {
    provider: process.env.KBO_PROVIDER || "mock"
  }
};

function isPlaceholder(value) {
  return !value || String(value).includes("dev_only") || String(value).startsWith("change_me") || String(value).startsWith("replace_me");
}

function assertProductionConfig() {
  if (!config.isProduction) return;
  const missing = [];
  const warnings = [];
  if (!/^https:\/\//.test(config.appUrl)) missing.push("APP_URL=https://...");
  if (config.storageAdapter !== "postgres") missing.push("STORAGE_ADAPTER=postgres");
  if (!config.supabase.url) missing.push("SUPABASE_URL");
  if (isPlaceholder(config.supabase.serviceRoleKey)) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (isPlaceholder(config.jwtSecret) || String(config.jwtSecret).length < 32) missing.push("JWT_SECRET");
  if (isPlaceholder(config.encryptionKey) || String(config.encryptionKey).length < 32) missing.push("ENCRYPTION_KEY");
  // Stripe en Peppol zijn optioneel tijdens pilot — waarschuwing, geen harde fout
  if (!String(config.stripe.secretKey || "").startsWith("sk_live_") || !String(config.stripe.webhookSecret || "").startsWith("whsec_")) {
    warnings.push("STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET (niet geconfigureerd — betalingen uitgeschakeld)");
  }
  if (config.peppol.provider === "mock") {
    warnings.push("PEPPOL_PROVIDER=mock (e-facturatie uitgeschakeld)");
  }
  if (warnings.length) {
    console.warn(`[config] Productie waarschuwingen: ${warnings.join(", ")}`);
  }
  if (missing.length) {
    throw new Error(`Production config blokkeert start: ${missing.join(", ")}`);
  }
}

assertProductionConfig();

module.exports = { config };
