// ── CTO3-04 · scenario 7 als ÉÉN doorlopende keten ──────────────────────────
// Cross-tenant aanvalsmatrix: tenant A maakt echte records; tenant B (een via
// self-signup ECHT geprovisioneerde tweede tenant) probeert elk pad naar A's
// data · LEZEN, WIJZIGEN, EXPORTEREN, DOCUMENT/ATTACHMENT en TRANSITIONS. Elk
// pad geeft een GENERIEKE weigering (403/404) zonder ook maar iets van A te
// lekken, en A's data blijft ongewijzigd. Positieve controle: B mag wél in B.
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
const denied = s => s === 403 || s === 404; // generieke weigering · nooit 200

(async () => {
  // ── Tenant A (demobouw): echte records met server-gegenereerde IDs ──────────
  const tokA = (await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" })).data.token;
  const tidA = (await j("GET", "/api/me", null, tokA)).data.user.tenantId;
  const custA = (await j("POST", `/api/tenants/${tidA}/customers`, { name: "Geheime Klant A BV", email: "a@geheim.be" }, tokA)).data.customer;
  const invA = (await j("POST", `/api/tenants/${tidA}/facturen`, { customerName: "Geheime Klant A BV", lines: [{ description: "Vertrouwelijk", qty: 1, unitPrice: 999, vatRate: 21 }] }, tokA)).data.invoice;
  const woA = (await j("POST", `/api/tenants/${tidA}/workorders`, { title: "Werf A", date: "2026-09-10" }, tokA)).data.workorder;
  await j("POST", `/api/tenants/${tidA}/workorders/${woA.id}/submit`, {}, tokA);
  check("0· tenant A heeft klant + factuur + werkbon", !!(custA.id && invA.id && woA.id), `${custA.id ? "c" : "-"}${invA.id ? "i" : "-"}${woA.id ? "w" : "-"}`);

  // ── Tenant B: ECHT geprovisioneerd via self-signup ──────────────────────────
  const email = "attacker@tenantb.be";
  const reg = await j("POST", "/api/auth/register", { companyName: "Tenant B BV", email, name: "Bob B", plan: "starter" }, null);
  check("1· tenant B geprovisioneerd (self-signup)", reg.status === 201 && !!reg.data.activationLink, reg.status);
  const actToken = decodeURIComponent((reg.data.activationLink || "").split("activate=")[1] || "");
  await j("POST", "/api/auth/activate", { token: actToken, password: "Sterk2026!Wachtwoord" });
  const tokB = (await j("POST", "/api/auth/login", { email, password: "Sterk2026!Wachtwoord" })).data.token;
  const tidB = (await j("GET", "/api/me", null, tokB)).data.user.tenantId;
  check("2· B is een ANDERE tenant dan A", !!tidB && tidB !== tidA, `${tidB} != ${tidA}`);

  // ── De aanvalsmatrix: B's token op A's tenant-gescopte routes ───────────────
  // LEZEN
  const read = await j("GET", `/api/tenants/${tidA}/customers`, null, tokB);
  check("3· LEZEN A's klanten → geweigerd, geen lek", denied(read.status) && !read.text.includes("Geheime Klant A"), `${read.status}`);
  // WIJZIGEN
  const modify = await j("PATCH", `/api/tenants/${tidA}/facturen/${invA.id}`, { notes: "overgenomen" }, tokB);
  check("4· WIJZIGEN A's factuur → geweigerd", denied(modify.status), modify.status);
  // EXPORTEREN
  const exp = await j("POST", `/api/tenants/${tidA}/grid/customers/export`, {}, tokB);
  check("5· EXPORTEREN A's klanten → geweigerd, geen lek", denied(exp.status) && !exp.text.includes("Geheime Klant A"), exp.status);
  // DOCUMENT/ATTACHMENT (UBL van A's factuur)
  const doc = await j("GET", `/api/tenants/${tidA}/facturen/${invA.id}/ubl`, null, tokB);
  check("6· DOCUMENT/attachment van A → geweigerd, geen UBL-lek", denied(doc.status) && !/<Invoice|cbc:/.test(doc.text), doc.status);
  // TRANSITIONS (werkbon-review + peppol-verzending)
  const trans1 = await j("POST", `/api/tenants/${tidA}/workorders/${woA.id}/review`, { decision: "approve" }, tokB);
  const trans2 = await j("POST", `/api/tenants/${tidA}/facturen/${invA.id}/peppol`, {}, tokB);
  check("7· TRANSITIONS op A (review + peppol) → geweigerd", denied(trans1.status) && denied(trans2.status), `${trans1.status}/${trans2.status}`);

  // ── Geen oracle: een BESTAAND en een ONBESTAAND A-ID geven dezelfde weigering ─
  const realId = await j("GET", `/api/tenants/${tidA}/facturen/${invA.id}`, null, tokB);
  const fakeId = await j("GET", `/api/tenants/${tidA}/facturen/onbestaand-id`, null, tokB);
  check("8· geen bestaan-oracle: zelfde weigering voor echt en nep-ID", denied(realId.status) && denied(fakeId.status), `${realId.status}/${fakeId.status}`);

  // ── A's data is ONGEWIJZIGD na alle pogingen (teruglezing als A) ─────────────
  const invAafter = (await j("GET", `/api/tenants/${tidA}/facturen`, null, tokA)).data.invoices.find(i => i.id === invA.id);
  check("9· A's factuur ongewijzigd (notes niet overschreven, geen verzending)", (invAafter.notes || "") !== "overgenomen" && invAafter.peppolStatus !== "delivered", `notes=${invAafter.notes || "-"}`);

  // ── Positieve controle: B mag WEL in de eigen tenant werken ─────────────────
  const ownB = await j("POST", `/api/tenants/${tidB}/customers`, { name: "Eigen klant B", email: "b@eigen.be" }, tokB);
  check("10· positieve controle: B mag in B's eigen tenant", ownB.status === 201, ownB.status);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
