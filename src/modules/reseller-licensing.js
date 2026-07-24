"use strict";

// ── Reseller-licensing (spec 23.10) · licenties, pricing en uitzonderingen ───
// Store-gebonden servicelaag boven de pure lagen reseller-domain (statusmachine
// licenseRequest) en reseller-authz (scope, vier-ogen, anti-probing). Harde
// regels die deze laag afdwingt:
//  - een reseller wijzigt NOOIT de verkoopprijs of productcatalogus van het
//    platform · prijzen komen uitsluitend uit de centrale billingbron (CTO-09);
//  - resellerprijzen/kortingen zijn versieerbaar (immutable versies) met een
//    geldigheidsperiode en hangen aan contract of tier;
//  - prijsuitzonderingen worden APART goedgekeurd van commissies (geen dubbele
//    bevoordeling) en kennen een drempelapproval zonder self-approval;
//  - suspensie blokkeert elke nieuwe aanvraag (RESELLER_NOT_ACTIVE), maar
//    historische records blijven leesbaar via de lijst-helpers;
//  - aanvraag-payloads worden nooit overschreven: een statuswijziging raakt
//    alleen status, history en de approval-metadata.

const crypto = require("crypto");
const D = require("../platform/reseller-domain");
const A = require("../platform/reseller-authz");
const { round2 } = require("../platform/commission-ledger");
const { billingQuote, planPricing } = require("./billing");
const { getBundle } = require("./bundles");
const { gateableKeys } = require("./catalog");

const REQUESTS = "resellerLicenseRequests";
const EXCEPTIONS = "resellerPriceExceptions";
const AGREEMENTS = "resellerPriceAgreements";

const MACHINE = D.STATE_MACHINES.licenseRequest;

const LICENSE_REQUEST_KINDS = Object.freeze(["order", "seat_change", "plan_change", "trial_extension", "cancellation"]);
const TERMS = Object.freeze(["monthly", "annual"]);
const CANCELLATION_SCOPES = Object.freeze(["full", "modules", "seats"]);

// Beleidsdrempel (23.10): boven deze korting is een tweede, onafhankelijke
// goedkeuring vereist. Dit is een drempel, geen prijsconstante.
const PRICE_EXCEPTION_ESCALATION_PCT = 20;
// Maximum aantal trialverlengingen zonder uitzonderingsapproval (23.10).
const MAX_TRIAL_EXTENSIONS = 2;
// Statussen die tellen als een toegekende (of in uitvoering zijnde) aanvraag.
const GRANTED_STATUSES = Object.freeze(["approved", "scheduled", "applied"]);
const OPEN_STATUSES = Object.freeze(["draft", "submitted", "approved", "scheduled"]);
// Prijsvelden die een aanvrager nooit zelf mag aanleveren (CTO-09).
const FORBIDDEN_PRICE_KEYS = Object.freeze(["price", "listPrice", "list_price", "baseAnnual", "seatAnnual", "unitPrice", "priceOverride"]);
// Commissievelden die nooit met een prijsuitzondering meereizen (23.10:
// prijsuitzonderingen worden apart van commissies goedgekeurd).
const FORBIDDEN_COMMISSION_KEYS = Object.freeze(["commission", "commissionPct", "commission_pct", "commissionModel", "commission_model", "attributionPercent", "attribution_percent"]);

function id(prefix) { return `${prefix}_${crypto.randomBytes(9).toString("hex")}`; }
function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
function nowIso() { return new Date().toISOString(); }
function who(actor) { return (actor && actor.email) || "system"; }
function clean(v) { return String(v == null ? "" : v).trim(); }
function isBlank(v) { return clean(v) === ""; }
function isIsoDate(v) { return typeof v === "string" && !isBlank(v) && Number.isFinite(Date.parse(v)); }

/** Zit deze actor aan de resellerkant (portaal) of aan de Monargo-kant? */
function isResellerSide(actor) {
  return !!(actor && (actor.resellerId || actor.role === "reseller" || String(actor.resellerRole || "").startsWith("reseller_")));
}

