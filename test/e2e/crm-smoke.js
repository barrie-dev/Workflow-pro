// Route-smoke voor R0-d: genormaliseerd CRM (contacts/addresses), compatibility
// read op bestaande demo-klanten, optimistic locking en creditLimit-redactie.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : ""));
  if (!ok) failures++;
}
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const me = await j("GET", "/api/me", null, tok);
  const tid = me.data.user.tenantId;

  // Compatibility read: bestaande demo-klanten worden canoniek getild.
  const list0 = await j("GET", `/api/tenants/${tid}/customers`, null, tok);
  const anyLegacy = (list0.data.customers || [])[0];
  check("bestaande klant canoniek (contacts + schemaVersion 2)", !anyLegacy || (Array.isArray(anyLegacy.contacts) && anyLegacy.schemaVersion === 2), anyLegacy && JSON.stringify({ sv: anyLegacy.schemaVersion, c: (anyLegacy.contacts || []).length }));

  // Nieuw: genormaliseerde aanmaak met platte velden → contacts/addresses afgeleid.
  const created = await j("POST", `/api/tenants/${tid}/customers`, {
    name: "CRM Test BV", vatNumber: "BE0999", email: "Info@Crm.be", contactName: "Jan", phone: "0470",
    address: "Dorpstraat 1", city: "Gent", zip: "9000", paymentTermsDays: 45, creditLimit: 5000,
  }, tok);
  const c = created.data.customer;
  check("aanmaak 201 + ULID-id + version 1", created.status === 201 && /^cust_[0-9A-HJKMNP-TV-Z]{26}$/.test(c.id) && c.version === 1, c.id);
  check("contact afgeleid + genormaliseerd e-mail", c.contacts && c.contacts[0].email === "info@crm.be" && c.contacts[0].isPrimary === true);
  check("adres afgeleid", c.addresses && c.addresses[0].line === "Dorpstraat 1" && c.addresses[0].country === "BE");
  check("betaaltermijn + legacy-spiegel", c.paymentTermsDays === 45 && c.email === "info@crm.be" && c.city === "Gent");

  // Optimistic locking: correcte version → 200, stale → 409.
  const okUpdate = await j("PATCH", `/api/tenants/${tid}/customers/${c.id}`, { phone: "0480", expectedVersion: 1 }, tok);
  check("update met juiste version → 200 + version 2", okUpdate.status === 200 && okUpdate.data.customer.version === 2, okUpdate.data.customer && okUpdate.data.customer.version);
  const stale = await j("PATCH", `/api/tenants/${tid}/customers/${c.id}`, { phone: "0499", expectedVersion: 1 }, tok);
  check("stale version → 409 VERSION_CONFLICT", stale.status === 409 && stale.data.code === "VERSION_CONFLICT" && stale.data.currentVersion === 2, stale.data.error);
  const noVer = await j("PATCH", `/api/tenants/${tid}/customers/${c.id}`, { notes: "zonder version" }, tok);
  check("update zonder version blijft werken", noVer.status === 200 && noVer.data.customer.version === 3);

  // Validatie via de repository.
  const bad = await j("POST", `/api/tenants/${tid}/customers`, { name: "", email: "x" }, tok);
  check("lege naam → 400", bad.status === 400);
  const badMail = await j("POST", `/api/tenants/${tid}/customers`, { name: "X", email: "geen-mail" }, tok);
  check("ongeldig e-mail → 400", badMail.status === 400);

  // creditLimit-redactie (h8.2): admin ziet het, een niet-beheerder niet.
  const adminList = await j("GET", `/api/tenants/${tid}/customers`, null, tok);
  const cAdmin = (adminList.data.customers || []).find(x => x.id === c.id);
  check("admin ziet creditLimit", cAdmin && cAdmin.creditLimit === 5000, cAdmin && cAdmin.creditLimit);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
