"use strict";
// IA-07 · Klantdomein en -werkruimte (IA handover §7/§8).
// Acceptatiebewijs uit de handover: "Canonical links; no duplicate
// customer/location data." Plus de gedeelde recordprimitieven die elke
// werkruimte gebruikt: route-backed tabbladen en server-eigen statusacties.
const { test } = require("node:test");
const assert = require("node:assert");
const ws = require("../public/js/app/workspaces/customer/definition");
const tabs = require("../public/js/app/shared/record-tabs");
const status = require("../public/js/app/shared/status-actions");

const ALLES = {
  permissions: ["*"],
  entitlements: ["customers", "quotes", "projects", "workorders", "invoices"],
  params: { customerId: "c_42" },
};

// ── Canonieke verwijzingen ───────────────────────────────────────────────────

test("IA-07 1· GEEN DUBBELE KLANTGEGEVENS: een werkbon draagt een id, geen naam", () => {
  const goed = ws.checkCanonicalLinks("work_order", { customerId: "c_1", locationId: "loc_2", number: "WB-9" });
  assert.equal(goed.ok, true);

  const fout = ws.checkCanonicalLinks("work_order", { customerId: "c_1", customerName: "Acme Bouw", siteAddress: "Dorpsstraat 1" });
  assert.equal(fout.ok, false);
  assert.deepEqual(fout.violations.map(v => v.field).sort(), ["customerName", "siteAddress"]);
  assert.equal(fout.violations.every(v => v.reason === "DUPLICATED_CUSTOMER_DATA"), true);
});

test("IA-07 2· een record zonder canonieke verwijzing wordt afgekeurd", () => {
  const uit = ws.checkCanonicalLinks("project", { name: "Renovatie" });
  assert.equal(uit.ok, false);
  assert.deepEqual(uit.violations, [{ field: "customerId", reason: "MISSING_CANONICAL_LINK" }]);
});

test("IA-07 3· een BEVROREN document mag de gegevens wel dragen (momentopname)", () => {
  // Een verstuurde factuur mag niet met terugwerkende kracht veranderen als
  // de klant morgen verhuist.
  const factuur = ws.checkCanonicalLinks("invoice", {
    customerId: "c_1", customerName: "Acme Bouw", billingAddress: "Dorpsstraat 1", vatNumber: "BE0123456789",
  });
  assert.equal(factuur.ok, true, "een boekstuk bevriest bewust");

  // Maar alleen de geregistreerde velden · een factuur bevriest geen telefoonnummer.
  const teveel = ws.checkCanonicalLinks("invoice", { customerId: "c_1", customerPhone: "0470112233" });
  assert.equal(teveel.ok, false);
  assert.deepEqual(teveel.violations.map(v => v.field), ["customerPhone"]);
});

test("IA-07 4· alleen documenten die de deur uit gaan mogen bevriezen", () => {
  const bevriezen = Object.entries(ws.CANONICAL_LINKS).filter(([, r]) => r.snapshotFields.length > 0).map(([t]) => t);
  assert.deepEqual(bevriezen.sort(), ["invoice", "quote_version"],
    "alleen een uitgegeven factuur en een verstuurde offerteversie bevriezen · de rest verwijst");
});

test("IA-07 5· weergavegegevens worden GERESOLVED, niet gekopieerd", () => {
  const bronnen = {
    customers: { c_1: { name: "Acme Bouw" } },
    locations: { loc_2: { label: "Werf Kortrijk" } },
  };
  const uit = ws.resolveDisplay({ customerId: "c_1", locationId: "loc_2" }, "work_order", bronnen);
  assert.equal(uit.customerName, "Acme Bouw");
  assert.equal(uit.locationLabel, "Werf Kortrijk");
  assert.equal(uit.frozen, null, "een werkbon bevriest niets");

  // Wijzigt de klant zijn naam, dan verandert de weergave mee · precies wat we willen.
  const na = ws.resolveDisplay({ customerId: "c_1", locationId: "loc_2" }, "work_order",
    { ...bronnen, customers: { c_1: { name: "Acme Bouw NV" } } });
  assert.equal(na.customerName, "Acme Bouw NV");
});

test("IA-07 6· bij een bevroren document wint de momentopname", () => {
  const uit = ws.resolveDisplay(
    { customerId: "c_1", customerName: "Acme Bouw", billingAddress: "Oud adres 1" },
    "invoice",
    { customers: { c_1: { name: "Acme Bouw NV" } } });
  assert.deepEqual(uit.frozen, { customerName: "Acme Bouw", billingAddress: "Oud adres 1" },
    "de factuur houdt het adres van toen");
  assert.equal(uit.customerId, "c_1", "de canonieke verwijzing blijft er wel bij staan");
});

test("IA-07 7· elke recordsoort in het register verwijst naar de klant", () => {
  for (const [type, regel] of Object.entries(ws.CANONICAL_LINKS)) {
    assert.equal(regel.customerKey, "customerId", `${type} gebruikt een afwijkende klantsleutel`);
    assert.ok(Array.isArray(regel.snapshotFields), `${type} mist snapshotFields`);
  }
  assert.equal(ws.checkCanonicalLinks("verzonnen_type", {}).violations[0].reason, "UNKNOWN_RECORD_TYPE");
});

// ── Gedeelde recordprimitieven ───────────────────────────────────────────────

test("IA-07 8· tabbladen zijn ROUTES · verversen komt op hetzelfde tabblad uit", () => {
  const t = tabs.tabsFor(ws.DEFINITION, { ...ALLES, activeTab: "invoices" });
  for (const tab of t) assert.equal(tab.route, `/app/customers/c_42/${tab.id}`);
  assert.equal(t.find(x => x.id === "invoices").isActive, true);
  assert.equal(t.filter(x => x.isActive).length, 1, "precies één actief tabblad");
});

