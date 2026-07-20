// h51 scenario 6 (mock-afdwingbaar deel): factuurnummering + reconciliatie
// factuur ⟷ UBL via de echte API, Peppol-fout met zichtbaar spoor, en een
// retry die aantoonbaar poging n+1 is en dan aflevert (mock-transport).
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
function xmlValues(xml, tag) {
  return [...xml.matchAll(new RegExp(`<cbc:${tag}[^>]*>([^<]+)</cbc:${tag}>`, "g"))].map(m => m[1]);
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // Leveranciersgegevens (KBO-profiel) · verplicht voor Peppol. Het BTW-nummer
  // moet de mod-97-controle halen; de onboarding-route gebruikt "zip".
  await j("POST", `/api/tenants/${tid}/onboarding`, { invoiceProfile: {
    vat: "BE0403170701", street: "Dorpstraat 1", zip: "9000", city: "Gent",
  } }, tok);

  // Factuur met gemengde btw-tarieven, klant-BTW bewust NOG NIET ingevuld.
  const created = await j("POST", `/api/tenants/${tid}/facturen`, {
    customerName: "Reconciliatie NV",
    lines: [
      { description: "Arbeid", qty: 3, unitPrice: 40.25, vatRate: 21 },
      { description: "Materiaal", qty: 1, unitPrice: 250, vatRate: 6 },
      { description: "Verplaatsing", qty: 2, unitPrice: 10, vatRate: 0 },
    ],
  }, tok);
  const inv = created.data.invoice;
  check("factuur aangemaakt met doorlopend nummer", created.status === 201 && !!inv.number, inv && inv.number);
  const som = (inv.lines || []).reduce((a, l) => a + Number(l.lineSubtotal ?? l.total ?? 0), 0);
  check("som van de regels == subtotaal (bron == aggregaat)", Math.round(som * 100) === Math.round(inv.subtotal * 100), `${som} vs ${inv.subtotal}`);

  // ── Reconciliatie factuur ⟷ UBL ──
  const ubl = (await j("GET", `/api/tenants/${tid}/facturen/${inv.id}/ubl`, null, tok)).text;
  const f2 = n => Number(n).toFixed(2);
  check("UBL TaxExclusiveAmount == subtotaal", xmlValues(ubl, "TaxExclusiveAmount")[0] === f2(inv.subtotal), xmlValues(ubl, "TaxExclusiveAmount")[0] + " vs " + f2(inv.subtotal));
  check("UBL TaxInclusiveAmount == totaal", xmlValues(ubl, "TaxInclusiveAmount")[0] === f2(inv.total));
  check("UBL TaxTotal == btw-bedrag", xmlValues(ubl, "TaxAmount")[0] === f2(inv.vatAmount), xmlValues(ubl, "TaxAmount")[0] + " vs " + f2(inv.vatAmount));
  const subTax = xmlValues(ubl, "TaxAmount").slice(1).reduce((a, b) => a + Number(b), 0);
  check("som TaxSubtotals == TaxTotal (per tarief sluitend)", Math.round(subTax * 100) === Math.round(Number(inv.vatAmount) * 100), subTax);
  check("UBL bevat 3 factuurregels", (ubl.match(/<cac:InvoiceLine>/g) || []).length === 3);
  check("gestructureerde mededeling reist mee als PaymentID", ubl.includes(inv.structuredComm), inv.structuredComm);

  // ── Preflight (h47): waarschuwt VOOR het verzenden, niet erna ──
  const pre = await j("GET", `/api/tenants/${tid}/facturen/${inv.id}/peppol/check`, null, tok);
  check("preflight toont validatiegebreken vooraf", pre.status === 200 && pre.data.validation.ok === false && pre.data.validation.errors.some(e => /BTW-nummer van de klant/.test(e)), pre.status);
  check("preflight meldt transport en deelnemerstatus", pre.data.readiness.mode === "mock" && pre.data.participant && pre.data.participant.mock === true, pre.data.readiness && pre.data.readiness.mode);

  // ── Peppol-fout: klant-BTW ontbreekt → 400 mét spoor op de factuur ──
  const fail1 = await j("POST", `/api/tenants/${tid}/facturen/${inv.id}/peppol`, {}, tok);
  check("verzending faalt op ontbrekend klant-BTW → 400", fail1.status === 400 && (fail1.data.errors || []).some(e => /BTW-nummer van de klant/.test(e)), fail1.status);
  let staat = (await j("GET", `/api/tenants/${tid}/facturen`, null, tok)).data.invoices.find(i => i.id === inv.id);
  check("foutstaat zichtbaar: peppolStatus error + poging 1", staat.peppolStatus === "error" && staat.peppolAttempts === 1 && /BTW/.test(staat.peppolError || ""), `${staat.peppolStatus}/${staat.peppolAttempts}`);

  // ── Fix + retry → afgeleverd (mock) als poging 2 ──
  await j("PATCH", `/api/tenants/${tid}/facturen/${inv.id}`, { customerVatNumber: "BE0417497106" }, tok);
  const retry = await j("POST", `/api/tenants/${tid}/facturen/${inv.id}/peppol`, {}, tok);
  check("retry levert af via mock-transport", retry.status === 200 && retry.data.status === "delivered" && retry.data.provider === "mock", JSON.stringify({ s: retry.status, st: retry.data.status }));
  check("retry is aantoonbaar poging 2", retry.data.attempts === 2, retry.data.attempts);
  staat = (await j("GET", `/api/tenants/${tid}/facturen`, null, tok)).data.invoices.find(i => i.id === inv.id);
  check("foutspoor gewist na succes, referentie bewaard", staat.peppolStatus === "delivered" && staat.peppolError === null && /^PEPPOL-MOCK-/.test(staat.peppolReference), staat.peppolReference);

  // De verzonden UBL is bevroren op de factuur en blijft reconcilieerbaar.
  const ublNa = (await j("GET", `/api/tenants/${tid}/facturen/${inv.id}/ubl`, null, tok)).text;
  check("bewaarde UBL draagt het klant-BTW-nummer en dezelfde totalen", ublNa.includes("BE0417497106") && xmlValues(ublNa, "PayableAmount")[0] === f2(inv.total));

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
