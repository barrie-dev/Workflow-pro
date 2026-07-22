"use strict";
// Velddictionary (h6-h24 · datadictionary). Bewijst dat het gebouwde artefact
// compleet en enum-zuiver is en dat structureFor() geldige engine-structuren
// levert. Slaat over zolang het artefact nog niet gebouwd is.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ARTIFACT = path.join(__dirname, "..", "src", "platform", "field-dictionary.json");
if (!fs.existsSync(ARTIFACT)) {
  test("field-dictionary: artefact nog niet gebouwd · overgeslagen", { skip: true }, () => {});
} else {
  const D = require("../src/platform/field-dictionary");
  const { CLASSIFICATIONS } = require("../src/platform/metadata");
  const REQUIRED = ["system", "required", "optional", "conditional"];

  test("dekt de 19 dictionary-hoofdstukken (h6-h24) en de totalen kloppen", () => {
    assert.equal(D.totals.chapters, 19);
    const actual = D.DICTIONARY.chapters.reduce((s, c) => s + c.fields.length, 0);
    assert.equal(D.totals.fields, actual, "totals.fields spiegelt de echte inhoud");
    assert.ok(actual >= 400, `substantiële dictionary (${actual} velden)`);
    const nums = D.DICTIONARY.chapters.map(c => c.chapter).sort((a, b) => a - b);
    assert.deepEqual(nums, Array.from({ length: 19 }, (_, i) => i + 6), "h6 t/m h24, geen gaten");
  });

  test("elk veld is enum-zuiver (required/classificatie/veldrecht)", () => {
    for (const c of D.DICTIONARY.chapters) {
      for (const f of c.fields) {
        assert.ok(REQUIRED.includes(f.required), `${c.chapter}/${f.field_key}: required`);
        assert.ok(CLASSIFICATIONS.includes(f.data_classification), `${c.chapter}/${f.field_key}: classificatie`);
      }
    }
  });

  test("gevoelige lagen zijn aanwezig · special_category, security_sensitive en veldrechten", () => {
    const all = D.DICTIONARY.chapters.flatMap(c => c.fields);
    assert.ok(all.some(f => f.data_classification === "special_category"), "HR/medisch aanwezig");
    assert.ok(all.some(f => f.data_classification === "security_sensitive"), "security aanwezig");
    assert.ok(all.some(f => f.data_classification === "financial"), "financieel aanwezig");
    assert.ok(all.some(f => f.view_permission), "minstens één expliciet veldrecht");
  });

  test("structureFor levert geldige engine-structuren (uniek, met sectie)", () => {
    for (const c of D.DICTIONARY.chapters) {
      const s = D.structureFor(c.chapter);
      assert.ok(s.sections.length >= 1, `h${c.chapter}: secties`);
      assert.ok(s.fields.length >= 1, `h${c.chapter}: velden`);
      const keys = new Set();
      for (const f of s.fields) {
        assert.ok(!keys.has(f.field_key), `h${c.chapter}: dubbele sleutel ${f.field_key}`);
        keys.add(f.field_key);
        assert.ok(["number", "date", "text"].includes(f.field_type), `h${c.chapter}/${f.field_key}: engine-type`);
        assert.ok(s.sections.some(x => x.key === f.section_key), `h${c.chapter}/${f.field_key}: sectie bestaat`);
      }
    }
  });
}
