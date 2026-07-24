"use strict";
// ── Extractie van het scherm "messages" uit admin.js ─────────────────────────
//
// Een extractie is pas te vertrouwen als je kunt zien dat er NIETS veranderd is.
// Daarom toetst dit bestand drie dingen naast elkaar:
//
//   * de GRENS · leest de module de gedeelde context of maakt ze een tweede
//     waarheid aan (eigen kopie van api/esc/uiConfirm/openDrawer/...)?
//   * de TEKST · het origineel gebruikte in dit scherm GEEN i18n-sleutels;
//     alle teksten stonden letterlijk in het Nederlands. Dat moet zo blijven,
//     want er sleutels van maken is een gedragswijziging.
//   * het GEDRAG · draai de renderer in een nep-DOM en kijk of de gesprekken,
//     de kaarten, het zoeken, het verwijderen en de compose-drawer doen wat ze
//     in admin.js deden.
//
// Regeleindes normaliseren: dit bestand staat op Windows in CRLF en dan matcht
// een patroon met \n opeens niets meer. Een test die daardoor omvalt zegt niets
// over de code.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MOD = path.join(__dirname, "..", "public", "js", "platforms", "admin-berichten.js");
const src = fs.readFileSync(MOD, "utf8").replace(/\r\n/g, "\n");

/** Broncode zonder commentaar · anders telt een uitleg mee als code. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ── Nep-DOM en nep-context ───────────────────────────────────────────────────
// Klein met opzet: dit scherm schrijft in #admContent en in #admDrawerBody, en
// zoekt daarna zijn eigen ids en klassen binnen die twee stukken HTML op.

function maakElement(id) {
  return {
    id, value: "", innerHTML: "", textContent: "", hidden: false, disabled: false,
    required: false, dataset: {}, handlers: {}, attrs: {}, _kinderen: new Map(),
    addEventListener(type, fn) { this.handlers[type] = fn; },
    getAttribute(naam) { return naam in this.attrs ? this.attrs[naam] : null; },
    setAttribute(naam, waarde) { this.attrs[naam] = waarde; },
    // Elke selector krijgt een stabiel nepkind · zo blijft .textContent bewaard.
    querySelector(sel) {
      if (!this._kinderen.has(sel)) this._kinderen.set(sel, maakElement(`${id}${sel}`));
      return this._kinderen.get(sel);
    },
    querySelectorAll: () => [],
    // Een handler oproepen zoals de browser dat zou doen.
    vuur(type, waarde) { return this.handlers[type]({ target: { value: waarde } }); },
  };
}

/** Minimale "knop" zoals querySelectorAll(".…") die in de echte DOM teruggeeft. */
function maakKnop(attrs) {
  const knop = {
    dataset: {}, handlers: {}, disabled: false, attrs: {}, klassen: [],
    kaart: null,
    addEventListener(type, fn) { this.handlers[type] = fn; },
    getAttribute(naam) { return naam in this.attrs ? this.attrs[naam] : null; },
    setAttribute(naam, waarde) { this.attrs[naam] = waarde; },
    closest() { return this.kaart; },
  };
  return Object.assign(knop, attrs || {});
}

const BERICHTEN = [
  { id: "m1", subject: "Startvergadering", body: "Maandag om 7u op de werf.", senderName: "Jan Peeters", createdAt: "2026-07-20T08:00:00Z", venueId: "v1", toRole: "employee" },
  { id: "m2", subject: "Loonbrief", body: "Persoonlijke opmerking.", senderName: "Els Claes", createdAt: "2026-07-19T08:00:00Z", recipientId: "u1" },
  { id: "m3", subject: "Levering beton", body: "Wordt uitgesteld naar woensdag.", senderName: "Els Claes", createdAt: "2026-07-18T08:00:00Z", venueId: "v2" },
];
const WERVEN = [{ id: "v1", name: "Kantoor Gent" }, { id: "v2", name: "Loods Aalst" }];
const MEDEWERKERS = [{ id: "u1", name: "Jan Peeters", role: "employee" }, { id: "u2", name: "Els Claes", role: "manager" }];

