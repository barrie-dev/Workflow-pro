const { config } = require("../lib/config");
const { isExpired } = require("./api-keys");
const { syncSummary, mappingSummary } = require("./integrations");
const { supportRisk } = require("./support");
const fs = require("fs");
const path = require("path");
const MODULE_SCOPES = ["planning", "workorders", "billing", "integrations"];
const BACKUP_STALE_DAYS = 7;

function isDevSecret(value, marker) {
  const raw = String(value || "");
  return !raw || raw.includes(marker) || raw.startsWith("change_me") || raw.startsWith("replace_me");
}

function isLiveStripeSecret(value) {
  const raw = String(value || "");
  return raw.startsWith("sk_live_");
}

function isLiveStripeWebhookSecret(value) {
  const raw = String(value || "");
  return raw.startsWith("whsec_") && !raw.includes("replace_me");
}

function check(key, label, ok, detail, priority = "P0") {
  return {
    key,
    label,
    ok: !!ok,
    status: ok ? "ready" : "open",
    priority,
    detail
  };
}

function productionConfigRisk() {
  const rows = [
    {
      key: "storage_adapter",
      label: "Storage adapter",
      required: "STORAGE_ADAPTER=postgres",
      ok: config.storageAdapter === "postgres",
      value: config.storageAdapter || "json",
      action: "Zet STORAGE_ADAPTER=postgres voor Supabase PostgreSQL."
    },
    {
      key: "supabase_url",
      label: "Supabase URL",
      required: "SUPABASE_URL",
      ok: !!config.supabase.url,
      value: config.supabase.url ? "configured" : "missing",
      action: "Vul SUPABASE_URL in vanuit het Supabase project."
    },
    {
      key: "supabase_service_role",
      label: "Supabase service role",
      required: "SUPABASE_SERVICE_ROLE_KEY",
      ok: !!config.supabase.serviceRoleKey,
      value: config.supabase.serviceRoleKey ? "configured" : "missing",
      action: "Vul SUPABASE_SERVICE_ROLE_KEY in als server-only secret."
    },
    {
      key: "jwt_secret",
      label: "JWT secret",
      required: "JWT_SECRET",
      ok: !isDevSecret(config.jwtSecret, "dev_only") && String(config.jwtSecret).length >= 32,
      value: isDevSecret(config.jwtSecret, "dev_only") ? "dev/default" : `${String(config.jwtSecret).length} chars`,
      action: "Gebruik een lange random JWT_SECRET van minstens 32 tekens."
    },
    {
      key: "encryption_key",
      label: "Encryptiesleutel",
      required: "ENCRYPTION_KEY",
      ok: !isDevSecret(config.encryptionKey, "dev_only") && String(config.encryptionKey).length >= 32,
      value: isDevSecret(config.encryptionKey, "dev_only") ? "dev/default" : `${String(config.encryptionKey).length} chars`,
      action: "Gebruik een production-grade ENCRYPTION_KEY van minstens 32 tekens."
    },
    {
      key: "stripe_secret",
      label: "Stripe secret",
      required: "STRIPE_SECRET_KEY",
      ok: isLiveStripeSecret(config.stripe.secretKey),
      value: config.stripe.secretKey ? (isLiveStripeSecret(config.stripe.secretKey) ? "live configured" : "not live") : "missing",
      action: "Zet STRIPE_SECRET_KEY op een live key die begint met sk_live_."
    },
    {
      key: "stripe_webhook",
      label: "Stripe webhook secret",
      required: "STRIPE_WEBHOOK_SECRET",
      ok: isLiveStripeWebhookSecret(config.stripe.webhookSecret),
      value: config.stripe.webhookSecret ? (isLiveStripeWebhookSecret(config.stripe.webhookSecret) ? "configured" : "placeholder") : "missing",
      action: "Zet STRIPE_WEBHOOK_SECRET zodat events cryptografisch gecontroleerd worden."
    },
    {
      key: "peppol_provider",
      label: "Peppol provider",
      required: "PEPPOL_PROVIDER",
      ok: config.peppol.provider !== "mock",
      value: config.peppol.provider,
      action: "Kies een echte Peppol provider voor Belgische facturatie."
    },
    {
      key: "peppol_api_key",
      label: "Peppol API key",
      required: "PEPPOL_API_KEY",
      ok: !isDevSecret(config.peppol.apiKey, "dev_only"),
      value: !isDevSecret(config.peppol.apiKey, "dev_only") ? "configured" : "missing",
      action: "Zet PEPPOL_API_KEY voor productie Peppol-verzending."
    },
    {
      key: "app_url",
      label: "Publieke app URL",
      required: "APP_URL",
      ok: /^https:\/\//.test(config.appUrl),
      value: config.appUrl,
      action: "Zet APP_URL naar de echte https productie-URL."
    },
    {
      key: "release_metadata",
      label: "Release metadata",
      required: "COMMIT_SHA + RELEASE_CHANNEL=production",
      ok: config.commitSha !== "local-dev" && config.releaseChannel === "production",
      value: `${config.releaseChannel}/${config.commitSha}`,
      action: "Zet COMMIT_SHA en RELEASE_CHANNEL=production in de deployment."
    }
  ];
  return {
    ok: rows.every(row => row.ok),
    total: rows.length,
    ready: rows.filter(row => row.ok).length,
    missing: rows.filter(row => !row.ok).length,
    rows
  };
}

