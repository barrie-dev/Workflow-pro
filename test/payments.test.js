"use strict";
// Betalingen + allocatie (h45 · sluitstuk lead-to-cash): registratie,
// toewijzing met dubbele bewaking (betalingsbedrag + openstaand saldo),
// deelbetalingen, compensatie met reden, voorstel-matching.
const { test } = require("node:test");
const assert = require("node:assert");

const pay = require("../src/platform/payments");

function fakeStore(data = {}) {
  const d = { payments: [], invoices: [], customers: [], auditRows: [], ...data };
  return {
    data: d,
    list(col, tid) { return (d[col] || []).filter(r => r.tenantId === tid); },
    get(col, id) { return (d[col] || []).find(r => r.id === id) || null; },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    update(col, id, patch) { d[col] = d[col].map(r => r.id === id ? { ...r, ...patch } : r); return d[col].find(r => r.id === id); },
    audit(row) { d.auditRows.push(row); },
    save() {},
  };
}
const tenant = { id: "t1" };
const user = { email: "admin@x.be" };
function invoice(store, over = {}) {
  return store.insert("invoices", {
    id: over.id || `inv_${Math.random().toString(36).slice(2, 8)}`, tenantId: "t1",
    number: over.number || "2026-001", status: "open", total: 1000,
    invoiceDate: "2026-07-01", structuredComm: "+++090/9337/55493+++", customerId: "c1", ...over,
  });
}
function payment(store, over = {}) {
  return pay.registerPayment(store, tenant, user, { amount: 1000, method: "bank", date: "2026-07-10", ...over });
}

test("registratie: bedrag/methode/datum gevalideerd, bedragen op de cent genormaliseerd", () => {
  const store = fakeStore();
  assert.throws(() => pay.registerPayment(store, tenant, user, { amount: 0 }), /groter zijn dan nul/);
  assert.throws(() => pay.registerPayment(store, tenant, user, { amount: 10, method: "cheque" }), /Methode/);
  assert.throws(() => pay.registerPayment(store, tenant, user, { amount: 10, date: "10-07-2026" }), /YYYY-MM-DD/);
  const p = pay.registerPayment(store, tenant, user, { amount: 100.005, method: "bank" });
  assert.strictEqual(p.amount, 100.01, "afgerond op de cent");
  assert.strictEqual(p.status, "unallocated");
  assert.strictEqual(p.unallocatedAmount, 100.01);
});

test("h45-kern: allocatie dekt de factuur → betaald; deelbetaling laat hem open", () => {
  const store = fakeStore();
  const inv = invoice(store, { total: 1000 });
  const p1 = payment(store, { amount: 400 });
  const r1 = pay.allocatePayment(store, tenant, user, p1.id, [{ invoiceId: inv.id, amount: 400 }]);
  assert.strictEqual(r1.invoicesPaid.length, 0, "deelbetaling → nog niet betaald");
  assert.strictEqual(store.get("invoices", inv.id).status, "open");
  assert.strictEqual(pay.invoicePaymentState(store, "t1", inv).openAmount, 600);

  const p2 = payment(store, { amount: 600 });
  const r2 = pay.allocatePayment(store, tenant, user, p2.id, [{ invoiceId: inv.id, amount: 600 }]);
  assert.strictEqual(r2.invoicesPaid.length, 1, "saldo nul → betaald");
  assert.strictEqual(store.get("invoices", inv.id).status, "paid");
  assert.ok(store.get("invoices", inv.id).paidAt);
  assert.strictEqual(pay.invoicePaymentState(store, "t1", inv).payments.length, 2, "beide betalingen zichtbaar in de drill-down");
});

