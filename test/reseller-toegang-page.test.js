"use strict";
// ── Resellerportaal · pagina "Gedelegeerde toegang" (CTO3-09) ────────────────
//
// Deze pagina raakt drie dingen die je niet met het oog controleert:
//
//   * de GRENS · haakt de module aan op het bestaande portaal zonder de
//     gedeelde context of de state van reseller.js te herdefinieren?
//   * de SCOPE · gaat er ooit een organisatie-id vanuit de UI naar de server?
//     De server leidt de organisatie af uit de sessie; een UI die er toch een
//     meestuurt, verplaatst de autorisatie stilletjes naar de client.
//   * de WEIGERING · toont een 403/404 een generieke melding, of lekt ze een
//     record-id of "bestaat niet"? Dat laatste is een bestaans-oracle waarmee
//     je ids kunt aftasten.
//
// Daarom draait dit bestand de module echt, in een nep-DOM, en kijkt naar de
// gerenderde HTML en naar elke fetch die eruit komt.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MOD = path.join(__dirname, "..", "public", "js", "platforms", "reseller-toegang.js");
const src = fs.readFileSync(MOD, "utf8").replace(/\r\n/g, "\n");

/** Broncode zonder commentaar · anders telt een uitleg mee als code. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ── Nep-DOM ─────────────────────────────────────────────────────────────────

function maakElement(id) {
  const el = {
    id, value: "", checked: false, disabled: false, textContent: "",
    style: {}, dataset: {}, handlers: {}, _html: "", _nodes: new Map(),
    addEventListener(type, fn) { this.handlers[type] = fn; },
    removeAttribute() {},
    setAttribute() {},
    classList: { toggle() {} },
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return el._html; },
    set(v) { el._html = String(v); el._nodes.clear(); },
    enumerable: true,
  });
  return el;
}

/** Knopen uit gerenderde HTML halen op class + data-id, zoals de module ze zoekt. */
function zoekAlles(el, selector) {
  const cls = selector.replace(/^\./, "");
  const re = new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"\\s+data-id="([^"]*)"`, "g");
  return [...el.innerHTML.matchAll(re)].map(m => {
    const sleutel = `${cls}#${m[1]}`;
    if (!el._nodes.has(sleutel)) {
      const node = maakElement("");
      node.dataset.id = m[1];
      el._nodes.set(sleutel, node);
    }
    return el._nodes.get(sleutel);
  });
}

const GRANT_ACTIEF = {
  id: "rag_11aa22bb33cc44dd",
  tenantId: "ten_klant_1",
  scope: ["ticket_view"],
  reason: "Ondersteuning bij onboarding",
  status: "active",
  startAt: "2020-01-01T00:00:00.000Z",
  endAt: "2099-01-01T00:00:00.000Z",
};

const GRANT_AANGEVRAAGD = {
  id: "rag_99zz88yy77xx66ww",
  tenantId: "ten_klant_1",
  scope: ["config_write"],
  reason: "Configuratie afwerken",
  status: "requested",
  startAt: "2020-01-01T00:00:00.000Z",
  endAt: "2099-01-01T00:00:00.000Z",
};

const TOEGEWEZEN = {
  ok: true,
  tenants: [{
    linkId: "rtl_aaaabbbbcccc1111",
    tenantId: "ten_klant_1",
    relationType: "reseller_of_record",
    startAt: "2024-01-01T00:00:00.000Z",
    endAt: null,
    tenant: {
      tenantId: "ten_klant_1", name: "Bouwwerken Vermeulen", plan: "business",
      status: "active", seats: 12, language: "NL", billingOwnership: "monargo_direct",
      renewal: "2027-01-01T00:00:00.000Z", createdAt: "2024-01-01T00:00:00.000Z",
    },
  }],
};

const KLANTEN = {
  ok: true,
  rows: [{
    tenantId: "ten_klant_1", name: "Bouwwerken Vermeulen", plan: "business",
    status: "active", mrr: 249, unpriced: false, commissionPct: 20, commission: 49.8,
  }],
};

/**
 * Laad de module in een nep-DOM.
 * antwoorden: { "GET /api/..." : { status, body } } · ontbreekt een sleutel,
 * dan valt de route terug op een standaardantwoord.
 */
