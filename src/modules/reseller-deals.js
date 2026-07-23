"use strict";

// ── Reseller-deals · dealregistratie en commerciele attributie (spec 23.8) ───
// Store-gebonden servicelaag bovenop de pure lagen:
//  - src/platform/reseller-domain.js · statusmachine "deal" (23.14) en
//    assertOrganizationActive (suspensieregel 23.4);
//  - src/platform/reseller-authz.js · rechten/scopes (grantFor), vier-ogen
//    (assertNotSelfApproval) en anti-probing-fouten (notFoundError).
//
// Harde regels die deze module afdwingt (23.8/23.15):
//  - reseller_id wordt AFGELEID uit de ingelogde reseller en is niet
//    wijzigbaar · een expliciet vreemde resellerId is een harde 403-weigering,
//    nooit stil herfilteren;
//  - source_evidence is verplicht en gestructureerd (e-mail, meeting,
//    referral-context of document) · een claim op enkel vrije tekst is
//    ongeldig;
//  - dubbele claims worden NOOIT automatisch op "first click" toegekend:
//    een botsing (vat-nummer of prospect+land) opent een conflict_case met
//    beide claims · de beoordeling is een menselijke beslissing met reden;
//  - een dealclaim geeft NOOIT recht op klantdata of een tenant: deze module
//    schrijft geen tenantkoppelingen, toegangs- of delegatierecords, ook niet
//    bij conversie · alleen expliciete assignment-/delegatierecords (aparte
//    collecties, aparte goedkeuring) geven ooit toegang;
//  - elke mutatie schrijft audit met actor, timestamp, reden en before/after
//    (compact JSON in detail · house style, zie audit-log.js-truncatie);
//  - mutable velden lopen via optimistic locking: body-carried expectedVersion
//    en een 409 VERSION_CONFLICT met currentVersion (huisconventie /api).

const crypto = require("crypto");
const D = require("../platform/reseller-domain");
const A = require("../platform/reseller-authz");

// Geldigheidsduur van een claim (23.8: "claim heeft beperkte geldigheidsduur").
// Bij acceptatie start een NIEUW venster: de geldigheidsperiode voor conversie.
const DEFAULT_CLAIM_VALIDITY_DAYS = 90;

// Toegelaten bewijsvormen (23.8 · source_evidence).
const EVIDENCE_TYPES = Object.freeze(["email", "meeting", "referral", "document"]);

// Statussen die meetellen bij deduplicatie: open claims + bestaand account
// (23.8: "bij dubbele claim of bestaand account"). Rejected/expired blokkeren niet.
const COLLISION_STATUSES = Object.freeze(["submitted", "under_review", "accepted", "converted"]);

// Niet-terminale statussen waarvoor de expiry-sweep geldt. De claimtermijn
// loopt vanaf registratie (23.8), dus ook een claim die nooit beoordeeld werd
// verloopt · de 23.14-machine beschrijft de handmatige workflowstappen, de
// sweep is de systeemtimeout op elke open claim.
const OPEN_STATUSES = Object.freeze(["draft", "submitted", "under_review", "accepted"]);

// Velden die in de audit-snapshot (before/after) meegaan · bewust compact
// zodat de detail-string onder de 1000-tekens-truncatie blijft.
const AUDIT_FIELDS = Object.freeze([
  "status", "attributionPercent", "rejectionReason", "expiryAt", "conflictCaseId", "conversion",
]);

// ── Hulpjes ──────────────────────────────────────────────────────────────────
function id(prefix) { return `${prefix}_${crypto.randomBytes(9).toString("hex")}`; }
function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
function nowIso() { return new Date().toISOString(); }
function who(actor) { return (actor && actor.email) || "system"; }
function isBlank(v) { return v == null || (typeof v === "string" && v.trim() === ""); }
function clean(v) { return String(v == null ? "" : v).trim(); }
function toMs(now) {
  if (now == null) return Date.now();
  if (now instanceof Date) return now.getTime();
  return typeof now === "number" ? now : Date.parse(now);
}
function isoPlusDays(fromMs, days) { return new Date(fromMs + days * 86400000).toISOString(); }

