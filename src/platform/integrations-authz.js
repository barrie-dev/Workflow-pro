"use strict";

// ── Geconsolideerd rechtenmodel · Integraties, Usage & Billing (spec sectie 16 + 11) ──
// Pure beslislaag voor het HELE integratie-/usage-/payrolldomein. Geen store,
// geen I/O, geen dependencies buiten de gedeelde SoD-helper. De router laadt de
// gebruiker + context en vraagt hier de beslissing, voor elke repository-call.
// Model gebouwd naar reseller-authz.js / forms-authz.js.
//
// Twee rechtenklassen, strikt gescheiden (geen crossover):
//   - PLATFORM (Super Admin): platform.peppol.* en platform.ai.* · vereisen
//     super_admin + een platformscope (hergebruik van hasPlatformScope-semantiek
//     uit lib/auth.js). Een tenant- of resellerrol krijgt deze NOOIT.
//   - TENANT: integrations.*, peppol.settings.manage/peppol.send, developer.*,
//     sso.* en payroll.* · capability-vlaggen op de tenantgebruiker. Super Admin
//     mag een tenant-operationele actie alleen uitvoeren MET expliciete
//     tenantcontext (support/impersonatie), nooit contextloos.
//
// NIET-ONDERHANDELBAAR (D01/D10): Mona AI-monitoring is uitsluitend Super Admin.
// Een tenantrol mag nooit een platform.ai.*-recht dragen · assertMonaAiTenantHidden
// dwingt dit af als laatste verdedigingslijn.

const { assertNotSelfApproval } = require("./reseller-authz");

// ── Platformscopes (spiegel van lib/auth.js:492 · PLATFORM_SCOPES) ────────────
// Lokaal gedefinieerd om deze laag puur te houden (geen zware auth-import). Moet
// consistent blijven met lib/auth.js; de router mag ook assertPlatformScope(user,
// platformScopeFor(perm)) gebruiken.
const PLATFORM_SCOPES = [
  "tenants", "billing", "modules", "integrations",
  "system", "support", "audit", "settings", "resellers",
];

// ── Rechtenregister (sectie 16) ───────────────────────────────────────────────
// Super Admin · Peppol platformbeheer
const PEPPOL_PLATFORM_PERMISSIONS = [
  "platform.peppol.provider.manage", // provider en centrale credentials
  "platform.peppol.usage.view",      // alle tenants en providerkosten
  "platform.peppol.pricing.manage",  // tarieven en overrides
];
// Super Admin · Mona AI-monitoring (NOOIT tenant · D01/D10)
const AI_PLATFORM_PERMISSIONS = [
  "platform.ai.usage.view",        // Mona usage over tenants
  "platform.ai.credits.manage",    // credits en adjustments
  "platform.ai.tenant_limit.manage", // soft/hard limit per tenant
  "platform.ai.global_limit.manage", // globale pool en budget
  "platform.ai.alerts.manage",     // drempels en ontvangers
];
const PLATFORM_PERMISSIONS = [...PEPPOL_PLATFORM_PERMISSIONS, ...AI_PLATFORM_PERMISSIONS];

// Tenant · Peppol operationeel
const PEPPOL_TENANT_PERMISSIONS = [
  "peppol.settings.manage", // eigen onderneming en verzendmodus
  "peppol.send",            // factuur verzenden
];
// Tenant · connectorframework
const INTEGRATION_TENANT_PERMISSIONS = [
  "integrations.view",      // eigen connectorstatus
  "integrations.connect",   // nieuwe verbinding
  "integrations.configure", // mappings en syncbeleid
  "integrations.retry",     // eigen fouten opnieuw proberen
];
// Tenant · developer platform (INT-19/20 · haak)
const DEVELOPER_TENANT_PERMISSIONS = [
  "developer.api.manage",      // API-clients en keys
  "developer.webhooks.manage", // endpoints en secrets
];
// Tenant · SSO (INT-17 · haak); sso.enforce is een gevoelig recht
const SSO_TENANT_PERMISSIONS = [
  "sso.configure", // tenant SSO voorbereiden
  "sso.enforce",   // SSO verplicht maken (gevoelig)
];
// Tenant · Payroll Exchange Engine (sectie 11)
const PAYROLL_PERMISSIONS = [
  "payroll.view",             // cockpit en statussen bekijken
  "payroll.prepare",          // periode voorbereiden
  "payroll.employee_mapping", // medewerkers aan provider-ID koppelen
  "payroll.code_mapping",     // prestatie-/afwezigheids-/variabele codes mappen
  "payroll.correct",          // correcties voorbereiden
  "payroll.period.review",    // review uitvoeren
  "payroll.period.approve",   // vierogencontrole goedkeuren (SoD)
  "payroll.export",           // providerpakket genereren
  "payroll.submit",           // als aangeleverd registreren
  "payroll.reopen",           // afgesloten/goedgekeurde periode heropenen
  "payroll.results.view",     // teruggekoppelde resultaten zien
  "payroll.costs.view",       // loonkosten zien
  "payroll.integration.manage", // providerconfiguratie beheren
];

