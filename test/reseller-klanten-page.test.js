"use strict";
// ── Resellerportaal · pagina "Klanten en tenantaanvragen" (CTO3-09) ──────────
//
// Deze pagina toont geld en klantnamen aan een partij die GEEN tenantgebruiker
// is. Drie eigenschappen mogen daarom nooit stilletjes wegvallen, en ze zijn
// alle drie hier vastgepind door de module echt te laden en te laten tekenen:
//
//   1. de module hangt zichzelf in het paginaregister en herdefinieert de
//      gedeelde kern of de portaalstate van reseller.js NIET;
//   2. er gaat nooit een resellerId vanuit de UI naar de server · de server
//      leidt de organisatie af uit de sessie (23.6);
//   3. een weigering wordt een generieke melding · geen id, geen servercode,
//      geen "bestaat niet" (dat zou een bestaans-oracle zijn).
//
// De tests draaien de bron in een vm-sandbox met een nagebootst window en een
// minimale DOM. Structuurcontroles alleen zijn te makkelijk te vervalsen: een
// generieke melding bewijs je door hem te laten renderen.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MOD = path.join(__dirname, "..", "public", "js", "platforms", "reseller-klanten.js");
const src = fs.readFileSync(MOD, "utf8").replace(/\r\n/g, "\n");

/** Broncode zonder commentaar · anders keurt een test een uitleg af. */
function code(input) {
  return input.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ── Nagebootste DOM ─────────────────────────────────────────────────────────
// Geen jsdom (geen npm-dependencies): een element dat innerHTML bijhoudt, de
// knoppen uit die opmaak teruggeeft en hun klik kan afvuren. Genoeg om het
// echte gedrag te meten in plaats van de bron te lezen.
function maakElement() {
  const knoppen = new Map(); // sleutel → clickhandler van de laatste render
  const maakKnop = sleutel => ({
    getAttribute: () => sleutel,
    setAttribute() {},
    focus() {},
    addEventListener(soort, fn) { if (soort === "click") knoppen.set(sleutel, fn); }
  });
  return {
    innerHTML: "",
    attrs: {},
    setAttribute(naam, waarde) { this.attrs[naam] = waarde; },
    removeAttribute(naam) { delete this.attrs[naam]; },
    querySelectorAll(selector) {
      if (selector !== "[data-rspk-tenant]") return [];
      return [...this.innerHTML.matchAll(/data-rspk-tenant="([^"]+)"/g)].map(m => maakKnop(m[1]));
    },
    querySelector(selector) {
      if (selector === "[data-rspk-retry]" && this.innerHTML.includes("data-rspk-retry")) {
        return maakKnop("__retry");
      }
      return null;
    },
    /** Vuur de klik van een knop af, zoals een gebruiker dat zou doen. */
    klik(sleutel) {
      const fn = knoppen.get(sleutel);
      if (!fn) throw new Error(`er is geen knop "${sleutel}" in de pagina`);
      return fn();
    }
  };
}

/**
 * Laad de module met een nagebootst window en een fetch die per pad antwoordt.
 * `routes` is pad-prefix → { status, body }. Alle opgevraagde URL's worden
 * bijgehouden zodat een test kan controleren wat er ECHT de deur uit ging.
 */
function laad(routes, extraWindow) {
  const verzoeken = [];
  const window = {
    wfpCore: {
      token: () => "test-token",
      esc: v => String(v == null ? "" : v).replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
    },
    ...(extraWindow || {})
  };
  const sandbox = {
    window,
    localStorage: { getItem: () => "test-token", removeItem() {} },
    fetch(url, opts) {
      verzoeken.push({ url, opts: opts || {} });
      const route = Object.keys(routes).find(p => String(url).startsWith(p));
      const antwoord = route ? routes[route] : { status: 404, body: { ok: false, error: "Not found" } };
      return Promise.resolve({
        ok: antwoord.status >= 200 && antwoord.status < 300,
        status: antwoord.status,
        json: () => Promise.resolve(antwoord.body)
      });
    },
    setTimeout, clearTimeout, console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "reseller-klanten.js" });
  return { window, sandbox, verzoeken };
}