function sqlMigrationCount() {
  const dir = path.join(config.root, "database", "migrations");
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(name => /^\d+_.*\.sql$/.test(name)).length;
}

function backupFreshness(store) {
  const dir = path.join(config.root, "data", "backups");
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(name => name.endsWith(".json"))
    : [];
  const backups = files.map(name => {
    const fullPath = path.join(dir, name);
    const stat = fs.statSync(fullPath);
    try {
      const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      return {
        tenantId: parsed.tenantId || null,
        createdAt: parsed.createdAt || stat.birthtime.toISOString(),
        name
      };
    } catch {
      return {
        tenantId: null,
        createdAt: stat.birthtime.toISOString(),
        name
      };
    }
  });
  const rows = (store.data.tenants || []).map(tenant => {
    const latest = backups
      .filter(row => row.tenantId === tenant.id || row.name.startsWith(`backup_${tenant.id}_`))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const timestamp = latest ? new Date(latest.createdAt).getTime() : 0;
    const ageDays = timestamp ? Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000)) : null;
    return {
      tenantId: tenant.id,
      latestBackupAt: latest?.createdAt || null,
      ageDays,
      ok: ageDays != null && ageDays <= BACKUP_STALE_DAYS
    };
  });
  return {
    rows,
    missing: rows.filter(row => !row.latestBackupAt).length,
    stale: rows.filter(row => row.latestBackupAt && !row.ok).length
  };
}

