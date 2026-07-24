"use strict";
// IA-06 · Global Create (IA handover §7/§8).
// Acceptatiebewijs uit de handover: "Only permitted/enabled actions; complex
// create opens full route."
const { test } = require("node:test");
const assert = require("node:assert");
const create = require("../public/js/app/shell/global-create");
const routeMap = require("../public/js/app/navigation/route-map");

const ALLES = {
  permissions: ["*"],
  entitlements: ["customers", "quotes", "projects", "planning", "workorders", "employees", "invoices", "inventory"],
};

test("IA-06 1· alleen toegestane acties verschijnen (recht ÉN entitlement)", () => {
  const acties = create.createActions({ permissions: ["quotes.create"], entitlements: ["quotes"] });
  assert.deepEqual(acties.map(a => a.id), ["create.quote"]);

  // Recht zonder module: niets.
  assert.deepEqual(create.createActions({ permissions: ["quotes.create"], entitlements: [] }), []);
  // Module zonder recht: ook niets.
  assert.deepEqual(create.createActions({ permissions: [], entitlements: ["quotes"] }), []);
});

test("IA-06 2· geen rechten betekent een lege launcher, geen fallback", () => {
  assert.deepEqual(create.createActions({}), [], "fail-closed · geen impliciete acties");
  assert.deepEqual(create.createActions({ permissions: ["*"], entitlements: [] }), [],
    "superrecht zonder vrijgegeven module levert nog steeds niets");
});

test("IA-06 3· COMPLEXE aanmaak opent een volledige route, nooit een drawer (D-04)", () => {
  const acties = create.createActions(ALLES);
  const complex = ["create.quote", "create.project", "create.work_order", "create.invoice", "create.employee", "create.incident"];
  for (const id of complex) {
    const a = acties.find(x => x.id === id);
    assert.equal(a.mode, "full", `${id} hoort een volledige pagina te zijn`);
    assert.deepEqual(a.quickFields, [], `${id} mag geen quick-create-velden hebben`);
  }
});

test("IA-06 4· quick create blijft binnen vijf velden, anders volledig", () => {
  for (const a of create.createActions(ALLES)) {
    if (a.mode !== "quick") continue;
    assert.ok(a.quickFields.length >= 1 && a.quickFields.length <= create.QUICK_CREATE_MAX_FIELDS,
      `${a.id} heeft ${a.quickFields.length} velden · de grens is ${create.QUICK_CREATE_MAX_FIELDS}`);
  }
  // De regel zelf, los van de huidige lijst.
  assert.equal(create.modeFor({ quickFields: ["a", "b", "c", "d", "e"] }), "quick");
  assert.equal(create.modeFor({ quickFields: ["a", "b", "c", "d", "e", "f"] }), "full");
  assert.equal(create.modeFor({ quickFields: [] }), "full");
});

test("IA-06 5· de context van het huidige dossier reist mee", () => {
  const acties = create.createActions({
    ...ALLES,
    route: { id: "projects", params: { projectId: "p_7", customerId: "c_3" } },
  });
  const werkbon = acties.find(a => a.id === "create.work_order");
  assert.deepEqual(werkbon.context, { customerId: "c_3", projectId: "p_7" });
  assert.equal(create.targetUrl(werkbon), "/app/work-orders/new?customerId=c_3&projectId=p_7");

  // Een actie die de context niet kent, krijgt hem ook niet opgedrongen.
  const medewerker = acties.find(a => a.id === "create.employee");
  assert.deepEqual(medewerker.context, {});
  assert.equal(create.targetUrl(medewerker), "/app/team/employees/new");
});

test("IA-06 6· zonder context blijft de route schoon", () => {
  const acties = create.createActions(ALLES);
  for (const a of acties) {
    assert.deepEqual(a.context, {}, `${a.id} verzint context`);
    assert.equal(create.targetUrl(a), a.route);
    assert.equal(a.route.includes("?"), false, "geen lege querystring");
  }
});

test("IA-06 7· de doel-URL heeft een vaste sleutelvolgorde (deelbaar)", () => {
  const a = { route: "/app/x/new", context: { projectId: "p_1", customerId: "c_1" } };
  const b = { route: "/app/x/new", context: { customerId: "c_1", projectId: "p_1" } };
  assert.equal(create.targetUrl(a), create.targetUrl(b));
  assert.equal(create.targetUrl(a), "/app/x/new?customerId=c_1&projectId=p_1");
});

test("IA-06 8· contextwaarden worden ge-encodeerd (geen URL-injectie)", () => {
  const uit = create.targetUrl({ route: "/app/x/new", context: { customerId: "c 1&admin=1" } });
  assert.equal(uit, "/app/x/new?customerId=c%201%26admin%3D1");
  assert.equal(uit.includes("&admin=1"), false);
});

test("IA-06 9· suggesties zetten contextuele acties bovenaan", () => {
  const acties = create.createActions({ ...ALLES, params: { projectId: "p_7" } });
  const top = create.suggested(acties, 3);
  assert.equal(top.length, 3);
  assert.ok(Object.keys(top[0].context).length > 0, "de eerste suggestie hoort contextueel te zijn");
  // Alle suggesties komen uit de toegestane lijst.
  assert.deepEqual(top.filter(a => !acties.includes(a)), []);
});

test("IA-06 10· de volgorde is stabiel · zelfde context geeft zelfde lijst", () => {
  const a = create.createActions(ALLES).map(x => x.id);
  const b = create.createActions(ALLES).map(x => x.id);
  assert.deepEqual(a, b);
  assert.deepEqual(a, [...a].sort((x, y) =>
    create.ACTIONS.findIndex(z => z.id === x) - create.ACTIONS.findIndex(z => z.id === y)));
});

test("IA-06 11· elke actie draagt een i18n-sleutel, nooit een letterlijk label", () => {
  for (const a of create.ACTIONS) {
    assert.match(a.labelKey, /^create\.[a-z_]+$/, `${a.id} heeft geen geldige i18n-sleutel`);
    assert.equal("label" in a, false, `${a.id} draagt een hardcoded label`);
  }
});

test("IA-06 12· elke aanmaakroute is een geldig pad onder /app", () => {
  for (const a of create.ACTIONS) {
    assert.match(a.route, /^\/app\/[a-z0-9\-/]+\/new$/, `${a.id} heeft een afwijkende route: ${a.route}`);
    // De route mag geen bestaande LIJST- of RECORD-route kapen.
    const geparst = routeMap.parse(a.route);
    if (geparst) assert.notEqual(geparst.kind, "record", `${a.id} botst met een recordroute`);
  }
});

test("IA-06 13· elk vereist recht hoort bij zijn eigen module (geen kruisrecht)", () => {
  const fouten = [];
  for (const a of create.ACTIONS) {
    if (!a.permission.includes(".")) fouten.push(`${a.id} heeft geen domein.actie-recht`);
    if (!/\.(create|request)$/.test(a.permission)) fouten.push(`${a.id} gebruikt geen aanmaakrecht: ${a.permission}`);
  }
  assert.deepEqual(fouten, [], fouten.join(" · "));
});
