const crypto = require("crypto");
const { config } = require("./config");
const { encryptSecret, decryptSecret, hashPassword, verifyPassword } = require("./security");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

// Constante-tijd tegen user-enumeratie: bij een onbestaand e-mailadres draaien
// we tóch een PBKDF2-verificatie tegen deze dummy-hash, zodat de responstijd
// niet verraadt of het account bestaat.
const DUMMY_PASSWORD_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", config.jwtSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verify(token) {
  if (!token || !token.includes(".")) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  const expected = crypto.createHmac("sha256", config.jwtSecret).update(body).digest("base64url");
  if (Buffer.byteLength(signature || "") !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch (error) {
    return null;
  }
  if (payload.exp && payload.exp < Date.now()) return null;
  return payload;
}

function issueSession(user) {
  return sign({
    sub: user.id,
    tenantId: user.tenantId || null,
    role: user.role,
    permissions: user.permissions || [],
    exp: Date.now() + 1000 * 60 * 60 * 8
  });
}

// ── Account-activatie / e-mailverificatie ────────────────────
// Bij aanmaak kiest de aanmaker GEEN wachtwoord. De persoon krijgt een mail met
// een tijdsgebonden activatielink en stelt zelf zijn wachtwoord in. Veiliger:
// niemand kent andermans wachtwoord en het e-mailadres wordt geverifieerd.
const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dagen

function hashActivation(secret) {
  return crypto.createHmac("sha256", config.jwtSecret).update(String(secret)).digest("base64url");
}
// Bouwt een activatie-record voor op de user; retourneert ook het ruwe secret.
function startActivation(now = Date.now()) {
  const secret = crypto.randomBytes(24).toString("base64url");
  return {
    secret,
    record: { tokenHash: hashActivation(secret), expiresAt: new Date(now + ACTIVATION_TTL_MS).toISOString(), createdAt: new Date(now).toISOString() }
  };
}
function activationToken(userId, secret) { return `${userId}~${secret}`; }
function parseActivationToken(token) {
  const i = String(token || "").indexOf("~");
  return i < 0 ? null : { userId: token.slice(0, i), secret: token.slice(i + 1) };
}
function checkActivation(user, secret, now = Date.now()) {
  const a = user && user.activation;
  if (!a || !a.tokenHash) return { ok: false, reason: "Geen openstaande activatie voor dit account" };
  if (new Date(a.expiresAt).getTime() <= now) return { ok: false, reason: "Activatielink is verlopen · vraag een nieuwe aan" };
  if (hashActivation(secret) !== a.tokenHash) return { ok: false, reason: "Ongeldige activatielink" };
  return { ok: true };
}

// Wachtwoord-reset: zelfde token-mechaniek als activatie, maar korter geldig (1u)
// en in een apart veld (user.passwordReset) zodat het niet botst met een
// openstaande activatie. Token-formaat (userId~secret) is gedeeld.
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 uur
function startPasswordReset(now = Date.now()) {
  const secret = crypto.randomBytes(24).toString("base64url");
  return {
    secret,
    record: { tokenHash: hashActivation(secret), expiresAt: new Date(now + PASSWORD_RESET_TTL_MS).toISOString(), createdAt: new Date(now).toISOString() }
  };
}
function checkPasswordReset(user, secret, now = Date.now()) {
  const a = user && user.passwordReset;
  if (!a || !a.tokenHash) return { ok: false, reason: "Geen openstaand reset-verzoek voor dit account" };
  if (new Date(a.expiresAt).getTime() <= now) return { ok: false, reason: "Reset-link is verlopen · vraag een nieuwe aan" };
  if (hashActivation(secret) !== a.tokenHash) return { ok: false, reason: "Ongeldige reset-link" };
  return { ok: true };
}

// ── GDPR support-impersonatie ────────────────────────────────
// Een support-sessie neemt de exacte gebruikerssessie over via een
// kortlevend support-token. Sliding expiry: bij activiteit verschuift
// de vervaltijd (auto-renew) tot een harde limiet, daarna nieuwe
// toestemming nodig. Toestemming + grant leven op de tenant, het token
// verwijst er via grantId naar. De token-exp is de harde limiet.
const SUPPORT_IDLE_MS = 30 * 60 * 1000;     // 30 min inactiviteit → verlopen
const SUPPORT_HARD_MS = 4 * 60 * 60 * 1000; // harde max 4u, daarna her-consent

