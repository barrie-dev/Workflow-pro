"use strict";
// ── Extractie van het scherm "incidents" (Werkongevallen) uit admin.js ───────
//
// Een extractie is geslaagd als er NIETS veranderd is behalve de plaats. Deze
// tests toetsen daarom twee dingen tegelijk:
//
//   * de grens: het bestand LEEST de gedeelde context en maakt haar niet aan,
//     het registreert zichzelf, en alles wat het niet zelf meebrengt komt uit
//     window.wfpAdmin (geen tweede waarheid, geen stille kopie);
//   * het gedrag: de renderer en de drawer draaien echt in een kale sandbox.
//     Zou er één identifier zijn die alleen in admin.js bestond, dan valt hij
//     hier om met een ReferenceError in plaats van pas in productie.
//
// De module is browsercode zonder buildstap; ze wordt hier met node:vm in een
// nagebootst window/document geladen.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const MOD = path.join(ROOT, "public", "js", "platforms", "admin-werkongevallen.js");
const ADMIN = path.join(ROOT, "public", "js", "platforms", "admin.js");

// Regeleindes normaliseren: git zet ze op Windows naar CRLF zodra hij het
// bestand aanraakt, en dan matcht een patroon met \n opeens niets meer.
const src = fs.readFileSync(MOD, "utf8").replace(/\r\n/g, "\n");
const adminSrc = fs.readFileSync(ADMIN, "utf8").replace(/\r\n/g, "\n");

// ── Nagebootste browser ─────────────────────────────────────────────────────
function maakElement(id) {
  return {
    id, innerHTML: "", textContent: "", value: "", href: "", download: "",
    disabled: false, style: {}, dataset: {}, luisteraars: {}, _data: {},
    addEventListener(type, fn) { (this.luisteraars[type] = this.luisteraars[type] || []).push(fn); },
    querySelectorAll() { return []; },
    appendChild() {}, click() { this._geklikt = true; }, remove() {},
  };
}
function maakDocument(ids) {
  const els = new Map();
  for (const id of ids) els.set(id, maakElement(id));
  const doc = {
    els,
    body: maakElement("body"),
    getElementById(id) { return els.get(id) || null; },
    querySelectorAll() { return []; },
    createElement(tag) { const el = maakElement(tag); doc.gemaakt.push(el); return el; },
    gemaakt: [],
  };
  return doc;
}

/** Laadt de module in een sandbox en geeft de gedeelde context + document terug. */
function laad(opties) {
  const cfg = opties || {};
  const geroepen = { openDrawer: 0, closeDrawer: 0, bevestigd: [], toasts: [], fetches: [] };
  const A = {
    api: cfg.api || (async () => ({})),
    // De echte esc uit admin.js; hier alleen nodig omdat de module hem gebruikt.
    esc: s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    // tA valt in de app terug op de fallback als er geen vertaling is; hier
    // geven we de SLEUTEL terug, zodat een test kan zien dat er vertaald is.
    tA: (key) => `«${key}»`,
    uiConfirm: async (bericht, opts) => { geroepen.bevestigd.push({ bericht, opts }); return cfg.bevestig !== false; },
    openDrawer() { geroepen.openDrawer++; },
    closeDrawer() { geroepen.closeDrawer++; },
    tenantId: () => "t-42",
    token: () => "jwt-abc",
    views: {}, drawers: { inquiry() {} },
  };
  const doc = maakDocument(cfg.ids || ["admContent"]);
  const win = cfg.zonderContext ? {} : { wfpAdmin: A };
  if (!cfg.zonderContext) win.showToast = (tekst, soort) => geroepen.toasts.push({ tekst, soort });
  const sandbox = {
    window: win, document: doc, navigator: {}, console,
    URL: { createObjectURL: () => "blob:werkongevallen", revokeObjectURL() {} },
    fetch: async (url, init) => {
      geroepen.fetches.push({ url, init });
      if (cfg.fetchFaalt) return { ok: false };
      return { ok: true, blob: async () => ({}) };
    },
    // Minimale FormData: de submit-handler leest alleen .entries().
    FormData: class { constructor(form) { this._d = (form && form._data) || {}; } entries() { return Object.entries(this._d); } },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "admin-werkongevallen.js" });
  return { A, doc, geroepen, win };
}

