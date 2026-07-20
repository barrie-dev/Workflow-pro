// Route-smoke h11: query met filters/zoeken/paginatie, bulk preview + per-record
// rapportage, export met filtercontext, views, gevoelige kolommen.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, data: ct.includes("json") ? await r.json().catch(() => ({})) : await r.text() };
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // Testdata
  for (const c of [
    { name: "Alfa Bouw", email: "a@x.be", city: "Gent" },
    { name: "Beta NV", email: "b@x.be", city: "Brugge" },
    { name: "Gamma bvba", email: "g@x.be", city: "Gent" },
  ]) await j("POST", `/api/tenants/${tid}/customers`, c, tok);

  // Resource-registry
  const resources = await j("GET", `/api/tenants/${tid}/grid/resources`, null, tok);
  check("resource-registry beschikbaar", resources.status === 200 && (resources.data.resources || []).some(r => r.key === "customers"), (resources.data.resources || []).length + " resources");
  check("operatoren gepubliceerd", (resources.data.operators || []).includes("contains"));

  // Query met filter
  const gent = await j("POST", `/api/tenants/${tid}/grid/customers/query`, { filters: [{ field: "city", op: "eq", value: "Gent" }] }, tok);
  check("server-side filter", gent.status === 200 && gent.data.total === 2, gent.data.total);
  const zoek = await j("POST", `/api/tenants/${tid}/grid/customers/query`, { search: "beta" }, tok);
  check("zoeken over gedefinieerde velden", zoek.data.total === 1 && zoek.data.rows[0].name === "Beta NV", zoek.data.total);
  const pag = await j("POST", `/api/tenants/${tid}/grid/customers/query`, { sort: { field: "name", dir: "asc" }, limit: 2 }, tok);
  check("paginatie met cursor", pag.data.rows.length === 2 && pag.data.nextCursor === "2", pag.data.nextCursor);
  const pag2 = await j("POST", `/api/tenants/${tid}/grid/customers/query`, { sort: { field: "name", dir: "asc" }, limit: 2, cursor: pag.data.nextCursor }, tok);
  check("volgende pagina", pag2.data.rows.length >= 1 && pag2.data.rows[0].name !== pag.data.rows[0].name);

  // Onbekende resource
  const onbekend = await j("POST", `/api/tenants/${tid}/grid/bestaatniet/query`, {}, tok);
  check("onbekende resource → 404", onbekend.status === 404 && onbekend.data.code === "UNKNOWN_RESOURCE", onbekend.data.code);

  // Bulk: eerst preview
  const ids = (gent.data.rows || []).map(r => r.id);
  const preview = await j("POST", `/api/tenants/${tid}/grid/customers/bulk/preview`, { action: "set_status", ids: [...ids, "bestaat-niet"], payload: { status: "inactief" } }, tok);
  check("bulk-preview toont geraakt en overgeslagen", preview.data.preview.affectedCount === 2 && preview.data.preview.skippedCount === 1, JSON.stringify({ a: preview.data.preview?.affectedCount, s: preview.data.preview?.skippedCount }));
  check("preview geeft reden per overgeslagen record", preview.data.preview.skipped[0].reason === "NOT_FOUND", preview.data.preview?.skipped?.[0]?.reason);

  // Bulk uitvoeren
  const bulk = await j("POST", `/api/tenants/${tid}/grid/customers/bulk`, { action: "set_status", ids: [...ids, "bestaat-niet"], payload: { status: "inactief" } }, tok);
  check("bulk rapporteert per record", bulk.data.job.succeeded === 2 && bulk.data.job.failed === 1 && bulk.data.job.status === "partial", JSON.stringify({ s: bulk.data.job?.succeeded, f: bulk.data.job?.failed }));
  const na = await j("POST", `/api/tenants/${tid}/grid/customers/query`, { filters: [{ field: "status", op: "eq", value: "inactief" }] }, tok);
  check("bulk daadwerkelijk toegepast", na.data.total === 2, na.data.total);

  // Verwijderen met beschermde relatie: maak een factuur voor een klant
  const klant = (await j("POST", `/api/tenants/${tid}/customers`, { name: "Met Factuur BV", email: "mf@x.be" }, tok)).data.customer;
  await j("POST", `/api/tenants/${tid}/facturen`, { customerId: klant.id, customerName: "Met Factuur BV", lines: [{ description: "Werk", qty: 1, unitPrice: 100, vatRate: 21 }] }, tok);
  const del = await j("POST", `/api/tenants/${tid}/grid/customers/bulk`, { action: "delete", ids: [klant.id] }, tok);
  check("verwijderen geblokkeerd door beschermde relatie", del.data.job.results[0].reason === "PROTECTED_RELATIONS", del.data.job?.results?.[0]?.reason);
  check("archiveren is een aparte actie die wel lukt", (await j("POST", `/api/tenants/${tid}/grid/customers/bulk`, { action: "archive", ids: [klant.id] }, tok)).data.job.succeeded === 1);

  // Export met filtercontext
  const exp = await j("POST", `/api/tenants/${tid}/grid/customers/export`, { filters: [{ field: "city", op: "eq", value: "Gent" }] }, tok);
  check("export levert CSV", exp.status === 200 && typeof exp.data === "string" && exp.data.includes("# Export customers"), exp.status);
  check("export draagt filtercontext", typeof exp.data === "string" && exp.data.includes('"field":"city"'));
  check("export draagt extractiemoment", typeof exp.data === "string" && /# Geëxtraheerd op: \d{4}-/.test(exp.data));

  // Financiële export vermeldt onderneming en valuta
  const expFin = await j("POST", `/api/tenants/${tid}/grid/invoices/export`, {}, tok);
  check("financiële export vermeldt onderneming + valuta", typeof expFin.data === "string" && /# Onderneming:/.test(expFin.data) && /# Valuta: EUR/.test(expFin.data));

  // Views
  const view = await j("POST", `/api/tenants/${tid}/grid/views`, { name: "Gentse klanten", resource: "customers", filters: [{ field: "city", op: "eq", value: "Gent" }] }, tok);
  check("view bewaard zonder beheerinstellingen", view.status === 201 && view.data.view.scope === "private", view.data.view && view.data.view.scope);
  const views = await j("GET", `/api/tenants/${tid}/grid/views?resource=customers`, null, tok);
  check("eigen view zichtbaar", (views.data.views || []).some(v => v.id === view.data.view.id));
  const gedeeld = await j("PATCH", `/api/tenants/${tid}/grid/views/${view.data.view.id}`, { scope: "organization" }, tok);
  check("view delen naar organisatie", gedeeld.data.view.scope === "organization");
  check("view verwijderen", (await j("DELETE", `/api/tenants/${tid}/grid/views/${view.data.view.id}`, null, tok)).status === 200);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