function laad(opties) {
  const cfg = opties || {};
  const berichten = cfg.berichten || BERICHTEN;
  const elementen = new Map();
  const content = maakElement("admContent");
  const drawerBody = maakElement("admDrawerBody");
  const drawerTitel = maakElement("admDrawerTitle");
  elementen.set("admContent", content);
  elementen.set("admDrawerBody", drawerBody);
  elementen.set("admDrawerTitle", drawerTitel);

  const geroepenApi = [];
  const meldingen = [];
  const geopendeDrawers = [];
  let bevestigAntwoord = cfg.bevestig !== false;
  const knoppenPerSelector = cfg.knoppen || {};
  content.querySelectorAll = sel => knoppenPerSelector[sel] || [];

  const A = {
    api: async (method, pad, body) => {
      geroepenApi.push({ method, pad, body });
      if (cfg.faal) throw new Error("Netwerk onbereikbaar");
      if (method === "GET" && pad === "/messages") return { messages: berichten };
      if (pad === "/venues") return { venues: cfg.werven || WERVEN };
      if (pad === "/employees") return { employees: cfg.medewerkers || MEDEWERKERS };
      return { ok: true };
    },
    esc: v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    state: cfg.state || {},
    openDrawer: () => geopendeDrawers.push("open"),
    closeDrawer: () => geopendeDrawers.push("dicht"),
    uiConfirm: async () => bevestigAntwoord,
    views: {},
    drawers: {},
  };

  const document = {
    getElementById(id) {
      if (elementen.has(id)) return elementen.get(id);
      // Alleen ids die echt gerenderd zijn bestaan · net als in de browser.
      const html = `${content.innerHTML}${drawerBody.innerHTML}`;
      if (!html.includes(`id="${id}"`)) return null;
      const el = maakElement(id);
      elementen.set(id, el);
      return el;
    },
    querySelectorAll: () => [],
  };

  // FormData leest in de browser de ingevulde velden. Hier leest ze wat de test
  // in form._waarden heeft gezet · dezelfde vorm, geen echte DOM nodig.
  class FormData {
    constructor(form) { this._f = form; }
    get(naam) { const v = (this._f && this._f._waarden) || {}; return naam in v ? v[naam] : null; }
  }

  const window = {
    wfpAdmin: A,
    showToast: (bericht, soort) => meldingen.push(`${soort}:${bericht}`),
  };

  vm.runInNewContext(src, { window, document, setTimeout, clearTimeout, console, FormData });
  return {
    A, content, drawerBody, drawerTitel, elementen, geroepenApi, meldingen, geopendeDrawers, window,
    zetBevestig(v) { bevestigAntwoord = v; },
    paden: () => geroepenApi.map(r => `${r.method} ${r.pad}`),
  };
}

/** Wachten tot de asynchrone renderer klaar is (api is een promise). */
const settle = () => new Promise(r => setTimeout(r, 5));
/** De zoekactie is bewust 180ms uitgesteld · dus iets langer wachten. */
const settleZoek = () => new Promise(r => setTimeout(r, 230));

// ── 1· de grens ──────────────────────────────────────────────────────────────

test("MSG 1· de module LEEST window.wfpAdmin en maakt hem niet aan", () => {
  assert.equal(/window\.wfpAdmin\s*=/.test(src), false,
    "een schermmodule die de gedeelde context aanmaakt, kan admin.js overschrijven");
  assert.match(src, /const A = window\.wfpAdmin;/);
  assert.match(src, /if \(!A\) return;/,
    "zonder deze bewaking klapt de module als admin.js niet geladen is");
});

test("MSG 2· de module registreert zich als A.views.messages", () => {
  const { A } = laad();
  assert.equal(typeof A.views.messages, "function");
  assert.deepEqual(Object.keys(A.views), ["messages"],
    "de renderer hangt ook nog ergens anders · dat is een tweede ingang");
  // De compose-drawer verhuist mee, dus moet hier ook A.drawers.message staan:
  // anders verliest de app die ingang zodra admin.js geknipt wordt.
  assert.equal(typeof A.drawers.message, "function");
  assert.deepEqual(Object.keys(A.drawers), ["message"]);
});

