"use strict";
// Creditnota's + bronlijnen (master-spec h30/E08).
const { test } = require("node:test");
const assert = require("node:assert");

const { createCustomerInvoice, createCreditNote } = require("../src/modules/customer-invoicing");

// Minimale store met de collecties + numberSequences/companies voor issueNumber.
function fakeStore() {
  const data = { invoices: [], companies: [{ id: "co_1", tenantId: "t1", isDefault: true }], numberSequences: [], auditLogs: [], outbox: [] };
  return {
    data,
    list(col, tid) { return (data[col] || []).filter(r => r.tenantId === tid); },
    insert(col, row) { (data[col] = data[col] || []).push(row); return row; },
    update(col, id, patch) { data[col] = data[col].map(r => r.id === id ? { ...r, ...patch } : r); return data[col].find(r => r.id === id); },
    get(col, id) { return (data[col] || []).find(r => r.id === id); },
    audit() {}, save() {},
  };
}
const TENANT = { id: "t1", name: "Demo BV" };
const USER = { email: "admin@x.be" };

test("factuur v2: lijnen dragen bronmetadata (default manual)", () => {
  const store = fakeStore();
  const inv = createCustomerInvoice(store, TENANT, USER, { customerName: "K", lines: [{ description: "Werk", qty: 1, unitPrice: 100 }] });
  assert.equal(inv.lines[0].sourceType, "manual");
  assert.equal(inv.lines[0].sourceId, null);

  const inv2 = createCustomerInvoice(store, TENANT, USER, { customerName: "K", lines: [{ description: "Uit offerte", qty: 1, unitPrice: 100, sourceType: "quote", sourceId: "quote_9" }] });
  assert.equal(inv2.lines[0].sourceType, "quote");
  assert.equal(inv2.lines[0].sourceId, "quote_9");
});

test("factuur v2: volledige creditnota keert om en markeert het origineel", () => {
  const store = fakeStore();
  const inv = createCustomerInvoice(store, TENANT, USER, { customerName: "Bouw NV", lines: [{ description: "Werk", qty: 2, unitPrice: 100, vatRate: 21 }] });
  assert.equal(inv.total, 242);

  const cn = createCreditNote(store, TENANT, USER, inv, { reason: "Foutieve factuur" });
  assert.equal(cn.docType, "credit_note");
  assert.match(cn.number, /^CN-\d{4}-\d{3}$/);
  assert.equal(cn.creditOf, inv.id);
  assert.equal(cn.creditOfNumber, inv.number);
  assert.equal(cn.total, -242, "bedrag omgekeerd");
  assert.equal(cn.lines[0].qty, -2);
  assert.equal(cn.lines[0].sourceType, "credit");
  assert.match(cn.notes, /Foutieve factuur/);

  // Origineel is nu gecrediteerd en gelinkt.
  const orig = store.get("invoices", inv.id);
  assert.equal(orig.status, "gecrediteerd");
  assert.equal(orig.creditNoteId, cn.id);

  // Domain event invoice.credited geëmit.
  assert.ok(store.data.outbox.some(e => e.eventType === "invoice.credited" && e.aggregateId === inv.id));

  // Idempotent: tweede volledige credit → 409.
  assert.throws(() => createCreditNote(store, TENANT, USER, store.get("invoices", inv.id), {}), /gecrediteerd/);
});

test("factuur v2: gedeeltelijke creditnota crediteert alleen gekozen lijnen", () => {
  const store = fakeStore();
  const inv = createCustomerInvoice(store, TENANT, USER, { customerName: "K", lines: [
    { description: "Uren", qty: 8, unitPrice: 50, vatRate: 21 },
    { description: "Materiaal", qty: 1, unitPrice: 200, vatRate: 21 },
  ] });
  const cn = createCreditNote(store, TENANT, USER, inv, { lineIndexes: [1] });
  assert.equal(cn.lines.length, 1);
  assert.equal(cn.lines[0].unitPrice, 200);
  assert.equal(cn.total, -242, "alleen de materiaallijn (200 + 21%)");

  // Gedeeltelijk → origineel NIET volledig gecrediteerd, wel gelinkt in creditNotes[].
  const orig = store.get("invoices", inv.id);
  assert.notEqual(orig.status, "gecrediteerd");
  assert.deepEqual(orig.creditNotes, [cn.id]);
  // Tweede gedeeltelijke credit mag nog.
  const cn2 = createCreditNote(store, TENANT, USER, store.get("invoices", inv.id), { lineIndexes: [0] });
  assert.equal(cn2.total, -484);
});