// Bouwt een grant-object (op de tenant te bewaren als supportSession).
function buildSupportGrant({ impersonatedUserId, agent, scope, reason, now = Date.now() }) {
  const grantId = `support_${now}_${crypto.randomBytes(6).toString("hex")}`;
  return {
    grantId,
    impersonatedUserId,
    agent,
    scope: scope === "write" ? "write" : "read",
    reason: reason || "",
    startedAt: new Date(now).toISOString(),
    lastActivityAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SUPPORT_IDLE_MS).toISOString(),
    hardExpiresAt: new Date(now + SUPPORT_HARD_MS).toISOString(),
    endedAt: null
  };
}

// Token dat naar een grant verwijst. exp = harde limiet (verify weigert daarna).
function issueSupportToken(grant, tenantId) {
  return sign({
    sub: grant.impersonatedUserId,
    tenantId: tenantId || null,
    support: true,
    grantId: grant.grantId,
    agent: grant.agent,
    scope: grant.scope,
    exp: new Date(grant.hardExpiresAt).getTime()
  });
}

function supportGrantStatus(grant, payload, now = Date.now()) {
  if (!grant || grant.endedAt) return { ok: false, reason: "Support-sessie is beëindigd" };
  if (payload && grant.grantId !== payload.grantId) return { ok: false, reason: "Support-grant komt niet overeen" };
  if (new Date(grant.hardExpiresAt).getTime() <= now) return { ok: false, reason: "Harde limiet bereikt, nieuwe toestemming nodig" };
  if (new Date(grant.expiresAt).getTime() <= now) return { ok: false, reason: "Support-sessie verlopen (inactiviteit)" };
  return { ok: true };
}

// Schuift de vervaltijd op bij activiteit, begrensd door de harde limiet.
function slideSupportGrant(grant, now = Date.now()) {
  const hard = new Date(grant.hardExpiresAt).getTime();
  const next = Math.min(now + SUPPORT_IDLE_MS, hard);
  return { ...grant, lastActivityAt: new Date(now).toISOString(), expiresAt: new Date(next).toISOString() };
}

// Blokkeer schrijfacties tijdens een read-only support-sessie.
function assertSupportWrite(user, method) {
  if (!user?.isSupportSession) return;
  if (user.support?.scope === "write") return;
  if (String(method || "GET").toUpperCase() === "GET") return;
  const error = new Error("Support-sessie heeft alleen leesrechten");
  error.status = 403;
  throw error;
}

function safeUser(user) {
  const { passwordHash, mfaSecret, mfaPendingSecret, recoveryCodes, activation, ...safe } = user || {};
  return safe;
}

function authenticate(req, store) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = verify(token);
  if (!payload) return null;

  // Support-impersonatie: valideer tegen de tenant-grant + schuif de vervaltijd.
  if (payload.support === true) {
    const tenant = (store.data.tenants || []).find(t => t.id === payload.tenantId);
    if (!tenant || tenant.supportAccess?.allowed !== true) return null;
    const grant = tenant.supportSession;
    const status = supportGrantStatus(grant, payload);
    if (!status.ok) return null;
    const user = store.getUserById(payload.sub);
    if (!user || !user.active) return null;
    // auto-renew bij activiteit
    const slid = slideSupportGrant(grant);
    tenant.supportSession = slid;
    if (typeof store.save === "function") { try { store.save(); } catch (_) {} }
    return {
      ...user,
      session: payload,
      isSupportSession: true,
      support: { agent: payload.agent, grantId: payload.grantId, scope: payload.scope, tenantId: tenant.id }
    };
  }

  const user = store.getUserById(payload.sub);
  if (!user || !user.active) return null;
  return { ...user, session: payload };
}

function lockError(user) {
  const error = new Error(`Account tijdelijk vergrendeld tot ${user.lockedUntil}`);
  error.status = 423;
  return error;
}

function isLocked(user) {
  return !!(user?.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now());
}

function assertNotLocked(user) {
  if (isLocked(user)) throw lockError(user);
}

function registerFailedLogin(store, user) {
  if (!user) return;
  const failedLoginCount = Number(user.failedLoginCount || 0) + 1;
  const lockedUntil = failedLoginCount >= MAX_FAILED_LOGINS
    ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
    : user.lockedUntil || null;
  store.update("users", user.id, { failedLoginCount, lockedUntil, updatedAt: new Date().toISOString() });
  store.audit({
    actor: user.email,
    tenantId: user.tenantId,
    action: lockedUntil ? "account_locked" : "login_failed",
    area: "auth",
    detail: `${failedLoginCount}/${MAX_FAILED_LOGINS}`
  });
}

