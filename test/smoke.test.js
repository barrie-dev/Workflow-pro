"use strict";
// HTTP smoke-test: boot de echte server (JSON-opslag, read-only checks).
// Vangt boot-time crashes (bad require, top-level throw, config-assert) die
// `node --check` niet ziet.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = Number(process.env.SMOKE_PORT || 4399);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

before(async () => {
  server = spawn(process.execPath, ["src/server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), STORAGE_ADAPTER: "json", REQUIRE_ADMIN_MFA: "false", NODE_ENV: "test", RELEASE_CHANNEL: "pilot", RATE_LIMIT_DISABLED: "true" },
    stdio: "pipe",
  });
  let bootLog = "";
  server.stderr.on("data", d => { bootLog += d.toString(); });
  server.stdout.on("data", d => { bootLog += d.toString(); });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch (_) {}
    if (server.exitCode !== null) throw new Error("server stopte tijdens boot:\n" + bootLog);
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error("server kwam niet op binnen 20s:\n" + bootLog);
});

after(() => { if (server && server.exitCode === null) server.kill(); });

test("health endpoint geeft ok", async () => {
  const d = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(d.ok, true);
  assert.ok(d.modules > 0, "modules geladen");
});

test("login pagina serveert HTML", async () => {
  const html = await (await fetch(`${BASE}/`)).text();
  assert.ok(html.includes("WorkFlow Pro"), "bevat app-naam");
  assert.ok(html.includes("loginForm"), "bevat loginformulier");
});

test("platform-scripts serveren met 200", async () => {
  for (const p of ["admin", "manager", "employee", "superadmin"]) {
    const r = await fetch(`${BASE}/js/platforms/${p}.js`);
    assert.equal(r.status, 200, `${p}.js moet 200 geven`);
  }
});

test("onbekende API-route geeft nette 404 JSON", async () => {
  const r = await fetch(`${BASE}/api/zzz-bestaat-niet`);
  assert.equal(r.status, 404);
  const d = await r.json();
  assert.equal(d.ok, false);
});

// ── Rechten: rollen mogen alleen hun eigen domein ──────────────
async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return r.json();
}

test("rechten: admin kan medewerkers lezen, employee niet", async () => {
  const admin = await login("admin@demobouw.be", "Demo2026!");
  assert.ok(admin.token, "admin-login moet slagen (reset-demo-passwords)");
  const okR = await fetch(`${BASE}/api/tenants/t_demo/employees`, { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(okR.status, 200, "admin → employees = 200");

  const emp = await login("jan@demobouw.be", "Demo2026!");
  assert.ok(emp.token, "employee-login moet slagen");
  const denyR = await fetch(`${BASE}/api/tenants/t_demo/employees`, { headers: { Authorization: `Bearer ${emp.token}` } });
  assert.equal(denyR.status, 403, "employee → employees = 403");
});

test("rechten: employee mag geen platform-admin endpoints", async () => {
  const emp = await login("jan@demobouw.be", "Demo2026!");
  const r = await fetch(`${BASE}/api/admin/stats`, { headers: { Authorization: `Bearer ${emp.token}` } });
  assert.equal(r.status, 403, "employee → /api/admin/stats = 403");
});

test("rechten: zonder token overal 401", async () => {
  const r = await fetch(`${BASE}/api/tenants/t_demo/facturen`);
  assert.equal(r.status, 401);
});

// ── Klantbril-QA: heldere, Nederlandse foutmeldingen ──
test("login met fout wachtwoord → 401 met Nederlandse melding", async () => {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@demobouw.be", password: "fout" }),
  });
  assert.equal(r.status, 401);
  const d = await r.json();
  assert.match(d.error, /wachtwoord/i, "melding is Nederlands en duidelijk");
  assert.doesNotMatch(d.error, /invalid credentials/i, "geen Engelse placeholder meer");
});

