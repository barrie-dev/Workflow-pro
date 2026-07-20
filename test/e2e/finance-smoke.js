// Route-smoke voor R4-a: projectId-bronketen + finance-read-model + scope-gate.
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
  const token = decodeURIComponent((c.data.activationLink || "").split("activate=")[1] || "");
  await j("POST", "/api/auth/activate", { token, password: "Sterk2026!Wachtwoord" });
  const login = await j("POST", "/api/auth/login", { email, password: "Sterk2026!Wachtwoord" });
  return { id: c.data.user.id, token: login.data.token };
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // Keten: klant → project → offerte(projectId) → convert → factuur draagt projectId
  const cust = await j("POST", `/api/tenants/${tid}/customers`, { name: "Finance Klant BV", email: "fk@x.be" }, tok);
  const prj = await j("POST", `/api/tenants/${tid}/projects`, { name: "Finance Project", customerId: cust.data.customer.id, budgetAmount: 5000 }, tok);
  const prjId = prj.data.project.id;

  const q = await j("POST", `/api/tenants/${tid}/offertes`, { projectId: prjId, customerId: cust.data.customer.id, customerName: "Finance Klant BV", lines: [{ description: "Werk", qty: 10, unitPrice: 100, vatRate: 21 }] }, tok);
  check("offerte draagt projectId", q.data.quote.projectId === prjId);
  const conv = await j("POST", `/api/tenants/${tid}/offertes/${q.data.quote.id}/convert`, {}, tok);
  check("conversie-factuur draagt projectId", conv.data.invoice.projectId === prjId, conv.data.invoice.projectId);

  // Planning: 2 shifts op het project (8u totaal, 1 met extra resource)
  const emp = await activeEmp(tok, tid, "Fin Tech", "ft@x.be");
  await j("POST", `/api/tenants/${tid}/planning`, { userId: emp.id, projectId: prjId, date: "2026-08-20", start: "08:00", end: "12:00" }, tok);
  await j("POST", `/api/tenants/${tid}/planning`, { userId: emp.id, projectId: prjId, date: "2026-08-21", start: "08:00", end: "12:00" }, tok);

  // Finance-read-model
  const fin = await j("GET", `/api/tenants/${tid}/projects/${prjId}/finance`, null, tok);
  check("finance 200 met budget", fin.status === 200 && fin.data.finance.budget.total === 5000, fin.data.finance && fin.data.finance.budget.total);
  check("arbeid 8u tegen tarief", fin.data.finance.actual.labor.hours === 8 && fin.data.finance.actual.labor.basis === "rate_estimate", JSON.stringify(fin.data.finance.actual.labor));
  check("gefactureerd 1000 excl btw (bron: offerteketen)", fin.data.finance.invoiced.total === 1000, fin.data.finance.invoiced.total);
  check("drill-down bronnen aanwezig", fin.data.finance.invoiced.sources.length === 1 && fin.data.finance.invoiced.sources[0].number, JSON.stringify(fin.data.finance.invoiced.sources[0]));

  // Financiele scope: medewerker (zonder admin) → 403 FINANCIAL_SCOPE
  const asEmp = await j("GET", `/api/tenants/${tid}/projects/${prjId}/finance`, null, emp.token);
  check("niet-beheerder → 403 FINANCIAL_SCOPE of geen projects-recht", asEmp.status === 403, asEmp.status + " " + (asEmp.data.code || ""));

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
