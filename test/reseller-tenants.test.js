"use strict";

// Tests voor src/modules/reseller-tenants.js (spec 23.4 + 23.9 + 23.12).
// Dekt o.a.: zelf-koppelen geweigerd, verlopen/ingetrokken delegatie geeft
// geen toegang, commerciele koppeling geeft geen klantinhoud, en
// provisioning-rollback (DoD-5).

const { test } = require("node:test");
const assert = require("node:assert");
const svc = require("../src/modules/reseller-tenants");

function baseData() {
  return {
    resellers: [
      { id: "resA", name: "Partner A", status: "active", delegated_support_allowed: true, delegated_tenant_admin_allowed: true, billing_email: "finance@partnera.be" },
      { id: "resB", name: "Partner B", status: "active", delegated_support_allowed: true, delegated_tenant_admin_allowed: true },
      { id: "resC", name: "Partner C zonder vlaggen", status: "active" },
      { id: "resS", name: "Suspended partner", status: "suspended" },
    ],
    tenants: [{ id: "t1", name: "Klant 1", plan: "business", status: "active", seats: 4 }],
    users: [],
    resellerTenantRequests: [],
    resellerTenantLinks: [],
    resellerAccessGrants: [],
    resellerDeals: [],
    outbox: [],
    audit: [],
  };
}

let auditSeq = 0;

function fakeStore(data = baseData()) {
  return {
    data,
    insert(coll, row) { (data[coll] = data[coll] || []).push(row); return row; },
    update(coll, id, patch) {
      data[coll] = data[coll].map(r => (r.id === id ? { ...r, ...patch } : r));
      return data[coll].find(r => r.id === id);
    },
    get(coll, id) { return (data[coll] || []).find(r => r.id === id); },
    // Zoals de echte store (platform/audit-log.appendAudit): de geschreven rij
    // krijgt een id en wordt teruggegeven, zodat een transactionele actie haar
    // auditregels in de rollback kan opnemen.
    audit(e) { const row = { id: `audit_${++auditSeq}`, ...e }; data.audit.push(row); return row; },
    save() {},
  };
}

const platformAdmin = { email: "super@monargo.one", role: "super_admin" };
const resellerUserA = { email: "sales@partnera.be", role: "reseller", resellerId: "resA" };
const resellerUserB = { email: "sales@partnerb.be", role: "reseller", resellerId: "resB" };
const tenantAdminT1 = { email: "admin@klant1.be", role: "tenant_admin", tenantId: "t1" };

function validInput(overrides = {}) {
  return {
    resellerId: "resA",
    endCustomer: {
      legalName: "Bakkerij Janssens BV",
      enterpriseVat: "BE 0123.456.789",
      address: { straat: "Kerkstraat", nummer: "12", postcode: "2000", gemeente: "Antwerpen", land: "BE" },
      contact: { name: "Jan Janssens", email: "jan@bakkerij.be" },
      language: "nl",
      sector: "bouw",
    },
    package: { plan: "business", modules: ["projects"], seats: 5, trial: true, term: "12m" },
    billingOwnership: "via_reseller",
    ...overrides,
  };
}

// Aanvraag door de reseller, dan door het platform tot "review" gebracht.
function requestInReview(store) {
  const row = svc.requestTenant(store, validInput(), resellerUserA);
  svc.transitionTenantRequest(store, { requestId: row.id, to: "submitted" }, resellerUserA);
  svc.transitionTenantRequest(store, { requestId: row.id, to: "customer_confirmation" }, platformAdmin);
  svc.transitionTenantRequest(store, { requestId: row.id, to: "review" }, platformAdmin);
  return svc.getTenantRequest(store, row.id);
}

function linkT1(store, resellerId = "resA") {
  return svc.linkTenant(store, { resellerId, tenantId: "t1", relationType: "commercial", reason: "verkoop" }, platformAdmin);
}

function activeGrant(store, { scope = ["config_write"], endAt = new Date(Date.now() + 3600e3).toISOString() } = {}) {
  linkT1(store);
  const g = svc.requestDelegatedAccess(store, {
    resellerId: "resA", tenantId: "t1", scope, reason: "configuratiehulp", endAt,
  }, resellerUserA);
  svc.approveDelegatedAccess(store, { grantId: g.id, activate: true }, tenantAdminT1);
  return svc.data ? null : store.get("resellerAccessGrants", g.id);
}

// ── 23.9 · tenantaanvraag ────────────────────────────────────────────────────

test("requestTenant · maakt draft-aanvraag met actor-audit", () => {
  const store = fakeStore();
  const row = svc.requestTenant(store, validInput(), resellerUserA);
  assert.equal(row.status, "draft");
  assert.equal(row.resellerId, "resA");
  assert.equal(row.createdBy, "sales@partnera.be");
  assert.equal(row.endCustomer.language, "NL");
  assert.equal(row.endCustomer.enterpriseVat, "BE0123456789");
  assert.equal(row.version, 1);
  const a = store.data.audit.find(x => x.action === "tenant_request_created");
  assert.ok(a);
  assert.equal(a.actor, "sales@partnera.be"); // resellergebruiker, nooit eindklant
});

