"use strict";
// Universele objectmetadata (h5 · FORM-05). Bewijst de canonieke enums, de
// strengste-classificatie-keuze, de standaardclassificatie per collectie en de
// additieve metadata-stempel (nooit overschrijven).
const { test } = require("node:test");
const assert = require("node:assert");
const M = require("../src/platform/metadata");

test("canonieke enums · 7 classificaties, 6 sources, 3 purge-strategieën", () => {
  assert.equal(M.CLASSIFICATIONS.length, 7);
  assert.deepEqual(M.CLASSIFICATIONS.slice(0, 2), ["public", "internal"]);
  assert.ok(M.CLASSIFICATIONS.includes("security_sensitive"));
  assert.deepEqual(M.SOURCES, ["ui", "import", "api", "integration", "automation", "migration"]);
  assert.deepEqual(M.PURGE_STRATEGIES, ["soft_archive", "anonymize", "hard_delete"]);
  assert.equal(M.isClassification("financial"), true);
  assert.equal(M.isClassification("nonsense"), false);
  assert.equal(M.isSource("api"), true);
});

test("strengste classificatie wint (voor afgeleide objecten)", () => {
  assert.equal(M.maxClassification("public", "financial"), "financial");
  assert.equal(M.maxClassification("special_category", "internal"), "special_category");
  assert.equal(M.maxClassification("confidential", "personal"), "personal");
});

test("standaardclassificatie per collectie · gevoelige domeinen strenger", () => {
  assert.equal(M.defaultClassificationFor("invoices"), "financial");
  assert.equal(M.defaultClassificationFor("employees"), "personal");
  assert.equal(M.defaultClassificationFor("apiKeys"), "security_sensitive");
  assert.equal(M.defaultClassificationFor("iets_anders"), "internal");
});

test("stempel is additief · vult ontbrekende systeemvelden, overschrijft nooit", () => {
  const fresh = M.stampMetadata("invoices", { id: "inv_1", amount: 100 });
  assert.equal(fresh.data_classification, "financial");
  assert.equal(fresh.source, "ui");
  assert.equal(fresh.version, 1);

  // Bestaande waarden blijven onaangeroerd.
  const kept = M.stampMetadata("invoices", { id: "inv_2", data_classification: "public", source: "import", version: 4 });
  assert.equal(kept.data_classification, "public");
  assert.equal(kept.source, "import");
  assert.equal(kept.version, 4);

  // Expliciete opts sturen de default, maar alleen als het veld ontbreekt.
  const viaApi = M.stampMetadata("customers", { id: "c1" }, { source: "api", classification: "confidential" });
  assert.equal(viaApi.source, "api");
  assert.equal(viaApi.data_classification, "confidential");

  // Ongeldige opts vallen terug op de veilige default.
  const bad = M.stampMetadata("leaves", { id: "l1" }, { source: "zzz", classification: "zzz" });
  assert.equal(bad.source, "ui");
  assert.equal(bad.data_classification, "special_category");
});
