"use strict";
// Moderne /v1-API (spec 5.4 + h41): vertaallaag-bouwstenen. De e2e-smoke
// (test/e2e/v1-smoke.js) bewijst de laag tegen de echte server; hier de
// randgevallen van geld, If-Match, filters, padvertaling en envelopes.
const { test } = require("node:test");
const assert = require("node:assert");

const v1 = require("../src/lib/api-v1");

function fakeReq(method, headers = {}) { return { method, headers }; }
function urlOf(path) { return new URL(path, "http://localhost"); }
async function prep(method, path, { headers = {}, body } = {}) {
  return v1.prepareV1(fakeReq(method, headers), urlOf(path), { readBody: async () => body || {} });
}

test("geld: euro's ↔ centen recursief, ook in document-lijnen, niet-geldvelden onaangetast", () => {
  const row = {
    total: 121.05, vatRate: 21, quantity: 3, name: "X",
    lines: [{ unitPrice: 10.005, total: 30.02 }],
    nested: { creditLimit: 5000 },
  };
  const cents = v1.eurosToCents(row);
  assert.strictEqual(cents.total, 12105);
  assert.strictEqual(cents.vatRate, 21, "vatRate is geen geldveld");
  assert.strictEqual(cents.quantity, 3);
  assert.strictEqual(cents.lines[0].unitPrice, 1001, "afronding op de cent");
  assert.strictEqual(cents.nested.creditLimit, 500000);
  const terug = v1.centsToEuros(cents);
  assert.strictEqual(terug.total, 121.05);
  assert.strictEqual(terug.nested.creditLimit, 5000);
});

test("If-Match: kale, gequote en weak vormen; '*' en rommel geven null", () => {
  const h = val => v1.versionFromIfMatch({ headers: { "if-match": val } });
  assert.strictEqual(h("3"), 3);
  assert.strictEqual(h('"7"'), 7);
  assert.strictEqual(h('W/"2"'), 2);
  assert.strictEqual(h("*"), null);
  assert.strictEqual(h("abc"), null);
  assert.strictEqual(v1.versionFromIfMatch({ headers: {} }), null);
});

test("filters: triplets, in/between als lijst, geldvelden van centen naar euro's", () => {
  const p = new URL("http://x/v1/invoices?filter=status:eq:open&filter=total:gte:10000&filter=status:in:open,sent&filter=naam").searchParams;
  const filters = v1.parseFilters(p);
  assert.deepStrictEqual(filters[0], { field: "status", op: "eq", value: "open" });
  assert.deepStrictEqual(filters[1], { field: "total", op: "gte", value: 100 }, "10000 centen → 100 euro voor de grid-kern");
  assert.deepStrictEqual(filters[2].value, ["open", "sent"]);
  assert.strictEqual(filters.length, 3, "vormfout wordt genegeerd");
});

test("padvertaling: lijst via grid, detail via grid-filter, create/mutatie naar de legacy-actie", async () => {
  const lijst = await prep("GET", "/v1/work-orders?limit=10&sort=-createdAt&search=lek");
  assert.strictEqual(lijst.method, "POST");
  assert.strictEqual(lijst.path, "grid/workorders/query");
  assert.deepStrictEqual(lijst.body.sort, { field: "createdAt", dir: "desc" });
  assert.strictEqual(lijst.body.limit, 10);
  assert.strictEqual(lijst.ctx.mode, "list");

  const detail = await prep("GET", "/v1/customers/cust_1");
  assert.deepStrictEqual(detail.body.filters, [{ field: "id", op: "eq", value: "cust_1" }]);
  assert.strictEqual(detail.ctx.mode, "detail");

  const create = await prep("POST", "/v1/invoices", { body: { total: 12105 } });
  assert.strictEqual(create.path, "facturen", "Engelse naam → legacy-actie");
  assert.strictEqual(create.body.total, 121.05, "centen → euro's voor de route");
  assert.strictEqual(create.ctx.mode, "create");

  const put = await prep("PUT", "/v1/customers/c1", { headers: { "if-match": '"4"' }, body: { name: "Y" } });
  assert.strictEqual(put.method, "PATCH", "PUT wordt legacy-PATCH");
  assert.strictEqual(put.body.expectedVersion, 4, "If-Match → expectedVersion");

  const sub = await prep("POST", "/v1/projects/p1/transition", { body: { status: "active" } });
  assert.strictEqual(sub.path, "projects/p1/transition", "subacties gaan mee");

  const onbekend = await prep("GET", "/v1/bestaat-niet");
  assert.strictEqual(onbekend.error.status, 404);
  assert.strictEqual(onbekend.error.payload.code, "UNKNOWN_RESOURCE");

  const discovery = await prep("GET", "/v1");
  assert.ok(discovery.discovery.resources.includes("work-orders"));
});