function requestsOf(store, resellerId) {
  return (store.data[REQUESTS] || []).filter(r => r.resellerId === resellerId);
}
/**
 * Platformoverzicht van alle licentieaanvragen. Zonder resellerId is dit het
 * Monargo-brede beeld; met resellerId hetzelfde als requestsOf. Bestond eerder
 * als een rechtstreekse store.data-lees in de route · daar hoort het niet.
 */
function listRequests(store, { resellerId = null } = {}) {
  return resellerId ? requestsOf(store, resellerId) : (store.data[REQUESTS] || []);
}
function exceptionsOf(store, resellerId) {
  return (store.data[EXCEPTIONS] || []).filter(r => r.resellerId === resellerId);
}
/** Platformoverzicht van de prijsuitzonderingen · zonder filter: alles. */
function listExceptions(store, { resellerId = null } = {}) {
  return resellerId ? exceptionsOf(store, resellerId) : (store.data[EXCEPTIONS] || []);
}
function discountsOf(store, resellerId) {
  return (store.data[AGREEMENTS] || []).filter(r => r.resellerId === resellerId);
}

/**
 * Prijzen mogen nooit door de aanvrager worden aangeleverd: ze komen uit de
 * centrale billingbron (CTO-09). Dit blokkeert ook elke poging van een
 * reseller om via een orderpayload de verkoopprijs te beinvloeden.
 */
function assertNoPriceInput(payload) {
  for (const key of FORBIDDEN_PRICE_KEYS) {
    if (payload && payload[key] !== undefined) {
      throw err(400, "PRICE_INPUT_FORBIDDEN", "prijzen komen uitsluitend uit de centrale billingbron · prijsvelden zijn niet toegestaan in de aanvraag");
    }
  }
}

/** Alleen een Monargo-actor keurt goed of beheert prijzen/catalogus (23.10). */
function assertPlatformSide(actor, code) {
  if (isResellerSide(actor)) {
    throw err(403, code || "RESELLER_APPROVAL_FORBIDDEN", "deze actie gebeurt aan Monargo-zijde · een reseller wijzigt geen verkoopprijs of catalogus");
  }
}

/**
 * Gedeelde context-resolutie voor elke aanvraag:
 *  - resellerkant: eigen resellerId verplicht, expliciet vreemde resellerId is
 *    een harde scope-schending (nooit stil herfilteren), organisatie moet
 *    actief zijn (suspensie blokkeert nieuwe aanvragen, 23.4/23.14);
 *  - tenantkoppeling: een actief assignment-record is vereist (23.15) · een
 *    niet-toegewezen tenant leest byte-identiek als een onbestaande (ISO-07);
 *  - platformkant: optionele resellerId, maar ook dan moet die organisatie
 *    actief zijn (geen nieuwe aanvragen op gesuspendeerde partners).
 */
function resolveContext(store, tenantId, payload, actor) {
  const resellerSide = isResellerSide(actor);
  let resellerId = null;
  if (resellerSide) {
    if (!actor.resellerId) throw A.forbiddenError();
    if (payload && payload.resellerId && payload.resellerId !== actor.resellerId) throw A.scopeViolationError();
    resellerId = actor.resellerId;
    D.assertOrganizationActive(store.get("resellers", resellerId));
  } else if (payload && payload.resellerId) {
    resellerId = payload.resellerId;
    D.assertOrganizationActive(store.get("resellers", resellerId));
  }
  const tenant = tenantId ? store.get("tenants", tenantId) : null;
  if (resellerSide) {
    const links = store.data.resellerTenantLinks || [];
    if (!tenant || !A.tenantInScope(actor, tenantId, links)) throw A.notFoundError("tenant");
  }
  if (!tenant) throw A.notFoundError("tenant");
  return { resellerSide, resellerId, tenant };
}

/**
 * Centrale prijs voor een plan-key bij een gegeven seat-aantal, uit
 * billing.planPricing() (superadmin-bewerkbare bundelprijzen). Geen prijs
 * bekend = op aanvraag: null, en null is NIET nul (CTO2-09).
 */