/** Vuurt de eerste geregistreerde luisteraar van een element af. */
function vuur(doc, id, type, event) {
  const el = doc.getElementById(id);
  assert.ok(el, `element ${id} bestaat niet in de nagebootste DOM`);
  const fns = el.luisteraars[type] || [];
  assert.equal(fns.length > 0, true, `${id} heeft geen ${type}-luisteraar · de bedrading is weg`);
  return fns[0](Object.assign({ preventDefault() {}, stopPropagation() {}, target: el }, event || {}));
}
const tik = () => new Promise(r => setTimeout(r, 0));

/** Datum n dagen van vandaag, als YYYY-MM-DD (zoals de server ze levert). */
function dag(offset) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

// ── 1· de grens met de gedeelde context ─────────────────────────────────────
test("werkongevallen 1· de werkruimte LEEST window.wfpAdmin en maakt hem niet aan", () => {
  assert.equal(/window\.wfpAdmin\s*=/.test(src), false,
    "alleen admin.js mag de gedeelde context aanmaken");
  assert.match(src, /const A = window\.wfpAdmin;/);
  assert.match(src, /if \(!A\) return;/);
  // Zonder context mag het bestand niets stukmaken (laadvolgorde is geen aanname).
  const { win } = laad({ zonderContext: true });
  assert.deepEqual(win, {}, "zonder context hoort de module niets te schrijven");
});

test("werkongevallen 2· de module registreert zichzelf in het view- en drawerregister", () => {
  const { A } = laad();
  assert.equal(typeof A.views.incidents, "function", "A.views.incidents ontbreekt · het scherm is onbereikbaar");
  assert.equal(typeof A.drawers.incident, "function",
    "A.drawers.incident ontbreekt · andere schermen openen de aangifte via d.incident(...)");
  // Registreren mag bestaande registraties niet wegvegen.
  assert.equal(typeof A.drawers.inquiry, "function", "het drawerregister is overschreven in plaats van aangevuld");
});

// ── 2· niets komt van buiten de context ─────────────────────────────────────
const UIT_CONTEXT = ["api", "esc", "tA", "uiConfirm", "openDrawer", "closeDrawer", "tenantId", "token"];

