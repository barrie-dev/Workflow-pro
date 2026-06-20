"use strict";

const { config } = require("../lib/config");

function isPlaceholder(value) {
  const raw = String(value || "");
  return !raw
    || raw.includes("<")
    || raw.includes(">")
    || raw.includes("replace_me")
    || raw.includes("change_me")
    || raw.includes("dev_only");
}

function maskedState(value, validLabel = "configured") {
  return value && !isPlaceholder(value) ? validLabel : "missing";
}

function item(key, label, ok, value, action, priority = "P0") {
  return {
    key,
    label,
    ok: !!ok,
    status: ok ? "ready" : "open",
    priority,
    value,
    action
  };
}

function validSupabaseUrl(value) {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(String(value || ""));
}

function validSupabaseServiceRole(value) {
  const raw = String(value || "");
  return raw.length >= 100 && raw.split(".").length >= 3 && !isPlaceholder(raw);
}

function validPoolerUrl(value) {
  const raw = String(value || "");
  if (!raw) return false;
  return /^postgres(ql)?:\/\//i.test(raw) && /pooler\.supabase\.com|:6543\//i.test(raw);
}

function validLiveStripeSecret(value) {
  const raw = String(value || "");
  return raw.startsWith("sk_live_") && raw.length > "sk_live_".length + 12 && !isPlaceholder(raw);
}

function validStripeWebhook(value) {
  const raw = String(value || "");
  return raw.startsWith("whsec_") && raw.length > "whsec_".length + 12 && !isPlaceholder(raw);
}

function validPeppolProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  return !!raw && raw !== "mock" && !isPlaceholder(raw);
}

function validProviderSecret(value) {
  const raw = String(value || "");
  return raw.length >= 16 && !isPlaceholder(raw);
}

function liveServiceReadiness(platformConfig = config) {
  const groups = [
    {
      key: "supabase",
      label: "Supabase PostgreSQL",
      items: [
        item(
          "storage_adapter",
          "Storage adapter",
          platformConfig.storageAdapter === "postgres",
          platformConfig.storageAdapter || "json",
          "Zet STORAGE_ADAPTER=postgres."
        ),
        item(
          "supabase_url",
          "Supabase URL",
          validSupabaseUrl(platformConfig.supabase.url),
          platformConfig.supabase.url ? "configured" : "missing",
          "Gebruik de project URL in vorm https://<project-ref>.supabase.co."
        ),
        item(
          "supabase_service_role",
          "Service role key",
          validSupabaseServiceRole(platformConfig.supabase.serviceRoleKey),
          maskedState(platformConfig.supabase.serviceRoleKey),
          "Gebruik de server-only service_role JWT. Log deze key nooit in frontend of client bundels."
        ),
        item(
          "database_url",
          "Database pooler URL",
          validPoolerUrl(platformConfig.databaseUrl),
          platformConfig.databaseUrl ? "configured" : "missing",
          "Zet DATABASE_URL naar de Supabase pooler op poort 6543 voor productieconnecties.",
          "P1"
        )
      ]
    },
    {
      key: "stripe",
      label: "Stripe Billing",
      items: [
        item(
          "stripe_secret",
          "Live secret key",
          validLiveStripeSecret(platformConfig.stripe.secretKey),
          platformConfig.stripe.secretKey ? (String(platformConfig.stripe.secretKey).startsWith("sk_live_") ? "live configured" : "not live") : "missing",
          "Zet STRIPE_SECRET_KEY op een live key die begint met sk_live_."
        ),
        item(
          "stripe_webhook",
          "Webhook signing secret",
          validStripeWebhook(platformConfig.stripe.webhookSecret),
          maskedState(platformConfig.stripe.webhookSecret),
          "Zet STRIPE_WEBHOOK_SECRET vanuit de live webhook endpoint settings."
        )
      ]
    },
    {
      key: "peppol",
      label: "Peppol e-facturatie",
      items: [
        item(
          "peppol_provider",
          "Provider",
          validPeppolProvider(platformConfig.peppol.provider),
          platformConfig.peppol.provider || "mock",
          "Kies een echte Peppol provider en zet PEPPOL_PROVIDER op diens providernaam."
        ),
        item(
          "peppol_api_key",
          "Provider API key",
          validProviderSecret(platformConfig.peppol.apiKey),
          maskedState(platformConfig.peppol.apiKey),
          "Zet PEPPOL_API_KEY als server-only secret."
        )
      ]
    },
    {
      key: "deployment",
      label: "Deployment metadata",
      items: [
        item(
          "app_url",
          "Publieke app URL",
          /^https:\/\//.test(platformConfig.appUrl),
          platformConfig.appUrl,
          "Zet APP_URL naar de definitieve https productie-URL.",
          "P1"
        ),
        item(
          "release_channel",
          "Release channel",
          platformConfig.releaseChannel === "production",
          platformConfig.releaseChannel,
          "Zet RELEASE_CHANNEL=production in de productieomgeving.",
          "P1"
        ),
        item(
          "commit_sha",
          "Commit SHA",
          platformConfig.commitSha !== "local-dev" && /^[0-9a-f]{7,40}$/i.test(platformConfig.commitSha),
          platformConfig.commitSha,
          "Zet COMMIT_SHA of RENDER_GIT_COMMIT zodat elke live deploy traceerbaar is.",
          "P1"
        )
      ]
    }
  ].map(group => {
    const blockers = group.items.filter(row => !row.ok && row.priority === "P0").length;
    const warnings = group.items.filter(row => !row.ok && row.priority !== "P0").length;
    return {
      ...group,
      ok: blockers === 0 && warnings === 0,
      blockers,
      warnings
    };
  });

  const items = groups.flatMap(group => group.items.map(row => ({ ...row, group: group.key })));
  const blockers = items.filter(row => !row.ok && row.priority === "P0");
  const warnings = items.filter(row => !row.ok && row.priority !== "P0");
  return {
    ok: blockers.length === 0,
    generatedAt: new Date().toISOString(),
    groups,
    blockers,
    warnings,
    ready: items.filter(row => row.ok).length,
    total: items.length
  };
}

module.exports = { liveServiceReadiness };
