const { isExpired } = require("./api-keys");

const MODULE_SCOPES = ["planning", "workorders", "billing", "integrations"];

function issue(priority, code, detail, action) {
  return { priority, code, detail, action };
}

function keyIssue(row) {
  const scopes = row.scopes || [];
  const issues = [];
  if (row.status === "active" && isExpired(row)) {
    issues.push(issue("P0", "expired", "Actieve key is verlopen.", "Roteer de key en trek de verlopen key in."));
  }
  if (!scopes.some(scope => ["read", "write"].includes(scope))) {
    issues.push(issue("P0", "missing_access_scope", "Mist read of write scope.", "Maak een nieuwe key met read voor lezen of write voor wijzigingen."));
  }
  if (!scopes.some(scope => MODULE_SCOPES.includes(scope))) {
    issues.push(issue("P0", "missing_module_scope", "Mist concrete module-scope.", "Maak een nieuwe key met planning, workorders, billing of integrations."));
  }
  if (!row.expiresAt) {
    issues.push(issue("P1", "missing_expiry", "Mist vervaldatum.", "Roteer de key met een vervaldatum, standaard 90 dagen."));
  }
  if (row.status === "active" && !row.lastUsedAt) {
    issues.push(issue("P1", "never_used", "Actieve key is nog nooit gebruikt.", "Bevestig met de partner of trek de ongebruikte key in."));
  }
  if (Number(row.deniedCount || 0) >= 3) {
    issues.push(issue("P1", "repeated_denials", "Key heeft herhaalde geweigerde requests.", "Controleer scopes en endpointgebruik met de integratiepartner."));
  }
  return issues;
}

function safeKey(row) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    label: row.label,
    prefix: row.prefix,
    status: row.status,
    scopes: row.scopes || [],
    expiresAt: row.expiresAt || null,
    lastUsedAt: row.lastUsedAt || null,
    deniedCount: Number(row.deniedCount || 0)
  };
}

function apiKeyGovernance(store, options = {}) {
  const tenantId = options.tenantId || "";
  const strict = !!options.strict;
  const keys = (store.data.apiKeys || [])
    .filter(row => !tenantId || row.tenantId === tenantId)
    .filter(row => row.status !== "revoked");
  const rows = keys.map(row => ({
    key: safeKey(row),
    issues: keyIssue(row)
  }));
  const openP0 = rows.flatMap(row => row.issues.filter(issue => issue.priority === "P0").map(issue => ({ ...issue, key: row.key })));
  const openP1 = rows.flatMap(row => row.issues.filter(issue => issue.priority === "P1").map(issue => ({ ...issue, key: row.key })));

  return {
    ok: openP0.length === 0 && (!strict || openP1.length === 0),
    strict,
    tenantId: tenantId || null,
    generatedAt: new Date().toISOString(),
    checked: keys.length,
    blockers: openP0.length,
    warnings: openP1.length,
    rows,
    openP0,
    openP1
  };
}

module.exports = { apiKeyGovernance, keyIssue, safeKey, MODULE_SCOPES };
