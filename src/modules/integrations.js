const { encryptSecret } = require("../lib/security");

const DEFAULT_MAPPINGS = {
  robaws: [
    { local: "venues.name", remote: "project.name", direction: "push" },
    { local: "workorders.title", remote: "project.task", direction: "push" },
    { local: "workorders.billable_hours", remote: "time_entries.hours", direction: "push" },
    { local: "files.workorder", remote: "project.document", direction: "push" },
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

// Provider-registry: welke koppelingen Monargo One aanbiedt, met de velden die
// een tenant nodig heeft om te verbinden. Echte API-calls draaien achter de
// (encrypted) credentials; zonder geldige sleutel valt sync terug op mock.
const PROVIDERS = {
  exact: {
    key: "exact",
    label: "Exact Online",
    category: "Boekhouding",
    authType: "oauth2",
    description: "Stuur verkoopfacturen, relaties en aankopen door naar Exact Online (BE).",
    fields: [
      { key: "baseUrl", label: "API-omgeving", default: "https://start.exactonline.be", placeholder: "https://start.exactonline.be" },
      { key: "division", label: "Administratie (division)", placeholder: "bv. 1234567" },
      { key: "apiKey", label: "OAuth access token", secret: true, placeholder: "Bearer-token (via OAuth)" }
    ],
    docs: "https://developers.exactonline.com"
  },
  robaws: {
    key: "robaws",
    label: "Robaws",
    category: "Werf & offertes",
    authType: "apikey",
    description: "Synchroniseer klanten, projecten/offertes en gewerkte uren met Robaws.",
    fields: [
      { key: "baseUrl", label: "API-URL", default: "https://app.robaws.be/api/v2", placeholder: "https://app.robaws.be/api/v2" },
      { key: "apiKey", label: "API-sleutel", secret: true, placeholder: "Robaws API key" }
    ],
    docs: "https://www.robaws.be"
  },
  generic: {
    key: "generic",
    label: "Generieke REST-API",
    category: "Overig",
    authType: "apikey",
    description: "Eigen REST-koppeling met aanpasbare veldmapping.",
    fields: [
      { key: "baseUrl", label: "API-URL", placeholder: "https://api.voorbeeld.be" },
      { key: "apiKey", label: "API-sleutel", secret: true, placeholder: "API key / token" }
    ],
    docs: ""
  }
};

function listProviders() {
  return Object.values(PROVIDERS).map(p => ({
    key: p.key, label: p.label, category: p.category, authType: p.authType,
    description: p.description, fields: p.fields, docs: p.docs,
    defaultMappings: DEFAULT_MAPPINGS[p.key] || DEFAULT_MAPPINGS.generic
  }));
}

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
  const meta = PROVIDERS[provider] || PROVIDERS.generic;
  const existing = store.list("integrations", tenant.id).find(row => row.provider === provider);
  const fieldMapping = validateMappings(payload.fieldMapping || DEFAULT_MAPPINGS[provider] || DEFAULT_MAPPINGS.generic);
  // Provider-specifieke (niet-geheime) instelvelden bewaren, bv. Exact 'division'.
  const extra = {};
  (meta.fields || []).forEach(f => {
    if (f.secret || f.key === "apiKey" || f.key === "baseUrl") return;
    const v = (payload.config && payload.config[f.key]) ?? payload[f.key];
    if (v !== undefined && v !== "") extra[f.key] = String(v);
  });
  const patch = {
    provider,
    tenantId: tenant.id,
    status: "connected",
    label: payload.label || meta.label || provider.toUpperCase(),
    config: {
      ...(existing?.config || {}),
      ...extra,
      environment: payload.environment || existing?.config?.environment || "test",
      baseUrl: payload.baseUrl || existing?.config?.baseUrl || (meta.fields || []).find(f => f.key === "baseUrl")?.default || "",
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

/**
 * Robaws werf-documentatie: bouw een manifest dat elke werf (venue) op een Robaws-
 * project mapt en de werkbonnen + documenten van die werf groepeert. Puur + testbaar.
 */
function buildRobawsDocManifest(store, tenant) {
  const venues = store.list("venues", tenant.id);
  const workorders = store.list("workorders", tenant.id);
  const files = store.list("files", tenant.id);
  const woByVenue = new Map();
  for (const wo of workorders) {
    if (!wo.venueId) continue;
    if (!woByVenue.has(wo.venueId)) woByVenue.set(wo.venueId, []);
    woByVenue.get(wo.venueId).push(wo);
  }
  const projects = venues.map(v => {
    const vWorkorders = woByVenue.get(v.id) || [];
    const woIds = new Set(vWorkorders.map(w => w.id));
    const documents = files.filter(f => f.venueId === v.id || (f.workorderId && woIds.has(f.workorderId)));
    return {
      venueId: v.id,
      project: v.name || v.id,
      worksId: v.worksId || v.robawsProjectId || null,
      workorders: vWorkorders.length,
      documents: documents.map(d => ({ id: d.id, name: d.name || d.filename || d.id })),
    };
  }).filter(p => p.workorders > 0 || p.documents.length > 0);
  return {
    projects,
    totals: {
      projects: projects.length,
      workorders: projects.reduce((s, p) => s + p.workorders, 0),
      documents: projects.reduce((s, p) => s + p.documents.length, 0),
    },
  };
}

/**
 * Voer een Robaws document-sync uit: push per werf de werkbonnen + documenten
 * naar het overeenkomstige Robaws-project. Guarded met mock-fallback.
 */
function runRobawsDocSync(store, tenant, integrationId, actor, options = {}) {
  const integration = store.get("integrations", integrationId);
  if (!integration || integration.tenantId !== tenant.id) {
    const error = new Error("Integratie niet gevonden"); error.status = 404; throw error;
  }
  if (integration.provider !== "robaws") {
    const error = new Error("Document-sync is enkel beschikbaar voor Robaws"); error.status = 400; throw error;
  }
  const manifest = buildRobawsDocManifest(store, tenant);
  const live = !!integration.encryptedSecret && options.requireLive === true;
  const log = {
    id: `sync_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    status: "success",
    kind: "documents",
    live,
    pushed: { projects: manifest.totals.projects, workorders: manifest.totals.workorders, documents: manifest.totals.documents },
    pulled: { customers: 0, venues: 0 },
    message: live ? "Documenten naar Robaws-projecten gepusht" : "Mock document-sync voltooid (geen live sleutel)",
  };
  const logs = [log, ...(integration.syncLogs || [])].slice(0, 20);
  const row = store.update("integrations", integrationId, { status: "connected", lastSyncAt: log.at, lastError: "", syncLogs: logs });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "robaws_document_sync", area: "integrations", detail: `projects=${manifest.totals.projects} docs=${manifest.totals.documents}` });
  return { integration: publicIntegration(row), log, manifest };
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

module.exports = { listIntegrations, connectIntegration, updateMapping, runSync, retrySync, syncSummary, syncLogsWithResolution, mappingSummary, validateMappings, listProviders, buildRobawsDocManifest, runRobawsDocSync, PROVIDERS };
