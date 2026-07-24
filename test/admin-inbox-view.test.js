"use strict";
// ── Extractie van het scherm "inbox" (Klantvragen) uit admin.js ──────────────
//
// Een extractie is geslaagd als er NIETS veranderd is behalve de plaats. Deze
// tests toetsen dus twee dingen tegelijk:
//
//   * de grens: het bestand leest de gedeelde context en maakt haar niet aan,
//     het registreert zichzelf, en alles wat het niet zelf meebrengt komt uit
//     window.wfpAdmin (geen tweede waarheid, geen stille kopie);
//   * het gedrag: de renderer draait echt in een kale sandbox. Zou er één
//     identifier zijn die alleen in admin.js bestond, dan valt hij hier om met
//     een ReferenceError in plaats van pas in productie.
//
// De module is browsercode zonder buildstap; ze wordt hier met node:vm in een
// nagebootst window/document geladen.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const MOD = path.join(ROOT, "public", "js", "platforms", "admin-klantvragen.js");
const ADMIN = path.join(ROOT, "public", "js", "platforms", "admin.js");

// Regeleindes normaliseren: git zet ze op Windows naar CRLF zodra hij het
// bestand aanraakt, en dan matcht een patroon met \n opeens niets meer.
const src = fs.readFileSync(MOD, "utf8").replace(/\r\n/g, "\n");
const adminSrc = fs.readFileSync(ADMIN, "utf8").replace(/\r\n/g, "\n");

// ── Nagebootste browser ─────────────────────────────────────────────────────
function maakElement(id) {
  return {
    id, innerHTML: "", textContent: "", value: "", disabled: false,
    style: {}, dataset: {}, luisteraars: {},
    addEventListener(type, fn) { (this.luisteraars[type] = this.luisteraars[type] || []).push(fn); },
    querySelectorAll() { return []; },
  };
}
function maakDocument(ids) {
  const els = new Map();
  for (const id of ids) els.set(id, maakElement(id));
  return {
    els,
    getElementById(id) { return els.get(id) || null; },
    querySelectorAll() { return []; },
  };
}

/** Laadt de module in een sandbox en geeft de gedeelde context + document terug. */
function laad(opties) {
  const cfg = opties || {};
  const geroepen = { openDrawer: 0, closeDrawer: 0, switchView: [] };
  const A = {
    api: cfg.api || (async () => ({})),
    // De echte esc uit admin.js; hier alleen nodig omdat de module hem gebruikt.
    esc: s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    // tA valt in de app terug op de fallback als er geen vertaling is; hier
    // geven we de SLEUTEL terug, zodat een test kan zien dat er vertaald is.
    tA: (key) => `«${key}»`,
    uiConfirm: async () => true,
    openDrawer() { geroepen.openDrawer++; },
    closeDrawer() { geroepen.closeDrawer++; },
    switchView(v) { geroepen.switchView.push(v); },
    views: {}, drawers: { offerte(q) { geroepen.offerte = q; } },
  };
  const doc = maakDocument(cfg.ids || ["admContent"]);
  const win = cfg.zonderContext ? {} : { wfpAdmin: A };
  if (cfg.modules) win._wfpEnt = { modules: cfg.modules };
  const sandbox = { window: win, document: doc, navigator: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "admin-klantvragen.js" });
  return { A, doc, geroepen, win };
}

/** Vuurt de eerste geregistreerde luisteraar van een element af. */
function klik(doc, id) {
  const el = doc.getElementById(id);
  assert.ok(el, `element ${id} bestaat niet in de nagebootste DOM`);
  const fns = el.luisteraars.click || [];
  assert.equal(fns.length > 0, true, `${id} heeft geen klik-luisteraar · de bedrading is weg`);
  return fns[0]({ preventDefault() {} });
}

