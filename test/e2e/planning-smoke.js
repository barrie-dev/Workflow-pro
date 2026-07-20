// Route-smoke voor R1-c: unified planning-tijdlijn, multi-resource shift + overlap.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function activeEmp(tok, tid, name, email) {
  const c = await j("POST", `/api/tenants/${tid}/employees`, { name, email }, tok);
  const token = decodeURIComponent((c.data.activationLink || "").split("activate=")[1] || "");
  await j("POST", "/api/auth/activate", { token, password: "Sterk2026!Wachtwoord" });
  return c.data.user.id;
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  const u1 = await activeEmp(tok, tid, "Tech A", "ta@t.be");
  const u2 = await activeEmp(tok, tid, "Tech B", "tb@t.be");
  const dag = "2026-08-10";

  // Multi-resource shift: u1 (primair) + u2 (assignee)
  const s1 = await j("POST", `/api/tenants/${tid}/planning`, { userId: u1, assigneeIds: [u2], date: dag, start: "08:00", end: "12:00", note: "Montage" }, tok);
  check("multi-resource shift aangemaakt", s1.status === 201 && s1.data.shift.assigneeIds.includes(u2), s1.data.shift && JSON.stringify(s1.data.shift.assigneeIds));

  // Afspraak dezelfde dag (klantgericht, geen resource)
  const apt = await j("POST", `/api/tenants/${tid}/appointments`, { customerName: "Klant X", date: dag, start: "14:00", end: "15:00", reminderDays: 0 }, tok);
  check("afspraak aangemaakt", apt.status === 201);

  // Unified tijdlijn bevat beide, gesorteerd
  const uni = await j("GET", `/api/tenants/${tid}/planning/unified?from=${dag}&to=${dag}`, null, tok);
  const sources = (uni.data.items || []).map(i => i.source);
  check("unified toont shift + afspraak", uni.status === 200 && sources.includes("shift") && sources.includes("appointment"), sources.join(","));
  const shiftItem = (uni.data.items || []).find(i => i.source === "shift");
  check("shift-item toont beide resources + jobId-veld", shiftItem && shiftItem.resourceIds.length === 2, shiftItem && shiftItem.resourceIds.length);

  // Overlap: u2 is al toegewezen 08-12 → nieuwe shift 10-14 voor u2 → 409
  const conflict = await j("POST", `/api/tenants/${tid}/planning`, { userId: u2, date: dag, start: "10:00", end: "14:00" }, tok);
  check("overlap op assignee → 409 SHIFT_OVERLAP", conflict.status === 409 && conflict.data.code === "SHIFT_OVERLAP", conflict.data.error);

  // Aansluitend (12-14) voor u2 → mag
  const ok2 = await j("POST", `/api/tenants/${tid}/planning`, { userId: u2, date: dag, start: "12:00", end: "14:00" }, tok);
  check("aansluitende shift → 201", ok2.status === 201, ok2.data.error);

  // Filter op resource
  const uniU1 = await j("GET", `/api/tenants/${tid}/planning/unified?resourceId=${u1}`, null, tok);
  check("filter op resource u1", (uniU1.data.items || []).every(i => i.resourceIds.includes(u1)) && (uniU1.data.items || []).length >= 1, (uniU1.data.items || []).length);

  // Event
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=planning.item_created`, null, superTok);
  check("planning.item_created events", (ev.data.events || []).length >= 2, (ev.data.events || []).length);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
