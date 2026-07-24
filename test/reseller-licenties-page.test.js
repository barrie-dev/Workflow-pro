"use strict";
// ── Resellerportaal · pagina "Licenties en prijsuitzonderingen" (23.10) ──────
//
// Deze pagina toont commerciële records van EIGEN klanten. Drie eigenschappen
// mogen nooit stilletjes wegvallen, en juist die zijn met een screenshot niet
// te zien:
//
//   * de grens: de module leest de portaalkern en definieert die (of de staat
//     van reseller.js) niet opnieuw · anders bestaan er twee waarheden;
//   * de scope: er vertrekt NOOIT een resellerId uit de UI. De server leidt de
//     organisatie af uit de sessie (23.6). Een id in de query is ook geweigerd
//     nog altijd een cross-reseller oracle;
//   * de weigering: een 403 toont één vaste, generieke melding. Geen id, geen
//     code, geen "bestaat niet" · anders is de foutmelding de bestaanstest
//     (ISO-07).
//
// De module is browsercode zonder buildstap en wordt hier met node:vm in een
// nagebootst window/document geladen.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const MOD = path.join(ROOT, "public", "js", "platforms", "reseller-licenties.js");
const PORTAAL = path.join(ROOT, "public", "js", "platforms", "reseller.js");

// Regeleindes normaliseren: git zet ze op Windows naar CRLF zodra hij het
// bestand aanraakt, en dan matcht een patroon met \n opeens niets meer.
const src = fs.readFileSync(MOD, "utf8").replace(/\r\n/g, "\n");
const portaalSrc = fs.readFileSync(PORTAAL, "utf8").replace(/\r\n/g, "\n");

/** Broncode zonder commentaar · anders slaagt of faalt een test op een uitleg. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ── Nagebootste browser ─────────────────────────────────────────────────────
function maakElement(tag) {
  const el = {
    tag, innerHTML: "", textContent: "", value: "", disabled: false,
    style: {}, dataset: {}, attrs: {}, luisteraars: {},
    addEventListener(type, fn) { (this.luisteraars[type] = this.luisteraars[type] || []).push(fn); },
    setAttribute(naam, waarde) { this.attrs[naam] = waarde; },
    removeAttribute(naam) { delete this.attrs[naam]; },
    // De module bindt op de HTML die ze zelf net geschreven heeft; we parsen
    // die met een regexp in plaats van een DOM na te bouwen.
    querySelectorAll(selector) {
      const m = /^\[data-([a-z-]+)\]$/.exec(selector);
      if (!m) return [];
      const attribuut = m[1];
      const camel = attribuut.replace(/^data-/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const gevonden = [...String(this.innerHTML).matchAll(new RegExp(`${attribuut}="([^"]*)"`, "g"))];
      return gevonden.map(t => {
        const knop = maakElement("button");
        knop.dataset[camel] = t[1];
        el.geknipt.push(knop);
        return knop;
      });
    },
    querySelector(selector) {
      const id = /^#(.+)$/.exec(selector);
      if (!id || !String(this.innerHTML).includes(`id="${id[1]}"`)) return null;
      const gevonden = maakElement("select");
      gevonden.id = id[1];
      el.geknipt.push(gevonden);
      return gevonden;
    },
    geknipt: [],
  };
  return el;
}

/** Laadt de module in een sandbox met een leeg document en één mounthost. */
function laad(opties) {
  const cfg = opties || {};
  const host = maakElement("main");
  const geroepen = { fetches: [], toasts: [], login: 0 };
  const win = cfg.zonderKern ? {} : {
    wfpCore: {
      token: () => "jwt-abc",
      esc: s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    },
    // t() geeft de SLEUTEL terug zodat een test ziet dat er vertaald is.
    wfpI18n: cfg.zonderI18n ? undefined : { lang: "nl", t: (key) => `«${key}»` },
    showToast: (tekst, soort) => geroepen.toasts.push({ tekst, soort }),
    WorkFlowProPlatformRouter: { showLogin() { geroepen.login++; } },
  };
  if (cfg.registerVooraf) win.wfpResellerPages = cfg.registerVooraf;
  const doc = {
    getElementById(id) { return id === "rspMain" ? host : null; },
    querySelectorAll() { return []; },
  };
  const sandbox = {
    window: win, document: doc, console,
    localStorage: { removeItem() {}, getItem: () => "jwt-abc" },
    fetch: async (url, init) => {
      geroepen.fetches.push({ url, init });
      const antwoord = (cfg.routes || {})[String(url).split("?")[0]] || (cfg.val && cfg.val(url));
      const gekozen = typeof antwoord === "function" ? antwoord(url) : antwoord;
      const res = gekozen || { status: 200, body: {} };
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        json: async () => res.body || {},
      };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "reseller-licenties.js" });
  return { win, host, geroepen, doc };
}