// Realistische antwoorden · de veldnamen komen uit src/http/routes/
// reseller-portal.js en src/modules/reseller-tenants.js, niet uit de duim.
const CLIENTS = {
  ok: true,
  reseller: { name: "Partner BV", defaultCommissionPct: 15 },
  clientCount: 2, totalMrr: 300, unpricedCount: 1, totalCommission: 45,
  rows: [
    { tenantId: "tenant_1", name: "Klant Een", plan: "business", status: "active", mrr: 300, unpriced: false, commissionPct: 15, commission: 45 },
    { tenantId: "tenant_2", name: "Klant Twee", plan: "enterprise", status: "trial", mrr: null, unpriced: true, commissionPct: 15, commission: 0 }
  ]
};
const ASSIGNED = {
  ok: true,
  tenants: [{
    linkId: "rtl_1", tenantId: "tenant_1", relationType: "commercial",
    startAt: "2026-01-01T00:00:00.000Z", endAt: null,
    tenant: {
      tenantId: "tenant_1", name: "Klant Een", plan: "business", status: "active",
      seats: 12, language: "NL", billingOwnership: "monargo_direct",
      renewal: "2027-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z"
    }
  }]
};
const REQUESTS = {
  ok: true,
  requests: [{
    id: "rtq_geheim01", resellerId: "res_1", status: "submitted",
    endCustomer: { legalName: "Nieuwe Klant NV", language: "NL" },
    package: { plan: "starter" }, createdAt: "2026-07-01T09:00:00.000Z"
  }]
};

const ALLES_OK = {
  "/api/reseller/clients": { status: 200, body: CLIENTS },
  "/api/reseller/assigned-tenants": { status: 200, body: ASSIGNED },
  "/api/reseller/tenant-requests": { status: 200, body: REQUESTS },
  "/api/reseller/delegated-access": { status: 200, body: { ok: true, grants: [] } }
};

/** Wacht tot de render en de erop volgende metingen zijn uitgekomen. */
async function rust() {
  for (let i = 0; i < 6; i += 1) await new Promise(r => setTimeout(r, 0));
}

/** Een lopende delegatie zoals requestDelegatedAccess ze opslaat (23.12). */
function grant(velden) {
  return {
    id: "rag_geheim01", resellerId: "res_1", tenantId: "tenant_1",
    scope: ["onboarding_view"], reason: "onboarding begeleiden",
    status: "active", revokedAt: null,
    startAt: "2026-07-01T00:00:00.000Z", endAt: "2099-01-01T00:00:00.000Z",
    ...velden
  };
}

// ── 1 · Registratie zonder de gedeelde context te kapen ─────────────────────

test("RKP 1· de module registreert zichzelf in het paginaregister", async () => {
  // Een bestaande registratie van een andere pagina blijft staan: het register
  // wordt gelezen, nooit vervangen.
  const { window } = laad(ALLES_OK, { wfpResellerPages: { verdiensten: { id: "verdiensten" } } });
  assert.ok(window.wfpResellerPages, "het paginaregister is niet aangemaakt");
  assert.equal(window.wfpResellerPages.verdiensten.id, "verdiensten", "een andere pagina is weggeveegd");
  const pagina = window.wfpResellerPages.klanten;
  assert.equal(typeof pagina, "object");
  assert.equal(typeof pagina.render, "function");
  assert.equal(pagina.id, "klanten");
  // Label en kopteksten zijn FUNCTIES · anders bevriest de taal van het
  // laadmoment en verandert een taalwissel de navigatie niet meer.
  assert.equal(typeof pagina.label, "function");
  assert.equal(typeof pagina.meta, "function");
  assert.ok(pagina.label().length > 0);
  assert.ok(pagina.meta().title.length > 0);
});

test("RKP 2· de module definieert wfpAdmin, wfpCore en de portaalstate NIET opnieuw", async () => {
  // Structureel: de verboden toewijzingen staan nergens in de code.
  const zonderCommentaar = code(src);
  for (const global of ["window.wfpAdmin", "window.wfpCore", "window.wfpI18n", "window.wfp_resellerInit"]) {
    assert.equal(new RegExp(`${global.replace(".", "\\.")}\\s*=[^=]`).test(zonderCommentaar), false,
      `${global} wordt hier toegewezen · dan zijn er twee waarheden`);
  }
  // En gedragsmatig: laden mag niets van het portaal overschrijven.
  const bestaandeInit = () => "portaal";
  const bestaandeState = { view: "dashboard" };
  const { window } = laad(ALLES_OK, { wfp_resellerInit: bestaandeInit, wfpResellerState: bestaandeState });
  assert.equal(window.wfpAdmin, undefined, "de admin-context hoort hier niet aangemaakt te worden");
  assert.equal(window.wfp_resellerInit, bestaandeInit, "de portaal-init is overschreven");
  assert.deepEqual(window.wfpResellerState, { view: "dashboard" }, "de portaalstate is aangeraakt");
  assert.equal(typeof window.wfpCore.token, "function", "de gedeelde kern is vervangen");
});

