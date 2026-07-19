"use strict";
// Universele overzichten, zoeken, bulkacties en export (master-spec h11/GRD):
// server-side filters met rechten, per-record bulkrapportage, exportcontext,
// gevoelige kolommen nooit zichtbaar, views zonder beheerrechten.
const { test } = require("node:test");
const assert = require("node:assert");

const {
  runQuery, previewBulk, runBulk, buildExport, createExportJob, getExportJob,
  makeViewRepository, sanitizeViewForUser, forbiddenColumns, matchesFilter, INLINE_EXPORT_LIMIT,
} = require("../src/platform/grid");

function fakeStore(data = {}) {
  const d = { customers: [], invoices: [], quotes: [], workorders: [], projects: [], gridViews: [], exportJobs: [], users: [], ...data };
  return {
    data: d,
    list(col, tid) { const r = d[col] || []; return tid == null ? r : r.filter(x => x.tenantId === tid); },
    get(col, id) { return (d[col] || []).find(x => x.id === id); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    update(col, id, patch) { d[col] = (d[col] || []).map(x => x.id === id ? { ...x, ...patch } : x); return (d[col] || []).find(x => x.id === id); },
    remove(col, id) { d[col] = (d[col] || []).filter(x => x.id !== id); },
    save() {},
  };
}
const TENANT = { id: "t1", name: "Demo Bouwgroep NV" };
const ADMIN = { id: "u1", email: "admin@x.be", tenantId: "t1", role: "tenant_admin", permissions: ["*"] };
const FINANCE = { id: "u4", email: "fin@x.be", tenantId: "t1", role: "employee", permissions: ["invoicing", "customers"] };
const TECH = { id: "u2", email: "tech@x.be", tenantId: "t1", role: "employee", permissions: ["own:workorders"] };

function seed() {
  return fakeStore({
    customers: [
      { id: "c1", tenantId: "t1", name: "Alfa Bouw", email: "a@x.be", city: "Gent", creditLimit: 5000, createdAt: "2026-01-01" },
      { id: "c2", tenantId: "t1", name: "Beta NV", email: "b@x.be", city: "Brugge", creditLimit: 1000, createdAt: "2026-02-01" },
      { id: "c3", tenantId: "t1", name: "Gamma bvba", email: "g@x.be", city: "Gent", creditLimit: 0, createdAt: "2026-03-01" },
    ],
    invoices: [{ id: "i1", tenantId: "t1", number: "2026-001", customerId: "c1", total: 1210, status: "open", createdAt: "2026-04-01" }],
    workorders: [
      { id: "w1", tenantId: "t1", number: "WO-1", title: "Ketel", userId: "u2", status: "open", createdAt: "2026-01-05" },
      { id: "w2", tenantId: "t1", number: "WO-2", title: "Dak", userId: "u3", status: "open", createdAt: "2026-01-06" },
    ],
  });
}

test("grid: filters draaien server-side en respecteren rechten", () => {
  const store = seed();
  const res = runQuery(store, TENANT, ADMIN, "customers", { filters: [{ field: "city", op: "eq", value: "Gent" }] });
  assert.equal(res.total, 2);
  assert.deepEqual(res.rows.map(r => r.name), ["Gamma bvba", "Alfa Bouw"], "standaard nieuwste eerst");
  // Zonder recht op de resource → 403.
  assert.throws(() => runQuery(store, TENANT, TECH, "customers", {}), e => e.status === 403 && e.code === "FORBIDDEN");
});

test("grid: scoping · own:workorders toont alleen eigen records", () => {
  const store = seed();
  const res = runQuery(store, TENANT, TECH, "workorders", {});
  assert.equal(res.total, 1, "own-scope beperkt tot eigen werkbonnen");
  assert.equal(res.rows[0].id, "w1");
  const alles = runQuery(store, TENANT, ADMIN, "workorders", {});
  assert.equal(alles.total, 2);
});

test("grid: operatoren, zoeken, sorteren en cursor-paginatie", () => {
  const store = seed();
  assert.equal(matchesFilter({ total: 500 }, { field: "total", op: "gt", value: 100 }), true);
  assert.equal(matchesFilter({ status: "open" }, { field: "status", op: "in", value: ["open", "paid"] }), true);
  assert.equal(matchesFilter({ name: "Alfa Bouw" }, { field: "name", op: "contains", value: "bouw" }), true);
  assert.equal(matchesFilter({ note: "" }, { field: "note", op: "empty" }), true);
  assert.equal(matchesFilter({ d: "2026-05-01" }, { field: "d", op: "between", value: ["2026-01-01", "2026-12-31"] }), true);

  const zoek = runQuery(store, TENANT, ADMIN, "customers", { search: "beta" });
  assert.equal(zoek.total, 1);
  assert.equal(zoek.rows[0].name, "Beta NV");

  const p1 = runQuery(store, TENANT, ADMIN, "customers", { sort: { field: "name", dir: "asc" }, limit: 2 });
  assert.deepEqual(p1.rows.map(r => r.name), ["Alfa Bouw", "Beta NV"]);
  assert.equal(p1.nextCursor, "2");
  const p2 = runQuery(store, TENANT, ADMIN, "customers", { sort: { field: "name", dir: "asc" }, limit: 2, cursor: p1.nextCursor });
  assert.deepEqual(p2.rows.map(r => r.name), ["Gamma bvba"]);
  assert.equal(p2.nextCursor, null);
});

test("grid: gevoelige kolommen verdwijnen uit lijst én export zonder recht", () => {
  const store = seed();
  assert.deepEqual(forbiddenColumns(ADMIN, "customers"), [], "beheerder ziet alles");
  assert.ok(forbiddenColumns(FINANCE, "customers").includes("creditLimit"));

  const alsAdmin = runQuery(store, TENANT, ADMIN, "customers", {});
  assert.equal(alsAdmin.rows[0].creditLimit !== undefined, true);
  const alsFinance = runQuery(store, TENANT, FINANCE, "customers", {});
  assert.equal(alsFinance.rows[0].creditLimit, undefined, "gevoelige kolom gestript");
  assert.ok(alsFinance.hiddenColumns.includes("creditLimit"), "expliciet gemeld welke kolommen verborgen zijn");

  const exp = buildExport(store, TENANT, FINANCE, "customers", {});
  assert.ok(!exp.columns.includes("creditLimit"), "ook niet in de export");
  assert.ok(!/creditLimit/.test(exp.csv));
});

test("grid: export draagt filtercontext en extractiemoment", () => {
  const store = seed();
  const now = new Date("2026-07-18T10:00:00Z");
  const exp = buildExport(store, TENANT, ADMIN, "customers", { filters: [{ field: "city", op: "eq", value: "Gent" }], search: "alfa" }, { now });
  assert.equal(exp.rowCount, 1);
  assert.match(exp.csv, /# Geëxtraheerd op: 2026-07-18T10:00:00\.000Z/);
  assert.match(exp.csv, /"field":"city"/, "filtercontext staat in de export");
  assert.match(exp.csv, /# Zoekterm: alfa/);
  assert.equal(exp.mode, "inline");
});

test("grid: financiële export vermeldt onderneming, valuta en datumcontext", () => {
  const store = seed();
  const now = new Date("2026-07-18T10:00:00Z");
  const exp = buildExport(store, TENANT, ADMIN, "invoices", {}, { now, company: { legalName: "Demo Bouwgroep NV", companyNumber: "0700.123.456" } });
  assert.match(exp.csv, /# Onderneming: Demo Bouwgroep NV/);
  assert.match(exp.csv, /# Ondernemingsnummer: 0700\.123\.456/);
  assert.match(exp.csv, /# Valuta: EUR/);
  assert.match(exp.csv, /# Datumcontext: 2026-07-18/);
});

test("grid: grote export wordt een job met downloadlink en vervaldatum", () => {
  const rows = Array.from({ length: INLINE_EXPORT_LIMIT + 5 }, (_, i) => ({ id: `c${i}`, tenantId: "t1", name: `Klant ${i}`, createdAt: "2026-01-01" }));
  const store = fakeStore({ customers: rows });
  const now = new Date("2026-07-18T10:00:00Z");
  const exp = buildExport(store, TENANT, ADMIN, "customers", {}, { now });
  // Regressie: een export mag NOOIT stilzwijgend afgekapt worden door de
  // paginalimiet · alle geselecteerde rijen horen erin te zitten.
  assert.equal(exp.rowCount, INLINE_EXPORT_LIMIT + 5, "volledige selectie, niet afgekapt op de paginagrootte");
  assert.equal(exp.csv.trim().split("\n").length, INLINE_EXPORT_LIMIT + 5 + 8, "contextregels + header + alle datarijen");
  assert.equal(exp.mode, "job");
  assert.ok(exp.expiresAt > now.toISOString());

  const job = createExportJob(store, TENANT, ADMIN, exp);
  assert.equal(job.status, "ready");
  assert.match(job.downloadPath, /\/grid\/exports\/exp_/);
  // Expliciet dezelfde klok als de export: anders wordt deze test vanzelf rood
  // zodra de echte tijd voorbij de vervaldatum schuift.
  assert.ok(getExportJob(store, TENANT, job.id, job.token, now), "download met geldig token");
  assert.throws(() => getExportJob(store, TENANT, job.id, "fout-token", now), e => e.code === "INVALID_TOKEN");
  // Vervallen download geeft 410.
  assert.throws(() => getExportJob(store, TENANT, job.id, job.token, new Date("2026-07-20T10:00:00Z")), e => e.code === "EXPIRED");
});

test("grid: bulkactie toont vooraf wat geraakt en wat overgeslagen wordt", () => {
  const store = seed();
  const preview = previewBulk(store, TENANT, ADMIN, "customers", "set_status", ["c1", "c2", "bestaat-niet"], { status: "inactief" });
  assert.equal(preview.affectedCount, 2);
  assert.equal(preview.skippedCount, 1);
  assert.equal(preview.skipped[0].reason, "NOT_FOUND");
  // Zonder waarde wordt alles overgeslagen.
  const leeg = previewBulk(store, TENANT, ADMIN, "customers", "set_status", ["c1"], {});
  assert.equal(leeg.affectedCount, 0);
  assert.equal(leeg.skipped[0].reason, "MISSING_VALUE");
});

test("grid: bulkactie rapporteert per record succes of fout", () => {
  const store = seed();
  const job = runBulk(store, TENANT, ADMIN, "customers", "set_status", ["c1", "c2", "weg"], { status: "inactief" }, "admin@x.be");
  assert.equal(job.status, "partial", "deels gelukt is een geldige uitkomst");
  assert.equal(job.succeeded, 2);
  assert.equal(job.failed, 1);
  assert.equal(job.results.filter(r => r.ok).length, 2);
  assert.equal(job.results.find(r => r.id === "weg").reason, "NOT_FOUND");
  assert.equal(store.get("customers", "c1").status, "inactief");
});

test("grid: bulkactie buiten je rechtenbereik wordt geweigerd, niet stil uitgevoerd", () => {
  const store = seed();
  // TECH heeft own:workorders → w2 is niet van hem.
  const job = runBulk(store, TENANT, TECH, "workorders", "set_status", ["w1", "w2"], { status: "klaar" }, "tech@x.be");
  assert.equal(job.succeeded, 1);
  assert.equal(job.results.find(r => r.id === "w2").reason, "FORBIDDEN");
  assert.equal(store.get("workorders", "w2").status, "open", "record van een ander onaangeroerd");
});

test("grid: verwijderen en archiveren zijn aparte acties; beschermde relaties blokkeren delete", () => {
  const store = seed();
  // c1 heeft een factuur → verwijderen geblokkeerd.
  const del = runBulk(store, TENANT, ADMIN, "customers", "delete", ["c1", "c3"], {}, "admin@x.be");
  assert.equal(del.results.find(r => r.id === "c1").reason, "PROTECTED_RELATIONS");
  assert.ok(/invoices/.test(del.results.find(r => r.id === "c1").message));
  assert.equal(del.results.find(r => r.id === "c3").ok, true, "zonder relaties mag verwijderen wel");
  assert.ok(store.get("customers", "c1"), "beschermd record bestaat nog");
  assert.equal(store.get("customers", "c3"), undefined);

  // Archiveren is een andere actie en raakt de relatiecheck niet.
  const arch = runBulk(store, TENANT, ADMIN, "customers", "archive", ["c1"], {}, "admin@x.be");
  assert.equal(arch.succeeded, 1);
  assert.ok(store.get("customers", "c1").archivedAt);
  // Tweede keer archiveren wordt overgeslagen.
  assert.equal(runBulk(store, TENANT, ADMIN, "customers", "archive", ["c1"], {}, "admin@x.be").results[0].reason, "ALREADY_ARCHIVED");
});

test("grid: views bewaren kan zonder beheerrechten; privé blijft privé", () => {
  const store = seed();
  const repo = makeViewRepository(store);
  const eigen = repo.insert("t1", { name: "Mijn Gentse klanten", resource: "customers", filters: [{ field: "city", op: "eq", value: "Gent" }] }, FINANCE);
  assert.equal(eigen.scope, "private");
  assert.equal(eigen.createdById, "u4");
  // Een andere gebruiker ziet die privé-view niet.
  assert.equal(repo.list("t1", ADMIN, "customers").length, 0);
  assert.equal(repo.list("t1", FINANCE, "customers").length, 1);
  // Gedeelde view is voor iedereen zichtbaar.
  repo.insert("t1", { name: "Team-view", resource: "customers", scope: "team" }, FINANCE);
  assert.equal(repo.list("t1", ADMIN, "customers").length, 1);
  // Andermans privé-view wijzigen mag niet.
  assert.throws(() => repo.update("t1", eigen.id, { name: "Gekaapt" }, ADMIN), e => e.status === 403);
});

test("grid: gedeelde view toont nooit kolommen zonder recht", () => {
  const view = { id: "v1", resource: "customers", name: "Met kredietlimiet", columns: ["name", "city", "creditLimit"] };
  const voorAdmin = sanitizeViewForUser(view, ADMIN);
  assert.ok(voorAdmin.columns.includes("creditLimit"));
  const voorFinance = sanitizeViewForUser(view, FINANCE);
  assert.ok(!voorFinance.columns.includes("creditLimit"), "kolom gestript uit de gedeelde view");
  assert.deepEqual(voorFinance.removedColumns, ["creditLimit"]);
});

test("grid: onbekende resource en onbekende actie worden geweigerd", () => {
  const store = seed();
  assert.throws(() => runQuery(store, TENANT, ADMIN, "bestaatniet", {}), e => e.code === "UNKNOWN_RESOURCE");
  assert.throws(() => previewBulk(store, TENANT, ADMIN, "customers", "drop_table", ["c1"]), e => e.code === "UNKNOWN_ACTION");
});
