const crypto = require("crypto");

const ALLOWED_SCOPES = ["read", "write", "planning", "workorders", "billing", "integrations"];
const MODULE_SCOPES = ["planning", "workorders", "billing", "integrations"];
const DEFAULT_EXPIRY_DAYS = 90;

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function scopesToPermissions(scopes) {
  const permissions = new Set();
  for (const scope of scopes || []) {
    if (scope === "planning") ["planning", "employees", "venues", "customers"].forEach(item => permissions.add(item));
    if (scope === "workorders") ["workorders", "clockings", "expenses"].forEach(item => permissions.add(item));
    if (scope === "billing") permissions.add("billing");
    if (scope === "integrations") permissions.add("integrations");
  }
  return Array.from(permissions);
}

function publicKey(row) {
  const { hash, ...safe } = row;
  return safe;
}

function normalizeExpiry(value) {
  const raw = value || new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    const error = new Error("Ongeldige vervaldatum voor API key");
    error.status = 400;
    throw error;
  }
  if (date.getTime() <= Date.now()) {
    const error = new Error("API key vervaldatum moet in de toekomst liggen");
    error.status = 400;
    throw error;
  }
  return date.toISOString();
}

function isExpired(row, now = new Date()) {
  if (!row.expiresAt) return false;
  const expiry = new Date(row.expiresAt);
  return !Number.isNaN(expiry.getTime()) && expiry <= now;
}

function normalizeScopes(value) {
  const scopes = Array.isArray(value)
    ? value.filter(scope => ALLOWED_SCOPES.includes(scope))
    : String(value || "").split(",").map(scope => scope.trim()).filter(scope => ALLOWED_SCOPES.includes(scope));
  const uniqueScopes = Array.from(new Set(scopes));
  if (!uniqueScopes.some(scope => ["read", "write"].includes(scope))) {
    const error = new Error("API key vereist minstens read of write scope");
    error.status = 400;
    throw error;
  }
  if (!uniqueScopes.some(scope => MODULE_SCOPES.includes(scope))) {
    const error = new Error("API key vereist minstens een concrete module-scope");
    error.status = 400;
    throw error;
  }
  return uniqueScopes;
}

function listApiKeys(store, tenantId) {
  return store.list("apiKeys", tenantId)
    .map(row => ({ ...publicKey(row), expired: isExpired(row) }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function createApiKey(store, tenant, payload, actor) {
  const token = `wfp_${crypto.randomBytes(24).toString("base64url")}`;
  const scopes = normalizeScopes(payload.scopes);
  const row = store.insert("apiKeys", {
    id: `api_key_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    tenantId: tenant.id,
    label: payload.label || "Nieuwe API key",
    prefix: token.slice(0, 12),
    hash: tokenHash(token),
    scopes,
    status: "active",
    createdAt: new Date().toISOString(),
    createdBy: actor.email,
    expiresAt: normalizeExpiry(payload.expiresAt),
    lastUsedAt: null,
    lastUsedPath: null,
    lastUsedMethod: null,
    usageCount: 0,
    revokedAt: null,
    revokedBy: null
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "api_key_created", area: "api_keys", detail: row.label });
  return { key: publicKey(row), token };
}

function revokeApiKey(store, tenant, keyId, actor) {
  const existing = store.get("apiKeys", keyId);
  if (!existing || existing.tenantId !== tenant.id) {
    const error = new Error("API key niet gevonden");
    error.status = 404;
    throw error;
  }
  const row = store.update("apiKeys", keyId, {
    status: "revoked",
    revokedAt: new Date().toISOString(),
    revokedBy: actor.email
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "api_key_revoked", area: "api_keys", detail: existing.label });
  return publicKey(row);
}

function rotateApiKey(store, tenant, keyId, payload, actor) {
  const existing = store.get("apiKeys", keyId);
  if (!existing || existing.tenantId !== tenant.id) {
    const error = new Error("API key niet gevonden");
    error.status = 404;
    throw error;
  }
  if (existing.status === "revoked") {
    const error = new Error("Ingetrokken API key kan niet geroteerd worden");
    error.status = 400;
    throw error;
  }
  const rotated = createApiKey(store, tenant, {
    label: payload.label || `${existing.label} rotatie`,
    scopes: payload.scopes || existing.scopes || ["read"],
    expiresAt: payload.expiresAt || null
  }, actor);
  const revoked = store.update("apiKeys", existing.id, {
    status: "revoked",
    revokedAt: new Date().toISOString(),
    revokedBy: actor.email,
    rotatedTo: rotated.key.id
  });
  store.audit({
    actor: actor.email,
    tenantId: tenant.id,
    action: "api_key_rotated",
    area: "api_keys",
    detail: `${existing.label} -> ${rotated.key.prefix}`
  });
  return { rotatedFrom: publicKey(revoked), rotatedTo: rotated.key, token: rotated.token };
}

function recordApiKeyDenied(store, user, metadata = {}, reason = "denied") {
  if (!user?.apiKeyId) return null;
  const row = store.get("apiKeys", user.apiKeyId);
  if (!row) return null;
  const deniedAt = new Date().toISOString();
  const updated = store.update("apiKeys", row.id, {
    lastDeniedAt: deniedAt,
    lastDeniedPath: metadata.path || row.lastDeniedPath || null,
    lastDeniedMethod: metadata.method || row.lastDeniedMethod || null,
    lastDeniedReason: reason,
    deniedCount: Number(row.deniedCount || 0) + 1
  });
  store.audit({
    actor: `api-key:${row.prefix}`,
    tenantId: row.tenantId,
    action: "api_key_request_denied",
    area: "api_keys",
    detail: `${reason}: ${metadata.method || "GET"} ${metadata.path || "unknown"}`
  });
  return publicKey(updated);
}

function authenticateApiKey(store, token, metadata = {}) {
  const value = String(token || "").trim();
  if (!value.startsWith("wfp_")) return null;
  const hash = tokenHash(value);
  const row = (store.data.apiKeys || []).find(key => key.status === "active" && safeEqual(key.hash, hash));
  if (!row) return null;
  if (isExpired(row)) {
    const expiredAt = new Date().toISOString();
    store.update("apiKeys", row.id, {
      status: "expired",
      expiredAt,
      lastFailedAt: expiredAt,
      lastFailedPath: metadata.path || row.lastFailedPath || null,
      lastFailedMethod: metadata.method || row.lastFailedMethod || null
    });
    store.audit({
      actor: `api-key:${row.prefix}`,
      tenantId: row.tenantId,
      action: "api_key_expired_rejected",
      area: "api_keys",
      detail: `${metadata.method || "GET"} ${metadata.path || "unknown"}`
    });
    return null;
  }
  const usedAt = new Date().toISOString();
  store.update("apiKeys", row.id, {
    lastUsedAt: usedAt,
    lastUsedPath: metadata.path || row.lastUsedPath || null,
    lastUsedMethod: metadata.method || row.lastUsedMethod || null,
    usageCount: Number(row.usageCount || 0) + 1
  });
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: `API key: ${row.label}`,
    email: `api-key:${row.prefix}`,
    role: "api_client",
    permissions: scopesToPermissions(row.scopes),
    active: true,
    authType: "api_key",
    apiKeyId: row.id,
    apiKeyScopes: row.scopes || [],
    apiKeyUsageCount: Number(row.usageCount || 0) + 1
  };
}

module.exports = {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  rotateApiKey,
  authenticateApiKey,
  recordApiKeyDenied,
  isExpired,
  normalizeExpiry
};