const ok = body => ({ status: 200, body });

/** Standaardantwoorden · overschrijfbaar per test. */
function routes(extra) {
  return Object.assign({
    "/api/reseller/license-requests": ok({ ok: true, requests: [] }),
    "/api/reseller/price-exceptions": ok({ ok: true, exceptions: [] }),
    "/api/reseller/assigned-tenants": ok({ ok: true, tenants: [] }),
    "/api/reseller/delegated-access": ok({ ok: true, grants: [] }),
  }, extra || {});
}

/** Vuurt de eerste luisteraar van een geknipte knop met dit data-attribuut af. */
async function klik(host, attribuut, waarde) {
  const knop = host.geknipt.find(el => el.dataset[attribuut] === waarde);
  assert.ok(knop, `geen knop met ${attribuut}="${waarde}" · de bedrading is weg`);
  const fns = knop.luisteraars.click || [];
  assert.equal(fns.length > 0, true, `de knop ${attribuut}="${waarde}" heeft geen click-luisteraar`);
  await fns[0]({ preventDefault() {} });
  return knop;
}

// ── 1· de grens met het bestaande portaal ───────────────────────────────────
test("licenties 1· de module maakt de portaalkern of de resellerstaat niet opnieuw aan", () => {
  // Alleen core.js mag wfpCore zijn, alleen i18n.js wfpI18n, alleen reseller.js
  // de portaalstaat. Een pagina die er zelf één maakt splitst de waarheid.
  for (const globaal of ["wfpAdmin", "wfpCore", "wfpI18n", "wfp_resellerInit", "WorkFlowProPlatformRouter"]) {
    assert.equal(new RegExp(`window\\.${globaal}\\s*=`).test(code), false,
      `de pagina wijst window.${globaal} toe · die hoort ergens anders thuis`);
  }
  // De portaalstaat van reseller.js blijft daar: geen tweede exemplaar van de
  // klanten-, grootboek- of aanvragenlijst van het portaal.
  assert.match(portaalSrc, /const state = \{ view: "dashboard"/, "de portaalstaat van reseller.js is verhuisd of hernoemd");
  assert.equal(/state\s*=\s*\{[^}]*view:\s*"dashboard"/.test(code), false,
    "de pagina kopieert de portaalstaat van reseller.js");
  // Zonder kern hoort het bestand niets te schrijven (laadvolgorde is geen aanname).
  const { win } = laad({ zonderKern: true });
  assert.deepEqual(win, {}, "zonder window.wfpCore schrijft de module toch iets");
});

test("licenties 2· de module registreert zichzelf zonder het register te wissen", () => {
  const bestaand = { dashboard: { view: "dashboard" } };
  const { win } = laad({ registerVooraf: bestaand });
  assert.ok(win.wfpResellerPages, "de pagina registreert zich nergens · ze is onbereikbaar");
  assert.equal(typeof win.wfpResellerPages.licenties.render, "function", "de renderfunctie ontbreekt in het register");
  assert.equal(win.wfpResellerPages.licenties.view, "licenties");
  assert.equal(typeof win.wfpResellerPages.licenties.label, "function", "het navigatielabel hoort een functie te zijn · anders bevriest het in één taal");
  assert.ok(win.wfpResellerPages.dashboard, "het register is overschreven in plaats van aangevuld");
  // Idempotent aanmaken · anders wist een tweede pagina de eerste.
  assert.match(code, /window\.wfpResellerPages\s*=\s*window\.wfpResellerPages\s*\|\|/);
});

// ── 2· de scope · nooit een resellerId uit de UI ────────────────────────────
test("licenties 3· de broncode kent het begrip resellerId niet als verzendveld", () => {
  // Statisch én zonder commentaar: geen querystring, geen body, geen variabele.
  assert.equal(/resellerId/.test(code), false,
    "resellerId staat in de code · de server leidt de organisatie af uit de sessie (23.6)");
});

test("licenties 4· geen enkel verzoek draagt een resellerId, ook niet de eigen", async () => {
  const { win, host, geroepen } = laad({
    routes: routes({
      "/api/reseller/license-requests": ok({
        ok: true,
        permissions: ["reseller.licenses.request"],
        requests: [{ id: "lreq_1", kind: "order", status: "draft", clientTenantId: "t-9", createdAt: "2026-07-01T10:00:00.000Z", payload: { plan: "business", seats: 5, pricing: { monthly: 120 } } }],
      }),
    }),
  });
  await win.wfpResellerPages.licenties.render(host);
  await klik(host, "rslOpen", "lreq_1");   // haalt de delegatiestatus op
  await klik(host, "rslSubmit", "lreq_1"); // schrijfactie

  assert.ok(geroepen.fetches.length >= 5, "er zijn te weinig verzoeken vertrokken om iets te bewijzen");
  for (const verzoek of geroepen.fetches) {
    assert.equal(/resellerId/i.test(String(verzoek.url)), false, `resellerId in de URL: ${verzoek.url}`);
    const body = verzoek.init && verzoek.init.body;
    if (body) assert.equal(/resellerId/i.test(String(body)), false, `resellerId in de body: ${body}`);
    assert.equal(verzoek.init.headers.Authorization, "Bearer jwt-abc", "het verzoek gaat zonder token de deur uit");
  }
  // De tenantverwijzing mag wel mee · dat is de EIGEN klant, geen andere partner.
  assert.ok(geroepen.fetches.some(f => String(f.url).includes("/api/reseller/delegated-access?tenantId=t-9")));
});

// ── 3· de weigering · generiek, zonder identifier ───────────────────────────
test("licenties 5· een 403 toont één generieke melding zonder id, code of reden", async () => {
  // De server antwoordt met een vaste body; sommige diensten geven bij andere
  // statussen wél een record-id mee. De UI mag die tekst nooit klakkeloos tonen.
  const { win, host } = laad({
    routes: routes({
      "/api/reseller/license-requests": { status: 403, body: { ok: false, error: "Geen toegang tot lreq_7f3a", code: "RESELLER_FORBIDDEN" } },
    }),
  });
  await win.wfpResellerPages.licenties.render(host);
  const html = host.innerHTML;

  assert.match(html, /«rsp\.lic\.denied»/, "de generieke weigermelding ontbreekt");
  assert.equal(html.includes("lreq_7f3a"), false, "de weigering lekt een record-id");
  assert.equal(html.includes("RESELLER_FORBIDDEN"), false, "de weigering lekt de foutcode");
  assert.equal(/403/.test(html), false, "de weigering toont de HTTP-status");
  assert.equal(/bestaat niet|niet gevonden|not found/i.test(html), false,
    "de melding zegt of het record bestaat · dat is precies de bestaanstest");
  // Geen retry-lus op een weigering: opnieuw proberen maakt van de melding een
  // teller waarmee je alsnog kunt aftasten.
  assert.equal(html.includes('id="rslRetry"'), false, "een weigering biedt een herhaalknop aan");
});

test("licenties 5b· een 404 leest exact hetzelfde als een 403", async () => {
  const maak = st => laad({
    routes: routes({ "/api/reseller/price-exceptions": { status: st, body: { ok: false, error: "PRICE_EXCEPTION_NOT_FOUND pex_9", code: "X" } } }),
  });
  const a = maak(403); const b = maak(404);
  await a.win.wfpResellerPages.licenties.render(a.host);
  await b.win.wfpResellerPages.licenties.render(b.host);
  assert.equal(a.host.innerHTML, b.host.innerHTML,
    "403 en 404 zien er verschillend uit · het verschil vertelt of het record bestaat");
  assert.equal(a.host.innerHTML.includes("pex_9"), false);
});

test("licenties 5c· een gewone serverfout blijft wél leesbaar en herhaalbaar", async () => {
  // Anti-probing mag geen excuus worden om élke fout te verdoezelen.
  const { win, host } = laad({
    routes: routes({ "/api/reseller/license-requests": { status: 503, body: { ok: false, error: "Dienst tijdelijk niet beschikbaar" } } }),
  });
  await win.wfpResellerPages.licenties.render(host);
  assert.match(host.innerHTML, /Dienst tijdelijk niet beschikbaar/);
  assert.match(host.innerHTML, /id="rslRetry"/);
});

// ── 4· rechten sturen de weergave, niet het scherm zelf ─────────────────────
const DRAFT = {
  ok: true,
  requests: [{ id: "lreq_1", kind: "order", status: "draft", clientTenantId: "t-9", createdAt: "2026-07-01T10:00:00.000Z", payload: { plan: "business", seats: 5, pricing: { monthly: 120 } } }],
};

test("licenties 6· zonder recht van de server verschijnt er geen schrijfknop", async () => {
  const { win, host } = laad({ routes: routes({ "/api/reseller/license-requests": ok(DRAFT) }) });
  await win.wfpResellerPages.licenties.render(host);
  assert.equal(host.innerHTML.includes("data-rsl-submit"), false,
    "de UI verzint een indienknop zonder dat de server het recht meestuurde");
  assert.match(host.innerHTML, /«rsp\.lic\.readOnly»/, "de leesmodus wordt niet gemeld");
  // Bedragen tonen mag wél · lezen en wijzigen zijn twee dingen.
  assert.ok(host.innerHTML.includes("120") || /€/.test(host.innerHTML), "het maandbedrag ontbreekt");
});

test("licenties 7· mét het recht verschijnt de knop, en alleen waar de server hem aanvaardt", async () => {
  const rijen = {
    ok: true,
    permissions: ["reseller.licenses.request"],
    requests: [
      DRAFT.requests[0],
      { id: "lreq_2", kind: "order", status: "applied", clientTenantId: "t-9", createdAt: "2026-07-02T10:00:00.000Z", payload: {} },
    ],
  };
  const { win, host } = laad({ routes: routes({ "/api/reseller/license-requests": ok(rijen) }) });
  await win.wfpResellerPages.licenties.render(host);
  assert.ok(host.innerHTML.includes('data-rsl-submit="lreq_1"'), "de indienknop ontbreekt op een concept");
  assert.equal(host.innerHTML.includes('data-rsl-submit="lreq_2"'), false,
    "een toegepaste aanvraag krijgt een indienknop · die overgang bestaat niet aan resellerkant");
});

test("licenties 8· indienen stuurt alleen de status, nooit prijzen of payload", async () => {
  const { win, host, geroepen } = laad({
    routes: routes({ "/api/reseller/license-requests": ok({ ok: true, permissions: { "reseller.licenses.request": true }, requests: DRAFT.requests }) }),
    val: url => (/\/transition$/.test(String(url)) ? ok({ ok: true, request: {} }) : null),
  });
  await win.wfpResellerPages.licenties.render(host);
  await klik(host, "rslSubmit", "lreq_1");

  const transitie = geroepen.fetches.find(f => /\/transition$/.test(String(f.url)));
  assert.ok(transitie, "er is geen overgang vertrokken");
  assert.equal(transitie.init.method, "POST");
  assert.match(String(transitie.url), /^\/api\/reseller\/license-requests\/lreq_1\/transition$/);
  assert.deepEqual(JSON.parse(transitie.init.body), { to: "submitted" },
    "de UI stuurt meer dan de status mee · prijs en payload horen van de server te blijven");
  assert.deepEqual(geroepen.toasts, [{ tekst: "«rsp.lic.submitted»", soort: "success" }]);
});

test("licenties 8b· een geweigerde schrijfactie meldt generiek en breekt de pagina niet", async () => {
  const { win, host, geroepen } = laad({
    routes: routes({ "/api/reseller/license-requests": ok({ ok: true, permissions: ["reseller.licenses.request"], requests: DRAFT.requests }) }),
    val: url => (/\/transition$/.test(String(url)) ? { status: 403, body: { ok: false, error: "Geen toegang tot lreq_1", code: "RESELLER_FORBIDDEN" } } : null),
  });
  await win.wfpResellerPages.licenties.render(host);
  await klik(host, "rslSubmit", "lreq_1");

  assert.deepEqual(geroepen.toasts, [{ tekst: "«rsp.lic.denied»", soort: "error" }],
    "de weigering van een schrijfactie toont de servertekst in plaats van de generieke melding");
  assert.ok(host.innerHTML.includes("data-rsl-submit"), "de lijst is verdwenen na een weigering");
});

// ── 5· klantinhoud vereist een actieve gedelegeerde toegang ─────────────────
const MET_MODULES = {
  ok: true,
  requests: [{
    id: "lreq_3", kind: "order", status: "submitted", clientTenantId: "t-9", createdAt: "2026-07-01T10:00:00.000Z",
    payload: { plan: "business", seats: 5, modules: ["planning", "invoicing"], pricing: { monthly: 120 } },
  }],
};

test("licenties 9· zonder actieve grant blijft de klantconfiguratie dicht", async () => {
  const { win, host } = laad({
    routes: routes({
      "/api/reseller/license-requests": ok(MET_MODULES),
      // Verlopen grant · statusveld zegt "active", de einddatum zegt nee.
      "/api/reseller/delegated-access": ok({ ok: true, grants: [{ status: "active", startDate: "2020-01-01T00:00:00.000Z", endDate: "2020-02-01T00:00:00.000Z" }] }),
    }),
  });
  await win.wfpResellerPages.licenties.render(host);
  await klik(host, "rslOpen", "lreq_3");

  assert.match(host.innerHTML, /«rsp\.lic\.contentShielded»/, "de afschermmelding ontbreekt");
  assert.equal(host.innerHTML.includes("invoicing"), false, "de modules van de klant staan er tóch");
  // De commerciële metadata blijft wel zichtbaar · dat is het hele punt.
  assert.match(host.innerHTML, /«rsp\.plan»/);
});

test("licenties 10· mét een actieve grant komt de configuratie er wél bij", async () => {
  const morgen = new Date(Date.now() + 86400000).toISOString();
  const { win, host } = laad({
    routes: routes({
      "/api/reseller/license-requests": ok(MET_MODULES),
      "/api/reseller/delegated-access": ok({ ok: true, grants: [{ status: "active", startDate: "2020-01-01T00:00:00.000Z", endDate: morgen, scope: ["support_read"] }] }),
    }),
  });
  await win.wfpResellerPages.licenties.render(host);
  await klik(host, "rslOpen", "lreq_3");
  assert.match(host.innerHTML, /invoicing/, "de configuratie blijft dicht ondanks een actieve delegatie");
  assert.equal(host.innerHTML.includes("«rsp.lic.contentShielded»"), false);
});

test("licenties 11· een mislukte delegatiecontrole faalt DICHT", async () => {
  const { win, host } = laad({
    routes: routes({
      "/api/reseller/license-requests": ok(MET_MODULES),
      "/api/reseller/delegated-access": { status: 500, body: { ok: false, error: "boem" } },
    }),
  });
  await win.wfpResellerPages.licenties.render(host);
  await klik(host, "rslOpen", "lreq_3");
  assert.match(host.innerHTML, /«rsp\.lic\.contentShielded»/, "een kapotte controle opent de klantinhoud");
  assert.equal(host.innerHTML.includes("invoicing"), false);
});

// ── 6· bedragen: tonen wat de server stuurt, niets uitrekenen ───────────────
test("licenties 12· een prijs op aanvraag is niet nul", async () => {
  const { win, host } = laad({
    routes: routes({
      "/api/reseller/license-requests": ok({
        ok: true,
        requests: [{ id: "lreq_4", kind: "seat_change", status: "submitted", clientTenantId: "t-9", createdAt: "2026-07-01T10:00:00.000Z", payload: { currentSeats: 5, requestedSeats: 9, proration: { monthlyDelta: null } } }],
      }),
    }),
  });
  await win.wfpResellerPages.licenties.render(host);
  assert.match(host.innerHTML, /«rsp\.onRequest»/, "een onbekende prijs wordt als bedrag getoond · null is geen 0");
  assert.equal(/€\s?0/.test(host.innerHTML), false);
});

test("licenties 13· de marge wordt getoond, nooit berekend", async () => {
  // Marge is een gevoelige dataklasse (CTO3-07). Stuurt de server hem niet mee,
  // dan mag de UI hem niet uit lijstprijs en korting terugrekenen.
  const { win, host } = laad({
    routes: routes({
      "/api/reseller/price-exceptions": ok({
        ok: true,
        exceptions: [{ id: "pex_1", clientTenantId: "t-9", listPrice: 1000, requestedPrice: 800, discountPct: 20, status: "pending", expiry: "2026-12-01T00:00:00.000Z", requiredApprovals: 1, approvals: [] }],
      }),
    }),
  });
  await win.wfpResellerPages.licenties.render(host);
  assert.equal(/\b80%/.test(host.innerHTML), false, "de marge is zelf uitgerekend in plaats van gelezen");
  assert.equal(/100\s*-\s*[A-Za-z.]*[Dd]iscount/.test(code), false, "de pagina rekent een marge uit");
  // Wat de server wél stuurt, hoort er te staan.
  assert.match(host.innerHTML, /20%/, "de korting die de server meestuurde ontbreekt");
});

test("licenties 13b· het soortfilter beperkt de lijst zonder een nieuw verzoek", async () => {
  const { win, host, geroepen } = laad({
    routes: routes({
      "/api/reseller/license-requests": ok({
        ok: true,
        requests: [
          { id: "lreq_a", kind: "order", status: "submitted", clientTenantId: "t-9", createdAt: "2026-07-01T10:00:00.000Z", payload: {} },
          { id: "lreq_b", kind: "cancellation", status: "submitted", clientTenantId: "t-9", createdAt: "2026-07-02T10:00:00.000Z", payload: { scope: "full", date: "2026-09-01T00:00:00.000Z" } },
        ],
      }),
    }),
  });
  await win.wfpResellerPages.licenties.render(host);
  const voor = geroepen.fetches.length;
  const select = host.geknipt.find(el => el.id === "rslKind");
  assert.ok(select, "het soortfilter is niet gebonden");
  select.luisteraars.change[0]({ target: { value: "cancellation" } });

  assert.ok(host.innerHTML.includes('data-rsl-open="lreq_b"'));
  assert.equal(host.innerHTML.includes('data-rsl-open="lreq_a"'), false, "het filter beperkt de lijst niet");
  assert.equal(geroepen.fetches.length, voor, "een filterkeuze gaat opnieuw naar de server");
});

// ── 7· huisregels ───────────────────────────────────────────────────────────
test("licenties 14· geen em-dash in gebruikerszichtbare tekst", () => {
  assert.equal(src.includes("—"), false, "gebruik '-' of '·'");
});

test("licenties 15· elke zichtbare tekst loopt via een i18n-sleutel met NL-fallback", () => {
  const sleutels = [...src.matchAll(/tR\("([^"]+)",\s*"([^"]*)"\)/g)];
  assert.ok(sleutels.length >= 40, `te weinig vertaalde teksten (${sleutels.length})`);
  for (const [, sleutel] of sleutels) {
    assert.match(sleutel, /^(rsp|adm)\./, `sleutel ${sleutel} valt buiten de naamruimte van het portaal`);
  }
  // Sleutels die het portaal al gebruikt, worden hergebruikt en niet gedupliceerd.
  const gebruikt = sleutels.map(m => m[1]);
  for (const hergebruik of ["rsp.plan", "rsp.onRequest", "rsp.notAvailable", "adm.status", "adm.thCustomer"]) {
    assert.ok(gebruikt.includes(hergebruik), `${hergebruik} bestaat al in het portaal en hoort hergebruikt te worden`);
  }
});

test("licenties 16· browsercode zonder buildstap laadt niets via require of import", () => {
  assert.equal(/\brequire\(|^import /m.test(code), false);
});
