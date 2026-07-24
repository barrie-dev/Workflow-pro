"use strict";
/**
 * Resellerportaal · pagina "Verdiensten & commissie" (CTO3-09).
 *
 * Deze tests laden public/js/platforms/reseller-verdiensten.js ECHT in een
 * sandbox met een nagebootste browser, want de eisen uit h23 gaan over gedrag
 * en niet over de aanwezigheid van een tekenreeks:
 *
 *   * de pagina registreert zich en laat de portalstate van reseller.js met
 *     rust (geen tweede context, geen tweede shell);
 *   * er gaat nooit een organisatie-id vanuit de UI naar de server · de server
 *     leidt de partnerorganisatie af uit de sessie;
 *   * een weigering toont een vaste, generieke melding · nooit een record-id
 *     en nooit "bestaat niet" (dat zou een bestaans-oracle zijn);
 *   * klantinhoud verschijnt enkel bij een ACTIEVE gedelegeerde toegang;
 *   * bedragen tonen is geen bedragen wijzigen: read-only, geen verzonnen
 *     actieknoppen.
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const MOD = path.join(ROOT, "public", "js", "platforms", "reseller-verdiensten.js");
const src = fs.readFileSync(MOD, "utf8").replace(/\r\n/g, "\n");

/** Broncode zonder commentaar · anders faalt een test op een uitleg. */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

// ── Nagebootste browser ─────────────────────────────────────────────────────

function response(status, body) {
  const r = {
    ok: status >= 200 && status < 300, status, gelezen: false,
    json() { r.gelezen = true; return Promise.resolve(body); }
  };
  return r;
}

function host() {
  return {
    innerHTML: "",
    attrs: {},
    setAttribute(key, value) { this.attrs[key] = value; },
    removeAttribute(key) { delete this.attrs[key]; },
    querySelector(selector) {
      const naam = selector.replace(/[[\]]/g, "");
      return this.innerHTML.includes(naam) ? { addEventListener() {} } : null;
    }
  };
}

/**
 * Laadt de module in een verse sandbox. `routes` bindt een pad (zonder query)
 * aan een antwoord; alles wat niet in routes staat is een harde testfout, zo
 * blijft zichtbaar welke endpoints de pagina echt aanroept.
 */
function laad(routes, extraWindow) {
  const calls = [];
  const win = Object.assign({
    wfpCore: {
      token: () => "test-token",
      esc: v => String(v == null ? "" : v).replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
    },
    WorkFlowProPlatformRouter: { showLogin() {} }
  }, extraWindow || {});
  const sandbox = {
    window: win,
    document: { getElementById: () => null },
    localStorage: { getItem: () => "test-token", removeItem() {}, setItem() {} },
    fetch(url, options) {
      calls.push({ url, options });
      const pad = String(url).split("?")[0];
      if (!(pad in routes)) return Promise.reject(new Error(`onverwacht endpoint ${pad}`));
      return Promise.resolve(routes[pad]);
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "reseller-verdiensten.js" });
  return { sandbox, win, calls, pagina: win.wfpResellerPages && win.wfpResellerPages.verdiensten };
}

// ── Vaste antwoorden ────────────────────────────────────────────────────────

const LEDGER = {
  ok: true,
  balance: { accrued: 1250.5, payable: 400, paid: 850.5, clawedBack: -50 },
  events: [
    { id: "cev_1", type: "accrual", period: "2026-05", clientTenantId: "t_alfa", clientName: "Alfa Bouw",
      basisAmount: 1000, ratePct: 10, amount: 100, createdAt: "2026-05-31T10:00:00.000Z",
      sourceRef: { kind: "invoice", id: "inv_alfa_001" } },
    { id: "cev_2", type: "accrual", period: "2026-06", clientTenantId: "t_beta", clientName: "Beta Dak",
      basisAmount: 2000, ratePct: 10, amount: 200, createdAt: "2026-06-30T10:00:00.000Z",
      sourceRef: { kind: "payment", id: "pay_beta_002" } }
  ],
  payouts: [{ id: "cpo_1", amount: 850.5, status: "paid", period: "2026-04", paymentRef: "SEPA-77", createdAt: "2026-05-02T09:00:00.000Z" }]
};

