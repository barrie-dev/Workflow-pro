"use strict";

// Connector-service (INT-01): store-gebonden integratielaag boven het pure
// connectorframework. Getest met een hand-rolled fake store · geen migratie,
// geen netwerk. Nadruk op de harde regels: secret nooit terugleesbaar,
// cross-tenant onmogelijk, mappingversie-resolutie, syncjob-retry/reconciliatie.

const { test } = require("node:test");
const assert = require("node:assert");

const S = require("../src/modules/connector-service");

function makeStore() {
  const data = {
    integrationConnectors: [], integrationConnections: [], integrationCredentials: [],
    integrationMappings: [], integrationSyncJobs: [], integrationSyncItems: [],
    integrationEvents: [], auditLogs: [],
  };
  return {
    data,
    audit(e) { data.auditLogs.push(e); return e; },
    save() {},
    insert(c, row) { (data[c] = data[c] || []).push(row); return row; },
    list(c, tenantId) { const a = data[c] || []; return tenantId ? a.filter(r => r.tenantId === tenantId) : a; },
    get(c, id) { return (data[c] || []).find(r => r.id === id); },
    update(c, id, patch) { const a = data[c] || []; const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...patch }; return a[i]; } return null; },
    remove(c, id) { const a = data[c] || []; const before = a.length; data[c] = a.filter(x => x.id !== id); return before !== data[c].length; },
  };
}

const actor = { email: "admin@t1.be" };
const tenant = { id: "t1" };
const tenantB = { id: "t2" };
const MANIFEST = {
  key: "billit", name: "Billit Peppol", category: "peppol",
  capabilities: ["invoices.write", "invoices.read"], authType: "apikey",
  scopes: ["peppol.send"], syncModes: ["push", "webhook"], webhookSupport: true,
  sandboxStatus: "available", entitlement: "peppol",
};

// ── Helper: registreer connector + maak een verbonden connection ─────────────
function seedConnection(store, overrides = {}) {
  if (!store.data.integrationConnectors.length) S.registerConnector(store, MANIFEST, actor);
  return S.createConnection(store, tenant, { companyId: "co1", connectorId: "billit", environment: "sandbox", ...overrides }, actor);
}

// ── Catalogus ────────────────────────────────────────────────────────────────
test("registerConnector: valideert het manifest en is idempotent op de sleutel", () => {
  const store = makeStore();
  const c = S.registerConnector(store, MANIFEST, actor);
  assert.strictEqual(c.key, "billit");
  assert.strictEqual(c.tenantId, null, "catalogus is platformbreed");
  // Tweede registratie met dezelfde key werkt bij, dupliceert niet.
  S.registerConnector(store, { ...MANIFEST, name: "Billit v2" }, actor);
  assert.strictEqual(store.data.integrationConnectors.length, 1);
  assert.strictEqual(S.getConnector(store, "billit").name, "Billit v2");
});

test("registerConnector: ongeldig manifest -> 400, gesmokkelde platform-concern -> 422", () => {
  const store = makeStore();
  assert.throws(() => S.registerConnector(store, { ...MANIFEST, category: "bogus" }, actor), e => e.code === "CATEGORY_INVALID" && e.status === 400);
  // A09/A10: een manifest mag geen pricing/billing/retry/secrets declareren.
  assert.throws(() => S.registerConnector(store, { ...MANIFEST, pricing: { unit: 1 } }, actor), e => e.code === "ADAPTER_BOUNDARY_VIOLATION" && e.status === 422);
});

// ── Connections ────────────────────────────────────────────────────────────
test("createConnection: start als draft/unknown en erft entitlement van de connector", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  assert.strictEqual(conn.status, "draft");
  assert.strictEqual(conn.health, "unknown");
  assert.strictEqual(conn.provider, "billit");
  assert.strictEqual(conn.entitlement, "peppol");
  assert.strictEqual(conn.companyId, "co1");
});

test("createConnection: weigert een inline ruw secret op de connection (A13)", () => {
  const store = makeStore();
  S.registerConnector(store, MANIFEST, actor);
  assert.throws(
    () => S.createConnection(store, tenant, { provider: "billit", environment: "sandbox", apiKey: "sk-geheim-123" }, actor),
    e => e.code === "RAW_SECRET_FORBIDDEN");
  // en het secret is nergens opgeslagen
  assert.ok(!JSON.stringify(store.data).includes("sk-geheim-123"));
});

test("createConnection: dedup per tenant+company+provider+environment (A11/A12)", () => {
  const store = makeStore();
  seedConnection(store);
  assert.throws(() => seedConnection(store), e => e.code === "CONNECTION_EXISTS" && e.status === 409);
  // andere omgeving mag wel
  const prod = S.createConnection(store, tenant, { companyId: "co1", connectorId: "billit", environment: "production" }, actor);
  assert.strictEqual(prod.environment, "production");
});

