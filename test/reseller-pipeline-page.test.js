"use strict";
// ── Resellerportaal · pagina "Pipeline & deals" (CTO3-09) ────────────────────
//
// De pagina is browsercode zonder buildstap; ze draait hier in een node:vm-
// sandbox met een nagebootste window/document, net als de admin-werkruimtes.
// Getoetst wordt GEDRAG en GRENS, niet dat een string bestaat:
//
//   1· de grens: de module registreert zichzelf in het paginaregister van het
//      portaal en herdefinieert de gedeelde context niet (geen wfpAdmin, geen
//      tweede portaalstate, geen tweede wfpCore);
//   2· de scoping: er vertrekt nergens een organisatie-id vanuit de UI · de
//      server leidt de reseller af uit de sessie (23.6 · ISO-03);
//   3· de weigering: 403 en 404 tonen dezelfde generieke melding zonder id en
//      zonder de reden "bestaat niet" (23.15 · anti-probing);
//   4· klantinhoud blijft dicht zonder ACTIEVE gedelegeerde toegang (23.12);
//   5· de UI verzint geen beoordelingsknoppen (deals.approve is Monargo-zijde).
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const MOD = path.join(ROOT, "public", "js", "platforms", "reseller-pipeline.js");
const PORTAL = path.join(ROOT, "public", "js", "platforms", "reseller.js");

// Regeleindes normaliseren: git zet ze op Windows naar CRLF zodra hij het
// bestand aanraakt, en dan matcht een patroon met \n opeens niets meer.
const src = fs.readFileSync(MOD, "utf8").replace(/\r\n/g, "\n");
const portalSrc = fs.readFileSync(PORTAL, "utf8").replace(/\r\n/g, "\n");

/** Broncode zonder commentaar · anders faalt een grenstest op een uitleg. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ── Nagebootste browser ─────────────────────────────────────────────────────
function maakElement(id) {
  return {
    id, innerHTML: "", textContent: "", value: "", dataset: {}, style: {},
    attributen: {}, luisteraars: {}, _data: {},
    addEventListener(type, fn) { (this.luisteraars[type] = this.luisteraars[type] || []).push(fn); },
    setAttribute(naam, waarde) { this.attributen[naam] = waarde; },
    removeAttribute(naam) { delete this.attributen[naam]; },
    getAttribute(naam) { return this.attributen[naam]; },
    querySelectorAll() { return []; },
    focus() {}, remove() {},
  };
}

function maakDocument(ids) {
  const els = new Map();
  for (const id of ids) els.set(id, maakElement(id));
  return {
    els,
    body: maakElement("body"),
    getElementById(id) { return els.get(id) || null; },
    querySelectorAll() { return []; },
    createElement(tag) { return maakElement(tag); },
  };
}

/**
 * Laadt de pagina in een kale sandbox. `antwoorden` is een functie
 * (method, url, body) → {status, data}; elk verzoek wordt vastgelegd zodat een
 * test kan zien WAT er precies de deur uit ging.
 */
function laad(opties) {
  const cfg = opties || {};
  const verzoeken = [];
  const toasts = [];
  const doc = maakDocument(cfg.ids || ["rspPipelineNew", "rspPipelineForm", "rspPipelineRetry", "rspPipelineMessage"]);
  const win = {};
  if (!cfg.zonderKern) {
    win.wfpCore = {
      token: () => "jwt-partner",
      esc: v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    };
    win.showToast = (tekst, soort) => toasts.push({ tekst, soort });
  }
  // Een pagina die eerder geladen werd · laadvolgorde is geen aanname.
  if (cfg.vooraf) win.wfpResellerPages = { bestaand: { id: "bestaand" } };
  const sandbox = {
    window: win, document: doc, console,
    localStorage: { removeItem() {}, getItem() { return "jwt-partner"; } },
    FormData: class { constructor(form) { this._d = (form && form._data) || {}; } entries() { return Object.entries(this._d); } },
    fetch: async (url, init) => {
      const method = (init && init.method) || "GET";
      const body = init && init.body ? JSON.parse(init.body) : null;
      verzoeken.push({ url, method, body, headers: (init && init.headers) || {} });
      const antwoord = (cfg.antwoorden || (() => ({ status: 200, data: { ok: true, deals: [] } })))(method, url, body);
      return {
        ok: antwoord.status >= 200 && antwoord.status < 300,
        status: antwoord.status,
        json: async () => antwoord.data || {},
      };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "reseller-pipeline.js" });
  return { win, doc, verzoeken, toasts, pagina: win.wfpResellerPages && win.wfpResellerPages.pipeline };
}

