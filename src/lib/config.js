const path = require("path");
const pkg = require("../../package.json");
const { loadEnvFile } = require("./env");

const root = path.join(__dirname, "..", "..");
const envStatus = loadEnvFile(path.join(root, ".env"));

// ── Omgeving (dev | test | staging | production) ──────────────────────────────
// Eén canonieke omgeving per deploy, gezet via APP_ENV (fallback RELEASE_CHANNEL/
// NODE_ENV). Bepaalt guardrails (echte mails/Stripe-live enkel waar toegestaan)
// en de zichtbare env-banner. Elke Render-service zet zijn eigen APP_ENV.
const APP_ENV = (() => {
  const raw = String(process.env.APP_ENV || process.env.RELEASE_CHANNEL || "").toLowerCase().trim();
  if (["dev", "development", "local"].includes(raw)) return "dev";
  if (["test", "qa"].includes(raw)) return "test";
  if (["staging", "stage", "uat"].includes(raw)) return "staging";
  if (["production", "prod", "live"].includes(raw)) return "production";
  return process.env.NODE_ENV === "production" ? "production" : "dev";
})();

const config = {
  root,
  port: Number(process.env.PORT || 4280),
  appEnv: APP_ENV,
  isProduction: APP_ENV === "production",
  // Prod-like = echte klantomgevingen (staging + production): strengere CSP,
  // echte e-mail toegestaan. Stripe-LIVE blijft exclusief voor production.
  isProdLike: APP_ENV === "production" || APP_ENV === "staging",
  guards: {
    allowStripeLive: APP_ENV === "production",
    allowRealEmail: APP_ENV === "production" || APP_ENV === "staging",
  },
  allowDemoData: process.env.WORKFLOWPRO_ALLOW_DEMO_DATA === "true",
  appUrl: process.env.APP_URL || "http://localhost:4280",
  appVersion: process.env.APP_VERSION || pkg.version,
  releaseChannel: process.env.RELEASE_CHANNEL || "pilot",
  // Generieke release-metadata eerst (vendor-onafhankelijk, S1-05/ADR-001):
  // APP_COMMIT_SHA is de canonieke variabele voor elk platform. Daarna de door
  // het platform per deploy gezette waarde (Render: RENDER_GIT_COMMIT) zodat de
  // rapportage de ECHTE draaiende commit toont; een handmatige COMMIT_SHA-
  // override komt als laatste (anders schaduwt een verouderde waarde de deploy).
  // "local-dev" lokaal.
  commitSha: (raw => /^[0-9a-f]{7,40}$/i.test(raw) ? raw.slice(0, 7) : raw)(process.env.APP_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || "local-dev"),
  jwtSecret: process.env.JWT_SECRET || "dev_only_replace_this_secret",
  encryptionKey: process.env.ENCRYPTION_KEY || "dev_only_replace_this_encryption_key_32",
  databaseUrl: process.env.DATABASE_URL || "",
  storageAdapter: process.env.STORAGE_ADAPTER || "json",
  // Generieke databaseconfiguratie (F-05): geldt voor ELKE standaard PostgreSQL
  // (lokale Docker, Azure Database for PostgreSQL, RDS, Cloud SQL, eigen VPS).
  // Geen providernaam, geen provider-specifieke sleutels.
  database: {
    url: process.env.DATABASE_URL || "",
    // TLS: expliciet via DATABASE_SSL=true|false; zonder expliciete keuze
    // automatisch AAN voor elke niet-lokale host. Managed databases (Supabase,
    // Azure, RDS) weigeren onversleutelde verbindingen · zonder deze detectie
    // crasht een productie-boot op "no encryption" terwijl dev gewoon werkt.
    ssl: (() => {
      const explicit = String(process.env.DATABASE_SSL || "").toLowerCase();
      if (explicit === "true") return true;
      if (explicit === "false") return false;
      const url = process.env.DATABASE_URL || "";
      if (/sslmode=(require|prefer|verify)/i.test(url)) return true;
      return /^postgres(ql)?:\/\//.test(url) && !/@(localhost|127\.0\.0\.1|host\.docker\.internal|db)([:/]|$)/.test(url);
    })(),
    maxConnections: Number(process.env.DATABASE_MAX_CONNECTIONS) || 10,
    statementTimeoutMs: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS) || 15000,
    // CTO-13 · TLS-modus: 'require' versleutelt zonder certificaatvalidatie
    // (dev/test-gemak); 'verify-full' valideert de certificaatketen (system
    // trust store of DATABASE_CA_CERT). Productie default = verify-full.
    sslMode: (() => {
      const m = String(process.env.DATABASE_SSL_MODE || "").toLowerCase().trim();
      if (m === "require" || m === "verify-full") return m;
      return APP_ENV === "production" ? "verify-full" : "require";
    })(),
    // PEM van de root-CA van de databaseprovider. Veel dashboards en shells
    // platten een meerregelige waarde tot letterlijke \n-reeksen; die zetten we
    // terug om, anders krijgt Node een onleesbaar certificaat en faalt de boot
    // met dezelfde onduidelijke ketenfout als een ontbrekende CA.
    caCert: String(process.env.DATABASE_CA_CERT || "").replace(/\\n/g, "\n").trim()
  },
  // CTO-03 · single-writer-guard: in productie/staging default AAN. Eén
  // instantie houdt de PostgreSQL advisory lock; een nieuwe deploy wacht
  // maximaal singleWriterWaitMs op de oude en faalt daarna hard.
  singleWriter: (() => {
    const v = String(process.env.SINGLE_WRITER || "").toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
    return APP_ENV === "production" || APP_ENV === "staging";
  })(),
  // Wachttijd op de writer-lock. De server luistert al tijdens dit wachten (zie
  // de bootgate in server.js), dus de healthcheck is groen en het platform durft
  // de oude instantie te stoppen · daarna valt de lock vrij. Snel falen is
  // daarom niet langer gewenst: 5 minuten geeft een trage rolling deploy ruim
  // de tijd, en blijft een plafond voor het geval er echt iets vasthangt.
  singleWriterWaitMs: Number(process.env.SINGLE_WRITER_WAIT_MS) || 300000,
  // CRM-bronschakelaar (handover 5.4 stap 5-7): legacy | shadow | pg.
  // shadow = legacy leidend + pg leest mee (afwijkingen naar telemetrie);
  // pg = cutover, met dual-write zodat rollback een flag-flip blijft.
  crm: {
    readSource: (process.env.CRM_READ_SOURCE || "legacy").toLowerCase()
  },
  // Identity-bronschakelaar (P0-01 · zelfde route als CRM): legacy | shadow | pg.
  // De spiegel-lus draait zodra de pg-adapter actief is, ongeacht de stand ·
  // zo bouwt het reconciliatiebewijs zich vanzelf op vóór de cutover.
  identity: {
    readSource: (process.env.IDENTITY_READ_SOURCE || "legacy").toLowerCase(),
    syncIntervalMs: Number(process.env.IDENTITY_SYNC_INTERVAL_MS) || 10000
  },
  // Finance-bronschakelaar (P0-01 · derde domein: facturen + betalingen).
  // Zelfde route en spiegel-lus als identity; schrijven blijft bij legacy.
  finance: {
    readSource: (process.env.FINANCE_READ_SOURCE || "legacy").toLowerCase(),
    syncIntervalMs: Number(process.env.FINANCE_SYNC_INTERVAL_MS) || 10000
  },
  // Company-bronschakelaar (P0-01 · vierde domein: ondernemingen + nummerreeksen).
  company: {
    readSource: (process.env.COMPANY_READ_SOURCE || "legacy").toLowerCase(),
    syncIntervalMs: Number(process.env.COMPANY_SYNC_INTERVAL_MS) || 10000
  },
  // Forms-bronschakelaar (Forms-handover · finale CTO-directive: één engine).
  // legacy = oude work-os JSON-engine blijft schrijfbaar (default, tot cutover);
  // pg     = de canonieke engine is de waarheid en het legacy-schrijfpad is
  //          BEVROREN (410 met verwijzing naar form-definitions/*); lezen blijft
  //          voor historiek.
  forms: {
    source: (process.env.FORMS_SOURCE || "legacy").toLowerCase()
  },
  // AI achter een port (handover 4.5 · F-07). Modelnamen staan HIER, nooit in
  // business rules. De super-admin kan dit per platform overschrijven via de
  // Integraties-console; zonder geldige sleutel draait de mock-adapter.
  ai: {
    provider: process.env.AI_PROVIDER || "openai",
    apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "",
    model: process.env.AI_MODEL || "gpt-4o-mini",
    endpoint: process.env.AI_ENDPOINT || "",
    apiVersion: process.env.AI_API_VERSION || "2024-10-21"
  },
  // Objectopslag achter een port (handover 4.2 · F-08). "local" draait overal
  // waar een schijf is; "azure-blob"/"s3" zijn latere adapters met exact
  // hetzelfde contract. Geen publieke containers: toegang via ondertekende URL.
  objectStorage: {
    adapter: process.env.OBJECT_STORAGE_ADAPTER || "local",
    path: process.env.OBJECT_STORAGE_PATH || "",
    urlTtlSeconds: Number(process.env.OBJECT_STORAGE_URL_TTL_SECONDS) || 900,
    // Valt terug op de app-secret zodat dev werkt zonder extra configuratie.
    signingKey: process.env.OBJECT_STORAGE_SIGNING_KEY || process.env.JWT_SECRET || "dev_only_replace_this_secret",
    // s3-compatibele adapter (P0-08): generieke variabelen, geen providernaam.
    // Werkt op elke s3-compatibele opslag; de aanbieder zit alleen in de URL.
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT || "",
    bucket: process.env.OBJECT_STORAGE_BUCKET || "",
    region: process.env.OBJECT_STORAGE_REGION || "us-east-1",
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || "",
    forcePathStyle: process.env.OBJECT_STORAGE_PATH_STYLE !== "false"
  },
  // LEGACY · uitsluitend voor een eenmalige migratie van bestaande data.
  // De normale runtime gebruikt deze waarden niet meer (F-01/F-02).
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
  },
  // Inbound e-mail (klantvragen-intake): provider POST't naar
  // /api/webhooks/inbound-mail?secret=<INBOUND_MAIL_SECRET>.
  inboundMail: {
    domain: process.env.INBOUND_MAIL_DOMAIN || "in.monargo.com",
    secret: process.env.INBOUND_MAIL_SECRET || ""
  },
  webpush: {
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
    subject: process.env.VAPID_SUBJECT || (process.env.EMAIL_FROM ? `mailto:${(process.env.EMAIL_FROM.match(/<([^>]+)>/) || [])[1] || process.env.EMAIL_FROM}` : "mailto:support@workflowpro.be")
  }
};

