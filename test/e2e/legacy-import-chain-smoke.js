// ── CTO3-04 · scenario 9 als ÉÉN doorlopende keten ──────────────────────────
// Legacy-migratie → external IDs → attachment → operationeel record. Bewijst als
// één verhaal: idempotente import (tweede run wijzigt niets), GEEN dataverlies,
// correcte source_of_truth (historische factuur = onbewerkbare snapshot), een
// aan het geïmporteerde record gekoppeld document, plus negatieve autorisatie
// en audit. Alle IDs komen uit serverresponses.
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
  const t = decodeURIComponent((c.data.activationLink || "").split("activate=")[1] || "");
  await j("POST", "/api/auth/activate", { token: t, password: "Sterk2026!Wachtwoord" });
  return (await j("POST", "/api/auth/login", { email, password: "Sterk2026!Wachtwoord" })).data.token;
}
const DATA = () => ({
  customers: [{ externalId: "R-C1", name: "Legacy Bouw NV", vat: "BE0123456789", email: "info@legacy.be" }],
  suppliers: [{ externalId: "R-S1", name: "Legacy Groothandel", vat: "BE0222333444" }],
  articles: [{ externalId: "R-A1", name: "Buis 32mm", sku: "B32", unitPrice: 12 }],
  invoices: [{ externalId: "R-I1", number: "2025-050", customerExternalId: "R-C1", total: 1210, finalized: true, paid: true }],
});

(async () => {
  const tok = (await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" })).data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // ── 1. Validatie (dry-run) → ok ─────────────────────────────────────────────
  const val = await j("POST", `/api/tenants/${tid}/import/robaws/validate`, { data: DATA() }, tok);
  check("1· validatie ok=true", val.status === 200 && val.data.validation.ok === true, val.status);

  // ── 2. Import → 4 records aangemaakt (klant/leverancier/artikel/snapshot) ────
  const run1 = await j("POST", `/api/tenants/${tid}/import/robaws/run`, { data: DATA() }, tok);
  check("2· import created 4", run1.status === 201 && run1.data.report.totals.created === 4, run1.data.report && run1.data.report.totals && run1.data.report.totals.created);

  // ── 3. EXTERNAL IDS: klant zichtbaar in CRM met robaws-external-id ───────────
  const custs = await j("GET", `/api/tenants/${tid}/customers`, null, tok);
  const c1 = (custs.data.customers || []).find(c => c.externalIds && c.externalIds.robaws === "R-C1");
  check("3· klant met external_id robaws=R-C1", !!c1, c1 && c1.name);

  // ── 4. SOURCE_OF_TRUTH: historische factuur = onbewerkbare externe snapshot ─
  const invs = await j("GET", `/api/tenants/${tid}/facturen`, null, tok);
  const snap = (invs.data.invoices || []).find(i => i.externalIds && i.externalIds.robaws === "R-I1");
  check("4· factuur-snapshot: external_snapshot, niet bewerkbaar, gelinkt aan klant", snap && snap.docType === "external_snapshot" && snap.editable === false && snap.customerId === (c1 && c1.id), snap && snap.docType);

  // ── 5. ATTACHMENT aan het geïmporteerde operationele record ─────────────────
  const content = Buffer.from("Origineel legacy-contract voor R-C1").toString("base64");
  const att = await j("POST", `/api/tenants/${tid}/docfiles`, {
    name: "legacy-contract.txt", mimeType: "text/plain", content, encoding: "base64",
    context: { entityType: "customer", entityId: c1.id },
  }, tok);
  check("5a· document geüpload en gekoppeld", att.status === 201 && !!att.data.file.id, att.status);
  const linked = await j("GET", `/api/tenants/${tid}/docfiles?entityType=customer&entityId=${c1.id}`, null, tok);
  check("5b· attachment gekoppeld aan de geïmporteerde klant", (linked.data.files || []).some(f => f.id === att.data.file.id), (linked.data.files || []).length);
  const dl = await j("POST", `/api/tenants/${tid}/docfiles/${att.data.file.id}/download`, {}, tok);
  check("5c· attachment leverbaar via ondertekende URL (roundtrip)", dl.status === 200 && (!!dl.data.url || !!dl.data.storageRef), dl.status);

  // ── 6. IDEMPOTENT: tweede run wijzigt niets · GEEN dataverlies ───────────────
  const run2 = await j("POST", `/api/tenants/${tid}/import/robaws/run`, { data: DATA() }, tok);
  check("6a· tweede run: 0 created, 4 skipped", run2.data.report.totals.created === 0 && run2.data.report.totals.skipped === 4, JSON.stringify(run2.data.report.totals));
  const custs2 = await j("GET", `/api/tenants/${tid}/customers`, null, tok);
  check("6b· geen duplicaat-klant", (custs2.data.customers || []).filter(c => c.externalIds && c.externalIds.robaws === "R-C1").length === 1);
  const linked2 = await j("GET", `/api/tenants/${tid}/docfiles?entityType=customer&entityId=${c1.id}`, null, tok);
  check("6c· attachment overleeft de herhaalde import (geen dataverlies)", (linked2.data.files || []).some(f => f.id === att.data.file.id));

  // ── 7. NEGATIEVE AUTORISATIE: medewerker mag niet importeren ────────────────
  const empTok = await activeEmp(tok, tid, "Iris Import", "iris.imp@x.be");
  const denied = await j("POST", `/api/tenants/${tid}/import/robaws/run`, { data: DATA() }, empTok);
  check("7· medewerker zonder recht → import geweigerd (403)", denied.status === 403, denied.status);

  // ── 8. AUDIT: import.completed geregistreerd ────────────────────────────────
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=import.completed`, null, superTok);
  check("8· audit: import.completed", (ev.data.events || []).length >= 1, (ev.data.events || []).length);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
