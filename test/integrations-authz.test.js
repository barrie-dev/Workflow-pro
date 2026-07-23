"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const authz = require("../src/platform/integrations-authz");

// ── Testgebruikers ────────────────────────────────────────────────────────────
const god = { role: "super_admin", protected: true };
const superBilling = { role: "super_admin", platformScopes: ["billing"] };
const superIntegrations = { role: "super_admin", platformScopes: ["integrations"] };
const superSupport = { role: "super_admin", platformScopes: ["support"] };
const superLegacy = { role: "super_admin" }; // geen platformScopes-veld
const tenantAdmin = { role: "tenant_admin", tenantId: "t1" };
const employee = { role: "employee", tenantId: "t1", permissions: [] };
const reseller = { role: "reseller", resellerId: "r1", permissions: ["*"] };

// ── Registers (sectie 16 + 11) ────────────────────────────────────────────────

test("PLATFORM_PERMISSIONS bevat exact de 8 Super Admin-rechten uit sectie 16", () => {
  assert.deepStrictEqual(authz.PLATFORM_PERMISSIONS.slice().sort(), [
    "platform.ai.alerts.manage",
    "platform.ai.credits.manage",
    "platform.ai.global_limit.manage",
    "platform.ai.tenant_limit.manage",
    "platform.ai.usage.view",
    "platform.peppol.pricing.manage",
    "platform.peppol.provider.manage",
    "platform.peppol.usage.view",
  ]);
});

test("TENANT_PERMISSIONS bevat de peppol/integrations/developer/sso + 13 payroll-rechten", () => {
  for (const p of [
    "peppol.settings.manage", "peppol.send",
    "integrations.view", "integrations.connect", "integrations.configure", "integrations.retry",
    "developer.api.manage", "developer.webhooks.manage",
    "sso.configure", "sso.enforce",
  ]) assert.ok(authz.TENANT_PERMISSIONS.includes(p), `mist ${p}`);
  assert.strictEqual(authz.PAYROLL_PERMISSIONS.length, 13);
  for (const p of authz.PAYROLL_PERMISSIONS) assert.ok(authz.TENANT_PERMISSIONS.includes(p));
});

test("platform- en tenantregister zijn disjunct (geen crossover)", () => {
  const overlap = authz.PLATFORM_PERMISSIONS.filter(p => authz.TENANT_PERMISSIONS.includes(p));
  assert.deepStrictEqual(overlap, []);
});

// ── canPlatform: Super Admin platformscope ───────────────────────────────────

test("god (beschermde hoofd-superadmin) mag elk platformrecht", () => {
  for (const p of authz.PLATFORM_PERMISSIONS) assert.strictEqual(authz.canPlatform(god, p), true);
});

test("legacy super_admin zonder platformScopes-veld behoudt volledige toegang (niet-brekend)", () => {
  assert.strictEqual(authz.canPlatform(superLegacy, "platform.ai.usage.view"), true);
  assert.strictEqual(authz.canPlatform(superLegacy, "platform.peppol.provider.manage"), true);
});

test("super_admin met billing-scope mag AI- en peppol-usage/pricing", () => {
  assert.strictEqual(authz.canPlatform(superBilling, "platform.ai.usage.view"), true);
  assert.strictEqual(authz.canPlatform(superBilling, "platform.ai.credits.manage"), true);
  assert.strictEqual(authz.canPlatform(superBilling, "platform.peppol.usage.view"), true);
  assert.strictEqual(authz.canPlatform(superBilling, "platform.peppol.pricing.manage"), true);
});

test("providerbeheer valt onder integrations-scope, niet billing", () => {
  assert.strictEqual(authz.canPlatform(superIntegrations, "platform.peppol.provider.manage"), true);
  assert.strictEqual(authz.canPlatform(superBilling, "platform.peppol.provider.manage"), false);
  assert.strictEqual(authz.canPlatform(superIntegrations, "platform.peppol.pricing.manage"), false);
});

test("technisch support-scope geeft GEEN inzage in providerkosten/AI-verbruik (sectie 19)", () => {
  assert.strictEqual(authz.canPlatform(superSupport, "platform.peppol.usage.view"), false);
  assert.strictEqual(authz.canPlatform(superSupport, "platform.ai.usage.view"), false);
});

test("canPlatform faalt op onbekend recht en op een tenantrecht", () => {
  assert.strictEqual(authz.canPlatform(god, "does.not.exist"), false);
  assert.strictEqual(authz.canPlatform(god, "peppol.send"), false); // tenantrecht is geen platformrecht
});

// ── Mona AI-monitoring: tenant NOOIT ─────────────────────────────────────────

test("tenant_admin kan geen enkel platform.ai.* of platform.peppol.*", () => {
  for (const p of authz.PLATFORM_PERMISSIONS) {
    assert.strictEqual(authz.canPlatform(tenantAdmin, p), false, p);
    assert.strictEqual(authz.canPlatform(employee, p), false, p);
  }
});

