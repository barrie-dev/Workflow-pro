"use strict";
// Dimona (RSZ · socialsecurity.be): aangifte-opbouw uit de personeelsfiche,
// guarded mock-verzending, register met hiaten, INSZ-validatie op de fiche.
const { test } = require("node:test");
const assert = require("node:assert");

const dimona = require("../src/modules/dimona");
const { normalizeEmployee } = (() => {
  // normalizeEmployee is intern; we testen INSZ via de repo-API in de e2e.
  return {};
})();

const tenant = { id: "t1", name: "Demo Bouw BV", compliance: { rszEmployerId: "123456789" } };
// Geldig INSZ (mod-97 op 85.07.30-033): 85073003328? We gebruiken een bekende
// geldige testwaarde volgens de ciaw-validator.
const { normalizeInsz, validInsz } = require("../src/modules/ciaw");
function findValidInsz() {
  // Deterministisch een geldig nummer zoeken rond een vaste basis · de
  // validator is de waarheid, niet een hardgecodeerde aanname.
  for (let i = 0; i < 97; i++) {
    const base = `850730033${String(i).padStart(2, "0")}`.slice(0, 9);
    for (let c = 1; c <= 97; c++) {
      const kandidaat = base + String(c).padStart(2, "0");
      if (validInsz(normalizeInsz(kandidaat))) return kandidaat;
    }
  }
  throw new Error("geen geldig test-INSZ gevonden");
}
const INSZ = findValidInsz();

function makeEmployee(over = {}) {
  return { id: "emp1", tenantId: "t1", name: "Jan Werker", insz: INSZ, activeFrom: "2026-08-01", status: "active", external: false, ...over };
}

test("aangifte-opbouw: IN vanaf de fiche, OUT met einddatum, REST-WS-vorm", () => {
  const inD = dimona.buildDimonaDeclaration({ tenant, employee: makeEmployee(), type: "in" });
  assert.strictEqual(inD.valid, true, inD.errors.join("; "));
  assert.strictEqual(inD.declaration.employer.nssoRegistrationNumber, "123456789");
  assert.strictEqual(inD.declaration.worker.ssin, normalizeInsz(INSZ));
  assert.strictEqual(inD.declaration.dimonaIn.startDate, "2026-08-01", "startdatum uit de fiche");
  assert.strictEqual(inD.declaration.dimonaIn.workerType, "OTH");

  const outD = dimona.buildDimonaDeclaration({ tenant, employee: makeEmployee({ activeTo: "2026-12-31" }), type: "out" });
  assert.strictEqual(outD.valid, true);
  assert.strictEqual(outD.declaration.dimonaOut.endDate, "2026-12-31");

  const expliciet = dimona.buildDimonaDeclaration({ tenant, employee: makeEmployee(), type: "in", date: "2026-09-15" });
  assert.strictEqual(expliciet.declaration.dimonaIn.startDate, "2026-09-15", "meegegeven datum wint van de fiche");
});

test("alle gebreken worden benoemd: RSZ-nummer, INSZ, datum, externen", () => {
  const kaal = dimona.buildDimonaDeclaration({ tenant: { id: "t2" }, employee: { id: "e", name: "X" }, type: "in" });
  assert.strictEqual(kaal.valid, false);
  assert.ok(kaal.errors.some(e => /RSZ-werkgeversnummer/.test(e)));
  assert.ok(kaal.errors.some(e => /INSZ/.test(e)));
  assert.ok(kaal.errors.some(e => /Startdatum/.test(e)));

  const extern = dimona.buildDimonaDeclaration({ tenant, employee: makeEmployee({ external: true, supplierId: "s1" }), type: "in" });
  assert.ok(extern.errors.some(e => /eigen werkgever/.test(e)), "onderaannemers vallen onder hun eigen Dimona");

  const foutType = dimona.buildDimonaDeclaration({ tenant, employee: makeEmployee(), type: "update" });
  assert.ok(foutType.errors.some(e => /'in' of 'out'/.test(e)));
});

test("guarded verzending: mock levert volwaardige registratie, gebreken geven rejected", async () => {
  const ok = await dimona.submitDimona({ config: {}, tenant, employee: makeEmployee(), type: "in" });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.live, false);
  assert.strictEqual(ok.status, "accepted");
  assert.match(ok.reference, /^DIMONA-MOCK-/);
  assert.strictEqual(ok.date, "2026-08-01");

  const fout = await dimona.submitDimona({ config: {}, tenant: { id: "t2" }, employee: makeEmployee(), type: "in" });
  assert.strictEqual(fout.ok, false);
  assert.strictEqual(fout.status, "rejected");
  assert.match(fout.error, /RSZ-werkgeversnummer/);
});

test("readiness: mock buiten certificatie, geblokkeerd wanneer live vereist zonder credentials", () => {
  assert.strictEqual(dimona.dimonaReadiness({ dimona: { provider: "mock" } }, false).live, false);
  const blocked = dimona.dimonaReadiness({ dimona: { provider: "rsz", clientId: "", clientSecret: "" } }, true);
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.errorCode, "dimona_credentials_missing");
  const live = dimona.dimonaReadiness({ dimona: { provider: "rsz", clientId: "cid_echt", clientSecret: "secret_echt" } }, true);
  assert.strictEqual(live.ok, true);
  assert.strictEqual(live.live, true);
});

test("register: actief zonder IN = hiaat, uit dienst zonder OUT = hiaat, extern telt niet mee", () => {
  const employees = [
    makeEmployee({ id: "e1", name: "Zonder aangifte" }),
    makeEmployee({ id: "e2", name: "Met IN", dimona: { type: "in", status: "accepted", reference: "R1", at: "2026-07-01" } }),
    makeEmployee({ id: "e3", name: "Uit dienst zonder OUT", activeTo: "2026-01-31", status: "left", dimona: { type: "in", status: "accepted", reference: "R2", at: "2026-01-01" } }),
    makeEmployee({ id: "e4", name: "Extern", external: true, supplierId: "s1" }),
    makeEmployee({ id: "e5", name: "Gefaalde aangifte", dimona: { type: "in", status: "failed", error: "x", at: "2026-07-01" } }),
  ];
  const store = { list: () => employees };
  const { rows, gaps } = dimona.dimonaRegister(store, "t1", "2026-08-15");
  assert.strictEqual(rows.length, 4, "externe medewerker staat niet in het register");
  assert.deepStrictEqual(gaps.map(g => g.employeeId).sort(), ["e1", "e3", "e5"]);
  assert.ok(gaps.find(g => g.employeeId === "e3").reason.includes("zonder Dimona-OUT"));
});