function resetLoginFailures(store, user) {
  if (!user) return;
  if (Number(user.failedLoginCount || 0) === 0 && !user.lockedUntil) return;
  store.update("users", user.id, { failedLoginCount: 0, lockedUntil: null, updatedAt: new Date().toISOString() });
}

function login(store, email, password) {
  const user = store.getUserByEmail(email);
  if (!user) { verifyPassword(password, DUMMY_PASSWORD_HASH); return null; } // constante tijd
  // Lockout beschermt tegen brute-force ZONDER een legitieme gebruiker buiten
  // te sluiten: een CORRECT wachtwoord mag altijd door (geen lockout-DoS), een
  // FOUT wachtwoord tijdens een lock blijft geweigerd. De gok-snelheid zelf is
  // per-IP begrensd door de rate-limiter.
  const locked = isLocked(user);
  if (!verifyPassword(password, user.passwordHash)) {
    registerFailedLogin(store, user);
    if (locked) throw lockError(store.getUserById(user.id) || user);
    return null;
  }
  if (user.active === false) return null; // gedeactiveerd / nog niet goedgekeurd
  if (user.mfaEnabled || user.mfaEnforced) {
    return { user, mfaRequired: true };
  }
  return { user, token: issueSession(user) };
}

function base32Encode(buffer) {
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  return bits.match(/.{1,5}/g).map(chunk => BASE32_ALPHABET[parseInt(chunk.padEnd(5, "0"), 2)]).join("");
}

function base32Decode(value) {
  const clean = String(value || "").replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = "";
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = bits.match(/.{8}/g) || [];
  return Buffer.from(bytes.map(byte => parseInt(byte, 2)));
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

function totp(secret, at = Date.now()) {
  return hotp(secret, Math.floor(at / 1000 / 30));
}

function verifyTotp(secret, code) {
  const clean = String(code || "").replace(/\s+/g, "");
  const now = Date.now();
  return [-1, 0, 1].some(step => totp(secret, now + step * 30_000) === clean);
}

function loginWithMfa(store, email, password, code) {
  const user = store.getUserByEmail(email);
  if (!user) { verifyPassword(password, DUMMY_PASSWORD_HASH); return null; } // constante tijd
  const locked = isLocked(user);
  if (!verifyPassword(password, user.passwordHash)) {
    registerFailedLogin(store, user);
    if (locked) throw lockError(store.getUserById(user.id) || user);
    return null;
  }
  if (user.active === false) return null; // gedeactiveerd / nog niet goedgekeurd
  if (user.mfaEnabled || user.mfaEnforced) {
    const recoveryResult = consumeRecoveryCode(store, user, code);
    const validTotp = user.mfaSecret && verifyTotp(decryptSecret(user.mfaSecret), code);
    if (!validTotp && !recoveryResult.ok) {
      registerFailedLogin(store, user);
      store.audit({ actor: user.email, tenantId: user.tenantId, action: "mfa_failed", area: "auth", detail: user.id });
      const error = new Error("MFA code is ongeldig");
      error.status = 401;
      throw error;
    }
    if (recoveryResult.ok) {
      store.audit({ actor: user.email, tenantId: user.tenantId, action: "mfa_recovery_code_used", area: "auth", detail: user.id });
    }
  }
  return { user: store.getUserById(user.id), token: issueSession(user) };
}

function createRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => crypto.randomBytes(5).toString("hex").toUpperCase().replace(/(.{5})/, "$1-"));
}

function consumeRecoveryCode(store, user, code) {
  const clean = String(code || "").trim().toUpperCase();
  if (!clean || !Array.isArray(user.recoveryCodes)) return { ok: false };
  const index = user.recoveryCodes.findIndex(row => row && !row.usedAt && verifyPassword(clean, row.hash));
  if (index < 0) return { ok: false };
  const recoveryCodes = user.recoveryCodes.map((row, rowIndex) => rowIndex === index
    ? { ...row, usedAt: new Date().toISOString() }
    : row);
  store.update("users", user.id, { recoveryCodes, updatedAt: new Date().toISOString() });
  return { ok: true };
}