function isPlaceholder(value) {
  return !value || String(value).includes("dev_only") || String(value).startsWith("change_me") || String(value).startsWith("replace_me");
}

function assertProductionConfig() {
  // Elke klantgerichte omgeving (staging + production) moet echte secrets hebben:
  // een default/zwakke JWT_SECRET laat sessie-, support- en reset-tokens
  // vervalsen; een default ENCRYPTION_KEY laat opgeslagen MFA-secrets ontsleutelen.
  // Staging draagt echte klantdata, dus de secret-check geldt óók daar.
  if (config.isProdLike) {
    const secretsMissing = [];
    if (isPlaceholder(config.jwtSecret) || String(config.jwtSecret).length < 32) secretsMissing.push("JWT_SECRET");
    if (isPlaceholder(config.encryptionKey) || String(config.encryptionKey).length < 32) secretsMissing.push("ENCRYPTION_KEY");
    if (secretsMissing.length) {
      throw new Error(`${config.appEnv}-config blokkeert start (zwakke/default secrets): ${secretsMissing.join(", ")}`);
    }
  }
  if (!config.isProduction) return;
  const missing = [];
  const warnings = [];
  if (!/^https:\/\//.test(config.appUrl)) missing.push("APP_URL=https://...");
  // Productie draait op een echte database, maar NIET op een specifieke
  // provider: enkel een standaard PostgreSQL-URL is vereist (F-05).
  if (config.storageAdapter !== "postgres") missing.push("STORAGE_ADAPTER=postgres");
  if (!/^postgres(ql)?:\/\//.test(config.database.url)) missing.push("DATABASE_URL=postgresql://...");
  // CTO-02 · lokale objectopslag is in productie VERBODEN: een deploy of
  // crash van de container wist bestanden onherroepelijk. Managed storage
  // (s3-compatibel of azure-blob) is de enige toegestane productiestandaard.
  if (String(config.objectStorage.adapter).toLowerCase() === "local") {
    missing.push("OBJECT_STORAGE_ADAPTER=s3|azure-blob (local is in productie verboden · bestanden overleven geen deploy)");
  }
  if (isPlaceholder(config.jwtSecret) || String(config.jwtSecret).length < 32) missing.push("JWT_SECRET");
  if (isPlaceholder(config.encryptionKey) || String(config.encryptionKey).length < 32) missing.push("ENCRYPTION_KEY");
  // Stripe en Peppol zijn optioneel tijdens pilot · waarschuwing, geen harde fout
  if (!String(config.stripe.secretKey || "").startsWith("sk_live_") || !String(config.stripe.webhookSecret || "").startsWith("whsec_")) {
    warnings.push("STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET (niet geconfigureerd · betalingen uitgeschakeld)");
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

/**
 * CTO-13 · pg-Pool ssl-opties uit de geconfigureerde TLS-modus.
 * 'verify-full' valideert de certificaatketen (system trust store, of de
 * meegegeven CA via DATABASE_CA_CERT); 'require' versleutelt zonder validatie.
 * Retourneert undefined als TLS uit staat (lokale database).
 */
function databaseSslOptions() {
  if (!config.database.ssl) return undefined;
  if (config.database.sslMode === "verify-full") {
    const opts = { rejectUnauthorized: true };
    if (config.database.caCert) opts.ca = config.database.caCert;
    return opts;
  }
  return { rejectUnauthorized: false };
}

module.exports = { config, databaseSslOptions };
