"use strict";
// CTO3-10 increment 4 · resellerportaal-routes uit server.js.
//
// Bij een extractie is de vraag niet "werkt het nog" maar "is er onderweg een
// autorisatiecheck weggevallen". Deze tests toetsen dat structureel: elke
// route MOET nog steeds actor, assertReseller, de organisatieregel en de
// rechtencheck doen, en die volgorde MOET kloppen.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const MOD = path.join(__dirname, "..", "src", "http", "routes", "reseller-portal.js");
const SERVER = path.join(__dirname, "..", "src", "server.js");
const routes = require("../src/http/routes/reseller-portal")();

test("RP 1· alle 23 portaalroutes zijn mee verhuisd", () => {
  assert.equal(routes.length, 23);
  const paden = routes.map(r => (typeof r.path === "string" ? r.path : r.path.source));
  for (const p of ["/api/reseller/clients", "/api/reseller/deals", "/api/reseller/tenant-requests",
    "/api/reseller/assigned-tenants", "/api/reseller/delegated-access", "/api/reseller/license-requests",
    "/api/reseller/price-exceptions", "/api/reseller/commission-agreements",
    "/api/reseller/commission-statements", "/api/reseller/commission-disputes",
    "/api/reseller/payout-changes"]) {
    assert.ok(paden.includes(p), `${p} ontbreekt in de routermodule`);
  }
  assert.equal(routes.filter(r => r.path instanceof RegExp).length, 5, "de vijf recordroutes met een id");
});

test("RP 2· server.js draagt geen /api/reseller-portaalroutes meer", () => {
  const src = fs.readFileSync(SERVER, "utf8");
  const achtergebleven = [...src.matchAll(/url\.pathname === "(\/api\/reseller\/[^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(achtergebleven, [], `nog in server.js: ${achtergebleven.join(", ")}`);
});

test("RP 3· ELKE route doet nog steeds authenticatie", () => {
  const src = fs.readFileSync(MOD, "utf8");
  const bodies = src.split("    async handler(req, res, { url, params, ctx }) {").slice(1);
  assert.equal(bodies.length, 23);
  for (const b of bodies) {
    assert.ok(b.includes("const user = actor(req);"), "een route logt niet meer in");
    assert.ok(b.includes('sendJson(res, 401, { ok: false, error: "Unauthorized" })'),
      "een route geeft geen 401 meer bij ontbrekende sessie");
  }
});

test("RP 4· ELKE route dwingt de resellerrol af", () => {
  const src = fs.readFileSync(MOD, "utf8");
  const bodies = src.split("    async handler(req, res, { url, params, ctx }) {").slice(1);
  for (const b of bodies) {
    assert.ok(b.includes("assertReseller(user);"), "een route accepteert nu een niet-reseller");
  }
});

test("RP 5· ELKE route controleert de EIGEN organisatie", () => {
  const src = fs.readFileSync(MOD, "utf8");
  const bodies = src.split("    async handler(req, res, { url, params, ctx }) {").slice(1);
  for (const b of bodies) {
    assert.ok(/store\.get\("resellers", user\.resellerId\)/.test(b),
      "een route haalt de reseller niet meer uit de EIGEN sessie · dat opent cross-reseller toegang");
  }
});

test("RP 6· de rechtencheck komt VOOR de service-aanroep", () => {
  // Volgorde is hier geen stijlkwestie. Een service-aanroep vóór de
  // rechtencheck kan al een bestaans-oracle zijn (bestaat dit id?) ook al
  // wordt het antwoord daarna geweigerd.
  const src = fs.readFileSync(MOD, "utf8");
  const bodies = src.split("    async handler(req, res, { url, params, ctx }) {").slice(1);
  let metCheck = 0;
  for (const b of bodies) {
    const check = b.indexOf("resellerPortalAllowed(");
    if (check < 0) continue;
    metCheck += 1;
    const svc = b.search(/reseller(Deals|Tenants|Licensing|Commission)Svc\./);
    if (svc >= 0) assert.ok(check < svc, "een service wordt aangeroepen vóór de rechtencheck");
  }
  assert.ok(metCheck >= 20, `verwacht een rechtencheck op vrijwel elke route, kreeg er ${metCheck}`);
});

test("RP 7· elke MUTATIE is idempotent afgeschermd", () => {
  const src = fs.readFileSync(MOD, "utf8");
  const blokken = src.split("  {").slice(1);
  for (const b of blokken) {
    if (!/method: \["POST"\]/.test(b)) continue;
    assert.ok(b.includes("armResellerIdempotency(req, res, url, user)"),
      "een POST zonder idempotentie kan bij een netwerkhapering dubbel boeken");
  }
});

test("RP 8· weigeren blijft een generieke 403 zonder ID-probing", () => {
  const src = fs.readFileSync(MOD, "utf8");
  assert.ok(src.includes("resellerForbidden(res)"), "de generieke weigering is verdwenen");
  // Geen enkele weigering mag het gevraagde id of de reden teruggeven.
  const lekken = [...src.matchAll(/sendJson\(res, 403, \{[^}]*\}/g)]
    .map(m => m[0])
    .filter(s => /\$\{|resellerId|dealId|grantId/.test(s));
  assert.deepEqual(lekken, [], `deze 403's dragen een identifier: ${lekken.join(" · ")}`);
});

test("RP 9· de foutafhandeling loopt via de gedeelde vertaler", () => {
  const src = fs.readFileSync(MOD, "utf8");
  const catches = [...src.matchAll(/catch \(e\) \{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(catches.length >= 10);
  for (const c of catches) {
    assert.ok(c.includes("sendResellerError(res, e)"),
      "een eigen foutafhandeling lekt makkelijk een interne melding naar buiten");
  }
});

test("RP 10· de routermodule bevat GEEN businesslogica", () => {
  // Laagindeling: router vertaalt HTTP naar een service-aanroep, meer niet.
  const src = fs.readFileSync(MOD, "utf8");
  assert.equal(/store\.(insert|update|remove)\(/.test(src), false,
    "een router hoort niet rechtstreeks te schrijven · dat gaat via een service");
});