function centralPricingFor(planKey, seats) {
  const entry = planPricing().find(p => p.key === planKey) || null;
  if (!entry || !(entry.baseAnnual > 0)) {
    return { unpriced: true, baseAnnual: null, seatAnnual: null, includedSeats: null, annual: null, monthly: null };
  }
  const extra = Math.max(0, seats - (entry.includedSeats || 0));
  const annual = entry.baseAnnual + (entry.seatAnnual || 0) * extra;
  return {
    unpriced: false, baseAnnual: entry.baseAnnual, seatAnnual: entry.seatAnnual,
    includedSeats: entry.includedSeats, annual: round2(annual), monthly: round2(annual / 12),
  };
}

/** Interne fabriek: elke aanvraag start als submitted licenseRequest-record. */
function newRequest(store, { kind, ctx, clientTenantId, payload, externalRef = null, auditAction, auditDetail }, actor) {
  const at = nowIso();
  const row = {
    id: id("lreq"), tenantId: null, kind,
    resellerId: ctx.resellerId, clientTenantId,
    status: "submitted", externalRef,
    payload, version: 1,
    history: [{ at, by: who(actor), from: MACHINE.initial, to: "submitted", reason: null }],
    createdAt: at, createdBy: who(actor),
    submittedAt: at, submittedBy: who(actor),
    approvedAt: null, approvedBy: null,
  };
  store.insert(REQUESTS, row);
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: auditAction, detail: auditDetail });
  return row;
}

// ── 23.10 · License order ────────────────────────────────────────────────────
// Alleen actieve catalogusitems; de order is idempotent: dezelfde externe
// referentie geeft dezelfde order terug en dupliceert niets.
function licenseOrder(store, payload, actor) {
  const { tenantId, plan, modules = [], seats, effectiveDate, term = "annual", externalRef } = payload || {};
  const ctx = resolveContext(store, tenantId, payload, actor);
  assertNoPriceInput(payload);
  if (isBlank(externalRef)) throw err(400, "EXTERNAL_REF_REQUIRED", "een externe referentie is verplicht voor een idempotente order");
  const ref = clean(externalRef);
  const planKey = String(plan || "").toLowerCase();

  const existing = (store.data[REQUESTS] || []).find(r => r.kind === "order" && r.externalRef === ref);
  if (existing) {
    const same = existing.clientTenantId === tenantId
      && existing.payload && existing.payload.plan === planKey
      && (existing.resellerId || null) === (ctx.resellerId || null);
    if (same) return existing; // replay: geen duplicaat, zelfde order terug
    throw err(409, "EXTERNAL_REF_CONFLICT", "deze externe referentie is al gebruikt voor een andere order");
  }

  const bundle = getBundle(store, planKey);
  if (!bundle) throw err(400, "PLAN_UNKNOWN", "onbekend plan · alleen catalogusbundels zijn bestelbaar");
  if (bundle.active === false) throw err(409, "CATALOG_ITEM_INACTIVE", "dit catalogusitem is niet actief en kan niet besteld worden");
  const valid = gateableKeys();
  for (const m of Array.isArray(modules) ? modules : []) {
    if (!valid.includes(m)) throw err(400, "MODULE_UNKNOWN", `onbekende module in de bestelling: ${m}`);
  }
  if (!Number.isInteger(seats) || seats < 0) throw err(400, "SEATS_INVALID", "seats moet een geheel getal van 0 of meer zijn");
  if (!isIsoDate(effectiveDate)) throw err(400, "DATE_INVALID", "effectiveDate is geen geldige datum");
  if (!TERMS.includes(term)) throw err(400, "TERM_INVALID", `term moet een van ${TERMS.join(", ")} zijn`);

  const pricing = centralPricingFor(planKey, seats);
  return newRequest(store, {
    kind: "order", ctx, clientTenantId: tenantId, externalRef: ref,
    payload: { plan: planKey, modules: [...(modules || [])], seats, effectiveDate, term, pricing },
    auditAction: "license_order_created",
    auditDetail: `${tenantId} ${planKey} seats=${seats} ref=${ref}`,
  }, actor);
}

