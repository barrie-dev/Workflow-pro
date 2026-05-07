const { encryptSecret } = require("../lib/security");

const DEFAULT_MAPPINGS = {
  robaws: [
    { local: "workorders.title", remote: "project.name", direction: "push" },
    { local: "workorders.billable_hours", remote: "time_entries.hours", direction: "push" },
    { local: "customers.vat", remote: "client.vat_number", direction: "both" }
  ],
  exact: [
    { local: "invoices.invoice_number", remote: "sales_invoice.number", direction: "push" },
    { local: "expenses.amount", remote: "purchase.amount", direction: "push" }
  ],
  generic: [
    { local: "customers.name", remote: "account.name", direction: "both" }
  ]
};

const ALLOWED_DIRECTIONS = ["push", "pull", "both"];

function validateMappings(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    const error = new Error("Minstens één field mapping is vereist");
    error.status = 400;
    throw error;
  }
  return rows.map((row, index) => {
    const local = String(row.local || "").trim();
    const remote = String(row.remote || "").trim();
    const direction = ALLOWED_DIRECTIONS.includes(row.direction) ? row.direction : "both";
    if (!local || !remote) {
      const error = new Error(`Mapping lijn ${index + 1} mist local of remote veld`);
      error.status = 400;
      throw error;
    }
    return { local, remote, direction };
  });
}

function mappingSummary(row) {
  const rows = row?.config?.fieldMapping || [];
  const invalidRows = Array.isArray(rows)
    ? rows.filter(mapping => !String(mapping.local || "").trim() || !String(mapping.remote || "").trim())
    : [];
  return {
    total: Array.isArray(rows) ? rows.length : 0,
    invalid: !Array.isArray(rows) ? 1 : invalidRows.length,
    valid: Array.isArray(rows) ? rows.length - invalidRows.length : 0,
    needsAttention: !Array.isArray(rows) || rows.length === 0 || invalidRows.length > 0
  };
}

function syncSummary(row) {
  const logs = Array.isArray(row.syncLogs) ? row.syncLogs : [];
  const failures = logs.filter(log => log.status === "failed");
  const resolvedFailureIds = new Set(logs.filter(log => log.status === "success" && log.retryOf).map(log => log.retryOf));
  const unresolvedFailureRows = failures.filter(log => !resolvedFailureIds.has(log.id));
  return {
    total: logs.length,
    success: logs.filter(log => log.status === "success").length,
    failed: failures.length,
    unresolvedFailures: unresolvedFailureRows.length,
    retryableFailures: unresolvedFailureRows.length,
    openErrorCodes: Array.from(new Set(unresolvedFailureRows.map(log => log.errorCode).filter(Boolean))),
    retries: logs.filter(log => !!log.retryOf).length,
    lastStatus: logs[0]?.status || "never",
    lastErrorCode: logs[0]?.errorCode || "",
    lastMessage: logs[0]?.message || "",
    lastSyncAt: row.lastSyncAt || logs[0]?.at || null,
    needsAttention: row.status === "error" || unresolvedFailureRows.length > 0
  };
}

function syncLogsWithResolution(row) {
  const logs = Array.isArray(row.syncLogs) ? row.syncLogs : [];
  const resolvedFailureIds = new Set(logs.filter(log => log.status === "success" && log.retryOf).map(log => log.retryOf));
  return logs.map(log => ({
    ...log,
    resolved: log.status === "failed" ? resolvedFailureIds.has(log.id) : false,
    retryable: log.status === "failed" && !resolvedFailureIds.has(log.id)
  }));
}

function publicIntegration(row) {
  const { encryptedSecret, secret, apiKey, ...safe } = row;
  return {
    ...safe,
    syncLogs: syncLogsWithResolution(row),
    hasSecret: !!encryptedSecret,
    syncSummary: syncSummary(row),
    mappingSummary: mappingSummary(row)
  };
}

function listIntegrations(store, tenantId) {
  return store.list("integrations", tenantId).map(publicIntegration);
}

function connectIntegration(store, tenant, payload, actor) {
  const provider = payload.provider || "robaws";
  const existing = store.list("integrations", tenant.id).find(row => row.provider === provider);
  const fieldMapping = validateMappings(payload.fieldMapping || DEFAULT_MAPPINGS[provider] || DEFAULT_MAPPINGS.generic);
  const patch = {
    provider,
    tenantId: tenant.id,
    status: "connected",
    label: payload.label || provider.toUpperCase(),
    config: {
      environment: payload.environment || "test",
      baseUrl: payload.baseUrl || "",
      fieldMapping
    },
    encryptedSecret: payload.apiKey ? encryptSecret(payload.apiKey) : existing?.encryptedSecret || "",
    lastError: "",
    updatedAt: new Date().toISOString()
  };
  const row = existing
    ? store.update("integrations", existing.id, patch)
    : store.insert("integrations", { id: `integration_${Date.now()}_${Math.random().toString(16).slice(2)}`, syncLogs: [], ...patch });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "integration_connected", area: "integrations", detail: provider });
  return publicIntegration(row);
}

