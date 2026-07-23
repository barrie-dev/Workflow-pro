"use strict";

// ── Payroll Exchange Engine · canoniek loonoverdrachtsmodel (INT-10) ─────────
// Sectie 10 + 11 van de handover "Integraties, Usage & Billing". Eén canonieke
// engine boven het gedeelde connectorframework (src/platform/connector-framework.js).
// SD Worx, Acerta, Liantis en Securex zijn bij livegang de ondersteunde
// providers via VIER providerprofielen op DEZELFDE engine; de concrete adapters
// (INT-11..14) zijn P1 en implementeren het adaptercontract dat hier gedefinieerd
// is. Monargo bereidt prestaties en mutaties voor; het sociaal secretariaat doet
// de loonberekening en de wettelijke verwerking (source of truth · sectie 5).
//
// De engine levert:
//  - canonieke entiteiten (10.1) als gevalideerde records (Employer, Employee,
//    Performance, Absence, Variable, Mutation, Period);
//  - de periode-statemachine (11) met assertTransition;
//  - segregation of duties (vier-ogencontrole): de indiener van de finale
//    aanlevering keurt NOOIT zelf goed (hergebruik assertNotSelfApproval);
//  - employee- en codemapping via het connectorframework-mappingmodel;
//  - het exportcontract (payroll_exports: versie, payload/bestand, checksum,
//    providerreferentie), import-resultaten en correcties die naar de vorige
//    versie verwijzen en audit bewaren;
//  - Connected vs Assisted als EXPLICIETE, ondersteunde modus per capability
//    (10.3) · assisted is nooit een verborgen fallback;
//  - het provideronafhankelijke adaptercontract dat de vier providers invullen.
//
// Assisted-modus (gecontroleerde export/CSV) hergebruikt de bestaande
// prestatie-aggregatie in src/platform/social-secretariat.js · geen duplicaat.

const crypto = require("crypto");
const CF = require("../platform/connector-framework");            // canoniek framework + mapping
const A = require("../platform/reseller-authz");                  // assertNotSelfApproval (vier-ogen)
const SS = require("../platform/social-secretariat");             // assisted export + codebasis

// ── Foutpatroon + kleine helpers (repo-conventie) ────────────────────────────
function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
function clean(v) { return String(v == null ? "" : v).trim(); }
function id(prefix) { return `${prefix}_${crypto.randomBytes(9).toString("hex")}`; }
function nowIso() { return new Date().toISOString(); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function isPeriod(p) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p || "")); }
function isDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(clean(v)); }
function isNum(v) { return typeof v === "number" && Number.isFinite(v); }

// ── Canoniek model · enums en labels ─────────────────────────────────────────

// De vier go-live-providers (10.2). De generieke/assisted basis (extra
// secretariaten) leeft in social-secretariat.js; de engine kent hier de vier
// die bij livegang een providerprofiel + (later) een adapter krijgen.
const GO_LIVE_PROVIDERS = ["sdworx", "acerta", "liantis", "securex"];

// Overdrachtsmodus per capability (10.3). Assisted is een ondersteunde
// productmodus, GEEN verborgen fallback.
const PAYROLL_MODES = ["connected", "assisted"];

// Loonfrequenties (Employer · 10.1).
const PAYROLL_FREQUENCIES = ["monthly", "four_weekly", "bi_weekly", "weekly"];

// Canonieke aanleverregels (payroll_entries · 17.3).
const ENTRY_TYPES = ["performance", "absence", "variable", "mutation"];

// Prestatiesoorten (Performance · 10.1): normale uren, overuren, nacht/weekend,
// wachtdienst, verplaatsing.
const PERFORMANCE_KINDS = ["normal", "overtime", "night", "weekend", "standby", "travel"];

// Afwezigheidstypes (Absence · 10.1).
const ABSENCE_TYPES = ["verlof", "ziekte", "klein_verlet", "inhaalrust", "tijdelijke_werkloosheid"];

// Variabele types (Variable · 10.1).
const VARIABLE_TYPES = ["premie", "bonus", "kilometer", "fiets", "maaltijd", "werfvergoeding", "inhouding", "onkost"];

// Mutatietypes (Mutation · 10.1).
const MUTATION_TYPES = ["in_dienst", "uit_dienst", "contract", "functie", "rooster", "adres", "bank"];

// Codemapping-soorten (payroll_code_mappings · 17.3).
const CODE_MAPPING_KINDS = ["performance", "absence", "variable"];

// ── Periode-statemachine (11) ────────────────────────────────────────────────
// Canonieke statuscodes (10.1) met de Nederlandse UI-labels (11). De keten is
// voorwaarts; enkele terugkeerpaden dekken herwerk en heropening (payroll.reopen).
// "closed" is de afsluitstatus en immutable, behalve een expliciete heropening
// naar een correctietraject.
const PERIOD_STATES = ["open", "voorbereiding", "review", "approved", "ready", "delivered", "processed", "correction", "closed"];
const PERIOD_LABELS = {
  open: "Open",
  voorbereiding: "In voorbereiding",
  review: "Te controleren",
  approved: "Goedgekeurd",
  ready: "Klaar voor verzending",
  delivered: "Aangeleverd",
  processed: "Verwerkt",
  correction: "Correctie vereist",
  closed: "Afgesloten",
};
const PERIOD_TRANSITIONS = {
  open: ["voorbereiding"],
  voorbereiding: ["review", "open"],            // aanbieden voor controle of terug naar open
  review: ["approved", "voorbereiding"],        // goedkeuren (vier-ogen) of terug voor herwerk
  approved: ["ready", "voorbereiding"],         // vrijgeven voor verzending of heropenen (reopen)
  ready: ["delivered", "approved"],             // aanleveren of terug
  delivered: ["processed", "correction"],       // provider verwerkt of correctie nodig
  processed: ["closed", "correction"],          // afsluiten of correctie nodig
  correction: ["voorbereiding"],                // correctie start een nieuwe versie via herwerk
  closed: ["correction"],                       // heropenen (payroll.reopen) → correctietraject
};

