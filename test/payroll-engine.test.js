"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const P = require("../src/modules/payroll-engine");

// ── Fake store (hand-rolled · zoals test/roles.test.js) ──────────────────────
function makeStore(seed = {}) {
  const data = {
    payrollPeriods: [], payrollEntries: [], payrollEmployeeMappings: [], payrollCodeMappings: [],
    payrollExports: [], payrollImportResults: [], payrollCorrections: [], payrollConnections: [],
    auditLogs: [], users: [], clocks: [], leaves: [], tenants: [], ...seed,
  };
  return {
    data,
    audit(e) { data.auditLogs.push(e); },
    save() {},
    insert(c, row) { (data[c] = data[c] || []).push(row); return row; },
    list(c, tenantId) { const a = data[c] || []; return tenantId ? a.filter(r => r.tenantId === tenantId) : a; },
    get(c, id) { return (data[c] || []).find(r => r.id === id); },
    update(c, id, patch) { const a = data[c] || []; const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...patch }; return a[i]; } return null; },
  };
}
const T = { id: "t1", name: "Acme BV" };
const userA = { email: "prep@acme.be" };
const userB = { email: "boss@acme.be" };

function reachApproved(store, tenant, periodId, prep = userA, appr = userB) {
  P.transitionPeriod(store, tenant, { periodId, to: "voorbereiding" }, prep);
  P.transitionPeriod(store, tenant, { periodId, to: "review" }, prep);
  P.approvePeriod(store, tenant, { periodId }, appr);
}

// ── 1. Entiteitvalidatoren (10.1) ────────────────────────────────────────────

test("validateEmployer eist een ondernemingsnummer", () => {
  assert.equal(P.validateEmployer({}).some(e => e.code === "COMPANY_NUMBER_REQUIRED"), true);
  assert.deepEqual(P.validateEmployer({ companyNumber: "0123", payrollFrequency: "monthly" }), []);
});

test("validateEmployer weigert een onbekende loonfrequentie", () => {
  assert.equal(P.validateEmployer({ companyNumber: "0123", payrollFrequency: "yearly" })[0].code, "FREQUENCY_INVALID");
});

test("validateEmployee eist employeeId en personeelsnummer", () => {
  const errs = P.validateEmployee({});
  assert.equal(errs.some(e => e.code === "EMPLOYEE_ID_REQUIRED"), true);
  assert.equal(errs.some(e => e.code === "PERSONNEL_NUMBER_REQUIRED"), true);
  assert.deepEqual(P.validateEmployee({ employeeId: "e1", personnelNumber: "P001" }), []);
});

test("validatePerformance eist positieve uren en een geldige soort", () => {
  assert.equal(P.validatePerformance({ employeeId: "e1", code: "1", value: 0 })[0].code, "VALUE_INVALID");
  assert.equal(P.validatePerformance({ employeeId: "e1", code: "1", value: 8, kind: "kosmos" })[0].code, "PERFORMANCE_KIND_INVALID");
  assert.deepEqual(P.validatePerformance({ employeeId: "e1", code: "1", value: 8, kind: "overtime" }), []);
});

test("validateAbsence weigert een onbekend afwezigheidstype", () => {
  assert.equal(P.validateAbsence({ employeeId: "e1", absenceType: "vakantie", value: 1 })[0].code, "ABSENCE_TYPE_INVALID");
  assert.deepEqual(P.validateAbsence({ employeeId: "e1", absenceType: "ziekte", value: 2 }), []);
});

test("validateVariable weigert bedrag 0 en onbekend type", () => {
  assert.equal(P.validateVariable({ employeeId: "e1", variableType: "bonus", value: 0 })[0].code, "VALUE_INVALID");
  assert.equal(P.validateVariable({ employeeId: "e1", variableType: "xyz", value: 5 })[0].code, "VARIABLE_TYPE_INVALID");
});

test("validateMutation eist een geldige ingangsdatum", () => {
  assert.equal(P.validateMutation({ employeeId: "e1", mutationType: "in_dienst", effectiveDate: "01-01-2026" })[0].code, "EFFECTIVE_DATE_INVALID");
  assert.deepEqual(P.validateMutation({ employeeId: "e1", mutationType: "in_dienst", effectiveDate: "2026-01-01" }), []);
});

test("validateEntry dispatcht op type en weigert een onbekend type", () => {
  assert.equal(P.validateEntry({ type: "loon" })[0].code, "ENTRY_TYPE_INVALID");
  assert.deepEqual(P.validateEntry({ type: "performance", employeeId: "e1", code: "1", value: 8 }), []);
});

