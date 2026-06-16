const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { config } = require("../lib/config");
const { releaseInfo } = require("./releases");
const { productionReadiness, productionConfigRisk } = require("./production");
const { rateLimitSnapshot } = require("../lib/rate-limit");
const { isExpired } = require("./api-keys");
const { syncSummary, mappingSummary } = require("./integrations");

const backupDir = path.join(config.root, "data", "backups");
const dbPath = path.join(config.root, "data", "workflowpro-fullstack.json");
const TENANT_COLLECTIONS = [
  "users",
  "roles",
  "venues",
  "customers",
  "shifts",
  "workorders",
  "clocks",
  "expenses",
  "stock",
  "vehicles",
  "leaves",
  "messages",
  "notifications",
  "integrations",
  "invoices",
  "apiKeys",
  "salesLeads",
  "partners"
];
const MODULE_SCOPES = ["planning", "workorders", "billing", "integrations"];
const BACKUP_STALE_DAYS = 7;

function apiKeyRisk(apiKeys) {
  const activeKeys = (apiKeys || []).filter(key => key.status === "active");
  const now = Date.now();
  const soonLimit = now + 30 * 24 * 60 * 60 * 1000;
  return {
    total: (apiKeys || []).length,
    active: activeKeys.length,
    expired: (apiKeys || []).filter(key => key.status === "expired" || isExpired(key)).length,
    noExpiry: activeKeys.filter(key => !key.expiresAt).length,
    neverUsed: activeKeys.filter(key => !key.lastUsedAt).length,
    missingReadScope: activeKeys.filter(key => !(key.scopes || []).includes("read")).length,
    missingModuleScope: activeKeys.filter(key => !(key.scopes || []).some(scope => MODULE_SCOPES.includes(scope))).length,
    broadWriteOnly: activeKeys.filter(key => (key.scopes || []).includes("write") && !(key.scopes || []).includes("read")).length,
    deniedRequests: (apiKeys || []).reduce((total, key) => total + Number(key.deniedCount || 0), 0),
    repeatedDenials: activeKeys.filter(key => Number(key.deniedCount || 0) >= 3).length,
    expiringSoon: activeKeys.filter(key => {
      if (!key.expiresAt) return false;
      const expiry = new Date(key.expiresAt).getTime();
      return !Number.isNaN(expiry) && expiry > now && expiry <= soonLimit;
    }).length
  };
}

function integrationRisk(integrations) {
  const rows = integrations || [];
  const rowsNeedingAttention = rows.filter(row => syncSummary(row).needsAttention || mappingSummary(row).needsAttention);
  const errorCodes = rows.reduce((counts, row) => {
    for (const code of syncSummary(row).openErrorCodes) {
      counts[code] = (counts[code] || 0) + 1;
    }
    return counts;
  }, {});
  return {
    total: rows.length,
    connected: rows.filter(row => row.status === "connected").length,
    errors: rows.filter(row => row.status === "error").length,
    missingSecrets: rows.filter(row => !row.encryptedSecret).length,
    syncFailures: rows.reduce((total, row) => total + syncSummary(row).unresolvedFailures, 0),
    retryableFailures: rows.reduce((total, row) => total + syncSummary(row).retryableFailures, 0),
    invalidMappings: rows.reduce((total, row) => total + mappingSummary(row).invalid, 0),
    mappingsNeedAttention: rows.filter(row => mappingSummary(row).needsAttention).length,
    errorCodes,
    needsAttention: rowsNeedingAttention.length
  };
}

function mfaRisk(users, tenantId = null) {
  const adminUsers = (users || [])
    .filter(user => ["tenant_admin", "super_admin"].includes(user.role))
    .filter(user => tenantId ? user.tenantId === tenantId || user.role === "super_admin" : true)
    .map(user => {
      const ready = !!user.mfaEnabled && !!user.mfaEnforced;
      return {
        id: user.id,
        tenantId: user.tenantId || null,
        name: user.name,
        email: user.email,
        role: user.role,
        mfaEnabled: !!user.mfaEnabled,
        mfaEnforced: !!user.mfaEnforced,
        ready,
        action: ready ? "Geen actie nodig." : "Laat deze admin MFA setup afronden voor productie."
      };
    });
  return {
    ok: adminUsers.length > 0 && adminUsers.every(user => user.ready),
    totalAdmins: adminUsers.length,
    readyAdmins: adminUsers.filter(user => user.ready).length,
    missingMfa: adminUsers.filter(user => !user.mfaEnabled).length,
    notEnforced: adminUsers.filter(user => user.mfaEnabled && !user.mfaEnforced).length,
    rows: adminUsers
  };
}

