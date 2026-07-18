"use strict";
/**
 * Universele overzichten, zoeken, bulkacties en export (master-spec h11/GRD · P0).
 *
 * Eén gedeelde datagrid-kern voor ALLE modules, zodat zoeken, filteren,
 * selecteren, exporteren en bulkverwerking overal hetzelfde werken en niet per
 * module opnieuw gebouwd worden (h9: "Bouwen als gedeelde kern").
 *
 * Business rules (h11):
 *  - Filters draaien SERVER-SIDE en respecteren exact dezelfde rechten als de
 *    recordweergave (policy.applyScope + het module-recht).
 *  - Een view mag geen velden tonen waarvoor de gebruiker geen recht heeft;
 *    gevoelige kolommen verdwijnen uit lijst, zoekresultaat én export.
 *  - Bulkacties tonen VOORAF hoeveel records geraakt worden en welke worden
 *    overgeslagen, en rapporteren daarna PER RECORD succes of fout.
 *  - Verwijderen en archiveren zijn APARTE acties; verwijderen kan alleen
 *    zonder beschermde relaties.
 *  - Export draagt de zichtbare filtercontext en het extractiemoment; boven een
 *    configureerbare limiet wordt het een job met downloadlink en vervaldatum.
 *  - Financiële exports vermelden onderneming, valuta en datumcontext.
 *
 * Cloudblind (ADR-001): geen SDK, geen SQL, geen omgevingsvariabelen.
 */

const { newUlid } = require("./events");
const { can, applyScope, SENSITIVE_FIELDS, canSeeSensitive } = require("./policy");

// Boven deze limiet wordt een export een achtergrondjob (h11-business rule).
const INLINE_EXPORT_LIMIT = 1000;
const EXPORT_TTL_HOURS = 24;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const VIEW_SCOPES = ["private", "team", "organization"];

/**
 * Registry van doorzoekbare resources. Elke entry koppelt de resource aan zijn
 * collectie, het vereiste recht en de eigenaarsvelden voor scoping. `financial`
 * dwingt de extra exportcontext af; `protectedBy` bepaalt of verwijderen mag.
 */
const RESOURCES = {
  customers:      { collection: "customers", permission: "customers", ownerFields: ["userId", "ownerId"], search: ["name", "email", "vatNumber", "city"], archivable: true, protectedBy: [{ collection: "invoices", field: "customerId" }, { collection: "quotes", field: "customerId" }] },
  quotes:         { collection: "quotes", permission: ["invoicing", "billing"], ownerFields: ["userId", "createdBy"], search: ["number", "clientName", "status"], financial: true, archivable: true, protectedBy: [{ collection: "invoices", field: "quoteId" }] },
  invoices:       { collection: "invoices", permission: ["invoicing", "billing"], ownerFields: ["userId", "createdBy"], search: ["number", "customerName", "status"], financial: true, archivable: false, protectedBy: [] },
  workorders:     { collection: "workorders", permission: "workorders", ownerFields: ["userId", "assignedTo", "createdBy"], search: ["number", "title", "clientName", "status"], archivable: true, protectedBy: [{ collection: "invoices", field: "workorderId" }] },
  projects:       { collection: "projects", permission: "projects", ownerFields: ["userId", "managerId", "createdBy"], search: ["number", "name", "status"], financial: true, archivable: true, protectedBy: [{ collection: "workorders", field: "projectId" }, { collection: "invoices", field: "projectId" }] },
  articles:       { collection: "articles", permission: "catalog", ownerFields: [], search: ["number", "name", "salesName", "barcode", "articleGroup"], archivable: true, protectedBy: [] },
  employees:      { collection: "employees", permission: "employees", ownerFields: ["userId"], search: ["name", "employeeNumber", "jobTitle", "teamId"], archivable: true, protectedBy: [] },
  suppliers:      { collection: "suppliers", permission: "procurement", ownerFields: [], search: ["name", "vatNumber", "email"], archivable: true, protectedBy: [{ collection: "purchaseOrders", field: "supplierId" }] },
  purchaseOrders: { collection: "purchaseOrders", permission: "procurement", ownerFields: ["createdBy"], search: ["number", "status"], financial: true, archivable: true, protectedBy: [] },
  contracts:      { collection: "contracts", permission: "contracts", ownerFields: ["createdBy"], search: ["number", "title", "status"], financial: true, archivable: true, protectedBy: [] },
  assets:         { collection: "assets", permission: "service_assets", ownerFields: [], search: ["name", "serialNumber", "type", "status"], archivable: true, protectedBy: [] },
  worksites:      { collection: "worksites", permission: "construction", ownerFields: [], search: ["name", "address", "status"], archivable: true, protectedBy: [] },
  progressClaims: { collection: "progressClaims", permission: "progress_claims", ownerFields: ["createdBy"], search: ["number", "status"], financial: true, archivable: false, protectedBy: [] },
  expenses:       { collection: "expenses", permission: "expenses", ownerFields: ["userId"], search: ["description", "status"], financial: true, archivable: true, protectedBy: [] },
  incidents:      { collection: "incidents", permission: "incidents", ownerFields: ["userId", "reportedBy"], search: ["description", "status"], archivable: true, protectedBy: [] },
};