test("één betaling over meerdere facturen; overallocatie op beide assen geblokkeerd", () => {
  const store = fakeStore();
  const a = invoice(store, { id: "invA", number: "2026-001", total: 300 });
  const b = invoice(store, { id: "invB", number: "2026-002", total: 200 });
  const p = payment(store, { amount: 450 });

  // Boven het openstaande saldo van de factuur → 409 met het saldo erbij.
  assert.throws(() => pay.allocatePayment(store, tenant, user, p.id, [{ invoiceId: a.id, amount: 301 }]),
    e => e.code === "OVER_ALLOCATION" && e.outstanding === 300);
  // Boven het niet-toegewezen deel van de betaling → 409.
  assert.throws(() => pay.allocatePayment(store, tenant, user, p.id, [
    { invoiceId: a.id, amount: 300 }, { invoiceId: b.id, amount: 200 },
  ]), e => e.code === "PAYMENT_EXHAUSTED");

  const r = pay.allocatePayment(store, tenant, user, p.id, [
    { invoiceId: a.id, amount: 300 }, { invoiceId: b.id, amount: 150 },
  ]);
  assert.strictEqual(r.invoicesPaid.map(i => i.id).join(","), "invA", "A volledig, B deels");
  assert.strictEqual(r.payment.status, "allocated");
  assert.strictEqual(r.payment.unallocatedAmount, 0);
  // Dubbele factuur binnen één call telt de eerdere regel mee.
  const p2 = payment(store, { amount: 100 });
  assert.throws(() => pay.allocatePayment(store, tenant, user, p2.id, [
    { invoiceId: b.id, amount: 40 }, { invoiceId: b.id, amount: 20 },
  ]), e => e.code === "OVER_ALLOCATION", "B heeft nog maar 50 open");
});

test("terugdraaien is compensatie: reden verplicht, historiek blijft, factuur valt terug naar open", () => {
  const store = fakeStore();
  const inv = invoice(store, { total: 500 });
  const p = payment(store, { amount: 500 });
  const r = pay.allocatePayment(store, tenant, user, p.id, [{ invoiceId: inv.id, amount: 500 }]);
  assert.strictEqual(store.get("invoices", inv.id).status, "paid");
  const allocId = r.allocations[0].id;

  assert.throws(() => pay.reverseAllocation(store, tenant, user, p.id, allocId, ""), /reden/i);
  const rev = pay.reverseAllocation(store, tenant, user, p.id, allocId, "verkeerde factuur");
  assert.ok(rev.allocation.reversedAt, "niet verwijderd maar gemarkeerd");
  assert.strictEqual(rev.allocation.reason, "verkeerde factuur");
  assert.strictEqual(rev.invoiceReopened.id, inv.id, "volledig gedekte factuur valt terug");
  assert.strictEqual(store.get("invoices", inv.id).status, "open");
  assert.strictEqual(store.get("invoices", inv.id).paidAt, null);
  assert.strictEqual(rev.payment.unallocatedAmount, 500, "bedrag komt vrij voor een nieuwe toewijzing");
  assert.throws(() => pay.reverseAllocation(store, tenant, user, p.id, allocId, "nogmaals"), e => e.code === "ALREADY_REVERSED");
});

test("gecrediteerde facturen zijn niet toewijsbaar; onbekende factuur → 404", () => {
  const store = fakeStore();
  const inv = invoice(store, { status: "gecrediteerd" });
  const p = payment(store, { amount: 100 });
  assert.throws(() => pay.allocatePayment(store, tenant, user, p.id, [{ invoiceId: inv.id, amount: 100 }]), e => e.code === "INVOICE_CREDITED");
  assert.throws(() => pay.allocatePayment(store, tenant, user, p.id, [{ invoiceId: "inv_x", amount: 100 }]), e => e.code === "INVOICE_NOT_FOUND");
});

test("voorstellen: gestructureerde mededeling wint, daarna oudste open factuur, tot de betaling op is", () => {
  const store = fakeStore();
  invoice(store, { id: "oud", number: "2026-001", total: 300, invoiceDate: "2026-05-01", structuredComm: "+++111/1111/11111+++" });
  invoice(store, { id: "match", number: "2026-002", total: 500, invoiceDate: "2026-06-01", structuredComm: "+++090/9337/55493+++" });
  invoice(store, { id: "nieuw", number: "2026-003", total: 400, invoiceDate: "2026-07-01", structuredComm: "+++222/2222/22222+++" });
  const p = payment(store, { amount: 600, reference: "090/9337/55493" });

  const s = pay.suggestAllocations(store, tenant, p.id);
  assert.strictEqual(s[0].invoiceId, "match", "referentie-match eerst");
  assert.strictEqual(s[0].matchedBy, "structured_communication");
  assert.strictEqual(s[0].amount, 500);
  assert.strictEqual(s[1].invoiceId, "oud", "daarna oudste open");
  assert.strictEqual(s[1].amount, 100, "beperkt tot het restant van de betaling");
  assert.strictEqual(s.length, 2, "betaling is op · geen derde voorstel");
});
