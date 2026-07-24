"use strict";
// ── Frontend-architectuurbewaking (tegenhanger van de CTO3-10-ratchet) ───────
// public/js/platforms/admin.js is met ~9.000 regels dezelfde monoliet die
// server.js was. Het splitspatroon bestaat al en werkt: een werkruimte leest
// window.wfpAdmin (de gedeelde context met api/esc/views/drawers) en registreert
// zichzelf in A.views. Deze tests maken dat patroon afdwingbaar:
//
//   * admin.js mag alleen KRIMPEN (ratchet · budget verlagen bij elke extractie);
//   * elk script in index.html bestaat echt, en elk platformbestand op schijf
//     wordt ook echt geladen · geen dode of vergeten bestanden;
//   * werkruimtes definieren de gedeelde context NIET opnieuw, ze lezen hem.
//
// Verhoog het budget nooit. Hoort er code bij, dan hoort ze in een eigen
// werkruimtebestand onder public/js/platforms/.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const ADMIN = path.join(PUBLIC, "js", "platforms", "admin.js");

// ── Het budget (ratchet · alleen omlaag) ─────────────────────────────────────
const MAX_ADMIN_LINES = 6197;   // elf schermen uitgesplitst (was 9153)
const FINAL_TARGET_LINES = 2500; // zelfde einddoel als server.js