function laad(opties) {
  const cfg = opties || {};
  const antwoorden = cfg.antwoorden || {};
  const calls = [];
  const toasts = [];
  const container = maakElement("rspMain");
  container.querySelectorAll = sel => zoekAlles(container, sel);

  // Ids bestaan pas als ze in de gerenderde HTML staan · en verdwijnen bij een
  // re-render, net als in de browser.
  const dynamisch = new Map();
  let laatsteHtml = "";
  const document = {
    getElementById(id) {
      if (id === "rspMain") return cfg.metMain ? container : null;
      if (container.innerHTML !== laatsteHtml) { dynamisch.clear(); laatsteHtml = container.innerHTML; }
      if (dynamisch.has(id)) return dynamisch.get(id);
      if (!container.innerHTML.includes(`id="${id}"`)) return null;
      const el = maakElement(id);
      dynamisch.set(id, el);
      return el;
    },
    querySelector() { return cfg.nav || null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };

  function standaard(sleutel) {
    if (sleutel.startsWith("GET /api/reseller/assigned-tenants")) return { status: 200, body: TOEGEWEZEN };
    if (sleutel.startsWith("GET /api/reseller/clients")) return { status: 200, body: KLANTEN };
    if (sleutel.startsWith("GET /api/reseller/delegated-access")) return { status: 200, body: { ok: true, grants: cfg.grants || [] } };
    if (sleutel.startsWith("POST /api/reseller/delegated-access")) return { status: 201, body: { ok: true, grant: GRANT_AANGEVRAAGD } };
    return { status: 200, body: { ok: true } };
  }

  const fetch = async (pad, opts) => {
    const method = (opts && opts.method) || "GET";
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method, pad, body, headers: (opts && opts.headers) || {} });
    const exact = `${method} ${pad}`;
    const gevonden = antwoorden[exact]
      || antwoorden[`${method} ${pad.split("?")[0]}`]
      || standaard(exact);
    return {
      status: gevonden.status,
      ok: gevonden.status >= 200 && gevonden.status < 300,
      json: async () => gevonden.body,
    };
  };

  const window = {
    wfpCore: {
      token: () => "test-token",
      esc: v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    },
    showToast: (tekst, soort) => toasts.push({ tekst, soort }),
    localStorage: { removeItem() {} },
    wfpResellerViews: cfg.registry,
    wfp_resellerInit: cfg.init,
  };

  vm.runInNewContext(src, {
    window, document, fetch, localStorage: window.localStorage,
    setTimeout, clearTimeout, console, Intl, Date, JSON,
  });

  return { window, document, container, calls, toasts,
    pagina: window.wfpResellerViews[ "delegated-access" ] };
}

const settle = () => new Promise(r => setTimeout(r, 10));

// ── 1· de grens ─────────────────────────────────────────────────────────────

test("TOEGANG 1· de module registreert zichzelf in de resellerregistry", () => {
  const { window, pagina } = laad();
  assert.equal(typeof pagina, "object", "de pagina staat niet in window.wfpResellerViews");
  assert.equal(typeof pagina.render, "function");
  assert.equal(typeof pagina.open, "function");
  assert.deepEqual(Object.keys(window.wfpResellerViews), ["delegated-access"]);
});

test("TOEGANG 2· een bestaande registry wordt gelezen, niet overschreven", () => {
  const bestaand = { "iets-anders": { render() {} } };
  const { window } = laad({ registry: bestaand });
  assert.ok(window.wfpResellerViews["iets-anders"], "de module gooide een bestaande registratie weg");
  assert.ok(window.wfpResellerViews["delegated-access"]);
  assert.equal(window.wfpResellerViews, bestaand, "de registry is vervangen in plaats van aangevuld");
});

test("TOEGANG 3· de module definieert window.wfpAdmin niet en leunt niet op de admin-monoliet", () => {
  assert.equal(/window\.wfpAdmin/.test(src), false,
    "dit is het resellerportaal · de admin-context hoort hier niet");
  assert.match(code, /window\.wfpResellerViews\s*=\s*window\.wfpResellerViews\s*\|\|/,
    "de registry hoort idempotent aangemaakt te worden");
});

