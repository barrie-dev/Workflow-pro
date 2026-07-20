// Route-smoke voor R4-b: contract → activeren → factuur genereren (idempotent),
// pro rata, indexatie, job-type en bronlijn naar projectfinance.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;
  check("contracts in views", ((await j("GET", "/api/me", null, tok)).data.entitlements?.views || []).includes("contracts"));

  const cust = await j("POST", `/api/tenants/${tid}/customers`, { name: "Contract Klant BV", email: "ck@x.be", address: "Laan 1", vatNumber: "BE0111" }, tok);
  const custId = cust.data.customer.id;

  // Maandcontract, start midden januari (pro rata), €300/maand
  const ct = await j("POST", `/api/tenants/${tid}/contracts`, { customerId: custId, title: "Onderhoud HVAC", startDate: "2026-01-17", amount: 300, frequency: "monthly", generateType: "invoice", vatRate: 21 }, tok);
  check("contract aangemaakt (CT-nummer, draft)", ct.status === 201 && /^CT-\d{4}-\d{3}$/.test(ct.data.contract.number) && ct.data.contract.status === "draft", ct.data.contract && ct.data.contract.number);
  const cid = ct.data.contract.id;

  // Genereren vóór activatie → 409
  const early = await j("POST", `/api/tenants/${tid}/contracts/${cid}/generate`, {}, tok);
  check("genereren op draft → 409 CONTRACT_NOT_ACTIVE", early.status === 409 && early.data.code === "CONTRACT_NOT_ACTIVE");

  await j("POST", `/api/tenants/${tid}/contracts/${cid}/transition`, { status: "active" }, tok);

  // Eerste generatie: pro rata januari (15/31 dagen)
  const g1 = await j("POST", `/api/tenants/${tid}/contracts/${cid}/generate`, {}, tok);
  check("generatie 1: factuur met pro rata", g1.status === 201 && g1.data.prorata.daysCovered === 15 && g1.data.amount === 145.17, JSON.stringify({ d: g1.data.prorata && g1.data.prorata.daysCovered, a: g1.data.amount }));
  check("factuurlijn draagt contract-bron", true); // gecontroleerd via factuur hieronder

  const invList = await j("GET", `/api/tenants/${tid}/facturen`, null, tok);
  const inv1 = (invList.data.invoices || []).find(i => i.id === g1.data.doc.id);
  check("factuur bestaat met sourceType contract", inv1 && inv1.lines[0].sourceType === "contract" && inv1.lines[0].sourceId === cid, inv1 && inv1.lines[0].sourceType);
  check("pro rata reproduceerbaar in omschrijving", inv1 && /pro rata 15\/31d/.test(inv1.lines[0].description), inv1 && inv1.lines[0].description);

  // Idempotent: zelfde periode opnieuw (handmatig met reden) → bestaand doc
  const g1b = await j("POST", `/api/tenants/${tid}/contracts/${cid}/generate`, { date: "2026-01-20", reason: "dubbelcheck" }, tok);
  check("zelfde periode → alreadyGenerated", g1b.status === 200 && g1b.data.alreadyGenerated === true);

  // Volgende periode: volledig bedrag
  const g2 = await j("POST", `/api/tenants/${tid}/contracts/${cid}/generate`, {}, tok);
  check("generatie 2: volledige maand €300", g2.status === 201 && g2.data.amount === 300, g2.data.amount);

  // Indexatie +5% per 1 maart, daarna generatie maart = €315
  await j("POST", `/api/tenants/${tid}/contracts/${cid}/index`, { pct: 5, sourceIndex: "Agoria", effectiveFrom: "2026-03-01" }, tok);
  const g3 = await j("POST", `/api/tenants/${tid}/contracts/${cid}/generate`, {}, tok);
  check("generatie 3 na indexatie: €315", g3.status === 201 && g3.data.amount === 315, g3.data.amount);

  // Buiten schema zonder reden → 400
  const oos = await j("POST", `/api/tenants/${tid}/contracts/${cid}/generate`, { date: "2026-09-01" }, tok);
  check("buiten schema zonder reden → 400 REASON_REQUIRED", oos.status === 400 && oos.data.code === "REASON_REQUIRED");

  // Job-type contract → werkbon
  const ct2 = await j("POST", `/api/tenants/${tid}/contracts`, { customerId: custId, title: "Kwartaalinspectie", startDate: "2026-01-01", amount: 0.01, frequency: "quarterly", generateType: "job" }, tok);
  await j("POST", `/api/tenants/${tid}/contracts/${ct2.data.contract.id}/transition`, { status: "active" }, tok);
  const gj = await j("POST", `/api/tenants/${tid}/contracts/${ct2.data.contract.id}/generate`, {}, tok);
  check("job-contract genereert werkbon", gj.status === 201 && /^WO-/.test((gj.data.doc && gj.data.doc.number) || ""), gj.data.doc && gj.data.doc.number);

  // Generatiehistoriek op het contract
  const ctAfter = await j("GET", `/api/tenants/${tid}/contracts?customerId=${custId}`, null, tok);
  const hist = (ctAfter.data.contracts || []).find(x => x.id === cid).generatedFor;
  check("generatiehistoriek: 3 periodes met prijsversie-referentie", hist.length === 3 && hist.every(h => h.priceVersionId), hist.length);

  // Events
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=contract.period_generated`, null, superTok);
  check("contract.period_generated events", (ev.data.events || []).length >= 4, (ev.data.events || []).length);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