test("requestTenant · gesuspendeerde reseller geweigerd (23.4)", () => {
  const store = fakeStore();
  assert.throws(() => svc.requestTenant(store, validInput({ resellerId: "resS" }), platformAdmin),
    e => e.status === 403 && e.code === "RESELLER_NOT_ACTIVE");
});

test("requestTenant · veldvalidatie geeft fieldErrors", () => {
  const store = fakeStore();
  const input = validInput();
  delete input.endCustomer.legalName;
  input.endCustomer.language = "DE";
  input.endCustomer.address = { straat: "Kerkstraat" };
  input.billingOwnership = "cash";
  assert.throws(() => svc.requestTenant(store, input, resellerUserA), e => {
    assert.equal(e.code, "TENANT_REQUEST_INVALID");
    assert.ok(e.fieldErrors["endCustomer.legalName"]);
    assert.ok(e.fieldErrors["endCustomer.language"]);
    assert.ok(e.fieldErrors["endCustomer.address"].includes("nummer"));
    assert.ok(e.fieldErrors.billingOwnership);
    return true;
  });
  assert.equal(store.data.resellerTenantRequests.length, 0);
});

test("requestTenant · vreemde resellerId is harde scopefout (ISO)", () => {
  const store = fakeStore();
  assert.throws(() => svc.requestTenant(store, validInput(), resellerUserB),
    e => e.code === "RESELLER_SCOPE_VIOLATION");
});

test("requestTenant · scope-check gaat VOOR de org-lookup · bestaan van partners lekt niet", () => {
  const store = fakeStore();
  const grijp = fn => { try { fn(); return null; } catch (e) { return e; } };
  // resA bestaat, res_bestaat_niet niet · beide zijn voor resellerUserB een
  // vreemde organisatie en moeten daarom exact dezelfde weigering geven.
  const bestaand = grijp(() => svc.requestTenant(store, validInput({ resellerId: "resA" }), resellerUserB));
  const onbestaand = grijp(() => svc.requestTenant(store, validInput({ resellerId: "res_bestaat_niet" }), resellerUserB));
  assert.ok(bestaand && onbestaand);
  assert.equal(bestaand.code, "RESELLER_SCOPE_VIOLATION");
  assert.equal(bestaand.code, onbestaand.code);
  assert.equal(bestaand.status, onbestaand.status);
  assert.equal(bestaand.message, onbestaand.message);
  // Zelfde volgorde in de delegatie-aanvraag.
  const dlgBestaand = grijp(() => svc.requestDelegatedAccess(store, { resellerId: "resA", tenantId: "t1", scope: ["ticket_view"], reason: "x", endAt: new Date(Date.now() + 3600e3).toISOString() }, resellerUserB));
  const dlgOnbestaand = grijp(() => svc.requestDelegatedAccess(store, { resellerId: "res_bestaat_niet", tenantId: "t1", scope: ["ticket_view"], reason: "x", endAt: new Date(Date.now() + 3600e3).toISOString() }, resellerUserB));
  assert.equal(dlgBestaand.code, "RESELLER_SCOPE_VIOLATION");
  assert.equal(dlgBestaand.code, dlgOnbestaand.code);
  // Monargo-zijde (geen eigen resellerId) merkt geen verschil met vroeger.
  assert.throws(() => svc.requestTenant(store, validInput({ resellerId: "res_bestaat_niet" }), platformAdmin),
    e => e.status === 404 && e.code === "RESELLER_NOT_FOUND");
});

test("requestTenant · onbestaande deal faalt dicht", () => {
  const store = fakeStore();
  assert.throws(() => svc.requestTenant(store, validInput({ dealId: "deal_x" }), resellerUserA),
    e => e.status === 404 && e.code === "DEAL_NOT_FOUND");
});

test("transition · reseller dient in, platform-only stappen geweigerd voor reseller", () => {
  const store = fakeStore();
  const row = svc.requestTenant(store, validInput(), resellerUserA);
  const next = svc.transitionTenantRequest(store, { requestId: row.id, to: "submitted" }, resellerUserA);
  assert.equal(next.status, "submitted");
  assert.equal(next.version, 2);
  assert.throws(() => svc.transitionTenantRequest(store, { requestId: row.id, to: "customer_confirmation" }, resellerUserA),
    e => e.status === 403 && e.code === "TENANT_REQUEST_PLATFORM_ONLY");
});

test("transition · ongeldige sprong volgt statusmachine 23.14", () => {
  const store = fakeStore();
  const row = svc.requestTenant(store, validInput(), resellerUserA);
  assert.throws(() => svc.transitionTenantRequest(store, { requestId: row.id, to: "review" }, platformAdmin),
    e => e.status === 409 && e.code === "TENANT_REQUEST_TRANSITION_INVALID");
});

test("transition · rechtstreeks naar active geweigerd: alleen provisionTenant", () => {
  const store = fakeStore();
  const row = requestInReview(store);
  svc.transitionTenantRequest(store, { requestId: row.id, to: "provisioning" }, platformAdmin);
  assert.throws(() => svc.transitionTenantRequest(store, { requestId: row.id, to: "active" }, platformAdmin),
    e => e.code === "TENANT_REQUEST_USE_PROVISION");
});