// Statussen waarin de aanleverregels nog gewijzigd mogen worden.
const ENTRY_MUTABLE_STATES = ["open", "voorbereiding", "correction"];
// Statussen waarin een (her)export gebouwd mag worden.
const EXPORT_BUILDABLE_STATES = ["approved", "ready", "correction"];

// ── Providerprofielen + capabilities (10.2 / 10.3) ───────────────────────────
// Canonieke payroll-capabilities. De providerkaart toont per capability of ze
// Connected (automatische transfer) of Assisted (gecontroleerd pakket) verloopt.
const PAYROLL_CAPABILITIES = [
  "employee_mapping", "performance", "absence", "variable",
  "correction", "transfer_status", "cost_center", "loon_codes", "monthly_delivery",
];

// Minimale providerpariteit bij livegang (10.2). Bij P0 is er nog GEEN
// connected adapter (INT-11..14 zijn P1), dus elke capability staat eerlijk op
// "assisted": Monargo genereert een providerconform pakket en registreert de
// bevestiging. Een P1-adapter zet specifieke capabilities op "connected" zodra
// de automatische transfer bestaat. De capability ontbreken = niet ondersteund
// (geen verborgen fallback).
const PROVIDER_PROFILES = {
  sdworx: {
    label: "SD Worx",
    capabilities: { employee_mapping: "assisted", performance: "assisted", absence: "assisted", variable: "assisted", correction: "assisted", transfer_status: "assisted" },
  },
  acerta: {
    label: "Acerta",
    capabilities: { employee_mapping: "assisted", performance: "assisted", absence: "assisted", variable: "assisted", cost_center: "assisted", transfer_status: "assisted" },
  },
  liantis: {
    label: "Liantis",
    capabilities: { employee_mapping: "assisted", performance: "assisted", absence: "assisted", variable: "assisted", monthly_delivery: "assisted", correction: "assisted" },
  },
  securex: {
    label: "Securex",
    capabilities: { employee_mapping: "assisted", performance: "assisted", absence: "assisted", loon_codes: "assisted", cost_center: "assisted", transfer_status: "assisted", correction: "assisted" },
  },
};

function isGoLiveProvider(p) { return GO_LIVE_PROVIDERS.includes(clean(p).toLowerCase()); }

// ── Entiteitvalidatoren (10.1) · geven een lijst veldfouten terug ────────────
// Elke fout is { field, code, message }. De assert-varianten gooien de eerste
// fout als Error met .status/.code (zoals connector-framework.js).

/** Employer (10.1): ondernemingsnummer verplicht; frequentie/kostenplaatsen getypeerd. */
function validateEmployer(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return [{ field: "employer", code: "EMPLOYER_INVALID", message: "employer ontbreekt" }];
  if (!clean(obj.companyNumber)) errors.push({ field: "companyNumber", code: "COMPANY_NUMBER_REQUIRED", message: "ondernemingsnummer is verplicht" });
  if (obj.payrollFrequency != null && !PAYROLL_FREQUENCIES.includes(obj.payrollFrequency)) {
    errors.push({ field: "payrollFrequency", code: "FREQUENCY_INVALID", message: `loonfrequentie moet een van ${PAYROLL_FREQUENCIES.join(", ")} zijn` });
  }
  if (obj.costCenters != null && !Array.isArray(obj.costCenters)) {
    errors.push({ field: "costCenters", code: "COST_CENTERS_INVALID", message: "kostenplaatsen moet een lijst zijn" });
  }
  return errors;
}

/** Employee (10.1): personeelsnummer + Monargo-medewerker verplicht. */
function validateEmployee(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return [{ field: "employee", code: "EMPLOYEE_INVALID", message: "employee ontbreekt" }];
  if (!clean(obj.employeeId)) errors.push({ field: "employeeId", code: "EMPLOYEE_ID_REQUIRED", message: "Monargo-medewerker (employeeId) is verplicht" });
  if (!clean(obj.personnelNumber)) errors.push({ field: "personnelNumber", code: "PERSONNEL_NUMBER_REQUIRED", message: "personeelsnummer is verplicht" });
  if (obj.startDate != null && !isDate(obj.startDate)) errors.push({ field: "startDate", code: "START_DATE_INVALID", message: "startdatum moet YYYY-MM-DD zijn" });
  if (obj.endDate != null && !isDate(obj.endDate)) errors.push({ field: "endDate", code: "END_DATE_INVALID", message: "einddatum moet YYYY-MM-DD zijn" });
  return errors;
}

/** Performance (10.1): employee + code + soort + uren. */
function validatePerformance(obj) {
  const errors = [];
  if (!clean(obj.employeeId)) errors.push({ field: "employeeId", code: "EMPLOYEE_ID_REQUIRED", message: "employeeId is verplicht" });
  if (!clean(obj.code)) errors.push({ field: "code", code: "CODE_REQUIRED", message: "een prestatiecode is verplicht" });
  if (obj.kind != null && !PERFORMANCE_KINDS.includes(obj.kind)) {
    errors.push({ field: "kind", code: "PERFORMANCE_KIND_INVALID", message: `prestatiesoort moet een van ${PERFORMANCE_KINDS.join(", ")} zijn` });
  }
  if (!isNum(obj.value) || obj.value <= 0) errors.push({ field: "value", code: "VALUE_INVALID", message: "aantal uren (value) moet een getal groter dan 0 zijn" });
  return errors;
}

