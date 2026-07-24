"use strict";
// CTO3-09 · paginaregister van het resellerportaal.
//
// De zes paginamodules zijn parallel gebouwd en registreren zich elk nét
// anders. Deze shim vangt dat op. Zolang die verscheidenheid bestaat, moet ze
// ZICHTBAAR zijn: deze tests pinnen de aanvaarde vormen vast, zodat er geen
// zevende variant bij kan komen zonder dat iemand het merkt.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORMS = path.join(__dirname, "..", "public", "js", "platforms");
const lees = f => fs.readFileSync(path.join(PLATFORMS, f), "utf8").replace(/\r\n/g, "\n");

const PAGINAS = ["reseller-pipeline.js", "reseller-klanten.js", "reseller-licenties.js",
  "reseller-verdiensten.js", "reseller-toegang.js", "reseller-uitbetaling.js"];

/** Laad de shim in een minimale window-omgeving. */
function laadShim(registers) {
  const win = { ...registers };
  const fn = new Function("window", lees("reseller-pages.js"));
  fn(win);
  return win.wfpResellerPageRegistry;
}

test("RPR 1· de shim voegt BEIDE registers samen", () => {
  // Vijf pagina's gebruiken wfpResellerPages, toegang gebruikt
  // wfpResellerViews. Wie er één vergeet, verliest een pagina zonder fout.
  const reg = laadShim({
    wfpResellerPages: { pipeline: { label: "A", render: () => "" } },
    wfpResellerViews: { toegang: { title: "B", render: () => "" } },
  });
  assert.deepEqual(reg.pages().map(p => p.id), ["pipeline", "toegang"]);
  assert.deepEqual(reg.REGISTERS, ["wfpResellerPages", "wfpResellerViews"]);
});

test("RPR 2· de volgorde staat vast, niet de registratievolgorde", () => {
  const reg = laadShim({
    wfpResellerPages: {
      uitbetaling: { label: "u", render: () => "" },
      pipeline: { label: "p", render: () => "" },
      licenties: { label: "l", render: () => "" },
    },
  });
  assert.deepEqual(reg.pages().map(p => p.id), ["pipeline", "licenties", "uitbetaling"],
    "de laadvolgorde van scripttags mag het menu niet bepalen");
});

test("RPR 3· een NIET-geregistreerde pagina levert geen dood menu-item", () => {
  const reg = laadShim({ wfpResellerPages: { pipeline: { label: "p", render: () => "" } } });
  assert.deepEqual(reg.pages().map(p => p.id), ["pipeline"]);
  assert.equal(reg.pages().length < reg.VOLGORDE.length, true,
    "alleen wat echt geladen is verschijnt in de navigatie");
});

test("RPR 4· label komt uit label() of title, met de id als laatste terugval", () => {
  const reg = laadShim({
    wfpResellerPages: {
      pipeline: { label: () => "Pipeline & deals", render: () => "" },
      klanten: { title: "Klanten", render: () => "" },
      licenties: { render: () => "" },
    },
  });
  const perId = Object.fromEntries(reg.pages().map(p => [p.id, p.label]));
  assert.equal(perId.pipeline, "Pipeline & deals");
  assert.equal(perId.klanten, "Klanten");
  assert.equal(perId.licenties, "licenties", "zonder label blijft de id over · nooit leeg");
});

test("RPR 5· een label() dat GOOIT breekt het menu niet", () => {
  const reg = laadShim({
    wfpResellerPages: { pipeline: { label: () => { throw new Error("i18n weg"); }, render: () => "" } },
  });
  assert.equal(reg.pages()[0].label, "pipeline",
    "een kapotte vertaling mag geen leeg portaal opleveren");
});