function productionReadiness(store) {
  const storage = store.storageStatus();
  const migrations = store.migrationStatus();
  const sqlMigrations = sqlMigrationCount();
  const users = store.data.users || [];
  const demoTenantCount = (store.data.tenants || []).filter(tenant => /^t_demo$/i.test(tenant.id) || /demo/i.test(`${tenant.name || ""} ${tenant.billingEmail || ""}`)).length;
  const demoUserCount = users.filter(user => /demo|workflowpro\.be/i.test(`${user.email || ""} ${user.name || ""}`)).length;
  const adminUsers = users.filter(user => ["tenant_admin", "super_admin"].includes(user.role));
  const mfaAdmins = adminUsers.filter(user => user.mfaEnabled && user.mfaEnforced);
  const activeApiKeys = (store.data.apiKeys || []).filter(key => key.status === "active");
  const expiredApiKeys = activeApiKeys.filter(key => isExpired(key));
  const noExpiryApiKeys = activeApiKeys.filter(key => !key.expiresAt);
  const weakScopeApiKeys = activeApiKeys.filter(key => !(key.scopes || []).includes("read") || !(key.scopes || []).some(scope => MODULE_SCOPES.includes(scope)));
  const integrations = store.data.integrations || [];
  const missingIntegrationSecrets = integrations.filter(row => !row.encryptedSecret);
  const integrationFailures = integrations.reduce((total, row) => total + syncSummary(row).unresolvedFailures, 0);
  const integrationMappingIssues = integrations.filter(row => mappingSummary(row).needsAttention).length;
  const support = supportRisk(store.data.supportTickets || []);
  const backups = backupFreshness(store);
  const configRisk = productionConfigRisk();
  const checks = [
    check(
      "env_file",
      "Configuratiebestand",
      config.env.loaded || process.env.NODE_ENV === "production",
      config.env.loaded ? `.env geladen met ${config.env.keys.length} keys.` : "Geen .env gevonden. Server environment kan dit in productie vervangen.",
      "P1"
    ),
    check(
      "database",
      "Supabase PostgreSQL adapter",
      storage.adapter === "postgres" && !!config.supabase.url && !!config.supabase.serviceRoleKey,
      storage.adapter === "postgres"
        ? "Supabase adapter geselecteerd."
        : "Nog lokale JSON adapter. Zet STORAGE_ADAPTER=postgres, SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY.",
      "P0"
    ),
    check(
      "database_pooling",
      "Supabase connection pooling",
      storage.adapter !== "postgres" || storage.bridge === "supabase-rest" || storage.pooled,
      storage.bridge === "supabase-rest"
        ? "Supabase REST bridge actief; pooling loopt via Supabase API."
        : storage.pooled ? "Pooler endpoint gedetecteerd." : "Gebruik bij productie bij voorkeur de Supabase pooler connection string.",
      "P1"
    ),
    check(
      "migrations",
      "Database migraties",
      migrations.pending.length === 0,
      migrations.pending.length === 0 ? `Schema v${migrations.currentVersion} is actueel.` : `${migrations.pending.length} migraties pending.`,
      "P0"
    ),
    check(
      "supabase_sql_migrations",
      "Supabase SQL migraties",
      sqlMigrations >= 3,
      `${sqlMigrations} SQL migratiebestanden beschikbaar in database/migrations.`,
      "P1"
    ),
    check(
      "demo_data_removed",
      "Demo data verwijderd",
      !config.isProduction || (demoTenantCount === 0 && demoUserCount === 0),
      demoTenantCount || demoUserCount
        ? `${demoTenantCount} demo tenants en ${demoUserCount} demo/admin voorbeeldgebruikers gevonden. Verwijder deze uit productie.`
        : "Geen demodata in productie-dataset gevonden.",
      "P0"
    ),
    check(
      "mfa",
      "Admin MFA",
      adminUsers.length > 0 && mfaAdmins.length === adminUsers.length,
      `${mfaAdmins.length}/${adminUsers.length} admin accounts hebben MFA actief en enforced.`,
      "P0"
    ),
    check(
      "jwt_secret",
      "JWT secret",
      !isDevSecret(config.jwtSecret, "dev_only"),
      isDevSecret(config.jwtSecret, "dev_only") ? "Vervang JWT_SECRET door een lange production secret." : "Production secret ingesteld.",
      "P0"
    ),
    check(
      "encryption_key",
      "Encryptiesleutel",
      !isDevSecret(config.encryptionKey, "dev_only") && String(config.encryptionKey).length >= 32,
      "ENCRYPTION_KEY moet production-grade en minstens 32 tekens zijn.",
      "P0"
    ),
    check(
      "stripe",
      "Stripe test/live configuratie",
      isLiveStripeSecret(config.stripe.secretKey) && isLiveStripeWebhookSecret(config.stripe.webhookSecret),
      "STRIPE_SECRET_KEY moet live zijn en STRIPE_WEBHOOK_SECRET moet geldig ingesteld zijn.",
      "P0"
    ),
    check(
      "peppol",
      "Peppol provider",
      config.peppol.provider !== "mock" && !isDevSecret(config.peppol.apiKey, "dev_only"),
      "Kies echte Peppol provider en zet PEPPOL_API_KEY.",
      "P0"
    ),
    check(
      "backup_freshness",
      "Recente tenantbackups",
      backups.missing === 0 && backups.stale === 0,
      backups.missing || backups.stale
        ? `${backups.missing} tenants zonder backup en ${backups.stale} tenants met backup ouder dan ${BACKUP_STALE_DAYS} dagen.`
        : `Alle tenants hebben een backup van maximaal ${BACKUP_STALE_DAYS} dagen oud.`,
      "P0"
    ),
    check(
      "api_key_expiry",
      "API key vervaldatums",
      expiredApiKeys.length === 0,
      expiredApiKeys.length
        ? `${expiredApiKeys.length} actieve API keys zijn verlopen en moeten ingetrokken of vernieuwd worden.`
        : "Geen actieve API keys met verlopen vervaldatum.",
      "P0"
    ),
    check(
      "api_key_governance",
      "API key governance",
      noExpiryApiKeys.length === 0,
      noExpiryApiKeys.length
        ? `${noExpiryApiKeys.length} actieve API keys hebben geen vervaldatum. Voeg expiresAt toe voor pilot- en partnerkeys.`
        : "Alle actieve API keys hebben een vervaldatum.",
      "P1"
    ),
    check(
      "api_key_scopes",
      "API key scopes",
      weakScopeApiKeys.length === 0,
      weakScopeApiKeys.length
        ? `${weakScopeApiKeys.length} actieve API keys missen read of een concrete module-scope. Gebruik read + planning/workorders/billing/integrations.`
        : "Alle actieve API keys hebben read en minstens een concrete module-scope.",
      "P1"
    ),
    check(
      "integration_credentials",
      "Integratie credentials",
      missingIntegrationSecrets.length === 0,
      missingIntegrationSecrets.length
        ? `${missingIntegrationSecrets.length} actieve koppelingen missen een versleutelde secret.`
        : "Alle gekoppelde integraties hebben een secret.",
      "P1"
    ),
    check(
      "integration_sync_health",
      "Integratie sync health",
      integrationFailures === 0,
      integrationFailures
        ? `${integrationFailures} integratie sync-fouten moeten bekeken of geretryd worden.`
        : "Geen integratie sync-fouten geregistreerd.",
      "P1"
    ),
    check(
      "integration_mapping_health",
      "Integratie field mappings",
      integrationMappingIssues === 0,
      integrationMappingIssues
        ? `${integrationMappingIssues} integraties hebben ontbrekende of ongeldige field mappings.`
        : "Alle integratie field mappings zijn volledig.",
      "P1"
    ),
    check(
      "support_sla",
      "Support SLA",
      support.slaBreached === 0,
      support.slaBreached
        ? `${support.slaBreached} open supporttickets zijn buiten SLA.`
        : "Geen open supporttickets buiten SLA.",
      "P1"
    ),
    check(
      "support_critical_bug_sla",
      "Kritieke bug SLA",
      support.criticalBugSlaBreached === 0,
      support.criticalBugSlaBreached
        ? `${support.criticalBugSlaBreached} kritieke bugtickets zijn buiten 48u SLA.`
        : "Geen kritieke bugtickets buiten 48u SLA.",
      "P1"
    ),
    check(
      "support_escalation_queue",
      "Support escalaties",
      support.blockers === 0 && support.escalations === 0,
      support.blockers || support.escalations
        ? `${support.blockers} pilot blockers en ${support.escalations} SLA-escalaties open.`
        : "Geen open supportescalaties.",
      "P1"
    ),
    check(
      "app_url",
      "Publieke app URL",
      /^https:\/\//.test(config.appUrl),
      "APP_URL moet in productie een https URL zijn.",
      "P1"
    ),
    check(
      "release",
      "Release metadata",
      config.commitSha !== "local-dev" && config.releaseChannel === "production",
      "Zet COMMIT_SHA en RELEASE_CHANNEL=production in de productieomgeving.",
      "P1"
    )
  ];

  return {
    generatedAt: new Date().toISOString(),
    score: Math.round((checks.filter(row => row.ok).length / checks.length) * 100),
    blockers: checks.filter(row => !row.ok && row.priority === "P0").length,
    configRisk,
    checks
  };
}

module.exports = { productionReadiness, productionConfigRisk };