function clean(v) { return String(v == null ? "" : v).trim(); }
function resourceDef(resource) {
  const def = RESOURCES[resource];
  if (!def) { const e = new Error(`Onbekende resource '${resource}'`); e.status = 404; e.code = "UNKNOWN_RESOURCE"; throw e; }
  return def;
}

/**
 * Toegang tot een resource. `permission` mag een lijst zijn: sommige domeinen
 * zijn via meerdere rechten bereikbaar (facturatie kan via "billing" óf
 * "invoicing"), precies zoals de bestaande routes dat afdwingen.
 */
function permissionsOf(def) {
  return Array.isArray(def.permission) ? def.permission : [def.permission];
}
function hasResourceAccess(user, def) {
  return permissionsOf(def).some(p => can(user, p));
}
/** Het recht waarmee deze gebruiker binnenkomt · bepaalt ook de scoping. */
function effectivePermission(user, def) {
  return permissionsOf(def).find(p => can(user, p)) || permissionsOf(def)[0];
}

// ── Filters ─────────────────────────────────────────────────────────────────
const OPERATORS = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "nin", "contains", "startsWith", "between", "empty", "notEmpty"];

function valueAt(row, field) {
  return String(field || "").split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), row);
}

function matchesFilter(row, filter) {
  const actual = valueAt(row, filter.field);
  const v = filter.value;
  const asNum = x => (x === null || x === undefined || x === "" ? NaN : Number(x));
  switch (filter.op) {
    case "eq": return String(actual ?? "") === String(v ?? "");
    case "ne": return String(actual ?? "") !== String(v ?? "");
    case "gt": return Number.isFinite(asNum(actual)) && Number.isFinite(asNum(v)) ? asNum(actual) > asNum(v) : String(actual ?? "") > String(v ?? "");
    case "gte": return Number.isFinite(asNum(actual)) && Number.isFinite(asNum(v)) ? asNum(actual) >= asNum(v) : String(actual ?? "") >= String(v ?? "");
    case "lt": return Number.isFinite(asNum(actual)) && Number.isFinite(asNum(v)) ? asNum(actual) < asNum(v) : String(actual ?? "") < String(v ?? "");
    case "lte": return Number.isFinite(asNum(actual)) && Number.isFinite(asNum(v)) ? asNum(actual) <= asNum(v) : String(actual ?? "") <= String(v ?? "");
    case "in": return Array.isArray(v) && v.map(String).includes(String(actual ?? ""));
    case "nin": return Array.isArray(v) && !v.map(String).includes(String(actual ?? ""));
    case "contains": return String(actual ?? "").toLowerCase().includes(String(v ?? "").toLowerCase());
    case "startsWith": return String(actual ?? "").toLowerCase().startsWith(String(v ?? "").toLowerCase());
    case "between": return Array.isArray(v) && v.length === 2 && String(actual ?? "") >= String(v[0]) && String(actual ?? "") <= String(v[1]);
    case "empty": return actual === undefined || actual === null || actual === "" || (Array.isArray(actual) && !actual.length);
    case "notEmpty": return !(actual === undefined || actual === null || actual === "" || (Array.isArray(actual) && !actual.length));
    default: return true;
  }
}