/** Absence (10.1): employee + afwezigheidstype + dagen. */
function validateAbsence(obj) {
  const errors = [];
  if (!clean(obj.employeeId)) errors.push({ field: "employeeId", code: "EMPLOYEE_ID_REQUIRED", message: "employeeId is verplicht" });
  if (!ABSENCE_TYPES.includes(obj.absenceType)) {
    errors.push({ field: "absenceType", code: "ABSENCE_TYPE_INVALID", message: `afwezigheidstype moet een van ${ABSENCE_TYPES.join(", ")} zijn` });
  }
  if (!isNum(obj.value) || obj.value <= 0) errors.push({ field: "value", code: "VALUE_INVALID", message: "aantal (value) moet een getal groter dan 0 zijn" });
  return errors;
}

/** Variable (10.1): employee + variabel type + bedrag. */
function validateVariable(obj) {
  const errors = [];
  if (!clean(obj.employeeId)) errors.push({ field: "employeeId", code: "EMPLOYEE_ID_REQUIRED", message: "employeeId is verplicht" });
  if (!VARIABLE_TYPES.includes(obj.variableType)) {
    errors.push({ field: "variableType", code: "VARIABLE_TYPE_INVALID", message: `variabel type moet een van ${VARIABLE_TYPES.join(", ")} zijn` });
  }
  if (!isNum(obj.value) || obj.value === 0) errors.push({ field: "value", code: "VALUE_INVALID", message: "bedrag (value) moet een getal ongelijk aan 0 zijn" });
  return errors;
}

/** Mutation (10.1): employee + mutatietype + ingangsdatum. */
function validateMutation(obj) {
  const errors = [];
  if (!clean(obj.employeeId)) errors.push({ field: "employeeId", code: "EMPLOYEE_ID_REQUIRED", message: "employeeId is verplicht" });
  if (!MUTATION_TYPES.includes(obj.mutationType)) {
    errors.push({ field: "mutationType", code: "MUTATION_TYPE_INVALID", message: `mutatietype moet een van ${MUTATION_TYPES.join(", ")} zijn` });
  }
  if (!isDate(obj.effectiveDate)) errors.push({ field: "effectiveDate", code: "EFFECTIVE_DATE_INVALID", message: "ingangsdatum (effectiveDate) moet YYYY-MM-DD zijn" });
  return errors;
}

/** Aanleverregel (payroll_entries): dispatcht op type naar de juiste validator. */
function validateEntry(obj) {
  if (!obj || typeof obj !== "object") return [{ field: "entry", code: "ENTRY_INVALID", message: "aanleverregel ontbreekt" }];
  if (!ENTRY_TYPES.includes(obj.type)) {
    return [{ field: "type", code: "ENTRY_TYPE_INVALID", message: `type moet een van ${ENTRY_TYPES.join(", ")} zijn` }];
  }
  if (obj.type === "performance") return validatePerformance(obj);
  if (obj.type === "absence") return validateAbsence(obj);
  if (obj.type === "variable") return validateVariable(obj);
  return validateMutation(obj);
}

/** Period (payroll_periods): tenant/company + periode + provider + modus + status. */
function validatePeriod(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return [{ field: "period", code: "PERIOD_INVALID", message: "periode ontbreekt" }];
  if (!clean(obj.tenantId)) errors.push({ field: "tenantId", code: "TENANT_REQUIRED", message: "tenant_id is verplicht" });
  if (!clean(obj.companyId)) errors.push({ field: "companyId", code: "COMPANY_REQUIRED", message: "company_id (juridische onderneming) is verplicht" });
  if (!isPeriod(obj.period)) errors.push({ field: "period", code: "PERIOD_FORMAT_INVALID", message: "period moet YYYY-MM zijn" });
  if (!isGoLiveProvider(obj.provider)) errors.push({ field: "provider", code: "PROVIDER_INVALID", message: `provider moet een van ${GO_LIVE_PROVIDERS.join(", ")} zijn` });
  if (obj.mode != null && !PAYROLL_MODES.includes(obj.mode)) errors.push({ field: "mode", code: "MODE_INVALID", message: `modus moet een van ${PAYROLL_MODES.join(", ")} zijn` });
  if (obj.status != null && !PERIOD_STATES.includes(obj.status)) errors.push({ field: "status", code: "STATUS_INVALID", message: `status moet een van ${PERIOD_STATES.join(", ")} zijn` });
  return errors;
}

// Generieke assert-fabriek: gooit de eerste veldfout van een validator.
function assertValid(validator, obj) {
  const errors = validator(obj);
  if (errors.length) { const first = errors[0]; throw err(400, first.code, first.message); }
  return true;
}
function assertEmployer(o) { return assertValid(validateEmployer, o); }
function assertEmployee(o) { return assertValid(validateEmployee, o); }
function assertEntry(o) { return assertValid(validateEntry, o); }
function assertPeriod(o) { return assertValid(validatePeriod, o); }

// ── Periode-statemachine (11) ────────────────────────────────────────────────

/** Dwing een geldige periode-statusovergang af. */
function assertPeriodTransition(from, to) {
  if (!PERIOD_STATES.includes(from)) throw err(400, "PERIOD_STATE_INVALID", `onbekende bronstatus ${from}`);
  if (!PERIOD_STATES.includes(to)) throw err(400, "PERIOD_STATE_INVALID", `onbekende doelstatus ${to}`);
  if (from === to) return true;
  if (!(PERIOD_TRANSITIONS[from] || []).includes(to)) {
    throw err(409, "PERIOD_TRANSITION_INVALID", `overgang ${from} · ${to} niet toegestaan`);
  }
  return true;
}

