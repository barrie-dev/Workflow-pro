"use strict";
// IA-10 · Planningwerkruimte · acceptatie: "Server validation; route-backed
//         filters; mobile read/write parity."
// IA-11 · Werkbonwerkruimte · acceptatie: "Existing full-chain E2E preserved;
//         idempotent offline replay."
const { test } = require("node:test");
const assert = require("node:assert");
const planning = require("../public/js/app/workspaces/planning/definition");
const wo = require("../public/js/app/workspaces/work-order/definition");
const tabs = require("../public/js/app/shared/record-tabs");

// ── IA-10 · filters in de URL ────────────────────────────────────────────────

test("IA-10 1· een gefilterde weergave is DEELBAAR", () => {
  const q = planning.buildFilterQuery({ view: "week", from: "2026-07-20", crew: "ploeg_a", worksite: "ws_3" });
  assert.equal(q, "?view=week&from=2026-07-20&crew=ploeg_a&worksite=ws_3");
  // Heen en terug levert exact dezelfde toestand op.
  const terug = planning.parseFilterQuery({ view: "week", from: "2026-07-20", crew: "ploeg_a", worksite: "ws_3" });
  assert.deepEqual(terug, { view: "week", from: "2026-07-20", crew: "ploeg_a", worksite: "ws_3" });
});

test("IA-10 2· dezelfde filters geven altijd dezelfde link", () => {
  const a = planning.buildFilterQuery({ crew: "p_1", view: "day" });
  const b = planning.buildFilterQuery({ view: "day", crew: "p_1" });
  assert.equal(a, b, "de sleutelvolgorde staat vast, niet de invoervolgorde");
});

test("IA-10 3· lege en onbekende filters vervuilen de URL niet", () => {
  assert.equal(planning.buildFilterQuery({ crew: "", worksite: null, unassigned: false }), "");
  assert.equal(planning.buildFilterQuery({}), "");
  assert.deepEqual(planning.parseFilterQuery({ verzonnen: "x", crew: "p_1" }), { crew: "p_1" });
  assert.deepEqual(planning.parseFilterQuery({ view: "kalenderjaar" }), {}, "een onbekende weergave vervalt");
});

test("IA-10 4· de onbezette-vraag-filter is een echte boolean", () => {
  assert.equal(planning.buildFilterQuery({ unassigned: true }), "?unassigned=true");
  assert.deepEqual(planning.parseFilterQuery({ unassigned: "true" }), { unassigned: true });
});

// ── IA-10 · servervalidatie ──────────────────────────────────────────────────

test("IA-10 5· de browser DETECTEERT conflicten, hij BESLIST niet", () => {
  const uit = planning.submitDecision(
    { id: "a_new", start: "2026-07-27T08:00:00Z", end: "2026-07-27T12:00:00Z", assigneeIds: ["e_1"] },
    { bookings: [{ id: "a_1", start: "2026-07-27T10:00:00Z", end: "2026-07-27T14:00:00Z", assigneeIds: ["e_1"] }] });
  assert.equal(uit.conflicts[0].code, "DOUBLE_BOOKED");
  assert.equal(uit.blocked, false, "overboeken mag bewust · met bevestiging");
  assert.equal(uit.requiresConfirmation, true);
  assert.equal(uit.serverMustValidate, true, "het eindoordeel komt ALTIJD van de server");
});

test("IA-10 6· zonder conflicten blijft de server nog steeds het laatste woord", () => {
  const uit = planning.submitDecision(
    { start: "2026-07-27T08:00:00Z", end: "2026-07-27T12:00:00Z", assigneeIds: ["e_1"] }, {});
  assert.deepEqual(uit.conflicts, []);
  assert.equal(uit.requiresConfirmation, false);
  assert.equal(uit.serverMustValidate, true,
    "de server ziet dingen die de browser niet kent · verlof van net, verlopen certificaat");
});

test("IA-10 7· verlof en beschikbaarheid worden herkend", () => {
  const opVerlof = planning.detectConflicts(
    { start: "2026-07-27T08:00:00Z", end: "2026-07-27T12:00:00Z", assigneeIds: ["e_1"] },
    { leaves: [{ id: "l_1", employeeId: "e_1", from: "2026-07-25", to: "2026-07-30" }] });
  assert.equal(opVerlof[0].code, "ON_LEAVE");

  const nietBeschikbaar = planning.detectConflicts(
    { start: "2026-07-27T08:00:00Z", end: "2026-07-27T12:00:00Z", assigneeIds: ["e_1"] },
    { availability: { e_1: { availableFrom: "2026-08-01" } } });
  assert.equal(nietBeschikbaar[0].code, "NOT_AVAILABLE");
});

