"use strict";
// Geverifieerde offerte-ondertekening: OTP-levenscyclus (TTL, pogingen,
// cooldown, timing-safe), adres komt ALTIJD uit het dossier, record draagt
// versie + hash + methode, terugval zonder e-mail is eerlijk ongeverifieerd.
const { test } = require("node:test");
const assert = require("node:assert");

const sign = require("../src/modules/quote-signing");

function fakeStore(data = {}) {
  const d = { quotes: [], customers: [], ...data };
  return {
    data: d,
    get(col, id) { return (d[col] || []).find(r => r.id === id) || null; },
    list(col, tid) { return (d[col] || []).filter(r => r.tenantId === tid); },
    update(col, id, patch) { d[col] = d[col].map(r => r.id === id ? { ...r, ...patch } : r); return d[col].find(r => r.id === id); },
    audit() {},
  };
}
const tenant = { id: "t1", name: "Demo Bouw BV" };
function makeQuote(store, over = {}) {
  const q = { id: "q1", tenantId: "t1", number: "OFF-2026-001", status: "verzonden", version: 2,
    documentHash: "abc123", customerId: "c1", validUntil: "2099-01-01", total: 1210, ...over };
  store.data.quotes.push(q);
  return q;
}
function withCustomer(store, email = "klant@bedrijf.be") {
  store.data.customers.push({ id: "c1", tenantId: "t1", name: "Klant NV", email });
}

test("adres komt uit het dossier: klantrecord eerst, bezoekersinput bestaat niet", () => {
  const store = fakeStore();
  withCustomer(store, "Eindklant@Bedrijf.be");
  const q = makeQuote(store);
  assert.strictEqual(sign.signerEmailFor(store, tenant, q), "Eindklant@Bedrijf.be");
  assert.strictEqual(sign.maskEmail("eindklant@bedrijf.be"), "ei•••••••@bedrijf.be");

  const zonder = fakeStore();
  const q2 = makeQuote(zonder, { customerId: null });
  assert.strictEqual(sign.signerEmailFor(zonder, tenant, q2), null, "geen dossieradres → geen verificatie mogelijk");
});

test("volledige gelukte flow: code aanvragen → verifiëren → record met hash, methode en handtekening", () => {
  const store = fakeStore();
  withCustomer(store);
  const q = makeQuote(store);

  const otp = sign.requestOtp(store, tenant, q, { now: 1000 });
  assert.match(otp.code, /^\d{6}$/);
  const bewaard = store.get("quotes", "q1");
  assert.notStrictEqual(bewaard.signing.otpHash, otp.code, "code staat gehasht, nooit leesbaar");
  assert.strictEqual(bewaard.signing.sentTo, "klant@bedrijf.be");

  const acceptance = sign.verifySignature(store, tenant, store.get("quotes", "q1"), {
    code: otp.code, name: "  Jan Ondertekenaar  ",
    signatureDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    ip: "1.2.3.4", userAgent: "Mozilla", now: 2000,
  });
  assert.strictEqual(acceptance.verified, true);
  assert.strictEqual(acceptance.method, "email-otp");
  assert.strictEqual(acceptance.name, "Jan Ondertekenaar", "naam getrimd");
  assert.strictEqual(acceptance.verifiedEmail, "klant@bedrijf.be");
  assert.strictEqual(acceptance.version, 2, "gebonden aan de versie");
  assert.strictEqual(acceptance.documentHash, "abc123", "gebonden aan de documenthash");
  assert.ok(acceptance.signature.startsWith("data:image/png"));
});

test("foute code: pogingteller loopt op, na 5 pogingen geblokkeerd; goede code blijft timing-safe", () => {
  const store = fakeStore();
  withCustomer(store);
  const q = makeQuote(store);
  sign.requestOtp(store, tenant, q, { now: 1000 });

  for (let i = 1; i <= 5; i++) {
    assert.throws(() => sign.verifySignature(store, tenant, store.get("quotes", "q1"), { code: "000000", name: "X", now: 2000 }),
      e => e.code === "OTP_INVALID" || e.code === "OTP_LOCKED");
  }
  assert.throws(() => sign.verifySignature(store, tenant, store.get("quotes", "q1"), { code: "000000", name: "X", now: 2000 }),
    e => e.code === "OTP_LOCKED", "zesde poging is hard geblokkeerd");
});

test("TTL en cooldown: verlopen code weigert; hersturen kan pas na 60 seconden", () => {
  const store = fakeStore();
  withCustomer(store);
  const q = makeQuote(store);
  const otp = sign.requestOtp(store, tenant, q, { now: 0 });

  assert.throws(() => sign.verifySignature(store, tenant, store.get("quotes", "q1"), { code: otp.code, name: "X", now: sign.OTP_TTL_MS + 1 }),
    e => e.code === "OTP_EXPIRED");
  assert.throws(() => sign.requestOtp(store, tenant, store.get("quotes", "q1"), { now: 30 * 1000 }),
    e => e.code === "OTP_COOLDOWN" && e.retryAfterSeconds > 0);
  const opnieuw = sign.requestOtp(store, tenant, store.get("quotes", "q1"), { now: 61 * 1000 });
  assert.match(opnieuw.code, /^\d{6}$/, "na de cooldown komt er een nieuwe code");
});

test("guards: verwerkte en verlopen offertes zijn niet ondertekenbaar; handtekening gevalideerd", () => {
  const store = fakeStore();
  withCustomer(store);
  assert.throws(() => sign.requestOtp(store, tenant, makeQuote(store, { id: "qA", status: "aanvaard" })), e => e.code === "QUOTE_PROCESSED");
  assert.throws(() => sign.requestOtp(store, tenant, makeQuote(store, { id: "qB", validUntil: "2020-01-01" })), e => e.code === "QUOTE_EXPIRED");

  const q = makeQuote(store, { id: "qC" });
  const otp = sign.requestOtp(store, tenant, q, { now: 1000 });
  assert.throws(() => sign.verifySignature(store, tenant, store.get("quotes", "qC"), { code: otp.code, name: "", now: 2000 }), e => e.code === "NAME_REQUIRED");
  assert.throws(() => sign.verifySignature(store, tenant, store.get("quotes", "qC"), { code: otp.code, name: "X", signatureDataUrl: "data:text/html;base64,x", now: 2000 }), e => e.code === "SIGNATURE_INVALID");
});

test("ondertekeningsbewijs: dossier zonder gevoelige inhoud, e-mail gemaskeerd", () => {
  const store = fakeStore();
  const q = makeQuote(store, {
    status: "aanvaard",
    acceptance: { name: "Jan", at: "2026-07-20T20:00:00Z", version: 2, documentHash: "abc123", verified: true, method: "email-otp", verifiedEmail: "klant@bedrijf.be", signature: "data:image/png;base64,x", ip: "1.2.3.4", userAgent: "UA" },
  });
  const r = sign.acceptanceReceipt(q, tenant);
  assert.strictEqual(r.signer.verified, true);
  assert.strictEqual(r.signer.verifiedEmail, "kl•••@bedrijf.be", "nooit het volledige adres in het bewijs");
  assert.strictEqual(r.signer.hasDrawnSignature, true);
  assert.strictEqual(r.document.documentHash, "abc123");
  assert.throws(() => sign.acceptanceReceipt(makeQuote(store, { id: "q9", status: "verzonden" }), tenant), e => e.code === "NOT_SIGNED");
});
