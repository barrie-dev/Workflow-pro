"use strict";

// ── Reseller-domein · pure beslislaag (h23 · spec 23.2/23.3/23.7/23.14) ──────
// Constanten, veldvalidatie en statusmachines voor het partnerkanaal. Deze
// module kent GEEN store, GEEN I/O en GEEN configuratie · alles is los
// testbaar. De store-gebonden servicelaag (src/modules/) en de routes bouwen
// hierop voort. De payout-statusmachine leeft bewust NIET hier maar in
// src/platform/commission-ledger.js (PAYOUT_STATES/PAYOUT_TRANSITIONS,
// CTO2-10) · niet dupliceren.
//
// Harde regels uit de spec die deze laag bewaakt:
//  - de tenant blijft altijd een aparte beveiligingsgrens; reseller_id
//    vervangt nooit tenant_id in businessdata (23.9);
//  - een tenantkoppeling geeft alleen commerciele metadata, tenzij apart
//    gedelegeerd beheer is goedgekeurd (23.4);
//  - veiligheidsdefaults staan UIT: delegated_support_allowed en
//    delegated_tenant_admin_allowed zijn standaard false (23.2);
//  - suspensie blokkeert nieuwe deals/aanvragen/beheeracties maar bewaart
//    historische rapportering (23.4/23.14).

function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
function isBlank(v) {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}
function clean(v) { return String(v == null ? "" : v).trim(); }

// ── 23.3 · Kanaaltypen ───────────────────────────────────────────────────────
// Elk kanaaltype krijgt eigen contract-, recht- en commissieregels. Een
// organisatie kan meerdere rollen hebben; bevoegdheden stapelen NIET
// automatisch. "nietAutomatisch" is normatief: die zaken vereisen altijd een
// aparte, expliciete en intrekbare toestemming.
const CHANNEL_TYPES = Object.freeze({
  referral: Object.freeze({
    label: "Referral partner",
    doel: "Brengt leads aan.",
    bevoegdheden: Object.freeze(["dealregistratie", "status_eigen_deals", "commissieoverzicht"]),
    nietAutomatisch: Object.freeze(["tenantbeheer", "klantdata", "supporttoegang"]),
  }),
  reseller: Object.freeze({
    label: "Reseller",
    doel: "Verkoopt Monargo One door aan eindklanten.",
    bevoegdheden: Object.freeze(["tenantaanvraag", "licenties", "commerciele_opvolging", "optionele_support"]),
    nietAutomatisch: Object.freeze(["volledige_klantdata", "superadminrechten"]),
  }),
  implementation: Object.freeze({
    label: "Implementatiepartner",
    doel: "Begeleidt configuratie, import en adoptie.",
    bevoegdheden: Object.freeze(["tijdelijke_project_of_tenanttoegang_na_goedkeuring"]),
    nietAutomatisch: Object.freeze(["billing", "commissies", "blijvende_beheerrechten"]),
  }),
  support: Object.freeze({
    label: "Supportpartner",
    doel: "Levert eerstelijns support.",
    bevoegdheden: Object.freeze(["ticketinzage_toegewezen_tenants", "beperkte_diagnose"]),
    nietAutomatisch: Object.freeze(["impersonatie", "data_export_zonder_tenanttoestemming"]),
  }),
  technology: Object.freeze({
    label: "Technology partner",
    doel: "Levert integratie of connector.",
    bevoegdheden: Object.freeze(["integratieconfiguratie", "technische_status"]),
    nietAutomatisch: Object.freeze(["crm_data", "finance_data", "hr_data_buiten_scope"]),
  }),
});

// 23.2 · het VELD partner_type is een strikter enum dan de kanaaltypen:
// "support" is wel een kanaaltype (23.3) maar geen geldige partner_type-waarde.
const PARTNER_TYPES = Object.freeze(["referral", "reseller", "implementation", "technology"]);

