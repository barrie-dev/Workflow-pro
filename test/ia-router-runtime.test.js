"use strict";
// IA-runtime · Router en SPA-fallback.
// Hier houdt de contractlaag op abstract te zijn: dit is de laag die de
// gebruiker deelbare links, een werkende terugknop en veilige refresh geeft.
// De browserdelen (history, popstate) zijn niet te unit-testen zonder DOM;
// resolve() is daarom bewust puur en draagt de hele beslissing.
const { test } = require("node:test");
const assert = require("node:assert");
const router = require("../public/js/app/routing/router");
const routeMap = require("../public/js/app/navigation/route-map");
const registry = require("../public/js/app/navigation/registry");
const resolver = require("../public/js/app/navigation/resolver");
const { spaFile } = require("../src/http/spa");

const ALLES = resolver.flatten(resolver.resolve(registry.ENTRIES, {
  portal: "tenant-admin", permissions: ["*"], entitlements: registry.ALL_ENTITLEMENTS,
})).map(r => r.id);

const CTX = { tenantId: "t_1", allowedRouteIds: ALLES };

// ── SPA-fallback ─────────────────────────────────────────────────────────────

test("RT 1· REFRESH SAFETY: een deeplink onder /app krijgt index.html", () => {
  assert.equal(spaFile("/app/customers"), "index.html");
  assert.equal(spaFile("/app/customers/c_42/overview"), "index.html");
  assert.equal(spaFile("/app"), "index.html");
  assert.equal(spaFile("/"), "index.html");
});

test("RT 2· een BESTAND blijft een bestand · anders breekt de pagina stil", () => {
  // HTML serveren met de MIME-type van een script geeft een lege pagina en
  // een onnavolgbare consolefout.
  assert.equal(spaFile("/app/thing.js"), "app/thing.js");
  assert.equal(spaFile("/js/app/routing/router.js"), "js/app/routing/router.js");
  assert.equal(spaFile("/favicon.ico"), "favicon.ico");
});

test("RT 3· buiten /app verandert er niets", () => {
  assert.equal(spaFile("/privacy.html"), "privacy.html");
  assert.equal(spaFile("/bestaat-niet"), "bestaat-niet", "een echte 404 blijft een 404");
  assert.equal(spaFile("/application/x"), "application/x", "geen prefix-verwarring met /app");
});

// ── De routerbeslissing ──────────────────────────────────────────────────────

test("RT 4· een geldige route levert een scherm op", () => {
  const uit = router.resolve("/app/finance/invoices", "", CTX);
  assert.equal(uit.action, "render");
  assert.equal(uit.route.id, "finance.invoices");
  assert.equal(uit.view, "facturen", "de monoliet tekent nog · de router bepaalt WAT");
});

test("RT 5· filters uit de URL komen mee in de route", () => {
  const uit = router.resolve("/app/finance/invoices", "?status=open&q=acme", CTX);
  assert.equal(uit.action, "render");
  assert.deepEqual(uit.route.query, { status: "open", q: "acme" });
});

test("RT 6· een route zonder recht wordt geweigerd", () => {
  const uit = router.resolve("/app/finance/invoices", "", { tenantId: "t_1", allowedRouteIds: ["customers"] });
  assert.equal(uit.action, "deny");
  assert.equal(uit.code, "ROUTE_DENIED");
});

test("RT 7· een CROSS-TENANT deeplink weigert net zo hard", () => {
  const uit = router.resolve("/app/customers/c_9/overview", "", { ...CTX, routeTenantId: "t_2" });
  assert.equal(uit.action, "deny");
  assert.equal(uit.code, "ROUTE_DENIED", "byte-identiek aan 'geen recht' · geen existence leak");
});

test("RT 8· een onbekende URL is niet gevonden, geen lege render", () => {
  const uit = router.resolve("/app/bestaat-niet", "", CTX);
  assert.equal(uit.action, "notfound");
  assert.equal(uit.code, "ROUTE_NOT_FOUND");
});

test("RT 9· een oude data-view uit een bookmark wordt omgeleid", () => {
  const uit = router.resolve("/", "", { ...CTX, legacyView: "facturen" });
  assert.equal(uit.action, "redirect");
  assert.equal(uit.url, "/app/finance/invoices");
  assert.equal(uit.reason, "LEGACY_VIEW");
});