function lines(p) { return fs.readFileSync(p, "utf8").split("\n").length; }
function indexHtml() { return fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8"); }
function scriptSrcs() {
  return [...indexHtml().matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
}

test("frontend 1· admin.js groeit niet meer (regelbudget daalt alleen)", () => {
  const n = lines(ADMIN);
  assert.ok(n <= MAX_ADMIN_LINES,
    `admin.js heeft ${n} regels, budget is ${MAX_ADMIN_LINES}. Extraheer een werkruimte naar public/js/platforms/ en verlaag het budget · verhogen is geen optie.`);
});

test("frontend 2· elk script in index.html bestaat echt op schijf", () => {
  const ontbreekt = scriptSrcs()
    .filter(src => src.startsWith("/"))
    .filter(src => !fs.existsSync(path.join(PUBLIC, src.replace(/^\//, ""))));
  assert.deepEqual(ontbreekt, [], `index.html laadt bestanden die niet bestaan: ${ontbreekt.join(", ")}`);
});

test("frontend 3· elk platformbestand wordt ook echt geladen (geen weesbestanden)", () => {
  const dir = path.join(PUBLIC, "js", "platforms");
  const geladen = new Set(scriptSrcs());
  const wees = fs.readdirSync(dir)
    .filter(f => f.endsWith(".js"))
    .filter(f => !geladen.has(`/js/platforms/${f}`));
  assert.deepEqual(wees, [], `deze werkruimtes staan op schijf maar worden nooit geladen: ${wees.join(", ")}`);
});

test("frontend 4· werkruimtes LEZEN de gedeelde context, ze herdefinieren hem niet", () => {
  const dir = path.join(PUBLIC, "js", "platforms");
  const fouten = [];
  for (const f of fs.readdirSync(dir).filter(x => x.startsWith("admin-") && x.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    // Alleen admin.js mag de context AANMAKEN (window.wfpAdmin = ...).
    if (/window\.wfpAdmin\s*=/.test(src)) fouten.push(`${f} maakt window.wfpAdmin aan`);
    // Een werkruimte hoort de context wel te LEZEN · anders hangt ze los.
    if (!/window\.wfpAdmin/.test(src)) fouten.push(`${f} leest window.wfpAdmin niet`);
  }
  assert.deepEqual(fouten, [], fouten.join(" · "));
});

test("frontend 5· admin.js blijft de enige plek die de gedeelde context aanmaakt", () => {
  const src = fs.readFileSync(ADMIN, "utf8");
  assert.match(src, /window\.wfpAdmin\s*=\s*window\.wfpAdmin\s*\|\|/,
    "admin.js hoort de gedeelde context idempotent aan te maken");
});

test("frontend 6· het einddoel blijft staan tot het budget het raakt", () => {
  assert.equal(FINAL_TARGET_LINES, 2500);
  assert.ok(MAX_ADMIN_LINES >= FINAL_TARGET_LINES, "blijf extraheren tot het budget het einddoel raakt");
});

// ── De IA-laag (public/js/app/) ──────────────────────────────────────────────
// Dit is de doelarchitectuur uit de IA-handover. Ze mag NOOIT terugleunen op de
// monoliet, anders is de strangler-migratie een cirkel in plaats van een pad.
function appFiles(dir) {
  const base = dir || path.join(PUBLIC, "js", "app");
  if (!fs.existsSync(base)) return [];
  const uit = [];
  for (const naam of fs.readdirSync(base)) {
    const p = path.join(base, naam);
    // Recursief: werkruimtes zitten twee niveaus diep (workspaces/customer/).
    if (fs.statSync(p).isDirectory()) uit.push(...appFiles(p));
    else if (naam.endsWith(".js")) uit.push(p);
  }
  return uit;
}

// De router is per definitie de plek waar de pure laag de browser raakt:
// history, popstate en linkklikken bestaan nergens anders. Dat is één
// benoemde uitzondering, geen versoepeling · regel 7b bewaakt dat het er
// één blijft.
const DOM_EXCEPTION = "js/app/routing/router.js";

test("frontend 7· de IA-laag leunt niet terug op de monoliet", () => {
  const fouten = [];
  for (const p of appFiles()) {
    const src = fs.readFileSync(p, "utf8");
    const naam = path.relative(PUBLIC, p).replace(/\\/g, "/");
    if (/window\.wfpAdmin|\bA\.views\b/.test(src)) fouten.push(`${naam} leest de admin-monoliet`);
    if (naam !== DOM_EXCEPTION && /\bdocument\.|\blocalStorage\b|\bfetch\(/.test(src)) {
      fouten.push(`${naam} raakt de DOM of het netwerk · de IA-kern hoort puur te zijn`);
    }
    if (!/module\.exports/.test(src)) fouten.push(`${naam} is niet in Node te laden · dan kan het contract niet getest worden`);
  }
  assert.deepEqual(fouten, [], fouten.join(" · "));
});

test("frontend 7b· er is precies ÉÉN bestand dat de browser aanraakt", () => {
  const raken = appFiles()
    .map(p => path.relative(PUBLIC, p).replace(/\\/g, "/"))
    .filter(naam => /\bdocument\.|\bhistory\.|\blocation\.|\bwindow\.addEventListener/.test(
      fs.readFileSync(path.join(PUBLIC, naam), "utf8")));
  assert.deepEqual(raken, [DOM_EXCEPTION],
    `alleen de router mag de browser aanraken · deze bestanden doen het ook: ${raken.join(", ")}`);
});

/** Broncode zonder commentaar · anders faalt een test op een uitleg. */
function code(p) {
  return fs.readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("frontend 7c· de router mag zelf ook niet in de monoliet grijpen", () => {
  const src = code(path.join(PUBLIC, DOM_EXCEPTION));
  assert.equal(/window\.wfpAdmin/.test(src), false,
    "de router kent de monoliet niet · de bootstrap geeft hem een onRender-functie");
  assert.equal(/switchView\s*\(/.test(src), false,
    "de router roept switchView niet zelf aan · dat doet de bootstrap");
});

test("frontend 8· elk IA-bestand heeft een contracttest", () => {
  const testSrc = fs.readdirSync(path.join(ROOT, "test"))
    .filter(f => f.startsWith("ia-") && f.endsWith(".test.js"))
    .map(f => fs.readFileSync(path.join(ROOT, "test", f), "utf8")).join("\n");
  const ongedekt = appFiles()
    .map(p => path.relative(PUBLIC, p).replace(/\\/g, "/"))
    .filter(rel => !testSrc.includes(rel.replace(/^js\//, "").replace(/\.js$/, "")));
  assert.deepEqual(ongedekt, [], `deze IA-bestanden hebben geen contracttest: ${ongedekt.join(", ")}`);
});