test("validatePeriod eist company en een go-live provider", () => {
  const errs = P.validatePeriod({ tenantId: "t1", period: "2026-06", provider: "onbekend" });
  assert.equal(errs.some(e => e.code === "COMPANY_REQUIRED"), true);
  assert.equal(errs.some(e => e.code === "PROVIDER_INVALID"), true);
  assert.deepEqual(P.validatePeriod({ tenantId: "t1", companyId: "c1", period: "2026-06", provider: "sdworx" }), []);
});

// ── 2. Periode-statemachine (11) ─────────────────────────────────────────────

test("assertPeriodTransition volgt de canonieke keten", () => {
  assert.equal(P.assertPeriodTransition("open", "voorbereiding"), true);
  assert.equal(P.assertPeriodTransition("review", "approved"), true);
  assert.throws(() => P.assertPeriodTransition("open", "approved"), e => e.code === "PERIOD_TRANSITION_INVALID" && e.status === 409);
  assert.throws(() => P.assertPeriodTransition("open", "onzin"), e => e.code === "PERIOD_STATE_INVALID" && e.status === 400);
});

test("closed is terminaal behoudens heropening naar correction", () => {
  assert.equal(P.isPeriodTerminal("closed"), true);
  assert.equal(P.isPeriodTerminal("processed"), false);
  assert.equal(P.assertPeriodTransition("closed", "correction"), true); // payroll.reopen
  assert.throws(() => P.assertPeriodTransition("closed", "open"), e => e.code === "PERIOD_TRANSITION_INVALID");
  assert.equal(P.periodLabel("ready"), "Klaar voor verzending");
});

// ── 3. Segregation of duties (23.9) ──────────────────────────────────────────

test("assertFourEyesApproval blokkeert self-approval en staat een andere goedkeurder toe", () => {
  assert.throws(() => P.assertFourEyesApproval("a@x", "a@x"), e => e.code === "SELF_APPROVAL_FORBIDDEN" && e.status === 403);
  assert.equal(P.assertFourEyesApproval("boss@x", "prep@x"), true);
  assert.equal(P.assertFourEyesApproval("a@x", "a@x", { fourEyes: false }), true); // vier-ogen uit
});

test("Payroll SoD · de voorbereider kan zijn eigen periode niet goedkeuren", () => {
  const store = makeStore();
  const period = P.openPeriod(store, T, { companyId: "c1", period: "2026-06", provider: "acerta" }, userA);
  P.addEntry(store, T, period.id, { type: "performance", employeeId: "e1", code: "1", value: 8 }, userA);
  P.transitionPeriod(store, T, { periodId: period.id, to: "voorbereiding" }, userA);
  P.transitionPeriod(store, T, { periodId: period.id, to: "review" }, userA);
  assert.throws(() => P.approvePeriod(store, T, { periodId: period.id }, userA), e => e.code === "SELF_APPROVAL_FORBIDDEN");
  const approved = P.approvePeriod(store, T, { periodId: period.id }, userB);
  assert.equal(approved.status, "approved");
  assert.equal(approved.approvedBy, userB.email);
});

// ── 4. Mappings via het connectorframework-mappingmodel ──────────────────────

test("resolveEmployeeMapping kiest de hoogste versie", () => {
  const maps = [
    P.buildEmployeeMapping({ employeeId: "e1", providerEmployeeId: "P1", version: 1 }),
    P.buildEmployeeMapping({ employeeId: "e1", providerEmployeeId: "P2", version: 2 }),
  ];
  assert.equal(P.resolveEmployeeMapping(maps, "e1").providerValue, "P2");
  assert.equal(P.resolveEmployeeMapping(maps, "nope"), null);
});

test("resolveCodeMapping scoopt op soort (kind)", () => {
  const maps = [
    P.buildCodeMapping({ kind: "performance", localCode: "1", providerCode: "PERF1" }),
    P.buildCodeMapping({ kind: "absence", localCode: "1", providerCode: "ABS1" }),
  ];
  assert.equal(P.resolveCodeMapping(maps, "performance", "1").providerValue, "PERF1");
  assert.equal(P.resolveCodeMapping(maps, "absence", "1").providerValue, "ABS1");
  assert.throws(() => P.buildCodeMapping({ kind: "loon", localCode: "1", providerCode: "X" }), e => e.code === "CODE_MAPPING_KIND_INVALID");
});