test("RT 10· een RECORD-deeplink opent de lijst én wijst het record aan", () => {
  // De recordwerkruimte bestaat nog niet, maar de bestaande drawer wel · dan
  // is de gebruiker beter af met zijn record open dan met een lijst waarin
  // hij het zelf mag terugzoeken.
  const uit = router.resolve("/app/customers/c_42/overview", "", CTX);
  assert.equal(uit.action, "render");
  assert.equal(uit.view, "customers");
  assert.deepEqual(uit.record, { drawer: "customer", id: "c_42", tab: null });
});

test("RT 10b· een lijstroute wijst geen record aan", () => {
  assert.equal(router.resolve("/app/customers", "", CTX).record, null);
});

test("RT 10c· elke drawer in de brug hoort bij een route die de brug kent", () => {
  const zonderView = Object.keys(router.DRAWER_BY_ROUTE).filter(id => !router.legacyViewFor(id));
  assert.deepEqual(zonderView, [], `drawers zonder scherm: ${zonderView.join(", ")}`);
});

// ── De strangler-brug ────────────────────────────────────────────────────────

test("RT 11· elke gebrugde route bestaat echt in de registry", () => {
  const geldig = new Set(ALLES);
  const kapot = Object.keys(router.LEGACY_VIEW_BY_ROUTE).filter(id => !geldig.has(id));
  assert.deepEqual(kapot, [], `deze brugregels wijzen naar onbekende routes: ${kapot.join(", ")}`);
});

test("RT 12· de brug werkt beide kanten op", () => {
  for (const [routeId, view] of Object.entries(router.LEGACY_VIEW_BY_ROUTE)) {
    assert.equal(router.legacyViewFor(routeId), view);
  }
  // Terug: een oude view vindt zijn route, met voorkeur voor het hoofddomein.
  assert.equal(router.routeIdForLegacyView("facturen"), "finance");
  assert.equal(router.routeIdForLegacyView("appointments"), "planning.unassigned",
    "een view die alleen als kind bestaat, vindt zijn kindroute");
  assert.equal(router.routeIdForLegacyView("verzonnen"), null);
});

test("RT 13· elk hoofddomein uit de registry heeft een scherm om naartoe te gaan", () => {
  const domeinen = registry.ENTRIES.filter(e => !e.parentId).map(e => e.id);
  const zonder = domeinen.filter(d => !router.legacyViewFor(d));
  assert.deepEqual(zonder, [],
    `deze domeinen staan in het menu maar hebben geen scherm: ${zonder.join(", ")}`);
});

test("RT 14· elke oude LEGACY_VIEW_MAP-bestemming is ook echt te renderen", () => {
  // Anders leidt een oude bookmark netjes om naar een route die vervolgens
  // 'geen renderer' zegt · dat is een omleiding naar een doodlopende weg.
  const kapot = Object.values(routeMap.LEGACY_VIEW_MAP).filter(id => !router.legacyViewFor(id));
  assert.deepEqual(kapot, [], `omleiding naar routes zonder scherm: ${kapot.join(", ")}`);
});

test("RT 15· de brug is compleet EN eerlijk · geen verzonnen views", () => {
  // Elke waarde in de brug moet een view zijn die admin.js kent. Dit leest
  // de echte VIEW_LABELS uit de monoliet, zodat een typefout meteen opvalt.
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "platforms", "admin.js"), "utf8");
  const blok = src.slice(src.indexOf("const VIEW_LABELS"), src.indexOf("const VIEW_BTN_LABEL"));
  const bekend = new Set([...blok.matchAll(/(?:^|[{,\s])"?([a-z_][a-z0-9_-]*)"?\s*:/gim)].map(m => m[1]));
  const onbekend = [...new Set(Object.values(router.LEGACY_VIEW_BY_ROUTE))].filter(v => !bekend.has(v));
  assert.deepEqual(onbekend, [], `deze views kent admin.js niet: ${onbekend.join(", ")}`);
});

test("RT 16· registry.ALL_ENTITLEMENTS dekt elke module in het menu", () => {
  const gebruikt = new Set(registry.ENTRIES
    .flatMap(e => [e.entitlement, ...(e.children || []).map(c => c.entitlement)])
    .filter(Boolean));
  assert.deepEqual(registry.ALL_ENTITLEMENTS.slice().sort(), [...gebruikt].sort());
  assert.ok(registry.ALL_ENTITLEMENTS.length > 0);
});