test("IA-10 8· een onmogelijke periode is wél hard geblokkeerd", () => {
  const uit = planning.submitDecision({ start: "2026-07-27T12:00:00Z", end: "2026-07-27T08:00:00Z" }, {});
  assert.equal(uit.blocked, true);
  assert.deepEqual(uit.conflicts, [{ code: "INVALID_RANGE" }]);
});

test("IA-10 9· MOBIELE PARITEIT: mobiel leest én schrijft", () => {
  const ctx = { permissions: ["planning.view", "planning.create", "planning.update"] };
  const desktop = planning.capabilities({ ...ctx, device: "desktop" });
  const mobiel = planning.capabilities({ ...ctx, device: "mobile" });
  assert.deepEqual(mobiel, desktop, "een monteur op de baan belandt niet in een alleen-lezen versie");
  assert.equal(mobiel.create, true);
  assert.equal(mobiel.reschedule, true);
  // Rechten beperken wél · dat is geen apparaatverschil.
  assert.equal(planning.capabilities({ permissions: ["planning.view"] }).create, false);
});

// ── IA-11 · idempotente offline replay ───────────────────────────────────────

test("IA-11 10· elke offline mutatie krijgt een stabiele sleutel op het TOESTEL", () => {
  const m = { workOrderId: "wo_1", type: "time.add", deviceId: "d_9", seq: 3, hours: 2 };
  assert.equal(wo.mutationKey(m), "wo:wo_1:time.add:d_9:3");
  // Opnieuw versturen geeft exact dezelfde sleutel · dat is het hele punt.
  assert.equal(wo.mutationKey({ ...m, hours: 2 }), wo.mutationKey(m));
});

test("IA-11 11· een mutatie zonder toestel of volgnummer wordt GEWEIGERD, niet geraden", () => {
  assert.equal(wo.mutationKey({ workOrderId: "wo_1", type: "time.add", seq: 1 }), null, "geen toestel");
  assert.equal(wo.mutationKey({ workOrderId: "wo_1", type: "time.add", deviceId: "d_1" }), null, "geen volgnummer");
  assert.equal(wo.mutationKey({ type: "time.add", deviceId: "d_1", seq: 1 }), null, "geen werkbon");
  // seq 0 is een geldig volgnummer, geen ontbrekende waarde.
  assert.ok(wo.mutationKey({ workOrderId: "wo_1", type: "time.add", deviceId: "d_1", seq: 0 }));
});

test("IA-11 12· niet elke mutatie mag offline · een status forceren hoort niet", () => {
  assert.equal(wo.mutationKey({ workOrderId: "wo_1", type: "status.invoiced", deviceId: "d_1", seq: 1 }), null);
  const q = wo.prepareQueue([{ workOrderId: "wo_1", type: "status.invoiced", deviceId: "d_1", seq: 1 }]);
  assert.deepEqual(q.ready, []);
  assert.equal(q.rejected[0].reason, "NOT_OFFLINE_CAPABLE");
});

test("IA-11 13· DUBBELE MUTATIES in de wachtrij worden er één", () => {
  const m = { workOrderId: "wo_1", type: "time.add", deviceId: "d_9", seq: 3, hours: 3 };
  const q = wo.prepareQueue([m, { ...m }, { ...m }]);
  assert.equal(q.ready.length, 1, "drie uur wordt niet negen uur na twee mislukte verzendingen");
  assert.equal(q.ready[0].idempotencyKey, "wo:wo_1:time.add:d_9:3");
});

test("IA-11 14· de wachtrij vertrekt in de volgorde waarin het werk gebeurde", () => {
  const q = wo.prepareQueue([
    { workOrderId: "wo_1", type: "proof.add", deviceId: "d_1", seq: 3 },
    { workOrderId: "wo_1", type: "time.add", deviceId: "d_1", seq: 1 },
    { workOrderId: "wo_1", type: "material.add", deviceId: "d_1", seq: 2 },
  ]);
  assert.deepEqual(q.ready.map(m => m.seq), [1, 2, 3], "ook als de wachtrij door elkaar raakte");
});

