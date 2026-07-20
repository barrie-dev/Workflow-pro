// Moderne /v1-API (spec 5.4 + h41): discovery, lijst met cursor en filters,
// detail met ETag, create in centen, If-Match-conflict met recovery,
// validatie als 422, pariteit met de rechten van de legacy-routes.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token, headers) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, headers: r.headers, data: await r.json().catch(() => ({})) };
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;

  // ── Zonder token: nette 401 ──
  const anoniem = await j("GET", "/v1/customers");
  check("zonder token → 401 UNAUTHENTICATED", anoniem.status === 401 && anoniem.data.code === "UNAUTHENTICATED", anoniem.status);

  // ── Discovery ──
  const disc = await j("GET", "/v1", null, tok);
  check("GET /v1 toont resources + conventies", disc.status === 200 && disc.data.resources.includes("work-orders") && /centen/.test(disc.data.conventions.money));

  // ── Create: centen op de draad, euro's intern ──
  const created = await j("POST", "/v1/customers", { name: "V1 Klant BV", email: "v1@klant.be", creditLimit: 250000 }, tok);
  check("create 201 met data/version/links", created.status === 201 && created.data.data.id && created.data.version === 1 && created.data.links.self.startsWith("/v1/customers/"), created.status);
  check("creditLimit blijft centen op de draad", created.data.data.creditLimit === 250000, created.data.data.creditLimit);
  check("ETag op de create-response", created.headers.get("etag") === '"1"', created.headers.get("etag"));
  const cid = created.data.data.id;

  // Interne opslag is euro's: de legacy-route toont 2500.
  const legacy = await j("GET", `/api/tenants/${(await j("GET", "/api/me", null, tok)).data.user.tenantId}/customers`, null, tok);
  const legacyRow = (legacy.data.customers || []).find(c => c.id === cid);
  check("legacy-route toont dezelfde klant in euro's (2500)", legacyRow && legacyRow.creditLimit === 2500, legacyRow && legacyRow.creditLimit);

  // Tweede klant zodat de paginering iets te pagineren heeft (verse seed start leeg).
  await j("POST", "/v1/customers", { name: "V1 Buffer BV", email: "buffer@klant.be" }, tok);

  // ── Detail met ETag ──
  const detail = await j("GET", `/v1/customers/${cid}`, null, tok);
  check("detail met version + ETag", detail.status === 200 && detail.data.version === 1 && detail.headers.get("etag") === '"1"');
  const misDetail = await j("GET", "/v1/customers/cust_bestaatniet", null, tok);
  check("onbekend id → 404 NOT_FOUND", misDetail.status === 404 && misDetail.data.code === "NOT_FOUND", misDetail.status);

  // ── Lijst: cursor-paginatie + filter + zoeken ──
  const lijst = await j("GET", "/v1/customers?limit=1", null, tok);
  check("lijst met limit 1 en nextCursor", lijst.status === 200 && lijst.data.data.length === 1 && lijst.data.nextCursor !== null, lijst.data.nextCursor);
  const pagina2 = await j("GET", `/v1/customers?limit=1&cursor=${lijst.data.nextCursor}`, null, tok);
  check("cursor geeft de volgende pagina", pagina2.status === 200 && pagina2.data.data[0] && pagina2.data.data[0].id !== lijst.data.data[0].id);
  const gefilterd = await j("GET", `/v1/customers?filter=name:contains:V1 Klant`, null, tok);
  check("filter met typed operator", gefilterd.status === 200 && gefilterd.data.data.length === 1 && gefilterd.data.data[0].id === cid, gefilterd.data.total);
  const geldFilter = await j("GET", `/v1/customers?filter=creditLimit:gte:200000`, null, tok);
  check("geldfilter in centen wordt intern euro's", geldFilter.status === 200 && geldFilter.data.data.some(c => c.id === cid));

  // ── Mutatie met If-Match ──
  const update = await j("PATCH", `/v1/customers/${cid}`, { phone: "0475" }, tok, { "If-Match": '"1"' });
  check("PATCH met juiste If-Match → version 2", update.status === 200 && update.data.version === 2, update.status);
  const stale = await j("PATCH", `/v1/customers/${cid}`, { phone: "0499" }, tok, { "If-Match": '"1"' });
  check("stale If-Match → 409 met currentVersion + recovery", stale.status === 409 && stale.data.currentVersion === 2 && stale.data.recovery.action === "reload", stale.status);

  // ── Validatie: 422 met veldfouten ──
  const invalide = await j("POST", "/v1/customers", { name: "", email: "geen-mail" }, tok);
  check("validatiefout → 422 met errors-lijst", invalide.status === 422 && Array.isArray(invalide.data.errors) && invalide.data.errors.length >= 1, invalide.status);

  // ── Idempotency-Key werkt ook op /v1 ──
  const k = { "Idempotency-Key": "v1-smoke-1" };
  const i1 = await j("POST", "/v1/customers", { name: "V1 Idem BV", email: "v1idem@klant.be" }, tok, k);
  const i2 = await j("POST", "/v1/customers", { name: "V1 Idem BV", email: "v1idem@klant.be" }, tok, k);
  check("herhaalde POST met sleutel → zelfde id + replay-header", i2.data.data.id === i1.data.data.id && i2.headers.get("idempotency-replayed") === "true");
  check("replay behoudt de v1-vorm (geen dubbele centconversie)", i2.data.data.creditLimit === i1.data.data.creditLimit);

  // ── Onbekende resource + pariteit van rechten ──
  const onbekend = await j("GET", "/v1/bestaat-niet", null, tok);
  check("onbekende resource → 404 UNKNOWN_RESOURCE", onbekend.status === 404 && onbekend.data.code === "UNKNOWN_RESOURCE");
  const werf = await j("GET", "/v1/worksites", null, tok);
  check("entitlements gelden ook op /v1 (construction niet in Business → 403)", werf.status === 403, werf.status);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
