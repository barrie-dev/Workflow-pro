"use strict";

// ── Veldrechten-register (Forms handover h3 "Rechtenmodel en veldbeveiliging"
//    · FORM-03) ───────────────────────────────────────────────────────────────
// Eén canoniek register voor veld-zichtbaarheid, gedeeld door de Forms-engine,
// de policy-laag, search, export en AI · dezelfde beslissing overal (h3: "zoek-
// resultaten, exports, dashboards, AI en integraties moeten dezelfde veldrechten
// respecteren als het scherm"). Geen SQL, puur.
//
// Kernregels uit de rolmatrix (h3):
//  - Bijzondere categorieën (special_category) en security_sensitive zijn NOOIT
//    automatisch zichtbaar - ook niet voor tenant_admin ("Geen automatische
//    bijzondere categorieën") - enkel met een expliciet veldrecht.
//  - Financieel/confidential/personal: beheerders zien binnen hun tenant; een
//    expliciet veldrecht ontsluit het rechten-gedreven voor niet-beheerders.

// De canonieke veld-zichtbaarheidsrechten (h3 "Veldniveau" + h10 field.margin.view).
// h3 noemt voorbeelden; elk recht dat het patroon field.<naam>.view volgt is
// geldig (isFieldPermission) - deze lijst is de delegeerbare catalogus.
const FIELD_PERMISSIONS = [
  "field.cost_price.view",
  "field.salary.view",
  "field.medical.view",
  "field.bank_account.view",
  "field.security_secret.view",
  "field.margin.view",
];

/** Volgt een recht het canonieke veldrecht-patroon? */
function isFieldPermission(perm) {
  return perm === "costs.view" || /^field\.[a-z0-9_]+\.view$/.test(String(perm || ""));
}

// Klasse-brede rechten: bezit van één ervan ontsluit de hele klasse. 'costs.view'
// blijft als bestaand zichtbaarheidsrecht (samenstelbare profielen #75) meelopen
// voor financieel, zodat forms en de rest van de app hetzelfde recht respecteren.
const CLASSIFICATION_PERMISSION = {
  financial: ["field.cost_price.view", "field.bank_account.view", "costs.view"],
  security_sensitive: ["field.security_secret.view"],
};

// Klassen die nooit automatisch (ook niet voor beheerders) zichtbaar zijn; enkel
// met een expliciet veldrecht op het veld zelf.
const EXPLICIT_ONLY_CLASSIFICATIONS = new Set(["special_category", "security_sensitive"]);

// Beheerdersrollen die confidential/personal/financial binnen hun tenant zien.
const ADMIN_ROLES = new Set(["tenant_admin", "super_admin"]);

// Scope-prefixen die van een recht-string gestript worden om de kale sleutel te
// vergelijken (de 7-scope-ladder uit h3, zie policy.js).
const SCOPE_PREFIX = /^(read:|team:|own:|assigned:|project:|company:|platform:)/;

/** Heeft de gebruiker (effectieve permissions) dit specifieke veldrecht? */
function hasFieldPermission(user, permission) {
  if (!permission) return false;
  const perms = (user && user.permissions) || [];
  return perms.includes("*") || perms.some(p => String(p).replace(SCOPE_PREFIX, "") === permission);
}

/**
 * Mag de gebruiker een veld met deze classificatie + (optioneel) expliciet
 * view_permission ZIEN? De centrale beslissing voor UI/API/search/export/AI.
 * @param {object} user
 * @param {{classification?:string, viewPermission?:string}} field
 */
function canViewClassified(user, { classification, viewPermission } = {}) {
  const cls = classification || "internal";
  if (cls === "public" || cls === "internal") return true;
  if (!user) return false;
  // 1) Expliciet veldrecht op het veld zelf ontsluit altijd.
  if (viewPermission && hasFieldPermission(user, viewPermission)) return true;
  // 2) Klasse-breed recht ontsluit (financieel, security).
  const mapped = CLASSIFICATION_PERMISSION[cls] || [];
  if (mapped.some(p => hasFieldPermission(user, p))) return true;
  // 3) Bijzondere categorieën + security: nooit automatisch (spec-carve-out).
  if (EXPLICIT_ONLY_CLASSIFICATIONS.has(cls)) return false;
  // 4) confidential/personal/financial: beheerders zien binnen hun tenant.
  return !!user && ADMIN_ROLES.has(user.role);
}

/** Vertaal een classificatie naar de veldrechten die ze kunnen ontsluiten (UI-hint). */
function permissionsForClassification(classification) {
  return CLASSIFICATION_PERMISSION[classification] ? [...CLASSIFICATION_PERMISSION[classification]] : [];
}

module.exports = {
  FIELD_PERMISSIONS, CLASSIFICATION_PERMISSION, EXPLICIT_ONLY_CLASSIFICATIONS,
  hasFieldPermission, canViewClassified, permissionsForClassification, isFieldPermission,
};
