"use strict";

// ── Reseller-lifecycle · store-gebonden service (h23 · 23.2/23.4/23.14/23.15) ─
// Onboarding, activatie, suspensie, partnerreview en offboarding van
// resellerorganisaties. Bouwt op de pure beslislaag
// src/platform/reseller-domain.js (statusmachines 23.14 + veldmodel 23.2) en
// volgt het servicepatroon van src/modules/commission-service.js.
//
// Principes uit de spec die deze laag afdwingt:
//  - portaalactivatie ALLEEN bij goedgekeurde organisatie EN actief contract
//    (agreement_version + accepted_at) · anders geen activatie (23.4);
//  - legal gates: dpa_accepted_at zodra verwerking van klantdata mogelijk is,
//    nda_accepted_at voor toegang tot vertrouwelijke informatie (23.2);
//  - suspensie blokkeert nieuwe deals, tenantaanvragen en beheeracties maar
//    BEWAART historische rapportering · bestaande data blijft leesbaar (23.4);
//  - offboarding trekt bij access_revoked ONMIDDELLIJK tokens, API-keys,
//    gedelegeerde toegang en open invitations in (23.15). Sessietokens sterven
//    doordat authenticate() inactieve gebruikers weigert · geen tokenstore nodig;
//  - historische deal-, contract- en commissiegegevens blijven behouden
//    volgens retentie- en wettelijke verplichtingen (23.15 / DoD-10);
//  - elke wijziging krijgt actor, timestamp, reden en before/after (23.15).
//    store.audit bewaart alleen een vaste veldenset en kapt detail af op 1000
//    tekens; daarom schrijft deze service de before/after naar de append-only
//    collectie resellerLifecycleEvents en dient de auditregel als index.
//
// Auditnamen zijn bewust gekozen zodat securityrelevante regels de LANGE
// retentie krijgen (SECURITY_ACTIONS-regex in src/platform/audit-log.js):
// permission_*, support_access_*, api_key_*, tenant_link_* matchen; generieke
// reseller_*-regels niet (die zijn niet securitygevoelig).
//
// Benodigde store-collecties (registratie in REQUIRED_COLLECTIONS doet de
// integratiestap, niet deze module): resellerAgreements, resellerTenantLinks,
// resellerAccessGrants, resellerReviews, resellerOffboardings,
// resellerLifecycleEvents. Bestaand en hergebruikt: resellers, users, apiKeys,
// tenants, commissionEvents, commissionPayouts.

const crypto = require("crypto");
const D = require("../platform/reseller-domain");
// Vier-ogencontrole (CTO3-08): dezelfde beslislaag als de rest van het kanaal.
const A = require("../platform/reseller-authz");
// EEN bron van waarheid voor tenantkoppelingen (DoD-3): relationType,
// goedkeurder, verplichte reden, platformvlaggen en de single-commercial-
// owner-guard staan in reseller-tenants.js · deze module dupliceert dat niet
// meer maar delegeert eraan.
const T = require("./reseller-tenants");
// 23.15 · payout-/contractvelden blijven buiten algemene resellerexports.
const { exportSafeReseller } = require("./reseller-commission-agreement");

function id(prefix) { return `${prefix}_${crypto.randomBytes(9).toString("hex")}`; }
function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
function nowIso() { return new Date().toISOString(); }
function today() { return nowIso().slice(0, 10); }
function clean(v) { return String(v == null ? "" : v).trim(); }
function isBlank(v) { return v == null || clean(v) === ""; }
function who(actor) { return (actor && actor.email) || "system"; }
function toMs(now) {
  if (now == null) return Date.now();
  if (now instanceof Date) return now.getTime();
  return typeof now === "number" ? now : Date.parse(now);
}

// ── Leeshulpen ───────────────────────────────────────────────────────────────
function orgOf(store, resellerId) {
  const org = store.get("resellers", resellerId);
  if (!org) throw err(404, "RESELLER_NOT_FOUND", "resellerorganisatie niet gevonden");
  return org;
}
function rowsOf(store, collection, resellerId) {
  return (store.data[collection] || []).filter(r => r && r.resellerId === resellerId);
}

// ── Append-only lifecycle-log (23.15: actor, timestamp, reden, before/after) ─
// Eigen collectie omdat store.audit extra velden stilletjes laat vallen; de
// auditregel blijft de doorzoekbare index, dit is het volledige bewijs.
function logLifecycle(store, { resellerId, kind, action, reason = null, refId = null, before = null, after = null }, actor) {
  return store.insert("resellerLifecycleEvents", {
    id: id("rle"), tenantId: null, resellerId,
    kind, action, actor: who(actor), at: nowIso(),
    reason: clean(reason) || null, refId: refId || null,
    before, after,
  });
}