test("IA-11 15· een DUPLICAAT-antwoord is een SUCCES, geen fout", () => {
  const q = wo.prepareQueue([
    { workOrderId: "wo_1", type: "time.add", deviceId: "d_1", seq: 1 },
    { workOrderId: "wo_1", type: "material.add", deviceId: "d_1", seq: 2 },
    { workOrderId: "wo_1", type: "proof.add", deviceId: "d_1", seq: 3 },
  ]).ready;

  const uit = wo.applyReplayResult(q, [
    { idempotencyKey: q[0].idempotencyKey, status: "applied" },
    // Het antwoord van de vorige poging ging verloren; de server had hem al.
    { idempotencyKey: q[1].idempotencyKey, status: "duplicate" },
    { idempotencyKey: q[2].idempotencyKey, status: "error", retryable: true },
  ]);
  assert.equal(uit.confirmed.length, 2, "applied én duplicate zijn allebei binnen");
  assert.equal(uit.retry.length, 1);
  assert.deepEqual(uit.failed, []);
});

test("IA-11 16· een definitieve weigering blijft niet eeuwig herhalen", () => {
  const q = wo.prepareQueue([{ workOrderId: "wo_1", type: "time.add", deviceId: "d_1", seq: 1 }]).ready;
  const uit = wo.applyReplayResult(q, [{ idempotencyKey: q[0].idempotencyKey, status: "error", retryable: false, code: "WORKORDER_CLOSED" }]);
  assert.deepEqual(uit.retry, []);
  assert.equal(uit.failed[0].error, "WORKORDER_CLOSED", "de monteur hoort te weten waaróm het niet lukte");
});

test("IA-11 17· een mutatie zonder antwoord wordt opnieuw geprobeerd", () => {
  const q = wo.prepareQueue([{ workOrderId: "wo_1", type: "time.add", deviceId: "d_1", seq: 1 }]).ready;
  const uit = wo.applyReplayResult(q, []);
  assert.deepEqual(uit.retry, q, "geen antwoord is geen bevestiging");
  assert.deepEqual(uit.confirmed, []);
});

// ── IA-11 · facturatiegereedheid ─────────────────────────────────────────────

test("IA-11 18· facturatiegereedheid komt van de SERVER (D-06)", () => {
  assert.deepEqual(wo.billingReadiness({ readyToBill: true }), { ready: true, blockers: [] });
  const geblokkeerd = wo.billingReadiness({ readyToBill: true, billingBlockers: [{ code: "MISSING_SIGNATURE" }] });
  assert.equal(geblokkeerd.ready, false);
  assert.equal(geblokkeerd.blockers[0].messageKey, "blocker.missing_signature", "met uitleg, niet met een dode knop");
  assert.equal(wo.billingReadiness({}).ready, false, "geen oordeel van de server is geen groen licht");
});

test("IA-11 19· facturatiegereedheid zit achter een financieel recht", () => {
  const monteur = tabs.tabsFor(wo.DEFINITION, {
    permissions: ["workorders.view"], entitlements: ["workorders"], params: { workOrderId: "wo_1" },
  });
  assert.equal(monteur.some(t => t.id === "billing"), false);
  assert.ok(monteur.some(t => t.id === "proof"), "de monteur ziet zijn eigen bewijsvoering wel");
});

test("IA-10+11 20· beide werkruimtes voldoen aan het gedeelde tabcontract", () => {
  for (const def of [planning.DEFINITION, wo.DEFINITION]) {
    const t = tabs.tabsFor(def, { permissions: ["*"], entitlements: ["inventory", "invoices"], params: { [def.idParam]: "r_1" } });
    assert.equal(t.filter(x => x.isActive).length, 1, `${def.id} heeft niet precies één actief tabblad`);
    for (const tab of t) {
      assert.equal(tab.route, `${def.recordBase}/r_1/${tab.id}`, `${def.id}/${tab.id} is niet route-backed`);
      assert.match(tab.labelKey, /^[a-z_]+\.tab\.[a-z_]+$/, `${def.id}/${tab.id} heeft geen i18n-sleutel`);
    }
  }
});
