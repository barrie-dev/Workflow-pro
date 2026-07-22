"use strict";

// ── build-field-dictionary · assembleer de canonieke velddictionary ──────────
// Leest de per-hoofdstuk JSON-extracties (h6-h24 uit de Forms-handover), valideert
// ze tegen de canonieke enums en schrijft één deterministisch artefact:
// src/platform/field-dictionary.json. Faalt HARD op elke afwijking - de
// dictionary is normatief, een stille reparatie zou een tweede waarheid zijn.
//
// Gebruik: node scripts/build-field-dictionary.js <bron-map>

const fs = require("fs");
const path = require("path");
const { CLASSIFICATIONS } = require("../src/platform/metadata");

const REQUIRED_LEVELS = ["system", "required", "optional", "conditional"];
// h3 noemt de veldrechten als VOORBEELDEN; elk recht dat het canonieke patroon
// volgt is geldig (bv. field.margin.view in h10). costs.view is het bestaande
// samengestelde recht (#75).
const { isFieldPermission } = require("../src/platform/field-permissions");

const srcDir = process.argv[2];
if (!srcDir || !fs.existsSync(srcDir)) {
  console.error("Gebruik: node scripts/build-field-dictionary.js <map-met-chNN.json>");
  process.exit(1);
}

const files = fs.readdirSync(srcDir).filter(f => /^ch\d{2}\.json$/.test(f)).sort();
if (!files.length) { console.error(`Geen chNN.json-bestanden in ${srcDir}`); process.exit(1); }

const errors = [];
const chapters = [];
for (const f of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(srcDir, f), "utf8"));
  const where = `${f}`;
  if (!Number.isInteger(raw.chapter)) errors.push(`${where}: chapter ontbreekt`);
  if (!raw.title) errors.push(`${where}: title ontbreekt`);
  if (!raw.domain) errors.push(`${where}: domain ontbreekt`);
  if (!Array.isArray(raw.fields) || !raw.fields.length) errors.push(`${where}: fields leeg`);
  const seen = new Set();
  for (const [i, fld] of (raw.fields || []).entries()) {
    const loc = `${where} veld[${i}] ${fld.field_key || "?"}`;
    if (!fld.field_key || !/^[a-z0-9_.]+$/.test(fld.field_key)) errors.push(`${loc}: ongeldige field_key`);
    if (!REQUIRED_LEVELS.includes(fld.required)) errors.push(`${loc}: required '${fld.required}' onbekend`);
    if (!CLASSIFICATIONS.includes(fld.data_classification)) errors.push(`${loc}: classificatie '${fld.data_classification}' onbekend`);
    if (fld.view_permission != null && !isFieldPermission(fld.view_permission)) errors.push(`${loc}: view_permission '${fld.view_permission}' volgt het veldrecht-patroon niet`);
    // Sleutels uniek binnen het hoofdstuk (sectie mag dupliceren over secties heen).
    const dedupKey = `${fld.section || ""}::${fld.field_key}`;
    if (seen.has(dedupKey)) errors.push(`${loc}: dubbele field_key binnen sectie`);
    seen.add(dedupKey);
  }
  chapters.push(raw);
}

if (errors.length) {
  console.error(`Dictionary NIET gebouwd · ${errors.length} fout(en):`);
  for (const e of errors.slice(0, 40)) console.error("  - " + e);
  process.exit(1);
}

chapters.sort((a, b) => a.chapter - b.chapter);
const total = chapters.reduce((s, c) => s + c.fields.length, 0);
const out = {
  source: "Monargo_One_Forms_Information_Fields_Development_Handover_v1.1_Reseller_2026-07-22",
  chapters,
  totals: { chapters: chapters.length, fields: total },
};

const target = path.join(__dirname, "..", "src", "platform", "field-dictionary.json");
fs.writeFileSync(target, JSON.stringify(out, null, 1) + "\n", "utf8");
console.log(`OK · ${chapters.length} hoofdstukken, ${total} velden → ${path.relative(process.cwd(), target)}`);