// ── Activatiegates (23.4) ────────────────────────────────────────────────────
// Verwerking van klantdata is mogelijk zodra een gedelegeerde bevoegdheid aan
// staat of de dienstverlening (support/implementation) klantdata raakt.
function customerDataPossible(org) {
  if (org.delegated_support_allowed === true || org.delegated_tenant_admin_allowed === true) return true;
  const scope = Array.isArray(org.service_scope) ? org.service_scope : [];
  return scope.includes("support") || scope.includes("implementation");
}
// Toegang tot vertrouwelijke informatie: expliciete vlag of een tier boven
// registered (tierinformatie zelf is Confidential · 23.2).
function confidentialAccessPossible(org) {
  if (org.confidential_access === true) return true;
  return ["silver", "gold", "custom"].includes(clean(org.partner_tier).toLowerCase());
}

/**
 * Alle blokkades voor portaalactivatie als { veld: reden } · leeg = klaar.
 * Combineert het volledige 23.2-veldmodel (voor de prospectieve status
 * active) met de contract- en legal gates uit 23.4.
 */
function activationBlockers(org, agreements = [], at = new Date(), ctx = {}) {
  const blockers = D.validateResellerOrganization({ ...org, status: "active", onboarding_status: "active" });
  if (isBlank(org.agreement_version)) blockers.agreement_version = "actief contract vereist: agreement_version ontbreekt (23.4)";
  if (isBlank(org.accepted_at)) blockers.accepted_at = "actief contract vereist: accepted_at ontbreekt (23.4)";
  // Zijn er versiegebonden contractrecords, dan moet er NU exact een actief zijn.
  const list = Array.isArray(agreements) ? agreements : [];
  if (list.length > 0 && !D.activeAgreement(list, at)) {
    blockers.agreement = "geen actief contractrecord voor dit moment (23.4)";
  }
  if (customerDataPossible(org) && isBlank(org.dpa_accepted_at)) {
    blockers.dpa_accepted_at = "dpa_accepted_at is verplicht zodra verwerking van klantdata mogelijk is (23.2)";
  }
  if (confidentialAccessPossible(org) && isBlank(org.nda_accepted_at)) {
    blockers.nda_accepted_at = "nda_accepted_at is verplicht voor toegang tot vertrouwelijke informatie (23.2)";
  }
  // ── CTO3-08 · afdwingbare onboarding-gates (niet enkel gemeten) ────────────
  // MFA is verplicht vóór een partner actief wordt: een actieve partner kan
  // deals, tenantaanvragen en (met grant) klantdata raken.
  if (org.mfa_enforced !== true) {
    blockers.mfa_enforced = "MFA is verplicht voor een actieve partner (23.15)";
  }
  // Payoutconfiguratie moet compleet zijn vóór activatie · anders ontstaat een
  // actieve partner die commissie opbouwt zonder uitbetaalbaar rekeningnummer.
  // De sleutel heet bewust NIET naar het gevoelige veld: blockers worden op de
  // organisatie bewaard en komen zo in admin-lijsten terecht · daar hoort de
  // naam van een finance-restricted veld (IBAN) niet thuis.
  const payoutOntbreekt = [];
  if (isBlank(org.payout_account)) payoutOntbreekt.push("rekeningnummer");
  if (isBlank(org.payout_currency)) payoutOntbreekt.push("valuta");
  if (payoutOntbreekt.length) {
    blockers.payout_configuration = `payoutconfiguratie onvolledig (${payoutOntbreekt.join(" + ")}) · verplicht voor een actieve partner (23.11)`;
  }
  // Rollen: er moet minstens één partnergebruiker toegewezen zijn, anders is er
  // niemand die het portaal kan bedienen en is "active" een lege claim.
  if (Number(ctx.resellerUserCount || 0) < 1) {
    blockers.roles = "minstens één partnergebruiker met rol is verplicht voor activatie (23.6)";
  }
  return blockers;
}

/**
 * CTO3-08 · een partner die niet actief is mag GEEN nieuwe acties starten
 * (deals, tenantaanvragen, licenties, gedelegeerde toegang). Historische
 * financiële rapportage blijft wel leesbaar · die loopt via de view-rechten.
 */
function assertPartnerActive(org, what = "deze actie") {
  const status = clean(org && org.status);
  if (status === "active") return true;
  throw err(403, "PARTNER_NOT_ACTIVE", `${what} vereist een actieve partner (huidige status: ${status || "onbekend"})`);
}

/**
 * Portaalactivatie (23.4): organisatie onboarding → active EN
 * onboarding_status training → active, in een beweging. Weigert met 409 +
 * .fieldErrors zolang niet alle voorwaarden vervuld zijn.
 */
