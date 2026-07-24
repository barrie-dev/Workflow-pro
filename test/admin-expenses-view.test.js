"use strict";
// ── Extractie van het onkostenscherm uit de admin-monoliet ───────────────────
// public/js/platforms/admin-onkosten.js is een LETTERLIJKE verplaatsing van
// renderExpenses c.s. uit admin.js. Bij zo'n verplaatsing is de vraag niet of
// de code nog compileert, maar of er onderweg een grens is weggevallen:
//
//   * maakt de module de gedeelde context aan in plaats van hem te lezen?
//   * hangt ze aan het juiste haakje (A.views.expenses) en alleen daaraan?
//   * roept ze iets aan dat nergens vandaan komt · een helper die stilletjes
//     mee gekopieerd is (twee waarheden) of juist vergeten is (kapot scherm)?
//   * is er onderweg i18n verdampt tot harde Nederlandse tekst?
//   * en is de verplaatste code echt woord-voor-woord dezelfde?
//
// De module draait in een vm-context met een nagebootste window en document,
// zodat het gedrag getoetst wordt en niet alleen de tekst van het bestand.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MOD = path.join(__dirname, "..", "public", "js", "platforms", "admin-onkosten.js");
const ADMIN = path.join(__dirname, "..", "public", "js", "platforms", "admin.js");
// Regeleindes normaliseren: git zet ze op Windows naar CRLF zodra hij het
// bestand aanraakt, en dan matcht een patroon met \n opeens niets meer.
const src = fs.readFileSync(MOD, "utf8").replace(/\r\n/g, "\n");

/** Broncode zonder commentaar · anders faalt een test op een uitleg. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Minimaal DOM-element: genoeg om het scherm te laten renderen. */
function elem(id) {
  return {
    id, innerHTML: "", value: "",
    addEventListener() {},
    querySelectorAll() { return []; }
  };
}

/** Voer de module uit met een nagebootste window/document; geef de context terug. */
function laad(wfpAdmin, els) {
  const window = {};
  if (wfpAdmin !== undefined) window.wfpAdmin = wfpAdmin;
  const elementen = els || {};
  const document = {
    getElementById: id => elementen[id] || null,
    createElement: () => elem("nieuw"),
    body: { appendChild() {} }
  };
  const ctx = { window, document, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "admin-onkosten.js" });
  return { window, document, elementen };
}

// ── 1· de gedeelde context wordt gelezen, niet aangemaakt ────────────────────

test("ONK 1· de module maakt window.wfpAdmin NIET aan, ze leest hem", () => {
  assert.equal(/window\.wfpAdmin\s*=/.test(code(src)), false,
    "alleen admin.js mag de gedeelde context aanmaken");
  assert.ok(/window\.wfpAdmin/.test(src), "een werkruimte die de context niet leest hangt los");

  // Gedrag: zonder shell doet de module niets en laat ze niets achter.
  const w = laad(undefined).window;
  assert.equal("wfpAdmin" in w, false,
    "de module heeft window.wfpAdmin aangemaakt terwijl de shell nog niet geladen was");
});

test("ONK 2· zonder shell valt de module stil in plaats van te ontploffen", () => {
  // Scripttag-volgorde is niet gegarandeerd bij een deploy-hapering; een
  // werkruimte die dan een TypeError gooit sloopt de hele pagina.
  assert.doesNotThrow(() => laad(undefined));
  assert.doesNotThrow(() => laad(null));
});

// ── 2· registratie ───────────────────────────────────────────────────────────

test("ONK 3· de module registreert zichzelf als A.views.expenses", () => {
  const A = { esc: v => v, api: () => Promise.resolve({}) };
  laad(A);
  assert.equal(typeof A.views.expenses, "function", "A.views.expenses is niet geregistreerd");
  assert.deepEqual(Object.keys(A.views), ["expenses"],
    "deze module hoort precies één scherm te registreren");
  assert.equal("drawers" in A, false,
    "het onkostenscherm heeft geen drawer · registreer er dan ook geen");
});

test("ONK 4· een bestaande views-registry wordt aangevuld, niet vervangen", () => {
  // admin.js registreert zijn kern-renderers vóór dit script laadt. Een
  // module die A.views overschrijft haalt de rest van de app onderuit.
  const bestaand = () => "dashboard";
  const A = { esc: v => v, views: { dashboard: bestaand } };
  laad(A);
  assert.equal(A.views.dashboard, bestaand, "andere schermen zijn weggegooid");
  assert.equal(typeof A.views.expenses, "function");
});

