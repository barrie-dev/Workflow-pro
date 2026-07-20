// Route-smoke h38 + h16-koppeling: portfolio, baseline, forecasthistoriek,
// capaciteitsforecast, en planning die beschikbaarheid/rooster valideert.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const SCHEDULE = { mon: { start: "08:00", end: "17:00" }, tue: { start: "08:00", end: "17:00" }, wed: { start: "08:00", end: "17:00" }, thu: { start: "08:00", end: "17:00" }, fri: { start: "08:00", end: "16:00" } };

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const me = await j("GET", "/api/me", null, tok);
  const tid = me.data.user.tenantId;
  const uid = me.data.user.id;

  // Project met fasen + offerte in de pipeline
  const cust = (await j("POST", `/api/tenants/${tid}/customers`, { name: "Portfolio Klant", email: "pk2@x.be" }, tok)).data.customer;
  const proj = await j("POST", `/api/tenants/${tid}/projects`, {
    name: "Nieuwbouw kantoor", customerId: cust.id, budgetAmount: 100000,
    startDate: "2026-01-01", endDate: "2026-12-01",
    phases: [
      { id: "f1", title: "Ruwbouw", startDate: "2026-01-01", endDate: "2026-03-31" },
      { id: "f2", title: "Afwerking", startDate: "2026-04-01", endDate: "2026-06-30" },
    ],
  }, tok);
  check("project met fasen", proj.status === 201 && proj.data.project.phases.length === 2, proj.data.project && proj.data.project.phases.length);
  const projId = proj.data.project.id;
  await j("POST", `/api/tenants/${tid}/offertes`, { customerId: cust.id, clientName: "Portfolio Klant", lines: [{ description: "Fase 2", qty: 1, unitPrice: 20000, vatRate: 21 }] }, tok);

  // Portfolio
  const pf = await j("GET", `/api/tenants/${tid}/portfolio`, null, tok);
  check("portfolio toont projecten", pf.status === 200 && (pf.data.portfolio.projects || []).some(p => p.projectId === projId), (pf.data.portfolio.projects || []).length);
  check("gewogen offertes staan apart van projecten", Array.isArray(pf.data.portfolio.weightedQuotes) && pf.data.portfolio.totals.pipelineWeighted !== undefined && pf.data.portfolio.totals.projectBudget !== undefined, JSON.stringify(pf.data.portfolio.totals && { b: pf.data.portfolio.totals.projectBudget, p: pf.data.portfolio.totals.pipelineWeighted }));
  check("geen misleidend gecombineerd omzettotaal", !("totalRevenue" in (pf.data.portfolio.totals || {})));

  // Baseline
  const geenBaseline = await j("GET", `/api/tenants/${tid}/projects/${projId}/baseline`, null, tok);
  check("zonder baseline geen vergelijking", geenBaseline.data.comparison.hasBaseline === false);
  const bl = await j("POST", `/api/tenants/${tid}/projects/${projId}/baseline`, {}, tok);
  check("baseline vastgelegd", bl.status === 200 && bl.data.comparison.hasBaseline === true && bl.data.comparison.maxEndDriftDays === 0);

  // Fase verschuift → drift zichtbaar, baseline onaangetast
  const huidig = bl.data.project;
  await j("PATCH", `/api/tenants/${tid}/projects/${projId}`, {
    ...huidig,
    phases: huidig.phases.map(p => p.id === "f2" ? { ...p, startDate: "2026-05-01", endDate: "2026-07-31" } : p),
  }, tok);
  const cmp = await j("GET", `/api/tenants/${tid}/projects/${projId}/baseline`, null, tok);
  const f2 = (cmp.data.comparison.phases || []).find(p => p.phaseId === "f2");
  check("uitloop t.o.v. baseline zichtbaar", f2 && f2.endDriftDays === 31 && f2.baselineEnd === "2026-06-30", f2 && f2.endDriftDays);

  // Forecasthistoriek
  await j("POST", `/api/tenants/${tid}/projects/${projId}/forecast`, { amount: 20000, probability: 0.5, source: "quote", reason: "Offerte verzonden" }, tok);
  await j("POST", `/api/tenants/${tid}/projects/${projId}/forecast`, { amount: 20000, probability: 1, source: "quote_accepted", reason: "Omgezet naar project" }, tok);
  const fc = await j("GET", `/api/tenants/${tid}/projects/${projId}/forecast`, null, tok);
  check("forecasthistoriek behouden bij conversie", (fc.data.history || []).length === 2 && fc.data.history[0].weighted === 10000 && fc.data.current.amount === 20000, (fc.data.history || []).length);

  // Personeelsfiches voor capaciteit
  const tech = await j("POST", `/api/tenants/${tid}/employee_records`, { name: "Tech A", jobTitle: "Technieker", userId: uid, activeFrom: "2025-01-01", workSchedule: SCHEDULE }, tok);
  check("personeelsfiche voor capaciteit", tech.status === 201);

  // Planning binnen rooster (maandag) → geen waarschuwing
  const maandag = await j("POST", `/api/tenants/${tid}/planning`, { userId: uid, date: "2026-07-20", start: "08:00", end: "16:00" }, tok);
  check("planning op een roosterdag lukt zonder waarschuwing", maandag.status === 201 && !maandag.data.warnings, JSON.stringify(maandag.data.warnings || "geen"));

  // Planning op zaterdag → lukt, maar mét waarschuwing (beleid: waarschuwen)
  const zaterdag = await j("POST", `/api/tenants/${tid}/planning`, { userId: uid, date: "2026-07-25", start: "08:00", end: "12:00" }, tok);
  check("planning buiten rooster = waarschuwing, geen blokkering", zaterdag.status === 201 && (zaterdag.data.warnings || []).length === 1 && zaterdag.data.warnings[0].reasons.some(r => r.code === "OFF_SCHEDULE"), JSON.stringify((zaterdag.data.warnings || [])[0]?.reasons?.map(r => r.code)));

  // Uit dienst → planning geblokkeerd
  await j("POST", `/api/tenants/${tid}/employee_records/${tech.data.employee.id}/transition`, { status: "left" }, tok);
  const naUit = await j("POST", `/api/tenants/${tid}/planning`, { userId: uid, date: "2026-07-27", start: "08:00", end: "16:00" }, tok);
  check("planning op iemand uit dienst → 409", naUit.status === 409 && naUit.data.code === "OUT_OF_SERVICE", naUit.data.code);

  // Capaciteitsforecast
  const cap = await j("GET", `/api/tenants/${tid}/portfolio/capacity?from=2026-07-01&to=2026-07-31&bucket=month`, null, tok);
  check("capaciteitsforecast per periode", cap.status === 200 && (cap.data.capacity.periods || []).length === 1 && cap.data.capacity.periods[0].period === "2026-07", cap.data.capacity && cap.data.capacity.periods.length);
  check("capaciteit uitgesplitst per rol", (cap.data.capacity.periods[0].roles || []).length >= 1, (cap.data.capacity.periods[0].roles || []).map(r => r.role).join(","));
  check("tekortenlijst aanwezig", Array.isArray(cap.data.capacity.shortfalls));

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