/** Is dit een terminale periodestatus? (closed, behoudens expliciete heropening) */
function isPeriodTerminal(state) { return state === "closed"; }

/** Nederlandse UI-label voor een canonieke status. */
function periodLabel(state) { return PERIOD_LABELS[state] || state; }

// ── Segregation of duties · vier-ogencontrole (11) ───────────────────────────

/**
 * De indiener van de finale aanlevering mag zijn eigen periode niet goedkeuren
 * (23.9 · Payroll SoD). Hergebruikt assertNotSelfApproval (faalt dicht bij
 * ontbrekende identiteit). Vier-ogen kan per periode uitgezet worden
 * (fourEyes === false) · dan geldt de controle niet.
 */
function assertFourEyesApproval(approverId, submittedById, { fourEyes = true } = {}) {
  if (fourEyes === false) return true;
  return A.assertNotSelfApproval(approverId, submittedById);
}

// ── Employee- en codemapping via het connectorframework-mappingmodel ─────────
// Mappings zijn connector-framework-mappings (A04): localField/code naar
// providerValue, met versie en geldigheidsperiode. De engine bouwt en resolvet
// ze via CF.validateMapping / CF.resolveMapping · geen eigen mappingimplementatie.

/** Bouw een employee-mapping-record (Monargo-medewerker naar provider employee ID). */
function buildEmployeeMapping({ employeeId, providerEmployeeId, version = 1, validFrom = null, validTo = null } = {}) {
  const m = { localField: clean(employeeId), providerValue: clean(providerEmployeeId), version, validFrom, validTo };
  CF.assertMapping(m);
  return m;
}

/** Bouw een codemapping-record (prestatie/absence/variable-code naar providercode). */
function buildCodeMapping({ kind, localCode, providerCode, version = 1, validFrom = null, validTo = null } = {}) {
  if (!CODE_MAPPING_KINDS.includes(kind)) throw err(400, "CODE_MAPPING_KIND_INVALID", `kind moet een van ${CODE_MAPPING_KINDS.join(", ")} zijn`);
  const m = { kind, code: clean(localCode), localField: clean(localCode), providerValue: clean(providerCode), version, validFrom, validTo };
  CF.assertMapping(m);
  return m;
}

/** Resolveer het provider employee ID voor een medewerker op een moment. */
function resolveEmployeeMapping(mappings, employeeId, at = null) {
  return CF.resolveMapping(mappings || [], clean(employeeId), at);
}

/** Resolveer de providercode voor een lokale code binnen een soort (kind). */
function resolveCodeMapping(mappings, kind, localCode, at = null) {
  const scoped = (mappings || []).filter(m => m && m.kind === kind);
  return CF.resolveMapping(scoped, clean(localCode), at);
}

// ── Connected vs Assisted per capability (10.3) ──────────────────────────────

/**
 * De overdrachtsmodus voor een provider + capability. Een niet-ondersteunde
 * capability gooit CAPABILITY_NOT_SUPPORTED · nooit een stille (verborgen)
 * fallback naar assisted.
 */
function capabilityMode(provider, capability) {
  const profile = PROVIDER_PROFILES[clean(provider).toLowerCase()];
  if (!profile) throw err(404, "PROVIDER_NOT_FOUND", `onbekende payrollprovider ${provider}`);
  const mode = profile.capabilities[capability];
  if (!mode) throw err(422, "CAPABILITY_NOT_SUPPORTED", `capability ${capability} wordt niet ondersteund door ${provider} (assisted is geen verborgen fallback)`);
  return mode;
}

/** Wordt deze capability ondersteund (in gelijk welke modus)? */
function supportsCapability(provider, capability) {
  try { capabilityMode(provider, capability); return true; } catch (_) { return false; }
}

/**
 * Providerkaart voor de provideronafhankelijke cockpit: per capability de
 * eerlijke modus (Connected/Assisted). De cockpit toont processtatus boven
 * providerbranding (20.4).
 */
function providerCard(provider) {
  const key = clean(provider).toLowerCase();
  const profile = PROVIDER_PROFILES[key];
  if (!profile) throw err(404, "PROVIDER_NOT_FOUND", `onbekende payrollprovider ${provider}`);
  return {
    provider: key,
    label: profile.label,
    capabilities: Object.keys(profile.capabilities).map(cap => ({
      capability: cap,
      mode: profile.capabilities[cap],
      connected: profile.capabilities[cap] === "connected",
    })),
  };
}

// ── Provideronafhankelijk adaptercontract (INT-11..14 · P1) ──────────────────
// De engine kent enkel het canonieke model; een provideradapter vertaalt
// UITSLUITEND canoniek <-> providerformaat (A10) en introduceert GEEN eigen
// credentials/mapping/logging/retry (A09 · bewaakt met CF.assertAdapterBoundary).

/** Documentatie van de vorm die een payroll-provideradapter moet invullen. */
function describeAdapterContract() {
  return {
    provider: `een van ${GO_LIVE_PROVIDERS.join(", ")}`,
    capabilities: "object { capability: 'connected'|'assisted' } · per capability de ondersteunde modus",
    methods: {
      buildPayload: "(canonicalExport, mappingCtx) -> providerPayload · pure vertaling, beide modi",
      submit: "(providerPayload, connectionCtx) -> { providerReference, status } · alleen Connected",
      fetchStatus: "(providerReference, connectionCtx) -> importResult · alleen Connected",
      buildAssistedPackage: "(canonicalExport) -> { file, format, filename } · alleen Assisted",
    },
    forbidden: "geen pricing/billing/credits/usage/rechten/retry/secrets/logging (CF.FORBIDDEN_ADAPTER_CONCERNS)",
  };
}