// ── 3· herkomst van elke functie ─────────────────────────────────────────────

// Helpers die in admin.js MOETEN blijven staan (andere schermen gebruiken ze
// ook) en hier dus uit de gedeelde context komen.
const GEDEELD = ["esc", "api", "uName"];

// Wat het scherm exclusief zelf is en dus meeverhuisde. openExpenseReviewModal
// hoort hierbij: buiten dit scherm roept niemand hem aan.
const EIGEN = ["tA", "renderExpenses", "buildExpRows", "openExpenseLinkModal",
  "wireExpBtns", "openExpenseReviewModal"];

test("ONK 5· gedeelde helpers worden gedelegeerd, niet gekopieerd", () => {
  const c = code(src);
  for (const naam of GEDEELD) {
    assert.ok(new RegExp(`A\\.${naam}\\b`).test(c),
      `${naam} wordt niet uit de gedeelde context gehaald`);
    assert.equal(new RegExp(`function\\s+${naam}\\s*\\(`).test(c), false,
      `${naam} is meegekopieerd · dan staat dezelfde waarheid op twee plekken`);
  }
});

test("ONK 6· elke aangeroepen functie is eigen, gedeeld of een veilige globale", () => {
  const c = code(src);
  const SLEUTELWOORDEN = new Set(["if", "for", "while", "switch", "catch", "return",
    "typeof", "function", "await", "async", "new", "of", "in", "do", "else"]);
  // Globals die een browser-scherm per definitie mag aanraken. Elke naam die
  // hier NIET in staat en ook niet uit A komt, is een vergeten of gekopieerde
  // helper · precies wat deze test moet vangen.
  const GLOBALS = new Set(["document", "window", "Date", "Number", "String", "Boolean",
    "Array", "Object", "Math", "Intl", "FormData", "Promise", "JSON", "parseInt",
    "parseFloat", "isNaN", "Set", "Map", "RegExp", "Error"]);
  // CSS-functies uit de style-attributen in de HTML-sjablonen · var(--gray-400),
  // rgba(11,19,32,.42). Ze zien er voor een regex uit als een aanroep maar zijn
  // het niet.
  const CSS = new Set(["var", "rgba", "rgb", "calc", "repeat", "translate", "url"]);
  // Schermtekst waarin toevallig een haakje volgt · "Geen (ontkoppelen)" in de
  // werkbon-keuzelijst. Ook dat is geen aanroep.
  const SCHERMTEKST = new Set(["Geen"]);

  const functies = [...c.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]);
  const bindingen = [...c.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]);
  // Parameters tellen ook als "hier gedefinieerd": openExpenseLinkModal(expId,
  // refresh) roept refresh() aan, en dat is geen zwevende helper.
  const params = [];
  const push = lijst => lijst.split(",").forEach(p => {
    const naam = p.replace(/[{}[\]]/g, "").split(/[=:]/)[0].replace(/\.\.\./, "").trim();
    if (/^[A-Za-z_$][\w$]*$/.test(naam)) params.push(naam);
  });
  [...c.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)].forEach(m => push(m[1]));
  [...c.matchAll(/\(([^)]*)\)\s*=>/g)].forEach(m => push(m[1]));
  [...c.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*=>/gm)].forEach(m => params.push(m[1]));

  const gedefinieerd = new Set([...functies, ...bindingen, ...params]);
  // Losse aanroepen: iets(...) zonder punt ervoor. Methodes (x.y()) blijven
  // buiten beeld · die horen bij hun object, niet bij deze module. Het teken
  // vóór de naam wordt op index bekeken en NIET meegematcht: anders eet de
  // buitenste aanroep het scheidingsteken op en glipt de binnenste erdoor
  // (esc(uName(e)) verstopt zo uName · precies de fout die deze test zoekt).
  const aangeroepen = [];
  for (const m of c.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
    const voor = m.index > 0 ? c[m.index - 1] : "";
    if (voor === "." || /[\w$]/.test(voor)) continue;
    aangeroepen.push(m[1]);
  }

  const onbekend = [...new Set(aangeroepen)]
    .filter(n => !SLEUTELWOORDEN.has(n))
    .filter(n => !GLOBALS.has(n))
    .filter(n => !CSS.has(n))
    .filter(n => !SCHERMTEKST.has(n))
    .filter(n => !gedefinieerd.has(n));
  assert.deepEqual(onbekend, [],
    `deze functies komen nergens vandaan: ${onbekend.join(", ")}`);

  // En omgekeerd: precies de verwachte set functies is meeverhuisd · niet meer
  // (dan is er iets gekopieerd) en niet minder (dan is er iets vergeten).
  assert.deepEqual(functies.slice().sort(), EIGEN.slice().sort());
});