test("MSG 3· elke aangeroepen functie is hier gedefinieerd OF komt uit A", () => {
  // Alles wat als naam(...) wordt aangeroepen, zonder punt ervoor (dus geen
  // methodes zoals .map( of A.esc( ).
  const aangeroepen = new Set(
    [...code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1])
  );
  // "async" hoort bij `async () => {}`; "var" komt uit de CSS-kleuren
  // (var(--wf-red)) in de sjabloonteksten · geen van beide is een aanroep.
  const SLEUTELWOORDEN = new Set(["if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "of", "in", "do", "else", "await", "delete", "void", "instanceof", "async", "var"]);
  const BROWSERGLOBALS = new Set(["Number", "String", "Boolean", "Array", "Object", "Set", "Map", "Date", "Promise", "RegExp", "JSON", "parseInt", "parseFloat", "isNaN", "setTimeout", "clearTimeout", "FormData"]);

  // Wat dit bestand zelf declareert.
  const lokaal = new Set([
    ...[...code.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]),
    ...[...code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]),
  ]);

  const zwevend = [...aangeroepen]
    .filter(n => !SLEUTELWOORDEN.has(n) && !BROWSERGLOBALS.has(n))
    .filter(n => !lokaal.has(n));
  assert.deepEqual(zwevend, [],
    `deze functies komen uit het niets · bind ze aan window.wfpAdmin: ${zwevend.join(", ")}`);

  // De gedeelde helpers moeten ECHT uit A komen, niet lokaal herbouwd zijn.
  const uitA = new Set([...code.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*A\.([\w$]+)/g)].map(m => m[1]));
  for (const naam of ["api", "esc", "_state", "openDrawer", "closeDrawer", "uiConfirm"]) {
    assert.ok(uitA.has(naam), `${naam} wordt niet uit window.wfpAdmin gelezen`);
  }
});

test("MSG 4· gedeelde helpers zijn NIET gekopieerd (geen tweede waarheid)", () => {
  for (const naam of ["api", "esc", "uiConfirm", "uiDialog", "openDrawer", "closeDrawer", "empNameById", "uName", "tA"]) {
    assert.equal(new RegExp(`function\\s+${naam}\\s*\\(`).test(code), false,
      `${naam} staat nu in twee bestanden · die lopen ooit uit elkaar`);
  }
  // Wat WEL exclusief van dit scherm is, hoort hier te staan.
  for (const naam of ["renderMessages", "openMessageDrawer"]) {
    assert.match(code, new RegExp(`function\\s+${naam}\\s*\\(`), `${naam} is niet meeverhuisd`);
  }
  for (const naam of ["messageRecipientLabel", "messageInitials", "messageTime", "messagePreview"]) {
    assert.match(code, new RegExp(`const ${naam} = `), `${naam} is niet meeverhuisd`);
  }
  // De filterstand hoort bij dit scherm en nergens anders.
  assert.match(code, /let _msgVenueFilter = "";[\s\S]*let _msgSearch = "";/);
});

// ── 2· de teksten ────────────────────────────────────────────────────────────

