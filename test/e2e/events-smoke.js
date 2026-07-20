// Route-smoke voor R0-a: domain events in de outbox na een klant→offerte→factuur-flow.
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

  // Flow: klant → locatie → offerte → send → accept (publiek) → convert → betaald
  const cust = await j("POST", `/api/tenants/${tid}/customers`, { name: "Events Klant BV", email: "ev@klant.be" }, tok);
  await j("PATCH", `/api/tenants/${tid}/customers/${cust.data.customer.id}`, { phone: "0470" }, tok);
  const venue = await j("POST", `/api/tenants/${tid}/venues`, { name: "Werf Events" }, tok);
  const quote = await j("POST", `/api/tenants/${tid}/offertes`, { customerId: cust.data.customer.id, customerName: "Events Klant BV", lines: [{ description: "Werk", qty: 2, unitPrice: 100 }] }, tok);
  const qid = quote.data.quote.id;
  const sent = await j("POST", `/api/tenants/${tid}/offertes/${qid}/send`, {}, tok);
  const pubToken = sent.data.acceptUrl.split("/").pop();
  await require("./_accept")(BASE, pubToken);
  const conv = await j("POST", `/api/tenants/${tid}/offertes/${qid}/convert`, {}, tok);
  await j("PATCH", `/api/tenants/${tid}/facturen/${conv.data.invoice.id}`, { status: "paid" }, tok);

  // Superadmin: outbox inzien
  const superLogin = await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" });
  const stok = superLogin.data.token;
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&limit=50`, null, stok);
  check("admin/events bereikbaar", ev.status === 200, ev.status);
  const types = (ev.data.events || []).map(e => e.eventType);
  for (const expect of ["customer.created", "customer.updated", "location.created", "quote.created", "quote.version_sent", "quote.accepted", "quote.converted", "invoice.created", "invoice.paid"]) {
    check(`event ${expect}`, types.includes(expect));
  }
  const one = (ev.data.events || [])[0];
  check("envelope: evt_ULID + correlatie + pending", /^evt_[0-9A-HJKMNP-TV-Z]{26}$/.test(one.id) && !!one.correlationId && one.delivery.status === "pending", one.id);
  check("envelope: geen persoonsgegevens in data", !JSON.stringify(one.data || {}).includes("@"));

  // Zonder platformscope → 403/401
  const noScope = await j("GET", "/api/admin/events", null, tok);
  check("tenant-admin krijgt geen outbox", noScope.status === 403 || noScope.status === 401, noScope.status);

  // Publiek geweigerde offerte kan niet geconverteerd worden (bugfix)
  const q2 = await j("POST", `/api/tenants/${tid}/offertes`, { customerName: "X", lines: [{ description: "y", qty: 1, unitPrice: 10 }] }, tok);
  const s2 = await j("POST", `/api/tenants/${tid}/offertes/${q2.data.quote.id}/send`, {}, tok);
  const pub2 = s2.data.acceptUrl.split("/").pop();
  await j("POST", `/api/public/quote/${pub2}`, { decision: "reject" });
  const convRej = await j("POST", `/api/tenants/${tid}/offertes/${q2.data.quote.id}/convert`, {}, tok);
  check("publiek geweigerd → 409 QUOTE_REJECTED", convRej.status === 409 && convRej.data.code === "QUOTE_REJECTED", convRej.data.error);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
