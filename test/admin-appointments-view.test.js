"use strict";
// ── Extractie van het scherm "appointments" uit admin.js ─────────────────────
//
// Een extractie is pas te vertrouwen als je kunt zien dat er NIETS veranderd is.
// Daarom toetst dit bestand twee dingen naast elkaar:
//
//   * de GRENS · leest de module de gedeelde context (api/esc/tA/uiConfirm/
//     openDrawer/closeDrawer) of bouwt ze een tweede waarheid?
//   * het GEDRAG · draai de renderer in een nep-DOM en kijk of de filters, de
//     reminderkolom en de drawer doen wat ze in admin.js deden.
//
// Regeleindes normaliseren: dit bestand staat op Windows in CRLF en dan matcht
// een patroon met \n opeens niets meer. Een test die daardoor omvalt zegt niets
// over de code.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MOD = path.join(__dirname, "..", "public", "js", "platforms", "admin-afspraken.js");
const src = fs.readFileSync(MOD, "utf8").replace(/\r\n/g, "\n");

/** Broncode zonder commentaar · anders telt een uitleg mee als code. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ── Nep-DOM en nep-context ───────────────────────────────────────────────────
// Klein met opzet: het scherm schrijft in #admContent, de drawer in
// #admDrawerBody, en hangt listeners aan een handvol ids.

function maakElement(id) {
  const el = {
    id, value: "", textContent: "", style: {}, dataset: {}, handlers: {},
    _html: "", _nodes: new Map(),
    addEventListener(type, fn) { this.handlers[type] = fn; },
    /** Een handler oproepen zoals de browser dat zou doen. */
    vuur(type, waarde) { return this.handlers[type]({ target: { value: waarde } }); },
  };
  // innerHTML als accessor: bij een re-render zijn de oude knoop-objecten weg,
  // net als in de browser. Anders zou een test listeners van een vorige render
  // aanroepen en dat bewijst niets.
  Object.defineProperty(el, "innerHTML", {
    get() { return el._html; },
    set(v) { el._html = String(v); el._nodes.clear(); },
    enumerable: true,
  });
  return el;
}

// Vaste data · "komend" filtert op datum, dus ver in de toekomst/verleden zodat
// de test niet op een bepaalde dag omvalt.
const AFSPRAKEN = [
  // komend, reminder aan, e-mail bekend → "2d vooraf"
  { id: "apt-1", date: "2099-03-04", start: "09:00", end: "11:00", customerName: "Acme", customerEmail: "info@acme.be", workorderNumber: "WB-001", reminderDays: 2, status: "gepland" },
  // komend, reminder al verstuurd
  { id: "apt-2", date: "2099-03-05", start: "13:00", customerName: "Beta", customerEmail: "beta@x.be", workorderId: "wo-9911", reminderDays: 1, reminderSentAt: "2099-03-04T08:00:00Z", status: "bevestigd" },
  // komend, geen e-mail → geen reminder mogelijk
  { id: "apt-3", date: "2099-03-06", start: "08:30", customerName: "Gamma", reminderDays: 1, status: "gepland" },
  // komend maar geannuleerd → hoort NIET in "komend"
  { id: "apt-4", date: "2099-03-07", start: "10:00", customerName: "Delta", customerEmail: "d@x.be", reminderDays: 0, status: "geannuleerd" },
  // verleden → hoort NIET in "komend"
  { id: "apt-5", date: "2000-01-02", start: "07:00", customerName: "Oud", customerEmail: "oud@x.be", reminderDays: 1, status: "uitgevoerd" },
];
const KLANTEN = [{ id: "c1", name: "Acme", email: "info@acme.be" }];
const WERKBONNEN = [
  { id: "wo-1", number: "WB-001", title: "Dakwerken", status: "open" },
  { id: "wo-2", number: "WB-002", title: "Afgerond werk", status: "Voltooid" },
];

