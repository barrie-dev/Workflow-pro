"use strict";
// Webhooks & delivery-runtime (master-spec h41/E19): ondertekening verifieerbaar,
// at-least-once met dedupe op event-ID, retry/backoff, dead-letter, health.
const { test } = require("node:test");
const assert = require("node:assert");

const {
  computeSignature, signatureHeader, verifySignature, matchesEventType,
  makeWebhookRepository, deliverPending, buildDeliveryHealth, requeueEvent, MAX_ATTEMPTS, ERROR_THRESHOLD,
} = require("../src/platform/webhooks");
const { emitDomainEvent, listOutbox } = require("../src/platform/events");

function fakeStore(data = {}) {
  const d = { webhookEndpoints: [], outbox: [], ...data };
  return {
    data: d,
    list(col, tid) { const r = d[col] || []; return tid == null ? r : r.filter(x => x.tenantId === tid); },
    get(col, id) { return (d[col] || []).find(x => x.id === id); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    update(col, id, patch) { d[col] = (d[col] || []).map(x => x.id === id ? { ...x, ...patch } : x); return (d[col] || []).find(x => x.id === id); },
    remove(col, id) { d[col] = (d[col] || []).filter(x => x.id !== id); },
    save() {},
  };
}

/** Transport-dubbel: registreert calls en geeft een instelbaar antwoord. */
function fakeTransport(responder = () => ({ statusCode: 200 })) {
  const calls = [];
  const fn = async args => { calls.push(args); return responder(args, calls.length); };
  fn.calls = calls;
  return fn;
}

test("webhook: handtekening is verifieerbaar met signing secret", () => {
  const body = JSON.stringify({ id: "evt_1", eventType: "invoice.created" });
  const secret = "whsec_test";
  const t = 1_800_000_000;
  const header = signatureHeader(body, secret, t);
  assert.match(header, /^t=\d+,v1=[0-9a-f]{64}$/);
  assert.equal(verifySignature(body, secret, header, { now: t }), true);
  // Verkeerd secret → ongeldig.
  assert.equal(verifySignature(body, "whsec_ander", header, { now: t }), false);
  // Gewijzigde body → ongeldig.
  assert.equal(verifySignature(body + "x", secret, header, { now: t }), false);
  // Te oude timestamp → geweigerd (replaybescherming).
  assert.equal(verifySignature(body, secret, header, { now: t + 10_000 }), false);
  assert.equal(computeSignature(body, secret, t).length, 64);
});

test("webhook: eventtype-abonnement met wildcard", () => {
  assert.equal(matchesEventType(["invoice.created"], "invoice.created"), true);
  assert.equal(matchesEventType(["invoice.created"], "invoice.paid"), false);
  assert.equal(matchesEventType(["invoice.*"], "invoice.paid"), true);
  assert.equal(matchesEventType(["invoice.*"], "quote.sent"), false);
});

test("webhook: endpoint valideert https en eventtypes; secret lekt niet in lijst", () => {
  const store = fakeStore();
  const repo = makeWebhookRepository(store);
  assert.throws(() => repo.insert("t1", { url: "http://onveilig.be/hook", eventTypes: ["invoice.created"] }, "admin"), /https|INVALID_URL/);
  assert.throws(() => repo.insert("t1", { url: "https://ok.be/hook", eventTypes: [] }, "admin"), /eventtype|NO_EVENT_TYPES/);
  const ep = repo.insert("t1", { url: "https://ok.be/hook", eventTypes: ["invoice.*"] }, "admin");
  assert.ok(ep.secret.startsWith("whsec_"), "secret eenmalig bij aanmaak");
  const listed = repo.list("t1");
  assert.equal(listed[0].secret, undefined, "secret nooit in leesacties");
  assert.match(listed[0].secretHint, /^whsec_…/);
  // Roteren geeft een nieuw secret.
  const rotated = repo.rotateSecret("t1", ep.id, "admin");
  assert.notEqual(rotated.secret, ep.secret);
});

test("webhook: levering ondertekent, stuurt event-ID mee en markeert bezorgd", async () => {
  const store = fakeStore();
  const repo = makeWebhookRepository(store);
  const ep = repo.insert("t1", { url: "https://ok.be/hook", eventTypes: ["invoice.*"] }, "admin");
  const event = emitDomainEvent(store, { tenantId: "t1", eventType: "invoice.created", aggregateType: "invoice", aggregateId: "i1", data: { total: 100 } });

  const transport = fakeTransport(() => ({ statusCode: 200 }));
  const report = await deliverPending(store, { transport });
  assert.equal(report.delivered, 1);
  assert.equal(report.failed, 0);
  const call = transport.calls[0];
  assert.equal(call.url, "https://ok.be/hook");
  assert.equal(call.headers["X-Monargo-Event-Id"], event.id, "ontvanger kan dedupliceren op event-ID");
  assert.equal(call.headers["X-Monargo-Event-Type"], "invoice.created");
  assert.ok(verifySignature(call.body, ep.secret, call.headers["X-Monargo-Signature"]), "handtekening klopt met het secret van dit endpoint");
  // Payload draagt geen delivery-metadata of actor.
  const payload = JSON.parse(call.body);
  assert.equal(payload.delivery, undefined);
  assert.equal(payload.actor, undefined);
  assert.equal(payload.data.total, 100);
  // Event staat op delivered → geen tweede levering.
  assert.equal(listOutbox(store, { status: "pending", tenantId: "t1" }).length, 0);
  const second = await deliverPending(store, { transport });
  assert.equal(second.attempted, 0, "at-least-once, maar niet eindeloos herhalen na succes");
});

test("webhook: mislukte levering gaat in retry met backoff, daarna dead-letter", async () => {
  const store = fakeStore();
  const repo = makeWebhookRepository(store);
  repo.insert("t1", { url: "https://stuk.be/hook", eventTypes: ["invoice.created"] }, "admin");
  emitDomainEvent(store, { tenantId: "t1", eventType: "invoice.created", aggregateType: "invoice", aggregateId: "i1" });
  const transport = fakeTransport(() => ({ statusCode: 500, text: "Server Error" }));

  const first = await deliverPending(store, { transport });
  assert.equal(first.failed, 1);
  assert.match(first.results[0].error, /HTTP 500/);
  let ev = store.data.outbox[0];
  assert.equal(ev.delivery.status, "pending", "blijft pending voor een nieuwe poging");
  assert.equal(ev.delivery.attempts, 1);
  assert.ok(ev.delivery.nextAttemptAt, "backoff ingesteld");

  // Binnen de backoff wordt er niet opnieuw geprobeerd.
  const tooSoon = await deliverPending(store, { transport });
  assert.equal(tooSoon.attempted, 0, "respecteert de backoff");

  // Forceer de resterende pogingen (alsof de backoff verstreken is).
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    store.data.outbox[0].delivery.nextAttemptAt = null;
    await deliverPending(store, { transport });
  }
  ev = store.data.outbox[0];
  assert.equal(ev.delivery.status, "dead_letter", `na ${MAX_ATTEMPTS} pogingen naar dead-letter`);
  assert.equal(ev.delivery.attempts, MAX_ATTEMPTS);
});

