"use strict";
// ── Extractie van het verlofscherm uit de admin-monoliet ─────────────────────
// public/js/platforms/admin-verlof.js is een LETTERLIJKE verplaatsing van
// renderLeaves c.s. uit admin.js. Bij zo'n verplaatsing is de vraag niet of de
// code nog compileert, maar of er onderweg een grens is weggevallen:
//
//   * maakt de module de gedeelde context aan in plaats van hem te lezen?
//   * hangt ze aan het juiste haakje (A.views.leaves) en alleen daaraan?
//   * roept ze iets aan dat nergens vandaan komt · een helper die stilletjes
//     mee gekopieerd is (twee waarheden) of juist vergeten is (kapot scherm)?
//   * is er onderweg i18n verdampt tot harde Nederlandse tekst?
//
// De module draait in een vm-context met een nagebootste window, zodat het
// gedrag getoetst wordt en niet alleen de tekst van het bestand.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MOD = path.join(__dirname, "..", "public", "js", "platforms", "admin-verlof.js");
// Regeleindes normaliseren: git zet ze op Windows naar CRLF zodra hij het
// bestand aanraakt, en dan matcht een patroon met \n opeens niets meer.
const src = fs.readFileSync(MOD, "utf8").replace(/\r\n/g, "\n");

/** Broncode zonder commentaar · anders faalt een test op een uitleg. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Voer de module uit met een nagebootste window en geef die window terug. */
function laad(wfpAdmin) {
  const window = {};
  if (wfpAdmin !== undefined) window.wfpAdmin = wfpAdmin;
  const ctx = { window, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "admin-verlof.js" });
  return window;
}

// ── 1· de gedeelde context wordt gelezen, niet aangemaakt ────────────────────

test("VL 1· de module maakt window.wfpAdmin NIET aan, ze leest hem", () => {
  assert.equal(/window\.wfpAdmin\s*=/.test(code(src)), false,
    "alleen admin.js mag de gedeelde context aanmaken");
  assert.ok(/window\.wfpAdmin/.test(src), "een werkruimte die de context niet leest hangt los");

  // Gedrag: zonder shell doet de module niets en laat ze niets achter.
  const w = laad(undefined);
  assert.equal("wfpAdmin" in w, false,
    "de module heeft window.wfpAdmin aangemaakt terwijl de shell nog niet geladen was");
});

test("VL 2· zonder shell valt de module stil in plaats van te ontploffen", () => {
  // Scripttag-volgorde is niet gegarandeerd bij een deploy-hapering; een
  // werkruimte die dan een TypeError gooit sloopt de hele pagina.
  assert.doesNotThrow(() => laad(undefined));
  assert.doesNotThrow(() => laad(null));
});

// ── 2· registratie ───────────────────────────────────────────────────────────

test("VL 3· de module registreert zichzelf als A.views.leaves", () => {
  const A = { esc: v => v, api: () => {}, state: {}, openDrawer() {}, closeDrawer() {} };
  laad(A);
  assert.equal(typeof A.views.leaves, "function", "A.views.leaves is niet geregistreerd");
  assert.deepEqual(Object.keys(A.views), ["leaves"],
    "deze module hoort precies één scherm te registreren");
});

test("VL 4· een bestaande views-registry wordt aangevuld, niet vervangen", () => {
  // admin.js registreert zijn kern-renderers vóór dit script laadt. Een
  // module die A.views overschrijft haalt de rest van de app onderuit.
  const bestaand = () => "dashboard";
  const A = { esc: v => v, views: { dashboard: bestaand } };
  laad(A);
  assert.equal(A.views.dashboard, bestaand, "andere schermen zijn weggegooid");
  assert.equal(typeof A.views.leaves, "function");
});

// ── 3· herkomst van elke functie ─────────────────────────────────────────────

// Helpers die in admin.js MOETEN blijven staan (andere schermen gebruiken ze
// ook) en hier dus gedelegeerd worden via de gedeelde context.
const GEDEELD = ["esc", "api", "openDrawer", "closeDrawer",
  "uName", "empNameById", "tLeaveType", "tLeaveStatus", "openLeaveReviewModal"];