test("transition · afwijzen vereist reden + expectedVersion bewaakt conflicten", () => {
  const store = fakeStore();
  const row = requestInReview(store);
  svc.transitionTenantRequest(store, { requestId: row.id, to: "provisioning" }, platformAdmin);
  const cur = svc.getTenantRequest(store, row.id);
  assert.throws(() => svc.transitionTenantRequest(store, { requestId: row.id, to: "rejected" }, platformAdmin),
    e => e.code === "REASON_REQUIRED");
  assert.throws(() => svc.transitionTenantRequest(store, { requestId: row.id, to: "rejected", reason: "x", expectedVersion: 1 }, platformAdmin),
    e => e.code === "VERSION_CONFLICT" && e.currentVersion === cur.version);
  const next = svc.transitionTenantRequest(store, { requestId: row.id, to: "rejected", reason: "kredietcheck faalt", expectedVersion: cur.version }, platformAdmin);
  assert.equal(next.status, "rejected");
  const h = next.history[next.history.length - 1];
  assert.equal(h.reason, "kredietcheck faalt"); // reden + before/after in history
  assert.equal(h.from, "provisioning");
});

// ── DoD-5 · provisioning ─────────────────────────────────────────────────────

test("provisionTenant · schrijft tenant, relatie, entitlements, admin en audit/outbox", () => {
  const store = fakeStore();
  const row = requestInReview(store);
  const out = svc.provisionTenant(store, { requestId: row.id }, platformAdmin);

  // klant/tenant
  assert.equal(out.tenant.name, "Bakkerij Janssens BV");
  assert.equal(out.tenant.status, "trial");
  assert.equal(out.tenant.resellerId, "resA");
  assert.equal(out.tenant.billingEmail, "finance@partnera.be"); // via_reseller
  // entitlements
  assert.equal(out.tenant.plan, "business");
  assert.deepEqual(out.tenant.moduleOverrides, { add: ["projects"], remove: [] });
  assert.equal(out.tenant.seats, 5);
  // tenantrelatie = eigen record
  assert.equal(out.link.relationType, "commercial");
  assert.equal(out.link.approvedBy, "super@monargo.one");
  assert.equal(out.link.status, "active");
  // eerste admin: pending tot eigen activatie
  const admin = store.data.users.find(u => u.id === out.adminUser.id);
  assert.equal(admin.role, "tenant_admin");
  assert.equal(admin.active, false);
  assert.equal(admin.passwordHash, "");
  assert.ok(admin.activation && admin.activation.tokenHash);
  assert.ok(out.activationToken.startsWith(admin.id + "~"));
  // aanvraag afgesloten
  assert.equal(out.request.status, "active");
  assert.equal(out.request.provisionedTenantId, out.tenant.id);
  // audit + outbox
  assert.ok(store.data.audit.some(a => a.action === "tenant_provisioned" && a.tenantId === out.tenant.id));
  const evt = store.data.outbox.find(e => e.eventType === "tenant.provisioned");
  assert.ok(evt);
  assert.equal(evt.tenantId, out.tenant.id);
  assert.equal(evt.data.resellerId, "resA");
});

test("provisionTenant · reseller mag nooit zelf provisioneren/koppelen (23.4)", () => {
  const store = fakeStore();
  const row = requestInReview(store);
  assert.throws(() => svc.provisionTenant(store, { requestId: row.id }, resellerUserA),
    e => e.status === 403 && e.code === "SELF_LINK_FORBIDDEN");
});

test("provisionTenant · verkeerde beginstatus volgt de machine", () => {
  const store = fakeStore();
  const row = svc.requestTenant(store, validInput(), resellerUserA);
  assert.throws(() => svc.provisionTenant(store, { requestId: row.id }, platformAdmin),
    e => e.code === "TENANT_REQUEST_TRANSITION_INVALID");
});

test("provisionTenant · rollback: geen halve tenant bij een fout halverwege", () => {
  const store = fakeStore();
  const row = requestInReview(store);
  const before = {
    tenants: store.data.tenants.length,
    users: store.data.users.length,
    links: store.data.resellerTenantLinks.length,
  };
  const origUpdate = store.update.bind(store);
  let armed = true;
  store.update = (coll, rid, patch) => {
    if (armed && coll === "resellerTenantRequests") { armed = false; throw new Error("schijf vol"); }
    return origUpdate(coll, rid, patch);
  };
  assert.throws(() => svc.provisionTenant(store, { requestId: row.id }, platformAdmin),
    e => e.status === 500 && e.code === "TENANT_PROVISION_FAILED");
  assert.equal(store.data.tenants.length, before.tenants);
  assert.equal(store.data.users.length, before.users);
  assert.equal(store.data.resellerTenantLinks.length, before.links);
  assert.equal(svc.getTenantRequest(store, row.id).status, "review"); // aanvraag hersteld
  assert.equal(store.data.outbox.length, 0); // geen event voor een niet-bestaande tenant
  assert.ok(store.data.audit.some(a => a.action === "tenant_provision_failed"));
});