// ── 23.10 · Seat change ──────────────────────────────────────────────────────
// Geen negatieve seats; audit van oude EN nieuwe waarde; proration-veld uit de
// centrale seatprijs (null bij op-aanvraag, dat is geen 0).
function seatChange(store, payload, actor) {
  const { tenantId, requestedSeats, effectiveDate, reason = null } = payload || {};
  const ctx = resolveContext(store, tenantId, payload, actor);
  assertNoPriceInput(payload);
  if (!Number.isInteger(requestedSeats)) throw err(400, "SEATS_INVALID", "requestedSeats moet een geheel getal zijn");
  if (requestedSeats < 0) throw err(400, "SEATS_NEGATIVE", "negatieve seats zijn niet toegestaan");
  if (!isIsoDate(effectiveDate)) throw err(400, "DATE_INVALID", "effectiveDate is geen geldige datum");

  const quote = billingQuote(store, ctx.tenant); // centrale bron voor huidige seats en seatprijs
  const currentSeats = quote.seats;
  if (requestedSeats === currentSeats) throw err(400, "SEATS_UNCHANGED", "het gevraagde aantal seats is gelijk aan het huidige aantal");
  const deltaSeats = requestedSeats - currentSeats;
  const proration = {
    currentSeats, requestedSeats, deltaSeats, effectiveDate,
    seatAnnual: quote.seatAnnual, // null = op aanvraag
    monthlyDelta: quote.seatAnnual == null ? null : round2(deltaSeats * quote.seatAnnual / 12),
  };
  return newRequest(store, {
    kind: "seat_change", ctx, clientTenantId: tenantId,
    payload: { currentSeats, requestedSeats, effectiveDate, proration, reason: clean(reason) || null },
    auditAction: "license_seat_change_requested",
    auditDetail: JSON.stringify({ tenant: tenantId, van: currentSeats, naar: requestedSeats }),
  }, actor);
}

// ── 23.10 · Upgrade/downgrade ────────────────────────────────────────────────
// Entitlement- en contractcontrole: het doelplan moet een actieve bundel zijn,
// het contract mag niet geannuleerd zijn en entitlementverlies (modules die
// wegvallen) vereist een expliciete bevestiging.
function upgradeDowngrade(store, payload, actor) {
  const { tenantId, toPlan, effectiveDate, term = null, confirmEntitlementLoss = false } = payload || {};
  const ctx = resolveContext(store, tenantId, payload, actor);
  assertNoPriceInput(payload);
  const fromKey = String(ctx.tenant.plan || "").toLowerCase();
  const toKey = String(toPlan || "").toLowerCase();
  if (!toKey) throw err(400, "PLAN_UNKNOWN", "doelplan is verplicht");
  if (toKey === fromKey) throw err(400, "PLAN_UNCHANGED", "het doelplan is gelijk aan het huidige plan");
  const toBundle = getBundle(store, toKey);
  if (!toBundle) throw err(400, "PLAN_UNKNOWN", "onbekend doelplan · alleen catalogusbundels zijn toegestaan");
  if (toBundle.active === false) throw err(409, "CATALOG_ITEM_INACTIVE", "het doelplan is geen actief catalogusitem");
  if (!isIsoDate(effectiveDate)) throw err(400, "DATE_INVALID", "effectiveDate is geen geldige datum");
  if (term != null && !TERMS.includes(term)) throw err(400, "TERM_INVALID", `term moet een van ${TERMS.join(", ")} zijn`);

  // Contractcontrole: op een geannuleerd contract wordt niet gewisseld.
  const contractStatus = ctx.tenant.billingStatus || ctx.tenant.status || "trial";
  if (contractStatus === "canceled") throw err(409, "CONTRACT_CANCELED", "het contract is geannuleerd · eerst heractiveren of een nieuwe order plaatsen");

  // Entitlementcontrole: welke modules vallen weg, welke komen erbij?
  const fromBundle = getBundle(store, fromKey);
  const fromModules = (fromBundle && fromBundle.modules) || [];
  const toModules = (toBundle && toBundle.modules) || [];
  const removed = fromModules.filter(m => !toModules.includes(m));
  const added = toModules.filter(m => !fromModules.includes(m));
  if (removed.length && !confirmEntitlementLoss) {
    const e = err(409, "ENTITLEMENT_LOSS_UNCONFIRMED", "bij deze wijziging vervallen modules · expliciete bevestiging vereist");
    e.removedModules = removed;
    throw e;
  }

  // Billingimpact uit de centrale prijzen, met de huidige seats.
  const quote = billingQuote(store, ctx.tenant);
  const from = centralPricingFor(fromKey, quote.seats);
  const to = centralPricingFor(toKey, quote.seats);
  const billingImpact = {
    seats: quote.seats,
    fromMonthly: from.monthly, toMonthly: to.monthly,
    deltaMonthly: (from.monthly == null || to.monthly == null) ? null : round2(to.monthly - from.monthly),
  };
  return newRequest(store, {
    kind: "plan_change", ctx, clientTenantId: tenantId,
    payload: {
      fromPlan: fromKey, toPlan: toKey, effectiveDate, term,
      entitlementDelta: { removed, added }, billingImpact,
    },
    auditAction: "license_plan_change_requested",
    auditDetail: JSON.stringify({ tenant: tenantId, van: fromKey, naar: toKey }),
  }, actor);
}