function dealsColl(store) { return store.data.resellerDeals || []; }
function findDeal(store, dealId) { return dealsColl(store).find(d => d.id === dealId) || null; }

/**
 * Anti-probing (23.15/ISO-07 · CTO2-01). Een reseller-side actor die NIET de
 * eigenaar van de deal is, krijgt exact dezelfde 404 als bij een onbestaand
 * dealId · ongeacht welke actie of overgang hij vroeg. Zonder deze guard
 * verraadt het verschil tussen 403 (bestaat, geen recht) en 404 (bestaat niet)
 * de id-ruimte van andermans claims. Monargo-zijde (geen eigen resellerId)
 * raakt deze guard niet.
 */
function assertDealVisible(deal, actor) {
  if (actor && actor.resellerId && deal.resellerId !== actor.resellerId) {
    throw A.notFoundError("deal");
  }
  return deal;
}

function snapshot(deal) {
  if (!deal) return null;
  const out = {};
  for (const f of AUDIT_FIELDS) { if (deal[f] !== undefined) out[f] = deal[f]; }
  return out;
}

/** Audit met actor, timestamp (appendAudit zet at), reden en before/after. */
function auditDeal(store, action, actor, deal, { before = null, after = null, reason = null } = {}) {
  store.audit({
    actor: who(actor), tenantId: null, area: "resellers", action,
    detail: JSON.stringify({ dealId: deal.id, resellerId: deal.resellerId, reason, before, after }),
  });
}

/** Optimistic locking · huisconventie: body-carried expectedVersion. */
function assertVersion(deal, expectedVersion) {
  if (expectedVersion == null) return;
  const current = deal.version || 1;
  if (Number(expectedVersion) !== current) {
    const e = err(409, "VERSION_CONFLICT", "de deal is intussen gewijzigd · herlaad en probeer opnieuw");
    e.currentVersion = current;
    throw e;
  }
}

/** Gedeelde mutatie: patch + versie-increment + audit met before/after. */
function applyPatch(store, deal, patch, actor, action, reason = null) {
  const before = snapshot(deal);
  const next = store.update("resellerDeals", deal.id, {
    ...patch,
    version: (deal.version || 1) + 1,
    updatedAt: nowIso(), updatedBy: who(actor),
  });
  auditDeal(store, action, actor, next, { before, after: snapshot(next), reason });
  return next;
}

/** Is de claim voorbij zijn geldigheidsduur? */
function claimExpired(deal, now) {
  return Boolean(deal.expiryAt) && Date.parse(deal.expiryAt) <= toMs(now);
}