/**
 * Valideer dat een provideradapter het contract invult. Bewaakt de
 * architectuurgrens (A09/A10) en dwingt af dat de per-capability aangekondigde
 * modus ook de bijhorende methode(n) heeft · geen half connected profiel zonder
 * transfer, geen assisted profiel zonder pakketgenerator.
 */
function assertAdapterContract(adapter) {
  if (!adapter || typeof adapter !== "object") throw err(400, "ADAPTER_INVALID", "adapter ontbreekt");
  if (!isGoLiveProvider(adapter.provider)) throw err(400, "ADAPTER_PROVIDER_INVALID", `provider moet een van ${GO_LIVE_PROVIDERS.join(", ")} zijn`);
  const caps = adapter.capabilities;
  if (!caps || typeof caps !== "object" || Object.keys(caps).length === 0) throw err(400, "ADAPTER_CAPABILITIES_REQUIRED", "een adapter declareert minstens een capability + modus");
  const modes = new Set();
  for (const [cap, mode] of Object.entries(caps)) {
    if (!PAYROLL_CAPABILITIES.includes(cap)) throw err(400, "ADAPTER_CAPABILITY_INVALID", `onbekende capability ${cap}`);
    if (!PAYROLL_MODES.includes(mode)) throw err(400, "ADAPTER_MODE_INVALID", `modus van ${cap} moet connected of assisted zijn`);
    modes.add(mode);
  }
  if (typeof adapter.buildPayload !== "function") throw err(400, "ADAPTER_BUILD_PAYLOAD_REQUIRED", "buildPayload (canoniek -> provider) is verplicht");
  if (modes.has("connected")) {
    if (typeof adapter.submit !== "function") throw err(400, "ADAPTER_SUBMIT_REQUIRED", "een connected capability vereist submit()");
    if (typeof adapter.fetchStatus !== "function") throw err(400, "ADAPTER_FETCH_STATUS_REQUIRED", "een connected capability vereist fetchStatus()");
  }
  if (modes.has("assisted") && typeof adapter.buildAssistedPackage !== "function") {
    throw err(400, "ADAPTER_ASSISTED_PACKAGE_REQUIRED", "een assisted capability vereist buildAssistedPackage()");
  }
  CF.assertAdapterBoundary(adapter); // A09/A10 · geen platform-concerns in een adapter
  return true;
}

// ── Exportcontract (payroll_exports · 17.3) ──────────────────────────────────

/** Stabiele checksum over de inhoud van een export (volatiele velden buiten beschouwing). */
function checksum(core) {
  return crypto.createHash("sha256").update(JSON.stringify(core)).digest("hex");
}

/**
 * Bouw het canonieke exportpakket (PUUR · geen store, geen tijd). Groepeert de
 * aanleverregels per medewerker, resolvet het provider employee ID en de
 * providercode via de connectorframework-mappings, en meldt EERLIJK wat
 * onmapbaar is (unmapped) · geen stille weglating. Het resultaat is de bron voor
 * zowel de Connected-transfer als het Assisted-pakket.
 */
function buildCanonicalExport({ period, employer, entries = [], employeeMappings = [], codeMappings = [], at = null } = {}) {
  if (!period || typeof period !== "object") throw err(400, "PERIOD_REQUIRED", "periode is verplicht voor een export");
  const moment = at || `${period.period}-01`;
  const byEmployee = new Map();
  for (const e of entries) {
    const empId = clean(e.employeeId);
    if (!byEmployee.has(empId)) byEmployee.set(empId, []);
    byEmployee.get(empId).push(e);
  }
  const unmapped = [];
  const employees = [];
  for (const empId of [...byEmployee.keys()].sort()) {
    const empMap = resolveEmployeeMapping(employeeMappings, empId, moment);
    if (!empMap) unmapped.push({ kind: "employee", employeeId: empId });
    const lines = byEmployee.get(empId).map(e => {
      let providerCode = null;
      if (CODE_MAPPING_KINDS.includes(e.type) && clean(e.code)) {
        const cm = resolveCodeMapping(codeMappings, e.type, e.code, moment);
        providerCode = cm ? cm.providerValue : null;
        if (!cm) unmapped.push({ kind: "code", entryType: e.type, code: clean(e.code), employeeId: empId });
      }
      return {
        type: e.type,
        code: clean(e.code) || null,
        providerCode,
        kind: e.kind || null,
        absenceType: e.absenceType || null,
        variableType: e.variableType || null,
        mutationType: e.mutationType || null,
        value: e.value != null ? round2(e.value) : null,
        effectiveDate: e.effectiveDate || null,
        project: e.project || null,
        worksite: e.worksite || null,
        costCenter: e.costCenter || null,
      };
    });
    employees.push({
      employeeId: empId,
      providerEmployeeId: empMap ? empMap.providerValue : null,
      lines,
    });
  }
  const totals = {
    employees: employees.length,
    lines: entries.length,
    performanceHours: round2(entries.filter(e => e.type === "performance").reduce((s, e) => s + (Number(e.value) || 0), 0)),
    absenceDays: round2(entries.filter(e => e.type === "absence").reduce((s, e) => s + (Number(e.value) || 0), 0)),
    variableAmount: round2(entries.filter(e => e.type === "variable").reduce((s, e) => s + (Number(e.value) || 0), 0)),
    mutations: entries.filter(e => e.type === "mutation").length,
    unmapped: unmapped.length,
  };
  // Kernpayload voor de checksum: deterministisch, zonder tijd/versie.
  const core = {
    period: { tenantId: period.tenantId, companyId: period.companyId, period: period.period, provider: period.provider },
    employer: employer ? { companyNumber: employer.companyNumber || null, rszNumber: employer.rszNumber || null } : null,
    employees,
  };
  return { core, employees, employer: employer || null, totals, unmapped, provider: period.provider, mode: period.mode || null };
}