// ── 23.2 · overige veldenums ─────────────────────────────────────────────────
const PARTNER_TIERS = Object.freeze(["registered", "silver", "gold", "custom"]);
const LANGUAGES = Object.freeze(["NL", "FR", "EN"]);
const SERVICE_SCOPES = Object.freeze(["sales", "onboarding", "implementation", "support"]);
const COMMISSION_MODELS = Object.freeze(["percentage", "fixed", "recurring"]);
const COMMISSION_STATUSES = Object.freeze(["pending", "approved", "paid", "disputed"]);
const ONBOARDING_STATUSES = Object.freeze(["applied", "screening", "contracting", "training", "active"]);
const ADDRESS_KEYS = Object.freeze(["straat", "nummer", "postcode", "gemeente", "land"]);

// Veiligheidsdefaults (23.2): gedelegeerde bevoegdheden staan standaard UIT en
// worden uitsluitend door de platform partner admin gezet. Voor gedelegeerd
// tenantbeheer is bovendien per tenant extra toestemming vereist.
const SECURITY_DEFAULTS = Object.freeze({
  delegated_support_allowed: false,
  delegated_tenant_admin_allowed: false,
});

/** Kloon met veiligheidsdefaults ingevuld waar het veld ontbreekt. */
function withSecurityDefaults(org) {
  const out = { ...(org || {}) };
  for (const [k, v] of Object.entries(SECURITY_DEFAULTS)) {
    if (typeof out[k] !== "boolean") out[k] = v;
  }
  return out;
}

// ── Statusmachine-fabriek (23.14 · letterlijk) ───────────────────────────────
// Zelfde semantiek als assertPayoutTransition in commission-ledger.js:
// onbekende status → 400, ongeldige overgang → 409, zelfde status → no-op.
function createMachine(key, codePrefix, transitions) {
  const STATES = Object.freeze(Object.keys(transitions));
  const TRANSITIONS = Object.freeze(Object.fromEntries(
    Object.entries(transitions).map(([from, to]) => [from, Object.freeze([...to])])
  ));
  function assertTransition(from, to) {
    if (!STATES.includes(from)) throw err(400, `${codePrefix}_STATE_INVALID`, `onbekende status ${from}`);
    if (!STATES.includes(to)) throw err(400, `${codePrefix}_STATE_INVALID`, `onbekende status ${to}`);
    if (from === to) return to;
    if (!TRANSITIONS[from].includes(to)) {
      throw err(409, `${codePrefix}_TRANSITION_INVALID`, `overgang ${from} → ${to} niet toegestaan`);
    }
    return to;
  }
  function canTransition(from, to) {
    if (!STATES.includes(from) || !STATES.includes(to)) return false;
    return from === to || TRANSITIONS[from].includes(to);
  }
  return Object.freeze({
    key, STATES, TRANSITIONS, assertTransition, canTransition,
    initial: STATES[0],
    isTerminal: s => STATES.includes(s) && TRANSITIONS[s].length === 0,
  });
}

// Resellerorganisatie (23.14 is de normatieve superset van het 23.2-veldenum).
const resellerOrganization = createMachine("resellerOrganization", "RESELLER_ORG", {
  applicant: ["screening"],
  screening: ["contracting"],
  contracting: ["onboarding"],
  onboarding: ["active"],
  active: ["suspended"],
  suspended: ["terminated"],
  terminated: [],
});

// Deal (23.8/23.14) · de claim heeft een beperkte geldigheidsduur.
//
// BEWUSTE VERRUIMING op het letterlijke 23.14-schema: naast accepted → expired
// mag ELKE open status (draft, submitted, under_review) naar expired. 23.8 zegt
// dat de claimtermijn loopt VANAF REGISTRATIE, dus ook een claim die nooit
// beoordeeld werd verloopt. Zonder deze overgangen zou de systeemsweep
// (reseller-deals.expireDeals) de machine moeten omzeilen met een blinde patch;
// de machine blijft zo de enige plek die ongeldige overgangen laat gooien.
// De verruiming is eenrichtingsverkeer naar een terminale status: er ontstaat
// geen nieuw pad om beoordeling of vier-ogen te omzeilen.
const deal = createMachine("deal", "DEAL", {
  draft: ["submitted", "expired"],
  submitted: ["under_review", "expired"],
  under_review: ["accepted", "rejected", "expired"],
  accepted: ["converted", "expired"],
  rejected: [],
  converted: [],
  expired: [],
});