test("RKP 3· zonder de gedeelde kern haakt de module stil af", () => {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "reseller-klanten.js" });
  assert.equal(sandbox.window.wfpResellerPages, undefined,
    "zonder window.wfpCore hoort het bestand niets te registreren");
});

// ── 2 · Nooit een resellerId vanuit de UI ───────────────────────────────────

test("RKP 4· er gaat nergens een resellerId van de UI naar de server", async () => {
  // Structureel: de naam komt in de code van dit bestand niet voor.
  assert.equal(/resellerId/.test(code(src)), false,
    "resellerId staat in de code · de server hoort de organisatie uit de sessie af te leiden");

  // Gedragsmatig: geen enkel echt verzoek draagt hem, ook niet na het openen
  // van een klantdetail · dat is het pad dat delegated-access opvraagt, waar
  // de body van de POST-variant wél een resellerId kent.
  const { window, verzoeken } = laad(ALLES_OK);
  const el = maakElement();
  await window.wfpResellerPages.klanten.render(el);
  await rust();
  await el.klik("tenant_1");
  await rust();

  assert.ok(verzoeken.some(v => String(v.url).startsWith("/api/reseller/delegated-access")),
    "het detailpaneel heeft de gedelegeerde toegang niet opgevraagd");
  assert.ok(verzoeken.length >= 4, "de pagina heeft niets opgehaald");
  for (const { url, opts } of verzoeken) {
    assert.equal(/resellerId/i.test(String(url)), false, `resellerId zit in de URL: ${url}`);
    assert.equal(/resellerId/i.test(String(opts.body || "")), false, `resellerId zit in de body van ${url}`);
    // Deze pagina leest alleen · een schrijfactie hoort hier niet te ontstaan.
    assert.equal(String(opts.method || "GET").toUpperCase(), "GET", `${url} is geen GET`);
  }
});

test("RKP 5· de pagina toont de commerciële gegevens die de server teruggaf", async () => {
  const { window, verzoeken } = laad(ALLES_OK);
  const el = maakElement();
  await window.wfpResellerPages.klanten.render(el);
  await rust();

  assert.match(el.innerHTML, /Klant Een/);
  assert.match(el.innerHTML, /Klant Twee/);
  assert.match(el.innerHTML, /Nieuwe Klant NV/, "de tenantaanvragen ontbreken");
  // Op aanvraag geprijsde klanten tonen geen verzonnen bedrag.
  assert.match(el.innerHTML, /Op aanvraag/);
  // Klantinhoud staat standaard dicht: pas een bevestigde actieve delegatie
  // kantelt die badge · onbekend blijft afgeschermd.
  assert.match(el.innerHTML, /Afgeschermd/);
  assert.equal(/Actieve toegang/.test(el.innerHTML), false,
    "zonder actieve grant hoort er geen toegangsbadge te staan");
  // Alleen de drie leesroutes van deze pagina.
  assert.deepEqual(verzoeken.map(v => v.url).sort(), [
    "/api/reseller/assigned-tenants", "/api/reseller/clients", "/api/reseller/tenant-requests"
  ]);
});

