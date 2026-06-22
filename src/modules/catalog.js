"use strict";
/**
 * Module- en submodule-catalogus voor de entitlement-laag.
 *
 * Dit is de marketeerbare boom (wat een tenant kan "krijgen") — los van de
 * rol-permissions in lib/auth.js. Superadmin stelt bundels samen uit deze
 * modules/submodules; per tenant kan worden afgeweken (overrides).
 *
 * - `core: true`  → altijd beschikbaar, nooit af te schakelen (dashboard,
 *   medewerkers, instellingen, abonnement, audit). Niet in bundels te kiezen.
 * - `core: false` → optionele module ("extensie"), gated in nav én API.
 *
 * `actions` = de API-action-prefixes (eerste segment van /api/tenants/:id/<action>)
 * die bij deze module horen; gebruikt voor server-side 403-handhaving.
 * `view`    = de client `data-view` waarde voor nav-gating.
 */

const MODULE_CATALOG = [
  // ── Operaties ─────────────────────────────────────────────
  { key: "planning", label: "Planning", group: "Operaties", core: false,
    view: "planning", actions: ["planning"],
    submodules: [
      { key: "shift-templates", label: "Ploegsjablonen" },
      { key: "calendar-export", label: "Kalender-export" },
    ] },
  { key: "workorders", label: "Werkbonnen", group: "Operaties", core: false,
    view: "workorders", actions: ["workorders"],
    submodules: [
      { key: "photos", label: "Foto's" },
      { key: "signature", label: "Digitale handtekening" },
      { key: "pdf", label: "PDF-export" },
    ] },
  { key: "clockings", label: "Prikklok / tijdregistratie", group: "Operaties", core: false,
    view: "clocking", actions: ["clock", "clocks"],
    submodules: [
      { key: "gps", label: "GPS-locatie" },
      { key: "corrections", label: "Correcties" },
    ] },
  { key: "leaves", label: "Verlof", group: "Operaties", core: false,
    view: "leaves", actions: ["leaves"],
    submodules: [
      { key: "balances", label: "Verlofsaldi" },
      { key: "calendar", label: "Verlofkalender" },
    ] },
  { key: "expenses", label: "Onkosten", group: "Operaties", core: false,
    view: "expenses", actions: ["expenses"],
    submodules: [
      { key: "approval", label: "Goedkeuringsflow" },
      { key: "receipt-scan", label: "Bonnetjes-scan" },
    ] },
  { key: "messages", label: "Berichten", group: "Operaties", core: false,
    view: "messages", actions: ["messages"], submodules: [] },

  // ── Klanten & Financiën ───────────────────────────────────
  { key: "customers", label: "Klanten", group: "Klanten & Financiën", core: false,
    view: "customers", actions: ["customers"], submodules: [] },
  { key: "offertes", label: "Offertes", group: "Klanten & Financiën", core: false,
    view: "offertes", actions: ["offertes"],
    submodules: [
      { key: "pdf", label: "PDF-export" },
      { key: "online-accept", label: "Online accepteren" },
    ] },
  { key: "invoices", label: "Facturen", group: "Klanten & Financiën", core: false,
    view: "facturen", actions: ["facturen"],
    submodules: [
      { key: "peppol", label: "Peppol e-facturatie" },
      { key: "reminders", label: "Betaalherinneringen" },
      { key: "online-payment", label: "Online betalen (Stripe)" },
    ] },

  // ── Middelen ──────────────────────────────────────────────
  { key: "stock", label: "Stock / magazijn", group: "Middelen", core: false,
    view: "stock", actions: ["stock"],
    submodules: [{ key: "low-alerts", label: "Lage-voorraad alerts" }] },
  { key: "vehicles", label: "Wagenpark", group: "Middelen", core: false,
    view: "vehicles", actions: ["vehicles"],
    submodules: [{ key: "maintenance", label: "Onderhoudsplanning" }] },
  { key: "venues", label: "Locaties / werven", group: "Middelen", core: false,
    view: "venues", actions: ["venues"], submodules: [] },

  // ── Inzicht & Systeem ─────────────────────────────────────
  { key: "reports", label: "Rapportages", group: "Inzicht", core: false,
    view: "reports", actions: ["reports"],
    submodules: [{ key: "datahub-export", label: "Datahub export" }] },
  { key: "integrations", label: "Integraties", group: "Systeem", core: false,
    view: "integrations", actions: ["integrations"], submodules: [] },
  // Add-on: Single Sign-On via SAML 2.0. Geen eigen nav-view — de configuratie
  // leeft in Instellingen. À-la-carte: superadmin zet 'm per tenant aan via
  // moduleOverrides.add (niet standaard in een bundel).
  { key: "sso", label: "Single Sign-On (SAML)", group: "Systeem", core: false,
    addon: true, actions: ["sso", "saml"], submodules: [],
    addonMonthly: 49, addonDesc: "Veilig aanmelden via je eigen identiteitsprovider (Azure AD, Okta, Google). Per organisatie." },
  // Add-on: laat de AI-assistent (Boden) écht acties uitvoeren namens de gebruiker
  // (na bevestiging). Betaalde add-on want de AI-kost van handelen is vooraf niet
  // te bepalen. Zonder deze add-on blijft Boden read-only (vragen/analyse/KPI's).
  { key: "ai_actions", label: "AI-acties (Boden voert uit)", group: "Systeem", core: false,
    addon: true, actions: [], submodules: [],
    addonMonthly: 29, addonDesc: "Laat de AI-assistent taken uitvoeren (verlof, onkosten, klanten, werkbonnen…) na jouw bevestiging." },
];