function activate(store, { resellerId, at = new Date() }, actor) {
  const org = orgOf(store, resellerId);
  if (org.status === "active") return org; // reeds actief · no-op
  D.resellerOrganization.assertTransition(org.status, "active");
  D.onboardingStatus.assertTransition(org.onboarding_status, "active");
  // CTO3-08 · vier-ogen: wie de aanvraag indiende mag niet zelf activeren.
  // Ontbrekende identiteit aan één van beide kanten faalt DICHT.
  A.assertNotSelfApproval((actor && (actor.id || actor.email)) || null, org.submitted_by || org.created_by || null);
  const blockers = activationBlockers(org, rowsOf(store, "resellerAgreements", resellerId), at, {
    resellerUserCount: (store.data.users || []).filter(u => u && u.resellerId === resellerId).length,
  });
  if (Object.keys(blockers).length > 0) {
    const e = err(409, "RESELLER_ACTIVATION_BLOCKED", "portaalactivatie geweigerd · voorwaarden uit 23.4 niet vervuld");
    e.fieldErrors = blockers;
    throw e;
  }
  const before = { status: org.status, onboarding_status: org.onboarding_status };
  const next = store.update("resellers", resellerId, {
    status: "active", onboarding_status: "active", activated_at: nowIso(),
  });
  logLifecycle(store, { resellerId, kind: "organization", action: "activated", before, after: { status: "active", onboarding_status: "active" } }, actor);
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: "permission_reseller_activated", detail: `${resellerId} portaal geactiveerd` });
  return next;
}

/**
 * onboarding_status vooruit bewegen (applied → screening → contracting →
 * training). De laatste stap naar active loopt UITSLUITEND via activate(),
 * zodat de contract- en legal gates nooit omzeild worden.
 */
function advanceOnboarding(store, { resellerId, to }, actor) {
  const org = orgOf(store, resellerId);
  if (to === "active") {
    throw err(409, "ACTIVATION_VIA_ACTIVATE", "onboarding_status active wordt uitsluitend via portaalactivatie gezet (23.4)");
  }
  D.onboardingStatus.assertTransition(org.onboarding_status, to);
  if (org.onboarding_status === to) return org;
  const before = { onboarding_status: org.onboarding_status };
  const next = store.update("resellers", resellerId, { onboarding_status: to });
  logLifecycle(store, { resellerId, kind: "organization", action: "onboarding_advanced", before, after: { onboarding_status: to } }, actor);
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: "reseller_onboarding_advanced", detail: `${resellerId} ${before.onboarding_status} naar ${to}` });
  return next;
}

// ── Suspensie en beeindiging (23.2/23.4/23.14) ───────────────────────────────

/** Trek alle niet-terminale gedelegeerde toegangen van een reseller in. */
function revokeDelegatedGrants(store, resellerId, actor, reason) {
  const open = rowsOf(store, "resellerAccessGrants", resellerId)
    .filter(g => !["revoked", "expired"].includes(g.status));
  for (const g of open) {
    store.update("resellerAccessGrants", g.id, {
      status: "revoked", revokedAt: nowIso(), revokedBy: who(actor), revokeReason: clean(reason) || null,
    });
    logLifecycle(store, { resellerId, kind: "delegated_access", action: "grant_revoked", reason, refId: g.id, before: { status: g.status }, after: { status: "revoked" } }, actor);
  }
  if (open.length > 0) {
    store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: "support_access_revoked", detail: `${resellerId} ${open.length} gedelegeerde toegang(en) ingetrokken` });
  }
  return open.length;
}

/**
 * Suspensie (23.4): reden VERPLICHT, datum wordt vastgelegd. Blokkeert nieuwe
 * deals, tenantaanvragen en beheeracties (via assertOperational op elke
 * schrijfroute) maar bewaart historische rapportering. Lopende gedelegeerde
 * toegang in klant-tenants stopt onmiddellijk · dat is een beheeractie.
 */
function suspend(store, { resellerId, reason, date = null }, actor) {
  const org = orgOf(store, resellerId);
  if (org.status === "suspended") return org; // reeds gesuspendeerd · no-op
  if (!clean(reason)) throw err(400, "SUSPENSION_REASON_REQUIRED", "suspension_reason is verplicht bij suspensie (23.2)");
  D.resellerOrganization.assertTransition(org.status, "suspended");
  const before = { status: org.status, suspension_reason: org.suspension_reason || null, suspension_date: org.suspension_date || null };
  const next = store.update("resellers", resellerId, {
    status: "suspended", suspension_reason: clean(reason), suspension_date: clean(date) || today(),
  });
  revokeDelegatedGrants(store, resellerId, actor, `suspensie: ${clean(reason)}`);
  logLifecycle(store, { resellerId, kind: "organization", action: "suspended", reason, before, after: { status: "suspended", suspension_reason: clean(reason), suspension_date: next.suspension_date } }, actor);
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: "permission_reseller_suspended", detail: `${resellerId} reden: ${clean(reason)}` });
  return next;
}

