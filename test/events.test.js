"use strict";
// Domain events + outbox (master-spec h46): ULID, envelope, lifecycle.
const { test } = require("node:test");
const assert = require("node:assert");

const { newUlid, emitDomainEvent, listOutbox, markEventDelivered, markEventFailed } = require("../src/platform/events");

function fakeStore() {
  return { data: { outbox: [] }, saves: 0, save() { this.saves++; } };
}

test("events: ULID is 26 tekens Crockford en tijd-sorteerbaar", () => {
  const a = newUlid(1000000000000);
  const b = newUlid(2000000000000);
  assert.match(a, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(a < b, "latere timestamp sorteert lexicografisch hoger");
  const set = new Set(Array.from({ length: 200 }, () => newUlid()));
  assert.equal(set.size, 200, "geen botsingen in 200 stuks");
});

test("events: emitDomainEvent bouwt de h46-envelope en valideert", () => {
  const store = fakeStore();
  const e = emitDomainEvent(store, {
    tenantId: "t1", eventType: "customer.created", aggregateType: "customer",
    aggregateId: "cust_1", actor: "admin@x.be", correlationId: "req_abc",
  });
  assert.match(e.id, /^evt_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(e.eventType, "customer.created");
  assert.equal(e.tenantId, "t1");
  assert.equal(e.companyId, null);
  assert.equal(e.aggregateType, "customer");
  assert.equal(e.correlationId, "req_abc");
  assert.equal(e.version, 1);
  assert.ok(e.occurredAt.includes("T"));
  assert.deepEqual(e.delivery, { status: "pending", attempts: 0, nextAttemptAt: null, lastError: null });
  assert.equal(store.data.outbox.length, 1);
  assert.ok(store.saves >= 1, "outbox wordt gepersisteerd");

  // Auto-correlationId als er geen request-context is.
  const e2 = emitDomainEvent(store, { tenantId: "t1", eventType: "invoice.paid", aggregateType: "invoice", aggregateId: "inv_1" });
  assert.match(e2.correlationId, /^corr_/);

  assert.throws(() => emitDomainEvent(store, { eventType: "x.y", aggregateType: "a", aggregateId: "1" }), /tenantId/);
  assert.throws(() => emitDomainEvent(store, { tenantId: "t1", eventType: "GeenPunt", aggregateType: "a", aggregateId: "1" }), /eventType/);
  assert.throws(() => emitDomainEvent(store, { tenantId: "t1", eventType: "a.b", aggregateType: "", aggregateId: "1" }), /aggregate/);
});

test("events: listOutbox filtert en geeft nieuwste eerst", () => {
  const store = fakeStore();
  emitDomainEvent(store, { tenantId: "t1", eventType: "customer.created", aggregateType: "customer", aggregateId: "c1" });
  emitDomainEvent(store, { tenantId: "t2", eventType: "invoice.paid", aggregateType: "invoice", aggregateId: "i1" });
  emitDomainEvent(store, { tenantId: "t1", eventType: "invoice.paid", aggregateType: "invoice", aggregateId: "i2" });

  assert.equal(listOutbox(store).length, 3);
  assert.equal(listOutbox(store)[0].aggregateId, "i2", "nieuwste eerst");
  assert.equal(listOutbox(store, { tenantId: "t1" }).length, 2);
  assert.equal(listOutbox(store, { eventType: "invoice.paid" }).length, 2);
  assert.equal(listOutbox(store, { status: "delivered" }).length, 0);
  assert.equal(listOutbox(store, { limit: 1 }).length, 1);
});

test("events: delivery-lifecycle met backoff en dead-letter", () => {
  const store = fakeStore();
  const e = emitDomainEvent(store, { tenantId: "t1", eventType: "quote.accepted", aggregateType: "quote", aggregateId: "q1" });

  const failed = markEventFailed(store, e.id, "timeout");
  assert.equal(failed.delivery.status, "pending");
  assert.equal(failed.delivery.attempts, 1);
  assert.ok(failed.delivery.nextAttemptAt, "backoff gepland");
  assert.equal(failed.delivery.lastError, "timeout");

  // Na maxAttempts → dead_letter.
  for (let i = 0; i < 7; i++) markEventFailed(store, e.id, "down");
  assert.equal(store.data.outbox[0].delivery.status, "dead_letter");
  assert.equal(store.data.outbox[0].delivery.nextAttemptAt, null);

  const ok = markEventDelivered(store, e.id);
  assert.equal(ok.delivery.status, "delivered");
  assert.ok(ok.delivery.deliveredAt);
  assert.equal(markEventDelivered(store, "evt_bestaatniet"), null);
});