test("ONK 7· de shell-helpers worden ook echt aangeroepen tijdens het renderen", () => {
  // Zonder deze test kan ONK 5 slagen op een dode regel: A.api wordt gebonden
  // maar nooit gebruikt omdat er stiekem een eigen fetch in staat.
  const c = code(src);
  assert.equal(/\bfetch\s*\(/.test(c), false,
    "de module praat buiten A.api om met de server");
  assert.equal(/localStorage/.test(c), false,
    "de module leest de sessie buiten de shell om");
  for (const pad of ['"/expenses"', '"/workorders"', "/expenses/${expId}", "/expenses/${id}"]) {
    assert.ok(c.includes(pad), `endpoint ${pad} is bij de verplaatsing verdwenen`);
  }
});

// ── 4· gedrag · het scherm rendert nog echt ──────────────────────────────────

test("ONK 8· renderExpenses haalt de data op en vult de tabel via A.esc/A.uName", async () => {
  const calls = [];
  const els = { admContent: elem("admContent"), admExpTable: elem("admExpTable"), admExpFilter: elem("admExpFilter") };
  const A = {
    esc: v => String(v == null ? "" : v),
    uName: rec => rec.userName || "Onbekende medewerker",
    api: (m, p) => {
      calls.push(`${m} ${p}`);
      if (p === "/expenses") {
        return Promise.resolve({ expenses: [
          { id: "e1", userName: "Jan Peeters", date: "2026-07-01", category: "Brandstof", amount: 42.5, status: "ingediend" },
          { id: "e2", userName: "Ana Diaz", date: "2026-07-02", category: "Parking", amount: 7, status: "goedgekeurd" }
        ] });
      }
      return Promise.resolve({ workorders: [] });
    }
  };
  laad(A, els);
  await A.views.expenses();

  assert.deepEqual(calls, ["GET /expenses", "GET /workorders"],
    "het scherm haalt onkosten én werkbonnen op · de werkbon-kolom hangt daaraan");
  // KPI-blok: 1 in behandeling, 1 goedgekeurd, 2 totaal.
  assert.ok(els.admContent.innerHTML.includes("adm-kpi"), "het KPI-blok is niet gerenderd");
  const rijen = els.admExpTable.innerHTML;
  assert.ok(rijen.includes("Jan Peeters") && rijen.includes("Ana Diaz"),
    "A.uName wordt niet gebruikt · de tabel toont geen namen");
  assert.ok(rijen.includes("€ 42.50"), "het bedrag wordt niet meer met twee decimalen getoond");
  // Alleen de ingediende rij krijgt beoordeel-knoppen.
  assert.equal((rijen.match(/adm-exp-review/g) || []).length, 2,
    "goedkeuren/weigeren hoort alleen bij een rij die nog in behandeling is");
});

test("ONK 9· een lege lijst geeft de lege-staat, geen kapotte tabel", async () => {
  const els = { admContent: elem("admContent"), admExpTable: elem("admExpTable") };
  const A = { esc: v => v, uName: r => r.userName, api: () => Promise.resolve({ expenses: [] }) };
  laad(A, els);
  await A.views.expenses();
  assert.ok(els.admExpTable.innerHTML.includes("adm-empty"), "de lege-staat ontbreekt");
  assert.equal(els.admExpTable.innerHTML.includes("<table"), false);
});

// ── 5· i18n mag bij een verplaatsing niet verdampen ──────────────────────────

// Exact de sleutels die het origineel in dit blok gebruikte (admin.js
// 3875-4075). Verdwijnt er één, dan staat er weer harde tekst op het scherm
// en is de FR/EN-vertaling stil kapot.
const SLEUTELS = ["adm.actions", "adm.allStatuses", "adm.amount", "adm.date",
  "adm.exp.allStatusesSub", "adm.exp.claims", "adm.exp.fPending", "adm.exp.none",
  "adm.exp.title", "adm.exp.totalSubmitted", "adm.status", "adm.thCategory",
  "adm.thDescription", "adm.thEmployee", "adm.thWorkorder",
  "emp.status.geweigerd", "emp.status.goedgekeurd"];

test("ONK 10· alle i18n-sleutels van het origineel zijn meeverhuisd", () => {
  const gebruikt = new Set([...src.matchAll(/tA\(\s*"([^"]+)"/g)].map(m => m[1]));
  const kwijt = SLEUTELS.filter(k => !gebruikt.has(k));
  assert.deepEqual(kwijt, [], `deze sleutels zijn verdwenen: ${kwijt.join(", ")}`);
  // En er zijn er geen bijgekomen: een nieuwe sleutel bestaat niet in de
  // bundel en rendert dus de terugval · dat is geen verplaatsing meer.
  const nieuw = [...gebruikt].filter(k => !SLEUTELS.includes(k));
  assert.deepEqual(nieuw, [], `deze sleutels zijn erbij verzonnen: ${nieuw.join(", ")}`);
});

test("ONK 11· de KPI's en de tabelkoppen blijven achter een i18n-sleutel", () => {
  // Deze labels waren in het origineel vertaald. Staan ze hier hard in de HTML,
  // dan is de FR/EN-versie stil Nederlands geworden.
  const zonderI18n = code(src).replace(/tA\(\s*"[^"]*"\s*,\s*"[^"]*"\s*\)/g, "tA()");
  const LABELS = ["In behandeling", "Totaal ingediend", "alle statussen", "declaraties",
    "Alle statussen", "Onkostennota's", "Geen onkosten gevonden", "Medewerker",
    "Datum", "Categorie", "Bedrag", "Omschrijving", "Acties"];
  const hard = LABELS.filter(w => zonderI18n.includes(w));
  assert.deepEqual(hard, [], `harde schermtekst zonder i18n-sleutel: ${hard.join(", ")}`);
});

test("ONK 12· de tekst die het origineel al hard had, is niet stiekem 'verbeterd'", () => {
  // De twee modals en de rij-knoppen waren in admin.js nooit vertaald. Een
  // extractie is niet de plek om dat te repareren: dan verandert er gedrag
  // in dezelfde stap en is de verplaatsing niet meer te reviewen. Deze test
  // legt de bestaande i18n-schuld vast · verhelpen mag, maar in een eigen
  // commit die deze lijst leegmaakt.
  const HARD_IN_ORIGINEEL = ["Goed", "Weigeren", "Werkbon", "op factuur",
    "niet doorrekenen", "Onkost koppelen aan werkbon", "Geen (ontkoppelen)",
    "Doorrekenen aan de klant op de werkbon-factuur", "Annuleren", "Opslaan",
    "Onkost gekoppeld aan werkbon", "Onkost ontkoppeld", "Onkost goedkeuren",
    "Onkost weigeren", "Geef een reden op bij weigering.", "Goedkeuren",
    "Onkost goedgekeurd", "Onkost geweigerd"];
  const kwijt = HARD_IN_ORIGINEEL.filter(t => !src.includes(t));
  assert.deepEqual(kwijt, [],
    `deze tekst stond letterlijk in het origineel en is nu weg: ${kwijt.join(", ")}`);
});

// ── 6· de verplaatsing is letterlijk ─────────────────────────────────────────

test("ONK 13· het verplaatste blok staat woord-voor-woord in admin.js", () => {
  const adminSrc = fs.readFileSync(ADMIN, "utf8").replace(/\r\n/g, "\n");
  if (!adminSrc.includes("async function renderExpenses()")) {
    // Het blok is centraal uit admin.js geknipt · de vergelijking heeft geen
    // bron meer en de test ontwapent zichzelf.
    return;
  }
  const start = src.indexOf("  async function renderExpenses()");
  const eind = src.indexOf("\n  A.views = A.views ||");
  assert.ok(start > 0 && eind > start, "het blok is niet terug te vinden in de module");
  const blok = src.slice(start, eind).replace(/\s+$/, "");
  assert.ok(adminSrc.includes(blok),
    "de verplaatste code wijkt af van admin.js · een extractie die onderweg gedrag verandert is niet te reviewen");
});

test("ONK 14· geen em-dash in gebruikerszichtbare tekst", () => {
  assert.equal(src.includes("—"), false,
    "em-dash is verboden in deze codebase · gebruik \"-\" of \"·\"");
});
