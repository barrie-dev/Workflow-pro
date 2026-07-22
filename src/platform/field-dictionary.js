"use strict";

// ── Velddictionary-loader (Forms handover h6-h24 · datadictionary) ───────────
// Ontsluit de normatieve velddictionary (field-dictionary.json, gebouwd door
// scripts/build-field-dictionary.js) voor de engine: per hoofdstuk/domein de
// canonieke velden mét classificatie, verplichtheid en veldrechten. structureFor()
// vertaalt een hoofdstuk naar de draft-structuur van de canonieke Forms-engine,
// zodat standaardformulieren hun ECHTE spec-velden dragen (geen verzonnen subset).

const DICT = require("./field-dictionary.json");

const byChapter = new Map(DICT.chapters.map(c => [c.chapter, c]));
const byDomain = new Map();
for (const c of DICT.chapters) {
  if (!byDomain.has(c.domain)) byDomain.set(c.domain, []);
  byDomain.get(c.domain).push(c);
}

/** Map het spec-type naar het engine-indextype (number/date/text). */
function engineFieldType(specType) {
  const t = String(specType || "").toLowerCase();
  if (/number|integer|numeric|decimal|bedrag|amount|percentage/.test(t)) return "number";
  if (/datetime|date|datum/.test(t)) return "date";
  return "text";
}

/** Alle velden van een hoofdstuk (of leeg). */
function fieldsForChapter(chapter) {
  const c = byChapter.get(chapter);
  return c ? c.fields : [];
}

/** Alle hoofdstukken voor een domeinobject (customer, project, ...). */
function chaptersForDomain(domain) {
  return byDomain.get(domain) || [];
}

/**
 * Vertaal een hoofdstuk naar de canonieke draft-structuur (sections + fields)
 * voor setDraftStructure. Secties volgen de spec-subsecties (of één hoofdsectie).
 * Systeemvelden gaan mee als read-only (required: "system") · de engine weigert
 * ze te bewerken (canEditField).
 */
function structureFor(chapter) {
  const c = byChapter.get(chapter);
  if (!c) return null;
  const sectionKeys = [];
  const sections = [];
  const seenSection = new Set();
  const usedKeys = new Set();
  const fields = [];
  for (const f of c.fields) {
    const sectionTitle = f.section || c.title;
    const sKey = sectionTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "main";
    if (!seenSection.has(sKey)) {
      seenSection.add(sKey);
      sectionKeys.push(sKey);
      sections.push({ key: sKey, title: { nl: sectionTitle } });
    }
    // Sleutels uniek binnen de structuur: bij botsing over secties heen prefixen.
    let key = f.field_key;
    if (usedKeys.has(key)) key = `${sKey}__${f.field_key}`.slice(0, 80);
    if (usedKeys.has(key)) continue; // identiek duplicaat · spec herhaalt universele metadata
    usedKeys.add(key);
    fields.push({
      field_key: key,
      section_key: sKey,
      label: { nl: f.label },
      field_type: engineFieldType(f.field_type),
      spec_type: f.field_type,
      required: f.required,
      data_classification: f.data_classification,
      view_permission: f.view_permission || undefined,
      usage: f.usage || undefined,
    });
  }
  return { sections, fields };
}

module.exports = {
  DICTIONARY: DICT,
  totals: DICT.totals,
  fieldsForChapter, chaptersForDomain, structureFor, engineFieldType,
};
