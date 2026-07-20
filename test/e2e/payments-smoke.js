// h45 · betalingsallocatie tegen de echte server: registreren, voorstellen,
// toewijzen (deel + volledig), factuurstatus volgt het saldo, terugdraaien
// met reden heropent de factuur. Bewust via de moderne /v1-API (centen).
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

  // Klant + twee facturen (via legacy, euro's): 300 en 200.
  const cust = await j("POST", `/api/tenants/${tid}/customers`, { name: "Betaler BV", email: "pay@x.be" }, tok);
  const cid = cust.data.customer.id;
  const invA = (await j("POST", `/api/tenants/${tid}/facturen`, { customerId: cid, customerName: "Betaler BV", lines: [{ description: "Werk A", quantity: 1, unitPrice: 300, vatRate: 0 }] }, tok)).data.invoice;
  const invB = (await j("POST", `/api/tenants/${tid}/facturen`, { customerId: cid, customerName: "Betaler BV", lines: [{ description: "Werk B", quantity: 1, unitPrice: 200, vatRate: 0 }] }, tok)).data.invoice;
  check("twee open facturen aangemaakt (300 + 200)", invA && invB && invA.total === 300 && invB.total === 200, invA && invA.total);

  // ── Betaling registreren via /v1 (45000 centen = 450 euro) ──
  const reg = await j("POST", "/v1/payments", { amount: 45000, method: "bank", date: "2026-07-20", customerId: cid, reference: invA.structuredComm }, tok);
  check("betaling geregistreerd via /v1 in centen", reg.status === 201 && reg.data.data.amount === 45000, reg.data.data && reg.data.data.amount);
  const payId = reg.data.data.id;

  // ── Voorstellen: referentie-match eerst ──
  const sugg = await j("GET", `/api/tenants/${tid}/payments/${payId}/suggestions`, null, tok);
  check("voorstel matcht eerst op gestructureerde mededeling", sugg.data.suggestions[0].invoiceId === invA.id && sugg.data.suggestions[0].matchedBy === "structured_communication", sugg.data.suggestions[0] && sugg.data.suggestions[0].matchedBy);

  // ── Toewijzen: A volledig (300), B deels (150) ──
  const alloc = await j("POST", `/api/tenants/${tid}/payments/${payId}/allocate`, { allocations: [
    { invoiceId: invA.id, amount: 300 }, { invoiceId: invB.id, amount: 150 },
  ] }, tok);
  check("toewijzing gelukt · A volledig gedekt", alloc.status === 200 && alloc.data.invoicesPaid.length === 1 && alloc.data.invoicesPaid[0].id === invA.id, JSON.stringify(alloc.data.invoicesPaid));
  check("betaling volledig toegewezen", alloc.data.payment.status === "allocated" && alloc.data.payment.unallocatedAmount === 0);

  const lijst = await j("GET", `/api/tenants/${tid}/facturen`, null, tok);
  const a2 = lijst.data.invoices.find(i => i.id === invA.id), b2 = lijst.data.invoices.find(i => i.id === invB.id);
  check("factuur A betaald, B open met saldo 50", a2.status === "paid" && b2.status === "open" && b2.openAmount === 50 && b2.paidAmount === 150, `${a2.status}/${b2.status}/${b2.openAmount}`);

  // ── Overallocatie geblokkeerd op beide assen ──
  const p2 = (await j("POST", `/api/tenants/${tid}/payments`, { amount: 100, method: "bank" }, tok)).data.payment;
  const teVeel = await j("POST", `/api/tenants/${tid}/payments/${p2.id}/allocate`, { allocations: [{ invoiceId: invB.id, amount: 60 }] }, tok);
  check("boven het openstaande saldo → 409 OVER_ALLOCATION", teVeel.status === 409 && teVeel.data.code === "OVER_ALLOCATION", teVeel.data.code);
  const uitgeput = await j("POST", `/api/tenants/${tid}/payments/${p2.id}/allocate`, { allocations: [{ invoiceId: invB.id, amount: 50 }] }, tok);
  const nogEens = await j("POST", `/api/tenants/${tid}/payments/${p2.id}/allocate`, { allocations: [{ invoiceId: invB.id, amount: 10 }] }, tok);
  check("betaling uitgeput → 409 (B is nu ook betaald)", uitgeput.status === 200 && nogEens.status === 409, `${uitgeput.status}/${nogEens.status}`);

  // ── Terugdraaien met reden → factuur heropent ──
  const detail = await j("GET", `/api/tenants/${tid}/payments/${payId}`, null, tok);
  const allocA = detail.data.payment.allocations.find(x => x.invoiceId === invA.id);
  const zonderReden = await j("POST", `/api/tenants/${tid}/payments/${payId}/allocations/${allocA.id}/reverse`, {}, tok);
  check("terugdraaien zonder reden → 400", zonderReden.status === 400 && zonderReden.data.code === "REASON_REQUIRED", zonderReden.status);
  const rev = await j("POST", `/api/tenants/${tid}/payments/${payId}/allocations/${allocA.id}/reverse`, { reason: "verkeerde factuur" }, tok);
  check("terugdraaien heropent factuur A", rev.status === 200 && rev.data.invoiceReopened && rev.data.invoiceReopened.id === invA.id, JSON.stringify(rev.data.invoiceReopened));
  const drill = await j("GET", `/api/tenants/${tid}/facturen/${invA.id}/payments`, null, tok);
  check("drill-down toont het heropende saldo", drill.data.openAmount === 300 && drill.data.paidAmount === 0, `${drill.data.paidAmount}/${drill.data.openAmount}`);

  // ── Events aanwezig ──
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=invoice.paid`, null, superTok);
  const ev2 = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=invoice.reopened`, null, superTok);
  check("events invoice.paid + invoice.reopened", (ev.data.events || []).length >= 1 && (ev2.data.events || []).length >= 1, `${(ev.data.events || []).length}/${(ev2.data.events || []).length}`);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
