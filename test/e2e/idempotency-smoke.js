// h41-acceptatie tegen de echte server: "Een herhaalde POST met dezelfde
// idempotency key creëert geen duplicaat." Plus: andere sleutel maakt wél een
// tweede rij, en de replay is byte-gelijk met een replay-markering.
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
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  const payload = { name: "Idempotent BV", email: "idem@klant.be", phone: "0470" };
  const kop = { "Idempotency-Key": "smoke-key-1" };

  const voor = (await j("GET", `/api/tenants/${tid}/customers`, null, tok)).data.customers.length;

  // ── Het acceptatiecriterium ──
  const eerste = await j("POST", `/api/tenants/${tid}/customers`, payload, tok, kop);
  check("eerste POST maakt de klant aan", eerste.status === 201 && !!eerste.data.customer, eerste.status);

  const herhaald = await j("POST", `/api/tenants/${tid}/customers`, payload, tok, kop);
  check("herhaalde POST → zelfde status", herhaald.status === eerste.status, herhaald.status);
  check("herhaalde POST → zelfde klant-id (geen duplicaat)", herhaald.data.customer && herhaald.data.customer.id === eerste.data.customer.id, herhaald.data.customer && herhaald.data.customer.id);
  check("replay gemarkeerd via Idempotency-Replayed-header", herhaald.headers.get("idempotency-replayed") === "true");

  const na = (await j("GET", `/api/tenants/${tid}/customers`, null, tok)).data.customers.length;
  check("exact één klant bijgekomen na twee identieke POSTs", na === voor + 1, `${voor} → ${na}`);

  // ── Andere sleutel = bewust een tweede uitvoering ──
  const andere = await j("POST", `/api/tenants/${tid}/customers`, { ...payload, email: "idem2@klant.be" }, tok, { "Idempotency-Key": "smoke-key-2" });
  check("andere sleutel maakt wél een nieuwe rij", andere.status === 201 && andere.data.customer.id !== eerste.data.customer.id);

  // ── Fouten spelen NIET terug: een verbeterde retry moet opnieuw evalueren ──
  const fout = await j("POST", `/api/tenants/${tid}/customers`, { name: "", email: "x" }, tok, { "Idempotency-Key": "smoke-key-3" });
  check("validatiefout blijft gewoon een fout", fout.status === 400, fout.status);
  const verbeterd = await j("POST", `/api/tenants/${tid}/customers`, { name: "Na correctie BV", email: "idem3@klant.be" }, tok, { "Idempotency-Key": "smoke-key-3" });
  check("verbeterde retry met dezelfde sleutel voert opnieuw uit", verbeterd.status === 201 && !!verbeterd.data.customer, verbeterd.status);

  // ── Ook op PATCH: herhaalde mutatie verhoogt de versie niet twee keer ──
  const cid = eerste.data.customer.id;
  const p1 = await j("PATCH", `/api/tenants/${tid}/customers/${cid}`, { phone: "0489", expectedVersion: 1 }, tok, { "Idempotency-Key": "smoke-patch-1" });
  const p2 = await j("PATCH", `/api/tenants/${tid}/customers/${cid}`, { phone: "0489", expectedVersion: 1 }, tok, { "Idempotency-Key": "smoke-patch-1" });
  check("herhaalde PATCH speelt terug in plaats van VERSION_CONFLICT", p2.status === p1.status && p2.headers.get("idempotency-replayed") === "true", p2.status);

  // ── Zonder header verandert er niets aan het bestaande gedrag ──
  const los1 = await j("POST", `/api/tenants/${tid}/customers`, { name: "Zonder sleutel BV", email: "los1@klant.be" }, tok);
  const los2 = await j("POST", `/api/tenants/${tid}/customers`, { name: "Zonder sleutel BV", email: "los2@klant.be" }, tok);
  check("zonder header blijven twee POSTs twee rijen", los1.data.customer.id !== los2.data.customer.id);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