function daysSince(value) {
  const timestamp = new Date(value || 0).getTime();
  if (Number.isNaN(timestamp) || !timestamp) return null;
  return Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
}

function backupChecksumPayload(backup) {
  return JSON.stringify({
    tenantId: backup.tenantId,
    schemaVersion: backup.schemaVersion,
    data: backup.data
  });
}

function backupChecksum(backup) {
  return crypto.createHash("sha256").update(backupChecksumPayload(backup)).digest("hex");
}

function backupIntegrity(backup) {
  if (!backup.checksum) return { checksumPresent: false, checksumValid: null };
  return {
    checksumPresent: true,
    checksumValid: backup.checksum === backupChecksum(backup)
  };
}

function backupHealth(store, tenantId = null) {
  const tenants = (store.data.tenants || [])
    .filter(tenant => !tenantId || tenant.id === tenantId)
    .map(tenant => ({ id: tenant.id, name: tenant.name }));
  const rows = tenants.map(tenant => {
    const backups = listBackups(tenant.id);
    const latest = backups[0] || null;
    const ageDays = latest ? daysSince(latest.createdAt) : null;
    const stale = ageDays == null || ageDays > BACKUP_STALE_DAYS;
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      count: backups.length,
      latestBackupAt: latest?.createdAt || null,
      latestBackupId: latest?.id || null,
      ageDays,
      stale
    };
  });
  return {
    ok: rows.every(row => row.count > 0 && !row.stale),
    staleAfterDays: BACKUP_STALE_DAYS,
    tenants: rows.length,
    missing: rows.filter(row => row.count === 0).length,
    stale: rows.filter(row => row.stale).length,
    rows
  };
}

function tenantStatus(store, tenantId) {
  const scoped = store.tenantScoped(tenantId);
  const lockedUsers = scoped.users
    .filter(user => user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now())
    .map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      failedLoginCount: user.failedLoginCount || 0,
      lockedUntil: user.lockedUntil
    }));
  const auditRows = store.data.auditLogs.filter(row => row.tenantId === tenantId);
  const errorRows = (store.data.errorEvents || []).filter(row => !row.tenantId || row.tenantId === tenantId);
  const latestAudit = auditRows.slice(-8).reverse();
  const latestErrors = errorRows.slice(-8).reverse();
  const migrations = store.migrationStatus();
  const storageStatus = store.storageStatus();
  const readiness = productionReadiness(store);
  const rateLimits = rateLimitSnapshot();
  const backups = backupHealth(store, tenantId);
  const keyRisk = apiKeyRisk(scoped.apiKeys);
  const mfa = mfaRisk(store.data.users, tenantId);
  const integrationHealth = integrationRisk(scoped.integrations);
  return {
    generatedAt: new Date().toISOString(),
    tenant: {
      id: scoped.tenant?.id,
      name: scoped.tenant?.name,
      plan: scoped.tenant?.plan,
      status: scoped.tenant?.status,
      supportAccess: scoped.tenant?.supportAccess || { enabled: false }
    },
    health: {
      api: "online",
      storage: fs.existsSync(dbPath) ? "json-store-online" : "seed-memory",
      backup: fs.existsSync(backupDir) ? "available" : "not-created",
      pwa: "enabled",
      rateLimiting: "enabled",
      errorTracking: "enabled",
      migrations: migrations.pending.length === 0 ? "up-to-date" : "pending"
    },
    rateLimits,
    backupHealth: backups,
    storage: {
      adapter: storageStatus.adapter,
      mode: storageStatus.mode,
      schemaVersion: migrations.currentVersion,
      latestSchemaVersion: migrations.latestVersion,
      migrationHistory: migrations.history,
      pendingMigrations: migrations.pending
    },
    config: {
      envLoaded: config.env.loaded,
      envKeys: config.env.keys,
      appUrl: config.appUrl,
      releaseChannel: config.releaseChannel
    },
    productionReadiness: readiness,
    apiKeyRisk: keyRisk,
    mfaRisk: mfa,
    integrationRisk: integrationHealth,
    release: releaseInfo(),
    counts: {
      users: scoped.users.length,
      lockedUsers: lockedUsers.length,
      venues: scoped.venues.length,
      planning: scoped.shifts.length,
      workorders: scoped.workorders.length,
      expenses: scoped.expenses.length,
      integrations: scoped.integrations.length,
      apiKeys: scoped.apiKeys.length,
      salesLeads: scoped.salesLeads.length,
      partners: scoped.partners.length,
      auditEvents: auditRows.length,
      errorEvents: errorRows.length
    },
    lockedUsers,
    latestAudit,
    latestErrors
  };
}