// Tenantaanvraag (23.9/23.14) · klantbevestiging is een verplichte stap.
const tenantRequest = createMachine("tenantRequest", "TENANT_REQUEST", {
  draft: ["submitted"],
  submitted: ["customer_confirmation"],
  customer_confirmation: ["review"],
  review: ["provisioning"],
  provisioning: ["active", "rejected", "canceled"],
  active: [],
  rejected: [],
  canceled: [],
});

// Licentiebestelling (23.10/23.14).
const licenseRequest = createMachine("licenseRequest", "LICENSE_REQUEST", {
  draft: ["submitted"],
  submitted: ["approved"],
  approved: ["scheduled"],
  scheduled: ["applied"],
  applied: ["failed", "canceled"],
  failed: [],
  canceled: [],
});

// Gedelegeerde toegang (23.12/23.14) · eigen record met scope, reden,
// startdatum, einddatum en intrekbaarheid; de tenant admin keurt goed.
const delegatedAccess = createMachine("delegatedAccess", "DELEGATED_ACCESS", {
  requested: ["tenant_approved"],
  tenant_approved: ["active"],
  active: ["expired", "revoked"],
  expired: [],
  revoked: [],
});

// Commissiestaat (23.11/23.14) · reproduceerbaar uit immutable events.
const commissionStatement = createMachine("commissionStatement", "COMMISSION_STATEMENT", {
  draft: ["review"],
  review: ["approved"],
  approved: ["invoiced"],
  invoiced: ["paid", "disputed"],
  paid: ["closed"],
  disputed: ["closed"],
  closed: [],
});

// Periodieke partnerreview (23.14).
const partnerReview = createMachine("partnerReview", "PARTNER_REVIEW", {
  scheduled: ["in_review"],
  in_review: ["action_required"],
  action_required: ["approved", "suspended"],
  approved: [],
  suspended: [],
});

// Offboarding (23.14) · toegang eerst intrekken, financien als laatste sluiten;
// historische financiele data blijft behouden (DoD-10).
const offboarding = createMachine("offboarding", "OFFBOARDING", {
  initiated: ["access_revoked"],
  access_revoked: ["tenants_transferred"],
  tenants_transferred: ["finance_closed"],
  finance_closed: ["completed"],
  completed: [],
});

// Commission agreement (23.11) · versies zijn immutable: een wijziging is een
// NIEUWE versie, nooit een aanpassing van een goedgekeurde.
const commissionAgreement = createMachine("commissionAgreement", "AGREEMENT", {
  draft: ["approved"],
  approved: ["active"],
  active: ["expired"],
  expired: [],
});

// Commission event-lifecycle (23.11) · een adjusted event wordt niet
// overschreven maar via tegenboeking gecompenseerd (zie commission-ledger.js).
const commissionEvent = createMachine("commissionEvent", "COMMISSION_EVENT", {
  generated: ["excluded", "adjusted"],
  excluded: [],
  adjusted: [],
});

// Dispuut (23.11).
const dispute = createMachine("dispute", "DISPUTE", {
  open: ["investigating"],
  investigating: ["accepted", "rejected"],
  accepted: ["closed"],
  rejected: ["closed"],
  closed: [],
});

// commission_status-veldenum (23.2) · elke status kan naar disputed.
const commissionStatus = createMachine("commissionStatus", "COMMISSION_STATUS", {
  pending: ["approved", "disputed"],
  approved: ["paid", "disputed"],
  paid: ["disputed"],
  disputed: [],
});

// onboarding_status-veldenum (23.2).
const onboardingStatus = createMachine("onboardingStatus", "ONBOARDING_STATUS", {
  applied: ["screening"],
  screening: ["contracting"],
  contracting: ["training"],
  training: ["active"],
  active: [],
});

