// Route-smoke voor R6: Robaws-import validatie → run → idempotent + blokkering.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const DATA = () => ({
  customers: [{ externalId: "R-C1", name: "Bouw NV", vat: "BE0123456789", email: "info@bouw.be" }],
  suppliers: [{ externalId: "R-S1", name: "Groothandel", vat: "BE0222333444" }],
  articles: [{ externalId: "R-A1", name: "Buis 32mm", sku: "B32", unitPrice: 12 }],
  invoices: [{ externalId: "R-I1", number: "2025-050", customerExternalId: "R-C1", total: 1210, finalized: true, paid: true }],
});

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // Validatie (dry-run)
  const val = await j("POST", `/api/tenants/${tid}/import/robaws/validate`, { data: DATA() }, tok);
  check("validatie 200 ok=true", val.status === 200 && val.data.validation.ok === true && val.data.validation.summary.customers.willCreate === 1, JSON.stringify(val.data.validation && val.data.validation.summary && val.data.validation.summary.customers));

  // Blokkerende import wordt geweigerd (dubbel id)
  const badRun = await j("POST", `/api/tenants/${tid}/import/robaws/run`, { data: { customers: [{ externalId: "X", name: "A" }, { externalId: "X", name: "B" }] } }, tok);
  check("blokkerende import → 422 IMPORT_INVALID", badRun.status === 422 && badRun.data.code === "IMPORT_INVALID");

  // Echte import
  const run1 = await j("POST", `/api/tenants/${tid}/import/robaws/run`, { data: DATA() }, tok);
  check("import created 4 (klant/leverancier/artikel/factuur-snapshot)", run1.status === 201 && run1.data.report.totals.created === 4, run1.data.report && run1.data.report.totals && run1.data.report.totals.created);

  // Klant nu zichtbaar in CRM met externalId
  const custs = await j("GET", `/api/tenants/${tid}/customers`, null, tok);
  const c1 = (custs.data.customers || []).find(c => c.externalIds && c.externalIds.robaws === "R-C1");
  check("geïmporteerde klant in CRM met external_id", !!c1, c1 && c1.name);

  // Factuur-snapshot is niet bewerkbaar
  const invs = await j("GET", `/api/tenants/${tid}/facturen`, null, tok);
  const snap = (invs.data.invoices || []).find(i => i.externalIds && i.externalIds.robaws === "R-I1");
  check("historische factuur = externe snapshot, gelinkt aan klant", snap && snap.docType === "external_snapshot" && snap.editable === false && snap.customerId === (c1 && c1.id), snap && snap.docType);

  // Idempotent: tweede run skipt alles
  const run2 = await j("POST", `/api/tenants/${tid}/import/robaws/run`, { data: DATA() }, tok);
  check("tweede run: 0 created, alles skipped", run2.data.report.totals.created === 0 && run2.data.report.totals.skipped === 4, JSON.stringify(run2.data.report.totals));

  // Geen duplicaten
  const custs2 = await j("GET", `/api/tenants/${tid}/customers`, null, tok);
  check("geen duplicaat-klant na tweede run", (custs2.data.customers || []).filter(c => c.externalIds && c.externalIds.robaws === "R-C1").length === 1);

  // Events
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=import.completed`, null, superTok);
  check("import.completed event", (ev.data.events || []).length >= 2);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