test("connection-lifecycle: activate/pause geldig, verboden overgang -> 409", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  assert.strictEqual(S.activateConnection(store, tenant, conn.id, actor).status, "connected");
  assert.strictEqual(S.pauseConnection(store, tenant, conn.id, actor).status, "disconnected");
  S.revokeConnection(store, tenant, conn.id, actor);
  // revoked is terminaal: opnieuw activeren kan niet
  assert.throws(() => S.activateConnection(store, tenant, conn.id, actor), e => e.code === "CONNECTION_TRANSITION_INVALID" && e.status === 409);
});

test("recordConnectionHealth: geldige waarde ok, onbekende waarde -> 400", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  assert.strictEqual(S.recordConnectionHealth(store, tenant, conn.id, "degraded", actor).health, "degraded");
  assert.throws(() => S.recordConnectionHealth(store, tenant, conn.id, "kapot", actor), e => e.code === "HEALTH_INVALID");
});

test("cross-tenant: een vreemde tenant ziet/leest de connection niet (404, geen lek)", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  assert.throws(() => S.getConnection(store, tenantB, conn.id), e => e.status === 404 && e.code === "CONNECTION_NOT_FOUND");
  assert.throws(() => S.activateConnection(store, tenantB, conn.id, actor), e => e.status === 404);
  assert.strictEqual(S.listConnections(store, tenantB).length, 0);
  assert.strictEqual(S.listConnections(store, tenant).length, 1);
});

// ── Credentials · secret nooit terugleesbaar ─────────────────────────────────
test("storeCredential: secret wordt versleuteld opgeslagen en komt NOOIT terug in een read", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  const SECRET = "supersecretapikey-12345";
  const created = S.storeCredential(store, tenant, conn.id, { value: SECRET }, actor);
  // aanmaak-bevestiging: hint + versie, geen waarde
  assert.strictEqual(created.hasSecret, true);
  assert.strictEqual(created.version, 1);
  assert.strictEqual(created.value, undefined);
  assert.strictEqual(created.encryptedSecret, undefined);
  assert.ok(!JSON.stringify(created).includes(SECRET));
  // reads geven nooit de waarde
  assert.ok(!JSON.stringify(S.getCredential(store, tenant, conn.id)).includes(SECRET));
  assert.ok(!JSON.stringify(S.listCredentials(store, tenant, conn.id)).includes(SECRET));
  // opgeslagen rij is versleuteld, niet plain
  assert.ok(!store.data.integrationCredentials.some(r => JSON.stringify(r.encryptedSecret).includes(SECRET)));
  // audit lekt de waarde niet
  assert.ok(!store.data.auditLogs.some(a => String(a.detail).includes(SECRET)));
});

test("resolveCredentialSecret: enkel server-side ontsleutelt de bruikbare waarde", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  const SECRET = "roundtrip-secret-abcdef";
  S.storeCredential(store, tenant, conn.id, { value: SECRET }, actor);
  const resolved = S.resolveCredentialSecret(store, tenant, conn.id);
  assert.strictEqual(resolved.value, SECRET);
  assert.strictEqual(resolved.secretReference, "");
});

test("storeCredential: rotatie bumpt de versie en superseedt de vorige", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  S.storeCredential(store, tenant, conn.id, { value: "eerste-sleutel-000" }, actor);
  const v2 = S.storeCredential(store, tenant, conn.id, { value: "tweede-sleutel-111" }, actor);
  assert.strictEqual(v2.version, 2);
  assert.strictEqual(S.getCredential(store, tenant, conn.id).version, 2);
  const hist = S.listCredentials(store, tenant, conn.id);
  assert.deepStrictEqual(hist.map(c => c.status), ["active", "superseded"]);
  assert.strictEqual(S.resolveCredentialSecret(store, tenant, conn.id).value, "tweede-sleutel-111");
});

test("storeCredential: secret-referentie (externe vault) wordt bewaard, waarde niet gelekt", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  const REF = "vault://monargo/peppol/billit-key";
  const cred = S.storeCredential(store, tenant, conn.id, { secretReference: REF }, actor);
  assert.strictEqual(cred.hasSecret, true);
  assert.ok(!JSON.stringify(cred).includes(REF), "de hint maskeert de volledige referentie");
  const resolved = S.resolveCredentialSecret(store, tenant, conn.id);
  assert.strictEqual(resolved.secretReference, REF);
  assert.strictEqual(resolved.value, "");
});

