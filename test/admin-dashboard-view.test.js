"use strict";
// ── Extractie · het dashboardscherm uit public/js/platforms/admin.js ─────────
//
// public/js/platforms/admin-dashboard.js is een LETTERLIJKE verhuizing van het
// dashboardblok uit de admin-monoliet. Bij zo'n verhuizing is de vraag niet of
// het bestand laadt, maar of er onderweg iets is weggevallen: een gedeelde
// helper die stilletjes opnieuw is geschreven (twee waarheden), een i18n-
// sleutel die is ingeruild voor kale tekst, of een scherm dat zich niet meer
// registreert. Deze tests toetsen precies dat.
//
// Ze zijn bewust ZELFSTANDIG: ze lezen admin.js niet, want het knippen van het
// oorspronkelijke blok gebeurt centraal en daarna zou een vergelijking met
// admin.js altijd falen. Wat het origineel deed staat hier daarom vastgepind.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MOD = path.join(__dirname, "..", "public", "js", "platforms", "admin-dashboard.js");
// Regeleindes normaliseren: git kan er op Windows CRLF van maken en dan matcht
// een patroon met \n opeens niets meer.
const src = fs.readFileSync(MOD, "utf8").replace(/\r\n/g, "\n");

// ── Bronscanner ─────────────────────────────────────────────────────────────
// Commentaar en de INHOUD van tekstliteralen weghalen, maar wél de ${…}-
// expressies in template-literalen behouden: daar zitten de echte aanroepen
// (esc(), tA(), admSpark()). Zonder dit onderscheid zou Nederlandse prose in
// een comment als "functieaanroep" gelezen worden.
function stripLiterals(input) {
  let out = "";
  let i = 0;
  function expr(inTemplate) {
    let depth = 0;
    while (i < input.length) {
      const ch = input[i], nx = input[i + 1];
      if (ch === "/" && nx === "/") { while (i < input.length && input[i] !== "\n") i += 1; continue; }
      if (ch === "/" && nx === "*") { i += 2; while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i += 1; i += 2; continue; }
      if (ch === '"' || ch === "'") {
        const q = ch; i += 1;
        while (i < input.length && input[i] !== q) { if (input[i] === "\\") i += 1; i += 1; }
        i += 1; out += " STR "; continue;
      }
      if (ch === "`") { i += 1; template(); continue; }
      if (inTemplate) {
        if (ch === "{") depth += 1;
        if (ch === "}") { if (depth === 0) { i += 1; return; } depth -= 1; }
      }
      out += ch; i += 1;
    }
  }
  function template() {
    while (i < input.length) {
      const ch = input[i];
      if (ch === "\\") { i += 2; continue; }
      if (ch === "`") { i += 1; return; }
      if (ch === "$" && input[i + 1] === "{") { i += 2; out += " ( "; expr(true); out += " ) "; continue; }
      i += 1;
    }
  }
  expr(false);
  return out;
}