function normalizeFilters(input) {
  return (Array.isArray(input) ? input : [])
    .map(f => {
      const field = clean(f && f.field);
      const op = OPERATORS.includes(f && f.op) ? f.op : "eq";
      if (!field) return null;
      return { field, op, value: f.value };
    })
    .filter(Boolean)
    .slice(0, 25);
}

/** Kolommen waar de gebruiker geen recht op heeft (h11: nooit in lijst/export). */
function forbiddenColumns(user, resource) {
  if (canSeeSensitive(user)) return [];
  return SENSITIVE_FIELDS[resource] || [];
}

function stripForbidden(user, resource, rows) {
  const forbidden = forbiddenColumns(user, resource);
  if (!forbidden.length) return rows;
  return rows.map(r => {
    const copy = { ...r };
    for (const f of forbidden) delete copy[f];
    return copy;
  });
}

/**
 * Voer een lijstquery uit: rechten, scoping, filters, zoeken, sorteren en
 * cursor-paginatie. Dit is HET pad dat zowel UI als API gebruiken, zodat
 * dezelfde filter functioneel dezelfde records oplevert (acceptatie h11).
 */
function runQuery(store, tenant, user, resource, { filters = [], search = "", sort = null, cursor = null, limit = DEFAULT_PAGE_SIZE, unbounded = false } = {}) {
  const def = resourceDef(resource);
  if (!hasResourceAccess(user, def)) {
    const e = new Error(`Geen recht op ${resource}`); e.status = 403; e.code = "FORBIDDEN"; throw e;
  }
  const all = store.list(def.collection, tenant.id) || [];
  // Rechten-scoping identiek aan de recordweergave (own/team/alle).
  let rows = applyScope(store, user, effectivePermission(user, def), all, def.ownerFields);

  const normalized = normalizeFilters(filters);
  for (const f of normalized) rows = rows.filter(r => matchesFilter(r, f));

  const q = clean(search).toLowerCase();
  if (q) {
    rows = rows.filter(r => (def.search || []).some(field => String(valueAt(r, field) ?? "").toLowerCase().includes(q)));
  }

  const sortField = clean(sort && sort.field) || "createdAt";
  const dir = (sort && sort.dir === "asc") ? 1 : -1;
  rows = rows.slice().sort((a, b) => {
    const av = valueAt(a, sortField), bv = valueAt(b, sortField);
    const an = Number(av), bn = Number(bv);
    if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * dir;
    return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
  });

  const total = rows.length;
  // Cursor = index-gebaseerd en stabiel binnen één sortering (h11-paginatie).
  // `unbounded` is uitsluitend voor exports: die moeten de VOLLEDIGE selectie
  // bevatten. Zonder deze uitzondering zou de paginalimiet een export
  // stilzwijgend afkappen, wat erger is dan traag.
  const start = unbounded ? 0 : Math.max(0, Number(cursor) || 0);
  const size = unbounded ? total : Math.min(Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const page = unbounded ? rows : rows.slice(start, start + size);
  const nextCursor = !unbounded && start + size < total ? String(start + size) : null;

  return {
    resource,
    rows: stripForbidden(user, resource, page),
    total,
    nextCursor,
    appliedFilters: normalized,
    search: q || null,
    sort: { field: sortField, dir: dir === 1 ? "asc" : "desc" },
    hiddenColumns: forbiddenColumns(user, resource),
  };
}

// ── Bulkacties ──────────────────────────────────────────────────────────────
const BULK_ACTIONS = ["set_status", "assign", "archive", "delete"];
// Velden die een bulkactie mag zetten · bewust smal (geen bedragen of nummers).
const BULK_SETTABLE = { set_status: "status", assign: "assignedTo" };

/** Heeft dit record een beschermde relatie die verwijderen blokkeert? */
function protectedRelations(store, tenant, def, row) {
  const blockers = [];
  for (const rel of def.protectedBy || []) {
    const hits = (store.list(rel.collection, tenant.id) || []).filter(r => String(r[rel.field] || "") === String(row.id));
    if (hits.length) blockers.push({ collection: rel.collection, count: hits.length });
  }
  return blockers;
}

/**
 * Vooruitblik op een bulkactie (h11-business rule): hoeveel records worden
 * geraakt en welke worden overgeslagen, mét reden. Wordt ALTIJD eerst
 * uitgevoerd, ook intern door runBulk, zodat preview en uitvoering niet
 * uiteen kunnen lopen.
 */
function previewBulk(store, tenant, user, resource, action, ids, payload = {}) {
  const def = resourceDef(resource);
  if (!BULK_ACTIONS.includes(action)) { const e = new Error(`Onbekende bulkactie '${action}'`); e.status = 400; e.code = "UNKNOWN_ACTION"; throw e; }
  if (!hasResourceAccess(user, def)) { const e = new Error(`Geen recht op ${resource}`); e.status = 403; e.code = "FORBIDDEN"; throw e; }

  const all = store.list(def.collection, tenant.id) || [];
  const visible = applyScope(store, user, effectivePermission(user, def), all, def.ownerFields);
  const visibleIds = new Set(visible.map(r => r.id));

  const affected = [], skipped = [];
  for (const id of (Array.isArray(ids) ? ids : [])) {
    const row = all.find(r => r.id === id);
    if (!row) { skipped.push({ id, reason: "NOT_FOUND", message: "Record niet gevonden" }); continue; }
    // Rechten: buiten je scope raak je niets aan, ook niet in bulk.
    if (!visibleIds.has(id)) { skipped.push({ id, reason: "FORBIDDEN", message: "Buiten je rechtenbereik" }); continue; }
    if (action === "archive" && def.archivable === false) { skipped.push({ id, reason: "NOT_ARCHIVABLE", message: `${resource} kan niet gearchiveerd worden` }); continue; }
    if (action === "archive" && row.archivedAt) { skipped.push({ id, reason: "ALREADY_ARCHIVED", message: "Al gearchiveerd" }); continue; }
    if (action === "delete") {
      // Verwijderen en archiveren zijn aparte acties; verwijderen kan alleen
      // zonder beschermde relaties (h11-business rule).
      const blockers = protectedRelations(store, tenant, def, row);
      if (blockers.length) { skipped.push({ id, reason: "PROTECTED_RELATIONS", message: `Beschermde relaties: ${blockers.map(b => `${b.count}× ${b.collection}`).join(", ")}` }); continue; }
    }
    if (action === "set_status" && !clean(payload.status)) { skipped.push({ id, reason: "MISSING_VALUE", message: "Geen status opgegeven" }); continue; }
    affected.push({ id, label: row.number || row.name || row.title || id });
  }
  return { resource, action, requested: (ids || []).length, affectedCount: affected.length, affected, skippedCount: skipped.length, skipped };
}

/**
 * Voer een bulkactie uit. Rapporteert PER RECORD succes of fout (acceptatie
 * h11). Een gedeeltelijk geslaagde job is een geldige uitkomst en wordt als
 * zodanig gerapporteerd.
 */
function runBulk(store, tenant, user, resource, action, ids, payload = {}, actor = null) {
  const def = resourceDef(resource);
  const preview = previewBulk(store, tenant, user, resource, action, ids, payload);
  const results = [...preview.skipped.map(s => ({ id: s.id, ok: false, reason: s.reason, message: s.message }))];

  for (const item of preview.affected) {
    try {
      if (action === "delete") {
        store.remove(def.collection, item.id);
      } else if (action === "archive") {
        store.update(def.collection, item.id, { archivedAt: new Date().toISOString(), archivedBy: actor, status: "archived" });
      } else {
        const field = BULK_SETTABLE[action];
        const value = action === "set_status" ? clean(payload.status) : clean(payload.assignedTo);
        store.update(def.collection, item.id, { [field]: value, updatedAt: new Date().toISOString(), updatedBy: actor });
      }
      results.push({ id: item.id, ok: true });
    } catch (e) {
      results.push({ id: item.id, ok: false, reason: "ERROR", message: String((e && e.message) || e).slice(0, 200) });
    }
  }
  const succeeded = results.filter(r => r.ok).length;
  const failed = results.length - succeeded;
  return {
    id: `bulk_${newUlid()}`,
    resource, action,
    status: failed === 0 ? "completed" : succeeded === 0 ? "failed" : "partial",
    requested: preview.requested, succeeded, failed,
    results,
    at: new Date().toISOString(), by: actor,
  };
}

// ── Export ──────────────────────────────────────────────────────────────────
function csvCell(value) {
  const text = value == null ? "" : (Array.isArray(value) || typeof value === "object") ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Bouw een export met exact de zichtbare filtercontext en het extractiemoment
 * (acceptatie h11). Financiële resources dragen onderneming, valuta en
 * datumcontext. Gevoelige kolommen zitten er nooit in.
 */
function buildExport(store, tenant, user, resource, query = {}, { columns = null, now = new Date(), company = null } = {}) {
  const def = resourceDef(resource);
  // Haal ALLE rijen binnen de filter (niet enkel de huidige pagina).
  const full = runQuery(store, tenant, user, resource, { ...query, cursor: null, unbounded: true });
  const rows = full.rows;

  const forbidden = forbiddenColumns(user, resource);
  const cols = (Array.isArray(columns) && columns.length ? columns : Object.keys(rows[0] || {}))
    .filter(c => !forbidden.includes(c));

  const contextLines = [
    `# Export ${resource}`,
    `# Geëxtraheerd op: ${now.toISOString()}`,
    `# Door: ${(user && user.email) || "onbekend"}`,
    `# Filters: ${JSON.stringify(full.appliedFilters)}`,
    `# Zoekterm: ${full.search || "-"}`,
    `# Sortering: ${full.sort.field} ${full.sort.dir}`,
    `# Aantal records: ${rows.length}`,
  ];
  if (def.financial) {
    // Financiële exports vermelden onderneming, valuta en datumcontext (h11).
    contextLines.push(`# Onderneming: ${(company && (company.legalName || company.name)) || tenant.name || "-"}`);
    contextLines.push(`# Ondernemingsnummer: ${(company && company.companyNumber) || "-"}`);
    contextLines.push(`# Valuta: EUR`);
    contextLines.push(`# Datumcontext: ${now.toISOString().slice(0, 10)}`);
  }
  const header = cols.map(csvCell).join(",");
  const body = rows.map(r => cols.map(c => csvCell(r[c])).join(",")).join("\n");
  const csv = `${contextLines.join("\n")}\n${header}\n${body}\n`;

  const oversized = rows.length > INLINE_EXPORT_LIMIT;
  return {
    resource,
    rowCount: rows.length,
    columns: cols,
    hiddenColumns: forbidden,
    generatedAt: now.toISOString(),
    // Boven de limiet: als job met downloadlink + vervaldatum (h11).
    mode: oversized ? "job" : "inline",
    csv,
    expiresAt: oversized ? new Date(now.getTime() + EXPORT_TTL_HOURS * 3600000).toISOString() : null,
  };
}

/** Sla een grote export op als job met downloadtoken en vervaldatum. */
function createExportJob(store, tenant, user, exportResult) {
  const job = {
    id: `exp_${newUlid()}`,
    tenantId: tenant.id,
    resource: exportResult.resource,
    rowCount: exportResult.rowCount,
    status: "ready",
    token: newUlid(),
    csv: exportResult.csv,
    createdAt: new Date().toISOString(),
    createdBy: (user && user.email) || null,
    expiresAt: exportResult.expiresAt,
  };
  store.insert("exportJobs", job);
  return { id: job.id, token: job.token, status: job.status, rowCount: job.rowCount, expiresAt: job.expiresAt, downloadPath: `/api/tenants/${tenant.id}/grid/exports/${job.id}?token=${job.token}` };
}

/** Haal een exportjob op; verlopen jobs geven niets terug. */
function getExportJob(store, tenant, id, token, now = new Date()) {
  const job = (store.list("exportJobs", tenant.id) || []).find(j => j.id === id);
  if (!job) return null;
  if (job.token !== token) { const e = new Error("Ongeldig downloadtoken"); e.status = 403; e.code = "INVALID_TOKEN"; throw e; }
  if (job.expiresAt && job.expiresAt < now.toISOString()) { const e = new Error("Deze download is vervallen"); e.status = 410; e.code = "EXPIRED"; throw e; }
  return job;
}

// ── Opgeslagen views ────────────────────────────────────────────────────────
/**
 * Views zijn GEBRUIKERSDATA, geen systeeminstellingen: iedereen mag ze bewaren
 * zonder beheerrechten (acceptatie h11). Delen kan naar team of organisatie.
 */
function normalizeView(payload, user) {
  const name = clean(payload && payload.name);
  if (!name) { const e = new Error("Een view heeft een naam nodig"); e.status = 400; throw e; }
  const resource = clean(payload.resource);
  resourceDef(resource);   // valideert de resource
  const scope = VIEW_SCOPES.includes(payload.scope) ? payload.scope : "private";
  return {
    name, resource, scope,
    filters: normalizeFilters(payload.filters),
    search: clean(payload.search),
    sort: payload.sort && payload.sort.field ? { field: clean(payload.sort.field), dir: payload.sort.dir === "asc" ? "asc" : "desc" } : null,
    columns: (Array.isArray(payload.columns) ? payload.columns : []).map(clean).filter(Boolean).slice(0, 40),
    groupBy: clean(payload.groupBy) || null,
  };
}

function makeViewRepository(store) {
  const col = "gridViews";
  return {
    /** Views die deze gebruiker mag zien: eigen privé + gedeelde. */
    list(tenantId, user, resource = null) {
      return (store.list(col, tenantId) || [])
        .filter(v => (!resource || v.resource === resource))
        .filter(v => v.scope !== "private" || String(v.createdById) === String(user.id))
        .map(v => sanitizeViewForUser(v, user))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(v => v.id === id) || null; },
    insert(tenantId, payload, user) {
      const normalized = normalizeView(payload, user);
      const now = new Date().toISOString();
      return store.insert(col, {
        id: `view_${newUlid()}`, tenantId, ...normalized,
        createdById: user.id, createdBy: user.email, createdAt: now, updatedAt: now, version: 1,
      });
    },
    update(tenantId, id, payload, user) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("View niet gevonden"); e.status = 404; throw e; }
      if (existing.scope === "private" && String(existing.createdById) !== String(user.id)) {
        const e = new Error("Je kunt alleen je eigen privé-views wijzigen"); e.status = 403; e.code = "FORBIDDEN"; throw e;
      }
      const normalized = normalizeView({ ...existing, ...payload }, user);
      return store.update(col, id, { ...normalized, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString() });
    },
    remove(tenantId, id, user) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("View niet gevonden"); e.status = 404; throw e; }
      if (String(existing.createdById) !== String(user.id) && !["tenant_admin", "super_admin"].includes(user.role)) {
        const e = new Error("Je kunt alleen je eigen views verwijderen"); e.status = 403; e.code = "FORBIDDEN"; throw e;
      }
      store.remove(col, id);
      return { ok: true };
    },
  };
}

/**
 * Een gedeelde view mag nooit kolommen tonen waar deze gebruiker geen recht op
 * heeft (h11-business rule). We strippen ze uit de kolomlijst en melden dat.
 */
function sanitizeViewForUser(view, user) {
  const forbidden = forbiddenColumns(user, view.resource);
  if (!forbidden.length || !(view.columns || []).length) return { ...view, removedColumns: [] };
  const removed = view.columns.filter(c => forbidden.includes(c));
  return { ...view, columns: view.columns.filter(c => !forbidden.includes(c)), removedColumns: removed };
}

module.exports = {
  RESOURCES, OPERATORS, BULK_ACTIONS, hasResourceAccess, permissionsOf, INLINE_EXPORT_LIMIT, VIEW_SCOPES, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE,
  matchesFilter, normalizeFilters, forbiddenColumns, runQuery,
  previewBulk, runBulk, protectedRelations,
  buildExport, createExportJob, getExportJob,
  normalizeView, makeViewRepository, sanitizeViewForUser,
};