// ── 5. Connected vs Assisted per capability (10.3) ───────────────────────────

test("capabilityMode geeft de eerlijke modus en faalt bij niet-ondersteunde capability", () => {
  assert.equal(P.capabilityMode("sdworx", "performance"), "assisted");
  assert.throws(() => P.capabilityMode("sdworx", "monthly_delivery"), e => e.code === "CAPABILITY_NOT_SUPPORTED" && e.status === 422);
  assert.throws(() => P.capabilityMode("onbekend", "performance"), e => e.code === "PROVIDER_NOT_FOUND");
  assert.equal(P.supportsCapability("liantis", "monthly_delivery"), true);
});

test("providerCard toont per capability de modus voor de cockpit", () => {
  const card = P.providerCard("securex");
  assert.equal(card.provider, "securex");
  assert.equal(card.capabilities.some(c => c.capability === "loon_codes"), true);
  assert.equal(card.capabilities.every(c => P.PAYROLL_MODES.includes(c.mode)), true);
});

// ── 6. Adaptercontract (INT-11..14 · P1) ─────────────────────────────────────

test("assertAdapterContract dwingt de methodes per modus af", () => {
  const connected = {
    provider: "sdworx",
    capabilities: { performance: "connected" },
    buildPayload() {}, submit() {}, fetchStatus() {},
  };
  assert.equal(P.assertAdapterContract(connected), true);
  const noSubmit = { provider: "sdworx", capabilities: { performance: "connected" }, buildPayload() {} };
  assert.throws(() => P.assertAdapterContract(noSubmit), e => e.code === "ADAPTER_SUBMIT_REQUIRED");
  const assisted = { provider: "acerta", capabilities: { performance: "assisted" }, buildPayload() {}, buildAssistedPackage() {} };
  assert.equal(P.assertAdapterContract(assisted), true);
});

test("assertAdapterContract weigert platform-concerns en een onbekende provider", () => {
  const leaky = { provider: "sdworx", capabilities: { performance: "assisted" }, buildPayload() {}, buildAssistedPackage() {}, pricing: {} };
  assert.throws(() => P.assertAdapterContract(leaky), e => e.code === "ADAPTER_BOUNDARY_VIOLATION");
  assert.throws(() => P.assertAdapterContract({ provider: "xyz", capabilities: { performance: "assisted" }, buildPayload() {} }), e => e.code === "ADAPTER_PROVIDER_INVALID");
  assert.equal(typeof P.describeAdapterContract().methods.buildPayload, "string");
});

// ── 7. Canoniek exportpakket (puur) ──────────────────────────────────────────

test("buildCanonicalExport groepeert per medewerker, mapt providercodes en meldt onmapbaar", () => {
  const period = { tenantId: "t1", companyId: "c1", period: "2026-06", provider: "sdworx" };
  const codeMappings = [P.buildCodeMapping({ kind: "performance", localCode: "1", providerCode: "PERF1" })];
  const employeeMappings = [P.buildEmployeeMapping({ employeeId: "e1", providerEmployeeId: "SDX-1" })];
  const entries = [
    { type: "performance", employeeId: "e1", code: "1", value: 8 },
    { type: "performance", employeeId: "e2", code: "9", value: 4 }, // e2 en code 9 niet gemapt
  ];
  const built = P.buildCanonicalExport({ period, entries, employeeMappings, codeMappings });
  assert.equal(built.employees.length, 2);
  const e1 = built.employees.find(x => x.employeeId === "e1");
  assert.equal(e1.providerEmployeeId, "SDX-1");
  assert.equal(e1.lines[0].providerCode, "PERF1");
  assert.equal(built.unmapped.some(u => u.kind === "employee" && u.employeeId === "e2"), true);
  assert.equal(built.unmapped.some(u => u.kind === "code" && u.code === "9"), true);
});

test("checksum is stabiel voor identieke inhoud en verandert bij wijziging", () => {
  const period = { tenantId: "t1", companyId: "c1", period: "2026-06", provider: "sdworx" };
  const a = P.buildCanonicalExport({ period, entries: [{ type: "performance", employeeId: "e1", code: "1", value: 8 }] });
  const b = P.buildCanonicalExport({ period, entries: [{ type: "performance", employeeId: "e1", code: "1", value: 8 }] });
  const c = P.buildCanonicalExport({ period, entries: [{ type: "performance", employeeId: "e1", code: "1", value: 9 }] });
  assert.equal(P.checksum(a.core), P.checksum(b.core));
  assert.notEqual(P.checksum(a.core), P.checksum(c.core));
});

