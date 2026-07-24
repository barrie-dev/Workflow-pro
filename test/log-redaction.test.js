"use strict";
// CTO3-12 · verplichte logredactietest: tokens, secrets, nationaal nummer en
// bankrekening mogen NOOIT in een applicatielog of alertmail belanden. Ook niet
// diep genest, niet in arrays, en niet verstopt in vrije tekst (foutboodschap,
// stack trace). De tenant blijft correleerbaar via een hash, nooit leesbaar.
const { test } = require("node:test");
const assert = require("node:assert");
const L = require("../src/platform/log-redaction");

const R = L.REDACTED;
const bevat = (s, naald) => String(s).includes(naald);

test("1· tokens en secrets worden gemaskeerd (sleutelnaam én vrije tekst)", () => {
  const uit = L.redactForLog({
    password: "Geheim123!", passwordHash: "$2b$10$abcdef", apiKey: "sk_live_ABCDEF123456",
    authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
    note: "Aanroep met Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop.signature mislukt",
    stripe: "sleutel sk_live_51ABCdefGHI gebruikt", webhook: "whsec_ABCDEF123456",
  });
  for (const k of ["password", "passwordHash", "apiKey", "authorization", "webhook"]) {
    assert.equal(uit[k], R, `${k} moet gemaskeerd zijn`);
  }
  assert.ok(!bevat(uit.note, "eyJ"), "JWT in vrije tekst gemaskeerd");
  assert.ok(!bevat(uit.stripe, "sk_live_51ABCdefGHI"), "providersleutel in vrije tekst gemaskeerd");
});

test("2· rijksregisternummer wordt gemaskeerd, ook in vrije tekst", () => {
  const uit = L.redactForLog({
    rijksregisternummer: "85.07.30-033.28",
    nationalNumber: "85073003328",
    melding: "Werknemer met nummer 85.07.30-033.28 kon niet worden aangemeld",
  });
  assert.equal(uit.rijksregisternummer, R);
  assert.equal(uit.nationalNumber, R);
  assert.ok(!bevat(uit.melding, "85.07.30-033.28"), "nationaal nummer in vrije tekst gemaskeerd");
});

test("3· bankrekening (IBAN) wordt gemaskeerd, ook in vrije tekst", () => {
  const uit = L.redactForLog({
    iban: "BE68 5390 0754 7034",
    payout_account: "BE68539007547034",
    fout: "Overschrijving naar BE68 5390 0754 7034 geweigerd",
  });
  assert.equal(uit.iban, R);
  assert.equal(uit.payout_account, R);
  assert.ok(!bevat(uit.fout, "5390"), "IBAN in vrije tekst gemaskeerd");
});

test("4· kaartnummers gemaskeerd, maar een epoch-timestamp blijft leesbaar", () => {
  const uit = L.redactForLog({
    kaart: "4111 1111 1111 1111",
    kaartKaal: "4111111111111111",
    at: "1784851611626",                 // 13 cijfers · epoch in ms
    bedrag: 1210,
  });
  assert.equal(uit.kaart, R);
  assert.equal(uit.kaartKaal, R);
  assert.equal(uit.at, "1784851611626", "een epoch-timestamp mag gewoon gelogd worden");
  assert.equal(uit.bedrag, 1210, "getallen blijven ongemoeid");
});

test("5· redactie werkt recursief: geneste objecten, arrays en Errors", () => {
  const uit = L.redactForLog({
    user: { name: "Jan", secret: "abc", nested: { iban: "BE68539007547034" } },
    lijst: [{ token: "xyz" }, { ok: true }],
    fout: Object.assign(new Error("Token eyJhbGciOiJIUzI1NiJ9.aaaaaaaaaaaaaaaaaaaa.bbb ongeldig"), { code: "AUTH_FAILED" }),
  });
  assert.equal(uit.user.name, "Jan", "niet-gevoelige velden blijven");
  assert.equal(uit.user.secret, R);
  assert.equal(uit.user.nested.iban, R);
  assert.equal(uit.lijst[0].token, R);
  assert.equal(uit.lijst[1].ok, true);
  assert.equal(uit.fout.code, "AUTH_FAILED", "foutcode blijft · die is nodig voor alerting");
  assert.ok(!bevat(uit.fout.message, "eyJ"), "token in foutboodschap gemaskeerd");
});

