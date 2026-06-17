"use strict";
// Unit-tests voor pure businesslogica (geen store/HTTP nodig).
const { test } = require("node:test");
const assert = require("node:assert");

const { lookupKbo, normalizeVat } = require("../src/modules/kbo");
const {
  buildSupportGrant, issueSupportToken, supportGrantStatus, slideSupportGrant,
  assertSupportWrite, SUPPORT_IDLE_MS, SUPPORT_HARD_MS
} = require("../src/lib/auth");

test("normalizeVat voegt BE-prefix toe en strijkt opmaak glad", () => {
  assert.equal(normalizeVat("0123456789"), "BE0123456789");
  assert.equal(normalizeVat("BE0123456789"), "BE0123456789");
  assert.equal(normalizeVat("be 0123.456.789"), "BE0123456789");
  assert.equal(normalizeVat(""), "");
});

test("lookupKbo fixture geeft volledige bedrijfsgegevens", () => {
  const r = lookupKbo("BE0123456789");
  assert.equal(r.name, "Demo Bouwgroep NV");
  assert.equal(r.companyNumber, "0123456789");
  assert.ok(r.street && r.city, "fixture moet straat + stad bevatten");
});

test("lookupKbo fallback: companyNumber afgeleid, adres leeg", () => {
  const r = lookupKbo("BE0999999999");
  assert.equal(r.companyNumber, "0999999999");
  assert.equal(r.street, "");
  assert.equal(r.city, "");
  // bevestigt waarom de golden-path KBO-stap (street||city vereist) faalt op fallback
});

// ── GDPR support-impersonatie: grant-levenscyclus (pure logica) ──
test("support-grant: vorm + scope-normalisatie + token-exp = harde limiet", () => {
  const now = Date.UTC(2026, 5, 1, 9, 0, 0);
  const g = buildSupportGrant({ impersonatedUserId: "u1", agent: "agent@wf.be", scope: "rommel", now });
  assert.equal(g.scope, "read", "onbekende scope valt terug op read");
  assert.ok(g.grantId.startsWith("support_"));
  assert.equal(new Date(g.expiresAt).getTime(), now + SUPPORT_IDLE_MS, "idle-venster");
  assert.equal(new Date(g.hardExpiresAt).getTime(), now + SUPPORT_HARD_MS, "harde limiet");
  assert.ok(new Date(g.expiresAt) < new Date(g.hardExpiresAt));

  const token = issueSupportToken({ ...g, scope: "write" }, "t1");
  const body = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
  assert.equal(body.support, true);
  assert.equal(body.scope, "write");
  assert.equal(body.grantId, g.grantId);
  assert.equal(body.exp, new Date(g.hardExpiresAt).getTime(), "token verloopt op de harde limiet");
});

test("support-grant: status valid / idle-verlopen / hard-verlopen / mismatch / beëindigd", () => {
  const now = Date.UTC(2026, 5, 1, 9, 0, 0);
  const g = buildSupportGrant({ impersonatedUserId: "u1", agent: "a", scope: "read", now });
  const ok = supportGrantStatus(g, { grantId: g.grantId }, now + 60_000);
  assert.equal(ok.ok, true, "binnen idle + hard → geldig");

  const idle = supportGrantStatus(g, { grantId: g.grantId }, now + SUPPORT_IDLE_MS + 1);
  assert.equal(idle.ok, false, "na inactiviteit verlopen");

  const hard = supportGrantStatus(g, { grantId: g.grantId }, now + SUPPORT_HARD_MS + 1);
  assert.equal(hard.ok, false, "na harde limiet verlopen");

  const mismatch = supportGrantStatus(g, { grantId: "ander" }, now + 1000);
  assert.equal(mismatch.ok, false, "grantId moet matchen");

  const ended = supportGrantStatus({ ...g, endedAt: new Date(now).toISOString() }, { grantId: g.grantId }, now + 1000);
  assert.equal(ended.ok, false, "beëindigde grant is ongeldig");
});

test("support-grant: sliding renew schuift op maar nooit voorbij de harde limiet", () => {
  const now = Date.UTC(2026, 5, 1, 9, 0, 0);
  const g = buildSupportGrant({ impersonatedUserId: "u1", agent: "a", scope: "read", now });

  const slidEarly = slideSupportGrant(g, now + 5 * 60_000);
  assert.equal(new Date(slidEarly.expiresAt).getTime(), now + 5 * 60_000 + SUPPORT_IDLE_MS, "verschuift mee met activiteit");

  // activiteit vlak voor de harde limiet → idle-venster wordt afgekapt op hard
  const nearHard = now + SUPPORT_HARD_MS - 60_000;
  const slidLate = slideSupportGrant(g, nearHard);
  assert.equal(new Date(slidLate.expiresAt).getTime(), now + SUPPORT_HARD_MS, "afgekapt op harde limiet");
});

test("support-scope: read-sessie blokkeert schrijven, write mag, GET altijd, gewone user vrij", () => {
  const read = { isSupportSession: true, support: { scope: "read" } };
  const write = { isSupportSession: true, support: { scope: "write" } };
  assert.doesNotThrow(() => assertSupportWrite(read, "GET"), "read mag lezen");
  assert.throws(() => assertSupportWrite(read, "POST"), e => e.status === 403, "read blokkeert schrijven");
  assert.throws(() => assertSupportWrite(read, "DELETE"), e => e.status === 403);
  assert.doesNotThrow(() => assertSupportWrite(write, "POST"), "write mag schrijven");
  assert.doesNotThrow(() => assertSupportWrite({}, "DELETE"), "niet-support-user onaangeroerd");
});
