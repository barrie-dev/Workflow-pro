// Route-smoke voor R2: Construction Core. Fase via argv[2]:
//   gated → business-tenant zonder pack: 403 module_disabled
//   full  → met moduleOverride: werf + partijen + change-order-flow + budgetdelta
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
const PHASE = process.argv[2] || "full";
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

  // Enterprise-pack: op een verse (business-)seed eerst aanzetten via de
  // superadmin, zodat deze smoke de module zelf voorziet i.p.v. een gegroeide
  // dataset te veronderstellen.
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  await j("PATCH", `/api/admin/tenants/${tid}/modules`, { moduleOverrides: { add: ["construction"], remove: [] } }, superTok);

  if (PHASE === "gated") {
    const r = await j("GET", `/api/tenants/${tid}/worksites`, null, tok);
    check("zonder pack → 403 module_disabled", r.status === 403 && r.data.code === "module_disabled", r.data.error);
    console.log(failures === 0 ? "GATED OK" : "GATED FAALT");
    exitSoft(failures === 0 ? 0 : 1);
  }

  // Projectcontext
  const cust = await j("POST", `/api/tenants/${tid}/customers`, { name: "Bouwheer NV", email: "bh@x.be" }, tok);
  const prj = await j("POST", `/api/tenants/${tid}/projects`, { name: "Nieuwbouw Zuid", customerId: cust.data.customer.id, budgetAmount: 10000 }, tok);
  const prjId = prj.data.project.id;

  // Werf met partijen
  const ws = await j("POST", `/api/tenants/${tid}/worksites`, {
    name: "Werf Gent Zuid", projectId: prjId, address: "Kaai 5", city: "Gent",
    accessInfo: "Code 1234", geo: { lat: 51.03, lng: 3.71 },
    parties: [
      { type: "principal", name: "Bouwheer NV", customerId: cust.data.customer.id },
      { type: "architect", name: "Studio A", contactEmail: "A@studio.be" },
      { type: "safety_coordinator", name: "VC Plus" },
    ],
  }, tok);
  check("werf aangemaakt met 3 partijen", ws.status === 201 && ws.data.worksite.parties.length === 3 && /^ws_/.test(ws.data.worksite.id), ws.data.worksite && ws.data.worksite.parties.length);
  check("partij-e-mail genormaliseerd", ws.data.worksite.parties[1].contactEmail === "a@studio.be");

  const wsList = await j("GET", `/api/tenants/${tid}/worksites?projectId=${prjId}`, null, tok);
  check("werven filterbaar op project", (wsList.data.worksites || []).length === 1);

  // Change order: draft → sent → accepted → budgetdelta op project
  const co = await j("POST", `/api/tenants/${tid}/changeorders`, {
    projectId: prjId, reason: "Extra stopcontacten", lines: [{ description: "Stopcontact", qty: 10, unitPrice: 100, vatRate: 21 }],
  }, tok);
  check("change order aangemaakt (CO-nummer, draft)", co.status === 201 && /^CO-\d{4}-\d{3}$/.test(co.data.changeOrder.number) && co.data.changeOrder.status === "draft", co.data.changeOrder && co.data.changeOrder.number);
  const coId = co.data.changeOrder.id;

  const badJump = await j("POST", `/api/tenants/${tid}/changeorders/${coId}/transition`, { status: "invoiced" }, tok);
  check("draft → invoiced geweigerd (409)", badJump.status === 409 && badJump.data.code === "INVALID_TRANSITION");

  await j("POST", `/api/tenants/${tid}/changeorders/${coId}/transition`, { status: "sent" }, tok);
  const acc = await j("POST", `/api/tenants/${tid}/changeorders/${coId}/transition`, { status: "accepted" }, tok);
  check("acceptatie geeft budgetDelta 1210", acc.status === 200 && acc.data.budgetDelta === 1210, acc.data.budgetDelta);

  const prjAfter = await j("GET", `/api/tenants/${tid}/projects/${prjId}`, null, tok);
  check("projectbudget verhoogd 10000 → 11210", prjAfter.data.project.budgetAmount === 11210, prjAfter.data.project.budgetAmount);

  // Lock na acceptatie
  const editLocked = await j("PATCH", `/api/tenants/${tid}/changeorders/${coId}`, { reason: "aanpassen" }, tok);
  check("bewerken na acceptatie → 409 CHANGE_LOCKED", editLocked.status === 409 && editLocked.data.code === "CHANGE_LOCKED");

  // Minderwerk
  const minder = await j("POST", `/api/tenants/${tid}/changeorders`, { projectId: prjId, reason: "Vloer geschrapt", lines: [{ description: "Vloer", qty: -10, unitPrice: 50, vatRate: 21 }] }, tok);
  check("minderwerk kind=decrease", minder.data.changeOrder.kind === "decrease" && minder.data.changeOrder.total === -605);

  // Events
  const superTok2 = superTok;
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=project.budget_changed`, null, superTok);
  check("project.budget_changed event", (ev.data.events || []).length >= 1, (ev.data.events || []).length);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