test("assertMonaAiTenantHidden gooit als een tenantprofiel per ongeluk platform.ai.* draagt", () => {
  const leaky = { role: "tenant_admin", tenantId: "t1", permissions: ["platform.ai.usage.view"] };
  assert.throws(() => authz.assertMonaAiTenantHidden(leaky), e => e.status === 403 && e.code === "AI_MONITORING_TENANT_FORBIDDEN");
});

test("assertMonaAiTenantHidden laat een schone tenant en een super_admin door", () => {
  assert.strictEqual(authz.assertMonaAiTenantHidden(employee), true);
  assert.strictEqual(authz.assertMonaAiTenantHidden(tenantAdmin), true);
  assert.strictEqual(authz.assertMonaAiTenantHidden({ role: "super_admin", permissions: ["platform.ai.usage.view"] }), true);
});

test("tenant-wildcard '*' verruimt NOOIT naar een platform.ai-recht", () => {
  const wild = { role: "employee", tenantId: "t1", permissions: ["*"] };
  assert.strictEqual(authz.canPlatform(wild, "platform.ai.usage.view"), false);
  assert.strictEqual(authz.assertMonaAiTenantHidden(wild), true); // '*' is geen expliciet platform.ai-recht
});

// ── canTenant: operationele tenantacties ─────────────────────────────────────

test("tenant_admin heeft de niet-gevoelige tenantrechten binnen de eigen tenant", () => {
  assert.strictEqual(authz.canTenant(tenantAdmin, "integrations.view", { tenantId: "t1" }), true);
  assert.strictEqual(authz.canTenant(tenantAdmin, "peppol.send", { tenantId: "t1" }), true);
  assert.strictEqual(authz.canTenant(tenantAdmin, "payroll.prepare", { tenantId: "t1" }), true);
});

test("employee krijgt een tenantrecht alleen via een expliciete grant", () => {
  assert.strictEqual(authz.canTenant(employee, "integrations.view", { tenantId: "t1" }), false);
  const granted = { role: "employee", tenantId: "t1", permissions: ["integrations.view"] };
  assert.strictEqual(authz.canTenant(granted, "integrations.view", { tenantId: "t1" }), true);
  assert.strictEqual(authz.canTenant(granted, "integrations.connect", { tenantId: "t1" }), false);
});

test("scope-prefix op een grant wordt genegeerd voor de capability-vlag", () => {
  const granted = { role: "manager", tenantId: "t1", permissions: ["read:integrations.view", "own:peppol.send"] };
  assert.strictEqual(authz.canTenant(granted, "integrations.view", { tenantId: "t1" }), true);
  assert.strictEqual(authz.canTenant(granted, "peppol.send", { tenantId: "t1" }), true);
});

test("super_admin mag een tenant-operationele send ALLEEN met tenantcontext", () => {
  assert.strictEqual(authz.canTenant(god, "peppol.send", {}), false);          // contextloos = weigering
  assert.strictEqual(authz.canTenant(god, "peppol.send", { tenantId: "t1" }), true);
});

test("cross-tenant: een tenantgebruiker mag niet in een andere tenant handelen", () => {
  const granted = { role: "tenant_admin", tenantId: "t1" };
  assert.strictEqual(authz.canTenant(granted, "integrations.view", { tenantId: "t2" }), false);
  assert.strictEqual(authz.canTenant(granted, "integrations.view", { tenantId: "t1" }), true);
});

test("canTenant weigert een platformrecht (geen crossover)", () => {
  assert.strictEqual(authz.canTenant(tenantAdmin, "platform.ai.usage.view", { tenantId: "t1" }), false);
  assert.strictEqual(authz.canTenant(tenantAdmin, "platform.peppol.usage.view", { tenantId: "t1" }), false);
});

test("gevoelig recht sso.enforce vereist een expliciete grant, ook voor tenant_admin", () => {
  assert.strictEqual(authz.canTenant(tenantAdmin, "sso.enforce", { tenantId: "t1" }), false);
  assert.strictEqual(authz.canTenant(tenantAdmin, "sso.configure", { tenantId: "t1" }), true); // niet-gevoelig
  const withEnforce = { role: "tenant_admin", tenantId: "t1", permissions: ["sso.enforce"] };
  assert.strictEqual(authz.canTenant(withEnforce, "sso.enforce", { tenantId: "t1" }), true);
  assert.strictEqual(authz.isSensitive("sso.enforce"), true);
});

test("'*'-tenantwildcard dekt niet-gevoelige tenantrechten maar niet sso.enforce", () => {
  const wild = { role: "manager", tenantId: "t1", permissions: ["*"] };
  assert.strictEqual(authz.canTenant(wild, "developer.api.manage", { tenantId: "t1" }), true);
  assert.strictEqual(authz.canTenant(wild, "sso.enforce", { tenantId: "t1" }), false);
});

