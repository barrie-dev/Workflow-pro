"use strict";
// IA-04 · Work Inbox-model (IA handover §7/§8).
// Acceptatiebewijs uit de handover: "Counts reconcile; action resolves source
// record; no duplicate item." Plus D-05: Work Inbox, Notifications en Messages
// zijn drie capabilities, geen drie tabbladen van dezelfde lijst.
const { test } = require("node:test");
const assert = require("node:assert");
const inbox = require("../public/js/app/shell/work-inbox");
const backend = require("../src/platform/work-inbox");

const NU = "2026-07-24T10:00:00.000Z";

const RUW = [
  { kind: "approval", sourceType: "leave", sourceId: "l_1", actionType: "approve", routeId: "team.leave", route: "/app/team/leave/l_1", priority: "high", dueAt: "2026-07-20T00:00:00.000Z", createdAt: "2026-07-14T10:00:00.000Z" },
  { kind: "task", sourceType: "customer_request", sourceId: "q_3", actionType: "open", routeId: "customers.requests", route: "/app/customers/requests/q_3", priority: "normal" },
  { kind: "exception", sourceType: "work_order", sourceId: "wo_9", actionType: "open", routeId: "work-orders", route: "/app/work-orders/wo_9/overview", priority: "critical" },
  { kind: "notification", sourceType: "notification", sourceId: "n_1", priority: "normal" },
  { kind: "message", sourceType: "message", sourceId: "m_1", priority: "normal" },
];

test("IA-04 1· D-05: meldingen en berichten verlaten de werklijst", () => {
  const p = inbox.partition(RUW);
  assert.equal(p.work.length, 3, "alleen approval/task/exception is werk");
  assert.equal(p.notifications.length, 1);
  assert.equal(p.messages.length, 1);
  assert.equal(p.work.some(i => i.kind === "notification" || i.kind === "message"), false,
    "een melding is geen werk · ze mag de badge niet opblazen");
});

test("IA-04 2· GEEN DUBBELS: twee bronnen over hetzelfde feit geven één item", () => {
  const dubbel = [
    { kind: "exception", sourceType: "work_order", sourceId: "wo_9", actionType: "open", route: "/app/work-orders/wo_9/overview", priority: "normal" },
    { kind: "exception", sourceType: "work_order", sourceId: "wo_9", actionType: "open", route: "/app/work-orders/wo_9/overview", priority: "critical" },
  ];
  const p = inbox.partition(dubbel);
  assert.equal(p.work.length, 1);
  assert.equal(p.work[0].priority, "critical", "bij een dubbel wint de zwaarste prioriteit");
});

test("IA-04 3· TELLINGEN KLOPPEN met wat er getoond wordt", () => {
  const veel = Array.from({ length: 25 }, (_, i) => ({
    kind: "task", sourceType: "customer_request", sourceId: `q_${i}`,
    actionType: "open", route: `/app/customers/requests/q_${i}`, priority: "normal",
  }));
  const p = inbox.partition(veel);
  const c = inbox.counts(p.work, { limit: 10 });
  assert.equal(c.total, 10, "de badge telt wat je ziet, niet wat er bestaat");
  assert.equal(c.truncated, 15, "wat wegviel staat er expliciet bij");
  assert.equal(Object.values(c.byKind).reduce((a, b) => a + b, 0), c.total);
  assert.equal(Object.values(c.byPriority).reduce((a, b) => a + b, 0), c.total);
});

test("IA-04 4· achterstallig en niet-toegewezen worden apart geteld", () => {
  const c = inbox.counts(inbox.partition(RUW).work, { now: NU });
  assert.equal(c.overdue, 1, "de verlofaanvraag stond op 20 juli");
  assert.equal(c.unassigned, 3, "niets is toegewezen");
  const opgelost = inbox.counts(inbox.partition(RUW.map(r =>
    r.sourceId === "l_1" ? { ...r, state: "resolved" } : r)).work, { now: NU });
  assert.equal(opgelost.overdue, 0, "een afgesloten item is niet meer achterstallig");
});

test("IA-04 5· de actie leidt naar het BRONRECORD, niet naar een lijst", () => {
  for (const i of inbox.partition(RUW).work) {
    const doel = inbox.resolveTarget(i);
    assert.ok(doel, `${i.id} heeft geen doel`);
    assert.ok(doel.includes(i.sourceId), `${i.id} leidt naar een lijst in plaats van het record`);
  }
});

test("IA-04 6· een item zonder bron wordt geweigerd (niet stil doorgelaten)", () => {
  assert.equal(inbox.normalize({ kind: "task", sourceId: "x" }), null, "geen bronsoort");
  assert.equal(inbox.normalize({ kind: "task", sourceType: "x" }), null, "geen bron-id");
  assert.equal(inbox.normalize({ sourceType: "x", sourceId: "y" }), null, "geen soort");
  assert.equal(inbox.normalize({ kind: "verzonnen", sourceType: "x", sourceId: "y" }), null, "onbekende soort");
});

