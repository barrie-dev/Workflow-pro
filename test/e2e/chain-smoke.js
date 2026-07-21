// ── Vlaggenschip-keten (h51.1 scenario 1) · MODULE-SAMENHANG ─────────────────
// Eén doorlopend scenario dat de hele bedrijfsketen als ÉÉN verhaal bewijst:
//   klant → offerte → (verzenden + geverifieerd ondertekenen) → project →
//   planning → werkbon (uren/materiaal/handtekening/goedkeuring) →
//   factuur (uit de offerteketen, draagt projectId) → betaling (allocatie) →
//   projectfinance (budget/arbeid/gefactureerd/marge).
//
// Waar de losse smokes elke schakel apart dekten, bewijst deze dat de modules
// ELKAAR voeden: dezelfde klant/project/offerte/factuur reizen door de keten en
// het finance-read-model telt precies op wat de bovenstroom produceerde. Dit is
// het "modules werken samen"-bewijs (CTO DEV-02 · scenario 1 "volledig").
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
const acceptQuote = require("./_accept");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function activeEmp(tok, tid, name, email) {
  const c = await j("POST", `/api/tenants/${tid}/employees`, { name, email }, tok);
  const token = decodeURIComponent((c.data.activationLink || "").split("activate=")[1] || "");
  await j("POST", "/api/auth/activate", { token, password: "Sterk2026!Wachtwoord" });
  const login = await j("POST", "/api/auth/login", { email, password: "Sterk2026!Wachtwoord" });
  return { id: c.data.user.id, token: login.data.token };
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // ── 1. Klant ──────────────────────────────────────────────────────────────
  const cust = await j("POST", `/api/tenants/${tid}/customers`, { name: "Keten Bouwheer BV", email: "keten@bouwheer.be" }, tok);
  check("1· klant aangemaakt", cust.status === 201 && !!cust.data.customer.id, cust.data.customer && cust.data.customer.id);
  const custId = cust.data.customer.id;

  // ── 2. Project (draagt budget, gekoppeld aan klant) ─────────────────────────
  const prj = await j("POST", `/api/tenants/${tid}/projects`, { name: "Keten Nieuwbouw", customerId: custId, budgetAmount: 5000 }, tok);
  check("2· project gekoppeld aan klant, budget 5000", prj.status === 201 && prj.data.project.customerId === custId && prj.data.project.budgetAmount === 5000, prj.data.project && prj.data.project.budgetAmount);
  const prjId = prj.data.project.id;

  // ── 3. Offerte draagt het projectId (bovenstroom → keten) ───────────────────
  const q = await j("POST", `/api/tenants/${tid}/offertes`, { projectId: prjId, customerId: custId, customerName: "Keten Bouwheer BV", lines: [{ description: "Ruwbouw", qty: 10, unitPrice: 100, vatRate: 21 }] }, tok);
  check("3· offerte draagt projectId", q.status === 201 && q.data.quote.projectId === prjId, q.data.quote && q.data.quote.projectId);
  const qid = q.data.quote.id;

  // ── 4. Verzenden bevriest de versie + hash; publieke GEVERIFIEERDE aanvaarding ─
  const send = await j("POST", `/api/tenants/${tid}/offertes/${qid}/send`, {}, tok);
  check("4a· verzenden bevriest v1 met documenthash", send.status === 200 && /^sha256:/.test(send.data.quote.documentHash), send.data.quote && (send.data.quote.documentHash || "").slice(0, 14));
  const pubToken = (send.data.acceptUrl || "").split("/").pop();
  const accept = await acceptQuote(BASE, pubToken, "Bouwheer Jan");
  check("4b· geverifieerde publieke aanvaarding", accept.status === 200 && accept.data.status === "aanvaard", accept.data && accept.data.status);

  // ── 5. Factuur uit de offerteketen · draagt hetzelfde projectId ─────────────
  const conv = await j("POST", `/api/tenants/${tid}/offertes/${qid}/convert`, {}, tok);
  check("5· conversie-factuur draagt projectId + nummer", conv.status === 201 && conv.data.invoice.projectId === prjId && !!conv.data.invoice.number, conv.data.invoice && conv.data.invoice.number);
  const inv = conv.data.invoice;

  // ── 6. Planning: 2 shifts op het project (arbeid = 8u) ──────────────────────
  const emp = await activeEmp(tok, tid, "Keten Tech", "keten.tech@x.be");
  const p1 = await j("POST", `/api/tenants/${tid}/planning`, { userId: emp.id, projectId: prjId, date: "2026-08-20", start: "08:00", end: "12:00" }, tok);
  const p2 = await j("POST", `/api/tenants/${tid}/planning`, { userId: emp.id, projectId: prjId, date: "2026-08-21", start: "08:00", end: "12:00" }, tok);
  check("6· 2 planning-shifts op het project", p1.status === 201 && p2.status === 201);

  // ── 7. Werkbon op het project: uren + materiaal + verplicht formulier + handtekening + goedkeuring ─
  const me = await j("GET", "/api/me", null, tok);
  const wo = await j("POST", `/api/tenants/${tid}/workorders`, { title: "Keten werkbon", date: "2026-08-21", description: "Uitvoering ruwbouw", projectId: prjId }, tok);
  check("7a· werkbon aangemaakt (WO-nummer)", wo.status === 201 && /^WO-/.test(wo.data.workorder.number), wo.data.workorder && wo.data.workorder.number);
  const woId = wo.data.workorder.id;
  const canon = await j("GET", `/api/tenants/${tid}/workorders/${woId}/canonical`, null, tok);
  const setFields = await j("PATCH", `/api/tenants/${tid}/workorders/${woId}/fields`, {
    expectedVersion: canon.data.workorder.version,
    workers: [{ userId: me.data.user.id, name: "Keten Tech", start: "08:00", end: "12:00", costRate: 30, salesRate: 55 }],
    materials: [{ description: "Beton", qty: 2, unitPrice: 150, costPrice: 90 }],
    forms: [{ id: "f1", label: "Veiligheid gecontroleerd?", type: "bool", required: true }],
  }, tok);
  check("7b· uren + materiaal gescheiden kost/verkoop", setFields.status === 200 && setFields.data.totals && setFields.data.totals.cost > 0 && setFields.data.totals.sales > setFields.data.totals.cost, JSON.stringify(setFields.data.totals));
  await j("PATCH", `/api/tenants/${tid}/workorders/${woId}/fields`, { expectedVersion: setFields.data.workorder.version, forms: [{ id: "f1", label: "Veiligheid gecontroleerd?", type: "bool", required: true, answer: true }] }, tok);
  const sign = await j("POST", `/api/tenants/${tid}/workorders/${woId}/sign`, { by: "Bouwheer Jan", dataRef: "sig_keten" }, tok);
  check("7c· handtekening gebonden aan versie", sign.status === 200 && sign.data.workorder.signature.invalidated === false);
  const sub = await j("POST", `/api/tenants/${tid}/workorders/${woId}/submit`, {}, tok);
  const appr = await j("POST", `/api/tenants/${tid}/workorders/${woId}/review`, { decision: "approve", note: "Akkoord" }, tok);
  check("7d· werkbon ingediend + goedgekeurd", sub.status === 200 && appr.status === 200 && appr.data.workorder.status === "approved", appr.data.workorder && appr.data.workorder.status);
  const woLines = await j("GET", `/api/tenants/${tid}/workorders/${woId}/canonical?strategy=detail`, null, tok);
  check("7e· werkbon levert factureerbare bronregels (sourceType=workorder)", (woLines.data.invoiceLines || []).length >= 1 && woLines.data.invoiceLines.every(l => l.sourceType === "workorder"), (woLines.data.invoiceLines || []).length);

  // ── 8. Betaling op de factuur (allocatie) ───────────────────────────────────
  const pay = await j("POST", `/api/tenants/${tid}/payments`, { amount: 1210, method: "bank", customerId: custId }, tok);
  check("8a· betaling geregistreerd", pay.status === 201 && !!pay.data.payment.id, pay.data.payment && pay.data.payment.amount);
  const alloc = await j("POST", `/api/tenants/${tid}/payments/${pay.data.payment.id}/allocate`, { allocations: [{ invoiceId: inv.id, amount: 1210 }] }, tok);
  check("8b· betaling toegewezen aan de ketenfactuur", alloc.status === 200 && alloc.data.payment.status === "allocated" && alloc.data.payment.unallocatedAmount === 0, alloc.data.payment && alloc.data.payment.status);
  const drill = await j("GET", `/api/tenants/${tid}/facturen/${inv.id}/payments`, null, tok);
  check("8c· factuur toont de betaling (drill-down)", (drill.data.payments || drill.data.allocations || []).length >= 1);

  // ── 9. Projectfinance telt de HELE keten op ─────────────────────────────────
  const fin = await j("GET", `/api/tenants/${tid}/projects/${prjId}/finance`, null, tok);
  const F = fin.data.finance || {};
  check("9a· budget uit het project", fin.status === 200 && F.budget && F.budget.total === 5000, F.budget && F.budget.total);
  check("9b· arbeid uit de planning (8u)", F.actual && F.actual.labor && F.actual.labor.hours === 8, F.actual && F.actual.labor && F.actual.labor.hours);
  check("9c· gefactureerd 1000 uit de offerteketen", F.invoiced && F.invoiced.total === 1000, F.invoiced && F.invoiced.total);
  check("9d· factuurbron traceerbaar naar de keten", F.invoiced && (F.invoiced.sources || []).some(s => s.number === inv.number), JSON.stringify((F.invoiced && F.invoiced.sources || []).map(s => s.number)));

  // ── 10. Project 360°-dossier: alle modulesporen + één tijdlijn (#76) ────────
  const dos = await j("GET", `/api/tenants/${tid}/projects/${prjId}/dossier`, null, tok);
  const D = dos.data.dossier || {};
  check("10a· dossier bundelt offerte + factuur + betaling van het project", dos.status === 200
    && D.counts.quotes >= 1 && D.counts.invoices >= 1 && D.counts.payments >= 1, JSON.stringify(D.counts));
  check("10b· één chronologische tijdlijn over de modules heen", Array.isArray(D.timeline)
    && D.timeline.length >= 4
    && D.timeline.some(e => e.module === "invoices")
    && D.timeline.some(e => e.module === "payments")
    && D.timeline.some(e => e.module === "quotes"), D.timeline && D.timeline.length);
  check("10c· financiele samenvatting mee voor de beheerder", D.finance && D.finance.budget && D.finance.budget.total === 5000, D.finance && D.finance.budget && D.finance.budget.total);

  // ── 11. Klant 360°-dossier: CRM + finance in één klantbeeld + saldo (#76) ───
  const cdos = await j("GET", `/api/tenants/${tid}/customers/${custId}/dossier`, null, tok);
  const CD = cdos.data.dossier || {};
  check("11a· klant-360 bundelt project + offerte + factuur + betaling", cdos.status === 200
    && CD.counts.projects >= 1 && CD.counts.invoices >= 1 && CD.counts.payments >= 1, JSON.stringify(CD.counts));
  check("11b· klantsaldo: gefactureerd / betaald / openstaand berekend", CD.balance
    && CD.balance.invoiced > 0 && CD.balance.paid > 0 && typeof CD.balance.outstanding === "number", JSON.stringify(CD.balance));

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