const STATEMENTS = {
  ok: true,
  statements: [{
    id: "cst_1", period: "2026-06", status: "invoiced", currency: "EUR", eventCount: 2,
    opening: 0, subtotal: 300, tax: 63, total: 363, generatedAt: "2026-07-01T08:00:00.000Z"
  }]
};

const AGREEMENTS = {
  ok: true,
  agreements: [{
    id: "cag_1", agreement_id: "agr_kern", version: 2, status: "active", model: "percentage",
    percentage: 10, fixed_amount: null, earning_trigger: "payment_received",
    start_date: "2026-01-01", end_date: null
  }]
};

const GEEN_GRANT = { ok: true, grants: [] };

function routes(overrides) {
  return Object.assign({
    "/api/reseller/commission": response(200, LEDGER),
    "/api/reseller/commission-statements": response(200, STATEMENTS),
    "/api/reseller/commission-agreements": response(200, AGREEMENTS),
    "/api/reseller/delegated-access": response(200, GEEN_GRANT)
  }, overrides || {});
}

// ── Structuur ───────────────────────────────────────────────────────────────

test("VRD 1· het bestand volgt het paginapatroon en maakt geen context aan", () => {
  assert.match(src, /^\/\*[\s\S]*?\*\/\s*\(function \(\) \{\s*\n\s*"use strict";/,
    "een paginamodule hoort een IIFE met 'use strict' te zijn");
  assert.match(src, /const C = window\.wfpCore;\s*\n\s*if \(!C\) return;/,
    "de gedeelde kern hoort gelezen te worden, met een harde afslag als hij er niet is");
  assert.equal(/window\.wfpAdmin\s*=/.test(src), false, "dit bestand maakt window.wfpAdmin aan");
  assert.equal(/window\.wfp_resellerInit\s*=/.test(src), false,
    "dit bestand kaapt de init van de portalshell");
  assert.equal(/function buildShell|rsp-sidebar|rspLogout/.test(code), false,
    "de portalshell hoort van reseller.js te blijven · dit is een pagina, geen tweede shell");
});

test("VRD 2· de pagina registreert zichzelf zonder bestaande state te herdefinieren", () => {
  const bestaand = { andere: { id: "andere" } };
  const { win, pagina } = laad(routes(), { wfpResellerPages: bestaand, wfp_resellerInit: "origineel" });

  assert.equal(win.wfpResellerPages, bestaand, "het bestaande paginaregister is vervangen in plaats van gelezen");
  assert.equal(win.wfpResellerPages.andere.id, "andere", "een andere pagina is uit het register geduwd");
  assert.ok(pagina, "de pagina heeft zich niet geregistreerd");
  assert.equal(pagina.id, "verdiensten");
  assert.equal(pagina.permission, "reseller.commissions.view");
  // Zelfde contract als de andere paginamodules van het portaal: render() vult
  // een container, html() geeft pure HTML uit de huidige state.
  for (const naam of ["load", "render", "html", "invalidate", "label"]) {
    assert.equal(typeof pagina[naam], "function", `${naam} ontbreekt in het paginacontract`);
  }
  assert.equal(pagina.html(), pagina.html(), "html() hoort puur te zijn");
  // De portalstate van reseller.js blijft onaangeroerd.
  assert.equal(win.wfpAdmin, undefined, "er is een tweede gedeelde context ontstaan");
  assert.equal(win.wfp_resellerInit, "origineel", "de init van de portalshell is overschreven");
});

test("VRD 3· zonder de gedeelde kern doet het bestand niets", () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "reseller-verdiensten.js" });
  assert.equal(sandbox.window.wfpResellerPages, undefined,
    "zonder wfpCore hoort de pagina stil af te haken, niet zelf iets aan te maken");
});

// ── Scope: nooit een organisatie-id uit de UI ───────────────────────────────