test("TOEGANG 4· de state van reseller.js blijft van reseller.js", () => {
  // De module heeft een eigen state-object in haar eigen closure. Wat ze NIET
  // mag doen is de shell of de state van reseller.js vervangen.
  assert.equal(/window\.wfpResellerState\s*=/.test(code), false);
  assert.equal(/state\s*=\s*window\./.test(code), false);
  // wfp_resellerInit wordt gewikkeld, nooit vervangen: het origineel blijft leidend.
  let origineelAangeroepen = 0;
  const { window } = laad({ init: function () { origineelAangeroepen += 1; return "shell"; } });
  const uit = window.wfp_resellerInit();
  assert.equal(origineelAangeroepen, 1, "de oorspronkelijke portaal-init wordt niet meer aangeroepen");
  assert.equal(uit, "shell", "de teruggave van de oorspronkelijke init gaat verloren");
});

test("TOEGANG 5· zonder portaalshell klapt er niets", () => {
  // haakAan() draait bij het laden. Is de shell er niet, dan hoort dat stil te
  // mislukken · niet het hele portaal mee te nemen.
  const { pagina } = laad();
  assert.ok(pagina, "de module overleefde het laden zonder shell niet");
});

// ── 2· de scope · nooit een organisatie-id uit de UI ─────────────────────────

test("TOEGANG 6· de broncode kent geen organisatie-id om mee te sturen", () => {
  assert.equal(/resellerId/.test(code), false,
    "resellerId komt in de code voor · de server leidt de organisatie af uit de sessie, de UI stuurt er nooit een mee");
});

test("TOEGANG 7· geen enkele call draagt een organisatie-id, in de URL noch in de body", async () => {
  const { pagina, container, document, calls } = laad({ grants: [GRANT_AANGEVRAAGD] });
  await pagina.render(container);
  await settle();

  // Volledige flow: ook aanvragen en intrekken moeten schoon blijven.
  container.querySelectorAll(".rsd-scope").forEach(vak => { if (vak.dataset.id === "ticket_view") vak.checked = true; });
  document.getElementById("rsdReason").value = "Support";
  document.getElementById("rsdEnd").value = "2099-01-01";
  await document.getElementById("rsdForm").handlers.submit({ preventDefault() {} });
  await settle();
  container.querySelectorAll(".rsd-revoke")[0].handlers.click();
  await settle();
  document.getElementById("rsdRevokeReason").value = "Klaar";
  document.getElementById("rsdRevokeConfirm").handlers.click();
  await settle();

  assert.ok(calls.length >= 5, "de flow is niet doorlopen");
  for (const call of calls) {
    assert.equal(/resellerId/i.test(call.pad), false, `organisatie-id in de URL: ${call.pad}`);
    assert.equal(/resellerId/i.test(JSON.stringify(call.body || {})), false,
      `organisatie-id in de body van ${call.method} ${call.pad}`);
  }
  // De klant-id hoort er WEL in te staan · anders weigert de server met 400.
  const grantCall = calls.find(c => c.pad.startsWith("/api/reseller/delegated-access"));
  assert.match(grantCall.pad, /tenantId=ten_klant_1/);
});

test("TOEGANG 8· een aanvraag stuurt alleen klant, scope, reden en venster", async () => {
  const { pagina, container, calls, document } = laad({ grants: [] });
  await pagina.render(container);
  await settle();

  container.querySelectorAll(".rsd-scope").forEach(vak => {
    if (vak.dataset.id === "ticket_view") vak.checked = true;
  });
  document.getElementById("rsdReason").value = "Onboarding afronden";
  document.getElementById("rsdEnd").value = "2099-01-01";
  await document.getElementById("rsdForm").handlers.submit({ preventDefault() {} });
  await settle();

  const post = calls.find(c => c.method === "POST");
  assert.ok(post, "de aanvraag is nooit verstuurd");
  assert.deepEqual(Object.keys(post.body).sort(), ["endAt", "reason", "scope", "startAt", "tenantId"]);
  assert.deepEqual(post.body.scope, ["ticket_view"]);
  assert.equal(post.body.tenantId, "ten_klant_1");
});

// ── 3· de weigering · generiek, zonder identifier ────────────────────────────

const LEKKEND_ANTWOORD = {
  ok: false,
  error: "Toegangsrecord rag_11aa22bb33cc44dd bestaat niet voor reseller res_deadbeefcafe01",
  code: "RESELLER_FORBIDDEN",
};

