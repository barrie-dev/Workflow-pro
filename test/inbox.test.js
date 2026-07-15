"use strict";
// E-mail-intake: payload-normalisatie, tenant-resolutie en klantvraag-aanmaak.
const { test } = require("node:test");
const assert = require("node:assert");

const { parseInboundPayload, resolveIntakeTenant, createInquiry, splitAddress, stripHtml } = require("../src/modules/inbox");

// Minimale in-memory store met dezelfde interface als lib/store.
function fakeStore() {
  const data = { tenants: [{ id: "t1", name: "Demo", intake: { token: "abc123def456", enabled: true } }], inquiries: [], customers: [{ id: "c1", tenantId: "t1", name: "Bouw NV", email: "Info@Bouw.be" }] };
  return {
    data,
    list(col, tenantId) { return (data[col] || []).filter(r => r.tenantId === tenantId); },
    insert(col, row) { data[col].push(row); return row; },
    audit() {},
  };
}

test("inbox: splitAddress en stripHtml", () => {
  assert.deepEqual(splitAddress('Jan Peeters <Jan@Bouw.be>'), { name: "Jan Peeters", email: "jan@bouw.be" });
  assert.deepEqual(splitAddress("jan@bouw.be"), { name: "", email: "jan@bouw.be" });
  assert.equal(stripHtml("<p>Dag,</p><p>graag een <b>offerte</b>.</p>"), "Dag,\ngraag een offerte.");
});

test("inbox: parseInboundPayload is provider-agnostisch", () => {
  // Mailgun-vorm
  const mg = parseInboundPayload({ from: "Jan <jan@bouw.be>", recipient: "abc123def456@in.monargo.com", subject: "Offerte terras", "body-plain": "Graag prijs voor 40m2.", "Message-Id": "<m1@mailgun>" });
  assert.equal(mg.fromEmail, "jan@bouw.be");
  assert.equal(mg.fromName, "Jan");
  assert.equal(mg.to, "abc123def456@in.monargo.com");
  assert.equal(mg.subject, "Offerte terras");
  assert.equal(mg.text, "Graag prijs voor 40m2.");
  assert.equal(mg.messageId, "<m1@mailgun>");

  // Postmark-vorm (ToFull-array, TextBody, MessageID)
  const pm = parseInboundPayload({ From: "an@klant.be", ToFull: [{ Email: "abc123def456@in.monargo.com" }], Subject: "Vraag", TextBody: "Wanneer kunnen jullie langskomen?", MessageID: "pm-1" });
  assert.equal(pm.fromEmail, "an@klant.be");
  assert.equal(pm.to, "abc123def456@in.monargo.com");
  assert.equal(pm.messageId, "pm-1");

  // SendGrid-vorm + HTML-fallback zonder platte tekst
  const sg = parseInboundPayload({ from: "piet@x.be", to: "abc123def456@in.monargo.com", subject: "", html: "<p>Lek in dak</p>" });
  assert.equal(sg.subject, "(geen onderwerp)");
  assert.equal(sg.text, "Lek in dak");

  assert.throws(() => parseInboundPayload({ to: "x@y.be", subject: "s" }), /afzendadres/);
  assert.throws(() => parseInboundPayload({ from: "a@b.be", subject: "s" }), /ontvangstadres/);
});

test("inbox: resolveIntakeTenant matcht token en respecteert enabled", () => {
  const store = fakeStore();
  assert.equal(resolveIntakeTenant(store, "abc123def456@in.monargo.com").id, "t1");
  assert.equal(resolveIntakeTenant(store, "ABC123DEF456@in.monargo.com").id, "t1", "case-insensitief");
  assert.equal(resolveIntakeTenant(store, "onbekend@in.monargo.com"), null);
  store.data.tenants[0].intake.enabled = false;
  assert.equal(resolveIntakeTenant(store, "abc123def456@in.monargo.com"), null, "uitgeschakelde intake matcht niet");
});

test("inbox: createInquiry koppelt klant en is idempotent op Message-Id", () => {
  const store = fakeStore();
  const tenant = store.data.tenants[0];
  const mail = { fromEmail: "info@bouw.be", fromName: "Bouw NV", subject: "Offerte", text: "Prijs?", messageId: "<m1>" };

  const r1 = createInquiry(store, tenant, mail);
  assert.equal(r1.duplicate, false);
  assert.equal(r1.inquiry.customerId, "c1", "klant gematcht op afzendadres (case-insensitief)");
  assert.equal(r1.inquiry.customerName, "Bouw NV");
  assert.equal(r1.inquiry.status, "nieuw");

  const r2 = createInquiry(store, tenant, mail);
  assert.equal(r2.duplicate, true, "zelfde Message-Id = duplicaat");
  assert.equal(store.data.inquiries.length, 1);

  const r3 = createInquiry(store, tenant, { ...mail, fromEmail: "onbekend@elders.be", messageId: "<m2>" });
  assert.equal(r3.inquiry.customerId, null, "onbekend adres = niet gekoppeld");
  assert.equal(store.data.inquiries.length, 2);
});