/**
 * Beeindiging (23.14: alleen vanuit suspended). Legt termination_date en
 * exit_status vast (23.2) · historische data blijft staan.
 */
function terminate(store, { resellerId, reason = null, date = null, exitStatus = "closed" }, actor) {
  const org = orgOf(store, resellerId);
  if (org.status === "terminated") return org; // reeds beeindigd · no-op
  D.resellerOrganization.assertTransition(org.status, "terminated");
  const before = { status: org.status, termination_date: org.termination_date || null, exit_status: org.exit_status || null };
  const next = store.update("resellers", resellerId, {
    status: "terminated", termination_date: clean(date) || today(), exit_status: clean(exitStatus) || "closed",
  });
  logLifecycle(store, { resellerId, kind: "organization", action: "terminated", reason, before, after: { status: "terminated", termination_date: next.termination_date, exit_status: next.exit_status } }, actor);
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: "permission_reseller_terminated", detail: `${resellerId}${reason ? " reden: " + clean(reason) : ""}` });
  return next;
}

/**
 * Generieke organisatie-overgang langs de 23.14-machine. De statussen met
 * extra plichten (active, suspended, terminated) lopen via hun eigen functie
 * zodat gates en verplichte velden nooit omzeild worden.
 */
function transitionOrganization(store, { resellerId, to, reason = null, date = null }, actor) {
  if (to === "active") return activate(store, { resellerId }, actor);
  if (to === "suspended") return suspend(store, { resellerId, reason, date }, actor);
  if (to === "terminated") return terminate(store, { resellerId, reason, date }, actor);
  const org = orgOf(store, resellerId);
  D.resellerOrganization.assertTransition(org.status, to);
  if (org.status === to) return org;
  const before = { status: org.status };
  const next = store.update("resellers", resellerId, { status: to });
  logLifecycle(store, { resellerId, kind: "organization", action: "status_changed", reason, before, after: { status: to } }, actor);
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: "reseller_status_changed", detail: `${resellerId} ${before.status} naar ${to}` });
  return next;
}

/**
 * Guard voor nieuwe deals, tenantaanvragen en beheeracties: alleen een
 * ACTIEVE organisatie mag nieuw werk starten (23.4). Leesroutes voor
 * historische rapportering gebruiken deze guard bewust NIET.
 */
function assertOperational(store, resellerId) {
  return D.assertOrganizationActive(store.get("resellers", resellerId));
}

/**
 * Historische rapportering · werkt in ELKE status (ook suspended/terminated):
 * suspensie en offboarding mogen bestaande data nooit onleesbaar maken
 * (23.4 / DoD-10).
 */
function historicalOverview(store, resellerId) {
  const organization = orgOf(store, resellerId);
  return {
    // Payout- en contractgegevens vallen ook hier weg (23.15/DoD-2): het
    // overzicht is rapportering, geen finance-oppervlak. IBAN opvragen loopt
    // via de aparte route achter reseller.payout.manage.
    organization: exportSafeReseller(organization),
    agreements: rowsOf(store, "resellerAgreements", resellerId),
    tenantLinks: rowsOf(store, "resellerTenantLinks", resellerId),
    reviews: rowsOf(store, "resellerReviews", resellerId),
    offboardings: rowsOf(store, "resellerOffboardings", resellerId),
    commissionEvents: rowsOf(store, "commissionEvents", resellerId),
    commissionPayouts: rowsOf(store, "commissionPayouts", resellerId),
    lifecycleEvents: rowsOf(store, "resellerLifecycleEvents", resellerId),
  };
}

// ── Partnerreview (23.14) ────────────────────────────────────────────────────

/** Plan een periodieke partnerreview · review_date is verplicht. */
function scheduleReview(store, { resellerId, reviewDate }, actor) {
  const org = orgOf(store, resellerId);
  if (!clean(reviewDate)) throw err(400, "REVIEW_DATE_REQUIRED", "review_date is verplicht voor een partnerreview (23.14)");
  const row = store.insert("resellerReviews", {
    id: id("prv"), tenantId: null, resellerId: org.id,
    status: "scheduled", reviewDate: clean(reviewDate),
    outcomeReason: null, decidedAt: null, decidedBy: null,
    createdAt: nowIso(), createdBy: who(actor),
  });
  logLifecycle(store, { resellerId: org.id, kind: "review", action: "review_scheduled", refId: row.id, after: { status: "scheduled", reviewDate: row.reviewDate } }, actor);
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: "reseller_review_scheduled", detail: `${org.id} review op ${row.reviewDate}` });
  return row;
}

/**
 * Review-overgang langs scheduled → in_review → action_required →
 * approved/suspended. De uitkomst suspended suspendeert de organisatie zelf
 * (reden verplicht) · reviewuitkomsten zijn geen vrijblijvende notities.
 */
