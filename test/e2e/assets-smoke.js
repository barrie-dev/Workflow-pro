// Route-smoke voor R3: assets + onderhoudsschema's + idempotente beurt-generatie.
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

  // Enterprise-pack: op een verse (business-)seed eerst aanzetten via de
  // superadmin, zodat deze smoke de module zelf voorziet i.p.v. een gegroeide
  // dataset te veronderstellen.
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  await j("PATCH", `/api/admin/tenants/${tid}/modules`, { moduleOverrides: { add: ["service_assets"], remove: [] } }, superTok);

  const cust = await j("POST", `/api/tenants/${tid}/customers`, { name: "HVAC Klant BV", email: "h@k.be" }, tok);

  // Installatie bij klant met serienummer
  const asset = await j("POST", `/api/tenants/${tid}/assets`, { name: "Warmtepomp WP-9", type: "installation", serial: "SN-WP9-001", customerId: cust.data.customer.id, warrantyUntil: "2028-01-01", meterReading: 120 }, tok);
  check("installatie aangemaakt (installed + historiek)", asset.status === 201 && asset.data.asset.status === "installed" && asset.data.asset.history.length === 1, asset.data.asset && asset.data.asset.status);
  const aid = asset.data.asset.id;

  const dup = await j("POST", `/api/tenants/${tid}/assets`, { name: "Kopie", serial: "SN-WP9-001" }, tok);
  check("dubbel serienummer → 409", dup.status === 409 && dup.data.code === "DUPLICATE_SERIAL");

  const meterDown = await j("PATCH", `/api/tenants/${tid}/assets/${aid}`, { meterReading: 100 }, tok);
  check("meterdaling zonder correctie → 409 METER_DECREASE", meterDown.status === 409 && meterDown.data.code === "METER_DECREASE");

  const statusChange = await j("PATCH", `/api/tenants/${tid}/assets/${aid}`, { status: "maintenance" }, tok);
  check("statuswijziging → historiek-event", statusChange.status === 200 && statusChange.data.asset.history.length === 2, statusChange.data.asset && statusChange.data.asset.history.length);

  // Onderhoudsschema + beurt genereren (idempotent)
  const plan = await j("POST", `/api/tenants/${tid}/maintenance/plans`, { assetId: aid, title: "Jaarlijks onderhoud WP", frequency: "annual", nextDue: "2026-07-20", checklist: ["Filter reinigen", "Druk controleren"] }, tok);
  check("schema aangemaakt (actief)", plan.status === 201 && plan.data.plan.status === "active", plan.data.plan && plan.data.plan.nextDue);
  const pid = plan.data.plan.id;

  const due = await j("GET", `/api/tenants/${tid}/maintenance/due?horizonDays=14`, null, tok);
  check("due-lijst bevat het schema", (due.data.due || []).some(p => p.id === pid), (due.data.due || []).length);

  const gen1 = await j("POST", `/api/tenants/${tid}/maintenance/plans/${pid}/generate`, {}, tok);
  check("beurt gegenereerd als werkbon met checklist", gen1.status === 201 && gen1.data.alreadyGenerated === false && !!gen1.data.job.id, gen1.data.dueDate);
  check("nextDue schuift 12 maanden op", gen1.data.plan.nextDue === "2027-07-20", gen1.data.plan.nextDue);

  // Werkbon draagt asset + checklist
  const wos = await j("GET", `/api/tenants/${tid}/workorders`, null, tok);
  const wo = (wos.data.workorders || []).find(w => w.maintenancePlanId === pid);
  check("werkbon gekoppeld aan plan + asset + 2 checklistitems", wo && wo.assetId === aid && (wo.checklist || []).length === 2, wo && (wo.checklist || []).length);

  // Events
  const superTok2 = superTok;
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=maintenance.job_generated`, null, superTok);
  check("maintenance.job_generated event", (ev.data.events || []).length >= 1);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
