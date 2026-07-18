"use strict";
// Werkbonnen v2 · mobiele uitvoering (master-spec h25/E07): offline sync zonder
// stille overschrijving, eigen-uren-regel, verplichte formulieren, handtekening
// gebonden aan versie, correctieboeking na goedkeuring, facturatiestrategieën.
const { test } = require("node:test");
const assert = require("node:assert");

const {
  upgradeLegacy, canonicalStatus, workedMinutes, missingRequiredAnswers,
  computeTotals, buildInvoiceLines, canEditWorkerHours, makeWorkOrderRepository,
} = require("../src/platform/work-orders");

function fakeStore(data = {}) {
  const d = { workorders: [], ...data };
  return {
    data: d,
    list(col, tid) { const r = d[col] || []; return tid == null ? r : r.filter(x => x.tenantId === tid); },
    get(col, id) { return (d[col] || []).find(x => x.id === id); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    update(col, id, patch) { d[col] = (d[col] || []).map(x => x.id === id ? { ...x, ...patch } : x); return (d[col] || []).find(x => x.id === id); },
    remove(col, id) { d[col] = (d[col] || []).filter(x => x.id !== id); },
    save() {},
  };
}
const LEAD = { id: "u1", email: "lead@x.be", role: "manager", permissions: ["workorders"] };
const TECH = { id: "u2", email: "tech@x.be", role: "employee", permissions: ["own:workorders"] };
const TECH2 = { id: "u3", email: "tech2@x.be", role: "employee", permissions: ["own:workorders"] };

function seed(extra = {}) {
  const store = fakeStore();
  store.insert("workorders", {
    id: "wo1", tenantId: "t1", number: "WO-2026-001", title: "Ketel vervangen",
    date: "2026-07-10", status: "open", version: 1, ...extra,
  });
  return { store, repo: makeWorkOrderRepository(store) };
}

test("werkbon: legacy-rij wordt opgewaardeerd zonder velden te verliezen", () => {
  const legacy = { id: "wo1", tenantId: "t1", number: "WO-2026-001", title: "Oud", status: "Voltooid", clientName: "Bouw NV", billableHours: 4 };
  const wo = upgradeLegacy(legacy);
  assert.equal(wo.status, "submitted", "legacy-status → canoniek");
  assert.equal(wo.legacyStatus, "Voltooid", "originele waarde blijft zichtbaar");
  assert.equal(wo.clientName, "Bouw NV", "legacy-veld behouden");
  assert.equal(wo.billableHours, 4);
  assert.deepEqual(wo.workers, []);
  assert.equal(wo.version, 1);
  assert.equal(canonicalStatus("in_progress"), "mobile_busy");
});

test("werkbon: uren per medewerker met pauzes (ploeg met verschillende uren)", () => {
  assert.equal(workedMinutes({ start: "08:00", end: "17:00", breaks: [{ start: "12:00", end: "12:30" }] }), 510);
  const { repo } = seed();
  const wo = repo.update("t1", "wo1", { workers: [
    { userId: "u2", name: "Tech", start: "08:00", end: "17:00", breaks: [{ start: "12:00", end: "12:30" }], costRate: 30, salesRate: 55 },
    { userId: "u3", name: "Tech2", start: "09:00", end: "15:00", costRate: 28, salesRate: 50 },
  ] }, LEAD, 1);
  assert.equal(wo.workers[0].hours, 8.5);
  assert.equal(wo.workers[1].hours, 6);
  assert.equal(wo.workers[0].costRateDate, "2026-07-10", "kosttarief geklikt op uitvoeringsdatum");
  const t = computeTotals(wo);
  assert.equal(t.hours, 14.5);
  assert.equal(t.cost, 423, "8.5*30 + 6*28");
});

test("werkbon: medewerker mag alleen eigen uren wijzigen", () => {
  const { repo } = seed();
  repo.update("t1", "wo1", { workers: [
    { userId: "u2", name: "Tech", start: "08:00", end: "16:00", costRate: 30 },
    { userId: "u3", name: "Tech2", start: "08:00", end: "16:00", costRate: 30 },
  ] }, LEAD, 1);
  // Eigen regel wijzigen mag.
  const ok = repo.update("t1", "wo1", { workers: [
    { userId: "u2", name: "Tech", start: "08:00", end: "18:00", costRate: 30 },
    { userId: "u3", name: "Tech2", start: "08:00", end: "16:00", costRate: 30 },
  ] }, TECH, 2);
  assert.equal(ok.workers.find(w => w.userId === "u2").hours, 10);
  // Andermans regel wijzigen mag niet.
  assert.throws(() => repo.update("t1", "wo1", { workers: [
    { userId: "u2", name: "Tech", start: "08:00", end: "18:00", costRate: 30 },
    { userId: "u3", name: "Tech2", start: "08:00", end: "20:00", costRate: 30 },
  ] }, TECH, 3), /eigen uren|OWN_HOURS_ONLY/);
  // Ploegleider mag wel.
  assert.ok(canEditWorkerHours(LEAD, "u3"));
  assert.ok(!canEditWorkerHours(TECH, "u3"));
});

test("werkbon: verplichte formulieren blokkeren indienen", () => {
  const { repo } = seed();
  repo.update("t1", "wo1", { forms: [
    { id: "f1", label: "Gasdichtheid gecontroleerd?", type: "bool", required: true },
    { id: "f2", label: "Opmerkingen", type: "text", required: false },
  ] }, LEAD, 1);
  assert.equal(missingRequiredAnswers(repo.findById("t1", "wo1").forms).length, 1);
  assert.throws(() => repo.submit("t1", "wo1", TECH), /Verplichte vragen|REQUIRED_FORMS_MISSING/);
  repo.update("t1", "wo1", { forms: [
    { id: "f1", label: "Gasdichtheid gecontroleerd?", type: "bool", required: true, answer: true },
    { id: "f2", label: "Opmerkingen", type: "text", required: false },
  ] }, LEAD, 2);
  const submitted = repo.submit("t1", "wo1", TECH);
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.review.status, "pending");
});