function laad(opties) {
  const cfg = opties || {};
  const afspraken = cfg.afspraken || AFSPRAKEN;
  const elementen = new Map();
  const content = maakElement("admContent");
  const drawerTitle = maakElement("admDrawerTitle");
  const drawerBody = maakElement("admDrawerBody");
  elementen.set("admContent", content);
  elementen.set("admDrawerTitle", drawerTitle);
  elementen.set("admDrawerBody", drawerBody);
  const gevraagdeSleutels = [];
  const gedaan = [];   // openDrawer/closeDrawer/uiConfirm-sporen
  const apiCalls = [];

  /** Elementen uit gerenderde HTML halen: class + data-id, zoals de code ze zoekt.
   *  Per render dezelfde knoop-objecten teruggeven, anders raakt de test de
   *  listener kwijt die de module er net op hing. */
  function zoekAlles(el, selector) {
    const cls = selector.replace(/^\./, "");
    const re = new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"\\s+data-id="([^"]*)"`, "g");
    return [...el.innerHTML.matchAll(re)].map(m => {
      const sleutel = `${cls}#${m[1]}`;
      if (!el._nodes.has(sleutel)) {
        const node = maakElement("");
        node.dataset.id = m[1];
        el._nodes.set(sleutel, node);
      }
      return el._nodes.get(sleutel);
    });
  }
  content.querySelectorAll = sel => zoekAlles(content, sel);
  drawerBody.querySelectorAll = sel => zoekAlles(drawerBody, sel);

  const A = {
    api: async (method, pad, body) => {
      apiCalls.push(`${method} ${pad}`);
      if (method === "GET" && pad === "/appointments") return { appointments: afspraken };
      if (method === "GET" && pad === "/customers") return { customers: KLANTEN };
      if (method === "GET" && pad === "/workorders") return { workorders: WERKBONNEN };
      if (cfg.apiFout) throw new Error(cfg.apiFout);
      return { ok: true, body };
    },
    esc: v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    tA: (key, fallback) => {
      gevraagdeSleutels.push(key);
      return (cfg.vertalingen && cfg.vertalingen[key]) || fallback;
    },
    uiConfirm: async (bericht, opties) => { gedaan.push({ uiConfirm: bericht, opties }); return cfg.bevestig !== false; },
    openDrawer: () => gedaan.push("openDrawer"),
    closeDrawer: () => gedaan.push("closeDrawer"),
    views: {},
    drawers: {},
  };
  // Zonder woordenlijst hoort tA de Nederlandse fallback terug te geven · dat is
  // exact wat admin.js deed toen tA daar nog stond.
  if (cfg.i18n === false) A.tA = (key, fallback) => { gevraagdeSleutels.push(key); return fallback; };

  const document = {
    getElementById(id) {
      if (elementen.has(id)) return elementen.get(id);
      // Alleen ids die in de gerenderde HTML voorkomen bestaan echt.
      const bronnen = content.innerHTML + drawerBody.innerHTML;
      if (!bronnen.includes(`id="${id}"`)) return null;
      const el = maakElement(id);
      elementen.set(id, el);
      return el;
    },
  };

  const window = {
    wfpAdmin: A,
    wfpTerms: cfg.terms || null,
    showToast: (bericht, soort) => gedaan.push({ toast: bericht, soort }),
  };

  vm.runInNewContext(src, { window, document, setTimeout, clearTimeout, console });
  return { A, content, drawerTitle, drawerBody, elementen, gevraagdeSleutels, gedaan, apiCalls };
}

/** Wachten tot de asynchrone renderer klaar is (api is een promise). */
const settle = () => new Promise(r => setTimeout(r, 5));

// ── 1· de grens ──────────────────────────────────────────────────────────────

test("APT 1· de module LEEST window.wfpAdmin en maakt hem niet aan", () => {
  assert.equal(/window\.wfpAdmin\s*=/.test(src), false,
    "een schermmodule die de gedeelde context aanmaakt, kan admin.js overschrijven");
  assert.match(src, /const A = window\.wfpAdmin;/);
  assert.match(src, /if \(!A\) return;/,
    "zonder deze bewaking klapt de module als admin.js niet geladen is");
});

test("APT 2· de module registreert zich als A.views.appointments én A.drawers.appointment", () => {
  const { A } = laad();
  assert.equal(typeof A.views.appointments, "function");
  // admin.js hing de drawer op als drawers.appointment (primary-action-knop en
  // de lege-staat-CTA's roepen d.appointment(null) aan). Die naam moet blijven.
  assert.equal(typeof A.drawers.appointment, "function");
  assert.deepEqual(Object.keys(A.views), ["appointments"]);
  assert.deepEqual(Object.keys(A.drawers), ["appointment"]);
});