test("provisionTenant · een BESTAANDE tenant kan nooit gedupliceerd worden (409)", () => {
  const store = fakeStore();
  const row = requestInReview(store);
  // t1 bestaat al · store.insert bewaakt geen unieke ids, dus zonder deze guard
  // ontstond er een tweede tenantrij met hetzelfde id plus een actieve
  // commerciele koppeling daarop (omweg rond linkTenant).
  assert.throws(() => svc.provisionTenant(store, { requestId: row.id, tenantId: "t1" }, platformAdmin),
    e => e.status === 409 && e.code === "TENANT_EXISTS");
  assert.equal(store.data.tenants.filter(t => t.id === "t1").length, 1);
  assert.equal(store.data.resellerTenantLinks.length, 0);
  assert.equal(svc.getTenantRequest(store, row.id).status, "review", "aanvraag onaangeroerd");
});

test("provisionTenant · commercial-conflictcheck geldt ook in de provisioning-tak", () => {
  const store = fakeStore();
  const row = requestInReview(store);
  // Achtergebleven commerciele koppeling van een ANDERE partner op het
  // gevraagde tenant-id (bv. na een overdracht waarbij de tenantrij verdween).
  store.data.resellerTenantLinks.push({
    id: "rtl_oud", resellerId: "resB", tenantId: "t_nieuw", relationType: "commercial",
    status: "active", startAt: null, endAt: null, revokedAt: null, history: [],
  });
  assert.throws(() => svc.provisionTenant(store, { requestId: row.id, tenantId: "t_nieuw" }, platformAdmin),
    e => e.status === 409 && e.code === "TENANT_ALREADY_ASSIGNED");
  assert.equal(store.data.tenants.some(t => t.id === "t_nieuw"), false);
  assert.equal(store.data.resellerTenantLinks.length, 1, "alleen de oude koppeling");
});

test("provisionTenant · rollback wist ook audit en outbox bij een fout na de datawrites", () => {
  const store = fakeStore();
  const row = requestInReview(store);
  const before = {
    tenants: store.data.tenants.length,
    users: store.data.users.length,
    links: store.data.resellerTenantLinks.length,
    audit: store.data.audit.length,
  };
  // emitDomainEvent pusht het event en roept dan store.save aan · laat die ene
  // aanroep falen, zodat de fout NA de datawrites en NA de outbox-push valt.
  let armed = true;
  store.save = () => { if (armed) { armed = false; throw new Error("outbox-sink onbereikbaar"); } };
  assert.throws(() => svc.provisionTenant(store, { requestId: row.id }, platformAdmin),
    e => e.status === 500 && e.code === "TENANT_PROVISION_FAILED");

  assert.equal(store.data.tenants.length, before.tenants);
  assert.equal(store.data.users.length, before.users);
  assert.equal(store.data.resellerTenantLinks.length, before.links);
  assert.equal(store.data.outbox.length, 0, "geen event voor een teruggedraaide provisioning");
  assert.equal(svc.getTenantRequest(store, row.id).status, "review");
  // Kern van de bevinding: GEEN auditspoor dat een provisioning claimt.
  assert.equal(store.data.audit.some(a => a.action === "tenant_link_created"), false);
  assert.equal(store.data.audit.some(a => a.action === "tenant_provisioned"), false);
  // Alleen de faalregel komt erbij.
  assert.equal(store.data.audit.length, before.audit + 1);
  assert.equal(store.data.audit[store.data.audit.length - 1].action, "tenant_provision_failed");
});

test("provisionTenant · rollback wist ook een al geschreven auditregel bij een fout in de audit zelf", () => {
  const store = fakeStore();
  const row = requestInReview(store);
  const auditBefore = store.data.audit.length;
  // Eerste auditregel (tenant_link_created) lukt, de tweede faalt: de eerste
  // mag geen spoor achterlaten van een provisioning die is teruggedraaid.
  const origAudit = store.audit.bind(store);
  store.audit = e => {
    if (e.action === "tenant_provisioned") throw new Error("auditopslag onbereikbaar");
    return origAudit(e);
  };
  assert.throws(() => svc.provisionTenant(store, { requestId: row.id }, platformAdmin),
    e => e.code === "TENANT_PROVISION_FAILED");
  assert.equal(store.data.audit.some(a => a.action === "tenant_link_created"), false);
  assert.equal(store.data.audit.length, auditBefore + 1); // enkel tenant_provision_failed
  assert.equal(store.data.outbox.length, 0);
  assert.equal(store.data.tenants.length, 1);
});

test("provisionTenant · dubbele admin-mail en tenantplafond falen VOOR er geschreven wordt", () => {
  const store = fakeStore();
  store.data.users.push({ id: "u1", email: "jan@bakkerij.be", tenantId: "t1" });
  const row = requestInReview(store);
  assert.throws(() => svc.provisionTenant(store, { requestId: row.id }, platformAdmin),
    e => e.code === "ADMIN_EMAIL_IN_USE");
  assert.equal(store.data.tenants.length, 1);

  // plafond: bestaande actieve koppeling + max_managed_tenants = 1
  store.data.users = [];
  store.data.resellers = store.data.resellers.map(r => (r.id === "resA" ? { ...r, max_managed_tenants: 1 } : r));
  linkT1(store);
  assert.throws(() => svc.provisionTenant(store, { requestId: row.id }, platformAdmin),
    e => e.code === "TENANT_CAP_REACHED");
});

