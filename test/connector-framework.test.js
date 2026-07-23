"use strict";
// INT-01 · gedeeld connectorframework (pure model- en vertaallaag). Manifest-
// validatie, capability-parsing, connection/mapping/sync-validatie, de
// statusmachines (connection + sync job), mappingresolutie op versie +
// geldigheidsperiode, en de architectuurbewaking van de adaptergrens.
const { test } = require("node:test");
const assert = require("node:assert");
const F = require("../src/platform/connector-framework");

// Een geldig basismanifest waarvan tests een veld wegnemen om fouten uit te lokken.
function baseManifest(patch = {}) {
  return {
    name: "Billit Peppol",
    category: "peppol",
    capabilities: ["invoices.write", "invoices.read"],
    authType: "apikey",
    scopes: ["peppol.send"],
    syncModes: ["push", "webhook"],
    webhookSupport: true,
    sandboxStatus: "available",
    entitlement: "integrations.peppol",
    ...patch,
  };
}

// ── Manifest-validatie ──

test("validateManifest · een volledig manifest levert geen veldfouten", () => {
  assert.deepEqual(F.validateManifest(baseManifest()), []);
});

test("validateManifest · ontbrekende naam geeft NAME_REQUIRED", () => {
  const errors = F.validateManifest(baseManifest({ name: "  " }));
  assert.ok(errors.some(e => e.field === "name" && e.code === "NAME_REQUIRED"));
});

test("validateManifest · onbekende categorie geeft CATEGORY_INVALID", () => {
  const errors = F.validateManifest(baseManifest({ category: "verzonnen" }));
  assert.ok(errors.some(e => e.code === "CATEGORY_INVALID"));
});

test("validateManifest · onbekend authenticatietype geeft AUTH_TYPE_INVALID", () => {
  const errors = F.validateManifest(baseManifest({ authType: "magic" }));
  assert.ok(errors.some(e => e.code === "AUTH_TYPE_INVALID"));
});

test("validateManifest · een ongeldige capability wordt per index gemeld", () => {
  const errors = F.validateManifest(baseManifest({ capabilities: ["invoices.write", "kapot"] }));
  assert.ok(errors.some(e => e.field === "capabilities[1]" && e.code === "CAPABILITY_INVALID"));
});

test("validateManifest · lege syncmodi geeft SYNC_MODES_REQUIRED", () => {
  const errors = F.validateManifest(baseManifest({ syncModes: [] }));
  assert.ok(errors.some(e => e.code === "SYNC_MODES_REQUIRED"));
});

test("validateManifest · webhookondersteuning moet een boolean zijn", () => {
  const errors = F.validateManifest(baseManifest({ webhookSupport: "ja" }));
  assert.ok(errors.some(e => e.code === "WEBHOOK_SUPPORT_INVALID"));
});

test("validateManifest · onbekende sandboxstatus en ontbrekend entitlement", () => {
  const errors = F.validateManifest(baseManifest({ sandboxStatus: "misschien", entitlement: "" }));
  assert.ok(errors.some(e => e.code === "SANDBOX_STATUS_INVALID"));
  assert.ok(errors.some(e => e.code === "ENTITLEMENT_REQUIRED"));
});

test("assertManifest · gooit de eerste veldfout als Error met .status/.code", () => {
  assert.throws(() => F.assertManifest(baseManifest({ category: "x" })), e => e.status === 400 && e.code === "CATEGORY_INVALID");
  assert.equal(F.assertManifest(baseManifest()), true);
});

// ── Capability object.actie ──

test("parseCapability · geldige sleutels customers.read / invoices.write / payroll.export", () => {
  assert.deepEqual(F.parseCapability("customers.read"), { object: "customers", action: "read", key: "customers.read" });
  assert.equal(F.parseCapability("invoices.write").action, "write");
  assert.equal(F.parseCapability("payroll.export").object, "payroll");
});

test("parseCapability · verkeerde vorm en onbekende actie gooien onderscheiden codes", () => {
  assert.throws(() => F.parseCapability("customers"), e => e.code === "CAPABILITY_INVALID");
  assert.throws(() => F.parseCapability("customers.frobnicate"), e => e.code === "CAPABILITY_ACTION_INVALID");
  assert.equal(F.isCapability("customers.read"), true);
  assert.equal(F.isCapability("nope"), false);
  assert.equal(F.capabilityKey("invoices", "write"), "invoices.write");
});

