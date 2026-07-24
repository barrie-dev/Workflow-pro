"use strict";
// CTO3-10 increment 5 · Monargo-zijde van het kanaaldomein uit server.js.
//
// 46 routes waarvan een deel geld verplaatst (payouts, commissiestaten) en een
// deel een IBAN toont. Bij een verplaatsing is de vraag niet of het nog werkt
// maar of er een grens is weggevallen · deze tests toetsen die grenzen.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const MOD = path.join(__dirname, "..", "src", "http", "routes", "admin-reseller.js");
const SERVER = path.join(__dirname, "..", "src", "server.js");
const routes = require("../src/http/routes/admin-reseller")();
const src = fs.readFileSync(MOD, "utf8");
const bodies = src.split("    async handler(req, res, { url, params, ctx }) {").slice(1);

test("AR 1· alle 47 routes zijn mee verhuisd", () => {
  assert.equal(routes.length, 47);
  assert.equal(bodies.length, 47);
  assert.equal(routes.filter(r => r.path instanceof RegExp).length, 26);
});

test("AR 2· ELKE route eist de platformscope 'resellers'", () => {
  for (const [i, b] of bodies.entries()) {
    assert.ok(b.includes('assertPlatformScope(user, "resellers")'),
      `route ${i} laat nu een gewone tenantgebruiker toe`);
  }
});

test("AR 3· ELKE route authenticeert en geeft 401 zonder sessie", () => {
  for (const b of bodies) {
    assert.ok(b.includes("const user = actor(req);"));
    assert.ok(b.includes('sendJson(res, 401, { ok: false, error: "Unauthorized" })'));
  }
});

// Eén route kiest GEEN kanaalrol en leunt alleen op de platformscope. Dat is
// bestaand gedrag uit server.js en is hier bewust NIET veranderd: een
// extractie hoort de autorisatie niet stilletjes te verscherpen, want dan weet
// niemand meer welke wijziging welk effect had. De uitzondering staat hier bij
// naam zodat ze zichtbaar blijft en niet groeit.
//
// OPEN PUNT voor de eigenaar: /api/admin/reseller-payouts toont commissie per
// partner en exporteert dat naar CSV. Dat is financiële informatie, dus de
// vraag is of een monargo_partner_manager dit hoort te kunnen. Zo niet, dan is
// het een aparte, bewuste wijziging met een eigen test.
const ZONDER_KANAALROL = ["/api/admin/reseller-payouts"];