// ── 23.4 · tenantkoppeling ───────────────────────────────────────────────────

test("linkTenant · reseller kan zichzelf nooit koppelen", () => {
  const store = fakeStore();
  assert.throws(() => svc.linkTenant(store, { resellerId: "resA", tenantId: "t1", relationType: "commercial", reason: "x" }, resellerUserA),
    e => e.status === 403 && e.code === "SELF_LINK_FORBIDDEN");
  assert.equal(store.data.resellerTenantLinks.length, 0);
});

test("linkTenant · platformkoppeling, dubbele en conflicterende koppelingen", () => {
  const store = fakeStore();
  const link = linkT1(store);
  assert.equal(link.approvedBy, "super@monargo.one");
  assert.equal(link.startDate, link.startAt); // alias voor reseller-authz.tenantInScope
  assert.throws(() => linkT1(store), e => e.code === "TENANT_LINK_EXISTS");
  assert.throws(() => linkT1(store, "resB"), e => e.code === "TENANT_ALREADY_ASSIGNED");
  assert.throws(() => svc.linkTenant(store, { resellerId: "resA", tenantId: "t1", relationType: "none", reason: "x" }, platformAdmin),
    e => e.code === "RELATION_TYPE_INVALID");
  assert.throws(() => svc.linkTenant(store, { resellerId: "resA", tenantId: "onbekend", relationType: "commercial", reason: "x" }, platformAdmin),
    e => e.status === 404 && e.code === "TENANT_NOT_FOUND");
});

test("linkTenant · reden verplicht + supportrelatie vereist platformvlag", () => {
  const store = fakeStore();
  assert.throws(() => svc.linkTenant(store, { resellerId: "resA", tenantId: "t1", relationType: "commercial", reason: " " }, platformAdmin),
    e => e.code === "REASON_REQUIRED");
  // resC heeft geen vlaggen: veiligheidsdefaults zijn false (23.2)
  assert.throws(() => svc.linkTenant(store, { resellerId: "resC", tenantId: "t1", relationType: "support", reason: "support" }, platformAdmin),
    e => e.code === "DELEGATION_NOT_ALLOWED");
  assert.throws(() => svc.linkTenant(store, { resellerId: "resC", tenantId: "t1", relationType: "delegated_admin", reason: "beheer" }, platformAdmin),
    e => e.code === "DELEGATION_NOT_ALLOWED");
});

test("assignedTenants · alleen actieve koppelingen, alleen commerciele metadata", () => {
  const store = fakeStore();
  store.data.tenants.push({ id: "t2", name: "Klant 2", plan: "pro", status: "active" });
  linkT1(store);
  // verlopen koppeling telt niet mee
  svc.linkTenant(store, {
    resellerId: "resA", tenantId: "t2", relationType: "commercial", reason: "oud",
    startAt: "2020-01-01T00:00:00.000Z", endAt: "2021-01-01T00:00:00.000Z",
  }, platformAdmin);
  const rows = svc.assignedTenants(store, "resA");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tenantId, "t1");
  // uitsluitend commerciele velden · nooit klantinhoud
  assert.deepEqual(Object.keys(rows[0].tenant).sort(), [
    "billingOwnership", "createdAt", "language", "name", "plan", "renewal", "seats", "status", "tenantId",
  ]);
  // en niets voor een andere reseller (cross-reseller negatief)
  assert.equal(svc.assignedTenants(store, "resB").length, 0);
});

test("revokeTenantLink · reden verplicht, daarna geen actieve toewijzing meer", () => {
  const store = fakeStore();
  const link = linkT1(store);
  assert.throws(() => svc.revokeTenantLink(store, { linkId: link.id }, platformAdmin),
    e => e.code === "REASON_REQUIRED");
  const next = svc.revokeTenantLink(store, { linkId: link.id, reason: "contract beeindigd" }, platformAdmin);
  assert.equal(next.status, "revoked");
  assert.ok(next.revokedAt);
  assert.equal(svc.assignedTenants(store, "resA").length, 0);
  const h = next.history[next.history.length - 1];
  assert.deepEqual({ before: h.before, after: h.after }, { before: { status: "active" }, after: { status: "revoked" } });
});

// ── 23.12 · gedelegeerde toegang ─────────────────────────────────────────────