test("RKP 6· een klant zonder commerciële cijfers krijgt geen verzonnen bedrag", async () => {
  // Een koppeling die niet in het commerciële overzicht voorkomt: dan is er
  // geen MRR bekend. "€ 0,00" zou lezen als "deze klant brengt niets op".
  const { window } = laad({
    ...ALLES_OK,
    "/api/reseller/assigned-tenants": {
      status: 200,
      body: {
        ok: true,
        tenants: [{
          linkId: "rtl_9", tenantId: "tenant_9", relationType: "support",
          startAt: "2026-05-01T00:00:00.000Z", endAt: null,
          tenant: { tenantId: "tenant_9", name: "Klant Negen", plan: "starter", status: "active", seats: 3 }
        }]
      }
    }
  });
  const el = maakElement();
  await window.wfpResellerPages.klanten.render(el);
  await rust();

  const rijVanNegen = el.innerHTML.split("Klant Negen")[1].split("</tr>")[0];
  assert.equal(/€/.test(rijVanNegen), false, "er staat een verzonnen bedrag bij een klant zonder cijfers");
  // De klant die wél cijfers heeft, toont ze gewoon.
  const rijVanEen = el.innerHTML.split("Klant Een")[1].split("</tr>")[0];
  assert.match(rijVanEen, /€/);
});

// ── 3 · Klantinhoud vereist een ACTIEVE gedelegeerde toegang ────────────────

test("RKP 7· zonder lopende delegatie blijft de klantinhoud afgeschermd", async () => {
  // Een ingetrokken en een verlopen grant: allebei geen toegang. De pagina
  // mag geen van beide als "actief" tekenen.
  const { window } = laad({
    ...ALLES_OK,
    "/api/reseller/delegated-access": {
      status: 200,
      body: {
        ok: true,
        grants: [
          grant({ status: "revoked", revokedAt: "2026-07-02T00:00:00.000Z" }),
          grant({ status: "active", endAt: "2026-01-01T00:00:00.000Z" }),
          grant({ status: "requested" })
        ]
      }
    }
  });
  const el = maakElement();
  await window.wfpResellerPages.klanten.render(el);
  await rust();
  await el.klik("tenant_1");
  await rust();

  assert.match(el.innerHTML, /Geen actieve gedelegeerde toegang/);
  assert.equal(/Actieve toegang/.test(el.innerHTML), false,
    "een ingetrokken of verlopen grant wordt als toegang getekend");
  // Wat er wél staat is uitsluitend commerciële metadata.
  assert.match(el.innerHTML, /Gebruikers/);
  assert.match(el.innerHTML, /Commercieel/);
  // En de belofte staat er met zoveel woorden bij.
  assert.match(el.innerHTML, /uitsluitend commerci/i);
});

test("RKP 8· een lopende delegatie toont bereik en einddatum", async () => {
  const { window, verzoeken } = laad({
    ...ALLES_OK,
    "/api/reseller/delegated-access": { status: 200, body: { ok: true, grants: [grant()] } }
  });
  const el = maakElement();
  await window.wfpResellerPages.klanten.render(el);
  await rust();
  await el.klik("tenant_1");
  await rust();

  assert.match(el.innerHTML, /Actieve toegang/);
  assert.match(el.innerHTML, /Onboarding inzien/, "het bereik van de delegatie ontbreekt");
  // De tenant komt mee in de query (die eist de route), de reseller niet.
  const meting = verzoeken.find(v => String(v.url).startsWith("/api/reseller/delegated-access"));
  assert.equal(meting.url, "/api/reseller/delegated-access?tenantId=tenant_1");
  // Ook een grant-id hoort niet in de pagina te belanden.
  assert.equal(el.innerHTML.includes("rag_geheim01"), false);
});

// ── 4 · Weigeringen ─────────────────────────────────────────────────────────

test("RKP 9· een geweigerde toegangsmeting lekt niets in het detailpaneel", async () => {
  const { window } = laad({
    ...ALLES_OK,
    "/api/reseller/delegated-access": {
      status: 403,
      body: { ok: false, error: "grant rag_geheim01 hoort bij reseller res_42", code: "RESELLER_FORBIDDEN" }
    }
  });
  const el = maakElement();
  await window.wfpResellerPages.klanten.render(el);
  await rust();
  await el.klik("tenant_1");
  await rust();

  for (const geheim of ["rag_geheim01", "res_42", "RESELLER_FORBIDDEN"]) {
    assert.equal(el.innerHTML.includes(geheim), false, `"${geheim}" lekt in het detailpaneel`);
  }
  assert.match(el.innerHTML, /Geen toegang/);
  assert.equal(/Actieve toegang/.test(el.innerHTML), false,
    "een weigering mag nooit als toegang gelezen worden");
});

