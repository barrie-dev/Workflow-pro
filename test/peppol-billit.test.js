"use strict";
// Billit Peppol Access Point (h47): host-keuze, headers, sendxml-contract,
// deelnemersnormalisatie, foutvertaling en de sandbox-guardrails. Alles met
// een fake transport · geen netwerk in de suite.
const { test } = require("node:test");
const assert = require("node:assert");

const billit = require("../src/modules/peppol-billit");
const { peppolTransportReadiness } = require("../src/modules/peppol-invoice");

function fakeTransport(responses) {
  const calls = [];
  const fn = async req => {
    calls.push(req);
    const r = responses.shift() || { statusCode: 200, body: "{}" };
    return { statusCode: r.statusCode, body: typeof r.body === "string" ? r.body : JSON.stringify(r.body) };
  };
  fn.calls = calls;
  return fn;
}
const cfg = { provider: "billit", apiKey: "billit_key_abc123", partyId: "P123", sandbox: true };

test("host: sandbox ↔ productie", () => {
  assert.strictEqual(billit.billitHost({ sandbox: true }), "api.sandbox.billit.be");
  assert.strictEqual(billit.billitHost({ sandbox: false }), "api.billit.be");
  assert.strictEqual(billit.billitHost({}), "api.billit.be", "zonder vlag → productie (expliciet is expliciet)");
});

test("headers: ApiKey + PartyID; headernaam is een env-flip", () => {
  const h = billit.billitHeaders(cfg);
  assert.strictEqual(h.ApiKey, "billit_key_abc123");
  assert.strictEqual(h.PartyID, "P123");
  const alt = billit.billitHeaders({ ...cfg, authHeader: "Authorization" });
  assert.strictEqual(alt.Authorization, "billit_key_abc123");
  assert.strictEqual(alt.ApiKey, undefined);
});

test("sendxml: POST met de UBL als platte tekst in het XML-veld, InboxItemID als referentie", async () => {
  const transport = fakeTransport([{ statusCode: 200, body: { InboxItemID: "ibx_42" } }]);
  const ubl = '<?xml version="1.0"?><Invoice>…</Invoice>';
  const sent = await billit.sendUbl(cfg, ubl, transport);

  const req = transport.calls[0];
  assert.strictEqual(req.hostname, "api.sandbox.billit.be");
  assert.strictEqual(req.path, "/v1/peppol/sendxml");
  assert.strictEqual(req.method, "POST");
  assert.strictEqual(JSON.parse(req.body).XML, ubl, "platte tekst, geen base64");
  assert.strictEqual(sent.reference, "ibx_42");
  assert.strictEqual(sent.transport, "billit-sandbox");
});

test("deelnemer: Registered + documenttypes bepalen samen of er verzonden kan worden", async () => {
  const ok = await billit.participantInfo(cfg, "BE0403170701", fakeTransport([
    { statusCode: 200, body: { Registered: true, Identifier: "9925:be0403170701", DocumentTypes: ["BISv3Invoice", "BISv3CreditNote"] } },
  ]));
  assert.strictEqual(ok.registered, true);
  assert.strictEqual(ok.canReceiveInvoice, true);

  const geenFactuur = await billit.participantInfo(cfg, "BE0403170701", fakeTransport([
    { statusCode: 200, body: { Registered: true, DocumentTypes: ["BISv3Order"] } },
  ]));
  assert.strictEqual(geenFactuur.canReceiveInvoice, false, "geregistreerd maar zonder factuurtype → niet verzenden");

  const niet = await billit.participantInfo(cfg, "BE0999999999", fakeTransport([
    { statusCode: 200, body: { Registered: false, DocumentTypes: [] } },
  ]));
  assert.strictEqual(niet.registered, false);
  assert.strictEqual(niet.canReceiveInvoice, false);
});

test("deelnemerscheck stuurt het identifier ge-encodeerd in het pad", async () => {
  const transport = fakeTransport([{ statusCode: 200, body: { Registered: true } }]);
  await billit.participantInfo(cfg, "9925:BE0403170701", transport);
  assert.strictEqual(transport.calls[0].path, "/v1/peppol/participantInformation/9925%3ABE0403170701");
  assert.strictEqual(transport.calls[0].method, "GET");
});

test("fouten: 401 wordt PEPPOL_AUTH_FAILED, providerfouten dragen de Billit-boodschap", async () => {
  await assert.rejects(
    () => billit.sendUbl(cfg, "<x/>", fakeTransport([{ statusCode: 401, body: { Message: "Invalid key" } }])),
    e => e.code === "PEPPOL_AUTH_FAILED" && /Invalid key/.test(e.message));
  await assert.rejects(
    () => billit.sendUbl(cfg, "<x/>", fakeTransport([{ statusCode: 422, body: { Errors: [{ Message: "UBL validation failed" }] } }])),
    e => e.code === "PEPPOL_PROVIDER_ERROR" && /UBL validation failed/.test(e.message) && e.providerStatus === 422);
});

test("readiness: sandbox is een volwaardig transport buiten productie, een blokkade erin", () => {
  const sandboxCfg = { peppol: { provider: "billit", apiKey: "billit_key_abc123", sandbox: true } };
  const dev = peppolTransportReadiness(sandboxCfg, false);
  assert.strictEqual(dev.ok, true);
  assert.strictEqual(dev.mode, "sandbox");
  assert.strictEqual(dev.transport, "billit");

  const prod = peppolTransportReadiness(sandboxCfg, true);
  assert.strictEqual(prod.ok, false, "testnetwerk mag nooit stil echte facturen dragen");
  assert.strictEqual(prod.errorCode, "peppol_sandbox_in_production");

  // Zonder echte sleutel blijft sandbox gewoon mock (niets half-live).
  const zonderKey = peppolTransportReadiness({ peppol: { provider: "billit", apiKey: "peppol_DUMMY_0000000000", sandbox: true } }, false);
  assert.strictEqual(zonderKey.transport, "mock");
});