function transitionReview(store, { reviewId, to, reason = null }, actor) {
  const review = store.get("resellerReviews", reviewId);
  if (!review) throw err(404, "REVIEW_NOT_FOUND", "partnerreview niet gevonden");
  D.partnerReview.assertTransition(review.status, to);
  if (review.status === to) return review;
  if (to === "suspended" && !clean(reason)) {
    throw err(400, "SUSPENSION_REASON_REQUIRED", "een suspensie-uitkomst vereist een reden (23.2)");
  }
  const patch = { status: to };
  if (to === "approved" || to === "suspended") {
    patch.decidedAt = nowIso(); patch.decidedBy = who(actor); patch.outcomeReason = clean(reason) || null;
  }
  const next = store.update("resellerReviews", reviewId, patch);
  logLifecycle(store, { resellerId: review.resellerId, kind: "review", action: `review_${to}`, reason, refId: reviewId, before: { status: review.status }, after: { status: to } }, actor);
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: `reseller_review_${to}`, detail: `${review.resellerId} ${reviewId}` });
  if (to === "suspended") {
    const org = store.get("resellers", review.resellerId);
    if (org && org.status === "active") {
      suspend(store, { resellerId: org.id, reason: `partnerreview ${reviewId}: ${clean(reason)}` }, actor);
    }
  }
  return next;
}

// ── Offboarding (23.14/23.15) ────────────────────────────────────────────────

function openOffboarding(store, resellerId) {
  return rowsOf(store, "resellerOffboardings", resellerId).find(o => o.status !== "completed") || null;
}

/**
 * Start het offboardingtraject. Vereist een gesuspendeerde of beeindigde
 * organisatie (23.14: de organisatiemachine bereikt terminated enkel via
 * suspended) en maximaal een lopend traject per reseller.
 */
function startOffboarding(store, { resellerId, reason = null }, actor) {
  const org = orgOf(store, resellerId);
  if (!["suspended", "terminated"].includes(org.status)) {
    throw err(409, "OFFBOARDING_REQUIRES_SUSPENSION", "offboarding start pas na suspensie of beeindiging van de organisatie (23.14)");
  }
  if (openOffboarding(store, resellerId)) {
    throw err(409, "OFFBOARDING_ALREADY_OPEN", "er loopt al een offboardingtraject voor deze reseller");
  }
  const row = store.insert("resellerOffboardings", {
    id: id("rob"), tenantId: null, resellerId,
    status: "initiated", reason: clean(reason) || null,
    startedAt: nowIso(), startedBy: who(actor),
    steps: [{ to: "initiated", at: nowIso(), by: who(actor), reason: clean(reason) || null }],
    revoked: null, transferredLinks: null, financeClosedAt: null, completedAt: null,
  });
  logLifecycle(store, { resellerId, kind: "offboarding", action: "offboarding_initiated", reason, refId: row.id, after: { status: "initiated" } }, actor);
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: "reseller_offboarding_initiated", detail: `${resellerId} ${row.id}` });
  return row;
}

/**
 * Trek ALLE actieve toegang van een reseller in (23.15): sessies (via
 * users.active=false · authenticate() weigert inactieve gebruikers bij het
 * eerstvolgende request), open invitations (activation-token gewist),
 * API-keys en gedelegeerde toegang. Retourneert een telbare samenvatting.
 * Historische data wordt hier NOOIT verwijderd.
 */
function revokeAllAccess(store, resellerId, actor, reason = "offboarding") {
  const at = nowIso();
  const users = (store.data.users || []).filter(u => u && u.resellerId === resellerId);
  let activeUsers = 0; let invitations = 0;
  for (const u of users) {
    if (u.active === true) activeUsers += 1;
    if (u.activation && u.active !== true) invitations += 1; // open invitation
    store.update("users", u.id, { active: false, activation: null, accessRevokedAt: at, accessRevokedBy: who(actor) });
  }
  const keys = (store.data.apiKeys || []).filter(k => k && k.resellerId === resellerId && k.status === "active");
  for (const k of keys) {
    store.update("apiKeys", k.id, { status: "revoked", revokedAt: at, revokedBy: who(actor) });
    store.audit({ actor: who(actor), tenantId: k.tenantId || null, area: "resellers", action: "api_key_revoked", detail: `${resellerId} ${k.id} (offboarding)` });
  }
  const delegatedGrants = revokeDelegatedGrants(store, resellerId, actor, reason);
  const summary = { users: activeUsers, invitations, apiKeys: keys.length, delegatedGrants, at };
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: "permission_access_revoked", detail: `${resellerId} toegang ingetrokken: ${JSON.stringify(summary)}` });
  return summary;
}