test("TOEGANG 9· een 403 toont een generieke melding zonder identifier", async () => {
  const { pagina, container } = laad({
    antwoorden: { "GET /api/reseller/assigned-tenants": { status: 403, body: LEKKEND_ANTWOORD } },
  });
  await pagina.render(container);
  await settle();

  const html = container.innerHTML;
  assert.ok(html.includes("geen toegang"), "er staat geen leesbare weigering op het scherm");
  for (const lek of ["rag_11aa22bb33cc44dd", "res_deadbeefcafe01", "bestaat niet", "RESELLER_FORBIDDEN", "403"]) {
    assert.equal(html.includes(lek), false, `de weigering lekt "${lek}" naar het scherm`);
  }
  assert.equal(/\b[a-z]{2,6}_[0-9a-f]{8,}\b/.test(html), false, "er staat een record-id in de weigering");
});

test("TOEGANG 10· een 404 op een grant leest exact hetzelfde als een 403", async () => {
  // De server antwoordt met 404 op records van een andere organisatie juist om
  // ids onvindbaar te maken. Een UI die daar "niet gevonden" van maakt, geeft
  // het verschil alsnog weg.
  const weigering = laad({
    antwoorden: { "GET /api/reseller/assigned-tenants": { status: 403, body: LEKKEND_ANTWOORD } },
  });
  const nietGevonden = laad({
    antwoorden: { "GET /api/reseller/assigned-tenants": { status: 404, body: { ok: false, error: "delegated_access niet gevonden", code: "NOT_FOUND" } } },
  });
  await weigering.pagina.render(weigering.container);
  await nietGevonden.pagina.render(nietGevonden.container);
  await settle();
  assert.equal(nietGevonden.container.innerHTML, weigering.container.innerHTML,
    "403 en 404 zien er verschillend uit · dat verschil is de oracle");
});

test("TOEGANG 11· een geweigerde aanvraag laat de knop verdwijnen en zegt niets specifieks", async () => {
  const { pagina, container, document } = laad({
    grants: [],
    antwoorden: { "POST /api/reseller/delegated-access": { status: 403, body: LEKKEND_ANTWOORD } },
  });
  await pagina.render(container);
  await settle();
  assert.ok(container.innerHTML.includes('id="rsdForm"'), "het aanvraagformulier ontbreekt vooraf");

  container.querySelectorAll(".rsd-scope").forEach(vak => { if (vak.dataset.id === "ticket_view") vak.checked = true; });
  document.getElementById("rsdReason").value = "Toegang nodig";
  document.getElementById("rsdEnd").value = "2099-01-01";
  await document.getElementById("rsdForm").handlers.submit({ preventDefault() {} });
  await settle();

  const html = container.innerHTML;
  assert.equal(html.includes('id="rsdForm"'), false,
    "de server weigerde de actie maar de UI biedt ze opnieuw aan");
  assert.equal(html.includes("rag_11aa22bb33cc44dd"), false);
  assert.equal(html.includes("bestaat niet"), false);
});

test("TOEGANG 12· een geweigerde intrekking meldt generiek, zonder id", async () => {
  const { pagina, container, document, toasts } = laad({
    grants: [GRANT_AANGEVRAAGD],
    antwoorden: { "POST /api/reseller/delegated-access/rag_99zz88yy77xx66ww/revoke": { status: 404, body: { ok: false, error: "delegated_access rag_99zz88yy77xx66ww niet gevonden" } } },
  });
  await pagina.render(container);
  await settle();

  container.querySelectorAll(".rsd-revoke")[0].handlers.click();
  await settle();
  document.getElementById("rsdRevokeReason").value = "Niet meer nodig";
  document.getElementById("rsdRevokeConfirm").handlers.click();
  await settle();

  const melding = toasts.map(t => t.tekst).join(" ");
  assert.ok(melding.length > 0, "er is helemaal geen melding");
  assert.equal(/rag_99zz88yy77xx66ww/.test(melding), false, "de melding lekt het record-id");
  assert.equal(/niet gevonden/i.test(melding), false, "de melding verklapt dat het record niet bestaat");
});