test("requestDelegatedAccess · vereist actieve koppeling, scope, reden en einddatum", () => {
  const store = fakeStore();
  const endAt = new Date(Date.now() + 3600e3).toISOString();
  // zonder koppeling: geweigerd
  assert.throws(() => svc.requestDelegatedAccess(store, { resellerId: "resA", tenantId: "t1", scope: ["config_write"], reason: "x", endAt }, resellerUserA),
    e => e.code === "TENANT_NOT_ASSIGNED");
  linkT1(store);
  assert.throws(() => svc.requestDelegatedAccess(store, { resellerId: "resA", tenantId: "t1", scope: ["alles"], reason: "x", endAt }, resellerUserA),
    e => e.code === "DELEGATED_ACCESS_INVALID" && Boolean(e.fieldErrors.scope));
  assert.throws(() => svc.requestDelegatedAccess(store, { resellerId: "resA", tenantId: "t1", scope: ["config_write"], reason: "x" }, resellerUserA),
    e => e.code === "DELEGATED_ACCESS_INVALID" && Boolean(e.fieldErrors.endAt));
  const g = svc.requestDelegatedAccess(store, { resellerId: "resA", tenantId: "t1", scope: ["config_write"], reason: "configuratiehulp", endAt }, resellerUserA);
  assert.equal(g.status, "requested");
  assert.equal(g.requestedBy, "sales@partnera.be");
  assert.equal(g.endDate, endAt); // alias voor delegationDecision
});

test("requestDelegatedAccess · platformvlaggen standaard false blokkeren (23.2)", () => {
  const store = fakeStore();
  svc.linkTenant(store, { resellerId: "resC", tenantId: "t1", relationType: "commercial", reason: "verkoop" }, platformAdmin);
  const endAt = new Date(Date.now() + 3600e3).toISOString();
  const actorC = { email: "sales@partnerc.be", role: "reseller", resellerId: "resC" };
  assert.throws(() => svc.requestDelegatedAccess(store, { resellerId: "resC", tenantId: "t1", scope: ["ticket_view"], reason: "x", endAt }, actorC),
    e => e.code === "DELEGATION_NOT_ALLOWED");
  assert.throws(() => svc.requestDelegatedAccess(store, { resellerId: "resC", tenantId: "t1", scope: ["config_write"], reason: "x", endAt }, actorC),
    e => e.code === "DELEGATION_NOT_ALLOWED");
});

test("approve · alleen de tenant admin van DIE tenant, nooit een reseller of zelf", () => {
  const store = fakeStore();
  linkT1(store);
  const endAt = new Date(Date.now() + 3600e3).toISOString();
  const g = svc.requestDelegatedAccess(store, { resellerId: "resA", tenantId: "t1", scope: ["config_write"], reason: "hulp", endAt }, resellerUserA);
  // Eigen reseller, verkeerde rol: het bestaan van het record is voor hem geen
  // geheim (hij vroeg het zelf aan), dus 403 blijft correct.
  assert.throws(() => svc.approveDelegatedAccess(store, { grantId: g.id }, resellerUserA),
    e => e.code === "DELEGATION_APPROVER_INVALID");
  // GEWIJZIGD GEDRAG (anti-probing, CTO2-01): een admin van een ANDERE tenant
  // kreeg 403 DELEGATION_APPROVER_INVALID en daarmee de bevestiging dat dit
  // grant-id bestaat. Nu dezelfde 404 als bij een onbestaand id.
  assert.throws(() => svc.approveDelegatedAccess(store, { grantId: g.id }, { email: "admin@ander.be", role: "tenant_admin", tenantId: "t99" }),
    e => e.code === "DELEGATED_ACCESS_NOT_FOUND" && e.status === 404);
  // zelfde persoon als aanvrager: vier-ogen geweigerd
  assert.throws(() => svc.approveDelegatedAccess(store, { grantId: g.id }, { email: "sales@partnera.be", role: "tenant_admin", tenantId: "t1" }),
    e => e.code === "SELF_APPROVAL_FORBIDDEN");
  const approved = svc.approveDelegatedAccess(store, { grantId: g.id }, tenantAdminT1);
  assert.equal(approved.status, "tenant_approved");
  assert.equal(approved.approvedBy, "admin@klant1.be");
});

test("activate · machinevolgorde en nooit door de reseller zelf", () => {
  const store = fakeStore();
  linkT1(store);
  const endAt = new Date(Date.now() + 3600e3).toISOString();
  const g = svc.requestDelegatedAccess(store, { resellerId: "resA", tenantId: "t1", scope: ["config_write"], reason: "hulp", endAt }, resellerUserA);
  // requested → active mag niet (eerst tenant_approved)
  assert.throws(() => svc.activateDelegatedAccess(store, { grantId: g.id }, tenantAdminT1),
    e => e.code === "DELEGATED_ACCESS_TRANSITION_INVALID");
  svc.approveDelegatedAccess(store, { grantId: g.id }, tenantAdminT1);
  assert.throws(() => svc.activateDelegatedAccess(store, { grantId: g.id }, resellerUserA),
    e => e.code === "DELEGATION_ACTIVATOR_INVALID");
  const active = svc.activateDelegatedAccess(store, { grantId: g.id }, tenantAdminT1);
  assert.equal(active.status, "active");
  assert.ok(svc.hasDelegatedAccess(store, { resellerId: "resA", tenantId: "t1", scope: "config_write" }));
});

test("klantinhoud · actieve delegatie geeft toegang, scope wordt exact gematcht", () => {
  const store = fakeStore();
  activeGrant(store, { scope: ["config_write"] });
  const ok = svc.assertContentAccess(store, { resellerId: "resA", tenantId: "t1", scope: "config_write" });
  assert.ok(ok.link && ok.grant);
  // andere scope: geweigerd (read impliceert nooit write en omgekeerd)
  assert.throws(() => svc.assertContentAccess(store, { resellerId: "resA", tenantId: "t1", scope: "data_export" }),
    e => e.code === "DELEGATED_SCOPE_EXCEEDED");
});