function updateMapping(store, tenant, integrationId, payload, actor) {
  const integration = store.get("integrations", integrationId);
  if (!integration || integration.tenantId !== tenant.id) {
    const error = new Error("Integratie niet gevonden");
    error.status = 404;
    throw error;
  }
  const row = store.update("integrations", integrationId, {
    config: {
      ...(integration.config || {}),
      fieldMapping: validateMappings(payload.fieldMapping)
    },
    updatedAt: new Date().toISOString()
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "integration_mapping_updated", area: "integrations", detail: integration.provider });
  return publicIntegration(row);
}

function runSync(store, tenant, integrationId, actor, retryOf = "") {
  const integration = store.get("integrations", integrationId);
  if (!integration || integration.tenantId !== tenant.id) {
    const error = new Error("Integratie niet gevonden");
    error.status = 404;
    throw error;
  }
  if (!integration.encryptedSecret) {
    const log = {
      id: `sync_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      status: "failed",
      errorCode: "missing_secret",
      retryOf,
      pushed: { workorders: 0, invoices: 0, expenses: 0 },
      pulled: { customers: 0, venues: 0 },
      message: "API secret ontbreekt. Voeg een geldige sleutel toe en probeer opnieuw."
    };
    const logs = [log, ...(integration.syncLogs || [])].slice(0, 20);
    const row = store.update("integrations", integrationId, {
      status: "error",
      lastSyncAt: log.at,
      lastError: log.message,
      syncLogs: logs
    });
    store.audit({
      actor: actor.email,
      tenantId: tenant.id,
      action: "integration_sync_failed",
      area: "integrations",
      detail: `${integration.provider}: ${log.message}`
    });
    return { integration: publicIntegration(row), log };
  }
  const mappings = mappingSummary(integration);
  if (mappings.needsAttention) {
    const log = {
      id: `sync_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      status: "failed",
      errorCode: "invalid_mapping",
      retryOf,
      pushed: { workorders: 0, invoices: 0, expenses: 0 },
      pulled: { customers: 0, venues: 0 },
      message: `Field mapping ongeldig: ${mappings.invalid} fouten, ${mappings.total} regels`
    };
    const logs = [log, ...(integration.syncLogs || [])].slice(0, 20);
    const row = store.update("integrations", integrationId, {
      status: "error",
      lastSyncAt: log.at,
      lastError: log.message,
      syncLogs: logs
    });
    store.audit({
      actor: actor.email,
      tenantId: tenant.id,
      action: "integration_sync_failed",
      area: "integrations",
      detail: `${integration.provider}: ${log.message}`
    });
    return { integration: publicIntegration(row), log };
  }
  const rows = store.tenantScoped(tenant.id);
  const log = {
    id: `sync_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    status: "success",
    retryOf,
    pushed: {
      workorders: rows.workorders.length,
      invoices: (rows.tenant?.billingOps?.invoiceHistory || []).length + rows.invoices.length,
      expenses: rows.expenses.length
    },
    pulled: {
      customers: rows.customers.length,
      venues: rows.venues.length
    },
    message: "Mock sync voltooid"
  };
  const logs = [log, ...(integration.syncLogs || [])].slice(0, 20);
  const row = store.update("integrations", integrationId, {
    status: "connected",
    lastSyncAt: log.at,
    lastError: "",
    syncLogs: logs
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: retryOf ? "integration_sync_retried" : "integration_sync_run", area: "integrations", detail: integration.provider });
  return { integration: publicIntegration(row), log };
}

function retrySync(store, tenant, integrationId, syncId, actor) {
  const integration = store.get("integrations", integrationId);
  if (!integration || integration.tenantId !== tenant.id) {
    const error = new Error("Integratie niet gevonden");
    error.status = 404;
    throw error;
  }
  if (!syncId) {
    const error = new Error("syncId is verplicht voor retry");
    error.status = 400;
    throw error;
  }
  const logs = integration.syncLogs || [];
  const target = logs.find(log => log.id === syncId);
  if (!target) {
    const error = new Error("Sync log niet gevonden");
    error.status = 404;
    throw error;
  }
  if (target.status !== "failed") {
    const error = new Error("Alleen failed sync logs kunnen opnieuw geprobeerd worden");
    error.status = 400;
    throw error;
  }
  const existingRetry = logs.find(log => log.status === "success" && log.retryOf === syncId);
  if (existingRetry) {
    store.audit({ actor: actor.email, tenantId: tenant.id, action: "integration_retry_duplicate", area: "integrations", detail: `${integration.provider}: ${syncId}` });
    return { integration: publicIntegration(integration), log: existingRetry, duplicate: true };
  }
  return runSync(store, tenant, integrationId, actor, syncId);
}

module.exports = { listIntegrations, connectIntegration, updateMapping, runSync, retrySync, syncSummary, syncLogsWithResolution, mappingSummary, validateMappings };