// Admin-geïnitieerde MFA-afdwinging: genereert een secret, schakelt MFA
// direct in + enforced, en maakt recovery codes. Retourneert de secret +
// otpauth + recovery codes zodat de beheerder ze meteen kan opslaan/scannen.
function enforceMfa(store, user) {
  const secret = base32Encode(crypto.randomBytes(20));
  const issuer = "Monargo One";
  const label = `${issuer}:${user.email}`;
  const otpauth = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
  const recoveryCodes = createRecoveryCodes();
  store.update("users", user.id, {
    mfaSecret: encryptSecret(secret),
    mfaPendingSecret: "",
    mfaEnabled: true,
    mfaEnforced: true,
    recoveryCodes: recoveryCodes.map(value => ({ hash: hashPassword(value), usedAt: null, createdAt: new Date().toISOString() })),
    updatedAt: new Date().toISOString()
  });
  store.audit({ actor: user.email, tenantId: user.tenantId, action: "mfa_enforced", area: "auth", detail: user.id });
  return { id: user.id, email: user.email, name: user.name || user.email, secret, otpauth, recoveryCodes };
}

function createMfaSetup(store, user) {
  const secret = base32Encode(crypto.randomBytes(20));
  const issuer = "Monargo One";
  const label = `${issuer}:${user.email}`;
  const otpauth = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
  const row = store.update("users", user.id, {
    mfaPendingSecret: encryptSecret(secret),
    mfaEnforced: !!user.mfaEnforced,
    updatedAt: new Date().toISOString()
  });
  store.audit({ actor: user.email, tenantId: user.tenantId, action: "mfa_setup_started", area: "auth", detail: user.id });
  return { user: row, secret, otpauth };
}

function verifyMfaSetup(store, user, code) {
  const current = store.getUserById(user.id);
  const encrypted = current?.mfaPendingSecret || current?.mfaSecret;
  if (!encrypted) {
    const error = new Error("Geen MFA setup actief");
    error.status = 400;
    throw error;
  }
  const secret = decryptSecret(encrypted);
  if (!verifyTotp(secret, code)) {
    const error = new Error("MFA code is ongeldig");
    error.status = 400;
    throw error;
  }
  const recoveryCodes = createRecoveryCodes();
  const row = store.update("users", user.id, {
    mfaSecret: encryptSecret(secret),
    mfaPendingSecret: "",
    mfaEnabled: true,
    mfaEnforced: true,
    recoveryCodes: recoveryCodes.map(value => ({ hash: hashPassword(value), usedAt: null, createdAt: new Date().toISOString() })),
    updatedAt: new Date().toISOString()
  });
  store.audit({ actor: user.email, tenantId: user.tenantId, action: "mfa_enabled", area: "auth", detail: user.id });
  return { user: safeUser(row), recoveryCodes };
}

/**
 * Permissieniveaus per module (door de tenant-admin instelbaar per gebruiker):
 *   "X"       → schrijven (volledige scope)
 *   "own:X"   → schrijven, beperkt tot eigen data (employees)
 *   "read:X"  → alleen-lezen (ziet de module, kan niets wijzigen)
 *   afwezig   → geen toegang
 * can() = mag zien (alle niveaus); canWrite() = mag wijzigen (niet bij read:).
 */
function can(user, permission) {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  const permissions = user.permissions || [];
  if (permissions.includes("*")) return true;
  // employee kan via "own:X" ook de basis X-scope claimen voor eigen data
  if (permissions.includes(permission)) return true;
  if (permissions.includes(`own:${permission}`)) return true;
  if (permissions.includes(`read:${permission}`)) return true;
  return false;
}

function canWrite(user, permission) {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  const permissions = user.permissions || [];
  if (permissions.includes("*")) return true;
  if (permissions.includes(permission)) return true;
  if (permissions.includes(`own:${permission}`)) return true;
  return false; // enkel read:X → niet schrijven
}

// Heeft deze gebruiker ENKEL eigen-data-toegang voor dit onderdeel?
// (own:X zonder vol X, read:X of *) → lijsten server-side filteren op eigen
// userId. GDPR: een veldwerker hoort geen verlof/uren van collega's te zien.
function ownScopeOnly(user, permission) {
  if (!user || user.role === "super_admin") return false;
  const p = user.permissions || [];
  if (p.includes("*") || p.includes(permission) || p.includes(`read:${permission}`)) return false;
  return p.includes(`own:${permission}`);
}

function assertCanWrite(user, permission) {
  assertAdminMfa(user);
  if (!canWrite(user, permission)) {
    const error = new Error(can(user, permission)
      ? "Je hebt alleen leesrechten voor dit onderdeel"
      : "Missing permission");
    error.status = 403;
    throw error;
  }
}

// Controleer of employee alleen zijn eigen resource mag lezen/wijzigen
function assertOwn(user, resourceUserId) {
  if (!user) { const e = new Error("Unauthorized"); e.status = 401; throw e; }
  if (["super_admin", "tenant_admin", "manager"].includes(user.role)) return; // admins mogen alles
  if (user.id !== resourceUserId) {
    const error = new Error("Je hebt geen toegang tot deze resource");
    error.status = 403;
    throw error;
  }
}