/** Container waarin de pagina monteert · zelfde vorm als het portaal-main. */
function maakHost() { return maakElement("rspMain"); }

/** Vuurt de eerste luisteraar van een element af. */
function vuur(doc, id, type, event) {
  const el = doc.getElementById(id);
  assert.ok(el, `element ${id} bestaat niet in de nagebootste DOM`);
  const fns = el.luisteraars[type] || [];
  assert.equal(fns.length > 0, true, `${id} heeft geen ${type}-luisteraar · de bedrading is weg`);
  return fns[0](Object.assign({ preventDefault() {}, stopPropagation() {}, target: el }, event || {}));
}

/** Klik op de gedelegeerde luisteraar van de container, met een nagebootste rij. */
function klikOpHost(host, attribuut, waarde) {
  const knoop = {
    dataset: { [attribuut === "data-rsp-deal" ? "rspDeal" : "rspSubmitDeal"]: waarde },
    getAttribute: naam => (naam === attribuut ? waarde : null),
  };
  const target = { closest: sel => (sel === `[${attribuut}]` ? knoop : null) };
  const fns = host.luisteraars.click || [];
  assert.equal(fns.length, 1, "de container hoort precies EEN gedelegeerde luisteraar te hebben");
  return fns[0]({ preventDefault() {}, target });
}

const tik = () => new Promise(r => setTimeout(r, 0));

function deal(extra) {
  return Object.assign({
    id: "deal_9f3a", prospectCompany: "Bouwwerken Peeters", prospectCountry: "BE",
    enterpriseOrVatNumber: "BE0123456789", status: "submitted",
    sourceEvidence: { type: "email", reference: "mail-771" },
    estimatedValue: 12000, currency: "EUR", products: [],
    registeredAt: "2026-05-02T09:00:00.000Z", expiryAt: "2026-07-31T09:00:00.000Z",
    rejectionReason: null, attributionPercent: null, attribution: null,
    conversion: null, convertedAt: null, inConflict: false, version: 1,
  }, extra || {});
}

