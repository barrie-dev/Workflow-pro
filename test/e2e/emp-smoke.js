// Route-smoke h16: personeelsfiche, datumgebonden tarieven, beschikbaarheid,
// uit dienst, attesten, en de koppeling naar werkbonkosten op uitvoeringsdatum.
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
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // Personeelsfiche aanmaken (los van het gebruikersaccount)
  const emp = await j("POST", `/api/tenants/${tid}/employee_records`, {
    name: "Jan Peeters", employeeNumber: "P001", jobTitle: "Technieker",
    activeFrom: "2025-01-01", workSchedule: SCHEDULE, mobileAccess: true,
    costRates: [{ validFrom: "2025-01-01", costRate: 28, salesRate: 50 }],
    skills: [{ key: "hvac", label: "HVAC", level: "expert" }],
    certificates: [{ label: "VCA", expiresAt: "2026-08-01" }],
  }, tok);
  check("personeelsfiche aangemaakt", emp.status === 201 && emp.data.employee.status === "active", emp.data.employee && emp.data.employee.name);
  const empId = emp.data.employee.id;

  // Tariefversie toevoegen vanaf 1 juli 2026
  const rate = await j("POST", `/api/tenants/${tid}/employee_records/${empId}/rates`, { validFrom: "2026-07-01", costRate: 32, salesRate: 58 }, tok);
  check("nieuwe tariefversie toegevoegd", rate.status === 201 && rate.data.employee.costRates.length === 2, rate.data.employee && rate.data.employee.costRates.length);
  check("oude tariefversie ongewijzigd bewaard", (rate.data.employee.costRates || []).some(r => r.validFrom === "2025-01-01" && r.costRate === 28));

  // KERNCRITERIUM: werkbon van vóór de wijziging rekent met het OUDE tarief
  const woOud = await j("POST", `/api/tenants/${tid}/workorders`, { title: "Beurt juni", date: "2026-06-15" }, tok);
  const woOudId = woOud.data.workorder.id;
  const canonOud = await j("GET", `/api/tenants/${tid}/workorders/${woOudId}/canonical`, null, tok);
  const setOud = await j("PATCH", `/api/tenants/${tid}/workorders/${woOudId}/fields`, {
    expectedVersion: canonOud.data.workorder.version,
    workers: [{ userId: "x", employeeId: empId, name: "Jan", start: "08:00", end: "16:00" }],
  }, tok);
  check("werkbon juni gebruikt tarief 28 (uitvoeringsdatum)", setOud.data.workorder.workers[0].costRate === 28, setOud.data.workorder?.workers?.[0]?.costRate);
  check("werkbon juni kost = 8 × 28", setOud.data.totals.cost === 224, setOud.data.totals?.cost);

  // Werkbon ná de wijziging gebruikt het nieuwe tarief
  const woNieuw = await j("POST", `/api/tenants/${tid}/workorders`, { title: "Beurt juli", date: "2026-07-15" }, tok);
  const woNieuwId = woNieuw.data.workorder.id;
  const canonNieuw = await j("GET", `/api/tenants/${tid}/workorders/${woNieuwId}/canonical`, null, tok);
  const setNieuw = await j("PATCH", `/api/tenants/${tid}/workorders/${woNieuwId}/fields`, {
    expectedVersion: canonNieuw.data.workorder.version,
    workers: [{ userId: "x", employeeId: empId, name: "Jan", start: "08:00", end: "16:00" }],
  }, tok);
  check("werkbon juli gebruikt tarief 32", setNieuw.data.workorder.workers[0].costRate === 32, setNieuw.data.workorder?.workers?.[0]?.costRate);

  // En de juni-werkbon is NIET met terugwerkende kracht veranderd
  const opnieuw = await j("GET", `/api/tenants/${tid}/workorders/${woOudId}/canonical`, null, tok);
  check("historische werkbon blijft op het oude tarief", opnieuw.data.workorder.workers[0].costRate === 28, opnieuw.data.workorder?.workers?.[0]?.costRate);

  // Beschikbaarheid
  const maandag = await j("GET", `/api/tenants/${tid}/employee_records/${empId}/availability?date=2026-07-20`, null, tok);
  check("maandag beschikbaar volgens rooster", maandag.data.availability.available === true, JSON.stringify(maandag.data.availability?.reasons || []));
  const zaterdag = await j("GET", `/api/tenants/${tid}/employee_records/${empId}/availability?date=2026-07-25`, null, tok);
  check("zaterdag buiten rooster = waarschuwing, geen blokkering", zaterdag.data.availability.available === false && zaterdag.data.availability.blocking === false, JSON.stringify(zaterdag.data.availability?.reasons?.map(r => r.code)));

  // Vervallende attesten
  const certs = await j("GET", `/api/tenants/${tid}/employee_records/expiring-certificates?horizonDays=60`, null, tok);
  check("vervallend attest gesignaleerd", (certs.data.employees || []).some(e => (e.certificates || []).some(c => c.label === "VCA")), (certs.data.employees || []).length);

  // Uit dienst: historiek blijft, plannen kan niet meer
  const left = await j("POST", `/api/tenants/${tid}/employee_records/${empId}/transition`, { status: "left" }, tok);
  check("uit dienst zetten", left.status === 200 && left.data.employee.status === "left" && left.data.employee.mobileAccess === false);
  const naUit = await j("GET", `/api/tenants/${tid}/employee_records/${empId}/availability?date=2026-07-20`, null, tok);
  check("uit dienst = harde blokkering voor nieuwe planning", naUit.data.availability.blocking === true && naUit.data.availability.reasons.some(r => r.code === "OUT_OF_SERVICE"));
  const fiche = await j("GET", `/api/tenants/${tid}/employee_records/${empId}`, null, tok);
  check("historiek (tarieven) blijft bewaard na uit dienst", (fiche.data.employee.costRates || []).length === 2, (fiche.data.employee.costRates || []).length);

  // Events
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=employee.rate_changed`, null, superTok);
  check("employee.rate_changed event", (ev.data.events || []).length >= 1, (ev.data.events || []).length);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