test("klantinhoud · commerciele koppeling ALLEEN geeft geen klantinhoud (23.4)", () => {
  const store = fakeStore();
  linkT1(store);
  // metadata: wel zichtbaar
  assert.equal(svc.assignedTenants(store, "resA")[0].tenant.name, "Klant 1");
  // inhoud: geweigerd zonder delegatie
  assert.throws(() => svc.assertContentAccess(store, { resellerId: "resA", tenantId: "t1", scope: "ticket_view" }),
    e => e.status === 403 && e.code === "DELEGATED_ACCESS_REQUIRED");
  assert.equal(svc.hasDelegatedAccess(store, { resellerId: "resA", tenantId: "t1", scope: "ticket_view" }), false);
});

test("klantinhoud · verlopen delegatie geeft GEEN toegang meer", () => {
  const store = fakeStore();
  const endAt = new Date(Date.now() + 3600e3).toISOString();
  activeGrant(store, { scope: ["config_write"], endAt });
  const later = Date.now() + 2 * 3600e3; // na de einddatum
  assert.equal(svc.hasDelegatedAccess(store, { resellerId: "resA", tenantId: "t1", scope: "config_write", now: later }), false);
  assert.throws(() => svc.assertContentAccess(store, { resellerId: "resA", tenantId: "t1", scope: "config_write", now: later }),
    e => e.code === "DELEGATED_ACCESS_EXPIRED");
});

test("klantinhoud · ingetrokken delegatie geeft GEEN toegang meer", () => {
  const store = fakeStore();
  activeGrant(store);
  const g = store.data.resellerAccessGrants[0];
  const revoked = svc.revokeDelegatedAccess(store, { grantId: g.id, reason: "klant vraagt stop" }, tenantAdminT1);
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.revokedBy, "admin@klant1.be");
  assert.throws(() => svc.assertContentAccess(store, { resellerId: "resA", tenantId: "t1", scope: "config_write" }),
    e => e.code === "DELEGATED_ACCESS_REVOKED");
});

test("klantinhoud · ingetrokken KOPPELING dooft ook een actieve delegatie", () => {
  const store = fakeStore();
  activeGrant(store);
  const link = store.data.resellerTenantLinks[0];
  svc.revokeTenantLink(store, { linkId: link.id, reason: "relatie beeindigd" }, platformAdmin);
  assert.throws(() => svc.assertContentAccess(store, { resellerId: "resA", tenantId: "t1", scope: "config_write" }),
    e => e.code === "TENANT_NOT_ASSIGNED");
});

test("revoke · reden verplicht en een ANDERE reseller kan nooit intrekken", () => {
  const store = fakeStore();
  activeGrant(store);
  const g = store.data.resellerAccessGrants[0];
  assert.throws(() => svc.revokeDelegatedAccess(store, { grantId: g.id }, tenantAdminT1),
    e => e.code === "REASON_REQUIRED");
  // GEWIJZIGD GEDRAG (anti-probing, CTO2-01): een vreemde reseller kreeg 403
  // RESELLER_SCOPE_VIOLATION op een BESTAAND grant-id en 404 op een onbestaand
  // id · dat verschil maakte grant-ids enumereerbaar. Nu altijd 404.
  assert.throws(() => svc.revokeDelegatedAccess(store, { grantId: g.id, reason: "x" }, resellerUserB),
    e => e.code === "DELEGATED_ACCESS_NOT_FOUND" && e.status === 404);
});

test("delegated access · vreemd en onbestaand grant-id geven byte-identieke 404 (ISO-07)", () => {
  const store = fakeStore();
  activeGrant(store); // grant van resA op t1
  const g = store.data.resellerAccessGrants[0];
  const tenantAdminT99 = { email: "admin@ander.be", role: "tenant_admin", tenantId: "t99" };

  const grijp = fn => { try { fn(); return null; } catch (e) { return e; } };
  const paren = [
    // revoke door een vreemde reseller
    [grijp(() => svc.revokeDelegatedAccess(store, { grantId: g.id, reason: "x" }, resellerUserB)),
      grijp(() => svc.revokeDelegatedAccess(store, { grantId: "rag_bestaat_niet", reason: "x" }, resellerUserB))],
    // revoke door de admin van een andere tenant
    [grijp(() => svc.revokeDelegatedAccess(store, { grantId: g.id, reason: "x" }, tenantAdminT99)),
      grijp(() => svc.revokeDelegatedAccess(store, { grantId: "rag_bestaat_niet", reason: "x" }, tenantAdminT99))],
    // approve door de admin van een andere tenant
    [grijp(() => svc.approveDelegatedAccess(store, { grantId: g.id }, tenantAdminT99)),
      grijp(() => svc.approveDelegatedAccess(store, { grantId: "rag_bestaat_niet" }, tenantAdminT99))],
  ];
  for (const [vreemd, onbestaand] of paren) {
    assert.ok(vreemd && onbestaand, "beide pogingen moeten gooien");
    assert.equal(vreemd.status, 404);
    assert.equal(vreemd.status, onbestaand.status);
    assert.equal(vreemd.code, onbestaand.code);
    assert.equal(vreemd.message, onbestaand.message, "identieke boodschap · bestaan lekt niet");
  }
  // Geen enkele poging heeft het record aangeraakt.
  assert.equal(store.get("resellerAccessGrants", g.id).status, "active");
});

