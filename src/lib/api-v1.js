"use strict";
/**
 * Moderne /v1-API (spec 5.4 + h41 development contract).
 *
 * Canonieke Engelse namespace (/v1/customers, /v1/work-orders, ...) als
 * VERTAALLAAG over de bestaande tenant-routes · strangler: /api blijft
 * ongewijzigd werken, /v1 is de hedendaagse voordeur. De laag herschrijft de
 * request naar de legacy-route en transformeert de response terug:
 *
 *  - tenantcontext uit het token (geen tenant-id in het pad);
 *  - geld als INTEGER MINOR UNITS (centen) op de draad, euro's intern;
 *  - If-Match → expectedVersion, ETag op detail/create/mutatie;
 *  - validatiefouten als 422 met een errors-lijst per veld;
 *  - 409 met currentVersion en een recovery-aanwijzing;
 *  - lijsten via de grid-kern (h11): cursor-paginatie, whitelist-filters met
 *    typed operators, rechten-scoping en veldafscherming identiek aan de UI;
 *  - 201/200 met data, version en links.
 *
 * Bewuste beperking: de laag voegt GEEN nieuwe rechten of gedragingen toe.
 * Wat de legacy-route weigert, weigert /v1 ook · pariteit is de garantie.
 */

// v1-naam (Engels, kebab) → legacy-actie + grid-resource (h11) + response-sleutel.
const RESOURCES = {
  "customers":       { action: "customers",        grid: "customers",      rowKey: "customer" },
  "quotes":          { action: "offertes",         grid: "quotes",         rowKey: "quote" },
  "invoices":        { action: "facturen",         grid: "invoices",       rowKey: "invoice" },
  "work-orders":     { action: "workorders",       grid: "workorders",     rowKey: "workorder" },
  "projects":        { action: "projects",         grid: "projects",       rowKey: "project" },
  "articles":        { action: "articles",         grid: "articles",       rowKey: "article" },
  "employees":       { action: "employee_records", grid: "employees",      rowKey: "record" },
  "suppliers":       { action: "suppliers",        grid: "suppliers",      rowKey: "supplier" },
  "purchase-orders": { action: "purchase_orders",  grid: "purchaseOrders", rowKey: "order" },
  "contracts":       { action: "contracts",        grid: "contracts",      rowKey: "contract" },
  "assets":          { action: "assets",           grid: "assets",         rowKey: "asset" },
  "worksites":       { action: "worksites",        grid: "worksites",      rowKey: "worksite" },
  "progress-claims": { action: "progress_claims",  grid: "progressClaims", rowKey: "claim" },
  "expenses":        { action: "expenses",         grid: "expenses",       rowKey: "expense" },
  "incidents":       { action: "incidents",        grid: "incidents",      rowKey: "incident" },
  "payments":        { action: "payments",         grid: "payments",       rowKey: "payment" },
  "webhooks":        { action: "webhooks",         grid: null,             rowKey: "endpoint" },
};

/**
 * Veldnamen die geld dragen · recursief toegepast, dus ook op document-lijnen.
 * Bewust GEEN dubbelzinnige namen (rate = ook btw-tarief, margin = ook %).
 */
const MONEY_FIELDS = new Set([
  "amount", "subtotal", "total", "totalExcl", "totalIncl", "vatAmount",
  "unitPrice", "price", "costPrice", "salesPrice", "purchasePrice",
  "budget", "creditLimit", "outstanding", "creditAmount",
  "laborCost", "materialCost", "totalCost", "actualCost",
  "paidAmount", "openAmount", "allocatedAmount", "unallocatedAmount",
]);

const isMoneyField = name => MONEY_FIELDS.has(name);

/** Recursieve geldtransformatie. `fn` werkt op het getal (euro's ↔ centen). */
function transformMoney(value, fn, fieldName) {
  if (Array.isArray(value)) return value.map(v => transformMoney(v, fn, fieldName));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = transformMoney(v, fn, k);
    return out;
  }
  if (fieldName && isMoneyField(fieldName) && typeof value === "number" && Number.isFinite(value)) return fn(value);
  return value;
}
const eurosToCents = v => transformMoney(v, n => Math.round(n * 100));
const centsToEuros = v => transformMoney(v, n => n / 100);

