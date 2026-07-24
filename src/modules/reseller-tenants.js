"use strict";

// ── Reseller-tenants · aanvraag, provisioning, tenantrelatie en gedelegeerde
//    toegang (h23 · spec 23.4 + 23.9 + 23.12) ────────────────────────────────
// Store-gebonden servicelaag bovenop de pure lagen:
//   src/platform/reseller-domain.js  · statusmachines 23.14 + veldmodel
//   src/platform/reseller-authz.js   · rechten, delegatiebeslissing, anti-probing
//
// Harde regels die deze laag afdwingt:
//  - de tenant blijft ALTIJD een aparte beveiligingsgrens: de tenantkoppeling
//    (resellerTenantLinks) is een EIGEN record met scope, goedkeurder en
//    einddatum · reseller_id op de tenant alleen is nooit genoeg (23.15);
//  - een reseller koppelt zichzelf NOOIT aan een tenant: koppeling en
//    provisioning zijn platformacties (23.4);
//  - een tenantkoppeling geeft ALLEEN commerciele metadata; klantinhoud
//    vereist een ACTIEVE gedelegeerde toegang met scope, reden, startdatum,
//    einddatum en goedkeuring door de tenant admin (23.4/23.12);
//  - alle acties loggen de RESELLERGEBRUIKER als actor plus de represented
//    tenant · nooit als eindklantgebruiker (23.12/DoD-9);
//  - provisioning is transactioneel: klant, tenantrelatie, entitlements,
//    eerste admin en audit/outbox landen samen of helemaal niet (DoD-5).

const crypto = require("crypto");
const D = require("../platform/reseller-domain");
const A = require("../platform/reseller-authz");
const { emitDomainEvent } = require("../platform/events");
const { startActivation, activationToken } = require("../lib/auth");
const { BUSINESS_ADMIN_PERMISSIONS } = require("../lib/store");

// Nieuwe platform-collecties (rijen dragen tenantId: null of de klant-tenant).
// De integrator registreert deze in REQUIRED_COLLECTIONS (src/lib/store.js).
const REQUESTS = "resellerTenantRequests";
const LINKS = "resellerTenantLinks";
const GRANTS = "resellerAccessGrants";

// Beheerrelatie van een tenantkoppeling (23.9). "none" is de neutrale waarde
// in rapportering; een koppeling AANMAKEN met "none" kan niet · geen relatie =
// geen record.
const RELATION_TYPES = Object.freeze(["none", "commercial", "support", "delegated_admin"]);

// Facturatie-eigenaarschap (23.9): direct Monargo→klant of Monargo→reseller.
const BILLING_OWNERSHIP = Object.freeze(["monargo_direct", "via_reseller"]);

