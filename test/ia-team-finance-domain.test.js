"use strict";
// IA-12 · Teamdomein · acceptatie: "Manager scope tests; approval SoD;
//         sensitive-field redaction."
// IA-13 · Financieel domein · acceptatie: "Invoice/Peppol full-chain
//         preserved; usage billing hidden from tenant."
const { test } = require("node:test");
const assert = require("node:assert");
const team = require("../public/js/app/workspaces/team/definition");
const finance = require("../public/js/app/workspaces/finance/definition");
const tabs = require("../public/js/app/shared/record-tabs");

const MEDEWERKER = {
  id: "e_5", name: "Jan Peeters", managerId: "e_1", email: "jan@demo.be",
  nationalNumber: "85.07.30-033.61", salary: 3400, costRate: 42.5,
  iban: "BE68539007547034", medicalNotes: "rugklachten",
};

// ── IA-12 · gevoelige velden ─────────────────────────────────────────────────

test("IA-12 1· gevoelige velden hangen aan een EIGEN recht, niet aan employees.view", () => {
  const planner = team.redact(MEDEWERKER, { permissions: ["employees.view"] });
  assert.equal(planner.name, "Jan Peeters", "de naam blijft · mensen verstoppen helpt niemand");
  for (const veld of ["nationalNumber", "salary", "costRate", "iban", "medicalNotes"]) {
    assert.equal(veld in planner, false, `${veld} lekt naar een gewone planner`);
  }
});

test("IA-12 2· een verboden veld wordt WEGGELATEN, niet genuld", () => {
  const planner = team.redact(MEDEWERKER, { permissions: ["employees.view"] });
  // Een veld met waarde null vertelt nog steeds dat het bestaat, en een leeg
  // loonveld naast een gevuld loonveld verraadt wie er meer verdient.
  assert.equal(JSON.stringify(planner).includes("salary"), false);
  assert.equal(JSON.stringify(planner).includes("null"), false);
});

test("IA-12 3· elk recht ontsluit precies zijn eigen klasse", () => {
  const metLoon = team.redact(MEDEWERKER, { permissions: ["employees.view", "costs.view"] });
  assert.equal(metLoon.salary, 3400, "costs.view ontsluit loongegevens");
  assert.equal(metLoon.costRate, 42.5);
  assert.equal("nationalNumber" in metLoon, false, "maar geen rijksregisternummer");
  assert.equal("iban" in metLoon, false, "en geen bankrekening");

  const hr = team.redact(MEDEWERKER, { permissions: ["employees.view", "employees.hr"] });
  assert.equal(hr.nationalNumber, "85.07.30-033.61");
  assert.equal(hr.iban, "BE68539007547034");
  assert.equal("salary" in hr, false, "HR zonder costs.view ziet geen loon");

  assert.deepEqual(team.allowedClasses({ permissions: ["employees.hr"] }).sort(),
    ["bank", "medical", "national_number"]);
});

test("IA-12 4· het contracttabblad zit achter employees.hr", () => {
  const planner = tabs.tabsFor(team.DEFINITION, {
    permissions: ["employees.view", "time.view", "leaves.view", "expenses.view"],
    params: { employeeId: "e_5" },
  });
  assert.equal(planner.some(t => t.id === "contract"), false);
  assert.ok(planner.some(t => t.id === "safety"), "veiligheid blijft wel zichtbaar");
});

// ── IA-12 · scope ────────────────────────────────────────────────────────────

test("IA-12 5· SCOPE: een manager ziet zijn team, niet de organisatie", () => {
  const ctx = { userId: "e_1", scope: "team", teamMemberIds: ["e_5", "e_6"], permissions: ["employees.view"] };
  assert.equal(team.inScope({ id: "e_5", managerId: "e_1" }, ctx), true);
  assert.equal(team.inScope({ id: "e_1" }, ctx), true, "jezelf zit altijd in je scope");
  assert.equal(team.inScope({ id: "e_9", managerId: "e_2" }, ctx), false, "iemand anders zijn team niet");
});

