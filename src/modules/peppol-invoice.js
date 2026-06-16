"use strict";
/**
 * Peppol e-facturatie voor klantfacturen (UBL 2.1 / Peppol BIS Billing 3.0).
 *
 * - buildUbl()       : genereert geldige UBL-Invoice XML uit een factuur + leverancier.
 * - validatePeppol() : controleert de wettelijk verplichte velden vóór verzenden.
 * - sendPeppolInvoice(): verzendt via de provider uit de console (Billit/Digiteal/…),
 *   of via een mock-transport wanneer geen echte sleutel is ingesteld.
 *
 * Verplicht in België sinds 1 jan 2026 voor B2B. De leverancier-gegevens komen
 * uit tenant.invoiceProfile (ingevuld via de KBO-onboarding).
 */
const https = require("https");
const { loadPlatformConfig } = require("./platform-config");
const { isValidBelgianVat, structuredCommunication } = require("./be-locale");

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function supplierOf(tenant) {
  const ip = (tenant && tenant.invoiceProfile) || {};
  return {
    name: tenant && tenant.name || ip.companyName || "",
    vat: ip.vat || "",
    companyNumber: ip.companyNumber || (ip.vat || "").replace(/^BE/, ""),
    street: ip.street || "",
    postalCode: ip.postalCode || "",
    city: ip.city || "",
    country: ip.country || "BE",
    iban: ip.iban || "",
  };
}

/** Controleer de verplichte Peppol-velden. @returns {{ok:boolean, errors:string[]}} */
function validatePeppol(invoice, tenant) {
  const s = supplierOf(tenant);
  const errors = [];
  if (!s.vat && !s.companyNumber) errors.push("Leverancier-BTW/ondernemingsnummer ontbreekt (vul KBO in via Instellingen).");
  if (!s.street || !s.city) errors.push("Leverancieradres ontbreekt (KBO-onboarding).");
  if (!invoice.customerName) errors.push("Klantnaam ontbreekt.");
  if (!invoice.customerVatNumber) errors.push("BTW-nummer van de klant ontbreekt (verplicht voor Peppol B2B).");
  else if (!isValidBelgianVat(invoice.customerVatNumber)) errors.push("Ongeldig Belgisch BTW-nummer van de klant (mod-97 controle faalt).");
  if (s.vat && !isValidBelgianVat(s.vat)) errors.push("Ongeldig Belgisch BTW-nummer van de leverancier (controleer KBO in Instellingen).");
  if (!Array.isArray(invoice.lines) || !invoice.lines.length) errors.push("Geen factuurregels.");
  if (!invoice.number) errors.push("Factuurnummer ontbreekt.");
  if (!invoice.invoiceDate) errors.push("Factuurdatum ontbreekt.");
  return { ok: errors.length === 0, errors };
}

function vatPercent(l) { return Number(l.vatRate == null ? 21 : l.vatRate); }