test("delegated access · verlopen grant kantelt bij de eerste geweigerde toegang (23.14)", () => {
  const store = fakeStore();
  const endAt = new Date(Date.now() + 3600e3).toISOString();
  activeGrant(store, { scope: ["config_write"], endAt });
  const g = store.data.resellerAccessGrants[0];
  assert.equal(g.status, "active");
  const later = Date.now() + 2 * 3600e3; // na de einddatum, zonder sweep
  assert.throws(() => svc.assertContentAccess(store, { resellerId: "resA", tenantId: "t1", scope: "config_write", now: later }),
    e => e.code === "DELEGATED_ACCESS_EXPIRED" && e.status === 403);
  // Het weigermoment is het kantelmoment: geen handmatige sweep meer nodig.
  const na = store.get("resellerAccessGrants", g.id);
  assert.equal(na.status, "expired");
  assert.ok(store.data.audit.some(a => a.action === "support_access_expired"));
  assert.equal(na.history[na.history.length - 1].after.status, "expired");
  // De sweep vindt daarna niets meer (idempotent) en de weigercode blijft
  // dezelfde: de statusflip verandert de beslissing niet.
  assert.equal(svc.expireDelegatedAccess(store, later).expired, 0);
  assert.throws(() => svc.assertContentAccess(store, { resellerId: "resA", tenantId: "t1", scope: "config_write", now: later }),
    e => e.code === "DELEGATED_ACCESS_EXPIRED");
});

test("expireDelegatedAccess · veegronde zet actieve grants voorbij einddatum op expired", () => {
  const store = fakeStore();
  const endAt = new Date(Date.now() + 3600e3).toISOString();
  activeGrant(store, { endAt });
  const out = svc.expireDelegatedAccess(store, Date.now() + 2 * 3600e3);
  assert.equal(out.expired, 1);
  assert.equal(store.data.resellerAccessGrants[0].status, "expired");
  assert.ok(store.data.audit.some(a => a.action === "support_access_expired"));
  // idempotent: tweede ronde doet niets
  assert.equal(svc.expireDelegatedAccess(store, Date.now() + 3 * 3600e3).expired, 0);
});

test("audit · delegatieacties loggen resellergebruiker + represented tenant (DoD-9)", () => {
  const store = fakeStore();
  activeGrant(store);
  const req = store.data.audit.find(a => a.action === "support_access_requested");
  assert.equal(req.actor, "sales@partnera.be"); // de resellergebruiker
  assert.equal(req.tenantId, "t1");             // de represented tenant
  const g = store.data.resellerAccessGrants[0];
  svc.logDelegatedAction(store, { grantId: g.id, action: "instelling gewijzigd", before: { x: 1 }, after: { x: 2 }, reason: "klantvraag" }, resellerUserA);
  const act = store.data.audit.find(a => a.action === "support_access_action");
  assert.equal(act.actor, "sales@partnera.be");
  assert.equal(act.tenantId, "t1");
  assert.ok(act.detail.includes("before"));
});

test("revokeAllAccess · suspensie/offboarding trekt alles in, historiek blijft (DoD-10)", () => {
  const store = fakeStore();
  activeGrant(store);
  // plus een nog openstaande aanvraag
  const endAt = new Date(Date.now() + 3600e3).toISOString();
  svc.requestDelegatedAccess(store, { resellerId: "resA", tenantId: "t1", scope: ["ticket_view"], reason: "extra", endAt }, resellerUserA);
  assert.throws(() => svc.revokeAllAccess(store, { resellerId: "resA", reason: "suspensie" }, resellerUserA),
    e => e.code === "SELF_LINK_FORBIDDEN");
  const out = svc.revokeAllAccess(store, { resellerId: "resA", reason: "suspensie wegens wanbetaling", includeLinks: true }, platformAdmin);
  assert.equal(out.revokedGrants, 2);
  assert.equal(out.revokedLinks, 1);
  // niets verwijderd: records en historiek blijven bestaan
  assert.equal(store.data.resellerAccessGrants.length, 2);
  assert.equal(store.data.resellerTenantLinks.length, 1);
  assert.ok(store.data.resellerAccessGrants.every(g => g.status === "revoked" && g.history.length >= 2));
  assert.equal(svc.assignedTenants(store, "resA").length, 0);
});

test("actor verplicht · zonder aangemelde gebruiker geen enkele actie", () => {
  const store = fakeStore();
  assert.throws(() => svc.requestTenant(store, validInput(), null), e => e.status === 401 && e.code === "ACTOR_REQUIRED");
  assert.throws(() => svc.linkTenant(store, { resellerId: "resA", tenantId: "t1", relationType: "commercial", reason: "x" }, {}),
    e => e.code === "ACTOR_REQUIRED");
});