test("werkbon: handtekening is gebonden aan de exacte versie en vervalt bij wijziging", () => {
  const { repo } = seed();
  repo.update("t1", "wo1", { workers: [{ userId: "u2", start: "08:00", end: "12:00", costRate: 30, salesRate: 50 }] }, LEAD, 1);
  const signed = repo.sign("t1", "wo1", { by: "Klant Jan", dataRef: "sig_abc" }, LEAD);
  assert.ok(signed.signature.boundHash, "handtekening draagt inhoudshash");
  assert.equal(signed.signature.invalidated, false);
  // Uren wijzigen ná ondertekening → handtekening vervalt (niet stil geldig blijven).
  const after = repo.update("t1", "wo1", { workers: [{ userId: "u2", start: "08:00", end: "18:00", costRate: 30, salesRate: 50 }] }, LEAD, signed.version);
  assert.equal(after.signature.invalidated, true, "handtekening vervalt bij inhoudswijziging");
});

test("werkbon: offline sync · conflict wordt niet stilzwijgend overschreven", () => {
  const { repo } = seed();
  // Client haalt versie 1 op en werkt offline verder.
  const baseVersion = repo.findById("t1", "wo1").version;
  // Ondertussen wijzigt de backoffice de werkbon op de server.
  repo.update("t1", "wo1", { description: "Bijgewerkt door backoffice" }, LEAD, 1);
  // De offline client synchroniseert met de verouderde baseVersion → conflict.
  let err = null;
  try { repo.sync("t1", "wo1", { baseVersion, patch: { description: "Offline notitie" }, clientId: "dev-1" }, TECH); }
  catch (e) { err = e; }
  assert.ok(err, "sync met verouderde baseVersion moet falen");
  assert.equal(err.code, "SYNC_CONFLICT");
  assert.equal(err.status, 409);
  assert.ok(err.serverState, "serverstaat wordt meegegeven om te mergen");
  assert.equal(err.clientPatch.description, "Offline notitie", "clientmutatie blijft behouden");
  assert.equal(repo.findById("t1", "wo1").description, "Bijgewerkt door backoffice", "server niet overschreven");
  // Met de juiste baseVersion lukt de sync wel.
  const current = repo.findById("t1", "wo1").version;
  const synced = repo.sync("t1", "wo1", { baseVersion: current, patch: { description: "Offline notitie" }, clientId: "dev-1", clientUpdatedAt: "2026-07-10T18:00:00Z" }, TECH);
  assert.equal(synced.description, "Offline notitie");
  assert.equal(synced.sync.clientId, "dev-1");
  assert.ok(synced.sync.lastSyncAt);
});

