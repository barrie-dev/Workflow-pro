// Route-smoke · Sociaal secretariaat: prestatie-export (GEEN RSZ-aangifte).
// Bewijst end-to-end: config zetten, werknemers + goedgekeurd verlof + INSZ,
// export (JSON + CSV-download), de waakhond (ontbrekend INSZ), en dat het
// enkel een OVERDRACHT is · Monargo geeft zelf niets aan bij de RSZ.
const BASE = "http://localhost:" + (process.env.PORT || "4299");
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token, raw) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return { status: r.status, text: await r.text(), ctype: r.headers.get("content-type") || "" };
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const INSZ_OK = "93051822361";
const month = new Date().toISOString().slice(0, 7);
const from = `${month}-01`, to = `${month}-28`;

(async () => {
  const tok = (await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" })).data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // 1) Config van het sociaal secretariaat zetten (aansluitingsnummer + provider).
  const cfg = await j("POST", `/api/tenants/${tid}/payroll/config`, { provider: "securex", affiliateNumber: "SEC-12345" }, tok);
  check("config: sociaal secretariaat ingesteld", cfg.status === 200 && cfg.data.readiness.provider === "securex", cfg.data.readiness && cfg.data.readiness.provider);
  check("config: melding dat Monargo zelf niet aangeeft", /geen RSZ-aangifte/i.test(cfg.data.readiness.note || ""), cfg.data.readiness && cfg.data.readiness.note);

  // 2) Bestaande actieve werknemers: Jan (krijgt INSZ + verlof), Sara (geen INSZ → waakhond).
  const janMe = await j("POST", "/api/auth/login", { email: "jan@demobouw.be", password: "Demo2026!" });
  const empTok = janMe.data.token;
  const emp1 = (await j("GET", "/api/me", null, empTok)).data.user;
  await j("PATCH", `/api/tenants/${tid}/employees/${emp1.id}`, { insz: INSZ_OK }, tok);

  // Jan vraagt verlof (2 dagen deze maand) · admin keurt goed.
  const lv = await j("POST", `/api/tenants/${tid}/me/leaves`, { startDate: `${month}-09`, endDate: `${month}-10`, type: "vakantie" }, empTok);
  const leaveId = lv.data.leave && lv.data.leave.id;
  const review = await j("POST", `/api/tenants/${tid}/leaves/${leaveId}/review`, { decision: "goedgekeurd" }, tok);
  check("setup: werknemer + goedgekeurd verlof", !!leaveId && review.data.leave && review.data.leave.status === "goedgekeurd", (lv.data.error || (review.data.leave && review.data.leave.status)));

  // 3) Prestatie-export (JSON) voor deze maand.
  const exp = await j("GET", `/api/tenants/${tid}/payroll/prestaties?from=${from}&to=${to}`, null, tok);
  check("export: endpoint levert de prestatiestaat", exp.status === 200 && exp.data.export && Array.isArray(exp.data.export.employees), exp.status);
  const data = exp.data.export;
  const e1 = data.employees.find(e => e.employeeId === emp1.id);
  check("export: werknemer met verlof verschijnt met verlofdagen", e1 && e1.leaveDays >= 1 && e1.inszValid === true, e1 && `${e1.leaveDays}d insz=${e1.inszValid}`);
  const leaveLine = e1 && e1.lines.find(l => l.key === "vakantie");
  check("export: verlof als dag-prestatielijn met code", !!leaveLine && leaveLine.unit === "days", leaveLine && leaveLine.code);

  // 4) Waakhond: een werknemer zonder INSZ (Sara) wordt gemeld, niet stil verzwegen.
  const e2 = data.employees.find(e => !e.inszValid);
  check("waakhond: ontbrekend/ongeldig INSZ gemeld", !!e2 && e2.warnings.some(w => /INSZ/i.test(w)), e2 && e2.name);

  // 5) CSV-download: content-type + koprij + INSZ in de body.
  const csv = await j("GET", `/api/tenants/${tid}/payroll/prestaties?from=${from}&to=${to}&format=csv`, null, tok, true);
  check("csv: download met csv-content-type", csv.status === 200 && /text\/csv/.test(csv.ctype), csv.ctype);
  check("csv: koprij + werknemer-INSZ aanwezig", /rsz_werkgever;aansluitingsnummer;insz/.test(csv.text) && csv.text.includes(INSZ_OK), csv.text.split("\n")[0]);

  // 6) Rechten: een gewone werknemer mag de prestatie-export NIET opvragen.
  const denied = await j("GET", `/api/tenants/${tid}/payroll/prestaties?from=${from}&to=${to}`, null, empTok);
  check("rechten: werknemer zonder personeelsrecht geweigerd", denied.status === 403, denied.status);

  console.log(failures ? `\n${failures} controle(s) faalden` : "\nPrestatie-export-smoke groen");
  exitSoft(failures ? 1 : 0);
})().catch(e => { console.error("SMOKE CRASH", e); exitSoft(1); });
