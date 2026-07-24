"use strict";
// ── Contract van de uitgesplitste planning-werkruimte ────────────────────────
// public/js/platforms/admin-planning.js is letterlijk uit admin.js geknipt.
// Deze tests leggen het GEDRAG en de STRUCTUUR van die knip vast:
//
//   1. de werkruimte LEEST de gedeelde context, ze maakt hem niet aan;
//   2. ze registreert zichzelf als A.views.planning (anders is het scherm weg);
//   3. elke functie die ze aanroept en niet zelf definieert, komt uit A;
//   4. de i18n-sleutels die het origineel gebruikte, staan er nog steeds.
//
// Test 3 is de belangrijkste: dupliceren van een helper is hoe twee waarheden
// ontstaan. Faalt hij, dan is er een helper gekopieerd in plaats van gedeeld.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
// Regel-eindes normaliseren: op Windows checkt git CRLF uit.
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

const MODULE = "public/js/platforms/admin-planning.js";
const src = read(MODULE);
// Broncode zonder commentaar · anders faalt een test op een uitleg.
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("planning 1· de werkruimte leest window.wfpAdmin en maakt hem niet aan", () => {
  assert.doesNotMatch(code, /window\.wfpAdmin\s*=/,
    "alleen admin.js mag de gedeelde context aanmaken");
  assert.match(code, /const A = window\.wfpAdmin;/);
  assert.match(code, /if \(!A\) return;/,
    "zonder context hoort de werkruimte stil af te haken, niet te crashen");
});

test("planning 2· ze registreert het scherm als A.views.planning", () => {
  // Draai het bestand echt: registratie via een string-match is een tautologie,
  // dit bewijst dat de IIFE de renderer ook werkelijk in de registry zet.
  const A = { views: {}, drawers: {} };
  const sandbox = { window: { wfpAdmin: A }, document: {}, console };
  vm.runInNewContext(src, sandbox, { filename: MODULE });
  assert.equal(typeof A.views.planning, "function", "A.views.planning ontbreekt");
  assert.equal(A.views.planning.name, "renderPlanning");
  assert.equal(typeof A.drawers.shift, "function",
    "de shiftdrawer verhuisde mee uit de drawer-registry van admin.js");
});

test("planning 2b· zonder gedeelde context registreert ze niets en gooit ze niet", () => {
  const sandbox = { window: {}, document: {}, console };
  assert.doesNotThrow(() => vm.runInNewContext(src, sandbox, { filename: MODULE }));
  assert.equal(sandbox.window.wfpAdmin, undefined);
});

test("planning 3· elke functie die ze niet zelf definieert, komt uit A", () => {
  const gedefinieerd = new Set();
  for (const m of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) gedefinieerd.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) gedefinieerd.add(m[1]);

  // Ingebouwde taal- en browserzaken · geen helpers uit de monoliet.
  const INGEBOUWD = new Set([
    "if", "for", "while", "switch", "catch", "return", "function", "typeof", "new",
    "await", "async", "else", "do", "try", "delete", "void", "in", "of", "var",
    "Promise", "Object", "Array", "Number", "String", "Boolean", "Math", "Set", "Map",
    "Date", "FormData", "JSON", "Intl", "Error", "isNaN", "encodeURIComponent",
  ]);
  // Methodeaanroepen op een expressie (foo.bar()) filtert de regex al weg; wat
  // overblijft zijn kale aanroepen. Ketenmethodes die zonder punt lijken te
  // staan (a\n  .map()) vangen we hier af.
  const METHODEN = new Set([
    "forEach", "map", "filter", "reduce", "join", "push", "slice", "split", "test",
    "exec", "sort", "find", "includes", "replace", "some", "every", "concat",
    "startsWith", "endsWith", "trim", "keys", "values", "entries", "fromEntries",
    "min", "max", "round", "from", "toISOString", "toUpperCase", "getDate", "setDate",
    "getTime", "toLocaleDateString", "toLocaleString", "localeCompare",
  ]);

  const aanroepen = new Set();
  for (const m of code.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) aanroepen.add(m[1]);

  const zwevend = [...aanroepen]
    .filter(n => n !== "var")                       // var(--wf-…) in CSS-strings
    .filter(n => !gedefinieerd.has(n))
    .filter(n => !INGEBOUWD.has(n) && !METHODEN.has(n));
  assert.deepEqual(zwevend, [],
    `deze functies komen nergens vandaan: ${zwevend.join(", ")}`);

  // De helpers die niet meeverhuisden MOETEN uit A komen · niet gekopieerd zijn.
  for (const helper of ["api", "esc", "tA", "uName", "uiConfirm", "viewEnabled",
    "getWeekStart", "openDrawer", "closeDrawer", "openWorkorderDrawer"]) {
    assert.match(code, new RegExp(`const ${helper} = A\\.${helper};`),
      `${helper} hoort uit de gedeelde context te komen`);
    assert.doesNotMatch(code, new RegExp(`function ${helper}\\s*\\(`),
      `${helper} is gekopieerd in plaats van gedeeld · dat maakt twee waarheden`);
  }
});

test("planning 4· de i18n-sleutels van het origineel zijn behouden", () => {
  // Het origineel vertaalde de kopieer-week-flow wél en de rest van het scherm
  // (nog) niet. Die keuze hoort de extractie ongewijzigd te laten.
  for (const key of ["adm.plan.copyNone", "adm.busy", "adm.plan.copied", "adm.plan.copyWeek"]) {
    assert.ok(code.includes(`tA("${key}"`), `i18n-sleutel ${key} ontbreekt`);
  }
  assert.equal((code.match(/\btA\(/g) || []).length, 4,
    "er zijn tA()-aanroepen bijgekomen of verdwenen · de extractie hoort tekstneutraal te zijn");
});

test("planning 5· de knip is letterlijk · de code staat nog exact zo in admin.js", () => {
  // Zolang admin.js nog niet centraal geknipt is, is dit het harde bewijs dat
  // er onderweg niets herschreven of 'verbeterd' is.
  const admin = read("public/js/platforms/admin.js");
  if (!admin.includes("async function renderPlanning()")) return; // al geknipt
  const blok = admin.split("\n").slice(2227, 2678).join("\n");
  assert.ok(src.replace(/\r\n/g, "\n").includes(blok),
    "de werkruimte wijkt af van het origineel in admin.js · een extractie mag geen gedrag wijzigen");
});