test("responstransformatie: lijst-envelope met centen en nextCursor", () => {
  const t = v1.transformResponse({ mode: "list", resource: "invoices" }, 200,
    { rows: [{ id: "f1", total: 121.05 }], total: 40, nextCursor: "25", sort: { field: "createdAt", dir: "desc" }, hiddenColumns: [] });
  assert.strictEqual(t.status, 200);
  assert.strictEqual(t.payload.data[0].total, 12105);
  assert.strictEqual(t.payload.nextCursor, "25");
  assert.strictEqual(t.payload.hiddenFields, undefined, "leeg → weggelaten");
});

test("responstransformatie: detail met ETag; lege grid-hit wordt 404", () => {
  const hit = v1.transformResponse({ mode: "detail", resource: "customers" }, 200, { rows: [{ id: "c1", version: 3, creditLimit: 5000 }] });
  assert.strictEqual(hit.headers.ETag, '"3"');
  assert.strictEqual(hit.payload.data.creditLimit, 500000);
  assert.strictEqual(hit.payload.links.self, "/v1/customers/c1");
  const mis = v1.transformResponse({ mode: "detail", resource: "customers" }, 200, { rows: [] });
  assert.strictEqual(mis.status, 404);
  assert.strictEqual(mis.payload.code, "NOT_FOUND");
});

test("responstransformatie: create haalt de rij uit de legacy-envelope met version en links", () => {
  const t = v1.transformResponse({ mode: "create", resource: "customers", rowKey: "customer" }, 201,
    { ok: true, customer: { id: "c9", version: 1, creditLimit: 5000 } });
  assert.strictEqual(t.status, 201);
  assert.strictEqual(t.payload.data.id, "c9");
  assert.strictEqual(t.payload.version, 1);
  assert.strictEqual(t.headers.ETag, '"1"');
  assert.strictEqual(t.payload.links.self, "/v1/customers/c9");
});

test("fouten: 400 wordt 422 met veldfouten (missing-lijst), 409 krijgt currentVersion + recovery", () => {
  const validatie = v1.transformResponse({ mode: "create", resource: "x" }, 400,
    { ok: false, error: "Verplichte vragen ontbreken", code: "REQUIRED_MISSING", missing: [{ id: "q1", label: "Naam" }] });
  assert.strictEqual(validatie.status, 422);
  assert.deepStrictEqual(validatie.payload.errors[0], { field: "q1", code: "required", message: "Naam" });

  const zonderVelden = v1.transformResponse({ mode: "create", resource: "x" }, 400, { ok: false, error: "Ongeldig e-mailadres" });
  assert.strictEqual(zonderVelden.status, 422);
  assert.strictEqual(zonderVelden.payload.errors[0].message, "Ongeldig e-mailadres");

  const conflict = v1.transformResponse({ mode: "mutation", resource: "x" }, 409,
    { ok: false, error: "Intussen gewijzigd", code: "VERSION_CONFLICT", currentVersion: 5 });
  assert.strictEqual(conflict.status, 409);
  assert.strictEqual(conflict.payload.currentVersion, 5);
  assert.strictEqual(conflict.payload.recovery.action, "reload");
});