/** Bouw UBL 2.1 / Peppol BIS Billing 3.0 Invoice XML. */
function buildUbl(invoice, tenant) {
  const s = supplierOf(tenant);
  const lines = invoice.lines || [];
  const cur = "EUR";
  const money = n => Number(n || 0).toFixed(2);

  // Groepeer per BTW-tarief voor TaxTotal/TaxSubtotal
  const groups = {};
  for (const l of lines) {
    const p = vatPercent(l);
    if (!groups[p]) groups[p] = { taxable: 0, tax: 0 };
    groups[p].taxable += Number(l.lineSubtotal != null ? l.lineSubtotal : (Number(l.qty || 1) * Number(l.unitPrice || 0)));
    groups[p].tax += Number(l.lineVat != null ? l.lineVat : (Number(l.qty || 1) * Number(l.unitPrice || 0) * p / 100));
  }
  const subtotal = Number(invoice.subtotal != null ? invoice.subtotal : Object.values(groups).reduce((a, g) => a + g.taxable, 0));
  const vatAmount = Number(invoice.vatAmount != null ? invoice.vatAmount : Object.values(groups).reduce((a, g) => a + g.tax, 0));
  const total = Number(invoice.total != null ? invoice.total : subtotal + vatAmount);

  // BTW-categorie: AE = btw verlegd (intracommunautair óf binnenlandse
  // medecontractant); Z = 0%; S = standaard.
  const reverseCharge = invoice.vatRegime === "intracom" || invoice.vatRegime === "medecontractant";
  const catId = pct => (reverseCharge ? "AE" : (Number(pct) === 0 ? "Z" : "S"));
  const exemptionXml = reverseCharge
    ? `${invoice.vatRegime === "intracom" ? "<cbc:TaxExemptionReasonCode>VATEX-EU-AE</cbc:TaxExemptionReasonCode>" : ""}<cbc:TaxExemptionReason>${esc(invoice.vatNote || "Btw verlegd")}</cbc:TaxExemptionReason>`
    : "";
  const ogm = invoice.structuredComm || structuredCommunication(invoice.number);
  const paymentMeansXml = `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
    <cbc:PaymentID>${esc(ogm)}</cbc:PaymentID>${s.iban ? `
    <cac:PayeeFinancialAccount><cbc:ID>${esc(s.iban.replace(/\s/g, ""))}</cbc:ID></cac:PayeeFinancialAccount>` : ""}
  </cac:PaymentMeans>`;

  const partyXml = (p, vat) => `
      <cac:PartyName><cbc:Name>${esc(p.name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(p.street)}</cbc:StreetName>
        <cbc:CityName>${esc(p.city)}</cbc:CityName>
        <cbc:PostalZone>${esc(p.postalCode)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${esc((p.country || "BE").slice(0, 2).toUpperCase())}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${vat ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(vat)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ""}
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName></cac:PartyLegalEntity>`;

  const taxSubtotals = Object.entries(groups).map(([pct, g]) => `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${cur}">${money(g.taxable)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${cur}">${money(g.tax)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${catId(pct)}</cbc:ID>
        <cbc:Percent>${money(pct)}</cbc:Percent>
        ${exemptionXml}
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`).join("");

  const invoiceLines = lines.map((l, i) => {
    const qty = Number(l.qty || 1);
    const lineSub = Number(l.lineSubtotal != null ? l.lineSubtotal : qty * Number(l.unitPrice || 0));
    const p = vatPercent(l);
    return `
  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${cur}">${money(lineSub)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(l.description || "Artikel")}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${catId(p)}</cbc:ID>
        <cbc:Percent>${money(p)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="${cur}">${money(l.unitPrice)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${esc(invoice.number)}</cbc:ID>
  <cbc:IssueDate>${esc(invoice.invoiceDate)}</cbc:IssueDate>
  ${invoice.dueDate ? `<cbc:DueDate>${esc(invoice.dueDate)}</cbc:DueDate>` : ""}
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  ${invoice.notes ? `<cbc:Note>${esc(invoice.notes)}</cbc:Note>` : ""}
  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>${partyXml(s, s.vat)}</cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>${partyXml({
    name: invoice.customerName, street: invoice.customerAddress || "", city: "", postalCode: "", country: "BE",
  }, invoice.customerVatNumber)}</cac:Party></cac:AccountingCustomerParty>${paymentMeansXml}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${cur}">${money(vatAmount)}</cbc:TaxAmount>${taxSubtotals}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${cur}">${money(subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${cur}">${money(subtotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${cur}">${money(total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${cur}">${money(total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${invoiceLines}
</Invoice>`;
}

function httpsPostJson(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = typeof body === "string" ? body : JSON.stringify(body);
    const req = https.request({ hostname, path, method: "POST", headers: { "Content-Length": Buffer.byteLength(data), ...headers } }, res => {
      let raw = ""; res.on("data", c => raw += c);
      res.on("end", () => {
        let json = {}; try { json = JSON.parse(raw); } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(new Error(json.error?.message || json.message || `Peppol-provider ${res.statusCode}`));
      });
    });
    req.on("error", reject); req.write(data); req.end();
  });
}

function isRealKey(k) { return !!k && !/DUMMY|replace[_-]?me|xxxx/i.test(String(k)); }

/**
 * Verzend een factuur via Peppol. Markeert peppolStatus + referentie op de factuur.
 * @returns {Promise<{ok:boolean, provider:string, reference:string, status:string}>}
 */
async function sendPeppolInvoice(store, tenant, invoice) {
  const v = validatePeppol(invoice, tenant);
  if (!v.ok) { const e = new Error("Peppol-validatie mislukt: " + v.errors.join(" ")); e.status = 400; e.errors = v.errors; throw e; }

  const ubl = buildUbl(invoice, tenant);
  const cfg = loadPlatformConfig(store);
  const provider = (cfg.peppol && cfg.peppol.provider) || "mock";
  const key = cfg.peppol && cfg.peppol.apiKey;
  let reference, status, transport;

  if (provider !== "mock" && isRealKey(key)) {
    // Echte provider. Endpoints verschillen per provider; hieronder de courante
    // Belgische opties. Faalt netjes als de provider een fout teruggeeft.
    const hosts = { billit: "api.billit.be", digiteal: "api.digiteal.eu", unifiedpost: "api.unifiedpost.com" };
    const host = hosts[provider] || hosts.billit;
    const resp = await httpsPostJson(host, "/v1/peppol/outbound", {
      Authorization: `Bearer ${key}`, "Content-Type": "application/xml",
    }, ubl);
    reference = resp.id || resp.transmissionId || `${provider}_${Date.now()}`;
    status = resp.status || "sent";
    transport = provider;
  } else {
    // Mock-transport: valideert + bewaart UBL, markeert als afgeleverd.
    reference = `PEPPOL-MOCK-${Date.now().toString(36).toUpperCase()}`;
    status = "delivered";
    transport = "mock";
  }

  store.update("invoices", invoice.id, {
    peppolStatus: status,
    peppolReference: reference,
    peppolProvider: transport,
    peppolSentAt: new Date().toISOString(),
    ublXml: ubl,
    updatedAt: new Date().toISOString(),
  });
  store.audit({ actor: "peppol", tenantId: tenant.id, action: "peppol_sent", area: "facturen", detail: `${invoice.number} → ${transport} (${status})` });
  return { ok: true, provider: transport, reference, status };
}

module.exports = { buildUbl, validatePeppol, sendPeppolInvoice, supplierOf };