const STATE_MACHINES = Object.freeze({
  resellerOrganization, deal, tenantRequest, licenseRequest, delegatedAccess,
  commissionStatement, partnerReview, offboarding,
  commissionAgreement, commissionEvent, dispute, commissionStatus, onboardingStatus,
});

/**
 * Suspensieregel (23.4/23.14): alleen een actieve organisatie mag nieuwe
 * deals, tenantaanvragen en beheeracties starten. Historische rapportering
 * blijft toegankelijk · dat beslist de leeslaag, niet deze guard.
 */
function assertOrganizationActive(org) {
  if (!org) throw err(404, "RESELLER_NOT_FOUND", "resellerorganisatie niet gevonden");
  if (org.status !== "active") {
    throw err(403, "RESELLER_NOT_ACTIVE", `resellerorganisatie is ${org.status || "onbekend"} · actie niet toegestaan`);
  }
  return org;
}

// ── 23.2 + 23.7 · Veldmodel resellerorganisatie ──────────────────────────────
// status: "systeem" (platform zet en bevriest), "verplicht" (altijd),
// "verplicht_actief" (verplicht zodra status active), "conditioneel"
// (verplicht onder de genoemde voorwaarde), "optioneel".
// toegang: wie het veld mag zien en/of wijzigen (spec-kolom letterlijk).
function field(status, type, classificatie, toegang, gebruik) {
  return Object.freeze({ status, type, classificatie, toegang, gebruik });
}

