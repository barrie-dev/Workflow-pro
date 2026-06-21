"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { mergeSubscription, saveSubscription, removeSubscription } = require("../src/modules/push");
const { pushRecipients } = require("../src/modules/notifications");

function subscription(endpoint = "https://push.example/sub-1") {
  return { endpoint, keys: { p256dh: "p256dh-key", auth: "auth-secret" } };
}

test("push: subscription merge dedupliceert op endpoint", () => {
  const first = subscription();
  const merged = mergeSubscription([first], { ...subscription(), keys: { p256dh: "new-key", auth: "new-auth" } });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].keys.p256dh, "new-key");
});

test("push: saveSubscription vereist endpoint en browser crypto keys", () => {
  const user = { id: "u1", pushSubscriptions: [] };
  const writes = [];
  const store = { update: (collection, id, patch) => writes.push({ collection, id, patch }) || { ...user, ...patch } };

  assert.throws(() => saveSubscription(store, user, { endpoint: "https://push.example/sub-1", keys: {} }), /Ongeldig/);
  const result = saveSubscription(store, user, subscription());
  assert.equal(result.count, 1);
  assert.equal(writes[0].collection, "users");
  assert.equal(writes[0].patch.pushSubscriptions[0].endpoint, "https://push.example/sub-1");
});

test("push: recipients volgen audience en toestel-opt-in", () => {
  const store = { data: { users: [
    { id: "a1", tenantId: "t1", role: "tenant_admin", active: true, pushSubscriptions: [subscription("https://push.example/a1")] },
    { id: "m1", tenantId: "t1", role: "manager", active: true, pushSubscriptions: [subscription("https://push.example/m1")] },
    { id: "e1", tenantId: "t1", role: "employee", active: true },
    { id: "x1", tenantId: "t2", role: "tenant_admin", active: true, pushSubscriptions: [subscription("https://push.example/x1")] }
  ] } };
  assert.deepEqual(pushRecipients(store, "t1", { audience: "admins" }).map(u => u.id), ["a1"]);
  assert.deepEqual(pushRecipients(store, "t1", { audience: "managers" }).map(u => u.id), ["m1"]);
  assert.deepEqual(pushRecipients(store, "t1", { audience: "all" }).map(u => u.id), ["a1", "m1"]);
});

test("push: removeSubscription verwijdert enkel gekozen endpoint", () => {
  const user = { id: "u1", pushSubscriptions: [subscription("https://push.example/a"), subscription("https://push.example/b")] };
  const writes = [];
  const store = { update: (collection, id, patch) => writes.push({ collection, id, patch }) || { ...user, ...patch } };
  const result = removeSubscription(store, user, "https://push.example/a");
  assert.equal(result.count, 1);
  assert.equal(writes[0].patch.pushSubscriptions[0].endpoint, "https://push.example/b");
});