test("IA-04 7· SLA-status volgt de belofte, niet de vervaldatum", () => {
  const geen = inbox.slaState({ dueAt: "2026-07-01" }, NU);
  assert.equal(geen.state, "none", "zonder SLA is er geen belofte om te breken");
  assert.equal(inbox.slaState({ slaAt: "2026-07-23T10:00:00.000Z" }, NU).state, "breached");
  assert.equal(inbox.slaState({ slaAt: "2026-07-24T20:00:00.000Z" }, NU).state, "at_risk");
  assert.equal(inbox.slaState({ slaAt: "2026-07-30T10:00:00.000Z" }, NU).state, "on_track");
  assert.equal(inbox.slaState({ slaAt: "2026-07-23T10:00:00.000Z", state: "resolved" }, NU).state, "met");
});

test("IA-04 8· sortering is stabiel: prioriteit, dan vervaldatum, dan id", () => {
  const p = inbox.partition(RUW);
  assert.deepEqual(p.work.map(i => i.priority), ["critical", "high", "normal"]);
  assert.deepEqual(inbox.partition(RUW).work, p.work, "zelfde invoer, zelfde volgorde");
});

test("IA-04 9· telemetrie draagt soort, bron, leeftijd en uitkomst · geen inhoud", () => {
  const item = inbox.partition(RUW).work.find(i => i.sourceType === "leave");
  const t = inbox.resolveTelemetry(item, { now: NU, outcome: "approved" });
  assert.deepEqual(t, {
    event: "work_inbox.resolve", item_type: "approval", source_type: "leave",
    age: 10, outcome: "approved",
  });
  assert.deepEqual(Object.keys(t).sort(), ["age", "event", "item_type", "outcome", "source_type"]);
});

// ── Backend-kant ─────────────────────────────────────────────────────────────

test("IA-04 10· BACKEND: de v1-telling beschreef meer dan ze teruggaf", () => {
  // Regressiebewijs. Vóór deze wijziging telde counts.total over de VOLLEDIGE
  // verzameling en werd daarna afgekapt op 80 · badge 120, scherm 80.
  const bron = require("fs").readFileSync(require.resolve("../src/platform/work-inbox"), "utf8");
  assert.equal(/total:\s*items\.length/.test(bron), false,
    "de telling mag niet over de ongekapte lijst gaan");
  assert.match(bron, /const shown = items\.slice\(0, MAX_ITEMS\)/);
  assert.match(bron, /total:\s*shown\.length/);
});

test("IA-04 11· BACKEND: v1-items worden canoniek met bron, route en soort", () => {
  const nu = new Date(NU);
  const c = backend.toCanonical({
    id: "leave:l_1", type: "leave_approval", priority: "high", title: "x",
    context: "", dueAt: null, targetView: "leaves", refId: "l_1", actions: ["approve", "reject"],
  }, nu);
  assert.equal(c.kind, "approval");
  assert.equal(c.sourceType, "leave");
  assert.equal(c.sourceId, "l_1");
  assert.equal(c.actionType, "approve");
  assert.equal(c.route, "/app/team/leave/l_1", "de actie leidt naar het record, niet naar de lijst");
  // Een melding is geen werk en levert dus geen canoniek werkitem op.
  assert.equal(backend.toCanonical({ type: "notification", refId: "n_1", actions: ["mark_read"] }, nu), null);
});

test("IA-04 13· BACKEND: de strangler-schakelaar zit bij de code, niet in server.js", () => {
  const server = require("fs").readFileSync(require.resolve("../src/server"), "utf8");
  // De route blijft één regel; de versiekeuze leeft in de platformmodule.
  assert.match(server, /buildWorkInboxFor\(store, tenant, user, url\)/);
  assert.equal(/searchParams\.get\("v"\)/.test(server), false,
    "de versiekeuze hoort niet in server.js te staan");
  assert.equal(typeof backend.buildWorkInboxFor, "function");
});

test("IA-04 12· BACKEND: het frontend-model aanvaardt exact wat de backend levert", () => {
  const nu = new Date(NU);
  const canoniek = ["leave_approval", "expense_approval", "po_approval", "inquiry", "overdue_workorder"]
    .map(type => backend.toCanonical({
      id: `${type}:r_1`, type, priority: "high", title: "t", context: "",
      dueAt: null, targetView: null, refId: "r_1", actions: ["approve"],
    }, nu));
  for (const c of canoniek) {
    assert.ok(c, "elke werksoort levert een canoniek item");
    assert.ok(inbox.normalize(c), `${c.sourceType} wordt door het frontend-model geweigerd`);
    assert.ok(inbox.WORK_KINDS.includes(c.kind), `${c.kind} is geen erkende werksoort`);
  }
});