// ── Reseller: nul rechten in dit domein (sectie 19) ──────────────────────────

test("reseller krijgt GEEN enkel platform- of tenantrecht in dit domein", () => {
  for (const p of authz.PLATFORM_PERMISSIONS) assert.strictEqual(authz.canPlatform(reseller, p), false, p);
  for (const p of authz.TENANT_PERMISSIONS) {
    assert.strictEqual(authz.canTenant(reseller, p, { tenantId: "t1" }), false, p);
  }
});

test("reseller met platform.ai in permissions wordt door assertMonaAiTenantHidden geweigerd", () => {
  const leakyReseller = { role: "reseller", resellerId: "r1", permissions: ["platform.ai.credits.manage"] };
  assert.throws(() => authz.assertMonaAiTenantHidden(leakyReseller), e => e.code === "AI_MONITORING_TENANT_FORBIDDEN");
});

// ── Vierogencontrole (payroll approval + pricing) ────────────────────────────

test("requiresFourEyes geldt voor payroll-goedkeuring en prijswijziging, niet voor gewone acties", () => {
  assert.strictEqual(authz.requiresFourEyes("payroll.period.approve"), true);
  assert.strictEqual(authz.requiresFourEyes("platform.peppol.pricing.manage"), true);
  assert.strictEqual(authz.requiresFourEyes("peppol.send"), false);
  assert.strictEqual(authz.requiresFourEyes("payroll.prepare"), false);
});

test("payroll SoD: indiener mag eigen finale aanlevering niet goedkeuren", () => {
  assert.throws(
    () => authz.assertFourEyes("payroll.period.approve", "u1", "u1"),
    e => e.status === 403 && e.code === "SELF_APPROVAL_FORBIDDEN",
  );
  assert.strictEqual(authz.assertFourEyes("payroll.period.approve", "approver", "submitter"), true);
});

test("assertFourEyes is een no-op voor een niet-vierogenrecht", () => {
  assert.strictEqual(authz.assertFourEyes("payroll.prepare", "u1", "u1"), true);
});

test("assertNotSelfApproval wordt herbruikt uit reseller-authz (dezelfde code)", () => {
  assert.throws(() => authz.assertNotSelfApproval("a", "a"), e => e.code === "SELF_APPROVAL_FORBIDDEN");
  assert.strictEqual(authz.assertNotSelfApproval("a", "b"), true);
});

// ── Asserts / anti-lek fouten ────────────────────────────────────────────────

test("assertCanPlatform gooit een generieke 403 bij weigering, slaagt bij toegang", () => {
  assert.throws(() => authz.assertCanPlatform(tenantAdmin, "platform.ai.usage.view"),
    e => e.status === 403 && e.code === "PLATFORM_SCOPE_REQUIRED" && e.message === "Geen toegang");
  assert.strictEqual(authz.assertCanPlatform(god, "platform.ai.usage.view"), true);
});

test("assertCanTenant gooit een generieke 403 bij weigering, slaagt bij toegang", () => {
  assert.throws(() => authz.assertCanTenant(employee, "peppol.send", { tenantId: "t1" }),
    e => e.status === 403 && e.code === "TENANT_PERMISSION_REQUIRED" && e.message === "Geen toegang");
  assert.strictEqual(authz.assertCanTenant(tenantAdmin, "peppol.send", { tenantId: "t1" }), true);
});

test("forbiddenError lekt niets: vaste boodschap 'Geen toegang'", () => {
  const e = authz.forbiddenError();
  assert.strictEqual(e.status, 403);
  assert.strictEqual(e.message, "Geen toegang");
  assert.strictEqual(e.code, "INTEGRATIONS_FORBIDDEN");
});

// ── Scope-mapping & classificatie ────────────────────────────────────────────

test("platformScopeFor mapt elk platformrecht op een bestaande PLATFORM_SCOPE", () => {
  for (const p of authz.PLATFORM_PERMISSIONS) {
    const sc = authz.platformScopeFor(p);
    assert.ok(authz.PLATFORM_SCOPES.includes(sc), `${p} -> ${sc}`);
  }
  assert.strictEqual(authz.platformScopeFor("peppol.send"), null); // tenantrecht heeft geen platformscope
});

test("permissionInfo classificeert platform vs tenant, sensitive en fourEyes", () => {
  assert.deepStrictEqual(authz.permissionInfo("platform.peppol.pricing.manage"),
    { kind: "platform", scope: "platform", requiredScope: "billing", sensitive: false, fourEyes: true });
  assert.deepStrictEqual(authz.permissionInfo("sso.enforce"),
    { kind: "tenant", scope: "tenant", requiredScope: null, sensitive: true, fourEyes: false });
  assert.deepStrictEqual(authz.permissionInfo("payroll.period.approve"),
    { kind: "tenant", scope: "tenant", requiredScope: null, sensitive: false, fourEyes: true });
  assert.strictEqual(authz.permissionInfo("nope"), null);
});