test("VRD 4· de pagina haalt precies haar eigen commissie-endpoints op, altijd GET", async () => {
  const { pagina, calls } = laad(routes());
  const doel = host();
  await pagina.render(doel);

  const paden = [...new Set(calls.map(c => String(c.url).split("?")[0]))].sort();
  assert.deepEqual(paden, [
    "/api/reseller/commission",
    "/api/reseller/commission-agreements",
    "/api/reseller/commission-statements",
    "/api/reseller/delegated-access"
  ]);
  for (const call of calls) {
    assert.equal((call.options && call.options.method) || "GET", "GET",
      `${call.url} wordt niet met GET opgehaald · deze pagina is read-only`);
    assert.equal(call.options.body, undefined, "een leespagina stuurt geen body mee");
    assert.equal(call.options.headers.Authorization, "Bearer test-token");
  }
});

test("VRD 5· er gaat nooit een organisatie-id vanuit de UI naar de server", async () => {
  const { pagina, calls } = laad(routes());
  await pagina.render(host());

  for (const call of calls) {
    assert.equal(/resellerId/i.test(String(call.url)), false,
      `${call.url} stuurt een organisatie-id mee · de server leidt die uit de sessie af`);
    assert.equal(call.options.body, undefined);
  }
  // En het mag ook niet latent in de bron staan: één regel code volstaat om
  // de serverregel (harde weigering bij een vreemde organisatie) te omzeilen.
  assert.equal(/resellerId/.test(code), false,
    "de bron kent een organisatie-id · een pagina hoort die nooit te bezitten");
  // De enige parameter die de pagina meestuurt is de klant-tenant voor de
  // delegatiecontrole.
  const query = calls.map(c => String(c.url)).filter(u => u.includes("?"));
  for (const url of query) assert.match(url, /\?tenantId=/);
});

// ── Weigeringen ─────────────────────────────────────────────────────────────

test("VRD 6· een 403 toont een generieke melding zonder enige identifier", async () => {
  const lek = response(403, { ok: false, code: "STATEMENT_NOT_FOUND", error: "statement cst_9f3a1b bestaat niet voor reseller rs_77" });
  const { pagina } = laad(routes({
    "/api/reseller/commission": lek,
    "/api/reseller/commission-statements": lek,
    "/api/reseller/commission-agreements": lek
  }));
  const doel = host();
  await pagina.render(doel);

  assert.match(doel.innerHTML, /Geen toegang/, "de generieke weigering ontbreekt");
  for (const lekt of ["cst_9f3a1b", "rs_77", "bestaat niet", "STATEMENT_NOT_FOUND", "403"]) {
    assert.equal(doel.innerHTML.includes(lekt), false,
      `het scherm toont "${lekt}" · een weigering mag nooit verraden wat er wel of niet bestaat`);
  }
  // Niets van de inhoud mag alsnog verschijnen.
  assert.equal(/rsp-kpi-value|Alfa Bouw/.test(doel.innerHTML), false,
    "er worden bedragen getoond terwijl de server weigerde");
  // Diepteverdediging: de foutbody wordt niet eens uitgelezen. Wat je nooit
  // in handen hebt, kan later ook niemand per ongeluk in het scherm zetten.
  assert.equal(lek.gelezen, false,
    "de pagina leest de foutbody van een weigering · precies daar zit een record-id in");
});

test("VRD 6b· een weigering op één blok laat de rest gewoon staan", async () => {
  const { pagina } = laad(routes({
    "/api/reseller/commission-statements": response(403, { ok: false, error: "statement cst_9f3a1b bestaat niet" })
  }));
  const doel = host();
  await pagina.render(doel);

  assert.match(doel.innerHTML, /Geen toegang/, "het geweigerde blok toont geen melding");
  assert.equal(doel.innerHTML.includes("cst_9f3a1b"), false);
  assert.match(doel.innerHTML, /Alfa Bouw/, "het grootboek is meegesneuveld met de commissiestaten");
  assert.match(doel.innerHTML, /Grootboek/);
});

test("VRD 6c· een technische fout toont onze eigen tekst, niet die van de server", async () => {
  const { pagina } = laad(routes({
    "/api/reseller/commission": response(500, { ok: false, error: "pg: relation resellerCommissionStatements ontbreekt" })
  }));
  const doel = host();
  await pagina.render(doel);

  assert.equal(doel.innerHTML.includes("pg:"), false, "een serverbericht lekt naar het scherm");
  assert.equal(doel.innerHTML.includes("resellerCommissionStatements"), false);
  assert.match(doel.innerHTML, /kon niet laden/i);
});

