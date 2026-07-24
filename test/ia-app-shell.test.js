"use strict";
// IA-03 · Gedeelde AppShell (IA handover §7/§8).
// Acceptatiebewijs uit de handover: "Desktop/tablet/mobile visual and
// interaction parity." Plus D-02: de zijbalk komt UITSLUITEND uit de registry.
const { test } = require("node:test");
const assert = require("node:assert");
const shell = require("../public/js/app/shell/app-shell");
const sidebar = require("../public/js/app/shell/sidebar");
const resolver = require("../public/js/app/navigation/resolver");
const registry = require("../public/js/app/navigation/registry");
const routeMap = require("../public/js/app/navigation/route-map");

const tree = () => resolver.resolve(registry.ENTRIES, {
  portal: "tenant-admin", permissions: ["*"],
  entitlements: ["customers", "quotes", "projects", "planning", "workorders", "employees", "invoices", "inventory", "reports", "automation", "construction", "progress_claims"],
});

test("IA-03 1· de zijbalk komt uit de registry, niet uit hardcoded items (D-02)", () => {
  const html = sidebar.renderSidebar(tree(), { t: k => k });
  for (const d of tree()) {
    assert.ok(html.includes(`data-nav-id="${d.id}"`), `${d.id} ontbreekt in de zijbalk`);
  }
  // Geen enkel item dat niet uit de boom komt.
  const ids = [...html.matchAll(/data-nav-id="([^"]+)"/g)].map(m => m[1]);
  const bekend = new Set(resolver.flatten(tree()).map(r => r.id));
  assert.deepEqual(ids.filter(i => !bekend.has(i)), []);
});

test("IA-03 2· maximaal twee niveaus in de gerenderde zijbalk (D-01)", () => {
  const t = tree();
  const html = sidebar.renderSidebar(t, { t: k => k });
  // Precies één nav-children-container per domein DAT kinderen heeft · niet meer.
  const metKinderen = t.filter(d => (d.children || []).length).length;
  const containers = (html.match(/class="nav-children"/g) || []).length;
  assert.equal(containers, metKinderen, "één kinderen-container per domein, geen extra nesting");
  // Een tweede niveau is een <a class="nav-sub">: dat kan per constructie geen
  // derde niveau dragen. Bewijs dat er geen groep binnen een kind zit.
  for (const blok of html.split('class="nav-children"').slice(1)) {
    const inhoud = blok.split("</div>")[0];
    assert.equal(/nav-group|nav-children/.test(inhoud), false, "geen derde niveau binnen een kinderenblok");
  }
});

test("IA-03 3· actieve route markeert het item EN zijn domein", () => {
  const route = routeMap.parse("/app/finance/invoices");
  const st = shell.shellState({ tree: tree(), route, width: 1400 });
  assert.equal(st.activeId, "finance.invoices");
  const html = sidebar.renderSidebar(tree(), { activeId: st.activeId, t: k => k });
  assert.match(html, /data-nav-group="finance"[^>]*/);
  assert.ok(html.includes(`class="nav-sub is-active" data-nav-id="finance.invoices"`), "child actief");
  // Het domein staat open zodat het actieve kind zichtbaar is.
  assert.ok(/<div class="nav-group is-open" data-nav-group="finance">/.test(html), "domein open");
});

test("IA-03 4· labels lopen via i18n · de sleutel is nooit de identifier", () => {
  const html = sidebar.renderSidebar(tree(), { t: k => (k === "nav.finance" ? "Financieel" : k) });
  assert.ok(html.includes(">Financieel<"), "vertaald label wordt getoond");
  assert.ok(html.includes(`data-nav-id="finance"`), "de id blijft de identifier");
});