// ── Store-gebonden service (collecties · 17.3) ───────────────────────────────
// Collecties (camelCase in de store): payrollConnections, payrollEmployeeMappings,
// payrollCodeMappings, payrollPeriods, payrollEntries, payrollExports,
// payrollImportResults, payrollCorrections. Elke mutatie schrijft een auditregel.
// store.get scoopt NIET op tenant · elke lookup checkt tenant/company expliciet.

function actorEmail(actor) { return (actor && (actor.email || actor.id)) || "system"; }

function getScopedPeriod(store, tenant, periodId) {
  const p = store.get("payrollPeriods", periodId);
  if (!p || p.tenantId !== tenant.id) throw err(404, "PAYROLL_PERIOD_NOT_FOUND", "payrollperiode niet gevonden");
  return p;
}

function audit(store, tenant, action, detail) {
  store.audit({ actor: detail.actor || "system", tenantId: tenant.id, area: "payroll", action, detail: detail.text || "" });
}

/** Open een payrollperiode voor een onderneming (status open). */
function openPeriod(store, tenant, { companyId, period, provider, mode = "assisted", fourEyes = true } = {}, actor) {
  const draft = { tenantId: tenant.id, companyId: clean(companyId), period: clean(period), provider: clean(provider).toLowerCase(), mode, status: "open" };
  assertPeriod(draft);
  if (mode === "connected" && !supportsCapability(draft.provider, "performance")) {
    throw err(422, "CAPABILITY_NOT_SUPPORTED", `connected modus niet beschikbaar voor ${draft.provider}`);
  }
  // Eén open/lopende periode per onderneming en maand.
  const dup = store.list("payrollPeriods", tenant.id).find(p =>
    p.companyId === draft.companyId && p.period === draft.period && p.status !== "closed");
  if (dup) throw err(409, "PAYROLL_PERIOD_EXISTS", "er bestaat al een lopende periode voor deze onderneming en maand");
  const row = {
    id: id("ppr"), ...draft, fourEyes: fourEyes !== false,
    preparedBy: null, preparedAt: null, submittedBy: null, submittedAt: null,
    approvedBy: null, approvedAt: null, deliveredBy: null, deliveredAt: null,
    providerReference: null, exportVersion: 0,
    createdAt: nowIso(), createdBy: actorEmail(actor),
  };
  store.insert("payrollPeriods", row);
  audit(store, tenant, "payroll_period_opened", { actor: row.createdBy, text: `${row.companyId} ${row.period} ${row.provider}` });
  return row;
}

/** Koppel een medewerker aan een provider employee ID (connectorframework-mapping). */
function setEmployeeMapping(store, tenant, { companyId = null, employeeId, providerEmployeeId, validFrom = null, validTo = null } = {}, actor) {
  const existing = store.list("payrollEmployeeMappings", tenant.id).filter(m => m.employeeId === clean(employeeId));
  const version = existing.reduce((mx, m) => Math.max(mx, m.version || 0), 0) + 1;
  const mapping = buildEmployeeMapping({ employeeId, providerEmployeeId, version, validFrom, validTo });
  const row = { id: id("pem"), tenantId: tenant.id, companyId: companyId ? clean(companyId) : null, employeeId: clean(employeeId), ...mapping, createdAt: nowIso(), createdBy: actorEmail(actor) };
  store.insert("payrollEmployeeMappings", row);
  audit(store, tenant, "payroll_employee_mapping_set", { actor: row.createdBy, text: `${row.employeeId} -> ${row.providerValue} v${version}` });
  return row;
}

/** Map een lokale prestatie/absence/variable-code op een providercode (versienummer). */
function setCodeMapping(store, tenant, { companyId = null, kind, localCode, providerCode, validFrom = null, validTo = null } = {}, actor) {
  const existing = store.list("payrollCodeMappings", tenant.id).filter(m => m.kind === kind && m.code === clean(localCode));
  const version = existing.reduce((mx, m) => Math.max(mx, m.version || 0), 0) + 1;
  const mapping = buildCodeMapping({ kind, localCode, providerCode, version, validFrom, validTo });
  const row = { id: id("pcm"), tenantId: tenant.id, companyId: companyId ? clean(companyId) : null, ...mapping, createdAt: nowIso(), createdBy: actorEmail(actor) };
  store.insert("payrollCodeMappings", row);
  audit(store, tenant, "payroll_code_mapping_set", { actor: row.createdBy, text: `${kind}:${row.code} -> ${row.providerValue} v${version}` });
  return row;
}