test("werkongevallen 3· elke functie die de module niet zelf definieert komt uit A", () => {
  // Statisch: de kop bindt precies deze namen, en allemaal uit A.
  const bindingen = [...src.matchAll(/^\s{2}const ([A-Za-z_$][\w$]*) = ([^;]+);$/gm)]
    .map(m => ({ naam: m[1], bron: m[2].trim() }))
    .filter(b => b.naam !== "A"); // A zelf is de context, niet iets eruit
  assert.deepEqual(bindingen.map(b => b.naam).sort(), UIT_CONTEXT.slice().sort(),
    "de kop bindt andere namen dan verwacht · controleer of er iets gekopieerd is");
  for (const b of bindingen) {
    // Altijd via A · geen eigen kanaal naar window, opslag of netwerk.
    assert.match(b.bron, /^A\./, `${b.naam} komt niet uit de gedeelde context maar uit "${b.bron}"`);
    assert.equal(/window\.|localStorage|fetch\(/.test(b.bron), false,
      `${b.naam} pakt een eigen bron (${b.bron}) in plaats van de gedeelde context`);
  }
  // Geen eigen kopie van een kernhelper: die zou stilletjes uit elkaar lopen.
  for (const naam of UIT_CONTEXT) {
    assert.equal(new RegExp(`function ${naam}\\s*\\(`).test(src), false,
      `${naam} is hier opnieuw gedefinieerd · dan bestaan er twee waarheden`);
  }
  assert.equal(/\brequire\(|^import /m.test(src), false, "browsercode zonder buildstap laadt niets via require/import");
});

// ── 3· het gedrag draait in een kale sandbox ────────────────────────────────
test("werkongevallen 4· het register toont alle rijen en telt ze", async () => {
  // Dit is de echte vangst van een extractie: een naam die alleen in admin.js
  // bestond. In strict mode is dat een ReferenceError, dus als deze render
  // slaagt is er niets achtergebleven.
  const rijen = [
    { id: "i1", date: dag(-20), employeeName: "Jan Peeters", location: "Werf Gent", severity: "licht", status: "open" },
    { id: "i2", date: dag(0), employeeName: "Els Maes", location: "Werf Brugge", severity: "ernstig", status: "open" },
    { id: "i3", date: dag(-30), employeeName: "Piet Claes", severity: "werkverlet", status: "gesloten", insurerReportedAt: dag(-28) },
  ];
  const paden = [];
  const { A, doc } = laad({
    ids: ["admContent", "admIncFilter", "admNewInc", "admIncCsv"],
    api: async (method, pad) => { paden.push(`${method} ${pad}`); return { incidents: rijen }; },
  });
  await A.views.incidents();

  assert.deepEqual(paden, ["GET /incidents"]);
  const html = doc.getElementById("admContent").innerHTML;
  for (const id of ["i1", "i2", "i3"]) {
    assert.ok(html.includes(`data-id="${id}"`), `${id} ontbreekt · het standaardfilter is niet "alle"`);
  }
  assert.ok(html.includes("Jan Peeters") && html.includes("Werf Gent"));
});

test("werkongevallen 5· de aangiftetermijn van 8 dagen wordt echt gerekend", async () => {
  // De wettelijke kern van dit scherm: aangifte bij de verzekeraar binnen 8
  // kalenderdagen. Een te laat dossier moet als te laat tonen, een gemeld
  // dossier als gemeld · anders is de opvolging waardeloos.
  const rijen = [
    { id: "telaat", date: dag(-20), employeeName: "A", severity: "licht", status: "open" },
    { id: "vandaag", date: dag(0), employeeName: "B", severity: "licht", status: "open" },
    { id: "gemeld", date: dag(-20), employeeName: "C", severity: "licht", status: "gemeld", insurerReportedAt: dag(-19) },
  ];
  const { A, doc } = laad({
    ids: ["admContent", "admIncFilter", "admNewInc", "admIncCsv"],
    api: async () => ({ incidents: rijen }),
  });
  await A.views.incidents();
  const html = doc.getElementById("admContent").innerHTML;
  const cel = id => html.split(`data-id="${id}"`)[1].split("</tr>")[0];

  assert.match(cel("telaat"), /«adm\.inc\.overdue»/, "een dossier van 20 dagen oud staat niet als te laat");
  assert.equal(/«adm\.inc\.overdue»/.test(cel("vandaag")), false, "een ongeval van vandaag staat al als te laat");
  assert.match(cel("vandaag"), /«adm\.inc\.dueBy».*\(8«adm\.leave\.daysAbbr»\)/,
    "de resterende termijn van 8 dagen klopt niet");
  assert.match(cel("gemeld"), /«adm\.inc\.reported»/, "een gemeld dossier toont nog een termijn");
  assert.equal(/«adm\.inc\.overdue»/.test(cel("gemeld")), false, "een gemeld dossier wordt alsnog als te laat gemarkeerd");
});

test("werkongevallen 6· het filter onthoudt zijn keuze en beperkt de lijst", async () => {
  const rijen = [
    { id: "licht", date: dag(-1), employeeName: "A", severity: "licht", status: "open" },
    { id: "ernstig", date: dag(-1), employeeName: "B", severity: "ernstig", status: "gesloten" },
    { id: "dodelijk", date: dag(-1), employeeName: "C", severity: "dodelijk", status: "open" },
  ];
  const { A, doc } = laad({
    ids: ["admContent", "admIncFilter", "admNewInc", "admIncCsv"],
    api: async () => ({ incidents: rijen }),
  });
  await A.views.incidents();

  vuur(doc, "admIncFilter", "change", { target: { value: "ernstig" } });
  await tik();
  let html = doc.getElementById("admContent").innerHTML;
  assert.ok(html.includes('data-id="ernstig"') && html.includes('data-id="dodelijk"'),
    "het ernstig-filter laat dodelijke ongevallen weg · net die moeten opvallen");
  assert.equal(html.includes('data-id="licht"'), false, "het filter beperkt de lijst niet");

  vuur(doc, "admIncFilter", "change", { target: { value: "open" } });
  await tik();
  html = doc.getElementById("admContent").innerHTML;
  assert.ok(html.includes('data-id="licht"') && html.includes('data-id="dodelijk"'));
  assert.equal(html.includes('data-id="ernstig"'), false, "het open-filter toont ook gesloten dossiers");
});

test("werkongevallen 7· een API-fout wordt getoond, niet gegooid", async () => {
  const { A, doc } = laad({ api: async () => { throw new Error("503 backend down"); } });
  await A.views.incidents();
  assert.match(doc.getElementById("admContent").innerHTML, /503 backend down/);
});

test("werkongevallen 8· de CSV-export gebruikt tenant en token uit de gedeelde context", async () => {
  // Deze tak verlaat de module (A.tenantId + A.token + fetch). Precies daar zou
  // een extractie stilletjes stukgaan, want beide stonden in admin.js.
  const { A, doc, geroepen } = laad({
    ids: ["admContent", "admIncFilter", "admNewInc", "admIncCsv"],
    api: async () => ({ incidents: [] }),
  });
  await A.views.incidents();
  await vuur(doc, "admIncCsv", "click");

  assert.equal(geroepen.fetches.length, 1, "er is geen export-verzoek vertrokken");
  assert.equal(geroepen.fetches[0].url, "/api/tenants/t-42/incidents?format=csv");
  assert.equal(geroepen.fetches[0].init.headers.Authorization, "Bearer jwt-abc",
    "de export gaat zonder token de deur uit");
  assert.match(doc.gemaakt[0].download, /^werkongevallen-\d{4}-\d{2}-\d{2}\.csv$/);
});

test("werkongevallen 8b· een mislukte export toont een melding en gooit niet", async () => {
  const { A, doc, geroepen } = laad({
    ids: ["admContent", "admIncFilter", "admNewInc", "admIncCsv"],
    api: async () => ({ incidents: [] }),
    fetchFaalt: true,
  });
  await A.views.incidents();
  await vuur(doc, "admIncCsv", "click");
  assert.deepEqual(geroepen.toasts, [{ tekst: "«adm.inc.exportErr»", soort: "error" }]);
});

// ── 4· de drawer ────────────────────────────────────────────────────────────
const DRAWER_IDS = ["admContent", "admDrawerTitle", "admDrawerBody", "incCancel", "incEmpSel", "incEmpName",
  "incVenueSel", "incLocation", "incSeverity", "incSevWarn", "incDelete", "incForm", "incFormErr"];

function drawerApi(gelogd) {
  return async (method, pad) => {
    gelogd.push(`${method} ${pad}`);
    if (pad === "/employees") return { employees: [{ id: "u1", name: "Jan Peeters" }, { id: "u2", name: "Weg", active: false }] };
    if (pad === "/venues") return { venues: [{ id: "v1", name: "Werf Gent" }] };
    if (pad === "/incidents") return { incidents: [] };
    return {};
  };
}

test("werkongevallen 9· de aangifte-drawer bouwt het formulier en opent", async () => {
  const roepen = [];
  const { A, doc, geroepen } = laad({ ids: DRAWER_IDS, api: drawerApi(roepen) });
  await A.drawers.incident(null);

  assert.equal(geroepen.openDrawer, 1, "de drawer is niet geopend");
  assert.deepEqual(roepen, ["GET /employees", "GET /venues"]);
  const body = doc.getElementById("admDrawerBody").innerHTML;
  assert.ok(body.includes('id="incForm"'));
  for (const veld of ["employeeName", "date", "severity", "description"]) {
    assert.ok(body.includes(`name="${veld}"`), `verplicht veld ${veld} ontbreekt in de aangifte`);
  }
  assert.ok(body.includes('value="u1"'), "de actieve medewerker staat niet in de keuzelijst");
  assert.equal(body.includes('value="u2"'), false, "een inactieve medewerker staat nog in de keuzelijst");
  assert.equal(body.includes('name="status"'), false, "een nieuwe registratie hoort nog geen statuskeuze te hebben");
  assert.equal(doc.getElementById("admDrawerTitle").textContent, "«adm.inc.newTitle»");
});

test("werkongevallen 10· een dodelijk ongeval toont de inspectiewaarschuwing", async () => {
  // Belgische meldplicht: de waarschuwing is geen versiering. Ze hangt aan een
  // luisteraar én aan de eerste schildering · beide moeten de knip overleven.
  const { A, doc } = laad({ ids: DRAWER_IDS, api: drawerApi([]) });
  doc.getElementById("incSeverity").value = "dodelijk";
  await A.drawers.incident({ id: "i1", date: dag(-1), severity: "dodelijk", status: "open" });

  const waarschuwing = doc.getElementById("incSevWarn");
  assert.equal(waarschuwing.textContent, "«adm.inc.fatalWarn»", "de waarschuwing bij een dodelijk ongeval is weg");
  assert.equal(waarschuwing.style.display, "");

  doc.getElementById("incSeverity").value = "licht";
  vuur(doc, "incSeverity", "change");
  assert.equal(waarschuwing.style.display, "none", "de waarschuwing blijft staan bij een licht ongeval");
});

test("werkongevallen 11· verwijderen vraagt bevestiging en ververst daarna de lijst", async () => {
  // uiConfirm en closeDrawer zitten in een callback · zonder hem af te vuren
  // zou een verweesde identifier daar ongemerkt blijven zitten.
  const roepen = [];
  const { A, doc, geroepen } = laad({ ids: DRAWER_IDS, api: drawerApi(roepen) });
  await A.drawers.incident({ id: "i1", date: "2026-07-01", severity: "licht", status: "open" });
  await vuur(doc, "incDelete", "click");

  assert.equal(geroepen.bevestigd.length, 1, "er wordt zonder bevestiging verwijderd");
  assert.equal(geroepen.bevestigd[0].opts.danger, true);
  assert.ok(roepen.includes("DELETE /incidents/i1"), `verwijderde niets · aangeroepen: ${roepen.join(", ")}`);
  assert.equal(geroepen.closeDrawer, 1, "de drawer blijft open na verwijderen");
  assert.ok(roepen.includes("GET /incidents"), "de lijst wordt niet herladen na verwijderen");
});

test("werkongevallen 11b· zonder bevestiging wordt er niets verwijderd", async () => {
  const roepen = [];
  const { A, doc } = laad({ ids: DRAWER_IDS, api: drawerApi(roepen), bevestig: false });
  await A.drawers.incident({ id: "i1", date: "2026-07-01", severity: "licht", status: "open" });
  await vuur(doc, "incDelete", "click");
  assert.equal(roepen.includes("DELETE /incidents/i1"), false, "annuleren verwijdert tóch");
});

test("werkongevallen 12· lege keuzelijsten gaan niet als lege string naar de server", async () => {
  // employeeId en venueId zijn optioneel; een leeg <select> levert "" op. Die
  // moet eruit, anders schrijft de server een verwijzing naar niets weg.
  const roepen = [];
  const verstuurd = [];
  const { A, doc, geroepen } = laad({
    ids: DRAWER_IDS,
    api: async (method, pad, body) => { roepen.push(`${method} ${pad}`); if (body) verstuurd.push(body); return drawerApi(roepen)(method, pad); },
  });
  await A.drawers.incident(null);
  const form = doc.getElementById("incForm");
  form._data = { employeeId: "", venueId: "", employeeName: "Jan Peeters", date: "2026-07-20", severity: "licht", description: "Val van ladder" };
  await vuur(doc, "incForm", "submit");

  assert.ok(roepen.includes("POST /incidents"), `er is niets aangemaakt · aangeroepen: ${roepen.join(", ")}`);
  assert.deepEqual(verstuurd[0], { employeeName: "Jan Peeters", date: "2026-07-20", severity: "licht", description: "Val van ladder" },
    "lege verwijzingen worden meegestuurd");
  assert.equal(geroepen.closeDrawer, 1);
  assert.deepEqual(geroepen.toasts, [{ tekst: "«adm.inc.createdToast»", soort: "success" }]);
});

test("werkongevallen 12b· bewerken PATCHt en toont een serverfout in het formulier", async () => {
  const { A, doc, geroepen } = laad({
    ids: DRAWER_IDS,
    api: async (method, pad) => {
      if (method === "PATCH") throw new Error("409 dossier al gemeld");
      return drawerApi([])(method, pad);
    },
  });
  await A.drawers.incident({ id: "i1", date: "2026-07-01", severity: "ernstig", status: "gemeld" });
  assert.ok(doc.getElementById("admDrawerBody").innerHTML.includes('name="status"'),
    "bij bewerken hoort de statuskeuze er wél te staan");
  const form = doc.getElementById("incForm");
  form._data = { employeeName: "Jan", date: "2026-07-01", severity: "ernstig", description: "x", status: "gemeld" };
  await vuur(doc, "incForm", "submit");

  const fout = doc.getElementById("incFormErr");
  assert.equal(fout.textContent, "409 dossier al gemeld", "de serverfout verdwijnt in het niets");
  assert.equal(fout.style.display, "");
  assert.equal(geroepen.closeDrawer, 0, "de drawer sluit ondanks een fout · het werk is weg");
});

// ── 5· de vertaling is niet onderweg gesneuveld ─────────────────────────────
// De originele code haalde ELKE zichtbare tekst door tA(sleutel, fallback). Bij
// een extractie is dat precies wat er stilletjes verloren gaat: één regel die
// als platte string terugkomt merkt niemand tot de Franse klant belt. De
// sleutelset staat daarom vast; hij mag groeien, niet krimpen.
const I18N_SLEUTELS = ["adm.actions", "adm.apt.thTime", "adm.cancel", "adm.createBtn", "adm.date",
  "adm.delete", "adm.edit", "adm.error", "adm.inc.createdToast", "adm.inc.csvBtn",
  "adm.inc.dateLabel", "adm.inc.deadlineHint", "adm.inc.deleteConfirm", "adm.inc.descLabel", "adm.inc.dueBy",
  "adm.inc.editTitle", "adm.inc.empName", "adm.inc.empty", "adm.inc.emptyBtn", "adm.inc.exportErr",
  "adm.inc.fatalWarn", "adm.inc.locLabel", "adm.inc.newTitle", "adm.inc.overdue", "adm.inc.reported",
  "adm.inc.reportedLabel", "adm.inc.savedToast", "adm.inc.seriousWarn", "adm.inc.sevFatal", "adm.inc.sevLight",
  "adm.inc.sevLostTime", "adm.inc.sevSerious", "adm.inc.singular", "adm.inc.stClosed", "adm.inc.stOpen",
  "adm.inc.stReported", "adm.inc.thEmployee", "adm.inc.thLocation", "adm.inc.thReport", "adm.inc.thSeverity",
  "adm.inc.witLabel", "adm.leave.daysAbbr", "adm.quote.manualFill", "adm.save", "adm.status",
  "mgr.all", "nav.incidents"];

test("werkongevallen 13· elke zichtbare tekst loopt nog via een i18n-sleutel", () => {
  const gebruikt = [...src.matchAll(/tA\("([^"]+)"/g)].map(m => m[1]);
  const ontbreekt = I18N_SLEUTELS.filter(k => !gebruikt.includes(k));
  assert.deepEqual(ontbreekt, [], `deze sleutels zijn verdwenen · staat de tekst nu hardgecodeerd? ${ontbreekt.join(", ")}`);
  assert.equal(gebruikt.length, 54, "het aantal vertaalde teksten is veranderd");
});

test("werkongevallen 14· de hardgecodeerde dialoogtitel uit het origineel groeit niet", () => {
  // Het origineel gaf uiConfirm een NL-titel zonder sleutel. Dat is bestaand
  // gedrag en is hier bewust niet gerepareerd · een extractie die onderweg iets
  // verbetert is niet meer te reviewen. De uitzondering staat hier bij naam
  // zodat ze zichtbaar blijft en er geen tweede bij kan komen.
  const zonderSleutel = [...src.matchAll(/title: "([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(zonderSleutel, ["Registratie verwijderen"]);
});

test("werkongevallen 15· geen em-dash in gebruikerszichtbare tekst", () => {
  assert.equal(src.includes("—"), false, "gebruik '-' of '·'");
});

// ── 6· de knip zelf ─────────────────────────────────────────────────────────
test("werkongevallen 16· de extractie is LETTERLIJK gelijk aan het origineel", () => {
  // Zolang admin.js het origineel nog draagt (de knip gebeurt centraal) moet de
  // verplaatste code teken voor teken gelijk zijn. Verandert er onderweg iets,
  // dan valt hier op wat een diff van 200 regels nooit laat zien.
  const start = src.indexOf("  // ── Werkongevallen (register");
  const eind = src.indexOf("\n  A.views = A.views || {};");
  assert.ok(start > 0 && eind > start, "de kop- of voetmarkering van de module is veranderd");
  const body = src.slice(start, eind);
  assert.ok(body.includes("async function renderIncidents()") && body.includes("async function openIncidentDrawer(inc)"),
    "de verhuisde code bevat niet beide functies");

  if (adminSrc.includes("async function renderIncidents()")) {
    assert.ok(adminSrc.includes(body),
      "de verplaatste code wijkt af van admin.js · een extractie hoort niets te herschrijven");
  } else {
    // Na de knip: admin.js mag geen enkel spoor meer dragen, anders draait er
    // een tweede kopie mee of verwijst een register naar niets.
    assert.equal(/function openIncidentDrawer/.test(adminSrc), false, "openIncidentDrawer staat nog in admin.js");
    assert.equal(/incidents: renderIncidents/.test(adminSrc), false, "admin.js registreert renderIncidents nog · die functie bestaat daar niet meer");
    assert.equal(/incident: openIncidentDrawer/.test(adminSrc), false, "admin.js registreert openIncidentDrawer nog");
    assert.equal(/_incFilter|tIncSeverity|tIncStatus|incDeadline/.test(adminSrc), false,
      "een hulpfunctie van het scherm is achtergebleven");
  }
});

test("werkongevallen 17· precies ÉÉN plek levert het scherm · nooit twee, nooit nul", () => {
  // De knip gebeurt centraal en de scripttag komt er los bij. Tussen die twee
  // momenten kan het scherm dubbel bestaan (twee kopieën die uiteen gaan
  // lopen) of helemaal verdwijnen. Deze test maakt beide toestanden zichtbaar.
  const index = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  const geladen = index.includes("/js/platforms/admin-werkongevallen.js");
  const inKern = adminSrc.includes("async function renderIncidents()");
  assert.ok(!(geladen && inKern),
    "het scherm staat nu op twee plekken · knip het blok uit admin.js (regels 2853-3059) weg");
  assert.ok(geladen || inKern,
    "het scherm staat nergens meer · zet de scripttag voor admin-werkongevallen.js in index.html");
});

test("werkongevallen 18· zodra de module geladen wordt, MOET admin.js tA en uiConfirm delen", () => {
  // De module leunt op A.tA en A.uiConfirm. Die staan wel in admin.js maar
  // worden NIET op window.wfpAdmin gezet. Kopiëren zou twee waarheden geven
  // (uiConfirm bepaalt de standaardknoplabels van élke bevestiging), dus de
  // kern hoort ze te exposeren. Zolang de scripttag ontbreekt is de module nog
  // niet aangesloten en is de afspraak nog niet opeisbaar.
  const index = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  if (!index.includes("/js/platforms/admin-werkongevallen.js")) return;
  const ontbreekt = ["tA", "uiConfirm"].filter(n => !new RegExp(`A\\.${n} = ${n};`).test(adminSrc));
  assert.deepEqual(ontbreekt, [],
    `admin.js exposeert dit niet op window.wfpAdmin: ${ontbreekt.join(", ")} · voeg "A.tA = tA;" en "A.uiConfirm = uiConfirm;" toe bij de gedeelde context`);
});
