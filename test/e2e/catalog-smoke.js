// Route-smoke E13: catalogus · artikel, prijsregels/prioriteit, resolve→lijn,
// samenstelling-kostopbouw, statusmodel, events.
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
  const me = await j("GET", "/api/me", null, tok);
  const tid = me.data.user.tenantId;
  check("catalog in views", (me.data.entitlements?.views || []).includes("catalog"), (me.data.entitlements?.views || []).includes("catalog"));

  // Klant voor klantspecifieke prijs
  const cust = await j("POST", `/api/tenants/${tid}/customers`, { name: "Prijs Klant BV", email: "pk@x.be" }, tok);
  const custId = cust.data.customer.id;

  // Artikel: kost/verkoop apart
  const art = await j("POST", `/api/tenants/${tid}/articles`, { name: "Stopcontact", unit: "st", costPrice: 3, salesPrice: 8, vatRate: 21 }, tok);
  check("artikel aangemaakt (ART-nummer, draft)", art.status === 201 && /^ART-\d{4}$/.test(art.data.article.number) && art.data.article.status === "draft", art.data.article && art.data.article.number);
  const artId = art.data.article.id;

  // Prijsregels + prioriteit
  await j("POST", `/api/tenants/${tid}/price_rules`, { articleId: artId, scope: "all", price: 7 }, tok);
  await j("POST", `/api/tenants/${tid}/price_rules`, { articleId: artId, scope: "customer", customerId: custId, price: 6 }, tok);
  const rAll = await j("POST", `/api/tenants/${tid}/articles/${artId}/resolve`, { qty: 10 }, tok);
  check("resolve zonder klant → algemene prijsregel 7", rAll.data.line?.unitPrice === 7 && rAll.data.line?.priceSource === "price_rule", JSON.stringify({ p: rAll.data.line?.unitPrice, s: rAll.data.line?.priceSource }));
  check("resolve snapshot draagt kost + totaal + btw", rAll.data.line?.costPrice === 3 && rAll.data.line?.lineTotal === 70 && rAll.data.line?.vatRate === 21, JSON.stringify({ c: rAll.data.line?.costPrice, t: rAll.data.line?.lineTotal }));
  const rCust = await j("POST", `/api/tenants/${tid}/articles/${artId}/resolve`, { qty: 1, customerId: custId }, tok);
  check("resolve met klant → klantspecifiek 6", rCust.data.line?.unitPrice === 6 && rCust.data.line?.priceSource === "customer", rCust.data.line?.unitPrice);
  check("prijsbron + prijsdatum zichtbaar", !!rCust.data.line?.priceSource && !!rCust.data.line?.priceDate, rCust.data.line?.priceDate);

  // Stamprijs wijzigen mag bestaande snapshot niet raken (de eerder opgehaalde lijn is een kopie)
  const upd = await j("PATCH", `/api/tenants/${tid}/articles/${artId}`, { name: "Stopcontact", unit: "st", costPrice: 4, salesPrice: 9, vatRate: 21, expectedVersion: 1 }, tok);
  check("update met priceChanged-vlag + event", upd.status === 200 && upd.data.priceChanged === true, upd.data.priceChanged);

  // Samengesteld artikel → kostopbouw
  const kabel = await j("POST", `/api/tenants/${tid}/articles`, { name: "Kabel", unit: "m", costPrice: 2 }, tok);
  const set = await j("POST", `/api/tenants/${tid}/articles`, { name: "Set", type: "composite", composition: [ { articleId: kabel.data.article.id, qty: 5 }, { articleId: artId, qty: 2 } ] }, tok);
  const setDetail = await j("GET", `/api/tenants/${tid}/articles/${set.data.article.id}`, null, tok);
  check("samenstelling kostopbouw (5*2 + 2*4 = 18)", setDetail.data.costBuildup?.unitCost === 18, setDetail.data.costBuildup?.unitCost);

  // Statusmodel: activeren → uitfaseren → niet selecteerbaar
  await j("POST", `/api/tenants/${tid}/articles/${artId}/transition`, { status: "active" }, tok);
  await j("POST", `/api/tenants/${tid}/articles/${artId}/transition`, { status: "phased_out" }, tok);
  const selectable = await j("GET", `/api/tenants/${tid}/articles?selectable=1`, null, tok);
  check("uitgefaseerd niet in selecteerbare lijst", !(selectable.data.articles || []).some(a => a.id === artId));
  const all = await j("GET", `/api/tenants/${tid}/articles`, null, tok);
  check("uitgefaseerd wel in gewone lijst", (all.data.articles || []).some(a => a.id === artId));

  // Optimistic locking
  const conflict = await j("PATCH", `/api/tenants/${tid}/articles/${artId}`, { name: "X", salesPrice: 5, expectedVersion: 1 }, tok);
  check("stale update → 409 VERSION_CONFLICT", conflict.status === 409 && conflict.data.code === "VERSION_CONFLICT", conflict.data.code);

  // Events
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=article.created`, null, superTok);
  check("article.created events", (ev.data.events || []).length >= 3, (ev.data.events || []).length);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