const RESELLER_FIELDS = Object.freeze({
  reseller_id: field("systeem", "uuid", "Internal", "platform", "Immutable uniek ID."),
  partner_name: field("verplicht", "text", "Internal/Public", "partner admin", "Officiele naam (legal_name) en weergave."),
  display_name: field("verplicht", "text", "Public/Internal", "reseller admin", "Naam zichtbaar in portal en klantcommunicatie."),
  enterprise_number: field("conditioneel", "identifier", "Financial", "partner finance", "Ondernemingsnummer · validatie."),
  vat_number: field("conditioneel", "identifier", "Financial", "partner finance", "Btw-nummer · validatie."),
  legal_form: field("conditioneel", "enum", "Legal", "reseller legal/finance", "BV, NV, eenmanszaak, enz."),
  registered_address: field("verplicht", "address", "Legal", "reseller admin", "Straat, nummer, postcode, gemeente, land."),
  invoice_address: field("conditioneel", "address", "Financial", "reseller finance", "Afwijkend facturatieadres."),
  billing_email: field("verplicht_actief", "email", "Financial", "reseller finance", "Gevalideerd e-mailadres voor staten en facturen."),
  phone: field("optioneel", "phone", "Public/Internal", "reseller admin", "Contactinformatie."),
  website: field("optioneel", "url", "Public/Internal", "reseller admin", "Profielinformatie."),
  preferred_language: field("verplicht", "enum", "Internal", "reseller admin", "NL, FR of EN."),
  timezone: field("verplicht", "structured", "Internal", "platform/reseller admin", "Voor data en rapportering."),
  locale: field("verplicht", "structured", "Internal", "platform/reseller admin", "Voor data en bedragen."),
  currency: field("verplicht", "structured", "Internal", "platform/reseller admin", "Voor bedragen en rapportering."),
  partner_type: field("verplicht", "enum", "Internal", "platform partner admin", "referral, reseller, implementation, technology."),
  partner_tier: field("conditioneel", "enum", "Confidential", "platform partner admin", "registered, silver, gold of custom."),
  status: field("verplicht", "enum", "Internal", "partner admin", "23.14-statusmodel resellerorganisatie."),
  onboarding_status: field("verplicht", "enum", "Internal", "partner admin", "applied, screening, contracting, training, active."),
  primary_contact: field("verplicht", "contact_reference", "Personal", "partner admin", "Operationeel aanspreekpunt."),
  sales_contact: field("verplicht_actief", "contact_reference", "Personal", "rolgebonden zichtbaarheid", "Commercieel aanspreekpunt."),
  support_contact: field("verplicht_actief", "contact_reference", "Personal", "rolgebonden zichtbaarheid", "Supportaanspreekpunt."),
  finance_contact: field("verplicht_actief", "contact_reference", "Personal", "rolgebonden zichtbaarheid", "Financieel aanspreekpunt."),
  contract_id: field("conditioneel", "reference", "Legal", "partner/legal", "Verwijzing naar de huidige overeenkomst."),
  agreement_version: field("verplicht_actief", "version", "Legal", "legal/partner admin", "Exacte contractversie."),
  accepted_at: field("verplicht_actief", "datetime", "Legal", "legal/partner admin", "Moment van contractacceptatie."),
  dpa_accepted_at: field("conditioneel", "datetime", "Legal", "legal/partner admin", "Verplicht indien verwerking van klantdata mogelijk is."),
  nda_accepted_at: field("conditioneel", "datetime", "Legal", "legal/partner admin", "Verplicht voor toegang tot vertrouwelijke informatie."),
  account_manager_id: field("verplicht_actief", "user_reference", "Confidential", "Monargo partner management", "Interne eigenaar van de relatie."),
  territory_segment: field("optioneel", "structured", "Confidential", "partner management", "Territorium- en segmentregels."),
  accreditations: field("optioneel", "repeating_structured", "Confidential", "partner admin", "Certificaten en vervaldatums."),
  service_scope: field("conditioneel", "multi_select", "Internal", "partner management", "sales, onboarding, implementation, support."),
  risk_status: field("conditioneel", "enum_score", "Security/Legal", "restricted", "Supplier/channel due diligence."),
  delegated_support_allowed: field("verplicht", "boolean", "Security", "platform partner admin", "Standaard false."),
  delegated_tenant_admin_allowed: field("verplicht", "boolean", "Security", "platform partner admin", "Standaard false · per tenant extra toestemming vereist."),
  max_managed_tenants: field("optioneel", "integer", "Commercial", "partner management", "Contractueel of operationeel plafond."),
  commission_model: field("conditioneel", "structured", "Financial", "partner finance restricted", "percentage, fixed of recurring."),
  payout_currency: field("conditioneel", "structured", "Financial", "partner finance restricted", "Uitbetalingsvaluta."),
  payout_account: field("conditioneel", "iban", "Financial", "finance restricted", "Valt onder fraudecontroles · vier-ogen bij wijziging."),
  commission_status: field("conditioneel", "enum", "Financial", "partner finance", "pending, approved, paid, disputed."),
  deal_registration: field("optioneel", "structured", "Confidential", "partner/sales", "Customer, value, dates, proof."),
  tenant_id: field("conditioneel", "reference", "Confidential", "partner admin", "Provisioned tenant · nooit een vervanging van de tenantgrens."),
  suspension_reason: field("conditioneel", "text", "Confidential", "partner management/legal", "Verplicht bij suspensie."),
  suspension_date: field("conditioneel", "date", "Confidential", "partner management/legal", "Verplicht bij suspensie."),
  termination_date: field("conditioneel", "date", "Legal", "partner management/legal", "Offboarding · behoud historische data."),
  exit_status: field("conditioneel", "enum", "Legal", "partner management/legal", "Offboarding-afhandeling."),
  support_level: field("conditioneel", "enum", "Internal", "partner operations", "Operationeel supportniveau."),
  capacity: field("conditioneel", "structured", "Internal", "partner operations", "Operationele capaciteit."),
});