// ── Deduplicatie (23.8) ──────────────────────────────────────────────────────
// Sterke sleutel: enterprise/vat-nummer. Zachte sleutel: prospect_company+land,
// genormaliseerd (hoofdletters/spaties tellen niet).
function normVat(v) { return clean(v).toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function normCompany(v) { return clean(v).toLowerCase().replace(/\s+/g, " "); }
function normCountry(v) { return clean(v).toUpperCase(); }

function findCollisions(store, { vat, company, country }, excludeDealId = null) {
  return dealsColl(store).filter(d => {
    if (d.id === excludeDealId) return false;
    if (!COLLISION_STATUSES.includes(d.status)) return false;
    if (vat && normVat(d.enterpriseOrVatNumber) === vat) return true;
    return Boolean(company && country
      && normCompany(d.prospectCompany) === company
      && normCountry(d.prospectCountry) === country);
  });
}

/**
 * Open (of hergebruik) een conflict_case voor een dedup-botsing. GEEN
 * automatische toekenning: alle claims blijven in hun eigen workflow staan
 * tot een mens met reden beslist (accept/reject).
 */
function openConflictCase(store, collisions, newDeal, matchReason, actor) {
  let existing = null;
  for (const d of collisions) {
    if (!d.conflictCaseId) continue;
    const c = (store.data.resellerDealConflicts || []).find(x => x.id === d.conflictCaseId && x.status === "open");
    if (c) { existing = c; break; }
  }
  let theCase;
  if (existing) {
    const ids = Array.from(new Set([...(existing.dealIds || []), ...collisions.map(d => d.id), newDeal.id]));
    theCase = store.update("resellerDealConflicts", existing.id, { dealIds: ids, updatedAt: nowIso() });
  } else {
    theCase = {
      id: id("cfl"), tenantId: null, status: "open", matchReason,
      dealIds: [...collisions.map(d => d.id), newDeal.id],
      createdAt: nowIso(), createdBy: who(actor), resolvedAt: null, resolution: null,
    };
    store.insert("resellerDealConflicts", theCase);
  }
  // Botsende claims zonder verwijzing krijgen de case-id (metadata, geen oordeel).
  for (const d of collisions) {
    if (!d.conflictCaseId) store.update("resellerDeals", d.id, { conflictCaseId: theCase.id, version: (d.version || 1) + 1 });
  }
  store.audit({
    actor: who(actor), tenantId: null, area: "resellers", action: "deal_conflict_opened",
    detail: JSON.stringify({ conflictCaseId: theCase.id, matchReason, dealIds: theCase.dealIds, reason: "dedup-botsing · geen automatische toekenning" }),
  });
  return theCase;
}

// ── Validatie registratie (23.8-veldtabel) ───────────────────────────────────
function validateEvidence(sourceEvidence) {
  if (sourceEvidence == null || (typeof sourceEvidence === "object" && !Array.isArray(sourceEvidence) && Object.keys(sourceEvidence).length === 0)) {
    throw err(400, "DEAL_EVIDENCE_REQUIRED", "source_evidence is verplicht: e-mail, meeting, referral-context of document");
  }
  // Enkel vrije tekst is een ongeldige claimbasis (23.8).
  if (typeof sourceEvidence !== "object" || Array.isArray(sourceEvidence)) {
    throw err(400, "DEAL_EVIDENCE_INVALID", "source_evidence op enkel vrije tekst is ongeldig · lever gestructureerd bewijs {type, reference}");
  }
  const type = clean(sourceEvidence.type).toLowerCase();
  if (!EVIDENCE_TYPES.includes(type)) {
    throw err(400, "DEAL_EVIDENCE_INVALID", `source_evidence.type moet een van ${EVIDENCE_TYPES.join(", ")} zijn`);
  }
  if (isBlank(sourceEvidence.reference)) {
    throw err(400, "DEAL_EVIDENCE_INVALID", "source_evidence.reference is verplicht (mail-id, meetingverslag, referral of documentreferentie)");
  }
  return { type, reference: clean(sourceEvidence.reference), description: clean(sourceEvidence.description) || null };
}

function validateCommercials({ estimatedValue, currency, products }) {
  let value = null, cur = null;
  if (estimatedValue != null) {
    if (typeof estimatedValue !== "number" || !Number.isFinite(estimatedValue) || estimatedValue < 0) {
      throw err(400, "DEAL_VALUE_INVALID", "estimated_value moet een niet-negatief getal zijn");
    }
    value = estimatedValue;
    if (isBlank(currency)) throw err(400, "DEAL_CURRENCY_INVALID", "currency is verplicht bij estimated_value");
  }
  if (!isBlank(currency)) {
    cur = clean(currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) throw err(400, "DEAL_CURRENCY_INVALID", "currency moet een geldige drieletter-valutacode zijn");
  }
  let prods = [];
  if (products != null) {
    if (!Array.isArray(products) || products.some(p => isBlank(p))) {
      throw err(400, "DEAL_PRODUCTS_INVALID", "products moet een lijst van niet-lege catalogusitems zijn");
    }
    prods = products.map(clean);
  }
  return { estimatedValue: value, currency: cur, products: prods };
}

// ── Kernfuncties ─────────────────────────────────────────────────────────────

/**
 * Registreer een dealclaim (23.8). reseller_id wordt afgeleid uit de
 * ingelogde reseller; een expliciet afwijkende resellerId is een harde
 * weigering. Alleen Monargo-zijde (scope all, geen eigen resellerId) mag
 * namens een partner registreren en moet dan resellerId meegeven.
 *
 * payload.draft === true slaat de claim op als "draft" (de beginstatus van de
 * 23.14-machine) in plaats van meteen in te dienen. Indienen gebeurt dan als
 * aparte stap via transitionDeal(to: "submitted"). Validatie, dedup en de
 * claimtermijn gelden onverkort: de termijn loopt vanaf REGISTRATIE (23.8),
 * ook voor een claim die nog in draft staat. Zonder de vlag blijft de
 * beginstatus "submitted" · bestaande callers wijzigen niet van gedrag.
 */
function registerDeal(store, payload = {}, actor) {
  const scope = A.grantFor(actor, "reseller.deals.create");
  if (!scope) throw A.forbiddenError();

  // reseller_id: afgeleid, niet wijzigbaar (23.8).
  let resellerId;
  if (actor && actor.resellerId) {
    if (!isBlank(payload.resellerId) && clean(payload.resellerId) !== actor.resellerId) {
      throw A.scopeViolationError();
    }
    resellerId = actor.resellerId;
  } else if (scope === "all") {
    resellerId = clean(payload.resellerId);
    if (!resellerId) throw err(400, "RESELLER_ID_REQUIRED", "resellerId is verplicht bij registratie namens een partner");
  } else {
    throw A.forbiddenError();
  }

  // Organisatie moet bestaan en actief zijn · suspensie blokkeert nieuwe deals (23.4).
  D.assertOrganizationActive(store.get("resellers", resellerId));

  const prospectCompany = clean(payload.prospectCompany);
  const prospectCountry = clean(payload.country || payload.prospectCountry);
  if (!prospectCompany || !prospectCountry) {
    throw err(400, "DEAL_PROSPECT_REQUIRED", "prospect_company met naam en land is verplicht (deduplicatiesleutel)");
  }
  const sourceEvidence = validateEvidence(payload.sourceEvidence);
  const commercials = validateCommercials(payload);

  // Deduplicatie: sterke sleutel (vat) en zachte sleutel (naam+land).
  const keys = {
    vat: normVat(payload.enterpriseOrVatNumber) || null,
    company: normCompany(prospectCompany),
    country: normCountry(prospectCountry),
  };
  const collisions = findCollisions(store, keys);
  const ownDuplicates = collisions.filter(d => d.resellerId === resellerId);
  if (ownDuplicates.length) {
    throw err(409, "DEAL_DUPLICATE", "er loopt al een claim van deze reseller op deze prospect");
  }

  const nowMs = Date.now();
  const deal = {
    id: id("deal"), tenantId: null, resellerId,
    prospectCompany, prospectCountry,
    enterpriseOrVatNumber: isBlank(payload.enterpriseOrVatNumber) ? null : clean(payload.enterpriseOrVatNumber),
    primaryContact: isBlank(payload.primaryContact) ? null : payload.primaryContact,
    sourceEvidence,
    estimatedValue: commercials.estimatedValue, currency: commercials.currency, products: commercials.products,
    status: payload.draft === true ? D.deal.initial : "submitted",
    registeredAt: new Date(nowMs).toISOString(),
    expiryAt: isoPlusDays(nowMs, DEFAULT_CLAIM_VALIDITY_DAYS),
    rejectionReason: null,
    attributionPercent: null, attribution: null,
    conflictCaseId: null,
    conversion: null, convertedAt: null,
    acceptedAt: null, acceptedBy: null, expiredAt: null,
    createdAt: new Date(nowMs).toISOString(), createdBy: who(actor),
    version: 1,
  };

  const foreign = collisions.filter(d => d.resellerId !== resellerId);
  if (foreign.length) {
    const matchReason = keys.vat && foreign.some(d => normVat(d.enterpriseOrVatNumber) === keys.vat)
      ? "vat_match" : "company_country_match";
    const theCase = openConflictCase(store, foreign, deal, matchReason, actor);
    deal.conflictCaseId = theCase.id;
  }

  store.insert("resellerDeals", deal);
  auditDeal(store, "deal_registered", actor, deal, {
    before: null,
    after: snapshot(deal),
    reason: deal.status === "draft"
      ? "dealregistratie als concept · nog niet ingediend"
      : "dealregistratie en claim op commerciele oorsprong",
  });
  return deal;
}

/**
 * Workflow-overgang volgens de 23.14-machine. Beoordelingsstappen
 * (under_review/accepted/rejected/expired) zijn Monargo-zijde en vereisen
 * reseller.deals.approve; accepteren is een vier-ogenbeslissing.
 */
function transitionDeal(store, { dealId, to, reason = null, expectedVersion = null, now = null } = {}, actor) {
  const deal = findDeal(store, dealId);
  if (!deal) throw A.notFoundError("deal");
  // Eigenaarschap VOOR elke andere check: een vreemde deal is voor een
  // reseller-side actor niet te onderscheiden van een onbestaande deal, ook
  // niet via de foutcode van een ongeldige `to` (DEAL_USE_CONVERT, 403 op de
  // approve-grant of een machinefout).
  assertDealVisible(deal, actor);
  if (to === "converted") throw err(400, "DEAL_USE_CONVERT", "gebruik convertDeal voor een traceerbare conversie");

  if (to === "submitted") {
    // Indienen van een draft: alleen de eigen reseller met deals.create.
    const scope = A.grantFor(actor, "reseller.deals.create");
    if (!scope) throw A.forbiddenError();
    if (scope !== "all" && (!actor || actor.resellerId !== deal.resellerId)) throw A.notFoundError("deal");
    D.assertOrganizationActive(store.get("resellers", deal.resellerId));
  } else {
    if (!A.grantFor(actor, "reseller.deals.approve")) throw A.forbiddenError();
  }

  assertVersion(deal, expectedVersion);
  D.deal.assertTransition(deal.status, to);
  if (deal.status === to) return deal; // no-op, zelfde semantiek als de machine

  const patch = { status: to };
  if (to === "rejected") {
    if (isBlank(reason)) throw err(400, "DEAL_REJECTION_REASON_REQUIRED", "rejection_reason is verplicht bij afwijzing");
    patch.rejectionReason = clean(reason);
  }
  if (to === "accepted") {
    if (claimExpired(deal, now)) throw err(409, "DEAL_CLAIM_EXPIRED", "de claim is verlopen en kan niet meer aanvaard worden");
    // Vier-ogen op de dealclaim (23.5/23.8): goedkeurder != indiener.
    A.assertNotSelfApproval(who(actor), deal.createdBy);
    // Open conflict: geen toekenning zonder gedocumenteerde beoordeling (23.8).
    if (deal.conflictCaseId) {
      const c = store.get("resellerDealConflicts", deal.conflictCaseId);
      if (c && c.status === "open") {
        if (isBlank(reason)) {
          throw err(400, "DEAL_CONFLICT_REASON_REQUIRED", "acceptatie bij een open conflict_case vereist een gedocumenteerde reden (bewijs/contractregels/bestaande relatie)");
        }
        store.update("resellerDealConflicts", c.id, {
          status: "resolved", resolvedAt: nowIso(),
          resolution: { wonDealId: deal.id, reason: clean(reason), resolvedBy: who(actor) },
        });
        store.audit({
          actor: who(actor), tenantId: null, area: "resellers", action: "deal_conflict_resolved",
          detail: JSON.stringify({ conflictCaseId: c.id, wonDealId: deal.id, reason: clean(reason) }),
        });
      }
    }
    patch.acceptedAt = nowIso();
    patch.acceptedBy = who(actor);
    // Een aanvaarde deal krijgt een geldigheidsperiode voor conversie (23.8).
    patch.expiryAt = isoPlusDays(toMs(now), DEFAULT_CLAIM_VALIDITY_DAYS);
  }
  if (to === "expired") patch.expiredAt = nowIso();

  return applyPatch(store, deal, patch, actor, `deal_status_${to}`, isBlank(reason) ? null : clean(reason));
}

/**
 * Attributiepercentage (23.8): 0-100, vier-ogencontrole, nooit self-approval,
 * altijd met reden. Alleen zinvol tijdens beoordeling of na acceptatie.
 */
function setAttribution(store, { dealId, attributionPercent, reason = null, expectedVersion = null } = {}, actor) {
  const deal = findDeal(store, dealId);
  if (!deal) throw A.notFoundError("deal");
  assertDealVisible(deal, actor); // zelfde anti-probing als transitionDeal
  if (!A.grantFor(actor, "reseller.deals.approve")) throw A.forbiddenError();
  assertVersion(deal, expectedVersion);
  if (!["under_review", "accepted"].includes(deal.status)) {
    throw err(409, "DEAL_ATTRIBUTION_STATE", "attributie kan alleen tijdens beoordeling of na acceptatie gezet worden");
  }
  if (typeof attributionPercent !== "number" || !Number.isFinite(attributionPercent)
    || attributionPercent < 0 || attributionPercent > 100) {
    throw err(400, "DEAL_ATTRIBUTION_INVALID", "attribution_percent moet een getal tussen 0 en 100 zijn");
  }
  if (isBlank(reason)) throw err(400, "DEAL_ATTRIBUTION_REASON_REQUIRED", "een reden is verplicht bij het zetten van attributie");
  // Vier-ogen (23.8): de indiener van de claim mag zijn eigen attributie niet goedkeuren.
  A.assertNotSelfApproval(who(actor), deal.createdBy);

  return applyPatch(store, deal, {
    attributionPercent,
    attribution: {
      percent: attributionPercent, reason: clean(reason),
      setBy: who(actor), setAt: nowIso(), previousPercent: deal.attributionPercent,
    },
  }, actor, "deal_attribution_set", clean(reason));
}

/**
 * Systeemsweep (23.8): elke open claim voorbij expiry_at wordt expired.
 * De claimtermijn loopt vanaf registratie en geldt dus ook voor claims die
 * nog niet beoordeeld zijn · idempotent, audit per deal.
 *
 * De sweep gaat NIET om de statusmachine heen: de machine kent sinds de
 * bewuste 23.8-verruiming ook draft/submitted/under_review → expired (zie
 * reseller-domain.js). assertTransition blijft dus de enige plek die een
 * ongeldige overgang laat gooien · een status buiten het model faalt hier hard
 * in plaats van stil doorgepatcht te worden.
 */
function expireDeals(store, now = new Date()) {
  const nowMs = toMs(now);
  const expired = [];
  for (const deal of dealsColl(store)) {
    if (!OPEN_STATUSES.includes(deal.status)) continue;
    if (!deal.expiryAt || Date.parse(deal.expiryAt) > nowMs) continue;
    D.deal.assertTransition(deal.status, "expired");
    const next = applyPatch(store, deal, { status: "expired", expiredAt: nowIso() }, null,
      "deal_expired", "geldigheidsduur van de claim verstreken");
    expired.push(next.id);
  }
  return { expired: expired.length, dealIds: expired };
}

/**
 * Traceerbare conversie (23.8): aanvaarde deal wordt gekoppeld aan klant,
 * tenant en (optioneel) abonnement. BEWUST: er wordt hier GEEN tenantkoppeling,
 * assignment of toegangsrecord geschreven · een dealclaim geeft nooit recht op
 * klantdata of een tenant; dat vergt aparte records met eigen goedkeuring.
 */
function convertDeal(store, { dealId, customerId, tenantId, subscriptionId = null, reason = null, expectedVersion = null, now = null } = {}, actor) {
  const deal = findDeal(store, dealId);
  if (!deal) throw A.notFoundError("deal");
  assertDealVisible(deal, actor); // zelfde anti-probing als transitionDeal
  if (!A.grantFor(actor, "reseller.deals.approve")) throw A.forbiddenError();
  assertVersion(deal, expectedVersion);
  D.deal.assertTransition(deal.status, "converted");
  if (claimExpired(deal, now)) throw err(409, "DEAL_CLAIM_EXPIRED", "de claim is verlopen en kan niet meer geconverteerd worden");
  if (isBlank(customerId) || isBlank(tenantId)) {
    throw err(400, "DEAL_CONVERSION_TARGET_REQUIRED", "customerId en tenantId zijn verplicht voor een traceerbare conversie");
  }
  return applyPatch(store, deal, {
    status: "converted",
    convertedAt: nowIso(),
    conversion: {
      customerId: clean(customerId), tenantId: clean(tenantId),
      subscriptionId: isBlank(subscriptionId) ? null : clean(subscriptionId),
      convertedBy: who(actor),
    },
  }, actor, "deal_converted", isBlank(reason) ? "conversie naar klant/tenant/abonnement" : clean(reason));
}

// ── Leesfuncties · reseller A ziet deals van B nooit ─────────────────────────

/** Projectie voor de partnerzijde: conflict_case_id is restricted (23.8). */
function projectDeal(deal, scope) {
  if (scope === "all") return { ...deal };
  const { conflictCaseId, ...rest } = deal;
  return { ...rest, inConflict: Boolean(conflictCaseId) };
}

/**
 * Lijst van deals binnen de scope van de gebruiker. Een expliciet vreemde
 * resellerId-filter is een harde weigering, geen stille herfiltering (23.6).
 */
function listDeals(store, user, { resellerId = null } = {}) {
  const scope = A.grantFor(user, "reseller.deals.view");
  if (!scope) throw A.forbiddenError();
  let rows;
  if (scope === "all") {
    rows = dealsColl(store).filter(d => !resellerId || d.resellerId === resellerId);
  } else {
    if (!user.resellerId) throw A.forbiddenError();
    if (resellerId && resellerId !== user.resellerId) throw A.scopeViolationError();
    rows = dealsColl(store).filter(d => d.resellerId === user.resellerId);
  }
  return rows
    .slice()
    .sort((a, b) => String(b.registeredAt || "").localeCompare(String(a.registeredAt || "")))
    .map(d => projectDeal(d, scope));
}

/**
 * Een deal ophalen. Anti-probing (23.15): een vreemde deal geeft exact
 * dezelfde 404 als een onbestaande deal · bestaan lekt nooit.
 */
function getDeal(store, user, dealId) {
  const scope = A.grantFor(user, "reseller.deals.view");
  if (!scope) throw A.forbiddenError();
  const deal = findDeal(store, dealId);
  if (!deal) throw A.notFoundError("deal");
  if (scope !== "all" && (!user.resellerId || deal.resellerId !== user.resellerId)) {
    throw A.notFoundError("deal");
  }
  return projectDeal(deal, scope);
}

module.exports = {
  DEFAULT_CLAIM_VALIDITY_DAYS, EVIDENCE_TYPES, COLLISION_STATUSES, OPEN_STATUSES,
  registerDeal, transitionDeal, setAttribution, expireDeals, convertDeal,
  listDeals, getDeal, projectDeal, findCollisions,
};
