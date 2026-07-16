const { Store } = require("../src/lib/store");
const { assertStrongPassword, hashPassword } = require("../src/lib/security");

function fail(message) {
  console.error(`Activatie geweigerd: ${message}`);
  process.exitCode = 1;
}

function main() {
  const email = String(process.env.PENDING_USER_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.PENDING_USER_PASSWORD || "");
  const confirmation = String(process.env.CONFIRM_PENDING_USER_ACTIVATION || "").trim().toLowerCase();
  const name = String(process.env.PENDING_USER_NAME || "").trim();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("PENDING_USER_EMAIL ontbreekt of is ongeldig.");
  if (confirmation !== email) return fail("CONFIRM_PENDING_USER_ACTIVATION moet exact gelijk zijn aan het e-mailadres.");
  try { assertStrongPassword(password); }
  catch (error) { return fail(error.message); }

  const store = new Store();
  const user = store.getUserByEmail(email);
  if (!user) return fail("account niet gevonden.");
  if (user.active !== false || user.passwordHash) return fail("account is niet langer een wachtwoordloos pending account.");
  if (!user.activation) return fail("account heeft geen actieve activatieaanvraag.");

  const now = new Date().toISOString();
  const updated = store.update("users", user.id, {
    ...(name ? { name } : {}),
    passwordHash: hashPassword(password),
    active: true,
    emailVerifiedAt: now,
    activation: null,
    failedLoginCount: 0,
    loginAttempts: 0,
    lockedUntil: null
  });
  store.audit({
    actor: "render-shell",
    tenantId: updated.tenantId || null,
    action: "pending_account_activated",
    area: "auth",
    detail: updated.email
  });
  console.log(`Account geactiveerd: ${updated.email} (${updated.role})`);
}

main();
