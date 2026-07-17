"use strict";
// Offerteversies (master-spec h19/E05): documenthash, bevriezen, revisie, diff.
const { test } = require("node:test");
const assert = require("node:assert");

const { computeDocumentHash, freezeSentVersion, reviseQuote, diffVersions, computeTotals } = require("../src/platform/quote-versions");

const baseQuote = () => ({
  id: "quote_1", number: "OFF-2026-001", version: 1, customerName: "Bouw NV",
  lines: [{ description: "Werk", qty: 2, unitPrice: 100, vatRate: 21 }],
  subtotal: 200, vatAmount: 42, total: 242, notes: "", versions: [], sentAt: null,
});

test("offerteversies: documenthash is deterministisch en inhoudsgevoelig", () => {
  const q = baseQuote();
  const h1 = computeDocumentHash(q);
  const h2 = computeDocumentHash({ ...q, updatedAt: "andere-timestamp" }); // niet-bindend veld
  assert.equal(h1, h2, "niet-bindende velden veranderen de hash niet");
  assert.match(h1, /^sha256:[0-9a-f]{64}$/);
  const h3 = computeDocumentHash({ ...q, lines: [{ description: "Werk", qty: 3, unitPrice: 100, vatRate: 21 }] });
  assert.notEqual(h1, h3, "inhoudswijziging verandert de hash");
});

test("offerteversies: freezeSentVersion bevriest idempotent met hash", () => {
  const q = baseQuote();
  const { patch, snapshot } = freezeSentVersion(q, "2026-07-17T10:00:00Z");
  assert.equal(patch.versions.length, 1);
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.sentAt, "2026-07-17T10:00:00Z");
  assert.match(snapshot.hash, /^sha256:/);
  assert.equal(patch.documentHash, snapshot.hash);

  // Nogmaals bevriezen (zelfde versie) → geen duplicaat.
  const again = freezeSentVersion({ ...q, versions: patch.versions }, "2026-07-17T11:00:00Z");
  assert.equal(again.patch.versions.length, 1);
  assert.equal(again.snapshot.sentAt, "2026-07-17T10:00:00Z", "bestaande snapshot behouden");
});

test("offerteversies: reviseQuote maakt versie+1 en bewaart de vorige onveranderd", () => {
  const q = baseQuote();
  const sent = freezeSentVersion(q, "2026-07-17T10:00:00Z");
  const quoteSent = { ...q, versions: sent.patch.versions, documentHash: sent.patch.documentHash, sentAt: "2026-07-17T10:00:00Z", status: "verzonden" };

  const patch = reviseQuote(quoteSent, [{ description: "Meer werk", qty: 4, unitPrice: 100, vatRate: 21 }]);
  assert.equal(patch.version, 2);
  assert.equal(patch.status, "concept");
  assert.equal(patch.sentAt, null);
  assert.equal(patch.total, 484);
  assert.equal(patch.versions.length, 1, "vorige verzonden versie blijft bewaard");
  assert.equal(patch.versions[0].version, 1);
  assert.equal(patch.versions[0].total, 242, "snapshot v1 ongewijzigd");

  // Revisie van een nooit-verzonden offerte → 409.
  assert.throws(() => reviseQuote(baseQuote(), [{ description: "x", qty: 1, unitPrice: 1 }]), /NO_SENT_VERSION|niet verzonden/);
  // Revisie zonder lijnen → 400.
  assert.throws(() => reviseQuote(quoteSent, []), /offerteregel/);
});

test("offerteversies: diffVersions toont het verschil", () => {
  const d = diffVersions({ version: 1, total: 242, lines: [{}] }, { version: 2, total: 484, lines: [{}, {}] });
  assert.equal(d.fromVersion, 1);
  assert.equal(d.toVersion, 2);
  assert.equal(d.totalDelta, 242);
  assert.equal(d.lineCountDelta, 1);
});

test("offerteversies: computeTotals rekent btw en afronding correct", () => {
  const { lines, subtotal, vatAmount, total } = computeTotals([{ description: "x", qty: 3, unitPrice: 33.33, vatRate: 6 }]);
  assert.equal(subtotal, 99.99);
  assert.equal(vatAmount, 6);
  assert.equal(total, 105.99);
  assert.equal(lines[0].lineTotal, 105.99);
});
