"use strict";
// Dimona-registratie en -bewaking · het platform geeft NIETS aan bij de RSZ
// (productbeslissing 2026-07-20): het sociaal secretariaat doet de aangifte,
// Monargo registreert dat ze gebeurd is en bewaakt de hiaten.
const { test } = require("node:test");
const assert = require("node:assert");

const dimona = require("../src/modules/dimona");

function makeEmployee(over = {}) {
  return { id: "emp1", tenantId: "t1", name: "Jan Werker", activeFrom: "2026-08-01", status: "active", external: false, ...over };
}

test("registratie: IN pakt de startdatum van de fiche, OUT de einddatum, expliciete datum wint", () => {
  const inR = dimona.normalizeDimonaRecord({ type: "in", reference: "SSEC-2026-0042" }, makeEmployee());
  assert.strictEqual(inR.type, "in");
  assert.strictEqual(inR.date, "2026-08-01", "startdatum uit de fiche");
  assert.strictEqual(inR.reference, "SSEC-2026-0042");

  const outR = dimona.normalizeDimonaRecord({ type: "out" }, makeEmployee({ activeTo: "2026-12-31" }));
  assert.strictEqual(outR.date, "2026-12-31");

  const expliciet = dimona.normalizeDimonaRecord({ type: "in", date: "2026-09-15" }, makeEmployee());
  assert.strictEqual(expliciet.date, "2026-09-15");
});

test("validatie: type verplicht, datum verplicht, externen uitgesloten", () => {
  assert.throws(() => dimona.normalizeDimonaRecord({ type: "update" }, makeEmployee()), e => e.code === "INVALID_TYPE");
  assert.throws(() => dimona.normalizeDimonaRecord({ type: "out" }, makeEmployee()), e => e.code === "DATE_REQUIRED", "geen einddatum op de fiche en geen datum meegegeven");
  assert.throws(() => dimona.normalizeDimonaRecord({ type: "in" }, makeEmployee({ external: true, supplierId: "s1" })), e => e.code === "EXTERNAL_EMPLOYEE", "onderaannemers vallen onder hun eigen werkgever");
});

test("register: actief zonder IN = hiaat met doorgeef-boodschap, uit dienst zonder OUT = hiaat, extern telt niet mee", () => {
  const employees = [
    makeEmployee({ id: "e1", name: "Zonder registratie" }),
    makeEmployee({ id: "e2", name: "Met IN", dimona: { type: "in", date: "2026-08-01", reference: "R1", at: "2026-07-01" } }),
    makeEmployee({ id: "e3", name: "Uit dienst zonder OUT", activeTo: "2026-01-31", status: "left", dimona: { type: "in", date: "2025-01-01", reference: "R2", at: "2025-01-01" } }),
    makeEmployee({ id: "e4", name: "Extern", external: true, supplierId: "s1" }),
  ];
  const store = { list: () => employees };
  const { rows, gaps } = dimona.dimonaRegister(store, "t1", "2026-08-15");
  assert.strictEqual(rows.length, 3, "externe medewerker staat niet in het register");
  assert.deepStrictEqual(gaps.map(g => g.employeeId).sort(), ["e1", "e3"]);
  assert.ok(gaps.find(g => g.employeeId === "e1").reason.includes("sociaal secretariaat"), "hiaat verwijst naar de doorgifte");
  assert.ok(gaps.find(g => g.employeeId === "e3").reason.includes("Dimona-OUT"));
  assert.strictEqual(rows.find(r => r.employeeId === "e2").registered, true);
});