/**
 * Offboarding-overgang langs initiated → access_revoked →
 * tenants_transferred → finance_closed → completed, met de plichten per stap:
 *  - access_revoked: onmiddellijke intrekking van alle toegang (23.15);
 *  - tenants_transferred: actieve tenantkoppelingen worden beeindigd, de
 *    records zelf blijven bestaan (historiek);
 *  - finance_closed: geweigerd zolang er open payouts staan · het commissie-
 *    grootboek zelf blijft onaangeroerd (retentie/wettelijk);
 *  - completed: een gesuspendeerde organisatie wordt beeindigd (23.14).
 */
function transitionOffboarding(store, { offboardingId, to, reason = null }, actor) {
  const ob = store.get("resellerOffboardings", offboardingId);
  if (!ob) throw err(404, "OFFBOARDING_NOT_FOUND", "offboarding niet gevonden");
  D.offboarding.assertTransition(ob.status, to);
  if (ob.status === to) return ob;
  const patch = {
    status: to,
    steps: [...(ob.steps || []), { to, at: nowIso(), by: who(actor), reason: clean(reason) || null }],
  };
  if (to === "access_revoked") {
    patch.revoked = revokeAllAccess(store, ob.resellerId, actor, `offboarding ${ob.id}`);
  }
  if (to === "tenants_transferred") {
    const links = activeTenantLinks(store, ob.resellerId);
    for (const l of links) {
      store.update("resellerTenantLinks", l.id, { status: "ended", endDate: nowIso(), endReason: "offboarding", endedBy: who(actor) });
      store.audit({ actor: who(actor), tenantId: l.tenantId || null, area: "resellers", action: "tenant_link_ended", detail: `${ob.resellerId} koppeling ${l.id} beeindigd (offboarding)` });
    }
    patch.transferredLinks = links.length;
  }
  if (to === "finance_closed") {
    // Een mislukte (failed) payout is nog onopgelost (herpoging mogelijk, 23.11)
    // en blokkeert het financieel afsluiten net als een open payout · een
    // teruggedraaide (reversed) payout is wel afgerond en telt niet mee.
    const open = rowsOf(store, "commissionPayouts", ob.resellerId)
      .filter(p => ["draft", "pending_approval", "approved", "failed"].includes(p.status));
    if (open.length > 0) {
      throw err(409, "OFFBOARDING_FINANCE_OPEN", `er staan nog ${open.length} open payout(s) · eerst afronden of annuleren`);
    }
    patch.financeClosedAt = nowIso();
  }
  if (to === "completed") patch.completedAt = nowIso();
  const next = store.update("resellerOffboardings", offboardingId, patch);
  logLifecycle(store, { resellerId: ob.resellerId, kind: "offboarding", action: `offboarding_${to}`, reason, refId: ob.id, before: { status: ob.status }, after: { status: to } }, actor);
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: `reseller_offboarding_${to}`, detail: `${ob.resellerId} ${ob.id}` });
  if (to === "completed") {
    const org = store.get("resellers", ob.resellerId);
    if (org && org.status === "suspended") {
      terminate(store, { resellerId: org.id, reason: `offboarding ${ob.id} voltooid`, exitStatus: "completed" }, actor);
    }
  }
  return next;
}

// ── Tenantkoppelingen + contractueel plafond (23.2/23.9) ─────────────────────

/** Actieve koppelingen (status active en binnen het datumvenster). */
function activeTenantLinks(store, resellerId, now = Date.now()) {
  const nowMs = toMs(now);
  return rowsOf(store, "resellerTenantLinks", resellerId).filter(l =>
    l.status === "active"
    && (!l.startDate || Date.parse(l.startDate) <= nowMs)
    && (!l.endDate || Date.parse(l.endDate) > nowMs));
}

/**
 * Koppel een tenant aan de reseller (assignment-record · 23.9/23.15).
 *
 * DELEGEERT naar reseller-tenants.linkTenant: daar zitten relationType,
 * approvedBy, de verplichte reden, de platformvlaggen (delegated_support /
 * delegated_tenant_admin) en de single-commercial-owner-guard. De eigen,
 * zwakkere variant is bewust verwijderd · een tweede schrijfpad op dezelfde
 * collectie was een klaarliggende bypass van DoD-3. Wat deze laag toevoegt is
 * lifecycle-eigen: het contractuele plafond max_managed_tenants (23.2), de
 * suspensieregel en de append-only before/after-log (23.15).
 */