// ── 23.10 · Price exception ──────────────────────────────────────────────────
// Korting en marge worden berekend uit de centrale lijstprijs; boven de
// drempel is een tweede goedkeuring vereist; nooit self-approval; volledig
// losgekoppeld van commissies (geen dubbele bevoordeling).
function priceException(store, payload, actor) {
  const { tenantId, listPrice = null, requestedPrice, reason, expiry } = payload || {};
  const ctx = resolveContext(store, tenantId, payload, actor);
  for (const key of FORBIDDEN_COMMISSION_KEYS) {
    if (payload && payload[key] !== undefined) {
      throw err(400, "COMMISSION_COUPLING_FORBIDDEN", "een prijsuitzondering wijzigt nooit commissie · commissies worden apart goedgekeurd");
    }
  }
  const quote = billingQuote(store, ctx.tenant);
  if (quote.annualSubtotal == null) throw err(409, "PRICE_ON_REQUEST", "dit plan is op aanvraag geprijsd · er is geen lijstprijs om op af te wijken");
  const centralList = quote.annualSubtotal;
  // De aanvrager mag de lijstprijs meesturen als integriteitscheck, maar de
  // centrale billingbron is altijd leidend (CTO-09).
  if (listPrice != null && round2(Number(listPrice)) !== round2(centralList)) {
    throw err(409, "LIST_PRICE_MISMATCH", "de meegestuurde lijstprijs wijkt af van de centrale billingbron");
  }
  const price = Number(requestedPrice);
  if (!Number.isFinite(price) || price <= 0 || price > centralList) {
    throw err(400, "REQUESTED_PRICE_INVALID", "de gevraagde prijs moet groter dan 0 en hoogstens de lijstprijs zijn");
  }
  if (isBlank(reason)) throw err(400, "REASON_REQUIRED", "een reden is verplicht bij een prijsuitzondering");
  if (!isIsoDate(expiry) || Date.parse(expiry) <= Date.now()) {
    throw err(400, "EXPIRY_INVALID", "expiry moet een geldige datum in de toekomst zijn · een prijsuitzondering heeft altijd een geldigheidsperiode");
  }

  const discount = round2(centralList - price);
  const discountPct = round2((discount / centralList) * 100);
  const marginPct = round2(100 - discountPct);
  const escalated = discountPct > PRICE_EXCEPTION_ESCALATION_PCT;
  const at = nowIso();
  const row = {
    id: id("pex"), tenantId: null, resellerId: ctx.resellerId, clientTenantId: tenantId,
    listPrice: round2(centralList), requestedPrice: round2(price),
    discount, discountPct, marginPct,
    reason: clean(reason), expiry,
    escalated, requiredApprovals: escalated ? 2 : 1, approvals: [],
    status: "pending", version: 1,
    // 23.10: aparte goedkeuring van commissies · dit record raakt nooit
    // commission-events of -percentages.
    commissionDecoupled: true,
    createdAt: at, createdBy: who(actor), decidedAt: null,
  };
  store.insert(EXCEPTIONS, row);
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: "price_exception_requested",
    detail: JSON.stringify({ tenant: tenantId, lijst: row.listPrice, gevraagd: row.requestedPrice, kortingPct: discountPct }) });
  return row;
}

/** Goedkeuring van een prijsuitzondering · Monargo-zijde, nooit self-approval,
 *  boven de drempel twee verschillende goedkeurders. */