test("klok in → meteen uit (zelfde minuut) → 400 met behulpzame uitleg", async () => {
  const sara = await login("sara@demobouw.be", "Demo2026!");
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${sara.token}` };
  const inR = await fetch(`${BASE}/api/tenants/t_demo/me/clock/in`, { method: "POST", headers: H, body: "{}" });
  assert.ok(inR.status === 201 || inR.status === 409, "inklokken lukt of er was al een actieve klok");
  const outR = await fetch(`${BASE}/api/tenants/t_demo/me/clock/out`, { method: "POST", headers: H, body: "{}" });
  if (outR.status === 400) {
    const d = await outR.json();
    assert.match(d.error, /uitklokken kan pas/i, "contextuele klok-uit-melding i.p.v. cryptische 'Eindtijd moet na Starttijd'");
    assert.doesNotMatch(d.error, /Eindtijd moet na/i);
  } else {
    assert.equal(outR.status, 200, "anders een geldige uitklok (tijd is verstreken)");
  }
});

// ── Boden AI-assistent ──────────────────────────────────────────
test("boden: endpoint draait in mock-modus zonder key en vereist login", async () => {
  // Zonder token → 401
  const noAuth = await fetch(`${BASE}/api/tenants/t_demo/boden`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hallo" }] }),
  });
  assert.equal(noAuth.status, 401);

  const admin = await login("admin@demobouw.be", "Demo2026!");
  const r = await fetch(`${BASE}/api/tenants/t_demo/boden`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ messages: [{ role: "user", content: "Wat kan je voor mij doen?" }] }),
  });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.mock, true, "geen echte key → mock-modus");
  assert.ok(typeof d.reply === "string" && d.reply.length > 0, "Boden antwoordt");
});

// ── Belgische facturatie: afronding, gestructureerde mededeling, btw verlegd ──
test("factuur: cent-afronding + geldige gestructureerde mededeling", async () => {
  const admin = await login("admin@demobouw.be", "Demo2026!");
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}` };
  const r = await fetch(`${BASE}/api/tenants/t_demo/facturen`, {
    method: "POST", headers: H,
    body: JSON.stringify({ customerName: "Klant A", customerVatNumber: "BE0417497106", lines: [{ description: "Uren", qty: 3, unitPrice: 33.33, vatRate: 21 }] }),
  });
  assert.equal(r.status, 201);
  const inv = (await r.json()).invoice;
  assert.equal(inv.subtotal, 99.99);
  assert.equal(inv.vatAmount, 21);     // round2(99.99*0.21)
  assert.equal(inv.total, 120.99);
  assert.match(inv.structuredComm, /^\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+$/);
});

test("factuur: intracommunautair → btw verlegd (0%)", async () => {
  const admin = await login("admin@demobouw.be", "Demo2026!");
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}` };
  const r = await fetch(`${BASE}/api/tenants/t_demo/facturen`, {
    method: "POST", headers: H,
    body: JSON.stringify({ customerName: "EU Klant", customerVatNumber: "NL123456789B01", vatRegime: "intracom", lines: [{ description: "Dienst", qty: 1, unitPrice: 1000, vatRate: 21 }] }),
  });
  assert.equal(r.status, 201);
  const inv = (await r.json()).invoice;
  assert.equal(inv.vatRegime, "intracom");
  assert.equal(inv.vatAmount, 0, "geen btw bij verlegging");
  assert.equal(inv.total, 1000);
  assert.ok(/verlegd/i.test(inv.vatNote), "wettelijke vermelding aanwezig");
});

test("factuur: binnenlandse medecontractant → btw verlegd (0%, KB nr. 1 art. 20)", async () => {
  const admin = await login("admin@demobouw.be", "Demo2026!");
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}` };
  const r = await fetch(`${BASE}/api/tenants/t_demo/facturen`, {
    method: "POST", headers: H,
    body: JSON.stringify({ customerName: "BE Aannemer", customerVatNumber: "BE0417497106", vatRegime: "medecontractant", lines: [{ description: "Ruwbouw", qty: 1, unitPrice: 5000, vatRate: 21 }] }),
  });
  assert.equal(r.status, 201);
  const inv = (await r.json()).invoice;
  assert.equal(inv.vatRegime, "medecontractant");
  assert.equal(inv.vatAmount, 0);
  assert.ok(/medecontractant/i.test(inv.vatNote), "medecontractant-vermelding");
});

