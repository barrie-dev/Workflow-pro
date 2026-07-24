"use strict";
// ── Extractie van het scherm "workorders" uit admin.js ───────────────────────
//
// Een extractie is pas te vertrouwen als je kunt zien dat er NIETS veranderd is.
// Daarom toetst dit bestand twee dingen naast elkaar:
//
//   * de GRENS · leest de module de gedeelde context of maakt ze een tweede
//     waarheid aan (eigen kopie van uName/tWoStatus/uiConfirm/...)?
//   * het GEDRAG · draai de renderer in een nep-DOM en kijk of de rijen, de
//     factuurknop en de filters doen wat ze in admin.js deden.
//
// Regeleindes normaliseren: dit bestand staat op Windows in CRLF en dan matcht
// een patroon met \n opeens niets meer. Een test die daardoor omvalt zegt niets
// over de code.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MOD = path.join(__dirname, "..", "public", "js", "platforms", "admin-werkbonnen.js");
const src = fs.readFileSync(MOD, "utf8").replace(/\r\n/g, "\n");

/** Broncode zonder commentaar · anders telt een uitleg mee als code. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ── Nep-DOM en nep-context ───────────────────────────────────────────────────
// Klein met opzet: renderWorkorders raakt alleen #admContent aan, hangt
// listeners aan een handvol ids en loopt over querySelectorAll-resultaten.

function maakElement(id) {
  return {
    id, value: "", innerHTML: "", textContent: "", dataset: {}, handlers: {},
    addEventListener(type, fn) { this.handlers[type] = fn; },
    // Een handler oproepen zoals de browser dat zou doen.
    vuur(type, waarde) { return this.handlers[type]({ target: { value: waarde } }); },
  };
}

const WERKBONNEN = [
  // uren > 0, nog niet gefactureerd → factureerbaar
  { id: "wo-0001", number: "WB-001", title: "Dakwerken", clientName: "Acme", userId: "u1", userName: "Jan Peeters", status: "open", priority: "hoog", scheduledDate: "2026-07-01", billableHours: 8 },
  // al gefactureerd → nooit factureerbaar, ook al zijn er uren
  { id: "wo-0002", number: "WB-002", title: "Onderhoud", clientName: "Beta", userId: "u2", userName: "Els Claes", status: "Voltooid", priority: "laag", scheduledDate: "2026-07-02", billableHours: 4, invoiceId: "inv-1" },
  // vast bedrag → factureerbaar zonder uren; status "done" hoort bij de done-groep
  { id: "wo-0003", number: "WB-003", title: "Herstelling", clientName: "Gamma", userId: "u1", userName: "Jan Peeters", status: "done", priority: "normaal", createdAt: "2026-06-30T10:00:00Z", fixedPrice: 250 },
];
const MEDEWERKERS = [{ id: "u1", name: "Jan Peeters" }, { id: "u2", name: "Els Claes" }];

function laad(opties) {
  const cfg = opties || {};
  const werkbonnen = cfg.werkbonnen || WERKBONNEN;
  const elementen = new Map();
  const content = maakElement("admContent");
  elementen.set("admContent", content);
  const gevraagdeSleutels = [];
  const gedrukteKnoppen = [];

  const A = {
    api: async (method, pad) => {
      if (pad === "/workorders") return { workorders: werkbonnen };
      if (pad === "/employees") return { employees: MEDEWERKERS };
      return {};
    },
    esc: v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    switchView: view => gedrukteKnoppen.push("switchView:" + view),
    uName: rec => (rec && (rec.userName || rec.userEmail)) || "Onbekende medewerker",
    tWoStatus: s => "status:" + s,
    uiConfirm: async () => true,
    openWorkorderDrawer: wo => gedrukteKnoppen.push("drawer:" + (wo ? wo.id : "nieuw")),
    views: {},
    drawers: {},
  };

  const document = {
    getElementById(id) {
      if (elementen.has(id)) return elementen.get(id);
      // Alleen ids die in de gerenderde HTML voorkomen bestaan echt.
      if (!content.innerHTML.includes(`id="${id}"`)) return null;
      const el = maakElement(id);
      elementen.set(id, el);
      return el;
    },
    querySelectorAll: () => [],
  };

  const window = {
    wfpAdmin: A,
    wfpI18n: cfg.i18n === false ? null : { t: (key, fallback) => { gevraagdeSleutels.push(key); return fallback; } },
    showToast: () => {},
  };

  vm.runInNewContext(src, { window, document, setTimeout, clearTimeout, console });
  return { A, content, elementen, gevraagdeSleutels, gedrukteKnoppen };
}

/** Wachten tot de asynchrone renderer klaar is (api is een promise). */
const settle = () => new Promise(r => setTimeout(r, 5));

// ── 1· de grens ──────────────────────────────────────────────────────────────

test("WO 1· de module LEEST window.wfpAdmin en maakt hem niet aan", () => {
  assert.equal(/window\.wfpAdmin\s*=/.test(src), false,
    "een schermmodule die de gedeelde context aanmaakt, kan admin.js overschrijven");
  assert.match(src, /const A = window\.wfpAdmin;/);
  assert.match(src, /if \(!A\) return;/,
    "zonder deze bewaking klapt de module als admin.js niet geladen is");
});