test("RKP 10· een 403 toont een generieke melding zonder identifier", async () => {
  // Een server die (fout of niet) een id en een reden meestuurt: niets daarvan
  // mag de pagina halen.
  const lek = {
    ok: false,
    error: "tenantaanvraag rtq_geheim01 bestaat niet voor reseller res_42",
    code: "TENANT_REQUEST_NOT_FOUND"
  };
  const { window } = laad({
    "/api/reseller/clients": { status: 200, body: CLIENTS },
    "/api/reseller/assigned-tenants": { status: 403, body: lek },
    "/api/reseller/tenant-requests": { status: 403, body: lek }
  });
  const el = maakElement();
  await window.wfpResellerPages.klanten.render(el);
  await rust();

  for (const geheim of ["rtq_geheim01", "res_42", "bestaat niet", "TENANT_REQUEST_NOT_FOUND"]) {
    assert.equal(el.innerHTML.includes(geheim), false,
      `"${geheim}" staat in de pagina · dat is een bestaans-oracle`);
  }
  assert.match(el.innerHTML, /Geen toegang/, "er staat geen generieke melding");
  // De rest van de pagina blijft leesbaar: een geweigerd deel sloopt niet alles.
  assert.match(el.innerHTML, /Klant Een/);
});

test("RKP 11· een 403 op de hele pagina lekt evenmin", async () => {
  const { window } = laad({
    "/api/reseller/clients": {
      status: 403,
      body: { ok: false, error: "reseller res_42 is niet actief", code: "RESELLER_NOT_ACTIVE" }
    }
  });
  const el = maakElement();
  await window.wfpResellerPages.klanten.render(el);
  await rust();

  for (const geheim of ["res_42", "RESELLER_NOT_ACTIVE", "niet actief"]) {
    assert.equal(el.innerHTML.includes(geheim), false, `"${geheim}" lekt in het foutscherm`);
  }
  assert.match(el.innerHTML, /Geen toegang/);
  assert.match(el.innerHTML, /data-rspk-retry/, "de gebruiker kan het niet opnieuw proberen");
});

test("RKP 12· de generieke melding is één tekst, ongeacht de oorzaak", () => {
  // Eén bron voor de weigertekst: wie er een tweede naast zet, laat ze op
  // termijn uit elkaar lopen en verraadt zo alsnog het verschil.
  const zonderCommentaar = code(src);
  assert.equal((zonderCommentaar.match(/rsp\.forbidden"/g) || []).length, 1,
    "de weigertekst wordt op meer dan één plek gedefinieerd");
  assert.match(zonderCommentaar, /function weigering|const weigering/);
});

// ── 5 · Huisregels ──────────────────────────────────────────────────────────

test("RKP 13· de pagina schrijft niet en verzint geen knoppen", () => {
  const zonderCommentaar = code(src);
  for (const methode of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(zonderCommentaar.includes(`"${methode}"`), false,
      `${methode} staat in een leespagina · rechten om te schrijven stuurt de server niet mee`);
  }
  // De enige aanroepen naar api() zijn GET's.
  const methoden = [...zonderCommentaar.matchAll(/api\(\s*"([A-Z]+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(methoden)], ["GET"]);
});

test("RKP 14· alle zichtbare tekst loopt via i18n met een NL-fallback", () => {
  const sleutels = [...src.matchAll(/tR\(\s*"([^"]+)"\s*,\s*"([^"]*)"/g)];
  assert.ok(sleutels.length > 25, "er zijn opvallend weinig vertaalde teksten");
  for (const [, sleutel, fallback] of sleutels) {
    assert.match(sleutel, /^(rsp|adm)\./, `${sleutel} valt buiten de portaalnaamruimte`);
    assert.notEqual(fallback.trim(), "", `${sleutel} heeft een lege NL-fallback`);
  }
  // Kale tekst in de opmaak (buiten tR) is hier de valkuil: die blijft
  // Nederlands voor een FR- of EN-gebruiker.
  assert.equal(/>\s*[A-Z][a-z]{3,}[^<>{}]*<\/(strong|span|p|h1|dt)>/.test(
    src.replace(/\$\{[^}]*\}/g, "")), false, "er staat kale tekst in de opmaak");
});

test("RKP 15· geen em-dash in het bestand", () => {
  assert.equal(src.includes("—"), false, "em-dash gevonden · gebruik '-' of '·'");
});
