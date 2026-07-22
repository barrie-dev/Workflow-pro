"use strict";

// ── Standaardformulieren-catalogus (Forms handover h25 "Standaardformulieren bij
//    livegang" + h23 reseller · F4) ─────────────────────────────────────────
// De canonieke lijst formulieren die een tenant bij livegang kent, met hun
// default activatiestatus, primaire flow, domeinobject, classificatie en (waar
// van toepassing) het vereiste entitlement. Puur data · de seeder materialiseert
// ze idempotent per tenant. Geen tweede engine: dit zijn definities voor DE engine.
//
// form_type: domain (schrijft naar een canoniek domeinobject) | workflow
// (goedkeuringsgericht) | evidence (onveranderlijk bewijs/checklist) | survey.

const CORE_FORMS = [
  { key: "CORE-001", chapter: 6, name: "Tenantregistratie", form_type: "domain", domain_object: "tenant", status: "system_required", data_classification: "confidential", flow: "Publiek → platform review" },
  { key: "CORE-002", chapter: 6, name: "Ondernemingsprofiel", form_type: "domain", domain_object: "company", status: "system_required", data_classification: "confidential", flow: "Tenant admin" },
  { key: "CORE-003", chapter: 6, name: "Gebruikersuitnodiging", form_type: "domain", domain_object: "user", status: "enabled", data_classification: "personal", flow: "User admin" },

  { key: "CRM-001", chapter: 8, name: "Snelle klantaanmaak", form_type: "domain", domain_object: "customer", status: "enabled", data_classification: "confidential", flow: "CRM create" },
  { key: "CRM-002", chapter: 8, name: "Volledig klantprofiel", form_type: "domain", domain_object: "customer", status: "enabled", data_classification: "confidential", flow: "CRM edit" },
  { key: "CRM-003", chapter: 8, name: "Contact en locatie", form_type: "domain", domain_object: "contact", status: "enabled", data_classification: "personal", flow: "CRM edit" },

  { key: "SAL-001", chapter: 10, name: "Offerte aanmaken", form_type: "domain", domain_object: "quote", status: "enabled", data_classification: "financial", flow: "Sales" },
  { key: "SAL-002", chapter: 10, name: "Prijsafwijking", form_type: "workflow", domain_object: "quote", status: "conditional", data_classification: "financial", flow: "Sales → approver",
    conditions: [{ field: "discount_pct", op: "gte", value: 10 }] },

  { key: "PRJ-001", chapter: 11, name: "Projectaanmaak", form_type: "domain", domain_object: "project", status: "enabled", data_classification: "internal", flow: "Project create" },
  { key: "PRJ-002", chapter: 11, name: "Projectkick-off", form_type: "domain", domain_object: "project", status: "available", data_classification: "internal", flow: "Project template" },
  { key: "PRJ-003", chapter: 11, name: "Projectoplevering", form_type: "workflow", domain_object: "project", status: "conditional", data_classification: "internal", flow: "Project manager → customer" },

  { key: "OPS-001", chapter: 13, name: "Werkbon uitvoering", form_type: "domain", domain_object: "workorder", status: "enabled", data_classification: "internal", flow: "Assigned worker" },
  { key: "OPS-002", chapter: 13, name: "Klantbevestiging", form_type: "workflow", domain_object: "workorder", status: "conditional", data_classification: "internal", flow: "External customer" },

  { key: "HR-001", chapter: 14, name: "Verlofaanvraag", form_type: "domain", domain_object: "leave", status: "enabled", data_classification: "special_category", requires_entitlement: "leave", flow: "Employee → manager" },
  { key: "HR-002", chapter: 14, name: "Tijdcorrectie", form_type: "domain", domain_object: "timesheet", status: "enabled", data_classification: "personal", requires_entitlement: "time", flow: "Employee → manager" },
  { key: "EXP-001", chapter: 14, name: "Onkostenaanvraag", form_type: "workflow", domain_object: "expense", status: "enabled", data_classification: "financial", requires_entitlement: "expenses", flow: "Employee → manager/finance" },

  { key: "FIN-001", chapter: 15, name: "Factuurcontrole", form_type: "workflow", domain_object: "invoice", status: "available", data_classification: "financial", flow: "Finance" },
  { key: "PUR-001", chapter: 16, name: "Aankoopaanvraag", form_type: "workflow", domain_object: "purchase", status: "available", data_classification: "financial", flow: "Requester → approvers" },
  { key: "STK-001", chapter: 17, name: "Voorraadcorrectie", form_type: "domain", domain_object: "stock", status: "available", data_classification: "internal", flow: "Warehouse → manager" },
  { key: "AST-001", chapter: 18, name: "Asset/voertuigschade", form_type: "evidence", domain_object: "asset", status: "available", data_classification: "internal", flow: "Assigned user → fleet/service" },
  { key: "CMP-001", chapter: 19, name: "Incident/near miss", form_type: "evidence", domain_object: "incident", status: "available", data_classification: "confidential", flow: "Employee → compliance" },
  { key: "SUP-001", chapter: 20, name: "Supportticket", form_type: "workflow", domain_object: "ticket", status: "enabled", data_classification: "internal", flow: "User/customer portal" },

  { key: "PRV-001", chapter: 21, name: "Gegevensinzage/verwijdering", form_type: "workflow", domain_object: "privacy_request", status: "system_required", data_classification: "personal", flow: "Data subject → privacy" },
  { key: "SEC-001", chapter: 21, name: "Securityincident", form_type: "evidence", domain_object: "security_incident", status: "system_required", data_classification: "security_sensitive", flow: "Authorized internal" },
  { key: "SEC-002", chapter: 21, name: "Supporttoegang", form_type: "workflow", domain_object: "support_grant", status: "conditional", data_classification: "security_sensitive", flow: "Tenant admin → support" },
];

