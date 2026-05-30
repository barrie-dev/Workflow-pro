const crypto = require("crypto");
const { config } = require("./config");
const { encryptSecret, decryptSecret, hashPassword, verifyPassword } = require("./security");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

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

function safeUser(user) {
  const { passwordHash, mfaSecret, mfaPendingSecret, recoveryCodes, ...safe } = user || {};
  return safe;
}

function authenticate(req, store) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = verify(token);
  if (!payload) return null;
  const user = store.getUserById(payload.sub);
  if (!user || !user.active) return null;
  return { ...user, session: payload };
}

function lockError(user) {
  const error = new Error(`Account tijdelijk vergrendeld tot ${user.lockedUntil}`);
  error.status = 423;
  return error;
}

function assertNotLocked(user) {
  if (!user?.lockedUntil) return;
  if (new Date(user.lockedUntil).getTime() > Date.now()) throw lockError(user);
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
  if (!user) return null;
  assertNotLocked(user);
  if (!verifyPassword(password, user.passwordHash)) {
    registerFailedLogin(store, user);
    return null;
  }
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
  if (!user) return null;
  assertNotLocked(user);
  if (!verifyPassword(password, user.passwordHash)) {
    registerFailedLogin(store, user);
    return null;
  }
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

function createMfaSetup(store, user) {
  const secret = base32Encode(crypto.randomBytes(20));
  const issuer = "WorkFlow Pro";
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

function can(user, permission) {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  const permissions = user.permissions || [];
  if (permissions.includes("*")) return true;
  // employee kan via "own:X" ook de basis X-scope claimen voor eigen data
  if (permissions.includes(permission)) return true;
  if (permissions.includes(`own:${permission}`)) return true;
  return false;
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
  authenticate,
  login,
  loginWithMfa,
  safeUser,
  createMfaSetup,
  verifyMfaSetup,
  resetLoginFailures,
  can,
  assertTenant,
  assertCan,
  assertOwn,
  assertSuperAdmin,
  assertAdminMfa,
  isEmployee,
  isManager,
  isAdmin
};