test("IA-07 9· geen recht betekent GEEN TABBLAD, niet een leeg tabblad", () => {
  const beperkt = tabs.tabsFor(ws.DEFINITION, {
    permissions: ["customers.view"], entitlements: ["customers"], params: { customerId: "c_42" },
  });
  const ids = beperkt.map(t => t.id);
  assert.deepEqual(ids, ["overview", "contacts", "locations", "files", "activity"]);
  assert.equal(ids.includes("invoices"), false, "geen factuurrecht → geen factuurtabblad");
  // Een deeplink naar een verborgen tabblad weigert net zo hard.
  assert.equal(tabs.tabAllowed(ws.DEFINITION, "invoices", { permissions: ["customers.view"], entitlements: ["customers"] }), false);
});

test("IA-07 10· module niet vrijgegeven verbergt het tabblad ook", () => {
  const zonderModule = tabs.tabsFor(ws.DEFINITION, {
    permissions: ["*"], entitlements: ["customers"], params: { customerId: "c_42" },
  });
  assert.equal(zonderModule.some(t => t.id === "quotes"), false, "recht zonder module is geen toegang");
});

test("IA-07 11· zonder recht op het gevraagde tabblad landt de gebruiker op een toegestaan tabblad", () => {
  const ctx = { permissions: ["customers.view"], entitlements: ["customers"], params: { customerId: "c_42" } };
  assert.equal(tabs.fallbackTab(ws.DEFINITION, ctx), "overview");
  assert.equal(tabs.fallbackTab(ws.DEFINITION, { permissions: [], entitlements: [] }), null,
    "geen enkel toegestaan tabblad geeft niets, geen standaardtabblad");
});

test("IA-07 12· tellingen worden apart geladen, alleen voor zichtbare tabbladen", () => {
  const bronnen = tabs.countSources(ws.DEFINITION, ALLES);
  assert.ok(bronnen.includes("customer.invoices"));
  const beperkt = tabs.countSources(ws.DEFINITION, { permissions: ["customers.view"], entitlements: ["customers"] });
  assert.equal(beperkt.includes("customer.invoices"), false, "geen telling voor een verborgen tabblad");
  // Het overzichtstabblad heeft geen telling · het dossier opent zonder wachten.
  assert.equal(tabs.tabsFor(ws.DEFINITION, ALLES).find(t => t.id === "overview").hasCount, false);
});

// ── Statusacties (D-06) ──────────────────────────────────────────────────────

test("IA-07 13· D-06: de UI verzint GEEN overgangen", () => {
  const leeg = status.actionsFor({ status: "draft" });
  assert.deepEqual(leeg.actions, [], "zonder serverantwoord geen knoppen");
  assert.equal(status.primaryAction(leeg), null);
  // Er staat nergens een statuslijst in dit bestand · de server bezit ze.
  const bron = require("fs").readFileSync(require.resolve("../public/js/app/shared/status-actions"), "utf8");
  assert.equal(/(draft|sent|accepted|paid|approved)\s*[:,"']/.test(bron), false,
    "status-actions.js mag geen eigen statuswaarden kennen");
});

test("IA-07 14· een geblokkeerde overgang wordt getoond met de reden, niet verstopt", () => {
  const m = status.actionsFor({
    status: "draft",
    allowedTransitions: [
      { action: "send", toStatus: "sent", labelKey: "action.send" },
      { action: "delete", destructive: true },
    ],
    blockers: [{ action: "send", code: "MISSING_VAT", messageKey: "blocker.missing_vat" }],
  });
  const send = m.actions.find(a => a.action === "send");
  assert.equal(send.enabled, false);
  assert.equal(send.blockerCode, "MISSING_VAT");
  assert.equal(send.blockerMessageKey, "blocker.missing_vat", "de gebruiker verdient een uitleg, geen verdwenen knop");
  // De primaire actie is de eerste UITVOERBARE, niet-destructieve overgang.
  assert.equal(status.primaryAction(m), null, "send is geblokkeerd en delete is destructief");
});

test("IA-07 15· destructieve en bevestigingsplichtige acties dragen hun bevestiging", () => {
  const m = status.actionsFor({
    allowedTransitions: [
      { action: "credit", requiresConfirmation: true, confirmationKey: "confirm.credit" },
      { action: "delete", destructive: true },
      { action: "save" },
    ],
  });
  assert.equal(status.guardExecute(m, "credit").confirm, "confirm.credit");
  assert.equal(status.guardExecute(m, "delete").confirm, null, "destructief zonder bevestigingsplicht blijft direct");
  assert.equal(m.actions.find(a => a.action === "delete").confirmationKey, "confirm.destructive");
  assert.equal(status.guardExecute(m, "save").confirm, null);
});

test("IA-07 16· een geblokkeerde of onbekende actie kan niet uitgevoerd worden", () => {
  const m = status.actionsFor({
    allowedTransitions: [{ action: "send" }],
    blockers: [{ action: "send", code: "MISSING_VAT" }],
  });
  assert.deepEqual(status.guardExecute(m, "send"), { ok: false, code: "MISSING_VAT" });
  assert.deepEqual(status.guardExecute(m, "verzonnen"), { ok: false, code: "UNKNOWN_TRANSITION" });
});

test("IA-07 17· een blokkade zonder overgang blijft zichtbaar als waarschuwing", () => {
  const m = status.actionsFor({
    status: "sent",
    allowedTransitions: [],
    blockers: [{ action: "peppol_send", code: "NO_KBO", messageKey: "blocker.no_kbo" }],
  });
  assert.deepEqual(m.blocked, [{ action: "peppol_send", code: "NO_KBO", messageKey: "blocker.no_kbo" }]);
});