// Reseller-formulieren (h23 · RES-001..010 = FORM-13..18). Allemaal achter het
// partnerprogramma-entitlement; enkel commerciële data (memory: resellers).
const RESELLER_FORMS = [
  { key: "RES-001", chapter: 23, name: "Reselleraanvraag en kwalificatie", form_type: "workflow", domain_object: "reseller", status: "available", data_classification: "confidential", requires_entitlement: "reseller_program", flow: "Extern → partner review" },
  { key: "RES-002", chapter: 23, name: "Reselleronboarding en contractacceptatie", form_type: "workflow", domain_object: "reseller", status: "conditional", data_classification: "confidential", requires_entitlement: "reseller_program", flow: "Partner admin/legal" },
  { key: "RES-003", chapter: 23, name: "Dealregistratie", form_type: "workflow", domain_object: "deal", status: "enabled", data_classification: "confidential", requires_entitlement: "reseller_program", flow: "Reseller → Monargo review" },
  { key: "RES-004", chapter: 23, name: "Tenantaanvraag", form_type: "domain", domain_object: "tenant", status: "enabled", data_classification: "confidential", requires_entitlement: "reseller_program", flow: "Reseller → customer confirmation → provisioning" },
  { key: "RES-005", chapter: 23, name: "Licentie- en seatbestelling", form_type: "workflow", domain_object: "license_order", status: "enabled", data_classification: "financial", requires_entitlement: "reseller_program", flow: "Reseller → approval/apply" },
  { key: "RES-006", chapter: 23, name: "Prijsuitzondering", form_type: "workflow", domain_object: "price_exception", status: "conditional", data_classification: "financial", requires_entitlement: "reseller_program", flow: "Reseller sales → partner manager/finance" },
  { key: "RES-007", chapter: 23, name: "Gedelegeerde supporttoegang", form_type: "workflow", domain_object: "support_grant", status: "available", data_classification: "security_sensitive", requires_entitlement: "reseller_program", flow: "Reseller support → tenant admin" },
  { key: "RES-008", chapter: 23, name: "Commissiestaat en dispuut", form_type: "workflow", domain_object: "commission", status: "enabled", data_classification: "financial", requires_entitlement: "reseller_program", flow: "System calculation → review/dispute" },
  { key: "RES-009", chapter: 23, name: "Partnerreview", form_type: "survey", domain_object: "reseller", status: "scheduled", data_classification: "confidential", requires_entitlement: "reseller_program", flow: "Monargo partner management" },
  { key: "RES-010", chapter: 23, name: "Reselleroffboarding", form_type: "workflow", domain_object: "reseller", status: "conditional", data_classification: "confidential", requires_entitlement: "reseller_program", flow: "Partner/legal/finance/security" },
];

const STANDARD_FORMS = [...CORE_FORMS, ...RESELLER_FORMS];
const BY_KEY = STANDARD_FORMS.reduce((m, f) => (m[f.key] = f, m), {});

/** Bouw de attributes-blob voor een catalogus-entry (flow, entitlement, voorwaarden). */
function attributesFor(entry) {
  const attrs = { catalog: true, flow: entry.flow || null };
  if (entry.chapter) attrs.dictionary_chapter = entry.chapter; // normatief h6-h24-hoofdstuk
  if (entry.requires_entitlement) attrs.requires_entitlement = entry.requires_entitlement;
  if (entry.conditions) attrs.conditions = entry.conditions;
  return attrs;
}

module.exports = { CORE_FORMS, RESELLER_FORMS, STANDARD_FORMS, BY_KEY, attributesFor };