// ── Klantinhoud versus commerciële metadata ────────────────────────────────

test("VRD 7· klantinhoud verschijnt alleen bij een ACTIEVE gedelegeerde toegang", async () => {
  // Alfa geeft een actieve toegang, Beta heeft ze ingetrokken.
  const grants = {
    t_alfa: { ok: true, grants: [{ id: "rag_1", tenantId: "t_alfa", status: "active", scope: ["support_read"], startDate: "2026-01-01T00:00:00.000Z", endDate: "2099-01-01T00:00:00.000Z" }] },
    t_beta: { ok: true, grants: [{ id: "rag_2", tenantId: "t_beta", status: "revoked", scope: ["support_read"], startDate: "2026-01-01T00:00:00.000Z", endDate: "2099-01-01T00:00:00.000Z" }] }
  };
  const { pagina, calls } = laadMetGrants(routes(), grants);
  const doel = host();
  await pagina.render(doel);

  assert.match(doel.innerHTML, /inv_alfa_001/, "de bron van de klant met actieve toegang ontbreekt");
  assert.equal(doel.innerHTML.includes("pay_beta_002"), false,
    "de bronverwijzing van een klant zonder actieve toegang wordt getoond · dat is klantinhoud");
  // Commerciële metadata blijft voor beide klanten gewoon zichtbaar.
  assert.match(doel.innerHTML, /Alfa Bouw/);
  assert.match(doel.innerHTML, /Beta Dak/);
  assert.match(doel.innerHTML, /enkel metadata/);
  assert.equal(calls.filter(c => String(c.url).includes("delegated-access")).length, 2);
});

test("VRD 7b· een verlopen toegang telt niet als toegang", async () => {
  const grants = {
    t_alfa: { ok: true, grants: [{ id: "rag_1", tenantId: "t_alfa", status: "active", startDate: "2020-01-01T00:00:00.000Z", endDate: "2020-02-01T00:00:00.000Z" }] },
    t_beta: { ok: true, grants: [{ id: "rag_2", tenantId: "t_beta", status: "tenant_approved", startDate: "2026-01-01T00:00:00.000Z", endDate: "2099-01-01T00:00:00.000Z" }] }
  };
  const { pagina } = laadMetGrants(routes(), grants);
  const doel = host();
  await pagina.render(doel);
  assert.equal(doel.innerHTML.includes("inv_alfa_001"), false, "een verlopen venster geeft toch inzage");
  assert.equal(doel.innerHTML.includes("pay_beta_002"), false, "een nog niet actieve grant geeft toch inzage");
});

test("VRD 7c· een geweigerde delegatiecontrole valt terug op alleen metadata", async () => {
  const grants = { t_alfa: response(403, { ok: false, error: "grant rag_1 bestaat niet" }), t_beta: response(403, { ok: false, error: "x" }) };
  const { pagina } = laadMetGrants(routes(), grants, true);
  const doel = host();
  await pagina.render(doel);
  assert.equal(doel.innerHTML.includes("inv_alfa_001"), false);
  assert.equal(doel.innerHTML.includes("rag_1"), false);
  assert.match(doel.innerHTML, /enkel metadata/);
});

/** Zelfde sandbox, maar met een antwoord PER tenant op de delegatie-endpoint. */
function laadMetGrants(basisRoutes, perTenant, ruwAntwoord) {
  const calls = [];
  const win = {
    wfpCore: {
      token: () => "test-token",
      esc: v => String(v == null ? "" : v).replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
    },
    WorkFlowProPlatformRouter: { showLogin() {} }
  };
  const sandbox = {
    window: win,
    document: { getElementById: () => null },
    localStorage: { getItem: () => "test-token", removeItem() {}, setItem() {} },
    fetch(url, options) {
      calls.push({ url, options });
      const [pad, query] = String(url).split("?");
      if (pad === "/api/reseller/delegated-access") {
        const tenant = decodeURIComponent(String(query || "").replace("tenantId=", ""));
        const antwoord = perTenant[tenant];
        if (!antwoord) return Promise.resolve(response(200, { ok: true, grants: [] }));
        return Promise.resolve(ruwAntwoord ? antwoord : response(200, antwoord));
      }
      if (!(pad in basisRoutes)) return Promise.reject(new Error(`onverwacht endpoint ${pad}`));
      return Promise.resolve(basisRoutes[pad]);
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "reseller-verdiensten.js" });
  return { sandbox, win, calls, pagina: win.wfpResellerPages.verdiensten };
}

