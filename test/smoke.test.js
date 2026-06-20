"use strict";
// HTTP smoke-test: boot de echte server (JSON-opslag, read-only checks).
// Vangt boot-time crashes (bad require, top-level throw, config-assert) die
// `node --check` niet ziet.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = Number(process.env.SMOKE_PORT || 4399);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let smokeDir;

before(async () => {
  smokeDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflowpro-smoke-"));
  server = spawn(process.execPath, ["src/server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(PORT),
      STORAGE_ADAPTER: "json",
      WORKFLOWPRO_DATA_FILE: path.join(smokeDir, "workflowpro-smoke.json"),
      WORKFLOWPRO_INITIAL_ADMIN_PASSWORD: "Demo2026!",
      REQUIRE_ADMIN_MFA: "false",
      NODE_ENV: "test",
      RELEASE_CHANNEL: "pilot",
      RATE_LIMIT_DISABLED: "true"
    },
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

after(() => {
  if (server && server.exitCode === null) server.kill();
  if (smokeDir) fs.rmSync(smokeDir, { recursive: true, force: true });
});

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
  for (const p of ["admin", "manager", "employee", "superadmin", "reseller"]) {
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

async function activateWithLink(activationLink, password) {
  assert.ok(activationLink, "dev/test moet een activatielink teruggeven");
  const token = new URL(activationLink).searchParams.get("activate");
  assert.ok(token, "activatielink bevat token");
  const r = await fetch(`${BASE}/api/auth/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password })
  });
  assert.equal(r.status, 200);
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

test("GDPR: superadmin-gebruikerslijst toont geen tenant-medewerkers (enkel platform)", async () => {
  const su = await login("super@workflowpro.be", "Demo2026!");
  const d = await (await fetch(`${BASE}/api/admin/users`, { headers: { Authorization: `Bearer ${su.token}` } })).json();
  assert.ok(Array.isArray(d.users));
  assert.ok(d.users.every(u => u.role === "super_admin"), "enkel platform-accounts, geen tenant-medewerkers");
});

test("GDPR: tenant-gebruikers voor overname enkel met klant-consent", async () => {
  const su = await login("super@workflowpro.be", "Demo2026!");
  const admin = await login("admin@demobouw.be", "Demo2026!");
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  // Zonder consent → 403
  await fetch(`${BASE}/api/tenants/t_demo/support-access/end`, { method: "POST", headers: H(admin.token), body: "{}" });
  const denied = await fetch(`${BASE}/api/admin/support/t_demo/users`, { headers: H(su.token) });
  assert.equal(denied.status, 403, "geen consent → geen medewerkergegevens");
  // Met consent → lijst (geen super_admins)
  try {
    await fetch(`${BASE}/api/tenants/t_demo/support-access`, { method: "POST", headers: H(admin.token), body: JSON.stringify({ allowed: true, reason: "consent-gated test" }) });
    const ok = await fetch(`${BASE}/api/admin/support/t_demo/users`, { headers: H(su.token) });
    assert.equal(ok.status, 200);
    const list = (await ok.json()).users;
    assert.ok(list.length > 0 && list.every(u => u.role !== "super_admin"), "tenant-medewerkers, geen platform-accounts");
  } finally {
    await fetch(`${BASE}/api/tenants/t_demo/support-access/end`, { method: "POST", headers: H(admin.token), body: "{}" });
  }
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

test("customer-start bootstrap: preview is read-only, apply is idempotent", async () => {
  const admin = await login("admin@demobouw.be", "Demo2026!");
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}` };
  const date = "2027-06-19";

  const preview = await fetch(`${BASE}/api/tenants/t_demo/customer-start/bootstrap?date=${date}&targetWorkorders=1`, { headers: H });
  assert.equal(preview.status, 200);
  const before = (await preview.json()).bootstrap;
  const targetWorkorders = before.existing.openWorkorders + 2;

  const apply = await fetch(`${BASE}/api/tenants/t_demo/customer-start/bootstrap`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ date, targetWorkorders })
  });
  assert.equal(apply.status, 201);
  const applied = (await apply.json()).bootstrap;
  assert.equal(applied.after.readyBefore, true, "na apply is customer-start technisch klaar");
  assert.ok(applied.created.some(row => row.collection === "workorders"), "maakt ontbrekende werkbonnen aan");
  assert.ok(applied.created.some(row => row.collection === "shifts") || before.existing.dayShifts > 0, "planning bestaat of wordt aangemaakt");

  const repeat = await fetch(`${BASE}/api/tenants/t_demo/customer-start/bootstrap`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ date, targetWorkorders })
  });
  assert.equal(repeat.status, 201);
  const repeated = (await repeat.json()).bootstrap;
  assert.equal(repeated.created.length, 0, "tweede apply maakt niets dubbel aan");
});

