"use strict";
// CTO3-07 · centrale gedelegeerde tenanttoegang. De beslislaag is puur, dus de
// verplichte aanvalsscenario's uit de handover zijn hier direct toetsbaar:
// assignment zonder grant, cross-tenant grant, read-grant op write-route,
// verlopen/revoked grant, veldredactie ondanks read-grant, en geen
// existence-leak tussen resellers.
const { test } = require("node:test");
const assert = require("node:assert");
const A = require("../src/platform/reseller-authz");

const NOW = Date.parse("2026-07-24T12:00:00Z");
const grant = (over = {}) => ({
  id: "grant_1", resellerId: "res_a", tenantId: "t_klant", status: "active",
  scope: ["read"], startDate: "2026-07-01T00:00:00Z", endDate: "2026-12-31T00:00:00Z",
  dataClasses: [], ...over,
});

test("1· actieve klant-assignment zonder delegation → 403 (assignment is nooit genoeg)", () => {
  // Assignment bewijst alleen de commerciële relatie; zonder grant geen toegang.
  const user = { resellerId: "res_a", role: "reseller_operations" };
  const assignments = [{ tenantId: "t_klant", resellerId: "res_a", status: "active" }];
  assert.equal(A.tenantInScope(user, "t_klant", assignments, NOW), true, "assignment bestaat wel");
  const r = A.requireDelegatedTenantAccess({ grant: null, tenantId: "t_klant", method: "GET", action: "customers", now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.equal(r.code, "DELEGATED_ACCESS_REQUIRED");
});

test("2· delegation van tenant A gebruikt op tenant B → generieke 403 (geen bevestiging)", () => {
  const r = A.requireDelegatedTenantAccess({ grant: grant({ tenantId: "t_ander" }), tenantId: "t_klant", method: "GET", action: "customers", now: NOW });
  assert.equal(r.ok, false);
  // Zelfde code als "helemaal geen grant": geen hint dat er elders wél een grant is.
  assert.equal(r.code, "DELEGATED_ACCESS_REQUIRED");
});

test("3· read-grant op een write-route → 403 (read impliceert nooit write)", () => {
  const g = grant({ scope: ["read"] });
  assert.equal(A.requireDelegatedTenantAccess({ grant: g, tenantId: "t_klant", method: "GET", action: "customers", now: NOW }).ok, true);
  const w = A.requireDelegatedTenantAccess({ grant: g, tenantId: "t_klant", method: "POST", action: "customers", now: NOW });
  assert.equal(w.ok, false);
  assert.equal(w.requiredScope, "write");
  assert.equal(w.code, "DELEGATED_SCOPE_EXCEEDED");
  // Export is óók een aparte scope · een read-grant dekt geen export.
  const e = A.requireDelegatedTenantAccess({ grant: g, tenantId: "t_klant", method: "POST", action: "grid/customers/export", now: NOW });
  assert.equal(e.requiredScope, "export");
  assert.equal(e.ok, false);
});

test("4· verlopen en revoked grant → 403 met auditbare weigercode", () => {
  const expired = A.requireDelegatedTenantAccess({ grant: grant({ endDate: "2026-07-01T00:00:00Z" }), tenantId: "t_klant", method: "GET", action: "customers", now: NOW });
  assert.equal(expired.ok, false);
  assert.equal(expired.code, "DELEGATED_ACCESS_EXPIRED");
  assert.equal(expired.audit.decision, "deny");
  assert.equal(expired.audit.grantId, "grant_1");

  const revoked = A.requireDelegatedTenantAccess({ grant: grant({ status: "revoked" }), tenantId: "t_klant", method: "GET", action: "customers", now: NOW });
  assert.equal(revoked.ok, false);
  assert.equal(revoked.code, "DELEGATED_ACCESS_REVOKED");
  assert.equal(revoked.audit.decision, "deny");
});

test("5· financieel/HR gevoelig veld blijft geredigeerd ondanks een algemene read-grant", () => {
  const r = A.requireDelegatedTenantAccess({ grant: grant({ scope: ["read"] }), tenantId: "t_klant", method: "GET", action: "employees", now: NOW });
  assert.equal(r.ok, true, "read mag");
  assert.deepEqual(r.allowedDataClasses, [], "een read-grant ontsluit GEEN gevoelige dataklassen");
  const row = {
    id: "u1", name: "Jan Janssen", email: "jan@x.be",
    salary: 3200, iban: "BE68539007547034", rijksregisternummer: "85073003328",
    costRate: 42, medicalNote: "rugklachten", passwordHash: "abc",
    nested: { grossSalary: 4000, city: "Gent" },
    list: [{ marge: 12, description: "regel" }],
  };
  const safe = A.redactSensitiveFields(row, r.allowedDataClasses);
  assert.equal(safe.name, "Jan Janssen", "niet-gevoelige velden blijven");
  assert.equal(safe.email, "jan@x.be");
  for (const k of ["salary", "iban", "rijksregisternummer", "costRate", "medicalNote", "passwordHash"]) {
    assert.equal(safe[k], A.REDACTED, `${k} moet geredigeerd zijn`);
  }
  assert.equal(safe.nested.grossSalary, A.REDACTED, "geneste gevoelige velden ook");
  assert.equal(safe.nested.city, "Gent");
  assert.equal(safe.list[0].marge, A.REDACTED, "gevoelige velden in arrays ook");
  assert.equal(safe.list[0].description, "regel");
});

test("5b· een expliciet toegekende dataklasse ontsluit alleen die klasse", () => {
  const r = A.requireDelegatedTenantAccess({ grant: grant({ dataClasses: ["payroll"] }), tenantId: "t_klant", method: "GET", action: "employees", now: NOW });
  assert.deepEqual(r.allowedDataClasses, ["payroll"]);
  const safe = A.redactSensitiveFields({ salary: 3200, iban: "BE68", costRate: 42 }, r.allowedDataClasses);
  assert.equal(safe.salary, 3200, "payroll is vrijgegeven");
  assert.equal(safe.iban, A.REDACTED, "bank blijft verborgen");
  assert.equal(safe.costRate, A.REDACTED, "marge blijft verborgen");
});

test("6· geen object-existence-leak tussen resellers (identieke weigering)", () => {
  // Grant van een ANDERE reseller op deze tenant, en een onbestaande grant:
  // beide leveren exact dezelfde status + code + boodschap.
  const vreemd = A.requireDelegatedTenantAccess({ grant: grant({ resellerId: "res_b", tenantId: "t_ander" }), tenantId: "t_klant", method: "GET", action: "customers", now: NOW });
  const geen = A.requireDelegatedTenantAccess({ grant: null, tenantId: "t_klant", method: "GET", action: "customers", now: NOW });
  assert.equal(vreemd.status, geen.status);
  assert.equal(vreemd.code, geen.code);
  assert.equal(A.forbiddenError().message, "Geen toegang");
  assert.equal(A.notFoundError("deal").message, "Niet gevonden");
});

test("scope-afleiding: GET=read, mutatie=write, export/support/impersonation apart", () => {
  assert.equal(A.scopeForRequest("GET", "customers"), "read");
  assert.equal(A.scopeForRequest("HEAD", "customers"), "read");
  assert.equal(A.scopeForRequest("POST", "customers"), "write");
  assert.equal(A.scopeForRequest("PATCH", "facturen/x"), "write");
  assert.equal(A.scopeForRequest("DELETE", "customers/x"), "write");
  assert.equal(A.scopeForRequest("POST", "grid/customers/export"), "export");
  assert.equal(A.scopeForRequest("GET", "support/sessions"), "support");
  assert.equal(A.scopeForRequest("POST", "impersonate"), "impersonation");
  assert.deepEqual(A.DELEGATION_SCOPES, ["read", "write", "export", "support", "impersonation"]);
});

test("route-inventaris dekt de gevoelige inhoudsfamilies; onbekende route is het striktst", () => {
  assert.deepEqual(A.dataClassesForAction("employees").sort(), ["bank", "margin", "national_number", "payroll"]);
  assert.deepEqual(A.dataClassesForAction("payroll/export").sort(), ["bank", "national_number", "payroll"]);
  assert.deepEqual(A.dataClassesForAction("facturen/123"), ["margin"]);
  assert.deepEqual(A.dataClassesForAction("api-keys"), ["security"]);
  assert.deepEqual(A.dataClassesForAction("leaves"), ["medical"]);
  assert.deepEqual(A.dataClassesForAction("iets-onbekends"), [], "onbekend → geen enkele klasse vrijgegeven");
  // Elke gedefinieerde klasse in het register is een bekende dataklasse.
  for (const classes of Object.values(A.TENANT_CONTENT_DATA_CLASSES)) {
    for (const c of classes) assert.ok(A.DATA_CLASSES.includes(c), `onbekende dataklasse ${c}`);
  }
});
