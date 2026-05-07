const path = require("path");
const pkg = require("../../package.json");
const { loadEnvFile } = require("./env");

const root = path.join(__dirname, "..", "..");
const envStatus = loadEnvFile(path.join(root, ".env"));

const config = {
  root,
  port: Number(process.env.PORT || 4280),
  appUrl: process.env.APP_URL || "http://localhost:4280",
  appVersion: process.env.APP_VERSION || pkg.version,
  releaseChannel: process.env.RELEASE_CHANNEL || "pilot",
  commitSha: process.env.COMMIT_SHA || "local-dev",
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

module.exports = { config };