const TENANT_PERMISSIONS = [
  ...PEPPOL_TENANT_PERMISSIONS,
  ...INTEGRATION_TENANT_PERMISSIONS,
  ...DEVELOPER_TENANT_PERMISSIONS,
  ...SSO_TENANT_PERMISSIONS,
  ...PAYROLL_PERMISSIONS,
];

const ALL_PERMISSIONS = [...PLATFORM_PERMISSIONS, ...TENANT_PERMISSIONS];

// ── Scope-mapping van platformrecht → bestaande PLATFORM_SCOPE ────────────────
// Bewust en consistent (recon): providerplumbing (credentials/callbacks/webhooks)
// = "integrations"; usage/pricing/credits/limieten/alerts = "billing". Beide zijn
// apart van "support" (sectie 19: data-inzage in providerkosten en AI-verbruik is
// gescheiden van technisch supportrecht).
const PLATFORM_PERMISSION_SCOPE = {
  "platform.peppol.provider.manage": "integrations",
  "platform.peppol.usage.view": "billing",
  "platform.peppol.pricing.manage": "billing",
  "platform.ai.usage.view": "billing",
  "platform.ai.credits.manage": "billing",
  "platform.ai.tenant_limit.manage": "billing",
  "platform.ai.global_limit.manage": "billing",
  "platform.ai.alerts.manage": "billing",
};

// Gevoelige tenantrechten: worden nooit impliciet aan tenant_admin toegekend,
// enkel via een expliciete grant + veilige activatieflow (sectie 13.2 · sso.enforce).
const SENSITIVE_TENANT_PERMISSIONS = ["sso.enforce"];

// Vierogencontrole vereist bij payroll-goedkeuring (SoD, sectie 11) en bij een
// prijswijziging (maker-checker op tarieven, sectie 7 · immutabiliteit).
const FOUR_EYES_PERMISSIONS = ["payroll.period.approve", "platform.peppol.pricing.manage"];

// Scope-prefixen die een samenstelbaar profiel voor een key kan dragen
// (spiegel van platform/policy.js). Voor capability-vlaggen strippen we die weg.
const SCOPE_PREFIXES = ["read:", "team:", "own:", "assigned:", "project:", "company:", "platform:"];

function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }

/** Strip een eventuele scope-prefix van een permissiestring → kale key. */
function stripScope(raw) {
  const p = String(raw || "");
  for (const pre of SCOPE_PREFIXES) if (p.startsWith(pre)) return p.slice(pre.length);
  return p;
}

function isSuperAdmin(user) { return !!(user && user.role === "super_admin"); }
function isReseller(user) { return !!(user && user.role === "reseller"); }
function isTenantRole(user) {
  return !!(user && !isSuperAdmin(user) && !isReseller(user));
}

// ── Platformscope-semantiek (spiegel lib/auth.js) ─────────────────────────────
function isPlatformGod(user) { return !!(user && user.role === "super_admin" && user.protected === true); }
function platformScopesOf(user) {
  if (isPlatformGod(user)) return PLATFORM_SCOPES.slice();
  const s = user && user.platformScopes;
  if (!Array.isArray(s)) return PLATFORM_SCOPES.slice(); // legacy super_admin: niet-brekend
  if (s.includes("*")) return PLATFORM_SCOPES.slice();
  return s.filter(x => PLATFORM_SCOPES.includes(x));
}
function hasPlatformScope(user, scope) {
  if (!isSuperAdmin(user)) return false;
  return isPlatformGod(user) || platformScopesOf(user).includes(scope);
}

/** Welke platformscope hoort bij dit platformrecht? null als geen platformrecht. */
function platformScopeFor(permission) { return PLATFORM_PERMISSION_SCOPE[permission] || null; }

/** Classificatie van een recht: {kind, scope, requiredScope, sensitive, fourEyes} of null. */
function permissionInfo(permission) {
  if (PLATFORM_PERMISSIONS.includes(permission)) {
    return {
      kind: "platform",
      scope: "platform",
      requiredScope: platformScopeFor(permission),
      sensitive: false,
      fourEyes: FOUR_EYES_PERMISSIONS.includes(permission),
    };
  }
  if (TENANT_PERMISSIONS.includes(permission)) {
    return {
      kind: "tenant",
      scope: "tenant",
      requiredScope: null,
      sensitive: SENSITIVE_TENANT_PERMISSIONS.includes(permission),
      fourEyes: FOUR_EYES_PERMISSIONS.includes(permission),
    };
  }
  return null;
}

/**
 * Mag deze gebruiker een Super Admin-platformactie uitvoeren?
 * Vereist super_admin EN de bijhorende platformscope. Tenant- en resellerrollen
 * krijgen deze rechten NOOIT (ook niet via "*"-tenantwildcard).
 */
function canPlatform(user, permission) {
  if (!user) return false;
  if (!PLATFORM_PERMISSIONS.includes(permission)) return false;
  if (!isSuperAdmin(user)) return false;
  return hasPlatformScope(user, platformScopeFor(permission));
}

