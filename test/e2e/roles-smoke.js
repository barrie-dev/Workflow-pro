// ── Samenstelbare profielen · custom rollen (#75) tegen de echte server ──────
// Bewijst de hele flow: de admin bouwt uit de rechtencatalogus een profiel dat
// wij nooit voorzagen, wijst het toe aan een gebruiker, en die gebruiker heeft
// PRECIES die rechten - inclusief 'costs.view' dat gevoelige velden ontsluit
// zonder de beheerdersrol. Escalatie (platform-rechten) wordt geweigerd.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function activateLogin(email, activationLink) {
  const token = decodeURIComponent((activationLink || "").split("activate=")[1] || "");
  await j("POST", "/api/auth/activate", { token, password: "Sterk2026!Wachtwoord" });
  return (await j("POST", "/api/auth/login", { email, password: "Sterk2026!Wachtwoord" })).data.token;
}

(async () => {
  const tok = (await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" })).data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // 1. Catalogus bevat operationele rechten + het gevoelige beheerrecht costs.view.
  const cat = await j("GET", `/api/tenants/${tid}/permission-catalog`, null, tok);
  check("catalogus geladen (operationeel + costs.view)", cat.status === 200
    && cat.data.catalog.operational.some(p => p.key === "planning")
    && cat.data.catalog.admin.some(a => a.key === "costs.view"), cat.status);

  // 2. Doelmedewerker (actief) met een kostprijs (gevoelig veld).
  const piet = await j("POST", `/api/tenants/${tid}/employees`, { name: "Piet Kost", email: "piet.kost@x.be", role: "employee" }, tok);
  await j("PATCH", `/api/tenants/${tid}/employees/${piet.data.user.id}`, { costRate: 42 }, tok);
  await activateLogin("piet.kost@x.be", piet.data.activationLink); // actief → verschijnt in de lijst

  // 3. Twee samengestelde profielen: HR-lezer (geen kostzicht) en HR-finance (mét).
  const rLezer = await j("POST", `/api/tenants/${tid}/roles`, { name: "HR-lezer", description: "Ziet medewerkers, geen kosten", permissions: ["read:employees"] }, tok);
  const rFin = await j("POST", `/api/tenants/${tid}/roles`, { name: "HR-finance", description: "Ziet medewerkers mét kostprijs", permissions: ["read:employees", "costs.view"] }, tok);
  check("profiel HR-lezer aangemaakt", rLezer.status === 201 && !!rLezer.data.role.id, rLezer.data.role && rLezer.data.role.id);
  check("profiel HR-finance draagt costs.view", rFin.status === 201 && rFin.data.role.permissions.includes("costs.view"));

  // 4. Escalatie geweigerd: een profiel met een platform-recht kan niet.
  const escal = await j("POST", `/api/tenants/${tid}/roles`, { name: "Overnemer", permissions: ["read:employees", "tenants", "*"] }, tok);
  check("escalatie geweigerd (400 ROLE_PERMISSIONS_REJECTED)", escal.status === 400 && escal.data.code === "ROLE_PERMISSIONS_REJECTED", escal.data.code);

  // 5. Twee gebruikers, elk met één profiel.
  const uLezer = await j("POST", `/api/tenants/${tid}/employees`, { name: "Lena Lezer", email: "lena@x.be", role: "employee", roleId: rLezer.data.role.id }, tok);
  const uFin = await j("POST", `/api/tenants/${tid}/employees`, { name: "Fien Finance", email: "fien@x.be", role: "employee", roleId: rFin.data.role.id }, tok);
  const tokLezer = await activateLogin("lena@x.be", uLezer.data.activationLink);
  const tokFin = await activateLogin("fien@x.be", uFin.data.activationLink);

  // 6. Effectieve rechten van het profiel zichtbaar in /api/me.
  const meLezer = await j("GET", "/api/me", null, tokLezer);
  check("profielrechten effectief in /api/me", (meLezer.data.user.permissions || []).includes("read:employees"), JSON.stringify(meLezer.data.user.permissions));

  // 7. Beiden zien de medewerkerslijst (read:employees); enkel HR-finance ziet de kostprijs.
  const lijstLezer = await j("GET", `/api/tenants/${tid}/employees`, null, tokLezer);
  const lijstFin = await j("GET", `/api/tenants/${tid}/employees`, null, tokFin);
  check("HR-lezer mag de lijst zien (rechten-gedreven)", lijstLezer.status === 200);
  const pietVoorLezer = (lijstLezer.data.employees || []).find(e => e.id === piet.data.user.id);
  const pietVoorFin = (lijstFin.data.employees || []).find(e => e.id === piet.data.user.id);
  check("HR-lezer ziet GEEN kostprijs (geen costs.view)", pietVoorLezer && pietVoorLezer.costRate === undefined, pietVoorLezer && pietVoorLezer.costRate);
  check("HR-finance ziet WÉL de kostprijs (costs.view ontsluit gevoelige velden)", pietVoorFin && pietVoorFin.costRate === 42, pietVoorFin && pietVoorFin.costRate);

  // 8. Zonder het profiel: een gewone medewerker mag de lijst niet.
  const uPlain = await j("POST", `/api/tenants/${tid}/employees`, { name: "Wim Werker", email: "wim@x.be", role: "employee" }, tok);
  const tokPlain = await activateLogin("wim@x.be", uPlain.data.activationLink);
  const verboden = await j("GET", `/api/tenants/${tid}/employees`, null, tokPlain);
  check("zonder profiel → geen toegang tot de lijst (403)", verboden.status === 403, verboden.status);

  // 9. Profiel verwijderen geblokkeerd zolang toegewezen (referentiële veiligheid).
  const del = await j("DELETE", `/api/tenants/${tid}/roles/${rFin.data.role.id}`, null, tok);
  check("verwijderen geblokkeerd zolang toegewezen (409 ROLE_IN_USE)", del.status === 409 && del.data.code === "ROLE_IN_USE", del.data.code);

  // 10. De rol-lijst toont ingebouwde + custom profielen met aantal toewijzingen.
  const list = await j("GET", `/api/tenants/${tid}/roles`, null, tok);
  check("rol-lijst toont ingebouwd + custom, met assignedCount", list.status === 200
    && list.data.builtin.length === 3
    && list.data.custom.find(r => r.id === rFin.data.role.id)?.assignedCount === 1, JSON.stringify({ b: list.data.builtin?.length, c: list.data.custom?.length }));

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
