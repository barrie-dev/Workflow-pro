"use strict";
// ── Extractie van het scherm "actions" uit de admin-monoliet ─────────────────
//
// public/js/platforms/admin-actiecentrum.js is uit admin.js geknipt. Bij een
// extractie is de vraag niet of er nog iets rendert, maar of er onderweg een
// grens is weggevallen: een tweede kopie van een helper, een verloren
// i18n-sleutel, of een stilzwijgende afhankelijkheid van de monoliet. Deze
// tests toetsen die grenzen · niet dat het bestand bestaat.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const MOD = path.join(ROOT, "public", "js", "platforms", "admin-actiecentrum.js");
const ADMIN = path.join(ROOT, "public", "js", "platforms", "admin.js");

// Regeleindes normaliseren: git zet ze op Windows naar CRLF zodra hij het
// bestand aanraakt, en dan matcht een patroon met \n opeens niets meer.
const lees = p => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const src = lees(MOD);
const adminSrc = lees(ADMIN);

/** Broncode zonder commentaar · anders slaagt of faalt een test op een uitleg. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const codeSrc = code(src);

// De namen die het scherm uit de gedeelde context haalt (const x = A.x;).
const UIT_A = [...codeSrc.matchAll(/const\s+([\w$]+)\s*=\s*A\.([\w$]+)\s*;/g)]
  .map(m => ({ lokaal: m[1], opA: m[2] }));

test("AC 1· het bestand LEEST window.wfpAdmin en maakt hem nooit aan", () => {
  // Zelfde regel als architecture-frontend.test.js frontend 4, maar hier op de
  // extractie zelf: één plek mag de gedeelde context aanmaken, en dat is admin.js.
  assert.equal(/window\.wfpAdmin\s*=/.test(codeSrc), false,
    "de werkruimte maakt window.wfpAdmin aan · dan bestaat de context twee keer");
  assert.match(codeSrc, /const A = window\.wfpAdmin;/);
  assert.match(codeSrc, /if \(!A\) return;/,
    "zonder deze bewaker crasht het bestand als het vóór admin.js geladen wordt");
});

test("AC 2· het scherm registreert zich als A.views.actions", () => {
  assert.match(codeSrc, /A\.views = A\.views \|\| \{\};/,
    "de registry wordt overschreven in plaats van aangevuld");
  assert.match(codeSrc, /A\.views\.actions = renderActionCenter;/);
});

test("AC 3· elke functie die het scherm niet zelf definieert komt uit A", () => {
  // Vrije aanroepen verzamelen: naam( , maar niet obj.naam( en niet de
  // declaratie zelf. Wat overblijft moet óf hier gedefinieerd zijn, óf een
  // platformglobal zijn, óf uit de gedeelde context komen. Alles daarbuiten is
  // een stilzwijgende afhankelijkheid van de monoliet.
  const zonderStrings = codeSrc
    .replace(/`(?:[^`\\]|\\.)*`/gs, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  const aangeroepen = new Set(
    [...zonderStrings.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[2])
  );
  const lokaal = new Set([
    ...[...codeSrc.matchAll(/function\s+([\w$]+)/g)].map(m => m[1]),
    ...[...codeSrc.matchAll(/(?:const|let|var)\s+([\w$]+)\s*=/g)].map(m => m[1]),
  ]);
  const TAAL = new Set([
    "function", "async", "if", "for", "while", "switch", "catch", "return", "typeof",
    "await", "Number", "String", "Array", "Date", "Boolean", "Object", "Promise",
    "parseInt", "parseFloat", "isNaN", "Intl", "Math", "JSON", "RegExp",
  ]);
  const uitA = new Set(UIT_A.map(x => x.lokaal));
  const onbekend = [...aangeroepen].filter(n => !lokaal.has(n) && !TAAL.has(n) && !uitA.has(n));
  assert.deepEqual(onbekend.sort(), [],
    `deze functies komen nergens vandaan · haal ze uit window.wfpAdmin: ${onbekend.join(", ")}`);

  // En de omgekeerde richting: wat uit A komt mag hier NIET opnieuw gedefinieerd
  // worden. Twee kopieën van uName of esc is hoe twee waarheden ontstaan.
  const dubbel = UIT_A.filter(x => new RegExp(`function\\s+${x.lokaal}\\b`).test(codeSrc));
  assert.deepEqual(dubbel.map(x => x.lokaal), [],
    "een uit A gelezen helper wordt hier ook zelf gedefinieerd");
  assert.ok(UIT_A.length >= 4, "het scherm leest de gedeelde context niet · dan hangt het los");
});

// Deze lijst hield tijdens de extractie bij welke helpers admin.js nog NIET op
// window.wfpAdmin zette. Bij het knippen zijn tA, uName en tLeaveType alsnog
// geëxposeerd, dus de schuld is afgelost en de lijst hoort leeg te zijn.
//
// Hij blijft staan als vangnet: komt er ooit een helper bij die het scherm uit
// A haalt terwijl admin.js hem niet deelt, dan faalt deze test met de naam
// erbij in plaats van dat het scherm bij de eerste klik stukloopt.
const NOG_NIET_OP_A = [];

test("AC 4· wat het scherm uit A haalt, zet admin.js daar ook echt op", () => {
  const ontbreekt = UIT_A
    .map(x => x.opA)
    .filter(naam => !new RegExp(`A\\.${naam}\\s*=`).test(adminSrc))
    .sort();
  assert.deepEqual(ontbreekt, NOG_NIET_OP_A.slice().sort(),
    `de gedeelde context mist deze helpers: ${ontbreekt.join(", ")}`);
});

// ── i18n · het origineel deed alle gebruikerstekst via tA(sleutel, fallback) ──
const tAparen = text => [...text.matchAll(/tA\(\s*"([^"]+)"\s*,\s*"([^"]*)"/g)]
  .map(m => `${m[1]}=${m[2]}`).sort();

test("AC 5· elke i18n-sleutel draagt nog zijn eigen fallback", () => {
  // Deze test vergeleek het nieuwe bestand met een REGELBEREIK uit admin.js.
  // Dat werkte precies zolang de knip nog niet gebeurd was; daarna wees het
  // bereik naar willekeurige andere code. Een test die aan een regelnummer
  // hangt, meet na de eerstvolgende wijziging iets anders dan hij belooft.
  //
  // Wat wél duurzaam te toetsen is: elke sleutel heeft een niet-lege fallback
  // en komt maar één keer voor met één betekenis. Ontbreekt de fallback, dan
  // toont FR/EN een lege string in plaats van de Nederlandse tekst.
  const paren = tAparen(src);
  assert.ok(paren.length >= 30, `verwacht de volledige tekstset, kreeg ${paren.length} sleutels`);

  const perSleutel = new Map();
  for (const paar of paren) {
    const [sleutel, ...rest] = paar.split("=");
    const fallback = rest.join("=");
    assert.notEqual(fallback.trim(), "", `${sleutel} heeft een lege fallback`);
    if (perSleutel.has(sleutel)) {
      assert.equal(perSleutel.get(sleutel), fallback,
        `${sleutel} heeft twee verschillende fallbacks · welke wint hangt dan van de volgorde af`);
    }
    perSleutel.set(sleutel, fallback);
  }
  for (const sleutel of perSleutel.keys()) {
    assert.match(sleutel, /^[a-z][\w.]*$/i, `${sleutel} is geen geldige i18n-sleutel`);
  }
});

test("AC 6· gebruikerstekst staat nooit los in de markup, altijd achter tA()", () => {
  // Strip alle tA(...)-aanroepen; wat er dan nog aan Nederlandse UI-woorden in
  // het bestand staat, is hardgecodeerde tekst die nooit vertaald wordt.
  const zonderTa = codeSrc.replace(/tA\(\s*"[^"]+"\s*,\s*"[^"]*"\s*\)/g, "T()");
  const woorden = ["Vandaag", "Acties", "Klaar", "Melding", "Factuur", "Werkbon",
    "Verlofaanvraag", "Onkostennota", "Vernieuwen", "Alles", "Kritiek", "Goedkeur",
    "Werkvoorraad", "Dringend", "Financieel", "Operaties"];
  const gevonden = woorden.filter(w => zonderTa.includes(w));
  assert.deepEqual(gevonden, [],
    `hardgecodeerde gebruikerstekst zonder i18n-sleutel: ${gevonden.join(", ")}`);
});

// ── Gedrag · het scherm draaien met een nagebouwde gedeelde context ──────────
function draaiScherm(data) {
  const geroepen = [];
  const klikken = { view: [], read: [], filter: [] };
  const content = {
    innerHTML: "",
    querySelectorAll(sel) {
      // Eén knop per selector zodat de handlers echt aangeroepen kunnen worden.
      if (sel === "[data-action-view]") return [knop("actionView", "facturen", klikken.view)];
      if (sel === "[data-action-read]") return [knop("actionRead", "n1", klikken.read)];
      if (sel === "[data-action-filter]") return [knop("actionFilter", "critical", klikken.filter)];
      return [];
    },
  };
  function knop(veld, waarde, bus) {
    return {
      dataset: { [veld]: waarde },
      addEventListener: (_evt, fn) => bus.push(fn),
    };
  }
  const A = {
    esc: v => String(v == null ? "" : v).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    api: (method, pad) => {
      geroepen.push(`${method} ${pad}`);
      return Promise.resolve(data[pad] || {});
    },
    viewEnabled: () => true,
    switchView: v => klikken.geschakeld = v,
    tA: (_key, fallback) => fallback,
    uName: rec => rec.userName || "Onbekende medewerker",
    tLeaveType: tp => tp || "-",
    views: {},
  };
  const window = { wfpAdmin: A, showToast: () => {} };
  const document = { getElementById: id => (id === "admContent" ? content : null) };
  new vm.Script(src, { filename: "admin-actiecentrum.js" }).runInContext(
    vm.createContext({ window, document, console })
  );
  return { A, content, geroepen, klikken };
}

test("AC 7· het scherm draait op de gedeelde context alleen · geen admin.js nodig", async () => {
  const { A, content, geroepen } = draaiScherm({});
  assert.equal(typeof A.views.actions, "function", "de registratie gebeurt niet bij het laden");
  await A.views.actions();
  assert.deepEqual(geroepen.sort(), [
    "GET /expenses", "GET /facturen", "GET /leaves?status=aangevraagd",
    "GET /notifications", "GET /workorders",
  ], "het scherm haalt niet dezelfde bronnen op als in admin.js");
  assert.match(content.innerHTML, /adm-action-center/);
});

test("AC 8· de vijf bronnen worden tot één gerangschikte werkvoorraad", async () => {
  const gisteren = "2000-01-01";
  const { A, content } = draaiScherm({
    "/notifications": { rows: [{ id: "n1", title: "Melding een", status: "new" }] },
    "/leaves?status=aangevraagd": { leaves: [{ id: "l1", status: "aangevraagd", userName: "Jan", type: "vakantie", startDate: gisteren }] },
    "/expenses": { expenses: [{ id: "e1", status: "ingediend", userName: "Ella", amount: 12 }] },
    "/facturen": { invoices: [{ id: "f1", status: "overdue", number: "F-9", total: 100, dueDate: gisteren }] },
    "/workorders": { workorders: [{ id: "w1", status: "open", number: "WB-3", scheduledDate: gisteren }] },
  });
  await A.views.actions();
  const html = content.innerHTML;
  // Vervallen factuur en late werkbon zijn kritiek en staan vóór de goedkeuringen.
  assert.ok(html.indexOf("F-9") < html.indexOf("Jan"), "de kritieke items staan niet bovenaan");
  assert.ok(html.includes("WB-3") && html.includes("Ella") && html.includes("Melding een"));
  // De tellers per filter zijn de kern van dit scherm: 2 kritiek, 2 goedkeuringen.
  assert.match(html, /data-action-filter="critical"><span>Kritiek<\/span><strong>2<\/strong>/);
  assert.match(html, /data-action-filter="approvals"><span>Goedkeuren<\/span><strong>2<\/strong>/);
  // "Volgende beste actie" is het bovenste item · hier de vervallen factuur, en
  // die opent een view in plaats van af te vinken.
  assert.match(html, /adm-btn-primary" data-action-view="facturen"/,
    "de volgende beste actie stuurt niet naar de juiste flow");
  // Afvinken hoort alleen bij een melding: een factuur of werkbon verdwijnt niet
  // met één klik uit de werkvoorraad.
  assert.equal((html.match(/data-action-read=/g) || []).length, 1);
  assert.match(html, /data-action-read="n1"/);
});

test("AC 9· openen gaat via A.switchView en afvinken via de notificatie-API", async () => {
  const { A, klikken, geroepen } = draaiScherm({
    "/notifications": { rows: [{ id: "n1", title: "Melding", status: "new" }] },
  });
  await A.views.actions();
  klikken.view[0]();
  assert.equal(klikken.geschakeld, "facturen",
    "de open-knop navigeert niet via de gedeelde switchView · dan blijft het scherm hangen");
  await klikken.read[0]();
  assert.ok(geroepen.includes("POST /notifications/n1/read"),
    "afvinken schrijft niet naar de notificatie-API");
});

test("AC 10· een falende bron legt het scherm niet plat", async () => {
  const geroepen = [];
  const content = { innerHTML: "", querySelectorAll: () => [] };
  const A = {
    esc: v => String(v == null ? "" : v),
    api: (method, pad) => {
      geroepen.push(`${method} ${pad}`);
      return pad === "/facturen" ? Promise.reject(new Error("500")) : Promise.resolve({});
    },
    viewEnabled: () => true, switchView: () => {},
    tA: (_k, f) => f, uName: () => "", tLeaveType: t => t, views: {},
  };
  const window = { wfpAdmin: A, showToast: () => {} };
  const document = { getElementById: id => (id === "admContent" ? content : null) };
  new vm.Script(src).runInContext(vm.createContext({ window, document, console }));
  await A.views.actions();
  assert.match(content.innerHTML, /adm-action-center/,
    "één kapotte bron mag het hele actiecentrum niet meeslepen");
});

test("AC 11· uitgeschakelde modules worden niet opgehaald", async () => {
  // viewEnabled is rechten-gedreven: zit facturen niet in het pakket, dan mag
  // het actiecentrum die endpoint ook niet aanroepen (403-ruis + datalek-risico).
  const geroepen = [];
  const content = { innerHTML: "", querySelectorAll: () => [] };
  const A = {
    esc: v => String(v == null ? "" : v),
    api: (method, pad) => { geroepen.push(`${method} ${pad}`); return Promise.resolve({}); },
    viewEnabled: view => view !== "facturen",
    switchView: () => {}, tA: (_k, f) => f, uName: () => "", tLeaveType: t => t, views: {},
  };
  const window = { wfpAdmin: A, showToast: () => {} };
  const document = { getElementById: id => (id === "admContent" ? content : null) };
  new vm.Script(src).runInContext(vm.createContext({ window, document, console }));
  await A.views.actions();
  assert.equal(geroepen.includes("GET /facturen"), false,
    "een uitgeschakelde module wordt toch bevraagd");
  assert.ok(geroepen.includes("GET /notifications"),
    "meldingen horen er altijd te zijn · dat is de kern van dit scherm");
});
