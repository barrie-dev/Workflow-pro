"use strict";

// ── Gedeelde Forms-engine · kernlogica (Forms handover · F1 Foundation) ──────
// Eén platformbrede engine (finale CTO-directive: geen parallelle engine). Deze
// module is de PURE beslislaag: de instance-state-machine, de immutable-publish-
// regels, segregation of duties, en de veld-/classificatierechten. Persistentie
// gebeurt in de pg-forms-repository; deze module bevat geen SQL en is los testbaar.

// ── Datamodel-enums (spiegelen migratie 008_forms.sql) ───────────────────────
const FORM_TYPES = ["domain", "workflow", "evidence", "survey"];
const DEFINITION_STATUSES = ["system_required", "available", "enabled", "conditional", "scheduled", "paused", "deprecated", "archived"];
const CLASSIFICATIONS = ["public", "internal", "confidential", "personal", "special_category", "financial", "security_sensitive"];
const REQUIRED_LEVELS = ["optional", "required", "conditional", "system"];

// Instance-lifecycle (spec h4). De machine is de bron van waarheid voor toegestane
// overgangen · een overgang die hier niet staat, is verboden.
const INSTANCE_STATES = [
  "not_started", "draft", "submitted", "in_review", "changes_requested",
  "resubmitted", "approved", "rejected", "signed", "completed",
  "withdrawn", "void", "archived",
];
const INSTANCE_TRANSITIONS = {
  not_started: ["draft", "withdrawn", "void"],
  draft: ["submitted", "withdrawn", "void"],
  submitted: ["in_review", "approved", "rejected", "changes_requested", "signed", "completed", "void"],
  in_review: ["approved", "rejected", "changes_requested", "void"],
  changes_requested: ["resubmitted", "withdrawn", "void"],
  resubmitted: ["in_review", "approved", "rejected", "changes_requested", "void"],
  approved: ["signed", "completed", "void"],
  rejected: ["resubmitted", "withdrawn", "void", "archived"],
  signed: ["completed", "void"],
  completed: ["archived"],
  withdrawn: ["archived"],
  void: ["archived"],
  archived: [],
};
// Statussen waarin de antwoorden nog bewerkbaar zijn (anders read-only).
const EDITABLE_STATES = new Set(["not_started", "draft", "changes_requested"]);
// Terminale statussen (geen inhoudelijke wijziging meer).
const TERMINAL_STATES = new Set(["completed", "void", "archived", "rejected"]);

function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }

/** Is de overgang from→to toegestaan volgens de state-machine? */
function canTransition(from, to) {
  return Array.isArray(INSTANCE_TRANSITIONS[from]) && INSTANCE_TRANSITIONS[from].includes(to);
}

/** Dwing een geldige overgang af, anders een 409 INVALID_TRANSITION. */
function assertTransition(from, to) {
  if (!INSTANCE_STATES.includes(to)) throw err(400, "INVALID_STATUS", `Onbekende status: ${to}`);
  if (from === to) return; // idempotent no-op
  if (!canTransition(from, to)) throw err(409, "INVALID_TRANSITION", `Overgang ${from} → ${to} is niet toegestaan.`);
}

function isEditable(status) { return EDITABLE_STATES.has(status); }
function isTerminal(status) { return TERMINAL_STATES.has(status); }

// ── FORM-02 · versie-lifecycle: gepubliceerd = ONVERANDERLIJK ────────────────
/**
 * Guard: een gepubliceerde versie mag niet meer inhoudelijk wijzigen. Een
 * wijziging maakt een NIEUWE versie; bestaande instances blijven aan hun
 * oorspronkelijke versie gekoppeld.
 */
function assertVersionEditable(version) {
  if (version && version.published === true) {
    throw err(409, "VERSION_PUBLISHED_IMMUTABLE", "Een gepubliceerde formulierversie is onveranderlijk. Maak een nieuwe versie.");
  }
}

/** Het volgende versienummer voor een definitie (max bestaand + 1, start op 1). */
function nextVersionNumber(existingVersionNumbers = []) {
  const max = existingVersionNumbers.reduce((m, n) => Math.max(m, Number(n) || 0), 0);
  return max + 1;
}

// ── FORM-04 · optimistic concurrency (If-Match) ──────────────────────────────
function assertIfMatch(current, expected) {
  if (expected == null) return; // geen If-Match meegegeven
  if (Number(current) !== Number(expected)) {
    const e = err(409, "VERSION_CONFLICT", "De instance is intussen gewijzigd (If-Match komt niet overeen).");
    e.currentVersion = current;
    throw e;
  }
}

// ── FORM-07 · segregation of duties ──────────────────────────────────────────
/**
 * Een gebruiker mag zijn eigen inzending niet goedkeuren, en niet twee keer op
 * dezelfde stap beslissen. `priorActors` = actoren die op deze stap al beslisten.
 */
function assertSegregationOfDuties({ actor, submitter, priorActors = [] }) {
  if (actor && submitter && actor === submitter) {
    throw err(403, "SOD_SELF_APPROVAL", "Je kunt je eigen inzending niet goedkeuren (segregation of duties).");
  }
  if (actor && priorActors.includes(actor)) {
    throw err(409, "SOD_DUPLICATE_ACTION", "Je hebt op deze goedkeuringsstap al beslist.");
  }
}

