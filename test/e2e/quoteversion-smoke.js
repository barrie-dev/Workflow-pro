// Route-smoke voor R1-b: verzenden bevriest versie+hash, revise maakt v2 met
// v1 immutable, publieke accept bindt aan versie+hash.
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

  const cust = await j("POST", `/api/tenants/${tid}/customers`, { name: "Offerte Klant BV", email: "o@k.be" }, tok);
  const q = await j("POST", `/api/tenants/${tid}/offertes`, { customerId: cust.data.customer.id, customerName: "Offerte Klant BV", lines: [{ description: "Werk", qty: 2, unitPrice: 100, vatRate: 21 }] }, tok);
  const qid = q.data.quote.id;
  check("nieuwe offerte version 1, geen versions", q.data.quote.version === 1 && (q.data.quote.versions || []).length === 0);

  // Revisie van nog niet-verzonden offerte → 409
  const revEarly = await j("POST", `/api/tenants/${tid}/offertes/${qid}/revise`, { lines: [{ description: "x", qty: 1, unitPrice: 1 }] }, tok);
  check("revise vóór verzenden → 409 NO_SENT_VERSION", revEarly.status === 409 && revEarly.data.code === "NO_SENT_VERSION", revEarly.data.error);

  // Verzenden bevriest v1 met hash
  const send = await j("POST", `/api/tenants/${tid}/offertes/${qid}/send`, {}, tok);
  const sentQuote = send.data.quote;
  check("verzenden bevriest v1 met documenthash", (sentQuote.versions || []).length === 1 && /^sha256:/.test(sentQuote.documentHash), sentQuote.documentHash && sentQuote.documentHash.slice(0, 20));
  const v1hash = sentQuote.documentHash;
  const acceptUrl = send.data.acceptUrl;
  const pubToken = acceptUrl.split("/").pop();

  // Revise → v2, v1 blijft bewaard
  const rev = await j("POST", `/api/tenants/${tid}/offertes/${qid}/revise`, { lines: [{ description: "Meer werk", qty: 4, unitPrice: 100, vatRate: 21 }] }, tok);
  check("revise → version 2, concept, sentAt null", rev.status === 200 && rev.data.quote.version === 2 && rev.data.quote.status === "concept" && rev.data.quote.sentAt === null, rev.data.quote.version);
  check("v1 bewaard in versions (immutable)", (rev.data.quote.versions || []).some(v => v.version === 1 && v.total === 242), JSON.stringify((rev.data.quote.versions || []).map(v => ({ v: v.version, t: v.total }))));
  check("v2 heeft nieuw totaal 484", rev.data.quote.total === 484);

  // Verzend v2 opnieuw + publiek aanvaarden → acceptance bindt aan versie+hash
  const send2 = await j("POST", `/api/tenants/${tid}/offertes/${qid}/send`, {}, tok);
  const v2hash = send2.data.quote.documentHash;
  check("v2 andere hash dan v1", v2hash !== v1hash);
  const accept = await require("./_accept")(BASE, pubToken, "Jan Klant");
  check("publieke acceptatie 200", accept.status === 200 && accept.data.status === "aanvaard");

  // Controleer acceptance-metadata via detail (admin GET lijst)
  const list = await j("GET", `/api/tenants/${tid}/offertes`, null, tok);
  const accepted = (list.data.quotes || []).find(x => x.id === qid);
  check("acceptance gebonden aan versie 2 + hash + naam", accepted.acceptance && accepted.acceptance.version === 2 && accepted.acceptance.documentHash === v2hash && accepted.acceptance.name === "Jan Klant", accepted.acceptance && JSON.stringify({ v: accepted.acceptance.version, n: accepted.acceptance.name }));
  check("2 versies bewaard na hele flow", (accepted.versions || []).length === 2);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