const code = stripLiterals(src);
const aangeroepen = new Set([...code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]));
const gedeclareerd = new Set([...code.matchAll(/(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
// Functies die dit bestand ZELF meebrengt (de verhuisde code).
const topFuncties = [...src.matchAll(/^ {2}(?:async )?function ([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);

// Sleutelwoorden en platformglobals: die horen niet uit A te komen.
const TAAL = new Set(["if", "for", "while", "switch", "catch", "return", "typeof", "function",
  "new", "await", "async", "of", "in", "do", "else", "try", "delete", "void", "instanceof"]);
const JS = new Set(["Number", "String", "Boolean", "Array", "Object", "Math", "Date", "Intl",
  "Set", "Map", "JSON", "Promise", "Error", "isFinite", "isNaN", "parseInt", "parseFloat",
  "setTimeout", "setInterval", "clearInterval", "clearTimeout", "Event", "require"]);

// ── Wat dit scherm zelf is, en wat het leent ────────────────────────────────
const EIGEN_FUNCTIES = [
  "tA",                       // benoemde uitzondering, zie DASH 6
  "renderDashboard",          // orkestrator met filter
  "renderUserDashboard",      // widgetdashboard (mijn / organisatie)
  "admSpark", "admDonut", "admTimeAgo", "admAskBoden",
  "renderStandardDashboard",  // het cockpitoverzicht
];

// Helpers die in admin.js BLIJVEN wonen en hier alleen geleend worden.
const UIT_A = [
  "esc", "api", "viewEnabled", "switchView",
  "openEmployeeDrawer", "openCustomerDrawer",
  "uName", "uiConfirm", "navFlyoutGo", "openLeaveReviewModal", "openWorkorderDrawer",
];

test("DASH 1· het bestand volgt het werkruimtepatroon en maakt de context NIET aan", () => {
  assert.match(src, /^\/\*[\s\S]*?\*\/\s*\(function \(\) \{\s*"use strict";/,
    "een werkruimte hoort een IIFE met 'use strict' te zijn");
  assert.match(src, /const A = window\.wfpAdmin;\s*\n\s*if \(!A\) return;/,
    "de gedeelde context hoort gelezen te worden, met een harde afslag als hij er niet is");
  // Dit is de regel uit test/architecture-frontend.test.js, hier nog eens
  // scherp: alleen admin.js mag window.wfpAdmin AANMAKEN.
  assert.equal(/window\.wfpAdmin\s*=/.test(src), false,
    "dit bestand maakt window.wfpAdmin aan · dan zijn er twee contexten");
});

test("DASH 2· het scherm registreert zich echt als A.views.dashboard", () => {
  // Structureel is te makkelijk te vervalsen · dus echt laden in een sandbox
  // met een nagebootste gedeelde context. Bij het laden mag het bestand niets
  // anders doen dan declareren en registreren.
  const A = {
    esc: s => s, api: () => Promise.resolve({}), viewEnabled: () => true,
    switchView: () => {}, drawers: {}, views: {},
  };
  const sandbox = { window: { wfpAdmin: A } };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "admin-dashboard.js" });

  assert.equal(typeof A.views.dashboard, "function", "A.views.dashboard is niet geregistreerd");
  assert.equal(A.views.dashboard.name, "renderDashboard",
    "er is iets anders geregistreerd dan de renderfunctie van dit scherm");
  // Het laden mag de context niet vervuilen met eigen sleutels.
  assert.deepEqual(Object.keys(A.views), ["dashboard"]);
  assert.deepEqual(Object.keys(A.drawers), [], "een view hoort geen drawers te kapen");
});

test("DASH 3· zonder gedeelde context doet het bestand niets (geen crash bij losse load)", () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "admin-dashboard.js" });
  assert.equal(sandbox.window.wfpAdmin, undefined,
    "zonder context hoort het bestand stil af te haken, niet zelf een context te maken");
});

test("DASH 4· elke functie die het gebruikt en niet zelf definieert, komt uit A", () => {
  const vrij = [...aangeroepen].filter(n => !gedeclareerd.has(n) && !TAAL.has(n) && !JS.has(n));
  assert.deepEqual(vrij.sort(), [],
    `deze namen hangen in de lucht · ze zijn nergens gedeclareerd: ${vrij.join(", ")}`);

  // En de geleende namen moeten aantoonbaar UIT A komen, niet uit een eigen
  // implementatie die toevallig dezelfde naam draagt.
  const nietUitA = UIT_A.filter(naam =>
    !new RegExp(`const ${naam} = (A\\.|[^;]*=> A\\.)`).test(src));
  assert.deepEqual(nietUitA, [],
    `deze helpers worden niet uit window.wfpAdmin gehaald: ${nietUitA.join(", ")}`);

  // window.wfpI18n / wfpTerms / showToast zijn platformglobals, geen admin-
  // helpers · die horen NIET via A te lopen en ook niet nagebouwd te worden.
  assert.equal(/function (showToast|wfpI18n)\b/.test(src), false);
});

test("DASH 5· het bestand brengt precies het dashboard mee, niets meer", () => {
  assert.deepEqual(topFuncties.slice().sort(), EIGEN_FUNCTIES.slice().sort(),
    "er is een functie bijgekomen of weggevallen ten opzichte van de extractie");
  // admAskBoden is meeverhuisd omdat hij in het dashboardblok stond, maar hij
  // wordt nergens aangeroepen · dode code. Hij staat hier bij naam zodat die
  // schuld zichtbaar blijft en niet stilletjes uitdijt.
  assert.equal((src.match(/\badmAskBoden\b/g) || []).length, 1,
    "admAskBoden heeft nu wel een aanroep · pas deze test aan of ruim hem op");
});

test("DASH 6· gedeelde helpers worden hier NIET opnieuw geschreven", () => {
  // Eén waarheid: wie hier een eigen esc/api/uName bouwt, laat de twee
  // implementaties uit elkaar lopen zodra er één verandert.
  const herschreven = [];
  for (const naam of UIT_A) {
    if (new RegExp(`function ${naam}\\s*\\(`).test(src)) { herschreven.push(naam); continue; }
    const regels = src.split("\n").filter(r => new RegExp(`\\b(?:const|let|var) ${naam}\\b`).test(r));
    assert.equal(regels.length, 1, `${naam} wordt ${regels.length}x gebonden in plaats van 1x`);
    const rechts = regels[0].slice(regels[0].indexOf("=") + 1);
    // Doorgeven aan A mag; een eigen body (accolades) is een herimplementatie.
    if (!/(^|=>)\s*A\./.test(rechts) || rechts.includes("{")) herschreven.push(naam);
  }
  assert.deepEqual(herschreven, [], `opnieuw geimplementeerd in plaats van geleend: ${herschreven.join(", ")}`);

  // De ENIGE benoemde uitzondering is tA: een adapter van één regel over
  // window.wfpI18n. De vertalingen zelf blijven daar wonen, dus dit is geen
  // tweede waarheid · maar hij wordt hier vastgepind zodat hij niet kan
  // afwijken van de versie in admin.js.
  assert.ok(src.includes(
    'function tA(key, fallback) { return window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback; }'),
    "de i18n-adapter wijkt af van die in admin.js");
});

// ── i18n · wat het origineel vertaalde, blijft vertaald ─────────────────────
// Deze lijst is uit het oorspronkelijke blok in admin.js gehaald. Verdwijnt er
// een sleutel, dan is er ergens kale tekst voor in de plaats gekomen en verliest
// een FR/EN-gebruiker dat stukje scherm.
const I18N_SLEUTELS = [
  "actions.openCenter", "dash.act.expenseFrom", "dash.act.invoice", "dash.act.leaveFrom",
  "dash.act.workorder", "dash.actionRequired", "dash.approve", "dash.clockedNow",
  "dash.employee", "dash.expenseWaiting", "dash.hoursWeek", "dash.invoiceOpen",
  "dash.invoiceOverdue", "dash.invoices", "dash.invst.draft", "dash.invst.open",
  "dash.invst.overdue", "dash.invst.paid", "dash.late", "dash.leaveRequests",
  "dash.mode.customize", "dash.mode.org", "dash.mode.overview", "dash.mode.personal",
  "dash.nClocked", "dash.noActivity", "dash.noRequests", "dash.noRevenuePrev",
  "dash.noTeam", "dash.noWo", "dash.nothingPlanned", "dash.onSchedule", "dash.oneClocked",
  "dash.openInvoices", "dash.openWo", "dash.overdue", "dash.planToday", "dash.recentActivity",
  "dash.reject", "dash.revenueMonth", "dash.stAbsent", "dash.stClockedIn", "dash.stNotClocked",
  "dash.team", "dash.teamToday", "dash.thAction", "dash.thEmployee", "dash.thPeriod",
  "dash.thPlanned", "dash.thStatus", "dash.thType", "dash.toPlanning", "dash.total",
  "dash.viewAll", "dash.vsPrevMonth", "dash.woByStatus", "dash.woseg.cancelled",
  "dash.woseg.done", "dash.woseg.inprog", "dash.woseg.open", "dash.woseg.other", "emp.unit.h",
];

test("DASH 7· alle 62 i18n-sleutels van het origineel zijn mee verhuisd", () => {
  const gevonden = [...new Set([...src.matchAll(/\btA\(\s*"([^"]+)"/g)].map(m => m[1]))].sort();
  assert.deepEqual(gevonden, I18N_SLEUTELS.slice().sort());
  // Ook het AANTAL aanroepen vastpinnen: dezelfde sleutel op twee plekken
  // gebruiken en er één schrappen zou de set hierboven ongemoeid laten.
  // 74 aanroepen + 1 declaratie van tA zelf.
  assert.equal((src.match(/\btA\(/g) || []).length, 75);
});

test("DASH 8· de drie taalvarianten van de dashboardteksten staan er nog", () => {
  // Twee blokken in dit scherm vertalen niet via tA maar via een eigen
  // nl/fr/en-object met een fallback op nl. Dat mechanisme is bewust
  // overgenomen · valt een taal weg, dan krijgt die gebruiker stil Nederlands.
  const talen = [...src.matchAll(/\n {6}(nl|fr|en):\{ locale:"(nl|fr|en)-BE"/g)].map(m => m[1]);
  assert.deepEqual(talen, ["nl", "fr", "en", "nl", "fr", "en"],
    "een taalvariant van de dagstart- of werkbordteksten ontbreekt");
  assert.equal((src.match(/\|\| "nl";/g) || []).length, 2, "de nl-fallback is weg");
});

test("DASH 9· de tekst die het origineel NIET vertaalde, is niet stilletjes gegroeid", () => {
  // Eerlijke schuldregistratie. Deze zinnen stonden in admin.js al zonder
  // i18n-sleutel; een extractie hoort dat niet te repareren (dat is een aparte,
  // zichtbare wijziging) maar ook niet uit te breiden.
  const KALE_TEKST = [
    "Monargo Flow", "Start een volledig klanttraject", "Start klantflow",
    "Widgets samenstellen", "Opslaan", "Publiceer voor organisatie",
    "Werkruimte gereedheid", "Bekijk status", "Roadmap",
    "Mijn dashboard opgeslagen", "Gepubliceerd voor de organisatie",
  ];
  for (const zin of KALE_TEKST) {
    assert.ok(src.includes(zin), `"${zin}" is verdwenen · dat is geen extractie meer`);
  }
  // Geen van deze zinnen mag stiekem tóch een sleutel hebben gekregen: dan is
  // het gedrag veranderd en hoort dat in een eigen commit met eigen test.
  for (const zin of KALE_TEKST) {
    assert.equal(new RegExp(`tA\\([^)]*"${zin}"`).test(src), false,
      `"${zin}" is tijdens de verhuizing vertaald · dat is een gedragswijziging`);
  }
});

test("DASH 10· geen em-dash in het bestand", () => {
  // Huisregel: nooit "—" in tekst; gebruik "-" of "·".
  assert.equal(src.includes("—"), false, "em-dash gevonden");
});