test("AR 4· de kanaalrol wordt expliciet gekozen · geen impliciete bevoegdheid", () => {
  // monargoChannelActor(user, fallbackrol) bepaalt of iemand als partnerbeheer
  // of als partnerfinance handelt. Zonder die keuze zou de bevoegdheid van de
  // sessie leidend zijn, en dat is precies de scheiding uit 23.5.
  const zonder = src.split("\n  {").slice(1)
    .filter(b => !/monargoChannelActor\(user, "monargo_partner_(manager|finance)"\)/.test(b))
    .map(b => ((b.match(/path: "([^"]+)"/) || [])[1]) || "(regex-route)");
  assert.deepEqual(zonder.sort(), ZONDER_KANAALROL.slice().sort(),
    "een route kiest geen kanaalrol · dan is de bevoegdheid van de sessie leidend");
});

test("AR 5· GELD raakt alleen partner-FINANCE, nooit partnerbeheer", () => {
  // 23.5 SENSITIVE_DENY: een partner manager mag geen payouts goedkeuren en
  // geen IBAN zien. Dat onderscheid zit in de gekozen fallbackrol.
  //
  // Toetsen op het PAD, niet op de bodytekst: een handler die toevallig het
  // woord "agreement" in een commentaar heeft staan is geen geldroute.
  const geldPad = /payout|commission-(statements|events|agreements|disputes)/;
  const geldRoutes = src.split("\n  {").slice(1)
    .map(b => ({ pad: (b.match(/path: ([^\n]+)/) || [])[1] || "", body: b }))
    .filter(x => geldPad.test(x.pad))
    .filter(x => !ZONDER_KANAALROL.some(p => x.pad.includes(p)));
  assert.ok(geldRoutes.length >= 12, `verwacht de finance-familie, kreeg ${geldRoutes.length}`);
  for (const x of geldRoutes) {
    assert.ok(x.body.includes('monargoChannelActor(user, "monargo_partner_finance")'),
      `${x.pad} draait onder partnerbeheer in plaats van partnerfinance`);
  }
});

test("AR 6· de IBAN-route staat achter payout.manage én is apart", () => {
  const iban = src.slice(src.indexOf("reseller-payout-details"));
  assert.ok(iban.includes('canResellerAction(cu, "reseller.payout.manage", {})'),
    "payoutgegevens zonder het beheerrecht");
  assert.ok(iban.includes('monargoChannelActor(user, "monargo_partner_finance")'));
  assert.ok(iban.includes('action: "payout_details_viewed"'),
    "IBAN inzien MOET een auditregel achterlaten");
});

test("AR 7· payout GOEDKEUREN vraagt een ander recht dan payout WIJZIGEN", () => {
  // Vier-ogen: wie een IBAN-wijziging aanvraagt keurt hem niet goed.
  const approve = src.slice(src.indexOf("reseller-payout-changes\\/([^/]+)\\/approve"));
  assert.ok(approve.includes('canResellerAction(cu, "reseller.payout.approve", {})'));
  const manage = src.slice(src.indexOf('path: "/api/admin/reseller-payout-changes",\n    method: ["POST"]'));
  assert.ok(manage.includes('canResellerAction(cu, "reseller.payout.manage", {})'));
});

test("AR 8· elke MUTATIE is idempotent afgeschermd", () => {
  // Uitzondering, expliciet en beperkt: de /expire-routes zijn opruimacties
  // die per definitie hetzelfde resultaat geven bij herhaling · een al
  // verlopen record nog eens laten verlopen verandert niets. Ze staan hier
  // bij naam zodat een NIEUWE POST niet stilletjes in dezelfde uitzondering
  // kan glippen.
  const OPRUIMACTIES = ["/api/admin/reseller-deals/expire", "/api/admin/reseller-delegated-access/expire"];
  const zonder = [];
  for (const b of src.split("\n  {").slice(1)) {
    if (!/method: \["POST"\]/.test(b)) continue;
    if (b.includes("armResellerIdempotency(req, res, url, user)")) continue;
    zonder.push(((b.match(/path: "([^"]+)"/) || [])[1]) || "(regex-route)");
  }
  assert.deepEqual(zonder.sort(), OPRUIMACTIES.slice().sort(),
    "een POST zonder idempotentie kan geld dubbel boeken bij een netwerkhapering");
});

test("AR 9· server.js draagt geen /api/admin/reseller-routes meer", () => {
  const server = fs.readFileSync(SERVER, "utf8");
  const rest = [...server.matchAll(/url\.pathname === "(\/api\/admin\/reseller-[^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(rest, [], `nog in server.js: ${rest.join(", ")}`);
});

test("AR 10· de router grijpt NIET meer rechtstreeks in de opslag", () => {
  // Dit was een echte vondst van de extractie: vijf lijst-endpoints lazen
  // store.data rechtstreeks. Die kennis hoort in de service, anders staat de
  // vorm van de data op twee plekken en loopt er ooit één achter.
  assert.equal(/store\.data/.test(src), false, "een router leest de opslag rechtstreeks");
  for (const fn of ["listTenantLinks", "listDelegatedAccess", "listRequests",
    "listExceptions", "listAgreements", "listStatements", "listDisputes", "listPayoutChanges"]) {
    assert.ok(src.includes(fn + "(store"), `${fn} wordt niet gebruikt · is de vervanger wel aangesloten?`);
  }
});

test("AR 11· de nieuwe lijstfuncties geven ZONDER filter alles terug", () => {
  // De valkuil bij deze vervanging: exceptionsOf(store, null) filtert op
  // resellerId === null en geeft dus NIETS terug in plaats van alles.
  const licensing = require("../src/modules/reseller-licensing");
  const tenants = require("../src/modules/reseller-tenants");
  const commissie = require("../src/modules/reseller-commission-agreement");
  const store = { data: {
    resellerPriceExceptions: [{ id: "e1", resellerId: "r1" }, { id: "e2", resellerId: "r2" }],
    resellerTenantLinks: [{ id: "l1", resellerId: "r1" }, { id: "l2", resellerId: "r2" }],
    resellerLicenseRequests: [{ id: "q1", resellerId: "r1" }],
    resellerCommissionAgreements: [{ id: "a1", resellerId: "r1" }, { id: "a2", resellerId: "r2" }],
    resellerCommissionStatements: [{ id: "s1", resellerId: "r1" }],
    resellerCommissionDisputes: [{ id: "d1", resellerId: "r1" }],
    resellerPayoutChanges: [{ id: "p1", resellerId: "r1" }],
    resellerAccessGrants: [{ id: "g1", resellerId: "r1", tenantId: "t1" }],
  } };
  assert.equal(licensing.listExceptions(store, {}).length, 2, "zonder filter hoort ALLES terug te komen");
  assert.equal(licensing.listExceptions(store, { resellerId: "r1" }).length, 1);
  assert.equal(tenants.listTenantLinks(store, {}).length, 2);
  assert.equal(tenants.listTenantLinks(store, { resellerId: "r2" }).length, 1);
  assert.equal(tenants.listDelegatedAccess(store, { tenantId: "t1" }).length, 1);
  assert.equal(licensing.listRequests(store, {}).length, 1);
  assert.equal(commissie.listAgreements(store, {}).length, 2);
  assert.equal(commissie.listStatements(store, {}).length, 1);
  assert.equal(commissie.listDisputes(store, {}).length, 1);
  assert.equal(commissie.listPayoutChanges(store, { resellerId: "r2" }).length, 0);
});

test("AR 12· de foutafhandeling loopt via de gedeelde vertaler", () => {
  const catches = [...src.matchAll(/catch \(e\) \{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(catches.length >= 25);
  const eigen = catches.filter(c => !c.includes("sendResellerError(res, e)"));
  assert.deepEqual(eigen, [], "een eigen foutafhandeling lekt makkelijk een interne melding");
});