function unlockUser(store, tenant, userId, actor) {
  const user = store.get("users", userId);
  if (!user || user.tenantId !== tenant.id) {
    const error = new Error("Gebruiker niet gevonden");
    error.status = 404;
    throw error;
  }
  const row = store.update("users", userId, {
    failedLoginCount: 0,
    lockedUntil: null,
    updatedAt: new Date().toISOString()
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "account_unlocked", area: "auth", detail: userId });
  const { passwordHash, mfaSecret, mfaPendingSecret, recoveryCodes, ...safe } = row;
  return safe;
}

function backupMetadata(name) {
  const fullPath = path.join(backupDir, name);
  const stat = fs.statSync(fullPath);
  let metadata = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    metadata = {
      tenantId: parsed.tenantId,
      schemaVersion: parsed.schemaVersion,
      createdBy: parsed.createdBy,
      createdAt: parsed.createdAt,
      ...backupIntegrity(parsed)
    };
  } catch {
    metadata = {};
  }
  return {
    id: name.replace(/\.json$/, ""),
    name,
    size: stat.size,
    createdAt: metadata.createdAt || stat.birthtime.toISOString(),
    tenantId: metadata.tenantId || null,
    schemaVersion: metadata.schemaVersion || null,
    createdBy: metadata.createdBy || null,
    checksumPresent: metadata.checksumPresent || false,
    checksumValid: metadata.checksumValid ?? null
  };
}