// Wat het scherm exclusief zelf is en dus meeverhuisde.
const EIGEN = ["monthNames", "weekdayShort", "renderLeaves", "openCreateLeaveDrawer",
  "renderLeaveBody", "renderLeaveCalendar", "renderLeaveBalance", "renderLeaveTable",
  "bindLeaveActions", "tA"];

test("VL 5· gedeelde helpers worden gedelegeerd, niet gekopieerd", () => {
  const c = code(src);
  for (const naam of GEDEELD) {
    assert.ok(new RegExp(`A\\.${naam}\\b`).test(c),
      `${naam} wordt niet uit de gedeelde context gehaald`);
    assert.equal(new RegExp(`function\\s+${naam}\\s*\\(`).test(c), false,
      `${naam} is meegekopieerd · dan staat dezelfde waarheid op twee plekken`);
  }
});

test("VL 6· elke aangeroepen functie is eigen, gedeeld of een veilige globale", () => {
  const c = code(src);
  const SLEUTELWOORDEN = new Set(["if", "for", "while", "switch", "catch", "return",
    "typeof", "function", "await", "new", "of", "in", "do", "else"]);
  // Globals die een browser-scherm per definitie mag aanraken. Elke naam die
  // hier NIET in staat en ook niet uit A komt, is een vergeten of gekopieerde
  // helper · precies wat deze test moet vangen.
  const GLOBALS = new Set(["document", "window", "Date", "Number", "String", "Boolean",
    "Array", "Object", "Math", "Intl", "FormData", "Promise", "JSON", "parseInt",
    "parseFloat", "isNaN", "Set", "Map", "RegExp", "Error"]);
  // CSS-functies uit de style-attributen in de HTML-sjablonen · var(--gray-400),
  // repeat(7,1fr). Ze zien er voor een regex uit als een aanroep maar zijn het niet.
  const CSS = new Set(["var", "repeat", "calc", "rgb", "rgba", "translate", "url"]);

  const functies = [...c.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]);
  const bindingen = [...c.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]);
  const gedefinieerd = new Set([...functies, ...bindingen]);
  // Losse aanroepen: iets(...) zonder punt ervoor. Methodes (x.y()) blijven
  // buiten beeld · die horen bij hun object, niet bij deze module.
  const aangeroepen = [...c.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[2]);

  const onbekend = [...new Set(aangeroepen)]
    .filter(n => !SLEUTELWOORDEN.has(n))
    .filter(n => !GLOBALS.has(n))
    .filter(n => !CSS.has(n))
    .filter(n => !gedefinieerd.has(n));
  assert.deepEqual(onbekend, [],
    `deze functies komen nergens vandaan: ${onbekend.join(", ")}`);

  // En omgekeerd: precies de verwachte set functies is meeverhuisd · niet meer
  // (dan is er iets gekopieerd) en niet minder (dan is er iets vergeten).
  assert.deepEqual(functies.slice().sort(), EIGEN.slice().sort());
});