test("credential cross-tenant: geen read en geen schrijf door een vreemde tenant", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  S.storeCredential(store, tenant, conn.id, { value: "x-geheim-999" }, actor);
  assert.throws(() => S.getCredential(store, tenantB, conn.id), e => e.status === 404);
  assert.throws(() => S.storeCredential(store, tenantB, conn.id, { value: "inbraak" }, actor), e => e.status === 404);
  assert.throws(() => S.resolveCredentialSecret(store, tenantB, conn.id), e => e.status === 404);
});

// ── Mappings · versie + geldigheid ───────────────────────────────────────────
test("mapping: automatische versie-ophoging en resolutie op geldigheidsvenster", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  const v1 = S.addMapping(store, tenant, conn.id, { localField: "customers.vat", providerValue: "client.vat_number", validFrom: "2026-01-01", validTo: "2026-06-01" }, actor);
  const v2 = S.addMapping(store, tenant, conn.id, { localField: "customers.vat", providerValue: "client.vat_v2", validFrom: "2026-06-01" }, actor);
  assert.strictEqual(v1.version, 1);
  assert.strictEqual(v2.version, 2, "versie wordt automatisch opgehoogd");
  // half-open interval [validFrom, validTo): 2026-03 valt op v1, 2026-07 op v2
  assert.strictEqual(S.resolveMapping(store, tenant, conn.id, "customers.vat", "2026-03-01T00:00:00Z").providerValue, "client.vat_number");
  assert.strictEqual(S.resolveMapping(store, tenant, conn.id, "customers.vat", "2026-07-01T00:00:00Z").providerValue, "client.vat_v2");
  // onbekende sleutel -> null
  assert.strictEqual(S.resolveMapping(store, tenant, conn.id, "onbekend.veld", "2026-07-01T00:00:00Z"), null);
});

test("mapping: providerwaarde is verplicht, en cross-tenant is onmogelijk", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  assert.throws(() => S.addMapping(store, tenant, conn.id, { localField: "x.y" }, actor), e => e.code === "PROVIDER_VALUE_REQUIRED");
  assert.throws(() => S.addMapping(store, tenantB, conn.id, { localField: "x.y", providerValue: "z" }, actor), e => e.status === 404);
  assert.throws(() => S.listMappings(store, tenantB, conn.id), e => e.status === 404);
});

// ── Sync jobs + items ────────────────────────────────────────────────────────
test("startSyncJob: queued met correlation-id en nul-tellers", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  const job = S.startSyncJob(store, tenant, conn.id, { direction: "push" }, actor);
  assert.strictEqual(job.status, "queued");
  assert.ok(job.correlationId, "correlation-id wordt gezet");
  assert.deepStrictEqual(job.counts, { processed: 0, succeeded: 0, failed: 0 });
});

test("startSyncJob: tweerichtingssync vereist een expliciet conflictbeleid (A11)", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  assert.throws(() => S.startSyncJob(store, tenant, conn.id, { direction: "bidirectional" }, actor), e => e.code === "SYNC_CONFLICT_RULES_REQUIRED");
  const ok = S.startSyncJob(store, tenant, conn.id, { direction: "bidirectional", conflictPolicy: { strategy: "monargo_wins" } }, actor);
  assert.strictEqual(ok.status, "queued");
});

test("syncjob-lifecycle: queued->running->succeeded is terminaal", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  const job = S.startSyncJob(store, tenant, conn.id, { direction: "pull" }, actor);
  S.transitionSyncJob(store, tenant, job.id, "running", {}, actor);
  const done = S.transitionSyncJob(store, tenant, job.id, "succeeded", { counts: { processed: 3, succeeded: 3 } }, actor);
  assert.strictEqual(done.status, "succeeded");
  assert.strictEqual(done.counts.processed, 3);
  // terminaal: geen verdere overgang en geen retry
  assert.throws(() => S.transitionSyncJob(store, tenant, job.id, "running", {}, actor), e => e.code === "SYNC_JOB_TRANSITION_INVALID");
  assert.throws(() => S.retrySyncJob(store, tenant, job.id, actor), e => e.code === "SYNC_JOB_TERMINAL");
});