test("APT 3· elke aangeroepen functie is hier gedefinieerd OF komt uit A", () => {
  // Alles wat als naam(...) wordt aangeroepen, zonder punt ervoor (dus geen
  // methodes zoals .map( of A.esc( ).
  // De CSS in de template-strings kent ook een var(--…)-oproep · dat is geen JS.
  // Geen spatie voor het haakje: anders leest "E-mail klant (voor reminder)" uit
  // een label als een oproep van "klant", en "async () =>" als een oproep van
  // "async".
  const aangeroepen = new Set(
    [...code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\(\s*(--)?/g)]
      .filter(m => !m[2])
      .map(m => m[1])
  );
  const SLEUTELWOORDEN = new Set(["if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "of", "in", "do", "else", "await", "delete", "void", "instanceof"]);
  const BROWSERGLOBALS = new Set(["Number", "String", "Boolean", "Array", "Object", "Set", "Map", "Date", "Promise", "RegExp", "JSON", "parseInt", "parseFloat", "isNaN", "setTimeout", "clearTimeout", "FormData"]);

  // Wat dit bestand zelf declareert.
  const lokaal = new Set([
    ...[...code.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]),
    ...[...code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]),
  ]);
  // Wat uit de gedeelde context komt.
  const uitA = new Set([...code.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*A\.([\w$]+)/g)].map(m => m[1]));

  const zwevend = [...aangeroepen]
    .filter(n => !SLEUTELWOORDEN.has(n) && !BROWSERGLOBALS.has(n))
    .filter(n => !lokaal.has(n));
  assert.deepEqual(zwevend, [],
    `deze functies komen uit het niets · bind ze aan window.wfpAdmin: ${zwevend.join(", ")}`);

  // De gedeelde helpers moeten ECHT uit A komen, niet lokaal herbouwd zijn.
  for (const naam of ["api", "esc", "tA", "uiConfirm", "openDrawer", "closeDrawer"]) {
    assert.ok(uitA.has(naam), `${naam} wordt niet uit window.wfpAdmin gelezen`);
  }
});

test("APT 4· gedeelde helpers zijn NIET gekopieerd (geen tweede waarheid)", () => {
  for (const naam of ["api", "esc", "tA", "uiConfirm", "uiDialog", "openDrawer", "closeDrawer", "empNameById", "uName"]) {
    assert.equal(new RegExp(`function\\s+${naam}\\s*\\(`).test(code), false,
      `${naam} staat nu in twee bestanden · die lopen ooit uit elkaar`);
  }
  // Wat WEL exclusief van dit scherm is, hoort hier te staan.
  for (const naam of ["tAptStatus", "renderAppointments", "openAppointmentDrawer"]) {
    assert.match(code, new RegExp(`function\\s+${naam}\\s*\\(`), `${naam} is niet meeverhuisd`);
  }
  // De filterstand hoort bij dit scherm en nergens anders.
  assert.match(code, /let _aptFilter = "komend";/);
});

// ── 2· de teksten ────────────────────────────────────────────────────────────

test("APT 5· elke tekst die in admin.js een i18n-sleutel had, heeft die nog", () => {
  // Vastgelegd zoals het origineel het deed (admin.js regels 2683-2851).
  // Verdwijnt er hier een sleutel, dan is het scherm stil eentalig geworden ·
  // dat is precies wat een extractie niet mag doen.
  const SLEUTELS = [
    "adm.error", "nav.appointments", "adm.apt.singular",
    "adm.apt.fUpcoming", "mgr.all", "adm.apt.stCancelled",
    "adm.apt.empty", "adm.apt.emptyBtn",
    "adm.date", "adm.apt.thTime", "adm.thCustomer", "emp.wo.default",
    "adm.apt.thReminder", "adm.status", "adm.actions", "adm.edit",
    "adm.apt.remSent", "adm.apt.remNoEmail", "adm.apt.remOff",
    "adm.leave.daysAbbr", "adm.apt.remBefore",
    "adm.apt.stPlanned", "adm.apt.stConfirmed", "adm.apt.stDone",
    "adm.apt.editTitle", "adm.apt.newTitle",
    "adm.quote.manualFill", "adm.quote.customerName", "adm.apt.custEmail",
    "mgr.startTime", "mgr.endTime", "adm.apt.optional", "mgr.noWo",
    "adm.apt.reminderLabel", "adm.apt.remNone",
    "adm.apt.rem1", "adm.apt.rem2", "adm.apt.rem3", "adm.apt.rem7",
    "adm.apt.noteLabel", "adm.apt.remSentOn", "adm.apt.remResetHint",
    "adm.delete", "adm.cancel", "adm.save", "adm.createBtn",
    "adm.apt.deleteConfirm", "adm.apt.savedToast", "adm.apt.createdToast",
  ];
  const ontbreekt = SLEUTELS.filter(k => !src.includes(`"${k}"`));
  assert.deepEqual(ontbreekt, [], `i18n-sleutels weggevallen bij de extractie: ${ontbreekt.join(", ")}`);
});

