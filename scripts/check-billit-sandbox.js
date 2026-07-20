#!/usr/bin/env node
"use strict";
/**
 * Billit-sandbox-gereedheidscheck · draaien zodra de sandbox-sleutel binnen is.
 *
 *   set PEPPOL_API_KEY=...        (de Billit API-sleutel · nooit in chat/commit)
 *   set PEPPOL_PARTY_ID=...      (PartyID van de sandbox-omgeving)
 *   npm run peppol:sandbox:check                → deelnemerscheck op eigen BTW
 *   npm run peppol:sandbox:check -- BE0403170701 → check op een ander nummer
 *   npm run peppol:sandbox:check -- BE0403170701 --send → stuur ook een test-UBL
 *
 * Het script raakt ALLEEN de sandbox (api.sandbox.billit.be), tenzij je
 * expliciet PEPPOL_SANDBOX=false zet · doe dat niet zonder reden.
 */

const { participantInfo, sendUbl, billitHost } = require("../src/modules/peppol-billit");
const { buildUbl } = require("../src/modules/peppol-invoice");

const cfg = {
  provider: "billit",
  apiKey: process.env.PEPPOL_API_KEY || "",
  partyId: process.env.PEPPOL_PARTY_ID || "",
  sandbox: process.env.PEPPOL_SANDBOX !== "false",
  authHeader: process.env.PEPPOL_AUTH_HEADER || "ApiKey",
};

const args = process.argv.slice(2).filter(a => a !== "--send");
const doSend = process.argv.includes("--send");
const identifier = args[0] || "";

function fail(msg) { console.error(`FOUT · ${msg}`); process.exit(1); }

(async () => {
  if (!cfg.apiKey) fail("PEPPOL_API_KEY ontbreekt (zet hem in deze terminal, niet in een bestand)");
  if (!cfg.partyId) console.warn("LET OP · PEPPOL_PARTY_ID ontbreekt; sommige accounts vereisen hem");
  if (!identifier) fail("geef een BTW- of KBO-nummer mee, bv.: npm run peppol:sandbox:check -- BE0403170701");
  console.log(`Host      : ${billitHost(cfg)} (${cfg.sandbox ? "SANDBOX" : "PRODUCTIE"})`);
  console.log(`Auth      : header '${cfg.authHeader}' + PartyID ${cfg.partyId ? "gezet" : "NIET gezet"}`);

  // 1) Deelnemerscheck · bewijst meteen dat de sleutel werkt.
  const p = await participantInfo(cfg, identifier);
  console.log(`Deelnemer : ${p.identifier}`);
  console.log(`  geregistreerd     : ${p.registered ? "JA" : "NEE"}`);
  console.log(`  kan facturen aan  : ${p.canReceiveInvoice ? "JA" : "NEE"}`);
  if (p.documentTypes.length) console.log(`  documenttypes     : ${p.documentTypes.join(", ")}`);

  // 2) Optioneel: een minimale test-UBL versturen (alleen zinnig op de sandbox).
  if (doSend) {
    if (!cfg.sandbox) fail("--send is alleen toegestaan op de sandbox");
    const tenant = {
      id: "t_test", name: "Monargo Sandboxtest BV",
      invoiceProfile: { vat: "BE0403170701", street: "Teststraat 1", postalCode: "9000", city: "Gent" },
    };
    const invoice = {
      id: "inv_sandbox", number: `SANDBOX-${Date.now().toString(36).toUpperCase()}`,
      invoiceDate: new Date().toISOString().slice(0, 10),
      customerName: "Sandbox Ontvanger", customerVatNumber: String(identifier),
      lines: [{ description: "Sandbox-testregel", qty: 1, unitPrice: 1, vatRate: 21, lineSubtotal: 1, lineVat: 0.21 }],
      subtotal: 1, vatAmount: 0.21, total: 1.21,
    };
    const sent = await sendUbl(cfg, buildUbl(invoice, tenant));
    console.log(`Verzonden : referentie ${sent.reference} via ${sent.transport}`);
  }

  console.log("\nSANDBOX-CHECK OK");
})().catch(e => {
  console.error(`FOUT · ${e.message}`);
  if (e.code === "PEPPOL_AUTH_FAILED") {
    console.error("Hint: klopt de sleutel en de PartyID? Probeer eventueel PEPPOL_AUTH_HEADER=Authorization");
  }
  process.exit(1);
});
