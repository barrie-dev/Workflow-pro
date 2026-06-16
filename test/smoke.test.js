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