test("webhook: endpoint gaat op error na opeenvolgende fouten en herstelt bij succes", async () => {
  const store = fakeStore();
  const repo = makeWebhookRepository(store);
  const ep = repo.insert("t1", { url: "https://wisselvallig.be/hook", eventTypes: ["job.done"] }, "admin");
  let mode = "fail";
  const transport = fakeTransport(() => (mode === "fail" ? { statusCode: 503 } : { statusCode: 200 }));

  // Blijven falen tot de circuit breaker het endpoint uitschakelt.
  for (let i = 0; i < 30 && repo.findById("t1", ep.id).status === "active"; i++) {
    emitDomainEvent(store, { tenantId: "t1", eventType: "job.done", aggregateType: "job", aggregateId: `j${i}` });
    store.data.outbox.forEach(e => { e.delivery.nextAttemptAt = null; });
    await deliverPending(store, { transport });
  }
  assert.equal(repo.findById("t1", ep.id).status, "error");
  assert.ok(repo.findById("t1", ep.id).health.consecutiveFailures >= ERROR_THRESHOLD);

  // Een endpoint in "error" krijgt geen leveringen meer, maar de events blijven
  // als ACHTERSTAND staan (niet stilzwijgend weggegooid).
  emitDomainEvent(store, { tenantId: "t1", eventType: "job.done", aggregateType: "job", aggregateId: "j99" });
  store.data.outbox.forEach(e => { e.delivery.nextAttemptAt = null; });
  const skipped = await deliverPending(store, { transport });
  assert.equal(skipped.attempted, 0, "niet-actief endpoint krijgt geen leveringen");
  assert.ok(skipped.results.some(r => r.status === "endpoint_inactive"), "wel zichtbaar als wachtend");
  assert.ok(listOutbox(store, { status: "pending", tenantId: "t1" }).length > 0, "events blijven bewaard");

  // Hervatten + succes → status terug actief.
  mode = "ok";
  repo.update("t1", ep.id, { url: ep.url, eventTypes: ep.eventTypes, status: "active" }, "admin");
  store.data.outbox.forEach(e => { e.delivery.nextAttemptAt = null; });
  await deliverPending(store, { transport });
  assert.equal(repo.findById("t1", ep.id).status, "active", "zelfherstel na succesvolle levering");
});

