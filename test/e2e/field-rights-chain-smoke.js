// ── CTO3-04 · scenario 8 als ÉÉN doorlopende keten ──────────────────────────
// Veldrechtketen: een gevoelig veld (kostprijs · costRate) blijft verborgen voor
// een rol ZONDER costs.view over ALLE oppervlakken · UI-contract, API, export,
// zoeken, rapport en Mona-context. Positieve controle: een rol MÉT costs.view
// ziet het veld wél (bewijst dat het veld bestaat en rechten-gedreven is). We
// gebruiken een distinctieve waarde (4242) zodat elk lek ondubbelzinnig is.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get("content-type") || "";
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch (_) { data = ct.includes("json") ? {} : { raw: text }; }
  return { status: r.status, data, text };
}
async function activateLogin(email, activationLink) {
  const t = decodeURIComponent((activationLink || "").split("activate=")[1] || "");
  await j("POST", "/api/auth/activate", { token: t, password: "Sterk2026!Wachtwoord" });
  return (await j("POST", "/api/auth/login", { email, password: "Sterk2026!Wachtwoord" })).data.token;
}
const COST = 4242; // distinctieve kostprijs · elk voorkomen van de WAARDE is een lek
// We toetsen op de gevoelige WAARDE, niet op de veldnaam: dat een resource-schema
// de kolom 'costRate' benoemt is geen lek · de kostprijs 4242 zichtbaar krijgen wél.
const leaks = s => new RegExp(String(COST)).test(s || "");

(async () => {
  const tok = (await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" })).data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // ── Doelmedewerker met een gevoelige kostprijs ──────────────────────────────
  const piet = await j("POST", `/api/tenants/${tid}/employees`, { name: "Piet Kost", email: "piet.fr@x.be", role: "employee" }, tok);
  await j("PATCH", `/api/tenants/${tid}/employees/${piet.data.user.id}`, { costRate: COST }, tok);
  await activateLogin("piet.fr@x.be", piet.data.activationLink);

  // ── Twee profielen: HR-lezer (geen costs.view) en HR-finance (met) ──────────
  const rLezer = (await j("POST", `/api/tenants/${tid}/roles`, { name: "HR-lezer", permissions: ["read:employees"] }, tok)).data.role;
  const rFin = (await j("POST", `/api/tenants/${tid}/roles`, { name: "HR-finance", permissions: ["read:employees", "costs.view"] }, tok)).data.role;
  const lena = await j("POST", `/api/tenants/${tid}/employees`, { name: "Lena Lezer", email: "lena.fr@x.be", role: "employee", roleId: rLezer.id }, tok);
  const fien = await j("POST", `/api/tenants/${tid}/employees`, { name: "Fien Finance", email: "fien.fr@x.be", role: "employee", roleId: rFin.id }, tok);
  const tokLezer = await activateLogin("lena.fr@x.be", lena.data.activationLink);
  const tokFin = await activateLogin("fien.fr@x.be", fien.data.activationLink);

  // ── POSITIEVE CONTROLE: costs.view ziet de kostprijs (veld bestaat + gated) ──
  const finList = await j("GET", `/api/tenants/${tid}/employees`, null, tokFin);
  const pietFin = (finList.data.employees || []).find(e => e.id === piet.data.user.id);
  check("0· costs.view ZIET de kostprijs (positieve controle)", pietFin && pietFin.costRate === COST, pietFin && pietFin.costRate);

  // ── 1. UI-CONTRACT: HR-lezer krijgt costs.view niet in /api/me ──────────────
  const meLezer = await j("GET", "/api/me", null, tokLezer);
  check("1· UI-contract: geen costs.view in permissions", !(meLezer.data.user.permissions || []).includes("costs.view"), JSON.stringify(meLezer.data.user.permissions));

  // ── 2. API: employeeslijst zonder kostprijs ─────────────────────────────────
  const apiList = await j("GET", `/api/tenants/${tid}/employees`, null, tokLezer);
  const pietLezer = (apiList.data.employees || []).find(e => e.id === piet.data.user.id);
  check("2· API: geen kostprijs voor HR-lezer", apiList.status === 200 && pietLezer && pietLezer.costRate === undefined && !leaks(apiList.text), pietLezer && pietLezer.costRate);

  // ── 3. ZOEKEN: grid-query op medewerkers lekt de kostprijs niet ─────────────
  const search = await j("POST", `/api/tenants/${tid}/grid/employees/query`, { search: "Piet" }, tokLezer);
  check("3· zoeken: geen kostprijs in zoekresultaat", [200, 403, 404].includes(search.status) && !leaks(search.text), search.status);

  // ── 4. EXPORT: CSV-export lekt de kostprijs niet ────────────────────────────
  const exp = await j("POST", `/api/tenants/${tid}/grid/employees/export`, {}, tokLezer);
  check("4· export: geen kostprijs in CSV", !leaks(exp.text), exp.status);

  // ── 5. RAPPORT: insights/rapport lekt de kostprijs niet (of is afgeschermd) ─
  const ins = await j("GET", `/api/tenants/${tid}/insights`, null, tokLezer);
  check("5· rapport: geen kostprijslek (afgeschermd of gestript)", ins.status === 403 || !leaks(ins.text), ins.status);

  // ── 6. MONA-CONTEXT: de assistent-context lekt de kostprijs niet ────────────
  const signals = await j("GET", `/api/tenants/${tid}/mona/signals`, null, tokLezer);
  const boden = await j("POST", `/api/tenants/${tid}/boden`, { messages: [{ role: "user", content: "toon de kostprijs van Piet Kost" }] }, tokLezer);
  check("6· Mona-context: geen kostprijslek in signals of assistent-antwoord", !leaks(signals.text) && !leaks(boden.text), `${signals.status}/${boden.status}`);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