// ── 1· de grens met de gedeelde context ─────────────────────────────────────
test("inbox 1· de werkruimte LEEST window.wfpAdmin en maakt hem niet aan", () => {
  assert.equal(/window\.wfpAdmin\s*=/.test(src), false,
    "alleen admin.js mag de gedeelde context aanmaken");
  assert.match(src, /const A = window\.wfpAdmin;/);
  assert.match(src, /if \(!A\) return;/);
  // Zonder context mag het bestand niets stukmaken (laadvolgorde is geen aanname).
  const { win } = laad({ zonderContext: true });
  assert.deepEqual(win, {}, "zonder context hoort de module niets te schrijven");
});

test("inbox 2· de module registreert zichzelf in het view- en drawerregister", () => {
  const { A } = laad();
  assert.equal(typeof A.views.inbox, "function", "A.views.inbox ontbreekt · het scherm is onbereikbaar");
  assert.equal(typeof A.drawers.inquiry, "function",
    "A.drawers.inquiry ontbreekt · de knop + Klantvraag (admin.js) roept d.inquiry(null) aan");
  // Registreren mag bestaande registraties niet wegvegen.
  assert.equal(typeof A.drawers.offerte, "function", "het drawerregister is overschreven in plaats van aangevuld");
});

// ── 2· niets komt van buiten de context ─────────────────────────────────────
const UIT_CONTEXT = ["api", "esc", "tA", "uiConfirm", "openDrawer", "closeDrawer", "switchView", "openOfferteDrawer"];

