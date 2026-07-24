"use strict";
// IA-17 t/m IA-20 · Portaalmatrix (IA handover §7/§8).
// Acceptaties: manager = geen full-admin-duplicatie + team-scope negatief;
// employee = vijf stabiele tabs; reseller = geen tenant-creatie + delegatie
// vereist; super admin = Mona-verbruik en Peppol-eigenaarschap geïsoleerd.
const { test } = require("node:test");
const assert = require("node:assert");
const m = require("../public/js/app/portals/portal-matrix");
const resolver = require("../public/js/app/navigation/resolver");
const registry = require("../public/js/app/navigation/registry");
const shell = require("../public/js/app/shell/app-shell");

test("IA-17 1· een MANAGER is geen halve tenant-admin", () => {
  const admin = m.domainsFor("tenant-admin");
  const manager = m.domainsFor("manager");
  assert.ok(manager.length < admin.length, "een manager krijgt minder, niet hetzelfde met filters");
  assert.equal(manager.includes("automation"), false, "beheer van de organisatie hoort niet bij teamleiding");
  assert.equal(manager.includes("finance"), false, "boekhouding evenmin");
  assert.equal(manager.includes("resources"), false);
  // Wat hij wél doet is het werk van zijn team.
  for (const d of ["planning", "work-orders", "team", "projects"]) {
    assert.ok(manager.includes(d), `een manager hoort ${d} te zien`);
  }
});

test("IA-17 2· elk portaal draagt een expliciete scope", () => {
  assert.equal(m.scopeFor("tenant-admin"), "alle");
  assert.equal(m.scopeFor("manager"), "team");
  assert.equal(m.scopeFor("employee"), "eigen");
  assert.equal(m.scopeFor("reseller"), "partner");
  assert.equal(m.scopeFor("super-admin"), "platform");
  assert.equal(m.scopeFor("customer"), "gedeeld");
  assert.equal(m.scopeFor("verzonnen"), null, "een onbekend portaal heeft geen scope");
});

test("IA-17 3· fail-closed: een onbekend portaal of domein geeft niets", () => {
  assert.deepEqual(m.domainsFor("verzonnen"), []);
  assert.equal(m.portalAllows("verzonnen", "finance"), false);
  assert.equal(m.portalAllows("manager", "verzonnen"), false);
  assert.equal(m.portalAllows("manager", "finance"), false);
});

test("IA-18 4· het medewerkersportaal past in vijf stabiele tabs", () => {
  const uit = m.checkMobileTabs(m.domainsFor("employee"));
  assert.equal(uit.ok, true, "meer dan vijf bestemmingen past niet in een onderbalk");
  assert.ok(m.domainsFor("employee").length <= m.MOBILE.bottomTabCount);
});

test("IA-18 5· de vijf-tabs-regel is afdwingbaar", () => {
  assert.equal(m.checkMobileTabs(["a", "b", "c", "d", "e", "f"]).violations[0].reason, "TOO_MANY_TABS");
  assert.equal(m.checkMobileTabs([]).violations[0].reason, "NO_TABS");
  assert.equal(m.checkMobileTabs(["a", "a"]).violations[0].reason, "DUPLICATE_TABS");
});

test("IA-18 6· de mobiele releasevereisten staan op één plek", () => {
  assert.equal(m.MOBILE.minTouchTargetPx, 44, "44px is een vereiste, geen richtlijn (D-12)");
  assert.equal(m.MOBILE.bottomTabCount, 5);
  assert.equal(m.MOBILE.resumeDraftAfterInterruption, true,
    "een monteur die gebeld wordt halverwege een werkbon verliest zijn invoer niet");
});

test("IA-19 7· een reseller maakt GEEN tenants aan · geen enkel recht helpt", () => {
  const alles = { permissions: ["*"], grant: { active: true, tenantId: "t_1", scopes: ["read", "write"] }, tenantId: "t_1" };
  for (const actie of m.RESELLER_FORBIDDEN_ACTIONS) {
    const uit = m.resellerActionDecision(actie, alles);
    assert.equal(uit.ok, false, `${actie} is uitvoerbaar`);
    assert.equal(uit.code, "FORBIDDEN_FOR_RESELLER");
  }
});

test("IA-19 8· klantinhoud vereist een ACTIEVE delegatie, niet de reseller-rol", () => {
  const nu = "2026-07-24T10:00:00Z";
  const basis = { tenantId: "t_1", now: nu };
  assert.equal(m.resellerActionDecision("tenant_content.invoice.read", basis).code, "NO_ACTIVE_DELEGATION");
  assert.equal(m.resellerActionDecision("tenant_content.invoice.read",
    { ...basis, grant: { active: false, tenantId: "t_1", scopes: ["read"] } }).code, "NO_ACTIVE_DELEGATION");
});

test("IA-19 9· een delegatie voor een ANDERE tenant helpt niet", () => {
  const uit = m.resellerActionDecision("tenant_content.invoice.read", {
    tenantId: "t_1", now: "2026-07-24T10:00:00Z",
    grant: { active: true, tenantId: "t_2", scopes: ["read"] },
  });
  assert.equal(uit.code, "GRANT_OTHER_TENANT");
});

