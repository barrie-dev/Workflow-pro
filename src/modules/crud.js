const { assertCan, assertTenant, assertSuperAdmin } = require("../lib/auth");
const { encryptSecret, hashPassword, assertStrongPassword } = require("../lib/security");
const { applyExpenseDefaults } = require("./expense-rules");
const { validatePlanningRules } = require("./planning-rules");
const { moduleByKey } = require("./registry");

function actorTenant(user, explicitTenantId) {
  return user.role === "super_admin" ? explicitTenantId : user.tenantId;
}

function publicRow(key, row) {
  if (key === "integrations") {
    const { encryptedSecret, encrypted_secret, secret, apiKey, ...safe } = row;
    return { ...safe, hasSecret: !!(encryptedSecret || encrypted_secret) };
  }
  if (key !== "users") return row;
  const { passwordHash, mfaSecret, recoveryCodes, ...safe } = row;
  return safe;
}

// Privilege-gevoelige velden mogen NOOIT via de generieke module-CRUD gezet
// worden: rol/rechten/platform-vlaggen horen uitsluitend via de dedicated
// /employees-endpoint te lopen (dat saneert en cl'ampt rollen). Zonder deze
// strip kan een gebruiker met 'employees'-recht zichzelf tot super_admin
// promoveren via PATCH /api/modules/users/:id.
const PRIVILEGED_USER_FIELDS = [
  "role", "permissions", "protected", "platformScopes",
  "mfaEnabled", "mfaEnforced", "mfaSecret", "mfaPendingSecret",
  "recoveryCodes", "passwordHash", "failedLoginCount", "lockedUntil"
];