// ── 8. Store-gebonden periode-lifecycle ──────────────────────────────────────

test("openPeriod maakt een open periode en weigert een duplicaat", () => {
  const store = makeStore();
  const p = P.openPeriod(store, T, { companyId: "c1", period: "2026-06", provider: "liantis" }, userA);
  assert.equal(p.status, "open");
  assert.equal(p.tenantId, "t1");
  assert.equal(store.data.auditLogs.some(a => a.action === "payroll_period_opened"), true);
  assert.throws(() => P.openPeriod(store, T, { companyId: "c1", period: "2026-06", provider: "liantis" }, userA), e => e.code === "PAYROLL_PERIOD_EXISTS");
});

test("addEntry werkt in open en is geblokkeerd na review", () => {
  const store = makeStore();
  const p = P.openPeriod(store, T, { companyId: "c1", period: "2026-06", provider: "sdworx" }, userA);
  P.addEntry(store, T, p.id, { type: "absence", employeeId: "e1", absenceType: "ziekte", value: 2 }, userA);
  P.transitionPeriod(store, T, { periodId: p.id, to: "voorbereiding" }, userA);
  P.transitionPeriod(store, T, { periodId: p.id, to: "review" }, userA);
  assert.throws(() => P.addEntry(store, T, p.id, { type: "performance", employeeId: "e1", code: "1", value: 8 }, userA), e => e.code === "PAYROLL_PERIOD_LOCKED");
});

test("volledige keten open -> afgesloten met export en levering", () => {
  const store = makeStore();
  const p = P.openPeriod(store, T, { companyId: "c1", period: "2026-06", provider: "sdworx" }, userA);
  P.addEntry(store, T, p.id, { type: "performance", employeeId: "e1", code: "1", value: 8 }, userA);
  reachApproved(store, T, p.id);
  const exp = P.buildAndStoreExport(store, T, p.id, {}, userB);
  assert.equal(exp.version, 1);
  assert.equal(exp.checksum.length, 64);
  P.transitionPeriod(store, T, { periodId: p.id, to: "ready" }, userB);
  P.transitionPeriod(store, T, { periodId: p.id, to: "delivered" }, userB);
  P.recordImportResult(store, T, p.id, { status: "processed", providerReference: "SDX-REF-9" }, userB);
  const after = store.get("payrollPeriods", p.id);
  assert.equal(after.status, "processed");
  assert.equal(after.providerReference, "SDX-REF-9");
  P.transitionPeriod(store, T, { periodId: p.id, to: "closed" }, userB);
  assert.equal(store.get("payrollPeriods", p.id).status, "closed");
});

test("levering vereist een bestaande exportversie", () => {
  const store = makeStore();
  const p = P.openPeriod(store, T, { companyId: "c1", period: "2026-06", provider: "sdworx" }, userA);
  P.addEntry(store, T, p.id, { type: "performance", employeeId: "e1", code: "1", value: 8 }, userA);
  reachApproved(store, T, p.id);
  P.transitionPeriod(store, T, { periodId: p.id, to: "ready" }, userB);
  assert.throws(() => P.transitionPeriod(store, T, { periodId: p.id, to: "delivered" }, userB), e => e.code === "PAYROLL_NO_EXPORT");
});

test("buildAndStoreExport eist regels en een exporteerbare status", () => {
  const store = makeStore();
  const p = P.openPeriod(store, T, { companyId: "c1", period: "2026-06", provider: "sdworx" }, userA);
  assert.throws(() => P.buildAndStoreExport(store, T, p.id, {}, userA), e => e.code === "PAYROLL_NOT_EXPORTABLE");
  P.addEntry(store, T, p.id, { type: "performance", employeeId: "e1", code: "1", value: 8 }, userA);
  reachApproved(store, T, p.id);
  const ok = P.buildAndStoreExport(store, T, p.id, {}, userB);
  assert.equal(ok.version, 1);
});

// ── 9. Payroll correction (23.10) ────────────────────────────────────────────