function approvePriceException(store, { exceptionId, note = null }, actor) {
  const ex = (store.data[EXCEPTIONS] || []).find(x => x.id === exceptionId);
  if (!ex) throw A.notFoundError("price_exception");
  assertPlatformSide(actor, "RESELLER_APPROVAL_FORBIDDEN");
  if (ex.status !== "pending") throw err(409, "PRICE_EXCEPTION_NOT_PENDING", "deze prijsuitzondering is niet meer in behandeling");
  if (Date.parse(ex.expiry) <= Date.now()) throw err(409, "PRICE_EXCEPTION_EXPIRED", "de geldigheidsperiode van deze prijsuitzondering is verstreken");
  A.assertNotSelfApproval(who(actor), ex.createdBy);
  const approvals = [...(ex.approvals || [])];
  if (approvals.some(a => String(a.by).toLowerCase() === who(actor).toLowerCase())) {
    throw err(409, "DUPLICATE_APPROVAL", "deze goedkeurder heeft al goedgekeurd · een tweede goedkeuring vereist een andere persoon");
  }
  approvals.push({ by: who(actor), at: nowIso(), note: clean(note) || null });
  const done = approvals.length >= ex.requiredApprovals;
  const next = store.update(EXCEPTIONS, ex.id, {
    approvals, status: done ? "approved" : "pending", decidedAt: done ? nowIso() : null,
  });
  store.audit({ actor: who(actor), tenantId: null, area: "resellers",
    action: done ? "price_exception_approved" : "price_exception_approval_added",
    detail: `${ex.id} (${approvals.length}/${ex.requiredApprovals})` });
  return next;
}

/** Afwijzing van een prijsuitzondering · Monargo-zijde, reden verplicht. */
function rejectPriceException(store, { exceptionId, reason }, actor) {
  const ex = (store.data[EXCEPTIONS] || []).find(x => x.id === exceptionId);
  if (!ex) throw A.notFoundError("price_exception");
  assertPlatformSide(actor, "RESELLER_APPROVAL_FORBIDDEN");
  if (ex.status !== "pending") throw err(409, "PRICE_EXCEPTION_NOT_PENDING", "deze prijsuitzondering is niet meer in behandeling");
  if (isBlank(reason)) throw err(400, "REASON_REQUIRED", "een reden is verplicht bij afwijzing");
  const next = store.update(EXCEPTIONS, ex.id, { status: "rejected", decidedAt: nowIso(), rejectReason: clean(reason) });
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: "price_exception_rejected", detail: `${ex.id} ${clean(reason)}` });
  return next;
}

// ── 23.10 · Trial extension ──────────────────────────────────────────────────
// Maximum aantal verlengingen; daarboven alleen via een expliciete
// uitzonderingsaanvraag; telt prior_extensions uit de historiek.
function trialExtension(store, payload, actor) {
  const { tenantId, newEnd, reason, exceptionRequested = false } = payload || {};
  const ctx = resolveContext(store, tenantId, payload, actor);
  assertNoPriceInput(payload);
  const originalEnd = ctx.tenant.trialEndsAt || null;
  if (!originalEnd) throw err(409, "NO_ACTIVE_TRIAL", "deze tenant heeft geen lopende proefperiode");
  if (!isIsoDate(newEnd) || Date.parse(newEnd) <= Date.parse(originalEnd)) {
    throw err(400, "TRIAL_END_INVALID", "de nieuwe einddatum moet een geldige datum na de huidige einddatum zijn");
  }
  if (isBlank(reason)) throw err(400, "REASON_REQUIRED", "een reden is verplicht bij een trialverlenging");
  const priorExtensions = (store.data[REQUESTS] || []).filter(r =>
    r.kind === "trial_extension" && r.clientTenantId === tenantId && GRANTED_STATUSES.includes(r.status)).length;
  const exception = priorExtensions >= MAX_TRIAL_EXTENSIONS;
  if (exception && !exceptionRequested) {
    throw err(409, "TRIAL_EXTENSION_LIMIT", `het maximum van ${MAX_TRIAL_EXTENSIONS} verlengingen is bereikt · alleen via een uitzonderingsaanvraag`);
  }
  return newRequest(store, {
    kind: "trial_extension", ctx, clientTenantId: tenantId,
    payload: { originalEnd, newEnd, reason: clean(reason), priorExtensions, exception },
    auditAction: "trial_extension_requested",
    auditDetail: JSON.stringify({ tenant: tenantId, van: originalEnd, naar: newEnd, eerdere: priorExtensions, uitzondering: exception }),
  }, actor);
}