test("WO 2· de module registreert zich als A.views.workorders", () => {
  const { A } = laad();
  assert.equal(typeof A.views.workorders, "function");
  // De renderer is niet ook nog eens ergens anders opgehangen.
  assert.deepEqual(Object.keys(A.views), ["workorders"]);
});

test("WO 3· elke aangeroepen functie is hier gedefinieerd OF komt uit A", () => {
  // Alles wat als naam(...) wordt aangeroepen, zonder punt ervoor (dus geen
  // methodes zoals .map( of A.esc( ).
  // De CSS in de template-strings kent ook een var(--…)-oproep · dat is geen JS.
  const aangeroepen = new Set(
    [...code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(\s*(--)?/g)]
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
  for (const naam of ["api", "esc", "switchView", "uName", "tWoStatus", "uiConfirm", "openWorkorderDrawer"]) {
    assert.ok(uitA.has(naam), `${naam} wordt niet uit window.wfpAdmin gelezen`);
  }
});

test("WO 4· gedeelde helpers zijn NIET gekopieerd (geen tweede waarheid)", () => {
  for (const naam of ["uName", "tWoStatus", "uiConfirm", "openWorkorderDrawer", "openFactuurDrawer", "empNameById"]) {
    assert.equal(new RegExp(`function\\s+${naam}\\s*\\(`).test(code), false,
      `${naam} staat nu in twee bestanden · die lopen ooit uit elkaar`);
  }
  // Wat WEL exclusief van dit scherm is, hoort hier te staan.
  for (const naam of ["woBillable", "tWoPrio", "renderWorkorders"]) {
    assert.match(code, new RegExp(`function\\s+${naam}\\s*\\(`), `${naam} is niet meeverhuisd`);
  }
  // De filterstand hoort bij dit scherm en nergens anders.
  assert.match(code, /let _woFilterStatus = "";[\s\S]*let _woFilterUser\s*=\s*"";[\s\S]*let _woFilterSearch = "";/);
});

// ── 2· de teksten ────────────────────────────────────────────────────────────

test("WO 5· elke tekst die in admin.js een i18n-sleutel had, heeft die nog", () => {
  // Vastgelegd zoals het origineel het deed (admin.js regels 4092-4213 plus
  // tWoPrio). Verdwijnt er hier een sleutel, dan is het scherm stil eentalig
  // geworden · dat is precies wat een extractie niet mag doen.
  const SLEUTELS = [
    "nav.workorders", "emp.wo.default", "adm.wo.searchPh", "adm.allStatuses",
    "dash.woseg.open", "dash.woseg.inprog", "dash.woseg.done", "dash.woseg.cancelled",
    "adm.wo.allEmployees", "adm.wo.clearFilters",
    "adm.thTitle", "adm.thEmployee", "adm.thCustomer", "adm.status", "adm.thPriority",
    "adm.date", "adm.actions",
    "adm.wo.invoiced", "adm.wo.toInvoice", "adm.edit",
    "adm.wo.noResults", "adm.wo.emptyTitle", "adm.wo.emptyBtn",
    "adm.wo.prioHigh", "adm.wo.prioNormal", "adm.wo.prioLow",
  ];
  const ontbreekt = SLEUTELS.filter(k => !src.includes(`"${k}"`));
  assert.deepEqual(ontbreekt, [], `i18n-sleutels weggevallen bij de extractie: ${ontbreekt.join(", ")}`);
});

test("WO 6· de i18n-sleutels worden ook echt opgevraagd bij het renderen", async () => {
  const { A, gevraagdeSleutels } = laad();
  await A.views.workorders();
  await settle();
  for (const k of ["nav.workorders", "adm.thTitle", "adm.status", "adm.wo.toInvoice", "adm.wo.prioHigh"]) {
    assert.ok(gevraagdeSleutels.includes(k), `${k} wordt niet opgevraagd · staat de tekst hardgecodeerd?`);
  }
});

test("WO 7· tekst die in admin.js LETTERLIJK stond, blijft letterlijk", () => {
  // Het origineel vertaalde deze niet. Er nu wel een sleutel van maken zou een
  // gedragswijziging zijn die in een extractie niemand verwacht.
  for (const tekst of [
    'title="Open werkbon"',
    'title="Maak factuur van deze werkbon"',
    "De geklokte of factureerbare uren, of het vaste bedrag, worden overgenomen in een nieuwe klantfactuur.",
    "Factuur maken van deze werkbon",
    "Factureren mislukt",
  ]) {
    assert.ok(src.includes(tekst), `de letterlijke tekst "${tekst}" is verdwenen of vertaald`);
  }
});

// ── 3· het gedrag ────────────────────────────────────────────────────────────

test("WO 8· rendert een rij per werkbon met naam, klant en status uit A", async () => {
  const { A, content } = laad();
  await A.views.workorders();
  await settle();
  const html = content.innerHTML;
  assert.ok(html.includes("Dakwerken") && html.includes("Onderhoud") && html.includes("Herstelling"));
  assert.ok(html.includes("Jan Peeters"), "de naamresolver A.uName wordt niet gebruikt");
  assert.ok(html.includes("status:open"), "de statusvertaler A.tWoStatus wordt niet gebruikt");
  assert.match(html, /3\/3/, "de teller toont niet zichtbaar/totaal");
  assert.equal((html.match(/class="adm-row-link adm-wo-row"/g) || []).length, 3);
});

test("WO 9· de factuurknop volgt woBillable · niet de status", async () => {
  const { A, content } = laad();
  await A.views.workorders();
  await settle();
  const html = content.innerHTML;
  // wo-0001 (uren) en wo-0003 (vast bedrag) mogen gefactureerd worden.
  assert.ok(html.includes('adm-wo-invoice" data-id="wo-0001"'));
  assert.ok(html.includes('adm-wo-invoice" data-id="wo-0003"'));
  // wo-0002 heeft een invoiceId: geen knop, wel de melding.
  assert.equal(html.includes('adm-wo-invoice" data-id="wo-0002"'), false,
    "een al gefactureerde werkbon krijgt opnieuw een factuurknop");
  assert.ok(html.includes("gefactureerd"));
});

test("WO 10· de statusfilter groepeert Voltooid/Afgewerkt/done samen", async () => {
  const { A, content, elementen } = laad();
  await A.views.workorders();
  await settle();
  elementen.get("admWoStatusFilter").vuur("change", "done");
  await settle();
  const html = content.innerHTML;
  assert.match(html, /2\/3/, "de done-groep vangt niet alle drie de schrijfwijzen");
  assert.ok(html.includes("Onderhoud") && html.includes("Herstelling"));
  assert.equal(html.includes("Dakwerken"), false, "een open werkbon staat in de done-groep");
});

test("WO 11· zoeken filtert op titel, klant en medewerker", async () => {
  const { A, content, elementen } = laad();
  await A.views.workorders();
  await settle();
  elementen.get("admWoSearch").vuur("input", "  acme ");
  await settle();
  assert.match(content.innerHTML, /1\/3/);
  assert.ok(content.innerHTML.includes("Dakwerken"), "zoeken op klantnaam vindt de werkbon niet");

  elementen.get("admWoSearch").vuur("input", "Els Claes");
  await settle();
  assert.ok(content.innerHTML.includes("Onderhoud"), "zoeken op medewerkersnaam werkt niet");
});

test("WO 12· de medewerkerfilter kijkt naar userId", async () => {
  const { A, content, elementen } = laad();
  await A.views.workorders();
  await settle();
  elementen.get("admWoUserFilter").vuur("change", "u1");
  await settle();
  assert.match(content.innerHTML, /2\/3/);
  assert.equal(content.innerHTML.includes("Onderhoud"), false);
});

test("WO 13· wis-filters verschijnt pas als er gefilterd is en zet alles terug", async () => {
  const { A, content, elementen } = laad();
  await A.views.workorders();
  await settle();
  assert.equal(content.innerHTML.includes('id="admWoClearFilter"'), false,
    "de wisknop staat er zonder actieve filter");

  elementen.get("admWoUserFilter").vuur("change", "u2");
  await settle();
  assert.ok(content.innerHTML.includes('id="admWoClearFilter"'));

  elementen.get("admWoClearFilter").handlers.click();
  await settle();
  assert.match(content.innerHTML, /3\/3/, "wis filters zet de filterstand niet terug");
});

test("WO 14· lege lijst toont de lege staat, gefilterde lege lijst niet", async () => {
  const leeg = laad({ werkbonnen: [] });
  await leeg.A.views.workorders();
  await settle();
  assert.ok(leeg.content.innerHTML.includes('id="admEmptyNewWO"'),
    "zonder werkbonnen hoort de aanmaakknop in de lege staat te staan");

  const gefilterd = laad();
  await gefilterd.A.views.workorders();
  await settle();
  gefilterd.elementen.get("admWoSearch").vuur("input", "bestaat-niet");
  await settle();
  assert.equal(gefilterd.content.innerHTML.includes('id="admEmptyNewWO"'), false,
    "een filter zonder resultaat mag niet als 'nog niets aangemaakt' lezen");
  assert.ok(gefilterd.content.innerHTML.includes("Geen resultaten voor deze filters"));
});

test("WO 15· de drawer wordt via de gedeelde openWorkorderDrawer geopend", async () => {
  const { A, elementen, gedrukteKnoppen } = laad();
  await A.views.workorders();
  await settle();
  elementen.get("admNewWO").handlers.click();
  assert.deepEqual(gedrukteKnoppen, ["drawer:nieuw"],
    "de nieuw-knop opent niet de gedeelde werkbon-drawer");
});

test("WO 16· zonder i18n valt het scherm terug op de Nederlandse tekst", async () => {
  const { A, content } = laad({ i18n: false });
  await A.views.workorders();
  await settle();
  assert.ok(content.innerHTML.includes("Werkbonnen"), "geen leesbare fallback zonder woordenlijst");
  assert.ok(content.innerHTML.includes("Alle medewerkers"));
});