test("IA-12 6· scope eigen betekent uitsluitend jezelf · fail-closed bij onzin", () => {
  const eigen = { userId: "e_5", scope: "eigen" };
  assert.equal(team.inScope({ id: "e_5" }, eigen), true);
  assert.equal(team.inScope({ id: "e_6" }, eigen), false);
  assert.equal(team.inScope({ id: "e_6" }, { userId: "e_5", scope: "verzonnen" }), false,
    "een onbekende scope geeft geen toegang");
  assert.equal(team.inScope({ id: "e_6" }, { userId: "e_5" }), false, "zonder scope is de scope eigen");
});

test("IA-12 7· lijstweergave filtert én redigeert in één beweging", () => {
  const ctx = { userId: "e_1", scope: "team", teamMemberIds: ["e_5"], permissions: ["employees.view"] };
  const uit = team.visibleList([MEDEWERKER, { id: "e_9", name: "Buiten team", salary: 9999 }], ctx);
  assert.equal(uit.length, 1);
  assert.equal(uit[0].name, "Jan Peeters");
  assert.equal("salary" in uit[0], false, "een lijstscherm kan de redactie niet vergeten");
});

// ── IA-12 · functiescheiding ─────────────────────────────────────────────────

test("IA-12 8· SoD: je keurt je eigen aanvraag niet goed", () => {
  const ctx = { userId: "e_5", scope: "alle", permissions: ["leaves.approve"] };
  assert.deepEqual(team.canApprove({ type: "leave", employeeId: "e_5" }, ctx),
    { ok: false, code: "SELF_APPROVAL" });
});

test("IA-12 9· SoD: je keurt de aanvraag van je eigen LEIDINGGEVENDE niet goed", () => {
  // Wie de verlofaanvraag van zijn baas mag goedkeuren, staat onder druk.
  const ctx = { userId: "e_5", managerId: "e_1", scope: "alle", permissions: ["leaves.approve"] };
  assert.deepEqual(team.canApprove({ type: "leave", employeeId: "e_1" }, ctx),
    { ok: false, code: "UPWARD_APPROVAL" });
});

test("IA-12 10· goedkeuren vereist het recht ÉN de scope", () => {
  const zonderRecht = { userId: "e_1", scope: "alle", permissions: ["employees.view"] };
  assert.equal(team.canApprove({ type: "leave", employeeId: "e_5" }, zonderRecht).code, "NO_APPROVAL_RIGHT");

  const buitenScope = { userId: "e_1", scope: "team", teamMemberIds: ["e_5"], permissions: ["leaves.approve"] };
  assert.equal(team.canApprove({ type: "leave", employeeId: "e_9", managerId: "e_2" }, buitenScope).code, "OUT_OF_SCOPE");

  const goed = { userId: "e_1", scope: "team", teamMemberIds: ["e_5"], permissions: ["leaves.approve"] };
  assert.deepEqual(team.canApprove({ type: "leave", employeeId: "e_5", managerId: "e_1" }, goed), { ok: true, code: null });
});

test("IA-12 11· onkosten en verlof hebben elk hun eigen goedkeuringsrecht", () => {
  const ctx = { userId: "e_1", scope: "alle", permissions: ["leaves.approve"] };
  assert.equal(team.canApprove({ type: "expense", employeeId: "e_5" }, ctx).code, "NO_APPROVAL_RIGHT",
    "verlof goedkeuren is geen onkosten goedkeuren");
});

// ── IA-13 · D-09 en D-08 ─────────────────────────────────────────────────────

const FACTUUR = {
  id: "i_1", number: "F2026-0042", total: 1210,
  peppolStatus: "delivered", peppolSentAt: "2026-07-20T09:00:00Z", peppolAttempts: 1,
  peppolProviderCost: 0.14, peppolUnitPrice: 0.35, peppolMargin: 0.21, peppolBillableUnits: 1,
  monaCredits: 4200, monaProviderSpend: 18.4,
};

test("IA-13 12· D-09: de tenant ziet de LEVERING, niet de kostprijs", () => {
  const tenant = finance.projectForViewer(FACTUUR, { portal: "tenant-admin", role: "tenant_admin" });
  assert.equal(tenant.peppolStatus, "delivered", "is mijn factuur aangekomen · dat mag je gewoon weten");
  assert.equal(tenant.peppolAttempts, 1);
  for (const veld of finance.PEPPOL_FIELDS.platform) {
    assert.equal(veld in tenant, false, `${veld} lekt naar de tenant · dat verraadt onze marge`);
  }
});

