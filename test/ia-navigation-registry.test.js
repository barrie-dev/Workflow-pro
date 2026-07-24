"use strict";
// IA-01 · Navigatieregistry + resolver (Information Architecture handover §5/§8).
// Acceptatiebewijs uit de handover: "Registry tests; no depth >2; fail-closed
// unknown rights." Plus de deterministische ordening en het verdwijnen van lege
// primaire groepen.
const { test } = require("node:test");
const assert = require("node:assert");
const registry = require("../public/js/app/navigation/registry");
const resolver = require("../public/js/app/navigation/resolver");

const ALL = registry.ENTRIES;
// Een ruime context: alles toegestaan. Losse tests knijpen dit af.
const ruim = (over = {}) => ({
  portal: "tenant-admin",
  permissions: ["*"],
  entitlements: ["customers", "quotes", "projects", "planning", "workorders", "employees", "invoices", "inventory", "reports", "automation", "construction", "progress_claims"],
  featureFlags: [],
  ...over,
});

test("IA-01 1· de registry voldoet aan het schema uit §5", () => {
  const fouten = registry.validate(ALL);
  assert.deepEqual(fouten, [], fouten.join(" · "));
});

test("IA-01 2· maximaal TWEE niveaus · een derde niveau wordt geweigerd (D-01)", () => {
  const teDiep = [{
    id: "x", portal: ["tenant-admin"], parentId: null, path: "/app/x", labelKey: "nav.x", order: 10,
    children: [{ id: "x.y", path: "/app/x/y", labelKey: "nav.x.y", order: 10,
      children: [{ id: "x.y.z", path: "/app/x/y/z", labelKey: "nav.x.y.z", order: 10 }] }],
  }];
  const fouten = registry.validate(teDiep);
  assert.ok(fouten.some(f => /derde menuniveau/.test(f)), fouten.join(" · "));
});

test("IA-01 3· onbekend recht faalt DICHT (verbergen, niet tonen)", () => {
  // De gebruiker heeft géén customers.view → het domein verdwijnt.
  const zonder = resolver.resolve(ALL, ruim({ permissions: ["projects.view"] }));
  assert.equal(zonder.some(d => d.id === "customers"), false, "zonder recht geen klantendomein");
  // Met het recht verschijnt het wél.
  const met = resolver.resolve(ALL, ruim({ permissions: ["customers.view"] }));
  assert.equal(met.some(d => d.id === "customers"), true);
});

test("IA-01 4· ontbrekend entitlement faalt DICHT", () => {
  const zonder = resolver.resolve(ALL, ruim({ entitlements: [] }));
  assert.deepEqual(zonder, [], "zonder entitlements is er geen enkel domein zichtbaar");
});

test("IA-01 5· een feature flag toont pas bij expliciete activering", () => {
  const metFlag = [{
    id: "beta", portal: ["tenant-admin"], parentId: null, path: "/app/beta",
    labelKey: "nav.beta", order: 10, featureFlag: "ia_beta",
  }];
  assert.equal(resolver.resolve(metFlag, ruim()).length, 0, "flag uit → verborgen");
  assert.equal(resolver.resolve(metFlag, ruim({ featureFlags: ["ia_beta"] })).length, 1, "flag aan → zichtbaar");
});

test("IA-01 6· zonder portaal geen menu (fail-closed)", () => {
  assert.deepEqual(resolver.resolve(ALL, ruim({ portal: null })), []);
});

test("IA-01 7· portaalfiltering: employee ziet alleen wat voor hem bedoeld is", () => {
  const emp = resolver.resolve(ALL, ruim({ portal: "employee" }));
  assert.deepEqual(emp.map(d => d.id), ["work-orders"], "werkbonnen is het enige gedeelde domein voor employee");
});

test("IA-01 8· de volgorde is deterministisch (order, dan id) ongeacht invoervolgorde", () => {
  const a = resolver.resolve(ALL, ruim()).map(d => d.id);
  const b = resolver.resolve(ALL.slice().reverse(), ruim()).map(d => d.id);
  assert.deepEqual(a, b, "omgekeerde invoer geeft dezelfde uitkomst");
  const orders = resolver.resolve(ALL, ruim()).map(d => d.order);
  assert.deepEqual(orders, orders.slice().sort((x, y) => x - y), "oplopend gesorteerd");
});

test("IA-01 9· lege primaire groepen verdwijnen na het filteren", () => {
  const groep = [{
    id: "leeg", portal: ["tenant-admin"], parentId: null, path: null,
    labelKey: "nav.leeg", order: 10,
    children: [{ id: "leeg.kind", path: "/app/leeg/kind", labelKey: "nav.leeg.kind", order: 10, permissions: ["nooit.dit.recht"] }],
  }];
  assert.deepEqual(resolver.resolve(groep, ruim({ permissions: ["iets.anders"] })), [],
    "een groep zonder eigen pad en zonder zichtbare kinderen verdwijnt");
});

test("IA-01 10· mobiel verbergt wat als hidden staat", () => {
  const desktop = resolver.resolve(ALL, ruim()).map(d => d.id);
  const mobiel = resolver.resolve(ALL, ruim({ mobile: true })).map(d => d.id);
  assert.ok(desktop.includes("insights"), "insights staat op desktop");
  assert.equal(mobiel.includes("insights"), false, "insights is mobilePriority hidden");
  assert.ok(mobiel.includes("work-orders"), "primaire domeinen blijven op mobiel");
});

test("IA-01 11· ids zijn de identifiers · labels worden nooit als sleutel gebruikt", () => {
  for (const d of ALL) {
    assert.match(d.labelKey, /^nav\./, `${d.id}: labelKey is een i18n-sleutel`);
    for (const ch of d.children || []) {
      assert.ok(ch.id.startsWith(d.id + "."), `${ch.id} hoort onder ${d.id}`);
      assert.match(ch.labelKey, /^nav\./);
    }
  }
});

test("IA-01 12· flatten + breadcrumb voeden sitemap, palette en kruimelpad", () => {
  const tree = resolver.resolve(ALL, ruim());
  const plat = resolver.flatten(tree);
  assert.ok(plat.length > tree.length, "de platte lijst bevat ook de kinderen");
  assert.ok(plat.every(r => r.path && r.id), "elke regel draagt een id en een pad");
  const kruimel = resolver.breadcrumb(tree, "finance.invoices");
  assert.deepEqual(kruimel.map(x => x.id), ["finance", "finance.invoices"], "maximaal twee niveaus diep");
  assert.deepEqual(resolver.breadcrumb(tree, "bestaat.niet"), []);
});

test("IA-01 13· Super Admin-only data lekt niet via het tenantmenu (D-08/D-09)", () => {
  // Mona-credits en Peppol-providertarieven horen NIET in een tenantportaal.
  const tenant = resolver.flatten(resolver.resolve(ALL, ruim()));
  const paden = tenant.map(r => r.path).join(" ");
  assert.equal(/credit|usage|provider-rate|mona\/usage/i.test(paden), false,
    "geen credit-/usage-/providertarief-route in het tenantmenu");
  // De operationele Peppol-levering mag er wél zijn (tenant Finance).
  assert.ok(tenant.some(r => r.id === "finance.peppol"), "operationele Peppol blijft tenantwerk");
});
