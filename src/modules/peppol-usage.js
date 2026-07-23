"use strict";

// ── Peppol usage · pricing · billing (INT-04/05/06) ──────────────────────────
// Store-gebonden laag BOVENOP de pure ledger (src/platform/usage-ledger.js) en
// de bestaande Peppol-transportadapter (src/modules/peppol-billit.js +
// peppol-invoice.js). Deze module wijzigt die adapter NIET; de metering hangt
// aan het moment waarop de provider een document technisch aanvaardt.
//
// Grondregels (niet-onderhandelbaar · spec 5/6/7 + testscenario's 23):
//  - 1 technisch geaccepteerd document = exact 1 billable usage_event. Een
//    dubbele webhook of een technische retry met dezelfde idempotency_key maakt
//    GEEN nieuw event (idempotent). Validatiefouten vóór provideracceptatie en
//    sandbox/test-documenten zijn NOOIT billable.
//  - Owner-mode per onderneming (source of truth, spec 5/6.2): Monargo,
//    boekhoudpakket of niet actief · nooit beide. Is het boekhoudpakket de
//    eigenaar, dan verzendt en meet Monargo NIET.
//  - De klantprijs + providerkost worden op billable_at VASTGEKLIKT op het event
//    (immutable). Prijswijzigingen werken alleen PROSPECTIEF: een bestaand event
//    behoudt zijn prijs, een nieuw event krijgt de nieuwe tariefregel.
//  - Correcties gaan via een TEGENGESTELD event (nooit een overschrijving).
//  - provider_unit_cost en marge zijn UITSLUITEND Super Admin-data · elke
//    tenant-view strippt ze. De tenant ziet enkel de eigen operationele status
//    en het eigen aangerekende volume/prijs.
//  - billing_period: Open -> Calculated -> Review -> Approved -> Invoiced ->
//    Closed (Closed = immutable; latere correcties naar een volgende periode).

const crypto = require("crypto");
const L = require("../platform/usage-ledger");
const { loadPlatformConfig } = require("./platform-config");