// ── Connection-validatie ──

test("validateConnection · vereist tenant, provider, geldige omgeving en status", () => {
  const ok = F.validateConnection({ tenantId: "t1", provider: "billit", environment: "sandbox", status: "connected", health: "healthy" });
  assert.deepEqual(ok, []);
  const bad = F.validateConnection({ provider: "billit", environment: "acc", status: "onbekend" });
  assert.ok(bad.some(e => e.code === "TENANT_REQUIRED"));
  assert.ok(bad.some(e => e.code === "ENVIRONMENT_INVALID"));
  assert.ok(bad.some(e => e.code === "STATUS_INVALID"));
});

test("validateConnection · een ruw secret in de connection is verboden (A13)", () => {
  const errors = F.validateConnection({ tenantId: "t1", provider: "billit", environment: "production", status: "draft", apiKey: "sk_live_123" });
  assert.ok(errors.some(e => e.code === "RAW_SECRET_FORBIDDEN" && e.field === "apiKey"));
});

// ── Connection-statusmachine ──

test("assertConnectionTransition · geldige overgangen slagen, ongeldige gooien", () => {
  assert.equal(F.assertConnectionTransition("connected", "error"), true);
  assert.equal(F.assertConnectionTransition("error", "connected"), true);
  assert.throws(() => F.assertConnectionTransition("draft", "disconnected"), e => e.status === 409 && e.code === "CONNECTION_TRANSITION_INVALID");
});

test("assertConnectionTransition · revoked is terminaal en onbekende status is 400", () => {
  assert.ok(F.isTerminal("connection", "revoked"));
  assert.throws(() => F.assertConnectionTransition("revoked", "connected"), e => e.code === "CONNECTION_TRANSITION_INVALID");
  assert.throws(() => F.assertConnectionTransition("connected", "zombie"), e => e.status === 400 && e.code === "CONNECTION_STATE_INVALID");
});

// ── Sync-job-statusmachine ──

test("assertSyncJobTransition · queued mag niet rechtstreeks naar succeeded", () => {
  assert.throws(() => F.assertSyncJobTransition("queued", "succeeded"), e => e.code === "SYNC_JOB_TRANSITION_INVALID");
  assert.equal(F.assertSyncJobTransition("queued", "running"), true);
});

test("assertSyncJobTransition · retry-lus partial → retrying → running en succeeded terminaal", () => {
  F.assertSyncJobTransition("running", "partial");
  F.assertSyncJobTransition("partial", "retrying");
  F.assertSyncJobTransition("retrying", "running");
  assert.ok(F.isTerminal("sync_job", "succeeded"));
  assert.throws(() => F.assertSyncJobTransition("succeeded", "running"), e => e.code === "SYNC_JOB_TRANSITION_INVALID");
});

// ── Mapping-validatie + resolutie op geldigheidsperiode ──

test("validateMapping · vereist localField/code, providerwaarde en een geldige versie", () => {
  assert.deepEqual(F.validateMapping({ localField: "customers.vat", providerValue: "client.vat_number", version: 1 }), []);
  const bad = F.validateMapping({ providerValue: "", version: 0 });
  assert.ok(bad.some(e => e.code === "LOCAL_FIELD_REQUIRED"));
  assert.ok(bad.some(e => e.code === "PROVIDER_VALUE_REQUIRED"));
  assert.ok(bad.some(e => e.code === "VERSION_INVALID"));
});

test("validateMapping · validTo moet na validFrom liggen", () => {
  const errors = F.validateMapping({ localField: "a", providerValue: "b", validFrom: "2026-07-01", validTo: "2026-06-01" });
  assert.ok(errors.some(e => e.code === "VALIDITY_RANGE_INVALID"));
});

test("resolveMapping · kiest de hoogste geldige versie op het moment", () => {
  const mappings = [
    { localField: "status", providerValue: "OPEN", version: 1, validFrom: "2026-01-01" },
    { localField: "status", providerValue: "DRAFT", version: 2, validFrom: "2026-01-01" },
    { localField: "other", providerValue: "X", version: 9 },
  ];
  const hit = F.resolveMapping(mappings, "status", "2026-07-01");
  assert.equal(hit.providerValue, "DRAFT");
  assert.equal(hit.version, 2);
});