// ── 23.10 · Cancellation ─────────────────────────────────────────────────────
// Scope, datum, reden, data-export en einde toegang zijn expliciet; contract
// en retentie worden gerespecteerd (einde toegang nooit voor de stopdatum).
function cancellation(store, payload, actor) {
  const { tenantId, scope, date, reason, dataExport, accessEnd } = payload || {};
  const ctx = resolveContext(store, tenantId, payload, actor);
  assertNoPriceInput(payload);
  if (!CANCELLATION_SCOPES.includes(scope)) throw err(400, "CANCELLATION_SCOPE_INVALID", `scope moet een van ${CANCELLATION_SCOPES.join(", ")} zijn`);
  if (!isIsoDate(date)) throw err(400, "DATE_INVALID", "de stopdatum is geen geldige datum");
  if (typeof dataExport !== "boolean") throw err(400, "DATA_EXPORT_DECISION_REQUIRED", "de keuze voor data-export moet expliciet true of false zijn");
  if (!isIsoDate(accessEnd) || Date.parse(accessEnd) < Date.parse(date)) {
    throw err(400, "ACCESS_END_INVALID", "einde toegang moet een geldige datum op of na de stopdatum zijn (retentie)");
  }
  if (isBlank(reason)) throw err(400, "REASON_REQUIRED", "een reden is verplicht bij een opzegging");
  const contractStatus = ctx.tenant.billingStatus || ctx.tenant.status || "trial";
  if (contractStatus === "canceled") throw err(409, "ALREADY_CANCELED", "het contract is al geannuleerd");
  const open = (store.data[REQUESTS] || []).some(r =>
    r.kind === "cancellation" && r.clientTenantId === tenantId && OPEN_STATUSES.includes(r.status));
  if (open) throw err(409, "CANCELLATION_ALREADY_OPEN", "er loopt al een opzegging voor deze tenant");
  return newRequest(store, {
    kind: "cancellation", ctx, clientTenantId: tenantId,
    payload: {
      scope, date, reason: clean(reason),
      retention: { dataExportRequested: dataExport, accessEndAt: accessEnd },
    },
    auditAction: "license_cancellation_requested",
    auditDetail: JSON.stringify({ tenant: tenantId, scope, datum: date, export: dataExport, toegangTot: accessEnd }),
  }, actor);
}

// ── Statusmachine licenseRequest (23.14) ─────────────────────────────────────
// draft → submitted → approved → scheduled → applied → failed/canceled.
// Goedkeuring en uitvoering gebeuren aan Monargo-zijde; goedkeurder en
// indiener moeten verschillen (geen self-approval, DoD-6).
function transitionLicenseRequest(store, { requestId, to, reason = null }, actor) {
  const req = (store.data[REQUESTS] || []).find(r => r.id === requestId);
  const resellerSide = isResellerSide(actor);
  // Anti-probing: een vreemd record leest byte-identiek als een onbestaand.
  if (!req || (resellerSide && req.resellerId !== actor.resellerId)) throw A.notFoundError("license_request");
  if (resellerSide) {
    D.assertOrganizationActive(store.get("resellers", actor.resellerId));
    if (to !== "submitted") {
      throw err(403, "RESELLER_APPROVAL_FORBIDDEN", "goedkeuring en uitvoering van licentieaanvragen gebeuren aan Monargo-zijde");
    }
  }
  MACHINE.assertTransition(req.status, to);
  if (req.status === to) return req; // no-op, zelfde semantiek als de machine

  const patch = {
    status: to,
    history: [...(req.history || []), { at: nowIso(), by: who(actor), from: req.status, to, reason: clean(reason) || null }],
  };
  if (to === "approved") {
    A.assertNotSelfApproval(who(actor), req.submittedBy || req.createdBy);
    // DoD-6: goedkeuring vereist dat de catalogusversie nog geldig is.
    const planKey = req.kind === "order" ? req.payload.plan : req.kind === "plan_change" ? req.payload.toPlan : null;
    if (planKey) {
      const bundle = getBundle(store, planKey);
      if (!bundle || bundle.active === false) throw err(409, "CATALOG_ITEM_INACTIVE", "het plan is geen actief catalogusitem meer · aanvraag kan niet worden goedgekeurd");
    }
    patch.approvedBy = who(actor); patch.approvedAt = nowIso();
  }
  if (to === "failed" || to === "canceled") patch.closedReason = clean(reason) || null;
  const next = store.update(REQUESTS, requestId, patch);
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: `license_request_${to}`,
    detail: `${req.id} ${req.kind} ${req.status}->${to}` });
  return next;
}