test("TOEGANG 12b· MFA_REQUIRED mag wél uitgelegd worden · dat gaat over de gebruiker", async () => {
  // De server werpt deze 403 vóór elke record-lookup, dus hij verraadt niets
  // over het bestaan van een record. Zonder uitleg blijft de gebruiker steken.
  const { pagina, container, document, toasts } = laad({
    grants: [GRANT_AANGEVRAAGD],
    antwoorden: { "POST /api/reseller/delegated-access/rag_99zz88yy77xx66ww/revoke": { status: 403, body: { ok: false, error: "Sterke authenticatie (MFA) is vereist voor deze actie", code: "MFA_REQUIRED" } } },
  });
  await pagina.render(container);
  await settle();
  container.querySelectorAll(".rsd-revoke")[0].handlers.click();
  await settle();
  document.getElementById("rsdRevokeReason").value = "Klaar";
  document.getElementById("rsdRevokeConfirm").handlers.click();
  await settle();

  const melding = toasts.map(t => t.tekst).join(" ");
  assert.match(melding, /MFA/, "de gebruiker hoort te weten dat MFA de blokkade is");
  assert.equal(/rag_99zz88yy77xx66ww/.test(melding), false, "de melding lekt het record-id");
});

// ── 4· klantinhoud vereist een ACTIEVE toestemming ───────────────────────────

test("TOEGANG 13· zonder actieve toestemming blijft het bij commerciële metadata", async () => {
  const { pagina, container } = laad({ grants: [GRANT_AANGEVRAAGD] });
  await pagina.render(container);
  await settle();
  const html = container.innerHTML;
  assert.ok(html.includes("Bouwwerken Vermeulen"), "de klantnaam ontbreekt");
  assert.ok(html.includes("Geen actieve toegang"), "de pagina verzwijgt dat er geen toegang is");
  assert.equal(html.includes("Toegang actief"), false, "een aanvraag leest als actieve toegang");
});

test("TOEGANG 14· een actieve toestemming wordt als actief getoond, met einddatum", async () => {
  const { pagina, container } = laad({ grants: [GRANT_ACTIEF] });
  await pagina.render(container);
  await settle();
  const html = container.innerHTML;
  assert.ok(html.includes("Toegang actief"), "een actieve toestemming wordt niet herkend");
  assert.ok(html.includes("Supportvragen inzien"), "de bevoegdheden staan er niet bij");
});

test("TOEGANG 15· een verlopen venster telt niet als actief", async () => {
  const verlopen = { ...GRANT_ACTIEF, endAt: "2020-06-01T00:00:00.000Z" };
  const { pagina, container } = laad({ grants: [verlopen] });
  await pagina.render(container);
  await settle();
  assert.equal(container.innerHTML.includes("Toegang actief"), false,
    "status 'active' met een verstreken einddatum leest nog als toegang");
});

test("TOEGANG 16· de pagina verzint geen goedkeurknop", () => {
  // Goedkeuren is een handeling van de tenantbeheerder (vier-ogen · de
  // aanvrager keurt nooit zijn eigen aanvraag goed). Staat die knop hier, dan
  // belooft het portaal iets wat de server hoe dan ook weigert.
  assert.equal(/\/approve|\/activate/.test(code), false,
    "de pagina roept een goedkeur- of activeerroute aan die de server voor een reseller altijd weigert");
  assert.equal(/rsd-approve|rsdApprove|rsdActivate/.test(code), false,
    "er staat een goedkeur- of activeerknop in het resellerportaal");
});

test("TOEGANG 17· bedragen staan er read-only bij", async () => {
  const { pagina, container } = laad({ grants: [] });
  await pagina.render(container);
  await settle();
  const html = container.innerHTML;
  assert.ok(/MRR/.test(html), "de commerciële cijfers ontbreken");
  // Geen invoerveld of knop rond het bedrag · tonen is niet wijzigen.
  assert.equal(/name="mrr"|id="rsdMrr"|data-id="mrr"/.test(html), false,
    "MRR is bewerkbaar gemaakt in een portaal dat alleen mag tonen");
});

// ── 5· netwerkpatroon ────────────────────────────────────────────────────────

test("TOEGANG 18· elke call gaat met het sessietoken en naar de eigen portaalroutes", async () => {
  const { pagina, container, calls } = laad({ grants: [] });
  await pagina.render(container);
  await settle();
  for (const call of calls) {
    assert.match(call.pad, /^\/api\/reseller\//, `${call.pad} valt buiten het resellerportaal`);
    assert.equal(call.headers.Authorization, "Bearer test-token");
  }
});
