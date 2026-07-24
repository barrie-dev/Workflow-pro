"use strict";
/**
 * Resellerportaal · pagina "Uitbetaling" (CTO3-09).
 *
 * Deze tests leggen GEDRAG vast, geen bestaan. De paginamodule is een browser-
 * IIFE zonder buildstap, dus ze wordt in een vm-context geladen met een minimale
 * window-stub. Daardoor kunnen de pure delen (rendering, foutvertaling,
 * body-opbouw, rechten) echt uitgevoerd worden in plaats van met een regex
 * bekeken. De structurele tests eronder bewaken wat je alleen in de bron ziet:
 * dat de module geen gedeelde context herdefinieert en nergens een
 * organisatie-id uit de UI naar de server kan sturen.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const BESTAND = path.join(ROOT, "public", "js", "platforms", "reseller-uitbetaling.js");
const bron = fs.readFileSync(BESTAND, "utf8");

/** Broncode zonder commentaar · anders faalt een test op een uitleg. */
function code() {
  return bron.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Laadt de module met een minimale browserstub en geeft de registratie terug. */
function laadPagina() {
  const window = {
    wfpCore: {
      token: () => "test-token",
      esc: v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ESC[c])
    }
  };
  const verzoeken = [];
  const sandbox = {
    window,
    document: { getElementById: () => null },
    localStorage: { getItem: () => "", removeItem() {} },
    async fetch(pad, opties) {
      verzoeken.push({ pad, opties });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(bron, sandbox, { filename: "reseller-uitbetaling.js" });
  return { pagina: window.wfpResellerPages && window.wfpResellerPages.uitbetaling, window, verzoeken };
}

// ── Registratie ─────────────────────────────────────────────────────────────

test("de module registreert zichzelf als paginamodule van het resellerportaal", () => {
  const { pagina } = laadPagina();
  assert.ok(pagina, "window.wfpResellerPages.uitbetaling ontbreekt na het laden");
  assert.equal(pagina.id, "uitbetaling");
  for (const fn of ["render", "html", "messageFor", "payloadFor", "mayManagePayout"]) {
    assert.equal(typeof pagina[fn], "function", `${fn} hoort deel te zijn van de registratie`);
  }
});

test("het paginaregister wordt idempotent aangemaakt en overschrijft niets", () => {
  // Een tweede module (of een herlaadbeurt) mag de eerste niet wegvegen.
  const { window } = laadPagina();
  window.wfpResellerPages.andere = { id: "andere" };
  vm.runInNewContext(bron, {
    window,
    document: { getElementById: () => null },
    localStorage: { getItem: () => "", removeItem() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    console
  });
  assert.ok(window.wfpResellerPages.andere, "het register werd opnieuw aangemaakt in plaats van gelezen");
  assert.ok(window.wfpResellerPages.uitbetaling);
  assert.match(code(), /window\.wfpResellerPages\s*=\s*window\.wfpResellerPages\s*\|\|/);
});

test("de module definieert de gedeelde context van andere shells niet opnieuw", () => {
  const broncode = code();
  for (const globaal of ["wfpAdmin", "wfpCore", "wfpI18n", "wfp_resellerInit", "WorkFlowProPlatformRouter"]) {
    assert.doesNotMatch(broncode, new RegExp(`window\\.${globaal}\\s*=[^=]`),
      `de pagina hoort window.${globaal} te LEZEN, niet aan te maken`);
  }
  // Geen tweede portaalstate: de state van reseller.js blijft van reseller.js.
  assert.doesNotMatch(broncode, /window\.\w*[Ss]tate\s*=/);
});

// ── Nooit een organisatie-id uit de UI ──────────────────────────────────────

test("er gaat nergens een resellerId uit de UI naar de server", () => {
  const broncode = code();
  assert.doesNotMatch(broncode, /resellerId/, "de server leidt de organisatie af uit de sessie");
  assert.doesNotMatch(broncode, /reseller_id/);
  // De enige schrijfroute die de pagina kent, is de payoutwijziging.
  const paden = [...broncode.matchAll(/api\("(GET|POST|PATCH|PUT|DELETE)",\s*"([^"]+)"/g)].map(m => `${m[1]} ${m[2]}`);
  assert.deepEqual(paden.sort(), ["GET /api/me", "GET /api/reseller/commission", "POST /api/reseller/payout-changes"]);
});

test("payloadFor bouwt de body zonder organisatie-id, ook als de UI er een aanreikt", () => {
  const { pagina } = laadPagina();
  const body = pagina.payloadFor({
    resellerId: "rsl_iemand_anders",
    payout_account: "be68 5390 0754 7034",
    payout_currency: "eur",
    reason: "  nieuwe bankrelatie  "
  });
  assert.deepEqual(Object.keys(body).sort(), ["payout_account", "payout_currency", "reason"]);
  assert.equal("resellerId" in body, false, "een resellerId uit de UI zou de scopecontrole van de server aanvalbaar maken");
  assert.equal(body.payout_account, "BE68539007547034");
  assert.equal(body.payout_currency, "EUR");
  assert.equal(body.reason, "nieuwe bankrelatie");
});

test("payloadFor laat lege velden weg in plaats van ze als null te sturen", () => {
  const { pagina } = laadPagina();
  // De body komt uit de vm-context · overzetten naar deze realm voor deepEqual.
  const body = plat => ({ ...pagina.payloadFor(plat) });
  assert.deepEqual(body({ payout_currency: "eur", reason: "valuta" }), { reason: "valuta", payout_currency: "EUR" });
  assert.deepEqual(body({}), { reason: "" });
});

// ── Weigeringen zijn generiek ───────────────────────────────────────────────

test("een 403 levert een generieke melding zonder identifier of reden", () => {
  const { pagina } = laadPagina();
  const tekst = pagina.messageFor({
    status: 403,
    code: "PAYOUT_CHANGE_FORBIDDEN",
    message: "payoutwijziging cpc_9f2a41 van rsl_007 bestaat niet"
  });
  assert.ok(tekst.length > 0);
  for (const lek of ["cpc_9f2a41", "rsl_007", "bestaat niet", "PAYOUT_CHANGE_FORBIDDEN", "403"]) {
    assert.equal(tekst.includes(lek), false, `de weigering lekt "${lek}"`);
  }
  assert.match(tekst, /geen toegang/i);
});

test("403 en 404 geven exact dezelfde tekst · geen bestaans-oracle", () => {
  const { pagina } = laadPagina();
  const verboden = pagina.messageFor({ status: 403, code: "RESELLER_FORBIDDEN" });
  const nietGevonden = pagina.messageFor({ status: 404, code: "PAYOUT_CHANGE_NOT_FOUND" });
  assert.equal(verboden, nietGevonden);
});

test("MFA is de enige weigering met een eigen tekst · ze gaat over de sessie, niet over een record", () => {
  const { pagina } = laadPagina();
  const mfa = pagina.messageFor({ status: 403, code: "MFA_REQUIRED" });
  assert.match(mfa, /MFA/);
  assert.notEqual(mfa, pagina.messageFor({ status: 403, code: "RESELLER_FORBIDDEN" }));
  assert.equal(mfa.includes("MFA_REQUIRED"), false);
});

test("de servertekst wordt nooit doorgegeven aan het scherm", () => {
  const { pagina } = laadPagina();
  const gelekt = "reseller rsl_007 niet gevonden";
  for (const status of [400, 401, 403, 404, 409, 500]) {
    const tekst = pagina.messageFor({ status, code: "IETS", message: gelekt, error: gelekt });
    assert.equal(tekst.includes("rsl_007"), false, `status ${status} lekt de servertekst`);
  }
});

test("het 403-pad rendert een scherm met de generieke melding en zonder identifier", () => {
  const { pagina } = laadPagina();
  const fout = { status: 403, code: "RESELLER_FORBIDDEN", message: "cpc_9f2a41 bestaat niet" };
  const html = pagina.html({
    user: { role: "reseller" },
    ledger: null,
    ledgerDenied: true,
    changes: [],
    notice: { tone: "denied", text: pagina.messageFor(fout) }
  });
  assert.match(html, /geen toegang/i);
  assert.equal(html.includes("cpc_9f2a41"), false);
  assert.equal(html.includes("bestaat niet"), false);
  assert.equal(html.includes("RESELLER_FORBIDDEN"), false);
  // Geweigerd grootboek betekent: geen bedragen op het scherm.
  assert.equal(/rsp-kpi-value/.test(html), false, "er worden bedragen getoond die de server niet gaf");
});

// ── Rechten sturen de rendering ─────────────────────────────────────────────

test("mayManagePayout volgt de serverregels en verruimt ze nooit", () => {
  const { pagina } = laadPagina();
  const may = pagina.mayManagePayout;
  // Klassieke enkelvoudige resellerlogin = eigenaar met de legacy-grants.
  assert.equal(may({ role: "reseller" }), true);
  // Expliciete kanaalrollen: finance mag, support niet.
  assert.equal(may({ role: "reseller", resellerRole: "reseller_finance" }), true);
  assert.equal(may({ role: "reseller", resellerRole: "reseller_support" }), false);
  // Gevoelige beperking 23.5: sales mag dit nooit, ook niet met expliciet recht.
  assert.equal(may({ role: "reseller", resellerRole: "reseller_sales", permissions: ["reseller.payout.manage:own"] }), false);
  assert.equal(may({ role: "reseller", resellerRole: "monargo_partner_manager", permissions: ["*"] }), false);
  // Expliciete grant op een rol die het niet standaard heeft.
  assert.equal(may({ role: "reseller", resellerRole: "reseller_operations", permissions: ["own:reseller.payout.manage"] }), true);
  assert.equal(may(null), false);
});

test("zonder wijzigingsrecht verschijnt er geen formulier en geen knop", () => {
  const { pagina } = laadPagina();
  const zonder = pagina.html({ user: { role: "reseller", resellerRole: "reseller_support" }, ledger: { balance: { payable: 1200, paid: 800 }, payouts: [] } });
  assert.equal(/<form/.test(zonder), false, "de UI verzint een formulier dat de server zou weigeren");
  assert.equal(/type="submit"/.test(zonder), false);
  // Bedragen tonen mag wel: kijken is geen wijzigen.
  assert.match(zonder, /rsp-kpi-value/);

  const met = pagina.html({ user: { role: "reseller", resellerRole: "reseller_finance", mfaEnabled: true }, ledger: { balance: { payable: 1200, paid: 800 }, payouts: [] } });
  assert.match(met, /id="rspPayoutForm"/);
  assert.match(met, /name="payout_account"/);
  assert.match(met, /name="reason"/);
});

test("zonder bevestigde MFA staat de plicht op het scherm", () => {
  const { pagina } = laadPagina();
  const html = pagina.html({ user: { role: "reseller", resellerRole: "reseller_finance", mfaEnabled: false } });
  assert.match(html, /MFA/);
});

// ── Bedragen en gegevens ────────────────────────────────────────────────────

test("het beschikbare saldo houdt open uitbetalingen gereserveerd", () => {
  const { pagina } = laadPagina();
  const html = pagina.html({
    user: { role: "reseller" },
    ledger: {
      balance: { payable: 1000, paid: 250 },
      payouts: [
        { amount: 400, status: "pending_approval", period: "2026-06" },
        { amount: 100, status: "paid", period: "2026-05", paidAt: "2026-06-03T10:00:00.000Z", paymentRef: "SEPA-1" }
      ]
    }
  });
  // 1000 uitbetaalbaar min 400 gereserveerd = 600 beschikbaar.
  assert.ok(html.includes("600"), "het gereserveerde bedrag wordt niet afgetrokken");
  assert.ok(html.includes("SEPA-1"), "de betaalreferentie hoort in de historiek");
});

test("een rekeningnummer komt nooit voluit in beeld", () => {
  const { pagina } = laadPagina();
  const html = pagina.html({
    user: { role: "reseller", resellerRole: "reseller_finance", mfaEnabled: true },
    changes: [{
      status: "pending", requestedAt: "2026-07-24T09:00:00.000Z", reason: "nieuwe bank",
      before: { payout_account: "BE68539007547034" },
      after: { payout_account: "BE62510007547061", payout_currency: "EUR" }
    }]
  });
  assert.equal(html.includes("BE68539007547034"), false, "de oude IBAN staat voluit op het scherm");
  assert.equal(html.includes("BE62510007547061"), false, "de nieuwe IBAN staat voluit op het scherm");
  assert.match(html, /7061/);
  assert.equal(pagina.maskIban("BE62510007547061"), "BE62 •••• 7061");
  assert.equal(pagina.maskIban(""), "-");
});

test("de pagina toont geen klantinhoud en zegt dat ook", () => {
  const { pagina } = laadPagina();
  const html = pagina.html({
    user: { role: "reseller" },
    ledger: {
      balance: { payable: 100, paid: 0 },
      payouts: [{ amount: 100, status: "draft", period: "2026-07" }],
      // Grootboekregels dragen klantnamen · die horen niet op deze pagina.
      events: [{ amount: 100, clientName: "Bouwbedrijf Peeters", clientTenantId: "tnt_42", period: "2026-07" }]
    }
  });
  assert.equal(html.includes("Bouwbedrijf Peeters"), false, "klantinhoud lekt op de uitbetalingspagina");
  assert.equal(html.includes("tnt_42"), false);
  assert.match(html, /gedelegeerde toegang/i);
});

test("lege waarden tonen als - en nooit als leeg of null", () => {
  const { pagina } = laadPagina();
  const html = pagina.html({ user: { role: "reseller" }, ledger: { balance: {}, payouts: [] } });
  assert.equal(html.includes("null"), false);
  assert.equal(html.includes("undefined"), false);
});

// ── Huisregels ──────────────────────────────────────────────────────────────

test("geen em-dash in gebruikerszichtbare tekst", () => {
  assert.equal(bron.includes("—"), false, 'gebruik "-" of "·", nooit een em-dash');
});
