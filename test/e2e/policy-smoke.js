// Route-smoke voor R0-c: team-scope end-to-end, IDOR-fix op employees-PATCH,
// team:-sanering en gevoelige-velden-redactie.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : ""));
  if (!ok) failures++;
}

async function j(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

async function makeActiveEmployee(tok, tid, { name, email, teamId }) {
  const created = await j("POST", `/api/tenants/${tid}/employees`, { name, email, teamId }, tok);
  const token = decodeURIComponent((created.data.activationLink || "").split("activate=")[1] || "");
  await j("POST", "/api/auth/activate", { token, password: "Sterk2026!Wachtwoord" });
  const login = await j("POST", "/api/auth/login", { email, password: "Sterk2026!Wachtwoord" });
  return { id: created.data.user.id, token: login.data.token };
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const me = await j("GET", "/api/me", null, tok);
  const tid = me.data.user.tenantId;

  // Drie medewerkers: a+b in ploeg1, c zonder team
  const a = await makeActiveEmployee(tok, tid, { name: "Ploeglid A", email: "pa@t.be", teamId: "team_ploeg1" });
  const b = await makeActiveEmployee(tok, tid, { name: "Ploeglid B", email: "pb@t.be", teamId: "team_ploeg1" });
  const c = await makeActiveEmployee(tok, tid, { name: "Solo C", email: "pc@t.be", teamId: null });
  check("drie medewerkers actief", !!(a.token && b.token && c.token));

  // Elk dient een eigen onkost in (me/expenses)
  for (const [who, t] of [["A", a.token], ["B", b.token], ["C", c.token]]) {
    const e = await j("POST", `/api/tenants/${tid}/me/expenses`, { amount: 10, category: "materiaal", description: `Onkost ${who}`, date: "2026-07-17" }, t);
    check(`onkost ${who} ingediend`, e.status === 201 || e.status === 200, e.status);
  }

  // Standaard (own:expenses): A ziet enkel de eigen onkost
  const ownList = await j("GET", `/api/tenants/${tid}/expenses`, null, a.token);
  check("own-scope: A ziet 1 onkost", (ownList.data.expenses || []).length === 1, (ownList.data.expenses || []).length);

  // Admin geeft A team-niveau: team:expenses
  const grant = await j("PATCH", `/api/tenants/${tid}/employees/${a.id}`, { permissions: ["team:expenses"] }, tok);
  check("team:expenses gesaneerd bewaard", (grant.data.user.permissions || []).includes("team:expenses"), JSON.stringify(grant.data.user.permissions));

  const teamList = await j("GET", `/api/tenants/${tid}/expenses`, null, a.token);
  const names = (teamList.data.expenses || []).map(e => e.description).sort();
  check("team-scope: A ziet A+B maar niet C", names.length === 2 && names.join(",").includes("Onkost A") && names.join(",").includes("Onkost B") && !names.join(",").includes("Onkost C"), names.join(" | "));

  // Escalatie-sanering: onbekend recht + admin-recht wordt gestript
  const esc = await j("PATCH", `/api/tenants/${tid}/employees/${a.id}`, { permissions: ["team:expenses", "settings", "billing", "team:bestaatniet"] }, tok);
  const perms = esc.data.user.permissions || [];
  check("escalatie gestript (geen settings/billing)", !perms.includes("settings") && !perms.includes("billing") && !perms.some(p => p.includes("bestaatniet")), JSON.stringify(perms));

  // IDOR-fix: PATCH op een user van een ANDERE tenant → 404
  const foreign = await j("PATCH", `/api/tenants/${tid}/employees/u_super`, { name: "gehackt" }, tok);
  check("cross-tenant/admin-target → 404/403", foreign.status === 404 || foreign.status === 403, foreign.status);

  // Redactie h8.2: admin zet kostvelden; manager-achtige (A met employees-recht? nee) ·
  // check via admin (ziet veld) vs medewerker B (geen employees-recht → 403 op lijst).
  await j("PATCH", `/api/tenants/${tid}/employees/${b.id}`, { hourlyRate: 42, costRate: 30 }, tok);
  const adminView = await j("GET", `/api/tenants/${tid}/employees`, null, tok);
  const bRowAdmin = (adminView.data.employees || []).find(u => u.id === b.id);
  check("admin ziet hourlyRate", bRowAdmin && bRowAdmin.hourlyRate === 42);

  // Maak A manager (baseline bevat employees-recht) · manager is geen beheerder
  // en mag dus GEEN kostvelden zien.
  await j("PATCH", `/api/tenants/${tid}/employees/${a.id}`, { role: "manager", permissions: ["team:expenses"] }, tok);
  const loginA2 = await j("POST", "/api/auth/login", { email: "pa@t.be", password: "Sterk2026!Wachtwoord" });
  const empView = await j("GET", `/api/tenants/${tid}/employees`, null, loginA2.data.token);
  if (empView.status === 200) {
    const bRow = (empView.data.employees || []).find(u => u.id === b.id);
    check("manager ziet GEEN kostvelden (h8.2)", bRow && bRow.hourlyRate === undefined && bRow.costRate === undefined, JSON.stringify({ hr: bRow && bRow.hourlyRate }));
    check("manager ziet wel de naam", bRow && bRow.name === "Ploeglid B");
  } else {
    check("employees-lijst voor manager A bereikbaar", false, empView.status);
  }

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