/** Heeft een tenantgebruiker de capability-vlag? (tenant_admin krijgt de niet-gevoelige set) */
function tenantHasPermission(user, permission) {
  if (user.role === "tenant_admin" && !SENSITIVE_TENANT_PERMISSIONS.includes(permission)) return true;
  for (const raw of user.permissions || []) {
    if (raw === "*") {
      // Tenant-wildcard verruimt binnen de tenant, maar nooit naar gevoelige
      // rechten (sso.enforce): die vereisen een expliciete grant.
      if (!SENSITIVE_TENANT_PERMISSIONS.includes(permission)) return true;
      continue;
    }
    if (stripScope(raw) === permission) return true;
  }
  return false;
}

/**
 * Mag deze gebruiker een tenant-operationele actie uitvoeren?
 * ctx: { tenantId, companyId }
 * - resellerrol: nooit (geen standaardtoegang · sectie 19);
 * - platformrecht via canTenant: nooit (geen crossover);
 * - super_admin: alleen MET expliciete tenantcontext (support/impersonatie),
 *   nooit contextloos;
 * - tenantgebruiker: moet tot de tenant in de context behoren (cross-tenant =
 *   harde weigering) en de capability dragen.
 * Company-rijfiltering blijft de router (companyId is hier informatief).
 */
function canTenant(user, permission, ctx = {}) {
  if (!user) return false;
  if (!TENANT_PERMISSIONS.includes(permission)) return false; // onbekend of platformrecht
  if (isReseller(user)) return false;
  if (isSuperAdmin(user)) return !!ctx.tenantId; // enkel met tenantcontext
  if (ctx.tenantId && user.tenantId && user.tenantId !== ctx.tenantId) return false;
  return tenantHasPermission(user, permission);
}

/** Vierogencontrole vereist voor payroll-goedkeuring en prijswijzigingen? */
function requiresFourEyes(permission) { return FOUR_EYES_PERMISSIONS.includes(permission); }

/** Gevoelig tenantrecht (expliciete grant + veilige activatieflow vereist)? */
function isSensitive(permission) { return SENSITIVE_TENANT_PERMISSIONS.includes(permission); }

// ── Anti-lek fouten (vaste boodschap, geen bestaans-/rechtenlek) ──────────────
/** Generieke 403 · zelfde boodschap ongeacht rol of bestaan van het object. */
function forbiddenError(code) { return err(403, code || "INTEGRATIONS_FORBIDDEN", "Geen toegang"); }

function assertCanPlatform(user, permission) {
  if (!canPlatform(user, permission)) throw forbiddenError("PLATFORM_SCOPE_REQUIRED");
  return true;
}

function assertCanTenant(user, permission, ctx = {}) {
  if (!canTenant(user, permission, ctx)) throw forbiddenError("TENANT_PERMISSION_REQUIRED");
  return true;
}

/**
 * NIET-ONDERHANDELBAAR (D01/D10): een tenant- of resellerrol mag nooit een
 * Mona AI-monitoringrecht dragen. Laatste verdedigingslijn tegen een verkeerd
 * geconfigureerd profiel · gooit een generieke 403 bij lek, faalt niet stil.
 */
function assertMonaAiTenantHidden(user) {
  if (!user || isSuperAdmin(user)) return true; // platform mag AI-monitoring wel
  for (const raw of user.permissions || []) {
    if (AI_PLATFORM_PERMISSIONS.includes(stripScope(raw))) {
      throw forbiddenError("AI_MONITORING_TENANT_FORBIDDEN");
    }
  }
  return true;
}

/**
 * Vierogencontrole-poort: als het recht vier ogen vereist, moeten indiener en
 * goedkeurder verschillen (hergebruik assertNotSelfApproval uit reseller-authz).
 * Voor niet-vierogen-rechten is dit een no-op die true teruggeeft.
 */
function assertFourEyes(permission, approverId, submittedById) {
  if (!requiresFourEyes(permission)) return true;
  return assertNotSelfApproval(approverId, submittedById);
}

module.exports = {
  // Registers
  PLATFORM_SCOPES,
  PEPPOL_PLATFORM_PERMISSIONS, AI_PLATFORM_PERMISSIONS, PLATFORM_PERMISSIONS,
  PEPPOL_TENANT_PERMISSIONS, INTEGRATION_TENANT_PERMISSIONS,
  DEVELOPER_TENANT_PERMISSIONS, SSO_TENANT_PERMISSIONS, PAYROLL_PERMISSIONS,
  TENANT_PERMISSIONS, ALL_PERMISSIONS,
  PLATFORM_PERMISSION_SCOPE, SENSITIVE_TENANT_PERMISSIONS, FOUR_EYES_PERMISSIONS,
  // Helpers
  stripScope, isSuperAdmin, isReseller, isTenantRole,
  isPlatformGod, platformScopesOf, hasPlatformScope, platformScopeFor,
  permissionInfo, isSensitive,
  // Beslisfuncties
  canPlatform, canTenant, tenantHasPermission,
  requiresFourEyes, assertMonaAiTenantHidden, assertFourEyes, assertNotSelfApproval,
  // Asserts / fouten
  assertCanPlatform, assertCanTenant, forbiddenError,
};