function linkTenant(store, { resellerId, tenantId, relationType = "commercial", startDate = null, endDate = null, startAt = null, endAt = null, reason = null }, actor) {
  const org = D.assertOrganizationActive(orgOf(store, resellerId));
  const cap = org.max_managed_tenants != null ? org.max_managed_tenants : org.maxManagedTenants;
  if (Number.isInteger(cap) && T.assignedTenants(store, resellerId).length >= cap) {
    throw err(409, "MAX_MANAGED_TENANTS_REACHED", `contractueel plafond bereikt: maximaal ${cap} beheerde tenant(s)`);
  }
  const row = T.linkTenant(store, {
    resellerId, tenantId, relationType,
    startAt: startAt || startDate, endAt: endAt || endDate, reason,
  }, actor);
  logLifecycle(store, { resellerId, kind: "tenant_link", action: "tenant_link_created", reason, refId: row.id, after: { tenantId, status: row.status } }, actor);
  return row;
}

/**
 * Beeindig een tenantkoppeling · het record blijft bestaan (historiek).
 * Delegeert naar reseller-tenants.revokeTenantLink (reden verplicht, actor
 * mag geen resellergebruiker zijn) en voegt alleen de lifecycle-log toe.
 */
function endTenantLink(store, { linkId, reason = null }, actor) {
  const before = store.get("resellerTenantLinks", linkId);
  const next = T.revokeTenantLink(store, { linkId, reason }, actor);
  logLifecycle(store, { resellerId: next.resellerId, kind: "tenant_link", action: "tenant_link_ended", reason, refId: linkId, before: { status: before && before.status }, after: { status: next.status } }, actor);
  return next;
}

// ── Legacy-pad (h23-migratie) ────────────────────────────────────────────────

/**
 * LEGACY-heractivatie · bewust BUITEN de 23.14-machine.
 *
 * De machine kent geen suspended → active: een partner opnieuw laten starten is
 * per 23.4 een nieuwe onboarding met contract- en legal-gates (activate()). De
 * oude admin-console kent die stappen niet en gebruikt een enkele statusknop
 * voor twee dingen: een self-signup-aanvraag ("pending") goedkeuren en een
 * legacy-pauze opheffen. Die knop blijft werken, maar de omzeiling wordt
 * hier expliciet vastgelegd in het append-only lifecycle-log, zodat de
 * historiek klopt en de uitzondering zichtbaar is in plaats van stil.
 * Nieuwe onboardings horen via advanceOnboarding + activate te lopen.
 */
function legacyReactivate(store, { resellerId, reason = null }, actor) {
  const org = orgOf(store, resellerId);
  if (org.status === "active") return org; // no-op
  // CTO3-08 · FAIL-CLOSED: het legacy-pad mag GEEN active record meer produceren
  // buiten de gates om. Dezelfde contract-, legal-, MFA-, payout- en rolgates
  // gelden hier; een grandfathered partner met geldige remediation-deadline is
  // de enige gedocumenteerde uitzondering.
  const blockers = activationBlockers(org, rowsOf(store, "resellerAgreements", resellerId), new Date(), {
    resellerUserCount: (store.data.users || []).filter(u => u && u.resellerId === resellerId).length,
  });
  if (Object.keys(blockers).length > 0 && !grandfatherValid(org)) {
    const e = err(409, "RESELLER_ACTIVATION_BLOCKED", "legacy-heractivatie geweigerd · activatiegates niet vervuld (CTO3-08)");
    e.fieldErrors = blockers;
    throw e;
  }
  const before = { status: org.status };
  const next = store.update("resellers", resellerId, { status: "active", reactivated_at: nowIso() });
  logLifecycle(store, {
    resellerId, kind: "organization", action: "legacy_reactivated",
    reason: reason || "legacy admin-console", before, after: { status: "active" },
  }, actor);
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: "permission_reseller_activated", detail: `${resellerId} legacy-heractivatie vanuit ${before.status}` });
  return next;
}

/**
 * CTO3-08 punt 3 · goedkeuring van een SELF-SIGNUP-aanvraag levert GEEN actieve
 * partner meer op, maar zet de aanvraag door naar ONBOARDING. De aanvrager kan
 * daarna zijn wachtwoord instellen en de onboarding doorlopen; pas activate()
 * (met contract-, legal-, MFA-, payout- en rolgates) maakt de partner actief.
 * Dit vervangt de oude "legacy active organization create".
 */
function approveApplication(store, { resellerId, reason = null }, actor) {
  const org = orgOf(store, resellerId);
  if (org.status === "active") return org;                       // al actief · no-op
  if (org.status === "onboarding") return org;                   // al in onboarding · idempotent
  const before = { status: org.status, onboarding_status: org.onboarding_status || null };
  const next = store.update("resellers", resellerId, {
    status: "onboarding",
    onboarding_status: org.onboarding_status && org.onboarding_status !== "applied" ? org.onboarding_status : "applied",
    approved_at: nowIso(), approved_by: who(actor),
  });
  logLifecycle(store, {
    resellerId, kind: "organization", action: "application_approved",
    reason: reason || "self-signup goedgekeurd · onboarding gestart (CTO3-08)",
    before, after: { status: "onboarding" },
  }, actor);
  store.audit({ actor: who(actor), tenantId: null, area: "resellers", action: "reseller_application_approved", detail: `${resellerId} naar onboarding vanuit ${before.status}` });
  return next;
}

