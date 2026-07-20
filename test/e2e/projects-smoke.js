// Route-smoke voor R1-a: project-CRUD, statemachine-transitions, events, redactie.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : ""));
  if (!ok) failures++;
}
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const me = await j("GET", "/api/me", null, tok);
  const tid = me.data.user.tenantId;
  check("projects in entitlements/views", (me.data.entitlements?.views || []).includes("projects"));

  // Klant nodig als context
  const cust = await j("POST", `/api/tenants/${tid}/customers`, { name: "Project Klant BV", email: "p@k.be" }, tok);
  const custId = cust.data.customer.id;

  // Aanmaak + nummering + version
  const created = await j("POST", `/api/tenants/${tid}/projects`, {
    name: "Nieuwbouw Gent", customerId: custId, customerName: "Project Klant BV",
    type: "project", startDate: "2026-08-01", endDate: "2026-12-01", budgetAmount: 75000,
    phases: [{ title: "Ruwbouw", order: 1 }, { title: "Afwerking", order: 2 }],
  }, tok);
  const p = created.data.project;
  check("aanmaak 201 + PRJ-nummer + version 1", created.status === 201 && /^PRJ-\d{4}-\d{3}$/.test(p.number) && p.version === 1, p.number);
  check("status preparation, fasen bewaard", p.status === "preparation" && p.phases.length === 2);

  // GET detail
  const detail = await j("GET", `/api/tenants/${tid}/projects/${p.id}`, null, tok);
  check("GET detail werkt", detail.status === 200 && detail.data.project.id === p.id);

  // PATCH mag status niet forceren
  const patch = await j("PATCH", `/api/tenants/${tid}/projects/${p.id}`, { status: "closed", notes: "poging", expectedVersion: 1 }, tok);
  check("PATCH forceert status niet", patch.status === 200 && patch.data.project.status === "preparation" && patch.data.project.version === 2);

  // Transition: geldig, dan ongeldige sprong
  const t1 = await j("POST", `/api/tenants/${tid}/projects/${p.id}/transition`, { status: "active" }, tok);
  check("transition → active", t1.status === 200 && t1.data.project.status === "active");
  const tBad = await j("POST", `/api/tenants/${tid}/projects/${p.id}/transition`, { status: "closed" }, tok);
  check("ongeldige sprong → 409 INVALID_TRANSITION", tBad.status === 409 && tBad.data.code === "INVALID_TRANSITION", tBad.data.error);

  await j("POST", `/api/tenants/${tid}/projects/${p.id}/transition`, { status: "technically_done" }, tok);
  await j("POST", `/api/tenants/${tid}/projects/${p.id}/transition`, { status: "to_invoice" }, tok);
  const tClose = await j("POST", `/api/tenants/${tid}/projects/${p.id}/transition`, { status: "closed" }, tok);
  check("afsluiten via keten", tClose.status === 200 && tClose.data.project.status === "closed");
  const tReopenNoReason = await j("POST", `/api/tenants/${tid}/projects/${p.id}/transition`, { status: "active" }, tok);
  check("heropening zonder reden → 400 REASON_REQUIRED", tReopenNoReason.status === 400 && tReopenNoReason.data.code === "REASON_REQUIRED");
  const tReopen = await j("POST", `/api/tenants/${tid}/projects/${p.id}/transition`, { status: "active", reason: "Extra werken" }, tok);
  check("heropening met reden → 200", tReopen.status === 200 && tReopen.data.project.status === "active");

  // Domain events zichtbaar voor superadmin
  const superLogin = await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" });
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=project.status_changed`, null, superLogin.data.token);
  check("project.status_changed events in outbox", (ev.data.events || []).length >= 3, (ev.data.events || []).length);

  // Validatie
  const bad = await j("POST", `/api/tenants/${tid}/projects`, { name: "Geen klant" }, tok);
  check("project zonder klant → 400", bad.status === 400);

  // Budget-redactie: admin ziet budgetAmount
  const list = await j("GET", `/api/tenants/${tid}/projects`, null, tok);
  const pAdmin = (list.data.projects || []).find(x => x.id === p.id);
  check("admin ziet budgetAmount", pAdmin && pAdmin.budgetAmount === 75000, pAdmin && pAdmin.budgetAmount);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