function id(prefix) { return `${prefix}_${crypto.randomBytes(9).toString("hex")}`; }
function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
function nowIso() { return new Date().toISOString(); }
function clean(v) { return String(v == null ? "" : v).trim(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function monthOf(iso) { return clean(iso).slice(0, 7); }               // YYYY-MM
// De maand NA een YYYY-MM (rolt over jaargrenzen). Gebruikt om een correctie naar
// de eerstvolgende open periode te schuiven wanneer de huidige maand niet open is.
function addMonth(period) {
  const parts = clean(period).split("-");
  const y = Number(parts[0]), m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return clean(period);
  const d = new Date(Date.UTC(y, m, 1));                                 // m (1-based) = volgende maand (0-based)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function qtyOf(ev) { return ev && ev.quantity != null ? ev.quantity : 1; }
function actorEmail(actor) { return (actor && (actor.email || actor.id)) || "system"; }

// Peppolmodus per juridische onderneming (spec 6.2). Exact één eigenaar.
const PEPPOL_MODES = ["monargo", "accounting_package", "inactive"];
// Operationele tenantrechten (spec 6.2 · verzenden/ontvangen/fouten/raadplegen).
const PEPPOL_OPERATIONAL_RIGHTS = ["peppol.send", "peppol.receive", "peppol.errors", "peppol.documents.view"];

// ── Interne readers (ledger verwacht een platte rules-array) ─────────────────
// Prijsregels zijn platformconfiguratie (tenantId: null zodat store.list(col,
// tenantId) ze nooit aan een tenant lekt). Het onderwerp van een override staat
// in subjectTenantId/subjectCompanyId · we mappen dat naar het veld dat de pure
// resolver (effectiveCustomerPrice) verwacht.
// Newest-first zodat een gelijk-gedateerde (of ongedateerde) nieuwere regel de
// tie-break wint: de resolver kiest bij gelijke validFrom de eerste in de array.
function ledgerPriceRules(store) {
  return (store.list("usagePriceRules", null) || []).slice().reverse().map(r => ({
    ...r, tenantId: r.subjectTenantId || null, companyId: r.subjectCompanyId || null,
  }));
}
function ledgerCostRules(store) {
  return (store.list("usageCostRules", null) || []).slice().reverse();
}

// Provider + omgeving voor billability/pricing. Expliciete input wint; anders de
// centrale Super Admin-config (provider + sandbox). Faalt zacht naar mock.
function peppolRuntime(store, input = {}) {
  let provider = clean(input.provider);
  let sandbox = input.sandbox;
  if (!provider || sandbox === undefined) {
    try {
      const cfg = loadPlatformConfig(store);
      if (!provider) provider = clean(cfg.peppol && cfg.peppol.provider);
      if (sandbox === undefined) sandbox = !!(cfg.peppol && cfg.peppol.sandbox);
    } catch (_) { /* zonder config: mock/productie-standaard */ }
  }
  const environment = clean(input.environment) || (sandbox ? "sandbox" : "production");
  return { provider: provider || "mock", environment };
}

// ── 1. Owner-mode / tenantactivatie per onderneming (INT-05, spec 6.2) ───────

/**
 * Activeer (of herconfigureer) Peppol voor één juridische onderneming van een
 * tenant. Idempotent per (tenant, company): een tweede activatie werkt de
 * bestaande bij. De modus bepaalt de eigenaar (nooit beide). Alleen niet-geheime
 * tenantgegevens; providercredentials leven centraal bij de Super Admin.
 */
function activatePeppol(store, input = {}, actor) {
  const tenantId = clean(input.tenantId);
  const companyId = clean(input.companyId);
  const mode = clean(input.mode);
  if (!tenantId) throw err(400, "PEPPOL_TENANT_REQUIRED", "tenantId is verplicht");
  if (!companyId) throw err(400, "PEPPOL_COMPANY_REQUIRED", "Peppol wordt per juridische onderneming geactiveerd");
  if (!PEPPOL_MODES.includes(mode)) throw err(400, "PEPPOL_MODE_INVALID", `onbekende peppolmodus ${mode || "leeg"}`);
  const rights = Array.isArray(input.operationalRights)
    ? input.operationalRights.filter(r => PEPPOL_OPERATIONAL_RIGHTS.includes(r))
    : [];
  const fields = {
    tenantId, companyId, mode,
    companyNumber: clean(input.companyNumber) || null,
    vatNumber: clean(input.vatNumber) || null,
    participantId: clean(input.participantId) || null,
    billingAddress: input.billingAddress || null,
    paymentReference: clean(input.paymentReference) || null,
    operationalRights: rights,
    status: mode === "inactive" ? "inactive" : "active",
    updatedAt: nowIso(), updatedBy: actorEmail(actor),
  };
  const existing = (store.list("peppolActivations", tenantId) || []).find(a => a.companyId === companyId);
  let row;
  if (existing) {
    row = store.update("peppolActivations", existing.id, fields);
  } else {
    row = { id: id("ppa"), createdAt: nowIso(), createdBy: actorEmail(actor), ...fields };
    store.insert("peppolActivations", row);
  }
  store.audit({ actor: actorEmail(actor), tenantId, area: "peppol", action: "peppol_activation_set", detail: `${companyId} mode=${mode}` });
  return row;
}

/** De activatie voor één onderneming (tenant-gescoped). Null wanneer afwezig. */
function peppolActivation(store, tenantId, companyId) {
  const t = clean(tenantId), c = clean(companyId);
  return (store.list("peppolActivations", t) || []).find(a => a.tenantId === t && a.companyId === c) || null;
}

/** Is Monargo de Peppol-eigenaar (verzender/meter) voor deze onderneming? */
function monargoOwnsPeppol(store, tenantId, companyId) {
  const a = peppolActivation(store, tenantId, companyId);
  return !!a && a.mode === "monargo";
}

/**
 * Tenant-view van de eigen operationele Peppol-status (geen kost/marge). Optioneel
 * gefilterd op één onderneming.
 */
function tenantPeppolStatus(store, tenantId, companyId = null) {
  const c = clean(companyId);
  return (store.list("peppolActivations", clean(tenantId)) || [])
    .filter(a => !c || a.companyId === c)
    .map(a => ({
      tenantId: a.tenantId, companyId: a.companyId, mode: a.mode,
      active: a.mode !== "inactive", monargoIsSender: a.mode === "monargo",
      participantId: a.participantId || null, companyNumber: a.companyNumber || null,
      vatNumber: a.vatNumber || null, operationalRights: a.operationalRights || [],
      status: a.status || "active",
    }));
}

// ── 2. Prijs- en kostregels (Super Admin · INT-06, spec 7) ───────────────────

/**
 * Zet een klantprijsregel (platform default / tenantpakket / tenantoverride).
 * Append-only en PROSPECTIEF: bestaande events behouden hun vastgeklikte prijs;
 * een nieuwe regel met validFrom in de toekomst geldt enkel voor latere events.
 * Overrides dragen subjectTenantId zodat het geen tenantdata wordt.
 */
function setPriceRule(store, input = {}, actor, opts = {}) {
  const level = clean(input.level);
  if (!L.CUSTOMER_PRICE_LEVELS.includes(level)) throw err(400, "PRICE_LEVEL_INVALID", `onbekend prijsniveau ${level || "leeg"}`);
  const usageType = clean(input.usageType) || null;
  if (usageType && !L.PEPPOL_USAGE_TYPES.includes(usageType)) throw err(400, "USAGE_TYPE_INVALID", `onbekend peppol usage_type ${usageType}`);
  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) throw err(400, "PRICE_INVALID", "prijs moet een getal groter of gelijk aan 0 zijn");
  const subjectTenantId = clean(input.subjectTenantId) || null;
  if ((level === "tenant_override" || level === "tenant_package") && !subjectTenantId) {
    throw err(400, "PRICE_TENANT_REQUIRED", `${level} vereist een subjectTenantId`);
  }
  // Vier-ogen op tarieven (sectie 7): een VOORGESTELDE regel (opts.pending) is nog
  // niet actief · een tweede Super Admin moet ze goedkeuren via approvePriceRule.
  // Een directe set (seed/migratie/interne aanroep) blijft onmiddellijk actief.
  const pending = opts.pending === true;
  const row = {
    id: id("upr"), tenantId: null, kind: "price", level, usageType,
    subjectTenantId, subjectCompanyId: clean(input.subjectCompanyId) || null,
    price: L.round2(price),
    includedVolume: input.includedVolume != null ? Math.max(0, Number(input.includedVolume) || 0) : 0,
    // Geen startdatum = open ondergrens (altijd geldige default). Een prospectieve
    // wijziging krijgt een expliciete validFrom en geldt enkel voor latere events.
    validFrom: clean(input.validFrom) || null,
    validTo: clean(input.validTo) || null,
    active: pending ? false : (input.active === false ? false : true),
    status: pending ? "pending_approval" : "active",
    proposedBy: pending ? actorEmail(actor) : null,
    proposedById: pending ? ((actor && actor.id) || actorEmail(actor) || null) : null,
    approvedBy: null, approvedById: null, approvedAt: null,
    createdAt: nowIso(), createdBy: actorEmail(actor),
  };
  store.insert("usagePriceRules", row);
  store.audit({ actor: actorEmail(actor), tenantId: null, area: "usage", action: pending ? "usage_price_rule_proposed" : "usage_price_rule_set", detail: `${level} ${usageType || "*"} ${row.price}${subjectTenantId ? " " + subjectTenantId : ""}` });
  return row;
}

/**
 * Stel een prijswijziging VOOR (maker). Vier-ogen op tarieven (sectie 7): de
 * voorgestelde regel is nog NIET actief en telt dus niet mee in prijs-resolutie
 * tot een TWEEDE Super Admin (checker) ze goedkeurt. De maker wordt geregistreerd
 * (proposedById) zodat dezelfde persoon niet zelf kan goedkeuren.
 */
function proposePriceRule(store, input = {}, actor) {
  return setPriceRule(store, input, actor, { pending: true });
}

/**
 * Keur een voorgestelde prijswijziging goed (checker) en maak ze actief. De
 * aanroeper (route) dwingt de vier-ogencontrole af via intAuthz.assertFourEyes:
 * de checker mag niet de maker (proposedById) zijn. Idempotent: een reeds
 * goedgekeurde regel wordt ongewijzigd teruggegeven.
 */
function approvePriceRule(store, { ruleId } = {}, approver) {
  const rule = store.get("usagePriceRules", ruleId);
  if (!rule || rule.kind !== "price") throw err(404, "PRICE_RULE_NOT_FOUND", "prijsregel niet gevonden");
  if (rule.status === "active" && rule.active) return rule; // reeds goedgekeurd (idempotent)
  const updated = store.update("usagePriceRules", ruleId, {
    active: true, status: "active",
    approvedBy: actorEmail(approver), approvedById: (approver && approver.id) || actorEmail(approver) || null,
    approvedAt: nowIso(),
  });
  store.audit({ actor: actorEmail(approver), tenantId: null, area: "usage", action: "usage_price_rule_approved", detail: `${rule.level} ${rule.usageType || "*"} ${rule.price}` });
  return updated;
}

/**
 * Zet een providerkostregel (UITSLUITEND Super Admin). Append-only en prospectief,
 * net als de klantprijs. tenantId blijft null · dit lekt nooit naar een tenant.
 */
function setCostRule(store, input = {}, actor) {
  const provider = clean(input.provider);
  if (!provider) throw err(400, "COST_PROVIDER_REQUIRED", "provider is verplicht voor een kostregel");
  const usageType = clean(input.usageType) || null;
  if (usageType && !L.PEPPOL_USAGE_TYPES.includes(usageType)) throw err(400, "USAGE_TYPE_INVALID", `onbekend peppol usage_type ${usageType}`);
  const unitCost = Number(input.unitCost);
  if (!Number.isFinite(unitCost) || unitCost < 0) throw err(400, "COST_INVALID", "provider_unit_cost moet een getal groter of gelijk aan 0 zijn");
  const cost_level = clean(input.level) || "provider_cost";
  if (!L.PROVIDER_COST_LEVELS.includes(cost_level)) throw err(400, "COST_LEVEL_INVALID", `onbekend kostniveau ${cost_level}`);
  const row = {
    id: id("ucr"), tenantId: null, kind: "cost", level: cost_level, provider, usageType,
    unitCost: L.round2(unitCost),
    validFrom: clean(input.validFrom) || null,
    validTo: clean(input.validTo) || null,
    active: input.active === false ? false : true,
    createdAt: nowIso(), createdBy: actorEmail(actor),
  };
  store.insert("usageCostRules", row);
  store.audit({ actor: actorEmail(actor), tenantId: null, area: "usage", action: "usage_cost_rule_set", detail: `${provider} ${usageType || "*"} ${row.unitCost}` });
  return row;
}

function listPriceRules(store) { return store.list("usagePriceRules", null) || []; }
function listCostRules(store) { return store.list("usageCostRules", null) || []; }

/** De effectieve klantprijsregel op een moment (Super Admin-inzicht). */
function resolvePeppolPrice(store, { tenantId, companyId, usageType, at } = {}) {
  return L.effectiveCustomerPrice(ledgerPriceRules(store), { tenantId, companyId, usageType, at: at || nowIso() });
}
/** De effectieve providerkostregel op een moment (Super Admin-only). */
function resolvePeppolCost(store, { provider, usageType, at } = {}) {
  return L.effectiveProviderCost(ledgerCostRules(store), { provider, usageType, at: at || nowIso() });
}

// ── 3. Billing-periodes (state machine · spec 7) ─────────────────────────────

/** Vind of open een periode voor (tenant, YYYY-MM). Nieuwe events horen hier. */
function ensureOpenPeriod(store, tenantId, period, actor) {
  const existing = (store.list("usageBillingPeriods", tenantId) || []).find(p => p.period === period);
  if (existing) return existing;
  const row = {
    id: id("ubp"), tenantId, period, status: "Open",
    calculatedAt: null, reviewedAt: null, approvedAt: null, invoicedAt: null, closedAt: null,
    createdAt: nowIso(), createdBy: actorEmail(actor),
  };
  store.insert("usageBillingPeriods", row);
  store.audit({ actor: actorEmail(actor), tenantId, area: "usage", action: "usage_period_opened", detail: `${tenantId} ${period}` });
  return row;
}

/**
 * Vind of open de eerstvolgende OPEN periode vanaf een startmaand. Een reeds
 * Calculated/.../Closed periode is immutable voor nieuwe events en wordt over-
 * geslagen · we schuiven maand per maand op tot een Open periode gevonden of
 * aangemaakt is. Dit borgt de regel 'latere correcties gaan naar een volgende
 * (open) periode' (spec 6.4/7 · een afgesloten periode blijft immutable).
 */
function nextOpenPeriodFrom(store, tenantId, startMonth, actor) {
  let month = clean(startMonth) || monthOf(nowIso());
  for (let i = 0; i < 240; i++) {                        // ruime bovengrens (20 jaar)
    const existing = (store.list("usageBillingPeriods", tenantId) || []).find(p => p.period === month);
    if (!existing) return ensureOpenPeriod(store, tenantId, month, actor);
    if (existing.status === "Open") return existing;
    month = addMonth(month);
  }
  throw err(409, "USAGE_NO_OPEN_PERIOD", "geen open periode beschikbaar voor de correctie");
}

/** Expliciet een periode openen (Super Admin). Idempotent per (tenant, period). */
function openPeriod(store, { tenantId, period }, actor) {
  const t = clean(tenantId), p = clean(period);
  if (!t) throw err(400, "USAGE_TENANT_REQUIRED", "tenantId is verplicht");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw err(400, "USAGE_PERIOD_INVALID", "period moet YYYY-MM zijn");
  return ensureOpenPeriod(store, t, p, actor);
}

function getPeriod(store, periodId) {
  const p = store.get("usageBillingPeriods", periodId);
  if (!p) throw err(404, "USAGE_PERIOD_NOT_FOUND", "billing-periode niet gevonden");
  return p;
}

function listPeriods(store, { tenantId = null } = {}) {
  return tenantId ? (store.list("usageBillingPeriods", tenantId) || []) : (store.list("usageBillingPeriods", null) || []);
}

/**
 * Bereken de periode: aggregeer de geboekte events tot billing_lines per
 * tenant/company/usageType (netto na correcties, met inbegrepen volume) en zet de
 * status op Calculated. Herberekenen mag zolang de periode niet Approved of hoger
 * is. Een Closed periode is immutable.
 */
function calculatePeriod(store, { periodId }, actor) {
  const period = getPeriod(store, periodId);
  if (L.isPeriodImmutable(period.status)) throw err(409, "USAGE_PERIOD_IMMUTABLE", "een gesloten periode is immutable");
  L.assertPeriodTransition(period.status, "Calculated"); // weigert vanaf Approved/Invoiced
  const events = (store.list("usageEvents", period.tenantId) || []).filter(e => e.billingPeriodId === periodId);
  const lines = L.calculate(events, ledgerPriceRules(store), { billingPeriodId: periodId });
  // Oude lijnen vervangen · de berekening is een volledige herrekening.
  for (const old of (store.list("usageBillingLines", period.tenantId) || []).filter(l => l.billingPeriodId === periodId)) {
    store.remove("usageBillingLines", old.id);
  }
  const stored = lines.map(line => {
    const row = { id: id("ubl"), createdAt: nowIso(), ...line };
    store.insert("usageBillingLines", row);
    return row;
  });
  const next = store.update("usageBillingPeriods", periodId, { status: "Calculated", calculatedAt: nowIso() });
  store.audit({ actor: actorEmail(actor), tenantId: period.tenantId, area: "usage", action: "usage_period_calculated", detail: `${period.tenantId} ${period.period} (${stored.length} lijnen)` });
  return { period: next, lines: stored };
}

/** Een geldige statusovergang op een periode (Review/Approved/Invoiced/Closed). */
function transitionPeriod(store, { periodId, to }, actor) {
  const period = getPeriod(store, periodId);
  L.assertPeriodTransition(period.status, clean(to));
  const patch = { status: clean(to) };
  const stamp = { Review: "reviewedAt", Approved: "approvedAt", Invoiced: "invoicedAt", Closed: "closedAt" }[clean(to)];
  if (stamp) patch[stamp] = nowIso();
  const next = store.update("usageBillingPeriods", periodId, patch);
  store.audit({ actor: actorEmail(actor), tenantId: period.tenantId, area: "usage", action: `usage_period_${clean(to).toLowerCase()}`, detail: `${period.tenantId} ${period.period}` });
  return next;
}

/** Convenience: keur een periode goed (Review -> Approved). */
function approvePeriod(store, { periodId }, actor) {
  return transitionPeriod(store, { periodId, to: "Approved" }, actor);
}

// ── 4. Usage-metering (INT-04 · haak op provideracceptatie) ──────────────────

/**
 * Boek exact 1 billable usage_event voor een technisch geaccepteerd Peppol-
 * document. Regels:
 *  - Owner-mode: alleen meten wanneer Monargo de eigenaar is; anders niet meten.
 *  - Dedup: een dubbele webhook of technische retry met dezelfde idempotency_key
 *    maakt GEEN nieuw event (idempotent success).
 *  - Niet billable: sandbox/test, validatiefout vóór acceptatie, of nog niet
 *    aanvaard (geen billable_at) · geen event.
 *  - Klik klantprijs + providerkost VAST op het event via de ledger-resolutie op
 *    billable_at (prospectief; latere prijswijziging raakt dit event niet).
 *
 * @returns {{ok, metered, billable, duplicate?, created?, reason?, event}}
 */
function recordPeppolUsage(store, input = {}, actor) {
  const usageType = clean(input.usageType);
  if (!L.PEPPOL_USAGE_TYPES.includes(usageType)) throw err(400, "USAGE_TYPE_INVALID", `peppol-metering vereist een peppol usage_type, kreeg ${usageType || "leeg"}`);
  const tenantId = clean(input.tenantId);
  const companyId = clean(input.companyId);
  const documentId = clean(input.documentId);
  const idempotencyKey = clean(input.idempotencyKey);
  if (!tenantId) throw err(400, "USAGE_TENANT_REQUIRED", "tenantId is verplicht");
  if (!companyId) throw err(400, "USAGE_COMPANY_REQUIRED", "companyId is verplicht voor Peppol-verbruik");
  if (!documentId) throw err(400, "USAGE_DOCUMENT_REQUIRED", "documentId is verplicht");
  if (!idempotencyKey) throw err(400, "USAGE_IDEMPOTENCY_REQUIRED", "idempotency_key is verplicht");

  // Owner-mode (spec 5/6.2): meet alleen wanneer Monargo de eigenaar is.
  const activation = peppolActivation(store, tenantId, companyId);
  const mode = activation ? activation.mode : "inactive";
  if (mode !== "monargo") {
    return { ok: true, metered: false, billable: false, reason: mode === "accounting_package" ? "owner_mode_accounting_package" : "peppol_not_active", event: null };
  }

  const runtime = peppolRuntime(store, input);
  const billableAt = clean(input.billableAt);
  const ev = {
    usageType, tenantId, companyId, documentId,
    providerReference: clean(input.providerReference) || null,
    billableAt, quantity: 1, idempotencyKey,
  };

  // Dedup vóór alles: 1 document = exact 1 billable event.
  const peppolEvents = (store.list("usageEvents", tenantId) || []).filter(e => L.PEPPOL_USAGE_TYPES.includes(e.usageType));
  const dup = peppolEvents.find(e => clean(e.idempotencyKey) === idempotencyKey);
  if (dup) return { ok: true, metered: true, billable: true, duplicate: true, created: false, reason: "duplicate", event: dup };

  const reason = L.billableReason(ev, {
    providerAccepted: !!billableAt,
    validationFailed: input.validationFailed === true,
    environment: runtime.environment,
    isTest: input.test === true,
  });
  if (reason) return { ok: true, metered: false, billable: false, reason, event: null };

  // Klik prijs + providerkost vast (immutable). Resolutie op billable_at.
  const priced = L.priceUsageEvent(ev, {
    priceRules: ledgerPriceRules(store), costRules: ledgerCostRules(store), provider: runtime.provider,
  });
  const period = ensureOpenPeriod(store, tenantId, monthOf(billableAt) || monthOf(nowIso()), actor);
  L.assertPeriodAcceptsEvents(period);

  const row = {
    id: id("uev"), ...priced, provider: runtime.provider, environment: runtime.environment,
    billingPeriodId: period.id, billable: true, correctionOf: null,
    createdAt: nowIso(), createdBy: actorEmail(actor),
  };
  store.insert("usageEvents", row);
  // Detail draagt NOOIT providerkost of marge · enkel de klantprijs.
  store.audit({ actor: actorEmail(actor), tenantId, area: "peppol", action: "peppol_usage_recorded", detail: `${usageType} ${documentId} ${row.customerUnitPrice}` });
  return { ok: true, metered: true, billable: true, duplicate: false, created: true, event: row };
}

/**
 * Verzend-haak voor het factuurpad: leidt companyId + usageType af uit een
 * verzonden factuur en boekt op het acceptatiemoment exact 1 billable event.
 * Dit is de brug tussen de bestaande transportadapter (peppol-invoice.js /
 * billing.js) en de metering · de transportcode zelf blijft ongewijzigd.
 *
 * Grondregels die hier bewaakt worden:
 *  - Owner-mode: recordPeppolUsage meet alleen wanneer Monargo de eigenaar is;
 *    verzendt het boekhoudpakket, dan meet Monargo NIET (metered:false).
 *  - 1 document = exact 1 billable event: de idempotency_key is STABIEL per
 *    document + operatie (usageType), zodat een retry of een dubbele acceptatie
 *    nooit een tweede event boekt.
 *  - billable_at = het moment van provideracceptatie (opts.billableAt).
 * De companyId komt van de factuur; ontbreekt hij, dan valt hij terug op de
 * default-onderneming van de tenant. Zonder herkenbaar document meet ze niet
 * (geen throw · de verzending zelf mag hier nooit op stuklopen).
 *
 * @returns {{ok, metered, billable, duplicate?, created?, reason?, event}}
 */
function recordInvoiceUsage(store, tenant, invoice, opts = {}, actor) {
  const tenantId = clean(tenant && tenant.id) || clean(invoice && invoice.tenantId);
  let companyId = clean(invoice && invoice.companyId);
  if (!companyId && tenantId) {
    const co = (store.data.companies || []).find(c => c && c.tenantId === tenantId && c.isDefault);
    companyId = co ? co.id : "";
  }
  const documentId = clean(invoice && invoice.id);
  if (!tenantId || !companyId || !documentId) {
    return { ok: true, metered: false, billable: false, reason: "document_unresolved", event: null };
  }
  const usageType = clean(invoice.docType) === "credit_note" ? "peppol.outbound_credit_note" : "peppol.outbound_invoice";
  return recordPeppolUsage(store, {
    usageType, tenantId, companyId, documentId,
    // Stabiel per document + operatie (NIET per poging/referentie): 1 document = 1 event.
    idempotencyKey: `peppol:${usageType}:${documentId}`,
    providerReference: clean(opts.providerReference) || null,
    billableAt: clean(opts.billableAt) || nowIso(),
    provider: clean(opts.provider) || undefined,
    sandbox: opts.sandbox,
  }, actor);
}

/**
 * Corrigeer een geboekt event via een TEGENGESTELD event (spec 6.4). Het origineel
 * wordt nooit overschreven en de vastgeklikte prijs blijft behouden. Twee regels:
 *  - Idempotent: een dubbele/geretryde correctie boekt GEEN tweede tegenboeking
 *    (1 origineel = maximaal 1 correctie). Dedup op de deterministische correctie-
 *    key of op een bestaande correctie van hetzelfde origineel · dan wordt het
 *    bestaande event teruggegeven (idempotent success).
 *  - Doelperiode: de tegenboeking hoort in een OPEN periode. Is de oorspronkelijke
 *    maandperiode nog Open, dan netto't de correctie daar; is die periode al
 *    Calculated/.../Closed (immutable), dan vloeit ze naar de huidige (of eerst-
 *    volgende) open periode i.p.v. hard te falen (afgesloten periode = immutable).
 */
function correctPeppolUsage(store, { eventId, reason, idempotencyKey = null }, actor) {
  const src = store.get("usageEvents", eventId);
  if (!src) throw err(404, "USAGE_EVENT_NOT_FOUND", "origineel usage event niet gevonden");
  const counter = L.correctionEvent(src, { reason, idempotencyKey, createdBy: actorEmail(actor) });

  // Idempotency/dedup vóór alles: geen tweede tegengesteld event bij een retry.
  const key = clean(counter.idempotencyKey);
  const existing = (store.list("usageEvents", src.tenantId) || []).find(e =>
    e.correctionOf === src.id || (key && clean(e.idempotencyKey) === key));
  if (existing) return existing;

  // Route naar een OPEN periode: originele maand als die nog Open is, anders de
  // huidige/eerstvolgende open periode (latere correctie naar een volgende periode).
  const originalMonth = monthOf(counter.billableAt) || monthOf(nowIso());
  const originalPeriod = (store.list("usageBillingPeriods", src.tenantId) || []).find(p => p.period === originalMonth);
  const period = (originalPeriod && originalPeriod.status === "Open")
    ? originalPeriod
    : nextOpenPeriodFrom(store, src.tenantId, monthOf(nowIso()), actor);
  L.assertPeriodAcceptsEvents(period);

  const row = {
    id: id("uev"), ...counter, provider: src.provider || null, environment: src.environment || null,
    billingPeriodId: period.id, billable: true, createdAt: nowIso(), createdBy: actorEmail(actor),
  };
  store.insert("usageEvents", row);
  store.audit({ actor: actorEmail(actor), tenantId: src.tenantId, area: "peppol", action: "peppol_usage_corrected", detail: `${eventId} ${clean(reason)}` });
  return row;
}

// ── 5. Views · providerkost en marge zijn Super Admin-only ───────────────────

function isPeppolRow(e) { return e && L.PEPPOL_USAGE_TYPES.includes(e.usageType); }
function filterEvents(rows, f = {}) {
  return (rows || []).filter(e => {
    if (!isPeppolRow(e)) return false;
    if (f.companyId && e.companyId !== f.companyId) return false;
    if (f.usageType && e.usageType !== f.usageType) return false;
    if (f.provider && e.provider !== f.provider) return false;
    if (f.period && monthOf(e.billableAt) !== f.period) return false;
    if (f.tenantId && e.tenantId !== f.tenantId) return false;
    return true;
  });
}

/** Super Admin-lijst van usage events (inclusief providerkost + marge). */
function listUsageEvents(store, filters = {}) {
  return filterEvents(store.list("usageEvents", null), filters).map(L.superAdminUsageView);
}

/**
 * Super Admin-overzicht met KPI's (volume, omzet, providerkost, marge). Correcties
 * verrekenen netto. Filter op periode/tenant/onderneming/provider.
 */
function peppolUsageOverview(store, filters = {}) {
  const events = filterEvents(store.list("usageEvents", null), filters);
  let volume = 0, revenue = 0, providerCost = 0;
  for (const e of events) {
    const q = num(qtyOf(e));
    volume += q;
    revenue += q * num(e.customerUnitPrice);
    providerCost += q * num(e.providerUnitCost);
  }
  return {
    volume: L.round2(volume),
    revenue: L.round2(revenue),
    providerCost: L.round2(providerCost),
    margin: L.round2(revenue - providerCost),
    count: events.length,
    events: events.map(L.superAdminUsageView),
  };
}

/** Tenant-view: eigen usage events, GESTRIPT van providerkost/kostregel/marge. */
function listTenantPeppolUsage(store, tenantId, filters = {}) {
  return filterEvents(store.list("usageEvents", clean(tenantId)), { ...filters, tenantId: clean(tenantId) })
    .map(L.tenantUsageView);
}

/** Tenant-view: eigen aangerekend volume + bedrag (nooit providerkost of marge). */
function tenantChargedVolume(store, tenantId, filters = {}) {
  const events = filterEvents(store.list("usageEvents", clean(tenantId)), { ...filters, tenantId: clean(tenantId) });
  let volume = 0, amount = 0;
  for (const e of events) {
    const q = num(qtyOf(e));
    volume += q;
    amount += q * num(e.customerUnitPrice);
  }
  return { tenantId: clean(tenantId), volume: L.round2(volume), amount: L.round2(amount), count: events.length };
}

/** Super Admin-billing-lijnen (inclusief providerkost + marge). */
function listBillingLines(store, { tenantId = null, billingPeriodId = null } = {}) {
  return (store.list("usageBillingLines", tenantId) || [])
    .filter(l => !billingPeriodId || l.billingPeriodId === billingPeriodId);
}

/** Tenant-view van de eigen billing-lijnen (providerkost + marge gestript). */
function listTenantBillingLines(store, tenantId, { billingPeriodId = null } = {}) {
  return (store.list("usageBillingLines", clean(tenantId)) || [])
    .filter(l => l.tenantId === clean(tenantId) && (!billingPeriodId || l.billingPeriodId === billingPeriodId))
    .map(L.tenantBillingLineView);
}

module.exports = {
  PEPPOL_MODES, PEPPOL_OPERATIONAL_RIGHTS,
  // owner-mode / activatie
  activatePeppol, peppolActivation, monargoOwnsPeppol, tenantPeppolStatus,
  // pricing (Super Admin) · tarieven met vier-ogen (propose/approve)
  setPriceRule, proposePriceRule, approvePriceRule, setCostRule, listPriceRules, listCostRules, resolvePeppolPrice, resolvePeppolCost,
  // periodes
  openPeriod, ensureOpenPeriod, getPeriod, listPeriods, calculatePeriod, transitionPeriod, approvePeriod,
  // metering
  recordPeppolUsage, recordInvoiceUsage, correctPeppolUsage,
  // views
  listUsageEvents, peppolUsageOverview, listTenantPeppolUsage, tenantChargedVolume,
  listBillingLines, listTenantBillingLines,
};
