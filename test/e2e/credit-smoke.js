// Route-smoke voor R1-d: bronlijnen bij conversie + creditnota-flow.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // Offerte → factuur: bronlijnen quote
  const cust = await j("POST", `/api/tenants/${tid}/customers`, { name: "Factuur Klant BV", email: "f@k.be" }, tok);
  const q = await j("POST", `/api/tenants/${tid}/offertes`, { customerId: cust.data.customer.id, customerName: "Factuur Klant BV", lines: [{ description: "Werk", qty: 2, unitPrice: 100, vatRate: 21 }] }, tok);
  const conv = await j("POST", `/api/tenants/${tid}/offertes/${q.data.quote.id}/convert`, {}, tok);
  const inv = conv.data.invoice;
  check("offerte→factuur lijnen dragen bron quote", inv.lines.every(l => l.sourceType === "quote" && l.sourceId === q.data.quote.id), inv.lines[0].sourceType);

  // Handmatige factuur → manual
  const man = await j("POST", `/api/tenants/${tid}/facturen`, { customerName: "K", lines: [{ description: "Los", qty: 1, unitPrice: 300 }] }, tok);
  check("handmatige lijn = manual", man.data.invoice.lines[0].sourceType === "manual");

  // Volledige creditnota
  const cn = await j("POST", `/api/tenants/${tid}/facturen/${inv.id}/credit`, { reason: "Verkeerd bedrag" }, tok);
  check("creditnota 201 + CN-nummer + negatief totaal", cn.status === 201 && /^CN-\d{4}-\d{3}$/.test(cn.data.creditNote.number) && cn.data.creditNote.total === -242, cn.data.creditNote && cn.data.creditNote.number);
  check("creditnota verwijst naar origineel", cn.data.creditNote.creditOf === inv.id && cn.data.creditNote.creditOfNumber === inv.number);

  // Origineel is gecrediteerd
  const list = await j("GET", `/api/tenants/${tid}/facturen`, null, tok);
  const orig = (list.data.invoices || []).find(x => x.id === inv.id);
  check("origineel status gecrediteerd + gelinkt", orig.status === "gecrediteerd" && orig.creditNoteId === cn.data.creditNote.id, orig.status);

  // Idempotent: tweede volledige credit → 409
  const cn2 = await j("POST", `/api/tenants/${tid}/facturen/${inv.id}/credit`, {}, tok);
  check("tweede volledige credit → 409 ALREADY_CREDITED", cn2.status === 409 && cn2.data.code === "ALREADY_CREDITED", cn2.data.error);

  // Creditnota crediteren → 400
  const cnOfCn = await j("POST", `/api/tenants/${tid}/facturen/${cn.data.creditNote.id}/credit`, {}, tok);
  check("creditnota crediteren → 400 IS_CREDIT_NOTE", cnOfCn.status === 400 && cnOfCn.data.code === "IS_CREDIT_NOTE");

  // Gedeeltelijke credit op de handmatige factuur (1 lijn)
  const man2 = await j("POST", `/api/tenants/${tid}/facturen`, { customerName: "K", lines: [{ description: "A", qty: 1, unitPrice: 100 }, { description: "B", qty: 1, unitPrice: 50 }] }, tok);
  const partial = await j("POST", `/api/tenants/${tid}/facturen/${man2.data.invoice.id}/credit`, { lineIndexes: [1] }, tok);
  check("gedeeltelijke credit alleen lijn B", partial.status === 201 && partial.data.creditNote.total === -60.5, partial.data.creditNote && partial.data.creditNote.total);

  // Events
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=invoice.credited`, null, superTok);
  check("invoice.credited events in outbox", (ev.data.events || []).length >= 2, (ev.data.events || []).length);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