test("IA-19 10· lezen mag niet automatisch schrijven", () => {
  const ctx = {
    tenantId: "t_1", now: "2026-07-24T10:00:00Z",
    grant: { active: true, tenantId: "t_1", scopes: ["read"], expiresAt: "2026-07-24T18:00:00Z" },
  };
  assert.equal(m.resellerActionDecision("tenant_content.invoice.read", ctx).ok, true);
  assert.equal(m.resellerActionDecision("tenant_content.invoice.update", ctx).code, "SCOPE_NOT_GRANTED");
});

test("IA-19 11· een VERLOPEN delegatie geeft geen toegang meer", () => {
  const uit = m.resellerActionDecision("tenant_content.invoice.read", {
    tenantId: "t_1", now: "2026-07-24T10:00:00Z",
    grant: { active: true, tenantId: "t_1", scopes: ["read"], expiresAt: "2026-07-24T09:00:00Z" },
  });
  assert.equal(uit.code, "GRANT_EXPIRED");
});

test("IA-19 12· commerciële acties van de reseller zelf blijven gewoon werken", () => {
  assert.deepEqual(m.resellerActionDecision("deal.create", { tenantId: "t_1" }), { ok: true, code: null });
  assert.deepEqual(m.resellerActionDecision("earnings.view", {}), { ok: true, code: null });
});

test("IA-19 13· het resellerportaal draagt GEEN klantinhoudsdomeinen", () => {
  const reseller = m.domainsFor("reseller");
  for (const d of ["customers", "finance", "work-orders", "team", "projects"]) {
    assert.equal(reseller.includes(d), false, `${d} hoort niet in het resellerportaal`);
  }
  assert.ok(reseller.every(d => d.startsWith("partner-")), "uitsluitend commerciële domeinen");
});

test("IA-20 14· platformdomeinen bestaan ALLEEN op het Super Admin-portaal", () => {
  for (const d of m.PLATFORM_ONLY_DOMAINS) {
    assert.equal(m.portalAllows("super-admin", d), true, `${d} ontbreekt bij Super Admin`);
    for (const p of m.PORTALS.filter(x => x !== "super-admin")) {
      assert.equal(m.portalAllows(p, d), false, `${d} lekt naar ${p}`);
    }
  }
});

test("IA-20 15· de acht Super Admin-domeinen uit de handover staan er", () => {
  assert.deepEqual(m.domainsFor("super-admin").sort(), [
    "platform-communication", "platform-operations", "platform-partners", "platform-product",
    "platform-revenue", "platform-security", "platform-services", "platform-tenants",
  ]);
});

test("IA-21 16· het klantportaal ziet alleen wat GEDEELD is", () => {
  assert.equal(m.scopeFor("customer"), "gedeeld");
  const klant = m.domainsFor("customer");
  assert.ok(klant.every(d => d.startsWith("portal-")), "een klant komt nooit in een intern domein");
  for (const d of ["team", "finance", "resources", "insights", "automation"]) {
    assert.equal(klant.includes(d), false, `${d} lekt naar het klantportaal`);
  }
});

test("IA-17..21 17· geen enkel portaal deelt een domein met een ander portaaltype", () => {
  // Interne domeinen mogen gedeeld zijn tussen admin/manager/employee,
  // maar partner-, platform- en portal-domeinen zijn exclusief.
  const exclusief = { "partner-": "reseller", "platform-": "super-admin", "portal-": "customer" };
  for (const [prefix, eigenaar] of Object.entries(exclusief)) {
    for (const p of m.PORTALS) {
      const vreemd = m.domainsFor(p).filter(d => d.startsWith(prefix));
      if (p === eigenaar) assert.ok(vreemd.length > 0, `${eigenaar} mist zijn eigen domeinen`);
      else assert.deepEqual(vreemd, [], `${p} draagt domeinen van ${eigenaar}`);
    }
  }
});

test("IA-17..20 18· de matrix sluit aan op de registry (D-02, geen tweede waarheid)", () => {
  // Elk intern domein in de matrix moet in de registry bestaan · anders
  // verwijst een portaal naar een menu-item dat nergens gedefinieerd is.
  const bekend = new Set(registry.ENTRIES.filter(e => !e.parentId).map(e => e.id));
  const intern = new Set([...m.domainsFor("tenant-admin"), ...m.domainsFor("manager"), ...m.domainsFor("employee")]);
  const onbekend = [...intern].filter(d => !bekend.has(d));
  assert.deepEqual(onbekend, [], `deze domeinen staan in de matrix maar niet in de registry: ${onbekend.join(", ")}`);
});

test("IA-18 19· het medewerkersportaal blijft op mobiel volledig bereikbaar (D-12)", () => {
  const tree = resolver.resolve(registry.ENTRIES, {
    portal: "employee", permissions: ["*"],
    entitlements: ["planning", "workorders", "employees", "customers"],
  });
  const st = shell.shellState({ tree, width: 390 });
  assert.equal(st.mode, "mobile");
  assert.deepEqual(shell.reachableIds(tree, st).sort(), tree.map(d => d.id).sort(),
    "op een telefoon van 390px valt er geen bestemming weg");
});