/** Geldige, niet-verlopen grandfather-uitzondering (CTO3-08 punt 6)? */
function grandfatherValid(org, at = new Date()) {
  if (!org || org.grandfathered !== true) return false;
  if (isBlank(org.remediation_deadline)) return false;   // uitzondering zonder deadline telt niet
  return toMs(org.remediation_deadline) > toMs(at);
}

/**
 * CTO3-08 punt 6 · veilige migratie van BESTAANDE actieve partners. Partners die
 * de nieuwe gates niet halen blijven werken, maar krijgen expliciet
 * grandfathered=true met een eigenaar en een verplichte remediation-deadline.
 * Idempotent: een reeds gemarkeerde partner wordt niet opnieuw gestempeld.
 */
function grandfatherExistingPartners(store, { deadline, owner = null, at = new Date() } = {}, actor) {
  if (isBlank(deadline)) throw err(400, "REMEDIATION_DEADLINE_REQUIRED", "een remediation-deadline is verplicht (CTO3-08)");
  const report = { marked: [], alreadyCompliant: [], alreadyMarked: [] };
  for (const org of (store.data.resellers || [])) {
    if (!org || org.status !== "active") continue;
    if (org.grandfathered === true) { report.alreadyMarked.push(org.id); continue; }
    const blockers = activationBlockers(org, rowsOf(store, "resellerAgreements", org.id), at, {
      resellerUserCount: (store.data.users || []).filter(u => u && u.resellerId === org.id).length,
    });
    if (Object.keys(blockers).length === 0) { report.alreadyCompliant.push(org.id); continue; }
    store.update("resellers", org.id, {
      grandfathered: true, remediation_deadline: deadline,
      remediation_owner: owner || who(actor), remediation_blockers: Object.keys(blockers),
    });
    logLifecycle(store, {
      resellerId: org.id, kind: "organization", action: "grandfathered",
      reason: `bestaande actieve partner voldoet nog niet aan de CTO3-08-gates · deadline ${deadline}`,
      before: { grandfathered: false }, after: { grandfathered: true, remediation_deadline: deadline },
    }, actor);
    report.marked.push({ resellerId: org.id, blockers: Object.keys(blockers) });
  }
  return report;
}

/**
 * Normaliseer een legacy-status die de 23.14-machine niet kent. "paused" is
 * nooit een echte status geweest: een rij met die waarde kon daarna nooit meer
 * gesuspendeerd of beeindigd worden (assertTransition gooit op een onbekende
 * status). Eenmalige datareparatie naar "suspended", met log.
 */
function normalizeLegacyStatus(store, resellerId, actor) {
  const org = orgOf(store, resellerId);
  if (org.status !== "paused") return org;
  const next = store.update("resellers", resellerId, { status: "suspended" });
  logLifecycle(store, {
    resellerId, kind: "organization", action: "legacy_status_normalized",
    reason: "legacy status paused bestaat niet in de 23.14-machine",
    before: { status: "paused" }, after: { status: "suspended" },
  }, actor);
  return next;
}

// ── Accreditaties (23.2: repeating structured met vervaldatums) ──────────────

/**
 * Verlopen accreditaties van een reseller op moment `now`. Fail dicht: een
 * certificaat zonder geldige (parseerbare) vervaldatum telt als verlopen ·
 * de spec eist certificaten MET vervaldatum.
 */
function expiredAccreditations(store, resellerId, now = new Date()) {
  const org = orgOf(store, resellerId);
  const nowMs = toMs(now);
  const list = Array.isArray(org.accreditations) ? org.accreditations : [];
  return list.filter(a => {
    if (!a || typeof a !== "object") return true;
    const ms = Date.parse(a.expiresAt || "");
    return Number.isNaN(ms) || ms <= nowMs;
  });
}

module.exports = {
  // organisatie-lifecycle
  transitionOrganization, activate, activationBlockers, advanceOnboarding,
  suspend, terminate, assertOperational, historicalOverview,
  // partnerreview
  scheduleReview, transitionReview,
  // offboarding
  startOffboarding, transitionOffboarding, revokeAllAccess,
  // tenantkoppelingen + plafond (delegeren naar reseller-tenants.js)
  linkTenant, endTenantLink, activeTenantLinks,
  // legacy admin-pad (h23-migratie)
  legacyReactivate, normalizeLegacyStatus,
  // CTO3-08 · afdwingbare partneractivatie
  assertPartnerActive, grandfatherValid, grandfatherExistingPartners, approveApplication,
  // accreditaties
  expiredAccreditations,
  // gedeeld: append-only before/after-log (23.15)
  logLifecycle,
};