// ── Self-service: publieke registratie + reseller-aanvraag ──
test("self-signup: publieke plannen + registratie + activatie", async () => {
  const plans = await (await fetch(`${BASE}/api/plans`)).json();
  assert.ok(Array.isArray(plans.plans) && plans.plans.length > 0, "publieke plannen beschikbaar zonder login");
  const stamp = Date.now();
  const email = `signup-${stamp}@nieuw.be`;
  const r = await fetch(`${BASE}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyName: "Nieuw Bedrijf", name: "Eigenaar", email, password: "NieuwSterk2026!@#", plan: "business" }) });
  assert.equal(r.status, 201);
  const d = await r.json();
  assert.equal(d.pending, true, "registratie wacht op e-mailactivatie");
  assert.ok(!d.token, "geen auto-login voor e-mailverificatie");
  const pre = await login(email, "NieuwSterk2026!@#");
  assert.ok(!pre.token, "voor activatie kan de nieuwe klant niet inloggen");
  const activated = await activateWithLink(d.activationLink, "NieuwSterk2026!@#");
  assert.ok(activated.token, "auto-login token na activatie");
  const me = await (await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${activated.token}` } })).json();
  assert.equal(me.user.role, "tenant_admin", "nieuwe gebruiker is tenant-admin van eigen bedrijf");
  // dubbele e-mail → 409
  const dup = await fetch(`${BASE}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyName: "X", email, plan: "business" }) });
  assert.equal(dup.status, 409);
  // zwak wachtwoord → 400
  const weak = await fetch(`${BASE}/api/auth/activate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: new URL(d.activationLink).searchParams.get("activate"), password: "zwak" }) });
  assert.equal(weak.status, 400);
});

test("self-signup: reseller-aanvraag = pending, login pas na goedkeuring", async () => {
  const stamp = Date.now();
  const email = `applyreseller-${stamp}@partner.be`;
  const pass = "PartnerSterk2026!@#";
  const ap = await fetch(`${BASE}/api/resellers/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Aanvrager BV", email, password: pass }) });
  assert.equal(ap.status, 201);
  const pre = await login(email, pass);
  assert.ok(!pre.token, "pending reseller kan nog niet inloggen");
  const god = await login("super@workflowpro.be", "Demo2026!");
  const H = { Authorization: `Bearer ${god.token}` };
  const list = await (await fetch(`${BASE}/api/admin/resellers`, { headers: H })).json();
  const pending = list.resellers.find(r => r.contactEmail === email);
  assert.ok(pending && pending.status === "pending", "aanvraag staat als pending");
  const approved = await (await fetch(`${BASE}/api/admin/resellers/${pending.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...H }, body: JSON.stringify({ status: "active" }) })).json();
  const activated = await activateWithLink(approved.activationLink, pass);
  assert.ok(activated.token, "na goedkeuring en activatie kan de reseller inloggen");
});