// ── FORM-05 · veld- en classificatierechten (server-side, één poort) ─────────
// Alleen beheerders zien standaard confidential/financieel/personal/special;
// een expliciet view_permission op het veld ontsluit het rechten-gedreven (bv.
// field.cost_price.view). Dezelfde beslissing geldt in UI, API, search, export en AI.
const ADMIN_ROLES = new Set(["tenant_admin", "super_admin"]);
const OPEN_CLASSIFICATIONS = new Set(["public", "internal"]);

function userHasPermission(user, permission) {
  if (!permission) return false;
  const perms = (user && user.permissions) || [];
  return perms.includes("*") || perms.some(p => String(p).replace(/^(read:|team:|own:)/, "") === permission);
}

/** Mag deze gebruiker het veld ZIEN? */
function canViewField(user, field) {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  const cls = (field && field.data_classification) || "internal";
  if (OPEN_CLASSIFICATIONS.has(cls)) return true;
  if (field && field.view_permission && userHasPermission(user, field.view_permission)) return true;
  return ADMIN_ROLES.has(user.role); // tenant_admin ziet gevoelige velden binnen zijn tenant
}

/** Mag deze gebruiker het veld WIJZIGEN? (systeemvelden nooit) */
function canEditField(user, field) {
  if (!field || field.required === "system") return false;
  if (!canViewField(user, field)) return false;
  if (field.edit_permission) return userHasPermission(user, field.edit_permission) || ADMIN_ROLES.has(user.role) || user.role === "super_admin";
  return true;
}

/** Strip velden die de gebruiker niet mag zien uit een antwoordenmap. */
function redactAnswers(user, fields, answers) {
  const out = {};
  const byKey = new Map((fields || []).map(f => [f.field_key || f.key, f]));
  for (const [key, val] of Object.entries(answers || {})) {
    const field = byKey.get(key);
    if (!field || canViewField(user, field)) out[key] = val;
  }
  return out;
}

// ── Validatie van antwoorden tegen de veld-dictionary (server-side, vertaald) ─
/**
 * Valideer ingediende antwoorden tegen de velddefinities. Retourneert
 * { ok, fieldErrors } · fieldErrors is per veld voor 422-responses (spec h27).
 */
function validateAnswers(fields, answers, { forSubmit = true } = {}) {
  const fieldErrors = {};
  const a = answers || {};
  for (const f of fields || []) {
    const key = f.field_key || f.key;
    const present = a[key] != null && a[key] !== "";
    const req = f.required || "optional";
    if (forSubmit && req === "required" && !present) {
      fieldErrors[key] = "verplicht";
      continue;
    }
    if (present && f.validation && typeof f.validation === "object") {
      const v = f.validation;
      const val = a[key];
      if (v.maxLength && String(val).length > v.maxLength) fieldErrors[key] = `max ${v.maxLength} tekens`;
      if (v.pattern && !(new RegExp(v.pattern).test(String(val)))) fieldErrors[key] = "ongeldig formaat";
      if (v.min != null && Number(val) < v.min) fieldErrors[key] = `min ${v.min}`;
      if (v.max != null && Number(val) > v.max) fieldErrors[key] = `max ${v.max}`;
      if (Array.isArray(v.enum) && !v.enum.includes(val)) fieldErrors[key] = "ongeldige keuze";
    }
  }
  return { ok: Object.keys(fieldErrors).length === 0, fieldErrors };
}

// Bouw de typed answer-index-rijen (voor reporting/search) uit antwoorden + velden.
function buildAnswerIndex(fields, answers) {
  const byKey = new Map((fields || []).map(f => [f.field_key || f.key, f]));
  const rows = [];
  for (const [key, val] of Object.entries(answers || {})) {
    const f = byKey.get(key);
    if (!f) continue;
    const row = { field_key: key, reporting_allowed: !!f.reporting_allowed, ai_allowed: !!f.ai_allowed, value_text: null, value_num: null, value_date: null };
    if (val == null) { rows.push(row); continue; }
    const t = f.field_type || "text";
    if (t === "number") row.value_num = Number(val);
    else if (t === "date") row.value_date = /^\d{4}-\d{2}-\d{2}/.test(String(val)) ? String(val).slice(0, 10) : null;
    else row.value_text = String(val).slice(0, 4000);
    rows.push(row);
  }
  return rows;
}

module.exports = {
  FORM_TYPES, DEFINITION_STATUSES, CLASSIFICATIONS, REQUIRED_LEVELS,
  INSTANCE_STATES, INSTANCE_TRANSITIONS, EDITABLE_STATES, TERMINAL_STATES,
  canTransition, assertTransition, isEditable, isTerminal,
  assertVersionEditable, nextVersionNumber, assertIfMatch,
  assertSegregationOfDuties, canViewField, canEditField, redactAnswers,
  validateAnswers, buildAnswerIndex, userHasPermission,
};