test("IA-03 5· alle tekst wordt ge-escaped (geen HTML-injectie via vertaling)", () => {
  const boom = [{ id: "x", path: "/app/x", labelKey: "nav.x", order: 10, children: [] }];
  const html = sidebar.renderSidebar(boom, { t: () => `<img src=x onerror="alert(1)">` });
  assert.equal(html.includes("<img"), false, "geen ruwe HTML uit een vertaling");
  assert.ok(html.includes("&lt;img"), "wel ge-escaped zichtbaar");
});

test("IA-03 6· responsive modus volgt de breekpunten", () => {
  assert.equal(shell.modeFor(1400), "desktop");
  assert.equal(shell.modeFor(1200), "desktop");
  assert.equal(shell.modeFor(900), "tablet");
  assert.equal(shell.modeFor(768), "tablet");
  assert.equal(shell.modeFor(500), "mobile");
  assert.equal(shell.modeFor(0), "mobile");
});

test("IA-03 7· PARITEIT: elke bestemming blijft bereikbaar op elke modus (D-12)", () => {
  const t = tree();
  const alle = t.map(d => d.id).sort();
  for (const width of [1400, 900, 420]) {
    const st = shell.shellState({ tree: t, width });
    const bereikbaar = shell.reachableIds(t, st).sort();
    assert.deepEqual(bereikbaar, alle, `bij ${width}px valt er een bestemming weg`);
  }
});

test("IA-03 8· mobiel toont maximaal vijf onderbalk-tabs, de rest onder 'meer'", () => {
  const st = shell.shellState({ tree: tree(), width: 420 });
  assert.equal(st.mode, "mobile");
  assert.ok(st.bottomTabs.length <= 5, `maximaal vijf tabs, kreeg ${st.bottomTabs.length}`);
  assert.ok(st.bottomTabs.length >= 1);
  // Geen overlap tussen tabs en 'meer'.
  assert.deepEqual(st.bottomTabs.filter(id => st.moreMenuIds.includes(id)), []);
});

test("IA-03 9· zijbalk-gedrag per modus", () => {
  assert.equal(shell.shellState({ tree: tree(), width: 1400 }).sidebarVisible, true);
  assert.equal(shell.shellState({ tree: tree(), width: 1400 }).sidebarCollapsible, false);
  const mob = shell.shellState({ tree: tree(), width: 420 });
  assert.equal(mob.sidebarVisible, false, "op mobiel start de zijbalk dicht");
  assert.equal(mob.sidebarCollapsible, true);
  assert.deepEqual(shell.shellState({ tree: tree(), width: 1400 }).bottomTabs, [], "geen onderbalk op desktop");
});

test("IA-03 10· supportsessie toont de geauditeerde banner", () => {
  const zonder = shell.shellState({ tree: tree(), width: 1400 });
  assert.equal(zonder.supportBanner, false);
  const met = shell.shellState({ tree: tree(), width: 1400, supportSession: { active: true, tenantId: "t_1" } });
  assert.equal(met.supportBanner, true, "impersonatie mag nooit onzichtbaar zijn");
});

test("IA-03 11· tenant/company-context en route-outlet zitten in de shell", () => {
  const st = shell.shellState({
    tree: tree(), width: 1400,
    tenant: { id: "t_demo", name: "Demo Bouwgroep", companyName: "Demo BV" },
  });
  assert.equal(st.tenant.id, "t_demo");
  assert.equal(st.tenant.name, "Demo Bouwgroep");
  assert.equal(st.tenant.companyName, "Demo BV");
  assert.equal(st.outletId, "app-outlet", "er is één vaste plek waar de route rendert");
});

test("IA-03 12· badges komen uit een benoemde bron, niet uit losse tellers", () => {
  const html = sidebar.renderSidebar(tree(), {
    t: k => k, badges: { "work_inbox.customer_requests": 3 },
  });
  assert.ok(html.includes(`<span class="nav-badge">3</span>`), "badge gerenderd via badgeSource");
  // Zonder telling geen lege badge.
  assert.equal(sidebar.renderSidebar(tree(), { t: k => k }).includes("nav-badge"), false);
});