// Gedelegeerde scopes (23.12-capabilities) → categorie. De categorie bepaalt
// welke platformvlag op de organisatie vereist is (23.2 · standaard false):
// support-scopes vereisen delegated_support_allowed, beheerscopes vereisen
// delegated_tenant_admin_allowed.
const DELEGATED_SCOPES = Object.freeze({
  onboarding_view: "support",
  onboarding_tasks: "support",
  ticket_create: "support",
  ticket_view: "support",
  config_write: "admin",
  user_admin: "admin",
  data_export: "admin",
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function id(prefix) { return `${prefix}_${crypto.randomBytes(9).toString("hex")}`; }
function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
function nowIso() { return new Date().toISOString(); }
function clean(v) { return String(v == null ? "" : v).trim(); }
function isBlank(v) { return v == null || (typeof v === "string" && v.trim() === ""); }
function toMs(v) {
  if (v == null) return Date.now();
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  return Date.parse(v);
}

function findReseller(store, resellerId) {
  return (store.data.resellers || []).find(r => r.id === resellerId) || null;
}
function findRow(store, collection, rowId) {
  return (store.data[collection] || []).find(r => r.id === rowId) || null;
}

/** Elke actie vereist een aangemelde actor: audit zonder actor bestaat niet. */
function requireActor(actor) {
  if (!actor || !actor.email) throw err(401, "ACTOR_REQUIRED", "actie vereist een aangemelde gebruiker");
  return actor;
}
function isResellerActor(actor) { return Boolean(actor && actor.resellerId); }

/** Een resellergebruiker mag nooit namens een ANDERE reseller handelen (23.6). */
function assertSameReseller(actor, resellerId) {
  if (actor.resellerId && actor.resellerId !== resellerId) throw A.scopeViolationError();
}

/**
 * Auditregel: actor = de (reseller)gebruiker, tenantId = de represented tenant.
 * Geeft de geschreven regel terug (store.audit → appendAudit levert een rij met
 * id), zodat een transactionele actie de regel in haar rollback kan opnemen.
 */
function audit(store, actor, action, tenantId, detail) {
  return store.audit({
    actor: (actor && actor.email) || "system",
    tenantId: tenantId || null,
    area: "resellers",
    action,
    detail,
  });
}

/**
 * Rollback-hulp: haal zojuist geschreven auditregels er weer uit. De audit
 * blijft append-only voor de buitenwereld · dit is uitsluitend het terugdraaien
 * van regels binnen EEN mislukte transactie, die dus nooit een feit hebben
 * beschreven. Verwijderen gebeurt op objectidentiteit, zodat de rollback niet
 * vastzit aan de naam van de auditcollectie (auditLogs in de platformstore).
 */
function dropAuditRows(store, rows) {
  if (!rows || !rows.length) return;
  for (const key of Object.keys(store.data || {})) {
    const coll = store.data[key];
    if (!Array.isArray(coll) || !coll.some(r => rows.includes(r))) continue;
    store.data[key] = coll.filter(r => !rows.includes(r));
    return;
  }
}

function histEntry(actor, from, to, reason) {
  return { at: nowIso(), by: (actor && actor.email) || "system", from, to, reason: isBlank(reason) ? null : clean(reason) };
}
function changeEntry(actor, action, before, after, reason) {
  return { at: nowIso(), by: (actor && actor.email) || "system", action, before, after, reason: isBlank(reason) ? null : clean(reason) };
}

function missingAddressKeys(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return [...D.ADDRESS_KEYS];
  return D.ADDRESS_KEYS.filter(k => isBlank(a[k]));
}

// ── 23.9 · Tenantaanvraag ────────────────────────────────────────────────────

/**
 * Registreer een tenantaanvraag voor een eindklant. Start in "draft" (23.14).
 * Vereist een actieve resellerorganisatie: suspensie blokkeert nieuwe
 * aanvragen (23.4). Valideert eindklant, pakket en facturatie-eigenaarschap.
 */
function requestTenant(store, input, actor) {
  requireActor(actor);
  const { resellerId, dealId = null, billingOwnership } = input || {};
  const endCustomer = (input && input.endCustomer) || {};
  const pkg = (input && input.package) || {};

  // Scope-check VOOR de org-lookup (patroon registerDeal): anders lekt het
  // bestaan van andere partnerorganisaties · een vreemde bestaande reseller
  // gaf 403 en een onbestaand id 404. Nu is een expliciet vreemde resellerId
  // altijd dezelfde harde weigering, ongeacht of dat id bestaat (LNK-02).
  assertSameReseller(actor, resellerId);
  const org = findReseller(store, resellerId);
  D.assertOrganizationActive(org); // 404 RESELLER_NOT_FOUND / 403 RESELLER_NOT_ACTIVE

  const fieldErrors = {};
  if (isBlank(endCustomer.legalName)) fieldErrors["endCustomer.legalName"] = "legalName is verplicht";
  const contact = typeof endCustomer.contact === "string" ? { email: clean(endCustomer.contact) } : (endCustomer.contact || {});
  if (isBlank(contact.email) || !EMAIL_RE.test(clean(contact.email))) {
    fieldErrors["endCustomer.contact"] = "contact met geldig e-mailadres is verplicht (klantbevestiging)";
  }
  const lang = clean(endCustomer.language).toUpperCase();
  if (!D.LANGUAGES.includes(lang)) fieldErrors["endCustomer.language"] = "language moet NL, FR of EN zijn";
  const missing = missingAddressKeys(endCustomer.address);
  if (missing.length) fieldErrors["endCustomer.address"] = `adres mist: ${missing.join(", ")}`;
  if (isBlank(pkg.plan)) fieldErrors["package.plan"] = "plan is verplicht";
  if (pkg.seats != null && (!Number.isInteger(pkg.seats) || pkg.seats < 1)) {
    fieldErrors["package.seats"] = "seats moet een geheel getal >= 1 zijn";
  }
  if (pkg.modules != null && !Array.isArray(pkg.modules)) fieldErrors["package.modules"] = "modules moet een lijst zijn";
  if (!BILLING_OWNERSHIP.includes(billingOwnership)) {
    fieldErrors.billingOwnership = `billingOwnership moet een van ${BILLING_OWNERSHIP.join(", ")} zijn`;
  }
  if (Object.keys(fieldErrors).length) {
    const e = err(400, "TENANT_REQUEST_INVALID", "tenantaanvraag is ongeldig");
    e.fieldErrors = fieldErrors;
    throw e;
  }

  // Dealreferentie: bestaat de deal niet of hoort hij bij een andere reseller,
  // dan faalt de aanvraag dicht (geen cross-reseller attributie).
  if (dealId) {
    const deal = (store.data.resellerDeals || []).find(d => d.id === dealId);
    if (!deal) throw A.notFoundError("deal");
    if (deal.resellerId !== resellerId) throw A.scopeViolationError();
  }

  const row = {
    id: id("rtq"),
    tenantId: null, // platform-niveau · de klant-tenant bestaat nog niet
    resellerId,
    dealId: dealId || null,
    status: D.tenantRequest.initial, // draft
    endCustomer: {
      legalName: clean(endCustomer.legalName),
      enterpriseVat: isBlank(endCustomer.enterpriseVat) ? null : clean(endCustomer.enterpriseVat).replace(/[\s.]/g, "").toUpperCase(),
      address: endCustomer.address,
      contact,
      language: lang,
      sector: isBlank(endCustomer.sector) ? null : clean(endCustomer.sector),
    },
    package: {
      plan: clean(pkg.plan),
      modules: [...(pkg.modules || [])],
      seats: pkg.seats == null ? null : pkg.seats,
      trial: pkg.trial === true,
      term: pkg.term || null,
    },
    billingOwnership,
    provisionedTenantId: null,
    version: 1,
    history: [histEntry(actor, null, "draft", (input && input.reason) || null)],
    createdAt: nowIso(),
    createdBy: actor.email,
  };
  store.insert(REQUESTS, row);
  audit(store, actor, "tenant_request_created", null,
    JSON.stringify({ requestId: row.id, resellerId, klant: row.endCustomer.legalName }));
  return row;
}

/**
 * Statusovergang van een tenantaanvraag (machine 23.14). Regels:
 *  - "active" kan uitsluitend via provisionTenant (transactioneel, DoD-5);
 *  - resellerzijde mag alleen indienen of annuleren · klantbevestiging,
 *    beoordeling en provisioning zijn Monargo-zijde (23.9);
 *  - afwijzen en annuleren vereisen een reden (23.15);
 *  - vooruit bewegen vereist een actieve organisatie (suspensieregel 23.4);
 *  - optioneel optimistic locking via expectedVersion (409 VERSION_CONFLICT).
 */
function transitionTenantRequest(store, { requestId, to, reason = null, expectedVersion = null }, actor) {
  requireActor(actor);
  const row = findRow(store, REQUESTS, requestId);
  if (!row) throw A.notFoundError("tenant_request");
  assertSameReseller(actor, row.resellerId);
  if (expectedVersion != null && expectedVersion !== row.version) {
    const e = err(409, "VERSION_CONFLICT", "de aanvraag is intussen gewijzigd");
    e.currentVersion = row.version;
    throw e;
  }
  if (to === "active") {
    throw err(409, "TENANT_REQUEST_USE_PROVISION", "activeren loopt uitsluitend via provisionTenant (transactioneel)");
  }
  D.tenantRequest.assertTransition(row.status, to);
  if (row.status === to) return row; // no-op, zoals de statusmachine
  if (["rejected", "canceled"].includes(to) && isBlank(reason)) {
    throw err(400, "REASON_REQUIRED", "een reden is verplicht bij afwijzen of annuleren");
  }
  if (isResellerActor(actor) && !["submitted", "canceled"].includes(to)) {
    throw A.forbiddenError("TENANT_REQUEST_PLATFORM_ONLY");
  }
  if (!["rejected", "canceled"].includes(to)) {
    D.assertOrganizationActive(findReseller(store, row.resellerId));
  }
  const next = store.update(REQUESTS, row.id, {
    status: to,
    version: row.version + 1,
    history: [...(row.history || []), histEntry(actor, row.status, to, reason)],
  });
  audit(store, actor, `tenant_request_${to}`, null,
    JSON.stringify({ requestId: row.id, resellerId: row.resellerId, before: row.status, after: to, reden: isBlank(reason) ? null : clean(reason) }));
  return next;
}

function getTenantRequest(store, requestId) { return findRow(store, REQUESTS, requestId); }

function listTenantRequests(store, { resellerId = null } = {}) {
  return (store.data[REQUESTS] || [])
    .filter(r => !resellerId || r.resellerId === resellerId)
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// ── 23.9 · Provisioning (DoD-5 · transactioneel) ─────────────────────────────

/**
 * Provisioneer de tenant uit een goedgekeurde aanvraag (status review of
 * provisioning). Schrijft klant (tenant), tenantrelatie (assignment-record),
 * entitlements (plan/modules/seats), eerste admin (pending activatie) en
 * audit/outbox. Alles-of-niets: faalt een deel, dan wordt alles teruggedraaid
 * en blijft er geen halve tenant achter.
 * Platformactie: een reseller provisioneert of koppelt nooit zelf (23.4).
 */
function provisionTenant(store, input, actor) {
  requireActor(actor);
  const { requestId, tenantId = null, adminEmail = null, adminName = null, commissionPct = null } = input || {};
  if (isResellerActor(actor)) throw A.forbiddenError("SELF_LINK_FORBIDDEN");
  const request = findRow(store, REQUESTS, requestId);
  if (!request) throw A.notFoundError("tenant_request");
  const org = findReseller(store, request.resellerId);
  D.assertOrganizationActive(org);
  // Statusmachine 23.14: review → provisioning → active. Elke andere
  // beginstatus faalt hier via de machine (400/409).
  if (request.status !== "provisioning") D.tenantRequest.assertTransition(request.status, "provisioning");
  D.tenantRequest.assertTransition("provisioning", "active");

  const email = clean(adminEmail || (request.endCustomer.contact && request.endCustomer.contact.email)).toLowerCase();
  if (!EMAIL_RE.test(email)) throw err(400, "ADMIN_EMAIL_INVALID", "een geldig e-mailadres voor de eerste admin is verplicht");
  if ((store.data.users || []).some(u => String(u.email || "").toLowerCase() === email)) {
    throw err(409, "ADMIN_EMAIL_IN_USE", "dit e-mailadres is al in gebruik");
  }

  // Contractueel plafond op beheerde tenants (23.2 · max_managed_tenants).
  const cap = org.max_managed_tenants != null ? org.max_managed_tenants : org.maxManagedTenants;
  if (Number.isInteger(cap) && assignedTenants(store, org.id).length >= cap) {
    throw err(409, "TENANT_CAP_REACHED", "het contractuele maximum aan beheerde tenants is bereikt");
  }

  // Een vrij gekozen tenantId mag NOOIT een bestaande tenant overschrijven of
  // dupliceren: store.insert bewaakt geen unieke ids, dus een tweede rij met
  // hetzelfde id zou naast de echte tenant komen te staan én er een actieve
  // commerciele koppeling op leggen. Dat is precies de omweg rond de
  // single-commercial-owner-guard van linkTenant (23.4/23.9).
  if (!isBlank(tenantId) && findRow(store, "tenants", clean(tenantId))) {
    throw err(409, "TENANT_EXISTS", "er bestaat al een tenant met dit id · koppelen loopt via linkTenant");
  }

  // Fase 1 · alles eerst in het geheugen bouwen: valideren voor schrijven.
  const now = nowIso();
  const pkg = request.package || {};
  const tenantRow = {
    id: tenantId || `tenant_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    name: request.endCustomer.legalName,
    plan: pkg.plan || "business",
    status: pkg.trial ? "trial" : "active",
    billingEmail: request.billingOwnership === "via_reseller"
      ? clean(org.billing_email || org.billingEmail || "")
      : email,
    language: request.endCustomer.language,
    sector: request.endCustomer.sector || null,
    seats: pkg.seats || null,
    // Entitlements (DoD-5/-6): de bundel volgt uit plan; extra modules als
    // per-tenant override, opgelost door de entitlement-resolver.
    ...(Array.isArray(pkg.modules) && pkg.modules.length
      ? { moduleOverrides: { add: [...pkg.modules], remove: [] } }
      : {}),
    // Bestaand commercieel veld voor commissie/rapportering. GEEN
    // autorisatiebetekenis: toegang loopt uitsluitend via het
    // assignment-record (23.15).
    resellerId: org.id,
    ...(typeof commissionPct === "number" ? { commissionPct } : {}),
    invoiceProfile: {},
    onboarding: {},
    billingOps: { invoiceHistory: [] },
    supportAccess: { allowed: false },
    billingOwnership: request.billingOwnership,
    provisionedFrom: request.id,
    createdAt: now,
  };
  // Dezelfde commercial-conflictcheck als linkTenant: ook een achtergebleven
  // koppeling op dit tenant-id (bv. na overdracht) blokkeert provisioning.
  assertNoCommercialConflict(store, {
    resellerId: org.id, tenantId: tenantRow.id, relationType: "commercial",
  }, Date.now());
  const linkRow = buildLink(store, {
    resellerId: org.id, tenantId: tenantRow.id, relationType: "commercial",
    startAt: now, endAt: null, reason: `provisioning ${request.id}`,
  }, actor);
  const { secret, record } = startActivation();
  const adminRow = {
    id: `user_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    tenantId: tenantRow.id,
    name: clean(adminName || (request.endCustomer.contact && request.endCustomer.contact.name)) || "Klant admin",
    email,
    role: "tenant_admin",
    permissions: [...BUSINESS_ADMIN_PERMISSIONS],
    // Pending tot de klant-admin zelf activeert via de e-maillink: de
    // aanmaker (platform of reseller) kent nooit het wachtwoord.
    passwordHash: "",
    active: false,
    emailVerifiedAt: null,
    activation: record,
    mfaEnabled: false,
    mfaEnforced: false,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: now,
  };
  const requestBefore = {
    status: request.status,
    version: request.version,
    history: request.history,
    provisionedTenantId: request.provisionedTenantId || null,
  };

  // Fase 2 · alles-of-niets schrijven. De store heeft geen transacties; bij
  // een fout halen we de zojuist toegevoegde rijen er direct weer uit (geen
  // store.remove: dat zou tombstones schrijven voor rijen die nooit bestaan
  // hebben) en herstellen we de aanvraag. Zo blijft er nooit een halve tenant
  // achter (DoD-5).
  //
  // Volgorde binnen de try: eerst de datawrites, dan het outbox-event, en de
  // audit als LAATSTE stap. Zo bestaat er nooit een auditspoor dat een
  // provisioning claimt die is teruggedraaid. De ids van outbox-event en
  // auditregels gaan mee in de rollback, zodat ook een fout NA die stappen
  // geen spoor achterlaat.
  const inserted = [];
  const audited = [];
  try {
    store.insert("tenants", tenantRow); inserted.push(["tenants", tenantRow.id]);
    store.insert(LINKS, linkRow); inserted.push([LINKS, linkRow.id]);
    store.insert("users", adminRow); inserted.push(["users", adminRow.id]);
    store.update(REQUESTS, request.id, {
      status: "active",
      provisionedTenantId: tenantRow.id,
      version: request.version + 1,
      history: [...(request.history || []), histEntry(actor, request.status, "active", "provisioned")],
    });
    emitDomainEvent(store, {
      tenantId: tenantRow.id,
      eventType: "tenant.provisioned",
      aggregateType: "tenant",
      aggregateId: tenantRow.id,
      actor: actor.email,
      data: { resellerId: org.id, requestId: request.id, plan: tenantRow.plan, linkId: linkRow.id },
    });
    audited.push(audit(store, actor, "tenant_link_created", tenantRow.id,
      JSON.stringify({ resellerId: org.id, linkId: linkRow.id, relationType: "commercial", reden: linkRow.reason })));
    audited.push(audit(store, actor, "tenant_provisioned", tenantRow.id,
      JSON.stringify({ resellerId: org.id, requestId: request.id, plan: tenantRow.plan, admin: email })));
  } catch (cause) {
    for (const [coll, rid] of inserted.reverse()) {
      store.data[coll] = (store.data[coll] || []).filter(r => r.id !== rid);
    }
    // Outbox: emitDomainEvent kan het event al gepusht hebben voordat het
    // wegschrijven faalde · dan is er geen returnwaarde om op te filteren. De
    // tenant is in DEZE transactie ontstaan (TENANT_EXISTS bewaakt dat), dus
    // elk outbox-event op dit aggregaat hoort bij de teruggedraaide
    // provisioning en mag weg.
    store.data.outbox = (store.data.outbox || [])
      .filter(e => !(e.aggregateType === "tenant" && e.aggregateId === tenantRow.id));
    // Audit als laatste geschreven, dus bij een fout in de stappen hiervoor is
    // er nog niets te wissen · de ids gaan wel mee zodat een fout NA de audit
    // (of een extra stap later) nooit een spoor achterlaat van een
    // provisioning die niet bestaat.
    dropAuditRows(store, audited.filter(Boolean));
    // Aanvraag herstellen zonder store.update: die kan zelf de faaloorzaak zijn.
    store.data[REQUESTS] = (store.data[REQUESTS] || []).map(r => (r.id === request.id ? { ...r, ...requestBefore } : r));
    if (typeof store.save === "function") store.save();
    audit(store, actor, "tenant_provision_failed", null,
      JSON.stringify({ requestId: request.id, resellerId: org.id, fout: String((cause && cause.message) || cause).slice(0, 200) }));
    const e = err(500, "TENANT_PROVISION_FAILED", "provisioning is volledig teruggedraaid · er blijft geen halve tenant achter");
    e.cause = cause;
    throw e;
  }

  return {
    tenant: tenantRow,
    link: linkRow,
    adminUser: { id: adminRow.id, name: adminRow.name, email: adminRow.email, role: adminRow.role },
    // Alleen voor de route in dev/mock (zelfde beleid als provisionPendingUser
    // in server.js): met echte mail hoort dit token NOOIT in een respons.
    activationToken: activationToken(adminRow.id, secret),
    request: findRow(store, REQUESTS, request.id),
  };
}

// ── 23.4/23.9 · Tenantkoppeling (assignment-record) ──────────────────────────

function buildLink(store, fields, actor) {
  const startAt = fields.startAt || nowIso();
  const endAt = fields.endAt || null;
  return {
    id: id("rtl"),
    resellerId: fields.resellerId,
    tenantId: fields.tenantId,
    relationType: fields.relationType,
    status: "active",
    approvedBy: actor.email,
    reason: isBlank(fields.reason) ? null : clean(fields.reason),
    startAt,
    endAt,
    // Aliassen zodat de pure scopecheck (reseller-authz.tenantInScope leest
    // startDate/endDate) exact hetzelfde venster ziet als deze servicelaag.
    startDate: startAt,
    endDate: endAt,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    history: [changeEntry(actor, "created", null, { relationType: fields.relationType, status: "active" }, fields.reason)],
    createdAt: nowIso(),
    createdBy: actor.email,
  };
}

/**
 * Single commercial owner (23.4/23.9): een tenant heeft nooit twee actieve
 * COMMERCIELE koppelingen. Gedeeld door linkTenant en provisionTenant, zodat
 * de provisioning-tak de guard niet stil kan omzeilen.
 */
function assertNoCommercialConflict(store, { resellerId, tenantId, relationType }, nowMs) {
  if (relationType !== "commercial") return;
  const other = (store.data[LINKS] || []).find(l =>
    l.tenantId === tenantId && l.relationType === "commercial"
    && l.resellerId !== resellerId && isLinkActive(l, nowMs));
  if (other) throw err(409, "TENANT_ALREADY_ASSIGNED", "deze tenant heeft al een actieve commerciele koppeling met een andere partner");
}

function isLinkActive(link, nowMs) {
  return Boolean(link)
    && link.status === "active"
    && !link.revokedAt
    && link.relationType !== "none"
    && (!link.startAt || toMs(link.startAt) <= nowMs)
    && (!link.endAt || toMs(link.endAt) > nowMs);
}

/** De actieve koppeling tussen reseller en tenant, of null. */
function activeLinkFor(store, resellerId, tenantId, now) {
  const nowMs = toMs(now);
  return (store.data[LINKS] || []).find(l =>
    l.resellerId === resellerId && l.tenantId === tenantId && isLinkActive(l, nowMs)) || null;
}

/**
 * Koppel een tenant aan een reseller. Uitsluitend een platformactie (platform
 * partner admin): een reseller kan zichzelf NOOIT koppelen (23.4). Vereist een
 * reden (toegangstoestemming · 23.15) en bewaakt dubbele of conflicterende
 * koppelingen.
 */
function linkTenant(store, { resellerId, tenantId, relationType, startAt = null, endAt = null, reason }, actor) {
  requireActor(actor);
  if (isResellerActor(actor)) throw A.forbiddenError("SELF_LINK_FORBIDDEN");
  const org = findReseller(store, resellerId);
  D.assertOrganizationActive(org);
  if (!RELATION_TYPES.includes(relationType) || relationType === "none") {
    throw err(400, "RELATION_TYPE_INVALID",
      `relationType moet een van ${RELATION_TYPES.filter(t => t !== "none").join(", ")} zijn · geen relatie = geen record`);
  }
  const tenant = (store.data.tenants || []).find(t => t.id === tenantId);
  if (!tenant) throw A.notFoundError("tenant");
  if (isBlank(reason)) throw err(400, "REASON_REQUIRED", "een reden is verplicht bij een tenantkoppeling");
  if (startAt != null && endAt != null && !(toMs(endAt) > toMs(startAt))) {
    throw err(400, "LINK_WINDOW_INVALID", "endAt moet na startAt liggen");
  }
  // Vlaggen op de organisatie (23.2 · standaard false) voor support- en
  // beheerrelaties; per tenant blijft daarbovenop delegatie vereist (23.12).
  const flags = D.withSecurityDefaults(org);
  if (relationType === "support" && !flags.delegated_support_allowed) throw A.forbiddenError("DELEGATION_NOT_ALLOWED");
  if (relationType === "delegated_admin" && !flags.delegated_tenant_admin_allowed) throw A.forbiddenError("DELEGATION_NOT_ALLOWED");

  const nowMs = Date.now();
  if (activeLinkFor(store, resellerId, tenantId, nowMs)) {
    throw err(409, "TENANT_LINK_EXISTS", "er is al een actieve koppeling tussen deze reseller en tenant");
  }
  assertNoCommercialConflict(store, { resellerId, tenantId, relationType }, nowMs);

  const row = buildLink(store, { resellerId, tenantId, relationType, startAt, endAt, reason }, actor);
  store.insert(LINKS, row);
  audit(store, actor, "tenant_link_created", tenantId,
    JSON.stringify({ resellerId, linkId: row.id, relationType, reden: clean(reason) }));
  return row;
}

/**
 * Trek een tenantkoppeling in (platformactie, reden verplicht). Het record
 * blijft bestaan voor historische rapportering; alleen de toegang vervalt.
 * Actieve delegaties op die tenant verliezen automatisch hun werking: de
 * inhoudscheck eist altijd eerst een actieve koppeling.
 */
function revokeTenantLink(store, { linkId, reason }, actor) {
  requireActor(actor);
  if (isResellerActor(actor)) throw A.forbiddenError("SELF_LINK_FORBIDDEN");
  const link = findRow(store, LINKS, linkId);
  if (!link) throw A.notFoundError("tenant_link");
  if (isBlank(reason)) throw err(400, "REASON_REQUIRED", "een reden is verplicht bij intrekken");
  if (link.revokedAt) return link; // idempotent
  const next = store.update(LINKS, link.id, {
    status: "revoked",
    revokedAt: nowIso(),
    revokedBy: actor.email,
    revokeReason: clean(reason),
    history: [...(link.history || []), changeEntry(actor, "revoked", { status: link.status }, { status: "revoked" }, reason)],
  });
  audit(store, actor, "tenant_link_revoked", link.tenantId,
    JSON.stringify({ linkId: link.id, resellerId: link.resellerId, before: link.status, after: "revoked", reden: clean(reason) }));
  return next;
}

/**
 * Alle ACTIEVE toewijzingen van een reseller, verrijkt met uitsluitend
 * commerciele tenantmetadata (23.4). Ingetrokken, verlopen of nog niet
 * gestarte koppelingen tellen niet mee.
 */
function assignedTenants(store, resellerId, now) {
  const nowMs = toMs(now);
  return (store.data[LINKS] || [])
    .filter(l => l.resellerId === resellerId && isLinkActive(l, nowMs))
    .map(l => ({
      linkId: l.id,
      tenantId: l.tenantId,
      relationType: l.relationType,
      startAt: l.startAt,
      endAt: l.endAt,
      tenant: commercialTenantMetadata(store, l.tenantId),
    }));
}

/**
 * ALLEEN commerciele metadata van een tenant (23.4/23.16): plan, seats,
 * status en renewal. Nooit operationele data of persoonsgegevens van
 * eindklantgebruikers · klantinhoud vereist actieve gedelegeerde toegang.
 */
function commercialTenantMetadata(store, tenantId) {
  const t = (store.data.tenants || []).find(x => x.id === tenantId);
  if (!t) return null;
  return {
    tenantId: t.id,
    name: t.name,
    plan: t.plan,
    status: t.status,
    seats: t.seats || null,
    language: t.language || null,
    billingOwnership: t.billingOwnership || null,
    renewal: (t.billing && t.billing.renewalDate) || t.renewalDate || null,
    createdAt: t.createdAt || null,
  };
}

// ── 23.12 · Gedelegeerde toegang ─────────────────────────────────────────────

/**
 * Vraag gedelegeerde toegang aan voor een toegewezen tenant. Eigen record met
 * scope, reden, start- en einddatum (verplicht · 23.4) en de statusmachine
 * requested → tenant_approved → active → expired/revoked. Vereist de
 * platformvlag van de scopecategorie en een actieve tenantkoppeling.
 */
function requestDelegatedAccess(store, { resellerId, tenantId, scope, reason, startAt = null, endAt = null }, actor) {
  requireActor(actor);
  // Zelfde volgorde als requestTenant: eerst de scope-check, dan pas de
  // org-lookup · een vreemde resellerId mag nooit verraden of die organisatie
  // bestaat.
  assertSameReseller(actor, resellerId);
  const org = findReseller(store, resellerId);
  D.assertOrganizationActive(org);
  if (!activeLinkFor(store, resellerId, tenantId, Date.now())) throw A.forbiddenError("TENANT_NOT_ASSIGNED");

  const scopes = (Array.isArray(scope) ? scope : [scope]).filter(Boolean);
  const fieldErrors = {};
  if (!scopes.length) fieldErrors.scope = "scope is verplicht";
  const bad = scopes.filter(s => !DELEGATED_SCOPES[s]);
  if (bad.length) fieldErrors.scope = `ongeldige scope: ${bad.join(", ")} · geldig: ${Object.keys(DELEGATED_SCOPES).join(", ")}`;
  if (isBlank(reason)) fieldErrors.reason = "reden is verplicht";
  if (isBlank(endAt)) {
    fieldErrors.endAt = "einddatum is verplicht (beperkte toestemming met einddatum · 23.4)";
  } else if (!(toMs(endAt) > toMs(startAt || undefined))) {
    fieldErrors.endAt = "endAt moet in de toekomst en na startAt liggen";
  }
  if (Object.keys(fieldErrors).length) {
    const e = err(400, "DELEGATED_ACCESS_INVALID", "aanvraag gedelegeerde toegang is ongeldig");
    e.fieldErrors = fieldErrors;
    throw e;
  }

  const flags = D.withSecurityDefaults(org);
  for (const s of scopes) {
    const cat = DELEGATED_SCOPES[s];
    if (cat === "support" && !flags.delegated_support_allowed) throw A.forbiddenError("DELEGATION_NOT_ALLOWED");
    if (cat === "admin" && !flags.delegated_tenant_admin_allowed) throw A.forbiddenError("DELEGATION_NOT_ALLOWED");
  }

  const s0 = startAt || nowIso();
  const row = {
    id: id("rag"),
    resellerId,
    tenantId,
    scope: [...scopes],
    reason: clean(reason),
    status: D.delegatedAccess.initial, // requested
    requestedBy: actor.email,
    requestedAt: nowIso(),
    startAt: s0,
    endAt,
    // Aliassen voor reseller-authz.delegationDecision (leest startDate/endDate).
    startDate: s0,
    endDate: endAt,
    approvedBy: null,
    approvedAt: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    version: 1,
    history: [changeEntry(actor, "requested", null, { status: "requested", scope: scopes }, reason)],
    createdAt: nowIso(),
    createdBy: actor.email,
  };
  store.insert(GRANTS, row);
  audit(store, actor, "support_access_requested", tenantId,
    JSON.stringify({ resellerId, grantId: row.id, scope: scopes, reden: clean(reason) }));
  return row;
}

/**
 * Anti-probing op delegatierecords (23.15/ISO-07 · CTO2-01). Een actor zonder
 * enige relatie tot het record - een reseller van een ANDERE organisatie of de
 * admin van een ANDERE tenant - krijgt exact dezelfde 404 als bij een
 * onbestaand grant-id. Zo zijn grant-ids niet te enumereren.
 * 403 blijft voorbehouden aan gevallen waar het bestaan geen geheim is: het
 * eigen record met de verkeerde rol (bv. de reseller die zijn eigen aanvraag
 * wil goedkeuren) of in de verkeerde staat.
 */
function assertGrantVisible(grant, actor) {
  if (isResellerActor(actor)) {
    if (actor.resellerId !== grant.resellerId) throw A.notFoundError("delegated_access");
    return grant;
  }
  if (actor.role === "tenant_admin" && actor.tenantId !== grant.tenantId) {
    throw A.notFoundError("delegated_access");
  }
  return grant;
}

/**
 * Goedkeuring door de TENANT ADMIN van precies die tenant (23.4/23.12) ·
 * nooit een resellergebruiker, nooit een admin van een andere tenant, en
 * nooit de aanvrager zelf (vier-ogen).
 */
function approveDelegatedAccess(store, { grantId, activate = false }, actor) {
  requireActor(actor);
  const grant = findRow(store, GRANTS, grantId);
  if (!grant) throw A.notFoundError("delegated_access");
  assertGrantVisible(grant, actor);
  if (isResellerActor(actor) || actor.role !== "tenant_admin" || actor.tenantId !== grant.tenantId) {
    throw A.forbiddenError("DELEGATION_APPROVER_INVALID");
  }
  A.assertNotSelfApproval(actor.email, grant.requestedBy);
  D.delegatedAccess.assertTransition(grant.status, "tenant_approved");
  let next = store.update(GRANTS, grant.id, {
    status: "tenant_approved",
    approvedBy: actor.email,
    approvedAt: nowIso(),
    version: (grant.version || 1) + 1,
    history: [...(grant.history || []), changeEntry(actor, "tenant_approved", { status: grant.status }, { status: "tenant_approved" }, null)],
  });
  audit(store, actor, "support_access_approved", grant.tenantId,
    JSON.stringify({ grantId: grant.id, resellerId: grant.resellerId, before: grant.status, after: "tenant_approved" }));
  if (activate) next = activateDelegatedAccess(store, { grantId: grant.id }, actor);
  return next;
}

/**
 * Activeer een goedgekeurde delegatie (tenant_approved → active). Tenant- of
 * platformzijde; nooit de reseller zelf. Suspensie tussen aanvraag en
 * activatie blokkeert nieuwe toegang (23.4).
 */
function activateDelegatedAccess(store, { grantId }, actor) {
  requireActor(actor);
  const grant = findRow(store, GRANTS, grantId);
  if (!grant) throw A.notFoundError("delegated_access");
  assertGrantVisible(grant, actor);
  if (isResellerActor(actor)) throw A.forbiddenError("DELEGATION_ACTIVATOR_INVALID");
  D.assertOrganizationActive(findReseller(store, grant.resellerId));
  D.delegatedAccess.assertTransition(grant.status, "active");
  const next = store.update(GRANTS, grant.id, {
    status: "active",
    version: (grant.version || 1) + 1,
    history: [...(grant.history || []), changeEntry(actor, "activated", { status: grant.status }, { status: "active" }, null)],
  });
  audit(store, actor, "support_access_activated", grant.tenantId,
    JSON.stringify({ grantId: grant.id, resellerId: grant.resellerId, before: grant.status, after: "active" }));
  return next;
}

/**
 * Trek een delegatie in (reden verplicht). Toegestaan voor de tenant admin
 * van die tenant, platformbeheer, of de reseller zelf (afstand doen van eigen
 * toegang) · nooit een andere reseller. De machine kent active → revoked;
 * een nog niet geactiveerde aanvraag intrekken eindigt in dezelfde terminale
 * status (DoD-10: alle toegang en openstaande aanvragen intrekbaar).
 */
function revokeDelegatedAccess(store, { grantId, reason }, actor) {
  requireActor(actor);
  const grant = findRow(store, GRANTS, grantId);
  if (!grant) throw A.notFoundError("delegated_access");
  // Zichtbaarheid VOOR de redencheck: anders verraadt 400 REASON_REQUIRED nog
  // altijd dat het grant-id bestaat.
  assertGrantVisible(grant, actor);
  if (isBlank(reason)) throw err(400, "REASON_REQUIRED", "een reden is verplicht bij intrekken");
  if (grant.status === "revoked") return grant; // idempotent
  if (grant.status === "expired") D.delegatedAccess.assertTransition("expired", "revoked"); // 409 · terminaal
  if (grant.status === "active") D.delegatedAccess.assertTransition("active", "revoked");
  const next = store.update(GRANTS, grant.id, {
    status: "revoked",
    revokedAt: nowIso(),
    revokedBy: actor.email,
    revokeReason: clean(reason),
    version: (grant.version || 1) + 1,
    history: [...(grant.history || []), changeEntry(actor, "revoked", { status: grant.status }, { status: "revoked" }, reason)],
  });
  audit(store, actor, "support_access_revoked", grant.tenantId,
    JSON.stringify({ grantId: grant.id, resellerId: grant.resellerId, before: grant.status, after: "revoked", reden: clean(reason) }));
  return next;
}

/**
 * Systeemveegronde: actieve delegaties voorbij hun einddatum worden expired
 * (active → expired). De toegangsbeslissing zelf is hier NIET van afhankelijk:
 * delegationDecision weigert een verlopen venster ook zonder deze sweep.
 * Met opts.grantId kantelt uitsluitend dat ene record · zo kan het weigermoment
 * zelf de status bijwerken (23.14) zonder een volledige ronde te draaien.
 */
function expireDelegatedAccess(store, now, { grantId = null } = {}) {
  const nowMs = toMs(now);
  const expired = [];
  for (const grant of store.data[GRANTS] || []) {
    if (grantId && grant.id !== grantId) continue;
    if (grant.status !== "active" || !grant.endAt || !(toMs(grant.endAt) <= nowMs)) continue;
    D.delegatedAccess.assertTransition("active", "expired");
    store.update(GRANTS, grant.id, {
      status: "expired",
      version: (grant.version || 1) + 1,
      history: [...(grant.history || []), changeEntry(null, "expired", { status: "active" }, { status: "expired" }, "einddatum bereikt")],
    });
    audit(store, null, "support_access_expired", grant.tenantId,
      JSON.stringify({ grantId: grant.id, resellerId: grant.resellerId }));
    expired.push(grant.id);
  }
  return { expired: expired.length, ids: expired };
}

/** Alle delegatierecords voor een reseller/tenant-paar, nieuwste eerst. */
function delegatedAccessFor(store, resellerId, tenantId) {
  return (store.data[GRANTS] || [])
    .filter(g => g.resellerId === resellerId && g.tenantId === tenantId)
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Platformoverzicht van de koppelingen, optioneel gefilterd op reseller.
 *
 * Bestond eerder als een rechtstreekse store.data-lees in server.js. Bij het
 * extraheren naar een router kwam dat boven water: een router hoort niet in de
 * opslag te grijpen, want dan zit de vorm van de data op twee plekken.
 */
function listTenantLinks(store, { resellerId = null } = {}) {
  return (store.data[LINKS] || []).filter(l => !resellerId || l.resellerId === resellerId);
}

/** Idem voor de delegatierecords · platformbreed, met optionele filters. */
function listDelegatedAccess(store, { resellerId = null, tenantId = null } = {}) {
  return (store.data[GRANTS] || [])
    .filter(g => (!resellerId || g.resellerId === resellerId) && (!tenantId || g.tenantId === tenantId));
}

/** Is er NU een actieve delegatie die deze scope dekt? Verlopen of ingetrokken telt niet. */
function hasDelegatedAccess(store, { resellerId, tenantId, scope = null, now = null }) {
  return delegatedAccessFor(store, resellerId, tenantId)
    .some(g => A.delegationDecision(g, scope, { tenantId, now: now == null ? Date.now() : now }).ok);
}

/**
 * TODO (volgende slice · bewust niet in deze slice gebouwd): er bestaat nog
 * GEEN route die klantinhoud ontsluit (ticketinzage, configuratie, gebruikers-
 * beheer, data-export onder delegatie). Zodra die er komt is deze guard
 * verplicht - assertContentAccess VOOR elke lees- of schrijfactie en
 * logDelegatedAction erna (DoD-9) - anders is er geen vangnet.
 *
 * Toegang tot KLANTINHOUD (23.4/23.12) · twee trappen:
 *  1. actieve tenantkoppeling verplicht (maar die geeft alleen metadata);
 *  2. actieve gedelegeerde toegang die de gevraagde scope exact dekt.
 * Gooit met de meest specifieke code van het recentste record
 * (EXPIRED/REVOKED/NOT_ACTIVE/SCOPE_EXCEEDED) of DELEGATED_ACCESS_REQUIRED.
 *
 * Het weigermoment is meteen het kantelmoment (23.14/DLG-03): een grant die op
 * "active" staat maar voorbij zijn einddatum is, gaat hier direct naar
 * "expired". Het statusmodel klopt daardoor zonder op de handmatige
 * admin-sweep te wachten · de beslissing zelf verandert er niet door.
 */
function assertContentAccess(store, { resellerId, tenantId, scope = null, now = null }) {
  const nowMs = now == null ? Date.now() : toMs(now);
  const link = activeLinkFor(store, resellerId, tenantId, nowMs);
  if (!link) throw A.forbiddenError("TENANT_NOT_ASSIGNED");
  let firstDenial = null;
  for (const grant of delegatedAccessFor(store, resellerId, tenantId)) {
    const decision = A.delegationDecision(grant, scope, { tenantId, now: nowMs });
    if (decision.ok) return { link, grant };
    if (decision.code === "DELEGATED_ACCESS_EXPIRED" && grant.status === "active") {
      expireDelegatedAccess(store, nowMs, { grantId: grant.id });
    }
    if (!firstDenial) firstDenial = decision; // nieuwste record = meest relevante reden
  }
  const code = firstDenial ? firstDenial.code : "DELEGATED_ACCESS_REQUIRED";
  throw err(403, code, "Geen toegang");
}

/**
 * Log een beheer- of supportactie die ONDER een delegatie is uitgevoerd
 * (DoD-9): actor = de resellergebruiker, tenantId = de represented tenant,
 * detail met reseller, grant, actie en before/after. Nooit als
 * eindklantgebruiker gelogd.
 */
function logDelegatedAction(store, { grantId, action, before = null, after = null, reason = null }, actor) {
  requireActor(actor);
  const grant = findRow(store, GRANTS, grantId);
  if (!grant) throw A.notFoundError("delegated_access");
  assertGrantVisible(grant, actor);
  audit(store, actor, "support_access_action", grant.tenantId,
    JSON.stringify({ grantId: grant.id, resellerId: grant.resellerId, actie: clean(action), before, after, reden: isBlank(reason) ? null : clean(reason) }));
  return true;
}

// ── 23.14/DoD-10 · Suspensie en offboarding ──────────────────────────────────

/**
 * Trek in EEN veegronde alle actieve en openstaande delegaties van een
 * reseller in, en optioneel ook de tenantkoppelingen (offboarding).
 * Platformactie. Records blijven bestaan: historische rapportering en
 * financiele data gaan nooit verloren (DoD-10).
 */
function revokeAllAccess(store, { resellerId, reason, includeLinks = false }, actor) {
  requireActor(actor);
  if (isResellerActor(actor)) throw A.forbiddenError("SELF_LINK_FORBIDDEN");
  if (isBlank(reason)) throw err(400, "REASON_REQUIRED", "een reden is verplicht (suspensie/offboarding)");
  let grants = 0;
  for (const grant of store.data[GRANTS] || []) {
    if (grant.resellerId !== resellerId) continue;
    if (!["requested", "tenant_approved", "active"].includes(grant.status)) continue;
    store.update(GRANTS, grant.id, {
      status: "revoked",
      revokedAt: nowIso(),
      revokedBy: actor.email,
      revokeReason: clean(reason),
      version: (grant.version || 1) + 1,
      history: [...(grant.history || []), changeEntry(actor, "revoked", { status: grant.status }, { status: "revoked" }, reason)],
    });
    audit(store, actor, "support_access_revoked", grant.tenantId,
      JSON.stringify({ grantId: grant.id, resellerId, before: grant.status, after: "revoked", reden: clean(reason) }));
    grants += 1;
  }
  let links = 0;
  if (includeLinks) {
    const nowMs = Date.now();
    for (const link of store.data[LINKS] || []) {
      if (link.resellerId !== resellerId || !isLinkActive(link, nowMs)) continue;
      store.update(LINKS, link.id, {
        status: "revoked",
        revokedAt: nowIso(),
        revokedBy: actor.email,
        revokeReason: clean(reason),
        history: [...(link.history || []), changeEntry(actor, "revoked", { status: link.status }, { status: "revoked" }, reason)],
      });
      audit(store, actor, "tenant_link_revoked", link.tenantId,
        JSON.stringify({ linkId: link.id, resellerId, before: "active", after: "revoked", reden: clean(reason) }));
      links += 1;
    }
  }
  audit(store, actor, "support_access_revoked_all", null,
    JSON.stringify({ resellerId, grants, links, reden: clean(reason) }));
  return { revokedGrants: grants, revokedLinks: links };
}

module.exports = {
  // constanten
  RELATION_TYPES, BILLING_OWNERSHIP, DELEGATED_SCOPES,
  // tenantaanvraag (23.9)
  requestTenant, transitionTenantRequest, getTenantRequest, listTenantRequests,
  // provisioning (DoD-5)
  provisionTenant,
  // tenantkoppeling (23.4/23.9)
  linkTenant, revokeTenantLink, activeLinkFor, assignedTenants, commercialTenantMetadata,
  listTenantLinks, listDelegatedAccess,
  // gedelegeerde toegang (23.12)
  requestDelegatedAccess, approveDelegatedAccess, activateDelegatedAccess,
  revokeDelegatedAccess, expireDelegatedAccess, delegatedAccessFor,
  hasDelegatedAccess, assertContentAccess, logDelegatedAction,
  // suspensie/offboarding (DoD-10)
  revokeAllAccess,
};