function listBackups(tenantId) {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter(name => name.endsWith(".json"))
    .map(backupMetadata)
    .filter(row => !tenantId || row.tenantId === tenantId || row.id.startsWith(`backup_${tenantId}_`))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function backupPath(backupId) {
  const safeId = String(backupId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(backupDir, `${safeId}.json`);
}

function readBackup(backupId) {
  const fullPath = backupPath(backupId);
  if (!fullPath.startsWith(backupDir) || !fs.existsSync(fullPath)) {
    const error = new Error("Backup niet gevonden");
    error.status = 404;
    throw error;
  }
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function tenantCounts(data, tenantId) {
  return TENANT_COLLECTIONS.reduce((counts, collection) => {
    counts[collection] = (data[collection] || []).filter(row => row.tenantId === tenantId).length;
    return counts;
  }, {});
}

function backupPreview(store, tenant, backupId) {
  const backup = readBackup(backupId);
  if (backup.tenantId !== tenant.id) {
    const error = new Error("Backup hoort niet bij deze tenant");
    error.status = 403;
    throw error;
  }
  return {
    id: backup.id,
    createdAt: backup.createdAt,
    createdBy: backup.createdBy,
    tenantId: backup.tenantId,
    schemaVersion: backup.schemaVersion,
    integrity: backupIntegrity(backup),
    currentCounts: tenantCounts(store.data, tenant.id),
    backupCounts: tenantCounts(backup.data || {}, tenant.id)
  };
}

function createBackup(store, tenant, actor) {
  fs.mkdirSync(backupDir, { recursive: true });
  const id = `backup_${tenant.id}_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const fullPath = path.join(backupDir, `${id}.json`);
  const data = {
    schemaVersion: store.data.schemaVersion,
    tenants: (store.data.tenants || []).filter(row => row.id === tenant.id)
  };
  for (const collection of TENANT_COLLECTIONS) {
    data[collection] = (store.data[collection] || []).filter(row => row.tenantId === tenant.id);
  }
  const payload = {
    id,
    createdAt: new Date().toISOString(),
    createdBy: actor.email,
    tenantId: tenant.id,
    schemaVersion: store.data.schemaVersion,
    data
  };
  payload.checksum = backupChecksum(payload);
  fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2));
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "backup_created", area: "admin", detail: id });
  return { id, name: `${id}.json`, size: fs.statSync(fullPath).size, createdAt: payload.createdAt, checksumPresent: true, checksumValid: true };
}

function restoreBackup(store, tenant, backupId, actor, confirm) {
  if (confirm !== "RESTORE") {
    const error = new Error("Restore vereist confirm: RESTORE");
    error.status = 400;
    throw error;
  }
  const preview = backupPreview(store, tenant, backupId);
  if (preview.integrity.checksumValid === false) {
    const error = new Error("Backup integriteitscontrole faalt");
    error.status = 409;
    throw error;
  }
  const backup = readBackup(backupId);
  const backupData = backup.data || {};
  const backupTenant = (backupData.tenants || []).find(row => row.id === tenant.id);
  if (!backupTenant) {
    const error = new Error("Tenant ontbreekt in backup");
    error.status = 400;
    throw error;
  }

  store.data.tenants = (store.data.tenants || []).map(row => (row.id === tenant.id ? backupTenant : row));
  for (const collection of TENANT_COLLECTIONS) {
    const currentRows = store.data[collection] || [];
    const backupRows = backupData[collection] || [];
    store.data[collection] = [
      ...currentRows.filter(row => row.tenantId !== tenant.id),
      ...backupRows.filter(row => row.tenantId === tenant.id)
    ];
  }
  store.save();
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "backup_restored", area: "admin", detail: backupId });
  return {
    restoredAt: new Date().toISOString(),
    restoredBy: actor.email,
    backup: preview
  };
}

function publicStatus(store) {
  const migrations = store.migrationStatus();
  const storageStatus = store.storageStatus();
  const readiness = productionReadiness(store);
  const rateLimits = rateLimitSnapshot();
  const backups = backupHealth(store);
  const mfa = mfaRisk(store.data.users);
  const configRisk = productionConfigRisk();
  return {
    ok: true,
    app: "WorkFlow Pro",
    status: "operational",
    generatedAt: new Date().toISOString(),
    tenants: store.data.tenants.length,
    release: releaseInfo(),
    storage: {
      adapter: storageStatus.adapter,
      mode: storageStatus.mode,
      schemaVersion: migrations.currentVersion,
      latestSchemaVersion: migrations.latestVersion,
      migrations: migrations.pending.length === 0 ? "up-to-date" : "pending"
    },
    rateLimits: {
      activeBuckets: rateLimits.activeBuckets,
      policies: rateLimits.policies
    },
    backupHealth: {
      ok: backups.ok,
      missing: backups.missing,
      stale: backups.stale,
      staleAfterDays: backups.staleAfterDays
    },
    mfaRisk: {
      ok: mfa.ok,
      totalAdmins: mfa.totalAdmins,
      readyAdmins: mfa.readyAdmins,
      missingMfa: mfa.missingMfa,
      notEnforced: mfa.notEnforced
    },
    configRisk: {
      ok: configRisk.ok,
      ready: configRisk.ready,
      missing: configRisk.missing,
      total: configRisk.total
    },
    productionReadiness: {
      score: readiness.score,
      blockers: readiness.blockers
    },
    modules: [
      { name: "API", status: "operational" },
      { name: "Auth", status: "operational" },
      { name: "Storage", status: fs.existsSync(dbPath) ? "operational" : "degraded" },
      { name: "Migrations", status: migrations.pending.length === 0 ? "operational" : "pending" },
      { name: "PWA", status: "operational" },
      { name: "Rate limiting", status: "operational" },
      { name: "Error tracking", status: "operational" },
      { name: "Integrations", status: "mock-ready" },
      { name: "Billing", status: "testmode" }
    ]
  };
}

module.exports = { tenantStatus, unlockUser, listBackups, createBackup, backupPreview, restoreBackup, backupHealth, mfaRisk, publicStatus };