function isEmployee(user) {
  return user?.role === "employee";
}

function isManager(user) {
  return user?.role === "manager";
}

function isAdmin(user) {
  return ["tenant_admin", "super_admin"].includes(user?.role);
}

function assertSuperAdmin(user) {
  if (!user || user.role !== "super_admin") {
    const error = new Error("Super admin required");
    error.status = 403;
    throw error;
  }
}

// De "god" van de SaaS: de beschermde hoofd-superadmin. Onaantastbaar en de
// enige die platform-medewerkers mag beheren.
function isPlatformGod(user) {
  return !!(user && user.role === "super_admin" && user.protected === true);
}

function assertPlatformGod(user) {
  if (!isPlatformGod(user)) {
    const error = new Error("Alleen de hoofd-superadmin mag het platformteam beheren");
    error.status = 403;
    throw error;
  }
}

// Platform-secties waartoe een teamlid toegang kan krijgen. De god heeft altijd
// alles; legacy-teamleden zonder platformScopes-veld ook (niet-brekend).
const PLATFORM_SCOPES = ["tenants", "billing", "modules", "integrations", "system", "support", "audit", "settings", "resellers"];

function isReseller(user) {
  return user?.role === "reseller";
}

function assertReseller(user) {
  if (!isReseller(user)) {
    const error = new Error("Reseller-account vereist");
    error.status = 403;
    throw error;
  }
}

function platformScopesOf(user) {
  if (isPlatformGod(user)) return PLATFORM_SCOPES.slice();
  const s = user && user.platformScopes;
  if (!Array.isArray(s)) return PLATFORM_SCOPES.slice();
  if (s.includes("*")) return PLATFORM_SCOPES.slice();
  return s.filter(x => PLATFORM_SCOPES.includes(x));
}

function hasPlatformScope(user, scope) {
  return isPlatformGod(user) || platformScopesOf(user).includes(scope);
}

function assertPlatformScope(user, scope) {
  assertSuperAdmin(user);
  if (!hasPlatformScope(user, scope)) {
    const error = new Error("Geen toegang tot deze platform-sectie");
    error.status = 403;
    throw error;
  }
}

function assertAdminMfa(user) {
  // In dev-modus of als REQUIRE_ADMIN_MFA=false → MFA niet verplicht
  if (process.env.REQUIRE_ADMIN_MFA === "false") return;
  if (!user || !["super_admin", "tenant_admin"].includes(user.role)) return;
  if (user.mfaEnabled && user.mfaEnforced && user.mfaSecret) return;
  const error = new Error("MFA is verplicht voor admin-acties. Activeer MFA via Instellingen.");
  error.status = 403;
  throw error;
}

function assertTenant(user, tenantId) {
  if (!user) {
    const error = new Error("Unauthorized");
    error.status = 401;
    throw error;
  }
  if (user.role === "super_admin") return;
  if (user.tenantId !== tenantId) {
    const error = new Error("Forbidden tenant");
    error.status = 403;
    throw error;
  }
}

function assertCan(user, permission) {
  assertAdminMfa(user);
  if (!can(user, permission)) {
    const error = new Error("Missing permission");
    error.status = 403;
    throw error;
  }
}

module.exports = {
  issueSession,
  ACTIVATION_TTL_MS,
  startActivation,
  activationToken,
  parseActivationToken,
  checkActivation,
  PASSWORD_RESET_TTL_MS,
  startPasswordReset,
  checkPasswordReset,
  authenticate,
  buildSupportGrant,
  issueSupportToken,
  supportGrantStatus,
  slideSupportGrant,
  assertSupportWrite,
  SUPPORT_IDLE_MS,
  SUPPORT_HARD_MS,
  login,
  loginWithMfa,
  isLocked,
  safeUser,
  createMfaSetup,
  verifyMfaSetup,
  enforceMfa,
  resetLoginFailures,
  can,
  canWrite,
  ownScopeOnly,
  assertTenant,
  assertCan,
  assertCanWrite,
  assertOwn,
  assertSuperAdmin,
  isPlatformGod,
  assertPlatformGod,
  PLATFORM_SCOPES,
  platformScopesOf,
  hasPlatformScope,
  assertPlatformScope,
  isReseller,
  assertReseller,
  assertAdminMfa,
  isEmployee,
  isManager,
  isAdmin
};
