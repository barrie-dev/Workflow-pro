// Route-smoke · trial-to-paid conversietrechter (GTM-sprint 1).
// Bewijst de WIRING en de kritische veiligheidseigenschap end-to-end:
//  1. /api/me draagt de billing-status (tenant: object · superadmin: null);
//  2. de gegrandfatherde demo-tenant (geen trialEndsAt) wordt NOOIT geblokkeerd
//     en een echte schrijfactie slaagt · de gate mag geen vals-positief geven;
//  3. een verse self-signup krijgt de proefklok gestempeld (state "trial",
//     ~14 dagen over) · dit dicht de funnel-lek waardoor signups gratis-voor-
//     altijd bleven.
// De harde 402-blokkade zelf (na proef + respijt) is deterministische pure
// logica en volledig gedekt door test/billing-access.test.js · net zoals de
// migratie-smoke de groene reconciliatie aan de live-pg-tests overlaat.
const BASE = "http://localhost:" + (process.env.PORT || "4299");
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

(async () => {
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const adminTok = (await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" })).data.token;
  check("setup: superadmin + tenant-admin ingelogd", !!superTok && !!adminTok);

  // ── 1. billing-status op /api/me ─────────────────────────────────────────
  const meAdmin = await j("GET", "/api/me", null, adminTok);
  const billing = meAdmin.data.billing;
  check("me: tenant-admin krijgt een billing-object", !!billing && typeof billing === "object", JSON.stringify(billing));
  check("me: demo-tenant is niet betalend en niet geblokkeerd", billing && billing.converted === false && billing.writeBlocked === false, billing && billing.state);
  const tenantId = meAdmin.data.user && meAdmin.data.user.tenantId;

  const meSuper = await j("GET", "/api/me", null, superTok);
  check("me: superadmin heeft geen billing-status (n.v.t.)", meSuper.data.billing === null, JSON.stringify(meSuper.data.billing));

  // ── 2. Gate blokkeert de gegrandfatherde tenant NIET (geen vals-positief) ─
  const write = await j("POST", `/api/tenants/${tenantId}/customers`, { name: "Trial Gate Testklant", email: "gate@example.com" }, adminTok);
  check("gate: schrijven blijft werken voor tenant zonder deadline", write.status >= 200 && write.status < 300, write.status);

  // ── 3. Verse self-signup krijgt de proefklok ─────────────────────────────
  const plans = await j("GET", "/api/plans", null, null);
  const plan = (plans.data.plans || []).find(p => !p.custom);
  check("signup: registreerbaar plan gevonden", !!plan, plan && plan.key);

  const email = `trial.smoke.${superTok.slice(-6)}@example.com`;
  const reg = await j("POST", "/api/auth/register", { companyName: "Trial Smoke BV", name: "Test Baas", email, plan: plan && plan.key }, null);
  check("signup: registratie aangemaakt (201, pending)", reg.status === 201 && reg.data.pending === true, reg.status);
  const link = reg.data.activationLink || "";
  const token = (link.match(/[?&]activate=([^&]+)/) || [])[1];
  check("signup: activatielink met token teruggegeven", !!token);

  const act = await j("POST", "/api/auth/activate", { token: token ? decodeURIComponent(token) : "", password: "Demo2026!Strong" }, null);
  check("signup: account geactiveerd + auto-login", act.status === 200 && !!act.data.token, act.status);

  const meNew = await j("GET", "/api/me", null, act.data.token);
  const nb = meNew.data.billing;
  check("signup: proefklok gestempeld (state 'trial')", nb && nb.state === "trial", nb && nb.state);
  check("signup: ~14 dagen over, niet geblokkeerd", nb && nb.daysLeft >= 12 && nb.daysLeft <= 14 && nb.writeBlocked === false, nb && `daysLeft=${nb && nb.daysLeft}`);
  check("signup: trialEndsAt aanwezig", !!(nb && nb.trialEndsAt), nb && nb.trialEndsAt);

  console.log(failures ? `\n${failures} controle(s) faalden` : "\nTrial-conversie-smoke groen");
  exitSoft(failures ? 1 : 0);
})().catch(e => { console.error("SMOKE CRASH", e); exitSoft(1); });
