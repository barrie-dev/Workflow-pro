// ── CTO3-04 · scenario 6 als ÉÉN doorlopende keten ──────────────────────────
// Factuurnummering → UBL-reconciliatie → Peppol provider-fout → fix + retry →
// aflevering. Bewijst als één verhaal: ZELFDE factuur, GEEN dubbel nummer, en
// EXACT ÉÉN billable usage-event zodra de provider aanvaardt · een idempotente
// retry boekt geen tweede event. Plus negatieve autorisatie en teruglezing.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
  return { status: r.status, data, text };
}
function xml(x, tag) { return [...x.matchAll(new RegExp(`<cbc:${tag}[^>]*>([^<]+)</cbc:${tag}>`, "g"))].map(m => m[1]); }
async function activeEmp(tok, tid, name, email) {
  const c = await j("POST", `/api/tenants/${tid}/employees`, { name, email }, tok);
  const t = decodeURIComponent((c.data.activationLink || "").split("activate=")[1] || "");
  await j("POST", "/api/auth/activate", { token: t, password: "Sterk2026!Wachtwoord" });
  return (await j("POST", "/api/auth/login", { email, password: "Sterk2026!Wachtwoord" })).data.token;
}

(async () => {
  const tok = (await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" })).data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // ── 1. Leveranciersprofiel (verplicht voor Peppol) + factuur (nummering) ─────
  await j("POST", `/api/tenants/${tid}/onboarding`, { invoiceProfile: { vat: "BE0403170701", street: "Dorpstraat 1", zip: "9000", city: "Gent" } }, tok);
  const created = await j("POST", `/api/tenants/${tid}/facturen`, {
    customerName: "Peppol Klant NV",
    lines: [{ description: "Arbeid", qty: 3, unitPrice: 40.25, vatRate: 21 }, { description: "Materiaal", qty: 1, unitPrice: 250, vatRate: 6 }],
  }, tok);
  const inv = created.data.invoice;
  check("1· factuur met doorlopend nummer", created.status === 201 && !!inv.number, inv && inv.number);
  const number0 = inv.number, companyId = inv.companyId;

  // ── 2. UBL-reconciliatie: totalen sluiten op de factuur ─────────────────────
  const ubl = (await j("GET", `/api/tenants/${tid}/facturen/${inv.id}/ubl`, null, tok)).text;
  const f2 = n => Number(n).toFixed(2);
  check("2· UBL TaxExclusive == subtotaal en TaxInclusive == totaal", xml(ubl, "TaxExclusiveAmount")[0] === f2(inv.subtotal) && xml(ubl, "TaxInclusiveAmount")[0] === f2(inv.total), `${xml(ubl, "TaxExclusiveAmount")[0]}/${xml(ubl, "TaxInclusiveAmount")[0]}`);

  // ── 3. Owner-mode monargo activeren zodat provideracceptatie meetbaar wordt ──
  const act = await j("POST", `/api/tenants/${tid}/peppol/activate`, { companyId, mode: "monargo" }, tok);
  check("3· Peppol owner-mode = monargo actief", act.status === 200 && act.data.activation.mode === "monargo", act.status);

  // ── 4. PROVIDER-FOUT: klant-BTW ontbreekt → 400 met zichtbaar spoor ─────────
  const fail = await j("POST", `/api/tenants/${tid}/facturen/${inv.id}/peppol`, {}, tok);
  check("4a· verzending faalt op ontbrekend klant-BTW → 400", fail.status === 400, fail.status);
  let row = (await j("GET", `/api/tenants/${tid}/facturen`, null, tok)).data.invoices.find(i => i.id === inv.id);
  check("4b· foutstaat zichtbaar: error + poging 1", row.peppolStatus === "error" && row.peppolAttempts === 1, `${row.peppolStatus}/${row.peppolAttempts}`);

  // ── 5. Fix + RETRY → afgeleverd als poging 2 · ZELFDE nummer ────────────────
  await j("PATCH", `/api/tenants/${tid}/facturen/${inv.id}`, { customerVatNumber: "BE0417497106" }, tok);
  const retry = await j("POST", `/api/tenants/${tid}/facturen/${inv.id}/peppol`, {}, tok);
  check("5a· retry levert af als poging 2", retry.status === 200 && retry.data.status === "delivered" && retry.data.attempts === 2, JSON.stringify({ s: retry.data.status, a: retry.data.attempts }));
  row = (await j("GET", `/api/tenants/${tid}/facturen`, null, tok)).data.invoices.find(i => i.id === inv.id);
  check("5b· ZELFDE factuur, GEEN dubbel nummer", row.number === number0, `${number0} == ${row.number}`);

  // ── 6. EXACT ÉÉN billable usage-event zodra de provider aanvaardt ───────────
  const usage1 = await j("GET", `/api/tenants/${tid}/peppol/usage`, null, tok);
  check("6· exact één billable event na acceptatie", usage1.data.charged.count === 1, JSON.stringify(usage1.data.charged));

  // ── 7. IDEMPOTENTE RETRY boekt GEEN tweede event ────────────────────────────
  const again = await j("POST", `/api/tenants/${tid}/facturen/${inv.id}/peppol`, {}, tok);
  const usage2 = await j("GET", `/api/tenants/${tid}/peppol/usage`, null, tok);
  check("7· herhaalde verzending → nog steeds één billable event", again.status === 200 && usage2.data.charged.count === 1, `attempts=${again.data.attempts} count=${usage2.data.charged.count}`);

  // ── 8. NEGATIEVE AUTORISATIE: medewerker zonder facturatierecht → geweigerd ──
  const empTok = await activeEmp(tok, tid, "Sam Steun", "sam.peppol@x.be");
  const denied = await j("POST", `/api/tenants/${tid}/facturen/${inv.id}/peppol`, {}, empTok);
  check("8· medewerker zonder facturatierecht → 403", denied.status === 403, denied.status);

  // ── 9. AUDIT + duurzame teruglezing ─────────────────────────────────────────
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=invoice.created`, null, superTok);
  check("9· audit: invoice.created + factuur blijft delivered", (ev.data.events || []).length >= 1 && row.peppolStatus === "delivered" && /^PEPPOL-MOCK-/.test(row.peppolReference), `${(ev.data.events || []).length} · ${row.peppolStatus}`);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