function normalizePayload(key, payload) {
  const next = { ...payload };
  if (key === "users") {
    for (const field of PRIVILEGED_USER_FIELDS) delete next[field];
    if (payload.password) {
      assertStrongPassword(payload.password);
      next.passwordHash = hashPassword(payload.password);
      delete next.password;
    }
  }
  if (key === "integrations") {
    const secret = payload.secret || payload.apiKey || payload.encryptedSecret;
    if (secret) next.encryptedSecret = encryptSecret(secret);
    delete next.secret;
    delete next.apiKey;
    delete next.encrypted_secret;
  }
  return next;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function requireField(payload, field, label = field) {
  if (!String(payload[field] || "").trim()) badRequest(`${label} is required`);
}

function validatePayload(key, payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  if (key === "users") {
    requireField(merged, "name", "Name");
    requireField(merged, "email", "Email");
    if (!String(merged.email).includes("@")) badRequest("Valid email is required");
  }
  if (key === "venues") requireField(merged, "name", "Venue name");
  if (key === "planning") {
    requireField(merged, "userId", "Employee");
    requireField(merged, "venueId", "Venue");
    requireField(merged, "date", "Date");
    requireField(merged, "start", "Start time");
    requireField(merged, "end", "End time");
  }
  if (key === "workorders") {
    requireField(merged, "title", "Workorder title");
    requireField(merged, "userId", "Employee");
  }
  if (key === "expenses") {
    requireField(merged, "title", "Expense title");
    requireField(merged, "category", "Category");
    if (Number.isNaN(Number(merged.amount)) || Number(merged.amount) < 0) badRequest("Valid expense amount is required");
  }
  if (key === "sales") {
    requireField(merged, "company", "Company");
    requireField(merged, "contactEmail", "Contact email");
    if (!String(merged.contactEmail).includes("@")) badRequest("Valid contact email is required");
  }
  if (key === "partners") {
    requireField(merged, "name", "Partner name");
    requireField(merged, "contactEmail", "Contact email");
    if (!String(merged.contactEmail).includes("@")) badRequest("Valid contact email is required");
  }
}

function listModule(store, user, key, tenantId) {
  const mod = moduleByKey(key);
  if (!mod) {
    const error = new Error("Unknown module");
    error.status = 404;
    throw error;
  }
  assertCan(user, mod.permission);
  if (key === "audit" && user.role !== "super_admin") {
    return store.list(mod.collection).filter(row => row.tenantId === user.tenantId);
  }
  if (key === "tenants" && user.role !== "super_admin") {
    return store.list(mod.collection).filter(tenant => tenant.id === user.tenantId);
  }
  if (!mod.tenantScoped) return store.list(mod.collection);
  const scopedTenant = actorTenant(user, tenantId);
  assertTenant(user, scopedTenant);
  return store.list(mod.collection, scopedTenant).map(row => publicRow(key, row));
}

function createModuleRow(store, user, key, tenantId, payload) {
  const mod = moduleByKey(key);
  if (!mod) {
    const error = new Error("Unknown module");
    error.status = 404;
    throw error;
  }
  assertCan(user, mod.permission);
  if (key === "tenants") assertSuperAdmin(user);
  const normalized = normalizePayload(key, payload);
  validatePayload(key, normalized);
  const scopedTenant = mod.tenantScoped ? actorTenant(user, tenantId || normalized.tenantId) : normalized.tenantId || null;
  if (mod.tenantScoped && !scopedTenant) badRequest("Tenant is required");
  if (mod.tenantScoped) assertTenant(user, scopedTenant);
  if (key === "planning") validatePlanningRules(store, scopedTenant, normalized);
  const row = {
    id: normalized.id || `${mod.collection}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    ...normalized,
    ...(mod.tenantScoped ? { tenantId: scopedTenant } : {})
  };
  if (key === "users") {
    row.active = row.active !== false;
    // Rol/rechten zijn gestript uit de payload (zie PRIVILEGED_USER_FIELDS):
    // via de generieke CRUD ontstaat altijd een minst-geprivilegieerde
    // employee zonder rechten. Rol-toekenning loopt via /employees.
    row.role = "employee";
    row.permissions = [];
    row.mfaEnabled = false;
    row.mfaEnforced = false;
  }
  if (key === "sales") {
    row.stage = row.stage || "qualified_lead";
    row.source = row.source || "direct";
    row.sector = row.sector || "bouw";
    row.seats = Number(row.seats || 0);
    row.createdAt = row.createdAt || new Date().toISOString();
    row.updatedAt = row.updatedAt || row.createdAt;
  }
  if (key === "partners") {
    row.type = row.type || "accountant";
    row.status = row.status || "active";
    row.createdAt = row.createdAt || new Date().toISOString();
    row.updatedAt = row.updatedAt || row.createdAt;
  }
  if (key === "expenses") Object.assign(row, applyExpenseDefaults(row));
  store.insert(mod.collection, row);
  store.audit({ actor: user.email, tenantId: scopedTenant, action: "create", area: mod.key, detail: row.id });
  return publicRow(key, row);
}

function updateModuleRow(store, user, key, id, payload) {
  const mod = moduleByKey(key);
  if (!mod) {
    const error = new Error("Unknown module");
    error.status = 404;
    throw error;
  }
  assertCan(user, mod.permission);
  if (key === "tenants") assertSuperAdmin(user);
  const existing = store.get(mod.collection, id);
  if (!existing) {
    const error = new Error("Not found");
    error.status = 404;
    throw error;
  }
  if (mod.tenantScoped) assertTenant(user, existing.tenantId);
  const patch = normalizePayload(key, payload);
  validatePayload(key, patch, existing);
  delete patch.id;
  if (mod.tenantScoped) delete patch.tenantId;
  if (key === "planning") validatePlanningRules(store, existing.tenantId, patch, existing);
  if (key === "sales") {
    patch.updatedAt = new Date().toISOString();
    if (patch.seats != null) patch.seats = Number(patch.seats || 0);
  }
  if (key === "partners") patch.updatedAt = new Date().toISOString();
  if (key === "expenses") Object.assign(patch, applyExpenseDefaults(patch, existing));
  const row = store.update(mod.collection, id, patch);
  store.audit({ actor: user.email, tenantId: existing.tenantId, action: "update", area: mod.key, detail: id });
  return publicRow(key, row);
}

module.exports = { listModule, createModuleRow, updateModuleRow };