test("werkbon: na goedkeuring enkel nog correctieboekingen (auditbaar)", () => {
  const { repo } = seed();
  repo.update("t1", "wo1", { workers: [{ userId: "u2", start: "08:00", end: "16:00", costRate: 30, salesRate: 55 }] }, LEAD, 1);
  repo.submit("t1", "wo1", TECH);
  const approved = repo.review("t1", "wo1", { decision: "approve", note: "Akkoord" }, LEAD);
  assert.equal(approved.status, "approved");
  // Rechtstreeks uren wijzigen kan niet meer.
  assert.throws(() => repo.update("t1", "wo1", { workers: [{ userId: "u2", start: "08:00", end: "20:00", costRate: 30 }] }, LEAD), /correctieboeking|CORRECTION_REQUIRED/);
  // Correctie zonder reden kan niet.
  assert.throws(() => repo.addCorrection("t1", "wo1", { type: "hours", qty: 2 }, LEAD), /reden|REASON_REQUIRED/);
  const { workorder, correction } = repo.addCorrection("t1", "wo1", { type: "hours", targetId: "u2", field: "hours", from: 8, to: 10, qty: 2, reason: "Extra uur nagemeld" }, LEAD);
  assert.equal(workorder.corrections.length, 1);
  assert.equal(correction.reason, "Extra uur nagemeld");
  assert.equal(correction.by, "lead@x.be");
  assert.ok(correction.at, "correctie is tijdgestempeld en dus auditbaar");
});

test("werkbon: garantiewerk telt niet mee in facturatie, wel in kost", () => {
  const { repo } = seed();
  const wo = repo.update("t1", "wo1", {
    workers: [
      { userId: "u2", name: "Tech", start: "08:00", end: "12:00", costRate: 30, salesRate: 55 },
      { userId: "u3", name: "Tech2", start: "08:00", end: "10:00", costRate: 28, salesRate: 50, warranty: true },
    ],
    materials: [
      { description: "Ketelonderdeel", qty: 1, unitPrice: 200, costPrice: 120 },
      { description: "Pakking (garantie)", qty: 2, unitPrice: 15, costPrice: 8, warranty: true },
    ],
  }, LEAD, 1);
  const t = computeTotals(wo);
  assert.equal(t.hours, 6, "alle uren tellen voor kost");
  assert.equal(t.billableHours, 4, "garantie-uren niet factureerbaar");
  assert.equal(t.cost, 312, "4*30 + 2*28 + 1*120 + 2*8 · garantie telt wel als kost");
  assert.equal(t.sales, 420, "4*55 + 200");
  assert.equal(t.warrantyValue, 130, "2*50 + 2*15");
});

test("werkbon: facturatiestrategieën detail, gegroepeerd en één totaalregel", () => {
  const { repo } = seed();
  const wo = repo.update("t1", "wo1", {
    workers: [{ userId: "u2", name: "Tech", start: "08:00", end: "12:00", costRate: 30, salesRate: 50 }],
    materials: [{ description: "Onderdeel", qty: 2, unitPrice: 100, costPrice: 60 }],
    equipment: [{ description: "Hoogwerker", hours: 3, rate: 40 }],
  }, LEAD, 1);
  const detail = buildInvoiceLines(wo, "detail");
  assert.equal(detail.length, 3);
  assert.ok(detail.every(l => l.sourceType === "workorder" && l.sourceId === "wo1"), "bronallocatie op elke lijn");
  const grouped = buildInvoiceLines(wo, "grouped");
  assert.deepEqual(grouped.map(l => l.description), ["Werkuren", "Materiaal", "Materieel"]);
  assert.equal(grouped[1].unitPrice, 200);
  const single = buildInvoiceLines(wo, "single");
  assert.equal(single.length, 1);
  assert.equal(single[0].unitPrice, 520, "4*50 + 200 + 120");
});

test("werkbon: statusovergangen worden afgedwongen", () => {
  const { repo } = seed();
  assert.throws(() => repo.review("t1", "wo1", { decision: "approve" }, LEAD), /INVALID_TRANSITION|kan niet vanuit/);
  repo.submit("t1", "wo1", TECH);
  const rejected = repo.review("t1", "wo1", { decision: "reject", note: "Uren ontbreken" }, LEAD);
  assert.equal(rejected.status, "rejected_for_correction");
  // Na afwijzing mag de technieker opnieuw bewerken en indienen.
  repo.update("t1", "wo1", { workers: [{ userId: "u2", start: "08:00", end: "16:00", costRate: 30 }] }, TECH, rejected.version);
  const again = repo.submit("t1", "wo1", TECH);
  assert.equal(again.status, "submitted");
});

test("werkbon: indienen met handtekeningvereiste blokkeert zonder geldige handtekening", () => {
  const { repo } = seed();
  assert.throws(() => repo.submit("t1", "wo1", TECH, { requireSignature: true }), /handtekening|SIGNATURE_REQUIRED/);
  repo.sign("t1", "wo1", { by: "Klant", dataRef: "x" }, LEAD);
  const ok = repo.submit("t1", "wo1", TECH, { requireSignature: true });
  assert.equal(ok.status, "submitted");
});