// Altijd-aan modules: nooit gated, niet in bundels te kiezen.
const CORE_MODULES = [
  { key: "dashboard", label: "Dashboard", group: "Kern", core: true, view: "dashboard" },
  { key: "employees", label: "Medewerkers", group: "Kern", core: true, view: "employees" },
  { key: "billing", label: "Abonnement & facturatie", group: "Kern", core: true, view: "billing" },
  { key: "settings", label: "Instellingen", group: "Kern", core: true, view: "settings" },
  { key: "audit", label: "Audittrail", group: "Kern", core: true, view: "audit" },
  { key: "roadmap", label: "Roadmap", group: "Kern", core: true, view: "roadmap" },
];

const GATEABLE = MODULE_CATALOG.filter(m => !m.core);
const gateableKeys = () => GATEABLE.map(m => m.key);
const allModuleKeys = () => MODULE_CATALOG.map(m => m.key);

// Betaalde add-ons (à-la-carte) met prijs — voor de prijzen-/facturatie-UI.
// `overrides` (per add-on, door superadmin bewerkbaar) overschrijft naam/prijs/
// omschrijving; `active:false` verbergt de add-on uit het aanbod. `includeInactive`
// is voor de superadmin-editor zelf (die wil ook gedeactiveerde add-ons zien).
function listAddons(overrides, includeInactive) {
  const ov = overrides || {};
  return MODULE_CATALOG
    .filter(m => m.addon)
    .map(m => {
      const o = ov[m.key] || {};
      return {
        key: m.key,
        label: o.label || m.label,
        monthly: o.monthly != null ? o.monthly : (m.addonMonthly ?? null),
        description: o.description || m.addonDesc || "",
        active: o.active !== false,
        // defaults erbij zodat de editor "terug naar standaard" kan tonen
        defaults: { label: m.label, monthly: m.addonMonthly ?? null, description: m.addonDesc || "" },
      };
    })
    .filter(a => includeInactive || a.active);
}

function moduleByKey(key) {
  return MODULE_CATALOG.find(m => m.key === key) || CORE_MODULES.find(m => m.key === key) || null;
}

/**
 * Welke gateable module hoort bij een API-action? Geeft de catalogus-module
 * terug, of null als de action niet gated is (kern/onbekend → altijd toegestaan).
 */
function moduleForAction(action) {
  const head = String(action || "").split("/")[0].toLowerCase();
  if (!head) return null;
  return GATEABLE.find(m => m.actions.includes(head)) || null;
}

/** Submodule-keys voor een module (voor validatie van overrides/bundels). */
function submoduleKeys(moduleKey) {
  const m = moduleByKey(moduleKey);
  return m && Array.isArray(m.submodules) ? m.submodules.map(s => s.key) : [];
}

module.exports = {
  MODULE_CATALOG,
  CORE_MODULES,
  GATEABLE,
  gateableKeys,
  allModuleKeys,
  listAddons,
  moduleByKey,
  moduleForAction,
  submoduleKeys,
};