// 23.7 · veldgroepen met classificatie en toegang.
const FIELD_GROUPS = Object.freeze({
  identiteit: Object.freeze({
    velden: Object.freeze(["partner_name", "display_name", "enterprise_number", "vat_number", "legal_form"]),
    status: "verplicht/conditioneel", toegang: "Legal/Financial · reseller admin en Monargo partner admin",
  }),
  adres: Object.freeze({
    velden: Object.freeze(["registered_address", "invoice_address", "country", "region"]),
    status: "verplicht", toegang: "Legal · finance waar nodig",
  }),
  contact: Object.freeze({
    velden: Object.freeze(["primary_contact", "sales_contact", "support_contact", "finance_contact"]),
    status: "verplicht_actief", toegang: "Personal · rolgebonden zichtbaarheid",
  }),
  programma: Object.freeze({
    velden: Object.freeze(["partner_type", "partner_tier", "territory_segment", "segments", "industries", "languages"]),
    status: "verplicht_actief", toegang: "Commercial confidential",
  }),
  contract: Object.freeze({
    velden: Object.freeze(["agreement_id", "version", "start_date", "end_date", "renewal", "notice_period"]),
    status: "verplicht_actief", toegang: "Legal restricted",
  }),
  security_privacy: Object.freeze({
    velden: Object.freeze(["nda_accepted_at", "dpa_accepted_at", "security_review", "subprocessors", "risk_status"]),
    status: "conditioneel", toegang: "Security/privacy restricted",
  }),
  operationeel: Object.freeze({
    velden: Object.freeze(["service_scope", "support_level", "onboarding_status", "capacity"]),
    status: "conditioneel", toegang: "partner operations",
  }),
  financieel: Object.freeze({
    velden: Object.freeze(["commission_model", "payout_currency", "billing_email", "vat_treatment"]),
    status: "conditioneel", toegang: "partner finance restricted",
  }),
  beheer: Object.freeze({
    velden: Object.freeze(["status", "suspension_reason", "owner", "review_date", "offboarding_status"]),
    status: "systeem/verplicht", toegang: "Monargo partner management",
  }),
});

// ── Validatiehulpen ──────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;

function validAddress(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  return ADDRESS_KEYS.every(k => !isBlank(a[k]));
}
function missingAddressKeys(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return [...ADDRESS_KEYS];
  return ADDRESS_KEYS.filter(k => isBlank(a[k]));
}

/**
 * Valideer een resellerorganisatie tegen het 23.2/23.7-veldmodel.
 * Retourneert { veldnaam: reden } · een leeg object betekent geldig.
 * "verplicht_actief"-velden worden pas afgedwongen zodra status active is.
 */
