"use strict";
/**
 * Configuratieplatform · custom fields + configureerbare statussen
 * (master-spec h12/E10, CFG).
 *
 * Functionele beheerders passen processen aan zonder code, met behoud van
 * datakwaliteit en versiebeheer. Business rules (h12):
 *  - technische sleutel is na publicatie ONVERANDERLIJK (weergavenaam mag wel);
 *  - een gebruikt extra veld verwijderen mag niet · archiveren wel;
 *  - een verplichte instelling maakt bestaande records niet retroactief
 *    onbruikbaar (validatie geldt bij nieuwe writes, niet met terugwerkende kracht);
 *  - configuratie-lifecycle: draft → published → archived.
 *
 * Gedeelde platformservice: entiteitsroutes valideren hun customFields-object
 * tegen de gepubliceerde definities. Geen vendor/SQL (ADR-001).
 */

const { newUlid } = require("./events");

const FIELD_TYPES = ["text", "number", "date", "boolean", "select", "multiselect"];
const FIELD_STATUSES = ["draft", "published", "archived"];
// Entiteiten die (voorlopig) custom fields ondersteunen.
const SUPPORTED_ENTITIES = ["customer", "project", "workorder", "quote", "invoice", "asset", "supplier", "worksite"];

function clean(v) { return String(v == null ? "" : v).trim(); }
// Technische sleutel: lowercase, letters/cijfers/underscore, begint met letter.
function normalizeKey(v) { return clean(v).toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^[^a-z]+/, "").slice(0, 40); }

function normalizeFieldDefinition(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  const entity = SUPPORTED_ENTITIES.includes(merged.entity) ? merged.entity : null;
  if (!existing && !entity) { const e = new Error(`Entiteit is verplicht (${SUPPORTED_ENTITIES.join(", ")})`); e.status = 400; throw e; }
  const type = FIELD_TYPES.includes(merged.type) ? merged.type : "text";
  // 'label' (flat) is een alias voor labels.nl en wint bij een expliciete patch
  // (existing bewaart alleen `labels`, dus merged.label komt enkel uit de patch).
  const labels = {
    nl: clean(merged.label || (merged.labels && merged.labels.nl)),
    fr: clean((merged.labels && merged.labels.fr)),
    en: clean((merged.labels && merged.labels.en)),
  };
  if (!labels.nl) { const e = new Error("Weergavenaam (labels.nl) is verplicht"); e.status = 400; throw e; }
  const options = (type === "select" || type === "multiselect")
    ? (Array.isArray(merged.options) ? merged.options.map(o => ({ value: clean(typeof o === "string" ? o : o.value), label: clean(typeof o === "string" ? o : (o.label || o.value)) })).filter(o => o.value) : [])
    : [];
  if ((type === "select" || type === "multiselect") && !options.length && !existing) { const e = new Error("Een keuzeveld heeft minstens één optie nodig"); e.status = 400; throw e; }
  return {
    entity: entity || existing.entity,
    module: clean(merged.module) || "core",
    type,
    labels,
    required: !!merged.required,
    defaultValue: merged.defaultValue ?? null,
    options,
    group: clean(merged.group),
    order: Number.isFinite(Number(merged.order)) ? Number(merged.order) : 99,
    validation: merged.validation && typeof merged.validation === "object" ? {
      min: merged.validation.min != null ? Number(merged.validation.min) : null,
      max: merged.validation.max != null ? Number(merged.validation.max) : null,
      pattern: clean(merged.validation.pattern) || null,
    } : {},
  };
}