// ── Reseller-programma: aanmaken, klant aanmaken, commissie, isolatie ──
test("reseller: god maakt reseller, reseller maakt klant + ziet commissie, niet die van anderen", async () => {
  const god = await login("super@workflowpro.be", "Demo2026!");
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  const stamp = Date.now();
  const loginEmail = `reseller-${stamp}@partners.be`;
  const pass = "ResellerSterk2026!@#";
  // 1) god maakt reseller met 10% commissie
  const cr = await fetch(`${BASE}/api/admin/resellers`, { method: "POST", headers: H(god.token), body: JSON.stringify({ name: "Partner X", loginEmail, password: pass, defaultCommissionPct: 10 }) });
  assert.equal(cr.status, 201);
  const createdReseller = await cr.json();
  // 2) reseller logt in
  const rs = await activateWithLink(createdReseller.activationLink, pass);
  assert.ok(rs.token, "reseller kan inloggen na activatie");
  // 3) reseller maakt een klant aan
  const adminEmail = `klant-${stamp}@klant.be`;
  const mk = await fetch(`${BASE}/api/reseller/clients`, { method: "POST", headers: H(rs.token), body: JSON.stringify({ name: "Klant van X", plan: "business", adminEmail, adminName: "Klant Admin", adminPassword: "KlantSterk2026!@#" }) });
  assert.equal(mk.status, 201);
  const tenantId = (await mk.json()).client.tenantId;
  // 4) god zet de klant actief → MRR + commissie > 0
  await fetch(`${BASE}/api/admin/tenants/${tenantId}`, { method: "PATCH", headers: H(god.token), body: JSON.stringify({ status: "active" }) });
  const ov = await (await fetch(`${BASE}/api/reseller/clients`, { headers: H(rs.token) })).json();
  const mine = ov.rows.find(r => r.tenantId === tenantId);
  assert.ok(mine, "reseller ziet eigen klant");
  assert.equal(mine.commissionPct, 10);
  assert.ok(mine.mrr > 0 && mine.commission > 0, "commissie = % van MRR");
  // 5) tweede reseller ziet die klant NIET
  const loginEmail2 = `reseller2-${stamp}@partners.be`;
  const cr2 = await (await fetch(`${BASE}/api/admin/resellers`, { method: "POST", headers: H(god.token), body: JSON.stringify({ name: "Partner Y", loginEmail: loginEmail2, password: pass, defaultCommissionPct: 5 }) })).json();
  const rs2 = await activateWithLink(cr2.activationLink, pass);
  const ov2 = await (await fetch(`${BASE}/api/reseller/clients`, { headers: H(rs2.token) })).json();
  assert.ok(!ov2.rows.some(r => r.tenantId === tenantId), "reseller ziet enkel eigen klanten");
  // 6) reseller mag geen platform-admin endpoints
  assert.equal((await fetch(`${BASE}/api/admin/resellers`, { headers: H(rs.token) })).status, 403, "reseller geen admin-toegang");
  assert.equal((await fetch(`${BASE}/api/admin/stats`, { headers: H(rs.token) })).status, 403);
});