// ── Versieerbare resellerprijzen/kortingen (23.10) ───────────────────────────
// Alleen Monargo beheert deze; versies zijn immutable (nieuwe versie i.p.v.
// overschrijven), hebben een geldigheidsperiode en hangen aan contract of tier.
function setResellerDiscount(store, payload, actor) {
  const { resellerId, tier = null, contractRef = null, discountPct, validFrom, validUntil } = payload || {};
  assertPlatformSide(actor, "CATALOG_CHANGE_FORBIDDEN");
  const reseller = store.get("resellers", resellerId);
  if (!reseller) throw err(404, "RESELLER_NOT_FOUND", "resellerorganisatie niet gevonden");
  const pct = Number(discountPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw err(400, "DISCOUNT_INVALID", "discountPct moet tussen 0 en 100 liggen");
  if (!isIsoDate(validFrom) || !isIsoDate(validUntil) || Date.parse(validFrom) >= Date.parse(validUntil)) {
    throw err(400, "VALIDITY_INVALID", "een geldigheidsperiode (validFrom voor validUntil) is verplicht");
  }
  if (isBlank(tier) && isBlank(contractRef)) {
    throw err(400, "CONTRACT_OR_TIER_REQUIRED", "een resellerkorting hangt aan een contract of tier");
  }
  const version = discountsOf(store, resellerId).reduce((max, r) => Math.max(max, r.version || 0), 0) + 1;
  const row = {
    id: id("rpa"), tenantId: null, resellerId,
    version, discountPct: round2(pct),
    tier: clean(tier) || null, contractRef: clean(contractRef) || null,
    validFrom, validUntil,
    createdAt: nowIso(), createdBy: who(actor),
  };
  store.insert(AGREEMENTS, row);
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: "reseller_discount_versioned",
    detail: JSON.stringify({ resellerId, versie: version, pct: row.discountPct, van: validFrom, tot: validUntil }) });
  return row;
}

/** Actieve kortingsversie voor een reseller op een moment: binnen de
 *  geldigheidsperiode, hoogste versie wint. Geen versie = null (lijstprijs). */
function resellerDiscountFor(store, resellerId, at) {
  const atMs = at == null ? Date.now() : (typeof at === "number" ? at : Date.parse(at));
  return discountsOf(store, resellerId)
    .filter(r => Date.parse(r.validFrom) <= atMs && atMs < Date.parse(r.validUntil))
    .sort((a, b) => (b.version || 0) - (a.version || 0))[0] || null;
}

module.exports = {
  // constanten
  LICENSE_REQUEST_KINDS, TERMS, CANCELLATION_SCOPES,
  PRICE_EXCEPTION_ESCALATION_PCT, MAX_TRIAL_EXTENSIONS,
  FORBIDDEN_PRICE_KEYS, FORBIDDEN_COMMISSION_KEYS,
  // aanvragen (23.10)
  licenseOrder, seatChange, upgradeDowngrade, trialExtension, cancellation,
  transitionLicenseRequest,
  // prijsuitzonderingen (drempel + vier-ogen, los van commissies)
  priceException, approvePriceException, rejectPriceException,
  // versieerbare resellerkortingen (alleen Monargo)
  setResellerDiscount, resellerDiscountFor,
  // leeshelpers voor portaal en admin
  requestsOf, listRequests, exceptionsOf, listExceptions, discountsOf,
  // guards (herbruikbaar in routes)
  isResellerSide, assertNoPriceInput, centralPricingFor,
};