// ── Validatie: junk-data wordt geweigerd ────────────────────────
test("validatie: onkost met bedrag 0 of negatief → 400", async () => {
  const emp = await login("jan@demobouw.be", "Demo2026!");
  for (const amount of [0, -5, "abc"]) {
    const r = await fetch(`${BASE}/api/tenants/t_demo/me/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${emp.token}` },
      body: JSON.stringify({ amount, category: "test", description: "junk" }),
    });
    assert.equal(r.status, 400, `bedrag ${amount} moet 400 geven`);
  }
});

test("validatie: shift met eindtijd vóór starttijd → 400", async () => {
  const admin = await login("admin@demobouw.be", "Demo2026!");
  const r = await fetch(`${BASE}/api/tenants/t_demo/planning`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ userId: "u_emp1", date: "2027-01-04", start: "17:00", end: "08:00" }),
  });
  assert.equal(r.status, 400);
});

// ── Entitlements: module-gating per pakket ──────────────────────
test("entitlements: business-tenant heeft planning (200) maar niet integraties (403)", async () => {
  const admin = await login("admin@demobouw.be", "Demo2026!");
  // Positief: planning zit in business (generieke module-route serveert GET).
  const ok = await fetch(`${BASE}/api/modules/planning?tenantId=t_demo`, { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(ok.status, 200, "planning zit in business → 200");
  // Negatief: integraties niet in business → 403 op zowel module-route als dispatcher.
  const denyMod = await fetch(`${BASE}/api/modules/integrations?tenantId=t_demo`, { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(denyMod.status, 403, "integraties niet in business (module-route) → 403");
  assert.equal((await denyMod.json()).code, "module_disabled");
  const deny = await fetch(`${BASE}/api/tenants/t_demo/integrations`, { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(deny.status, 403, "integraties niet in business (dispatcher) → 403");
  assert.equal((await deny.json()).ok, false);
});

test("entitlements: /api/me geeft entitlements met views", async () => {
  const admin = await login("admin@demobouw.be", "Demo2026!");
  const d = await (await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${admin.token}` } })).json();
  assert.ok(d.entitlements, "me bevat entitlements");
  assert.ok(Array.isArray(d.entitlements.views) && d.entitlements.views.includes("dashboard"), "views bevat kern");
  assert.ok(d.entitlements.modules.includes("planning"));
});

test("entitlements: super-admin catalogus + bundels endpoints", async () => {
  const su = await login("super@workflowpro.be", "Demo2026!");
  assert.ok(su.token, "super-admin login moet slagen");
  const cat = await (await fetch(`${BASE}/api/admin/catalog`, { headers: { Authorization: `Bearer ${su.token}` } })).json();
  assert.ok(cat.modules.length > 0 && cat.core.length > 0, "catalogus geladen");
  const bun = await (await fetch(`${BASE}/api/admin/bundles`, { headers: { Authorization: `Bearer ${su.token}` } })).json();
  assert.ok(bun.bundles.some(b => b.key === "business"), "bundels bevatten business");
});

test("entitlements: super-admin omzeilt module-gating", async () => {
  const su = await login("super@workflowpro.be", "Demo2026!");
  const r = await fetch(`${BASE}/api/tenants/t_demo/integrations`, { headers: { Authorization: `Bearer ${su.token}` } });
  assert.equal(r.status, 200, "super-admin → integraties = 200 ondanks pakket");
});

// ── Per-user rechten: admin kan rechten zetten, server saneert escalatie ──
test("rechten per user: employees GET levert grantable lijst", async () => {
  const admin = await login("admin@demobouw.be", "Demo2026!");
  const d = await (await fetch(`${BASE}/api/tenants/t_demo/employees?includeInactive=true`, { headers: { Authorization: `Bearer ${admin.token}` } })).json();
  assert.ok(Array.isArray(d.grantable), "grantable aanwezig");
  const keys = d.grantable.map(g => g.key);
  assert.ok(keys.includes("planning") && keys.includes("customers"), "operationele modules toewijsbaar");
  for (const adminPerm of ["settings", "billing", "audit", "tenants", "employees"]) {
    assert.ok(!keys.includes(adminPerm), `${adminPerm} niet toewijsbaar`);
  }
});

test("superadmin: kan tenant-gebruiker rol toekennen + rechten inperken", async () => {
  const su = await login("super@workflowpro.be", "Demo2026!");
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  try {
    const r = await fetch(`${BASE}/api/admin/users/u_emp1`, { method: "PATCH", headers: H(su.token), body: JSON.stringify({ role: "manager", permissions: ["planning"] }) });
    assert.equal(r.status, 200);
    const u = (await r.json()).user;
    assert.equal(u.role, "manager", "rol toegekend");
    assert.ok(u.permissions.includes("planning"), "toegestaan recht bewaard");
    assert.ok(!u.permissions.includes("billing") && !u.permissions.includes("settings"), "admin-rechten niet toegekend");
  } finally {
    await fetch(`${BASE}/api/admin/users/u_emp1`, { method: "PATCH", headers: H(su.token), body: JSON.stringify({ role: "employee", permissions: ["planning"] }) });
  }
});

test("superadmin: kan tenant-gebruiker niet promoten tot super_admin", async () => {
  const su = await login("super@workflowpro.be", "Demo2026!");
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  const r = await fetch(`${BASE}/api/admin/users/u_emp1`, { method: "PATCH", headers: H(su.token), body: JSON.stringify({ role: "super_admin" }) });
  assert.equal(r.status, 400, "geen escalatie naar super_admin via /users");
});

test("audit F1: prijsloze bundel is 'op aanvraag' en niet kiesbaar", async () => {
  const su = await login("super@workflowpro.be", "Demo2026!");
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  await fetch(`${BASE}/api/admin/bundles`, { method: "POST", headers: H(su.token), body: JSON.stringify({ key: "auditpro", label: "Audit Pro", modules: ["planning"] }) });
  try {
    const admin = await login("admin@demobouw.be", "Demo2026!");
    const plans = (await (await fetch(`${BASE}/api/tenants/t_demo/billing/plans`, { headers: H(admin.token) })).json()).plans || [];
    const pro = plans.find(p => p.key === "auditpro");
    assert.ok(pro, "bundel verschijnt in catalogus");
    assert.equal(pro.custom, true, "prijsloze bundel = op aanvraag");
    assert.equal(pro.baseMonthly, null, "geen €0-prijs");
    // Niet zelf te kiezen → 400
    const sel = await fetch(`${BASE}/api/tenants/t_demo/billing/select-plan`, { method: "POST", headers: H(admin.token), body: JSON.stringify({ plan: "auditpro" }) });
    assert.equal(sel.status, 400, "prijsloze bundel niet kiesbaar");
  } finally {
    await fetch(`${BASE}/api/admin/bundles/auditpro`, { method: "DELETE", headers: H(su.token) });
  }
});

test("audit F2: peppol-submodule uit → 403 op verstuur-endpoint", async () => {
  const su = await login("super@workflowpro.be", "Demo2026!");
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  // invoices behouden maar peppol weglaten
  await fetch(`${BASE}/api/admin/tenants/t_demo/modules`, { method: "PATCH", headers: H(su.token), body: JSON.stringify({ submoduleOverrides: { invoices: ["reminders", "online-payment"] } }) });
  try {
    const admin = await login("admin@demobouw.be", "Demo2026!");
    const r = await fetch(`${BASE}/api/tenants/t_demo/facturen/any-id/peppol`, { method: "POST", headers: H(admin.token), body: "{}" });
    assert.equal(r.status, 403, "peppol uit → 403");
    assert.equal((await r.json()).code, "submodule_disabled");
  } finally {
    // herstel: terug naar bundeldefaults
    await fetch(`${BASE}/api/admin/tenants/t_demo/modules`, { method: "PATCH", headers: H(su.token), body: JSON.stringify({ submoduleOverrides: {} }) });
  }
});

test("rechten per user: PATCH saneert escalatie-poging", async () => {
  const admin = await login("admin@demobouw.be", "Demo2026!");
  const empId = "u_emp1"; // jan, employee in demo-data
  const r = await fetch(`${BASE}/api/tenants/t_demo/employees/${empId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ permissions: ["customers", "settings", "billing", "tenants", "*"] }),
  });
  assert.equal(r.status, 200);
  const perms = (r.ok && (await r.json()).user.permissions) || [];
  assert.ok(perms.includes("own:customers"), "toegestaan recht bewaard (own-scoped voor employee)");
  assert.ok(perms.includes("own:clockings"), "prikklok blijft altijd behouden, ook al niet aangevraagd");
  for (const bad of ["settings", "billing", "tenants", "*"]) {
    assert.ok(!perms.includes(bad), `escalatie '${bad}' geweerd`);
  }
});

// ── GDPR support-toegang: consent + impersonatie + sliding expiry ──
test("support: consent met auto-renew zet jaarlijkse review-datum", async () => {
  const admin = await login("admin@demobouw.be", "Demo2026!");
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  try {
    const r = await fetch(`${BASE}/api/tenants/t_demo/support-access`, { method: "POST", headers: H(admin.token), body: JSON.stringify({ allowed: true, autoRenew: true, reason: "test" }) });
    assert.equal(r.status, 200);
    const sa = (await r.json()).tenant.supportAccess;
    assert.equal(sa.autoRenew, true);
    assert.ok(sa.reviewDueAt, "jaarlijkse review-datum gezet");
    const days = (new Date(sa.reviewDueAt).getTime() - Date.now()) / 86400000;
    assert.ok(days > 360 && days < 370, `review ~1 jaar vooruit (was ${Math.round(days)} dagen)`);
  } finally {
    await fetch(`${BASE}/api/tenants/t_demo/support-access/end`, { method: "POST", headers: H(admin.token), body: "{}" });
  }
});

test("support: agent kan een specifieke medewerker overnemen, niet enkel de admin", async () => {
  const su = await login("super@workflowpro.be", "Demo2026!");
  const admin = await login("admin@demobouw.be", "Demo2026!");
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  try {
    await fetch(`${BASE}/api/tenants/t_demo/support-access`, { method: "POST", headers: H(admin.token), body: JSON.stringify({ allowed: true, reason: "per-user" }) });
    // Neem de medewerker (jan, u_emp1) over — niet de admin.
    const start = await fetch(`${BASE}/api/admin/support/start`, { method: "POST", headers: H(su.token), body: JSON.stringify({ tenantId: "t_demo", impersonatedUserId: "u_emp1", scope: "read", reason: "jan kan niet inklokken" }) });
    assert.equal(start.status, 200);
    const sd = await start.json();
    assert.equal(sd.session.impersonatedUserId, "u_emp1");
    const me = await (await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${sd.supportToken}` } })).json();
    assert.equal(me.user.role, "employee", "overgenomen sessie is de medewerker, niet de admin");
    assert.equal(me.user.email, "jan@demobouw.be");
  } finally {
    await fetch(`${BASE}/api/admin/support/end`, { method: "POST", headers: H(su.token), body: JSON.stringify({ tenantId: "t_demo" }) });
    await fetch(`${BASE}/api/tenants/t_demo/support-access/end`, { method: "POST", headers: H(admin.token), body: "{}" });
  }
});

test("support: gebruiker van een andere tenant kan niet overgenomen worden", async () => {
  const su = await login("super@workflowpro.be", "Demo2026!");
  const admin = await login("admin@demobouw.be", "Demo2026!");
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  try {
    await fetch(`${BASE}/api/tenants/t_demo/support-access`, { method: "POST", headers: H(admin.token), body: JSON.stringify({ allowed: true, reason: "cross-tenant" }) });
    const r = await fetch(`${BASE}/api/admin/support/start`, { method: "POST", headers: H(su.token), body: JSON.stringify({ tenantId: "t_demo", impersonatedUserId: "u_super", scope: "read", reason: "mag niet" }) });
    assert.equal(r.status, 404, "gebruiker buiten de tenant → geweigerd");
  } finally {
    await fetch(`${BASE}/api/tenants/t_demo/support-access/end`, { method: "POST", headers: H(admin.token), body: "{}" });
  }
});

// ── Platformteam: eigen support-medewerkers (super_admin) + god-bescherming ──
test("platformteam: god maakt medewerker, agent heeft super-rechten maar geen god-macht", async () => {
  const god = await login("super@workflowpro.be", "Demo2026!");
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  const email = `staff-test-${Date.now()}@workflowpro.be`;
  const pass = "AgentSterk2026!@#";
  const c = await fetch(`${BASE}/api/admin/staff`, { method: "POST", headers: H(god.token), body: JSON.stringify({ name: "Test Agent", email, password: pass }) });
  assert.equal(c.status, 201, "god kan teamlid aanmaken");
  const agent = await login(email, pass);
  assert.ok(agent.token, "nieuwe agent kan inloggen");
  // Volledige platform-/support-rechten
  assert.equal((await fetch(`${BASE}/api/admin/stats`, { headers: H(agent.token) })).status, 200);
  assert.equal((await fetch(`${BASE}/api/admin/support`, { headers: H(agent.token) })).status, 200);
  // Maar geen god-macht: geen teamleden beheren
  const noStaff = await fetch(`${BASE}/api/admin/staff`, { method: "POST", headers: H(agent.token), body: JSON.stringify({ name: "X", email: `x${Date.now()}@y.be`, password: pass }) });
  assert.equal(noStaff.status, 403, "agent mag geen teamlid aanmaken");
  // En de god is onaantastbaar
  const noKill = await fetch(`${BASE}/api/admin/users/u_super`, { method: "PATCH", headers: H(agent.token), body: JSON.stringify({ active: false }) });
  assert.equal(noKill.status, 403, "god kan niet gedeactiveerd worden");
});

test("platformteam: hoofd-superadmin (god) kan zelfs door zichzelf niet gedeactiveerd worden", async () => {
  const god = await login("super@workflowpro.be", "Demo2026!");
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  const viaStaff = await fetch(`${BASE}/api/admin/staff/u_super`, { method: "PATCH", headers: H(god.token), body: JSON.stringify({ active: false }) });
  assert.equal(viaStaff.status, 403, "god is beschermd via /staff");
  const viaUsers = await fetch(`${BASE}/api/admin/users/u_super`, { method: "PATCH", headers: H(god.token), body: JSON.stringify({ active: false }) });
  assert.equal(viaUsers.status, 403, "god is beschermd via /users");
});

test("support: zonder klant-consent kan super-admin geen sessie starten", async () => {
  const su = await login("super@workflowpro.be", "Demo2026!");
  const admin = await login("admin@demobouw.be", "Demo2026!");
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  // zorg dat consent uit staat
  await fetch(`${BASE}/api/tenants/t_demo/support-access/end`, { method: "POST", headers: H(admin.token), body: "{}" });
  const r = await fetch(`${BASE}/api/admin/support/start`, { method: "POST", headers: H(su.token), body: JSON.stringify({ tenantId: "t_demo", scope: "read", reason: "test" }) });
  assert.equal(r.status, 403, "geen consent → 403");
});

test("support: read-sessie neemt gebruiker over, leest wel, schrijft niet", async () => {
  const su = await login("super@workflowpro.be", "Demo2026!");
  const admin = await login("admin@demobouw.be", "Demo2026!");
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  try {
    // 1) klant geeft consent
    const consent = await fetch(`${BASE}/api/tenants/t_demo/support-access`, { method: "POST", headers: H(admin.token), body: JSON.stringify({ allowed: true, reason: "Klant vraagt hulp" }) });
    assert.equal(consent.status, 200);
    // 2) super-admin start read-sessie
    const start = await fetch(`${BASE}/api/admin/support/start`, { method: "POST", headers: H(su.token), body: JSON.stringify({ tenantId: "t_demo", scope: "read", reason: "Onderzoek facturatiebug" }) });
    assert.equal(start.status, 200, "consent aanwezig → start ok");
    const sd = await start.json();
    assert.ok(sd.supportToken, "support-token uitgereikt");
    assert.equal(sd.session.scope, "read");
    assert.ok(sd.session.expiresAt < sd.session.hardExpiresAt, "sliding < hard max");
    // 3) impersonatie: GET werkt + /me toont sessie-banner info
    const me = await (await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${sd.supportToken}` } })).json();
    assert.ok(me.supportSession && me.supportSession.active, "/me meldt actieve support-sessie (banner)");
    assert.equal(me.supportSession.scope, "read");
    const read = await fetch(`${BASE}/api/tenants/t_demo/facturen`, { headers: { Authorization: `Bearer ${sd.supportToken}` } });
    assert.equal(read.status, 200, "read-sessie mag lezen als overgenomen gebruiker");
    // 4) read-scope blokkeert schrijven
    const write = await fetch(`${BASE}/api/tenants/t_demo/facturen`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sd.supportToken}` }, body: JSON.stringify({ customerName: "X", lines: [{ description: "u", qty: 1, unitPrice: 1, vatRate: 21 }] }) });
    assert.equal(write.status, 403, "read-sessie mag niet schrijven");
    // 5) overzicht toont actieve sessie
    const ov = await (await fetch(`${BASE}/api/admin/support`, { headers: H(su.token) })).json();
    const row = ov.rows.find(r => r.tenantId === "t_demo");
    assert.ok(row && row.allowed && row.session, "overzicht toont consent + actieve sessie");
  } finally {
    await fetch(`${BASE}/api/admin/support/end`, { method: "POST", headers: H(su.token), body: JSON.stringify({ tenantId: "t_demo" }) });
    await fetch(`${BASE}/api/tenants/t_demo/support-access/end`, { method: "POST", headers: H(admin.token), body: "{}" });
  }
});

test("support: write-sessie mag schrijven, en consent intrekken stopt de sessie", async () => {
  const su = await login("super@workflowpro.be", "Demo2026!");
  const admin = await login("admin@demobouw.be", "Demo2026!");
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  await fetch(`${BASE}/api/tenants/t_demo/support-access`, { method: "POST", headers: H(admin.token), body: JSON.stringify({ allowed: true, reason: "Hulp bij planning" }) });
  const start = await fetch(`${BASE}/api/admin/support/start`, { method: "POST", headers: H(su.token), body: JSON.stringify({ tenantId: "t_demo", scope: "write", reason: "Planning herstellen" }) });
  const sd = await start.json();
  assert.equal(sd.session.scope, "write");
  const write = await fetch(`${BASE}/api/tenants/t_demo/planning`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sd.supportToken}` }, body: JSON.stringify({ userId: "u_emp1", date: "2027-02-01", start: "08:00", end: "16:00" }) });
  assert.ok(write.status === 200 || write.status === 201, "write-sessie mag schrijven");
  // klant trekt consent in → sessie meteen dood
  await fetch(`${BASE}/api/tenants/t_demo/support-access/end`, { method: "POST", headers: H(admin.token), body: "{}" });
  const after = await fetch(`${BASE}/api/tenants/t_demo/planning`, { headers: { Authorization: `Bearer ${sd.supportToken}` } });
  assert.equal(after.status, 401, "ingetrokken consent → support-token ongeldig");
});
