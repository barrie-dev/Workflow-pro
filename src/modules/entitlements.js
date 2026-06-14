"use strict";
/**
 * Entitlement-resolver: bepaalt welke modules/submodules een tenant écht heeft,
 * door de bundel (tenant.plan) te combineren met per-tenant overrides.
 *
 *   tenant.moduleOverrides = { add: [moduleKey], remove: [moduleKey] }
 *   tenant.submoduleOverrides = { <moduleKey>: [subKey, ...] }   // vervangt bundelset
 *
 * Kernmodules (catalog core:true) zijn altijd actief en niet af te schakelen.
 * super_admin omzeilt alle gating.
 */

const { gateableKeys, CORE_MODULES, GATEABLE, moduleForAction, moduleByKey, submoduleKeys } = require("./catalog");
const { getBundle, listBundles } = require("./bundles");

function pickBundle(store, tenant) {
  return getBundle(store, tenant && tenant.plan) || getBundle(store, "business") || listBundles(store)[0] || null;
}

/**
 * Geef de opgeloste entitlements voor een tenant.
 * @returns {{ plan:string, modules:string[], submodules:Object, coreViews:string[], views:string[] }}
 */
function resolveTenantModules(store, tenant) {
  const bundle = pickBundle(store, tenant);
  const base = new Set(bundle ? bundle.modules : gateableKeys());

  const ov = (tenant && tenant.moduleOverrides) || {};
  for (const k of ov.add || []) if (gateableKeys().includes(k)) base.add(k);
  for (const k of ov.remove || []) base.delete(k);

  const modules = [...base];

  // Submodules: bundelset, tenzij per-tenant expliciet overschreven.
  const submodules = {};
  const subOv = (tenant && tenant.submoduleOverrides) || {};
  for (const key of modules) {
    const valid = submoduleKeys(key);
    if (!valid.length) continue;
    if (Array.isArray(subOv[key])) {
      submodules[key] = subOv[key].filter(s => valid.includes(s));
    } else if (bundle && bundle.submodules && Array.isArray(bundle.submodules[key])) {
      submodules[key] = bundle.submodules[key].filter(s => valid.includes(s));
    } else {
      submodules[key] = valid;
    }
  }

  const coreViews = CORE_MODULES.map(m => m.view);
  const gatedViews = modules.map(k => (moduleByKey(k) || {}).view).filter(Boolean);

  return {
    plan: bundle ? bundle.key : (tenant && tenant.plan) || "business",
    bundleLabel: bundle ? bundle.label : null,
    modules,
    submodules,
    coreViews,
    views: [...new Set([...coreViews, ...gatedViews])],
  };
}

function isModuleEnabled(store, tenant, moduleKey) {
  const m = moduleByKey(moduleKey);
  if (!m) return false;
  if (m.core) return true;
  return resolveTenantModules(store, tenant).modules.includes(moduleKey);
}

function isSubmoduleEnabled(store, tenant, moduleKey, subKey) {
  if (!isModuleEnabled(store, tenant, moduleKey)) return false;
  const subs = resolveTenantModules(store, tenant).submodules[moduleKey] || [];
  return subs.includes(subKey);
}

/**
 * Handhaaf module-toegang voor een API-action. super_admin omzeilt.
 * Onbekende/kern-actions zijn altijd toegestaan (moduleForAction → null).
 */
function assertModuleEnabled(store, user, tenant, action) {
  if (user && user.role === "super_admin") return;
  const mod = moduleForAction(action);
  if (!mod) return; // kern of niet-gated
  if (!isModuleEnabled(store, tenant, mod.key)) {
    const e = new Error(`Module '${mod.label}' is niet inbegrepen in het pakket van deze organisatie.`);
    e.status = 403;
    e.code = "module_disabled";
    e.module = mod.key;
    throw e;
  }
}

// Operationele rechten die een tenant-admin per medewerker mag toekennen.
// Bewust GEEN admin-rechten (settings, billing, audit, tenants, employees, integrations):
// die blijven voorbehouden aan de tenant_admin-rol — geen escalatie via per-user rechten.
// Ook GEEN 'clockings': in-/uitprikken is basisfunctionaliteit die ELKE gebruiker
// altijd heeft, ongeacht functie — dus niet per-user uitschakelbaar (zie ALWAYS_PERMISSIONS).
const OPERATIONAL_PERMISSIONS = [
  { key: "planning", label: "Planning" },
  { key: "workorders", label: "Werkbonnen" },
  { key: "expenses", label: "Onkosten" },
  { key: "leaves", label: "Verlof" },
  { key: "messages", label: "Berichten" },
  { key: "customers", label: "Klanten" },
  { key: "venues", label: "Locaties / werven" },
  { key: "stock", label: "Stock" },
  { key: "vehicles", label: "Wagenpark" },
];

// Rechten die iedereen altijd heeft (kunnen niet per gebruiker worden afgenomen).
const ALWAYS_PERMISSIONS = ["clockings"];
const OPERATIONAL_KEYS = new Set(OPERATIONAL_PERMISSIONS.map(p => p.key));

/** Rechten die de tenant-admin per gebruiker mag toekennen = operationeel ∩ tenant-entitlements. */
function grantablePermissions(store, tenant) {
  const enabled = new Set(resolveTenantModules(store, tenant).modules);
  return OPERATIONAL_PERMISSIONS.filter(p => enabled.has(p.key));
}

module.exports = {
  resolveTenantModules,
  isModuleEnabled,
  isSubmoduleEnabled,
  assertModuleEnabled,
  grantablePermissions,
  OPERATIONAL_PERMISSIONS,
  OPERATIONAL_KEYS,
  ALWAYS_PERMISSIONS,
};
