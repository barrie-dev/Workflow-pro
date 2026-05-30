const crypto = require("crypto");
const { productionConfigRisk } = require("../src/modules/production");

function randomSecret(bytes = 48) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function envLine(key, value, comment = "") {
  return `${key}=${value}${comment ? ` # ${comment}` : ""}`;
}

function productionEnvTemplate() {
  return [
    envLine("NODE_ENV", "production"),
    envLine("RELEASE_CHANNEL", "production"),
    envLine("COMMIT_SHA", "<git_commit_sha>", "set by CI/CD"),
    envLine("PORT", "4280"),
    envLine("APP_URL", "https://app.workflowpro.be", "replace with live domain"),
    envLine("STORAGE_ADAPTER", "postgres"),
    envLine("SUPABASE_URL", "https://<project-ref>.supabase.co"),
    envLine("SUPABASE_SERVICE_ROLE_KEY", "<supabase_service_role_key>", "server-only secret"),
    envLine("DATABASE_URL", "postgresql://postgres.<project-ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres", "pooler URL"),
    envLine("JWT_SECRET", randomSecret(48), "generated"),
    envLine("ENCRYPTION_KEY", randomSecret(48), "generated"),
    envLine("STRIPE_SECRET_KEY", "sk_live_<replace_me>"),
    envLine("STRIPE_WEBHOOK_SECRET", "whsec_<replace_me>"),
    envLine("PEPPOL_PROVIDER", "<provider_name>"),
    envLine("PEPPOL_API_KEY", "<provider_api_key>"),
    envLine("KBO_PROVIDER", "mock", "replace when paid provider is chosen")
  ];
}

function bootstrapActions(configRisk) {
  const actionByKey = new Map(configRisk.rows.filter(row => !row.ok).map(row => [row.key, row.action]));
  return [
    {
      key: "supabase",
      done: !["storage_adapter", "supabase_url", "supabase_service_role"].some(key => actionByKey.has(key)),
      action: "Maak Supabase project aan, run database migraties en zet STORAGE_ADAPTER/SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY."
    },
    {
      key: "secrets",
      done: !["jwt_secret", "encryption_key"].some(key => actionByKey.has(key)),
      action: "Gebruik de gegenereerde JWT_SECRET en ENCRYPTION_KEY uit dit script in de hostingomgeving."
    },
    {
      key: "stripe",
      done: !["stripe_secret", "stripe_webhook"].some(key => actionByKey.has(key)),
      action: "Maak Stripe live account/webhook aan en vul STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET in."
    },
    {
      key: "peppol",
      done: !["peppol_provider", "peppol_api_key"].some(key => actionByKey.has(key)),
      action: "Kies Peppol provider, activeer Belgische e-facturatie en vul PEPPOL_PROVIDER + PEPPOL_API_KEY in."
    },
    {
      key: "release",
      done: !["app_url", "release_metadata"].some(key => actionByKey.has(key)),
      action: "Zet APP_URL, COMMIT_SHA en RELEASE_CHANNEL=production in CI/CD."
    }
  ];
}

const jsonMode = process.argv.includes("--json");
const configRisk = productionConfigRisk();
const env = productionEnvTemplate();
const actions = bootstrapActions(configRisk);
const payload = {
  ok: actions.every(row => row.done),
  generatedAt: new Date().toISOString(),
  ready: configRisk.ready,
  total: configRisk.total,
  missing: configRisk.missing,
  actions,
  env
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

console.log("WorkFlow Pro production env bootstrap");
console.log(`Config status nu: ${configRisk.ready}/${configRisk.total} klaar`);
console.log("\nActies");
actions.forEach(row => {
  console.log(`[${row.done ? "OK" : "OPEN"}] ${row.key}: ${row.action}`);
});
console.log("\n.env.production template");
console.log(env.join("\n"));