/** If-Match: '"3"', 'W/"3"' of '3' → 3; anders null. */
function versionFromIfMatch(req) {
  const raw = String((req.headers && req.headers["if-match"]) || "").replace(/^W\//, "").replace(/"/g, "").trim();
  if (!raw || raw === "*") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Filterparameters: `filter=<field>:<op>:<value>`, herhaalbaar.
 * `in`/`nin`/`between` nemen kommagescheiden waarden. Geldvelden komen als
 * centen binnen en gaan als euro's naar de grid-kern.
 */
function parseFilters(searchParams) {
  const filters = [];
  for (const raw of searchParams.getAll("filter")) {
    const first = raw.indexOf(":"), second = raw.indexOf(":", first + 1);
    if (first < 1 || second < 0) continue;                 // vormfout → genegeerd, whitelist vangt de rest
    const field = raw.slice(0, first);
    const op = raw.slice(first + 1, second);
    const rawValue = raw.slice(second + 1);
    const leaf = field.split(".").pop();
    const coerce = s => {
      if (isMoneyField(leaf) && s !== "" && Number.isFinite(Number(s))) return Number(s) / 100;
      return s;
    };
    const value = ["in", "nin", "between"].includes(op) ? rawValue.split(",").map(coerce) : coerce(rawValue);
    filters.push({ field, op, value });
  }
  return filters;
}

/** `sort=-createdAt` → { field: "createdAt", dir: "desc" }. */
function parseSort(searchParams) {
  const raw = String(searchParams.get("sort") || "").trim();
  if (!raw) return undefined;
  return raw.startsWith("-") ? { field: raw.slice(1), dir: "desc" } : { field: raw, dir: "asc" };
}

function v1Error(status, code, message) {
  return { error: { status, payload: { ok: false, code, error: message } } };
}

/**
 * Vertaal een /v1-request naar de legacy-route. Retourneert:
 *  { discovery }                            · GET /v1
 *  { error: { status, payload } }           · onbekende resource of vorm
 *  { method, path, body?, ctx }             · herschrijving + responscontext
 * `path` is relatief aan /api/tenants/:tenantId/.
 */
async function prepareV1(req, url, { readBody }) {
  const segments = url.pathname.split("/").filter(Boolean);   // ["v1", resource, id?, ...rest]
  if (segments.length === 1) {
    if (req.method !== "GET") return v1Error(405, "METHOD_NOT_ALLOWED", "Gebruik GET voor het overzicht");
    return {
      discovery: {
        ok: true,
        version: "v1",
        resources: Object.keys(RESOURCES).sort(),
        conventions: {
          money: "integer minor units (centen)",
          dates: "ISO 8601",
          pagination: "cursor + limit, nextCursor in de response",
          filters: "filter=<veld>:<operator>:<waarde> · herhaalbaar, whitelist per resource",
          concurrency: "If-Match: <version> op mutaties · 409 met currentVersion bij conflict",
          idempotency: "Idempotency-Key-header op muterende calls",
          errors: "422 met errors[] per veld · stabiele machine-codes",
        },
      },
    };
  }

  const name = segments[1];
  const def = RESOURCES[name];
  if (!def) return v1Error(404, "UNKNOWN_RESOURCE", `Onbekende resource '${name}' · zie GET /v1`);
  const id = segments[2] || null;
  const rest = segments.slice(3).join("/");
  const ctx = { resource: name, rowKey: def.rowKey };

  // ── Lezen ──
  if (req.method === "GET" || req.method === "HEAD") {
    if (!id && def.grid) {
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 25));
      const body = {
        limit,
        cursor: url.searchParams.get("cursor") || undefined,
        search: url.searchParams.get("search") || undefined,
        sort: parseSort(url.searchParams),
        filters: parseFilters(url.searchParams),
      };
      return { method: "POST", path: `grid/${def.grid}/query`, body, ctx: { ...ctx, mode: "list" } };
    }
    if (id && !rest && def.grid) {
      const body = { filters: [{ field: "id", op: "eq", value: id }], limit: 1 };
      return { method: "POST", path: `grid/${def.grid}/query`, body, ctx: { ...ctx, mode: "detail", id } };
    }
    // Zonder grid (of dieper pad): passthrough op de legacy-route.
    return { method: "GET", path: [def.action, id, rest].filter(Boolean).join("/"), ctx: { ...ctx, mode: "passthrough" } };
  }

  // ── Muteren ──
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    return v1Error(405, "METHOD_NOT_ALLOWED", `Methode ${req.method} wordt niet ondersteund`);
  }
  const method = req.method === "PUT" ? "PATCH" : req.method;   // legacy muteert via PATCH
  let body;
  if (method !== "DELETE") {
    body = centsToEuros(await readBody(req));
    const expected = versionFromIfMatch(req);
    if (expected && body && typeof body === "object" && body.expectedVersion === undefined) {
      body.expectedVersion = expected;
    }
  }
  const mode = (!id && method === "POST") ? "create" : "mutation";
  return { method, path: [def.action, id, rest].filter(Boolean).join("/"), body, ctx: { ...ctx, mode } };
}