test("IA-13 13· D-08: Mona-credits zijn UITSLUITEND Super Admin", () => {
  const tenant = finance.projectForViewer(FACTUUR, { portal: "tenant-admin" });
  for (const veld of finance.MONA_FIELDS.platform) {
    assert.equal(veld in tenant, false, `${veld} mag een tenant nooit zien`);
  }
  assert.equal(JSON.stringify(tenant).includes("4200"), false, "ook de waarde niet");
});

test("IA-13 14· Super Admin ziet wél alles", () => {
  const sa = finance.projectForViewer(FACTUUR, { portal: "super-admin" });
  assert.equal(sa.peppolProviderCost, 0.14);
  assert.equal(sa.monaCredits, 4200);
  assert.equal(finance.projectForViewer(FACTUUR, { role: "super_admin" }).peppolMargin, 0.21,
    "de rol werkt net zo goed als het portaal");
});

test("IA-13 15· platformvelden worden weggelaten, niet genuld", () => {
  const tenant = finance.projectForViewer(FACTUUR, { portal: "tenant-admin" });
  // Een genuld kostenveld vertelt nog steeds dat er een kostprijs bestaat
  // en hoe hij heet.
  assert.equal(Object.keys(tenant).some(k => k.toLowerCase().includes("cost")), false);
  assert.equal(Object.keys(tenant).some(k => k.toLowerCase().includes("margin")), false);
});

test("IA-13 16· de veldrenderer weigert elk platformveld voor een tenant", () => {
  for (const veld of finance.PLATFORM_ONLY_FIELDS) {
    assert.equal(finance.fieldVisible(veld, { portal: "tenant-admin" }), false, `${veld} zou gerenderd worden`);
    assert.equal(finance.fieldVisible(veld, { portal: "super-admin" }), true);
  }
  assert.equal(finance.fieldVisible("total", { portal: "tenant-admin" }), true, "gewone velden blijven gewoon");
});

test("IA-13 17· een mislukte levering geeft handelingsperspectief, geen doodlopende melding", () => {
  const ctx = { portal: "tenant-admin" };
  assert.equal(finance.deliveryStatus({ ...FACTUUR, peppolStatus: "failed" }, ctx).actionKey, "peppol.action.fix_and_resend");
  assert.equal(finance.deliveryStatus({ ...FACTUUR, peppolStatus: "rejected" }, ctx).actionKey, "peppol.action.contact_customer");
  assert.equal(finance.deliveryStatus(FACTUUR, ctx).actionKey, null, "geleverd vraagt geen actie");
  assert.equal(finance.deliveryStatus({}, ctx).status, "not_sent", "geen status is 'nog niet verstuurd'");
});

test("IA-13 18· de bezorgingsstatus draagt zelf geen platformvelden mee", () => {
  const d = finance.deliveryStatus(FACTUUR, { portal: "tenant-admin" });
  assert.deepEqual(Object.keys(d).sort(), ["actionKey", "attempts", "deliveredAt", "errorCode", "sentAt", "status"]);
});

test("IA-13 19· vorderingsstaten zijn conditioneel op de bouwmodule", () => {
  assert.equal(finance.progressClaimsVisible({ entitlements: ["progress_claims", "construction"] }), true);
  assert.equal(finance.progressClaimsVisible({ entitlements: ["progress_claims"] }), false,
    "vorderingsstaten zonder bouwmodule zijn een leeg menu-item");
  assert.equal(finance.progressClaimsVisible({}), false);
});

test("IA-12+13 20· beide domeinen voldoen aan het gedeelde tabcontract", () => {
  for (const def of [team.DEFINITION, finance.DEFINITION]) {
    const t = tabs.tabsFor(def, { permissions: ["*"], entitlements: [], params: { [def.idParam]: "r_1" } });
    assert.equal(t.filter(x => x.isActive).length, 1, `${def.id} heeft niet precies één actief tabblad`);
    for (const tab of t) {
      assert.equal(tab.route, `${def.recordBase}/r_1/${tab.id}`, `${def.id}/${tab.id} is niet route-backed`);
      assert.match(tab.labelKey, /^[a-z_]+\.tab\.[a-z_]+$/, `${def.id}/${tab.id} heeft geen i18n-sleutel`);
    }
  }
});
