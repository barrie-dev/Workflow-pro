"use strict";
/**
 * Bundels (pakketten) · door de superadmin samen te stellen sets van modules
 * en submodules. Opgeslagen in de 'bundles'-collectie (platform-niveau,
 * tenantId null). Een tenant verwijst via `tenant.plan` naar een bundle-key.
 *
 * Prijzen voor de drie standaardbundels blijven uit billing.PLAN_PACKAGES
 * komen; bundels dragen hier vooral de MODULE-samenstelling.
 */

const { gateableKeys, submoduleKeys, GATEABLE } = require("./catalog");

const COLLECTION = "bundles";

// Standaard module-samenstelling per standaardbundel (seed-waarde).
const DEFAULT_BUNDLES = [
  {
    key: "starter", label: "Starter", order: 1, active: true, custom: false,
    description: "Voor kleine teams die starten met planning en tijdregistratie.",
    modules: ["planning", "appointments", "clockings", "messages", "customers", "venues", "incidents"],
  },
  {
    key: "business", label: "Business", order: 2, active: true, custom: false, popular: true,
    description: "Het volledige operationele pakket inclusief werkbonnen en facturatie.",
    modules: ["planning", "appointments", "clockings", "messages", "customers", "venues", "incidents",
      "inbox", "workorders", "leaves", "expenses", "offertes", "invoices", "stock", "vehicles", "reports"],
  },
  {
    key: "enterprise", label: "Enterprise", order: 3, active: true, custom: true,
    description: "Alles, met integraties en maatwerkafspraken.",
    modules: gateableKeys(),
  },
];

// Nieuwe standaardmodules die aan RÉEDS BESTAANDE bundels moeten worden
// toegevoegd (append-only, éénmalig). Bijhouden via bundle.backfilled zodat
// een bewuste verwijdering door de superadmin daarna gerespecteerd blijft.
const BUNDLE_BACKFILL = {
  appointments: ["starter", "business", "enterprise"],
  // Werkongevallen-register is wettelijk verplicht voor elke werkgever → elke bundel.
  incidents: ["starter", "business", "enterprise"],
  // E-mail-intake: vanaf Business (starter kan upgraden of via override).
  inbox: ["business", "enterprise"],
};

function ensureArray(store) {
  if (!Array.isArray(store.data[COLLECTION])) store.data[COLLECTION] = [];
}

// Vul submodules-map aan: standaard alle submodules van een gekozen module aan.
function withAllSubmodules(modules) {
  const sub = {};
  for (const key of modules) {
    const subs = submoduleKeys(key);
    if (subs.length) sub[key] = subs;
  }
  return sub;
}

function normalizeBundle(raw) {
  const modules = [...new Set((raw.modules || []).filter(k => gateableKeys().includes(k)))];
  const submodules = {};
  const rawSub = raw.submodules || {};
  for (const key of modules) {
    const valid = submoduleKeys(key);
    const chosen = Array.isArray(rawSub[key]) ? rawSub[key].filter(s => valid.includes(s)) : valid;
    if (valid.length) submodules[key] = [...new Set(chosen)];
  }
  return {
    id: raw.id || `bundle_${raw.key}`,
    tenantId: null,
    key: String(raw.key || "").toLowerCase(),
    label: raw.label || raw.key,
    description: raw.description || "",
    order: Number(raw.order || 99),
    active: raw.active !== false,
    custom: !!raw.custom,
    popular: !!raw.popular,
    modules,
    submodules,
    updatedAt: new Date().toISOString(),
  };
}

/** Seed de standaardbundels één keer als de collectie leeg is. */
function seedDefaults(store) {
  ensureArray(store);
  if (!store.data[COLLECTION].length) {
    for (const def of DEFAULT_BUNDLES) {
      store.insert(COLLECTION, normalizeBundle({ ...def, submodules: withAllSubmodules(def.modules) }));
    }
    return;
  }
  // Backfill: standaardbundels die vóór de 'popular'-introductie geseed werden
  // hebben nog geen vlag. Vul de default éénmalig in (alleen als nog niet gezet),
  // zodat 'meest gekozen' out-of-the-box klopt zonder superadmin-keuzes te overschrijven.
  for (const def of DEFAULT_BUNDLES) {
    const existing = store.data[COLLECTION].find(b => b.key === def.key);
    if (existing && existing.popular === undefined) existing.popular = !!def.popular;
  }
  // Backfill: nieuwe standaardmodules éénmalig toevoegen aan bestaande bundels.
  for (const [modKey, bundleKeys] of Object.entries(BUNDLE_BACKFILL)) {
    for (const bKey of bundleKeys) {
      const b = store.data[COLLECTION].find(x => x.key === bKey);
      if (!b) continue;
      b.backfilled = Array.isArray(b.backfilled) ? b.backfilled : [];
      if (b.backfilled.includes(modKey)) continue;         // al gedaan (evt. bewust verwijderd)
      b.backfilled.push(modKey);
      if (!Array.isArray(b.modules)) b.modules = [];
      if (!b.modules.includes(modKey)) b.modules.push(modKey);
      const subs = submoduleKeys(modKey);
      if (subs.length) {
        b.submodules = b.submodules || {};
        if (!Array.isArray(b.submodules[modKey])) b.submodules[modKey] = subs;
      }
      b.updatedAt = new Date().toISOString();
    }
  }
}

function listBundles(store) {
  seedDefaults(store);
  return [...store.data[COLLECTION]].sort((a, b) => (a.order || 99) - (b.order || 99));
}

function getBundle(store, key) {
  if (!key) return null;
  seedDefaults(store);
  return store.data[COLLECTION].find(b => b.key === String(key).toLowerCase()) || null;
}

/** Maak of werk een bundel bij (upsert op key). */
function saveBundle(store, patch, actor) {
  ensureArray(store);
  const key = String(patch.key || "").toLowerCase().trim();
  if (!key) { const e = new Error("Bundel-key is verplicht"); e.status = 400; throw e; }
  if (!/^[a-z0-9_-]+$/.test(key)) { const e = new Error("Bundel-key mag enkel kleine letters, cijfers, - en _ bevatten"); e.status = 400; throw e; }
  const existing = getBundle(store, key);
  const next = normalizeBundle({ ...(existing || {}), ...patch, key });
  if (existing) store.update(COLLECTION, existing.id, next);
  else store.insert(COLLECTION, next);
  if (store.audit) store.audit({ actor: actor && actor.email, tenantId: null, action: existing ? "bundle_updated" : "bundle_created", area: "billing", detail: key });
  return next;
}

function deleteBundle(store, key, actor) {
  const bundle = getBundle(store, key);
  if (!bundle) { const e = new Error("Bundel niet gevonden"); e.status = 404; throw e; }
  const inUse = (store.data.tenants || []).filter(t => String(t.plan).toLowerCase() === bundle.key);
  if (inUse.length) { const e = new Error(`Bundel '${bundle.key}' is nog toegewezen aan ${inUse.length} tenant(s)`); e.status = 409; throw e; }
  store.remove(COLLECTION, bundle.id);
  if (store.audit) store.audit({ actor: actor && actor.email, tenantId: null, action: "bundle_deleted", area: "billing", detail: bundle.key });
  return { ok: true, key: bundle.key };
}

module.exports = { listBundles, getBundle, saveBundle, deleteBundle, seedDefaults, DEFAULT_BUNDLES, COLLECTION };