// ── 1· de grens met het bestaande portaal ───────────────────────────────────
test("pipeline 1· de module registreert zichzelf en herdefinieert niets van het portaal", () => {
  const schoon = code(src);
  assert.equal(/window\.wfpAdmin/.test(schoon), false,
    "dit is het resellerportaal, niet de admin-monoliet · window.wfpAdmin hoort hier niet");
  assert.equal(/window\.wfpCore\s*=/.test(schoon), false, "de gedeelde kern wordt hier opnieuw gezet");
  assert.equal(/window\.wfp_resellerInit\s*=/.test(schoon), false,
    "reseller.js is de enige die de portaalshell start");
  assert.equal(/function buildShell|function switchView|function loadData/.test(schoon), false,
    "de portaalshell wordt hier nagebouwd · dan bestaan er twee waarheden");
  // De portaalstate (clients/ledger/requests) blijft van reseller.js.
  assert.match(portalSrc, /const state = \{ view: "dashboard", clients: null/);
  assert.equal(/\bclients: null|\bledger: null|\brequests: null/.test(schoon), false,
    "de portaalstate is hier gekopieerd in plaats van gelaten waar ze hoort");

  // Registreren gebeurt idempotent in het gedeelde paginaregister.
  assert.match(schoon, /window\.wfpResellerPages = window\.wfpResellerPages \|\| \{\}/);
  const { win, pagina } = laad();
  assert.equal(typeof pagina, "object", "de pagina staat niet in het register · ze is onbereikbaar");
  for (const naam of ["mount", "render", "load", "bind", "meta"]) {
    assert.equal(typeof pagina[naam], "function", `pipeline.${naam} ontbreekt`);
  }
  assert.equal(win.wfpAdmin, undefined, "de admin-context wordt aangemaakt vanuit het resellerportaal");
});

test("pipeline 1b· een bestaande registratie wordt aangevuld, niet weggeveegd", () => {
  // Laadvolgorde is geen aanname: een tweede pagina die eerder geladen werd
  // moet blijven staan.
  const { win } = laad({ vooraf: true, ids: [] });
  assert.equal(typeof win.wfpResellerPages.pipeline, "object", "de eigen registratie ontbreekt");
  assert.deepEqual(win.wfpResellerPages.bestaand, { id: "bestaand" },
    "het paginaregister is overschreven in plaats van aangevuld");
});

test("pipeline 1c· zonder de gedeelde kern schrijft de module niets", () => {
  const { win } = laad({ zonderKern: true });
  assert.deepEqual(win, {}, "zonder wfpCore hoort de module niets op window te zetten");
});

// ── 2· scoping · nooit een organisatie-id uit de UI ─────────────────────────
test("pipeline 2· er vertrekt nergens een organisatie-id vanuit de UI", async () => {
  const schoon = code(src);
  assert.equal(/resellerId/.test(schoon), false,
    "de UI stuurt een organisatie-id mee · de server hoort die uit de sessie af te leiden (ISO-03)");

  const host = maakHost();
  const { pagina, verzoeken, doc } = laad({
    antwoorden: (method, url) => {
      if (method === "GET" && url === "/api/reseller/deals") return { status: 200, data: { ok: true, deals: [deal()] } };
      return { status: 201, data: { ok: true, deal: deal() } };
    },
  });
  await pagina.mount(host);
  vuur(doc, "rspPipelineNew", "click");
  const form = doc.getElementById("rspPipelineForm");
  form._data = {
    prospectCompany: "Dakwerken Maes", country: "BE", enterpriseOrVatNumber: "",
    estimatedValue: "8000", currency: "EUR", evidenceType: "meeting", evidenceReference: "verslag-12",
  };
  await vuur(doc, "rspPipelineForm", "submit");
  await tik();

  assert.equal(verzoeken[0].url, "/api/reseller/deals", "de lijst hangt een queryparameter aan het pad");
  const post = verzoeken.find(v => v.method === "POST");
  assert.ok(post, "er is niets geregistreerd");
  assert.deepEqual(post.body, {
    prospectCompany: "Dakwerken Maes", country: "BE", enterpriseOrVatNumber: null,
    sourceEvidence: { type: "meeting", reference: "verslag-12" },
    estimatedValue: 8000, currency: "EUR",
  }, "de payload wijkt af · een organisatie-id of een verzonnen veld is erin geslopen");
  for (const verzoek of verzoeken) {
    assert.equal(/resellerId/i.test(verzoek.url), false, `organisatie-id in de URL: ${verzoek.url}`);
    assert.equal(/resellerId/i.test(JSON.stringify(verzoek.body || {})), false, "organisatie-id in de body");
    assert.equal(verzoek.headers.Authorization, "Bearer jwt-partner", "het verzoek gaat zonder token de deur uit");
  }
});

// ── 3· weigeringen zijn generiek · geen bestaans-oracle ─────────────────────
test("pipeline 3· een 403 toont een generieke melding zonder identifier", async () => {
  const host = maakHost();
  const { pagina } = laad({
    antwoorden: () => ({ status: 403, data: { ok: false, error: "Geen toegang", code: "RESELLER_FORBIDDEN" } }),
  });
  await pagina.mount(host);

  const html = host.innerHTML;
  assert.match(html, /Geen toegang/, "een weigering hoort een nette melding te tonen");
  assert.match(html, /partnerbeheerder/, "de melding zegt niet wat de gebruiker kan doen");
  assert.equal(/RESELLER_FORBIDDEN|403|deal_|bestaat niet|niet gevonden/i.test(html), false,
    "de weigering lekt een foutcode, een status of een record · dat is een bestaans-oracle");
  assert.equal(/rspPipelineRetry|Opnieuw proberen/.test(html), false,
    "een weigering biedt een retry-knop · dat nodigt uit tot rammelen aan de deur");
});

test("pipeline 3b· een 404 op een vreemde deal klinkt exact als een 403", async () => {
  // De server antwoordt bewust byte-identiek voor "bestaat niet" en "niet van
  // jou". De UI mag dat verschil niet alsnog verklappen.
  const host403 = maakHost();
  const a = laad({ antwoorden: () => ({ status: 403, data: { ok: false, error: "Geen toegang" } }) });
  await a.pagina.mount(host403);

  const host404 = maakHost();
  const b = laad({ antwoorden: () => ({ status: 404, data: { ok: false, error: "Niet gevonden", code: "DEAL_NOT_FOUND" } }) });
  await b.pagina.mount(host404);

  assert.equal(host404.innerHTML, host403.innerHTML,
    "een onbestaande deal ziet er anders uit dan een vreemde deal · zo is de id-ruimte af te tasten");
});

test("pipeline 3c· een geweigerde registratie verbergt de actie en toont geen id", async () => {
  const host = maakHost();
  const { pagina, doc } = laad({
    antwoorden: (method) => (method === "GET"
      ? { status: 200, data: { ok: true, deals: [deal()] } }
      : { status: 403, data: { ok: false, error: "Geen toegang", code: "RESELLER_FORBIDDEN" } }),
  });
  await pagina.mount(host);
  assert.match(host.innerHTML, /rspPipelineNew/, "de registratie-actie ontbreekt bij de start");

  vuur(doc, "rspPipelineNew", "click");
  const form = doc.getElementById("rspPipelineForm");
  form._data = { prospectCompany: "X", country: "BE", evidenceType: "email", evidenceReference: "m-1", estimatedValue: "", currency: "EUR" };
  await vuur(doc, "rspPipelineForm", "submit");
  await tik();

  const html = host.innerHTML;
  assert.match(html, /partnerbeheerder/, "de generieke melding staat niet in het scherm");
  assert.equal(/RESELLER_FORBIDDEN|403/.test(html), false, "de foutcode of status lekt in het scherm");
  assert.equal(/rspPipelineNew|rspPipelineForm/.test(html), false,
    "de UI blijft een actie aanbieden die de server geweigerd heeft");
});

// ── 4· klantinhoud vraagt een ACTIEVE gedelegeerde toegang ──────────────────
test("pipeline 4· zonder actieve grant blijft er commerciële metadata over, meer niet", async () => {
  const omgezet = deal({
    id: "deal_conv", status: "converted",
    conversion: { customerId: "cus_geheim", tenantId: "ten_geheim", subscriptionId: "sub_geheim" },
    convertedAt: "2026-06-01T10:00:00.000Z",
  });
  const host = maakHost();
  const { pagina, verzoeken } = laad({
    antwoorden: (method, url) => {
      if (url.indexOf("/api/reseller/delegated-access") === 0) {
        return { status: 200, data: { ok: true, grants: [{ status: "revoked", scope: ["read"] }] } };
      }
      return { status: 200, data: { ok: true, deals: [omgezet] } };
    },
  });
  await pagina.mount(host);
  await klikOpHost(host, "data-rsp-deal", "deal_conv");
  await tik();

  const html = host.innerHTML;
  assert.match(html, /Bouwwerken Peeters/, "de commerciële metadata hoort wél te tonen");
  assert.match(html, /afgeschermd/, "er staat geen uitleg waarom de klantinhoud ontbreekt");
  assert.equal(/cus_geheim|ten_geheim|sub_geheim/.test(html), false,
    "de klantverwijzing toont zonder actieve gedelegeerde toegang");
  assert.ok(verzoeken.some(v => v.url.indexOf("/api/reseller/delegated-access?tenantId=") === 0),
    "de toegang is niet nagevraagd · dan is het slot een aanname");
  // Herschilderen mag geen luisteraars stapelen · anders vuurt één klik straks
  // drie keer en vertrekken er drie verzoeken.
  assert.equal(host.luisteraars.click.length, 1, "elke herschildering bindt er een luisteraar bij");
});

test("pipeline 4b· een actieve grant ontgrendelt de klantverwijzing", async () => {
  const omgezet = deal({
    id: "deal_conv", status: "converted",
    conversion: { customerId: "cus_1", tenantId: "ten_1", subscriptionId: "sub_1" },
  });
  const host = maakHost();
  const { pagina } = laad({
    antwoorden: (method, url) => {
      if (url.indexOf("/api/reseller/delegated-access") === 0) {
        return {
          status: 200,
          data: { ok: true, grants: [{ status: "active", scope: ["read"], startDate: "2026-01-01T00:00:00.000Z", endDate: "2099-01-01T00:00:00.000Z" }] },
        };
      }
      return { status: 200, data: { ok: true, deals: [omgezet] } };
    },
  });
  await pagina.mount(host);
  await klikOpHost(host, "data-rsp-deal", "deal_conv");
  await tik();
  assert.match(host.innerHTML, /ten_1/, "een actieve grant ontgrendelt de klantverwijzing niet");
});

test("pipeline 4c· een verlopen venster telt niet als toegang", async () => {
  const omgezet = deal({ id: "deal_conv", status: "converted", conversion: { customerId: "cus_1", tenantId: "ten_1" } });
  const host = maakHost();
  const { pagina } = laad({
    antwoorden: (method, url) => {
      if (url.indexOf("/api/reseller/delegated-access") === 0) {
        return {
          status: 200,
          data: { ok: true, grants: [{ status: "active", startDate: "2026-01-01T00:00:00.000Z", endDate: "2026-01-02T00:00:00.000Z" }] },
        };
      }
      return { status: 200, data: { ok: true, deals: [omgezet] } };
    },
  });
  await pagina.mount(host);
  await klikOpHost(host, "data-rsp-deal", "deal_conv");
  await tik();
  assert.equal(/ten_1/.test(host.innerHTML), false, "een grant buiten zijn venster ontgrendelt tóch");
  assert.match(host.innerHTML, /afgeschermd/);
});

test("pipeline 4d· een geweigerde toegangsvraag laat het slot dicht en toont geen melding", async () => {
  const omgezet = deal({ id: "deal_conv", status: "converted", conversion: { customerId: "cus_1", tenantId: "ten_1" } });
  const host = maakHost();
  const { pagina } = laad({
    antwoorden: (method, url) => (url.indexOf("/api/reseller/delegated-access") === 0
      ? { status: 403, data: { ok: false, error: "Geen toegang" } }
      : { status: 200, data: { ok: true, deals: [omgezet] } }),
  });
  await pagina.mount(host);
  await klikOpHost(host, "data-rsp-deal", "deal_conv");
  await tik();
  assert.equal(/ten_1/.test(host.innerHTML), false, "een geweigerde toegangsvraag ontgrendelt tóch");
  assert.match(host.innerHTML, /afgeschermd/);
  assert.match(host.innerHTML, /Bouwwerken Peeters/, "de hele pagina valt om door een geweigerde deelvraag");
});

// ── 5· de UI volgt de server · ze verzint geen bevoegdheden ─────────────────
test("pipeline 5· beoordelen, attributie en conversie krijgen hier geen knop", () => {
  const schoon = code(src);
  for (const verboden of ["deals.approve", "setAttribution", "attributionPercent:", "convertDeal",
    'to: "accepted"', 'to: "rejected"', 'to: "under_review"', 'to: "converted"']) {
    assert.equal(schoon.includes(verboden), false,
      `de pagina bouwt een Monargo-actie na (${verboden}) · beoordelen is nooit een partneractie`);
  }
  // Statussen mogen wél gelezen worden · tonen is geen mogen wijzigen.
  assert.match(schoon, /const OPEN_STATUSES = \["draft", "submitted", "under_review", "accepted"\]/);
  // Bedragen tonen mag, bedragen wijzigen niet: het enige mutatiepad is
  // registreren en het indienen van een eigen concept.
  const posts = [...schoon.matchAll(/api\("POST", (`[^`]+`|"[^"]+")/g)].map(m => m[1]).sort();
  assert.deepEqual(posts, ["\"/api/reseller/deals\"", "`/api/reseller/deals/${encodeURIComponent(dealId)}/transition`"],
    `er lopen andere schrijfacties vanaf deze pagina: ${posts.join(", ")}`);
  assert.equal(/to: "submitted"/.test(schoon), true, "de enige overgang hier hoort 'indienen' te zijn");
});

test("pipeline 5b· de server bepaalt het recht · een meegestuurde rechtenlijst wint", async () => {
  const host = maakHost();
  const { pagina } = laad({
    antwoorden: () => ({ status: 200, data: { ok: true, deals: [deal({ status: "draft" })], rights: ["reseller.deals.view"] } }),
  });
  await pagina.mount(host);
  assert.equal(/rspPipelineNew/.test(host.innerHTML), false,
    "de server meldt geen create-recht en de UI toont de knop tóch");
  assert.equal(/data-rsp-submit-deal/.test(host.innerHTML), false,
    "een concept krijgt een indien-knop zonder recht");
});

test("pipeline 6· een eigen concept indienen gaat met optimistic locking en zonder id-lek", async () => {
  const host = maakHost();
  const { pagina, verzoeken } = laad({
    antwoorden: (method) => (method === "POST"
      ? { status: 200, data: { ok: true, deal: deal({ status: "submitted", version: 3 }) } }
      : { status: 200, data: { ok: true, deals: [deal({ status: "draft", version: 2 })], rights: ["reseller.deals.view", "reseller.deals.create"] } }),
  });
  await pagina.mount(host);
  assert.match(host.innerHTML, /data-rsp-submit-deal="deal_9f3a"/, "een eigen concept heeft geen indien-knop");

  await klikOpHost(host, "data-rsp-submit-deal", "deal_9f3a");
  await tik();
  const post = verzoeken.find(v => v.method === "POST");
  assert.equal(post.url, "/api/reseller/deals/deal_9f3a/transition");
  assert.deepEqual(post.body, { to: "submitted", expectedVersion: 2 },
    "de overgang gaat zonder versie de deur uit · dan overschrijft ze een intussen gewijzigde deal");
});

test("pipeline 7· een lege lijst en een netwerkfout hebben elk hun eigen scherm", async () => {
  const leeg = maakHost();
  const a = laad({ antwoorden: () => ({ status: 200, data: { ok: true, deals: [] } }) });
  await a.pagina.mount(leeg);
  assert.match(leeg.innerHTML, /Nog geen deals geregistreerd/);
  assert.equal(/partnerbeheerder/.test(leeg.innerHTML), false, "een lege lijst wordt als weigering getoond");

  const stuk = maakHost();
  const b = laad({ antwoorden: () => ({ status: 500, data: { ok: false, error: "Interne fout" } }) });
  await b.pagina.mount(stuk);
  assert.match(stuk.innerHTML, /Interne fout/, "een echte fout hoort zichtbaar te zijn");
  assert.match(stuk.innerHTML, /rspPipelineRetry/, "een storing hoort een retry te krijgen");
});

// ── 6· huisregels ───────────────────────────────────────────────────────────
test("pipeline 8· alle zichtbare tekst loopt via een i18n-sleutel", () => {
  const sleutels = [...src.matchAll(/tR\("([^"]+)"/g)].map(m => m[1]);
  assert.ok(sleutels.length >= 40, `slechts ${sleutels.length} vertaalde teksten · er staat tekst hardgecodeerd`);
  // Bestaande portaalsleutels worden hergebruikt in plaats van gedupliceerd.
  for (const hergebruik of ["rsp.statusDraft", "rsp.commercialOnly", "rsp.couldNotLoad", "rsp.retry", "rsp.sessionExpired"]) {
    assert.ok(sleutels.includes(hergebruik), `${hergebruik} bestaat al in het portaal en hoort hergebruikt te worden`);
    assert.ok(portalSrc.includes(`"${hergebruik}"`), `${hergebruik} bestaat niet in reseller.js`);
  }
  assert.equal(/rsp\.[a-zA-Z]+", *"[^"]*—/.test(src), false, "em-dash in een fallback");
});

test("pipeline 9· geen em-dash en geen require/import in browsercode", () => {
  assert.equal(src.includes("—"), false, "gebruik '-' of '·'");
  assert.equal(/\brequire\(|^import /m.test(src), false, "browsercode zonder buildstap laadt niets via require/import");
});
