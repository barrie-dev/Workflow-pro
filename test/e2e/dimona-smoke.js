// Dimona-REGISTRATIE + Publiato tegen de echte server. Het platform geeft
// NIETS aan bij de RSZ (het sociaal secretariaat doet de aangifte): hier
// wordt geregistreerd dat ze gebeurd is en bewaakt wat nog doorgegeven moet.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
// Zoek een INSZ dat de mod-97-controle haalt (validator = waarheid).
const { normalizeInsz, validInsz } = require("../../src/modules/ciaw");
function validTestInsz() {
  for (let c = 1; c <= 97; c++) {
    const k = "850730033" + String(c).padStart(2, "0");
    if (validInsz(normalizeInsz(k))) return k;
  }
  throw new Error("geen geldig test-INSZ");
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // RSZ-werkgeversnummer op de organisatie (voorwaarde voor elke aangifte).
  const rsz = await j("POST", `/api/tenants/${tid}/compliance/rsz`, { rszEmployerId: "123456789" }, tok);
  check("RSZ-werkgeversnummer gezet", rsz.status === 200 && rsz.data.rszEmployerId === "123456789", rsz.status);

  // ── Foute INSZ wordt aan de bron geweigerd ──
  const fout = await j("POST", `/api/tenants/${tid}/employee_records`, { name: "Foutieve Fiche", insz: "12345678901" }, tok);
  check("ongeldig INSZ → 400 INVALID_INSZ", fout.status === 400 && fout.data.code === "INVALID_INSZ", fout.data.code);

  // ── Fiche met geldig INSZ + dienstperiode ──
  const insz = validTestInsz();
  const emp = await j("POST", `/api/tenants/${tid}/employee_records`, { name: "Dimona Werker", insz, activeFrom: "2026-08-01" }, tok);
  check("personeelsfiche met INSZ aangemaakt", emp.status === 201 && emp.data.employee.insz === normalizeInsz(insz), emp.status);
  const empId = emp.data.employee.id;

  // ── Vóór registratie: het register signaleert het hiaat ──
  const voor = await j("GET", `/api/tenants/${tid}/dimona/declarations`, null, tok);
  check("hiaat gesignaleerd: geef door aan het sociaal secretariaat", (voor.data.gaps || []).some(g => g.employeeId === empId && /sociaal secretariaat/.test(g.reason)), JSON.stringify((voor.data.gaps || []).find(g => g.employeeId === empId)));

  // ── Registreren dat het secretariaat de Dimona-IN heeft gedaan ──
  const foutType = await j("POST", `/api/tenants/${tid}/employee_records/${empId}/dimona`, { type: "update" }, tok);
  check("ongeldig type → 400 INVALID_TYPE", foutType.status === 400 && foutType.data.code === "INVALID_TYPE", foutType.data.code);
  const decl = await j("POST", `/api/tenants/${tid}/employee_records/${empId}/dimona`, { type: "in", reference: "SSEC-2026-0042" }, tok);
  check("Dimona-registratie vastgelegd met referentie van het secretariaat", decl.status === 200 && decl.data.dimona.reference === "SSEC-2026-0042", JSON.stringify(decl.data.dimona || decl.data).slice(0, 120));
  check("registratie draagt de startdatum van de fiche", decl.data.dimona.date === "2026-08-01");

  // ── Register: hiaat weg, registratie zichtbaar ──
  const reg = await j("GET", `/api/tenants/${tid}/dimona/declarations`, null, tok);
  check("register opvraagbaar", reg.status === 200 && Array.isArray(reg.data.rows), reg.status);
  const rij = (reg.data.rows || []).find(r => r.employeeId === empId);
  check("medewerker geregistreerd in het register", !!rij && rij.registered === true && rij.reference === "SSEC-2026-0042", rij && rij.reference);
  check("hiaat verdwenen na registratie", !(reg.data.gaps || []).some(g => g.employeeId === empId));

  // ── Compliance-overzicht bevat de Dimona-categorie ──
  const comp = await j("GET", `/api/tenants/${tid}/compliance/overview`, null, tok);
  const cat = ((comp.data.overview || comp.data).categories || []).find(c => c.key === "dimona");
  check("compliance-overzicht heeft een Dimona-categorie", !!cat, (comp.data.overview || comp.data).categories && (comp.data.overview || comp.data).categories.map(c => c.key).join(","));

  // ── Publiato-dossier op een werkongeval ──
  const inc = await j("POST", `/api/tenants/${tid}/incidents`, {
    date: "2026-07-18", time: "10:30", employeeId: empId, employeeName: "Dimona Werker",
    location: "Werf Gent", severity: "ernstig", description: "Val van ladder tijdens dakwerk",
  }, tok);
  check("werkongeval geregistreerd", inc.status === 201, inc.status);
  const dossier = await j("GET", `/api/tenants/${tid}/incidents/${inc.data.incident.id}/publiato`, null, tok);
  check("Publiato-dossier opvraagbaar met deadline", dossier.status === 200 && dossier.data.deadline && dossier.data.deadline.deadline === "2026-07-26", dossier.data.deadline && dossier.data.deadline.deadline);
  check("dossier draagt slachtoffer + INSZ + ernst", dossier.data.dossier.slachtoffer.insz === normalizeInsz(insz) && dossier.data.dossier.ongeval.ernst === "ernstig" && dossier.data.dossier.status.ernstigOngeval === true);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