test("6· cyclische structuren breken de logger niet", () => {
  const a = { naam: "x" }; a.zelf = a;
  const uit = L.redactForLog(a);
  assert.equal(uit.naam, "x");
  assert.equal(uit.zelf, "[CIRCULAR]");
});

test("7· de tenant is correleerbaar via een hash, nooit leesbaar", () => {
  const h1 = L.hashTenantId("t_demo");
  const h2 = L.hashTenantId("t_demo");
  const h3 = L.hashTenantId("t_ander");
  assert.equal(h1, h2, "stabiel: dezelfde tenant geeft dezelfde hash");
  assert.notEqual(h1, h3, "verschillende tenants botsen niet");
  assert.ok(!bevat(h1, "t_demo"), "de hash verraadt het tenant-id niet");
  assert.equal(L.hashTenantId(""), null);
  assert.equal(L.hashTenantId(null), null);
});

test("8· de canonieke logvelden dragen correlatie zonder klantdata", () => {
  const f = L.safeLogFields({
    requestId: "req_123", tenantId: "t_demo", deploymentId: "dep-9", commitSha: "abc1234",
    code: "PERSIST_FAILED", level: "error",
    message: "Fout voor BE68 5390 0754 7034",
    context: { password: "x", klant: "Acme" },
  });
  assert.equal(f.requestId, "req_123");
  assert.equal(f.deploymentId, "dep-9");
  assert.equal(f.commitSha, "abc1234");
  assert.equal(f.code, "PERSIST_FAILED");
  assert.equal(f.level, "error");
  assert.ok(f.tenant && f.tenant.startsWith("t#"), "tenant is gehasht");
  assert.equal(f.tenant.includes("t_demo"), false);
  assert.ok(!bevat(f.message, "5390"), "IBAN uit de boodschap gemaskeerd");
  assert.equal(f.context.password, R);
  assert.equal(f.context.klant, "Acme");
  // De logregel is één JSON-regel voor een collector.
  const regel = L.formatLogLine({ requestId: "r", tenantId: "t_demo", message: "ok" });
  assert.equal(regel.includes("\n"), false);
  assert.ok(JSON.parse(regel).tenant.startsWith("t#"));
});

test("9· niets ontsnapt: functies en symbolen worden nooit gelogd", () => {
  const uit = L.redactForLog({ fn: () => {}, sym: Symbol("x"), ok: 1 });
  assert.equal(uit.fn, R);
  assert.equal(uit.sym, R);
  assert.equal(uit.ok, 1);
});

test("10· incident-runbook legt SLO, alerts, proces en de open infra-acties vast", () => {
  const fs = require("node:fs"), path = require("node:path");
  const txt = fs.readFileSync(path.join(__dirname, "..", "docs", "INCIDENT-RUNBOOK.md"), "utf8");
  assert.match(txt, /99,5%/, "pilot-SLO staat erin");
  assert.match(txt, /99,9%/, "commercieel SLO staat erin");
  assert.match(txt, /synthetic-checks\.js/, "verwijst naar de externe synthetische checks");
  assert.match(txt, /post-mortem/i, "post-mortem-sjabloon aanwezig");
  for (const ernst of ["S1", "S2", "S3"]) assert.ok(txt.includes(ernst), `ernstniveau ${ernst} gedefinieerd`);
  // De infra-acties die NIET door code geleverd kunnen worden, staan expliciet
  // als open checklist · een leeg vakje is een open risico, geen detail.
  assert.match(txt, /- \[ \] \*\*Hostingplan\*\*/, "hostingplan-upgrade als open infra-actie");
  assert.match(txt, /- \[ \] \*\*Database-PITR\*\*/, "PITR als open infra-actie");
  assert.match(txt, /- \[ \] \*\*Game day\*\*/, "game day als open infra-actie");
});