test("VL 7· de shell-helpers worden ook echt aangeroepen tijdens het renderen", () => {
  // Zonder deze test kan VL 5 slagen op een dode regel: A.api wordt gebonden
  // maar nooit gebruikt omdat er stiekem een eigen fetch in staat.
  assert.equal(/\bfetch\s*\(/.test(code(src)), false,
    "de module praat buiten A.api om met de server");
  assert.equal(/localStorage/.test(code(src)), false,
    "de module leest de sessie buiten de shell om");
  const c = code(src);
  for (const pad of ["/leaves", "/leaves/calendar", "/leaves/balance", "/employees"]) {
    assert.ok(c.includes(pad), `endpoint ${pad} is bij de verplaatsing verdwenen`);
  }
});

// ── 4· i18n mag bij een verplaatsing niet verdampen ──────────────────────────

// Exact de sleutels die het origineel in dit blok gebruikte (admin.js
// 3547-3834). Verdwijnt er één, dan staat er weer harde tekst op het scherm
// en is de FR/EN-vertaling stil kapot.
const SLEUTELS = ["adm.actions", "adm.allStatuses", "adm.cancel", "adm.leave.approveShort",
  "adm.leave.approvedCount", "adm.leave.balanceIntro", "adm.leave.create", "adm.leave.created",
  "adm.leave.daysAbbr", "adm.leave.employee", "adm.leave.from", "adm.leave.new",
  "adm.leave.newTitle", "adm.leave.noEmployees", "adm.leave.noRequests", "adm.leave.optNote",
  "adm.leave.pickEmployee", "adm.leave.reasonLabel", "adm.leave.reject", "adm.leave.tabBalances",
  "adm.leave.tabCalendar", "adm.leave.tabRequests", "adm.leave.thNote", "adm.leave.thProgress",
  "adm.leave.thQuota", "adm.leave.thReason", "adm.leave.thRemaining", "adm.leave.thType",
  "adm.leave.thUsed", "adm.leave.thisMonth", "adm.leave.to", "adm.leave.typeLabel",
  "adm.loading", "adm.lstatus.approved", "adm.lstatus.rejected", "adm.lstatus.requested",
  "adm.ltype.adv", "adm.ltype.bijzonder", "adm.ltype.onbetaald", "adm.ltype.vakantie",
  "adm.ltype.ziekte", "adm.status", "adm.thEmployee", "adm.unknown", "nav.leaves"];

test("VL 8· alle i18n-sleutels van het origineel zijn meeverhuisd", () => {
  const gebruikt = new Set([...src.matchAll(/tA\(\s*"([^"]+)"/g)].map(m => m[1]));
  const kwijt = SLEUTELS.filter(k => !gebruikt.has(k));
  assert.deepEqual(kwijt, [], `deze sleutels zijn verdwenen: ${kwijt.join(", ")}`);
});

test("VL 9· geen losse Nederlandse schermtekst buiten een i18n-sleutel", () => {
  // Strip commentaar én elke tA("sleutel","terugval")-aanroep. Wat er dan nog
  // aan Nederlandse labels overblijft, staat hard in de HTML en is dus in FR
  // en EN gewoon Nederlands.
  const zonderI18n = code(src).replace(/tA\(\s*"[^"]*"\s*,\s*"[^"]*"\s*\)/g, "tA()");
  const LABELS = ["Verlof", "Medewerker", "Annuleren", "Aanmaken", "Goedgekeurd",
    "Aangevraagd", "Geweigerd", "Aanvragen", "Kalender", "Saldi", "Laden",
    "Quota", "Gebruikt", "Resterend", "Voortgang", "Onbekend", "Vakantie",
    "Ziekte", "Opmerking", "Weigeren", "Acties", "Status", "Reden"];
  // Op woordgrens toetsen: "Status" is óók een stuk van de identifier
  // tLeaveStatus, en dat is geen schermtekst.
  const hard = LABELS.filter(w => new RegExp(`(^|[^A-Za-z_$])${w}([^A-Za-z_$]|$)`).test(zonderI18n));
  assert.deepEqual(hard, [], `harde schermtekst zonder i18n-sleutel: ${hard.join(", ")}`);
});

test("VL 10· de kalender blijft drietalig · maand- en dagnamen per taal", () => {
  // monthNames/weekdayShort zijn geen tA-sleutels maar opzoektabellen; die
  // vorm is bij de verplaatsing behouden en moet drietalig blijven.
  const A = { esc: v => v };
  const w = laad(A);
  assert.ok(/nl:.*Januari/.test(src) && /fr:.*Janvier/.test(src) && /en:.*January/.test(src),
    "een taal is uit de maandtabel gevallen");
  assert.ok(/nl:.*"Ma","Di"/.test(src) && /fr:.*"Lu","Ma"/.test(src) && /en:.*"Mon","Tue"/.test(src),
    "een taal is uit de dagtabel gevallen");
  assert.equal(typeof w.wfpAdmin.views.leaves, "function");
});

test("VL 11· geen em-dash in gebruikerszichtbare tekst", () => {
  assert.equal(src.includes("—"), false,
    "em-dash is verboden in deze codebase · gebruik \"-\" of \"·\"");
});