/** Voeg een canonieke aanleverregel toe aan een periode (alleen in wijzigbare status). */
function addEntry(store, tenant, periodId, entry, actor) {
  const period = getScopedPeriod(store, tenant, periodId);
  if (!ENTRY_MUTABLE_STATES.includes(period.status)) {
    throw err(409, "PAYROLL_PERIOD_LOCKED", `regels kunnen niet gewijzigd worden in status ${period.status} (${periodLabel(period.status)})`);
  }
  assertEntry(entry);
  const row = {
    id: id("pen"), tenantId: tenant.id, companyId: period.companyId, periodId,
    type: entry.type, employeeId: clean(entry.employeeId),
    code: entry.code != null ? clean(entry.code) : null,
    kind: entry.kind || null, absenceType: entry.absenceType || null,
    variableType: entry.variableType || null, mutationType: entry.mutationType || null,
    value: entry.value != null ? round2(entry.value) : null,
    effectiveDate: entry.effectiveDate || null,
    project: entry.project || null, worksite: entry.worksite || null, costCenter: entry.costCenter || null,
    createdAt: nowIso(), createdBy: actorEmail(actor),
  };
  store.insert("payrollEntries", row);
  audit(store, tenant, "payroll_entry_added", { actor: row.createdBy, text: `${periodId} ${entry.type} ${row.employeeId}` });
  return row;
}

function entriesOf(store, tenant, periodId) {
  return store.list("payrollEntries", tenant.id).filter(e => e.periodId === periodId);
}
function exportsOf(store, tenant, periodId) {
  return store.list("payrollExports", tenant.id).filter(x => x.periodId === periodId);
}

/**
 * Statusovergang van een periode (11) met de vereiste velden per doel. Vier-ogen
 * wordt afgedwongen bij goedkeuring (review -> approved): de goedkeurder mag niet
 * de indiener zijn. Levering vereist een bestaande exportversie.
 */
function transitionPeriod(store, tenant, { periodId, to } = {}, actor) {
  const period = getScopedPeriod(store, tenant, periodId);
  assertPeriodTransition(period.status, to);
  const who = actorEmail(actor);
  const patch = { status: to };
  if (to === "voorbereiding" && period.status === "open") { patch.preparedBy = who; patch.preparedAt = nowIso(); }
  if (to === "review") { patch.submittedBy = who; patch.submittedAt = nowIso(); }
  if (to === "approved") {
    // Segregation of duties (23.9): de indiener keurt niet zelf goed.
    assertFourEyesApproval(who, period.submittedBy || period.preparedBy, { fourEyes: period.fourEyes });
    patch.approvedBy = who; patch.approvedAt = nowIso();
  }
  if (to === "delivered") {
    if (!exportsOf(store, tenant, periodId).length) throw err(409, "PAYROLL_NO_EXPORT", "geen exportversie om aan te leveren · bouw eerst een export");
    patch.deliveredBy = who; patch.deliveredAt = nowIso();
  }
  const next = store.update("payrollPeriods", periodId, patch);
  audit(store, tenant, `payroll_period_${to}`, { actor: who, text: `${periodId} ${period.status} -> ${to}` });
  return next;
}

/** Vier-ogen-goedkeuring (review -> approved). Convenience boven transitionPeriod. */
function approvePeriod(store, tenant, { periodId } = {}, actor) {
  return transitionPeriod(store, tenant, { periodId, to: "approved" }, actor);
}

/**
 * Bouw en bewaar een exportversie (payroll_exports): versie, canonieke payload,
 * checksum en (later) providerreferentie. Een nieuwe versie verwijst ALTIJD naar
 * de vorige (previousVersion/previousExportId) · historie wordt nooit overschreven.
 */
function buildAndStoreExport(store, tenant, periodId, { employer = null } = {}, actor) {
  const period = getScopedPeriod(store, tenant, periodId);
  if (!EXPORT_BUILDABLE_STATES.includes(period.status)) {
    throw err(409, "PAYROLL_NOT_EXPORTABLE", `een export kan alleen gebouwd worden in status ${EXPORT_BUILDABLE_STATES.join("/")}, niet ${period.status}`);
  }
  const entries = entriesOf(store, tenant, periodId);
  if (!entries.length) throw err(409, "PAYROLL_NO_ENTRIES", "de periode bevat geen aanleverregels");
  const employeeMappings = store.list("payrollEmployeeMappings", tenant.id);
  const codeMappings = store.list("payrollCodeMappings", tenant.id);
  const built = buildCanonicalExport({ period, employer, entries, employeeMappings, codeMappings, at: `${period.period}-01` });
  const prior = exportsOf(store, tenant, periodId).slice().sort((a, b) => b.version - a.version)[0] || null;
  const version = (prior ? prior.version : 0) + 1;
  const row = {
    id: id("pex"), tenantId: tenant.id, companyId: period.companyId, periodId,
    version, previousVersion: prior ? prior.version : null, previousExportId: prior ? prior.id : null,
    provider: period.provider, mode: period.mode,
    payload: built.core, totals: built.totals, unmapped: built.unmapped,
    checksum: checksum(built.core), providerReference: null,
    createdAt: nowIso(), createdBy: actorEmail(actor),
  };
  store.insert("payrollExports", row);
  store.update("payrollPeriods", periodId, { exportVersion: version });
  audit(store, tenant, "payroll_export_built", { actor: row.createdBy, text: `${periodId} v${version}${prior ? ` (vorige v${prior.version})` : ""} sha256:${row.checksum.slice(0, 12)}` });
  return row;
}

/**
 * Registreer het resultaat van een provideraanlevering (payroll_import_results):
 * status, documenten en fouten. Zet de providerreferentie op de exportversie en
 * beweegt de periode mee: processed bij succes, correction bij een afwijzing.
 */
