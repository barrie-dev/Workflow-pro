"use strict";
// IA-21 · Klantportaal (IA handover §7/§8).
// Acceptatiebewijs: "Versioned approvals; explicit record sharing; external
// auth and audit." De gebruiker staat hier BUITEN de organisatie, dus elke
// aanname over impliciete toegang is een lek.
const { test } = require("node:test");
const assert = require("node:assert");
const cp = require("../public/js/app/portals/customer/definition");

const NU = "2026-07-24T10:00:00Z";
const CTX = { customerId: "c_42", contactId: "ct_1", authMethod: "portal_account", now: NU };
const OFFERTE = { type: "quote_version", id: "qv_3", quoteId: "q_1", total: 12500 };
const DEEL = {
  recordType: "quote_version", recordId: "qv_3", versionId: "qv_3",
  customerId: "c_42", active: true, scopes: ["view", "approve"], expiresAt: "2026-08-24T00:00:00Z",
};

test("IA-21 1· EXPLICIET DELEN: zonder deelhandeling geen toegang", () => {
  assert.deepEqual(cp.canView(OFFERTE, null, CTX), { ok: false, code: "NOT_SHARED" });
  // "Het hoort bij deze klant" is geen deelhandeling · anders ziet de klant
  // elke conceptofferte en elke interne notitie op zijn dossier.
  const alleenKlantId = { recordType: "quote_version", recordId: "qv_9", customerId: "c_42", active: true };
  assert.equal(cp.canView(OFFERTE, alleenKlantId, CTX).code, "NOT_SHARED");
});

test("IA-21 2· een deling van een ANDERE klant geeft geen toegang", () => {
  const uit = cp.canView(OFFERTE, { ...DEEL, customerId: "c_99" }, CTX);
  assert.equal(uit.code, "NOT_SHARED", "byte-identiek aan niet-gedeeld · geen existence leak");
});

test("IA-21 3· ingetrokken en verlopen delingen sluiten meteen", () => {
  assert.equal(cp.canView(OFFERTE, { ...DEEL, active: false }, CTX).code, "SHARE_REVOKED");
  assert.equal(cp.canView(OFFERTE, { ...DEEL, expiresAt: "2026-07-24T09:00:00Z" }, CTX).code, "SHARE_EXPIRED");
  assert.equal(cp.canView(OFFERTE, DEEL, CTX).ok, true);
});

test("IA-21 4· een gedeelde VERSIE opent geen andere versie", () => {
  const versie4 = { ...OFFERTE, id: "qv_4" };
  assert.equal(cp.canView(versie4, DEEL, CTX).code, "NOT_SHARED",
    "delen van versie 3 is geen toestemming voor versie 4");
});

test("IA-21 5· niet elk recordtype kan gedeeld worden", () => {
  const intern = { type: "employee", id: "e_1" };
  assert.equal(cp.canView(intern, { ...DEEL, recordType: "employee", recordId: "e_1" }, CTX).code, "TYPE_NOT_SHAREABLE");
  for (const t of cp.SHAREABLE_TYPES) {
    assert.equal(cp.canView({ type: t, id: "r_1" },
      { ...DEEL, recordType: t, recordId: "r_1", versionId: null }, CTX).ok, true, `${t} zou deelbaar moeten zijn`);
  }
});

test("IA-21 6· interne velden gaan NOOIT mee naar buiten", () => {
  const uit = cp.projectForCustomer({
    ...OFFERTE, costPrice: 8100, margin: 4400, marginPct: 0.35,
    internalNotes: "klant onderhandelt hard", supplierPrice: 7900,
  });
  assert.equal(uit.total, 12500, "zijn eigen prijs ziet hij gewoon");
  for (const veld of cp.NEVER_SHARED_FIELDS) {
    assert.equal(veld in uit, false, `${veld} lekt naar de klant`);
  }
  assert.equal(JSON.stringify(uit).includes("onderhandelt"), false);
});

test("IA-21 7· interne velden worden weggelaten, niet genuld", () => {
  const uit = cp.projectForCustomer({ ...OFFERTE, margin: 4400 });
  assert.equal(Object.keys(uit).some(k => k.toLowerCase().includes("margin")), false,
    "een leeg margeveld verraadt nog steeds dat er marge op zit");
});

// ── Goedkeuring per versie ───────────────────────────────────────────────────

test("IA-21 8· een goedkeuring geldt voor de VERSIE waarop ze sloeg", () => {
  const goedgekeurd = { versionId: "qv_3", decision: "approved" };
  assert.deepEqual(cp.approvalState(goedgekeurd, "qv_3"), { state: "approved", validFor: "qv_3" });
});