test("RPR 6· BEIDE rendervormen werken · string terug OF de host vullen", async () => {
  const reg = laadShim({
    wfpResellerPages: {
      pipeline: { label: "p", render: () => "<p>uit string</p>" },
      klanten: { label: "k", render: host => { host.innerHTML = "<p>uit host</p>"; } },
    },
  });
  const paginas = reg.pages();

  const host1 = { innerHTML: "" };
  await paginas[0].render(host1);
  assert.equal(host1.innerHTML, "<p>uit string</p>");

  const host2 = { innerHTML: "" };
  await paginas[1].render(host2);
  assert.equal(host2.innerHTML, "<p>uit host</p>");
});

test("RPR 7· mount en open tellen ook als renderfunctie", async () => {
  const reg = laadShim({
    wfpResellerPages: { pipeline: { label: "p", mount: host => { host.innerHTML = "m"; } } },
    wfpResellerViews: { toegang: { title: "t", open: host => { host.innerHTML = "o"; } } },
  });
  const h1 = { innerHTML: "" }, h2 = { innerHTML: "" };
  await reg.pages()[0].render(h1);
  await reg.pages()[1].render(h2);
  assert.equal(h1.innerHTML, "m");
  assert.equal(h2.innerHTML, "o");
});

test("RPR 8· een pagina ZONDER renderfunctie zegt dat, in plaats van leeg te blijven", async () => {
  const reg = laadShim({ wfpResellerPages: { pipeline: { label: "p" } } });
  const host = { innerHTML: "" };
  await reg.pages()[0].render(host);
  assert.match(host.innerHTML, /nog niet beschikbaar/,
    "een leeg vlak laat de gebruiker denken dat er iets stuk is");
});

test("RPR 9· elke paginamodule bestaat en registreert zich in één van de twee registers", () => {
  for (const f of PAGINAS) {
    const src = lees(f);
    assert.ok(/wfpResellerPages|wfpResellerViews/.test(src), `${f} registreert zich nergens`);
    assert.ok(/=\s*window\.wfpReseller(Pages|Views)\s*=\s*window\.wfpReseller(Pages|Views)\s*\|\|/.test(src)
      || /window\.wfpReseller(Pages|Views)\s*=\s*window\.wfpReseller(Pages|Views)\s*\|\|/.test(src),
    `${f} maakt het register niet idempotent aan · de laadvolgorde zou dan bepalen wie overleeft`);
  }
});

test("RPR 10· GEEN paginamodule stuurt een organisatie-id naar de server", () => {
  // h23.6 / ISO-03: de server leidt de reseller af uit de sessie. Een UI die
  // een resellerId meestuurt opent cross-reseller toegang zodra de server ooit
  // iets minder streng wordt.
  const fouten = [];
  for (const f of PAGINAS) {
    const src = lees(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const m of src.matchAll(/resellerId\s*[:=]\s*(?!null)(\w)/g)) {
      fouten.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(fouten, [], `deze pagina's dragen een organisatie-id: ${fouten.join(" · ")}`);
});

test("RPR 11· elke paginamodule wordt geladen door index.html", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  for (const f of [...PAGINAS, "reseller-pages.js"]) {
    assert.ok(html.includes(`/js/platforms/${f}`), `${f} staat niet in index.html`);
  }
  // Het register moet er zijn vóór reseller.js het uitleest bij het bouwen van
  // de shell · reseller.js staat eerder, maar leest pas bij render.
  assert.ok(html.indexOf("reseller-pages.js") > html.indexOf("platforms/reseller.js"),
    "de shim hoort na reseller.js · daarvoor bestaat de shell nog niet");
});

test("RPR 12· reseller.js toont ALLEEN geregistreerde pagina's", () => {
  const src = lees("reseller.js");
  assert.ok(src.includes("wfpResellerPageRegistry"), "de shell leest het register niet");
  assert.ok(src.includes("extraNavItems()"), "de navigatie toont de extra pagina's niet");
  assert.match(src, /const reg = window\.wfpResellerPageRegistry;\s*\n\s*return reg \? reg\.pages\(\) : \[\];/,
    "zonder register hoort de shell gewoon door te draaien, niet te crashen");
});