function recordImportResult(store, tenant, periodId, { status, providerReference = null, documents = [], errors = [], exportId = null } = {}, actor) {
  const period = getScopedPeriod(store, tenant, periodId);
  const RESULT_STATES = ["processed", "partially_processed", "rejected", "correction_required"];
  if (!RESULT_STATES.includes(status)) throw err(400, "IMPORT_RESULT_STATUS_INVALID", `status moet een van ${RESULT_STATES.join(", ")} zijn`);
  const exp = exportId
    ? exportsOf(store, tenant, periodId).find(x => x.id === exportId)
    : exportsOf(store, tenant, periodId).slice().sort((a, b) => b.version - a.version)[0];
  if (!exp) throw err(409, "PAYROLL_NO_EXPORT", "geen exportversie om een resultaat op te registreren");
  const row = {
    id: id("pir"), tenantId: tenant.id, companyId: period.companyId, periodId, exportId: exp.id, exportVersion: exp.version,
    status, providerReference: providerReference ? clean(providerReference) : null,
    documents: Array.isArray(documents) ? documents : [], errors: Array.isArray(errors) ? errors : [],
    createdAt: nowIso(), createdBy: actorEmail(actor),
  };
  store.insert("payrollImportResults", row);
  if (row.providerReference) {
    store.update("payrollExports", exp.id, { providerReference: row.providerReference });
    store.update("payrollPeriods", periodId, { providerReference: row.providerReference });
  }
  // Statusgevolg (alleen vanuit delivered/processed, binnen de statemachine).
  if (status === "processed" && period.status === "delivered") transitionPeriod(store, tenant, { periodId, to: "processed" }, actor);
  else if ((status === "rejected" || status === "correction_required") && ["delivered", "processed"].includes(period.status)) {
    transitionPeriod(store, tenant, { periodId, to: "correction" }, actor);
  }
  audit(store, tenant, "payroll_import_result", { actor: row.createdBy, text: `${periodId} v${exp.version} ${status}${row.providerReference ? " ref=" + row.providerReference : ""}` });
  return row;
}

/**
 * Start een correctie op een reeds aangeleverde/verwerkte/afgesloten periode
 * (23.10 · Payroll correction). Registreert een correctierecord dat naar de
 * laatste exportversie verwijst, beweegt de periode naar "correction" en bewaart
 * audit. De VOLGENDE buildAndStoreExport levert dan versie N+1 met previousVersion
 * naar N · de historie wordt nooit overschreven.
 */
function correctPeriod(store, tenant, periodId, { reason } = {}, actor) {
  const period = getScopedPeriod(store, tenant, periodId);
  if (!clean(reason)) throw err(400, "PAYROLL_CORRECTION_REASON_REQUIRED", "een correctie vereist een reden");
  const latest = exportsOf(store, tenant, periodId).slice().sort((a, b) => b.version - a.version)[0];
  if (!latest) throw err(409, "PAYROLL_NO_EXPORT", "er is geen aangeleverde exportversie om te corrigeren");
  assertPeriodTransition(period.status, "correction"); // geldig vanuit delivered/processed/closed
  const row = {
    id: id("pco"), tenantId: tenant.id, companyId: period.companyId, periodId,
    correctsExportId: latest.id, correctsVersion: latest.version,
    reason: clean(reason), createdAt: nowIso(), createdBy: actorEmail(actor),
  };
  store.insert("payrollCorrections", row);
  store.update("payrollPeriods", periodId, { status: "correction" });
  audit(store, tenant, "payroll_correction_opened", { actor: row.createdBy, text: `${periodId} corrigeert v${latest.version}: ${row.reason}` });
  return row;
}

/**
 * Assisted-pakket (10.3): het gecontroleerde providerconforme exportbestand.
 * HERGEBRUIKT de bestaande prestatie-aggregatie (social-secretariat.js): dezelfde
 * prestatiecodes en CSV-vorm die elk secretariaat inleest · geen duplicaat.
 */
function buildAssistedPackage(store, tenant, { from, to, separator = ";" } = {}) {
  const exportData = SS.buildPayrollExport(store, tenant, { from, to });
  return { mode: "assisted", format: "csv", filename: `payroll_${clean(from)}_${clean(to)}.csv`, csv: SS.toCsv(exportData, { separator }), export: exportData };
}

/** Tenant-veilige periodeweergave voor de cockpit (met status-label). */
function periodView(period) {
  if (!period) return period;
  return { ...period, statusLabel: periodLabel(period.status) };
}

module.exports = {
  // canoniek model · enums en labels
  GO_LIVE_PROVIDERS, PAYROLL_MODES, PAYROLL_FREQUENCIES, ENTRY_TYPES,
  PERFORMANCE_KINDS, ABSENCE_TYPES, VARIABLE_TYPES, MUTATION_TYPES, CODE_MAPPING_KINDS,
  PERIOD_STATES, PERIOD_LABELS, PERIOD_TRANSITIONS, PAYROLL_CAPABILITIES, PROVIDER_PROFILES,
  isGoLiveProvider,
  // entiteitvalidatoren + assert-varianten
  validateEmployer, validateEmployee, validatePerformance, validateAbsence, validateVariable, validateMutation, validateEntry, validatePeriod,
  assertEmployer, assertEmployee, assertEntry, assertPeriod,
  // periode-statemachine
  assertPeriodTransition, isPeriodTerminal, periodLabel,
  // segregation of duties
  assertFourEyesApproval,
  // mappings via connectorframework
  buildEmployeeMapping, buildCodeMapping, resolveEmployeeMapping, resolveCodeMapping,
  // connected vs assisted
  capabilityMode, supportsCapability, providerCard,
  // adaptercontract
  describeAdapterContract, assertAdapterContract,
  // exportcontract (puur)
  checksum, buildCanonicalExport,
  // store-gebonden service
  openPeriod, setEmployeeMapping, setCodeMapping, addEntry,
  transitionPeriod, approvePeriod, buildAndStoreExport, recordImportResult, correctPeriod,
  buildAssistedPackage, periodView,
};