test("MSG 5· het scherm blijft letterlijk Nederlands · net als het origineel", () => {
  // admin.js regels 4454-4749 bevatten GEEN enkele tA()-aanroep: dit scherm was
  // niet vertaald. Er nu sleutels van maken (of een i18n-shim toevoegen) zou een
  // gedragswijziging zijn die in een extractie niemand verwacht.
  assert.equal(/\btA\s*\(/.test(code), false,
    "het origineel had hier geen i18n-sleutels · deze extractie voegt ze toe");
  assert.equal(/wfpI18n/.test(code), false,
    "het origineel raakte de woordenlijst in dit scherm niet aan");

  for (const tekst of [
    "Communicatie", "Gesprekken", "Alle berichten", "Volledig overzicht",
    "Algemeen", "Zonder werfkoppeling", "Werven", "Nog geen werven beschikbaar.",
    "Zoek in berichten…", "Nieuw bericht", "Geen inhoud", "Verwijderen",
    "Bericht permanent verwijderen?", "Bericht verwijderd.",
    "Geen zoekresultaten", "Nog geen berichten", "Onbekende werf",
    "Alle interne communicatie, van algemeen tot werfgebonden.",
    "Gesprekken en afspraken binnen deze werfcontext.",
    "Schrijf een helder bericht", "Sturen naar *", "Werfcontext",
    "Algemeen · geen werf", "Kies een ontvanger.", "Bericht verzonden.",
    "Bericht verzenden", "Annuleren", "Nog geen onderwerp",
  ]) {
    assert.ok(src.includes(tekst), `de letterlijke tekst "${tekst}" is verdwenen of vertaald`);
  }
});

test("MSG 6· geen em-dash in de tekst", () => {
  assert.equal(src.includes("—"), false,
    'em-dash gebruikt · de huisregel is "-" of "·"');
});

// ── 3· het gedrag · overzicht ────────────────────────────────────────────────

test("MSG 7· rendert een kaart per bericht met afzender en werftag", async () => {
  const { A, content } = laad();
  await A.views.messages();
  await settle();
  const html = content.innerHTML;
  assert.equal((html.match(/class="message-card"/g) || []).length, 3);
  assert.ok(html.includes("Startvergadering") && html.includes("Loonbrief") && html.includes("Levering beton"));
  assert.ok(html.includes("Kantoor Gent"), "de werfnaam wordt niet opgezocht bij het venueId");
  assert.ok(html.includes("Jan Peeters"), "de afzender ontbreekt op de kaart");
  assert.ok(html.includes("Maandag om 7u op de werf."), "de berichttekst staat niet in de kaart");
});

test("MSG 8· de ontvangerlabels volgen recipientId en toRole", async () => {
  const { A, content } = laad();
  await A.views.messages();
  await settle();
  const html = content.innerHTML;
  assert.ok(html.includes("<em>Alle medewerkers</em>"), "toRole employee levert niet 'Alle medewerkers'");
  assert.ok(html.includes("<em>Iedereen</em>"), "een bericht zonder ontvanger levert niet 'Iedereen'");
  assert.ok(html.includes("<em>Jan Peeters</em>"), "recipientId wordt niet naar een naam vertaald");
});

test("MSG 9· de gesprekkenlijst telt algemeen en per werf", async () => {
  const { A, content } = laad();
  await A.views.messages();
  await settle();
  const html = content.innerHTML;
  assert.ok(html.includes('data-thread=""'), "de knop 'Alle berichten' ontbreekt");
  assert.ok(html.includes('data-thread="general"'));
  assert.ok(html.includes('data-thread="v1"') && html.includes('data-thread="v2"'));
  assert.match(html, /<b>3<\/b>/, "de totaalteller klopt niet");
  assert.match(html, /<b>1<\/b>/, "de teller 'algemeen' klopt niet");
});

test("MSG 10· een werfgesprek kiezen filtert de stroom en wisselt de titel", async () => {
  const draad = maakKnop({ dataset: { thread: "v2" } });
  const { A, content } = laad({ knoppen: { ".message-thread": [draad] } });
  await A.views.messages();
  await settle();

  draad.handlers.click();
  await settle();
  const html = content.innerHTML;
  assert.ok(html.includes("Levering beton"));
  assert.equal(html.includes("Startvergadering"), false, "een ander werfgesprek lekt in de stroom");
  assert.ok(html.includes("Loods Aalst"), "de titel van het gekozen gesprek klopt niet");
  assert.ok(html.includes("Gesprekken en afspraken binnen deze werfcontext."));
});

test("MSG 11· het gesprek 'Algemeen' toont enkel berichten zonder werf", async () => {
  const draad = maakKnop({ dataset: { thread: "general" } });
  const { A, content } = laad({ knoppen: { ".message-thread": [draad] } });
  await A.views.messages();
  await settle();

  draad.handlers.click();
  await settle();
  assert.ok(content.innerHTML.includes("Loonbrief"));
  assert.equal(content.innerHTML.includes("Levering beton"), false,
    "een werfgebonden bericht staat in het algemene gesprek");
  assert.ok(content.innerHTML.includes("Algemene berichten"));
});

test("MSG 12· zoeken kijkt naar onderwerp, tekst en afzender", async () => {
  const { A, content, elementen } = laad();
  await A.views.messages();
  await settle();

  elementen.get("msgSearch").vuur("input", "beton");
  await settleZoek();
  assert.ok(content.innerHTML.includes("Levering beton"));
  assert.equal(content.innerHTML.includes("Loonbrief"), false);

  elementen.get("msgSearch").vuur("input", "els claes");
  await settleZoek();
  assert.ok(content.innerHTML.includes("Loonbrief"), "zoeken op afzender werkt niet");
  assert.equal(content.innerHTML.includes("Startvergadering"), false);
});

test("MSG 13· lege lijst en lege zoekopdracht lezen verschillend", async () => {
  const leeg = laad({ berichten: [] });
  await leeg.A.views.messages();
  await settle();
  assert.ok(leeg.content.innerHTML.includes("Nog geen berichten"));
  assert.ok(leeg.content.innerHTML.includes('id="msgEmptyCompose"'));

  const gefilterd = laad();
  await gefilterd.A.views.messages();
  await settle();
  gefilterd.elementen.get("msgSearch").vuur("input", "bestaat-niet");
  await settleZoek();
  assert.ok(gefilterd.content.innerHTML.includes("Geen zoekresultaten"),
    "een filter zonder resultaat mag niet als 'nog niets verzonden' lezen");
  assert.equal(gefilterd.content.innerHTML.includes("Start de communicatie"), false);
});

test("MSG 14· een kaart open-/dichtklappen zet aria-expanded en hidden", async () => {
  const detail = maakElement("detail");
  detail.hidden = true;
  const kaart = {
    querySelector: () => detail,
    classList: { toggle(naam, aan) { this.laatste = [naam, aan]; } },
  };
  const toggle = maakKnop({ dataset: { id: "m1" }, kaart });
  const { A } = laad({ knoppen: { ".msg-toggle": [toggle] } });
  await A.views.messages();
  await settle();

  toggle.setAttribute("aria-expanded", "false");
  toggle.handlers.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(detail.hidden, false, "het bericht blijft verborgen na openklappen");
  assert.deepEqual(kaart.classList.laatste, ["expanded", true]);

  toggle.handlers.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(detail.hidden, true, "het bericht blijft open na dichtklappen");
});

test("MSG 15· verwijderen vraagt eerst bevestiging via de gedeelde uiConfirm", async () => {
  const wisKnop = maakKnop({ dataset: { id: "m3" } });
  const { A, paden, meldingen, zetBevestig } = laad({ knoppen: { ".adm-msg-del": [wisKnop] } });
  await A.views.messages();
  await settle();

  zetBevestig(false);
  await wisKnop.handlers.click();
  assert.equal(paden().includes("DELETE /messages/m3"), false,
    "er wordt verwijderd terwijl de bevestiging geweigerd is");
  assert.equal(wisKnop.disabled, false, "de knop blijft geblokkeerd na annuleren");

  zetBevestig(true);
  await wisKnop.handlers.click();
  await settle();
  assert.ok(paden().includes("DELETE /messages/m3"), "het bericht wordt niet verwijderd");
  assert.ok(meldingen.includes("success:Bericht verwijderd."));
});

test("MSG 16· een falende api toont de fout in het scherm, geen lege pagina", async () => {
  const { A, content } = laad({ faal: true });
  await A.views.messages();
  await settle();
  assert.ok(content.innerHTML.includes("Netwerk onbereikbaar"),
    "de foutmelding komt niet in beeld · het scherm blijft leeg achter");
});

test("MSG 17· opgehaalde medewerkers landen in de gedeelde A.state", async () => {
  const state = {};
  const { A } = laad({ state });
  await A.views.messages();
  await settle();
  assert.equal(A.state, state, "de module werkt op een eigen kopie van de state");
  assert.deepEqual((state.employees || []).map(e => e.id), ["u1", "u2"]);
});

// ── 4· het gedrag · de compose-drawer ────────────────────────────────────────

test("MSG 18· de drawer opent via A.openDrawer met de werf voorgeselecteerd", async () => {
  const draad = maakKnop({ dataset: { thread: "v1" } });
  const { A, elementen, drawerBody, drawerTitel, geopendeDrawers } = laad({ knoppen: { ".message-thread": [draad] } });
  await A.views.messages();
  await settle();
  draad.handlers.click();
  await settle();

  elementen.get("msgCompose").handlers.click();
  await settle();

  assert.ok(geopendeDrawers.includes("open"), "de gedeelde A.openDrawer wordt niet gebruikt");
  assert.equal(drawerTitel.textContent, "Nieuw bericht");
  assert.ok(drawerBody.innerHTML.includes('value="v1" selected'),
    "de werf van het open gesprek staat niet voorgeselecteerd");
  // Alleen actieve medewerkers in de personenlijst · zo deed het origineel het.
  assert.ok(drawerBody.innerHTML.includes("Jan Peeters"));
});

test("MSG 19· de drawer laat inactieve medewerkers weg", async () => {
  const { A, elementen, drawerBody } = laad({
    medewerkers: [{ id: "u1", name: "Jan Peeters" }, { id: "u9", name: "Uit dienst", active: false }],
  });
  await A.views.messages();
  await settle();
  elementen.get("msgCompose").handlers.click();
  await settle();
  assert.ok(drawerBody.innerHTML.includes("Jan Peeters"));
  assert.equal(drawerBody.innerHTML.includes("Uit dienst"), false,
    "een niet-actieve medewerker blijft als ontvanger kiesbaar");
});

test("MSG 20· 'Specifieke persoon' zonder ontvanger wordt geweigerd", async () => {
  const { A, elementen, paden } = laad();
  await A.views.messages();
  await settle();
  elementen.get("msgCompose").handlers.click();
  await settle();

  const form = elementen.get("admMsgForm");
  form._waarden = { toMode: "person", recipientId: "", subject: "Test", body: "Tekst", venueId: "" };
  await form.handlers.submit({ preventDefault() {} });

  const fout = elementen.get("admMsgErr");
  assert.equal(fout.hidden, false);
  assert.equal(fout.textContent, "Kies een ontvanger.");
  assert.equal(paden().includes("POST /messages"), false,
    "er wordt toch verzonden zonder gekozen ontvanger");
  // De verzendknop is nooit opgehaald · de handler stopt daarvoor, dus hij is
  // ook niet geblokkeerd blijven staan.
  assert.equal(elementen.has("admMsgSubmit"), false,
    "de verzendknop is aangeraakt terwijl de invoer geweigerd werd");
});

test("MSG 21· verzenden vertaalt de keuzelijst naar toRole/recipientId", async () => {
  const gevallen = [
    ["all", {}],
    ["role_employee", { toRole: "employee" }],
    ["role_manager", { toRole: "manager" }],
    ["person", { recipientId: "u2" }],
  ];
  for (const [toMode, verwacht] of gevallen) {
    const { A, elementen, geroepenApi, meldingen, geopendeDrawers } = laad();
    await A.views.messages();
    await settle();
    elementen.get("msgCompose").handlers.click();
    await settle();

    const form = elementen.get("admMsgForm");
    form._waarden = { toMode, recipientId: "u2", subject: "  Werfoverleg  ", body: " Om 7u ", venueId: "v1" };
    await form.handlers.submit({ preventDefault() {} });
    await settle();

    const post = geroepenApi.find(r => r.method === "POST" && r.pad === "/messages");
    assert.ok(post, `${toMode}: er wordt niets verzonden`);
    assert.equal(post.body.subject, "Werfoverleg", `${toMode}: het onderwerp wordt niet getrimd`);
    assert.equal(post.body.body, "Om 7u", `${toMode}: de tekst wordt niet getrimd`);
    assert.equal(post.body.venueId, "v1");
    assert.equal(post.body.toRole, verwacht.toRole, `${toMode}: verkeerde toRole`);
    assert.equal(post.body.recipientId, verwacht.recipientId, `${toMode}: verkeerde recipientId`);
    assert.ok(geopendeDrawers.includes("dicht"), `${toMode}: de drawer sluit niet na verzenden`);
    assert.ok(meldingen.includes("success:Bericht verzonden."), `${toMode}: geen bevestiging`);
  }
});

test("MSG 22· na verzenden springt het scherm naar het gesprek van de werf", async () => {
  const { A, content, elementen } = laad();
  await A.views.messages();
  await settle();
  elementen.get("msgCompose").handlers.click();
  await settle();

  const form = elementen.get("admMsgForm");
  form._waarden = { toMode: "all", subject: "Levering", body: "Woensdag", venueId: "v2" };
  await form.handlers.submit({ preventDefault() {} });
  await settle();

  assert.ok(content.innerHTML.includes("Loods Aalst"),
    "het scherm blijft op 'Alle berichten' staan na verzenden naar een werf");
  assert.equal(content.innerHTML.includes("Alle interne communicatie"), false);
});
