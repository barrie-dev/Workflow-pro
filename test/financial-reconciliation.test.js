"use strict";
// Financiële reconciliatie (h51 scenario 6, lokaal afdwingbaar deel):
// het gerenderde document, het factuur-aggregaat en de UBL vertellen
// ALLE DRIE hetzelfde verhaal · totalen, btw per tarief en regelbedragen.
// Plus: een Peppol-fout laat een spoor na (status/reden/pogingteller).
const { test } = require("node:test");
const assert = require("node:assert");

const { buildUbl, validatePeppol, sendPeppolInvoice } = require("../src/modules/peppol-invoice");
const tpl = require("../src/modules/templates");

const tenant = {
  id: "t1", name: "Demo Bouw BV", vatNumber: "BE0776834537",
  invoiceProfile: { name: "Demo Bouw BV", vat: "BE0776834537", street: "Dorpstraat 1", zip: "9000", city: "Gent", iban: "BE71 0961 2345 6769" },
};

// Gemengde tarieven (21/6/0) met expliciete regelbedragen zoals de
// factuurmotor ze afrondt · subtotal 390.75, btw 40.36, totaal 431.11.
function makeInvoice(over = {}) {
  return {
    id: "inv1", tenantId: "t1", number: "2026-042", status: "open",
    invoiceDate: "2026-07-20", dueDate: "2026-08-19",
    customerName: "Klant NV", customerVatNumber: "BE0417497106", customerAddress: "Kaai 7, Antwerpen",
    structuredComm: "+++090/9337/55493+++",
    lines: [
      { description: "Arbeid", qty: 3, unitPrice: 40.25, vatRate: 21, lineSubtotal: 120.75, lineVat: 25.36 },
      { description: "Materiaal", qty: 1, unitPrice: 250, vatRate: 6, lineSubtotal: 250, lineVat: 15 },
      { description: "Verplaatsing", qty: 2, unitPrice: 10, vatRate: 0, lineSubtotal: 20, lineVat: 0 },
    ],
    subtotal: 390.75, vatAmount: 40.36, total: 431.11,
    ...over,
  };
}

function xmlValues(xml, tag) {
  return [...xml.matchAll(new RegExp(`<cbc:${tag}[^>]*>([^<]+)</cbc:${tag}>`, "g"))].map(m => m[1]);
}

test("reconciliatie: UBL-totalen zijn exact de factuurtotalen, ook per btw-tarief", () => {
  const inv = makeInvoice();
  const ubl = buildUbl(inv, tenant);

  assert.deepStrictEqual(xmlValues(ubl, "TaxExclusiveAmount"), ["390.75"]);
  assert.deepStrictEqual(xmlValues(ubl, "TaxInclusiveAmount"), ["431.11"]);
  assert.deepStrictEqual(xmlValues(ubl, "PayableAmount"), ["431.11"]);

  // TaxTotal = som van de TaxSubtotals = factuur-btw.
  const taxAmounts = xmlValues(ubl, "TaxAmount").map(Number);
  assert.strictEqual(taxAmounts[0], 40.36, "TaxTotal == vatAmount");
  const subtotals = taxAmounts.slice(1);
  assert.strictEqual(Math.round(subtotals.reduce((a, b) => a + b, 0) * 100), 4036, "som TaxSubtotals == TaxTotal");

  // Regels: som van LineExtensionAmount (excl. de kop) == subtotaal; 3 regels.
  const lineAmounts = xmlValues(ubl, "LineExtensionAmount").map(Number);
  const lineSum = lineAmounts.slice(1).reduce((a, b) => a + b, 0);   // [0] is het totaal in LegalMonetaryTotal
  assert.strictEqual(Math.round(lineSum * 100), 39075);
  assert.strictEqual((ubl.match(/<cac:InvoiceLine>/g) || []).length, 3);

  // Betaalgegevens: gestructureerde mededeling + IBAN reizen mee.
  assert.ok(ubl.includes("+++090/9337/55493+++"), "PaymentID = gestructureerde mededeling");
  assert.ok(ubl.includes("BE71096123456769"), "IBAN zonder spaties");
});

test("reconciliatie: het gerenderde document toont dezelfde totalen als factuur en UBL", () => {
  const inv = makeInvoice();
  const html = tpl.renderDocument(tpl.defaultTemplate("invoice"), "invoice", inv, tenant);
  const { fields } = tpl.buildContext("invoice", inv, tenant);

  for (const [veld, verwacht] of [["totalen.subtotaal", 390.75], ["totalen.btw", 40.36], ["totalen.totaal", 431.11]]) {
    const geformatteerd = fields[veld];
    assert.ok(html.includes(geformatteerd), `document toont ${veld} (${geformatteerd})`);
    // En dat geformatteerde bedrag is numeriek EXACT het factuurbedrag.
    const numeriek = Number(geformatteerd.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
    assert.strictEqual(numeriek, verwacht, `${veld} == factuurwaarde`);
  }
  assert.ok(html.includes("2026-042"), "factuurnummer in het document");
});

test("btw verlegd (medecontractant): categorie AE met reden, geen btw-bedrag", () => {
  const inv = makeInvoice({
    vatRegime: "medecontractant", vatNote: "Btw verlegd, KB nr. 1 art. 20",
    lines: [{ description: "Werk in onroerende staat", qty: 1, unitPrice: 1000, vatRate: 0, lineSubtotal: 1000, lineVat: 0 }],
    subtotal: 1000, vatAmount: 0, total: 1000,
  });
  const ubl = buildUbl(inv, tenant);
  assert.ok(ubl.includes("<cbc:ID>AE</cbc:ID>"), "categorie AE");
  assert.ok(ubl.includes("Btw verlegd, KB nr. 1 art. 20"), "reden vermeld");
  assert.deepStrictEqual(xmlValues(ubl, "TaxInclusiveAmount"), ["1000.00"]);
});

test("peppol-fout laat een spoor na: status error, reden en pogingteller op de factuur", async () => {
  const rows = new Map();
  const invalide = makeInvoice({ customerVatNumber: "" });   // verplicht voor B2B-Peppol
  rows.set(invalide.id, invalide);
  const store = {
    data: {},
    get: (col, id) => rows.get(id) || null,
    update: (col, id, patch) => { const r = { ...rows.get(id), ...patch }; rows.set(id, r); return r; },
    audit: () => {},
    list: () => [],
  };

  await assert.rejects(() => sendPeppolInvoice(store, tenant, invalide), /BTW-nummer van de klant/);
  let na = rows.get(invalide.id);
  assert.strictEqual(na.peppolStatus, "error");
  assert.match(na.peppolError, /BTW-nummer/);
  assert.strictEqual(na.peppolAttempts, 1);

  // Retry zonder fix → poging 2, spoor blijft actueel.
  await assert.rejects(() => sendPeppolInvoice(store, tenant, na));
  na = rows.get(invalide.id);
  assert.strictEqual(na.peppolAttempts, 2, "elke poging telt");
  assert.ok(na.peppolLastAttemptAt, "laatste poging heeft een tijdstip");
});

test("validatie somt ALLE gebreken op in één keer (geen fix-loop per veld)", () => {
  const v = validatePeppol({ lines: [] }, { id: "t2" });
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.length >= 4, `meerdere fouten tegelijk (${v.errors.length})`);
});