test("inbox 3· elke functie die de module niet zelf definieert komt uit A", () => {
  // Statisch: de kop bindt precies deze namen, en allemaal uit A.
  const bindingen = [...src.matchAll(/^\s{2}const ([A-Za-z_$][\w$]*) = ([^;]+);$/gm)]
    .map(m => ({ naam: m[1], bron: m[2].trim() }))
    .filter(b => b.naam !== "A"); // A zelf is de context, niet iets eruit
  assert.deepEqual(bindingen.map(b => b.naam).sort(), UIT_CONTEXT.slice().sort(),
    "de kop bindt andere namen dan verwacht · controleer of er iets gekopieerd is");
  for (const b of bindingen) {
    // Rechtstreeks (A.api) of laat gebonden (q => A.drawers.offerte(q)), maar
    // altijd via A · geen eigen kanaal naar window, opslag of netwerk.
    assert.match(b.bron, /\bA\./, `${b.naam} komt niet uit de gedeelde context maar uit "${b.bron}"`);
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

test("inbox 4· de renderer draait in een kale sandbox (geen verweesde identifier)", async () => {
  // Dit is de echte vangst van een extractie: een naam die alleen in admin.js
  // bestond. In strict mode is dat een ReferenceError, dus als deze render
  // slaagt is er niets achtergebleven.
  const rijen = [
    { id: "q1", status: "nieuw", subject: "Lek in dak", fromName: "Jan", fromEmail: "jan@vb.be", receivedAt: "2026-07-20T09:00:00Z", customerName: "Bouw BV" },
    { id: "q2", status: "in_behandeling", subject: "Offerte gevraagd", fromEmail: "els@vb.be", receivedAt: "2026-07-19T09:00:00Z" },
    { id: "q3", status: "gesloten", subject: "Afgehandeld", fromName: "Piet", source: "handmatig" },
  ];
  const paden = [];
  const { A, doc } = laad({
    ids: ["admContent", "admInboxBadge"],
    api: async (method, pad) => {
      paden.push(`${method} ${pad}`);
      if (pad === "/inquiries") return { inquiries: rijen };
      if (pad === "/inquiries/intake-config") return { intake: { address: "intake@monargo.one", live: false } };
      return {};
    },
  });
  await A.views.inbox();

  assert.deepEqual(paden, ["GET /inquiries", "GET /inquiries/intake-config"]);
  const html = doc.getElementById("admContent").innerHTML;
  // Standaardfilter is "nieuw": alleen q1 hoort in de tabel te staan.
  assert.ok(html.includes('data-id="q1"'), "de nieuwe klantvraag ontbreekt");
  assert.equal(html.includes('data-id="q2"'), false, "het standaardfilter toont ook niet-nieuwe vragen");
  assert.equal(html.includes('data-id="q3"'), false);
  assert.ok(html.includes("intake@monargo.one"), "het intake-adres wordt niet getoond");
  // De badge in de navigatie telt alleen de nieuwe vragen.
  assert.equal(doc.getElementById("admInboxBadge").textContent, 1);
});

test("inbox 5· een API-fout wordt getoond, niet gegooid", async () => {
  const { A, doc } = laad({ api: async () => { throw new Error("503 backend down"); } });
  await A.views.inbox();
  assert.match(doc.getElementById("admContent").innerHTML, /503 backend down/);
});

test("inbox 6· de drawer opent en bouwt het handmatige formulier", async () => {
  const { A, doc, geroepen } = laad({
    ids: ["admContent", "admDrawerTitle", "admDrawerBody", "inqCancel", "inqForm", "inqFormErr"],
    api: async () => ({ customers: [{ id: "c1", name: "Bouw BV" }] }),
  });
  await A.drawers.inquiry(null);
  assert.equal(geroepen.openDrawer, 1, "de drawer is niet geopend");
  const body = doc.getElementById("admDrawerBody").innerHTML;
  assert.ok(body.includes('id="inqForm"'));
  assert.ok(body.includes('name="subject"'), "het onderwerp-veld ontbreekt in de handmatige invoer");
  assert.equal(doc.getElementById("admDrawerTitle").textContent, "«adm.inq.newTitle»");
});

test("inbox 6b· verwijderen vraagt bevestiging en ververst daarna de lijst", async () => {
  // uiConfirm en closeDrawer zitten in een callback · zonder hem af te vuren
  // zou een verweesde identifier daar ongemerkt blijven zitten.
  const roepen = [];
  const { A, doc, geroepen } = laad({
    ids: ["admContent", "admDrawerTitle", "admDrawerBody", "inqCancel", "inqDelete", "inqForm", "inqFormErr"],
    api: async (method, pad) => {
      roepen.push(`${method} ${pad}`);
      if (pad === "/customers") return { customers: [] };
      if (pad === "/inquiries") return { inquiries: [] };
      return {};
    },
  });
  await A.drawers.inquiry({ id: "q1", status: "nieuw", subject: "Lek", fromEmail: "jan@vb.be" });
  await klik(doc, "inqDelete");
  assert.ok(roepen.includes("DELETE /inquiries/q1"), `verwijderde niets · aangeroepen: ${roepen.join(", ")}`);
  assert.equal(geroepen.closeDrawer, 1, "de drawer blijft open na verwijderen");
  assert.ok(roepen.includes("GET /inquiries"), "de lijst wordt niet herladen na verwijderen");
});

test("inbox 6c· de AI-raming maakt pas een offerte NA bevestiging", async () => {
  // De gevoeligste tak van dit scherm: hij verlaat de module (switchView +
  // A.drawers.offerte). Precies daar zou een extractie stukgaan.
  const roepen = [];
  const { A, doc, geroepen } = laad({
    ids: ["admContent", "admDrawerTitle", "admDrawerBody", "inqCancel", "inqDelete", "inqForm", "inqFormErr",
      "inqAiZone", "inqAiBtn", "inqAiConfirm", "inqAiDismiss"],
    modules: ["ai_estimate"],
    api: async (method, pad) => {
      roepen.push(`${method} ${pad}`);
      if (pad === "/customers") return { customers: [] };
      if (pad === "/estimate") {
        // Zelfde vorm als POST /estimate in src/server.js: estimate én prefill
        // staan NAAST elkaar in het antwoord, niet in elkaar.
        return {
          estimate: { lines: [{ qty: 2, unitPrice: 150, description: "Dakpannen" }], confidence: "middel", assumptions: ["30 m2"], mock: true },
          prefill: { customerId: null, customerName: "" },
        };
      }
      if (pad === "/offertes") return { quote: { id: "o1", number: "Q-2026-001" } };
      return {};
    },
  });
  await A.drawers.inquiry({ id: "q1", status: "nieuw", subject: "Dak", fromName: "Jan" });

  await klik(doc, "inqAiBtn");
  assert.ok(roepen.includes("POST /estimate"));
  assert.equal(roepen.includes("POST /offertes"), false,
    "de raming maakt meteen een offerte aan · de menselijke eindcontrole is weg");
  const zone = doc.getElementById("inqAiZone").innerHTML;
  assert.ok(zone.includes("300.00"), `het regeltotaal (2 x 150) ontbreekt in de voorbeschouwing: ${zone}`);

  await klik(doc, "inqAiConfirm");
  assert.ok(roepen.includes("POST /offertes"), "na bevestigen wordt er geen concept aangemaakt");
  assert.deepEqual(geroepen.switchView, ["offertes"]);
  assert.deepEqual(geroepen.offerte, { id: "o1", number: "Q-2026-001" },
    "de nieuwe offerte wordt niet geopend · A.drawers.offerte is niet bereikt");
});

// ── 3· de vertaling is niet onderweg gesneuveld ─────────────────────────────
// De originele code haalde ELKE zichtbare tekst door tA(sleutel, fallback). Bij
// een extractie is dat precies wat er stilletjes verloren gaat: één regel die
// als platte string terugkomt merkt niemand tot de Franse klant belt. De
// sleutelset staat daarom vast; hij mag groeien, niet krimpen.
const I18N_SLEUTELS = ["adm.cancel", "adm.createBtn", "adm.delete", "adm.error", "adm.est.assumptions",
  "adm.est.btn", "adm.est.busy", "adm.est.confHigh", "adm.est.confLow", "adm.est.confMid",
  "adm.est.confirmBtn", "adm.est.createdToast", "adm.est.creating", "adm.est.hint", "adm.est.previewTitle",
  "adm.est.reviewToast", "adm.est.subtotal", "adm.inq.copiedToast", "adm.inq.copyBtn", "adm.inq.createdToast",
  "adm.inq.deleteConfirm", "adm.inq.empty", "adm.inq.emptyHint", "adm.inq.fOpen", "adm.inq.fromEmail",
  "adm.inq.fromName", "adm.inq.intakeLabel", "adm.inq.manualTag", "adm.inq.newTitle", "adm.inq.noCustomer",
  "adm.inq.replyHint", "adm.inq.savedToast", "adm.inq.singular", "adm.inq.stAnswered", "adm.inq.stBusy",
  "adm.inq.stClosed", "adm.inq.stNew", "adm.inq.testMode", "adm.inq.textLabel", "adm.inq.thFrom",
  "adm.inq.thReceived", "adm.inq.thSubject", "adm.inq.viaMail", "adm.save", "adm.status",
  "adm.thCustomer", "mgr.all", "nav.inbox"];

test("inbox 7· elke zichtbare tekst loopt nog via een i18n-sleutel", () => {
  const gebruikt = [...src.matchAll(/tA\("([^"]+)"/g)].map(m => m[1]);
  const ontbreekt = I18N_SLEUTELS.filter(k => !gebruikt.includes(k));
  assert.deepEqual(ontbreekt, [], `deze sleutels zijn verdwenen · staat de tekst nu hardgecodeerd? ${ontbreekt.join(", ")}`);
  assert.equal(gebruikt.length, 64, "het aantal vertaalde teksten is veranderd");
});

test("inbox 8· de hardgecodeerde dialoogtitel uit het origineel groeit niet", () => {
  // Het origineel gaf uiConfirm een NL-titel zonder sleutel. Dat is bestaand
  // gedrag en is hier bewust niet gerepareerd · een extractie die onderweg iets
  // verbetert is niet meer te reviewen. De uitzondering staat hier bij naam
  // zodat ze zichtbaar blijft en er geen tweede bij kan komen.
  const zonderSleutel = [...src.matchAll(/title: "([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(zonderSleutel, ["Klantvraag verwijderen"]);
});

test("inbox 9· geen em-dash in gebruikerszichtbare tekst", () => {
  assert.equal(src.includes("—"), false, "gebruik '-' of '·'");
});

// ── 4· de knip zelf ─────────────────────────────────────────────────────────
test("inbox 10· de extractie is LETTERLIJK gelijk aan het origineel", () => {
  // Zolang admin.js het origineel nog draagt (de knip gebeurt centraal) moet de
  // verplaatste code teken voor teken gelijk zijn. Verandert er onderweg iets,
  // dan valt hier op wat een diff van 230 regels nooit laat zien.
  const start = src.indexOf("  // ── Klantvragen (Inbox");
  const eind = src.indexOf("  // Registreren in de gedeelde registers");
  assert.ok(start > 0 && eind > start, "de kop- of voetmarkering van de module is veranderd");
  const body = src.slice(start, eind).replace(/\s+$/, "\n");
  assert.ok(body.includes("async function renderInbox()") && body.includes("async function openInquiryDrawer(inq)"),
    "de verhuisde code bevat niet beide functies");

  if (adminSrc.includes("async function renderInbox()")) {
    assert.ok(adminSrc.includes(body),
      "de verplaatste code wijkt af van admin.js · een extractie hoort niets te herschrijven");
  } else {
    // Na de knip: admin.js mag geen enkel spoor meer dragen, anders draait er
    // een tweede kopie mee of verwijst een register naar niets.
    assert.equal(/function openInquiryDrawer/.test(adminSrc), false, "openInquiryDrawer staat nog in admin.js");
    assert.equal(/inbox: renderInbox/.test(adminSrc), false, "admin.js registreert renderInbox nog · die functie bestaat daar niet meer");
    assert.equal(/inquiry: openInquiryDrawer/.test(adminSrc), false, "admin.js registreert openInquiryDrawer nog");
    assert.equal(/_inqFilter|tInqStatus/.test(adminSrc), false, "een hulpfunctie van het scherm is achtergebleven");
  }
});

test("inbox 11· precies ÉÉN plek levert het scherm · nooit twee, nooit nul", () => {
  // De knip gebeurt centraal en de scripttag komt er los bij. Tussen die twee
  // momenten kan het scherm dubbel bestaan (twee kopieën die uiteen gaan
  // lopen) of helemaal verdwijnen. Deze test maakt beide toestanden zichtbaar.
  const index = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  const geladen = index.includes("/js/platforms/admin-klantvragen.js");
  const inKern = adminSrc.includes("async function renderInbox()");
  assert.ok(!(geladen && inKern),
    "het scherm staat nu op twee plekken · knip het blok uit admin.js (regels 3061-3291) weg");
  assert.ok(geladen || inKern,
    "het scherm staat nergens meer · zet de scripttag voor admin-klantvragen.js in index.html");
});

test("inbox 12· zodra de module geladen wordt, MOET admin.js tA en uiConfirm delen", () => {
  // De module leunt op A.tA en A.uiConfirm. Die stonden wel in admin.js maar
  // werden NIET op window.wfpAdmin gezet. Kopiëren zou twee waarheden geven
  // (uiConfirm bepaalt de standaardknoplabels van élke bevestiging), dus de
  // kern hoort ze te exposeren. Zolang de scripttag ontbreekt is de module nog
  // niet aangesloten en is de afspraak nog niet opeisbaar.
  const index = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  if (!index.includes("/js/platforms/admin-klantvragen.js")) return;
  const ontbreekt = ["tA", "uiConfirm"].filter(n => !new RegExp(`A\\.${n} = ${n};`).test(adminSrc));
  assert.deepEqual(ontbreekt, [],
    `admin.js exposeert dit niet op window.wfpAdmin: ${ontbreekt.join(", ")} · voeg "A.tA = tA;" en "A.uiConfirm = uiConfirm;" toe bij de gedeelde context`);
});