test("APT 6· de i18n-sleutels worden ook echt opgevraagd bij het renderen", async () => {
  const { A, gevraagdeSleutels } = laad();
  await A.views.appointments();
  await settle();
  for (const k of ["nav.appointments", "adm.apt.fUpcoming", "adm.apt.thReminder", "adm.status", "adm.apt.stPlanned"]) {
    assert.ok(gevraagdeSleutels.includes(k), `${k} wordt niet opgevraagd · staat de tekst hardgecodeerd?`);
  }
});

test("APT 7· ook de drawer vraagt zijn sleutels op", async () => {
  const { A, gevraagdeSleutels } = laad();
  await A.drawers.appointment(null);
  await settle();
  for (const k of ["adm.apt.newTitle", "adm.apt.custEmail", "adm.apt.reminderLabel", "adm.apt.noteLabel"]) {
    assert.ok(gevraagdeSleutels.includes(k), `${k} wordt niet opgevraagd in de drawer`);
  }
});

test("APT 8· tekst die in admin.js LETTERLIJK stond, blijft letterlijk", () => {
  // Het origineel vertaalde de dialoogtitel niet en gebruikte een vaste
  // nl-BE-datumopmaak. Er nu wel een sleutel van maken zou een gedragswijziging
  // zijn die in een extractie niemand verwacht.
  for (const tekst of [
    'title: "Afspraak verwijderen"',
    '.toLocaleDateString("nl-BE")',
    '.toLocaleString("nl-BE")',
  ]) {
    assert.ok(src.includes(tekst), `de letterlijke tekst "${tekst}" is verdwenen of vertaald`);
  }
});

// ── 3· het gedrag ────────────────────────────────────────────────────────────

test("APT 9· 'komend' toont alleen toekomstige, niet-geannuleerde afspraken", async () => {
  const { A, content } = laad();
  await A.views.appointments();
  await settle();
  const html = content.innerHTML;
  assert.ok(html.includes("Acme") && html.includes("Beta") && html.includes("Gamma"));
  assert.equal(html.includes("Delta"), false, "een geannuleerde afspraak staat in 'komend'");
  assert.equal(html.includes("Oud"), false, "een afspraak uit het verleden staat in 'komend'");
  assert.equal((html.match(/class="adm-row-link adm-apt-row"/g) || []).length, 3);
});

test("APT 10· de filter wisselt naar alle en naar geannuleerd", async () => {
  const { A, content, elementen } = laad();
  await A.views.appointments();
  await settle();

  elementen.get("admAptFilter").vuur("change", "alle");
  await settle();
  assert.equal((content.innerHTML.match(/class="adm-row-link adm-apt-row"/g) || []).length, 5,
    "'alle' toont niet alle afspraken");

  elementen.get("admAptFilter").vuur("change", "geannuleerd");
  await settle();
  assert.ok(content.innerHTML.includes("Delta"));
  assert.equal(content.innerHTML.includes("Acme"), false,
    "de geannuleerd-filter laat ook geplande afspraken zien");
});

test("APT 11· de reminderkolom leest de drie toestanden uit de afspraak", async () => {
  const { A, content, elementen } = laad();
  await A.views.appointments();
  await settle();
  const html = content.innerHTML;
  assert.ok(html.includes("verstuurd"), "een verstuurde reminder wordt niet gemeld");
  assert.ok(html.includes("geen e-mail"), "zonder klant-e-mail hoort dat er te staan");
  assert.ok(html.includes("2d vooraf"), "het aantal dagen vooraf klopt niet");

  // reminderDays 0 → "uit". Die afspraak (Delta) zit in de geannuleerd-filter.
  elementen.get("admAptFilter").vuur("change", "geannuleerd");
  await settle();
  assert.ok(content.innerHTML.includes("uit"), "reminderDays 0 leest niet als 'uit'");
});

test("APT 12· de status krijgt zijn eigen css-klasse en vertaalde naam", async () => {
  // Met een woordenlijst moet tAptStatus de status-sleutel opvragen · doet hij
  // dat niet, dan lekt de ruwe databasewaarde het scherm in.
  const { A, content } = laad({
    vertalingen: { "adm.apt.stPlanned": "Ingepland", "adm.apt.stConfirmed": "Bevestigd!" },
  });
  await A.views.appointments();
  await settle();
  const html = content.innerHTML;
  assert.ok(html.includes("adm-status adm-status-pending"), "gepland → adm-status-pending");
  assert.ok(html.includes("adm-status adm-status-goedgekeurd"), "bevestigd → adm-status-goedgekeurd");
  assert.ok(html.includes("Ingepland") && html.includes("Bevestigd!"),
    "tAptStatus vertaalt de status niet · de ruwe waarde staat in het scherm");
});

