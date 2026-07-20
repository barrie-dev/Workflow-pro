"use strict";
// Idempotency-Key (h41). Acceptatiecriterium uit de spec, letterlijk:
// "Een herhaalde POST met dezelfde idempotency key creëert geen duplicaat."
// De e2e-smoke (test/e2e/idempotency-smoke.js) bewijst dit tegen de echte
// server; hier bewijzen we de bouwstenen en hun randgevallen.
const { test } = require("node:test");
const assert = require("node:assert");

const idem = require("../src/lib/idempotency");

function fakeStore() {
  return { data: {}, saved: 0, save() { this.saved++; } };
}
function keyFor(overrides = {}) {
  return idem.cacheKeyFor({ tenantId: "t1", actorId: "u1", method: "POST", path: "/api/tenants/t1/customers", key: "abc", ...overrides });
}

test("h41 acceptatie: herhaalde POST met dezelfde sleutel geeft de eerste response terug (geen tweede uitvoering)", () => {
  const store = fakeStore();
  const cacheKey = keyFor();

  // Eerste request: geen replay → route voert uit en legt de response vast.
  assert.strictEqual(idem.findReplay(store, cacheKey), null);
  idem.recordResponse(store, cacheKey, { status: 201, payload: { ok: true, customer: { id: "cust_1", name: "Aannemer BV" } } });

  // Herhaalde request: replay gevonden, byte-gelijk aan het origineel.
  const replay = idem.findReplay(store, cacheKey);
  assert.ok(replay, "replay moet gevonden worden");
  assert.strictEqual(replay.status, 201);
  assert.deepStrictEqual(JSON.parse(replay.body), { ok: true, customer: { id: "cust_1", name: "Aannemer BV" } });

  // Nogmaals vastleggen onder dezelfde sleutel wijzigt niets (eerste wint).
  idem.recordResponse(store, cacheKey, { status: 201, payload: { ok: true, customer: { id: "cust_2" } } });
  assert.strictEqual(JSON.parse(idem.findReplay(store, cacheKey).body).customer.id, "cust_1");
  assert.strictEqual(store.data[idem.COLLECTION].length, 1, "geen duplicaat in de sleutelopslag");
});

test("sleutelscope: tenant, actor, methode en pad isoleren dezelfde sleutelwaarde", () => {
  const base = keyFor();
  assert.notStrictEqual(keyFor({ tenantId: "t2" }), base, "andere tenant → andere cache-sleutel");
  assert.notStrictEqual(keyFor({ actorId: "u2" }), base, "andere gebruiker → andere cache-sleutel");
  assert.notStrictEqual(keyFor({ method: "PATCH" }), base, "andere methode → andere cache-sleutel");
  assert.notStrictEqual(keyFor({ path: "/api/tenants/t1/projects" }), base, "ander pad → andere cache-sleutel");
  assert.strictEqual(keyFor(), base, "identieke input → deterministisch dezelfde sleutel");
});

test("alleen succesvolle responses worden vastgelegd: fouten mogen opnieuw uitgevoerd worden", () => {
  const store = fakeStore();
  idem.recordResponse(store, keyFor({ key: "k400" }), { status: 400, payload: { ok: false, error: "Ongeldig" } });
  idem.recordResponse(store, keyFor({ key: "k500" }), { status: 500, payload: { ok: false, error: "Serverfout" } });
  assert.strictEqual((store.data[idem.COLLECTION] || []).length, 0, "4xx/5xx niet vastgelegd");
  assert.strictEqual(idem.findReplay(store, keyFor({ key: "k400" })), null, "een retry na een fout voert opnieuw uit");
});

test("verlopen sleutels spelen niet terug en worden opgeruimd", () => {
  const store = fakeStore();
  const cacheKey = keyFor({ key: "oud" });
  const lang_geleden = Date.now() - (idem.TTL_HOURS + 1) * 3600000;
  idem.recordResponse(store, cacheKey, { status: 200, payload: { ok: true } }, lang_geleden);

  assert.strictEqual(idem.findReplay(store, cacheKey), null, "verlopen → opnieuw uitvoeren");
  assert.strictEqual(idem.pruneExpired(store), 1, "opruimronde verwijdert de verlopen sleutel");
  assert.strictEqual(store.data[idem.COLLECTION].length, 0);
  assert.strictEqual(idem.pruneExpired(store), 0, "niets meer te ruimen");
});

test("headerparsing: afwezig, leeg of absurd lang wordt genegeerd", () => {
  assert.strictEqual(idem.idempotencyKeyFrom({ headers: {} }), null);
  assert.strictEqual(idem.idempotencyKeyFrom({ headers: { "idempotency-key": "   " } }), null);
  assert.strictEqual(idem.idempotencyKeyFrom({ headers: { "idempotency-key": "x".repeat(300) } }), null);
  assert.strictEqual(idem.idempotencyKeyFrom({ headers: { "idempotency-key": " sleutel-1 " } }), "sleutel-1", "whitespace getrimd");
});