test("resolveMapping · respecteert de geldigheidsperiode [validFrom, validTo)", () => {
  const mappings = [
    { localField: "code", providerValue: "OUD", version: 1, validFrom: "2026-01-01", validTo: "2026-07-01" },
    { localField: "code", providerValue: "NIEUW", version: 1, validFrom: "2026-07-01" },
  ];
  assert.equal(F.resolveMapping(mappings, "code", "2026-06-15").providerValue, "OUD");
  // Op precies validTo is de oude verlopen en de nieuwe actief (half-open interval).
  assert.equal(F.resolveMapping(mappings, "code", "2026-07-01").providerValue, "NIEUW");
});

test("resolveMapping · geen geldige mapping geeft null, ook bij een onparseerbare grens (faalt dicht)", () => {
  assert.equal(F.resolveMapping([{ localField: "x", providerValue: "y", validFrom: "2099-01-01" }], "x", "2026-07-01"), null);
  assert.equal(F.resolveMapping([{ localField: "x", providerValue: "y", validTo: "geen-datum" }], "x", "2026-07-01"), null);
  assert.equal(F.resolveMapping([], "x", "2026-07-01"), null);
});

test("resolveMapping · matcht ook op code (payroll-codemapping)", () => {
  const mappings = [{ code: "OVT", providerValue: "1000", version: 1 }];
  assert.equal(F.resolveMapping(mappings, "OVT").providerValue, "1000");
});

// ── Sync-item-validatie ──

test("validateSyncItem · error-status vereist een foutcode", () => {
  const ok = F.validateSyncItem({ syncJobId: "j1", sourceRecord: { id: 1 }, mappingStatus: "mapped", reconciliationStatus: "matched" });
  assert.deepEqual(ok, []);
  const bad = F.validateSyncItem({ syncJobId: "j1", sourceRecord: { id: 1 }, mappingStatus: "error", reconciliationStatus: "pending" });
  assert.ok(bad.some(e => e.code === "ERROR_CODE_REQUIRED"));
});

// ── Sync-job-validatie · A11 tweerichtingssync ──

test("validateSyncJob · bidirectional zonder conflictregels is verboden (A11)", () => {
  const bad = F.validateSyncJob({ direction: "bidirectional", status: "queued", correlationId: "c1" });
  assert.ok(bad.some(e => e.code === "SYNC_CONFLICT_RULES_REQUIRED"));
  const ok = F.validateSyncJob({ direction: "bidirectional", status: "queued", correlationId: "c1", conflictPolicy: { strategy: "source_wins" } });
  assert.deepEqual(ok, []);
  const noCorr = F.validateSyncJob({ direction: "push", status: "queued", correlationId: "" });
  assert.ok(noCorr.some(e => e.code === "CORRELATION_ID_REQUIRED"));
});

// ── Architectuurbewaking (A09/A10) ──

test("assertAdapterBoundary · een adapter die platform-concerns declareert wordt geweigerd", () => {
  const clean = { name: "billit", provider: "billit", capabilities: ["invoices.write"], toCanonical() {}, toProvider() {} };
  assert.equal(F.assertAdapterBoundary(clean), true);
  assert.deepEqual(F.adapterBoundaryViolations(clean), []);
  const leaky = { name: "billit", pricing: { unit: 0.4 }, retryPolicy: {}, permissions: ["x"] };
  const violations = F.adapterBoundaryViolations(leaky);
  assert.ok(violations.includes("pricing") && violations.includes("retryPolicy") && violations.includes("permissions"));
  assert.throws(() => F.assertAdapterBoundary(leaky), e => e.status === 422 && e.code === "ADAPTER_BOUNDARY_VIOLATION");
});

test("assertHealth · valideert enkel de waarde, niet een overgang", () => {
  assert.equal(F.assertHealth("degraded"), true);
  assert.throws(() => F.assertHealth("op-vakantie"), e => e.code === "HEALTH_INVALID");
});