test("webhook: health toont laatste succes, laatste fout en achterstand", async () => {
  const store = fakeStore();
  const repo = makeWebhookRepository(store);
  repo.insert("t1", { url: "https://ok.be/hook", eventTypes: ["invoice.*"] }, "admin");
  emitDomainEvent(store, { tenantId: "t1", eventType: "invoice.created", aggregateType: "invoice", aggregateId: "i1" });
  await deliverPending(store, { transport: fakeTransport(() => ({ statusCode: 200 })) });
  emitDomainEvent(store, { tenantId: "t1", eventType: "invoice.paid", aggregateType: "invoice", aggregateId: "i1" });
  await deliverPending(store, { transport: fakeTransport(() => ({ statusCode: 500 })) });

  const health = buildDeliveryHealth(store, "t1");
  const ep = health.endpoints[0];
  assert.ok(ep.lastSuccessAt, "laatste succes zichtbaar");
  assert.ok(ep.lastErrorAt, "laatste fout zichtbaar");
  assert.match(ep.lastError, /HTTP 500/);
  assert.equal(ep.delivered, 1);
  assert.equal(ep.failed, 1);
  assert.equal(ep.backlog, 1, "achterstand = openstaande events voor dit abonnement");
  assert.equal(health.backlogTotal, 1);
});

test("webhook: event zonder abonnees loopt de outbox niet vol", async () => {
  const store = fakeStore();
  makeWebhookRepository(store).insert("t1", { url: "https://ok.be/hook", eventTypes: ["invoice.created"] }, "admin");
  emitDomainEvent(store, { tenantId: "t1", eventType: "quote.sent", aggregateType: "quote", aggregateId: "q1" });
  const report = await deliverPending(store, { transport: fakeTransport() });
  assert.equal(report.results[0].status, "no_subscribers");
  assert.equal(listOutbox(store, { status: "pending", tenantId: "t1" }).length, 0);
});

test("webhook: dead-letter kan handmatig opnieuw in de wachtrij", async () => {
  const store = fakeStore();
  makeWebhookRepository(store).insert("t1", { url: "https://stuk.be/hook", eventTypes: ["invoice.created"] }, "admin");
  const event = emitDomainEvent(store, { tenantId: "t1", eventType: "invoice.created", aggregateType: "invoice", aggregateId: "i1" });
  const transport = fakeTransport(() => ({ statusCode: 500 }));
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    store.data.outbox.forEach(e => { e.delivery.nextAttemptAt = null; });
    await deliverPending(store, { transport });
  }
  assert.equal(store.data.outbox[0].delivery.status, "dead_letter");
  requeueEvent(store, "t1", event.id);
  assert.equal(store.data.outbox[0].delivery.status, "pending");
  assert.equal(store.data.outbox[0].delivery.attempts, 0);
  // En dan lukt het alsnog.
  const ok = await deliverPending(store, { transport: fakeTransport(() => ({ statusCode: 200 })) });
  assert.equal(ok.delivered, 1);
});

test("webhook: transport is verplicht (cloudblind · geen impliciete netwerkcall)", async () => {
  const store = fakeStore();
  await assert.rejects(() => deliverPending(store, {}), /transport/);
});