// ── Read-only ───────────────────────────────────────────────────────────────

test("VRD 8· bedragen tonen is geen bedragen wijzigen · de pagina verzint geen knoppen", async () => {
  const { pagina } = laad(routes());
  const doel = host();
  await pagina.render(doel);

  assert.match(doel.innerHTML, /rsp-kpi-value/, "de bedragen worden niet getoond");
  assert.equal(/<button|<form|<input|<select/.test(doel.innerHTML), false,
    "er staat een bedieningselement op een pagina waarvoor de server geen rechten meestuurt");
  // Structureel: er bestaat hier geen schrijfpad om per ongeluk aan te roepen.
  assert.equal(/"(POST|PUT|PATCH|DELETE)"/.test(code), false, "er zit een schrijfmethode in de bron");
  assert.equal(/commission-disputes|payout-changes/.test(code), false,
    "de pagina roept een schrijfroute aan zonder dat de server een recht meestuurt");
  assert.match(code, /async function api\(path\)/,
    "api() hoort geen methode-argument te hebben · dan kan er ook geen schrijfactie ontstaan");
});

test("VRD 8b· de enige knop op de pagina is het herstelpad na een technische fout", async () => {
  const { pagina } = laad(routes({ "/api/reseller/commission": response(500, { ok: false, error: "boem" }) }));
  const doel = host();
  await pagina.render(doel);
  const knoppen = doel.innerHTML.match(/<button/g) || [];
  assert.equal(knoppen.length, 1, "het foutscherm hoort precies één herstelknop te hebben");
  assert.match(doel.innerHTML, /data-rsp-verdiensten-retry/);
});

// ── Taal en huisregels ──────────────────────────────────────────────────────

test("VRD 9· alle zichtbare tekst loopt via i18n met een Nederlandse terugval", () => {
  const i18n = fs.readFileSync(path.join(ROOT, "public", "js", "i18n.js"), "utf8");
  const sleutels = [...new Set([...src.matchAll(/tR\(\s*"([^"]+)"/g)].map(m => m[1]))];
  assert.ok(sleutels.length > 40, "er wordt te weinig via i18n gehaald voor een volledige pagina");

  // Sleutels die het portaal al kent moeten in alle drie de talen staan · een
  // pagina die er één hergebruikt mag geen taal laten wegvallen.
  const bestaand = sleutels.filter(k => i18n.includes(`"${k}"`));
  assert.ok(bestaand.length >= 30, "de pagina hergebruikt de bestaande portaalsleutels niet");
  for (const key of bestaand) {
    const aantal = (i18n.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length;
    assert.equal(aantal, 3, `${key} staat niet in NL, FR en EN`);
  }
  // Nieuwe sleutels horen in dezelfde naamruimte, zodat de vertaalronde ze in
  // één keer vindt (zie het rapport: FR/EN moeten nog toegevoegd worden).
  const nieuw = sleutels.filter(k => !i18n.includes(`"${k}"`));
  assert.deepEqual(nieuw.filter(k => !k.startsWith("rsp.")), [],
    "een nieuwe sleutel staat buiten de rsp.-naamruimte van het resellerportaal");
  // En elke aanroep heeft een terugvaltekst · anders ziet een gebruiker de sleutel.
  const zonderTerugval = [...src.matchAll(/tR\(\s*"[^"]+"\s*([,)])/g)].filter(m => m[1] === ")");
  assert.equal(zonderTerugval.length, 0, "een i18n-aanroep zonder Nederlandse terugval");
});

test("VRD 10· geen em-dash in het bestand", () => {
  // Huisregel: nooit een em-dash in tekst; gebruik "-" of "·". Zelfde
  // formulering als test/admin-dashboard-view.test.js, zodat de regel overal
  // op dezelfde manier bewaakt wordt.
  assert.equal(src.includes("—"), false, "em-dash gevonden");
});