function validateResellerOrganization(org) {
  const o = org && typeof org === "object" ? org : {};
  const errors = {};
  const need = (f, reden) => { if (isBlank(o[f])) errors[f] = reden; };

  // Altijd verplicht (23.2).
  if (isBlank(o.partner_name) && isBlank(o.legal_name)) {
    errors.partner_name = "partner_name/legal_name is verplicht";
  }
  need("display_name", "display_name is verplicht");
  need("primary_contact", "primary_contact is verplicht");
  need("timezone", "timezone is verplicht");
  need("locale", "locale is verplicht");
  need("currency", "currency is verplicht");

  if (isBlank(o.partner_type)) errors.partner_type = "partner_type is verplicht";
  else if (!PARTNER_TYPES.includes(o.partner_type)) {
    errors.partner_type = `partner_type moet een van ${PARTNER_TYPES.join(", ")} zijn`;
  }

  if (isBlank(o.status)) errors.status = "status is verplicht";
  else if (!resellerOrganization.STATES.includes(o.status)) {
    errors.status = `status moet een van ${resellerOrganization.STATES.join(", ")} zijn`;
  }

  if (isBlank(o.onboarding_status)) errors.onboarding_status = "onboarding_status is verplicht";
  else if (!ONBOARDING_STATUSES.includes(o.onboarding_status)) {
    errors.onboarding_status = `onboarding_status moet een van ${ONBOARDING_STATUSES.join(", ")} zijn`;
  }

  if (isBlank(o.preferred_language)) errors.preferred_language = "preferred_language is verplicht";
  else if (!LANGUAGES.includes(String(o.preferred_language).toUpperCase())) {
    errors.preferred_language = "preferred_language moet NL, FR of EN zijn";
  }

  if (!validAddress(o.registered_address)) {
    errors.registered_address = `registered_address is verplicht met: ${missingAddressKeys(o.registered_address).join(", ")}`;
  }

  // Veiligheidsvelden: expliciet boolean · standaard false (23.2).
  for (const k of Object.keys(SECURITY_DEFAULTS)) {
    if (typeof o[k] !== "boolean") errors[k] = `${k} moet expliciet true of false zijn (standaard false)`;
  }

  // Verplicht zodra de partner actief is (23.2 "verplicht actief" + 23.7).
  if (o.status === "active") {
    need("billing_email", "billing_email is verplicht voor een actieve partner");
    need("account_manager_id", "account_manager_id is verplicht voor een actieve partner");
    need("agreement_version", "agreement_version is verplicht voor een actieve partner");
    need("accepted_at", "accepted_at is verplicht voor een actieve partner");
    need("sales_contact", "sales_contact is verplicht voor een actieve partner");
    need("support_contact", "support_contact is verplicht voor een actieve partner");
    need("finance_contact", "finance_contact is verplicht voor een actieve partner");
  }

  // Conditionele triggers (23.2).
  if (o.status === "suspended") {
    need("suspension_reason", "suspension_reason is verplicht bij suspensie");
    need("suspension_date", "suspension_date is verplicht bij suspensie");
  }
  if (o.status === "terminated") {
    need("termination_date", "termination_date is verplicht bij beeindiging");
  }

  // Vormchecks op aanwezige velden.
  if (!isBlank(o.billing_email) && !EMAIL_RE.test(clean(o.billing_email))) {
    errors.billing_email = "billing_email is geen geldig e-mailadres";
  }
  if (o.invoice_address != null && !validAddress(o.invoice_address)) {
    errors.invoice_address = `invoice_address mist: ${missingAddressKeys(o.invoice_address).join(", ")}`;
  }
  if (!isBlank(o.partner_tier) && !PARTNER_TIERS.includes(clean(o.partner_tier).toLowerCase())) {
    errors.partner_tier = `partner_tier moet een van ${PARTNER_TIERS.join(", ")} zijn`;
  }
  if (o.service_scope != null) {
    const scopes = Array.isArray(o.service_scope) ? o.service_scope : [o.service_scope];
    const bad = scopes.filter(s => !SERVICE_SCOPES.includes(s));
    if (bad.length) errors.service_scope = `ongeldige service_scope: ${bad.join(", ")}`;
  }
  if (!isBlank(o.commission_status) && !COMMISSION_STATUSES.includes(o.commission_status)) {
    errors.commission_status = `commission_status moet een van ${COMMISSION_STATUSES.join(", ")} zijn`;
  }
  if (o.commission_model != null) {
    const m = o.commission_model;
    if (typeof m !== "object" || Array.isArray(m) || !COMMISSION_MODELS.includes(m.type)) {
      errors.commission_model = `commission_model.type moet een van ${COMMISSION_MODELS.join(", ")} zijn`;
    }
  }
  if (!isBlank(o.payout_account) && !IBAN_RE.test(clean(o.payout_account).replace(/\s+/g, "").toUpperCase())) {
    errors.payout_account = "payout_account is geen geldige IBAN";
  }
  if (o.max_managed_tenants != null) {
    const n = o.max_managed_tenants;
    if (!Number.isInteger(n) || n < 0) errors.max_managed_tenants = "max_managed_tenants moet een geheel getal >= 0 zijn";
  }
  if (!isBlank(o.website) && !/^https?:\/\/\S+$/.test(clean(o.website))) {
    errors.website = "website moet een geldige http(s)-URL zijn";
  }

  return errors;
}

/** Gooit 400 met .fieldErrors wanneer de organisatie ongeldig is. */
function assertValidResellerOrganization(org) {
  const errors = validateResellerOrganization(org);
  if (Object.keys(errors).length > 0) {
    const e = err(400, "RESELLER_ORGANIZATION_INVALID", "resellerorganisatie is ongeldig");
    e.fieldErrors = errors;
    throw e;
  }
  return org;
}

