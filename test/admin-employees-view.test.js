"use strict";
// ── Contract van de uitgesplitste medewerkers-werkruimte ────────────────────
// public/js/platforms/admin-medewerkers.js is letterlijk uit admin.js geknipt
// (het employees-blok: lijst, tabel, rij-acties en de medewerker-drawer).
// Deze tests leggen het GEDRAG en de STRUCTUUR van die knip vast:
//
//   1. de werkruimte LEEST de gedeelde context, ze maakt hem niet aan;
//   2. ze registreert zichzelf als A.views.employees (anders is het scherm weg)
//      en als A.drawers.employee (anders breekt de teamrij op het dashboard);
//   3. elke functie die ze aanroept en niet zelf definieert, komt uit A;
//   4. de i18n-keuze van het origineel is ongewijzigd: de lijst vertaalt via
//      tA(), de drawer had geen enkele sleutel en houdt dus zijn vaste tekst;
//   5. de knip is letterlijk · de code staat nog exact zo in admin.js.
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

const MODULE = "public/js/platforms/admin-medewerkers.js";
const src = read(MODULE);

// ── Broncode-scanner ────────────────────────────────────────────────────────
// Haalt commentaar, quoted strings, reguliere expressies en de TEKST van
// template-literals weg, maar houdt de ${…}-expressies wel over. Zonder die
// scheiding zou gebruikerstekst als "In- en uitprikken (prikklok)" doorgaan
// voor een functieaanroep, en dan bewijst test 3 niets meer.
function alleenCode(bron) {
  const ctx = [{ t: "code", depth: 0 }];
  let out = "";
  let i = 0;
  const laatsteTeken = () => {
    for (let j = out.length - 1; j >= 0; j -= 1) if (!/\s/.test(out[j])) return out[j];
    return "";
  };
  while (i < bron.length) {
    const top = ctx[ctx.length - 1];
    const c = bron[i];
    const c2 = bron.slice(i, i + 2);
    if (top.t === "tmpl") {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { ctx.pop(); i += 1; out += " "; continue; }
      if (c2 === "${") { ctx.push({ t: "code", depth: 0 }); i += 2; out += " "; continue; }
      if (c === "\n") out += "\n";
      i += 1;
      continue;
    }
    if (c2 === "//") { while (i < bron.length && bron[i] !== "\n") i += 1; continue; }
    if (c2 === "/*") { i += 2; while (i < bron.length && bron.slice(i, i + 2) !== "*/") i += 1; i += 2; continue; }
    if (c === '"' || c === "'") {
      const quote = c;
      i += 1;
      while (i < bron.length) {
        if (bron[i] === "\\") { i += 2; continue; }
        if (bron[i] === quote) { i += 1; break; }
        i += 1;
      }
      out += " ";
      continue;
    }
    if (c === "`") { ctx.push({ t: "tmpl" }); i += 1; out += " "; continue; }
    // Regex-literal: herkenbaar aan het teken dat eraan voorafgaat.
    if (c === "/" && "(,=:[!&|?{};+".includes(laatsteTeken())) {
      i += 1;
      let inKlasse = false;
      while (i < bron.length) {
        if (bron[i] === "\\") { i += 2; continue; }
        if (bron[i] === "[") inKlasse = true;
        else if (bron[i] === "]") inKlasse = false;
        else if (bron[i] === "/" && !inKlasse) { i += 1; break; }
        i += 1;
      }
      while (i < bron.length && /[gimsuy]/.test(bron[i])) i += 1;
      out += " ";
      continue;
    }
    if (c === "{") { top.depth += 1; out += c; i += 1; continue; }
    if (c === "}") {
      if (top.depth === 0 && ctx.length > 1) { ctx.pop(); i += 1; out += " "; continue; }
      top.depth -= 1; out += c; i += 1; continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const code = alleenCode(src);

test("medewerkers 1· de werkruimte leest window.wfpAdmin en maakt hem niet aan", () => {
  assert.doesNotMatch(code, /window\.wfpAdmin\s*=/,
    "alleen admin.js mag de gedeelde context aanmaken");
  assert.match(code, /const A = window\.wfpAdmin;/);
  assert.match(code, /if \(!A\) return;/,
    "zonder context hoort de werkruimte stil af te haken, niet te crashen");
});

test("medewerkers 2· ze registreert het scherm en de drawer", () => {
  // Draai het bestand echt: registratie via een string-match is een tautologie,
  // dit bewijst dat de IIFE de renderer ook werkelijk in de registry zet.
  const A = { views: {}, drawers: {} };
  const sandbox = { window: { wfpAdmin: A }, document: {}, console };
  vm.runInNewContext(src, sandbox, { filename: MODULE });
  assert.equal(typeof A.views.employees, "function", "A.views.employees ontbreekt");
  assert.equal(A.views.employees.name, "renderEmployees");
  assert.equal(typeof A.drawers.employee, "function",
    "de medewerker-drawer verhuisde mee uit de drawer-registry van admin.js");
  assert.equal(A.drawers.employee.name, "openEmployeeDrawer");
  // Alleen deze twee sleutels · een extractie hoort niets extra's te claimen.
  assert.deepEqual(Object.keys(A.views), ["employees"]);
  assert.deepEqual(Object.keys(A.drawers), ["employee"]);
});

test("medewerkers 2b· zonder gedeelde context registreert ze niets en gooit ze niet", () => {
  const sandbox = { window: {}, document: {}, console };
  assert.doesNotThrow(() => vm.runInNewContext(src, sandbox, { filename: MODULE }));
  assert.equal(sandbox.window.wfpAdmin, undefined);
});

test("medewerkers 3· elke functie die ze niet zelf definieert, komt uit A", () => {
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
  const METHODEN = new Set([
    "forEach", "map", "filter", "reduce", "join", "push", "slice", "split", "test",
    "exec", "sort", "find", "includes", "replace", "some", "every", "concat",
    "startsWith", "endsWith", "trim", "keys", "values", "entries", "fromEntries",
    "indexOf", "text", "click", "toUpperCase", "toLowerCase",
  ]);

  const aanroepen = new Set();
  for (const m of code.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) aanroepen.add(m[1]);

  const zwevend = [...aanroepen]
    .filter(n => !gedefinieerd.has(n))
    .filter(n => !INGEBOUWD.has(n) && !METHODEN.has(n));
  assert.deepEqual(zwevend, [],
    `deze functies komen nergens vandaan: ${zwevend.join(", ")}`);

  // De helpers die niet meeverhuisden MOETEN uit A komen · niet gekopieerd zijn.
  for (const helper of ["api", "esc", "openDrawer", "closeDrawer"]) {
    assert.match(code, new RegExp(`const ${helper} = A\\.${helper};`),
      `${helper} hoort uit de gedeelde context te komen`);
  }
  // tA, uiConfirm en uiInput staan (nog) niet op window.wfpAdmin. Ze worden
  // laat gebonden opgehaald zodat er geen tweede waarheid ontstaat zodra
  // admin.js ze toevoegt. Kopieren van hun body is precies wat hier niet mag.
  for (const helper of ["tA", "uiConfirm", "uiInput"]) {
    assert.match(code, new RegExp(`const ${helper} = \\([^)]*\\) => A\\.${helper}\\(`),
      `${helper} hoort laat gebonden uit de gedeelde context te komen`);
  }
  for (const helper of ["api", "esc", "openDrawer", "closeDrawer", "tA", "uiConfirm", "uiInput", "uName"]) {
    assert.doesNotMatch(code, new RegExp(`function ${helper}\\s*\\(`),
      `${helper} is gekopieerd in plaats van gedeeld · dat maakt twee waarheden`);
  }
  // De gedeelde state-cache wordt gedeeld, niet nagebouwd.
  assert.match(code, /const _state = A\.state;/);
  assert.doesNotMatch(code, /let _state\s*=|const _state = \{/,
    "_state hoort de referentie uit admin.js te zijn, geen eigen object");

  // Wat wel exclusief van dit scherm is, hoort hier gedefinieerd te staan.
  for (const eigen of ["renderEmployees", "renderEmployeeTable", "bindEmpActions", "openEmployeeDrawer"]) {
    assert.ok(gedefinieerd.has(eigen), `${eigen} hoort mee te verhuizen`);
  }
  assert.match(code, /let _empShowInactive = false;/);
  assert.match(code, /let _grantable = \[\];/);
  assert.match(code, /const ROLE_DEFAULT_PERMS = \{/);
});

test("medewerkers 4· de i18n-keuze van het origineel is onveranderd", () => {
  // De lijst + tabel vertaalden via tA(); de drawer had géén enkele sleutel en
  // hield vaste Nederlandse tekst. Die keuze hoort de extractie te bewaren:
  // sleutels bijverzinnen of weglaten verandert de gebruikerstekst.
  const SLEUTELS = [
    "adm.emp.activeCount", "adm.emp.inactiveCount", "adm.search", "adm.showInactive",
    "adm.csvImport", "adm.export", "adm.emp.none", "adm.name", "adm.email",
    "adm.function", "adm.role", "adm.status", "adm.actions", "role.manager",
    "role.admin", "dash.employee", "adm.active", "adm.inactive", "adm.edit",
    "adm.emp.deactivate", "adm.emp.activate",
  ];
  for (const key of SLEUTELS) {
    assert.ok(src.includes(`tA("${key}"`), `i18n-sleutel ${key} ontbreekt`);
  }
  // Kale aanroepen tellen · "A.tA(" in de binding bovenaan is geen schermtekst.
  assert.equal((src.match(/(?:^|[^.\w$])tA\(/g) || []).length, SLEUTELS.length,
    "er zijn tA()-aanroepen bijgekomen of verdwenen · de extractie hoort tekstneutraal te zijn");

  const drawer = src.slice(src.indexOf("function openEmployeeDrawer"));
  assert.equal((drawer.match(/(?:^|[^.\w$])tA\(/g) || []).length, 0,
    "de drawer had in admin.js geen i18n-sleutels · een extractie voegt ze niet toe");
  assert.ok(drawer.includes("Medewerker bewerken") && drawer.includes("Medewerker toevoegen"),
    "de vaste drawer-titels van het origineel horen ongewijzigd te blijven");

  // Huisregel: nooit het em-dash-teken in tekst.
  assert.ok(!src.includes("—"), "em-dash gevonden · gebruik '-' of '·'");
});

test("medewerkers 5· de knip is letterlijk · de code staat nog exact zo in admin.js", () => {
  // Zolang admin.js nog niet centraal geknipt is, is dit het harde bewijs dat
  // er onderweg niets herschreven of 'verbeterd' is.
  const admin = read("public/js/platforms/admin.js");
  if (!admin.includes("async function renderEmployees()")) return; // al geknipt
  const blok = admin.split("\n").slice(1920, 2226).join("\n");
  assert.ok(src.includes(blok),
    "de werkruimte wijkt af van het origineel in admin.js · een extractie mag geen gedrag wijzigen");
});