// ── Integraties: Exact Online + Robaws ──
test("integraties: Exact Online + Robaws in registry, verbindbaar + sync", async () => {
  const su = await login("super@workflowpro.be", "Demo2026!");
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${su.token}` };
  const list = await (await fetch(`${BASE}/api/tenants/t_demo/integrations`, { headers: H })).json();
  const keys = (list.providers || []).map(p => p.key);
  assert.ok(keys.includes("exact") && keys.includes("robaws"), "Exact + Robaws aangeboden");
  const exactMeta = list.providers.find(p => p.key === "exact");
  assert.equal(exactMeta.authType, "oauth2");
  assert.ok(exactMeta.fields.some(f => f.key === "division"), "Exact heeft division-veld");

  // Robaws verbinden + synchroniseren (sleutel + default mapping → success)
  const conn = await fetch(`${BASE}/api/tenants/t_demo/integrations/connect`, { method: "POST", headers: H, body: JSON.stringify({ provider: "robaws", apiKey: "robaws-test-key", baseUrl: "https://app.robaws.be/api/v2" }) });
  assert.equal(conn.status, 201);
  const row = (await conn.json()).row;
  assert.equal(row.provider, "robaws");
  assert.equal(row.hasSecret, true);
  const sync = await fetch(`${BASE}/api/tenants/t_demo/integrations/${row.id}/sync`, { method: "POST", headers: H, body: "{}" });
  assert.equal(sync.status, 200);
  assert.equal((await sync.json()).result.log.status, "success", "sync slaagt met sleutel + default mapping");

  // Exact verbinden met division (provider-specifiek configveld bewaard)
  const ex = await fetch(`${BASE}/api/tenants/t_demo/integrations/connect`, { method: "POST", headers: H, body: JSON.stringify({ provider: "exact", apiKey: "exact-oauth-token", config: { division: "1234567" } }) });
  assert.equal(ex.status, 201);
  const exrow = (await ex.json()).row;
  assert.equal(exrow.provider, "exact");
  assert.equal(exrow.config.division, "1234567");
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
  const created = await c.json();
  const agent = await activateWithLink(created.activationLink, pass);
  assert.ok(agent.token, "nieuwe agent kan inloggen na activatie");
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

test("platformteam: scoped agent komt enkel in toegestane platform-secties", async () => {
  const god = await login("super@workflowpro.be", "Demo2026!");
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  const email = `scoped-${Date.now()}@workflowpro.be`;
  const pass = "ScopedAgent2026!@#";
  // Agent met enkel 'support'-scope
  const c = await fetch(`${BASE}/api/admin/staff`, { method: "POST", headers: H(god.token), body: JSON.stringify({ name: "Scoped Agent", email, password: pass, platformScopes: ["support"] }) });
  assert.equal(c.status, 201);
  const created = await c.json();
  assert.deepEqual(created.staff.scopes, ["support"]);
  const agent = await activateWithLink(created.activationLink, pass);
  // In-scope: support → 200
  assert.equal((await fetch(`${BASE}/api/admin/support`, { headers: H(agent.token) })).status, 200);
  // Out-of-scope: billing en audit → 403
  assert.equal((await fetch(`${BASE}/api/admin/billing`, { headers: H(agent.token) })).status, 403, "geen billing-scope");
  assert.equal((await fetch(`${BASE}/api/audit`, { headers: H(agent.token) })).status, 403, "geen audit-scope");
  assert.equal((await fetch(`${BASE}/api/admin/integrations`, { headers: H(agent.token) })).status, 403, "geen integraties-scope");
  // /me toont de scopes
  const me = await (await fetch(`${BASE}/api/me`, { headers: H(agent.token) })).json();
  assert.deepEqual(me.platform.scopes, ["support"]);
  assert.equal(me.platform.isGod, false);
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

// ── SAML SSO (add-on) ──────────────────────────────────────────────────────
test("sso: add-on gating, configuratie, resolve, login-redirect, metadata en ACS-weigering", async () => {
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  const god = await login("super@workflowpro.be", "Demo2026!");
  const admin = await login("admin@demobouw.be", "Demo2026!");

  // Zonder add-on: /sso/config is 403 (entitlement-gating).
  const denied = await fetch(`${BASE}/api/tenants/t_demo/sso/config`, { headers: H(admin.token) });
  assert.equal(denied.status, 403, "geen sso-add-on → 403");

  // God kent de sso-add-on toe via module-overrides.
  const grant = await fetch(`${BASE}/api/admin/tenants/t_demo/modules`, {
    method: "PATCH", headers: H(god.token),
    body: JSON.stringify({ moduleOverrides: { add: ["sso"], remove: [] } })
  });
  assert.equal(grant.status, 200);

  // Nu kan de admin de config lezen + opslaan.
  const cfgGet = await fetch(`${BASE}/api/tenants/t_demo/sso/config`, { headers: H(admin.token) });
  assert.equal(cfgGet.status, 200, "met add-on → config leesbaar");

  const dummyCert = "-----BEGIN CERTIFICATE-----\nMIIBdummybase64data\n-----END CERTIFICATE-----";
  const save = await fetch(`${BASE}/api/tenants/t_demo/sso/config`, {
    method: "PUT", headers: H(admin.token),
    body: JSON.stringify({
      enabled: true, entryPoint: "https://idp.example/sso", idpCert: dummyCert,
      domains: ["demobouw.be"], jit: { enabled: true, defaultRole: "employee" }
    })
  });
  assert.equal(save.status, 200);
  const saved = await save.json();
  assert.equal(saved.sso.enabled, true);
  assert.deepEqual(saved.sso.domains, ["demobouw.be"]);

  // Inschakelen zonder cert moet falen (anti-lockout).
  const bad = await fetch(`${BASE}/api/tenants/t_demo/sso/config`, {
    method: "PUT", headers: H(admin.token),
    body: JSON.stringify({ enabled: true, entryPoint: "https://idp.example/sso", idpCert: "" })
  });
  assert.equal(bad.status, 400, "inschakelen zonder cert → 400");
  // (config staat nog op de geldige versie van hierboven)
  await fetch(`${BASE}/api/tenants/t_demo/sso/config`, {
    method: "PUT", headers: H(admin.token),
    body: JSON.stringify({ enabled: true, entryPoint: "https://idp.example/sso", idpCert: dummyCert, domains: ["demobouw.be"], jit: { enabled: true, defaultRole: "employee" } })
  });

  // Publieke resolve: domein → tenant.
  const resolved = await (await fetch(`${BASE}/api/auth/sso/resolve?email=iemand@demobouw.be`)).json();
  assert.equal(resolved.sso, true);
  assert.equal(resolved.tenantId, "t_demo");
  const noSso = await (await fetch(`${BASE}/api/auth/sso/resolve?email=iemand@onbekend.be`)).json();
  assert.equal(noSso.sso, false);

  // Login-endpoint → 302 naar de IdP met SAMLRequest.
  const loginRedirect = await fetch(`${BASE}/api/auth/saml/t_demo/login`, { redirect: "manual" });
  assert.equal(loginRedirect.status, 302);
  assert.match(loginRedirect.headers.get("location") || "", /^https:\/\/idp\.example\/sso\?SAMLRequest=/);

  // SP-metadata is XML.
  const meta = await fetch(`${BASE}/api/auth/saml/t_demo/metadata`);
  assert.equal(meta.status, 200);
  assert.match((meta.headers.get("content-type") || ""), /xml/);

  // ACS met rommel → redirect met sso_error (nooit een sessie).
  const acs = await fetch(`${BASE}/api/auth/saml/t_demo/acs`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "SAMLResponse=" + encodeURIComponent(Buffer.from("<garbage/>").toString("base64")),
    redirect: "manual"
  });
  assert.equal(acs.status, 302);
  assert.match(acs.headers.get("location") || "", /sso_error=/);
});

// ── Stripe-abonnementen: checkout + portal (mock-modus zonder live key) ─────
test("billing: checkout + portal endpoints (mock), auth-gating", async () => {
  const admin = await login("admin@demobouw.be", "Demo2026!");
  const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });

  // Employee mag niet factureren
  const emp = await login("jan@demobouw.be", "Demo2026!");
  const denied = await fetch(`${BASE}/api/tenants/t_demo/billing/checkout`, { method: "POST", headers: H(emp.token), body: JSON.stringify({ plan: "business" }) });
  assert.equal(denied.status, 403, "employee → geen billing");

  // Admin checkout (mock): activeert plan + geeft mock-URL
  const co = await (await fetch(`${BASE}/api/tenants/t_demo/billing/checkout`, { method: "POST", headers: H(admin.token), body: JSON.stringify({ plan: "business" }) })).json();
  assert.equal(co.ok, true);
  assert.equal(co.provider, "mock", "zonder live key → mock");
  assert.match(co.url, /abonnement=mock/);

  // Onbekend plan → 400
  const bad = await fetch(`${BASE}/api/tenants/t_demo/billing/checkout`, { method: "POST", headers: H(admin.token), body: JSON.stringify({ plan: "bestaat-niet" }) });
  assert.equal(bad.status, 400);

  // Portal (mock)
  const portal = await (await fetch(`${BASE}/api/tenants/t_demo/billing/portal`, { method: "POST", headers: H(admin.token), body: "{}" })).json();
  assert.equal(portal.ok, true);
  assert.equal(portal.provider, "mock");
});

// ── Wachtwoord vergeten → reset via e-maillink ──────────────────────────────
// LET OP: dit verandert het wachtwoord van de demo-admin onomkeerbaar (de oude
// seed 'Demo2026!' is korter dan het sterkte-beleid, dus niet herstelbaar via de
// reset-endpoint). Daarom MOET deze test als laatste lopen in dit bestand.
test("password-reset: forgot stuurt link (dev), reset zet nieuw wachtwoord + login", async () => {
  // 'forgot' voor onbekend e-mail → zelfde ok-antwoord, geen enumeratie
  const unknown = await (await fetch(`${BASE}/api/auth/forgot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "bestaat.niet@nergens.be" }) })).json();
  assert.equal(unknown.ok, true);
  assert.ok(!unknown.resetLink, "geen link voor onbekend account");

  // Bestaande demo-admin vraagt reset → dev geeft resetLink terug
  const req = await (await fetch(`${BASE}/api/auth/forgot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@demobouw.be" }) })).json();
  assert.equal(req.ok, true);
  assert.ok(req.resetLink, "dev/test geeft reset-link terug");
  const tokenParam = new URL(req.resetLink).searchParams.get("reset");
  assert.ok(tokenParam, "reset-link bevat token");

  // Zwak wachtwoord → 400
  const weak = await fetch(`${BASE}/api/auth/reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tokenParam, password: "zwak" }) });
  assert.equal(weak.status, 400);

  // Sterk wachtwoord → 200 + auto-login token
  const newPass = "ResetSterk2026!@#";
  const done = await (await fetch(`${BASE}/api/auth/reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tokenParam, password: newPass }) })).json();
  assert.ok(done.token, "reset geeft sessie-token");

  // Oud wachtwoord werkt niet meer, nieuw wel
  const oldLogin = await login("admin@demobouw.be", "Demo2026!");
  assert.ok(!oldLogin.token, "oud wachtwoord is ongeldig na reset");
  const newLogin = await login("admin@demobouw.be", newPass);
  assert.ok(newLogin.token, "nieuw wachtwoord werkt");

  // Token is eenmalig: tweede reset met zelfde token → 400
  const reuse = await fetch(`${BASE}/api/auth/reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tokenParam, password: "NogEenSterk2026!@#" }) });
  assert.equal(reuse.status, 400, "reset-token is eenmalig");
});