test("IA-21 9· een NIEUWE VERSIE laat de oude goedkeuring vervallen", () => {
  const st = cp.approvalState({ versionId: "qv_3", decision: "approved" }, "qv_4");
  assert.equal(st.state, "superseded");
  assert.equal(st.reason, "NEW_VERSION_NEEDS_NEW_APPROVAL",
    "anders lift een prijswijziging mee op een akkoord over een ander bedrag");
  assert.equal(st.validFor, "qv_3", "waar ze wél voor gold blijft zichtbaar");
});

test("IA-21 10· een goedkeuring zonder versie is ongeldig, niet geldig-voor-alles", () => {
  const st = cp.approvalState({ decision: "approved" }, "qv_3");
  assert.equal(st.state, "invalid");
  assert.equal(st.reason, "APPROVAL_WITHOUT_VERSION");
});

test("IA-21 11· zonder goedkeuring staat het op wachten, niet op afgekeurd", () => {
  assert.deepEqual(cp.approvalState(null, "qv_3"), { state: "pending", validFor: null });
  assert.equal(cp.approvalState({ versionId: "qv_3", decision: "rejected" }, "qv_3").state, "rejected");
});

test("IA-21 12· goedkeuren vereist een expliciete goedkeur-scope op de deling", () => {
  const alleenKijken = { ...DEEL, scopes: ["view"] };
  assert.equal(cp.canApprove(OFFERTE, alleenKijken, null, CTX).code, "APPROVAL_NOT_GRANTED",
    "mogen zien is niet mogen tekenen");
  assert.equal(cp.canApprove(OFFERTE, DEEL, null, CTX).ok, true);
});

test("IA-21 13· twee keer goedkeuren kan niet, en niet-tekenbare records evenmin", () => {
  assert.equal(cp.canApprove(OFFERTE, DEEL, { versionId: "qv_3", decision: "approved" }, CTX).code, "ALREADY_APPROVED");
  const factuur = { type: "invoice", id: "i_1" };
  assert.equal(cp.canApprove(factuur, { ...DEEL, recordType: "invoice", recordId: "i_1", versionId: null }, null, CTX)
    .code, "NOT_APPROVABLE");
});

test("IA-21 14· goedkeuren zonder geldige deling lukt niet", () => {
  assert.equal(cp.canApprove(OFFERTE, { ...DEEL, active: false }, null, CTX).code, "SHARE_REVOKED");
});

// ── Externe authenticatie en audit ───────────────────────────────────────────

test("IA-21 15· een externe sessie draagt nooit een interne rol", () => {
  const uit = cp.checkExternalSession({
    customerId: "c_42", authMethod: "portal_account", role: "tenant_admin", expiresAt: "2026-07-25",
  });
  assert.equal(uit.ok, false);
  assert.deepEqual(uit.violations, [{ field: "role", reason: "INTERNAL_ROLE_ON_EXTERNAL_SESSION" }],
    "interne en externe identiteit lopen niet door elkaar");
});

test("IA-21 16· alleen erkende externe inlogmethodes tellen", () => {
  for (const m of cp.EXTERNAL_AUTH_METHODS) {
    assert.equal(cp.checkExternalSession({ customerId: "c_42", authMethod: m, expiresAt: "2026-07-25" }).ok, true);
  }
  assert.equal(cp.checkExternalSession({ customerId: "c_42", authMethod: "internal_password", expiresAt: "x" })
    .violations[0].reason, "INVALID_EXTERNAL_AUTH");
});

test("IA-21 17· een externe sessie zonder vervaldatum wordt geweigerd", () => {
  const uit = cp.checkExternalSession({ customerId: "c_42", authMethod: "magic_link" });
  assert.ok(uit.violations.some(v => v.reason === "SESSION_WITHOUT_EXPIRY"));
  assert.deepEqual(cp.checkExternalSession({}).violations.map(v => v.field).sort(),
    ["authMethod", "customerId", "expiresAt"]);
});

test("IA-21 18· de audit draagt de VERSIE, niet alleen het record", () => {
  const a = cp.auditEntry("view", OFFERTE, CTX);
  assert.equal(a.versionId, "qv_3",
    "'de klant heeft de offerte gezien' is bij een geschil niets waard zonder te weten welke");
  assert.equal(a.customerId, "c_42");
  assert.equal(a.contactId, "ct_1");
  assert.equal(a.authMethod, "portal_account");
});

test("IA-21 19· de audit draagt geen recordinhoud", () => {
  const a = cp.auditEntry("approve", { ...OFFERTE, total: 12500, internalNotes: "geheim" }, CTX);
  assert.deepEqual(Object.keys(a).sort(),
    ["action", "at", "authMethod", "contactId", "customerId", "event", "recordId", "recordType", "versionId"]);
  assert.equal(JSON.stringify(a).includes("12500"), false);
  assert.equal(JSON.stringify(a).includes("geheim"), false);
});