// ── 23.7/23.11 · Contract/agreement-model ────────────────────────────────────
// Veldgroep Contract: agreement_id, version, start/end, renewal, notice_period.
// Versies zijn immutable: een wijziging is een nieuwe versie met eigen record.
const AGREEMENT_FIELDS = Object.freeze({
  agreement_id: field("verplicht", "identifier", "Legal", "legal restricted", "Uniek contract-ID."),
  version: field("verplicht", "integer", "Legal", "legal restricted", "Immutable versienummer · wijziging = nieuwe versie."),
  status: field("verplicht", "enum", "Legal", "legal restricted", "draft, approved, active, expired."),
  start_date: field("verplicht", "date", "Legal", "legal restricted", "Ingangsdatum."),
  end_date: field("conditioneel", "date", "Legal", "legal restricted", "Einddatum · leeg = onbepaalde duur."),
  renewal: field("conditioneel", "structured", "Legal", "legal restricted", "Verlengingsregeling."),
  notice_period: field("conditioneel", "structured", "Legal", "legal restricted", "Opzegtermijn."),
});

function isoOf(at) {
  if (at == null) return new Date(0).toISOString();
  if (at instanceof Date) return at.toISOString();
  return String(at);
}

/** Valideer een agreement-record · { veldnaam: reden }, leeg = geldig. */
function validateAgreement(a) {
  const o = a && typeof a === "object" ? a : {};
  const errors = {};
  if (isBlank(o.agreement_id)) errors.agreement_id = "agreement_id is verplicht";
  if (!Number.isInteger(o.version) || o.version < 1) errors.version = "version moet een geheel getal >= 1 zijn";
  if (isBlank(o.status)) errors.status = "status is verplicht";
  else if (!commissionAgreement.STATES.includes(o.status)) {
    errors.status = `status moet een van ${commissionAgreement.STATES.join(", ")} zijn`;
  }
  if (isBlank(o.start_date)) errors.start_date = "start_date is verplicht";
  if (!isBlank(o.start_date) && !isBlank(o.end_date) && isoOf(o.end_date) < isoOf(o.start_date)) {
    errors.end_date = "end_date ligt voor start_date";
  }
  return errors;
}

/**
 * Het actieve contract op moment `at` (ISO-string of Date, default nu):
 * status active, start_date <= at en (geen end_date of at <= end_date).
 * Bij meerdere kandidaten wint de hoogste versie (immutable versiereeks).
 */
function activeAgreement(list, at = new Date()) {
  const t = isoOf(at);
  const hits = (Array.isArray(list) ? list : []).filter(a =>
    a && a.status === "active" &&
    !isBlank(a.start_date) && isoOf(a.start_date) <= t &&
    (isBlank(a.end_date) || t <= isoOf(a.end_date))
  );
  hits.sort((x, y) => (Number(y.version) || 0) - (Number(x.version) || 0));
  return hits[0] || null;
}

/** Gooit 409 wanneer er geen actief contract is · commissie vereist er een (23.4). */
function assertAgreementActive(list, at = new Date()) {
  const a = activeAgreement(list, at);
  if (!a) throw err(409, "AGREEMENT_NOT_ACTIVE", "geen actief partnercontract voor deze periode");
  return a;
}

module.exports = {
  // kanaaltypen en enums
  CHANNEL_TYPES, PARTNER_TYPES, PARTNER_TIERS, LANGUAGES, SERVICE_SCOPES,
  COMMISSION_MODELS, COMMISSION_STATUSES, ONBOARDING_STATUSES, ADDRESS_KEYS,
  SECURITY_DEFAULTS, withSecurityDefaults,
  // statusmachines (23.14 + 23.11/23.2-aanvullingen)
  STATE_MACHINES,
  resellerOrganization, deal, tenantRequest, licenseRequest, delegatedAccess,
  commissionStatement, partnerReview, offboarding,
  commissionAgreement, commissionEvent, dispute, commissionStatus, onboardingStatus,
  assertOrganizationActive,
  // veldmodel + validatie
  RESELLER_FIELDS, FIELD_GROUPS,
  validateResellerOrganization, assertValidResellerOrganization,
  // contract/agreement
  AGREEMENT_FIELDS, validateAgreement, activeAgreement, assertAgreementActive,
};