/** Legacy-succes { ok, <rowKey>: {...} } → de rij zelf. */
function extractRow(payload, rowKey) {
  if (!payload || typeof payload !== "object") return payload;
  if (rowKey && payload[rowKey] && typeof payload[rowKey] === "object") return payload[rowKey];
  const keys = Object.keys(payload).filter(k => k !== "ok" && k !== "requestId");
  if (keys.length === 1 && payload[keys[0]] && typeof payload[keys[0]] === "object") return payload[keys[0]];
  return payload;
}

/** Legacy-fout → moderne envelope (422 met veldfouten, 409 met recovery). */
function transformError(status, payload) {
  const message = (payload && (payload.error || payload.message)) || "Onbekende fout";
  const code = (payload && payload.code) || (status === 404 ? "NOT_FOUND" : status === 403 ? "FORBIDDEN" : status === 401 ? "UNAUTHENTICATED" : "ERROR");
  const out = { ok: false, code, message };
  if (payload && payload.requestId) out.requestId = payload.requestId;
  if (status === 400) {
    out.code = payload && payload.code ? payload.code : "VALIDATION_FAILED";
    out.errors = Array.isArray(payload && payload.missing)
      ? payload.missing.map(m => ({ field: m && (m.id || m.field) || null, code: "required", message: (m && m.label) || message }))
      : [{ field: null, code: out.code, message }];
    return { status: 422, payload: out };
  }
  if (status === 409) {
    if (payload && payload.currentVersion !== undefined) out.currentVersion = payload.currentVersion;
    out.recovery = { action: "reload", description: "Haal de actuele versie op en pas de wijziging opnieuw toe" };
    return { status, payload: out };
  }
  return { status, payload: out };
}

/**
 * Responstransformatie · aangeroepen vanuit sendJson vlak voor het schrijven.
 * Retourneert { status, payload, headers }.
 */
function transformResponse(ctx, status, payload) {
  if (status >= 400) return { ...transformError(status, payload), headers: {} };

  if (ctx.mode === "list") {
    return {
      status: 200,
      payload: {
        ok: true,
        data: eurosToCents(payload.rows || []),
        total: payload.total,
        nextCursor: payload.nextCursor || null,
        sort: payload.sort,
        hiddenFields: payload.hiddenColumns && payload.hiddenColumns.length ? payload.hiddenColumns : undefined,
      },
      headers: {},
    };
  }
  if (ctx.mode === "detail") {
    const row = (payload.rows || [])[0];
    if (!row) return { status: 404, payload: { ok: false, code: "NOT_FOUND", message: "Niet gevonden" }, headers: {} };
    const headers = row.version ? { ETag: `"${row.version}"` } : {};
    return { status: 200, payload: { ok: true, data: eurosToCents(row), version: row.version, links: { self: `/v1/${ctx.resource}/${row.id}` } }, headers };
  }
  if (ctx.mode === "create" || ctx.mode === "mutation") {
    const row = extractRow(payload, ctx.rowKey);
    const out = { ok: true, data: eurosToCents(row) };
    const headers = {};
    if (row && typeof row === "object") {
      if (row.version !== undefined) { out.version = row.version; headers.ETag = `"${row.version}"`; }
      if (row.id) out.links = { self: `/v1/${ctx.resource}/${row.id}` };
    }
    return { status, payload: out, headers };
  }
  // passthrough: alleen geld en foutvorm moderniseren.
  return { status, payload: eurosToCents(payload), headers: {} };
}

module.exports = { RESOURCES, MONEY_FIELDS, prepareV1, transformResponse, eurosToCents, centsToEuros, versionFromIfMatch, parseFilters };