test("Payroll correction · nieuwe exportversie verwijst naar de vorige en bewaart audit", () => {
  const store = makeStore();
  const p = P.openPeriod(store, T, { companyId: "c1", period: "2026-06", provider: "acerta" }, userA);
  P.addEntry(store, T, p.id, { type: "performance", employeeId: "e1", code: "1", value: 8 }, userA);
  reachApproved(store, T, p.id);
  const v1 = P.buildAndStoreExport(store, T, p.id, {}, userB);
  P.transitionPeriod(store, T, { periodId: p.id, to: "ready" }, userB);
  P.transitionPeriod(store, T, { periodId: p.id, to: "delivered" }, userB);
  const corr = P.correctPeriod(store, T, p.id, { reason: "fout uurloon" }, userB);
  assert.equal(corr.correctsVersion, 1);
  assert.equal(store.get("payrollPeriods", p.id).status, "correction");
  const v2 = P.buildAndStoreExport(store, T, p.id, {}, userB);
  assert.equal(v2.version, 2);
  assert.equal(v2.previousVersion, 1);
  assert.equal(v2.previousExportId, v1.id);
  assert.equal(store.data.auditLogs.some(a => a.action === "payroll_correction_opened"), true);
  // Historie blijft: v1 bestaat nog ongewijzigd.
  assert.equal(store.get("payrollExports", v1.id).version, 1);
});

test("correctPeriod eist een reden en een bestaande export", () => {
  const store = makeStore();
  const p = P.openPeriod(store, T, { companyId: "c1", period: "2026-06", provider: "acerta" }, userA);
  P.addEntry(store, T, p.id, { type: "performance", employeeId: "e1", code: "1", value: 8 }, userA);
  reachApproved(store, T, p.id);
  assert.throws(() => P.correctPeriod(store, T, p.id, { reason: "" }, userB), e => e.code === "PAYROLL_CORRECTION_REASON_REQUIRED");
});

// ── 10. Import-resultaat met afwijzing → correction ──────────────────────────

test("recordImportResult met afwijzing beweegt de periode naar correction", () => {
  const store = makeStore();
  const p = P.openPeriod(store, T, { companyId: "c1", period: "2026-06", provider: "securex" }, userA);
  P.addEntry(store, T, p.id, { type: "variable", employeeId: "e1", variableType: "bonus", value: 250 }, userA);
  reachApproved(store, T, p.id);
  P.buildAndStoreExport(store, T, p.id, {}, userB);
  P.transitionPeriod(store, T, { periodId: p.id, to: "ready" }, userB);
  P.transitionPeriod(store, T, { periodId: p.id, to: "delivered" }, userB);
  P.recordImportResult(store, T, p.id, { status: "rejected", errors: [{ code: "E1", message: "onbekende looncode" }] }, userB);
  assert.equal(store.get("payrollPeriods", p.id).status, "correction");
});

// ── 11. Cross-tenant isolatie (23.11) ────────────────────────────────────────

test("Cross-tenant · een andere tenant ziet de periode niet", () => {
  const store = makeStore();
  const p = P.openPeriod(store, T, { companyId: "c1", period: "2026-06", provider: "sdworx" }, userA);
  const other = { id: "t2", name: "Andere BV" };
  assert.throws(() => P.addEntry(store, other, p.id, { type: "performance", employeeId: "e1", code: "1", value: 8 }, userA), e => e.code === "PAYROLL_PERIOD_NOT_FOUND" && e.status === 404);
  assert.throws(() => P.transitionPeriod(store, other, { periodId: p.id, to: "voorbereiding" }, userA), e => e.code === "PAYROLL_PERIOD_NOT_FOUND");
  assert.equal(store.list("payrollPeriods", "t2").length, 0); // tenant-scoped list lekt niets
});

// ── 12. Assisted-pakket hergebruikt social-secretariat ───────────────────────

test("buildAssistedPackage levert een providerconform CSV-pakket (hergebruik)", () => {
  const store = makeStore({
    users: [{ id: "u1", tenantId: "t1", name: "Jan Jansens", role: "employee", insz: "" }],
  });
  const tenant = { id: "t1", name: "Acme BV", compliance: { socialSecretariat: { provider: "sdworx", affiliateNumber: "12345" }, rszEmployerId: "0123456789" } };
  const pkg = P.buildAssistedPackage(store, tenant, { from: "2026-06-01", to: "2026-06-30" });
  assert.equal(pkg.mode, "assisted");
  assert.equal(pkg.format, "csv");
  assert.equal(typeof pkg.csv, "string");
  assert.equal(pkg.csv.includes("insz"), true); // CSV-header uit social-secretariat
  assert.equal(pkg.export.provider, "sdworx");
});