test("APT 13· lege lijst toont de lege staat met aanmaakknop", async () => {
  const { A, content } = laad({ afspraken: [] });
  await A.views.appointments();
  await settle();
  assert.ok(content.innerHTML.includes('id="admEmptyNewApt"'),
    "zonder afspraken hoort de aanmaakknop in de lege staat te staan");
  assert.equal(content.innerHTML.includes("adm-apt-row"), false);
});

test("APT 14· een rij openen gebruikt de gedeelde openDrawer met de juiste afspraak", async () => {
  const { A, content, drawerTitle, drawerBody, gedaan } = laad();
  await A.views.appointments();
  await settle();
  const rijen = content.querySelectorAll(".adm-apt-row");
  assert.equal(rijen.length, 3);
  // Rij 1 = Acme. De klik moet die afspraak in de drawer zetten, niet een lege.
  rijen[0].handlers.click({ target: { closest: () => null } });
  await settle();
  assert.ok(gedaan.includes("openDrawer"), "de drawer wordt niet geopend");
  assert.ok(drawerTitle.textContent.includes("bewerken"),
    "een bestaande afspraak opent als 'nieuw'");
  assert.ok(drawerBody.innerHTML.includes('value="Acme"'), "de klantnaam staat niet voorgevuld");
  assert.ok(drawerBody.innerHTML.includes('value="2099-03-04"'), "de datum staat niet voorgevuld");
});

test("APT 15· een klik op een knop in de rij opent de rij-drawer NIET dubbel", async () => {
  const { A, content, gedaan } = laad();
  await A.views.appointments();
  await settle();
  const rij = content.querySelectorAll(".adm-apt-row")[0];
  rij.handlers.click({ target: { closest: sel => (sel === "button" ? {} : null) } });
  await settle();
  assert.equal(gedaan.includes("openDrawer"), false,
    "de rij-handler negeert de knop-uitzondering · dan opent de drawer twee keer");
});

test("APT 16· nieuw aanmaken opent een lege drawer met alleen open werkbonnen", async () => {
  const { A, drawerTitle, drawerBody, elementen, content } = laad();
  await A.views.appointments();
  await settle();
  elementen.get("admNewApt").handlers.click();
  await settle();
  assert.ok(drawerTitle.textContent.includes("Nieuwe"), "de nieuw-drawer heeft de verkeerde titel");
  assert.equal(drawerBody.innerHTML.includes('id="aptDelete"'), false,
    "een nieuwe afspraak krijgt een verwijderknop");
  assert.ok(drawerBody.innerHTML.includes("Dakwerken"), "de open werkbon ontbreekt in de keuzelijst");
  assert.equal(drawerBody.innerHTML.includes("Afgerond werk"), false,
    "een voltooide werkbon hoort niet in de keuzelijst");
  assert.ok(content.innerHTML.length > 0);
});

test("APT 17· verwijderen vraagt eerst bevestiging via de gedeelde uiConfirm", async () => {
  const { A, gedaan, apiCalls, elementen } = laad({ bevestig: false });
  await A.drawers.appointment(AFSPRAKEN[0]);
  await settle();
  elementen.get("aptDelete").handlers.click();
  await settle();
  const vraag = gedaan.find(x => x && x.uiConfirm);
  assert.ok(vraag, "er wordt niets gevraagd voor er verwijderd wordt");
  assert.ok(vraag.uiConfirm.includes("2099-03-04"), "de datum staat niet in de vraag");
  assert.ok(vraag.opties && vraag.opties.danger === true, "de bevestiging is niet als gevaarlijk gemarkeerd");
  assert.equal(apiCalls.some(c => c.startsWith("DELETE")), false,
    "bij 'nee' wordt er tóch verwijderd");
});

test("APT 18· zonder woordenlijst valt het scherm terug op de Nederlandse tekst", async () => {
  const { A, content } = laad({ i18n: false });
  await A.views.appointments();
  await settle();
  assert.ok(content.innerHTML.includes("Afspraken"), "geen leesbare fallback zonder woordenlijst");
  assert.ok(content.innerHTML.includes("Komende"));
});

test("APT 19· de werkbon-term komt uit wfpTerms als die er is", async () => {
  const zonder = laad();
  await zonder.A.views.appointments();
  await settle();
  assert.ok(zonder.content.innerHTML.includes("Werkbon"), "zonder wfpTerms hoort de tA-fallback te staan");

  const met = laad({ terms: { t: sleutel => (sleutel === "jobSingular" ? "Interventie" : null) } });
  await met.A.views.appointments();
  await settle();
  assert.ok(met.content.innerHTML.includes("Interventie"),
    "de eigen woordenlijst van de klant wordt genegeerd");
});
