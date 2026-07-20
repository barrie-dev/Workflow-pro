// Route-smoke voor E21: Mona Signals over een echte flow + rechten-scoping + Mona-tool.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function activeEmp(tok, tid, name, email) {
  const c = await j("POST", `/api/tenants/${tid}/employees`, { name, email }, tok);
  const t = decodeURIComponent((c.data.activationLink || "").split("activate=")[1] || "");
  await j("POST", "/api/auth/activate", { token: t, password: "Sterk2026!Wachtwoord" });
  return (await j("POST", "/api/auth/login", { email, password: "Sterk2026!Wachtwoord" })).data.token;
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // Bouw wat "lekkage": aanvaarde offerte zonder conversie + vervallen factuur
  const cust = await j("POST", `/api/tenants/${tid}/customers`, { name: "Signal Klant BV", email: "s@k.be" }, tok);
  const q = await j("POST", `/api/tenants/${tid}/offertes`, { customerId: cust.data.customer.id, customerName: "Signal Klant BV", lines: [{ description: "Werk", qty: 1, unitPrice: 1000, vatRate: 21 }] }, tok);
  const send = await j("POST", `/api/tenants/${tid}/offertes/${q.data.quote.id}/send`, {}, tok);
  await j("POST", `/api/public/quote/${send.data.acceptUrl.split("/").pop()}`, { decision: "accept", name: "Klant" });

  // Vervallen factuur
  const inv = await j("POST", `/api/tenants/${tid}/facturen`, { customerName: "Signal Klant BV", dueDate: "2026-01-01", lines: [{ description: "Oud", qty: 1, unitPrice: 500 }] }, tok);

  const sig = await j("GET", `/api/tenants/${tid}/mona/signals`, null, tok);
  check("signals endpoint 200 met counts", sig.status === 200 && typeof sig.data.counts.total === "number", sig.data.counts && sig.data.counts.total);
  const types = (sig.data.signals || []).map(s => s.type);
  check("facturatie-lekkage gedetecteerd (aanvaarde offerte)", (sig.data.signals || []).some(s => s.type === "invoice_leakage" && s.refId === q.data.quote.id));
  check("vervallen factuur = kritiek", (sig.data.signals || []).some(s => s.type === "overdue_invoice" && s.severity === "critical" && s.refId === inv.data.invoice.id));
  check("kritiek staat vooraan (sortering)", (sig.data.signals[0] || {}).severity === "critical", (sig.data.signals[0] || {}).severity);

  // Rechten-scoping: medewerker ziet geen billing-signalen
  const empTok = await activeEmp(tok, tid, "Sig Emp", "se@x.be");
  const sigEmp = await j("GET", `/api/tenants/${tid}/mona/signals`, null, empTok);
  check("medewerker: geen factuur-lekkage/overdue", sigEmp.status === 200 && !(sigEmp.data.signals || []).some(s => ["invoice_leakage", "overdue_invoice"].includes(s.type)), (sigEmp.data.signals || []).map(s => s.type).join(","));

  // Mona-tool get_signals via de chat (mock-modus, maar de tool zelf is bereikbaar via de widget-flow)
  const boden = await j("POST", `/api/tenants/${tid}/boden`, { messages: [{ role: "user", content: "wat heeft mijn aandacht nodig?" }] }, tok);
  check("Mona-chat bereikbaar (mock of live)", boden.status === 200 && typeof boden.data.reply === "string");

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
