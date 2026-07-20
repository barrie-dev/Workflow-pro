// Route-smoke voor R0-b: default-company (migratie v8), nummerreeksen en companyId.
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
  const year = new Date().getFullYear();

  // Default-company (migratie v8 + endpoint)
  const co = await j("GET", `/api/tenants/${tid}/company`, null, tok);
  check("GET /company geeft default-company", co.status === 200 && co.data.company && co.data.company.isDefault === true, co.data.company && co.data.company.legalName);
  check("company-id formaat co_ULID", /^co_[0-9A-HJKMNP-TV-Z]{26}$/.test(co.data.company.id), co.data.company.id);

  // Facturen: sequentieel + companyId + geen hergebruik na delete
  const mkInv = () => j("POST", `/api/tenants/${tid}/facturen`, { customerName: "Seq Klant", lines: [{ description: "x", qty: 1, unitPrice: 100 }] }, tok);
  const i1 = await mkInv();
  const i2 = await mkInv();
  const n1 = Number(i1.data.invoice.number.split("-").pop());
  const n2 = Number(i2.data.invoice.number.split("-").pop());
  check("factuurnummers sequentieel", n2 === n1 + 1, `${i1.data.invoice.number} → ${i2.data.invoice.number}`);
  check("factuur draagt companyId", i2.data.invoice.companyId === co.data.company.id);
  const del = await j("DELETE", `/api/tenants/${tid}/facturen/${i2.data.invoice.id}`, null, tok);
  check("factuur 2 verwijderd", del.status === 200);
  const i3 = await mkInv();
  const n3 = Number(i3.data.invoice.number.split("-").pop());
  check("geen hergebruik na delete (max+1)", n3 === n2 + 1, `${i3.data.invoice.number}`);

  // Offertes + conversie: nummering + companyId
  const q1 = await j("POST", `/api/tenants/${tid}/offertes`, { customerName: "Seq Klant", lines: [{ description: "y", qty: 1, unitPrice: 50 }] }, tok);
  check("offertenummer formaat", new RegExp(`^OFF-${year}-\\d{3}$`).test(q1.data.quote.number), q1.data.quote.number);
  check("offerte draagt companyId", q1.data.quote.companyId === co.data.company.id);
  const conv = await j("POST", `/api/tenants/${tid}/offertes/${q1.data.quote.id}/convert`, { target: "workorder" }, tok);
  check("werkbonnummer formaat", new RegExp(`^WO-${year}-\\d{3}$`).test(conv.data.workorder.number), conv.data.workorder.number);
  const conv2 = await j("POST", `/api/tenants/${tid}/offertes/${q1.data.quote.id}/convert`, {}, tok);
  check("conversie-factuur sequentieel + companyId", Number(conv2.data.invoice.number.split("-").pop()) === n3 + 1 && conv2.data.invoice.companyId === co.data.company.id, conv2.data.invoice.number);

  // Rechten: employee mag /company niet lezen (settings-recht)
  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