test("syncjob-retry: failed -> retrying met backoff, en idempotent bij lopende retry", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  const job = S.startSyncJob(store, tenant, conn.id, { direction: "push" }, actor);
  S.transitionSyncJob(store, tenant, job.id, "running", {}, actor);
  S.transitionSyncJob(store, tenant, job.id, "failed", { error: "provider 503" }, actor);
  const r1 = S.retrySyncJob(store, tenant, job.id, actor);
  assert.strictEqual(r1.duplicate, false);
  assert.strictEqual(r1.job.status, "retrying");
  assert.strictEqual(r1.job.retry.attempts, 1);
  assert.ok(r1.job.retry.nextAttemptAt, "backoff wordt gezet");
  // opnieuw retryen terwijl hij al retrying is verandert niets (idempotent)
  const r2 = S.retrySyncJob(store, tenant, job.id, actor);
  assert.strictEqual(r2.duplicate, true);
  assert.strictEqual(r2.job.retry.attempts, 1);
});

test("recordSyncItem: tellers lopen bij, error vereist een foutcode, reconciliatie werkt", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  const job = S.startSyncJob(store, tenant, conn.id, { direction: "pull" }, actor);
  S.transitionSyncJob(store, tenant, job.id, "running", {}, actor);
  const okItem = S.recordSyncItem(store, tenant, job.id, { sourceRecord: { id: "src1" }, mappingStatus: "mapped", reconciliationStatus: "pending" }, actor);
  assert.strictEqual(okItem.reconciliationStatus, "pending");
  // een error-item zonder foutcode wordt geweigerd (framework)
  assert.throws(() => S.recordSyncItem(store, tenant, job.id, { sourceRecord: { id: "src2" }, mappingStatus: "error" }, actor), e => e.code === "ERROR_CODE_REQUIRED");
  S.recordSyncItem(store, tenant, job.id, { sourceRecord: { id: "src2" }, mappingStatus: "error", errorCode: "MAP_FAIL" }, actor);
  // tellers: 1 succes + 1 fout op 2 verwerkt
  const summary = S.syncJobSummary(store, tenant, job.id);
  assert.strictEqual(summary.counts.processed, 2);
  assert.strictEqual(summary.counts.succeeded, 1);
  assert.strictEqual(summary.counts.failed, 1);
  // reconciliatie: pending -> matched
  const rec = S.reconcileSyncItem(store, tenant, okItem.id, "matched", actor);
  assert.strictEqual(rec.reconciliationStatus, "matched");
  assert.throws(() => S.reconcileSyncItem(store, tenant, okItem.id, "bogus", actor), e => e.code === "RECONCILIATION_STATUS_INVALID");
});

test("syncjob + items cross-tenant: geen retry, geen item-injectie door vreemde tenant", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  const job = S.startSyncJob(store, tenant, conn.id, { direction: "push" }, actor);
  assert.throws(() => S.retrySyncJob(store, tenantB, job.id, actor), e => e.status === 404);
  assert.throws(() => S.recordSyncItem(store, tenantB, job.id, { sourceRecord: {}, mappingStatus: "mapped" }, actor), e => e.status === 404);
  assert.throws(() => S.listSyncItems(store, tenantB, job.id), e => e.status === 404);
  assert.strictEqual(S.listSyncJobs(store, tenantB).length, 0);
});

// ── Audit/technisch eventspoor (A08) ─────────────────────────────────────────
test("integration_events: elke actie logt een event, metadata wordt van secrets ontdaan", () => {
  const store = makeStore();
  const conn = seedConnection(store);
  S.activateConnection(store, tenant, conn.id, actor);
  const events = S.listEvents(store, tenant.id);
  assert.ok(events.length >= 2, "connection_created + connection_connected");
  assert.ok(events.some(e => e.action === "connection_created"));
  // metadata-secret wordt geredigeerd
  const ev = S.recordEvent(store, { tenantId: tenant.id, connector: "billit", actor, action: "probe", metadata: { apiKey: "sk-lek-abc", note: "veilig" } });
  assert.strictEqual(ev.metadata.apiKey, "[REDACTED]");
  assert.strictEqual(ev.metadata.note, "veilig");
  // audit meegeschreven
  assert.ok(store.data.auditLogs.some(a => a.action === "integration_probe"));
});

test("webhookRepository: hergebruikt de bestaande gedeelde runtime (geen duplicaat)", () => {
  const store = makeStore();
  store.data.webhookEndpoints = [];
  const repo = S.webhookRepository(store);
  assert.strictEqual(typeof repo.insert, "function");
  assert.strictEqual(typeof repo.rotateSecret, "function");
  // het signing secret verlaat de repo niet in een read
  const ep = repo.insert("t1", { url: "https://hook.monargo.one/in", eventTypes: ["invoice.created"] }, actor.email);
  const listed = repo.list("t1");
  assert.ok(!("secret" in listed[0]) || listed[0].secret === undefined);
  assert.ok(String(listed[0].secretHint).startsWith("whsec_"));
  assert.ok(ep.secret, "het volledige secret wordt eenmalig bij aanmaak teruggegeven");
});