/** Valideer één waarde tegen een velddefinitie. @returns null of foutmelding. */
function validateValue(def, value) {
  const empty = value == null || value === "" || (Array.isArray(value) && !value.length);
  if (empty) return def.required ? `${def.labels.nl} is verplicht` : null;
  switch (def.type) {
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) return `${def.labels.nl} moet een getal zijn`;
      if (def.validation.min != null && n < def.validation.min) return `${def.labels.nl} moet ≥ ${def.validation.min} zijn`;
      if (def.validation.max != null && n > def.validation.max) return `${def.labels.nl} moet ≤ ${def.validation.max} zijn`;
      return null;
    }
    case "date": {
      const s = String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${def.labels.nl} moet een geldige datum zijn (YYYY-MM-DD)`;
      const d = new Date(`${s}T00:00:00Z`);
      // Echte kalendercheck: 2026-13-01 pareert het formaat maar bestaat niet.
      return (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s) ? null : `${def.labels.nl} moet een geldige datum zijn (YYYY-MM-DD)`;
    }
    case "boolean":
      return typeof value === "boolean" || value === "true" || value === "false" ? null : `${def.labels.nl} moet waar/onwaar zijn`;
    case "select":
      return def.options.some(o => o.value === value) ? null : `${def.labels.nl}: '${value}' is geen geldige keuze`;
    case "multiselect": {
      const arr = Array.isArray(value) ? value : [value];
      const bad = arr.find(v => !def.options.some(o => o.value === v));
      return bad ? `${def.labels.nl}: '${bad}' is geen geldige keuze` : null;
    }
    default: { // text
      if (def.validation.pattern) { try { if (!new RegExp(def.validation.pattern).test(String(value))) return `${def.labels.nl} voldoet niet aan het verwachte formaat`; } catch { /* ongeldige pattern negeren */ } }
      return null;
    }
  }
}

function makeConfigRepository(store) {
  const col = "customFields";
  return {
    list(tenantId, opts = {}) {
      let rows = (store.list(col, tenantId) || []).slice();
      if (opts.entity) rows = rows.filter(f => f.entity === opts.entity);
      if (opts.status) rows = rows.filter(f => f.status === opts.status);
      return rows.sort((a, b) => (a.order - b.order) || a.key.localeCompare(b.key));
    },
    published(tenantId, entity) { return this.list(tenantId, { entity, status: "published" }); },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(f => f.id === id) || null; },
    insert(tenantId, payload, actor) {
      const normalized = normalizeFieldDefinition(payload, null);
      const key = normalizeKey(payload.key || normalized.labels.nl);
      if (!key) { const e = new Error("Technische sleutel is ongeldig"); e.status = 400; throw e; }
      // Sleutel uniek per tenant+entiteit (h12: twee configs mogen niet dezelfde sleutel delen).
      if (this.list(tenantId, { entity: normalized.entity }).some(f => f.key === key)) {
        const e = new Error(`Technische sleutel '${key}' bestaat al voor deze entiteit`); e.status = 409; e.code = "DUPLICATE_KEY"; throw e;
      }
      const now = new Date().toISOString();
      return store.insert(col, { id: `cf_${newUlid()}`, tenantId, key, ...normalized, status: "draft", version: 1, createdAt: now, createdBy: actor || null, updatedAt: now, updatedBy: actor || null });
    },
    update(tenantId, id, patch, actor, expectedVersion) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Veld niet gevonden"); e.status = 404; throw e; }
      if (expectedVersion != null && Number(existing.version || 1) !== Number(expectedVersion)) { const e = new Error("Het veld is intussen gewijzigd."); e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = existing.version || 1; throw e; }
      // Technische sleutel is na publicatie onveranderlijk (h12); type ook.
      if (existing.status !== "draft" && patch.key && normalizeKey(patch.key) !== existing.key) {
        const e = new Error("De technische sleutel kan na publicatie niet meer wijzigen"); e.status = 409; e.code = "KEY_IMMUTABLE"; throw e;
      }
      if (existing.status !== "draft" && patch.type && patch.type !== existing.type) {
        const e = new Error("Het veldtype kan na publicatie niet meer wijzigen"); e.status = 409; e.code = "TYPE_IMMUTABLE"; throw e;
      }
      const normalized = normalizeFieldDefinition({ ...patch, entity: existing.entity }, existing);
      return store.update(col, id, { ...normalized, key: existing.key, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
    },
    transition(tenantId, id, toStatus, actor) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Veld niet gevonden"); e.status = 404; throw e; }
      if (!FIELD_STATUSES.includes(toStatus)) { const e = new Error(`Ongeldige status '${toStatus}'`); e.status = 400; throw e; }
      const allowed = { draft: ["published", "archived"], published: ["archived"], archived: [] };
      if (existing.status === toStatus) return existing;
      if (!(allowed[existing.status] || []).includes(toStatus)) { const e = new Error(`Overgang van '${existing.status}' naar '${toStatus}' is niet toegestaan`); e.status = 409; e.code = "INVALID_TRANSITION"; throw e; }
      return store.update(col, id, { status: toStatus, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null, ...(toStatus === "published" ? { publishedAt: new Date().toISOString() } : {}) });
    },
    remove(tenantId, id) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Veld niet gevonden"); e.status = 404; throw e; }
      // Alleen concept mag echt weg; gepubliceerd/gebruikt → archiveren (h12).
      if (existing.status !== "draft") { const e = new Error("Een gepubliceerd veld kan niet worden verwijderd · archiveer het"); e.status = 409; e.code = "ARCHIVE_INSTEAD"; throw e; }
      store.remove(col, id);
      return { ok: true };
    },
    /**
     * Valideer een customFields-waardenobject tegen de gepubliceerde definities
     * van een entiteit. @returns {{ ok, errors:[], values }} (genormaliseerde waarden).
     */
    validateValues(tenantId, entity, values) {
      const defs = this.published(tenantId, entity);
      const errors = [];
      const out = {};
      const input = values && typeof values === "object" ? values : {};
      for (const def of defs) {
        const raw = input[def.key] ?? def.defaultValue ?? null;
        const err = validateValue(def, raw);
        if (err) errors.push({ key: def.key, error: err });
        else if (raw != null && raw !== "") out[def.key] = def.type === "boolean" ? (raw === true || raw === "true") : def.type === "number" ? Number(raw) : raw;
      }
      // Onbekende sleutels worden genegeerd (geen technische fout, h12).
      return { ok: errors.length === 0, errors, values: out };
    },
  };
}

module.exports = { FIELD_TYPES, FIELD_STATUSES, SUPPORTED_ENTITIES, normalizeKey, normalizeFieldDefinition, validateValue, makeConfigRepository };
