const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { config } = require("./lib/config");
const { sendJson, readBody, readRawBody, securityHeaders, corsHeaders } = require("./lib/http");
const { checkRateLimit } = require("./lib/rate-limit");
const { Store, BUSINESS_ADMIN_PERMISSIONS, MANAGER_PERMISSIONS, EMPLOYEE_PERMISSIONS } = require("./lib/store");
const { createDataAdapter } = require("./lib/data-adapters");
const { createObjectStorage } = require("./infrastructure/object-storage-factory");
const { createJobQueue } = require("./infrastructure/job-queue-factory");
const { makeCustomerSource } = require("./infrastructure/crm-source");
const { hashPassword, assertStrongPassword, verifyPassword } = require("./lib/security");
const {
  authenticate,
  issueSession,
  startActivation,
  activationToken,
  parseActivationToken,
  checkActivation,
  startPasswordReset,
  checkPasswordReset,
  login,
  loginWithMfa,
  safeUser,
  createMfaSetup,
  verifyMfaSetup,
  enforceMfa,
  resetLoginFailures,
  assertTenant,
  assertCan,
  can,
  assertOwn,
  assertSuperAdmin,
  isPlatformGod,
  assertPlatformGod,
  PLATFORM_SCOPES,
  platformScopesOf,
  assertPlatformScope,
  isReseller,
  assertReseller,
  assertAdminMfa,
  assertSupportWrite,
  buildSupportGrant,
  issueSupportToken,
  isEmployee,
  isManager,
  isAdmin,
  canWrite,
  assertCanWrite,
  ownScopeOnly
} = require("./lib/auth");
const {
  getMyProfile, getMyPlanning, getMyClock, getMyExpenses,
  getMyLeaves, getMyWorkorders, getMyMessages, getMyDashboard,
  getManagerDashboard, getManagerTeamPlanning
} = require("./modules/me");
const { modules } = require("./modules/registry");
const { MODULE_CATALOG, CORE_MODULES, moduleByKey, listAddons } = require("./modules/catalog");
const { listBundles, getBundle, saveBundle, deleteBundle } = require("./modules/bundles");
const { resolveTenantModules, isModuleEnabled, assertModuleEnabled, assertSubmoduleEnabled, grantablePermissions, OPERATIONAL_KEYS, ALWAYS_PERMISSIONS } = require("./modules/entitlements");
const rolesMod = require("./modules/roles");
const { bodenChat } = require("./modules/boden");
const { workingDaysBetween, round2, isValidBelgianVat } = require("./modules/be-locale");

/**
 * Maak een veilige permissions-array voor een medewerker op basis van wat de
 * tenant-admin aanvinkt. Voorkomt escalatie: niet-operationele rol-rechten komen
 * uit de rol-baseline; operationele rechten enkel uit de 'grantable' set
 * (operationeel ∩ tenant-entitlements), gescoped per rol (employee → own:).
 */
function sanitizeEmployeePermissions(store, tenant, role, requested) {
  const grantable = new Set(grantablePermissions(store, tenant).map(g => g.key));
  const baseDefault = role === "manager" ? MANAGER_PERMISSIONS : EMPLOYEE_PERMISSIONS;
  // Behoud niet-operationele rol-rechten (bv. manager: employees, alerts).
  const keptBase = baseDefault.filter(p => !OPERATIONAL_KEYS.has(String(p).replace(/^own:/, "").replace(/^read:/, "")));
  // Door admin gekozen operationele rechten met niveau: "X" = schrijven,
  // "read:X" = alleen-lezen. Beperkt tot wat de tenant heeft (grantable);
  // schrijven wordt voor employees gescopet naar eigen data (own:).
  const scoped = [];
  for (const raw of (Array.isArray(requested) ? requested : [])) {
    const p = String(raw);
    const readOnly = p.startsWith("read:");
    const teamLevel = p.startsWith("team:");
    const key = p.replace(/^read:/, "").replace(/^team:/, "").replace(/^own:/, "");
    if (!grantable.has(key)) continue;
    if (readOnly) scoped.push(`read:${key}`);
    else if (teamLevel) scoped.push(`team:${key}`); // E02/h8.1: expliciet team-scope
    else scoped.push(role === "employee" ? `own:${key}` : key);
  }
  // Altijd-rechten (bv. prikklok) forceren · iedereen kan in-/uitprikken ongeacht functie.
  const always = ALWAYS_PERMISSIONS.map(k => (role === "employee" ? `own:${k}` : k));
  return [...new Set([...keptBase, ...scoped, ...always])];
}

// ── Centrale lees/schrijf-gate ────────────────────────────────────────────────
// Mutaties op operationele onderdelen worden hier tenant-breed geblokkeerd voor
// gebruikers met enkel leesrechten (read:X). GET blijft werken via can();
// me/*-flows (eigen klok, eigen verlof/onkosten indienen) blijven persoonlijke
// basisfunctionaliteit en vallen buiten deze gate.
const WRITE_GATE_MAP = {
  workorders: ["workorders"], shifts: ["planning"], planning: ["planning"], appointments: ["planning"],
  incidents: ["incidents"], inquiries: ["customers"], estimate: ["invoicing", "billing"],
  projects: ["projects"], worksites: ["construction"], changeorders: ["construction"],
  assets: ["service_assets"], maintenance: ["service_assets"], contracts: ["contracts"],
  suppliers: ["procurement"], purchase_orders: ["procurement"], inventory: ["inventory"],
  expenses: ["expenses"], leaves: ["leaves"], messages: ["messages"],
  customers: ["customers"], venues: ["venues"], stock: ["stock"], vehicles: ["vehicles"],
  facturen: ["invoicing", "billing"], offertes: ["invoicing", "billing"], payments: ["invoicing", "billing"],
};
function assertNotReadOnly(user, action, method) {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return;
  if (!user || user.role === "super_admin") return;
  const keys = WRITE_GATE_MAP[String(action).split("/")[0]];
  if (!keys) return;                                   // niet-operationeel → eigen asserts
  if (keys.some(k => canWrite(user, k))) return;       // schrijfrecht aanwezig
  if (keys.some(k => can(user, k))) {                  // wel zien, niet wijzigen
    const e = new Error("Je hebt alleen leesrechten voor dit onderdeel");
    e.status = 403;
    throw e;
  }
  // geen enkel recht → laat het endpoint zelf de juiste 403 geven
}

// Trial-to-paid schrijf-gate: zodra proef + respijt voorbij zijn en er niet
// betaald is, blokkeren we muteren tenant-breed (402). Lezen blijft altijd
// werken en de billing/subscription-routes blijven schrijfbaar zodat upgraden
// nooit vastloopt. Tenants zonder trialEndsAt worden nooit geblokkeerd.
const UPGRADE_EXEMPT_HEADS = ["billing", "subscription"];
function assertTrialActive(user, tenant, action, method) {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return;
  if (!user || user.role === "super_admin") return;    // ops/support niet blokkeren
  const head = String(action).split("/")[0];
  if (UPGRADE_EXEMPT_HEADS.includes(head)) return;      // laat betalen/upgraden toe
  const access = billingAccess(tenant);
  if (!access.writeBlocked) return;
  const e = new Error("Je proefperiode is verlopen. Kies een abonnement om verder te werken.");
  e.status = 402;
  e.code = "TRIAL_EXPIRED";
  throw e;
}

// ── Prikklok-helpers: canoniek schema (date + HH:MM) ─────────────────────────
// Valide "HH:MM" of null; knipt seconden weg ("07:00:00" → "07:00").
function hhmm(v) {
  const s = String(v || "").slice(0, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null;
}
function hhmmToMin(t) { return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)); }
// Verrijk een klok-rij met beide representaties: canoniek (date/clockIn/clockOut/
// durationMinutes) én afgeleide lokale ISO's (clockedIn/clockedOut) voor de UI.
// Legacy ISO-rijen worden string-gewijs gelezen (geen Date-parse → geen tz-schuif).
function enrichClock(c) {
  const date = c.date || String(c.clockedIn || "").slice(0, 10) || null;
  const clockIn = hhmm(c.clockIn) || (c.clockedIn ? hhmm(String(c.clockedIn).slice(11, 16)) : null);
  const clockOut = hhmm(c.clockOut) || (c.clockedOut ? hhmm(String(c.clockedOut).slice(11, 16)) : null);
  const pauseMin = c.breakMinutes ?? clockBreakMinutes(c.breaks);
  const durationMinutes = c.durationMinutes
    ?? (clockIn && clockOut ? Math.max(0, hhmmToMin(clockOut) - hhmmToMin(clockIn) - pauseMin) : null);
  return {
    ...c, date, clockIn, clockOut, durationMinutes,
    breakMinutes: pauseMin,
    clockedIn: date && clockIn ? `${date}T${clockIn}:00` : null,
    clockedOut: date && clockOut ? `${date}T${clockOut}:00` : null
  };
}

// Vul userName aan vanuit het gebruikersbestand voor lijsten die enkel een
// userId dragen. GDPR-scoping gebeurt op rij-niveau (own-scope filtert wat je
// mag zien); wat je wél mag zien moet werkbaar zijn en dus een naam tonen.
function withUserNames(store, rows) {
  const cache = {};
  return rows.map(r => {
    if (r.userName || !r.userId) return r;
    if (!cache[r.userId]) {
      const u = store.getUserById(r.userId);
      cache[r.userId] = u ? (u.name || u.email) : r.userId;
    }
    return { ...r, userName: cache[r.userId] };
  });
}

// Klant-facturatie (offertes/facturen): toegankelijk met het admin-brede
// "billing" óf het toekenbare "invoicing"-recht (finance-profiel zonder
// toegang tot abonnementsbeheer).
function assertInvoicing(user) {
  assertAdminMfa(user);
  if (can(user, "billing") || can(user, "invoicing")) return;
  const e = new Error("Missing permission");
  e.status = 403;
  throw e;
}

// Verstuur (of log) een activatiemail met de wachtwoord-instellink.
function sendActivationMail(user, link) {
  const html = `<p>Hallo ${user.name || ""},</p>
    <p>Er is een Monargo One-account voor je aangemaakt. Stel binnen 7 dagen je wachtwoord in via de knop hieronder:</p>
    <p><a href="${link}" style="display:inline-block;background:#0071e3;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Wachtwoord instellen</a></p>
    <p style="font-size:12px;color:#64748b">Werkt de knop niet? Open deze link: ${link}</p>`;
  // Niet awaiten: mailer logt bij fout en valt terug op console.
  Promise.resolve(sendMail({ to: user.email, subject: "Activeer je Monargo One-account", html, text: `Stel je wachtwoord in (7 dagen geldig): ${link}` })).catch(() => {});
}

// Verstuur (of log) een wachtwoord-reset-mail met de reset-link (1 uur geldig).
function sendPasswordResetMail(user, link) {
  const html = `<p>Hallo ${user.name || ""},</p>
    <p>Er is een wachtwoord-reset aangevraagd voor je Monargo One-account. Stel binnen 1 uur een nieuw wachtwoord in:</p>
    <p><a href="${link}" style="display:inline-block;background:#0071e3;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Nieuw wachtwoord instellen</a></p>
    <p style="font-size:12px;color:#64748b">Heb je dit niet aangevraagd? Negeer deze mail · je wachtwoord blijft ongewijzigd.<br>Werkt de knop niet? Open deze link: ${link}</p>`;
  Promise.resolve(sendMail({ to: user.email, subject: "Reset je Monargo One-wachtwoord", html, text: `Stel een nieuw wachtwoord in (1 uur geldig): ${link}` })).catch(() => {});
}

// Maak een account zónder wachtwoord: pending tot de persoon zelf activeert via
// de e-mailink. De aanmaker kiest dus nooit een wachtwoord (veiliger + verificatie).
function provisionPendingUser(fields) {
  const { secret, record } = startActivation();
  const user = store.insert("users", {
    ...fields,
    passwordHash: "",
    active: false,
    emailVerifiedAt: null,
    activation: record,
    createdAt: fields.createdAt || new Date().toISOString()
  });
  const link = `${config.appUrl}/?activate=${encodeURIComponent(activationToken(user.id, secret))}`;
  sendActivationMail(user, link);
  // Link enkel teruggeven in dev/mock (geen echte mailprovider) zodat het testbaar
  // is; in productie met echte mail wordt de link NOOIT in de respons gezet.
  return { user, activationLink: (config.isProduction || isMailLive()) ? null : link };
}
const { listModule, createModuleRow, updateModuleRow } = require("./modules/crud");
const { lookupKboResolve } = require("./modules/kbo");
const { createCustomerInvoice, createCreditNote, workorderInvoicePayload } = require("./modules/customer-invoicing");
const { runPaymentReminders, reminderPolicy } = require("./modules/payment-reminders");
const { normalizeAppointment, runAppointmentReminders } = require("./modules/appointments");
const { normalizeIncident, incidentsToCsv, incidentDeadline } = require("./modules/incidents");
const { INQUIRY_STATUSES, ensureIntake, intakeAddress, newIntakeToken, parseInboundPayload, resolveIntakeTenant, createInquiry } = require("./modules/inbox");
const { estimateFromQuestion } = require("./modules/estimator");
const { emitDomainEvent, listOutbox, registerOutboxSink } = require("./platform/events");
const { ensureDefaultCompany, issueNumber } = require("./platform/companies");
const { applyScope, redactSensitive, canSeeSensitive } = require("./platform/policy");
const { projectDossier } = require("./modules/project-dossier");
const { customerDossier } = require("./modules/customer-dossier");
const { makeCustomerRepository } = require("./platform/crm");
const { makeProjectRepository } = require("./platform/projects");
const { freezeSentVersion, reviseQuote, computeDocumentHash } = require("./platform/quote-versions");
const { listPlanningItems, planningOverlap } = require("./platform/planning");
const { makeWorksiteRepository } = require("./platform/worksites");
const { makeChangeOrderRepository } = require("./platform/change-orders");
const { buildComplianceOverview } = require("./platform/compliance");
const { makeAssetRepository, makeMaintenancePlanRepository } = require("./platform/assets");
const { buildProjectFinance } = require("./platform/project-finance");
const { makeContractRepository } = require("./platform/contracts");
const { makeSupplierRepository, makePurchaseOrderRepository } = require("./platform/procurement");
const { makeCatalogRepository, resolvePrice, snapshotForLine, explodeComposition } = require("./platform/catalog");
const { makeWorkOrderRepository, computeTotals: computeWoTotals, buildInvoiceLines: buildWoInvoiceLines } = require("./platform/work-orders");
const { makeWebhookRepository, deliverPending, buildDeliveryHealth, requeueEvent, listDeliveries, requeueDelivery } = require("./platform/webhooks");
const { makeProgressClaimRepository, computeClaimTotals } = require("./platform/progress-claims");
const paymentsModule = require("./platform/payments");
const { makeEmployeeRepository, rateOn, availabilityOn, expiringCertificates } = require("./platform/employees");
const {
  RESOURCES: GRID_RESOURCES, OPERATORS: GRID_OPERATORS, BULK_ACTIONS: GRID_BULK_ACTIONS,
  runQuery: runGridQuery, previewBulk: previewGridBulk, runBulk: runGridBulk, hasResourceAccess: hasGridAccess,
  buildExport: buildGridExport, createExportJob: createGridExportJob, getExportJob: getGridExportJob,
  makeViewRepository: makeGridViewRepository,
} = require("./platform/grid");
const {
  makeFormTemplateRepository, makeFormInstanceRepository, makeTaskRepository,
  makeFileRepository, makeCommunicationRepository,
} = require("./platform/work-os");
const {
  buildPortfolio, buildCapacityForecast, captureBaseline, comparePhases,
  appendForecast, currentForecast,
} = require("./platform/portfolio");
const { httpsRequest } = require("./lib/http-client");
const inventory = require("./platform/inventory");
const { buildMonaSignals } = require("./platform/mona-signals");
const { buildPreparedWork, prepareProject, buildDailyDigest } = require("./platform/mona-prepare");
const robawsImport = require("./platform/robaws-import");
const { buildWorkInbox } = require("./platform/work-inbox");
const { makeConfigRepository } = require("./platform/config-platform");
const { makeAutomationRepository, makeDispatcher, executeFlow } = require("./platform/automation");
const { registerEventListener } = require("./platform/events");
const { makeLocalTransactionManager } = require("./infrastructure/local/transaction-manager");
const { buildInsights } = require("./platform/insights");
const {
  createSetupIntent,
  billingQuote,
  planCatalog,
  selectPlan,
  attachPaymentMethod,
  createInvoice,
  sendPeppol,
  billingSummary,
  transitionContract,
  markPaymentFailed,
  advanceDunning,
  acceptDpa,
  createGdprRequest,
  processGdprRequest,
  processStripeWebhook,
  tenantMrr
} = require("./modules/billing");
const { readiness, applyKbo, createDemoGoldenPath } = require("./modules/golden-path");
const { SECTORS, TEAM_SIZES, isValidSector, publicSectors, sectorByKey, terminologyFor } = require("./modules/sectors");
const { availableWidgets, renderWidgets, sanitizeKeys: sanitizeWidgetKeys } = require("./modules/dashboards");
const { todayPayload, completeWorkorder, attachWorkorderPhoto, signWorkorder, syncMobileQueue } = require("./modules/mobile");
const { clockIn, clockOut, breakStart, breakStop, approveExpense, managementReport } = require("./modules/operations");
const { breakMinutes: clockBreakMinutes } = require("./modules/clocking-rules");

// Widget-catalogus voor de medewerker-startpagina. `view` koppelt een widget
// aan een module-view zodat entitlements bepalen wat kiesbaar is.
const EMP_HOME_WIDGETS = [
  { key: "clock", label: "Prikklok & vandaag", view: "clocking" },
  { key: "quickactions", label: "Snelacties", view: null },
  { key: "urgent", label: "Urgente werkbonnen", view: "workorders" },
  { key: "overview", label: "Mijn overzicht", view: null },
  { key: "leavebalance", label: "Verlofsaldo", view: "leaves" },
  { key: "notifications", label: "Ongelezen meldingen", view: null }
];
const { leaveConflictOn } = require("./modules/planning-rules");
const { listIntegrations, connectIntegration, updateMapping, runSync, retrySync, listProviders, runRobawsDocSync } = require("./modules/integrations");
const { commissionOverview, publicReseller, payoutDetails } = require("./modules/resellers");
const commissionSvc = require("./modules/commission-service");
// Kanaaldomein h23 (reseller, partnerkanaal en commissiebeheer): pure
// beslislaag + vijf store-gebonden domeinmodules. Elke route gaat VOOR de
// service-call door reseller-authz (actie + scope + tenantrelatie).
const resellerAuthz = require("./platform/reseller-authz");
const resellerDealsSvc = require("./modules/reseller-deals");
const resellerTenantsSvc = require("./modules/reseller-tenants");
const resellerLicensingSvc = require("./modules/reseller-licensing");
const resellerCommissionSvc = require("./modules/reseller-commission-agreement");
const resellerLifecycleSvc = require("./modules/reseller-lifecycle");

// ── Kanaaldomein h23 · route-helpers ─────────────────────────────────────────

// Kanaalrol voor portaalgebruikers (23.6): een expliciete sub-rol op de
// gebruiker (resellerRole) wint; de klassieke enkelvoudige reseller-login
// (systeemrol "reseller", zonder sub-rol) werkt als eigenaar met de bestaande
// portaalbevoegdheden. Deny-by-default blijft gelden voor al het overige, en
// de gevoelige beperkingen uit 23.5 blijven hard.
const LEGACY_RESELLER_GRANTS = Object.freeze([
  "reseller.deals.create:own",
  "reseller.tenants.request:own",
  "reseller.licenses.request:assigned",
  "reseller.commissions.dispute:own",
  "reseller.payout.manage:own",
  "reseller.delegated_admin.use:assigned"
]);
function resellerChannelActor(user) {
  if (user.resellerRole) return user;
  return { ...user, resellerRole: "reseller_owner", permissions: [...(user.permissions || []), ...LEGACY_RESELLER_GRANTS] };
}

// Monargo-zijde: superadmins zonder expliciete kanaalrol krijgen per
// routefamilie een passende fallbackrol (partnerbeheer vs finance), zodat de
// gevoelige beperkingen uit 23.5 aan de juiste kant vallen (een partner
// manager wijzigt bv. nooit payoutgegevens).
function monargoChannelActor(user, fallbackRole) {
  if (user.resellerRole) return user;
  return { ...user, resellerRole: fallbackRole };
}

// Portaal-gate (23.6/23.15): actie + scope + tenantrelatie via reseller-authz,
// VOOR elke service-call. Zonder tenant in het spel volstaat de grant plus de
// suspensieregel (23.4: views blijven werken, al het andere blokkeert); met
// tenantId is bovendien een actieve tenantkoppeling vereist (assignment-
// record · reseller_id op de tenant alleen is nooit genoeg).
function resellerPortalAllowed(channelUser, permissions, reseller, tenantId = null) {
  const list = Array.isArray(permissions) ? permissions : [permissions];
  for (const permission of list) {
    if (tenantId != null) {
      const ok = resellerAuthz.canResellerAction(channelUser, permission, {
        resellerId: reseller.id, resellerStatus: reseller.status, tenantId,
        assignments: store.data.resellerTenantLinks || []
      });
      if (ok) return true;
      continue;
    }
    const scope = resellerAuthz.grantFor(channelUser, permission);
    if (!scope) continue;
    if (reseller.status !== "active" && resellerAuthz.suspensionBlocks(permission)) continue;
    return true;
  }
  return false;
}

// Fouten uit de kanaalservices: status/code/fieldErrors een-op-een doorgeven.
function sendResellerError(res, e) {
  const payload = { ok: false, error: e.message, code: e.code };
  if (e.fieldErrors) payload.fieldErrors = e.fieldErrors;
  if (e.currentVersion !== undefined) payload.currentVersion = e.currentVersion;
  if (e.removedModules) payload.removedModules = e.removedModules;
  return sendJson(res, e.status || 400, payload);
}

// Generieke 403 zonder ID-probing (23.15/ISO-07): vaste body, ongeacht het
// bestaan van het object of de precieze reden van de weigering.
function resellerForbidden(res) {
  return sendJson(res, 403, { ok: false, error: "Geen toegang", code: "RESELLER_FORBIDDEN" });
}

// ISO-03 (23.6): een EXPLICIETE ?resellerId= die niet de eigen organisatie is,
// is een harde weigering · nooit stil herfilteren naar de eigen scope. Elke
// portaal-GET roept dit aan voor de service-call. Retourneert true als het
// antwoord al verstuurd is.
function foreignResellerParam(res, url, reseller) {
  const rid = url.searchParams.get("resellerId");
  if (rid && rid !== reseller.id) {
    sendResellerError(res, resellerAuthz.scopeViolationError());
    return true;
  }
  return false;
}

// MFA-plicht 23.15/DoD-8 · zelfde patroon als de payoutflow
// (reseller-commission-agreement.assertMfa): reselleradmins, finance en IEDEREEN
// met gedelegeerde tenanttoegang hebben sterke authenticatie nodig. Faalt
// dicht: zonder aantoonbare MFA is er geen toegang.
function assertResellerMfa(channelUser, permission) {
  if (!resellerAuthz.requiresMfa(channelUser, permission)) return;
  if (channelUser && (channelUser.mfaEnabled === true || channelUser.mfaVerified === true)) return;
  const e = new Error("Sterke authenticatie (MFA) is vereist voor deze actie");
  e.status = 403; e.code = "MFA_REQUIRED";
  throw e;
}

// Idempotency-Key voor muterende kanaalroutes (zelfde mechaniek als in de
// tenant-dispatcher · h41): een herhaalde mutatie met dezelfde sleutel maakt
// geen duplicaat maar krijgt de eerdere response terug. Retourneert true als
// de replay al verstuurd is.
function armResellerIdempotency(req, res, url, user) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return false;
  const idemKey = idempotency.idempotencyKeyFrom(req);
  if (!idemKey) return false;
  const cacheKey = idempotency.cacheKeyFor({
    tenantId: user.resellerId || null, actorId: user.id, method: req.method, path: url.pathname, key: idemKey
  });
  const replay = idempotency.findReplay(store, cacheKey);
  if (replay) {
    res.wfpV1 = null;
    sendJson(res, replay.status, JSON.parse(replay.body), { "Idempotency-Replayed": "true" });
    return true;
  }
  res.wfpIdem = { store, cacheKey };
  return false;
}

// Idempotency-arm voor top-level Super Admin/platform-routes (Integraties, Usage
// & Billing). Zonder Idempotency-Key gebeurt er niets; met sleutel speelt een
// eerder 2xx-resultaat terug i.p.v. een dubbele financiele mutatie. Platformbreed
// gescoopt (tenantId: null · deze routes muteren platformdata, geen tenantdata).
function armPlatformIdempotency(req, res, url, user) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return false;
  const idemKey = idempotency.idempotencyKeyFrom(req);
  if (!idemKey) return false;
  const cacheKey = idempotency.cacheKeyFor({
    tenantId: null, actorId: user.id, method: req.method, path: url.pathname, key: idemKey
  });
  const replay = idempotency.findReplay(store, cacheKey);
  if (replay) {
    res.wfpV1 = null;
    sendJson(res, replay.status, JSON.parse(replay.body), { "Idempotency-Replayed": "true" });
    return true;
  }
  res.wfpIdem = { store, cacheKey };
  return false;
}

// Aanmaak van een licentieaanvraag (23.10): routelaag-switch op kind; alle
// validatie, catalogus- en prijslogica zit in de servicelaag.
function createResellerLicenseRequest(body, channelUser) {
  const kind = String((body && body.kind) || "").trim();
  if (kind === "order") return resellerLicensingSvc.licenseOrder(store, body, channelUser);
  if (kind === "seat_change") return resellerLicensingSvc.seatChange(store, body, channelUser);
  if (kind === "plan_change") return resellerLicensingSvc.upgradeDowngrade(store, body, channelUser);
  if (kind === "trial_extension") return resellerLicensingSvc.trialExtension(store, body, channelUser);
  if (kind === "cancellation") return resellerLicensingSvc.cancellation(store, body, channelUser);
  const e = new Error(`kind moet een van ${resellerLicensingSvc.LICENSE_REQUEST_KINDS.join(", ")} zijn`);
  e.status = 400; e.code = "LICENSE_KIND_INVALID";
  throw e;
}
const saml = require("./modules/saml");
const { tenantStatus, unlockUser, listBackups, createBackup, backupPreview, restoreBackup, publicStatus, mfaRisk, getBackupPolicy, setBackupPolicy, pruneTenantBackups } = require("./modules/admin");
const { createNotification, listNotifications, markNotificationRead, generateReminders, notificationSummary } = require("./modules/notifications");
const { importEmployees } = require("./modules/imports");
const { runSupportAccessReview } = require("./modules/support-access");
const { portalPayload, updateOnboardingStep } = require("./modules/portal");
const { customerStartPayload } = require("./modules/customer-start");
const { previewCustomerStart, applyCustomerStart } = require("./modules/customer-start-bootstrap");
const { listApiKeys, createApiKey, revokeApiKey, rotateApiKey, authenticateApiKey, recordApiKeyDenied } = require("./modules/api-keys");
const { apiKeyGovernance } = require("./modules/api-key-governance");
const { releaseInfo } = require("./modules/releases");
const { pilotKpis, decisionReport } = require("./modules/pilot");
const { salesSummary, salesLaunchReadiness, advanceLead, addPartnerNote } = require("./modules/sales");
const { goLiveReadiness } = require("./modules/go-live");
const { listReports, getReport, generateStatusBundle } = require("./modules/reports");
const { listAuditEvents } = require("./modules/audit");
const { sendMail, setRuntimeConfig, isMailLive, recentMail, setMailSink } = require("./lib/mailer");
const { pruneAudit } = require("./platform/audit-log");
const { ConsoleTelemetry } = require("./infrastructure/telemetry/console-telemetry");
const { routePattern } = require("./lib/route-pattern");
const idempotency = require("./lib/idempotency");
const apiV1 = require("./lib/api-v1");
/**
 * Telemetrie (handover 4.7). Console-adapter schrijft gestructureerde JSON naar
 * stdout, wat elk container-platform verzamelt zonder agent of account. Een
 * OpenTelemetry-collector of Azure Monitor-exporter sluit hier later op aan
 * zonder dat aanroepende code wijzigt.
 */
const telemetry = new ConsoleTelemetry({
  minLevel: process.env.LOG_LEVEL || (config.isProduction ? "info" : "warn"),
  environment: config.appEnv,
});
const { productionReadiness } = require("./modules/production");
const { eventLog, backupSummary, lifecycle, resellerPayouts, securityCenter, gdprOverview } = require("./modules/platform-ops");
const { setPlanPriceOverrides, planPricing } = require("./modules/billing");
const { loadPlatformConfig, publicPlatformConfig, savePlatformConfig } = require("./modules/platform-config");
const { createPaymentLink, markInvoicePaidById } = require("./modules/payments");
const { createSubscriptionCheckout, createBillingPortalSession, applySubscriptionEvent, TRIAL_DAYS } = require("./modules/subscriptions");
const { billingAccess, trialNudge } = require("./modules/billing-access");
const { pushConfigured, publicKey: pushPublicKey, saveSubscription: savePushSubscription, removeSubscription: removePushSubscription } = require("./modules/push");
const { verifyStripeSignature } = require("./modules/stripe-webhook");
const { seedDemoData, clearDemoData } = require("./modules/demo-seed");
const { buildUbl, validatePeppol, sendPeppolInvoice, peppolTransportReadiness } = require("./modules/peppol-invoice");
// ── Integraties, Usage & Billing (INT-01..10) · P0-kern ─────────────────────
// Gedeeld connectorframework + usage-ledger + Peppol/AI-metering + payrollengine.
// Elke route loopt eerst door de pure rechtenlaag intAuthz (integrations-authz.js).
const connectorSvc = require("./modules/connector-service");
const peppolUsage = require("./modules/peppol-usage");
const monaAi = require("./modules/mona-ai-metering");
const payrollEngine = require("./modules/payroll-engine");
const intAuthz = require("./platform/integrations-authz");
const quoteSigning = require("./modules/quote-signing");
const { normalizeDimonaRecord, dimonaRegister } = require("./modules/dimona");
const { buildPayrollExport, buildPayrollDigest, toCsv: payrollToCsv, payrollReadiness, providerList: payrollProviderList, KNOWN_PROVIDERS: payrollProviders } = require("./platform/social-secretariat");
const { submitCheckin, buildPresenceRegister } = require("./modules/ciaw");
const { listPostedWorkers, createPostedWorker, updatePostedWorker, deletePostedWorker, submitLimosa } = require("./modules/posted-workers");
const tpl = require("./modules/templates");
const {
  leaveSubmittedToAdmin,
  leaveReviewedToEmployee,
  expenseSubmittedToAdmin,
  expenseReviewedToEmployee,
  welcomeEmployee
} = require("./modules/email-templates");
const { listErrorEvents } = require("./modules/errors");
const { homeSuggestion, recordSuggestionEvent } = require("./modules/suggestions");
const { roadmapStatus } = require("./modules/roadmap");
const { buildTraceability } = require("./modules/traceability");
const { openApiSpec } = require("./modules/openapi");
const {
  listStock, getStockItem, createStockItem,
  updateStockItem, addMutation, stockAlerts, releaseReservation
} = require("./modules/stock");
const {
  listLeaves, getLeave, createLeave, reviewLeave, leaveConflicts, leaveCalendar
} = require("./modules/leaves");
const {
  listVehicles, getVehicle, createVehicle, updateVehicle, logMileage, scheduleService
} = require("./modules/vehicles");

// Netwerk-adapters (PostgreSQL) kunnen niet synchroon in een constructor laden.
// De store-instantie bestaat wel meteen (repositories verwijzen ernaar); de data
// komt via initAsync() vóór de server gaat luisteren.
const storeAdapter = createDataAdapter();
// Server-runtime: gebufferde JSON-writes (gecoalesced in de request-finally,
// zelfde duurzaamheidscontract als de pg-adapter). Losse scripts laten de
// adapter synchroon zodat "script klaar" ook "geschreven" blijft.
if (storeAdapter.name === "json") storeAdapter.buffered = true;
// Transactionele outbox (CTO P0-05): op de pg-adapter gaat elk domeinevent
// óók naar de duurzame outbox_events-tabel, in DEZELFDE transactie als de
// staat. De in-memory cap van 2.000 kan het werkgeheugen knippen; de tabel
// is de blijvende log met retentie en replay.
if (storeAdapter.name === "postgres" && typeof storeAdapter.queueOutboxAppend === "function") {
  registerOutboxSink({
    append: ev => storeAdapter.queueOutboxAppend(ev),
    status: up => storeAdapter.queueOutboxStatus(up),
  });
}
// Insights-dashboardcache (per gebruiker, TTL 10s · zie de insights-route).
const insightsCache = new Map();
const storeNeedsAsyncLoad = typeof storeAdapter.loadAsync === "function";
const store = new Store(storeAdapter, { defer: storeNeedsAsyncLoad });
const customerRepo = makeCustomerRepository(store);
const projectRepo = makeProjectRepository(store);
const worksiteRepo = makeWorksiteRepository(store);
const changeOrderRepo = makeChangeOrderRepository(store);
const assetRepo = makeAssetRepository(store);
const maintenancePlanRepo = makeMaintenancePlanRepository(store);
const contractRepo = makeContractRepository(store);
const supplierRepo = makeSupplierRepository(store);
const purchaseOrderRepo = makePurchaseOrderRepository(store);
const catalogRepo = makeCatalogRepository(store);
const workOrderRepo = makeWorkOrderRepository(store);
const webhookRepo = makeWebhookRepository(store);
const progressClaimRepo = makeProgressClaimRepository(store);
const employeeRepo = makeEmployeeRepository(store);
const gridViewRepo = makeGridViewRepository(store);
// Work OS-kern (h39): gedeelde platformdiensten voor élke module.
const formTemplateRepo = makeFormTemplateRepository(store);
const formInstanceRepo = makeFormInstanceRepository(store, formTemplateRepo);
const taskRepo = makeTaskRepository(store);
const fileRepo = makeFileRepository(store);
const communicationRepo = makeCommunicationRepository(store);
// Objectopslag achter de poort (handover 4.2): lokaal volume nu, Azure Blob of
// S3 later via dezelfde interface · een configuratiewissel, geen codewijziging.
const objectStorage = createObjectStorage();
// JobQueue (handover 4.6): op PostgreSQL deelt hij de pool met de data-adapter,
// zodat reserveringen een herstart en meerdere replicas overleven.
const jobQueue = createJobQueue(storeAdapter);

// Canonieke Forms-capability (Forms-handover F1 · finale CTO-directive: één
// platformbrede engine). Genormaliseerd + RLS-geïsoleerd op PostgreSQL, achter
// de distincte paden form-definitions/* en form-instances/*. Vereist pg; in pure
// JSON-dev is hij null en antwoorden de routes met 503 (geen tweede engine).
const formsApi = require("./modules/forms-api");
const formsRepo = (() => {
  const pool = storeAdapter && storeAdapter.name === "postgres" ? storeAdapter.pool : null;
  if (!pool) return null;
  const { makePgFormsRepository } = require("./infrastructure/postgres/pg-forms-repository");
  // F4 · domeincommands: een domeinformulier schrijft transactioneel naar het
  // canonieke domeinobject (zelfde pg-transactie als de submit/approve). De
  // customer-handler voedt CRM-001/002 rechtstreeks in de genormaliseerde tabel.
  const { makeDomainCommandRouter } = require("./platform/forms-domain-commands");
  const domainCommands = makeDomainCommandRouter();
  domainCommands.register("customer", async ({ client, tenantId, payload, actor }) => {
    const cid = "cus_" + require("crypto").randomBytes(10).toString("hex");
    await client.query(
      `INSERT INTO customers (id, tenant_id, name, email, phone, vat_number, language, status, notes, custom_fields, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'prospect',$8,$9,$10,$10)`,
      [cid, tenantId, String(payload.name || payload.customer_name || "").trim() || "Onbekend",
       payload.email || null, payload.phone || null, payload.vat_number || null,
       ["nl", "fr", "en"].includes(payload.language) ? payload.language : "nl",
       payload.notes || null, JSON.stringify(payload.custom_fields || {}), actor || null]);
    return { domainObject: "customer", domainId: cid };
  });
  // CRM-003 · contact hangt tenant-veilig aan zijn klant (pg-canoniek, 002_crm).
  domainCommands.register("contact", async ({ client, tenantId, instance, payload, actor }) => {
    const customerId = payload.customer_id || (instance.subject_type === "customer" ? instance.subject_id : null);
    if (!customerId) { const e = new Error("customer_id is verplicht voor een contactformulier"); e.status = 422; e.code = "CONTACT_CUSTOMER_REQUIRED"; throw e; }
    const cid = "ctc_" + require("crypto").randomBytes(10).toString("hex");
    await client.query(
      `INSERT INTO customer_contacts (id, tenant_id, customer_id, first_name, last_name, email, phone, role, is_primary, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
      [cid, tenantId, customerId, payload.first_name || null, payload.last_name || null,
       payload.email || null, payload.phone || null, payload.role || null, payload.is_primary === true, actor || null]);
    return { domainObject: "contact", domainId: cid, customerId };
  });
  return makePgFormsRepository(pool, { domainCommands, objectStorage });
})();

/**
 * CRM-bronschakelaar (5.4 stap 5-7). Buiten legacy-modus is een PostgreSQL-
 * verbinding nodig: gedeeld met de data-adapter als die op pg draait, anders
 * een eigen pool op DATABASE_URL (zo kan dev met een JSON-store al schaduwen).
 * Ontbreekt de URL, dan faalt het opstarten hard · stil terugvallen zou een
 * cutover suggereren die er niet is (ADR-004).
 */
const customerSource = (() => {
  const mode = config.crm.readSource;
  if (mode === "legacy") return makeCustomerSource({ mode, legacyRepo: customerRepo, telemetry });
  let pool = storeAdapter && storeAdapter.name === "postgres" ? storeAdapter.pool : null;
  if (!pool) {
    if (!/^postgres(ql)?:\/\//.test(config.database.url)) {
      throw new Error(`CRM_READ_SOURCE=${mode} vereist DATABASE_URL (of STORAGE_ADAPTER=postgres)`);
    }
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: config.database.url, ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined, max: 5 });
  }
  const { makePgCustomerRepository } = require("./infrastructure/postgres/pg-customer-repository");
  const { backfillCustomers } = require("./infrastructure/postgres/crm-backfill");
  const pgRepo = makePgCustomerRepository(pool);
  const mirror = async (tenantId, row) => {
    // De tenant moet in het genormaliseerde schema bestaan (FK-anker).
    const tenant = (store.data.tenants || []).find(t => t.id === tenantId);
    await pool.query(
      "INSERT INTO tenants (id, name, plan) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING",
      [tenantId, (tenant && tenant.name) || tenantId, (tenant && tenant.plan) || "starter"]);
    await backfillCustomers(pool, tenantId, [row]);
  };
  console.log(`  CRM-bron  : ${mode}${mode === "shadow" ? " (legacy leidend, pg leest mee)" : " (cutover · dual-write actief)"}`);
  return makeCustomerSource({ mode, legacyRepo: customerRepo, pgRepo, mirror, telemetry });
})();
/**
 * Identity-bronschakelaar (P0-01 · tweede domein langs de CRM-route). De
 * spiegel-lus draait zodra er een pg-pool is, ook in legacy-stand: zo bouwt
 * het reconciliatiebewijs zich op vóór de cutover, zonder gedragsverandering.
 */
const identitySource = (() => {
  const mode = config.identity.readSource;
  let pool = storeAdapter && storeAdapter.name === "postgres" ? storeAdapter.pool : null;
  if (!pool && mode !== "legacy") {
    if (!/^postgres(ql)?:\/\//.test(config.database.url)) {
      throw new Error(`IDENTITY_READ_SOURCE=${mode} vereist DATABASE_URL (of STORAGE_ADAPTER=postgres)`);
    }
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: config.database.url, ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined, max: 3 });
  }
  const { makeIdentitySource } = require("./infrastructure/identity-source");
  const source = makeIdentitySource({ mode, store, pool, telemetry });
  if (pool) {
    // Eerste sync kort na de start (migraties zijn dan zeker toegepast door de
    // startvolgorde), daarna op interval; snapshot-gepoort dus goedkoop.
    setTimeout(() => source.syncNow().catch(() => {}), 15 * 1000).unref();
    setInterval(() => source.syncNow().catch(() => {}), config.identity.syncIntervalMs).unref();
    console.log(`  Identity  : ${mode}${mode === "legacy" ? " (spiegel-lus bouwt bewijs op)" : mode === "shadow" ? " (legacy leidend, pg leest mee)" : " (pg-leesbron · legacy blijft write-owner)"}`);
  }
  return source;
})();
/**
 * Finance-bronschakelaar (P0-01 fase 3 · facturen + betalingen). Zelfde
 * strangler-route en spiegel-lus als identity; schrijven blijft bij legacy
 * (nummering, allocatie en saldo-invarianten).
 */
const financeSource = (() => {
  const mode = config.finance.readSource;
  let pool = storeAdapter && storeAdapter.name === "postgres" ? storeAdapter.pool : null;
  if (!pool && mode !== "legacy") {
    if (!/^postgres(ql)?:\/\//.test(config.database.url)) {
      throw new Error(`FINANCE_READ_SOURCE=${mode} vereist DATABASE_URL (of STORAGE_ADAPTER=postgres)`);
    }
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: config.database.url, ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined, max: 3 });
  }
  const { makeFinanceSource } = require("./infrastructure/finance-source");
  const source = makeFinanceSource({ mode, store, pool, telemetry });
  if (pool) {
    setTimeout(() => source.syncNow().catch(() => {}), 18 * 1000).unref();
    setInterval(() => source.syncNow().catch(() => {}), config.finance.syncIntervalMs).unref();
    console.log(`  Finance   : ${mode}${mode === "legacy" ? " (spiegel-lus bouwt bewijs op)" : mode === "shadow" ? " (legacy leidend, pg leest mee)" : " (pg-leesbron · legacy blijft write-owner)"}`);
  }
  return source;
})();
/**
 * Company-bronschakelaar (P0-01 fase 4 · ondernemingen + nummerreeksen). Zodra
 * companies genormaliseerd meelopen, kunnen de finance-FK's naar companies
 * later echte database-FK's worden (samen met customers).
 */
const companySource = (() => {
  const mode = config.company.readSource;
  let pool = storeAdapter && storeAdapter.name === "postgres" ? storeAdapter.pool : null;
  if (!pool && mode !== "legacy") {
    if (!/^postgres(ql)?:\/\//.test(config.database.url)) {
      throw new Error(`COMPANY_READ_SOURCE=${mode} vereist DATABASE_URL (of STORAGE_ADAPTER=postgres)`);
    }
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: config.database.url, ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined, max: 3 });
  }
  const { makeCompanySource } = require("./infrastructure/company-source");
  const source = makeCompanySource({ mode, store, pool, telemetry });
  if (pool) {
    setTimeout(() => source.syncNow().catch(() => {}), 21 * 1000).unref();
    setInterval(() => source.syncNow().catch(() => {}), config.company.syncIntervalMs).unref();
    console.log(`  Company   : ${mode}${mode === "legacy" ? " (spiegel-lus bouwt bewijs op)" : mode === "shadow" ? " (legacy leidend, pg leest mee)" : " (pg-leesbron · legacy blijft write-owner)"}`);
  }
  return source;
})();
/**
 * Migratie-orchestrator (P0-01 sluitstuk): coördineert de genormaliseerde
 * snapshot-spiegel-domeinen als één geheel voor de cutover-beslissing.
 * Dependency-volgorde: identity (tenants/users) → company → finance.
 */
const migrationOrchestrator = require("./infrastructure/migration-orchestrator").makeMigrationOrchestrator({
  domains: [
    { name: "identity", source: identitySource },
    { name: "company", source: companySource, dependsOn: ["identity"] },
    { name: "finance", source: financeSource, dependsOn: ["identity", "company"] },
  ],
  // CRM volgt een eigen (oudere) cutover-route met een eigen reconciliatie-CLI;
  // hier alleen informatief.
  info: { crm: () => (customerSource.status ? customerSource.status() : { source: config.crm.readSource }) },
});
/**
 * Persistent verzendlog (F-09). Was een proceslokale ring-buffer: die verdween
 * bij elke herstart en verschilde per replica, dus de superadmin zag maar een
 * fractie. Nu in de store, met een eigen bovengrens zodat het log niet
 * ongelimiteerd groeit.
 */
const MAIL_LOG_MAX = 1000;
setMailSink({
  record(entry) {
    if (!Array.isArray(store.data.mailLog)) store.data.mailLog = [];
    store.data.mailLog.push({ id: `mail_${Date.now()}_${Math.random().toString(16).slice(2)}`, ...entry });
    if (store.data.mailLog.length > MAIL_LOG_MAX) store.data.mailLog = store.data.mailLog.slice(-MAIL_LOG_MAX);
    store.save();
  },
  recent(limit = 100) {
    return (store.data.mailLog || []).slice(-limit).reverse();
  },
});
/** Kosttarieven zijn gevoelige velden (h8.2): enkel beheerders zien/beheren ze. */
function canSeeEmployeeCost(user) {
  return !!user && ["tenant_admin", "super_admin"].includes(user.role);
}
/**
 * Vul ontbrekende uurtarieven op werkbonregels aan uit het personeelsregister,
 * met het tarief dat gold op de UITVOERINGSDATUM (h16-business rule + h25).
 * Zo is er één bron voor kost en blijft historische nacalculatie correct als
 * een tarief later wijzigt. Expliciet meegegeven tarieven blijven leidend.
 */
function enrichWorkerRates(tenantId, workers, executionDate) {
  if (!Array.isArray(workers)) return workers;
  return workers.map(w => {
    if (w.costRate != null && w.salesRate != null) return w;
    const emp = (w.employeeId && employeeRepo.findById(tenantId, w.employeeId))
      || (w.userId && employeeRepo.findByUserId(tenantId, w.userId));
    if (!emp) return w;
    const r = rateOn(emp, executionDate);
    if (!r.found) return w;
    return {
      ...w,
      costRate: w.costRate != null ? w.costRate : r.costRate,
      salesRate: w.salesRate != null ? w.salesRate : r.salesRate,
      hourCode: w.hourCode || r.hourCode,
    };
  });
}
/**
 * HTTPS-transport voor de webhook-runtime (E19). De platform-laag blijft
 * cloudblind (ADR-001): zij kent geen https · deze adapter injecteert hem.
 * Gebruikt de geharde gedeelde client (timeout, nette foutafhandeling).
 */
async function webhookTransport({ url, body, headers }) {
  const parsed = new URL(url);
  const res = await httpsRequest({
    hostname: parsed.hostname,
    port: parsed.port || undefined,        // klant-endpoints mogen een eigen poort gebruiken
    path: `${parsed.pathname}${parsed.search}`,
    method: "POST",
    headers,
    body,
    timeoutMs: 10000,
  });
  return { statusCode: res.statusCode, text: res.text };
}
const configRepo = makeConfigRepository(store);
const automationRepo = makeAutomationRepository(store);
// Unit-of-work port (E1 · ADR-003): atomaire multi-writes, adapter-onafhankelijk.
// De lokale manager dekt de store-flows; op PostgreSQL bestaat daarnaast de
// échte database-unit-of-work (P0-01): repository-calls die binnen één
// pgTxManager.run(...) lopen, joinen automatisch dezelfde transactie
// (BEGIN/COMMIT/ROLLBACK op één connectie) zonder dat repositorycode wijzigt.
const txManager = makeLocalTransactionManager(store);
const pgTxManager = storeAdapter && storeAdapter.name === "postgres"
  ? require("./infrastructure/postgres/pg-transaction-manager").makePgTransactionManager(storeAdapter.pool)
  : null;
// Automation-engine (E11) luistert op alle domain events (best-effort).
registerEventListener(makeDispatcher(store));
// h26 · Forms assignment-triggers: een domeinevent kan automatisch een
// formulier toewijzen (objectaanmaak/statuswijziging/bedrag/...). Best-effort
// en idempotent per (event, definitie) · een trigger mag een event nooit laten
// falen; zonder pg (geen formsRepo) is er niets te triggeren.
if (formsRepo) {
  registerEventListener((event) => {
    formsRepo.processDomainEvent(event.tenantId, event)
      .then(r => { if (r.created.length) telemetry.metric("forms.trigger.assigned", r.created.length, { event: event.eventType }); })
      .catch(() => { /* best-effort: nooit het event blokkeren */ });
  });
}

function csvCell(value) {
  const text = value == null ? "" : Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function sendCsv(res, filename, rows) {
  const fields = Array.from(rows.reduce((set, row) => {
    Object.keys(row || {}).forEach(key => {
      if (!["passwordHash", "encryptedSecret", "mfaSecret", "recoveryCodes"].includes(key)) set.add(key);
    });
    return set;
  }, new Set(["id", "tenantId"])));
  const lines = [
    fields.map(csvCell).join(","),
    ...rows.map(row => fields.map(field => csvCell(row[field])).join(","))
  ];
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store"
  });
  res.end(lines.join("\n"));
}

function actor(req) {
  const user = authenticate(req, store) || authenticateApiKey(store, req.headers["x-api-key"], requestMetadata(req));
  // Onthoud wie de aanroeper is, zodat telemetrie en securityevents een actorId
  // kunnen meedragen (handover 4.7). Bewust het INTERNE id, geen e-mailadres:
  // dat laatste is PII en hoort niet in telemetrie.
  if (user) req.wfpActor = { id: user.id, tenantId: user.tenantId };
  // Read-only support-sessie: blokkeer elke schrijfactie centraal.
  if (user) assertSupportWrite(user, req.method);
  return user;
}

function requestMetadata(req) {
  return {
    method: req.method,
    path: new URL(req.url, `http://${req.headers.host}`).pathname
  };
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  throw error;
}

function assertInteractiveUser(user) {
  if (user?.authType === "api_key") forbidden("Interactive admin login required");
  assertAdminMfa(user);
}

function assertHumanUser(user) {
  if (user?.authType === "api_key") forbidden("Interactive admin login required");
}

function assertApiKeyWriteAllowed(user, req) {
  if (user?.authType === "api_key" && req.method === "GET" && !(user.apiKeyScopes || []).includes("read")) {
    recordApiKeyDenied(store, user, requestMetadata(req), "missing_read_scope");
    forbidden("API key mist read scope");
  }
  if (user?.authType === "api_key" && req.method !== "GET" && !(user.apiKeyScopes || []).includes("write")) {
    recordApiKeyDenied(store, user, requestMetadata(req), "missing_write_scope");
    forbidden("API key mist write scope");
  }
}

/**
 * Fouten die een SECURITYgebeurtenis zijn (handover 4.7): een geweigerde
 * toegang moet als apart kanaal zichtbaar zijn, niet verstopt tussen gewone
 * 4xx-ruis. De code bepaalt de soort, zodat een SOC-regel erop kan filteren.
 */
function securityKindFor(error) {
  const code = String(error.code || "");
  if (code === "CROSS_TENANT_KEY" || code === "STATE_REVISION_CONFLICT") return "cross_tenant_denied";
  if (code === "FINANCIAL_SCOPE" || code === "OWN_HOURS_ONLY") return "permission_denied";
  if (error.status === 403) return "permission_denied";
  if (error.status === 401) return "auth_failure";
  return null;
}

function handleError(req, res, error, tenantId = null) {
  const status = error.status || 500;
  // Telemetrie vóór de response: ook een 500 moet traceerbaar zijn.
  const kind = securityKindFor(error);
  if (kind) {
    telemetry.security({
      kind, outcome: "denied",
      message: error.message,
      correlationId: res.wfpCorrelationId, requestId: res.wfpRequestId,
      tenantId, actorId: (req.wfpActor && req.wfpActor.id) || null,
      attributes: { path: new URL(req.url, config.appUrl).pathname, method: req.method, code: error.code || null },
    });
  } else if (status >= 500) {
    telemetry.log({
      level: "error", message: error.message || "Server error",
      correlationId: res.wfpCorrelationId, requestId: res.wfpRequestId, tenantId,
      attributes: { path: new URL(req.url, config.appUrl).pathname, method: req.method, status, code: error.code || null },
    });
  }
  if (status >= 500) {
    store.errorEvent({
      tenantId,
      method: req.method,
      path: new URL(req.url, config.appUrl).pathname,
      status,
      message: error.message || "Server error",
      requestId: res.wfpRequestId || null,
      stack: String(error.stack || "").split("\n").slice(0, 4).join("\n")
    });
  }
  const payload = { ok: false, error: error.message || "Server error" };
  if (error.code) payload.code = error.code;       // bv. module_disabled / submodule_disabled
  if (error.module) payload.module = error.module;
  if (error.fieldErrors) payload.fieldErrors = error.fieldErrors;
  sendJson(res, status, payload);
}

function publicQuotePage() {
  // Self-contained publieke offerte-pagina. Leest token uit de URL en praat
  // met /api/public/quote/:token. Geen login, geen externe assets.
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offerte · Monargo One</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,Arial,sans-serif;background:#F0F4F8;color:#0F172A;padding:24px;line-height:1.5}
.wrap{max-width:680px;margin:0 auto}
.card{background:#fff;border:1px solid #E2E8F0;border-radius:14px;box-shadow:0 4px 16px rgba(0,0,0,.05);overflow:hidden}
.hd{background:#0B1929;color:#fff;padding:22px 24px}
.hd h1{font-size:20px;font-weight:800}.hd .sub{color:#94A3B8;font-size:13px;margin-top:2px}
.body{padding:24px}
.meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:13px;color:#64748B;margin-bottom:18px}
table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px}
th{text-align:left;padding:8px 10px;background:#F8FAFC;color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid #E2E8F0}
td{padding:9px 10px;border-bottom:1px solid #F1F5F9}.num{text-align:right;font-variant-numeric:tabular-nums}
.tot{margin-left:auto;width:240px}.tot .row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px}
.tot .grand{font-weight:800;font-size:16px;border-top:2px solid #0F172A;padding-top:8px;margin-top:4px}
.actions{display:flex;gap:10px;margin-top:22px}
button{flex:1;padding:13px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}
.accept{background:#10B981;color:#fff}.reject{background:#fff;color:#64748B;border:1.5px solid #E2E8F0}
.banner{padding:14px 18px;border-radius:10px;font-weight:600;font-size:14px;text-align:center;margin-top:8px}
.ok{background:#D1FAE5;color:#065F46}.warn{background:#FEF3C7;color:#92400E}.muted{color:#94A3B8;text-align:center;padding:40px}
.foot{text-align:center;font-size:11px;color:#94A3B8;margin-top:18px}
</style></head><body>
<div class="wrap"><div class="card">
  <div class="hd"><h1 id="coName">Offerte</h1><div class="sub" id="coNr"></div></div>
  <div class="body" id="body"><div class="muted">Laden…</div></div>
</div><div class="foot">Aangeboden via Monargo One</div></div>
<script>
const token = location.pathname.split("/").filter(Boolean).pop();
const eur = n => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(Number(n||0));
const esc = s => String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
async function load(){
  try{
    const d = await (await fetch("/api/public/quote/"+token)).json();
    if(!d.ok){ document.getElementById("body").innerHTML='<div class="muted">Offerte niet gevonden.</div>'; return; }
    const q=d.quote, c=d.company;
    document.getElementById("coName").textContent=c.name||"Offerte";
    document.getElementById("coNr").textContent="Offerte "+esc(q.number)+(c.vat?" · "+esc(c.vat):"");
    const done = q.status==="aanvaard"||q.status==="geweigerd";
    const expired = q.status==="verlopen";
    document.getElementById("body").innerHTML=
      '<div class="meta"><span>Datum: '+esc(q.quoteDate||"-")+'</span><span>Geldig tot: '+esc(q.validUntil||"-")+'</span></div>'+
      '<table><thead><tr><th>Omschrijving</th><th class="num">Aantal</th><th class="num">Prijs</th><th class="num">Btw</th><th class="num">Totaal</th></tr></thead><tbody>'+
      (q.lines||[]).map(l=>'<tr><td>'+esc(l.description)+'</td><td class="num">'+esc(l.qty)+'</td><td class="num">'+eur(l.unitPrice)+'</td><td class="num">'+esc(l.vatRate)+'%</td><td class="num">'+eur(l.lineTotal)+'</td></tr>').join("")+
      '</tbody></table>'+
      '<div class="tot"><div class="row"><span>Subtotaal</span><span>'+eur(q.subtotal)+'</span></div><div class="row"><span>Btw</span><span>'+eur(q.vatAmount)+'</span></div><div class="row grand"><span>Totaal</span><span>'+eur(q.total)+'</span></div></div>'+
      (q.notes?'<p style="font-size:13px;color:#64748B;margin-top:14px">'+esc(q.notes)+'</p>':"")+
      (done? '<div class="banner '+(q.status==="aanvaard"?"ok":"warn")+'">'+(q.status==="aanvaard"?"✅ Offerte ondertekend · bedankt!":"Offerte geweigerd")+'</div>'+(q.status==="aanvaard"?'<div style="text-align:center;margin-top:10px"><a href="#" onclick="showReceipt();return false" style="font-size:13px;color:#2563EB">Bekijk het ondertekeningsbewijs</a></div><div id="receipt"></div>':"")
        : expired? '<div class="banner warn">Deze offerte is verlopen. Neem contact op voor een nieuwe.</div>'
        : '<div class="actions"><button class="accept" onclick="startSign()">✓ Offerte ondertekenen</button><button class="reject" onclick="decide(\\'reject\\')">Weigeren</button></div><div id="signPanel"></div>');
  }catch(e){ document.getElementById("body").innerHTML='<div class="muted">Er ging iets mis. Probeer later opnieuw.</div>'; }
}
// ── Geverifieerd ondertekenen: code naar het GEKENDE klantadres ──
async function startSign(){
  const r = await (await fetch("/api/public/quote/"+token+"/otp",{method:"POST"})).json();
  if(!r.ok && r.code==="NO_EMAIL_ON_FILE"){ decide("accept"); return; }   // geen adres bekend → gewone aanvaarding
  if(!r.ok && r.code!=="OTP_COOLDOWN"){ alert(r.error||"Er ging iets mis"); return; }
  const panel = document.getElementById("signPanel");
  panel.innerHTML =
    '<div style="margin-top:18px;padding:18px;border:1.5px solid #E2E8F0;border-radius:12px">'+
    '<div style="font-weight:700;margin-bottom:4px">Verifieer en onderteken</div>'+
    '<div style="font-size:13px;color:#64748B;margin-bottom:14px">Er is een 6-cijferige code gestuurd naar '+esc(r.sentTo||"het gekende e-mailadres")+'.</div>'+
    '<label style="font-size:12px;font-weight:600">Verificatiecode</label>'+
    '<input id="sgCode" inputmode="numeric" maxlength="6" style="width:100%;padding:11px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:18px;letter-spacing:6px;text-align:center;margin:4px 0 12px" placeholder="······">'+
    '<label style="font-size:12px;font-weight:600">Naam ondertekenaar</label>'+
    '<input id="sgName" style="width:100%;padding:11px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:14px;margin:4px 0 12px" placeholder="Voor- en achternaam">'+
    '<label style="font-size:12px;font-weight:600">Handtekening (optioneel · teken met muis of vinger)</label>'+
    '<canvas id="sgPad" width="420" height="120" style="width:100%;border:1.5px dashed #CBD5E1;border-radius:8px;margin:4px 0 4px;touch-action:none;background:#fff"></canvas>'+
    '<div style="display:flex;justify-content:space-between;margin-bottom:12px"><a href="#" onclick="clearPad();return false" style="font-size:12px;color:#64748B">Wissen</a>'+
    '<a href="#" id="sgResend" onclick="resend();return false" style="font-size:12px;color:#94A3B8;pointer-events:none">Nieuwe code (60s)</a></div>'+
    '<div id="sgErr" style="color:#B91C1C;font-size:13px;font-weight:600;margin-bottom:8px"></div>'+
    '<button class="accept" style="width:100%" onclick="submitSign()">Onderteken offerte</button></div>';
  initPad();
  let left = r.cooldownSeconds||60;
  const timer = setInterval(()=>{ left--; const a=document.getElementById("sgResend"); if(!a){clearInterval(timer);return;}
    if(left<=0){ a.textContent="Nieuwe code sturen"; a.style.color="#2563EB"; a.style.pointerEvents="auto"; clearInterval(timer); }
    else a.textContent="Nieuwe code ("+left+"s)"; },1000);
  panel.scrollIntoView({behavior:"smooth",block:"center"});
}
let padDirty=false;
function initPad(){
  const cv=document.getElementById("sgPad"); if(!cv) return; const ctx=cv.getContext("2d");
  ctx.lineWidth=2; ctx.lineCap="round"; ctx.strokeStyle="#0F172A"; let drawing=false;
  const pos=e=>{ const r=cv.getBoundingClientRect(); const p=e.touches?e.touches[0]:e; return {x:(p.clientX-r.left)*cv.width/r.width,y:(p.clientY-r.top)*cv.height/r.height}; };
  const start=e=>{ drawing=true; padDirty=true; const p=pos(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); e.preventDefault(); };
  const move=e=>{ if(!drawing) return; const p=pos(e); ctx.lineTo(p.x,p.y); ctx.stroke(); e.preventDefault(); };
  const end=()=>{ drawing=false; };
  cv.addEventListener("mousedown",start); cv.addEventListener("mousemove",move); window.addEventListener("mouseup",end);
  cv.addEventListener("touchstart",start,{passive:false}); cv.addEventListener("touchmove",move,{passive:false}); cv.addEventListener("touchend",end);
}
function clearPad(){ const cv=document.getElementById("sgPad"); if(cv){ cv.getContext("2d").clearRect(0,0,cv.width,cv.height); padDirty=false; } }
async function resend(){ document.getElementById("signPanel").innerHTML=""; startSign(); }
async function submitSign(){
  const code=(document.getElementById("sgCode").value||"").trim();
  const name=(document.getElementById("sgName").value||"").trim();
  const err=document.getElementById("sgErr");
  if(code.length!==6){ err.textContent="Vul de 6-cijferige code in."; return; }
  if(!name){ err.textContent="Vul de naam van de ondertekenaar in."; return; }
  const cv=document.getElementById("sgPad");
  const signature = padDirty && cv ? cv.toDataURL("image/png") : undefined;
  const d = await (await fetch("/api/public/quote/"+token,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({decision:"accept",code,name,signature})})).json();
  if(!d.ok){ err.textContent=d.error||"Ondertekenen mislukt"; return; }
  load();
}
async function showReceipt(){
  const r = await (await fetch("/api/public/quote/"+token+"/receipt")).json();
  if(!r.ok) return;
  const a=r.receipt;
  document.getElementById("receipt").innerHTML =
    '<div style="margin-top:12px;padding:16px;border:1px solid #E2E8F0;border-radius:10px;font-size:13px;text-align:left">'+
    '<div style="font-weight:700;margin-bottom:8px">Ondertekeningsbewijs</div>'+
    '<div>Document: offerte '+esc(a.document.number)+' · versie '+esc(a.document.version)+'</div>'+
    '<div>Ondertekend door: '+esc(a.signer.name)+(a.signer.verified?' · <span style="color:#065F46;font-weight:600">e-mail geverifieerd</span> ('+esc(a.signer.verifiedEmail||"")+')':' · niet geverifieerd')+'</div>'+
    '<div>Tijdstip: '+esc(a.signedAt)+'</div>'+
    '<div style="word-break:break-all;color:#94A3B8;margin-top:6px">Documentvingerafdruk: '+esc(a.document.documentHash||"-")+'</div>'+
    '<div style="color:#64748B;margin-top:6px">'+esc(a.note)+'</div></div>';
}
async function decide(decision){
  if(decision==="accept" && !confirm("Offerte aanvaarden?")) return;
  if(decision==="reject" && !confirm("Offerte weigeren?")) return;
  const d = await (await fetch("/api/public/quote/"+token,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({decision})})).json();
  if(!d.ok && d.error) alert(d.error);
  load();
}
load();
</script></body></html>`;
}

function publicPayPage() {
  // Mock-betaalpagina (geen echte Stripe). Toont factuur + "Betaal nu (demo)".
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Betaling · Monargo One</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:Inter,system-ui,Arial,sans-serif;background:#F0F4F8;color:#0F172A;padding:24px;line-height:1.5}
.wrap{max-width:480px;margin:0 auto}.card{background:#fff;border:1px solid #E2E8F0;border-radius:14px;box-shadow:0 4px 16px rgba(0,0,0,.05);overflow:hidden}
.hd{background:#0B1929;color:#fff;padding:22px 24px}.hd h1{font-size:18px;font-weight:800}.hd .sub{color:#94A3B8;font-size:13px;margin-top:2px}
.body{padding:24px}.amount{font-size:34px;font-weight:800;text-align:center;margin:8px 0 4px}.muted{text-align:center;color:#94A3B8;font-size:13px;margin-bottom:20px}
button{width:100%;padding:14px;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;background:#10B981;color:#fff;font-family:inherit}
.demo{font-size:11px;color:#94A3B8;text-align:center;margin-top:12px}
.banner{padding:14px 18px;border-radius:10px;font-weight:600;font-size:14px;text-align:center;background:#D1FAE5;color:#065F46}
.foot{text-align:center;font-size:11px;color:#94A3B8;margin-top:18px}
</style></head><body>
<div class="wrap"><div class="card">
  <div class="hd"><h1 id="coName">Betaling</h1><div class="sub" id="coNr"></div></div>
  <div class="body" id="body"><div class="muted">Laden…</div></div>
</div><div class="foot">Beveiligde betaling via Monargo One</div></div>
<script>
const token = location.pathname.split("/").filter(Boolean).pop();
const eur = n => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(Number(n||0));
const esc = s => String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
async function load(){
  try{
    const d = await (await fetch("/api/public/pay/"+token)).json();
    if(!d.ok){ document.getElementById("body").innerHTML='<div class="muted">Factuur niet gevonden.</div>'; return; }
    const inv=d.invoice;
    document.getElementById("coName").textContent=d.company.name||"Betaling";
    document.getElementById("coNr").textContent="Factuur "+esc(inv.number);
    if(inv.status==="paid"){ document.getElementById("body").innerHTML='<div class="banner">✅ Deze factuur is reeds betaald · bedankt!</div>'; return; }
    document.getElementById("body").innerHTML=
      '<div class="amount">'+eur(inv.total)+'</div><div class="muted">Factuur '+esc(inv.number)+' · '+esc(inv.customerName||"")+'</div>'+
      '<button onclick="pay()">Betaal nu</button><div class="demo">Demo-betaling · markeert de factuur als betaald.</div>';
  }catch(e){ document.getElementById("body").innerHTML='<div class="muted">Er ging iets mis.</div>'; }
}
async function pay(){
  const d = await (await fetch("/api/public/pay/"+token,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
  load();
}
load();
</script></body></html>`;
}

// In-memory gzip-cache voor tekstassets. Sleutel = pad; auto-invalidatie als de
// bestandsgrootte wijzigt (na edit) of bij procesherstart (na deploy).
const _gzCache = new Map();
function gzipFor(filePath, data) {
  const c = _gzCache.get(filePath);
  if (c && c.size === data.length) return c.buf;
  const buf = require("zlib").gzipSync(data);
  _gzCache.set(filePath, { size: data.length, buf });
  return buf;
}

function serveStatic(req, res) {
  const url = new URL(req.url, config.appUrl);
  const file = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const filePath = path.join(config.root, "public", file);
  if (!filePath.startsWith(path.join(config.root, "public"))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const MIME = {
      ".js": "text/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".json": "application/json",
      ".webmanifest": "application/manifest+json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".woff2": "font/woff2",
      ".woff": "font/woff",
      ".txt": "text/plain"
    };
    const type = MIME[ext] || "application/octet-stream";
    const isText = type.startsWith("text/") || type === "application/json" || type === "application/manifest+json";
    const cacheControl = [".woff2", ".woff", ".png", ".jpg", ".jpeg", ".svg", ".ico"].includes(ext)
      ? "public, max-age=86400"  // 24h cache voor statische assets
      : "no-store";
    // Gzip voor tekstassets (JS/CSS/HTML/JSON) wanneer de client het ondersteunt.
    const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
    if (isText && acceptsGzip && data.length > 1024) {
      const gz = gzipFor(filePath, data);
      res.writeHead(200, securityHeaders({
        "Content-Type": `${type}; charset=utf-8`,
        "Cache-Control": cacheControl,
        "Content-Encoding": "gzip",
        "Vary": "Accept-Encoding"
      }));
      res.end(gz);
      return;
    }
    res.writeHead(200, securityHeaders({
      "Content-Type": isText ? `${type}; charset=utf-8` : type,
      "Cache-Control": cacheControl
    }));
    res.end(data);
  });
}

// CTO-03 · bootgate. Het proces gaat METEEN luisteren, nog voor de store is
// geladen. Reden: dit platform verdraagt maar EEN schrijver, en een platform
// dat zero-downtime deployt (Render, Kubernetes RollingUpdate) stopt de oude
// instantie pas zodra de nieuwe gezond is. Wachtten we met luisteren tot we de
// writer-lock hadden, dan werd de nieuwe instantie nooit gezond, stopte de oude
// nooit en kwam de lock nooit vrij · een deadlock die elke deploy liet falen.
// Door eerst te luisteren wordt de healthcheck groen, stopt het platform de
// oude instantie, valt de lock vrij en neemt deze instantie hem over.
// CTO3-01 · STARTUP-STATE-MACHINE. De bootgate opent businessverkeer UITSLUITEND
// wanneer de staat geladen EN de laatste verplichte bootflush geslaagd is
// (state=ready). Elke tussenstap is expliciet en zichtbaar. Een mislukte
// verplichte persistactie is een HARDE, zichtbare startupfout (state=failed,
// exit 1) · nooit een stille best-effort. Liveness (het proces leeft) en
// readiness (mag businessverkeer bedienen) zijn verschillende signalen: alleen
// readiness bepaalt of businessroutes worden bediend.
const BOOT_STATES = ["booting", "migrating", "waiting_lock", "loading", "flushing", "ready", "failed"];
let bootState = "booting";
// CTO3-05 · migratieversie gecacht bij boot (niet-geheim) voor de veilige
// readiness-samenvatting: aantal toegepaste migraties + de laatst toegepaste id.
let bootMigrationVersion = null;
function setBootState(next) {
  if (!BOOT_STATES.includes(next)) return;
  // 'ready' is een eindtoestand: alleen 'failed' mag hem nog overrulen.
  if (bootState === "ready" && next !== "failed") return;
  bootState = next;
  if (next !== "ready") console.log(`[boot] state=${next}`);
}
function isBootReady() { return bootState === "ready"; }

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, config.appUrl);
  if (!isBootReady()) {
    // Liveness: het proces leeft (ook tijdens opstarten). Nooit een readiness-
    // claim: een 200 hier betekent NIET dat businessverkeer veilig kan.
    if (url.pathname === "/api/health" || url.pathname === "/api/live") {
      return sendJson(res, 200, {
        ok: true, app: "Monargo One Fullstack", status: bootState,
        appEnv: config.appEnv, version: config.appVersion,
        commitSha: config.commitSha, deploymentId: config.deploymentId,
      });
    }
    // Readiness weerspiegelt de state-machine: 503 tot state=ready.
    if (url.pathname === "/api/ready") {
      res.setHeader("retry-after", "5");
      return sendJson(res, 503, {
        ok: false, code: "NOT_READY", status: bootState,
        commitSha: config.commitSha, deploymentId: config.deploymentId,
      });
    }
    // Alle overige (business)routes: geweigerd tot de staat geladen EN geflusht is.
    res.setHeader("retry-after", "5");
    return sendJson(res, 503, {
      ok: false, code: "BOOTING", status: bootState,
      error: "De server start op. Businessverkeer wordt pas bediend na volledige, duurzame initialisatie.",
    });
  }
  let errorTenantId = url.pathname.match(/^\/api\/tenants\/([^/]+)\//)?.[1] || null;
  // Correlatie-id (backend-handoff): elk antwoord draagt een requestId zodat een
  // testerscreenshot naar de juiste serverlog leidt. Geen gevoelige data.
  res.wfpRequestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  res.setHeader("x-request-id", res.wfpRequestId);
  // Correlatievelden voor telemetrie (handover 4.7). Een correlationId van de
  // client wordt overgenomen zodat een keten over meerdere diensten te volgen
  // is; anders is het requestId de correlatie.
  res.wfpCorrelationId = String(req.headers["x-correlation-id"] || res.wfpRequestId).slice(0, 64);
  res.wfpStartedAt = Date.now();
  // CTO-05 · durability-gate: op een muterende request vertrekt een geslaagde
  // response pas NADAT de staat echt gepersisteerd is (flush vóór antwoord).
  // Zo overleeft een write zelfs een harde crash direct na de 2xx; het oude
  // gat ("flush ná antwoord, één event-loop-tik risico") is hiermee dicht.
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    res.wfpBeforeSend = async (status) => {
      if (status < 400 && store.isDirty()) await store.flush();
    };
  }

  try {
    const rateLimit = checkRateLimit(req, url.pathname);
    if (rateLimit.limited) {
      store.errorEvent({
        tenantId: errorTenantId,
        method: req.method,
        path: url.pathname,
        status: 429,
        message: `Rate limit exceeded (${rateLimit.policy})`
      });
      sendJson(res, 429, {
        ok: false,
        error: "Te veel aanvragen. Probeer zo meteen opnieuw.",
        retryAfter: rateLimit.retryAfter
      }, {
        "Retry-After": String(rateLimit.retryAfter),
        "X-RateLimit-Limit": String(rateLimit.limit),
        "X-RateLimit-Remaining": String(rateLimit.remaining),
        "X-RateLimit-Reset": String(rateLimit.resetAt)
      });
      return;
    }

    // CTO3-02 · LIVENESS. /api/health en /api/live melden dat het PROCES leeft.
    // Dit is NOOIT een readiness-claim: een 200 hier betekent niet dat business-
    // verkeer veilig kan · daarvoor is /api/ready. (Tijdens het opstarten wordt
    // liveness al door de bootgate bediend; dit is het pad zodra state=ready.)
    if (url.pathname === "/api/live") {
      return sendJson(res, 200, {
        ok: true, app: "Monargo One Fullstack", status: bootState,
        appEnv: config.appEnv, version: config.appVersion,
        commitSha: config.commitSha, deploymentId: config.deploymentId,
        uptime: Math.floor(process.uptime()),
      });
    }
    if (url.pathname === "/api/health") {
      const storeStatus = store.storageStatus ? store.storageStatus() : { ok: true };
      sendJson(res, 200, {
        ok: true,
        app: "Monargo One Fullstack",
        status: bootState,
        deploymentId: config.deploymentId,
        appEnv: config.appEnv,
        version: config.appVersion,
        releaseChannel: config.releaseChannel,
        commitSha: config.commitSha,
        storageAdapter: config.storageAdapter,
        // Unit-of-work-adapter (E1 · ADR-003): op PostgreSQL de echte
        // database-transactie (P0-01), anders de lokale store-variant.
        txAdapter: (pgTxManager || txManager).adapter,
        objectStorageAdapter: objectStorage.name,
        identitySource: identitySource.mode,   // P0-01-migratiestand
        financeSource: financeSource.mode,
        companySource: companySource.mode,
        storeReady: storeStatus?.ok !== false,
        modules: modules.length,
        uptime: Math.floor(process.uptime()),
        time: new Date().toISOString()
      });
      return;
    }

    // ── Moderne /v1-API (spec 5.4 + h41): canonieke Engelse namespace als
    //    vertaallaag over de bestaande tenant-routes. Strangler: /api blijft
    //    werken; /v1 herschrijft de request en armt de responstransformatie
    //    (centen, 422-veldfouten, ETag/links) die in sendJson draait ──
    if (url.pathname === "/v1" || url.pathname.startsWith("/v1/")) {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, code: "UNAUTHENTICATED", error: "Authenticatie vereist" });
      // Tenantcontext komt uit het token; een superadmin kiest expliciet via header.
      const tenantId = user.tenantId || (user.role === "super_admin" ? String(req.headers["x-tenant-id"] || "") : "");
      if (!tenantId) return sendJson(res, 403, { ok: false, code: "TENANT_CONTEXT_REQUIRED", error: "Dit endpoint vereist tenantcontext (token van een tenant-gebruiker)" });
      const v1 = await apiV1.prepareV1(req, url, { readBody });
      if (v1.error) return sendJson(res, v1.error.status, v1.error.payload);
      if (v1.discovery) return sendJson(res, 200, v1.discovery);
      req.method = v1.method;
      url.pathname = `/api/tenants/${tenantId}/${v1.path}`;
      req.url = url.pathname + url.search;
      if (v1.body !== undefined) req.wfpPrereadBody = v1.body;
      res.wfpV1 = v1.ctx;
      errorTenantId = tenantId;
      // GEEN return: valt door in de normale dispatch met alle bestaande
      // auth-, entitlement- en rechtenpoorten · pariteit is de garantie.
    }

    // Readiness probe (E1): faalt bij storage-uitval ZONDER het proces te doden.
    // Liveness (/api/health) blijft 200 zolang het proces draait; zo herstart de
    // orchestrator niet onnodig bij een tijdelijke DB-hapering (K8s/Render/Azure).
    // CTO3-02 · READINESS. Dit pad wordt alleen bereikt wanneer state=ready
    // (de bootgate heeft migraties, writer-lock, state-load en de verplichte
    // bootflush al met succes doorlopen · anders was het proces hard gestopt).
    // Een runtime-storagefout maakt de instantie alsnog NIET-ready (503) zodat
    // een orchestrator ze uit rotatie haalt. Readiness bepaalt of businessverkeer
    // wordt toegelaten; deze respons is machineleesbaar en SHA-gekoppeld.
    if (url.pathname === "/api/ready") {
      const storeStatus = store.storageStatus ? store.storageStatus() : { ok: true };
      const ready = isBootReady() && storeStatus?.ok !== false;
      sendJson(res, ready ? 200 : 503, {
        ok: ready,
        status: bootState,
        commitSha: config.commitSha,
        deploymentId: config.deploymentId,
        checks: {
          state: isBootReady(),           // staat geladen + bootflush geslaagd
          storage: storeStatus?.ok !== false,
          storageAdapter: config.storageAdapter,
          objectStorageAdapter: objectStorage.name,
          txAdapter: (pgTxManager || txManager).adapter,
          databaseSslMode: config.database.sslMode,
          // Openstaande schrijfacties: een orchestrator kan hierop wachten
          // vóór hij een replica uit rotatie haalt.
          pendingWrites: store.isDirty(),
          // CTO3-05 · veilige config-samenvatting (NOOIT secrets): bronstatus per
          // domein, TLS/single-writer-modus, release-kanaal en migratieversie.
          releaseChannel: config.releaseChannel,
          singleWriter: !!config.singleWriter,
          databaseCaCertPresent: !!(config.database && config.database.caCert),
          migrationVersion: bootMigrationVersion,
          sources: {
            crm: config.crm.readSource,
            identity: config.identity.readSource,
            finance: config.finance.readSource,
            company: config.company.readSource,
            forms: config.forms.source,
          },
        },
        store: storeStatus,
      });
      return;
    }

    if (url.pathname === "/api/status" && req.method === "GET") {
      sendJson(res, 200, publicStatus(store));
      return;
    }

    if (url.pathname === "/api/openapi.json" && req.method === "GET") {
      sendJson(res, 200, openApiSpec());
      return;
    }

    if (url.pathname === "/api/releases" && req.method === "GET") {
      sendJson(res, 200, { ok: true, release: releaseInfo() });
      return;
    }

    // Publieke platform-aankondiging / onderhoudsbanner · getoond aan alle shells.
    if (url.pathname === "/api/announcement" && req.method === "GET") {
      const a = loadPlatformConfig(store).announcement || {};
      sendJson(res, 200, { ok: true, announcement: a.active ? { active: true, level: a.level || "info", message: a.message || "" } : { active: false } });
      return;
    }

    if (url.pathname === "/api/webhooks/stripe" && req.method === "POST") {
      const rawBody = await readRawBody(req);
      const signature = verifyStripeSignature(rawBody, req.headers["stripe-signature"], {
        webhookSecret: config.stripe.webhookSecret,
        requireSignature: config.isProduction
      });
      if (!signature.ok) return sendJson(res, 400, { ok: false, error: "Invalid Stripe signature" });
      let event;
      try {
        event = rawBody ? JSON.parse(rawBody) : {};
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
      }
      // Klantfactuur betaald via Checkout? (metadata.wfp_invoice_id)
      const obj = event?.data?.object || {};
      const invId = obj.metadata?.wfp_invoice_id || (obj.client_reference_id && String(obj.client_reference_id).startsWith("inv_") ? obj.client_reference_id : null);
      if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type) && invId) {
        const paid = markInvoicePaidById(store, invId, "stripe");
        if (paid) {
          createNotification(store, { id: paid.tenantId }, { type: "payment", channel: "in_app", audience: "admins", title: "Factuur betaald", body: `${paid.number} (€${Number(paid.total||0).toFixed(2)}) is betaald via Stripe.`, priority: "normal", sourceRef: `invoice:${paid.id}:paid` }, { email: "stripe-webhook" });
        }
        sendJson(res, 200, { ok: true, signature: signature.mode, invoicePaid: !!paid });
        return;
      }
      // Abonnement-levenscyclus (start/wijziging/opzegging) → tenant-status syncen.
      if (typeof event.type === "string" && event.type.startsWith("customer.subscription")) {
        const tenantId = obj.metadata?.wfp_tenant_id
          || (store.data.tenants || []).find(t => t.stripeCustomerId && t.stripeCustomerId === obj.customer)?.id;
        const subTenant = tenantId ? store.get("tenants", tenantId) : null;
        if (subTenant) {
          const patch = applySubscriptionEvent(subTenant, event);
          if (patch) {
            store.updateTenant(subTenant.id, patch);
            store.audit({ actor: "stripe-webhook", tenantId: subTenant.id, action: "subscription_synced", area: "billing", detail: `${event.type} → ${patch.status || "?"}` });
          }
        }
        sendJson(res, 200, { ok: true, signature: signature.mode, subscription: event.type });
        return;
      }
      const result = processStripeWebhook(store, event);
      sendJson(res, 200, { ok: true, signature: signature.mode, result });
      return;
    }

    // ── Inbound e-mail → klantvraag (provider-agnostisch: Mailgun/Postmark/SendGrid) ──
    if (url.pathname === "/api/webhooks/inbound-mail" && req.method === "POST") {
      const provided = url.searchParams.get("secret") || req.headers["x-inbound-secret"] || "";
      if (config.inboundMail.secret) {
        if (provided !== config.inboundMail.secret) return sendJson(res, 401, { ok: false, error: "Invalid inbound secret" });
      } else if (config.isProduction) {
        // Zonder secret geen open intake in productie (spam/forgery).
        return sendJson(res, 503, { ok: false, error: "Inbound mail is niet geconfigureerd" });
      }
      const body = await readBody(req);
      let mail;
      try { mail = parseInboundPayload(body); }
      catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message }); }
      const intakeTenant = resolveIntakeTenant(store, mail.to);
      if (!intakeTenant) return sendJson(res, 404, { ok: false, error: "Onbekend intake-adres" });
      if (!isModuleEnabled(store, intakeTenant, "inbox")) return sendJson(res, 403, { ok: false, error: "Module Klantvragen is niet actief voor deze organisatie" });
      const result = createInquiry(store, intakeTenant, mail);
      sendJson(res, 200, { ok: true, duplicate: result.duplicate, inquiryId: result.inquiry.id });
      return;
    }

    // ── Publieke offerte-acceptatie (geen login) ──────────────────────────────
    const pubQuoteMatch = url.pathname.match(/^\/api\/public\/quote\/([a-f0-9]+)$/);
    if (pubQuoteMatch && req.method === "GET") {
      const token = pubQuoteMatch[1];
      let found = null, foundTenant = null;
      for (const t of store.data.tenants || []) {
        const q = store.list("quotes", t.id).find(x => x.publicToken === token);
        if (q) { found = q; foundTenant = t; break; }
      }
      if (!found) return sendJson(res, 404, { ok: false, error: "Offerte niet gevonden" });
      const today = new Date().toISOString().slice(0, 10);
      const status = (found.status === "verzonden" && found.validUntil && found.validUntil < today) ? "verlopen" : found.status;
      sendJson(res, 200, { ok: true, quote: {
        number: found.number, customerName: found.customerName,
        quoteDate: found.quoteDate, validUntil: found.validUntil,
        lines: found.lines, subtotal: found.subtotal, vatAmount: found.vatAmount, total: found.total,
        notes: found.notes, status
      }, company: { name: foundTenant.name || "Monargo One", vat: foundTenant.invoiceProfile?.vat || "" } });
      return;
    }
    // Verificatiecode voor geverifieerd ondertekenen: gaat ALTIJD naar het
    // e-mailadres dat al in het klantdossier staat, nooit naar bezoekersinput.
    const pubQuoteOtpMatch = url.pathname.match(/^\/api\/public\/quote\/([a-f0-9]+)\/otp$/);
    if (pubQuoteOtpMatch && req.method === "POST") {
      for (const t of store.data.tenants || []) {
        const q = store.list("quotes", t.id).find(x => x.publicToken === pubQuoteOtpMatch[1]);
        if (!q) continue;
        try {
          const otp = quoteSigning.requestOtp(store, t, q);
          await sendMail({
            to: otp.email,
            subject: `Verificatiecode offerte ${q.number}: ${otp.code}`,
            text: `Beste,\n\nUw verificatiecode voor het ondertekenen van offerte ${q.number} van ${t.name || "uw leverancier"} is:\n\n    ${otp.code}\n\nDe code is 10 minuten geldig. Vroeg u geen code aan? Negeer dan deze e-mail; er wordt zonder deze code niets ondertekend.`,
          });
          store.audit({ actor: "public-sign", tenantId: t.id, action: "quote_otp_sent", area: "offertes", detail: `${q.number} → ${otp.masked}` });
          return sendJson(res, 200, { ok: true, sentTo: otp.masked, cooldownSeconds: Math.round(quoteSigning.OTP_RESEND_COOLDOWN_MS / 1000) });
        } catch (e) {
          return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, retryAfterSeconds: e.retryAfterSeconds });
        }
      }
      return sendJson(res, 404, { ok: false, error: "Offerte niet gevonden" });
    }
    // Ondertekeningsbewijs · pas beschikbaar na aanvaarding.
    const pubQuoteReceiptMatch = url.pathname.match(/^\/api\/public\/quote\/([a-f0-9]+)\/receipt$/);
    if (pubQuoteReceiptMatch && req.method === "GET") {
      for (const t of store.data.tenants || []) {
        const q = store.list("quotes", t.id).find(x => x.publicToken === pubQuoteReceiptMatch[1]);
        if (!q) continue;
        try { return sendJson(res, 200, { ok: true, receipt: quoteSigning.acceptanceReceipt(q, t) }); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
      }
      return sendJson(res, 404, { ok: false, error: "Offerte niet gevonden" });
    }
    if (pubQuoteMatch && req.method === "POST") {
      const token = pubQuoteMatch[1];
      const body = await readBody(req).catch(() => ({}));
      for (const t of store.data.tenants || []) {
        const q = store.list("quotes", t.id).find(x => x.publicToken === token);
        if (q) {
          if (["aanvaard", "geweigerd"].includes(q.status)) return sendJson(res, 409, { ok: false, error: "Offerte is al verwerkt" });
          if (quoteSigning.isExpired(q)) return sendJson(res, 409, { ok: false, error: "Deze offerte is verlopen · vraag een nieuwe versie aan", code: "QUOTE_EXPIRED" });
          const decision = body.decision === "reject" ? "geweigerd" : "aanvaard";
          const patch = { status: decision, updatedAt: new Date().toISOString() };
          if (decision === "aanvaard") {
            const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || null;
            const userAgent = String(req.headers["user-agent"] || "").slice(0, 200);
            const signerEmail = quoteSigning.signerEmailFor(store, t, q);
            if (signerEmail) {
              // Gekend adres → verificatie is VERPLICHT (geen stille terugval).
              try {
                patch.acceptance = quoteSigning.verifySignature(store, t, q, {
                  code: body.code, name: body.name, signatureDataUrl: body.signature, ip, userAgent,
                });
              } catch (e) {
                return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, attemptsLeft: e.attemptsLeft });
              }
              patch.acceptance.documentHash = patch.acceptance.documentHash || computeDocumentHash({ ...q, version: q.version || 1 });
              patch.signing = null;   // code is verbruikt
            } else {
              // Geen gekend adres → link-aanvaarding, eerlijk gemarkeerd.
              patch.acceptance = {
                name: String(body.name || q.customerName || "klant").slice(0, 120),
                at: new Date().toISOString(),
                version: q.version || 1,
                documentHash: q.documentHash || computeDocumentHash({ ...q, version: q.version || 1 }),
                verified: false, method: "link",
                ip, userAgent,
              };
            }
            patch.acceptedAt = patch.acceptance.at;
          } else {
            patch.rejectedAt = new Date().toISOString();
          }
          store.update("quotes", q.id, patch);
          store.audit({ actor: (patch.acceptance && patch.acceptance.name) || q.customerName || "klant", tenantId: t.id, action: `quote_${decision}_public`, area: "offertes", detail: `${q.number}${patch.acceptance && patch.acceptance.verified ? " · e-mail-geverifieerd" : ""}` });
          emitDomainEvent(store, { tenantId: t.id, eventType: decision === "aanvaard" ? "quote.accepted" : "quote.rejected", aggregateType: "quote", aggregateId: q.id, actor: "public-accept", correlationId: res.wfpRequestId, data: decision === "aanvaard" ? { verified: patch.acceptance.verified === true, method: patch.acceptance.method } : undefined });
          return sendJson(res, 200, { ok: true, status: decision, verified: patch.acceptance ? patch.acceptance.verified === true : undefined });
        }
      }
      return sendJson(res, 404, { ok: false, error: "Offerte niet gevonden" });
    }

    // ── Publieke mock-betaling (geen login) ───────────────────────────────────
    const pubPayMatch = url.pathname.match(/^\/api\/public\/pay\/([a-f0-9]+)$/);
    if (pubPayMatch && (req.method === "GET" || req.method === "POST")) {
      const token = pubPayMatch[1];
      let inv = null, invTenant = null;
      for (const t of store.data.tenants || []) {
        const found = store.list("invoices", t.id).find(x => x.payToken === token);
        if (found) { inv = found; invTenant = t; break; }
      }
      if (!inv) return sendJson(res, 404, { ok: false, error: "Factuur niet gevonden" });
      if (req.method === "GET") {
        return sendJson(res, 200, { ok: true, invoice: { number: inv.number, customerName: inv.customerName, total: inv.total, status: inv.status, invoiceDate: inv.invoiceDate, dueDate: inv.dueDate, lines: inv.lines }, company: { name: invTenant.name || "Monargo One" } });
      }
      if (inv.status === "paid") return sendJson(res, 409, { ok: false, error: "Factuur is al betaald" });
      const paid = markInvoicePaidById(store, inv.id, "mock");
      createNotification(store, { id: invTenant.id }, { type: "payment", channel: "in_app", audience: "admins", title: "Factuur betaald", body: `${paid.number} (€${Number(paid.total||0).toFixed(2)}) is betaald.`, priority: "normal", sourceRef: `invoice:${paid.id}:paid` }, { email: "mock-pay" });
      return sendJson(res, 200, { ok: true, status: "paid" });
    }

    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      const body = await readBody(req);
      const result = body.mfaCode
        ? loginWithMfa(store, body.email, body.password, body.mfaCode)
        : login(store, body.email, body.password);
      if (!result) return sendJson(res, 401, { ok: false, error: "Onjuist e-mailadres of wachtwoord" });
      if (result.mfaRequired) {
        store.audit({ actor: result.user.email, tenantId: result.user.tenantId, action: "mfa_required", area: "auth" });
        sendJson(res, 200, { ok: true, mfaRequired: true, user: safeUser(result.user) });
        return;
      }
      resetLoginFailures(store, result.user);
      store.update("users", result.user.id, { lastLoginAt: new Date().toISOString() });
      store.audit({ actor: result.user.email, tenantId: result.user.tenantId, action: "login", area: "auth" });
      // P0-01 schaduwlezing: vergelijk deze gebruiker met de genormaliseerde
      // tabel (na sync) · bouwt cutover-bewijs op, breekt de login nooit.
      identitySource.shadowCompareByEmail(body.email);
      sendJson(res, 200, { ok: true, token: result.token, user: safeUser(result.user) });
      return;
    }

    // ── CORS-preflight voor de publieke marketing-endpoints ───────────────────
    // Zodat monargo.com de canonieke prijzen/plannen cross-origin mag ophalen.
    if (req.method === "OPTIONS" && (url.pathname === "/api/plans" || url.pathname === "/api/sectors")) {
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }

    // ── Publieke plannen (registratiepagina én marketingsite monargo.com) ─────
    if (url.pathname === "/api/plans" && req.method === "GET") {
      // Eén bron van waarheid: dezelfde catalogus als in-app (prijzen, features,
      // 'meest gekozen', proefperiode), zodat monargo.com, de registratie en het
      // abonnementsscherm nooit uit elkaar lopen. Geen tenant-PII → CORS-baar.
      const plans = planCatalog(store).map(p => ({
        key: p.key, label: p.label, description: p.description || "",
        baseMonthly: p.baseMonthly ?? null, baseAnnual: p.baseAnnual ?? null,
        seatAnnual: p.seatAnnual ?? null, includedSeats: p.includedSeats ?? null,
        features: p.features || [], custom: !!p.custom, popular: !!p.popular,
        modules: Array.isArray(p.modules) ? p.modules.length : 0,
      }));
      sendJson(res, 200, {
        ok: true, plans, trialDays: TRIAL_DAYS,
        addons: listAddons(loadPlatformConfig(store).addons)
      }, corsHeaders(req));
      return;
    }

    // ── Publieke sectorlijst (onboarding-wizard + signup) ─────────────────────
    if (url.pathname === "/api/sectors" && req.method === "GET") {
      sendJson(res, 200, { ok: true, sectors: publicSectors() }, corsHeaders(req));
      return;
    }

    // ── Publieke formulier-ondertekening (CTO2-05) ────────────────────────────
    // Extern tekenen kan UITSLUITEND met een geldig, niet-verlopen en niet-
    // ingetrokken assignment-token; de identiteit (token → assignment), het IP,
    // de user-agent en de inhouds-hash worden aan het signature-evidence gebonden.
    if (url.pathname === "/api/public/form-sign" && req.method === "POST") {
      if (!formsRepo) return sendJson(res, 503, { ok: false, code: "FORMS_REQUIRES_PG", error: "Formulieren vereisen PostgreSQL." });
      const body = await readBody(req);
      const tid = String(body.tenantId || "").trim();
      const instId = String(body.instanceId || "").trim();
      const token = String(body.token || "").trim();
      if (!tid || !instId || !token) return sendJson(res, 400, { ok: false, error: "tenantId, instanceId en token zijn verplicht" });
      const inst = await formsRepo.getInstance(tid, instId);
      if (!inst) return sendJson(res, 403, { ok: false, code: "FORMS_FORBIDDEN", error: "Geen toegang." });
      const grant = await formsRepo.resolveExternalToken(tid, inst.definition_id, token);
      if (!grant) return sendJson(res, 403, { ok: false, code: "SIGN_TOKEN_INVALID", error: "Ongeldig, verlopen of ingetrokken ondertekentoken." });
      const r = await formsRepo.captureSignature(tid, instId, {
        signer_name: body.signerName || body.signer_name,
        transitionToSigned: true,
        evidence: {
          type: "external_token", assignmentId: grant.id, scopeId: grant.scope_id,
          ip: String(req.socket && req.socket.remoteAddress || ""), userAgent: String(req.headers["user-agent"] || "").slice(0, 200),
        },
      }, `extern:${grant.scope_id || grant.id}`);
      return sendJson(res, 200, { ok: true, result: r });
    }

    // ── Publieke KBO-opzoeking (BTW-autofill op de registratiepagina) ─────────
    if (url.pathname === "/api/public/kbo" && req.method === "GET") {
      const vat = String(url.searchParams.get("vat") || "").trim();
      if (vat.length < 8) return sendJson(res, 400, { ok: false, error: "Geef een geldig BTW-/ondernemingsnummer" });
      const company = await lookupKboResolve(vat);
      sendJson(res, 200, { ok: true, company });
      return;
    }

    // ── Self-service registratie: klant maakt zelf account + kiest bundel ──────
    if (url.pathname === "/api/auth/register" && req.method === "POST") {
      const body = await readBody(req);
      const vatNumber = String(body.vatNumber || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      // BTW-nummer ingevuld? Vul bedrijfsgegevens automatisch aan via KBO/VIES.
      const kbo = vatNumber ? await lookupKboResolve(vatNumber) : null;
      const companyName = String(body.companyName || (kbo && kbo.name) || "").trim();
      const name = String(body.name || "").trim();
      if (!companyName) return sendJson(res, 400, { ok: false, error: "Bedrijfsnaam is verplicht" });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendJson(res, 400, { ok: false, error: "Geldig e-mailadres is verplicht" });
      if (store.getUserByEmail(email)) return sendJson(res, 409, { ok: false, error: "Er bestaat al een account met dit e-mailadres" });
      // Bundel: gekozen plan moet bestaan en niet 'op aanvraag' (custom = prijs op aanvraag → contact).
      const bundle = getBundle(store, body.plan);
      if (!bundle || bundle.active === false) return sendJson(res, 400, { ok: false, error: "Kies een geldig pakket" });
      if (bundle.custom) return sendJson(res, 400, { ok: false, error: "Dit pakket is op aanvraag · neem contact op." });
      const now = new Date().toISOString();
      // Trial-to-paid: de proefklok start bij aanmaak. Zonder deze deadline zou
      // een self-signup nooit door de conversietrechter lopen (gratis voor
      // altijd). Bestaande tenants zonder trialEndsAt blijven bewust ongemoeid.
      const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
      // KBO-gegevens meteen in het facturatieprofiel zetten (volledige onboarding-start).
      const invoiceProfile = kbo
        ? { vat: kbo.vat, companyNumber: kbo.companyNumber, name: kbo.name, street: kbo.street || "", zip: kbo.zip || "", city: kbo.city || "" }
        : {};
      const tenant = store.insert("tenants", {
        id: `tenant_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name: companyName, plan: bundle.key, status: "trial", billingEmail: email,
        trialStartedAt: now, trialEndsAt,
        // Voorkeur uit de registratie (jaarlijks = standaard, ~17% voordeliger);
        // gebruikt bij het opzetten van het abonnement na de proefperiode.
        billingPeriod: body.billingPeriod === "month" ? "month" : "year",
        invoiceProfile, onboarding: { completed: false }, billingOps: { invoiceHistory: [] },
        supportAccess: { allowed: false }, selfSignup: true, createdAt: now,
        kboSyncedAt: kbo ? now : null
      });
      // Geen wachtwoord bij aanmaak: de klant verifieert zijn e-mail en stelt
      // zelf zijn wachtwoord in via de activatielink.
      const { activationLink } = provisionPendingUser({
        id: `user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        tenantId: tenant.id, name: name || companyName, email,
        role: "tenant_admin", permissions: BUSINESS_ADMIN_PERMISSIONS,
        mfaEnabled: false, mfaEnforced: false
      });
      store.audit({ actor: email, tenantId: tenant.id, action: "self_signup", area: "auth", detail: `${companyName} · ${bundle.key}` });
      sendJson(res, 201, { ok: true, pending: true, message: "Account aangemaakt · check je e-mail om je wachtwoord in te stellen.", activationLink });
      return;
    }

    // ── Self-service reseller-aanvraag (pending → superadmin keurt goed) ───────
    if (url.pathname === "/api/resellers/apply" && req.method === "POST") {
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      if (!name) return sendJson(res, 400, { ok: false, error: "Naam is verplicht" });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendJson(res, 400, { ok: false, error: "Geldig e-mailadres is verplicht" });
      if (store.getUserByEmail(email)) return sendJson(res, 409, { ok: false, error: "Er bestaat al een account met dit e-mailadres" });
      const now = new Date().toISOString();
      const reseller = store.insert("resellers", {
        id: `reseller_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        tenantId: null, name, contactEmail: email, status: "pending",
        defaultCommissionPct: 0, appliedAt: now, createdAt: now
      });
      // Login alvast aanmaken maar INACTIEF en zonder wachtwoord. Pas bij
      // goedkeuring ontvangt de aanvrager de activatiemail om zijn wachtwoord te
      // kiezen. MFA is verplicht voor reselleraccounts (23.15) · mfaEnforced
      // staat daarom meteen aan.
      store.insert("users", {
        id: `reseller_user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        tenantId: null, name, email, passwordHash: "",
        role: "reseller", permissions: [], resellerId: reseller.id,
        mfaEnabled: false, mfaEnforced: true, active: false, createdAt: now
      });
      store.audit({ actor: email, tenantId: null, action: "reseller_applied", area: "resellers", detail: name });
      sendJson(res, 201, { ok: true, message: "Aanvraag ontvangen · je account wordt na goedkeuring geactiveerd." });
      return;
    }

    // ── Account-activatie: persoon stelt zelf wachtwoord in via e-mailink ──────
    if (url.pathname === "/api/auth/activate" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = parseActivationToken(body.token);
      const user = parsed ? store.getUserById(parsed.userId) : null;
      const chk = user ? checkActivation(user, parsed.secret) : { ok: false, reason: "Ongeldige activatielink" };
      if (!chk.ok) return sendJson(res, 400, { ok: false, error: chk.reason });
      try { assertStrongPassword(body.password); }
      catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
      const now = new Date().toISOString();
      const updated = store.update("users", user.id, {
        passwordHash: hashPassword(body.password), active: true,
        emailVerifiedAt: now, activation: null, lastLoginAt: now
      });
      store.audit({ actor: updated.email, tenantId: updated.tenantId || null, action: "account_activated", area: "auth" });
      // Auto-login na activatie. (Een reseller logt in maar het portaal blijft in
      // afwachting tot de superadmin de reseller-status op 'active' zet.)
      sendJson(res, 200, { ok: true, token: issueSession(updated), user: safeUser(updated) });
      return;
    }

    // Nieuwe activatiemail aanvragen (geen account-enumeratie: altijd ok).
    if (url.pathname === "/api/auth/activate/resend" && req.method === "POST") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const user = email ? store.getUserByEmail(email) : null;
      if (user && user.active === false && user.activation) {
        const { secret, record } = startActivation();
        store.update("users", user.id, { activation: record });
        const link = `${config.appUrl}/?activate=${encodeURIComponent(activationToken(user.id, secret))}`;
        sendActivationMail(user, link);
      }
      sendJson(res, 200, { ok: true, message: "Als er een account in afwachting is, sturen we een nieuwe activatiemail." });
      return;
    }

    // ── Wachtwoord vergeten: stuur een reset-link (geen account-enumeratie) ────
    if (url.pathname === "/api/auth/forgot" && req.method === "POST") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const user = email ? store.getUserByEmail(email) : null;
      // Enkel actieve accounts met een wachtwoord kunnen resetten. Pending accounts
      // (nog niet geactiveerd) horen via de activatiemail te lopen, niet via reset.
      let link = null;
      if (user && user.active !== false && user.passwordHash) {
        const { secret, record } = startPasswordReset();
        store.update("users", user.id, { passwordReset: record });
        link = `${config.appUrl}/?reset=${encodeURIComponent(activationToken(user.id, secret))}`;
        sendPasswordResetMail(user, link);
        store.audit({ actor: user.email, tenantId: user.tenantId || null, action: "password_reset_requested", area: "auth" });
      }
      // Altijd identiek antwoord (voorkomt account-enumeratie). In dev/mock geven we
      // de link terug zodat het testbaar is; in productie nooit.
      sendJson(res, 200, { ok: true, message: "Als er een account met dit e-mailadres bestaat, sturen we een reset-link.", resetLink: isMailLive() ? null : link });
      return;
    }

    // Reset uitvoeren: token + nieuw wachtwoord → instellen en inloggen.
    if (url.pathname === "/api/auth/reset" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = parseActivationToken(body.token);
      const user = parsed ? store.getUserById(parsed.userId) : null;
      const chk = user ? checkPasswordReset(user, parsed.secret) : { ok: false, reason: "Ongeldige reset-link" };
      if (!chk.ok) return sendJson(res, 400, { ok: false, error: chk.reason });
      try { assertStrongPassword(body.password); }
      catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
      const now = new Date().toISOString();
      const updated = store.update("users", user.id, {
        passwordHash: hashPassword(body.password), passwordReset: null,
        active: true, lastLoginAt: now, failedLoginCount: 0, lockedUntil: null
      });
      store.audit({ actor: updated.email, tenantId: updated.tenantId || null, action: "password_reset_completed", area: "auth" });
      sendJson(res, 200, { ok: true, token: issueSession(updated), user: safeUser(updated) });
      return;
    }

    // ── SAML Single Sign-On (add-on) ──────────────────────────────────────────
    // Add-on: enkel beschikbaar als de tenant het 'sso'-entitlement heeft ÉN het
    // geconfigureerd is. We valideren XML-signaturen via de vetted library.
    const ssoLive = t => t && saml.ssoConfigured(t) && isModuleEnabled(store, t, "sso");
    const redirectTo = to => { res.writeHead(302, { Location: to }); res.end(); };

    // Domein → tenant: welk SSO-startpunt hoort bij dit e-mailadres?
    if (url.pathname === "/api/auth/sso/resolve" && req.method === "GET") {
      const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
      const domain = email.includes("@") ? email.split("@")[1] : email.replace(/^@/, "");
      let hit = null;
      if (domain) {
        hit = (store.data.tenants || []).find(t => ssoLive(t) && saml.ssoDomains(t).includes(domain)) || null;
      }
      if (!hit) return sendJson(res, 200, { ok: true, sso: false });
      sendJson(res, 200, { ok: true, sso: true, tenantId: hit.id, loginUrl: `/api/auth/saml/${hit.id}/login` });
      return;
    }

    const samlMatch = url.pathname.match(/^\/api\/auth\/saml\/([^/]+)\/(metadata|login|acs)$/);
    if (samlMatch) {
      const tenant = store.get("tenants", samlMatch[1]);
      const kind = samlMatch[2];
      // SP-metadata mag getoond worden zodra geconfigureerd+entitled (publiek doc).
      if (kind === "metadata" && req.method === "GET") {
        if (!ssoLive(tenant)) { res.writeHead(404); res.end("SSO niet beschikbaar"); return; }
        res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
        res.end(saml.spMetadata(tenant));
        return;
      }
      if (kind === "login" && req.method === "GET") {
        if (!ssoLive(tenant)) return redirectTo("/?sso_error=unavailable");
        try {
          const loginUrl = await saml.buildLoginUrl(tenant, "");
          return redirectTo(loginUrl);
        } catch (e) {
          store.audit({ actor: "sso", tenantId: tenant.id, action: "sso_login_error", area: "auth", detail: e.message });
          return redirectTo("/?sso_error=request");
        }
      }
      if (kind === "acs" && req.method === "POST") {
        if (!ssoLive(tenant)) return redirectTo("/?sso_error=unavailable");
        let identity;
        try {
          const raw = await readRawBody(req);
          const form = new URLSearchParams(raw);
          const profile = await saml.validateAcs(tenant, { SAMLResponse: form.get("SAMLResponse"), RelayState: form.get("RelayState") });
          identity = saml.extractIdentity(profile, tenant);
        } catch (e) {
          store.audit({ actor: "sso", tenantId: tenant.id, action: "sso_assertion_invalid", area: "auth", detail: e.message });
          return redirectTo("/?sso_error=assertion");
        }
        if (!identity.email || !/@/.test(identity.email)) return redirectTo("/?sso_error=noemail");

        let target = (store.data.users || []).find(u => u.tenantId === tenant.id && String(u.email).toLowerCase() === identity.email);
        const now = new Date().toISOString();
        if (target) {
          if (target.active === false) {
            // Pending account (nooit wachtwoord gezet) → SSO bewijst de identiteit,
            // dus activeren. Een door een admin gedeactiveerd account blijft geweigerd.
            if (!target.passwordHash && target.activation) {
              target = store.update("users", target.id, { active: true, emailVerifiedAt: now, activation: null, lastLoginAt: now });
            } else {
              store.audit({ actor: identity.email, tenantId: tenant.id, action: "sso_login_denied", area: "auth", detail: "account inactief" });
              return redirectTo("/?sso_error=inactive");
            }
          } else {
            store.update("users", target.id, { lastLoginAt: now });
          }
        } else {
          // Just-in-time provisioning: account aanmaken bij eerste SSO-login.
          if (!saml.jitEnabled(tenant)) {
            store.audit({ actor: identity.email, tenantId: tenant.id, action: "sso_login_denied", area: "auth", detail: "geen account, JIT uit" });
            return redirectTo("/?sso_error=nouser");
          }
          const role = saml.jitRole(tenant);
          target = store.insert("users", {
            id: `user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            tenantId: tenant.id, name: identity.name || identity.email, email: identity.email,
            passwordHash: "", role, permissions: role === "manager" ? MANAGER_PERMISSIONS : EMPLOYEE_PERMISSIONS,
            mfaEnabled: false, mfaEnforced: false, active: true, ssoProvisioned: true,
            emailVerifiedAt: now, lastLoginAt: now, createdAt: now
          });
          store.audit({ actor: identity.email, tenantId: tenant.id, action: "sso_jit_provisioned", area: "auth", detail: role });
        }
        store.audit({ actor: identity.email, tenantId: tenant.id, action: "sso_login", area: "auth" });
        // Sessie-token in de URL-fragment (gaat niet naar server/logs), net als de
        // support-flow. De client pikt #sso_token op en toont meteen het platform.
        return redirectTo(`/#sso_token=${encodeURIComponent(issueSession(target))}`);
      }
      res.writeHead(405); res.end("Method niet toegestaan"); return;
    }

    if (url.pathname === "/api/me") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      let entitlements;
      if (user.role === "super_admin") {
        // Super-admin ziet altijd alles.
        entitlements = { plan: null, modules: MODULE_CATALOG.map(m => m.key), views: "*", coreViews: CORE_MODULES.map(m => m.view) };
      } else {
        const tenant = store.data.tenants.find(t => t.id === user.tenantId) || {};
        entitlements = resolveTenantModules(store, tenant);
      }
      const supportSession = user.isSupportSession
        ? { active: true, agent: user.support?.agent, scope: user.support?.scope, expiresAt: store.data.tenants.find(t => t.id === user.support?.tenantId)?.supportSession?.expiresAt || null }
        : null;
      const platform = user.role === "super_admin"
        ? { scopes: platformScopesOf(user), isGod: isPlatformGod(user), allScopes: PLATFORM_SCOPES }
        : null;
      // Onboarding-status + sector-terminologie (voor de tenant-shells).
      let onboarding = null;
      let terminology = null;
      if (user.tenantId && user.role !== "super_admin") {
        const myTenant = store.data.tenants.find(t => t.id === user.tenantId);
        terminology = terminologyFor(myTenant || {});
        if (user.role === "tenant_admin") {
          onboarding = { completed: !!(myTenant && myTenant.onboarding && myTenant.onboarding.completed) };
        }
      }
      // Capabilities (backend-handoff): de UI mag nooit over maildelivery liegen ·
      // mail=false betekent dat verzendknoppen een setup-uitleg tonen.
      const capabilities = { mail: isMailLive() };
      // Trial-to-paid: de conversietrechter-banner leest hierop (dagen over,
      // respijt, geblokkeerd). Enkel voor tenant-gebruikers, niet superadmin.
      let billing = null;
      if (user.tenantId && user.role !== "super_admin") {
        const myTenant = store.data.tenants.find(t => t.id === user.tenantId);
        if (myTenant) billing = billingAccess(myTenant);
      }
      sendJson(res, 200, { ok: true, user: safeUser(user), entitlements, supportSession, platform, onboarding, terminology, capabilities, billing });
      return;
    }

    if (url.pathname === "/api/auth/change-password" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertHumanUser(user);
      const body = await readBody(req);
      if (!body.currentPassword) return sendJson(res, 400, { ok: false, error: "Huidig wachtwoord is verplicht" });
      if (!body.newPassword) return sendJson(res, 400, { ok: false, error: "Nieuw wachtwoord is verplicht" });
      if (!verifyPassword(body.currentPassword, user.passwordHash)) {
        // 400 (geen 401): gebruiker ís geauthenticeerd; dit is invoervalidatie.
        return sendJson(res, 400, { ok: false, error: "Huidig wachtwoord is onjuist" });
      }
      assertStrongPassword(body.newPassword);
      store.update("users", user.id, { passwordHash: hashPassword(body.newPassword) });
      store.audit({ actor: user.email, tenantId: user.tenantId, action: "password_changed", area: "auth" });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/me/mfa/setup" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertHumanUser(user);
      const setup = createMfaSetup(store, user);
      sendJson(res, 201, { ok: true, setup: { secret: setup.secret, otpauth: setup.otpauth } });
      return;
    }

    if (url.pathname === "/api/me/mfa/verify" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertHumanUser(user);
      const body = await readBody(req);
      const result = verifyMfaSetup(store, user, body.code || body.token || body.mfaCode);
      sendJson(res, 200, { ok: true, user: result.user, recoveryCodes: result.recoveryCodes });
      return;
    }

    // Platform-brede MFA-afdwinging (super_admin): schrijft alle admin-accounts
    // (tenant_admin + super_admin) zonder MFA in. Retourneert secrets + recovery codes.
    // Platform-integraties (super-admin console): Stripe / Peppol / e-mail / KBO
    if (url.pathname === "/api/admin/integrations" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "integrations");
      sendJson(res, 200, { ok: true, config: publicPlatformConfig(store) });
      return;
    }
    // Read-only overzicht van de eigen koppelingen (Robaws/Exact/…) per tenant.
    // De config zelf blijft tenant-zijde; dit is enkel operatorzicht (geen secrets).
    if (url.pathname === "/api/admin/tenant-integrations" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "integrations");
      const tenantName = {};
      for (const t of store.data.tenants || []) tenantName[t.id] = t.name || t.id;
      const rows = (store.data.integrations || []).map(i => ({
        tenantId: i.tenantId, tenant: tenantName[i.tenantId] || i.tenantId,
        provider: i.provider, status: i.status || "-",
        hasSecret: !!i.encryptedSecret, lastSyncAt: i.lastSyncAt || null,
      })).sort((a, b) => String(a.tenant).localeCompare(String(b.tenant)));
      sendJson(res, 200, { ok: true, rows, total: rows.length, connected: rows.filter(r => r.hasSecret).length });
      return;
    }
    if (url.pathname === "/api/admin/integrations" && req.method === "PUT") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "integrations");
      const body = await readBody(req);
      const config2 = savePlatformConfig(store, body, user);
      // Pas e-mailconfig meteen toe op de mailer
      try { setRuntimeConfig(loadPlatformConfig(store).email); } catch (_) {}
      try { setPlanPriceOverrides(loadPlatformConfig(store).planPrices); } catch (_) {}
      sendJson(res, 200, { ok: true, config: config2 });
      return;
    }

    if (url.pathname === "/api/admin/mfa/enforce" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "system");
      const admins = (store.data.users || []).filter(u =>
        ["tenant_admin", "super_admin"].includes(u.role) && u.active !== false && !(u.mfaEnabled && u.mfaEnforced)
      );
      const enrolled = admins.map(u => enforceMfa(store, u));
      sendJson(res, 200, { ok: true, enrolled, count: enrolled.length });
      return;
    }

    if (url.pathname === "/api/modules") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertAdminMfa(user);
      assertApiKeyWriteAllowed(user, req);
      sendJson(res, 200, { ok: true, modules });
      return;
    }

    const moduleMatch = url.pathname.match(/^\/api\/modules\/([^/]+)(?:\/([^/]+))?$/);
    if (moduleMatch) {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertAdminMfa(user);
      assertApiKeyWriteAllowed(user, req);
      const key = moduleMatch[1];
      const id = moduleMatch[2];
      // Niet-super gebruikers zijn ALTIJD aan hun eigen tenant gebonden; de
      // query-tenantId telt enkel voor super_admin. Zo kan de entitlement-check
      // niet omzeild worden door een andere tenant op te geven.
      const tenantId = user.role === "super_admin" ? (url.searchParams.get("tenantId") || user.tenantId) : user.tenantId;
      // Entitlement-handhaving op moduleniveau (super_admin omzeilt).
      if (user.role !== "super_admin") {
        const cat = moduleByKey(key);
        if (cat && !cat.core) {
          const t = store.data.tenants.find(x => x.id === tenantId) || {};
          if (!isModuleEnabled(store, t, key)) {
            return sendJson(res, 403, { ok: false, error: `Module '${cat.label}' is niet inbegrepen in het pakket van deze organisatie.`, code: "module_disabled" });
          }
        }
      }
      if (req.method === "GET") return sendJson(res, 200, { ok: true, rows: listModule(store, user, key, tenantId) });
      if (req.method === "POST") {
        assertApiKeyWriteAllowed(user, req);
        return sendJson(res, 201, { ok: true, row: createModuleRow(store, user, key, tenantId, await readBody(req)) });
      }
      if (req.method === "PATCH" && id) {
        assertApiKeyWriteAllowed(user, req);
        return sendJson(res, 200, { ok: true, row: updateModuleRow(store, user, key, id, await readBody(req)) });
      }
    }

    const exportMatch = url.pathname.match(/^\/api\/exports\/([^/]+)\.csv$/);
    if (exportMatch && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertAdminMfa(user);
      const key = exportMatch[1];
      const tenantId = user.role === "super_admin" ? (url.searchParams.get("tenantId") || user.tenantId) : user.tenantId;
      const rows = listModule(store, user, key, tenantId);
      sendCsv(res, `${key}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
      return;
    }

    // ── Module-catalogus (super-admin) ──────────────────────
    if (url.pathname === "/api/admin/catalog" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "modules");
      assertInteractiveUser(user);
      sendJson(res, 200, { ok: true, modules: MODULE_CATALOG, core: CORE_MODULES });
      return;
    }

    // ── Add-ons beheren (superadmin): naam, prijs, omschrijving, actief ──────
    if (url.pathname === "/api/admin/addons" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "modules");
      assertInteractiveUser(user);
      sendJson(res, 200, { ok: true, addons: listAddons(loadPlatformConfig(store).addons, true) });
      return;
    }
    if (url.pathname === "/api/admin/addons" && req.method === "PUT") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "modules");
      assertInteractiveUser(user);
      const body = await readBody(req);
      // Enkel geldige add-on-keys aanvaarden.
      const valid = new Set(listAddons({}, true).map(a => a.key));
      const addons = {};
      for (const [k, v] of Object.entries(body.addons || {})) if (valid.has(k)) addons[k] = v;
      savePlatformConfig(store, { addons }, user);
      store.audit({ actor: user.email, tenantId: null, action: "addons_updated", area: "modules", detail: Object.keys(addons).join(",") });
      sendJson(res, 200, { ok: true, addons: listAddons(loadPlatformConfig(store).addons, true) });
      return;
    }

    // ── Bundel-prijzen (superadmin-bewerkbaar) ───────────────────────────────
    if (url.pathname === "/api/admin/plan-prices" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "modules");
      sendJson(res, 200, { ok: true, plans: planPricing() });
      return;
    }
    if (url.pathname === "/api/admin/plan-prices" && req.method === "PUT") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "modules");
      assertInteractiveUser(user);
      const body = await readBody(req);
      savePlatformConfig(store, { planPrices: body.planPrices || {} }, user);
      setPlanPriceOverrides(loadPlatformConfig(store).planPrices);
      store.audit({ actor: user.email, tenantId: null, action: "plan_prices_updated", area: "modules", detail: Object.keys(body.planPrices || {}).join(",") });
      sendJson(res, 200, { ok: true, plans: planPricing() });
      return;
    }

    // ── Tenant-lifecycle (superadmin): status, trials, conversie ─────────────
    if (url.pathname === "/api/admin/lifecycle" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "tenants");
      sendJson(res, 200, { ok: true, lifecycle: lifecycle(store) });
      return;
    }

    // ── Reseller-payouts (superadmin): commissie verschuldigd + CSV-export ────
    if (url.pathname === "/api/admin/reseller-payouts" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const payouts = resellerPayouts(store, commissionOverview);
      if (url.searchParams.get("format") === "csv") {
        const head = "reseller,contact,clients,mrr,commissie_maand";
        const lines = payouts.rows.map(r => [r.reseller, r.contactEmail, r.clients, r.mrr, r.commissionMonthly].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
        res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"reseller-payouts.csv\"" });
        res.end([head, ...lines].join("\n"));
        return;
      }
      sendJson(res, 200, { ok: true, ...payouts });
      return;
    }

    // ── Forms-cutover (CTO2-08) · superadmin ─────────────────────────────────
    // Inventaris + reconciliatie van de legacy work-os forms tegen de canonieke
    // engine. Poortwacht: FORMS_SOURCE=pg is pas veilig als ready=true.
    if (url.pathname === "/api/admin/forms-cutover" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "system");
      if (!formsRepo) return sendJson(res, 503, { ok: false, code: "FORMS_REQUIRES_PG", error: "De canonieke Forms-capability vereist PostgreSQL." });
      const formsCutover = require("./modules/forms-cutover");
      const tid = url.searchParams.get("tenantId");
      const tenants = tid ? [{ id: tid }] : (store.data.tenants || []);
      const rows = [];
      for (const t of tenants) rows.push(await formsCutover.reconcileForms({ store, repo: formsRepo, tenantId: t.id }));
      const ready = rows.every(r => r.ready);
      return sendJson(res, 200, { ok: true, formsSource: config.forms.source, ready, tenants: rows });
    }
    if (url.pathname === "/api/admin/forms-cutover/migrate" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "system");
      assertInteractiveUser(user);
      if (!formsRepo) return sendJson(res, 503, { ok: false, code: "FORMS_REQUIRES_PG", error: "De canonieke Forms-capability vereist PostgreSQL." });
      const formsCutover = require("./modules/forms-cutover");
      const body = await readBody(req);
      const tenants = body.tenantId ? [{ id: body.tenantId }] : (store.data.tenants || []);
      const rows = [];
      for (const t of tenants) rows.push(await formsCutover.migrateLegacyForms({ store, repo: formsRepo, tenantId: t.id, actor: user.email }));
      store.audit({ actor: user.email, tenantId: null, area: "forms", action: "forms_cutover_migrate", detail: `${tenants.length} tenant(s)` });
      return sendJson(res, 200, { ok: true, migrated: rows });
    }

    // ── Commission ledger (CTO2-10) · superadmin ─────────────────────────────
    // Immutable commissie-grootboek: accrual per periode uit de centrale billing-
    // MRR, correctie via tegenboeking, payouts met goedkeuring/betaalreferentie,
    // clawback en dispute. Alles herleidbaar (bron, grondslag, tarief, bedrag).
    const commAccrueMatch = url.pathname.match(/^\/api\/admin\/reseller-commission\/([^/]+)\/accrue$/);
    if (commAccrueMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const reseller = store.get("resellers", commAccrueMatch[1]);
      if (!reseller) return sendJson(res, 404, { ok: false, error: "Reseller niet gevonden" });
      const body = await readBody(req);
      try {
        const overview = commissionOverview(store, reseller);
        const r = commissionSvc.accruePeriod(store, { resellerId: reseller.id, period: body.period, overview }, user);
        return sendJson(res, 200, { ok: true, ...r });
      } catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
    }
    const commLedgerMatch = url.pathname.match(/^\/api\/admin\/reseller-commission\/([^/]+)$/);
    if (commLedgerMatch && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      return sendJson(res, 200, { ok: true, ...commissionSvc.ledgerFor(store, commLedgerMatch[1]) });
    }
    const commCorrectMatch = url.pathname.match(/^\/api\/admin\/reseller-commission\/([^/]+)\/correct$/);
    if (commCorrectMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const body = await readBody(req);
      try { return sendJson(res, 200, { ok: true, event: commissionSvc.correctEvent(store, { eventId: body.eventId, amount: body.amount ?? null, reason: body.reason }, user) }); }
      catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
    }
    const commClawMatch = url.pathname.match(/^\/api\/admin\/reseller-commission\/([^/]+)\/clawback$/);
    if (commClawMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const body = await readBody(req);
      try { return sendJson(res, 200, { ok: true, event: commissionSvc.clawback(store, { eventId: body.eventId, amount: body.amount ?? null, reason: body.reason }, user) }); }
      catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
    }
    const commPayoutMatch = url.pathname.match(/^\/api\/admin\/reseller-commission\/([^/]+)\/payouts$/);
    if (commPayoutMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const body = await readBody(req);
      try { return sendJson(res, 201, { ok: true, payout: commissionSvc.createPayout(store, { resellerId: commPayoutMatch[1], period: body.period || null }, user) }); }
      catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
    }
    const commPayoutTransMatch = url.pathname.match(/^\/api\/admin\/reseller-commission\/payouts\/([^/]+)\/transition$/);
    if (commPayoutTransMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      // Daar waar geld het systeem verlaat gelden dezelfde eisen als bij een
      // IBAN-wijziging (23.11): het recht reseller.payout.approve (partner
      // manager is hier hard uitgesloten via SENSITIVE_DENY) plus MFA. De
      // vier-ogencontrole zelf zit in transitionPayout (service-side).
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.payout.approve", {})) return resellerForbidden(res);
      const body = await readBody(req);
      try {
        assertResellerMfa(cu, "reseller.payout.approve");
        return sendJson(res, 200, { ok: true, payout: commissionSvc.transitionPayout(store, { payoutId: commPayoutTransMatch[1], to: body.to, paymentRef: body.paymentRef || null, reason: body.reason || null }, user) });
      }
      catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
    }
    // Reseller-portaal: eigen grootboek (read-only, enkel commerciële data).
    if (url.pathname === "/api/reseller/commission" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller || reseller.status !== "active") return sendJson(res, 403, { ok: false, error: "Reseller-account niet actief" });
      if (foreignResellerParam(res, url, reseller)) return;
      return sendJson(res, 200, { ok: true, ...commissionSvc.ledgerFor(store, reseller.id) });
    }

    // ── Governance: security-center, GDPR/DPA-overzicht, API-key-governance ──
    if (url.pathname === "/api/admin/security" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "system");
      sendJson(res, 200, { ok: true, security: securityCenter(store, mfaRisk) });
      return;
    }
    if (url.pathname === "/api/admin/gdpr-overview" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "support");
      sendJson(res, 200, { ok: true, ...gdprOverview(store) });
      return;
    }
    if (url.pathname === "/api/admin/api-key-governance" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "integrations");
      sendJson(res, 200, { ok: true, governance: apiKeyGovernance(store, { strict: url.searchParams.get("strict") === "1" }) });
      return;
    }

    // ── Platform-aankondiging beheren (superadmin) ───────────────────────────
    if (url.pathname === "/api/admin/announcement" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "settings");
      sendJson(res, 200, { ok: true, announcement: loadPlatformConfig(store).announcement || { active: false, level: "info", message: "" } });
      return;
    }
    if (url.pathname === "/api/admin/announcement" && req.method === "PUT") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "settings");
      assertInteractiveUser(user);
      const body = await readBody(req);
      savePlatformConfig(store, { announcement: body.announcement || {} }, user);
      store.audit({ actor: user.email, tenantId: null, action: "announcement_updated", area: "settings", detail: (body.announcement && body.announcement.active) ? "active" : "off" });
      sendJson(res, 200, { ok: true, announcement: loadPlatformConfig(store).announcement });
      return;
    }

    // ── Bundels CRUD (super-admin) ───────────────────────────
    const bundleMatch = url.pathname.match(/^\/api\/admin\/bundles(?:\/([^/]+))?$/);
    if (bundleMatch) {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "modules");
      assertInteractiveUser(user);
      const bundleKey = bundleMatch[1];
      if (req.method === "GET" && !bundleKey) {
        sendJson(res, 200, { ok: true, bundles: listBundles(store) });
        return;
      }
      if (req.method === "POST" && !bundleKey) {
        const bundle = saveBundle(store, await readBody(req), user);
        sendJson(res, 200, { ok: true, bundle });
        return;
      }
      if (req.method === "DELETE" && bundleKey) {
        sendJson(res, 200, { ok: true, ...deleteBundle(store, bundleKey, user) });
        return;
      }
    }

    // ── Per-tenant entitlements (super-admin) ────────────────
    const tenantEntMatch = url.pathname.match(/^\/api\/admin\/tenants\/([^/]+)\/(entitlements|modules)$/);
    if (tenantEntMatch) {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "tenants");
      assertInteractiveUser(user);
      const tenant = store.data.tenants.find(t => t.id === tenantEntMatch[1]);
      if (!tenant) return sendJson(res, 404, { ok: false, error: "Tenant not found" });
      if (tenantEntMatch[2] === "entitlements" && req.method === "GET") {
        sendJson(res, 200, { ok: true, entitlements: resolveTenantModules(store, tenant), overrides: tenant.moduleOverrides || { add: [], remove: [] } });
        return;
      }
      if (tenantEntMatch[2] === "modules" && req.method === "PATCH") {
        const body = await readBody(req);
        const patch = {};
        if (body.plan && getBundle(store, body.plan)) patch.plan = String(body.plan).toLowerCase();
        if (body.moduleOverrides) {
          patch.moduleOverrides = {
            add: Array.isArray(body.moduleOverrides.add) ? body.moduleOverrides.add : [],
            remove: Array.isArray(body.moduleOverrides.remove) ? body.moduleOverrides.remove : [],
          };
        }
        if (body.submoduleOverrides && typeof body.submoduleOverrides === "object") patch.submoduleOverrides = body.submoduleOverrides;
        const next = store.updateTenant(tenant.id, patch);
        store.audit({ actor: user.email, tenantId: tenant.id, action: "tenant_modules_updated", area: "billing", detail: JSON.stringify(patch).slice(0, 200) });
        sendJson(res, 200, { ok: true, entitlements: resolveTenantModules(store, next) });
        return;
      }
    }

    const adminTenantMatch = url.pathname.match(/^\/api\/admin\/tenants(?:\/([^/]+))?$/);
    if (adminTenantMatch && req.method === "GET" && !adminTenantMatch[1]) {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "tenants");
      assertInteractiveUser(user);
      const tenants = store.data.tenants.map(tenant => {
        const scoped = store.tenantScoped(tenant.id);
        return {
          ...tenant,
          counts: {
            users: scoped.users.length,
            planning: scoped.shifts.length,
            workorders: scoped.workorders.length,
            invoices: scoped.invoices.length
          }
        };
      });
      sendJson(res, 200, { ok: true, tenants });
      return;
    }

    if (adminTenantMatch && req.method === "POST" && !adminTenantMatch[1]) {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "tenants");
      assertInteractiveUser(user);
      const body = await readBody(req);
      const tenant = store.insert("tenants", {
        id: body.id || `tenant_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name: body.name || "Nieuwe klant",
        plan: body.plan || "business",
        status: body.status || "trial",
        billingEmail: body.billingEmail || "",
        invoiceProfile: {},
        onboarding: {},
        billingOps: { invoiceHistory: [] },
        supportAccess: { allowed: false }
      });
      let adminUser = null;
      let activationLink = null;
      if (body.adminEmail) {
        // Geen wachtwoord door de aanmaker: de klant-admin ontvangt een
        // activatiemail en stelt zelf zijn wachtwoord in.
        const prov = provisionPendingUser({
          id: `user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId: tenant.id,
          name: body.adminName || "Klant admin",
          email: String(body.adminEmail).toLowerCase(),
          role: "tenant_admin",
          permissions: BUSINESS_ADMIN_PERMISSIONS,
          mfaEnabled: false,
          mfaEnforced: false,
          failedLoginCount: 0,
          lockedUntil: null
        });
        adminUser = prov.user;
        activationLink = prov.activationLink;
      }
      store.audit({ actor: user.email, tenantId: tenant.id, action: "tenant_created", area: "tenants", detail: tenant.name });
      sendJson(res, 201, { ok: true, tenant, adminUser: adminUser ? { id: adminUser.id, name: adminUser.name, email: adminUser.email, role: adminUser.role } : null, activationLink });
      return;
    }

    if (adminTenantMatch && req.method === "PATCH" && adminTenantMatch[1]) {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "tenants");
      assertInteractiveUser(user);
      const tenant = store.data.tenants.find(row => row.id === adminTenantMatch[1]);
      if (!tenant) return sendJson(res, 404, { ok: false, error: "Tenant not found" });
      const body = await readBody(req);
      const patch = {
        ...(body.name ? { name: body.name } : {}),
        ...(body.plan ? { plan: body.plan } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.billingEmail !== undefined ? { billingEmail: body.billingEmail } : {}),
        ...(body.resellerId !== undefined ? { resellerId: body.resellerId || null } : {}),
        ...(typeof body.commissionPct === "number" ? { commissionPct: body.commissionPct } : {})
      };
      const next = store.updateTenant(tenant.id, patch);
      store.audit({ actor: user.email, tenantId: tenant.id, action: "tenant_updated", area: "tenants", detail: JSON.stringify(patch) });
      sendJson(res, 200, { ok: true, tenant: next });
      return;
    }

    // ── Super-admin: stats dashboard ──────────────────────────────────────────
    if (url.pathname === "/api/admin/stats" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      const tenants = store.data.tenants;
      const allUsers = store.data.users;
      // CTO-09: MRR uit de centrale billingbron, geen vaste prijsconstanten.
      let mrr = 0;
      tenants.filter(t => t.status === "active").forEach(t => { mrr += tenantMrr(store, t) || 0; });
      mrr = Math.round(mrr * 100) / 100;
      const errorCount = (store.data.errorEvents || []).filter(e => {
        const d = new Date(e.at || 0);
        return d > new Date(Date.now() - 24 * 60 * 60 * 1000);
      }).length;
      sendJson(res, 200, {
        ok: true,
        tenants: { total: tenants.length, active: tenants.filter(t => t.status === "active").length,
          trial: tenants.filter(t => t.status === "trial").length,
          suspended: tenants.filter(t => t.status === "suspended").length },
        users: { total: allUsers.length, active: allUsers.filter(u => u.active !== false).length,
          admins: allUsers.filter(u => ["tenant_admin","super_admin"].includes(u.role)).length },
        mrr: Math.round(mrr),
        arr: Math.round(mrr * 12),
        errors24h: errorCount,
        uptime: Math.floor(process.uptime()),
        storageAdapter: config.storageAdapter,
        version: config.appVersion,
        releaseChannel: config.releaseChannel,
        commitSha: config.commitSha
      });
      return;
    }

    // ── Super-admin: alle gebruikers ──────────────────────────────────────────
    if (url.pathname === "/api/admin/users" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      const safe = (u) => { const { passwordHash, mfaSecret, mfaPendingSecret, recoveryCodes, ...s } = u; return s; };
      // GDPR/dataminimalisatie: de console toont enkel platform-accounts, geen
      // persoonsgegevens van tenant-medewerkers. Die raadpleeg je via consent-impersonatie.
      // P0-01: geschakelde leesroute · in pg-stand komt deze lijst uit de
      // genormaliseerde tabellen; in shadow leest pg mee (telemetrie).
      const users = (await identitySource.listPlatformUsers()).map(safe);
      sendJson(res, 200, { ok: true, users });
      return;
    }

    // ── P0-01 · identity-migratiestatus + reconciliatiebewijs (ops) ──────────
    if (url.pathname === "/api/admin/identity/status" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      sendJson(res, 200, { ok: true, identity: identitySource.status() });
      return;
    }
    if (url.pathname === "/api/admin/identity/reconcile" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      // Bewust: eerst syncen, dan reconciliëren. Het antwoord toont daardoor
      // of de PIJPLIJN klopt; blijvende afwijkingen zijn echte bugs.
      await identitySource.syncNow({ force: true });
      const result = await identitySource.reconcile();
      store.audit({ actor: user.email, tenantId: null, action: "identity_reconcile", area: "platform", details: { ok: result.ok, checked: result.checked } });
      sendJson(res, 200, { ok: true, reconcile: result, status: identitySource.status() });
      return;
    }

    // ── P0-01 · finance-migratiestatus + reconciliatiebewijs (ops) ───────────
    if (url.pathname === "/api/admin/finance/status" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      sendJson(res, 200, { ok: true, finance: financeSource.status() });
      return;
    }
    if (url.pathname === "/api/admin/finance/reconcile" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      await financeSource.syncNow({ force: true });
      const result = await financeSource.reconcile();
      store.audit({ actor: user.email, tenantId: null, action: "finance_reconcile", area: "platform", details: { ok: result.ok } });
      sendJson(res, 200, { ok: true, reconcile: result, status: financeSource.status() });
      return;
    }

    // ── P0-01 · company-migratiestatus + reconciliatiebewijs (ops) ───────────
    if (url.pathname === "/api/admin/company/status" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      sendJson(res, 200, { ok: true, company: companySource.status() });
      return;
    }
    if (url.pathname === "/api/admin/company/reconcile" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      await companySource.syncNow({ force: true });
      const result = await companySource.reconcile();
      store.audit({ actor: user.email, tenantId: null, action: "company_reconcile", area: "platform", details: { ok: result.ok } });
      sendJson(res, 200, { ok: true, reconcile: result, status: companySource.status() });
      return;
    }

    // ── P0-01 sluitstuk · cross-domein migratiestatus + reconciliatie (ops) ──
    // Eén blik vóór een cutover: synct en reconcilieert alle genormaliseerde
    // domeinen in dependency-volgorde. `ok:true` = cutover-gereed.
    if (url.pathname === "/api/admin/migration/status" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      sendJson(res, 200, { ok: true, migration: migrationOrchestrator.status() });
      return;
    }
    // DEV-01 · Traceability-matrix (R0-R7/E01-E22/DoD) uit één bron van waarheid.
    // Dezelfde afleiding die de CLI-gate en het releaseverslag gebruiken, zodat
    // CLI, admin-UI en rapport nooit uit elkaar lopen.
    if (url.pathname === "/api/admin/traceability" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      const matrix = buildTraceability({ repoRoot: process.cwd(), commitSha: config.commitSha || "unknown" });
      matrix.generatedAt = new Date().toISOString();
      sendJson(res, 200, { ok: true, traceability: matrix });
      return;
    }
    if (url.pathname === "/api/admin/migration/reconcile" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      const result = await migrationOrchestrator.reconcileAll();
      store.audit({ actor: user.email, tenantId: null, action: "migration_reconcile", area: "platform", details: { ok: result.ok, order: result.order } });
      sendJson(res, result.ok ? 200 : 409, { ok: result.ok, reconcile: result });
      return;
    }

    // Outbox-inzage voor platform-ops (master-spec h46 · delivery volgt in E19).
    if (url.pathname === "/api/admin/events" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "system");
      const events = listOutbox(store, {
        status: url.searchParams.get("status") || undefined,
        tenantId: url.searchParams.get("tenantId") || undefined,
        eventType: url.searchParams.get("eventType") || undefined,
        limit: url.searchParams.get("limit") || 50,
      });
      sendJson(res, 200, { ok: true, events });
      return;
    }

    // Duurzame outbox (P0-05): de blijvende log in PostgreSQL, ook voorbij de
    // in-memory cap · inspectie + replay voor de superadmin.
    if (url.pathname === "/api/admin/outbox" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "system");
      if (typeof storeAdapter.listOutboxEvents !== "function") {
        return sendJson(res, 409, { ok: false, error: "Duurzame outbox vereist de PostgreSQL-adapter", code: "OUTBOX_NOT_DURABLE" });
      }
      const rows = await storeAdapter.listOutboxEvents({
        tenantId: url.searchParams.get("tenantId") || undefined,
        status: url.searchParams.get("status") || undefined,
        eventType: url.searchParams.get("eventType") || undefined,
        limit: url.searchParams.get("limit") || undefined,
      });
      sendJson(res, 200, { ok: true, events: rows });
      return;
    }
    // Replay uit de duurzame log: zet het event terug als pending in het
    // werkgeheugen zodat de bezorgcyclus het opnieuw uitlevert (h46: event
    // replay binnen de retentie).
    const outboxReplayMatch = url.pathname.match(/^\/api\/admin\/outbox\/([^/]+)\/replay$/);
    if (outboxReplayMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "system");
      if (typeof storeAdapter.listOutboxEvents !== "function") {
        return sendJson(res, 409, { ok: false, error: "Duurzame outbox vereist de PostgreSQL-adapter", code: "OUTBOX_NOT_DURABLE" });
      }
      const { rows: replayRows } = await storeAdapter.pool.query(`SELECT * FROM outbox_events WHERE id = $1`, [outboxReplayMatch[1]]);
      const row = replayRows[0];
      if (!row) return sendJson(res, 404, { ok: false, error: "Event niet gevonden in de duurzame outbox" });
      const inMemory = (store.data.outbox || []).find(e => e.id === row.id);
      if (inMemory) {
        inMemory.delivery = { ...inMemory.delivery, status: "pending", attempts: 0, nextAttemptAt: null, lastError: null };
      } else {
        store.data.outbox = store.data.outbox || [];
        store.data.outbox.push({
          id: row.id, eventType: row.event_type, tenantId: row.tenant_id, companyId: row.company_id,
          aggregateType: row.aggregate_type, aggregateId: row.aggregate_id,
          occurredAt: new Date(row.occurred_at).toISOString(), correlationId: row.correlation_id,
          version: row.version, data: row.data || {}, actor: "outbox-replay",
          delivery: { status: "pending", attempts: 0, nextAttemptAt: null, lastError: null },
        });
      }
      store.save();
      store.audit({ actor: user.email, tenantId: row.tenant_id, action: "outbox_event_replayed", area: "integrations", detail: row.id });
      sendJson(res, 200, { ok: true, replayed: row.id });
      return;
    }

    // Activatielink her-uitgeven voor een pending account (backend-handoff):
    // bewuste, geauditeerde superadmin-actie voor omgevingen zonder mail.
    // Werkt ALLEEN voor wachtwoordloze pending accounts · bestaande wachtwoorden
    // blijven onaangeroerd; dit is nooit een reset.
    const adminActivationMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/activation-link$/);
    if (adminActivationMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "tenants");
      const target = store.getUserById(adminActivationMatch[1]);
      if (!target) return sendJson(res, 404, { ok: false, error: "Account niet gevonden" });
      if (target.active !== false || target.passwordHash) {
        return sendJson(res, 409, { ok: false, error: "Dit account is geen pending account · het bestaande wachtwoord blijft onaangeroerd", code: "NOT_PENDING" });
      }
      const { secret, record } = startActivation();
      store.update("users", target.id, { activation: record, updatedAt: new Date().toISOString() });
      const link = `${config.appUrl}/?activate=${encodeURIComponent(activationToken(target.id, secret))}`;
      store.audit({ actor: user.email, tenantId: target.tenantId || null, action: "activation_link_issued", area: "auth", detail: target.email });
      sendJson(res, 200, { ok: true, activationLink: link, expiresAt: record.expiresAt });
      return;
    }

    // ── Platformteam: eigen support-medewerkers (super_admin) beheren ──────────
    // Lezen mag elke super_admin; aanmaken/wijzigen enkel de god (beschermde
    // hoofd-superadmin). De god is onaantastbaar.
    if (url.pathname === "/api/admin/staff" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      const staff = store.data.users
        .filter(u => u.role === "super_admin")
        .map(u => ({ id: u.id, name: u.name, email: u.email, active: u.active !== false, protected: u.protected === true, isYou: u.id === user.id, scopes: platformScopesOf(u), lastLoginAt: u.lastLoginAt || null, createdAt: u.createdAt || null }));
      sendJson(res, 200, { ok: true, staff, canManage: isPlatformGod(user), allScopes: PLATFORM_SCOPES });
      return;
    }
    if (url.pathname === "/api/admin/staff" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      assertPlatformGod(user);
      assertAdminMfa(user);
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const name = String(body.name || "").trim();
      if (!name) return sendJson(res, 400, { ok: false, error: "Naam is verplicht" });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendJson(res, 400, { ok: false, error: "Geldig e-mailadres is verplicht" });
      if (store.getUserByEmail(email)) return sendJson(res, 409, { ok: false, error: "Er bestaat al een gebruiker met dit e-mailadres" });
      // Platform-scopes: standaard volledige toegang, of de aangevinkte subset.
      const scopes = Array.isArray(body.platformScopes)
        ? body.platformScopes.filter(s => PLATFORM_SCOPES.includes(s))
        : PLATFORM_SCOPES.slice();
      // Geen wachtwoord door de aanmaker: het teamlid ontvangt een activatiemail.
      const { user: created, activationLink } = provisionPendingUser({
        id: `staff_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        tenantId: null,
        name,
        email,
        role: "super_admin",
        permissions: ["*"],
        platformScopes: scopes,
        protected: false,
        mfaEnabled: false,
        mfaEnforced: false,
        createdBy: user.email
      });
      store.audit({ actor: user.email, tenantId: null, action: "platform_staff_created", area: "auth", detail: `${email} scopes=${scopes.join(",")}` });
      sendJson(res, 201, { ok: true, staff: { id: created.id, name: created.name, email: created.email, active: false, protected: false, scopes }, activationLink });
      return;
    }
    const adminStaffMatch = url.pathname.match(/^\/api\/admin\/staff\/([^/]+)$/);
    if (adminStaffMatch && req.method === "PATCH") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      assertPlatformGod(user);
      const targetId = adminStaffMatch[1];
      const target = store.getUserById(targetId);
      if (!target || target.role !== "super_admin") return sendJson(res, 404, { ok: false, error: "Platform-medewerker niet gevonden" });
      if (target.protected === true) return sendJson(res, 403, { ok: false, error: "De hoofd-superadmin kan niet gewijzigd worden" });
      if (target.id === user.id) return sendJson(res, 400, { ok: false, error: "Je kan je eigen account hier niet wijzigen" });
      const body = await readBody(req);
      const patch = {};
      if (typeof body.active === "boolean") patch.active = body.active;
      if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
      if (Array.isArray(body.platformScopes)) patch.platformScopes = body.platformScopes.filter(s => PLATFORM_SCOPES.includes(s));
      const updated = store.update("users", targetId, { ...patch, updatedAt: new Date().toISOString() });
      store.audit({ actor: user.email, tenantId: null, action: "platform_staff_updated", area: "auth", detail: `${target.email} ${JSON.stringify(patch)}` });
      sendJson(res, 200, { ok: true, staff: { id: updated.id, name: updated.name, email: updated.email, active: updated.active !== false, protected: false, scopes: platformScopesOf(updated) } });
      return;
    }

    // ── Support: tenant-gebruikers om over te nemen · ALLEEN met klant-consent ──
    // Persoonsgegevens van medewerkers zijn enkel zichtbaar als de klant
    // support-toegang toestond (GDPR: toegang gekoppeld aan toestemming).
    const adminSupportUsersMatch = url.pathname.match(/^\/api\/admin\/support\/([^/]+)\/users$/);
    if (adminSupportUsersMatch && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "support");
      const tnt = store.data.tenants.find(t => t.id === adminSupportUsersMatch[1]);
      if (!tnt) return sendJson(res, 404, { ok: false, error: "Tenant niet gevonden" });
      if (tnt.supportAccess?.allowed !== true) {
        return sendJson(res, 403, { ok: false, error: "Klant heeft geen support-toegang toegestaan" });
      }
      const users = store.data.users
        .filter(u => u.tenantId === tnt.id && u.active !== false && u.role !== "super_admin")
        .map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
      sendJson(res, 200, { ok: true, users });
      return;
    }

    // ── Resellers (platform-partnerprogramma): beheer door superadmin ──────────
    if (url.pathname === "/api/admin/resellers" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const resellers = (store.data.resellers || []).map(r => publicReseller(r, store));
      sendJson(res, 200, { ok: true, resellers, canManage: isPlatformGod(user) });
      return;
    }
    if (url.pathname === "/api/admin/resellers" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformGod(user);
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      const loginEmail = String(body.loginEmail || "").trim().toLowerCase();
      if (!name) return sendJson(res, 400, { ok: false, error: "Naam is verplicht" });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(loginEmail)) return sendJson(res, 400, { ok: false, error: "Geldig login-e-mailadres is verplicht" });
      if (store.getUserByEmail(loginEmail)) return sendJson(res, 409, { ok: false, error: "Er bestaat al een gebruiker met dit e-mailadres" });
      const pct = Math.min(Math.max(Number(body.defaultCommissionPct) || 0, 0), 100);
      const now = new Date().toISOString();
      // LEGACY-BOOTSTRAP (bewust · h23-migratiepad). Deze route maakt de
      // organisatie meteen in status "active" aan en slaat daarmee de
      // 23.14-onboarding (applicant → screening → contracting → onboarding →
      // active) EN de activatiegates uit 23.4 over: geen 23.2-veldvalidatie,
      // geen contract-, DPA- of NDA-controle. Ze blijft bestaan zodat de
      // bestaande superadmin-console werkt; de normatieve weg is
      // POST /api/admin/resellers (applicant) + /onboarding + /activate.
      // Om de historiek toch kloppend te houden schrijven we de bootstrap als
      // expliciete gebeurtenis naar het append-only lifecycle-log (23.15).
      const reseller = store.insert("resellers", {
        id: `reseller_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        tenantId: null, name, contactEmail: String(body.contactEmail || loginEmail),
        status: "active", defaultCommissionPct: pct, createdBy: user.email, createdAt: now
      });
      // De gates uit 23.4 worden hier niet AFGEDWONGEN (dat zou de console breken),
      // maar wel GEMETEN en vastgelegd: zolang activationBlockers niet leeg is,
      // staat deze organisatie actief zonder geldig contract/DPA. Het veld is
      // machinaal opvraagbaar (GET /api/admin/resellers/:id/activation-blockers)
      // en het lifecycle-log draagt de exacte lijst, zodat de afwijking niet stil
      // is. Volledig sluiten vraagt een productbesluit: de console moet dan de
      // 23.2-verplichte velden + agreement_version/accepted_at uitvragen.
      const bootstrapBlockers = resellerLifecycleSvc.activationBlockers(reseller, [], new Date());
      store.update("resellers", reseller.id, { activationBlockers: bootstrapBlockers });
      reseller.activationBlockers = bootstrapBlockers;
      resellerLifecycleSvc.logLifecycle(store, {
        resellerId: reseller.id, kind: "organization", action: "legacy_bootstrap_created",
        reason: "legacy admin-console · onboarding- en contractgates overgeslagen",
        before: null,
        after: { status: "active", defaultCommissionPct: pct, activationBlockers: bootstrapBlockers },
      }, user);
      // Geen wachtwoord door de aanmaker: de reseller ontvangt een activatiemail.
      // MFA is verplicht voor reselleradmins (23.15): het account wordt met
      // mfaEnforced aangemaakt, zodat de eerste aanmelding MFA vraagt.
      const { user: loginUser, activationLink } = provisionPendingUser({
        id: `reseller_user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        tenantId: null, name, email: loginEmail,
        role: "reseller", permissions: [], resellerId: reseller.id,
        mfaEnabled: false, mfaEnforced: true
      });
      store.audit({ actor: user.email, tenantId: null, action: "reseller_created", area: "resellers", detail: `${name} (${loginEmail}) ${pct}%` });
      sendJson(res, 201, { ok: true, reseller: publicReseller(reseller, store), login: { email: loginUser.email }, activationLink });
      return;
    }
    const adminResellerMatch = url.pathname.match(/^\/api\/admin\/resellers\/([^/]+)$/);
    if (adminResellerMatch && req.method === "PATCH") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformGod(user);
      const reseller = store.get("resellers", adminResellerMatch[1]);
      if (!reseller) return sendJson(res, 404, { ok: false, error: "Reseller niet gevonden" });
      const body = await readBody(req);
      // ── Status via de 23.14-machine, niet via een vrije patch ──────────────
      // "paused" bestond alleen in dit legacy-pad en is in de machine niet
      // representeerbaar: zo'n rij kon daarna nooit meer gesuspendeerd of
      // beeindigd worden. De console blijft "paused" en "active" sturen, maar
      // de route mapt dat op de echte lifecycle: paused → suspend (reden
      // verplicht) en active → de expliciet gemarkeerde legacy-heractivatie.
      // Een self-signup-aanvraag ("pending") is geen machinestatus: pauzeren
      // daarvan faalt nu luid (RESELLER_ORG_STATE_INVALID) in plaats van stil
      // een onbekende status weg te schrijven · goedkeuren blijft wel werken.
      const wanted = body.status === "paused" ? "suspended" : body.status;
      if (typeof body.status === "string" && !["active", "paused", "suspended"].includes(body.status)) {
        return sendJson(res, 400, { ok: false, error: "Status moet active, paused of suspended zijn", code: "RESELLER_STATUS_INVALID" });
      }
      const patch = {};
      if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
      if (body.defaultCommissionPct !== undefined) patch.defaultCommissionPct = Math.min(Math.max(Number(body.defaultCommissionPct) || 0, 0), 100);
      let updated = store.update("resellers", reseller.id, { ...patch, updatedAt: new Date().toISOString() });
      if (wanted) {
        try {
          // Eenmalige datareparatie van legacy-rijen met status "paused".
          resellerLifecycleSvc.normalizeLegacyStatus(store, reseller.id, user);
          updated = wanted === "suspended"
            ? resellerLifecycleSvc.suspend(store, { resellerId: reseller.id, reason: body.reason || "legacy pauze" }, user)
            : resellerLifecycleSvc.legacyReactivate(store, { resellerId: reseller.id, reason: body.reason || null }, user);
        } catch (e) { return sendResellerError(res, e); }
      }
      let activationLink = null;
      if (wanted) {
        (store.data.users || []).filter(u => u.role === "reseller" && u.resellerId === reseller.id)
          .forEach(u => {
            if (wanted === "active") {
              // Goedkeuren: heeft de aanvrager nog geen wachtwoord? → activatiemail
              // sturen zodat die er zelf één instelt. Anders gewoon heractiveren.
              if (!u.passwordHash && !u.activation) {
                const { secret, record } = startActivation();
                store.update("users", u.id, { activation: record });
                const link = `${config.appUrl}/?activate=${encodeURIComponent(activationToken(u.id, secret))}`;
                sendActivationMail(u, link);
                if (!config.isProduction && !isMailLive()) activationLink = link;
              } else if (u.passwordHash) {
                store.update("users", u.id, { active: true });
              }
            } else {
              // Pauzeren → login-account deactiveren.
              store.update("users", u.id, { active: false });
            }
          });
      }
      store.audit({ actor: user.email, tenantId: null, action: "reseller_updated", area: "resellers", detail: `${reseller.name} ${JSON.stringify({ ...patch, ...(wanted ? { status: updated.status } : {}) })}` });
      sendJson(res, 200, { ok: true, reseller: publicReseller(updated, store), activationLink });
      return;
    }

    // ── Reseller-portaal: enkel commerciële data van EIGEN klanten ─────────────
    // De lijst volgt de koppelingsadministratie (resellerTenantLinks): een
    // ingetrokken of beeindigde koppeling laat de klant meteen verdwijnen ·
    // reseller_id op de tenant alleen is nooit genoeg (23.15). Zie
    // clientsOfReseller in src/modules/resellers.js voor de legacy-regel.
    if (url.pathname === "/api/reseller/clients" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller || reseller.status !== "active") return sendJson(res, 403, { ok: false, error: "Reseller-account niet actief" });
      if (foreignResellerParam(res, url, reseller)) return;
      sendJson(res, 200, { ok: true, reseller: { name: reseller.name, defaultCommissionPct: reseller.defaultCommissionPct }, ...commissionOverview(store, reseller) });
      return;
    }
    // Klant aanbrengen = een TENANTAANVRAAG indienen (23.9), nooit zelf een
    // tenant aanmaken. Het oude gedrag (directe tenant-insert met
    // resellerId = eigen id) was een zelf-koppeling buiten 23.4/23.9 om: geen
    // klantbevestiging, geen Monargo-review, geen assignment-record, geen
    // entitlements-validatie en niet transactioneel. Provisioning blijft een
    // platformactie (/api/admin/reseller-tenant-requests/:id/provision).
    if (url.pathname === "/api/reseller/clients" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller || reseller.status !== "active") return sendJson(res, 403, { ok: false, error: "Reseller-account niet actief" });
      const cu = resellerChannelActor(user);
      if (!resellerPortalAllowed(cu, "reseller.tenants.request", reseller)) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        // resellerId komt NOOIT uit de body: een reseller vraagt alleen voor
        // zichzelf aan (geen cross-reseller attributie, geen bestaans-oracle).
        const row = resellerTenantsSvc.requestTenant(store, { ...body, resellerId: reseller.id }, cu);
        return sendJson(res, 202, {
          ok: true, tenantRequest: row,
          message: "Aanvraag ontvangen · Monargo beoordeelt de aanvraag en bevestigt bij de klant voor de tenant wordt aangemaakt."
        });
      } catch (e) { return sendResellerError(res, e); }
    }

    // ═════ Kanaaldomein h23 · reseller-portaal (eigen/assigned scope) ═════════
    // Elke portaalroute: actor + assertReseller + eigen organisatieregel, en
    // daarna de rechtencheck via reseller-authz (actie + scope + tenantrelatie)
    // VOOR de service-call. Weigering is altijd een generieke 403 zonder
    // ID-probing; de services herhalen de checks (defense in depth).
    //
    // TODO (volgende slices · bewust NIET in deze slice gebouwd):
    //  - resellergebruikersbeheer (23.5): invite/rol/deactivate onder het recht
    //    reseller.users.manage. Zolang die routes ontbreken krijgt elke
    //    reseller-login de fallbackrol reseller_owner + LEGACY_RESELLER_GRANTS,
    //    waardoor sales-, ops- en financebevoegdheden in EEN persoon vallen;
    //  - klantinhoud-routes (23.12): elke route die verder gaat dan commerciele
    //    metadata MOET door resellerTenantsSvc.assertContentAccess +
    //    logDelegatedAction · zie de TODO bij die functies;
    //  - het volledige 23.13-portaal (deals, aanvragen, licenties, staten,
    //    disputen, payoutwijzigingen als paginas).

    // ── Deals (23.8): registratie, opvolging en indienen ─────────────────────
    if (url.pathname === "/api/reseller/deals" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (!resellerPortalAllowed(cu, "reseller.deals.view", reseller)) return resellerForbidden(res);
      if (foreignResellerParam(res, url, reseller)) return;
      try { return sendJson(res, 200, { ok: true, deals: resellerDealsSvc.listDeals(store, cu, {}) }); }
      catch (e) { return sendResellerError(res, e); }
    }
    if (url.pathname === "/api/reseller/deals" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (!resellerPortalAllowed(cu, "reseller.deals.create", reseller)) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const deal = resellerDealsSvc.registerDeal(store, body, cu);
        return sendJson(res, 201, { ok: true, deal: resellerDealsSvc.projectDeal(deal, "own") });
      } catch (e) { return sendResellerError(res, e); }
    }
    const rsDealTransMatch = url.pathname.match(/^\/api\/reseller\/deals\/([^/]+)\/transition$/);
    if (rsDealTransMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (!resellerPortalAllowed(cu, "reseller.deals.create", reseller)) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const deal = resellerDealsSvc.transitionDeal(store, {
          dealId: rsDealTransMatch[1], to: body.to, reason: body.reason || null,
          expectedVersion: body.expectedVersion === undefined ? null : body.expectedVersion
        }, cu);
        return sendJson(res, 200, { ok: true, deal: resellerDealsSvc.projectDeal(deal, "own") });
      } catch (e) { return sendResellerError(res, e); }
    }
    const rsDealMatch = url.pathname.match(/^\/api\/reseller\/deals\/([^/]+)$/);
    if (rsDealMatch && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (!resellerPortalAllowed(cu, "reseller.deals.view", reseller)) return resellerForbidden(res);
      try { return sendJson(res, 200, { ok: true, deal: resellerDealsSvc.getDeal(store, cu, rsDealMatch[1]) }); }
      catch (e) { return sendResellerError(res, e); }
    }

    // ── Tenantaanvragen (23.9): aanvragen, indienen of annuleren ─────────────
    if (url.pathname === "/api/reseller/tenant-requests" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (!resellerPortalAllowed(cu, ["reseller.tenants.request", "reseller.tenants.view"], reseller)) return resellerForbidden(res);
      if (foreignResellerParam(res, url, reseller)) return;
      return sendJson(res, 200, { ok: true, requests: resellerTenantsSvc.listTenantRequests(store, { resellerId: reseller.id }) });
    }
    if (url.pathname === "/api/reseller/tenant-requests" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (!resellerPortalAllowed(cu, "reseller.tenants.request", reseller)) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerTenantsSvc.requestTenant(store, { ...body, resellerId: body.resellerId || reseller.id }, cu);
        return sendJson(res, 201, { ok: true, request: row });
      } catch (e) { return sendResellerError(res, e); }
    }
    const rsTrqTransMatch = url.pathname.match(/^\/api\/reseller\/tenant-requests\/([^/]+)\/transition$/);
    if (rsTrqTransMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (!resellerPortalAllowed(cu, "reseller.tenants.request", reseller)) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerTenantsSvc.transitionTenantRequest(store, {
          requestId: rsTrqTransMatch[1], to: body.to, reason: body.reason || null,
          expectedVersion: body.expectedVersion === undefined ? null : body.expectedVersion
        }, cu);
        return sendJson(res, 200, { ok: true, request: row });
      } catch (e) { return sendResellerError(res, e); }
    }

    // ── Toegewezen tenants (23.4): uitsluitend commerciele metadata ──────────
    if (url.pathname === "/api/reseller/assigned-tenants" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (!resellerPortalAllowed(cu, "reseller.tenants.view", reseller)) return resellerForbidden(res);
      if (foreignResellerParam(res, url, reseller)) return;
      return sendJson(res, 200, { ok: true, tenants: resellerTenantsSvc.assignedTenants(store, reseller.id) });
    }

    // ── Gedelegeerde toegang (23.12): aanvragen, inzien, afstand doen ────────
    if (url.pathname === "/api/reseller/delegated-access" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      const tenantId = url.searchParams.get("tenantId");
      if (!tenantId) return sendJson(res, 400, { ok: false, error: "tenantId is verplicht", code: "TENANT_ID_REQUIRED" });
      if (!resellerPortalAllowed(cu, ["reseller.delegated_admin.use", "reseller.support.view", "reseller.tenants.view"], reseller, tenantId)) {
        return resellerForbidden(res);
      }
      if (foreignResellerParam(res, url, reseller)) return;
      return sendJson(res, 200, { ok: true, grants: resellerTenantsSvc.delegatedAccessFor(store, reseller.id, tenantId) });
    }
    if (url.pathname === "/api/reseller/delegated-access" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      if (!resellerPortalAllowed(cu, "reseller.delegated_admin.use", reseller, body.tenantId || null)) return resellerForbidden(res);
      try {
        // 23.15: iedereen met gedelegeerde tenanttoegang heeft MFA nodig.
        assertResellerMfa(cu, "reseller.delegated_admin.use");
        const row = resellerTenantsSvc.requestDelegatedAccess(store, {
          resellerId: body.resellerId || reseller.id, tenantId: body.tenantId,
          scope: body.scope, reason: body.reason, startAt: body.startAt || null, endAt: body.endAt || null
        }, cu);
        return sendJson(res, 201, { ok: true, grant: row });
      } catch (e) { return sendResellerError(res, e); }
    }
    const rsDlgRevokeMatch = url.pathname.match(/^\/api\/reseller\/delegated-access\/([^/]+)\/revoke$/);
    if (rsDlgRevokeMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      // Afstand doen van eigen toegang mag ook onder suspensie (veilige actie).
      if (!resellerPortalAllowed(cu, ["reseller.delegated_admin.use", "reseller.organization.view"], reseller)) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        // 23.15: ook afstand doen van gedelegeerde toegang blijft een handeling
        // op dat toegangsrecord · sterke authenticatie vereist.
        assertResellerMfa(cu, "reseller.delegated_admin.use");
        const row = resellerTenantsSvc.revokeDelegatedAccess(store, { grantId: rsDlgRevokeMatch[1], reason: body.reason }, cu);
        return sendJson(res, 200, { ok: true, grant: row });
      } catch (e) { return sendResellerError(res, e); }
    }

    // ── Licentie-aanvragen (23.10): order/seats/plan/trial/opzegging ─────────
    if (url.pathname === "/api/reseller/license-requests" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (!resellerPortalAllowed(cu, ["reseller.licenses.request", "reseller.organization.view"], reseller)) return resellerForbidden(res);
      if (foreignResellerParam(res, url, reseller)) return;
      return sendJson(res, 200, { ok: true, requests: resellerLicensingSvc.requestsOf(store, reseller.id) });
    }
    if (url.pathname === "/api/reseller/license-requests" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      if (!resellerPortalAllowed(cu, "reseller.licenses.request", reseller, body.tenantId || null)) return resellerForbidden(res);
      try { return sendJson(res, 201, { ok: true, request: createResellerLicenseRequest(body, cu) }); }
      catch (e) { return sendResellerError(res, e); }
    }
    const rsLicTransMatch = url.pathname.match(/^\/api\/reseller\/license-requests\/([^/]+)\/transition$/);
    if (rsLicTransMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (!resellerPortalAllowed(cu, "reseller.licenses.request", reseller)) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerLicensingSvc.transitionLicenseRequest(store, { requestId: rsLicTransMatch[1], to: body.to, reason: body.reason || null }, cu);
        return sendJson(res, 200, { ok: true, request: row });
      } catch (e) { return sendResellerError(res, e); }
    }

    // ── Prijsuitzonderingen (23.10): aanvragen en inzien · nooit goedkeuren ──
    if (url.pathname === "/api/reseller/price-exceptions" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (!resellerPortalAllowed(cu, ["reseller.licenses.request", "reseller.organization.view"], reseller)) return resellerForbidden(res);
      if (foreignResellerParam(res, url, reseller)) return;
      return sendJson(res, 200, { ok: true, exceptions: resellerLicensingSvc.exceptionsOf(store, reseller.id) });
    }
    if (url.pathname === "/api/reseller/price-exceptions" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      if (!resellerPortalAllowed(cu, "reseller.licenses.request", reseller, body.tenantId || null)) return resellerForbidden(res);
      try { return sendJson(res, 201, { ok: true, exception: resellerLicensingSvc.priceException(store, body, cu) }); }
      catch (e) { return sendResellerError(res, e); }
    }

    // ── Commissie (23.11): eigen contracten, staten, dispuut en payout ───────
    if (url.pathname === "/api/reseller/commission-agreements" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (!resellerPortalAllowed(cu, "reseller.commissions.view", reseller)) return resellerForbidden(res);
      if (foreignResellerParam(res, url, reseller)) return;
      return sendJson(res, 200, { ok: true, agreements: resellerCommissionSvc.agreementsFor(store, reseller.id) });
    }
    if (url.pathname === "/api/reseller/commission-statements" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (!resellerPortalAllowed(cu, "reseller.commissions.view", reseller)) return resellerForbidden(res);
      if (foreignResellerParam(res, url, reseller)) return;
      return sendJson(res, 200, { ok: true, statements: resellerCommissionSvc.statementsFor(store, reseller.id) });
    }
    if (url.pathname === "/api/reseller/commission-disputes" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (!resellerPortalAllowed(cu, "reseller.commissions.dispute", reseller)) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerCommissionSvc.openDispute(store, {
          statementId: body.statementId || null, eventId: body.eventId || null,
          reason: body.reason, disputedAmount: body.disputedAmount === undefined ? null : body.disputedAmount
        }, cu);
        return sendJson(res, 201, { ok: true, dispute: row });
      } catch (e) { return sendResellerError(res, e); }
    }
    if (url.pathname === "/api/reseller/payout-changes" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller) return resellerForbidden(res);
      const cu = resellerChannelActor(user);
      if (!resellerPortalAllowed(cu, "reseller.payout.manage", reseller)) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerCommissionSvc.requestPayoutChange(store, {
          resellerId: body.resellerId || reseller.id,
          payout_account: body.payout_account === undefined ? null : body.payout_account,
          payout_currency: body.payout_currency === undefined ? null : body.payout_currency,
          reason: body.reason
        }, cu);
        return sendJson(res, 201, { ok: true, change: row });
      } catch (e) { return sendResellerError(res, e); }
    }

    // ── Gedelegeerde toegang · besluit door de TENANT ADMIN (23.12) ──────────
    // Bewust buiten /api/reseller en /api/admin: de goedkeurder is de admin
    // van precies die tenant (vier-ogen, nooit de aanvrager zelf).
    const dlgApproveMatch = url.pathname.match(/^\/api\/delegated-access\/([^/]+)\/approve$/);
    if (dlgApproveMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      if (user.role !== "tenant_admin") return resellerForbidden(res);
      assertAdminMfa(user);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const grant = resellerTenantsSvc.approveDelegatedAccess(store, { grantId: dlgApproveMatch[1], activate: body.activate === true }, user);
        return sendJson(res, 200, { ok: true, grant });
      } catch (e) { return sendResellerError(res, e); }
    }
    const dlgTenantRevokeMatch = url.pathname.match(/^\/api\/delegated-access\/([^/]+)\/revoke$/);
    if (dlgTenantRevokeMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      if (user.role !== "tenant_admin") return resellerForbidden(res);
      assertAdminMfa(user);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const grant = resellerTenantsSvc.revokeDelegatedAccess(store, { grantId: dlgTenantRevokeMatch[1], reason: body.reason }, user);
        return sendJson(res, 200, { ok: true, grant });
      } catch (e) { return sendResellerError(res, e); }
    }

    // ═════ Kanaaldomein h23 · Monargo-zijde (/api/admin/reseller-*) ═══════════
    // Platform-scope "resellers" + kanaalrolcheck via reseller-authz. De
    // fallbackrol per routefamilie (partnerbeheer vs finance) houdt de
    // gevoelige beperkingen uit 23.5 intact.

    // ── Deals (23.8) · beoordeling, attributie, conversie ────────────────────
    if (url.pathname === "/api/admin/reseller-deals" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.deals.view", {})) return resellerForbidden(res);
      try { return sendJson(res, 200, { ok: true, deals: resellerDealsSvc.listDeals(store, cu, { resellerId: url.searchParams.get("resellerId") || null }) }); }
      catch (e) { return sendResellerError(res, e); }
    }
    if (url.pathname === "/api/admin/reseller-deals" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.deals.create", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try { return sendJson(res, 201, { ok: true, deal: resellerDealsSvc.registerDeal(store, body, cu) }); }
      catch (e) { return sendResellerError(res, e); }
    }
    if (url.pathname === "/api/admin/reseller-deals/expire" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.deals.approve", {})) return resellerForbidden(res);
      try { return sendJson(res, 200, { ok: true, ...resellerDealsSvc.expireDeals(store) }); }
      catch (e) { return sendResellerError(res, e); }
    }
    const admDealTransMatch = url.pathname.match(/^\/api\/admin\/reseller-deals\/([^/]+)\/transition$/);
    if (admDealTransMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.deals.approve", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const deal = resellerDealsSvc.transitionDeal(store, {
          dealId: admDealTransMatch[1], to: body.to, reason: body.reason || null,
          expectedVersion: body.expectedVersion === undefined ? null : body.expectedVersion
        }, cu);
        return sendJson(res, 200, { ok: true, deal });
      } catch (e) { return sendResellerError(res, e); }
    }
    const admDealAttrMatch = url.pathname.match(/^\/api\/admin\/reseller-deals\/([^/]+)\/attribution$/);
    if (admDealAttrMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.deals.approve", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const deal = resellerDealsSvc.setAttribution(store, {
          dealId: admDealAttrMatch[1], attributionPercent: body.attributionPercent,
          reason: body.reason || null,
          expectedVersion: body.expectedVersion === undefined ? null : body.expectedVersion
        }, cu);
        return sendJson(res, 200, { ok: true, deal });
      } catch (e) { return sendResellerError(res, e); }
    }
    const admDealConvertMatch = url.pathname.match(/^\/api\/admin\/reseller-deals\/([^/]+)\/convert$/);
    if (admDealConvertMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.deals.approve", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const deal = resellerDealsSvc.convertDeal(store, {
          dealId: admDealConvertMatch[1], customerId: body.customerId, tenantId: body.tenantId,
          subscriptionId: body.subscriptionId || null, reason: body.reason || null,
          expectedVersion: body.expectedVersion === undefined ? null : body.expectedVersion
        }, cu);
        return sendJson(res, 200, { ok: true, deal });
      } catch (e) { return sendResellerError(res, e); }
    }
    const admDealMatch = url.pathname.match(/^\/api\/admin\/reseller-deals\/([^/]+)$/);
    if (admDealMatch && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.deals.view", {})) return resellerForbidden(res);
      try { return sendJson(res, 200, { ok: true, deal: resellerDealsSvc.getDeal(store, cu, admDealMatch[1]) }); }
      catch (e) { return sendResellerError(res, e); }
    }

    // ── Tenantaanvragen (23.9) · beoordeling en transactionele provisioning ──
    if (url.pathname === "/api/admin/reseller-tenant-requests" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.view", {})) return resellerForbidden(res);
      return sendJson(res, 200, { ok: true, requests: resellerTenantsSvc.listTenantRequests(store, { resellerId: url.searchParams.get("resellerId") || null }) });
    }
    const admTrqTransMatch = url.pathname.match(/^\/api\/admin\/reseller-tenant-requests\/([^/]+)\/transition$/);
    if (admTrqTransMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.request", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerTenantsSvc.transitionTenantRequest(store, {
          requestId: admTrqTransMatch[1], to: body.to, reason: body.reason || null,
          expectedVersion: body.expectedVersion === undefined ? null : body.expectedVersion
        }, cu);
        return sendJson(res, 200, { ok: true, request: row });
      } catch (e) { return sendResellerError(res, e); }
    }
    const admTrqProvisionMatch = url.pathname.match(/^\/api\/admin\/reseller-tenant-requests\/([^/]+)\/provision$/);
    if (admTrqProvisionMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.request", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const result = resellerTenantsSvc.provisionTenant(store, {
          requestId: admTrqProvisionMatch[1], tenantId: body.tenantId || null,
          adminEmail: body.adminEmail || null, adminName: body.adminName || null,
          commissionPct: typeof body.commissionPct === "number" ? body.commissionPct : null
        }, cu);
        // Zelfde beleid als provisionPendingUser: het activatietoken komt
        // NOOIT in een respons zodra er echte mail of productie in het spel is.
        const activationLink = (config.isProduction || isMailLive())
          ? null
          : `${config.appUrl}/?activate=${encodeURIComponent(result.activationToken)}`;
        return sendJson(res, 201, { ok: true, tenant: result.tenant, link: result.link, adminUser: result.adminUser, request: result.request, activationLink });
      } catch (e) { return sendResellerError(res, e); }
    }

    // ── Tenantkoppelingen (23.4/23.9/23.15) · assignment-records ─────────────
    if (url.pathname === "/api/admin/reseller-tenant-links" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.view", {})) return resellerForbidden(res);
      const rid = url.searchParams.get("resellerId");
      const links = (store.data.resellerTenantLinks || []).filter(l => !rid || l.resellerId === rid);
      return sendJson(res, 200, { ok: true, links });
    }
    if (url.pathname === "/api/admin/reseller-tenant-links" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.request", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerTenantsSvc.linkTenant(store, {
          resellerId: body.resellerId, tenantId: body.tenantId, relationType: body.relationType,
          startAt: body.startAt || null, endAt: body.endAt || null, reason: body.reason
        }, cu);
        return sendJson(res, 201, { ok: true, link: row });
      } catch (e) { return sendResellerError(res, e); }
    }
    const admLinkRevokeMatch = url.pathname.match(/^\/api\/admin\/reseller-tenant-links\/([^/]+)\/revoke$/);
    if (admLinkRevokeMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.request", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerTenantsSvc.revokeTenantLink(store, { linkId: admLinkRevokeMatch[1], reason: body.reason }, cu);
        return sendJson(res, 200, { ok: true, link: row });
      } catch (e) { return sendResellerError(res, e); }
    }

    // ── Gedelegeerde toegang (23.12) · platformbeheer + sweep ────────────────
    if (url.pathname === "/api/admin/reseller-delegated-access" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.view", {})) return resellerForbidden(res);
      const rid = url.searchParams.get("resellerId");
      const tid = url.searchParams.get("tenantId");
      const grants = (store.data.resellerAccessGrants || [])
        .filter(g => (!rid || g.resellerId === rid) && (!tid || g.tenantId === tid));
      return sendJson(res, 200, { ok: true, grants });
    }
    if (url.pathname === "/api/admin/reseller-delegated-access/expire" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.request", {})) return resellerForbidden(res);
      try { return sendJson(res, 200, { ok: true, ...resellerTenantsSvc.expireDelegatedAccess(store, Date.now()) }); }
      catch (e) { return sendResellerError(res, e); }
    }
    const admDlgActivateMatch = url.pathname.match(/^\/api\/admin\/reseller-delegated-access\/([^/]+)\/activate$/);
    if (admDlgActivateMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.request", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      try {
        const grant = resellerTenantsSvc.activateDelegatedAccess(store, { grantId: admDlgActivateMatch[1] }, cu);
        return sendJson(res, 200, { ok: true, grant });
      } catch (e) { return sendResellerError(res, e); }
    }
    const admDlgRevokeMatch = url.pathname.match(/^\/api\/admin\/reseller-delegated-access\/([^/]+)\/revoke$/);
    if (admDlgRevokeMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.tenants.request", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const grant = resellerTenantsSvc.revokeDelegatedAccess(store, { grantId: admDlgRevokeMatch[1], reason: body.reason }, cu);
        return sendJson(res, 200, { ok: true, grant });
      } catch (e) { return sendResellerError(res, e); }
    }

    // ── Licenties en prijzen (23.10) · goedkeuring aan Monargo-zijde ─────────
    if (url.pathname === "/api/admin/reseller-license-requests" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.licenses.request", {})) return resellerForbidden(res);
      const rid = url.searchParams.get("resellerId");
      const requests = rid
        ? resellerLicensingSvc.requestsOf(store, rid)
        : (store.data.resellerLicenseRequests || []);
      return sendJson(res, 200, { ok: true, requests });
    }
    if (url.pathname === "/api/admin/reseller-license-requests" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.licenses.request", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try { return sendJson(res, 201, { ok: true, request: createResellerLicenseRequest(body, cu) }); }
      catch (e) { return sendResellerError(res, e); }
    }
    const admLicTransMatch = url.pathname.match(/^\/api\/admin\/reseller-license-requests\/([^/]+)\/transition$/);
    if (admLicTransMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.licenses.request", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerLicensingSvc.transitionLicenseRequest(store, { requestId: admLicTransMatch[1], to: body.to, reason: body.reason || null }, cu);
        return sendJson(res, 200, { ok: true, request: row });
      } catch (e) { return sendResellerError(res, e); }
    }
    if (url.pathname === "/api/admin/reseller-price-exceptions" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.licenses.request", {})) return resellerForbidden(res);
      const rid = url.searchParams.get("resellerId");
      const exceptions = rid
        ? resellerLicensingSvc.exceptionsOf(store, rid)
        : (store.data.resellerPriceExceptions || []);
      return sendJson(res, 200, { ok: true, exceptions });
    }
    const admPexApproveMatch = url.pathname.match(/^\/api\/admin\/reseller-price-exceptions\/([^/]+)\/approve$/);
    if (admPexApproveMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.licenses.request", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerLicensingSvc.approvePriceException(store, { exceptionId: admPexApproveMatch[1], note: body.note || null }, cu);
        return sendJson(res, 200, { ok: true, exception: row });
      } catch (e) { return sendResellerError(res, e); }
    }
    const admPexRejectMatch = url.pathname.match(/^\/api\/admin\/reseller-price-exceptions\/([^/]+)\/reject$/);
    if (admPexRejectMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.licenses.request", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerLicensingSvc.rejectPriceException(store, { exceptionId: admPexRejectMatch[1], reason: body.reason }, cu);
        return sendJson(res, 200, { ok: true, exception: row });
      } catch (e) { return sendResellerError(res, e); }
    }
    if (url.pathname === "/api/admin/reseller-discounts" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.tier.manage", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try { return sendJson(res, 201, { ok: true, discount: resellerLicensingSvc.setResellerDiscount(store, body, cu) }); }
      catch (e) { return sendResellerError(res, e); }
    }
    const admDiscountMatch = url.pathname.match(/^\/api\/admin\/reseller-discounts\/([^/]+)$/);
    if (admDiscountMatch && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.tier.manage", {})) return resellerForbidden(res);
      return sendJson(res, 200, {
        ok: true,
        discounts: resellerLicensingSvc.discountsOf(store, admDiscountMatch[1]),
        active: resellerLicensingSvc.resellerDiscountFor(store, admDiscountMatch[1])
      });
    }

    // ── Commissiecontracten, events, staten, dispuut, payout (23.11) ─────────
    if (url.pathname === "/api/admin/reseller-commission-agreements" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.view", {})) return resellerForbidden(res);
      const rid = url.searchParams.get("resellerId");
      const agreements = rid
        ? resellerCommissionSvc.agreementsFor(store, rid)
        : (store.data.resellerCommissionAgreements || []);
      return sendJson(res, 200, { ok: true, agreements });
    }
    if (url.pathname === "/api/admin/reseller-commission-agreements" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try { return sendJson(res, 201, { ok: true, agreement: resellerCommissionSvc.createAgreement(store, body, cu) }); }
      catch (e) { return sendResellerError(res, e); }
    }
    const admCagTransMatch = url.pathname.match(/^\/api\/admin\/reseller-commission-agreements\/([^/]+)\/transition$/);
    if (admCagTransMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerCommissionSvc.transitionAgreement(store, { agreementId: admCagTransMatch[1], to: body.to, reason: body.reason || null }, cu);
        return sendJson(res, 200, { ok: true, agreement: row });
      } catch (e) { return sendResellerError(res, e); }
    }
    const admCagAmendMatch = url.pathname.match(/^\/api\/admin\/reseller-commission-agreements\/([^/]+)\/amend$/);
    if (admCagAmendMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerCommissionSvc.amendAgreement(store, { agreementId: admCagAmendMatch[1], changes: body.changes || {}, reason: body.reason }, cu);
        return sendJson(res, 201, { ok: true, agreement: row });
      } catch (e) { return sendResellerError(res, e); }
    }
    if (url.pathname === "/api/admin/reseller-commission-events/accrue" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const result = resellerCommissionSvc.accrueFromSource(store, { resellerId: body.resellerId, source: body.source || {}, at: body.at || null }, cu);
        return sendJson(res, result.created ? 201 : 200, { ok: true, ...result });
      } catch (e) { return sendResellerError(res, e); }
    }
    const admCevExcludeMatch = url.pathname.match(/^\/api\/admin\/reseller-commission-events\/([^/]+)\/exclude$/);
    if (admCevExcludeMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try { return sendJson(res, 200, { ok: true, ...resellerCommissionSvc.excludeEvent(store, { eventId: admCevExcludeMatch[1], reason: body.reason }, cu) }); }
      catch (e) { return sendResellerError(res, e); }
    }
    const admCevAdjustMatch = url.pathname.match(/^\/api\/admin\/reseller-commission-events\/([^/]+)\/adjust$/);
    if (admCevAdjustMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const result = resellerCommissionSvc.adjustEvent(store, {
          eventId: admCevAdjustMatch[1], amount: body.amount === undefined ? null : body.amount, reason: body.reason
        }, cu);
        return sendJson(res, 200, { ok: true, ...result });
      } catch (e) { return sendResellerError(res, e); }
    }
    const admCevClawMatch = url.pathname.match(/^\/api\/admin\/reseller-commission-events\/([^/]+)\/clawback$/);
    if (admCevClawMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const result = resellerCommissionSvc.clawbackForReason(store, {
          eventId: admCevClawMatch[1], reasonCode: body.reasonCode,
          amount: body.amount === undefined ? null : body.amount, note: body.note || ""
        }, cu);
        return sendJson(res, 200, { ok: true, ...result });
      } catch (e) { return sendResellerError(res, e); }
    }
    if (url.pathname === "/api/admin/reseller-commission-statements" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.view", {})) return resellerForbidden(res);
      const rid = url.searchParams.get("resellerId");
      const statements = rid
        ? resellerCommissionSvc.statementsFor(store, rid)
        : (store.data.resellerCommissionStatements || []);
      return sendJson(res, 200, { ok: true, statements });
    }
    if (url.pathname === "/api/admin/reseller-commission-statements" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try { return sendJson(res, 201, { ok: true, statement: resellerCommissionSvc.buildStatement(store, body, cu) }); }
      catch (e) { return sendResellerError(res, e); }
    }
    const admCstRebuildMatch = url.pathname.match(/^\/api\/admin\/reseller-commission-statements\/([^/]+)\/rebuild$/);
    if (admCstRebuildMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      try { return sendJson(res, 200, { ok: true, statement: resellerCommissionSvc.rebuildStatement(store, { statementId: admCstRebuildMatch[1] }, cu) }); }
      catch (e) { return sendResellerError(res, e); }
    }
    const admCstTransMatch = url.pathname.match(/^\/api\/admin\/reseller-commission-statements\/([^/]+)\/transition$/);
    if (admCstTransMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerCommissionSvc.transitionStatement(store, { statementId: admCstTransMatch[1], to: body.to, reason: body.reason || null }, cu);
        return sendJson(res, 200, { ok: true, statement: row });
      } catch (e) { return sendResellerError(res, e); }
    }
    if (url.pathname === "/api/admin/reseller-commission-disputes" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.view", {})) return resellerForbidden(res);
      const rid = url.searchParams.get("resellerId");
      const disputes = (store.data.resellerCommissionDisputes || []).filter(d => !rid || d.resellerId === rid);
      return sendJson(res, 200, { ok: true, disputes });
    }
    const admCdsTransMatch = url.pathname.match(/^\/api\/admin\/reseller-commission-disputes\/([^/]+)\/transition$/);
    if (admCdsTransMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.commissions.manage", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerCommissionSvc.transitionDispute(store, { disputeId: admCdsTransMatch[1], to: body.to, resolution: body.resolution || null }, cu);
        return sendJson(res, 200, { ok: true, dispute: row });
      } catch (e) { return sendResellerError(res, e); }
    }
    if (url.pathname === "/api/admin/reseller-payout-changes" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.payout.manage", {})) return resellerForbidden(res);
      const rid = url.searchParams.get("resellerId");
      const changes = (store.data.resellerPayoutChanges || []).filter(c => !rid || c.resellerId === rid);
      return sendJson(res, 200, { ok: true, changes });
    }
    if (url.pathname === "/api/admin/reseller-payout-changes" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.payout.manage", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerCommissionSvc.requestPayoutChange(store, {
          resellerId: body.resellerId,
          payout_account: body.payout_account === undefined ? null : body.payout_account,
          payout_currency: body.payout_currency === undefined ? null : body.payout_currency,
          reason: body.reason
        }, cu);
        return sendJson(res, 201, { ok: true, change: row });
      } catch (e) { return sendResellerError(res, e); }
    }
    const admPchApproveMatch = url.pathname.match(/^\/api\/admin\/reseller-payout-changes\/([^/]+)\/approve$/);
    if (admPchApproveMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.payout.approve", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      try { return sendJson(res, 200, { ok: true, change: resellerCommissionSvc.approvePayoutChange(store, { changeId: admPchApproveMatch[1] }, cu) }); }
      catch (e) { return sendResellerError(res, e); }
    }
    const admPchRejectMatch = url.pathname.match(/^\/api\/admin\/reseller-payout-changes\/([^/]+)\/reject$/);
    if (admPchRejectMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.payout.approve", {})
        && !resellerAuthz.canResellerAction(cu, "reseller.payout.manage", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try { return sendJson(res, 200, { ok: true, change: resellerCommissionSvc.rejectPayoutChange(store, { changeId: admPchRejectMatch[1], reason: body.reason || null }, cu) }); }
      catch (e) { return sendResellerError(res, e); }
    }
    // ── Payoutgegevens inzien (23.15/DoD-2) · APARTE finance-route ───────────
    // Algemene resellerexports (lijst, overview, lifecycle-responses) dragen
    // NOOIT de IBAN: die is uitsluitend hier zichtbaar, achter
    // reseller.payout.manage. Een monargo_partner_manager valt daarmee af
    // (SENSITIVE_DENY 23.5) · alleen partner finance ziet payoutgegevens.
    const admPayoutDetailsMatch = url.pathname.match(/^\/api\/admin\/reseller-payout-details\/([^/]+)$/);
    if (admPayoutDetailsMatch && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_finance");
      if (!resellerAuthz.canResellerAction(cu, "reseller.payout.manage", {})) return resellerForbidden(res);
      const org = store.get("resellers", admPayoutDetailsMatch[1]);
      if (!org) return sendJson(res, 404, { ok: false, error: "Niet gevonden", code: "RESELLER_NOT_FOUND" });
      store.audit({ actor: user.email, tenantId: null, area: "resellers", action: "payout_details_viewed", detail: org.id });
      return sendJson(res, 200, { ok: true, payout: payoutDetails(org) });
    }

    // ── Organisatie-lifecycle, reviews en offboarding (23.13/23.14) ──────────
    const admOrgActionMatch = url.pathname.match(/^\/api\/admin\/resellers\/([^/]+)\/(transition|activate|suspend|terminate|onboarding|activation-blockers|overview|reviews|offboarding)$/);
    if (admOrgActionMatch) {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      const resellerId = admOrgActionMatch[1];
      const orgAction = admOrgActionMatch[2];
      const readOnly = req.method === "GET" && ["activation-blockers", "overview", "reviews"].includes(orgAction);
      const needed = readOnly ? "reseller.organization.view" : "reseller.organization.edit";
      if (!resellerAuthz.canResellerAction(cu, needed, {})) return resellerForbidden(res);
      if (readOnly) {
        try {
          if (orgAction === "activation-blockers") {
            const org = store.get("resellers", resellerId);
            if (!org) return sendJson(res, 404, { ok: false, error: "Niet gevonden", code: "RESELLER_NOT_FOUND" });
            const agreements = (store.data.resellerAgreements || []).filter(a => a && a.resellerId === resellerId);
            return sendJson(res, 200, { ok: true, blockers: resellerLifecycleSvc.activationBlockers(org, agreements) });
          }
          if (orgAction === "overview") {
            return sendJson(res, 200, { ok: true, ...resellerLifecycleSvc.historicalOverview(store, resellerId) });
          }
          // orgAction === "reviews"
          const reviews = (store.data.resellerReviews || []).filter(r => r && r.resellerId === resellerId);
          return sendJson(res, 200, { ok: true, reviews });
        } catch (e) { return sendResellerError(res, e); }
      }
      if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        if (orgAction === "transition") {
          const org = resellerLifecycleSvc.transitionOrganization(store, { resellerId, to: body.to, reason: body.reason || null, date: body.date || null }, cu);
          return sendJson(res, 200, { ok: true, reseller: publicReseller(org, store) });
        }
        if (orgAction === "activate") {
          const org = resellerLifecycleSvc.activate(store, { resellerId }, cu);
          return sendJson(res, 200, { ok: true, reseller: publicReseller(org, store) });
        }
        if (orgAction === "suspend") {
          const org = resellerLifecycleSvc.suspend(store, { resellerId, reason: body.reason, date: body.date || null }, cu);
          return sendJson(res, 200, { ok: true, reseller: publicReseller(org, store) });
        }
        if (orgAction === "terminate") {
          const org = resellerLifecycleSvc.terminate(store, { resellerId, reason: body.reason || null, date: body.date || null, exitStatus: body.exitStatus || "closed" }, cu);
          return sendJson(res, 200, { ok: true, reseller: publicReseller(org, store) });
        }
        if (orgAction === "onboarding") {
          const org = resellerLifecycleSvc.advanceOnboarding(store, { resellerId, to: body.to }, cu);
          return sendJson(res, 200, { ok: true, reseller: publicReseller(org, store) });
        }
        if (orgAction === "reviews") {
          const row = resellerLifecycleSvc.scheduleReview(store, { resellerId, reviewDate: body.reviewDate }, cu);
          return sendJson(res, 201, { ok: true, review: row });
        }
        // orgAction === "offboarding"
        const row = resellerLifecycleSvc.startOffboarding(store, { resellerId, reason: body.reason || null }, cu);
        return sendJson(res, 201, { ok: true, offboarding: row });
      } catch (e) { return sendResellerError(res, e); }
    }
    const admReviewTransMatch = url.pathname.match(/^\/api\/admin\/reseller-reviews\/([^/]+)\/transition$/);
    if (admReviewTransMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.organization.edit", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerLifecycleSvc.transitionReview(store, { reviewId: admReviewTransMatch[1], to: body.to, reason: body.reason || null }, cu);
        return sendJson(res, 200, { ok: true, review: row });
      } catch (e) { return sendResellerError(res, e); }
    }
    const admObTransMatch = url.pathname.match(/^\/api\/admin\/reseller-offboardings\/([^/]+)\/transition$/);
    if (admObTransMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "resellers");
      const cu = monargoChannelActor(user, "monargo_partner_manager");
      if (!resellerAuthz.canResellerAction(cu, "reseller.organization.edit", {})) return resellerForbidden(res);
      if (armResellerIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      try {
        const row = resellerLifecycleSvc.transitionOffboarding(store, { offboardingId: admObTransMatch[1], to: body.to, reason: body.reason || null }, cu);
        return sendJson(res, 200, { ok: true, offboarding: row });
      } catch (e) { return sendResellerError(res, e); }
    }

    // ── Super-admin: gebruiker bijwerken (deactiveren / rol) ──────────────────
    const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (adminUserMatch && req.method === "PATCH") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      const target = store.getUserById(adminUserMatch[1]);
      // De beschermde hoofd-superadmin (god) is onaantastbaar; platform-
      // medewerkers (super_admin) worden enkel via /api/admin/staff door de god
      // beheerd · niet via dit generieke endpoint.
      if (target && target.protected === true) {
        return sendJson(res, 403, { ok: false, error: "De hoofd-superadmin kan niet gewijzigd of gedeactiveerd worden" });
      }
      if (target && target.role === "super_admin") {
        return sendJson(res, 403, { ok: false, error: "Beheer platform-medewerkers via Platformteam" });
      }
      const body = await readBody(req);
      // GDPR/dataminimalisatie: de superadmin-console beheert geen rollen/rechten
      // van tenant-medewerkers. Dat gebeurt via geconsenteerde impersonatie in de
      // tenant-admin. Hier enkel platform-veilige basisvelden.
      const allowed = ["active", "name", "function", "phone"];
      const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
      const updated = store.update("users", adminUserMatch[1], { ...patch, updatedAt: new Date().toISOString() });
      store.audit({ actor: user.email, tenantId: updated.tenantId, action: "admin_user_updated", area: "users", detail: adminUserMatch[1] });
      const { passwordHash, mfaSecret, mfaPendingSecret, recoveryCodes, ...safe } = updated;
      sendJson(res, 200, { ok: true, user: safe });
      return;
    }

    // ── Super-admin: gebruiker ontgrendelen ───────────────────────────────────
    const adminUserUnlockMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/unlock$/);
    if (adminUserUnlockMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      const updated = store.update("users", adminUserUnlockMatch[1], {
        failedLoginCount: 0, lockedUntil: null, updatedAt: new Date().toISOString()
      });
      store.audit({ actor: user.email, tenantId: updated.tenantId, action: "admin_user_unlocked", area: "users", detail: adminUserUnlockMatch[1] });
      sendJson(res, 200, { ok: true });
      return;
    }

    // ── Super-admin: wachtwoord resetten ──────────────────────────────────────
    const adminUserResetMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
    if (adminUserResetMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      const target = store.getUserById(adminUserResetMatch[1]);
      if (!target) return sendJson(res, 404, { ok: false, error: "Gebruiker niet gevonden" });
      const tempPassword = crypto.randomBytes(10).toString("base64url");
      store.update("users", target.id, { passwordHash: hashPassword(tempPassword), updatedAt: new Date().toISOString() });
      store.audit({ actor: user.email, tenantId: target.tenantId, action: "admin_password_reset", area: "users", detail: target.email });
      sendJson(res, 200, { ok: true, tempPassword });
      return;
    }

    // ── Super-admin: facturatie overzicht ─────────────────────────────────────
    if (url.pathname === "/api/admin/billing" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "billing");
      // CTO-09: MRR uit de centrale billingbron (superadmin-bewerkbare
      // bundelprijzen) · geen vaste prijsconstanten meer in dit overzicht.
      const rows = store.data.tenants.map(t => {
        const users = store.list("users", t.id).length;
        const mrr = tenantMrr(store, t);
        const mrrUnit = users > 0 ? Math.round((mrr / users) * 100) / 100 : mrr;
        return { id: t.id, name: t.name, plan: t.plan, status: t.status,
          users, mrrUnit, mrr, arr: Math.round(mrr * 12 * 100) / 100, billingEmail: t.billingEmail || "" };
      }).sort((a, b) => b.mrr - a.mrr);
      const totalMrr = rows.reduce((s, r) => s + r.mrr, 0);
      sendJson(res, 200, { ok: true, rows, totalMrr, totalArr: totalMrr * 12 });
      return;
    }

    // ── Super-admin: systeem errors (alle tenants) ────────────────────────────
    if (url.pathname === "/api/admin/errors" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "system");
      const limit = Number(url.searchParams.get("limit") || 100);
      const errors = (store.data.errorEvents || []).slice().reverse().slice(0, limit);
      sendJson(res, 200, { ok: true, errors });
      return;
    }

    // ── Platform-operations (superadmin): readiness, events, mail-log, backups ──
    if (url.pathname === "/api/admin/readiness" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "system");
      sendJson(res, 200, { ok: true, readiness: productionReadiness(store) });
      return;
    }
    if (url.pathname === "/api/admin/events" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "system");
      sendJson(res, 200, { ok: true, ...eventLog(store, Number(url.searchParams.get("limit") || 60)) });
      return;
    }
    if (url.pathname === "/api/admin/mail-log" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "system");
      sendJson(res, 200, { ok: true, mail: recentMail(), live: isMailLive() });
      return;
    }
    if (url.pathname === "/api/admin/backups" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "system");
      sendJson(res, 200, { ok: true, ...backupSummary(store, listBackups) });
      return;
    }
    // Superadmin beheert het backup-bewaarbeleid PER TENANT.
    const backupPolicyMatch = url.pathname.match(/^\/api\/admin\/backups\/([^/]+)\/policy$/);
    if (backupPolicyMatch && (req.method === "GET" || req.method === "PUT")) {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "system");
      const tenant = store.data.tenants.find(t => t.id === backupPolicyMatch[1]);
      if (!tenant) return sendJson(res, 404, { ok: false, error: "Tenant niet gevonden" });
      if (req.method === "GET") {
        sendJson(res, 200, { ok: true, ...getBackupPolicy(store, tenant) });
      } else {
        const body = await readBody(req).catch(() => ({}));
        sendJson(res, 200, { ok: true, ...setBackupPolicy(store, tenant, body, user) });
      }
      return;
    }
    const adminBackupMatch = url.pathname.match(/^\/api\/admin\/backups\/([^/]+)(?:\/([^/]+)\/restore)?$/);
    if (adminBackupMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      const tenant = store.data.tenants.find(t => t.id === adminBackupMatch[1]);
      if (!tenant) return sendJson(res, 404, { ok: false, error: "Tenant niet gevonden" });
      if (adminBackupMatch[2]) {
        // Herstel = destructief → enkel de hoofd-superadmin (god).
        assertPlatformGod(user);
        const body = await readBody(req).catch(() => ({}));
        sendJson(res, 200, { ok: true, result: restoreBackup(store, tenant, adminBackupMatch[2], user, body.confirm === true) });
      } else {
        assertPlatformScope(user, "system");
        sendJson(res, 201, { ok: true, backup: createBackup(store, tenant, user) });
      }
      return;
    }

    // ── Super-admin: support-toegang overzicht (GDPR) ─────────────────────────
    // Per tenant de toestemming + actieve impersonatie-sessie.
    if (url.pathname === "/api/admin/support" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "support");
      const now = Date.now();
      const rows = store.data.tenants.map(t => {
        const sa = t.supportAccess || {};
        const sess = t.supportSession || null;
        const active = !!(sess && !sess.endedAt && new Date(sess.expiresAt).getTime() > now && new Date(sess.hardExpiresAt).getTime() > now);
        return {
          tenantId: t.id, tenantName: t.name,
          allowed: sa.allowed === true,
          consentBy: sa.allowedBy || null, consentAt: sa.allowedAt || null,
          session: active ? { agent: sess.agent, scope: sess.scope, startedAt: sess.startedAt, expiresAt: sess.expiresAt, hardExpiresAt: sess.hardExpiresAt, impersonatedUserId: sess.impersonatedUserId } : null,
        };
      });
      sendJson(res, 200, { ok: true, rows });
      return;
    }

    // ── Super-admin: start GDPR support-sessie (impersonatie) ─────────────────
    if (url.pathname === "/api/admin/support/start" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "support");
      const body = await readBody(req);
      const tenant = store.data.tenants.find(t => t.id === body.tenantId);
      if (!tenant) return sendJson(res, 404, { ok: false, error: "Tenant niet gevonden" });
      if (tenant.supportAccess?.allowed !== true) {
        return sendJson(res, 403, { ok: false, error: "Klant heeft geen support-toegang toegestaan (GDPR-consent vereist)" });
      }
      if (!body.reason || !String(body.reason).trim()) {
        return sendJson(res, 400, { ok: false, error: "Reden is verplicht (wordt geaudit)" });
      }
      const tenantUsers = store.data.users.filter(u => u.tenantId === tenant.id && u.active !== false);
      const target = body.impersonatedUserId
        ? tenantUsers.find(u => u.id === body.impersonatedUserId)
        : (tenantUsers.find(u => u.role === "tenant_admin") || tenantUsers[0]);
      if (!target) return sendJson(res, 404, { ok: false, error: "Geen geschikte gebruiker om over te nemen" });
      const grant = buildSupportGrant({ impersonatedUserId: target.id, agent: user.email, scope: body.scope, reason: String(body.reason).trim() });
      store.updateTenant(tenant.id, { supportSession: grant });
      const supportToken = issueSupportToken(grant, tenant.id);
      store.audit({ actor: user.email, tenantId: tenant.id, action: "support_session_started", area: "support", detail: `scope=${grant.scope} als=${target.email} reden=${grant.reason}` });
      sendJson(res, 200, { ok: true, supportToken, session: {
        grantId: grant.grantId, scope: grant.scope, agent: grant.agent,
        impersonatedUserId: target.id, impersonatedUserEmail: target.email,
        startedAt: grant.startedAt, expiresAt: grant.expiresAt, hardExpiresAt: grant.hardExpiresAt
      } });
      return;
    }

    // ── Super-admin: beëindig support-sessie ──────────────────────────────────
    if (url.pathname === "/api/admin/support/end" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "support");
      const body = await readBody(req);
      const tenant = store.data.tenants.find(t => t.id === body.tenantId);
      if (!tenant) return sendJson(res, 404, { ok: false, error: "Tenant niet gevonden" });
      const sess = tenant.supportSession;
      if (sess && !sess.endedAt) {
        store.updateTenant(tenant.id, { supportSession: { ...sess, endedAt: new Date().toISOString(), endedBy: user.email, endedReason: "ended_by_agent" } });
        store.audit({ actor: user.email, tenantId: tenant.id, action: "support_session_ended", area: "support", detail: sess.grantId });
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    // ── Super-admin: suspend/activate tenant ──────────────────────────────────
    const adminTenantActionMatch = url.pathname.match(/^\/api\/admin\/tenants\/([^/]+)\/(suspend|activate)$/);
    if (adminTenantActionMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertPlatformScope(user, "tenants");
      const [, tid, action] = adminTenantActionMatch;
      const tenant = store.data.tenants.find(t => t.id === tid);
      if (!tenant) return sendJson(res, 404, { ok: false, error: "Tenant niet gevonden" });
      const newStatus = action === "suspend" ? "suspended" : "active";
      const next = store.updateTenant(tid, { status: newStatus });
      store.audit({ actor: user.email, tenantId: tid, action: `tenant_${action}d`, area: "tenants", detail: tid });
      sendJson(res, 200, { ok: true, tenant: next });
      return;
    }

    if (url.pathname === "/api/kbo/lookup" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertCan(user, "tenants");
      const body = await readBody(req);
      sendJson(res, 200, { ok: true, company: await lookupKboResolve(body.vat) });
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Integraties, Usage & Billing · Super Admin (platform) API (INT-01..09)
    // Elke route loopt vóór de service-call door intAuthz (integrations-authz.js):
    // super_admin + de juiste platformscope. Reseller/tenant krijgen deze rechten
    // NOOIT (D01/D10 · Mona AI-monitoring is uitsluitend hier zichtbaar).
    // Financiele mutaties ondersteunen Idempotency-Key (armPlatformIdempotency).
    // ═══════════════════════════════════════════════════════════════════════

    // ── Super Admin IA (sectie 3.1 + B24): navigatie-registratie die de views
    //    voedt · Platformintegraties, Usage & Billing en Integratiebeheer ─────
    if (url.pathname === "/api/admin/usage/ia" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      if (!intAuthz.isSuperAdmin(user)) throw intAuthz.forbiddenError("PLATFORM_SCOPE_REQUIRED");
      sendJson(res, 200, {
        ok: true,
        ia: {
          platformIntegrations: {
            label: "Platformintegraties",
            items: [
              { key: "connectors", label: "Connectorcatalogus", endpoint: "/api/admin/integrations/connectors" },
              { key: "events", label: "Foutlogboek & audit", endpoint: "/api/admin/integrations/events" },
            ],
          },
          usageBilling: {
            label: "Usage & Billing",
            items: [
              { key: "overview", label: "Overzicht", endpoint: "/api/admin/usage/overview" },
              { key: "peppol", label: "Peppol-verbruik", endpoint: "/api/admin/usage/peppol" },
              { key: "mona", label: "Mona AI-verbruik", endpoint: "/api/admin/usage/mona" },
              { key: "pricing", label: "Tarieven & providerkosten", endpoint: "/api/admin/usage/pricing" },
              { key: "limits", label: "Tenantlimieten", endpoint: "/api/admin/ai/tenants" },
              { key: "periods", label: "Facturatieperiodes", endpoint: "/api/admin/usage/periods" },
              { key: "alerts", label: "Waarschuwingen", endpoint: "/api/admin/ai/alerts" },
            ],
          },
          integrationManagement: {
            label: "Integratiebeheer",
            items: [
              { key: "tenant-integrations", label: "Tenantkoppelingen", endpoint: "/api/admin/tenant-integrations" },
              { key: "provider-config", label: "Providerconfiguratie", endpoint: "/api/admin/integrations" },
            ],
          },
        },
      });
      return;
    }

    // ── INT-01 · Connectorcatalogus (manifests) ─────────────────────────────
    if (url.pathname === "/api/admin/integrations/connectors" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.peppol.provider.manage");
      sendJson(res, 200, {
        ok: true,
        connectors: connectorSvc.listConnectors(store, {
          category: url.searchParams.get("category") || null,
          entitlement: url.searchParams.get("entitlement") || null,
        }),
      });
      return;
    }
    if (url.pathname === "/api/admin/integrations/connectors" && req.method === "PUT") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.peppol.provider.manage");
      if (armPlatformIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      sendJson(res, 200, { ok: true, connector: connectorSvc.registerConnector(store, body, user) });
      return;
    }
    // ── INT-01/A16 · Globale connectorhealth, foutlogboek en audit ──────────
    if (url.pathname === "/api/admin/integrations/events" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.peppol.provider.manage");
      sendJson(res, 200, {
        ok: true,
        events: connectorSvc.listEvents(store, url.searchParams.get("tenantId") || null, {
          connector: url.searchParams.get("connector") || null,
          action: url.searchParams.get("action") || null,
          result: url.searchParams.get("result") || null,
          limit: Number(url.searchParams.get("limit")) || 100,
        }),
      });
      return;
    }

    // ── INT-02/03 · Usage & Billing-overzicht (KPI-kaarten · B25) ───────────
    if (url.pathname === "/api/admin/usage/overview" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.peppol.usage.view");
      const period = url.searchParams.get("period") || new Date().toISOString().slice(0, 7);
      const filters = {
        period,
        tenantId: url.searchParams.get("tenantId") || null,
        companyId: url.searchParams.get("companyId") || null,
        provider: url.searchParams.get("provider") || null,
      };
      const peppol = peppolUsage.peppolUsageOverview(store, filters);
      const kpis = {
        peppolVolume: peppol.volume, peppolRevenue: peppol.revenue,
        providerCost: peppol.providerCost, margin: peppol.margin,
      };
      // AI-providerkost en Mona-verbruik zijn AI-INZAGE (MONA-AI-04/05): enkel voor
      // een houder van platform.ai.usage.view. Een op peppol.usage.view gescopte
      // inzage krijgt de AI-blokken NIET · de scheiding Peppol vs AI zit hier in de
      // route zelf, niet enkel in de gedeelde 'billing'-scope. Faalt zacht bij lege
      // periode.
      if (intAuthz.canPlatform(user, "platform.ai.usage.view")) {
        try {
          const rows = monaAi.adminTenantUsage(store, { period });
          kpis.monaUsage = round2(rows.reduce((s, r) => s + (Number(r.balance.consumed) || 0), 0));
          kpis.aiCost = round2((store.data.aiProviderUsage || [])
            .filter(p => p && p.period === period)
            .reduce((s, p) => s + (Number(p.providerCost) || 0), 0));
          kpis.tenantsAbove80 = monaAi.tenantsAtOrAbove(store, period, monaAi.WARN_THRESHOLD_PCT).length;
          kpis.tenantsAbove95 = monaAi.tenantsAtOrAbove(store, period, monaAi.DEFAULT_ALERT_THRESHOLD_PCT).length;
        } catch (_) { /* geen AI-data voor deze periode */ }
      }
      sendJson(res, 200, { ok: true, period, kpis, peppol });
      return;
    }
    // ── INT-04/06 · Peppol-verbruik (doorklik naar individuele events · B25) ─
    if (url.pathname === "/api/admin/usage/peppol" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.peppol.usage.view");
      const filters = {
        period: url.searchParams.get("period") || null,
        tenantId: url.searchParams.get("tenantId") || null,
        companyId: url.searchParams.get("companyId") || null,
        provider: url.searchParams.get("provider") || null,
        usageType: url.searchParams.get("usageType") || null,
      };
      sendJson(res, 200, { ok: true, ...peppolUsage.peppolUsageOverview(store, filters) });
      return;
    }
    // ── INT-06 · Tarieven (klantprijs) en providerkosten instellen ──────────
    if (url.pathname === "/api/admin/usage/pricing" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.peppol.pricing.manage");
      sendJson(res, 200, { ok: true, priceRules: peppolUsage.listPriceRules(store), costRules: peppolUsage.listCostRules(store) });
      return;
    }
    if (url.pathname === "/api/admin/usage/pricing" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.peppol.pricing.manage");
      if (armPlatformIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      // Vier-ogen op tarieven (sectie 7): een prijswijziging wordt VOORGESTELD (maker)
      // en is nog niet actief · een tweede Super Admin keurt goed via .../approve.
      sendJson(res, 200, { ok: true, priceRule: peppolUsage.proposePriceRule(store, body, user) });
      return;
    }
    // Vier-ogencontrole: een voorgestelde prijswijziging goedkeuren (checker != maker).
    const usagePriceApproveMatch = url.pathname.match(/^\/api\/admin\/usage\/pricing\/([^/]+)\/approve$/);
    if (usagePriceApproveMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.peppol.pricing.manage");
      if (armPlatformIdempotency(req, res, url, user)) return;
      const [, ruleId] = usagePriceApproveMatch;
      const rule = store.get("usagePriceRules", ruleId);
      if (!rule || rule.kind !== "price") return sendJson(res, 404, { ok: false, error: "PRICE_RULE_NOT_FOUND" });
      // Maker-checker: de goedkeurder mag niet de indiener van de prijswijziging zijn.
      intAuthz.assertFourEyes("platform.peppol.pricing.manage", user.id, rule.proposedById);
      sendJson(res, 200, { ok: true, priceRule: peppolUsage.approvePriceRule(store, { ruleId }, user) });
      return;
    }
    if (url.pathname === "/api/admin/usage/cost" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.peppol.pricing.manage");
      if (armPlatformIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      sendJson(res, 200, { ok: true, costRule: peppolUsage.setCostRule(store, body, user) });
      return;
    }
    // ── INT-06 · Facturatieperiodes (state machine · B22/B26) ───────────────
    if (url.pathname === "/api/admin/usage/periods" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.peppol.usage.view");
      sendJson(res, 200, { ok: true, periods: peppolUsage.listPeriods(store, { tenantId: url.searchParams.get("tenantId") || null }) });
      return;
    }
    if (url.pathname === "/api/admin/usage/periods" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.peppol.pricing.manage");
      if (armPlatformIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      sendJson(res, 200, { ok: true, period: peppolUsage.openPeriod(store, { tenantId: body.tenantId, period: body.period }, user) });
      return;
    }
    const usagePeriodActionMatch = url.pathname.match(/^\/api\/admin\/usage\/periods\/([^/]+)\/(calculate|transition|approve)$/);
    if (usagePeriodActionMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.peppol.pricing.manage");
      if (armPlatformIdempotency(req, res, url, user)) return;
      const [, periodId, act] = usagePeriodActionMatch;
      const body = await readBody(req);
      let result;
      if (act === "calculate") result = peppolUsage.calculatePeriod(store, { periodId }, user);
      else if (act === "approve") result = { period: peppolUsage.approvePeriod(store, { periodId }, user) };
      else result = { period: peppolUsage.transitionPeriod(store, { periodId, to: body.to }, user) };
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    // ── INT-07/08/09 · Mona AI-verbruik (UITSLUITEND Super Admin · D01/D10) ──
    if (url.pathname === "/api/admin/usage/mona" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.ai.usage.view");
      const period = url.searchParams.get("period") || new Date().toISOString().slice(0, 7);
      const tenantId = url.searchParams.get("tenant") || url.searchParams.get("tenantId") || null;
      const payload = { ok: true, period, tenants: monaAi.adminTenantUsage(store, { period }) };
      try { payload.platformBudget = monaAi.platformBudgetStatus(store, { period }); } catch (_) {}
      if (tenantId) payload.balance = monaAi.creditBalance(store, tenantId, period);
      sendJson(res, 200, payload);
      return;
    }
    if (url.pathname === "/api/admin/ai/tenants" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.ai.usage.view");
      const period = url.searchParams.get("period") || new Date().toISOString().slice(0, 7);
      sendJson(res, 200, { ok: true, period, tenants: monaAi.adminTenantUsage(store, { period }) });
      return;
    }
    if (url.pathname === "/api/admin/ai/limits" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.ai.tenant_limit.manage");
      const body = await readBody(req);
      const { tenantId, ...patch } = body;
      sendJson(res, 200, { ok: true, limits: monaAi.setTenantLimits(store, tenantId, patch, user) });
      return;
    }
    if (url.pathname === "/api/admin/ai/credits" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.ai.credits.manage");
      if (armPlatformIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      sendJson(res, 200, { ok: true, allocation: monaAi.grantAllocation(store, body, user) });
      return;
    }
    if (url.pathname === "/api/admin/ai/adjustments" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.ai.credits.manage");
      if (armPlatformIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      sendJson(res, 200, { ok: true, adjustment: monaAi.addAdjustment(store, body, user) });
      return;
    }
    if (url.pathname === "/api/admin/ai/budget" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.ai.global_limit.manage");
      const body = await readBody(req);
      sendJson(res, 200, { ok: true, budget: monaAi.setPlatformBudget(store, body, user) });
      return;
    }
    if (url.pathname === "/api/admin/ai/budget" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.ai.usage.view");
      const period = url.searchParams.get("period") || new Date().toISOString().slice(0, 7);
      sendJson(res, 200, { ok: true, ...monaAi.platformBudgetStatus(store, { period }) });
      return;
    }
    // ── INT-09 · 95%-waarschuwingen: bereken, persisteer, verstuur, bevestig ─
    if (url.pathname === "/api/admin/ai/alerts" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.ai.alerts.manage");
      const period = url.searchParams.get("period") || new Date().toISOString().slice(0, 7);
      const alerts = (store.data.usageAlerts || []).filter(a => a && (!period || a.period === period));
      sendJson(res, 200, { ok: true, period, alerts });
      return;
    }
    if (url.pathname === "/api/admin/ai/alerts/run" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.ai.alerts.manage");
      if (armPlatformIdempotency(req, res, url, user)) return;
      const body = await readBody(req);
      const period = body.period || new Date().toISOString().slice(0, 7);
      const result = monaAi.raiseAlerts(store, { period, baseUrl: config.appUrl || "" }, user);
      // Verstuur de e-mailtaken via de bestaande mailer (best-effort · in-app blijft
      // altijd staan). Uitputtingswaarschuwingen mogen de request niet blokkeren.
      for (const mail of result.emails || []) {
        for (const to of mail.recipients || []) {
          Promise.resolve(sendMail({ to, subject: mail.subject, text: JSON.stringify({ period: mail.period, percentage: mail.percentage, used: mail.used, limit: mail.limit }), html: `<p>${mail.subject}</p>` })).catch(() => {});
        }
      }
      sendJson(res, 200, { ok: true, created: result.created.length, reminders: result.reminders.length, emails: (result.emails || []).length });
      return;
    }
    const aiAlertAckMatch = url.pathname.match(/^\/api\/admin\/ai\/alerts\/([^/]+)\/ack$/);
    if (aiAlertAckMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      intAuthz.assertCanPlatform(user, "platform.ai.alerts.manage");
      sendJson(res, 200, { ok: true, alert: monaAi.acknowledgeAlert(store, aiAlertAckMatch[1], user) });
      return;
    }

    const tenantMatch = url.pathname.match(/^\/api\/tenants\/([^/]+)\/(.+)$/);
    if (tenantMatch) {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertAdminMfa(user);
      const tenantId = tenantMatch[1];
      errorTenantId = tenantId;
      const action = tenantMatch[2];
      assertTenant(user, tenantId);
      const tenant = store.data.tenants.find(t => t.id === tenantId);
      if (!tenant) return sendJson(res, 404, { ok: false, error: "Tenant not found" });
      assertApiKeyWriteAllowed(user, req);
      // Entitlement-handhaving: gated modules die niet in het pakket zitten → 403.
      assertModuleEnabled(store, user, tenant, action);
      // Alleen-lezen-handhaving: read:X-gebruikers kunnen niets muteren.
      assertNotReadOnly(user, action, req.method);
      // Trial-to-paid-handhaving: verlopen proef (na respijt) blokkeert muteren.
      assertTrialActive(user, tenant, action, req.method);

      // ── Idempotency-Key (h41): herhaalde mutatie met dezelfde sleutel
      //    creëert geen duplicaat maar krijgt de eerdere response terug ──
      if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
        const idemKey = idempotency.idempotencyKeyFrom(req);
        if (idemKey) {
          const cacheKey = idempotency.cacheKeyFor({ tenantId, actorId: user.id, method: req.method, path: url.pathname, key: idemKey });
          const replay = idempotency.findReplay(store, cacheKey);
          if (replay) {
            // Een via /v1 vastgelegde response is al v1-getransformeerd; de
            // hook moet uit, anders zouden centen dubbel geconverteerd worden.
            res.wfpV1 = null;
            sendJson(res, replay.status, JSON.parse(replay.body), { "Idempotency-Replayed": "true" });
            return;
          }
          // Arm de response: sendJson legt een 2xx-resultaat vast onder deze sleutel.
          res.wfpIdem = { store, cacheKey };
        }
      }

      // ── Mona AI-assistent (route-naam boden blijft voor compatibiliteit) (beschikbaar voor elke ingelogde tenant-gebruiker;
      //    de tools binnen Mona bewaken zelf de data-rechten) ──
      if (action === "boden" && req.method === "POST") {
        assertInteractiveUser(user);
        // ── Mona AI hard-block-poort (INT-08 · spec 9.1) ──────────────────────
        // Vóór ELKE AI-actie: mag deze tenant Mona nog gebruiken? Een hard limit
        // of aiDisabled blokkeert UITSLUITEND Mona, nooit de rest van de app. De
        // tenant krijgt enkel de functionele boodschap · NOOIT een cijfer, saldo,
        // krediet of limiet (result.message; reason blijft Super Admin-logging).
        const aiModel = ((loadPlatformConfig(store).openai) || {}).model || null;
        const gate = monaAi.checkAllowed(store, { tenantId, feature: "boden", model: aiModel, userId: user.id });
        if (!gate.allowed) {
          const code = ["ai_disabled", "feature_not_allowed", "model_not_allowed"].includes(gate.reason)
            ? "AI_UNAVAILABLE" : "AI_LIMIT_REACHED";
          return sendJson(res, 403, { ok: false, code, error: gate.message });
        }
        const body = await readBody(req);
        try {
          const result = await bodenChat(store, tenant, user, body.messages || []);
          // ── Mona AI-metering (INT-07) NA een geslaagde providercall ─────────
          // Boek het echte verbruik (credits/95%-alerts weerspiegelen zo live
          // gebruik). Idempotent op requestId. Mock-modus verbruikt geen
          // provider-units en levert geen _metering · dan meten we niet. Metering
          // mag het AI-antwoord nooit breken.
          const metering = result._metering;
          if (metering) {
            try {
              monaAi.meterRequest(store, {
                tenantId, feature: "boden", model: metering.model,
                providerUnits: metering.providerUnits, requestId: metering.requestId, userId: user.id,
              }, user);
            } catch (_) { /* metering nooit fataal voor de assistent */ }
          }
          // _metering blijft server-intern · nooit naar de tenant (geen units/kost).
          const { _metering, ...clientResult } = result;
          sendJson(res, 200, { ok: true, ...clientResult });
        } catch (e) {
          sendJson(res, e.status || 500, { ok: false, error: e.message });
        }
        return;
      }

      // ── Robaws-import (E20/h47.1): switcher-migratie · integraties-recht ──
      if (action === "import/robaws/validate" && req.method === "POST") {
        assertCan(user, "integrations");
        assertInteractiveUser(user);
        const body = await readBody(req);
        sendJson(res, 200, { ok: true, validation: robawsImport.validateImport(store, tenant, body.data || body) });
        return;
      }
      if (action === "import/robaws/run" && req.method === "POST") {
        assertCan(user, "integrations");
        assertInteractiveUser(user);
        const body = await readBody(req);
        const data = body.data || body;
        // Verplichte validatie vooraf: geen import als er blokkerende fouten zijn.
        const validation = robawsImport.validateImport(store, tenant, data);
        if (!validation.ok && !body.force) {
          return sendJson(res, 422, { ok: false, error: "Import bevat blokkerende fouten · corrigeer of gebruik force", code: "IMPORT_INVALID", validation });
        }
        const result = robawsImport.runImport(store, tenant, data, user.email);
        store.audit({ actor: user.email, tenantId, action: "robaws_import", area: "integrations", detail: `created ${result.report.totals.created} · skipped ${result.report.totals.skipped} · errors ${result.report.totals.errors}` });
        emitDomainEvent(store, { tenantId, eventType: "import.completed", aggregateType: "import", aggregateId: `imp_${Date.now()}`, actor: user.email, correlationId: res.wfpRequestId, data: { source: "robaws", ...result.report.totals } });
        sendJson(res, 201, { ok: true, ...result });
        return;
      }

      // ══════════════════════════════════════════════════════════════════════
      // Integraties & Datahub · tenant API (INT-01/05/10). Elke route loopt vóór
      // de service door intAuthz.assertCanTenant (capability + tenantscoping).
      // Mona AI-usage/credits/kosten/limieten zijn hier NOOIT bereikbaar
      // (D01/D10): geen enkele tenant-route geeft AI-verbruik terug ·
      // assertMonaAiTenantHidden is de laatste verdedigingslijn. De Peppol-views
      // strippen providerkost en marge (C11).
      // ══════════════════════════════════════════════════════════════════════

      // ── Tenant IA "Integraties & Datahub" (sectie 3.1): overzicht dat de view
      //    voedt · connectorstatus + Peppol-activaties + payrollperiodes ──────
      if (action === "integrations/hub" && req.method === "GET") {
        intAuthz.assertCanTenant(user, "integrations.view", { tenantId });
        intAuthz.assertMonaAiTenantHidden(user);
        sendJson(res, 200, {
          ok: true,
          connections: connectorSvc.listConnections(store, tenant, {}),
          peppol: peppolUsage.tenantPeppolStatus(store, tenantId),
          payrollPeriods: store.list("payrollPeriods", tenantId).map(payrollEngine.periodView),
        });
        return;
      }

      // ── INT-01 · Connectorframework (tenant · eigen verbindingen) ──────────
      if (action === "integrations/catalog" && req.method === "GET") {
        intAuthz.assertCanTenant(user, "integrations.view", { tenantId });
        sendJson(res, 200, { ok: true, connectors: connectorSvc.listConnectors(store, {}) });
        return;
      }
      if (action === "integrations/connections" && req.method === "GET") {
        intAuthz.assertCanTenant(user, "integrations.view", { tenantId });
        sendJson(res, 200, {
          ok: true,
          connections: connectorSvc.listConnections(store, tenant, {
            companyId: url.searchParams.get("companyId") || null,
            status: url.searchParams.get("status") || null,
          }),
        });
        return;
      }
      if (action === "integrations/connections" && req.method === "POST") {
        intAuthz.assertCanTenant(user, "integrations.connect", { tenantId });
        const body = await readBody(req);
        sendJson(res, 201, { ok: true, connection: connectorSvc.createConnection(store, tenant, body, user) });
        return;
      }

      // ── INT-05 · Peppol per juridische onderneming (owner-mode) ────────────
      if (action === "peppol/status" && req.method === "GET") {
        intAuthz.assertCanTenant(user, "peppol.settings.manage", { tenantId });
        sendJson(res, 200, { ok: true, activations: peppolUsage.tenantPeppolStatus(store, tenantId, url.searchParams.get("companyId") || null) });
        return;
      }
      if (action === "peppol/activate" && req.method === "POST") {
        intAuthz.assertCanTenant(user, "peppol.settings.manage", { tenantId });
        const body = await readBody(req);
        // Route-tenantId wint (geen cross-tenant activatie via body).
        sendJson(res, 200, { ok: true, activation: peppolUsage.activatePeppol(store, { ...body, tenantId }, user) });
        return;
      }
      // Eigen aangerekend verbruik (C11): eigen volume + prijs · NOOIT providerkost/marge.
      if (action === "peppol/usage" && req.method === "GET") {
        intAuthz.assertCanTenant(user, "peppol.settings.manage", { tenantId });
        intAuthz.assertMonaAiTenantHidden(user);
        const filters = {
          companyId: url.searchParams.get("companyId") || null,
          period: url.searchParams.get("period") || null,
          usageType: url.searchParams.get("usageType") || null,
        };
        sendJson(res, 200, {
          ok: true,
          charged: peppolUsage.tenantChargedVolume(store, tenantId, filters),
          events: peppolUsage.listTenantPeppolUsage(store, tenantId, filters),
        });
        return;
      }

      // ── INT-10 · Payroll Exchange Engine (tenant cockpit) ──────────────────
      if (action === "payroll/providers" && req.method === "GET") {
        intAuthz.assertCanTenant(user, "payroll.view", { tenantId });
        sendJson(res, 200, { ok: true, providers: payrollEngine.GO_LIVE_PROVIDERS.map(p => payrollEngine.providerCard(p)) });
        return;
      }
      if (action === "payroll/periods" && req.method === "GET") {
        intAuthz.assertCanTenant(user, "payroll.view", { tenantId });
        const companyId = url.searchParams.get("companyId") || null;
        sendJson(res, 200, {
          ok: true,
          periods: store.list("payrollPeriods", tenantId).filter(p => !companyId || p.companyId === companyId).map(payrollEngine.periodView),
        });
        return;
      }
      if (action === "payroll/periods" && req.method === "POST") {
        intAuthz.assertCanTenant(user, "payroll.prepare", { tenantId });
        const body = await readBody(req);
        sendJson(res, 201, { ok: true, period: payrollEngine.openPeriod(store, tenant, body, user) });
        return;
      }
      // Detail van één periode (regels + exportversies + resultaten) · cockpit-view.
      const payrollPeriodDetail = action.match(/^payroll\/periods\/([^/]+)$/);
      if (payrollPeriodDetail && req.method === "GET") {
        intAuthz.assertCanTenant(user, "payroll.view", { tenantId });
        const periodId = payrollPeriodDetail[1];
        const period = store.list("payrollPeriods", tenantId).find(p => p.id === periodId);
        if (!period) return sendJson(res, 404, { ok: false, error: "Payrollperiode niet gevonden" });
        sendJson(res, 200, {
          ok: true,
          period: payrollEngine.periodView(period),
          entries: store.list("payrollEntries", tenantId).filter(e => e.periodId === periodId),
          exports: store.list("payrollExports", tenantId).filter(x => x.periodId === periodId),
          importResults: store.list("payrollImportResults", tenantId).filter(r => r.periodId === periodId),
        });
        return;
      }
      // Aanleverregel toevoegen (performance/absence/variable/mutation) · alleen in
      // een wijzigbare status (engine bewaakt dat). Recht: payroll.prepare.
      const payrollEntryMatch = action.match(/^payroll\/periods\/([^/]+)\/entries$/);
      if (payrollEntryMatch && req.method === "POST") {
        intAuthz.assertCanTenant(user, "payroll.prepare", { tenantId });
        const body = await readBody(req);
        sendJson(res, 201, { ok: true, entry: payrollEngine.addEntry(store, tenant, payrollEntryMatch[1], body, user) });
        return;
      }
      // Employee-mapping (Monargo-medewerker → provider employee ID · versie/geldigheid).
      if (action === "payroll/employee-mappings" && req.method === "GET") {
        intAuthz.assertCanTenant(user, "payroll.view", { tenantId });
        sendJson(res, 200, { ok: true, mappings: store.list("payrollEmployeeMappings", tenantId) });
        return;
      }
      if (action === "payroll/employee-mappings" && req.method === "POST") {
        intAuthz.assertCanTenant(user, "payroll.employee_mapping", { tenantId });
        const body = await readBody(req);
        sendJson(res, 201, { ok: true, mapping: payrollEngine.setEmployeeMapping(store, tenant, body, user) });
        return;
      }
      // Codemapping (prestatie-/afwezigheids-/variabele code → providercode).
      if (action === "payroll/code-mappings" && req.method === "GET") {
        intAuthz.assertCanTenant(user, "payroll.view", { tenantId });
        sendJson(res, 200, { ok: true, mappings: store.list("payrollCodeMappings", tenantId) });
        return;
      }
      if (action === "payroll/code-mappings" && req.method === "POST") {
        intAuthz.assertCanTenant(user, "payroll.code_mapping", { tenantId });
        const body = await readBody(req);
        sendJson(res, 201, { ok: true, mapping: payrollEngine.setCodeMapping(store, tenant, body, user) });
        return;
      }
      // Periode-goedkeuring (review → approved). Recht: payroll.period.approve ·
      // de vier-ogen-SoD (indiener ≠ goedkeurder) wordt door de engine afgedwongen.
      const payrollApproveMatch = action.match(/^payroll\/periods\/([^/]+)\/approve$/);
      if (payrollApproveMatch && req.method === "POST") {
        intAuthz.assertCanTenant(user, "payroll.period.approve", { tenantId });
        sendJson(res, 200, { ok: true, period: payrollEngine.approvePeriod(store, tenant, { periodId: payrollApproveMatch[1] }, user) });
        return;
      }
      // Generieke periode-transitie · elke doelstatus achter het bijhorende recht.
      const payrollTransitionMatch = action.match(/^payroll\/periods\/([^/]+)\/transition$/);
      if (payrollTransitionMatch && req.method === "POST") {
        const body = await readBody(req);
        const to = String(body.to || "");
        const PAYROLL_TRANSITION_PERM = {
          voorbereiding: "payroll.prepare", review: "payroll.period.review",
          approved: "payroll.period.approve", ready: "payroll.export",
          delivered: "payroll.submit", processed: "payroll.submit",
          correction: "payroll.correct", closed: "payroll.submit",
        };
        const perm = PAYROLL_TRANSITION_PERM[to];
        if (!perm) return sendJson(res, 400, { ok: false, error: `Onbekende doelstatus '${to}'`, code: "PAYROLL_TARGET_INVALID" });
        intAuthz.assertCanTenant(user, perm, { tenantId });
        sendJson(res, 200, { ok: true, period: payrollEngine.transitionPeriod(store, tenant, { periodId: payrollTransitionMatch[1], to }, user) });
        return;
      }
      // Exportversie bouwen (canoniek pakket + checksum, previousVersion-keten).
      const payrollExportMatch = action.match(/^payroll\/periods\/([^/]+)\/export$/);
      if (payrollExportMatch && req.method === "POST") {
        intAuthz.assertCanTenant(user, "payroll.export", { tenantId });
        const body = await readBody(req).catch(() => ({}));
        sendJson(res, 201, { ok: true, export: payrollEngine.buildAndStoreExport(store, tenant, payrollExportMatch[1], { employer: body.employer || null }, user) });
        return;
      }
      // Provideraanlevering registreren (import-resultaat · processed/rejected/...).
      const payrollImportMatch = action.match(/^payroll\/periods\/([^/]+)\/import-result$/);
      if (payrollImportMatch && req.method === "POST") {
        intAuthz.assertCanTenant(user, "payroll.submit", { tenantId });
        const body = await readBody(req);
        sendJson(res, 201, { ok: true, result: payrollEngine.recordImportResult(store, tenant, payrollImportMatch[1], body, user) });
        return;
      }
      // Correctietraject openen op een aangeleverde/verwerkte/afgesloten periode.
      const payrollCorrectMatch = action.match(/^payroll\/periods\/([^/]+)\/correct$/);
      if (payrollCorrectMatch && req.method === "POST") {
        intAuthz.assertCanTenant(user, "payroll.correct", { tenantId });
        const body = await readBody(req);
        sendJson(res, 200, { ok: true, correction: payrollEngine.correctPeriod(store, tenant, payrollCorrectMatch[1], body, user) });
        return;
      }

      // ── Mona Signals (h48/E21): proactieve detectie · rechten-gescoped ──
      if ((action === "mona/signals" || action === "boden/signals") && req.method === "GET") {
        assertInteractiveUser(user);
        sendJson(res, 200, { ok: true, ...buildMonaSignals(store, tenant, user) });
        return;
      }

      // ── Mona Prepare (h48): proactief VOORBEREID werk · gratis, deterministisch,
      //    rechten-gescoped. "Voorbereid voor jou" bij het openen van de app.
      //    Uitvoeren van een stap blijft achter bevestiging (+ ai_actions-add-on).
      if (action === "mona/prepared" && req.method === "GET") {
        assertInteractiveUser(user);
        sendJson(res, 200, { ok: true, ...buildPreparedWork(store, tenant, user) });
        return;
      }
      // Dagelijkse digest: samenvatting van het voorbereide werk. GET geeft
      // enkel de samenvatting; POST maakt (idempotent per dag) de melding aan.
      if (action === "mona/digest" && (req.method === "GET" || req.method === "POST")) {
        assertInteractiveUser(user);
        const digest = buildDailyDigest(store, tenant, user);
        let notified = false;
        if (req.method === "POST" && digest.actionable > 0) {
          const sourceRef = `mona:digest:${new Date().toISOString().slice(0, 10)}`;
          const already = (store.data.notifications || []).some(n => n.tenantId === tenantId && n.sourceRef === sourceRef);
          if (!already) {
            createNotification(store, tenant, {
              type: "mona", audience: "admins", title: `${digest.actionable} ding(en) voorbereid`,
              body: `Mona heeft ${digest.actionable} ding(en) voor je klaargezet: ${digest.titles.join(" · ")}. Open "Voorbereid voor jou" om ze te bevestigen.`,
              priority: "normal", sourceRef,
            }, user);
            notified = true;
          }
        }
        sendJson(res, 200, { ok: true, digest, notified });
        return;
      }

      // Op verzoek een volledig project voorbereiden (dossier + kickoff-afspraak).
      if (action === "mona/prepare-project" && req.method === "POST") {
        assertInteractiveUser(user);
        const body = await readBody(req);
        try {
          const plan = prepareProject(store, tenant, user, {
            customerId: body.customerId || null, customerName: body.customerName || "",
            projectName: body.projectName || "", type: body.type || "", startDate: body.startDate || null,
          });
          store.audit({ actor: user.email, tenantId, action: "mona_project_prepared", area: "mona", detail: plan.title });
          sendJson(res, 200, { ok: true, plan });
        } catch (e) {
          sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code });
        }
        return;
      }

      // ── Work Inbox (E09/GRID): geconsolideerde werklijst · rechten-gescoped ──
      if (action === "work-inbox" && req.method === "GET") {
        assertInteractiveUser(user);
        sendJson(res, 200, { ok: true, ...buildWorkInbox(store, tenant, user) });
        return;
      }

      // ── Insights (E22/BI): rol-dashboard met herleidbare KPI's ────────────────
      if (action === "insights" && req.method === "GET") {
        assertInteractiveUser(user);
        // Read-model met korte TTL-cache PER GEBRUIKER (rol + signalen zijn
        // persoonlijk, dus nooit tenant-breed cachen). Spec 5.3 staat
        // eventual consistency op read-models expliciet toe; 10 seconden is
        // voor een dashboard onzichtbaar en haalde de P95 onder concurrentie
        // van >1s naar vrijwel nul (loadtest 2026-07-21).
        const cacheKey = `${tenantId}:${user.id}`;
        const cached = insightsCache.get(cacheKey);
        if (cached && Date.now() - cached.at < 10_000) {
          sendJson(res, 200, cached.payload);
          return;
        }
        const payload = { ok: true, ...buildInsights(store, tenant, user) };
        insightsCache.set(cacheKey, { at: Date.now(), payload });
        if (insightsCache.size > 500) {
          for (const [k, v] of insightsCache) { if (Date.now() - v.at > 10_000) insightsCache.delete(k); }
        }
        sendJson(res, 200, payload);
        return;
      }

      // ── Automation engine (E11/h13): flows + runs ────────────────────────────
      if (action === "automation/flows" && req.method === "GET") {
        assertCan(user, "settings");
        sendJson(res, 200, { ok: true, flows: automationRepo.list(tenantId, { status: url.searchParams.get("status") || undefined, trigger: url.searchParams.get("trigger") || undefined }) });
        return;
      }
      if (action === "automation/flows" && req.method === "POST") {
        assertCan(user, "settings");
        assertApiKeyWriteAllowed(user, req);
        let row;
        try { row = automationRepo.insert(tenantId, await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "automation_flow_created", area: "automation", detail: `${row.name} · ${row.trigger}` });
        sendJson(res, 201, { ok: true, flow: row });
        return;
      }
      if (action === "automation/runs" && req.method === "GET") {
        assertCan(user, "settings");
        sendJson(res, 200, { ok: true, runs: automationRepo.listRuns(tenantId, { flowId: url.searchParams.get("flowId") || undefined, limit: url.searchParams.get("limit") }) });
        return;
      }
      const flowItemMatch = action.match(/^automation\/flows\/([^/]+)$/);
      if (flowItemMatch && req.method === "PATCH") {
        assertCan(user, "settings");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = automationRepo.update(tenantId, flowItemMatch[1], body, user.email, body.expectedVersion); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion }); }
        store.audit({ actor: user.email, tenantId, action: "automation_flow_updated", area: "automation", detail: flowItemMatch[1] });
        sendJson(res, 200, { ok: true, flow: row });
        return;
      }
      const flowTransitionMatch = action.match(/^automation\/flows\/([^/]+)\/transition$/);
      if (flowTransitionMatch && req.method === "POST") {
        assertCan(user, "settings");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = automationRepo.transition(tenantId, flowTransitionMatch[1], body.status, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "automation_flow_transition", area: "automation", detail: `${flowTransitionMatch[1]} → ${body.status}` });
        sendJson(res, 200, { ok: true, flow: row });
        return;
      }
      // Simuleren met testdata zonder productiedata te wijzigen (h13-acceptatie).
      const flowSimulateMatch = action.match(/^automation\/flows\/([^/]+)\/simulate$/);
      if (flowSimulateMatch && req.method === "POST") {
        assertCan(user, "settings");
        const body = await readBody(req);
        const flow = automationRepo.findById(tenantId, flowSimulateMatch[1]);
        if (!flow) return sendJson(res, 404, { ok: false, error: "Flow niet gevonden" });
        const sampleEvent = { eventType: flow.trigger, tenantId, aggregateType: body.aggregateType || "customer", aggregateId: body.aggregateId || "sample", data: body.data || {} };
        const run = executeFlow(store, tenant, flow, sampleEvent, { dryRun: true });
        sendJson(res, 200, { ok: true, run });
        return;
      }
      if (flowItemMatch && req.method === "DELETE") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        try { automationRepo.remove(tenantId, flowItemMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "automation_flow_deleted", area: "automation", detail: flowItemMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Configuratieplatform (E10/h12): custom fields ─────────────────────────
      if (action === "config/fields" && req.method === "GET") {
        assertCan(user, "settings");
        sendJson(res, 200, { ok: true, fields: configRepo.list(tenantId, { entity: url.searchParams.get("entity") || undefined, status: url.searchParams.get("status") || undefined }) });
        return;
      }
      if (action === "config/fields" && req.method === "POST") {
        assertCan(user, "settings");
        assertApiKeyWriteAllowed(user, req);
        let row;
        try { row = configRepo.insert(tenantId, await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "custom_field_created", area: "config", detail: `${row.entity}.${row.key}` });
        sendJson(res, 201, { ok: true, field: row });
        return;
      }
      if (action === "config/fields/validate" && req.method === "POST") {
        assertCan(user, "settings");
        const body = await readBody(req);
        sendJson(res, 200, { ok: true, result: configRepo.validateValues(tenantId, body.entity, body.values) });
        return;
      }
      const cfgFieldMatch = action.match(/^config\/fields\/([^/]+)$/);
      if (cfgFieldMatch && cfgFieldMatch[1] !== "validate" && req.method === "PATCH") {
        assertCan(user, "settings");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = configRepo.update(tenantId, cfgFieldMatch[1], body, user.email, body.expectedVersion); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion }); }
        store.audit({ actor: user.email, tenantId, action: "custom_field_updated", area: "config", detail: cfgFieldMatch[1] });
        sendJson(res, 200, { ok: true, field: row });
        return;
      }
      const cfgTransitionMatch = action.match(/^config\/fields\/([^/]+)\/transition$/);
      if (cfgTransitionMatch && req.method === "POST") {
        assertCan(user, "settings");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = configRepo.transition(tenantId, cfgTransitionMatch[1], body.status, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "custom_field_transition", area: "config", detail: `${cfgTransitionMatch[1]} → ${body.status}` });
        sendJson(res, 200, { ok: true, field: row });
        return;
      }
      if (cfgFieldMatch && cfgFieldMatch[1] !== "validate" && req.method === "DELETE") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        try { configRepo.remove(tenantId, cfgFieldMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "custom_field_deleted", area: "config", detail: cfgFieldMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── SAML SSO-configuratie (add-on; gated door assertModuleEnabled hierboven) ──
      if (action === "sso/config" && req.method === "GET") {
        assertCan(user, "settings");
        sendJson(res, 200, { ok: true, sso: saml.publicSsoConfig(tenant) });
        return;
      }
      if (action === "sso/config" && (req.method === "PUT" || req.method === "POST")) {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        const body = await readBody(req);
        const next = saml.sanitizeSsoInput(body, tenant.sso || {});
        // Inschakelen mag enkel met een werkbare configuratie (anti-lockout).
        if (next.enabled && (!next.entryPoint || !next.idpCert)) {
          return sendJson(res, 400, { ok: false, error: "IdP-login-URL en certificaat zijn verplicht om SSO in te schakelen." });
        }
        const updated = store.update("tenants", tenant.id, { sso: next });
        store.audit({ actor: user.email, tenantId, action: "sso_config_updated", area: "settings", detail: next.enabled ? "ingeschakeld" : "uitgeschakeld" });
        sendJson(res, 200, { ok: true, sso: saml.publicSsoConfig(updated) });
        return;
      }

      if (action === "golden-path" && req.method === "GET") {
        sendJson(res, 200, { ok: true, readiness: readiness(store, tenantId) });
        return;
      }

      // ── Onboarding-wizard (sector, teamgrootte, facturatie/contact) ──────────
      if (action === "onboarding" && req.method === "GET") {
        assertCan(user, "settings");
        sendJson(res, 200, { ok: true,
          sectors: publicSectors(), teamSizes: TEAM_SIZES,
          tenant: {
            name: tenant.name, sector: tenant.sector || "", teamSize: tenant.teamSize || "",
            contact: tenant.contact || {}, invoiceProfile: tenant.invoiceProfile || {},
            onboarding: tenant.onboarding || { completed: false }
          }
        });
        return;
      }
      if (action === "onboarding" && req.method === "POST") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        const body = await readBody(req);
        const patch = {};
        if (body.sector !== undefined) patch.sector = isValidSector(body.sector) ? body.sector : tenant.sector || "andere";
        if (body.teamSize !== undefined) patch.teamSize = TEAM_SIZES.includes(body.teamSize) ? body.teamSize : (tenant.teamSize || "");
        if (body.contact && typeof body.contact === "object") {
          patch.contact = {
            phone: String(body.contact.phone || "").trim(),
            contactName: String(body.contact.contactName || "").trim(),
            contactRole: String(body.contact.contactRole || "").trim(),
          };
        }
        // Facturatie/adres aanvullen of corrigeren (bovenop wat KBO al invulde).
        if (body.invoiceProfile && typeof body.invoiceProfile === "object") {
          const ip = tenant.invoiceProfile || {};
          const inn = body.invoiceProfile;
          patch.invoiceProfile = {
            ...ip,
            vat: String(inn.vat ?? ip.vat ?? "").trim(),
            companyNumber: String(inn.companyNumber ?? ip.companyNumber ?? "").trim(),
            name: String(inn.name ?? ip.name ?? tenant.name ?? "").trim(),
            street: String(inn.street ?? ip.street ?? "").trim(),
            zip: String(inn.zip ?? ip.zip ?? "").trim(),
            city: String(inn.city ?? ip.city ?? "").trim(),
          };
        }
        if (body.billingEmail) patch.billingEmail = String(body.billingEmail).trim();
        patch.onboarding = { ...(tenant.onboarding || {}), completed: body.completed === false ? false : true, completedAt: new Date().toISOString(), completedBy: user.email };
        const next = store.updateTenant(tenant.id, patch);
        store.audit({ actor: user.email, tenantId: tenant.id, action: "onboarding_completed", area: "tenants", detail: `${patch.sector || tenant.sector || "?"} · ${patch.teamSize || tenant.teamSize || "?"}` });
        sendJson(res, 200, { ok: true, tenant: { sector: next.sector, teamSize: next.teamSize, contact: next.contact, invoiceProfile: next.invoiceProfile, onboarding: next.onboarding } });
        return;
      }
      if (action === "suggestions/home" && req.method === "GET") {
        sendJson(res, 200, { ok: true, suggestion: homeSuggestion(store, tenant, user) });
        return;
      }
      if (action === "suggestions/home/events" && req.method === "POST") {
        sendJson(res, 200, { ok: true, event: recordSuggestionEvent(store, tenant, user, await readBody(req)) });
        return;
      }
      if (action === "admin/status" && req.method === "GET") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        sendJson(res, 200, { ok: true, status: tenantStatus(store, tenantId) });
        return;
      }
      const unlockUserMatch = action.match(/^admin\/users\/([^/]+)\/unlock$/);
      if (unlockUserMatch && req.method === "POST") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        sendJson(res, 200, { ok: true, user: unlockUser(store, tenant, unlockUserMatch[1], user), status: tenantStatus(store, tenantId) });
        return;
      }
      if (action === "portal" && req.method === "GET") {
        sendJson(res, 200, { ok: true, portal: portalPayload(store, tenant, tenantStatus(store, tenantId), billingSummary(tenant)) });
        return;
      }
      if (action === "customer-start" && req.method === "GET") {
        const status = tenantStatus(store, tenantId);
        const billing = billingSummary(tenant);
        const portal = portalPayload(store, tenant, status, billing);
        sendJson(res, 200, { ok: true, start: customerStartPayload(store, tenant, portal, billing) });
        return;
      }
      if (action === "customer-start/bootstrap" && req.method === "GET") {
        assertCan(user, "planning");
        const date = url.searchParams.get("date") || undefined;
        const targetWorkorders = Number(url.searchParams.get("targetWorkorders") || 1);
        sendJson(res, 200, { ok: true, bootstrap: previewCustomerStart(store, tenantId, { date, targetWorkorders }) });
        return;
      }
      if (action === "customer-start/bootstrap" && req.method === "POST") {
        assertCan(user, "planning");
        assertCan(user, "workorders");
        assertInteractiveUser(user);
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const result = applyCustomerStart(store, tenantId, {
          date: body.date,
          targetWorkorders: body.targetWorkorders,
          actor: user
        });
        sendJson(res, 201, { ok: result.after?.readyBefore || false, bootstrap: result });
        return;
      }
      const onboardingStepMatch = action.match(/^portal\/onboarding\/([^/]+)$/);
      if (onboardingStepMatch && req.method === "PATCH") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        const updatedTenant = updateOnboardingStep(store, tenant, onboardingStepMatch[1], await readBody(req), user);
        sendJson(res, 200, { ok: true, portal: portalPayload(store, updatedTenant, tenantStatus(store, tenantId), billingSummary(updatedTenant)) });
        return;
      }
      if (action === "sales/summary" && req.method === "GET") {
        assertCan(user, "tenants");
        sendJson(res, 200, { ok: true, summary: salesSummary(store, tenant.id) });
        return;
      }
      if (action === "sales/readiness" && req.method === "GET") {
        assertCan(user, "tenants");
        sendJson(res, 200, { ok: true, readiness: salesLaunchReadiness(store, tenant.id) });
        return;
      }
      if (action === "go-live" && req.method === "GET") {
        assertCan(user, "tenants");
        sendJson(res, 200, { ok: true, readiness: goLiveReadiness(store, tenant, { strictProduction: url.searchParams.get("strictProduction") === "true" }) });
        return;
      }
      if (action === "roadmap" && req.method === "GET") {
        assertCan(user, "tenants");
        sendJson(res, 200, { ok: true, roadmap: roadmapStatus(store, tenant) });
        return;
      }
      // GET /search?q= · globale zoek over klanten, werkbonnen, facturen, medewerkers
      if (action === "search" && req.method === "GET") {
        const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
        if (q.length < 2) { sendJson(res, 200, { ok: true, results: [] }); return; }
        const match = (...vals) => vals.some(v => String(v || "").toLowerCase().includes(q));
        const results = [];
        if (can(user, "customers")) {
          for (const c of store.list("customers", tenantId)) {
            if (match(c.name, c.contactName, c.email, c.vatNumber)) {
              results.push({ type: "Klant", view: "customers", id: c.id, label: c.name || "Klant", sub: c.email || c.vatNumber || "" });
            }
          }
        }
        if (can(user, "workorders")) {
          for (const w of store.list("workorders", tenantId)) {
            if (match(w.number, w.title, w.clientName, w.userName)) {
              results.push({ type: "Werkbon", view: "workorders", id: w.id, label: `${w.number ? w.number + " · " : ""}${w.title || "Werkbon"}`, sub: w.clientName || w.status || "" });
            }
          }
        }
        if (can(user, "billing")) {
          for (const inv of store.list("invoices", tenantId)) {
            if (match(inv.number, inv.customerName, inv.customerVatNumber)) {
              results.push({ type: "Factuur", view: "facturen", id: inv.id, label: `${inv.number || "Factuur"} · ${inv.customerName || ""}`, sub: `€ ${Number(inv.total || 0).toFixed(2)} · ${inv.status || ""}` });
            }
          }
        }
        if (can(user, "employees")) {
          for (const u of store.list("users", tenantId)) {
            if (u.role === "super_admin") continue;
            if (match(u.name, u.email, u.function)) {
              results.push({ type: "Medewerker", view: "employees", id: u.id, label: u.name || u.email, sub: u.function || u.role || "" });
            }
          }
        }
        sendJson(res, 200, { ok: true, results: results.slice(0, 25) });
        return;
      }
      if (action === "reports" && req.method === "GET") {
        assertCan(user, "tenants");
        sendJson(res, 200, { ok: true, ...listReports(tenant.id, { limit: url.searchParams.get("limit") }) });
        return;
      }
      // POST /reports/log · registreert rapportgeneratie voor pilot-KPI tracking
      if (action === "reports/log" && req.method === "POST") {
        assertCan(user, "leaves"); // accessible to tenant admin + manager
        const body = await readBody(req);
        store.audit({ actor: user.email, tenantId, action: "report_generated", area: "reports", detail: body.type || "beslissersrapport" });
        sendJson(res, 200, { ok: true });
        return;
      }
      if (action === "reports/generate" && req.method === "POST") {
        assertCan(user, "tenants");
        assertInteractiveUser(user);
        const body = await readBody(req);
        sendJson(res, 201, {
          ok: true,
          bundle: generateStatusBundle(store, tenant, user, {
            minPilotScore: body.minPilotScore,
            strictProduction: !!body.strictProduction
          })
        });
        return;
      }
      const reportMatch = action.match(/^reports\/(.+)$/);
      if (reportMatch && req.method === "GET") {
        assertCan(user, "tenants");
        sendJson(res, 200, { ok: true, report: getReport(tenant.id, reportMatch[1]) });
        return;
      }
      const salesAdvanceMatch = action.match(/^sales\/([^/]+)\/advance$/);
      if (salesAdvanceMatch && req.method === "POST") {
        assertCan(user, "tenants");
        assertInteractiveUser(user);
        sendJson(res, 200, {
          ok: true,
          row: advanceLead(store, tenant, salesAdvanceMatch[1], user),
          summary: salesSummary(store, tenant.id),
          readiness: salesLaunchReadiness(store, tenant.id)
        });
        return;
      }
      const partnerNoteMatch = action.match(/^partners\/([^/]+)\/notes$/);
      if (partnerNoteMatch && req.method === "POST") {
        assertCan(user, "tenants");
        assertInteractiveUser(user);
        sendJson(res, 201, {
          ok: true,
          row: addPartnerNote(store, tenant, partnerNoteMatch[1], await readBody(req), user),
          summary: salesSummary(store, tenant.id),
          readiness: salesLaunchReadiness(store, tenant.id)
        });
        return;
      }
      if (action === "pilot/kpis" && req.method === "GET") {
        sendJson(res, 200, { ok: true, pilot: pilotKpis(store, tenant.id) });
        return;
      }
      if (action === "pilot/decision-report" && req.method === "POST") {
        assertCan(user, "planning");
        assertInteractiveUser(user);
        sendJson(res, 201, { ok: true, report: decisionReport(store, tenant, user) });
        return;
      }
      if (action === "admin/backups" && req.method === "GET") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        sendJson(res, 200, { ok: true, rows: listBackups(tenant.id) });
        return;
      }
      if (action === "admin/backup-policy" && req.method === "GET") {
        // Alleen-lezen voor de tenant-beheerder; configuratie gebeurt door de
        // superadmin via /api/admin/backups/:tenantId/policy.
        assertCan(user, "settings");
        assertInteractiveUser(user);
        sendJson(res, 200, { ok: true, ...getBackupPolicy(store, tenant) });
        return;
      }
      if (action === "admin/backups" && req.method === "POST") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        sendJson(res, 201, { ok: true, backup: createBackup(store, tenant, user) });
        return;
      }
      const backupActionMatch = action.match(/^admin\/backups\/([^/]+)\/(preview|restore)$/);
      if (backupActionMatch) {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        const backupId = backupActionMatch[1];
        const backupAction = backupActionMatch[2];
        if (backupAction === "preview" && req.method === "GET") {
          sendJson(res, 200, { ok: true, preview: backupPreview(store, tenant, backupId) });
          return;
        }
        if (backupAction === "restore" && req.method === "POST") {
          sendJson(res, 200, { ok: true, result: restoreBackup(store, tenant, backupId, user, (await readBody(req)).confirm) });
          return;
        }
      }
      // ── Webhooks & delivery-runtime (E19/h41) ────────────────────────────────
      if (action === "webhooks" && req.method === "GET") {
        assertCan(user, "integrations");
        sendJson(res, 200, { ok: true, endpoints: webhookRepo.list(tenantId), health: buildDeliveryHealth(store, tenantId) });
        return;
      }
      if (action === "webhooks" && req.method === "POST") {
        assertCan(user, "integrations");
        assertInteractiveUser(user);
        let row;
        try { row = webhookRepo.insert(tenantId, await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "webhook_endpoint_created", area: "integrations", detail: row.url });
        // Het signing secret wordt EENMALIG getoond · daarna alleen nog een hint.
        sendJson(res, 201, { ok: true, endpoint: row, secret: row.secret, secretNotice: "Bewaar dit signing secret nu · het wordt niet opnieuw getoond." });
        return;
      }
      const webhookItemMatch = action.match(/^webhooks\/([^/]+)$/);
      if (webhookItemMatch && req.method === "PATCH") {
        assertCan(user, "integrations");
        assertInteractiveUser(user);
        let row;
        try { row = webhookRepo.update(tenantId, webhookItemMatch[1], await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "webhook_endpoint_updated", area: "integrations", detail: row.url });
        sendJson(res, 200, { ok: true, endpoint: { ...row, secret: undefined } });
        return;
      }
      if (webhookItemMatch && req.method === "DELETE") {
        assertCan(user, "integrations");
        assertInteractiveUser(user);
        try { webhookRepo.remove(tenantId, webhookItemMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "webhook_endpoint_deleted", area: "integrations", detail: webhookItemMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }
      const webhookRotateMatch = action.match(/^webhooks\/([^/]+)\/rotate-secret$/);
      if (webhookRotateMatch && req.method === "POST") {
        assertCan(user, "integrations");
        assertInteractiveUser(user);
        let row;
        try { row = webhookRepo.rotateSecret(tenantId, webhookRotateMatch[1], user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "webhook_secret_rotated", area: "integrations", detail: row.url });
        sendJson(res, 200, { ok: true, secret: row.secret, secretNotice: "Nieuw signing secret · werk je ontvanger bij." });
        return;
      }
      // Bezorgronde handmatig aanstoten (naast de achtergrondlus).
      if (action === "webhooks/deliver" && req.method === "POST") {
        assertCan(user, "integrations");
        assertInteractiveUser(user);
        const report = await deliverPending(store, { transport: webhookTransport, tenantId, limit: 50 });
        sendJson(res, 200, { ok: true, ...report });
        return;
      }
      // Deliveryrecords per event × endpoint (P0-04): traceerbaar per abonnee.
      if (action === "webhooks/deliveries" && req.method === "GET") {
        assertCan(user, "integrations");
        sendJson(res, 200, { ok: true, deliveries: listDeliveries(store, tenantId, {
          endpointId: url.searchParams.get("endpointId") || undefined,
          eventId: url.searchParams.get("eventId") || undefined,
          status: url.searchParams.get("status") || undefined,
          limit: url.searchParams.get("limit") || undefined,
        }) });
        return;
      }
      // Eén delivery opnieuw proberen · bezorgde endpoints blijven met rust.
      const deliveryRequeueMatch = action.match(/^webhooks\/deliveries\/([^/]+)\/requeue$/);
      if (deliveryRequeueMatch && req.method === "POST") {
        assertCan(user, "integrations");
        assertInteractiveUser(user);
        let d;
        try { d = requeueDelivery(store, tenantId, deliveryRequeueMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "webhook_delivery_requeued", area: "integrations", detail: d.id });
        sendJson(res, 200, { ok: true, delivery: d });
        return;
      }
      // Mislukt of dead-letter event opnieuw in de wachtrij (h41).
      const webhookRequeueMatch = action.match(/^webhooks\/events\/([^/]+)\/requeue$/);
      if (webhookRequeueMatch && req.method === "POST") {
        assertCan(user, "integrations");
        assertInteractiveUser(user);
        let ev;
        try { ev = requeueEvent(store, tenantId, webhookRequeueMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "webhook_event_requeued", area: "integrations", detail: ev.id });
        sendJson(res, 200, { ok: true, event: { id: ev.id, eventType: ev.eventType, delivery: ev.delivery } });
        return;
      }

      if (action === "api-keys" && req.method === "GET") {
        assertCan(user, "integrations");
        assertInteractiveUser(user);
        sendJson(res, 200, { ok: true, rows: listApiKeys(store, tenant.id) });
        return;
      }
      if (action === "api-keys/governance" && req.method === "GET") {
        assertCan(user, "integrations");
        assertInteractiveUser(user);
        sendJson(res, 200, { ok: true, governance: apiKeyGovernance(store, { tenantId: tenant.id, strict: url.searchParams.get("strict") === "true" }) });
        return;
      }
      if (action === "api-keys/governance/run" && req.method === "POST") {
        assertCan(user, "integrations");
        assertInteractiveUser(user);
        const governance = apiKeyGovernance(store, { tenantId: tenant.id, strict: true });
        store.audit({
          actor: user.email,
          tenantId: tenant.id,
          action: "api_key_governance_checked",
          area: "api_keys",
          detail: `${governance.blockers} blockers, ${governance.warnings} warnings`
        });
        sendJson(res, 201, { ok: true, governance });
        return;
      }
      if (action === "api-keys" && req.method === "POST") {
        assertCan(user, "integrations");
        assertInteractiveUser(user);
        sendJson(res, 201, { ok: true, result: createApiKey(store, tenant, await readBody(req), user) });
        return;
      }
      const apiKeyRevokeMatch = action.match(/^api-keys\/([^/]+)\/revoke$/);
      if (apiKeyRevokeMatch && req.method === "POST") {
        assertCan(user, "integrations");
        assertInteractiveUser(user);
        sendJson(res, 200, { ok: true, row: revokeApiKey(store, tenant, apiKeyRevokeMatch[1], user) });
        return;
      }
      const apiKeyRotateMatch = action.match(/^api-keys\/([^/]+)\/rotate$/);
      if (apiKeyRotateMatch && req.method === "POST") {
        assertCan(user, "integrations");
        assertInteractiveUser(user);
        sendJson(res, 201, { ok: true, result: rotateApiKey(store, tenant, apiKeyRotateMatch[1], await readBody(req), user) });
        return;
      }
      if (action === "management-report" && req.method === "GET") {
        assertCan(user, "planning");
        sendJson(res, 200, { ok: true, report: managementReport(store, tenantId) });
        return;
      }
      if (action === "imports/employees" && req.method === "POST") {
        assertCan(user, "employees");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 201, { ok: true, result: importEmployees(store, tenant, await readBody(req), user, provisionPendingUser) });
        return;
      }
      // POST /admin/backfill · data quality fixes (nummers, notificaties, etc.)
      // MFA verplichten voor alle beheerders van deze tenant (self-service).
      // Retourneert per beheerder de secret/otpauth + recovery codes.
      if (action === "admin/mfa/enforce" && req.method === "POST") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        const admins = store.list("users", tenantId).filter(u =>
          u.role === "tenant_admin" && u.active !== false && !(u.mfaEnabled && u.mfaEnforced)
        );
        const enrolled = admins.map(u => enforceMfa(store, u));
        store.audit({ actor: user.email, tenantId, action: "mfa_enforced_all", area: "settings", detail: `${enrolled.length} beheerders` });
        sendJson(res, 200, { ok: true, enrolled, count: enrolled.length });
        return;
      }

      if (action === "admin/backfill" && req.method === "POST") {
        assertCan(user, "settings");
        const results = {};
        // 1. Werkbon nummers
        const wos = store.list("workorders", tenantId).filter(w => !w.number);
        const byYear = {};
        wos.sort((a, b) => (a.createdAt||"").localeCompare(b.createdAt||"")).forEach(w => {
          const yr = (w.createdAt||new Date().toISOString()).slice(0, 4);
          if (!byYear[yr]) byYear[yr] = store.list("workorders", tenantId).filter(x => (x.number||"").startsWith(`WO-${yr}-`)).length;
          byYear[yr]++;
          store.update("workorders", w.id, { number: `WO-${yr}-${String(byYear[yr]).padStart(3,"0")}` });
        });
        results.workorderNumbers = wos.length;
        // 2. Notificaties zonder userId (zoek de leaf userId via sourceRef)
        const notifs = store.list("notifications", tenantId).filter(n => !n.userId && n.sourceRef && n.sourceRef.startsWith("leave:"));
        let fixedNotifs = 0;
        notifs.forEach(n => {
          const leaveId = n.sourceRef.split(":")[1];
          const leave = store.get("leaves", leaveId);
          if (leave?.userId) { store.update("notifications", n.id, { userId: leave.userId }); fixedNotifs++; }
        });
        results.notificationUserIds = fixedNotifs;
        // 3. Verloven zonder days
        const leavesNoDays = store.list("leaves", tenantId).filter(l => !l.days && l.startDate && l.endDate);
        leavesNoDays.forEach(l => {
          const days = workingDaysBetween(l.startDate, l.endDate); // excl. weekend + BE feestdagen
          if (days > 0) store.update("leaves", l.id, { days });
        });
        results.leaveDays = leavesNoDays.length;
        store.audit({ actor: user.email, tenantId, action: "data_backfill", area: "admin", detail: JSON.stringify(results) });
        sendJson(res, 200, { ok: true, results });
        return;
      }
      // POST /admin/backfill-wo-numbers · vult lege werkbon-nummers in
      if (action === "admin/backfill-wo-numbers" && req.method === "POST") {
        assertCan(user, "settings");
        const wos = store.list("workorders", tenantId).filter(w => !w.number);
        const byYear = {};
        wos.sort((a, b) => (a.createdAt||"").localeCompare(b.createdAt||"")).forEach(w => {
          const yr = (w.createdAt||new Date().toISOString()).slice(0, 4);
          if (!byYear[yr]) {
            // Count existing numbered WOs for this year
            byYear[yr] = store.list("workorders", tenantId).filter(x => (x.number||"").startsWith(`WO-${yr}-`)).length;
          }
          byYear[yr]++;
          store.update("workorders", w.id, { number: `WO-${yr}-${String(byYear[yr]).padStart(3,"0")}` });
        });
        store.audit({ actor: user.email, tenantId, action: "wo_numbers_backfilled", area: "workorders", detail: `${wos.length} werkbonnen genummerd` });
        sendJson(res, 200, { ok: true, updated: wos.length });
        return;
      }
      // Rijke demodata laden/verwijderen (alle schermen gevuld). Ook in productie
      // toegestaan: tenant-scoped voorbeelddata, gemarkeerd en weer verwijderbaar.
      if (action === "demo/seed" && req.method === "POST") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        const result = seedDemoData(store, tenant, user);
        sendJson(res, 200, { ok: true, ...result });
        return;
      }
      if (action === "demo/clear" && req.method === "POST") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        const removed = clearDemoData(store, tenantId);
        store.audit({ actor: user.email, tenantId, action: "demo_cleared", area: "demo", detail: String(removed) });
        sendJson(res, 200, { ok: true, removed });
        return;
      }
      if (action === "golden-path/demo" && req.method === "POST") {
        if (config.isProduction) return sendJson(res, 403, { ok: false, error: "Demo data is uitgeschakeld in productie" });
        assertCan(user, "settings");
        assertInteractiveUser(user);
        sendJson(res, 201, { ok: true, result: createDemoGoldenPath(store, tenant, user) });
        return;
      }
      if (action === "kbo/lookup" && req.method === "POST") {
        assertCan(user, "customers");
        const body = await readBody(req);
        sendJson(res, 200, { ok: true, company: await lookupKboResolve(body.vat || body.name) });
        return;
      }
      if (action === "kbo/apply" && req.method === "POST") {
        assertCan(user, "tenants");
        assertInteractiveUser(user);
        const body = await readBody(req);
        sendJson(res, 200, { ok: true, tenant: applyKbo(store, tenant, body.vat, user) });
        return;
      }
      // GDPR-consent: de klant (tenant-admin) staat support-toegang toe of trekt ze in.
      // Toestemming intrekken beëindigt meteen een lopende support-sessie.
      if (action === "support-access" && req.method === "POST") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        const body = await readBody(req);
        const now = new Date();
        const allowed = body.allowed !== false && body.enabled !== false;
        const autoRenew = body.autoRenew !== false; // standaard aan: blijft jaarlijks staan
        const reviewDueAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
        const supportAccess = {
          allowed,
          reason: body.reason || "Support-toegang toegestaan door klant",
          allowedBy: user.email,
          allowedAt: now.toISOString(),
          autoRenew,
          // Jaarlijkse mededeling-datum (alleen relevant zolang toegestaan).
          reviewDueAt: allowed ? reviewDueAt : null
        };
        const patch = { supportAccess };
        if (!allowed && tenant.supportSession && !tenant.supportSession.endedAt) {
          patch.supportSession = { ...tenant.supportSession, endedAt: now.toISOString(), endedBy: user.email, endedReason: "consent_withdrawn" };
        }
        const next = store.updateTenant(tenant.id, patch);
        store.audit({ actor: user.email, tenantId: tenant.id, action: allowed ? "support_access_allowed" : "support_access_denied", area: "support", detail: supportAccess.reason });
        sendJson(res, 200, { ok: true, tenant: next });
        return;
      }
      if (action === "support-access/end" && req.method === "POST") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        const previous = tenant.supportAccess || {};
        const now = new Date();
        const patch = { supportAccess: { ...previous, allowed: false, endedBy: user.email, endedAt: now.toISOString() } };
        if (tenant.supportSession && !tenant.supportSession.endedAt) {
          patch.supportSession = { ...tenant.supportSession, endedAt: now.toISOString(), endedBy: user.email, endedReason: "consent_withdrawn" };
        }
        const next = store.updateTenant(tenant.id, patch);
        store.audit({ actor: user.email, tenantId: tenant.id, action: "support_access_denied", area: "support", detail: previous.reason || "" });
        sendJson(res, 200, { ok: true, tenant: next });
        return;
      }
      if (action === "billing/setup-intent" && req.method === "POST") {
        assertCan(user, "billing");
        sendJson(res, 200, { ok: true, setupIntent: createSetupIntent(tenant) });
        return;
      }
      if (action === "billing/summary" && req.method === "GET") {
        assertCan(user, "billing");
        sendJson(res, 200, { ok: true, billing: billingSummary(tenant) });
        return;
      }
      if (action === "billing/quote" && req.method === "GET") {
        assertCan(user, "billing");
        sendJson(res, 200, { ok: true, quote: billingQuote(store, tenant) });
        return;
      }
      if (action === "billing/plans" && req.method === "GET") {
        assertCan(user, "billing");
        sendJson(res, 200, { ok: true, plans: planCatalog(store) });
        return;
      }
      if (action === "billing/select-plan" && req.method === "POST") {
        assertCan(user, "billing");
        assertInteractiveUser(user);
        const body = await readBody(req);
        sendJson(res, 200, { ok: true, billing: selectPlan(store, tenant, body.plan, user) });
        return;
      }
      // Start/betaal een abonnement via Stripe Checkout (mode=subscription).
      if (action === "billing/checkout" && req.method === "POST") {
        assertCan(user, "billing");
        assertInteractiveUser(user);
        const body = await readBody(req);
        try {
          const result = await createSubscriptionCheckout(store, tenant, body.plan, user);
          sendJson(res, 200, { ok: true, ...result });
        } catch (e) { sendJson(res, e.status || 500, { ok: false, error: e.message }); }
        return;
      }
      // Self-service abonnementsbeheer (upgrade/downgrade/opzeggen/betaalmethode).
      if (action === "billing/portal" && req.method === "POST") {
        assertCan(user, "billing");
        assertInteractiveUser(user);
        try {
          const result = await createBillingPortalSession(store, tenant, user);
          sendJson(res, 200, { ok: true, ...result });
        } catch (e) { sendJson(res, e.status || 500, { ok: false, error: e.message }); }
        return;
      }
      if (action === "billing/contract-state" && req.method === "POST") {
        assertCan(user, "billing");
        assertInteractiveUser(user);
        sendJson(res, 200, { ok: true, result: transitionContract(store, tenant, await readBody(req), user) });
        return;
      }
      if (action === "billing/payment-method" && req.method === "POST") {
        assertCan(user, "billing");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        sendJson(res, 200, { ok: true, tenant: attachPaymentMethod(store, tenant, body.paymentMethodRef, user) });
        return;
      }
      if (action === "billing/invoices" && req.method === "POST") {
        assertCan(user, "billing");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 201, { ok: true, result: createInvoice(store, tenant, await readBody(req), user) });
        return;
      }
      if (action.startsWith("billing/peppol/") && req.method === "POST") {
        assertCan(user, "billing");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 200, { ok: true, result: sendPeppol(store, tenant, action.split("/").pop(), user, await readBody(req)) });
        return;
      }
      if (action === "billing/payment-failed" && req.method === "POST") {
        assertCan(user, "billing");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 200, { ok: true, result: markPaymentFailed(store, tenant, await readBody(req), user) });
        return;
      }
      const dunningMatch = action.match(/^billing\/failed-payments\/([^/]+)\/dunning$/);
      if (dunningMatch && req.method === "POST") {
        assertCan(user, "billing");
        assertInteractiveUser(user);
        sendJson(res, 200, { ok: true, result: advanceDunning(store, tenant, dunningMatch[1], await readBody(req), user) });
        return;
      }
      if (action === "compliance/dpa" && req.method === "POST") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        sendJson(res, 200, { ok: true, tenant: acceptDpa(store, tenant, await readBody(req), user) });
        return;
      }
      // RSZ-werkgeversnummer instellen (vereist voor CIAW/Checkin@Work-aangiftes).
      if (action === "compliance/rsz" && req.method === "POST") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        const body = await readBody(req);
        const rszEmployerId = String(body.rszEmployerId || "").replace(/[^0-9]/g, "").slice(0, 12);
        const next = store.updateTenant(tenant.id, { compliance: { ...(tenant.compliance || {}), rszEmployerId } });
        store.audit({ actor: user.email, tenantId: tenant.id, action: "rsz_employer_set", area: "compliance", detail: rszEmployerId ? "set" : "cleared" });
        sendJson(res, 200, { ok: true, rszEmployerId: next.compliance.rszEmployerId });
        return;
      }
      if (action === "compliance/gdpr-requests" && req.method === "POST") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        sendJson(res, 201, { ok: true, result: createGdprRequest(store, tenant, await readBody(req), user) });
        return;
      }
      const gdprProcessMatch = action.match(/^compliance\/gdpr-requests\/([^/]+)\/process$/);
      if (gdprProcessMatch && req.method === "POST") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        sendJson(res, 200, { ok: true, result: processGdprRequest(store, tenant, gdprProcessMatch[1], user) });
        return;
      }
      if (action === "mobile/today" && req.method === "GET") {
        sendJson(res, 200, { ok: true, today: todayPayload(store, user) });
        return;
      }
      if (action === "mobile/sync" && req.method === "POST") {
        assertApiKeyWriteAllowed(user, req);
        const syncBody = await readBody(req);
        const syncItems = Array.isArray(syncBody.items) ? syncBody.items : (Array.isArray(syncBody.queue) ? syncBody.queue : []);
        // Prikklok is een universele actie (iedere medewerker mag in-/uitklokken);
        // werkbon-acties vereisen wel het workorders-recht.
        const onlyClock = syncItems.length > 0 && syncItems.every(it => it.action === "clock_in" || it.action === "clock_out");
        if (onlyClock) assertInteractiveUser(user); else assertCan(user, "workorders");
        sendJson(res, 200, { ok: true, sync: syncMobileQueue(store, tenant, syncBody, user) });
        return;
      }
      if (action === "integrations" && req.method === "GET") {
        assertCan(user, "integrations");
        sendJson(res, 200, { ok: true, rows: listIntegrations(store, tenant.id), providers: listProviders() });
        return;
      }
      if (action === "notifications" && req.method === "GET") {
        assertCan(user, "alerts");
        sendJson(res, 200, { ok: true, rows: listNotifications(store, tenant.id), summary: notificationSummary(store, tenant.id) });
        return;
      }
      if (action === "notifications" && req.method === "POST") {
        assertCan(user, "alerts");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 201, { ok: true, row: createNotification(store, tenant, await readBody(req), user) });
        return;
      }
      if (action === "notifications/reminders" && req.method === "POST") {
        assertCan(user, "alerts");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 201, { ok: true, rows: generateReminders(store, tenant, user) });
        return;
      }
      const notificationReadMatch = action.match(/^notifications\/([^/]+)\/read$/);
      if (notificationReadMatch && req.method === "POST") {
        assertCan(user, "alerts");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 200, { ok: true, row: markNotificationRead(store, tenant, notificationReadMatch[1], user) });
        return;
      }
      if (action === "integrations/connect" && req.method === "POST") {
        assertCan(user, "integrations");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 201, { ok: true, row: connectIntegration(store, tenant, await readBody(req), user) });
        return;
      }
      const integrationActionMatch = action.match(/^integrations\/([^/]+)\/(mapping|sync|retry|sync-documents)$/);
      if (integrationActionMatch && req.method === "POST") {
        assertCan(user, "integrations");
        const integrationId = integrationActionMatch[1];
        const integrationAction = integrationActionMatch[2];
        const body = await readBody(req);
        assertApiKeyWriteAllowed(user, req);
        if (integrationAction === "mapping") {
          sendJson(res, 200, { ok: true, row: updateMapping(store, tenant, integrationId, body, user) });
          return;
        }
        if (integrationAction === "sync") {
          sendJson(res, 200, { ok: true, result: runSync(store, tenant, integrationId, user) });
          return;
        }
        // Robaws werf-documentatie: push werkbonnen + documenten per werf naar het project.
        if (integrationAction === "sync-documents") {
          sendJson(res, 200, { ok: true, result: runRobawsDocSync(store, tenant, integrationId, user) });
          return;
        }
        if (integrationAction === "retry") {
          sendJson(res, 200, { ok: true, result: retrySync(store, tenant, integrationId, body.syncId || "", user) });
          return;
        }
      }
      const mobileWorkorderMatch = action.match(/^mobile\/workorders\/([^/]+)\/(complete|photo|signature)$/);
      if (mobileWorkorderMatch && req.method === "POST") {
        assertCan(user, "workorders");
        assertApiKeyWriteAllowed(user, req);
        const workorderId = mobileWorkorderMatch[1];
        const mobileAction = mobileWorkorderMatch[2];
        const body = await readBody(req);
        if (mobileAction === "complete") {
          sendJson(res, 200, { ok: true, row: completeWorkorder(store, tenant, workorderId, body, user) });
          return;
        }
        if (mobileAction === "photo") {
          sendJson(res, 200, { ok: true, result: attachWorkorderPhoto(store, tenant, workorderId, body, user) });
          return;
        }
        if (mobileAction === "signature") {
          sendJson(res, 200, { ok: true, row: signWorkorder(store, tenant, workorderId, body, user) });
          return;
        }
      }
      // ── Stock routes ──────────────────────────────────────────────────────────
      if (action === "stock" && req.method === "GET") {
        assertCan(user, "stock");
        const opts = {
          venueId: url.searchParams.get("venueId"),
          category: url.searchParams.get("category"),
          alertOnly: url.searchParams.get("alertOnly") === "true"
        };
        sendJson(res, 200, { ok: true, ...listStock(store, tenantId, opts) });
        return;
      }

      if (action === "stock/alerts" && req.method === "GET") {
        assertCan(user, "stock");
        sendJson(res, 200, { ok: true, ...stockAlerts(store, tenantId) });
        return;
      }

      if (action === "stock" && req.method === "POST") {
        assertCan(user, "stock");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 201, { ok: true, item: createStockItem(store, tenant, await readBody(req), user) });
        return;
      }

      const stockItemMatch = action.match(/^stock\/([^/]+)$/);
      if (stockItemMatch && req.method === "GET") {
        assertCan(user, "stock");
        sendJson(res, 200, { ok: true, item: getStockItem(store, tenantId, stockItemMatch[1]) });
        return;
      }

      if (stockItemMatch && req.method === "PATCH") {
        assertCan(user, "stock");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 200, { ok: true, item: updateStockItem(store, tenant, stockItemMatch[1], await readBody(req), user) });
        return;
      }

      if (stockItemMatch && req.method === "DELETE") {
        assertCan(user, "stock");
        assertInteractiveUser(user);
        const stockId = stockItemMatch[1];
        const item = store.list("stock", tenantId).find(s => s.id === stockId);
        if (!item) return sendJson(res, 404, { ok: false, error: "Artikel niet gevonden" });
        store.remove("stock", stockId);
        store.audit({ actor: user.email, tenantId, action: "stock_item_deleted", area: "stock", detail: item.name || stockId });
        sendJson(res, 200, { ok: true });
        return;
      }

      const stockMutMatch = action.match(/^stock\/([^/]+)\/mutations$/);
      if (stockMutMatch && req.method === "POST") {
        assertCan(user, "stock");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 201, { ok: true, item: addMutation(store, tenant, stockMutMatch[1], await readBody(req), user) });
        return;
      }

      const stockRelMatch = action.match(/^stock\/mutations\/([^/]+)\/release$/);
      if (stockRelMatch && req.method === "POST") {
        assertCan(user, "stock");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 200, { ok: true, item: releaseReservation(store, tenant, stockRelMatch[1], user) });
        return;
      }
      // ── Einde stock routes ────────────────────────────────────────────────────

      // ── Verlof routes ─────────────────────────────────────────────────────────
      if (action === "leaves" && req.method === "GET") {
        assertCan(user, "leaves");
        const opts = {
          // own-scope: enkel eigen verlof zichtbaar (GDPR), ongeacht de query.
          userId: ownScopeOnly(user, "leaves") ? user.id : url.searchParams.get("userId"),
          status: url.searchParams.get("status"),
          type: url.searchParams.get("type"),
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to")
        };
        const leaveResult = listLeaves(store, tenantId, opts);
        // Dossierscope (E02): own = alleen eigen, team = eigen team, anders alles.
        leaveResult.leaves = withUserNames(store, applyScope(store, user, "leaves", leaveResult.leaves));
        sendJson(res, 200, { ok: true, ...leaveResult });
        return;
      }

      if (action === "leaves/calendar" && req.method === "GET") {
        assertCan(user, "leaves");
        const year = Number(url.searchParams.get("year") || new Date().getFullYear());
        const month = Number(url.searchParams.get("month") || new Date().getMonth() + 1);
        const calResult = leaveCalendar(store, tenantId, year, month);
        calResult.leaves = withUserNames(store, calResult.leaves);
        sendJson(res, 200, { ok: true, ...calResult });
        return;
      }

      // GET /leaves/balance · verlof saldo per medewerker voor dit jaar
      if (action === "leaves/balance" && req.method === "GET") {
        assertCan(user, "leaves");
        const year = Number(url.searchParams.get("year") || new Date().getFullYear());
        const yearStr = String(year);
        const employees = store.list("users", tenantId)
          .filter(u => !["super_admin"].includes(u.role));
        const allLeaves = store.list("leaves", tenantId).filter(l =>
          l.status === "goedgekeurd" && l.type === "vakantie" &&
          (l.startDate || "").startsWith(yearStr)
        );
        const balance = employees.map(u => {
          const quota = Number(u.leaveQuota || 20);
          const usedDays = allLeaves.filter(l => l.userId === u.id)
            .reduce((s, l) => s + Number(l.days || 0), 0);
          return {
            userId: u.id,
            name: u.name || u.email,
            email: u.email,
            quota,
            used: usedDays,
            remaining: Math.max(0, quota - usedDays)
          };
        });
        sendJson(res, 200, { ok: true, year, balance });
        return;
      }

      // GET /me/leaves/balance · eigen verlof saldo
      if (action === "me/leaves/balance" && req.method === "GET") {
        const year = Number(url.searchParams.get("year") || new Date().getFullYear());
        const yearStr = String(year);
        const u = store.getUserById(user.id);
        const quota = Number(u?.leaveQuota || 20);
        const used = store.list("leaves", tenantId)
          .filter(l => l.userId === user.id && l.status === "goedgekeurd" && l.type === "vakantie" && (l.startDate||"").startsWith(yearStr))
          .reduce((s, l) => s + Number(l.days || 0), 0);
        sendJson(res, 200, { ok: true, year, quota, used, remaining: Math.max(0, quota - used) });
        return;
      }

      if (action === "leaves" && req.method === "POST") {
        assertCan(user, "leaves");
        sendJson(res, 201, { ok: true, leave: createLeave(store, tenant, await readBody(req), user) });
        return;
      }

      const leaveMatch = action.match(/^leaves\/([^/]+)$/);
      if (leaveMatch && req.method === "GET") {
        assertCan(user, "leaves");
        sendJson(res, 200, { ok: true, leave: getLeave(store, tenantId, leaveMatch[1]) });
        return;
      }

      const leaveReviewMatch = action.match(/^leaves\/([^/]+)\/review$/);
      if (leaveReviewMatch && (req.method === "POST" || req.method === "PATCH")) {
        assertCan(user, "leaves");
        const reviewBody = await readBody(req);
        const leave = reviewLeave(store, tenant, leaveReviewMatch[1], reviewBody, user);
        // E-mail + in-app notificatie naar medewerker bij goedkeuring/afwijzing
        if (["goedgekeurd", "geweigerd"].includes(leave?.status)) {
          const employee = store.getUserById(leave.userId);
          if (employee?.email) {
            const tpl = leaveReviewedToEmployee({ employee, leave, reviewer: user, appUrl: config.appUrl });
            sendMail({ to: employee.email, ...tpl });
          }
          createNotification(store, tenant, {
            type: "leave",
            channel: "in_app",
            audience: leave.userId,
            userId: leave.userId,
            title: leave.status === "goedgekeurd" ? "Verlof goedgekeurd" : "Verlof geweigerd",
            body: `Jouw verlofaanvraag (${leave.startDate || ""} – ${leave.endDate || ""}) werd ${leave.status}.`,
            priority: "normal",
            sourceRef: `leave:${leave.id}:${leave.status}`
          }, user);
        }
        sendJson(res, 200, { ok: true, leave });
        return;
      }

      if (action === "leaves/conflicts" && req.method === "GET") {
        assertCan(user, "leaves");
        const from = url.searchParams.get("from") || new Date().toISOString().slice(0, 10);
        const to = url.searchParams.get("to") || from;
        sendJson(res, 200, { ok: true, ...leaveConflicts(store, tenantId, from, to) });
        return;
      }
      // ── Einde verlof routes ───────────────────────────────────────────────────

      // ── Voertuigen routes ─────────────────────────────────────────────────────
      if (action === "vehicles" && req.method === "GET") {
        assertCan(user, "vehicles");
        const opts = {
          status: url.searchParams.get("status"),
          driverId: url.searchParams.get("driverId"),
          alertOnly: url.searchParams.get("alertOnly") === "true"
        };
        sendJson(res, 200, { ok: true, ...listVehicles(store, tenantId, opts) });
        return;
      }

      if (action === "vehicles" && req.method === "POST") {
        assertCan(user, "vehicles");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 201, { ok: true, vehicle: createVehicle(store, tenant, await readBody(req), user) });
        return;
      }

      const vehicleMatch = action.match(/^vehicles\/([^/]+)$/);
      if (vehicleMatch && req.method === "GET") {
        assertCan(user, "vehicles");
        sendJson(res, 200, { ok: true, vehicle: getVehicle(store, tenantId, vehicleMatch[1]) });
        return;
      }

      if (vehicleMatch && req.method === "PATCH") {
        assertCan(user, "vehicles");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 200, { ok: true, vehicle: updateVehicle(store, tenant, vehicleMatch[1], await readBody(req), user) });
        return;
      }

      if (vehicleMatch && req.method === "DELETE") {
        assertCan(user, "vehicles");
        assertInteractiveUser(user);
        const vehicleId = vehicleMatch[1];
        const vehicle = store.list("vehicles", tenantId).find(v => v.id === vehicleId);
        if (!vehicle) return sendJson(res, 404, { ok: false, error: "Voertuig niet gevonden" });
        store.remove("vehicles", vehicleId);
        store.audit({ actor: user.email, tenantId, action: "vehicle_deleted", area: "vehicles", detail: vehicle.name || vehicle.plate || vehicleId });
        sendJson(res, 200, { ok: true });
        return;
      }

      const vehicleMileageMatch = action.match(/^vehicles\/([^/]+)\/mileage$/);
      if (vehicleMileageMatch && req.method === "POST") {
        assertCan(user, "vehicles");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 200, { ok: true, vehicle: logMileage(store, tenant, vehicleMileageMatch[1], await readBody(req), user) });
        return;
      }

      const vehicleServiceMatch = action.match(/^vehicles\/([^/]+)\/service$/);
      if (vehicleServiceMatch && req.method === "POST") {
        assertCan(user, "vehicles");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 200, { ok: true, vehicle: scheduleService(store, tenant, vehicleServiceMatch[1], await readBody(req), user) });
        return;
      }
      // ── Einde voertuigen routes ───────────────────────────────────────────────

      // ── Employee "me" routes ──────────────────────────────────────────────────
      if (action === "me" && req.method === "GET") {
        sendJson(res, 200, { ok: true, user: getMyProfile(store, user) });
        return;
      }

      if (action === "me" && req.method === "PATCH") {
        assertHumanUser(user);
        const body = await readBody(req);
        // Alleen veilige velden bijwerken · geen rol, geen rechten, geen wachtwoord
        const allowed = ["name", "phone", "address", "iban", "language", "notificationPrefs"];
        const patch = {};
        allowed.forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
        const updated = store.update("users", user.id, { ...patch, updatedAt: new Date().toISOString() });
        const { passwordHash, mfaSecret, ...safeUser } = updated;
        sendJson(res, 200, { ok: true, user: safeUser });
        return;
      }

      if (action === "me/dashboard" && req.method === "GET") {
        sendJson(res, 200, { ok: true, ...getMyDashboard(store, tenantId, user) });
        return;
      }

      // ── Configureerbare dashboards ──────────────────────────────────────────
      // Builder-data: beschikbare widgets (rechten-gefilterd), eigen config en het
      // door de admin gepubliceerde org-dashboard.
      if (action === "me/dashboard/builder" && req.method === "GET") {
        const pub = tenant.publishedDashboard || null;
        sendJson(res, 200, { ok: true,
          available: availableWidgets(store, tenant, user),
          personal: { widgets: (user.dashboardConfig && user.dashboardConfig.widgets) || [] },
          published: pub ? { widgets: pub.widgets || [], publishedBy: pub.publishedBy || null, publishedAt: pub.publishedAt || null } : null,
          canPublish: can(user, "settings") || user.role === "tenant_admin"
        });
        return;
      }
      // Render: bereken de data voor een modus (personal of org), rechten-gefilterd.
      if (action === "me/dashboard/render" && req.method === "GET") {
        const mode = url.searchParams.get("mode") === "org" ? "org" : "personal";
        const keys = mode === "org"
          ? ((tenant.publishedDashboard && tenant.publishedDashboard.widgets) || [])
          : ((user.dashboardConfig && user.dashboardConfig.widgets) || []);
        sendJson(res, 200, { ok: true, mode, widgets: renderWidgets(store, tenant, user, keys) });
        return;
      }
      // Eigen dashboard opslaan (gesaneerd tot wat de gebruiker mag zien).
      if (action === "me/dashboard/config" && (req.method === "POST" || req.method === "PUT")) {
        assertInteractiveUser(user);
        const body = await readBody(req);
        const widgets = sanitizeWidgetKeys(store, tenant, user, body.widgets);
        store.update("users", user.id, { dashboardConfig: { widgets } });
        sendJson(res, 200, { ok: true, personal: { widgets } });
        return;
      }
      // Org-dashboard publiceren (admin) · niet aanpasbaar voor anderen.
      if (action === "me/dashboard/publish" && req.method === "POST") {
        if (!(can(user, "settings") || user.role === "tenant_admin")) return sendJson(res, 403, { ok: false, error: "Alleen een beheerder kan publiceren" });
        assertInteractiveUser(user);
        const body = await readBody(req);
        const widgets = sanitizeWidgetKeys(store, tenant, user, body.widgets);
        const published = { widgets, publishedBy: user.email, publishedAt: new Date().toISOString() };
        store.updateTenant(tenant.id, { publishedDashboard: published });
        store.audit({ actor: user.email, tenantId, action: "dashboard_published", area: "settings", detail: `${widgets.length} widgets` });
        sendJson(res, 200, { ok: true, published });
        return;
      }

      if (action === "me/planning" && req.method === "GET") {
        const opts = { from: url.searchParams.get("from"), to: url.searchParams.get("to") };
        sendJson(res, 200, { ok: true, ...getMyPlanning(store, tenantId, user.id, opts) });
        return;
      }

      if (action === "me/clock" && req.method === "GET") {
        sendJson(res, 200, { ok: true, ...getMyClock(store, tenantId, user.id), paidBreaks: tenant.clockingPrefs?.paidBreaks === true });
        return;
      }

      if (action === "me/expenses" && req.method === "GET") {
        const opts = { status: url.searchParams.get("status") };
        sendJson(res, 200, { ok: true, ...getMyExpenses(store, tenantId, user.id, opts) });
        return;
      }

      if (action === "me/leaves" && req.method === "GET") {
        sendJson(res, 200, { ok: true, ...getMyLeaves(store, tenantId, user.id) });
        return;
      }

      if (action === "me/workorders" && req.method === "GET") {
        const opts = { status: url.searchParams.get("status") };
        sendJson(res, 200, { ok: true, ...getMyWorkorders(store, tenantId, user.id, opts) });
        return;
      }

      // Medewerker werkt eigen werkbon bij (enkel status: in_progress / Voltooid)
      const meWoMatch = action.match(/^me\/workorders\/([^/]+)$/);
      if (meWoMatch && req.method === "PATCH") {
        assertHumanUser(user);
        const woId = meWoMatch[1];
        const wo = store.list("workorders", tenantId).find(w => w.id === woId);
        if (!wo) return sendJson(res, 404, { ok: false, error: "Werkbon niet gevonden" });
        if (wo.userId !== user.id) return sendJson(res, 403, { ok: false, error: "Niet toegewezen aan jou" });
        const body = await readBody(req);
        const patch = { updatedAt: new Date().toISOString() };
        // Status update
        if (body.status) {
          const allowedStatuses = ["in_progress", "Voltooid"];
          if (!allowedStatuses.includes(body.status)) {
            return sendJson(res, 400, { ok: false, error: `Status moet ${allowedStatuses.join(" of ")} zijn` });
          }
          patch.status = body.status;
          if (body.status === "in_progress") patch.startedAt = new Date().toISOString();
          if (body.status === "Voltooid") patch.completedAt = new Date().toISOString();
        }
        // Allow adding completion note and photos (base64 array)
        if (body.completionNote !== undefined) patch.completionNote = String(body.completionNote||"").slice(0, 2000);
        if (Array.isArray(body.photos)) {
          // Store max 5 photos, each max 3MB
          const validPhotos = body.photos.filter(p => typeof p === "string" && p.length < 4*1024*1024).slice(0, 5);
          patch.photos = validPhotos;
        }
        const updated = store.update("workorders", woId, patch);
        store.audit({ actor: user.email, tenantId, action: "workorder_status_updated", area: "workorders", detail: `${woId} → ${patch.status||"updated"}` });
        sendJson(res, 200, { ok: true, workorder: updated });
        return;
      }

      if (action === "me/messages" && req.method === "GET") {
        sendJson(res, 200, { ok: true, ...getMyMessages(store, tenantId, user.id) });
        return;
      }

      // GET /me/notifications · persoonlijke notificaties voor medewerker
      if (action === "me/notifications" && req.method === "GET") {
        const all = listNotifications(store, tenantId);
        const mine = all.filter(n => n.userId === user.id || n.audience === user.id);
        sendJson(res, 200, { ok: true, rows: mine, unread: mine.filter(n => n.status !== "read").length });
        return;
      }
      // POST /me/notifications/:id/read
      const meNotifReadMatch = action.match(/^me\/notifications\/([^/]+)\/read$/);
      if (meNotifReadMatch && req.method === "POST") {
        const nid = meNotifReadMatch[1];
        const n = store.get("notifications", nid);
        if (!n || n.tenantId !== tenantId || (n.userId !== user.id && n.audience !== user.id)) {
          return sendJson(res, 404, { ok: false, error: "Niet gevonden" });
        }
        const updated = store.update("notifications", nid, { status: "read", readAt: new Date().toISOString(), readBy: user.email });
        sendJson(res, 200, { ok: true, row: updated });
        return;
      }

      // PATCH /me/messages/:id/read · markeer als gelezen
      const meMessageReadMatch = action.match(/^me\/messages\/([^/]+)\/read$/);
      if (meMessageReadMatch && req.method === "PATCH") {
        const msgId = meMessageReadMatch[1];
        const msg = (store.data.messages || []).find(m => m.id === msgId && m.tenantId === tenantId);
        if (!msg) return sendJson(res, 404, { ok: false, error: "Bericht niet gevonden" });
        const readBy = Array.isArray(msg.readBy) ? msg.readBy : [];
        if (!readBy.includes(user.id)) {
          store.update("messages", msgId, { readBy: [...readBy, user.id] });
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      // Web-push: VAPID public key ophalen + (de)abonneren van dit toestel.
      if (action === "me/push/key" && req.method === "GET") {
        sendJson(res, 200, { ok: true, enabled: pushConfigured(), publicKey: pushPublicKey() });
        return;
      }
      if (action === "me/push/subscribe" && req.method === "POST") {
        if (!pushConfigured()) return sendJson(res, 503, { ok: false, error: "Push is niet geconfigureerd" });
        const body = await readBody(req);
        sendJson(res, 200, { ok: true, ...savePushSubscription(store, user, body.subscription || body) });
        return;
      }
      if (action === "me/push/unsubscribe" && req.method === "POST") {
        const body = await readBody(req);
        sendJson(res, 200, { ok: true, ...removePushSubscription(store, user, body.endpoint) });
        return;
      }

      // me/clock/in en me/clock/out · medewerker klokt zichzelf in/uit
      // (geo wordt meegestuurd voor locatie-geverifieerd inklokken op de werf)
      if (action === "me/clock/in" && req.method === "POST") {
        const body = await readBody(req).catch(() => ({}));
        sendJson(res, 201, { ok: true, row: clockIn(store, tenant, { userId: user.id, geo: body.geo, venueId: body.venueId }, user) });
        return;
      }
      if (action === "me/clock/out" && req.method === "POST") {
        sendJson(res, 200, { ok: true, row: clockOut(store, tenant, { userId: user.id }, user) });
        return;
      }
      // Pauze op de actieve prikking: netto gewerkte tijd = bruto - pauzes.
      if (action === "me/clock/break/start" && req.method === "POST") {
        sendJson(res, 200, { ok: true, row: breakStart(store, tenant, { userId: user.id }, user) });
        return;
      }
      if (action === "me/clock/break/stop" && req.method === "POST") {
        sendJson(res, 200, { ok: true, row: breakStop(store, tenant, { userId: user.id }, user) });
        return;
      }

      // Startpagina-widgets van de medewerker: de beheerder bepaalt het
      // standaardtemplate (Instellingen), de medewerker mag zelf een eigen
      // selectie kiezen; entitlements filteren wat beschikbaar is.
      if (action === "me/home-config" && req.method === "GET") {
        const ent = user.role === "super_admin"
          ? { views: "*" }
          : resolveTenantModules(store, tenant);
        const available = EMP_HOME_WIDGETS.filter(w => !w.view || ent.views === "*" || (ent.views || []).includes(w.view));
        const availKeys = new Set(available.map(w => w.key));
        const template = (tenant.employeeHomeTemplate || []).filter(k => availKeys.has(k));
        const personal = Array.isArray(user.homeWidgets) ? user.homeWidgets.filter(k => availKeys.has(k)) : null;
        sendJson(res, 200, { ok: true, available, template: template.length ? template : available.map(w => w.key), personal });
        return;
      }
      if (action === "me/home-config" && req.method === "POST") {
        assertHumanUser(user);
        const body = await readBody(req);
        const validKeys = new Set(EMP_HOME_WIDGETS.map(w => w.key));
        let homeWidgets = null; // null = terugvallen op het bedrijfstemplate
        if (Array.isArray(body.widgets)) {
          homeWidgets = body.widgets.filter(k => validKeys.has(k));
          if (!homeWidgets.length) return sendJson(res, 400, { ok: false, error: "Kies minstens één blok, of herstel de bedrijfsstandaard" });
        }
        store.update("users", user.id, { homeWidgets });
        store.audit({ actor: user.email, tenantId, action: "home_config_updated", area: "settings", detail: homeWidgets ? homeWidgets.join(",") : "standaard" });
        sendJson(res, 200, { ok: true, personal: homeWidgets });
        return;
      }

      // me/expenses POST · medewerker dient onkosten in
      if (action === "me/expenses" && req.method === "POST") {
        const body = await readBody(req);
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount <= 0) return sendJson(res, 400, { ok: false, error: "Bedrag moet groter zijn dan €0" });
        if (amount > 100000) return sendJson(res, 400, { ok: false, error: "Bedrag is onrealistisch hoog · controleer de invoer" });
        // Optionele werkbon-koppeling: zo kan de onkost later mee op de
        // klantfactuur van die werkbon (doorrekenen aan de klant).
        let expWorkorderId = null;
        if (body.workorderId) {
          const woRef = store.get("workorders", String(body.workorderId));
          if (woRef && woRef.tenantId === tenantId) expWorkorderId = woRef.id;
        }
        const row = store.insert("expenses", {
          id: `exp_${Date.now()}_${require("crypto").randomBytes(4).toString("hex")}`,
          tenantId,
          userId: user.id,
          userName: user.name || user.email,
          date: body.date || new Date().toISOString().slice(0, 10),
          amount,
          category: body.category || "overig",
          description: body.description || "",
          workorderId: expWorkorderId,
          status: "ingediend",
          createdAt: new Date().toISOString()
        });
        // E-mail naar tenant-admins
        const adminEmails = store.list("users", tenantId)
          .filter(u => u.active !== false && ["tenant_admin", "manager"].includes(u.role) && u.email)
          .map(u => u.email);
        if (adminEmails.length) {
          const tpl = expenseSubmittedToAdmin({ employee: user, expense: row, appUrl: config.appUrl });
          adminEmails.forEach(to => sendMail({ to, ...tpl }));
        }
        sendJson(res, 201, { ok: true, row });
        return;
      }

      // me/leaves POST · medewerker vraagt verlof aan
      if (action === "me/leaves" && req.method === "POST") {
        const body = await readBody(req);
        if (!body.startDate || !body.endDate) return sendJson(res, 400, { ok: false, error: "Start- en einddatum zijn verplicht" });
        // Validatie: geen conflict met bestaand verlof
        const existingLeaves = store.list("leaves", tenantId).filter(l =>
          l.userId === user.id &&
          !["geweigerd", "geannuleerd"].includes(l.status) &&
          l.startDate <= body.endDate &&
          l.endDate >= body.startDate
        );
        if (existingLeaves.length > 0) return sendJson(res, 409, { ok: false, error: "Je hebt al een verlofaanvraag in deze periode" });
        // Bereken werkdagen (excl. weekend + Belgische feestdagen)
        const days = workingDaysBetween(body.startDate, body.endDate);
        if (days === 0) return sendJson(res, 400, { ok: false, error: "Geen werkdagen in de geselecteerde periode" });
        const leave = store.insert("leaves", {
          id: `leave_${Date.now()}_${require("crypto").randomBytes(4).toString("hex")}`,
          tenantId,
          userId: user.id,
          userName: user.name || user.email,
          type: body.type || "vakantie",
          startDate: body.startDate,
          endDate: body.endDate,
          days,
          reason: body.reason || "",
          status: "aangevraagd",
          createdAt: new Date().toISOString()
        });
        // E-mail naar tenant-admins
        const adminEmails = store.list("users", tenantId)
          .filter(u => u.active !== false && ["tenant_admin", "manager"].includes(u.role) && u.email)
          .map(u => u.email);
        if (adminEmails.length) {
          const tpl = leaveSubmittedToAdmin({ employee: user, leave, appUrl: config.appUrl });
          adminEmails.forEach(to => sendMail({ to, ...tpl }));
        }
        // Consistente response: gebruik 'leave' (niet 'row')
        sendJson(res, 201, { ok: true, leave, row: leave });
        return;
      }

      // me/leaves/:id DELETE · medewerker trekt eigen aanvraag in
      const meLeaveItemMatch = action.match(/^me\/leaves\/([^/]+)$/);
      if (meLeaveItemMatch && req.method === "DELETE") {
        assertHumanUser(user);
        const leaveId = meLeaveItemMatch[1];
        const leave = store.list("leaves", tenantId).find(l => l.id === leaveId);
        if (!leave) return sendJson(res, 404, { ok: false, error: "Verlofaanvraag niet gevonden" });
        if (leave.userId !== user.id) return sendJson(res, 403, { ok: false, error: "Geen toegang" });
        if (leave.status !== "aangevraagd") return sendJson(res, 400, { ok: false, error: "Alleen aanvragen met status 'aangevraagd' kunnen worden ingetrokken" });
        store.update("leaves", leaveId, { status: "geannuleerd", cancelledAt: new Date().toISOString(), cancelledBy: user.email });
        store.audit({ actor: user.email, tenantId, action: "leave_cancelled_by_employee", area: "leaves", detail: `${leave.type} ${leave.startDate}→${leave.endDate}` });
        sendJson(res, 200, { ok: true });
        return;
      }

      // me/expenses/:id DELETE · medewerker verwijdert eigen openstaande declaratie
      const meExpItemMatch = action.match(/^me\/expenses\/([^/]+)$/);
      if (meExpItemMatch && req.method === "DELETE") {
        assertHumanUser(user);
        const expId = meExpItemMatch[1];
        const exp = store.list("expenses", tenantId).find(e => e.id === expId);
        if (!exp) return sendJson(res, 404, { ok: false, error: "Declaratie niet gevonden" });
        if (exp.userId !== user.id) return sendJson(res, 403, { ok: false, error: "Geen toegang" });
        if (!["aangevraagd", "ingediend", "pending"].includes(exp.status)) return sendJson(res, 400, { ok: false, error: "Alleen openstaande declaraties kunnen worden verwijderd" });
        store.remove("expenses", expId);
        store.audit({ actor: user.email, tenantId, action: "expense_deleted_by_employee", area: "expenses", detail: `€${exp.amount} ${exp.category}` });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Einde employee me routes ──────────────────────────────────────────────

      // ── Manager team routes ───────────────────────────────────────────────────
      if (action === "manager/dashboard" && req.method === "GET") {
        assertCan(user, "planning");
        sendJson(res, 200, { ok: true, ...getManagerDashboard(store, tenantId, user) });
        return;
      }

      if (action === "manager/planning" && req.method === "GET") {
        assertCan(user, "planning");
        const opts = { from: url.searchParams.get("from"), to: url.searchParams.get("to") };
        sendJson(res, 200, { ok: true, shifts: withUserNames(store, getManagerTeamPlanning(store, tenantId, opts)) });
        return;
      }

      // ── Planning shift aanmaken ────────────────────────────────────────────────
      // Overlap-detectie planning: zelfde medewerker, zelfde datum, overlappend
      // tijdvenster (excludeId voor PATCH op de eigen shift).
      const shiftOverlapOn = (userId, date, start, end, excludeId) =>
        store.list("shifts", tenantId).find(s =>
          s.userId === userId && s.date === date && s.id !== excludeId &&
          String(start) < String(s.end || "24:00") && String(end) > String(s.start || "00:00")
        ) || null;

      // Geünificeerde planning (E06): shifts + afspraken als één tijdlijn.
      if (action === "planning/unified" && req.method === "GET") {
        assertCan(user, "planning");
        const items = listPlanningItems(store, tenantId, {
          from: url.searchParams.get("from") || undefined,
          to: url.searchParams.get("to") || undefined,
          resourceId: url.searchParams.get("resourceId") || undefined,
          jobId: url.searchParams.get("jobId") || undefined,
        });
        // Dossierscope (E02): een own/team-planner ziet enkel eigen/team-resources.
        const scoped = applyScope(store, user, "planning", items, ["primaryResourceId"]);
        sendJson(res, 200, { ok: true, items: scoped });
        return;
      }

      if (action === "planning" && req.method === "POST") {
        assertCan(user, "planning");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        if (!body.userId) return sendJson(res, 400, { ok: false, error: "Medewerker (userId) is verplicht" });
        if (!body.date)   return sendJson(res, 400, { ok: false, error: "Datum is verplicht" });
        if (!body.start)  return sendJson(res, 400, { ok: false, error: "Starttijd is verplicht" });
        if (!body.end)    return sendJson(res, 400, { ok: false, error: "Eindtijd is verplicht" });
        if (String(body.end) <= String(body.start)) return sendJson(res, 400, { ok: false, error: "Eindtijd moet na de starttijd liggen" });
        // Verlof-aware planning: medewerker met goedgekeurd verlof niet inplannen.
        const leaveClash = leaveConflictOn(store, tenantId, body.userId, body.date);
        if (leaveClash) return sendJson(res, 409, { ok: false, error: `Medewerker heeft goedgekeurd verlof op ${body.date} (${leaveClash.startDate} t/m ${leaveClash.endDate}) en kan niet ingepland worden.`, code: "LEAVE_CONFLICT", conflict: { leaveId: leaveClash.id, startDate: leaveClash.startDate, endDate: leaveClash.endDate } });
        // Dubbele boeking (backend-handoff): zelfde medewerker, overlappend tijdvenster → 409 met conflictdata.
        // Multi-resource (E06/h24): naast de primaire userId mogen extra
        // medewerkers worden toegewezen; de overlap-check geldt voor elk van hen.
        const assigneeIds = Array.isArray(body.assigneeIds) ? body.assigneeIds.filter(id => id && id !== body.userId) : [];
        // Beschikbaarheid tegen de personeelsfiche (h16-acceptatie: planning
        // valideert beschikbaarheid, werkrooster en dienstperiode). Uit dienst
        // of buiten de dienstperiode BLOKKEERT; buiten het werkrooster is een
        // waarschuwing, zodat een uitzondering bewust gepland kan worden.
        const planningWarnings = [];
        for (const rid of [body.userId, ...assigneeIds]) {
          const emp = employeeRepo.findByUserId(tenantId, rid);
          if (!emp) continue;
          const avail = availabilityOn(emp, body.date, { leaves: store.list("leaves", tenantId) || [] });
          if (avail.blocking) {
            const reason = avail.reasons.find(r => ["OUT_OF_SERVICE", "NOT_PLANNABLE", "BEFORE_START", "AFTER_END"].includes(r.code)) || avail.reasons[0];
            return sendJson(res, 409, { ok: false, error: `${emp.name}: ${reason.message}`, code: reason.code, conflict: { employeeId: emp.id, date: body.date, reasons: avail.reasons } });
          }
          if (!avail.available) planningWarnings.push({ employeeId: emp.id, name: emp.name, reasons: avail.reasons });
        }
        // Overlap-check over de geünificeerde planning voor élke toegewezen resource.
        for (const rid of [body.userId, ...assigneeIds]) {
          const overlap = planningOverlap(store, tenantId, rid, body.date, body.start, body.end, null);
          if (overlap) return sendJson(res, 409, { ok: false, error: `Overlapt met bestaande planning van ${overlap.start} tot ${overlap.end}.`, code: "SHIFT_OVERLAP", conflict: { shiftId: overlap.id, resourceId: rid, date: overlap.date, start: overlap.start, end: overlap.end, venueId: overlap.venueId || null } });
        }
        const shift = store.insert("shifts", {
          id: `shift_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId,
          userId: body.userId,
          assigneeIds,
          date: body.date,
          start: body.start,
          end: body.end,
          venueId: body.venueId || null,
          workorderId: body.workorderId || null,   // koppel de shift aan een werkbon → uren stromen door
          projectId: body.projectId || null,       // planning alloceert tijd voor een project/job
          note: body.note || "",
          createdBy: user.id,
          createdAt: new Date().toISOString()
        });
        store.audit({ actor: user.email, tenantId, action: "shift_created", area: "planning", detail: `${body.date} ${body.start}–${body.end}` });
        emitDomainEvent(store, { tenantId, eventType: "planning.item_created", aggregateType: "planning_item", aggregateId: shift.id, actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 201, { ok: true, shift, warnings: planningWarnings.length ? planningWarnings : undefined });
        return;
      }

      // ── Planning shift bijwerken / verwijderen ────────────────────────────────
      const planningItemMatch = action.match(/^planning\/([^/]+)$/);
      if (planningItemMatch && req.method === "PATCH") {
        assertCan(user, "planning");
        assertApiKeyWriteAllowed(user, req);
        const existingShift = store.list("shifts", tenantId).find(s => s.id === planningItemMatch[1]);
        if (!existingShift) return sendJson(res, 404, { ok: false, error: "Shift niet gevonden" });
        const body = await readBody(req);
        // Zelfde regels als bij aanmaken: tijdvolgorde, verlof en overlap gelden
        // ook voor het gewijzigde resultaat (backend-handoff).
        const next = { ...existingShift, ...body };
        if (!next.userId || !next.date || !next.start || !next.end) return sendJson(res, 400, { ok: false, error: "Medewerker, datum, start- en eindtijd zijn verplicht" });
        if (String(next.end) <= String(next.start)) return sendJson(res, 400, { ok: false, error: "Eindtijd moet na de starttijd liggen" });
        const patchLeave = leaveConflictOn(store, tenantId, next.userId, next.date);
        if (patchLeave) return sendJson(res, 409, { ok: false, error: `Medewerker heeft goedgekeurd verlof op ${next.date} (${patchLeave.startDate} t/m ${patchLeave.endDate}).`, code: "LEAVE_CONFLICT", conflict: { leaveId: patchLeave.id, startDate: patchLeave.startDate, endDate: patchLeave.endDate } });
        const patchOverlap = shiftOverlapOn(next.userId, next.date, next.start, next.end, existingShift.id);
        if (patchOverlap) return sendJson(res, 409, { ok: false, error: `Overlapt met een bestaande shift van ${patchOverlap.start} tot ${patchOverlap.end}.`, code: "SHIFT_OVERLAP", conflict: { shiftId: patchOverlap.id, date: patchOverlap.date, start: patchOverlap.start, end: patchOverlap.end, venueId: patchOverlap.venueId || null } });
        const shift = store.update("shifts", existingShift.id, { ...body, updatedAt: new Date().toISOString() });
        store.audit({ actor: user.email, tenantId, action: "shift_updated", area: "planning", detail: planningItemMatch[1] });
        sendJson(res, 200, { ok: true, shift });
        return;
      }
      if (planningItemMatch && req.method === "DELETE") {
        assertCan(user, "planning");
        assertInteractiveUser(user);
        store.remove("shifts", planningItemMatch[1]);
        store.audit({ actor: user.email, tenantId, action: "shift_deleted", area: "planning", detail: planningItemMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }
      // ── Einde manager routes ──────────────────────────────────────────────────

      // ── Projecten (centraal uitvoeringsdossier · E04) ─────────────────────────
      if (action === "projects" && req.method === "GET") {
        assertCan(user, "projects");
        // Financiele velden (budget/forecast) enkel voor beheerders (h8.2/h22:
        // operationele en financiele info scheidbaar).
        // customerName stabiel meegeven (frontend-coverage punt 1).
        const projCustNames = new Map(store.list("customers", tenantId).map(c => [c.id, c.name]));
        const projRows = projectRepo.list(tenantId)
          .map(p => p.customerName || !p.customerId ? p : { ...p, customerName: projCustNames.get(p.customerId) || null });
        sendJson(res, 200, { ok: true, projects: redactSensitive(user, "projects", projRows) });
        return;
      }
      const projectItemMatch = action.match(/^projects\/([^/]+)$/);
      if (projectItemMatch && req.method === "GET") {
        assertCan(user, "projects");
        const p = projectRepo.findById(tenantId, projectItemMatch[1]);
        if (!p) return sendJson(res, 404, { ok: false, error: "Project niet gevonden" });
        sendJson(res, 200, { ok: true, project: redactSensitive(user, "projects", p) });
        return;
      }
      // ── Project 360°-dossier (#76): alle modulesporen + tijdlijn in één view ──
      const projectDossierMatch = action.match(/^projects\/([^/]+)\/dossier$/);
      if (projectDossierMatch && req.method === "GET") {
        assertCan(user, "projects");
        const p = projectRepo.findById(tenantId, projectDossierMatch[1]);
        if (!p) return sendJson(res, 404, { ok: false, error: "Project niet gevonden" });
        // Financiele samenvatting enkel voor wie de kosten mag zien (rechten-gedreven,
        // zelfde poort als de finance-endpoint + costs.view uit een samengesteld profiel).
        const mayFinance = ["tenant_admin", "super_admin"].includes(user.role) || canSeeSensitive(user);
        const dossier = projectDossier(store, tenantId, p, { finance: mayFinance ? buildProjectFinance(store, tenant, p) : null });
        // Gevoelige velden per deellijst redigeren (marge, kostprijs, kredietlimiet ...).
        dossier.project = redactSensitive(user, "projects", dossier.project);
        dossier.related.quotes = redactSensitive(user, "quotes", dossier.related.quotes);
        sendJson(res, 200, { ok: true, dossier });
        return;
      }
      if (action === "projects" && req.method === "POST") {
        assertCan(user, "projects");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = projectRepo.insert(tenantId, body, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "project_created", area: "projects", detail: `${row.number} · ${row.name}` });
        emitDomainEvent(store, { tenantId, eventType: "project.created", aggregateType: "project", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 201, { ok: true, project: row });
        return;
      }
      if (projectItemMatch && req.method === "PATCH") {
        assertCan(user, "projects");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = projectRepo.update(tenantId, projectItemMatch[1], body, user.email, body.expectedVersion); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion }); }
        store.audit({ actor: user.email, tenantId, action: "project_updated", area: "projects", detail: projectItemMatch[1] });
        emitDomainEvent(store, { tenantId, eventType: "project.updated", aggregateType: "project", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId, data: { changedFields: Object.keys(body) } });
        sendJson(res, 200, { ok: true, project: row });
        return;
      }
      // Projectfinance (E14/h23): budget vs werkelijk vs gefactureerd vs marge.
      // Financiele inzage is gescheiden van operationele (h22): enkel beheerders.
      const projectFinanceMatch = action.match(/^projects\/([^/]+)\/finance$/);
      if (projectFinanceMatch && req.method === "GET") {
        assertCan(user, "projects");
        if (!["tenant_admin", "super_admin"].includes(user.role)) {
          return sendJson(res, 403, { ok: false, error: "Financiele projectinzage is voorbehouden aan beheerders", code: "FINANCIAL_SCOPE" });
        }
        const p = projectRepo.findById(tenantId, projectFinanceMatch[1]);
        if (!p) return sendJson(res, 404, { ok: false, error: "Project niet gevonden" });
        sendJson(res, 200, { ok: true, finance: buildProjectFinance(store, tenant, p) });
        return;
      }
      const projectTransitionMatch = action.match(/^projects\/([^/]+)\/transition$/);
      if (projectTransitionMatch && req.method === "POST") {
        assertCan(user, "projects");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = projectRepo.transition(tenantId, projectTransitionMatch[1], body.status, user.email, body.reason); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "project_transition", area: "projects", detail: `${projectTransitionMatch[1]} → ${body.status}` });
        emitDomainEvent(store, { tenantId, eventType: "project.status_changed", aggregateType: "project", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId, data: { status: row.status } });
        sendJson(res, 200, { ok: true, project: row });
        return;
      }
      if (projectItemMatch && req.method === "DELETE") {
        assertCan(user, "projects");
        assertInteractiveUser(user);
        try { projectRepo.remove(tenantId, projectItemMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message }); }
        store.audit({ actor: user.email, tenantId, action: "project_deleted", area: "projects", detail: projectItemMatch[1] });
        emitDomainEvent(store, { tenantId, eventType: "project.deleted", aggregateType: "project", aggregateId: projectItemMatch[1], actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Compliance-overzicht (Construction Core · h43.5) ──────────────────────
      if (action === "compliance/overview" && req.method === "GET") {
        assertCan(user, "construction");
        sendJson(res, 200, { ok: true, overview: buildComplianceOverview(store, tenant) });
        return;
      }

      // ── Werven / worksites (Construction Core · E12) ──────────────────────────
      if (action === "worksites" && req.method === "GET") {
        assertCan(user, "construction");
        sendJson(res, 200, { ok: true, worksites: worksiteRepo.list(tenantId, { projectId: url.searchParams.get("projectId") || undefined }) });
        return;
      }
      if (action === "worksites" && req.method === "POST") {
        assertCan(user, "construction");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = worksiteRepo.insert(tenantId, body, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "worksite_created", area: "construction", detail: row.name });
        emitDomainEvent(store, { tenantId, eventType: "worksite.created", aggregateType: "worksite", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 201, { ok: true, worksite: row });
        return;
      }
      const worksiteItemMatch = action.match(/^worksites\/([^/]+)$/);
      if (worksiteItemMatch && req.method === "PATCH") {
        assertCan(user, "construction");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = worksiteRepo.update(tenantId, worksiteItemMatch[1], body, user.email, body.expectedVersion); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion }); }
        store.audit({ actor: user.email, tenantId, action: "worksite_updated", area: "construction", detail: worksiteItemMatch[1] });
        sendJson(res, 200, { ok: true, worksite: row });
        return;
      }
      if (worksiteItemMatch && req.method === "DELETE") {
        assertCan(user, "construction");
        assertInteractiveUser(user);
        try { worksiteRepo.remove(tenantId, worksiteItemMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message }); }
        store.audit({ actor: user.email, tenantId, action: "worksite_deleted", area: "construction", detail: worksiteItemMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Meerwerk / change orders (Construction Core · E12) ────────────────────
      if (action === "changeorders" && req.method === "GET") {
        assertCan(user, "construction");
        sendJson(res, 200, { ok: true, changeOrders: changeOrderRepo.list(tenantId, { projectId: url.searchParams.get("projectId") || undefined }) });
        return;
      }
      if (action === "changeorders" && req.method === "POST") {
        assertCan(user, "construction");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = changeOrderRepo.insert(tenantId, body, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "change_order_created", area: "construction", detail: `${row.number} · €${row.total.toFixed(2)}` });
        emitDomainEvent(store, { tenantId, eventType: "change_order.created", aggregateType: "change_order", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 201, { ok: true, changeOrder: row });
        return;
      }
      const changeOrderItemMatch = action.match(/^changeorders\/([^/]+)$/);
      if (changeOrderItemMatch && req.method === "PATCH") {
        assertCan(user, "construction");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = changeOrderRepo.update(tenantId, changeOrderItemMatch[1], body, user.email, body.expectedVersion); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion }); }
        store.audit({ actor: user.email, tenantId, action: "change_order_updated", area: "construction", detail: changeOrderItemMatch[1] });
        sendJson(res, 200, { ok: true, changeOrder: row });
        return;
      }
      const changeOrderTransitionMatch = action.match(/^changeorders\/([^/]+)\/transition$/);
      if (changeOrderTransitionMatch && req.method === "POST") {
        assertCan(user, "construction");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let result;
        try { result = changeOrderRepo.transition(tenantId, changeOrderTransitionMatch[1], body.status, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        // Geaccepteerde change wijzigt het contractbudget van het project (h43.4).
        if (result.budgetDelta && result.changeOrder.projectId) {
          const proj = projectRepo.findById(tenantId, result.changeOrder.projectId);
          if (proj) {
            const newBudget = round2(Number(proj.budgetAmount || 0) + result.budgetDelta);
            store.update("projects", proj.id, { budgetAmount: newBudget, version: Number(proj.version || 1) + 1, updatedAt: new Date().toISOString() });
            emitDomainEvent(store, { tenantId, eventType: "project.budget_changed", aggregateType: "project", aggregateId: proj.id, actor: user.email, correlationId: res.wfpRequestId, data: { delta: result.budgetDelta, changeOrderId: result.changeOrder.id } });
          }
        }
        store.audit({ actor: user.email, tenantId, action: "change_order_transition", area: "construction", detail: `${changeOrderTransitionMatch[1]} → ${body.status}` });
        emitDomainEvent(store, { tenantId, eventType: "change_order.status_changed", aggregateType: "change_order", aggregateId: result.changeOrder.id, actor: user.email, correlationId: res.wfpRequestId, data: { status: result.changeOrder.status } });
        sendJson(res, 200, { ok: true, changeOrder: result.changeOrder, budgetDelta: result.budgetDelta });
        return;
      }
      if (changeOrderItemMatch && req.method === "DELETE") {
        assertCan(user, "construction");
        assertInteractiveUser(user);
        try { changeOrderRepo.remove(tenantId, changeOrderItemMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "change_order_deleted", area: "construction", detail: changeOrderItemMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Vorderingsstaten (h32/PRG · R7) ───────────────────────────────────────
      if (action === "progress_claims" && req.method === "GET") {
        assertCan(user, "progress_claims");
        const claims = progressClaimRepo.list(tenantId, { projectId: url.searchParams.get("projectId") || undefined, status: url.searchParams.get("status") || undefined });
        sendJson(res, 200, { ok: true, claims: claims.map(c => ({ ...c, totals: computeClaimTotals(c) })) });
        return;
      }
      if (action === "progress_claims" && req.method === "POST") {
        assertCan(user, "progress_claims");
        assertApiKeyWriteAllowed(user, req);
        let row;
        try { row = progressClaimRepo.insert(tenantId, await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "progress_claim_created", area: "progress_claims", detail: row.number });
        emitDomainEvent(store, { tenantId, eventType: "progress_claim.created", aggregateType: "progress_claim", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId, data: { projectId: row.projectId, sequence: row.sequence } });
        sendJson(res, 201, { ok: true, claim: row, totals: computeClaimTotals(row) });
        return;
      }
      const claimItemMatch = action.match(/^progress_claims\/([^/]+)$/);
      if (claimItemMatch && req.method === "GET") {
        assertCan(user, "progress_claims");
        const claim = progressClaimRepo.findById(tenantId, claimItemMatch[1]);
        if (!claim) return sendJson(res, 404, { ok: false, error: "Vorderingsstaat niet gevonden" });
        sendJson(res, 200, { ok: true, claim, totals: computeClaimTotals(claim) });
        return;
      }
      if (claimItemMatch && req.method === "PATCH") {
        assertCan(user, "progress_claims");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = progressClaimRepo.update(tenantId, claimItemMatch[1], body, user.email, body.expectedVersion); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion, lines: e.lines }); }
        sendJson(res, 200, { ok: true, claim: row, totals: computeClaimTotals(row) });
        return;
      }
      if (claimItemMatch && req.method === "DELETE") {
        assertCan(user, "progress_claims");
        assertInteractiveUser(user);
        try { progressClaimRepo.remove(tenantId, claimItemMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "progress_claim_deleted", area: "progress_claims", detail: claimItemMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }
      const claimTransitionMatch = action.match(/^progress_claims\/([^/]+)\/transition$/);
      if (claimTransitionMatch && req.method === "POST") {
        assertCan(user, "progress_claims");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = progressClaimRepo.transition(tenantId, claimTransitionMatch[1], body.status, user.email, { note: body.note }); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "progress_claim_status_changed", area: "progress_claims", detail: `${row.number} → ${row.status}` });
        emitDomainEvent(store, { tenantId, eventType: "progress_claim.status_changed", aggregateType: "progress_claim", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId, data: { status: row.status } });
        sendJson(res, 200, { ok: true, claim: row, totals: computeClaimTotals(row) });
        return;
      }
      // Factuur uit de goedgekeurde vordering · alleen de huidige periode (h32).
      const claimInvoiceMatch = action.match(/^progress_claims\/([^/]+)\/invoice$/);
      if (claimInvoiceMatch && req.method === "POST") {
        assertCan(user, "progress_claims");
        assertInvoicing(user);
        assertApiKeyWriteAllowed(user, req);
        let result;
        try {
          // Atomair (E1): factuur + koppeling committen samen of rollen samen terug.
          result = await txManager.run(() => {
            const payload = progressClaimRepo.invoicePayload(tenantId, claimInvoiceMatch[1]);
            const project = (store.list("projects", tenantId) || []).find(p => p.id === payload.claim.projectId) || {};
            const cust = project.customerId ? (customerRepo.findById(tenantId, project.customerId) || {}) : {};
            const invoice = createCustomerInvoice(store, tenant, user, {
              customerId: project.customerId || null,
              customerName: cust.name || "",
              customerAddress: cust.address || "",
              customerVatNumber: cust.vatNumber || "",
              projectId: payload.claim.projectId,
              notes: `Vorderingsstaat ${payload.claim.number}${payload.claim.periodStart ? ` · periode ${payload.claim.periodStart} t/m ${payload.claim.periodEnd || ""}` : ""}`,
              lines: payload.lines,
            });
            const claim = progressClaimRepo.markInvoiced(tenantId, payload.claim.id, invoice.id, user.email);
            emitDomainEvent(store, { tenantId, eventType: "progress_claim.invoiced", aggregateType: "progress_claim", aggregateId: claim.id, actor: user.email, correlationId: res.wfpRequestId, data: { invoiceId: invoice.id, netPayable: payload.totals.netPayable } });
            return { invoice, claim, totals: payload.totals };
          });
        }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "progress_claim_invoiced", area: "progress_claims", detail: `${result.claim.number} → ${result.invoice.number}` });
        sendJson(res, 201, { ok: true, ...result });
        return;
      }

      // ── Catalogus & materiaal (E13/h20) ───────────────────────────────────────
      if (action === "articles" && req.method === "GET") {
        assertCan(user, "catalog");
        const opts = { includeArchived: url.searchParams.get("includeArchived") === "1", selectableOnly: url.searchParams.get("selectable") === "1" };
        sendJson(res, 200, { ok: true, articles: catalogRepo.list(tenantId, opts) });
        return;
      }
      if (action === "articles" && req.method === "POST") {
        assertCan(user, "catalog");
        assertApiKeyWriteAllowed(user, req);
        let row;
        try { row = catalogRepo.insert(tenantId, await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "article_created", area: "catalog", detail: `${row.number} · ${row.name}` });
        emitDomainEvent(store, { tenantId, eventType: "article.created", aggregateType: "article", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 201, { ok: true, article: row });
        return;
      }
      const articleItemMatch = action.match(/^articles\/([^/]+)$/);
      if (articleItemMatch && req.method === "GET") {
        assertCan(user, "catalog");
        const art = catalogRepo.findById(tenantId, articleItemMatch[1]);
        if (!art) return sendJson(res, 404, { ok: false, error: "Artikel niet gevonden" });
        const costBuildup = art.type === "composite" ? explodeComposition(store, tenant, art) : null;
        sendJson(res, 200, { ok: true, article: art, priceRules: catalogRepo.listPriceRules(tenantId, art.id), costBuildup });
        return;
      }
      if (articleItemMatch && req.method === "PATCH") {
        assertCan(user, "catalog");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let result;
        try { result = catalogRepo.update(tenantId, articleItemMatch[1], body, user.email, body.expectedVersion); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion }); }
        store.audit({ actor: user.email, tenantId, action: "article_updated", area: "catalog", detail: articleItemMatch[1] });
        if (result.priceChanged) emitDomainEvent(store, { tenantId, eventType: "article.price_changed", aggregateType: "article", aggregateId: result.article.id, actor: user.email, correlationId: res.wfpRequestId, data: { costPrice: result.article.costPrice, salesPrice: result.article.salesPrice } });
        sendJson(res, 200, { ok: true, article: result.article, priceChanged: result.priceChanged });
        return;
      }
      const articleTransitionMatch = action.match(/^articles\/([^/]+)\/transition$/);
      if (articleTransitionMatch && req.method === "POST") {
        assertCan(user, "catalog");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = catalogRepo.transition(tenantId, articleTransitionMatch[1], body.status, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        emitDomainEvent(store, { tenantId, eventType: "article.status_changed", aggregateType: "article", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId, data: { status: row.status } });
        sendJson(res, 200, { ok: true, article: row });
        return;
      }
      // Artikel → documentlijn: prijs oplossen + onveranderlijke snapshot (E13-acceptatie:
      // een artikel kan met correcte prijs/kost/btw/eenheid in offerte/order/werkbon/factuur).
      const articleResolveMatch = action.match(/^articles\/([^/]+)\/resolve$/);
      if (articleResolveMatch && req.method === "POST") {
        assertCan(user, "catalog");
        const art = catalogRepo.findById(tenantId, articleResolveMatch[1]);
        if (!art) return sendJson(res, 404, { ok: false, error: "Artikel niet gevonden" });
        const body = await readBody(req).catch(() => ({}));
        let line;
        try { line = snapshotForLine(store, tenant, art, { qty: body.qty, unit: body.unit, customerId: body.customerId, priceGroup: body.priceGroup, manualPrice: body.manualPrice, at: body.at }); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        sendJson(res, 200, { ok: true, line });
        return;
      }

      // ── Prijsregels / prijslijst (E13/h20) ────────────────────────────────────
      if (action === "price_rules" && req.method === "GET") {
        assertCan(user, "catalog");
        sendJson(res, 200, { ok: true, priceRules: catalogRepo.listPriceRules(tenantId, url.searchParams.get("articleId") || null) });
        return;
      }
      if (action === "price_rules" && req.method === "POST") {
        assertCan(user, "catalog");
        assertApiKeyWriteAllowed(user, req);
        let row;
        try { row = catalogRepo.addPriceRule(tenantId, await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "price_rule_added", area: "catalog", detail: `${row.articleId} · ${row.scope}` });
        sendJson(res, 201, { ok: true, priceRule: row });
        return;
      }
      const priceRuleItemMatch = action.match(/^price_rules\/([^/]+)$/);
      if (priceRuleItemMatch && req.method === "DELETE") {
        assertCan(user, "catalog");
        assertInteractiveUser(user);
        try { catalogRepo.removePriceRule(tenantId, priceRuleItemMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "price_rule_removed", area: "catalog", detail: priceRuleItemMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Leveranciers (E18/h27) ────────────────────────────────────────────────
      if (action === "suppliers" && req.method === "GET") {
        assertCan(user, "procurement");
        sendJson(res, 200, { ok: true, suppliers: redactSensitive(user, "suppliers", supplierRepo.list(tenantId)) });
        return;
      }
      if (action === "suppliers" && req.method === "POST") {
        assertCan(user, "procurement");
        assertApiKeyWriteAllowed(user, req);
        let row;
        try { row = supplierRepo.insert(tenantId, await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "supplier_created", area: "procurement", detail: row.name });
        emitDomainEvent(store, { tenantId, eventType: "supplier.created", aggregateType: "supplier", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 201, { ok: true, supplier: row });
        return;
      }
      const supplierItemMatch = action.match(/^suppliers\/([^/]+)$/);
      if (supplierItemMatch && req.method === "PATCH") {
        assertCan(user, "procurement");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = supplierRepo.update(tenantId, supplierItemMatch[1], body, user.email, body.expectedVersion); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion }); }
        store.audit({ actor: user.email, tenantId, action: "supplier_updated", area: "procurement", detail: supplierItemMatch[1] });
        sendJson(res, 200, { ok: true, supplier: row });
        return;
      }
      if (supplierItemMatch && req.method === "DELETE") {
        assertCan(user, "procurement");
        assertInteractiveUser(user);
        try { supplierRepo.remove(tenantId, supplierItemMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message }); }
        store.audit({ actor: user.email, tenantId, action: "supplier_deleted", area: "procurement", detail: supplierItemMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Inkooporders (E18/h27) ────────────────────────────────────────────────
      if (action === "purchase_orders" && req.method === "GET") {
        assertCan(user, "procurement");
        sendJson(res, 200, { ok: true, purchaseOrders: purchaseOrderRepo.list(tenantId, { supplierId: url.searchParams.get("supplierId") || undefined, projectId: url.searchParams.get("projectId") || undefined, status: url.searchParams.get("status") || undefined }) });
        return;
      }
      if (action === "purchase_orders" && req.method === "POST") {
        assertCan(user, "procurement");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try {
          if (body.supplierId && !supplierRepo.findById(tenantId, body.supplierId)) return sendJson(res, 404, { ok: false, error: "Leverancier niet gevonden" });
          row = purchaseOrderRepo.insert(tenantId, body, user.email);
        }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "purchase_order_created", area: "procurement", detail: `${row.number} · €${row.subtotal.toFixed(2)}` });
        emitDomainEvent(store, { tenantId, eventType: "purchase_order.created", aggregateType: "purchase_order", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 201, { ok: true, purchaseOrder: row });
        return;
      }
      const poItemMatch = action.match(/^purchase_orders\/([^/]+)$/);
      if (poItemMatch && req.method === "PATCH") {
        assertCan(user, "procurement");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = purchaseOrderRepo.update(tenantId, poItemMatch[1], body, user.email, body.expectedVersion); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion }); }
        store.audit({ actor: user.email, tenantId, action: "purchase_order_updated", area: "procurement", detail: poItemMatch[1] });
        sendJson(res, 200, { ok: true, purchaseOrder: row });
        return;
      }
      const poTransitionMatch = action.match(/^purchase_orders\/([^/]+)\/transition$/);
      if (poTransitionMatch && req.method === "POST") {
        assertCan(user, "procurement");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = purchaseOrderRepo.transition(tenantId, poTransitionMatch[1], body.status, user.email, { reason: body.reason }); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "purchase_order_transition", area: "procurement", detail: `${poTransitionMatch[1]} → ${body.status}` });
        emitDomainEvent(store, { tenantId, eventType: "purchase_order.status_changed", aggregateType: "purchase_order", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId, data: { status: row.status, commitment: row.commitment } });
        sendJson(res, 200, { ok: true, purchaseOrder: row });
        return;
      }
      const poReceiveMatch = action.match(/^purchase_orders\/([^/]+)\/receive$/);
      if (poReceiveMatch && req.method === "POST") {
        assertCan(user, "procurement");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let result;
        try { result = purchaseOrderRepo.receive(tenantId, poReceiveMatch[1], body.receipts, user.email, body.locationId); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "goods_receipt", area: "procurement", detail: `${poReceiveMatch[1]} · ${result.progress.pct}%` });
        emitDomainEvent(store, { tenantId, eventType: "purchase_order.received", aggregateType: "purchase_order", aggregateId: poReceiveMatch[1], actor: user.email, correlationId: res.wfpRequestId, data: { pct: result.progress.pct, movements: result.movements.length } });
        sendJson(res, 201, { ok: true, ...result });
        return;
      }
      if (poItemMatch && req.method === "DELETE") {
        assertCan(user, "procurement");
        assertInteractiveUser(user);
        try { purchaseOrderRepo.remove(tenantId, poItemMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "purchase_order_deleted", area: "procurement", detail: poItemMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Voorraad-ledger (E17/h28) ─────────────────────────────────────────────
      if (action === "inventory/levels" && req.method === "GET") {
        assertCan(user, "inventory");
        const levels = inventory.listLevels(store, tenantId, { articleId: url.searchParams.get("articleId") || undefined, locationId: url.searchParams.get("locationId") || undefined });
        // Canonieke namen meegeven (frontend-coverage punt 3): de UI hoeft
        // geen eigen catalogus- en locatie-verrijking meer te doen.
        const articleById = new Map(store.list("articles", tenantId).map(a => [a.id, a]));
        const venueById = new Map(store.list("venues", tenantId).map(v => [v.id, v]));
        const locationById = new Map((store.data.stockLocations || []).filter(l => l.tenantId === tenantId).map(l => [l.id, l]));
        sendJson(res, 200, { ok: true, levels: levels.map(l => {
          const art = articleById.get(l.articleId);
          const loc = locationById.get(l.locationId) || venueById.get(l.locationId);
          return { ...l, articleName: (art && art.name) || null, unit: (art && art.unit) || null, locationName: (loc && loc.name) || null };
        }) });
        return;
      }
      // Leescontract voor detailtraceerbaarheid (frontend-coverage punt 4).
      if (action === "inventory/movements" && req.method === "GET") {
        assertCan(user, "inventory");
        sendJson(res, 200, { ok: true, movements: inventory.listMovements(store, tenantId, {
          articleId: url.searchParams.get("articleId") || undefined,
          locationId: url.searchParams.get("locationId") || undefined,
          limit: url.searchParams.get("limit") || undefined,
        }) });
        return;
      }
      if (action === "inventory/reservations" && req.method === "GET") {
        assertCan(user, "inventory");
        sendJson(res, 200, { ok: true, reservations: inventory.listReservations(store, tenantId, {
          articleId: url.searchParams.get("articleId") || undefined,
          locationId: url.searchParams.get("locationId") || undefined,
          status: url.searchParams.get("status") || undefined,
        }) });
        return;
      }
      if (action === "inventory/movements" && req.method === "POST") {
        assertCan(user, "inventory");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let mv;
        try { mv = inventory.bookMovement(store, tenantId, body, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "stock_movement", area: "inventory", detail: `${body.type} · ${mv.qty}` });
        emitDomainEvent(store, { tenantId, eventType: "stock.movement_booked", aggregateType: "stock_movement", aggregateId: mv.id, actor: user.email, correlationId: res.wfpRequestId, data: { type: mv.type } });
        sendJson(res, 201, { ok: true, movement: mv });
        return;
      }
      const mvReverseMatch = action.match(/^inventory\/movements\/([^/]+)\/reverse$/);
      if (mvReverseMatch && req.method === "POST") {
        assertCan(user, "inventory");
        assertApiKeyWriteAllowed(user, req);
        let mv;
        try { mv = inventory.reverseMovement(store, tenantId, mvReverseMatch[1], user.email, (await readBody(req).catch(() => ({}))).reason); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "stock_movement_reversed", area: "inventory", detail: mvReverseMatch[1] });
        sendJson(res, 201, { ok: true, movement: mv });
        return;
      }
      if (action === "inventory/reservations" && req.method === "POST") {
        assertCan(user, "inventory");
        assertApiKeyWriteAllowed(user, req);
        let r;
        try { r = inventory.reserve(store, tenantId, await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, available: e.available }); }
        store.audit({ actor: user.email, tenantId, action: "stock_reserved", area: "inventory", detail: `${r.articleId} · ${r.qty}` });
        sendJson(res, 201, { ok: true, reservation: r });
        return;
      }
      const resReleaseMatch = action.match(/^inventory\/reservations\/([^/]+)$/);
      if (resReleaseMatch && req.method === "DELETE") {
        assertCan(user, "inventory");
        assertApiKeyWriteAllowed(user, req);
        let r;
        try { r = inventory.release(store, tenantId, resReleaseMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "stock_released", area: "inventory", detail: resReleaseMatch[1] });
        sendJson(res, 200, { ok: true, reservation: r });
        return;
      }
      if (action === "inventory/transfer" && req.method === "POST") {
        assertCan(user, "inventory");
        assertApiKeyWriteAllowed(user, req);
        let t;
        try { t = inventory.transfer(store, tenantId, await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "stock_transfer", area: "inventory", detail: t.transferId });
        sendJson(res, 201, { ok: true, transfer: t });
        return;
      }
      if (action === "inventory/count" && req.method === "POST") {
        assertCan(user, "inventory");
        assertApiKeyWriteAllowed(user, req);
        let result;
        try { result = inventory.bookCount(store, tenantId, (await readBody(req)).counts, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "stock_count", area: "inventory", detail: `${result.count} correcties` });
        sendJson(res, 201, { ok: true, ...result });
        return;
      }

      // ── Contracten & abonnementen (E15/h35) ───────────────────────────────────
      if (action === "contracts" && req.method === "GET") {
        assertCan(user, "contracts");
        // customerName stabiel meegeven (frontend-coverage punt 1) · geen
        // terugval op klant-id's in de UI.
        const custNames = new Map(store.list("customers", tenantId).map(c => [c.id, c.name]));
        const rows = contractRepo.list(tenantId, { customerId: url.searchParams.get("customerId") || undefined, status: url.searchParams.get("status") || undefined })
          .map(c => c.customerName || !c.customerId ? c : { ...c, customerName: custNames.get(c.customerId) || null });
        sendJson(res, 200, { ok: true, contracts: rows });
        return;
      }
      if (action === "contracts" && req.method === "POST") {
        assertCan(user, "contracts");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = contractRepo.insert(tenantId, body, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "contract_created", area: "contracts", detail: `${row.number} · ${row.title}` });
        emitDomainEvent(store, { tenantId, eventType: "contract.created", aggregateType: "contract", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 201, { ok: true, contract: row });
        return;
      }
      const contractItemMatch = action.match(/^contracts\/([^/]+)$/);
      if (contractItemMatch && req.method === "PATCH") {
        assertCan(user, "contracts");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = contractRepo.update(tenantId, contractItemMatch[1], body, user.email, body.expectedVersion); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion }); }
        store.audit({ actor: user.email, tenantId, action: "contract_updated", area: "contracts", detail: contractItemMatch[1] });
        sendJson(res, 200, { ok: true, contract: row });
        return;
      }
      const contractTransitionMatch = action.match(/^contracts\/([^/]+)\/transition$/);
      if (contractTransitionMatch && req.method === "POST") {
        assertCan(user, "contracts");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = contractRepo.transition(tenantId, contractTransitionMatch[1], body.status, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "contract_transition", area: "contracts", detail: `${contractTransitionMatch[1]} → ${body.status}` });
        emitDomainEvent(store, { tenantId, eventType: "contract.status_changed", aggregateType: "contract", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId, data: { status: row.status } });
        sendJson(res, 200, { ok: true, contract: row });
        return;
      }
      const contractIndexMatch = action.match(/^contracts\/([^/]+)\/index$/);
      if (contractIndexMatch && req.method === "POST") {
        assertCan(user, "contracts");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = contractRepo.applyIndexation(tenantId, contractIndexMatch[1], { pct: body.pct, sourceIndex: body.sourceIndex, effectiveFrom: body.effectiveFrom }, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "contract_indexed", area: "contracts", detail: `${contractIndexMatch[1]} · ${body.pct}%` });
        emitDomainEvent(store, { tenantId, eventType: "contract.indexed", aggregateType: "contract", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId, data: { pct: Number(body.pct) } });
        sendJson(res, 200, { ok: true, contract: row });
        return;
      }
      const contractGenerateMatch = action.match(/^contracts\/([^/]+)\/generate$/);
      if (contractGenerateMatch && req.method === "POST") {
        assertCan(user, "contracts");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req).catch(() => ({}));
        let result;
        try {
          // Atomair (E1 · ADR-003): doc-creatie + generatiehistoriek + audit +
          // event committen samen, of rollen samen terug. Zo kan een halverwege-
          // fout nooit een factuur/werkbon zonder historiek achterlaten (wat tot
          // dubbele generatie zou leiden).
          result = await txManager.run(() => {
          const r = contractRepo.generateForPeriod(tenantId, contractGenerateMatch[1], user.email, { date: body.date, reason: body.reason }, (contract, ctx) => {
            const periodLabel = `${ctx.periodStart} t/m ${ctx.periodEnd}`;
            if (contract.generateType === "job") {
              const woNum = issueNumber(store, { tenant, docType: "workorder" }).number;
              return store.insert("workorders", {
                id: `wo_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                tenantId, number: woNum,
                title: `${contract.title} · ${ctx.periodKey}`,
                clientName: (customerRepo.findById(tenantId, contract.customerId) || {}).name || "",
                customerId: contract.customerId, projectId: contract.projectId || null,
                contractId: contract.id, assetIds: contract.assetIds || [],
                date: ctx.periodStart,
                status: "open", priority: "normaal",
                description: `Contractuele beurt (${contract.frequency}) · periode ${periodLabel}`,
                createdBy: user.id, createdAt: new Date().toISOString(),
              });
            }
            // Factuur: pro rata-berekening reproduceerbaar in de omschrijving.
            const cust = customerRepo.findById(tenantId, contract.customerId) || {};
            return createCustomerInvoice(store, tenant, user, {
              customerId: contract.customerId,
              customerName: cust.name || "",
              customerAddress: cust.address || "",
              customerVatNumber: cust.vatNumber || "",
              projectId: contract.projectId || null,
              notes: `Contract ${contract.number} · periode ${periodLabel}${ctx.prorata.factor !== 1 ? ` · pro rata ${ctx.prorata.daysCovered}/${ctx.prorata.daysTotal} dagen` : ""}`,
              lines: [{
                description: `${contract.title} · ${ctx.periodKey}${ctx.prorata.factor !== 1 ? ` (pro rata ${ctx.prorata.daysCovered}/${ctx.prorata.daysTotal}d)` : ""}`,
                qty: 1, unitPrice: ctx.amount, vatRate: contract.vatRate,
                sourceType: "contract", sourceId: contract.id,
              }],
            });
          });
          if (!r.alreadyGenerated) {
            store.audit({ actor: user.email, tenantId, action: "contract_generated", area: "contracts", detail: `${contractGenerateMatch[1]} · ${r.periodKey}` });
            emitDomainEvent(store, { tenantId, eventType: "contract.period_generated", aggregateType: "contract", aggregateId: contractGenerateMatch[1], actor: user.email, correlationId: res.wfpRequestId, data: { periodKey: r.periodKey, resultId: r.doc.id } });
          }
          return r;
          });
        }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        sendJson(res, result.alreadyGenerated ? 200 : 201, { ok: true, ...result });
        return;
      }
      if (contractItemMatch && req.method === "DELETE") {
        assertCan(user, "contracts");
        assertInteractiveUser(user);
        try { contractRepo.remove(tenantId, contractItemMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message }); }
        store.audit({ actor: user.email, tenantId, action: "contract_deleted", area: "contracts", detail: contractItemMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Service & Assets (E16/h44) ────────────────────────────────────────────
      if (action === "assets" && req.method === "GET") {
        assertCan(user, "service_assets");
        sendJson(res, 200, { ok: true, assets: assetRepo.list(tenantId, { type: url.searchParams.get("type") || undefined, customerId: url.searchParams.get("customerId") || undefined }) });
        return;
      }
      if (action === "assets" && req.method === "POST") {
        assertCan(user, "service_assets");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = assetRepo.insert(tenantId, body, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "asset_created", area: "assets", detail: `${row.name}${row.serial ? " · " + row.serial : ""}` });
        emitDomainEvent(store, { tenantId, eventType: "asset.created", aggregateType: "asset", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 201, { ok: true, asset: row });
        return;
      }
      const assetItemMatch = action.match(/^assets\/([^/]+)$/);
      if (assetItemMatch && req.method === "PATCH") {
        assertCan(user, "service_assets");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = assetRepo.update(tenantId, assetItemMatch[1], body, user.email, body.expectedVersion); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion }); }
        store.audit({ actor: user.email, tenantId, action: "asset_updated", area: "assets", detail: assetItemMatch[1] });
        sendJson(res, 200, { ok: true, asset: row });
        return;
      }
      if (assetItemMatch && req.method === "DELETE") {
        assertCan(user, "service_assets");
        assertInteractiveUser(user);
        try { assetRepo.remove(tenantId, assetItemMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message }); }
        store.audit({ actor: user.email, tenantId, action: "asset_deleted", area: "assets", detail: assetItemMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Onderhoudsschema's (E16/h34) ──────────────────────────────────────────
      if (action === "maintenance/plans" && req.method === "GET") {
        assertCan(user, "service_assets");
        sendJson(res, 200, { ok: true, plans: maintenancePlanRepo.list(tenantId, { assetId: url.searchParams.get("assetId") || undefined, status: url.searchParams.get("status") || undefined }) });
        return;
      }
      if (action === "maintenance/plans" && req.method === "POST") {
        assertCan(user, "service_assets");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try {
          const asset = body.assetId ? assetRepo.findById(tenantId, body.assetId) : null;
          if (body.assetId && !asset) return sendJson(res, 404, { ok: false, error: "Asset niet gevonden" });
          row = maintenancePlanRepo.insert(tenantId, body, user.email);
        }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "maintenance_plan_created", area: "assets", detail: `${row.title} · ${row.frequency}` });
        sendJson(res, 201, { ok: true, plan: row });
        return;
      }
      if (action === "maintenance/due" && req.method === "GET") {
        assertCan(user, "service_assets");
        const horizon = Math.min(Number(url.searchParams.get("horizonDays")) || 14, 90);
        sendJson(res, 200, { ok: true, due: maintenancePlanRepo.listDue(tenantId, horizon) });
        return;
      }
      const planItemMatch = action.match(/^maintenance\/plans\/([^/]+)$/);
      if (planItemMatch && req.method === "PATCH") {
        assertCan(user, "service_assets");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = maintenancePlanRepo.update(tenantId, planItemMatch[1], body, user.email, body.expectedVersion); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion }); }
        store.audit({ actor: user.email, tenantId, action: "maintenance_plan_updated", area: "assets", detail: planItemMatch[1] });
        sendJson(res, 200, { ok: true, plan: row });
        return;
      }
      const planGenerateMatch = action.match(/^maintenance\/plans\/([^/]+)\/generate$/);
      if (planGenerateMatch && req.method === "POST") {
        assertCan(user, "service_assets");
        assertApiKeyWriteAllowed(user, req);
        let result;
        try {
          result = maintenancePlanRepo.generateDueJob(tenantId, planGenerateMatch[1], user.email, (plan, dueDate) => {
            // Onderhoudsbeurt = werkbon (h44: technicus krijgt checklist mee).
            const asset = plan.assetId ? assetRepo.findById(tenantId, plan.assetId) : null;
            const woNum = issueNumber(store, { tenant, docType: "workorder" }).number;
            return store.insert("workorders", {
              id: `wo_${Date.now()}_${Math.random().toString(16).slice(2)}`,
              tenantId, number: woNum,
              title: `${plan.title}${asset ? ` · ${asset.name}` : ""}`,
              clientName: asset && asset.customerId ? (customerRepo.findById(tenantId, asset.customerId) || {}).name || "" : "",
              customerId: asset ? asset.customerId : null,
              venueId: asset ? asset.venueId : null,
              assetId: plan.assetId || null,
              maintenancePlanId: plan.id,
              date: dueDate,
              status: "open", priority: "normaal",
              description: `Periodiek onderhoud (${plan.frequency})${asset && asset.serial ? ` · serienr ${asset.serial}` : ""}`,
              checklist: (plan.checklist || []).map(label => ({ label, done: false })),
              createdBy: user.id, createdAt: new Date().toISOString(),
            });
          });
        }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        if (!result.alreadyGenerated) {
          store.audit({ actor: user.email, tenantId, action: "maintenance_job_generated", area: "assets", detail: `${planGenerateMatch[1]} · ${result.dueDate}` });
          emitDomainEvent(store, { tenantId, eventType: "maintenance.job_generated", aggregateType: "maintenance_plan", aggregateId: planGenerateMatch[1], actor: user.email, correlationId: res.wfpRequestId, data: { dueDate: result.dueDate, jobId: result.job.id } });
        }
        sendJson(res, result.alreadyGenerated ? 200 : 201, { ok: true, job: result.job, dueDate: result.dueDate, alreadyGenerated: result.alreadyGenerated, plan: result.plan });
        return;
      }
      if (planItemMatch && req.method === "DELETE") {
        assertCan(user, "service_assets");
        assertInteractiveUser(user);
        try { maintenancePlanRepo.remove(tenantId, planItemMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message }); }
        store.audit({ actor: user.email, tenantId, action: "maintenance_plan_deleted", area: "assets", detail: planItemMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Klanten (customers) · via de bronschakelaar (5.4 stap 5-7) ───────────
      // legacy | shadow | pg via CRM_READ_SOURCE. Dit zijn de canonieke routes
      // die als eerste schakelen; afgeleide naam-lookups elders blijven op de
      // synchrone legacy-repo tot hun eigen domein migreert.
      if (action === "customers" && req.method === "GET") {
        assertCan(user, "customers");
        const rows = await customerSource.list(tenantId);
        sendJson(res, 200, { ok: true, customers: redactSensitive(user, "customers", rows), source: customerSource.mode });
        return;
      }
      if (action === "customers" && req.method === "POST") {
        assertCan(user, "customers");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        // Custom fields (E10): valideer tegen gepubliceerde definities voor 'customer'.
        const cfCheck = configRepo.validateValues(tenantId, "customer", body.customFields);
        if (!cfCheck.ok) return sendJson(res, 400, { ok: false, error: "Ongeldige extra velden", code: "CUSTOM_FIELDS_INVALID", fieldErrors: cfCheck.errors });
        let row;
        try { row = await customerSource.insert(tenantId, { ...body, customFields: cfCheck.values }, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "customer_created", area: "customers", detail: row.name });
        emitDomainEvent(store, { tenantId, eventType: "customer.created", aggregateType: "customer", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 201, { ok: true, customer: row });
        return;
      }
      // ── Klant 360°-dossier (#76): CRM + finance in één klantbeeld + saldo ──
      const customerDossierMatch = action.match(/^customers\/([^/]+)\/dossier$/);
      if (customerDossierMatch && req.method === "GET") {
        assertCan(user, "customers");
        const c = (await customerSource.list(tenantId)).find(x => x.id === customerDossierMatch[1]);
        if (!c) return sendJson(res, 404, { ok: false, error: "Klant niet gevonden" });
        const dossier = customerDossier(store, tenantId, c);
        dossier.customer = redactSensitive(user, "customers", dossier.customer);
        dossier.related.quotes = redactSensitive(user, "quotes", dossier.related.quotes);
        sendJson(res, 200, { ok: true, dossier });
        return;
      }
      const customerMatch = action.match(/^customers\/([^/]+)$/);
      if (customerMatch && req.method === "PATCH") {
        assertCan(user, "customers");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = await customerSource.update(tenantId, customerMatch[1], body, user.email, body.expectedVersion); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion }); }
        store.audit({ actor: user.email, tenantId, action: "customer_updated", area: "customers", detail: customerMatch[1] });
        emitDomainEvent(store, { tenantId, eventType: "customer.updated", aggregateType: "customer", aggregateId: customerMatch[1], actor: user.email, correlationId: res.wfpRequestId, data: { changedFields: Object.keys(body) } });
        sendJson(res, 200, { ok: true, customer: row });
        return;
      }
      if (customerMatch && req.method === "DELETE") {
        assertCan(user, "customers");
        assertInteractiveUser(user);
        try { await customerSource.remove(tenantId, customerMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "customer_deleted", area: "customers", detail: customerMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Facturen (klantfacturen) ──────────────────────────────────────────────
      if (action === "facturen" && req.method === "GET") {
        assertInvoicing(user);
        // Legacy-leespad (autoriteit in legacy/shadow, performance-getuned):
        // h45-saldi in ÉÉN pas over de betalingen. Per factuur alle betalingen
        // scannen was kwadratisch en brak het performancebudget bij 1200
        // facturen × 400 betalingen (loadtest 2026-07-21: P95 > 1s).
        const legacyInvoices = () => {
          const rows = store.list("invoices", tenantId);
          const today = new Date().toISOString().slice(0, 10);
          const allocatedCents = new Map();
          for (const p of store.list("payments", tenantId)) {
            for (const a of (p.allocations || [])) {
              if (a.reversedAt) continue;
              allocatedCents.set(a.invoiceId, (allocatedCents.get(a.invoiceId) || 0) + Math.round(Number(a.amount || 0) * 100));
            }
          }
          return rows.map(inv => {
            const cents = allocatedCents.get(inv.id) || 0;
            const base = { ...inv, paidAmount: cents / 100, openAmount: Math.round(Number(inv.total || 0) * 100 - cents) / 100 };
            if (inv.status === "open" && inv.dueDate && inv.dueDate < today) return { ...base, status: "overdue" };
            return base;
          });
        };
        // P0-01: in pg-stand komt de lijst uit de genormaliseerde tabellen (saldo
        // = som over allocatie-rijen); in shadow leest pg mee (telemetrie).
        const invoices = await financeSource.readInvoices(tenantId, {}, legacyInvoices);
        sendJson(res, 200, { ok: true, invoices });
        return;
      }
      if (action === "facturen" && req.method === "POST") {
        assertInvoicing(user);
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        if (!body.customerName && !body.customerId) return sendJson(res, 400, { ok: false, error: "Klant is verplicht" });
        if (!Array.isArray(body.lines) || !body.lines.length) return sendJson(res, 400, { ok: false, error: "Minimaal 1 factuurregel vereist" });
        // Gedeelde factuurlogica (nummering, btw-regime, afronding, gestructureerde
        // mededeling) · identiek voor handmatig, offerte→factuur en werkbon→factuur.
        const invoice = createCustomerInvoice(store, tenant, user, body);
        sendJson(res, 201, { ok: true, invoice });
        return;
      }
      // ── Betalingen + allocatie (h45 · sluitstuk lead-to-cash) ────────────────
      if (action === "payments" && req.method === "GET") {
        assertInvoicing(user);
        const customerId = url.searchParams.get("customerId") || undefined;
        const invoiceId = url.searchParams.get("invoiceId") || undefined;
        // pg-stand leest betalingen uit de tabellen; het invoiceId-filter (dat
        // op actieve allocaties werkt) blijft op het legacy-pad tot dat filter
        // ook genormaliseerd is · legacy is en blijft de write-owner.
        const legacyPayments = () => paymentsModule.listPayments(store, tenantId, { customerId, invoiceId });
        const payments = invoiceId
          ? legacyPayments()
          : await financeSource.readPayments(tenantId, { customerId }, legacyPayments);
        sendJson(res, 200, { ok: true, payments });
        return;
      }
      if (action === "payments" && req.method === "POST") {
        assertInvoicing(user);
        assertApiKeyWriteAllowed(user, req);
        const payment = paymentsModule.registerPayment(store, tenant, user, await readBody(req));
        emitDomainEvent(store, { tenantId, eventType: "payment.registered", aggregateType: "payment", aggregateId: payment.id, actor: user.email, correlationId: res.wfpRequestId, data: { amount: payment.amount, method: payment.method } });
        sendJson(res, 201, { ok: true, payment });
        return;
      }
      const paymentItemMatch = action.match(/^payments\/([^/]+)$/);
      if (paymentItemMatch && req.method === "GET") {
        assertInvoicing(user);
        sendJson(res, 200, { ok: true, payment: paymentsModule.decorate(store, paymentsModule.getPayment(store, tenantId, paymentItemMatch[1])) });
        return;
      }
      const paymentSuggestMatch = action.match(/^payments\/([^/]+)\/suggestions$/);
      if (paymentSuggestMatch && req.method === "GET") {
        assertInvoicing(user);
        sendJson(res, 200, { ok: true, suggestions: paymentsModule.suggestAllocations(store, tenant, paymentSuggestMatch[1]) });
        return;
      }
      const paymentAllocateMatch = action.match(/^payments\/([^/]+)\/allocate$/);
      if (paymentAllocateMatch && req.method === "POST") {
        assertInvoicing(user);
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const result = paymentsModule.allocatePayment(store, tenant, user, paymentAllocateMatch[1], body.allocations);
        emitDomainEvent(store, { tenantId, eventType: "payment.allocated", aggregateType: "payment", aggregateId: result.payment.id, actor: user.email, correlationId: res.wfpRequestId, data: { allocations: result.allocations.map(a => ({ invoiceId: a.invoiceId, amount: a.amount })) } });
        for (const inv of result.invoicesPaid) {
          emitDomainEvent(store, { tenantId, eventType: "invoice.paid", aggregateType: "invoice", aggregateId: inv.id, actor: user.email, correlationId: res.wfpRequestId, data: { via: "payment_allocation", paymentId: result.payment.id } });
        }
        sendJson(res, 200, { ok: true, payment: result.payment, invoicesPaid: result.invoicesPaid.map(i => ({ id: i.id, number: i.number })) });
        return;
      }
      const paymentReverseMatch = action.match(/^payments\/([^/]+)\/allocations\/([^/]+)\/reverse$/);
      if (paymentReverseMatch && req.method === "POST") {
        assertInvoicing(user);
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const result = paymentsModule.reverseAllocation(store, tenant, user, paymentReverseMatch[1], paymentReverseMatch[2], body.reason);
        emitDomainEvent(store, { tenantId, eventType: "payment.allocation_reversed", aggregateType: "payment", aggregateId: result.payment.id, actor: user.email, correlationId: res.wfpRequestId, data: { invoiceId: result.allocation.invoiceId, amount: result.allocation.amount, reason: result.allocation.reason } });
        if (result.invoiceReopened) {
          emitDomainEvent(store, { tenantId, eventType: "invoice.reopened", aggregateType: "invoice", aggregateId: result.invoiceReopened.id, actor: user.email, correlationId: res.wfpRequestId, data: { via: "allocation_reversed", paymentId: result.payment.id } });
        }
        sendJson(res, 200, { ok: true, payment: result.payment, invoiceReopened: result.invoiceReopened ? { id: result.invoiceReopened.id, number: result.invoiceReopened.number } : null });
        return;
      }
      // Drill-down vanaf de factuur: welke betalingen dekken dit document.
      const invoicePaymentsMatch = action.match(/^facturen\/([^/]+)\/payments$/);
      if (invoicePaymentsMatch && req.method === "GET") {
        assertInvoicing(user);
        const inv = store.get("invoices", invoicePaymentsMatch[1]);
        if (!inv || inv.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Factuur niet gevonden" });
        sendJson(res, 200, { ok: true, ...paymentsModule.invoicePaymentState(store, tenantId, inv) });
        return;
      }

      // ── CIAW / Checkin@Work: aanwezigheidsaangifte voor een klokregistratie ──
      if (action === "ciaw/checkin" && req.method === "POST") {
        assertInteractiveUser(user);
        const body = await readBody(req);
        const clock = store.get("clocks", String(body.clockId || ""));
        if (!clock || clock.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Klokregistratie niet gevonden" });
        const clockUser = store.get("users", clock.userId) || null;
        const venue = clock.venueId ? store.get("venues", clock.venueId) : null;
        const result = await submitCheckin({ config: loadPlatformConfig(store), tenant, clock, user: clockUser, venue, action: body.action || "in" });
        const ciaw = { status: result.status, reference: result.reference || "", live: !!result.live, provider: result.provider, error: result.error || null, action: (body.action === "out" ? "OUT" : "IN"), at: new Date().toISOString() };
        store.update("clocks", clock.id, { ciaw });
        store.audit({ actor: user.email, tenantId, action: "ciaw_checkin", area: "clockings", detail: `${clock.id}:${ciaw.status}` });
        sendJson(res, result.ok ? 200 : 400, { ok: result.ok, ciaw, error: result.error || undefined });
        return;
      }
      if (action === "ciaw/declarations" && req.method === "GET") {
        assertCan(user, "clockings");
        const rows = store.list("clocks", tenantId)
          .filter(c => c.ciaw)
          .sort((a, b) => String(b.ciaw.at || "").localeCompare(String(a.ciaw.at || "")))
          .slice(0, 100)
          .map(c => ({ clockId: c.id, userId: c.userId, venueId: c.venueId, date: c.date, geoVerified: !!c.geoVerified, geoDistanceM: c.geoDistanceM ?? null, ...c.ciaw }));
        sendJson(res, 200, { ok: true, declarations: rows, rszEmployerId: (tenant.compliance && tenant.compliance.rszEmployerId) || "" });
        return;
      }
      // Aanwezigheidsregister voor werfcontrole (wie is nu ingeklokt + CIAW-status).
      if (action === "ciaw/presence" && req.method === "GET") {
        assertCan(user, "clockings");
        const reg = buildPresenceRegister({
          clocks: store.list("clocks", tenantId),
          users: store.list("users", tenantId),
          venues: store.list("venues", tenantId),
        });
        if (url.searchParams.get("format") === "csv") {
          const head = "werf,medewerker,insz,insz_geldig,sinds,ciaw_status,referentie";
          const lines = reg.rows.map(r => [r.venue, r.name, r.insz || "", r.inszValid ? "ja" : "nee", r.since || "", r.ciawStatus, r.ciawReference].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
          res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="aanwezigheidsregister-${reg.at.slice(0,10)}.csv"` });
          res.end([head, ...lines].join("\n"));
          return;
        }
        sendJson(res, 200, { ok: true, ...reg });
        return;
      }

      // ── A1 / Limosa · detachering van (onder)aannemers (compliance-add-on) ──
      if (action === "posted_workers" && req.method === "GET") {
        assertInteractiveUser(user);
        const ciawCfg = (loadPlatformConfig(store).ciaw) || {};
        const limosaMode = (ciawCfg.provider && ciawCfg.provider !== "mock" && !/DUMMY|replace|changeme|xxxx/i.test(String(ciawCfg.apiKey || ""))) ? "live" : "mock";
        sendJson(res, 200, { ok: true, ...listPostedWorkers(store, tenant), limosaMode });
        return;
      }
      if (action === "posted_workers" && req.method === "POST") {
        assertCan(user, "employees");
        sendJson(res, 201, { ok: true, record: createPostedWorker(store, tenant, await readBody(req), user) });
        return;
      }
      // A1-attest downloaden (base64 data-URL → bestand).
      const pwFileMatch = action.match(/^posted_workers\/([^/]+)\/file$/);
      if (pwFileMatch && req.method === "GET") {
        assertInteractiveUser(user);
        const rec = store.get("postedWorkers", pwFileMatch[1]);
        if (!rec || rec.tenantId !== tenantId || !rec.documentFile) return sendJson(res, 404, { ok: false, error: "Geen A1-bestand" });
        const m = /^data:([^;]+);base64,(.*)$/s.exec(String(rec.documentFile));
        if (!m) return sendJson(res, 422, { ok: false, error: "Bestandsformaat ongeldig" });
        const buf = Buffer.from(m[2], "base64");
        const ext = m[1] === "application/pdf" ? "pdf" : (m[1].split("/")[1] || "bin");
        res.writeHead(200, { "Content-Type": m[1], "Content-Disposition": `inline; filename="${(rec.documentFileName || "A1").replace(/[^\w.-]/g, "_")}.${ext}"` });
        res.end(buf);
        return;
      }
      const pwMatch = action.match(/^posted_workers\/([^/]+)(\/limosa)?$/);
      if (pwMatch) {
        const pwId = pwMatch[1];
        if (pwMatch[2] && req.method === "POST") {
          assertCan(user, "employees");
          const result = await submitLimosa(store, tenant, pwId, { config: loadPlatformConfig(store) }, user);
          sendJson(res, result.ok ? 200 : 400, { ok: result.ok, ...result });
          return;
        }
        if (req.method === "PUT") {
          assertCan(user, "employees");
          sendJson(res, 200, { ok: true, record: updatePostedWorker(store, tenant, pwId, await readBody(req), user) });
          return;
        }
        if (req.method === "DELETE") {
          assertCan(user, "employees");
          sendJson(res, 200, { ok: true, ...deletePostedWorker(store, tenant, pwId, user) });
          return;
        }
      }

      // ── Configureerbare documentsjablonen (factuur/offerte/werkbon) ──────────
      if (action === "templates" && req.method === "GET") {
        assertCan(user, "settings");
        const rows = store.list("templates", tenantId);
        sendJson(res, 200, { ok: true, templates: rows, types: tpl.DOCUMENT_TYPES, fields: tpl.FIELD_CATALOG, columns: Object.fromEntries(Object.entries(tpl.LINE_COLUMNS).map(([k, v]) => [k, v.label])) });
        return;
      }
      // Live preview van een (nog niet opgeslagen) concept-sjabloon.
      if (action === "templates/preview" && req.method === "POST") {
        assertCan(user, "settings");
        const body = await readBody(req);
        const type = tpl.isType(body.type) ? body.type : "invoice";
        const draft = tpl.normalizeTemplate(body, { type });
        sendJson(res, 200, { ok: true, html: tpl.renderDocument(draft, type, tpl.sampleDoc(type), tenant) });
        return;
      }
      if (action === "templates" && req.method === "POST") {
        assertCan(user, "settings");
        const body = await readBody(req);
        if (!tpl.isType(body.type)) return sendJson(res, 400, { ok: false, error: "Ongeldig documenttype" });
        const data = tpl.normalizeTemplate(body);
        if (data.isDefault) for (const t of store.list("templates", tenantId)) if (t.type === data.type && t.isDefault) store.update("templates", t.id, { isDefault: false });
        const row = store.insert("templates", { id: `tpl_${Date.now()}_${Math.random().toString(16).slice(2)}`, tenantId, ...data, createdAt: new Date().toISOString() });
        store.audit({ actor: user.email, tenantId, action: "template_created", area: "templates", detail: `${data.type}:${data.name}` });
        sendJson(res, 201, { ok: true, template: row });
        return;
      }
      const tplMatch = action.match(/^templates\/([^/]+)(\/preview|\/default)?$/);
      if (tplMatch) {
        const t = store.get("templates", tplMatch[1]);
        if (!t || t.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Sjabloon niet gevonden" });
        if (tplMatch[2] === "/preview" && req.method === "GET") {
          assertCan(user, "settings");
          sendJson(res, 200, { ok: true, html: tpl.renderDocument(t, t.type, tpl.sampleDoc(t.type), tenant) });
          return;
        }
        if (tplMatch[2] === "/default" && req.method === "POST") {
          assertCan(user, "settings");
          for (const o of store.list("templates", tenantId)) if (o.type === t.type && o.isDefault) store.update("templates", o.id, { isDefault: false });
          const row = store.update("templates", t.id, { isDefault: true });
          sendJson(res, 200, { ok: true, template: row });
          return;
        }
        if (req.method === "PUT") {
          assertCan(user, "settings");
          const data = tpl.normalizeTemplate(await readBody(req), t);
          if (data.isDefault) for (const o of store.list("templates", tenantId)) if (o.id !== t.id && o.type === data.type && o.isDefault) store.update("templates", o.id, { isDefault: false });
          const row = store.update("templates", t.id, data);
          store.audit({ actor: user.email, tenantId, action: "template_updated", area: "templates", detail: t.id });
          sendJson(res, 200, { ok: true, template: row });
          return;
        }
        if (req.method === "DELETE") {
          assertCan(user, "settings");
          store.remove("templates", t.id);
          store.audit({ actor: user.email, tenantId, action: "template_deleted", area: "templates", detail: t.id });
          sendJson(res, 200, { ok: true });
          return;
        }
      }
      // Render een echt document met het standaard-sjabloon (of ?templateId=) → print-HTML.
      const renderMatch = action.match(/^documents\/(invoice|quote|workorder)\/([^/]+)\/render$/);
      if (renderMatch && req.method === "GET") {
        assertInteractiveUser(user);
        const dType = renderMatch[1], docId = renderMatch[2];
        let doc = null;
        if (dType === "invoice") doc = store.get("invoices", docId) || ((tenant.billingOps && tenant.billingOps.invoiceHistory) || []).find(i => i.id === docId || i.number === docId);
        else if (dType === "quote") doc = store.get("quotes", docId);
        else if (dType === "workorder") doc = store.get("workorders", docId);
        if (!doc || (doc.tenantId && doc.tenantId !== tenantId)) return sendJson(res, 404, { ok: false, error: "Document niet gevonden" });
        const wantId = url.searchParams.get("templateId");
        const all = store.list("templates", tenantId).filter(t => t.type === dType);
        const chosen = (wantId && all.find(t => t.id === wantId)) || all.find(t => t.isDefault) || all[0] || tpl.defaultTemplate(dType);
        sendJson(res, 200, { ok: true, html: tpl.renderDocument(chosen, dType, doc, tenant), templateName: chosen.name });
        return;
      }

      // Peppol e-facturatie verzenden
      // Peppol-preflight (h47): documentvalidatie + kan de ontvanger BIS v3
      // ontvangen? Zo waarschuwt de UI VOOR het verzenden, niet erna.
      const invoicePeppolCheckMatch = action.match(/^facturen\/([^/]+)\/peppol\/check$/);
      if (invoicePeppolCheckMatch && req.method === "GET") {
        assertInvoicing(user);
        assertSubmoduleEnabled(store, user, tenant, "invoices", "peppol");
        const inv = store.get("invoices", invoicePeppolCheckMatch[1]);
        if (!inv || inv.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Factuur niet gevonden" });
        const validation = validatePeppol(inv, tenant);
        const cfg = loadPlatformConfig(store);
        const readiness = peppolTransportReadiness(cfg, config.isProduction);
        let participant = null;
        if (readiness.ok && readiness.transport === "billit" && inv.customerVatNumber) {
          try { participant = await require("./modules/peppol-billit").participantInfo(cfg.peppol || {}, inv.customerVatNumber); }
          catch (e) { participant = { registered: null, error: e.message, code: e.code }; }
        } else if (readiness.ok && readiness.transport === "mock") {
          participant = { registered: true, canReceiveInvoice: true, mock: true, note: "Mock-transport · geen echte netwerkcheck" };
        }
        sendJson(res, 200, { ok: true, validation, readiness: { mode: readiness.mode, provider: readiness.provider, ok: readiness.ok, message: readiness.message }, participant });
        return;
      }
      const invoicePeppolMatch = action.match(/^facturen\/([^/]+)\/peppol$/);
      if (invoicePeppolMatch && req.method === "POST") {
        assertInvoicing(user);
        assertSubmoduleEnabled(store, user, tenant, "invoices", "peppol");
        const inv = store.get("invoices", invoicePeppolMatch[1]);
        if (!inv || inv.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Factuur niet gevonden" });
        try {
          const result = await sendPeppolInvoice(store, tenant, inv);
          sendJson(res, 200, { ok: true, ...result });
        } catch (e) {
          sendJson(res, e.status || 400, { ok: false, error: e.message, errors: e.errors || [] });
        }
        return;
      }
      // UBL-XML downloaden / bekijken
      const invoiceUblMatch = action.match(/^facturen\/([^/]+)\/ubl$/);
      if (invoiceUblMatch && req.method === "GET") {
        assertInvoicing(user);
        const inv = store.get("invoices", invoiceUblMatch[1]);
        if (!inv || inv.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Factuur niet gevonden" });
        const xml = inv.ublXml || buildUbl(inv, tenant);
        res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${(inv.number||inv.id)}.xml"` });
        res.end(xml);
        return;
      }
      // Betaallink genereren (Stripe Checkout of mock-fallback)
      const invoicePayMatch = action.match(/^facturen\/([^/]+)\/payment-link$/);
      if (invoicePayMatch && req.method === "POST") {
        assertInvoicing(user);
        assertSubmoduleEnabled(store, user, tenant, "invoices", "online-payment");
        const inv = store.get("invoices", invoicePayMatch[1]);
        if (!inv || inv.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Factuur niet gevonden" });
        const link = await createPaymentLink(store, tenant, inv);
        store.audit({ actor: user.email, tenantId, action: "payment_link_created", area: "facturen", detail: `${inv.number} (${link.provider})` });
        sendJson(res, 200, { ok: true, url: link.url, provider: link.provider });
        return;
      }
      // Creditnota op een factuur (E08/h30): definitief document, corrigeert saldo.
      const invoiceCreditMatch = action.match(/^facturen\/([^/]+)\/credit$/);
      if (invoiceCreditMatch && req.method === "POST") {
        assertInvoicing(user);
        assertApiKeyWriteAllowed(user, req);
        const inv = store.get("invoices", invoiceCreditMatch[1]);
        if (!inv || inv.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Factuur niet gevonden" });
        if (inv.docType === "credit_note") return sendJson(res, 400, { ok: false, error: "Een creditnota kun je niet crediteren", code: "IS_CREDIT_NOTE" });
        const body = await readBody(req).catch(() => ({}));
        let credit;
        try { credit = createCreditNote(store, tenant, user, inv, { lineIndexes: body.lineIndexes, reason: body.reason }); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        sendJson(res, 201, { ok: true, creditNote: credit });
        return;
      }
      const invoiceItemMatch = action.match(/^facturen\/([^/]+)$/);
      if (invoiceItemMatch && req.method === "PATCH") {
        assertInvoicing(user);
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const inv = store.get("invoices", invoiceItemMatch[1]);
        if (!inv || inv.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Factuur niet gevonden" });
        const patch = { updatedAt: new Date().toISOString() };
        const allowedFields = ["status", "notes", "dueDate", "invoiceDate", "customerAddress", "customerVatNumber"];
        allowedFields.forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
        // Statusmachine (backend-handoff): beperkte set waarden; "paid" is een
        // eindtoestand (serverwaarheid via betaling/webhook) en kan niet worden
        // teruggedraaid of overschreven via een gewone PATCH.
        if (patch.status !== undefined) {
          const INVOICE_STATUSES = ["open", "paid", "overdue", "cancelled"];
          if (!INVOICE_STATUSES.includes(patch.status)) return sendJson(res, 400, { ok: false, error: `Ongeldige factuurstatus '${patch.status}'`, code: "INVALID_STATUS" });
          if (inv.status === "paid" && patch.status !== "paid") return sendJson(res, 409, { ok: false, error: "Een betaalde factuur kan niet van status veranderen", code: "INVOICE_PAID_FINAL" });
        }
        if (body.status === "paid" && !inv.paidAt) patch.paidAt = new Date().toISOString();
        const updated = store.update("invoices", invoiceItemMatch[1], patch);
        store.audit({ actor: user.email, tenantId, action: `invoice_${patch.status||"updated"}`, area: "facturen", detail: inv.number });
        if (patch.status === "paid" && inv.status !== "paid") {
          emitDomainEvent(store, { tenantId, eventType: "invoice.paid", aggregateType: "invoice", aggregateId: inv.id, actor: user.email, correlationId: res.wfpRequestId, data: { source: "manual" } });
        }
        sendJson(res, 200, { ok: true, invoice: updated });
        return;
      }
      if (invoiceItemMatch && req.method === "DELETE") {
        assertInvoicing(user);
        assertInteractiveUser(user);
        const inv = store.get("invoices", invoiceItemMatch[1]);
        if (!inv || inv.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Factuur niet gevonden" });
        if (inv.status === "paid") return sendJson(res, 400, { ok: false, error: "Betaalde facturen kunnen niet worden verwijderd", code: "INVOICE_PAID_FINAL" });
        if (inv.sentAt) return sendJson(res, 409, { ok: false, error: "Deze factuur is al verzonden · annuleer ze in plaats van ze te verwijderen", code: "INVOICE_ALREADY_SENT" });
        store.remove("invoices", invoiceItemMatch[1]);
        store.audit({ actor: user.email, tenantId, action: "invoice_deleted", area: "facturen", detail: inv.number });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Offertes (quotes) ─────────────────────────────────────────────────────
      if (action === "offertes" && req.method === "GET") {
        assertInvoicing(user);
        const today = new Date().toISOString().slice(0, 10);
        const rows = store.list("quotes", tenantId).map(q => {
          if (q.status === "verzonden" && q.validUntil && q.validUntil < today) return { ...q, status: "verlopen" };
          return q;
        });
        sendJson(res, 200, { ok: true, quotes: rows });
        return;
      }
      if (action === "offertes" && req.method === "POST") {
        assertInvoicing(user);
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        if (!body.customerName && !body.customerId) return sendJson(res, 400, { ok: false, error: "Klant is verplicht" });
        if (!Array.isArray(body.lines) || !body.lines.length) return sendJson(res, 400, { ok: false, error: "Minimaal 1 offerteregel vereist" });
        // Nummerreeks per onderneming (E01/PLT-BR-005): monotoon, geen hergebruik na delete.
        const issuedQuoteNo = issueNumber(store, { tenant, docType: "quote" });
        const number = issuedQuoteNo.number;
        const lines = body.lines.map(l => {
          const qty = Number(l.qty || 1);
          const unitPrice = Number(l.unitPrice || 0);
          const vatRate = Number(l.vatRate ?? 21);
          const lineSubtotal = round2(qty * unitPrice);
          const lineVat = round2(lineSubtotal * vatRate / 100);
          return { description: l.description || "", qty, unitPrice, vatRate, lineSubtotal, lineVat, lineTotal: round2(lineSubtotal + lineVat) };
        });
        const subtotal = round2(lines.reduce((s, l) => s + l.lineSubtotal, 0));
        const vatAmount = round2(lines.reduce((s, l) => s + l.lineVat, 0));
        const total = round2(subtotal + vatAmount);
        const quote = store.insert("quotes", {
          id: `quote_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId,
          companyId: issuedQuoteNo.companyId,
          number,
          projectId: body.projectId || null,   // E14: bronketen naar projectfinance
          customerId: body.customerId || null,
          customerName: body.customerName || "",
          customerAddress: body.customerAddress || "",
          customerVatNumber: body.customerVatNumber || "",
          status: "concept",
          quoteDate: body.quoteDate || new Date().toISOString().slice(0, 10),
          validUntil: body.validUntil || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
          lines, subtotal, vatAmount, total,
          notes: body.notes || "",
          publicToken: crypto.randomBytes(16).toString("hex"),
          version: 1, versions: [], documentHash: null,   // E05: versiebeheer
          sentAt: null, acceptedAt: null, rejectedAt: null,
          invoiceId: null, workorderId: null,
          createdBy: user.email,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        store.audit({ actor: user.email, tenantId, action: "quote_created", area: "offertes", detail: `${number} · €${total.toFixed(2)}` });
        emitDomainEvent(store, { tenantId, eventType: "quote.created", aggregateType: "quote", aggregateId: quote.id, actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 201, { ok: true, quote });
        return;
      }
      const quoteSendMatch = action.match(/^offertes\/([^/]+)\/send$/);
      if (quoteSendMatch && req.method === "POST") {
        assertInvoicing(user);
        const q = store.get("quotes", quoteSendMatch[1]);
        if (!q || q.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Offerte niet gevonden" });
        // E05: bevries de huidige versie als onveranderlijke snapshot met documenthash.
        const sentAtTs = new Date().toISOString();
        const frozen = freezeSentVersion({ ...q, version: q.version || 1 }, sentAtTs);
        const updated = store.update("quotes", q.id, { status: q.status === "concept" ? "verzonden" : q.status, sentAt: sentAtTs, ...frozen.patch, updatedAt: sentAtTs });
        const acceptUrl = `${config.appUrl}/offerte/${q.publicToken}`;
        // Eerlijke delivery-state (backend-handoff): de offerte-status is de
        // in-app-waarheid; `delivery` beschrijft wat er met de e-mail gebeurde.
        // Nooit "verzonden" claimen zonder actieve provider.
        const cust = q.customerId ? store.get("customers", q.customerId) : null;
        const to = cust?.email || null;
        const mail = to ? {
          to,
          subject: `Offerte ${q.number} van ${tenant.name || "Monargo One"}`,
          text: `Bekijk en aanvaard je offerte: ${acceptUrl}`,
          html: `<p>Beste,</p><p>Uw offerte <strong>${q.number}</strong> (totaal €${q.total.toFixed(2)}) staat klaar.</p><p><a href="${acceptUrl}">Bekijk en aanvaard de offerte</a></p>`,
        } : null;
        let delivery;
        if (!to) {
          delivery = { status: "failed", reason: "no_recipient", retryable: false };
        } else if (!isMailLive()) {
          // Log-provider voor QA-zichtbaarheid, maar rapporteer eerlijk "disabled".
          await sendMail(mail).catch(() => {});
          delivery = { status: "disabled", reason: "mail_not_configured", to };
        } else {
          try {
            const sent = await sendMail(mail);
            delivery = sent.ok === false
              ? { status: "failed", reason: sent.error || "provider_error", retryable: true, to }
              : { status: "sent", provider: sent.provider || null, to };
          } catch (e2) {
            delivery = { status: "failed", reason: e2.message, retryable: true, to };
          }
        }
        store.audit({ actor: user.email, tenantId, action: "quote_sent", area: "offertes", detail: `${q.number} · mail ${delivery.status}` });
        emitDomainEvent(store, { tenantId, eventType: "quote.version_sent", aggregateType: "quote", aggregateId: q.id, actor: user.email, correlationId: res.wfpRequestId, data: { deliveryStatus: delivery.status } });
        sendJson(res, 200, { ok: true, quote: updated, acceptUrl, delivery });
        return;
      }
      // E05: nieuwe revisie van een reeds verzonden offerte (immutable vorige versie).
      const quoteReviseMatch = action.match(/^offertes\/([^/]+)\/revise$/);
      if (quoteReviseMatch && req.method === "POST") {
        assertInvoicing(user);
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const q = store.get("quotes", quoteReviseMatch[1]);
        if (!q || q.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Offerte niet gevonden" });
        let patch;
        try { patch = reviseQuote({ ...q, version: q.version || 1 }, body.lines); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        const updated = store.update("quotes", q.id, patch);
        store.audit({ actor: user.email, tenantId, action: "quote_revised", area: "offertes", detail: `${q.number} → v${patch.version}` });
        emitDomainEvent(store, { tenantId, eventType: "quote.version_created", aggregateType: "quote", aggregateId: q.id, actor: user.email, correlationId: res.wfpRequestId, data: { version: patch.version } });
        sendJson(res, 200, { ok: true, quote: updated });
        return;
      }
      const quoteConvertMatch = action.match(/^offertes\/([^/]+)\/convert$/);
      if (quoteConvertMatch && req.method === "POST") {
        assertInvoicing(user);
        const body = await readBody(req);
        const q = store.get("quotes", quoteConvertMatch[1]);
        if (!q || q.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Offerte niet gevonden" });
        // Idempotent (backend-handoff): een tweede conversie geeft het bestaande
        // vervolgdocument terug in plaats van stil een duplicaat te maken.
        if (body.target === "workorder" && q.workorderId) {
          const existingWo = store.get("workorders", q.workorderId);
          if (existingWo) return sendJson(res, 200, { ok: true, workorder: existingWo, alreadyConverted: true, code: "QUOTE_ALREADY_CONVERTED" });
        }
        if (body.target !== "workorder" && q.invoiceId) {
          const existingInv = store.get("invoices", q.invoiceId);
          if (existingInv) return sendJson(res, 200, { ok: true, invoice: existingInv, alreadyConverted: true, code: "QUOTE_ALREADY_CONVERTED" });
        }
        // Zowel intern afgewezen als publiek geweigerd blokkeert conversie
        // (statusnamen worden pas bij E05 quote-versioning gecanonicaliseerd).
        if (["afgewezen", "geweigerd"].includes(q.status)) return sendJson(res, 409, { ok: false, error: "Een afgewezen offerte kan niet worden omgezet", code: "QUOTE_REJECTED" });
        if (body.target === "workorder") {
          const woNum = issueNumber(store, { tenant, docType: "workorder" }).number;
          const wo = store.insert("workorders", {
            id: `wo_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            tenantId, number: woNum,
            title: `Uit offerte ${q.number}`,
            clientName: q.customerName, customerId: q.customerId || null,
            projectId: q.projectId || null,
            status: "open", priority: "normaal",
            description: (q.lines || []).map(l => `${l.qty}× ${l.description}`).join("\n"),
            quoteId: q.id, createdBy: user.id, createdAt: new Date().toISOString()
          });
          store.update("quotes", q.id, { workorderId: wo.id, updatedAt: new Date().toISOString() });
          store.audit({ actor: user.email, tenantId, action: "quote_to_workorder", area: "offertes", detail: `${q.number} → ${woNum}` });
          emitDomainEvent(store, { tenantId, eventType: "quote.converted", aggregateType: "quote", aggregateId: q.id, actor: user.email, correlationId: res.wfpRequestId, data: { target: "workorder", resultId: wo.id } });
          sendJson(res, 201, { ok: true, workorder: wo });
          return;
        }
        // default: naar factuur
        const issuedInvNo = issueNumber(store, { tenant, docType: "invoice" });
        const invNum = issuedInvNo.number;
        const invoice = store.insert("invoices", {
          id: `inv_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId, companyId: issuedInvNo.companyId, number: invNum,
          projectId: q.projectId || null,
          customerId: q.customerId || null, customerName: q.customerName,
          customerAddress: q.customerAddress, customerVatNumber: q.customerVatNumber,
          status: "open",
          invoiceDate: new Date().toISOString().slice(0, 10),
          dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
          lines: (q.lines || []).map(l => ({ ...l, sourceType: "quote", sourceId: q.id })),
          subtotal: q.subtotal, vatAmount: q.vatAmount, total: q.total,
          notes: `Op basis van offerte ${q.number}`, quoteId: q.id,
          paidAt: null, sentAt: null, createdBy: user.email,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        });
        store.update("quotes", q.id, { invoiceId: invoice.id, updatedAt: new Date().toISOString() });
        store.audit({ actor: user.email, tenantId, action: "quote_to_invoice", area: "offertes", detail: `${q.number} → ${invNum}` });
        emitDomainEvent(store, { tenantId, eventType: "quote.converted", aggregateType: "quote", aggregateId: q.id, actor: user.email, correlationId: res.wfpRequestId, data: { target: "invoice", resultId: invoice.id } });
        emitDomainEvent(store, { tenantId, eventType: "invoice.created", aggregateType: "invoice", aggregateId: invoice.id, actor: user.email, correlationId: res.wfpRequestId, data: { source: "quote" } });
        sendJson(res, 201, { ok: true, invoice });
        return;
      }
      const quoteItemMatch = action.match(/^offertes\/([^/]+)$/);
      if (quoteItemMatch && req.method === "PATCH") {
        assertInvoicing(user);
        const body = await readBody(req);
        const q = store.get("quotes", quoteItemMatch[1]);
        if (!q || q.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Offerte niet gevonden" });
        const patch = { updatedAt: new Date().toISOString() };
        ["status", "notes", "validUntil", "quoteDate", "customerAddress", "customerVatNumber"].forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
        if (body.status === "aanvaard" && !q.acceptedAt) patch.acceptedAt = new Date().toISOString();
        if (body.status === "geweigerd" && !q.rejectedAt) patch.rejectedAt = new Date().toISOString();
        const updated = store.update("quotes", q.id, patch);
        store.audit({ actor: user.email, tenantId, action: `quote_${patch.status||"updated"}`, area: "offertes", detail: q.number });
        sendJson(res, 200, { ok: true, quote: updated });
        return;
      }
      if (quoteItemMatch && req.method === "DELETE") {
        assertInvoicing(user);
        assertInteractiveUser(user);
        const q = store.get("quotes", quoteItemMatch[1]);
        if (!q || q.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Offerte niet gevonden" });
        store.remove("quotes", q.id);
        store.audit({ actor: user.email, tenantId, action: "quote_deleted", area: "offertes", detail: q.number });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Locaties / Venues ─────────────────────────────────────────────────────
      // ── Afspraken bij de klant (+ automatische reminder) ────────────────
      if (action === "appointments" && req.method === "GET") {
        assertCan(user, "planning");
        const rows = store.list("appointments", tenantId)
          .slice()
          .sort((a, b) => `${a.date} ${a.start || ""}`.localeCompare(`${b.date} ${b.start || ""}`));
        sendJson(res, 200, { ok: true, appointments: rows });
        return;
      }
      if (action === "appointments" && req.method === "POST") {
        assertCan(user, "planning");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const clean = normalizeAppointment(body);
        const row = store.insert("appointments", {
          id: `apt_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId, ...clean, reminderSentAt: null,
          createdBy: user.email, createdAt: new Date().toISOString()
        });
        store.audit({ actor: user.email, tenantId, action: "appointment_created", area: "appointments", detail: `${clean.date} ${clean.start} · ${clean.customerName}` });
        sendJson(res, 201, { ok: true, appointment: row });
        return;
      }
      const aptMatch = action.match(/^appointments\/([^/]+)$/);
      if (aptMatch && req.method === "PATCH") {
        assertCan(user, "planning");
        assertApiKeyWriteAllowed(user, req);
        const existingApt = store.list("appointments", tenantId).find(a => a.id === aptMatch[1]);
        if (!existingApt) return sendJson(res, 404, { ok: false, error: "Afspraak niet gevonden" });
        const body = await readBody(req);
        const clean = normalizeAppointment(body, existingApt);
        // Verschuift de afspraak of wijzigt het reminder-venster → reminder mag opnieuw.
        const resetReminder = clean.date !== existingApt.date || clean.start !== existingApt.start || clean.reminderDays !== existingApt.reminderDays;
        const row = store.update("appointments", existingApt.id, {
          ...clean,
          ...(resetReminder ? { reminderSentAt: null } : {}),
          updatedAt: new Date().toISOString()
        });
        store.audit({ actor: user.email, tenantId, action: "appointment_updated", area: "appointments", detail: `${clean.date} ${clean.start} · ${clean.customerName}` });
        sendJson(res, 200, { ok: true, appointment: row });
        return;
      }
      if (aptMatch && req.method === "DELETE") {
        assertCan(user, "planning");
        assertApiKeyWriteAllowed(user, req);
        const existingApt = store.list("appointments", tenantId).find(a => a.id === aptMatch[1]);
        if (!existingApt) return sendJson(res, 404, { ok: false, error: "Afspraak niet gevonden" });
        store.remove("appointments", existingApt.id);
        store.audit({ actor: user.email, tenantId, action: "appointment_deleted", area: "appointments", detail: `${existingApt.date} ${existingApt.start} · ${existingApt.customerName}` });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Werkongevallen (register + aangifte-opvolging) ──────────────────
      if (action === "incidents" && req.method === "GET") {
        assertCan(user, "incidents");
        const rows = store.list("incidents", tenantId)
          .slice()
          .sort((a, b) => `${b.date} ${b.time || ""}`.localeCompare(`${a.date} ${a.time || ""}`));
        if (url.searchParams.get("format") === "csv") {
          res.writeHead(200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="werkongevallen-${new Date().toISOString().slice(0, 10)}.csv"`,
            "Cache-Control": "no-store"
          });
          res.end(incidentsToCsv(rows));
          return;
        }
        sendJson(res, 200, { ok: true, incidents: rows });
        return;
      }
      if (action === "incidents" && req.method === "POST") {
        assertCan(user, "incidents");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const clean = normalizeIncident(body);
        const row = store.insert("incidents", {
          id: `inc_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId, ...clean,
          createdBy: user.email, createdAt: new Date().toISOString()
        });
        store.audit({ actor: user.email, tenantId, action: "incident_created", area: "incidents", detail: `${clean.date} · ${clean.employeeName} · ${clean.severity}` });
        sendJson(res, 201, { ok: true, incident: row });
        return;
      }
      // Publiato-dossier (Fedris · arbeidsongevallen-aangifte): het portaal
      // heeft geen publieke API, dus dit levert het complete overtypbare
      // dossier + de wettelijke deadline-status uit incidentDeadline.
      const incPubliatoMatch = action.match(/^incidents\/([^/]+)\/publiato$/);
      if (incPubliatoMatch && req.method === "GET") {
        assertCan(user, "incidents");
        const inc = store.list("incidents", tenantId).find(i => i.id === incPubliatoMatch[1]);
        if (!inc) return sendJson(res, 404, { ok: false, error: "Werkongeval niet gevonden" });
        const emp = inc.employeeId ? store.list("employees", tenantId).find(e => e.id === inc.employeeId) : null;
        const dl = incidentDeadline(inc);
        sendJson(res, 200, { ok: true, deadline: dl, dossier: {
          werkgever: {
            naam: tenant.name || "", rszNummer: (tenant.compliance && tenant.compliance.rszEmployerId) || "",
            ondernemingsnummer: (tenant.invoiceProfile && (tenant.invoiceProfile.companyNumber || tenant.invoiceProfile.vat)) || "",
          },
          slachtoffer: { naam: inc.employeeName, insz: (emp && emp.insz) || "", functie: (emp && emp.jobTitle) || "" },
          ongeval: {
            datum: inc.date, uur: inc.time || "", plaats: inc.location || "",
            ernst: inc.severity, omschrijving: inc.description, getuigen: inc.witnesses || "",
          },
          status: { verzekeraarIngelicht: !!inc.insurerReportedAt, verzekeraarIngelichtOp: inc.insurerReportedAt || null,
            deadlineVerzekeraar: dl.deadline, ernstigOngeval: dl.serious, onmiddellijkMelden: dl.immediate },
        } });
        return;
      }
      const incMatch = action.match(/^incidents\/([^/]+)$/);
      if (incMatch && req.method === "PATCH") {
        assertCan(user, "incidents");
        assertApiKeyWriteAllowed(user, req);
        const existingInc = store.list("incidents", tenantId).find(i => i.id === incMatch[1]);
        if (!existingInc) return sendJson(res, 404, { ok: false, error: "Werkongeval niet gevonden" });
        const body = await readBody(req);
        const clean = normalizeIncident(body, existingInc);
        const row = store.update("incidents", existingInc.id, { ...clean, updatedAt: new Date().toISOString() });
        store.audit({ actor: user.email, tenantId, action: "incident_updated", area: "incidents", detail: `${clean.date} · ${clean.employeeName} · ${clean.severity}` });
        sendJson(res, 200, { ok: true, incident: row });
        return;
      }
      if (incMatch && req.method === "DELETE") {
        assertCan(user, "incidents");
        assertApiKeyWriteAllowed(user, req);
        const existingInc = store.list("incidents", tenantId).find(i => i.id === incMatch[1]);
        if (!existingInc) return sendJson(res, 404, { ok: false, error: "Werkongeval niet gevonden" });
        store.remove("incidents", existingInc.id);
        store.audit({ actor: user.email, tenantId, action: "incident_deleted", area: "incidents", detail: `${existingInc.date} · ${existingInc.employeeName}` });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Onderneming (E01): default-company van deze tenant ──────────────
      if (action === "company" && req.method === "GET") {
        assertCan(user, "settings");
        // P0-01: geschakelde leesroute · in pg-stand komt de default-company uit
        // de tabel; schrijven (ensureDefaultCompany) blijft de write-owner.
        const company = await companySource.readDefaultCompany(tenantId, () => ensureDefaultCompany(store, tenant));
        sendJson(res, 200, { ok: true, company });
        return;
      }

      // ── Klantvragen (Inbox · e-mail-intake) ─────────────────────────────
      if (action === "inquiries/intake-config" && req.method === "GET") {
        assertCan(user, "customers");
        const intake = ensureIntake(store, tenant);
        sendJson(res, 200, { ok: true, intake: {
          address: intakeAddress(tenant, config),
          enabled: intake.enabled !== false,
          // Zonder INBOUND_MAIL_SECRET is de webhook nog niet aangesloten op
          // een provider · de UI toont dan dat intake in testmodus staat.
          live: !!config.inboundMail.secret,
        } });
        return;
      }
      if (action === "inquiries/intake-config" && req.method === "POST") {
        assertCan(user, "settings");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const intake = { ...ensureIntake(store, tenant) };
        if (body.regenerate) intake.token = newIntakeToken();
        if (typeof body.enabled === "boolean") intake.enabled = body.enabled;
        store.updateTenant(tenant.id, { intake });
        tenant.intake = intake;
        store.audit({ actor: user.email, tenantId, action: "intake_config_updated", area: "inbox", detail: body.regenerate ? "adres vernieuwd" : `enabled=${intake.enabled !== false}` });
        sendJson(res, 200, { ok: true, intake: { address: intakeAddress(tenant, config), enabled: intake.enabled !== false, live: !!config.inboundMail.secret } });
        return;
      }
      if (action === "inquiries" && req.method === "GET") {
        assertCan(user, "customers");
        const rows = store.list("inquiries", tenantId)
          .slice()
          .sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")));
        sendJson(res, 200, { ok: true, inquiries: rows });
        return;
      }
      if (action === "inquiries" && req.method === "POST") {
        // Handmatige klantvraag (telefoon/balie) in dezelfde Inbox.
        assertCan(user, "customers");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const fromEmail = String(body.fromEmail || "").trim().toLowerCase();
        if (fromEmail && !fromEmail.includes("@")) return sendJson(res, 400, { ok: false, error: "Geldig e-mailadres van de klant is vereist" });
        if (!String(body.subject || "").trim() && !String(body.text || "").trim()) return sendJson(res, 400, { ok: false, error: "Onderwerp of omschrijving is verplicht" });
        const result = createInquiry(store, tenant, {
          fromEmail: fromEmail || "-",
          fromName: String(body.fromName || "").trim(),
          subject: String(body.subject || "").trim() || "(geen onderwerp)",
          text: String(body.text || "").trim(),
          messageId: null,
        }, "handmatig");
        sendJson(res, 201, { ok: true, inquiry: result.inquiry });
        return;
      }
      const inqMatch = action.match(/^inquiries\/([^/]+)$/);
      if (inqMatch && inqMatch[1] !== "intake-config" && req.method === "PATCH") {
        assertCan(user, "customers");
        assertApiKeyWriteAllowed(user, req);
        const existingInq = store.list("inquiries", tenantId).find(q => q.id === inqMatch[1]);
        if (!existingInq) return sendJson(res, 404, { ok: false, error: "Klantvraag niet gevonden" });
        const body = await readBody(req);
        const patch = { updatedAt: new Date().toISOString() };
        if (body.status !== undefined) {
          if (!INQUIRY_STATUSES.includes(body.status)) return sendJson(res, 400, { ok: false, error: "Ongeldige status" });
          patch.status = body.status;
        }
        if (body.customerId !== undefined) {
          const cust = body.customerId ? store.list("customers", tenantId).find(c => c.id === body.customerId) : null;
          if (body.customerId && !cust) return sendJson(res, 400, { ok: false, error: "Klant niet gevonden" });
          patch.customerId = cust ? cust.id : null;
          patch.customerName = cust ? cust.name : null;
        }
        const row = store.update("inquiries", existingInq.id, patch);
        store.audit({ actor: user.email, tenantId, action: "inquiry_updated", area: "inbox", detail: `${existingInq.subject} → ${patch.status || existingInq.status}` });
        sendJson(res, 200, { ok: true, inquiry: row });
        return;
      }
      if (inqMatch && inqMatch[1] !== "intake-config" && req.method === "DELETE") {
        assertCan(user, "customers");
        assertApiKeyWriteAllowed(user, req);
        const existingInq = store.list("inquiries", tenantId).find(q => q.id === inqMatch[1]);
        if (!existingInq) return sendJson(res, 404, { ok: false, error: "Klantvraag niet gevonden" });
        store.remove("inquiries", existingInq.id);
        store.audit({ actor: user.email, tenantId, action: "inquiry_deleted", area: "inbox", detail: existingInq.subject });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── AI-offerte-estimatie (add-on ai_estimate · altijd concept, mens keurt goed) ──
      if (action === "estimate" && req.method === "POST") {
        assertInvoicing(user);
        assertInteractiveUser(user);
        const body = await readBody(req);
        let question = String(body.question || "").trim();
        let inquiry = null;
        if (body.inquiryId) {
          inquiry = store.list("inquiries", tenantId).find(q => q.id === body.inquiryId);
          if (!inquiry) return sendJson(res, 404, { ok: false, error: "Klantvraag niet gevonden" });
          question = [inquiry.subject, inquiry.text].filter(Boolean).join("\n\n");
        }
        if (!question) return sendJson(res, 400, { ok: false, error: "Omschrijf de klantvraag (of kies een klantvraag uit de Inbox)" });
        try {
          const estimate = await estimateFromQuestion(store, tenant, question);
          store.audit({ actor: user.email, tenantId, action: "quote_estimated", area: "offertes", detail: `${estimate.mock ? "mock" : "ai"} · ${estimate.lines.length} regels · ${question.slice(0, 60)}` });
          sendJson(res, 200, { ok: true, estimate, prefill: {
            customerId: inquiry ? inquiry.customerId : null,
            customerName: inquiry ? (inquiry.customerName || inquiry.fromName || "") : "",
          } });
        } catch (e) {
          sendJson(res, e.status || 502, { ok: false, error: e.message });
        }
        return;
      }

      if (action === "venues" && req.method === "GET") {
        assertCan(user, "venues");
        sendJson(res, 200, { ok: true, venues: store.list("venues", tenantId) });
        return;
      }
      if (action === "venues" && req.method === "POST") {
        assertCan(user, "venues");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        if (!String(body.name||"").trim()) return sendJson(res, 400, { ok: false, error: "Naam is verplicht" });
        const row = store.insert("venues", {
          id: `venue_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId, ...body, active: body.active !== false, createdAt: new Date().toISOString()
        });
        store.audit({ actor: user.email, tenantId, action: "venue_created", area: "venues", detail: body.name });
        emitDomainEvent(store, { tenantId, eventType: "location.created", aggregateType: "location", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 201, { ok: true, venue: row });
        return;
      }
      const venueMatch = action.match(/^venues\/([^/]+)$/);
      if (venueMatch && req.method === "PATCH") {
        assertCan(user, "venues");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const row = store.update("venues", venueMatch[1], { ...body, updatedAt: new Date().toISOString() });
        store.audit({ actor: user.email, tenantId, action: "venue_updated", area: "venues", detail: venueMatch[1] });
        sendJson(res, 200, { ok: true, venue: row });
        return;
      }
      if (venueMatch && req.method === "DELETE") {
        assertCan(user, "venues");
        assertApiKeyWriteAllowed(user, req);
        const venue = (store.data.venues || []).find(v => v.id === venueMatch[1] && v.tenantId === tenantId);
        if (!venue) return sendJson(res, 404, { ok: false, error: "Locatie niet gevonden" });
        store.remove("venues", venueMatch[1]);
        store.audit({ actor: user.email, tenantId, action: "venue_deleted", area: "venues", detail: venue.name || venueMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Medewerkers ophalen ───────────────────────────────────────────────────
      // ── Portfolio, baseline en capaciteitsforecast (h38/PPL) ─────────────────
      if (action === "portfolio" && req.method === "GET") {
        assertCan(user, "projects");
        sendJson(res, 200, { ok: true, portfolio: buildPortfolio(store, tenant) });
        return;
      }
      if (action === "portfolio/capacity" && req.method === "GET") {
        assertCan(user, "planning");
        sendJson(res, 200, { ok: true, capacity: buildCapacityForecast(store, tenant, {
          from: url.searchParams.get("from") || undefined,
          to: url.searchParams.get("to") || undefined,
          bucket: url.searchParams.get("bucket") || "month",
        }) });
        return;
      }
      // Baseline vastleggen: momentopname van de fasering om later tegen af te zetten.
      const projectBaselineMatch = action.match(/^projects\/([^/]+)\/baseline$/);
      if (projectBaselineMatch && req.method === "POST") {
        assertCan(user, "projects");
        assertApiKeyWriteAllowed(user, req);
        const project = projectRepo.findById(tenantId, projectBaselineMatch[1]);
        if (!project) return sendJson(res, 404, { ok: false, error: "Project niet gevonden" });
        const patch = captureBaseline(project, user.email);
        const saved = store.update("projects", project.id, patch);
        store.audit({ actor: user.email, tenantId, action: "project_baseline_captured", area: "projects", detail: project.number || project.id });
        sendJson(res, 200, { ok: true, project: saved, comparison: comparePhases(saved) });
        return;
      }
      if (projectBaselineMatch && req.method === "GET") {
        assertCan(user, "projects");
        const project = projectRepo.findById(tenantId, projectBaselineMatch[1]);
        if (!project) return sendJson(res, 404, { ok: false, error: "Project niet gevonden" });
        sendJson(res, 200, { ok: true, comparison: comparePhases(project) });
        return;
      }
      // Forecastregel toevoegen · de historiek wordt nooit gewist (h38).
      const projectForecastMatch = action.match(/^projects\/([^/]+)\/forecast$/);
      if (projectForecastMatch && req.method === "POST") {
        assertCan(user, "projects");
        assertApiKeyWriteAllowed(user, req);
        const project = projectRepo.findById(tenantId, projectForecastMatch[1]);
        if (!project) return sendJson(res, 404, { ok: false, error: "Project niet gevonden" });
        const body = await readBody(req);
        const patch = appendForecast(project, { amount: body.amount, probability: body.probability, source: body.source, sourceId: body.sourceId, reason: body.reason, actor: user.email });
        const saved = store.update("projects", project.id, patch);
        emitDomainEvent(store, { tenantId, eventType: "project.forecast_updated", aggregateType: "project", aggregateId: project.id, actor: user.email, correlationId: res.wfpRequestId, data: { amount: patch.forecastAmount } });
        sendJson(res, 201, { ok: true, project: saved, forecast: currentForecast(saved) });
        return;
      }
      if (projectForecastMatch && req.method === "GET") {
        assertCan(user, "projects");
        const project = projectRepo.findById(tenantId, projectForecastMatch[1]);
        if (!project) return sendJson(res, 404, { ok: false, error: "Project niet gevonden" });
        sendJson(res, 200, { ok: true, history: project.forecastHistory || [], current: currentForecast(project) });
        return;
      }

      // ── Canonieke Forms-capability (Forms-handover F1) ──────────────────────
      // Genormaliseerde, versie-onveranderlijke, RLS-geïsoleerde formulieren met
      // veld-/classificatierechten en segregation of duties. Distincte paden
      // (form-definitions/*, form-instances/*) naast de legacy work-os forms/* ;
      // de strangler unificeert die later. De handler bezit rechten + veldredactie.
      if (formsApi.isFormsAction(action)) {
        if (!formsRepo) return sendJson(res, 503, { ok: false, code: "FORMS_REQUIRES_PG", error: "De canonieke Forms-capability vereist PostgreSQL." });
        // CTO2-01/02: de rechten (action + record-scope) leven in de handler zelf
        // (forms-authz) · GEEN blanket settings-gate meer: die maakte starten te
        // streng en muteren te ruim. Hier alleen de transportgates: geen API-key-
        // schrijfacties zonder toestemming, en beheer alleen interactief.
        if (req.method !== "GET") assertApiKeyWriteAllowed(user, req);
        if ((action.startsWith("form-retention") || action.startsWith("form-reminders")) && req.method !== "GET") assertInteractiveUser(user);
        const needsBody = req.method === "POST" || req.method === "PATCH" || req.method === "PUT";
        const body = needsBody ? await readBody(req) : {};
        const formsTenant = (store.data.tenants || []).find(t => t.id === tenantId) || null;
        const entitlements = formsTenant ? resolveTenantModules(store, formsTenant) : [];
        // Autorisatiecontext: e-mails van teamgenoten voor de team-scope.
        const teamEmails = new Set(user && user.teamId
          ? (store.data.users || []).filter(u => u.tenantId === tenantId && u.teamId === user.teamId).map(u => u.email)
          : []);
        const r = await formsApi.handleFormsRoute(formsRepo, { user, tenantId, method: req.method, action, body, req, entitlements, ctx: { teamEmails } });
        if (r) {
          if (r.headers) for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
          if (r.status >= 200 && r.status < 300 && req.method !== "GET") {
            store.audit({ actor: user.email, tenantId, action: "forms_" + req.method.toLowerCase(), area: "forms", detail: action });
          }
          return sendJson(res, r.status, r.payload);
        }
      }

      // Strangler (finale CTO-directive · één engine): met FORMS_SOURCE=pg is de
      // canonieke engine de waarheid en is het legacy work-os SCHRIJFPAD bevroren.
      // Lezen blijft toegestaan voor historiek; schrijven wijst naar de nieuwe paden.
      if (config.forms.source === "pg" && req.method !== "GET" &&
          (action.startsWith("forms/templates") || action.startsWith("forms/instances"))) {
        return sendJson(res, 410, {
          ok: false, code: "FORMS_LEGACY_FROZEN",
          error: "Het legacy formulier-schrijfpad is bevroren. Gebruik form-definitions/* en form-instances/* (canonieke Forms-engine).",
        });
      }

      // ── Work OS-kern · formulieren, taken, bestanden, communicatie (h39/DOC) ──
      // Formulierdesigner
      if (action === "forms/templates" && req.method === "GET") {
        sendJson(res, 200, { ok: true, templates: formTemplateRepo.list(tenantId, { status: url.searchParams.get("status") || undefined, appliesTo: url.searchParams.get("appliesTo") || undefined }) });
        return;
      }
      if (action === "forms/templates" && req.method === "POST") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        let row;
        try { row = formTemplateRepo.insert(tenantId, await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "form_template_created", area: "forms", detail: row.name });
        sendJson(res, 201, { ok: true, template: row });
        return;
      }
      const formTplMatch = action.match(/^forms\/templates\/([^/]+)$/);
      if (formTplMatch && req.method === "PATCH") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        let row;
        try { row = formTemplateRepo.update(tenantId, formTplMatch[1], await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        sendJson(res, 200, { ok: true, template: row });
        return;
      }
      const formTplTransitionMatch = action.match(/^forms\/templates\/([^/]+)\/transition$/);
      if (formTplTransitionMatch && req.method === "POST") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        const body = await readBody(req);
        let row;
        try { row = formTemplateRepo.transition(tenantId, formTplTransitionMatch[1], body.status, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        sendJson(res, 200, { ok: true, template: row });
        return;
      }
      // Formulierinvulling · gestructureerde antwoorden, filterbaar via de API
      if (action === "forms/instances" && req.method === "GET") {
        sendJson(res, 200, { ok: true, instances: formInstanceRepo.list(tenantId, {
          templateId: url.searchParams.get("templateId") || undefined,
          entityType: url.searchParams.get("entityType") || undefined,
          entityId: url.searchParams.get("entityId") || undefined,
          status: url.searchParams.get("status") || undefined,
        }) });
        return;
      }
      if (action === "forms/instances" && req.method === "POST") {
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = formInstanceRepo.start(tenantId, body, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        sendJson(res, 201, { ok: true, instance: row });
        return;
      }
      const formInstMatch = action.match(/^forms\/instances\/([^/]+)$/);
      if (formInstMatch && req.method === "PATCH") {
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = formInstanceRepo.saveAnswers(tenantId, formInstMatch[1], body.answers, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        sendJson(res, 200, { ok: true, instance: row });
        return;
      }
      const formSubmitMatch = action.match(/^forms\/instances\/([^/]+)\/(submit|lock|photo)$/);
      if (formSubmitMatch && req.method === "POST") {
        assertApiKeyWriteAllowed(user, req);
        const op = formSubmitMatch[2];
        let row;
        try {
          if (op === "submit") row = formInstanceRepo.submit(tenantId, formSubmitMatch[1], user.email);
          else if (op === "lock") row = formInstanceRepo.lock(tenantId, formSubmitMatch[1], user.email);
          else row = formInstanceRepo.attachPhoto(tenantId, formSubmitMatch[1], await readBody(req), user.email);
        }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, missing: e.missing, invalid: e.invalid }); }
        if (op === "submit") emitDomainEvent(store, { tenantId, eventType: "form.submitted", aggregateType: "form_instance", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId, data: { templateKey: row.templateKey, context: row.context } });
        sendJson(res, 200, { ok: true, instance: row });
        return;
      }

      // Taken
      if (action === "tasks" && req.method === "GET") {
        const mine = url.searchParams.get("mine") === "1";
        sendJson(res, 200, { ok: true, tasks: taskRepo.list(tenantId, {
          assigneeId: mine ? user.id : (url.searchParams.get("assigneeId") || undefined),
          teamId: url.searchParams.get("teamId") || undefined,
          status: url.searchParams.get("status") || undefined,
          entityType: url.searchParams.get("entityType") || undefined,
          entityId: url.searchParams.get("entityId") || undefined,
          overdueOn: url.searchParams.get("overdue") === "1" ? new Date().toISOString().slice(0, 10) : undefined,
        }) });
        return;
      }
      if (action === "tasks" && req.method === "POST") {
        assertApiKeyWriteAllowed(user, req);
        let row;
        try { row = taskRepo.insert(tenantId, await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        emitDomainEvent(store, { tenantId, eventType: "task.created", aggregateType: "task", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId, data: { context: row.context, assigneeId: row.assigneeId } });
        sendJson(res, 201, { ok: true, task: row });
        return;
      }
      const taskItemMatch = action.match(/^tasks\/([^/]+)$/);
      if (taskItemMatch && req.method === "PATCH") {
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = taskRepo.update(tenantId, taskItemMatch[1], body, user.email, body.expectedVersion); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion }); }
        sendJson(res, 200, { ok: true, task: row });
        return;
      }
      if (taskItemMatch && req.method === "DELETE") {
        assertInteractiveUser(user);
        try { taskRepo.remove(tenantId, taskItemMatch[1]); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        sendJson(res, 200, { ok: true });
        return;
      }
      const taskTransitionMatch = action.match(/^tasks\/([^/]+)\/transition$/);
      if (taskTransitionMatch && req.method === "POST") {
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = taskRepo.transition(tenantId, taskTransitionMatch[1], body.status, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        sendJson(res, 200, { ok: true, task: row });
        return;
      }

      // Bestanden · versies en geauditeerde downloads
      if (action === "docfiles" && req.method === "GET") {
        sendJson(res, 200, { ok: true, files: fileRepo.list(tenantId, { entityType: url.searchParams.get("entityType") || undefined, entityId: url.searchParams.get("entityId") || undefined }) });
        return;
      }
      if (action === "docfiles" && req.method === "POST") {
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try {
          // Inhoud loopt via de objectopslag-poort (handover 4.2): de key wordt
          // SERVER-SIDE gebouwd met tenantcontext, dus een client kan nooit een
          // pad kiezen. Zonder inhoud blijft dit puur metadata (bv. een
          // vooraf-ondertekende upload die al gebeurd is).
          if (body.content) {
            const stored = await objectStorage.put({
              tenantId,
              scope: (body.context && body.context.entityType) || "general",
              extension: String(body.name || "").split(".").pop(),
              content: Buffer.from(String(body.content), body.encoding === "base64" ? "base64" : "utf8"),
              mimeType: body.mimeType,
              fileName: body.name,
            });
            body.storageRef = stored.key;
            body.size = stored.size;
            body.hash = stored.checksum;
          }
          row = fileRepo.insert(tenantId, body, user.email);
        }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "file_uploaded", area: "files", detail: `${row.name} v${row.currentVersion}` });
        sendJson(res, 201, { ok: true, file: row });
        return;
      }
      // Vooraf-ondertekende upload-URL: de client uploadt rechtstreeks, wij
      // geven alleen een kortlevend, ondertekend slot uit.
      if (action === "docfiles/upload-url" && req.method === "POST") {
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let slot;
        try {
          slot = await objectStorage.createUploadUrl({
            tenantId, scope: body.scope || "general",
            extension: String(body.name || "").split(".").pop(),
            mimeType: body.mimeType, size: body.size,
          });
        }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        sendJson(res, 200, { ok: true, upload: slot });
        return;
      }
      const fileVersionMatch = action.match(/^docfiles\/([^/]+)\/versions$/);
      if (fileVersionMatch && req.method === "POST") {
        assertApiKeyWriteAllowed(user, req);
        let row;
        try { row = fileRepo.addVersion(tenantId, fileVersionMatch[1], await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "file_version_added", area: "files", detail: `${row.name} v${row.currentVersion}` });
        sendJson(res, 201, { ok: true, file: row });
        return;
      }
      const fileDownloadMatch = action.match(/^docfiles\/([^/]+)\/download$/);
      if (fileDownloadMatch && req.method === "POST") {
        let entry, file;
        try {
          entry = fileRepo.recordDownload(tenantId, fileDownloadMatch[1], { version: url.searchParams.get("version"), actor: user.email, ip: req.socket && req.socket.remoteAddress });
          file = fileRepo.findById(tenantId, fileDownloadMatch[1]);
        }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        // Downloads worden geaudit (acceptatie h39).
        store.audit({ actor: user.email, tenantId, action: "file_downloaded", area: "files", detail: `${file.name} v${entry.version}` });
        // Levering via een kortlevende, ondertekende URL (handover 4.2): er is
        // geen publieke map, en een besmet bestand wordt geweigerd.
        const ref = (file.versions.find(v => v.version === entry.version) || {}).storageRef;
        let signed = null;
        if (ref) {
          try { signed = await objectStorage.createDownloadUrl({ tenantId, key: ref }); }
          catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        }
        sendJson(res, 200, { ok: true, download: entry, storageRef: ref, url: signed });
        return;
      }

      // Communicatietijdlijn
      if (action === "communications" && req.method === "GET") {
        sendJson(res, 200, { ok: true, communications: communicationRepo.list(tenantId, {
          entityType: url.searchParams.get("entityType") || undefined,
          entityId: url.searchParams.get("entityId") || undefined,
          channel: url.searchParams.get("channel") || undefined,
        }) });
        return;
      }
      if (action === "communications" && req.method === "POST") {
        assertApiKeyWriteAllowed(user, req);
        let row;
        try { row = communicationRepo.record(tenantId, await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "communication_recorded", area: "communications", detail: `${row.channel} · ${row.subject}` });
        sendJson(res, 201, { ok: true, communication: row });
        return;
      }

      // ── Universele overzichten, bulkacties en export (h11/GRD) ────────────────
      // Entitlement-handhaving voor grid-paden: moduleForAction kijkt naar het
      // eerste padsegment ("grid") en zag deze routes dus niet. Zonder deze
      // mapping kon een tenant buiten zijn pakket om module-data bevragen
      // (bv. grid/worksites/query op een Business-plan) · gevonden door de
      // /v1-pariteitssmoke.
      const GRID_MODULE_ACTION = {
        customers: "customers", quotes: "offertes", invoices: "facturen",
        workorders: "workorders", projects: "projects", articles: "articles",
        employees: "employee_records", suppliers: "suppliers", purchaseOrders: "purchase_orders",
        contracts: "contracts", assets: "assets", worksites: "worksites",
        progressClaims: "progress_claims", expenses: "expenses", incidents: "incidents",
        payments: "payments",
      };
      const gridResourceMatch = action.match(/^grid\/([^/]+)\/(query|bulk|bulk\/preview|export)$/);
      if (gridResourceMatch && GRID_MODULE_ACTION[gridResourceMatch[1]]) {
        assertModuleEnabled(store, user, tenant, GRID_MODULE_ACTION[gridResourceMatch[1]]);
      }

      // Eén gedeeld pad voor elke resource, zodat UI en API dezelfde filters,
      // rechten en zichtbare kolommen hanteren.
      if (action === "grid/resources" && req.method === "GET") {
        const available = Object.entries(GRID_RESOURCES)
          .filter(([, def]) => hasGridAccess(user, def))
          .map(([key, def]) => ({ key, permission: def.permission, searchable: def.search || [], financial: def.financial === true, archivable: def.archivable !== false }));
        sendJson(res, 200, { ok: true, resources: available, operators: GRID_OPERATORS, bulkActions: GRID_BULK_ACTIONS });
        return;
      }
      const gridQueryMatch = action.match(/^grid\/([^/]+)\/query$/);
      if (gridQueryMatch && req.method === "POST") {
        const body = await readBody(req).catch(() => ({}));
        let result;
        try { result = runGridQuery(store, tenant, user, gridQueryMatch[1], { filters: body.filters, search: body.search, sort: body.sort, cursor: body.cursor, limit: body.limit }); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        sendJson(res, 200, { ok: true, ...result });
        return;
      }
      // Vooruitblik: hoeveel records worden geraakt en wat wordt overgeslagen.
      const gridPreviewMatch = action.match(/^grid\/([^/]+)\/bulk\/preview$/);
      if (gridPreviewMatch && req.method === "POST") {
        const body = await readBody(req);
        let preview;
        try { preview = previewGridBulk(store, tenant, user, gridPreviewMatch[1], body.action, body.ids, body.payload || {}); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        sendJson(res, 200, { ok: true, preview });
        return;
      }
      const gridBulkMatch = action.match(/^grid\/([^/]+)\/bulk$/);
      if (gridBulkMatch && req.method === "POST") {
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let job;
        try { job = runGridBulk(store, tenant, user, gridBulkMatch[1], body.action, body.ids, body.payload || {}, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "grid_bulk_action", area: "grid", detail: `${gridBulkMatch[1]} · ${body.action} · ${job.succeeded}/${job.requested}` });
        emitDomainEvent(store, { tenantId, eventType: "grid.bulk_completed", aggregateType: "bulk_job", aggregateId: job.id, actor: user.email, correlationId: res.wfpRequestId, data: { resource: job.resource, action: job.action, succeeded: job.succeeded, failed: job.failed } });
        sendJson(res, job.status === "failed" ? 422 : 200, { ok: job.status !== "failed", job });
        return;
      }
      const gridExportMatch = action.match(/^grid\/([^/]+)\/export$/);
      if (gridExportMatch && req.method === "POST") {
        const body = await readBody(req).catch(() => ({}));
        let exported;
        try {
          exported = buildGridExport(store, tenant, user, gridExportMatch[1],
            { filters: body.filters, search: body.search, sort: body.sort },
            { columns: body.columns, company: ensureDefaultCompany(store, tenant) });
        }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "grid_export", area: "grid", detail: `${gridExportMatch[1]} · ${exported.rowCount} records` });
        // Boven de limiet: job met downloadlink en vervaldatum (h11).
        if (exported.mode === "job") {
          const job = createGridExportJob(store, tenant, user, exported);
          return sendJson(res, 202, { ok: true, mode: "job", job, rowCount: exported.rowCount, hiddenColumns: exported.hiddenColumns });
        }
        res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${gridExportMatch[1]}-${exported.generatedAt.slice(0, 10)}.csv"` });
        res.end(exported.csv);
        return;
      }
      const gridExportJobMatch = action.match(/^grid\/exports\/([^/]+)$/);
      if (gridExportJobMatch && req.method === "GET") {
        let job;
        try { job = getGridExportJob(store, tenant, gridExportJobMatch[1], url.searchParams.get("token")); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        if (!job) return sendJson(res, 404, { ok: false, error: "Export niet gevonden" });
        res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${job.resource}-${job.createdAt.slice(0, 10)}.csv"` });
        res.end(job.csv);
        return;
      }
      // Opgeslagen views · gebruikersdata, geen systeeminstellingen (h11).
      if (action === "grid/views" && req.method === "GET") {
        sendJson(res, 200, { ok: true, views: gridViewRepo.list(tenantId, user, url.searchParams.get("resource") || null) });
        return;
      }
      if (action === "grid/views" && req.method === "POST") {
        assertInteractiveUser(user);
        let view;
        try { view = gridViewRepo.insert(tenantId, await readBody(req), user); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        sendJson(res, 201, { ok: true, view });
        return;
      }
      const gridViewItemMatch = action.match(/^grid\/views\/([^/]+)$/);
      if (gridViewItemMatch && req.method === "PATCH") {
        assertInteractiveUser(user);
        let view;
        try { view = gridViewRepo.update(tenantId, gridViewItemMatch[1], await readBody(req), user); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        sendJson(res, 200, { ok: true, view });
        return;
      }
      if (gridViewItemMatch && req.method === "DELETE") {
        assertInteractiveUser(user);
        try { gridViewRepo.remove(tenantId, gridViewItemMatch[1], user); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Personeelsfiches (h16/EMP) ────────────────────────────────────────────
      // Bewust een eigen route naast "employees": daar beheer je GEBRUIKERS
      // (loginaccounts), hier de personeelsfiche. De spec houdt die twee
      // uitdrukkelijk apart, met een optionele één-op-éénkoppeling via userId.
      if (action === "employee_records" && req.method === "GET") {
        assertCan(user, "employees");
        const rows = employeeRepo.list(tenantId, {
          status: url.searchParams.get("status") || undefined,
          teamId: url.searchParams.get("teamId") || undefined,
          skill: url.searchParams.get("skill") || undefined,
          includeArchived: url.searchParams.get("includeArchived") === "1",
        });
        // Kosttarieven zijn gevoelig (h8.2): enkel beheerders zien ze.
        const scoped = canSeeEmployeeCost(user) ? rows : rows.map(r => ({ ...r, costRates: undefined }));
        sendJson(res, 200, { ok: true, employees: scoped });
        return;
      }
      if (action === "employee_records" && req.method === "POST") {
        assertCan(user, "employees");
        assertApiKeyWriteAllowed(user, req);
        let row;
        try { row = employeeRepo.insert(tenantId, await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "employee_record_created", area: "employees", detail: row.name });
        emitDomainEvent(store, { tenantId, eventType: "employee.created", aggregateType: "employee", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 201, { ok: true, employee: row });
        return;
      }
      // ── Dimona-registratie · het platform geeft NIETS aan bij de RSZ ─────────
      // De aangifte gebeurt door het sociaal secretariaat; hier wordt enkel
      // GEREGISTREERD dat ze gebeurd is (referentie), zodat de hiaten-bewaking
      // kan signaleren wat nog doorgegeven moet worden.
      const empDimonaMatch = action.match(/^employee_records\/([^/]+)\/dimona$/);
      if (empDimonaMatch && req.method === "POST") {
        assertCan(user, "employees");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req).catch(() => ({}));
        const emp = employeeRepo.findById(tenantId, empDimonaMatch[1]);
        if (!emp) return sendJson(res, 404, { ok: false, error: "Werknemer niet gevonden" });
        let record;
        try { record = normalizeDimonaRecord(body, emp); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        const entry = { ...record, at: new Date().toISOString(), by: user.email };
        store.update("employees", emp.id, {
          dimona: entry,
          dimonaHistory: [...(emp.dimonaHistory || []), entry].slice(-20),
        });
        store.audit({ actor: user.email, tenantId, action: "dimona_recorded", area: "employees", detail: `${emp.name} · ${record.type.toUpperCase()} ${record.date}${record.reference ? ` · ${record.reference}` : ""}` });
        emitDomainEvent(store, { tenantId, eventType: "employee.dimona_recorded", aggregateType: "employee", aggregateId: emp.id, actor: user.email, correlationId: res.wfpRequestId, data: { type: record.type, date: record.date } });
        sendJson(res, 200, { ok: true, dimona: entry });
        return;
      }
      // Register + hiaten (actief zonder geregistreerde IN, uit dienst zonder OUT).
      if (action === "dimona/declarations" && req.method === "GET") {
        assertCan(user, "employees");
        sendJson(res, 200, { ok: true, ...dimonaRegister(store, tenantId) });
        return;
      }

      // ── Sociaal secretariaat · PRESTATIE-EXPORT (geen RSZ-aangifte) ──────────
      // Levert de gewerkte uren + goedgekeurde afwezigheden per periode aan zodat
      // het secretariaat kan verlonen. Monargo geeft zelf NIETS aan bij de RSZ.
      if (action === "payroll/config" && req.method === "GET") {
        assertCan(user, "employees");
        sendJson(res, 200, { ok: true, readiness: payrollReadiness(tenant), providers: payrollProviderList() });
        return;
      }
      if (action === "payroll/config" && req.method === "POST") {
        assertCan(user, "settings");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req).catch(() => ({}));
        const prevSs = (tenant.compliance || {}).socialSecretariat || {};
        const compliance = { ...(tenant.compliance || {}) };
        const provider = payrollProviders.includes(String(body.provider || "").toLowerCase()) ? String(body.provider).toLowerCase() : "generic";
        // Nachtvenster alleen bewaren als beide tijden geldig zijn (anders geen nachtmeting).
        const nw = body.nightWindow || {};
        const nightWindow = (/^\d{2}:\d{2}$/.test(String(nw.from)) && /^\d{2}:\d{2}$/.test(String(nw.to)))
          ? { from: String(nw.from), to: String(nw.to) } : null;
        compliance.socialSecretariat = {
          provider,
          affiliateNumber: String(body.affiliateNumber || "").trim(),
          codeMap: (body.codeMap && typeof body.codeMap === "object") ? body.codeMap : prevSs.codeMap || {},
          dailyNormHours: Number(body.dailyNormHours) > 0 ? Number(body.dailyNormHours) : (prevSs.dailyNormHours || undefined),
          nightWindow: nightWindow || (body.nightWindow === null ? null : prevSs.nightWindow || null),
        };
        store.updateTenant(tenant.id, { compliance });
        tenant.compliance = compliance;
        store.audit({ actor: user.email, tenantId, action: "payroll_config_updated", area: "employees", detail: `secretariaat=${provider}` });
        sendJson(res, 200, { ok: true, readiness: payrollReadiness(tenant) });
        return;
      }
      // Maandelijkse samenvatting (vorige maand) · GET toont, POST maakt de
      // melding idempotent aan. Handmatige trigger voor ops en tests.
      if (action === "payroll/digest" && (req.method === "GET" || req.method === "POST")) {
        assertCan(user, "employees");
        let digest;
        try { digest = buildPayrollDigest(store, tenant); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        let notified = false;
        if (req.method === "POST" && digest.hasData) {
          const sourceRef = `payroll:digest:${digest.month}`;
          if (!(store.data.notifications || []).some(n => n.tenantId === tenantId && n.sourceRef === sourceRef)) {
            createNotification(store, tenant, {
              type: "mona", audience: "admins", title: `Prestatiestaat ${digest.month} klaar`,
              body: `De prestatiestaat van ${digest.month} staat klaar om door te sturen naar ${digest.providerLabel}: ${digest.exportable} werknemer(s), ${digest.workedHours} gewerkte uren, ${digest.leaveDays} verlofdag(en).`,
              priority: "normal", sourceRef,
            }, user);
            notified = true;
          }
        }
        sendJson(res, 200, { ok: true, digest, notified });
        return;
      }
      if (action === "payroll/prestaties" && req.method === "GET") {
        assertCan(user, "employees");
        const from = url.searchParams.get("from") || "";
        const to = url.searchParams.get("to") || "";
        let data;
        try { data = buildPayrollExport(store, tenant, { from, to }); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "payroll_export", area: "employees", detail: `${data.period.from}..${data.period.to} · ${data.totals.employees} werknemer(s)` });
        if (url.searchParams.get("format") === "csv") {
          const csv = payrollToCsv(data);
          res.writeHead(200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="prestaties-${data.period.from}_${data.period.to}.csv"`,
          });
          res.end(csv);
          return;
        }
        sendJson(res, 200, { ok: true, export: data });
        return;
      }

      // Let op de volgorde: deze literale route moet vóór de generieke
      // item-regex staan, anders wordt "expiring-certificates" als een id gelezen.
      if (action === "employee_records/expiring-certificates" && req.method === "GET") {
        assertCan(user, "employees");
        const horizonDays = Number(url.searchParams.get("horizonDays")) || 60;
        sendJson(res, 200, { ok: true, horizonDays, employees: employeeRepo.expiringCertificates(tenantId, { horizonDays }) });
        return;
      }
      const empItemMatch = action.match(/^employee_records\/([^/]+)$/);
      if (empItemMatch && req.method === "GET") {
        assertCan(user, "employees");
        const row = employeeRepo.findById(tenantId, empItemMatch[1]);
        if (!row) return sendJson(res, 404, { ok: false, error: "Werknemer niet gevonden" });
        sendJson(res, 200, {
          ok: true,
          employee: canSeeEmployeeCost(user) ? row : { ...row, costRates: undefined },
          expiringCertificates: expiringCertificates(row),
        });
        return;
      }
      if (empItemMatch && req.method === "PATCH") {
        assertCan(user, "employees");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = employeeRepo.update(tenantId, empItemMatch[1], body, user.email, body.expectedVersion); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion }); }
        store.audit({ actor: user.email, tenantId, action: "employee_record_updated", area: "employees", detail: row.name });
        sendJson(res, 200, { ok: true, employee: row });
        return;
      }
      // Nieuwe tariefversie · historische versies blijven ongewijzigd (h16).
      const empRateMatch = action.match(/^employee_records\/([^/]+)\/rates$/);
      if (empRateMatch && req.method === "POST") {
        assertCan(user, "employees");
        assertInteractiveUser(user);
        if (!canSeeEmployeeCost(user)) return sendJson(res, 403, { ok: false, error: "Enkel beheerders beheren tarieven", code: "FINANCIAL_SCOPE" });
        let row;
        try { row = employeeRepo.addRate(tenantId, empRateMatch[1], await readBody(req), user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "employee_rate_added", area: "employees", detail: `${row.name} · vanaf ${row.costRates[0].validFrom}` });
        emitDomainEvent(store, { tenantId, eventType: "employee.rate_changed", aggregateType: "employee", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId, data: { validFrom: row.costRates[0].validFrom } });
        sendJson(res, 201, { ok: true, employee: row });
        return;
      }
      const empTransitionMatch = action.match(/^employee_records\/([^/]+)\/transition$/);
      if (empTransitionMatch && req.method === "POST") {
        assertCan(user, "employees");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = employeeRepo.transition(tenantId, empTransitionMatch[1], body.status, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "employee_status_changed", area: "employees", detail: `${row.name} → ${row.status}` });
        emitDomainEvent(store, { tenantId, eventType: "employee.status_changed", aggregateType: "employee", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId, data: { status: row.status } });
        sendJson(res, 200, { ok: true, employee: row });
        return;
      }
      // Beschikbaarheid op een datum: rooster, dienstperiode en verlof (h16).
      const empAvailMatch = action.match(/^employee_records\/([^/]+)\/availability$/);
      if (empAvailMatch && req.method === "GET") {
        assertCan(user, "employees");
        const row = employeeRepo.findById(tenantId, empAvailMatch[1]);
        if (!row) return sendJson(res, 404, { ok: false, error: "Werknemer niet gevonden" });
        const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
        sendJson(res, 200, { ok: true, date, availability: availabilityOn(row, date, { leaves: store.list("leaves", tenantId) || [] }) });
        return;
      }
      // ── Samenstelbare profielen · custom rollen (#75) ─────────────────────────
      // Rechten-gedreven rolbeheer: de tenant-admin stelt zelf profielen samen uit
      // de granulaire rechtencatalogus. Lezen vraagt 'settings'; wijzigen vraagt
      // schrijfrecht op 'settings' (+ admin-MFA) en wordt geaudit in de module.
      if (action === "permission-catalog" && req.method === "GET") {
        assertCan(user, "settings");
        sendJson(res, 200, { ok: true, catalog: rolesMod.permissionCatalog(store, tenant) });
        return;
      }
      if (action === "roles" && req.method === "GET") {
        assertCan(user, "settings");
        sendJson(res, 200, { ok: true, ...rolesMod.listRoles(store, tenantId) });
        return;
      }
      if (action === "roles" && req.method === "POST") {
        assertCanWrite(user, "settings");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        try {
          const role = rolesMod.createRole(store, tenant, user.email, body);
          sendJson(res, 201, { ok: true, role });
        } catch (e) { sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code || "ROLE_INVALID" }); }
        return;
      }
      const roleItemMatch = action.match(/^roles\/([^/]+)$/);
      if (roleItemMatch && req.method === "PATCH") {
        assertCanWrite(user, "settings");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        try {
          const role = rolesMod.updateRole(store, tenant, user.email, roleItemMatch[1], body);
          sendJson(res, 200, { ok: true, role });
        } catch (e) { sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code || "ROLE_INVALID" }); }
        return;
      }
      if (roleItemMatch && req.method === "DELETE") {
        assertCanWrite(user, "settings");
        assertApiKeyWriteAllowed(user, req);
        try {
          rolesMod.deleteRole(store, tenant, user.email, roleItemMatch[1]);
          sendJson(res, 200, { ok: true });
        } catch (e) { sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code || "ROLE_INVALID" }); }
        return;
      }

      if (action === "employees" && req.method === "GET") {
        assertCan(user, "employees");
        const includeInactive = url.searchParams.get("includeInactive") === "true";
        const users = store.list("users", tenantId)
          .filter(u => (includeInactive || u.active !== false) && !["super_admin"].includes(u.role))
          .map(u => { const { passwordHash, mfaSecret, mfaPendingSecret, recoveryCodes, ...safe } = u; return safe; });
        // Gevoelige velden (h8.2): kostvelden enkel voor beheerders.
        sendJson(res, 200, { ok: true, employees: redactSensitive(user, "employees", users), grantable: grantablePermissions(store, tenant) });
        return;
      }

      // ── Medewerker bijwerken ──────────────────────────────────────────────────
      const employeePatchMatch = action.match(/^employees\/([^/]+)$/);
      if (employeePatchMatch && req.method === "PATCH") {
        assertCan(user, "employees");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const { passwordHash, mfaSecret, mfaPendingSecret, recoveryCodes, newPassword, role: bodyRole, permissions: bodyPerms, roleId: bodyRoleId, ...safe } = body;
        const existing = store.getUserById(employeePatchMatch[1]);
        // PLT-BR-002: nooit toegang enkel op basis van een record-ID. Het doelwit
        // moet van deze tenant zijn en employee/manager (admins wijzig je niet
        // via deze route · geen privilege-escalatie of cross-tenant-overname).
        if (!existing || existing.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Medewerker niet gevonden" });
        if (!["employee", "manager"].includes(existing.role)) return sendJson(res, 403, { ok: false, error: "Beheerdersaccounts kunnen niet via deze route worden gewijzigd", code: "TARGET_NOT_EMPLOYEE" });
        if (newPassword) {
          assertStrongPassword(newPassword);
          safe.passwordHash = hashPassword(newPassword);
          store.audit({ actor: user.email, tenantId, action: "admin_password_reset", area: "users", detail: employeePatchMatch[1] });
        }
        // Rol enkel binnen employee/manager wijzigbaar (geen escalatie naar admin).
        const effRole = ["manager", "employee"].includes(bodyRole) ? bodyRole : (existing && existing.role) || "employee";
        if (bodyRole !== undefined) safe.role = effRole;
        // Permissions altijd server-side saneren (nooit rauw doorlaten).
        if (bodyPerms !== undefined || bodyRole !== undefined) {
          const requested = Array.isArray(bodyPerms) ? bodyPerms : (existing && existing.permissions) || [];
          safe.permissions = sanitizeEmployeePermissions(store, tenant, effRole, requested);
        }
        // Samengesteld profiel toewijzen/losmaken (#75): valideer dat het profiel
        // van deze tenant is; "" of null maakt het profiel los.
        if (bodyRoleId !== undefined) {
          if (bodyRoleId) { try { rolesMod.resolveAssignableRole(store, tenantId, bodyRoleId); } catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code || "ROLE_NOT_ASSIGNABLE" }); } safe.roleId = bodyRoleId; }
          else safe.roleId = null;
        }
        const row = store.update("users", employeePatchMatch[1], { ...safe, updatedAt: new Date().toISOString() });
        const { passwordHash: _ph, mfaSecret: _ms, ...safeRow } = row;
        sendJson(res, 200, { ok: true, user: safeRow });
        return;
      }

      // ── Medewerker aanmaken met rol ───────────────────────────────────────────
      if (action === "employees" && req.method === "POST") {
        assertCan(user, "employees");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const email = String(body.email || "").toLowerCase().trim();
        if (!email) { sendJson(res, 400, { ok: false, error: "Email is verplicht" }); return; }
        if (store.getUserByEmail(email)) { sendJson(res, 409, { ok: false, error: "Email bestaat al" }); return; }
        const role = ["manager", "employee"].includes(body.role) ? body.role : "employee";
        const permissions = body.permissions !== undefined
          ? sanitizeEmployeePermissions(store, tenant, role, body.permissions)
          : (role === "manager" ? MANAGER_PERMISSIONS : EMPLOYEE_PERMISSIONS);
        // Optioneel samengesteld profiel (#75): valideer dat het van deze tenant is.
        let roleId = null;
        if (body.roleId) { try { rolesMod.resolveAssignableRole(store, tenantId, body.roleId); roleId = body.roleId; } catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code || "ROLE_NOT_ASSIGNABLE" }); } }
        // Geen wachtwoord door de aanmaker: de medewerker ontvangt een activatiemail
        // en stelt binnen de geldigheidsperiode zelf zijn wachtwoord in.
        const { user: newUser, activationLink } = provisionPendingUser({
          id: `user_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
          tenantId,
          name: String(body.name || "").trim() || email,
          email,
          role,
          permissions,
          roleId,
          mfaEnabled: false,
          mfaEnforced: false,
          function: body.function || null,
          phone: body.phone || null,
          teamId: body.teamId || null,
          // Rijksregisternummer (INSZ) · nodig voor CIAW/Checkin@Work-aangiftes.
          nationalId: body.nationalId ? String(body.nationalId).replace(/[^0-9]/g, "").slice(0, 11) : null
        });
        store.audit({ actor: user.email, tenantId, action: "employee_created", area: "employees", detail: `${email} (${role})` });
        sendJson(res, 201, { ok: true, user: { ...newUser, passwordHash: undefined }, activationLink });
        return;
      }
      // ── Einde medewerker aanmaken ─────────────────────────────────────────────

      if (action === "clock/in" && req.method === "POST") {
        assertCan(user, "clockings");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 201, { ok: true, row: clockIn(store, tenant, await readBody(req), user) });
        return;
      }
      if (action === "clock/out" && req.method === "POST") {
        assertCan(user, "clockings");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 200, { ok: true, row: clockOut(store, tenant, await readBody(req), user) });
        return;
      }
      const expenseApprovalMatch = action.match(/^expenses\/([^/]+)\/approve$/);
      if (expenseApprovalMatch && req.method === "POST") {
        assertCan(user, "expenses");
        assertApiKeyWriteAllowed(user, req);
        const expense = approveExpense(store, tenant, expenseApprovalMatch[1], user);
        // E-mail + in-app notificatie naar medewerker
        if (expense?.userId) {
          const employee = store.getUserById(expense.userId);
          if (employee?.email) {
            const tpl = expenseReviewedToEmployee({ employee, expense, reviewer: user, appUrl: config.appUrl });
            sendMail({ to: employee.email, ...tpl });
          }
          createNotification(store, tenant, {
            type: "expense",
            channel: "in_app",
            audience: expense.userId,
            userId: expense.userId,
            title: "Onkostennota goedgekeurd",
            body: `€${expense.amount || ""} (${expense.category || ""}) werd goedgekeurd.`,
            priority: "normal",
            sourceRef: `expense:${expense.id}:goedgekeurd`
          }, user);
        }
        sendJson(res, 200, { ok: true, row: expense });
        return;
      }

      // ── Onkosten lijst (admin/manager) ────────────────────────────────────────
      if (action === "expenses" && req.method === "GET") {
        assertCan(user, "expenses");
        let expenses = withUserNames(store, store.list("expenses", tenantId))
          .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        expenses = applyScope(store, user, "expenses", expenses); // E02: own/team/tenant
        sendJson(res, 200, { ok: true, expenses });
        return;
      }

      // PATCH /expenses/:id · status bijwerken (goedgekeurd/geweigerd) + werkbon-koppeling
      const expPatchMatch = action.match(/^expenses\/([^/]+)$/);
      if (expPatchMatch && req.method === "PATCH") {
        assertCan(user, "expenses");
        const existingExp = store.get("expenses", expPatchMatch[1]);
        if (!existingExp || existingExp.tenantId !== tenantId) {
          return sendJson(res, 404, { ok: false, error: "Onkost niet gevonden" });
        }
        const body = await readBody(req);
        // Whitelist: only allow specific fields to be updated via this route.
        // workorderId/billable = doorrekenen aan de klant via de werkbon-factuur.
        const allowed = ["status", "reviewNote", "reviewedBy", "reviewedAt", "amount", "category", "description", "date", "workorderId", "billable"];
        const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
        // Goed-/afkeuren is voorbehouden aan manager/admin (nooit je eigen nota's beoordelen).
        if (patch.status !== undefined && (isEmployee(user) || existingExp.userId === user.id)) {
          return sendJson(res, 403, { ok: false, error: "Onkosten beoordelen kan enkel door een manager of beheerder (en nooit je eigen nota's)" });
        }
        if (patch.workorderId) {
          const woRef = store.get("workorders", String(patch.workorderId));
          if (!woRef || woRef.tenantId !== tenantId) return sendJson(res, 400, { ok: false, error: "Werkbon niet gevonden" });
        }
        if (patch.billable !== undefined) patch.billable = patch.billable !== false && patch.billable !== "false";
        if (patch.status === "goedgekeurd" || patch.status === "geweigerd") {
          patch.reviewedBy = user.email;
          patch.reviewedAt = new Date().toISOString();
        }
        const row = store.update("expenses", expPatchMatch[1], { ...patch, updatedAt: new Date().toISOString() });
        store.audit({ actor: user.email, tenantId, action: `expense_${patch.status||"updated"}`, area: "expenses", detail: `€${row?.amount} · ${row?.category}` });
        // E-mail + in-app notificatie naar medewerker bij statuswijziging naar goedgekeurd/geweigerd
        if (["goedgekeurd", "geweigerd"].includes(row?.status) && row?.userId) {
          const employee = store.getUserById(row.userId);
          if (employee?.email) {
            const tpl = expenseReviewedToEmployee({ employee, expense: row, reviewer: user, appUrl: config.appUrl });
            sendMail({ to: employee.email, ...tpl });
          }
          createNotification(store, tenant, {
            type: "expense",
            channel: "in_app",
            audience: row.userId,
            userId: row.userId,
            title: row.status === "goedgekeurd" ? "Onkostennota goedgekeurd" : "Onkostennota geweigerd",
            body: `€${row.amount || ""} (${row.category || ""}) werd ${row.status}.`,
            priority: "normal",
            sourceRef: `expense:${row.id}:${row.status}`
          }, user);
        }
        sendJson(res, 200, { ok: true, row });
        return;
      }

      // ── Clocks lijst (admin/manager) ──────────────────────────────────────────
      // ── Prikklok: één canoniek schema aan de API-grens ────────────────────────
      // Echte prikklok-rijen: date + clockIn/clockOut (HH:MM) + durationMinutes +
      // status "active"/"ready_for_approval"/…  Oudere handmatige rijen gebruikten
      // clockedIn/clockedOut (ISO). GET verrijkt elke rij met BEIDE representaties
      // zodat alle schermen kloppen; mutaties schrijven canoniek en houden een
      // correctie-spoor (corrections[]) bij voor de sociale-wetgeving-audit.
      if (action === "clocks" && req.method === "GET") {
        assertCan(user, "clockings");
        const fromQ = url.searchParams.get("from");
        const toQ   = url.searchParams.get("to");
        const dateFilter = url.searchParams.get("date");
        let clocks = withUserNames(store, store.list("clocks", tenantId).map(enrichClock))
          .sort((a, b) => `${b.date || ""}${b.clockIn || ""}`.localeCompare(`${a.date || ""}${a.clockIn || ""}`));
        clocks = applyScope(store, user, "clockings", clocks); // E02: own/team/tenant
        if (dateFilter) clocks = clocks.filter(c => c.date === dateFilter);
        if (fromQ) clocks = clocks.filter(c => (c.date || "") >= fromQ);
        if (toQ)   clocks = clocks.filter(c => (c.date || "") <= toQ);
        sendJson(res, 200, { ok: true, clocks });
        return;
      }

      // Handmatige klokregistratie (beheerder/manager: vergeten prik toevoegen)
      if (action === "clocks/manual" && req.method === "POST") {
        assertCan(user, "clockings");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        // Canoniek (date + clockIn HH:MM) mét fallback voor het oude ISO-contract.
        const date = body.date || String(body.clockedIn || "").slice(0, 10);
        const clockIn = hhmm(body.clockIn) || hhmm(String(body.clockedIn || "").slice(11, 16));
        const clockOut = hhmm(body.clockOut) || hhmm(String(body.clockedOut || "").slice(11, 16));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !clockIn) {
          return sendJson(res, 400, { ok: false, error: "Datum en inkloktijd zijn verplicht" });
        }
        if (clockOut && clockOut <= clockIn) {
          return sendJson(res, 400, { ok: false, error: "Uitkloktijd moet na inkloktijd liggen" });
        }
        const target = store.getUserById(String(body.userId || ""));
        if (!target || target.tenantId !== tenantId) {
          return sendJson(res, 400, { ok: false, error: "Medewerker niet gevonden" });
        }
        const row = store.insert("clocks", {
          id: `clock_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId,
          userId: target.id,
          userName: target.name || target.email,
          date, clockIn, clockOut: clockOut || null,
          durationMinutes: clockOut ? hhmmToMin(clockOut) - hhmmToMin(clockIn) : null,
          status: clockOut ? "ready_for_approval" : "active",
          note: body.note || "Handmatige registratie",
          manual: true,
          createdBy: user.email,
          createdAt: new Date().toISOString()
        });
        store.audit({ actor: user.email, tenantId, action: "clock_manual_created", area: "clockings",
          detail: `${target.name || target.email} ${date} ${clockIn}-${clockOut || "…"}` });
        sendJson(res, 201, { ok: true, row: enrichClock(row) });
        return;
      }

      // Klokregistratie corrigeren (met audit-spoor van de originele tijden)
      const clockItemMatch = action.match(/^clocks\/([^/]+)$/);
      if (clockItemMatch && req.method === "PATCH") {
        assertCan(user, "clockings");
        assertApiKeyWriteAllowed(user, req);
        const existing = store.get("clocks", clockItemMatch[1]);
        if (!existing || existing.tenantId !== tenantId) {
          return sendJson(res, 404, { ok: false, error: "Klokregistratie niet gevonden" });
        }
        const body = await readBody(req);
        const cur = enrichClock(existing);
        const newIn = hhmm(body.clockIn) || hhmm(String(body.clockedIn || "").slice(11, 16)) || cur.clockIn;
        const outCleared = body.clockOut === null || body.clockedOut === null;
        const newOut = outCleared ? null
          : (hhmm(body.clockOut) || hhmm(String(body.clockedOut || "").slice(11, 16)) || cur.clockOut);
        if (!newIn) return sendJson(res, 400, { ok: false, error: "Inkloktijd is verplicht" });
        if (newOut && newOut <= newIn) {
          return sendJson(res, 400, { ok: false, error: "Uitkloktijd moet na inkloktijd liggen" });
        }
        const corrections = [...(existing.corrections || []), {
          by: user.email,
          at: new Date().toISOString(),
          note: String(body.note || ""),
          original: { clockIn: cur.clockIn, clockOut: cur.clockOut }
        }];
        // Duur herberekenen conform het pauzebeleid van de tenant.
        const corrPause = tenant.clockingPrefs?.paidBreaks === true ? 0 : clockBreakMinutes(existing.breaks);
        const updated = store.update("clocks", existing.id, {
          date: cur.date,
          clockIn: newIn,
          clockOut: newOut || null,
          durationMinutes: newOut ? Math.max(0, hhmmToMin(newOut) - hhmmToMin(newIn) - corrPause) : null,
          // Uitkloktijd gezet op een actieve prik → klaar voor goedkeuring; anders status behouden.
          status: newOut ? (["active", "in"].includes(existing.status) ? "ready_for_approval" : existing.status || "ready_for_approval") : "active",
          note: body.note !== undefined ? body.note : existing.note,
          corrections,
          corrected: true,
          // Legacy-velden mee-updaten zodat oude consumenten consistent blijven.
          clockedIn: cur.date && newIn ? `${cur.date}T${newIn}:00` : null,
          clockedOut: cur.date && newOut ? `${cur.date}T${newOut}:00` : null,
          updatedAt: new Date().toISOString()
        });
        store.audit({ actor: user.email, tenantId, action: "clock_corrected", area: "clockings",
          detail: `${cur.userName || existing.userId} ${cur.date}: ${cur.clockIn || "-"}-${cur.clockOut || "-"} naar ${newIn}-${newOut || "-"}` });
        sendJson(res, 200, { ok: true, row: enrichClock(updated) });
        return;
      }

      // ── Berichten lijst (admin/manager) ──────────────────────────────────────
      if (action === "messages" && req.method === "GET") {
        assertCan(user, "messages");
        // Werf-chat: filter op ?venueId voor de gespreksgroep van één werf.
        const venueFilter = url.searchParams.get("venueId");
        let messages = store.list("messages", tenantId);
        if (venueFilter) messages = messages.filter(m => m.venueId === venueFilter);
        messages = messages
          .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
          .slice(0, 100);
        sendJson(res, 200, { ok: true, messages });
        return;
      }
      // Werf-gespreksgroepen: per werf het aantal berichten + laatste activiteit.
      if (action === "messages/venues" && req.method === "GET") {
        assertCan(user, "messages");
        const byVenue = new Map();
        for (const m of store.list("messages", tenantId)) {
          if (!m.venueId) continue;
          const cur = byVenue.get(m.venueId) || { venueId: m.venueId, count: 0, lastAt: "" };
          cur.count++;
          if ((m.createdAt || "") > cur.lastAt) cur.lastAt = m.createdAt || "";
          byVenue.set(m.venueId, cur);
        }
        const venuesById = new Map(store.list("venues", tenantId).map(v => [v.id, v.name]));
        const threads = [...byVenue.values()]
          .map(t => ({ ...t, venue: venuesById.get(t.venueId) || t.venueId }))
          .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
        sendJson(res, 200, { ok: true, threads });
        return;
      }

      // POST /messages · nieuw bericht versturen
      if (action === "messages" && req.method === "POST") {
        assertCan(user, "messages");
        const body = await readBody(req);
        // recipientRole: stuur aan iedereen met die rol in de tenant
        let toRole = body.toRole || body.recipientRole || null;
        let toName = null;
        if (toRole) {
          const targetUsers = store.list("users", tenantId).filter(u => u.role === toRole && u.active !== false);
          toName = toRole === "tenant_admin" ? "Admin" : toRole === "manager" ? "Manager(s)" : toRole;
          body.recipientId = null; // broadcast by role, not single user
        }
        const row = store.insert("messages", {
          id: `msg_${Date.now()}_${require("crypto").randomBytes(4).toString("hex")}`,
          tenantId,
          senderId: user.id,
          senderName: user.name || user.email,
          recipientId: body.recipientId || null,
          toRole: toRole || null,
          toName: toName || null,
          venueId: body.venueId || null,     // werf-chat: koppel bericht aan een werf
          subject: body.subject || "",
          body: body.body || "",
          readBy: [],
          createdAt: new Date().toISOString()
        });
        sendJson(res, 201, { ok: true, row });
        return;
      }

      // DELETE /messages/:id · bericht verwijderen (admin/manager)
      const msgDeleteMatch = action.match(/^messages\/([^/]+)$/);
      if (msgDeleteMatch && req.method === "DELETE") {
        assertCan(user, "messages");
        assertInteractiveUser(user);
        const msgId = msgDeleteMatch[1];
        const msg = store.list("messages", tenantId).find(m => m.id === msgId);
        if (!msg) return sendJson(res, 404, { ok: false, error: "Bericht niet gevonden" });
        store.remove("messages", msgId);
        store.audit({ actor: user.email, tenantId, action: "message_deleted", area: "messages", detail: msgId });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Werkbon v2 · mobiele uitvoering (E07/h25) ────────────────────────────
      // Canonieke weergave (legacy-rijen worden opgewaardeerd) met totalen en
      // factuurvoorstel volgens de gekozen strategie.
      const woV2Match = action.match(/^workorders\/([^/]+)\/(sync|submit|sign|review|corrections|canonical)$/);
      if (woV2Match && woV2Match[2] === "canonical" && req.method === "GET") {
        assertCan(user, "workorders");
        const wo = workOrderRepo.findById(tenantId, woV2Match[1]);
        if (!wo) return sendJson(res, 404, { ok: false, error: "Werkbon niet gevonden" });
        const strategy = url.searchParams.get("strategy") || "detail";
        sendJson(res, 200, { ok: true, workorder: wo, totals: computeWoTotals(wo), invoiceLines: buildWoInvoiceLines(wo, strategy), strategy });
        return;
      }
      // Offline-sync: baseVersion bepaalt of er een conflict is. Bij conflict
      // 409 MET de serverstaat + de clientmutatie · nooit stil overschrijven.
      if (woV2Match && woV2Match[2] === "sync" && req.method === "POST") {
        assertCan(user, "workorders");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let wo;
        try { wo = workOrderRepo.sync(tenantId, woV2Match[1], { baseVersion: body.baseVersion, patch: body.patch, clientId: body.clientId, clientUpdatedAt: body.clientUpdatedAt, commandId: body.commandId }, user); }
        catch (e) {
          return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion, serverState: e.serverState, clientPatch: e.clientPatch });
        }
        // Dubbel queue-item herkend → geen tweede toepassing, geen event.
        if (wo.syncReplayed) return sendJson(res, 200, { ok: true, workorder: wo, replayed: true });
        emitDomainEvent(store, { tenantId, eventType: "workorder.synced", aggregateType: "workorder", aggregateId: wo.id, actor: user.email, correlationId: res.wfpRequestId, data: { clientId: wo.sync.clientId, version: wo.version } });
        sendJson(res, 200, { ok: true, workorder: wo });
        return;
      }
      if (woV2Match && woV2Match[2] === "submit" && req.method === "POST") {
        assertCan(user, "workorders");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req).catch(() => ({}));
        let wo;
        try { wo = workOrderRepo.submit(tenantId, woV2Match[1], user, { requireSignature: body.requireSignature === true }); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, missing: e.missing }); }
        store.audit({ actor: user.email, tenantId, action: "workorder_submitted", area: "workorders", detail: wo.number || wo.id });
        emitDomainEvent(store, { tenantId, eventType: "workorder.submitted", aggregateType: "workorder", aggregateId: wo.id, actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 200, { ok: true, workorder: wo });
        return;
      }
      if (woV2Match && woV2Match[2] === "sign" && req.method === "POST") {
        assertCan(user, "workorders");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let wo;
        try { wo = workOrderRepo.sign(tenantId, woV2Match[1], { by: body.by, dataRef: body.dataRef }, user); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        emitDomainEvent(store, { tenantId, eventType: "workorder.signed", aggregateType: "workorder", aggregateId: wo.id, actor: user.email, correlationId: res.wfpRequestId, data: { boundVersion: wo.signature.boundVersion } });
        sendJson(res, 200, { ok: true, workorder: wo });
        return;
      }
      if (woV2Match && woV2Match[2] === "review" && req.method === "POST") {
        assertCan(user, "workorders");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let wo;
        try { wo = workOrderRepo.review(tenantId, woV2Match[1], { decision: body.decision, note: body.note }, user); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: `workorder_${body.decision === "approve" ? "approved" : "rejected"}`, area: "workorders", detail: wo.number || wo.id });
        emitDomainEvent(store, { tenantId, eventType: body.decision === "approve" ? "workorder.approved" : "workorder.rejected", aggregateType: "workorder", aggregateId: wo.id, actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 200, { ok: true, workorder: wo });
        return;
      }
      // Correctieboeking na goedkeuring · onveranderlijk en auditbaar (h25).
      if (woV2Match && woV2Match[2] === "corrections" && req.method === "POST") {
        assertCan(user, "workorders");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let result;
        try { result = workOrderRepo.addCorrection(tenantId, woV2Match[1], body, user); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "workorder_corrected", area: "workorders", detail: `${result.workorder.number || result.workorder.id} · ${result.correction.reason}` });
        emitDomainEvent(store, { tenantId, eventType: "workorder.corrected", aggregateType: "workorder", aggregateId: result.workorder.id, actor: user.email, correlationId: res.wfpRequestId, data: { type: result.correction.type, reason: result.correction.reason } });
        sendJson(res, 201, { ok: true, workorder: result.workorder, correction: result.correction });
        return;
      }
      // v2-velden (workers/materials/equipment/forms) via de canonieke repository:
      // dwingt de eigen-uren-regel, bevriezing na goedkeuring en versieconflicten af.
      const woFieldsMatch = action.match(/^workorders\/([^/]+)\/fields$/);
      if (woFieldsMatch && req.method === "PATCH") {
        assertCan(user, "workorders");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let wo;
        try {
          if (body.workers) {
            const current = workOrderRepo.findById(tenantId, woFieldsMatch[1]);
            const executionDate = body.date || (current && current.date) || null;
            body.workers = enrichWorkerRates(tenantId, body.workers, executionDate);
          }
          wo = workOrderRepo.update(tenantId, woFieldsMatch[1], body, user, body.expectedVersion);
        }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion, serverState: e.serverState }); }
        sendJson(res, 200, { ok: true, workorder: wo, totals: computeWoTotals(wo) });
        return;
      }

      // ── Werkbonnen lijst (admin/manager) ─────────────────────────────────────
      if (action === "workorders" && req.method === "GET") {
        assertCan(user, "workorders");
        let workorders = withUserNames(store, store.list("workorders", tenantId))
          .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        workorders = applyScope(store, user, "workorders", workorders, ["userId", "assignedTo"]); // E02
        sendJson(res, 200, { ok: true, workorders });
        return;
      }

      if (action === "workorders" && req.method === "POST") {
        assertCan(user, "workorders");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        if (!String(body.title||"").trim()) return sendJson(res, 400, { ok: false, error: "Titel is verplicht" });
        // Nummering via de persistente reeks (E01) · geen hergebruik na delete.
        const woNumber = issueNumber(store, { tenant, docType: "workorder" }).number;
        const row = store.insert("workorders", {
          id: `wo_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId, ...body,
          number: woNumber,
          status: body.status || "open",
          createdBy: user.id,
          createdAt: new Date().toISOString()
        });
        store.audit({ actor: user.email, tenantId, action: "workorder_created", area: "workorders", detail: body.title });
        sendJson(res, 201, { ok: true, workorder: row });
        return;
      }

      // ── Werkbon → Factuur (1-klik): sluit de veld→cash-lus ────────────────────
      // Neemt geklokte/factureerbare uren × tarief (of vast bedrag) over in een
      // klantfactuur, koppelt beide, en markeert de werkbon als gefactureerd.
      const workorderInvoiceMatch = action.match(/^workorders\/([^/]+)\/invoice$/);
      if (workorderInvoiceMatch && req.method === "POST") {
        assertInvoicing(user);
        assertApiKeyWriteAllowed(user, req);
        const wo = store.get("workorders", workorderInvoiceMatch[1]);
        if (!wo || wo.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Werkbon niet gevonden" });
        if (wo.invoiceId) return sendJson(res, 409, { ok: false, error: "Deze werkbon is al gefactureerd" });
        const body = await readBody(req).catch(() => ({}));
        const payload = workorderInvoicePayload(store, tenant, wo, body.extraLines);
        const invoice = createCustomerInvoice(store, tenant, user, payload);
        const workorder = store.update("workorders", wo.id, {
          invoiceId: invoice.id, billableStatus: "invoiced",
          invoicedAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        });
        // Doorgerekende onkosten markeren zodat ze nooit dubbel op een factuur komen.
        for (const expId of (payload.expenseIds || [])) {
          store.update("expenses", expId, { invoiceId: invoice.id, invoicedAt: new Date().toISOString() });
        }
        store.audit({ actor: user.email, tenantId, action: "workorder_invoiced", area: "facturen", detail: `${wo.number || wo.id} → ${invoice.number}` });
        sendJson(res, 201, { ok: true, invoice, workorder });
        return;
      }

      const workorderItemMatch = action.match(/^workorders\/([^/]+)$/);
      if (workorderItemMatch && req.method === "PATCH") {
        assertCan(user, "workorders");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const row = store.update("workorders", workorderItemMatch[1], { ...body, updatedAt: new Date().toISOString() });
        store.audit({ actor: user.email, tenantId, action: "workorder_updated", area: "workorders", detail: workorderItemMatch[1] });
        sendJson(res, 200, { ok: true, workorder: row });
        return;
      }
      if (workorderItemMatch && req.method === "DELETE") {
        assertCan(user, "workorders");
        assertApiKeyWriteAllowed(user, req);
        const wo = (store.data.workorders || []).find(w => w.id === workorderItemMatch[1] && w.tenantId === tenantId);
        if (!wo) return sendJson(res, 404, { ok: false, error: "Werkbon niet gevonden" });
        store.remove("workorders", workorderItemMatch[1]);
        store.audit({ actor: user.email, tenantId, action: "workorder_deleted", area: "workorders", detail: wo.title || workorderItemMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Bedrijfsinstellingen bijwerken ────────────────────────────────────────
      if (action === "settings" && req.method === "GET") {
        assertCan(user, "settings");
        const t = store.data.tenants.find(x => x.id === tenantId);
        if (!t) return sendJson(res, 404, { ok: false, error: "Tenant niet gevonden" });
        const { billingOps, supportSession, ...safeTenant } = t;
        sendJson(res, 200, { ok: true, tenant: safeTenant });
        return;
      }

      if (action === "settings" && req.method === "PATCH") {
        assertCan(user, "settings");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const allowed = ["name", "vatNumber", "address", "contactEmail", "phone", "invoiceProfile"];
        const patch = {};
        allowed.forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
        // Standaardtemplate voor de medewerker-startpagina (widget-keys).
        if (body.employeeHomeTemplate !== undefined) {
          const validKeys = new Set(EMP_HOME_WIDGETS.map(w => w.key));
          const tpl = Array.isArray(body.employeeHomeTemplate) ? body.employeeHomeTemplate.filter(k => validKeys.has(k)) : [];
          if (!tpl.length) return sendJson(res, 400, { ok: false, error: "Kies minstens één blok voor de startpagina" });
          patch.employeeHomeTemplate = tpl;
        }
        // Standaard-uurtarief: fallback voor werkbonnen zonder eigen tarief bij facturatie.
        if (body.defaultHourlyRate !== undefined) patch.defaultHourlyRate = Math.max(0, Number(body.defaultHourlyRate) || 0);
        // Automatische betaalherinneringen (opt-in; zie payment-reminders.js).
        // Frequentie en maximum bepaalt het bedrijf zelf; reminderPolicy
        // begrenst op veilige waarden (1-90 dagen, 1-10 herinneringen).
        if (body.autoReminders && typeof body.autoReminders === "object") {
          const policy = reminderPolicy(body.autoReminders);
          patch.autoReminders = {
            enabled: body.autoReminders.enabled === true,
            intervalDays: policy.intervalDays,
            maxReminders: policy.maxReminders
          };
        }
        // Prikklok-beleid: tellen pauzes mee als betaalde werktijd?
        // Geldt voor registraties vanaf de wijziging; bestaande blijven staan.
        if (body.clockingPrefs && typeof body.clockingPrefs === "object") {
          patch.clockingPrefs = { ...(tenant.clockingPrefs || {}), paidBreaks: body.clockingPrefs.paidBreaks === true };
        }
        // E-mailnotificatie-voorkeur (tenant-breed).
        if (body.notificationPrefs && typeof body.notificationPrefs === "object") {
          patch.notificationPrefs = { ...(tenant.notificationPrefs || {}), emailEnabled: body.notificationPrefs.emailEnabled !== false };
        }
        const updated = store.updateTenant(tenantId, patch);
        store.audit({ actor: user.email, tenantId, action: "settings_updated", area: "settings", detail: JSON.stringify(patch) });
        sendJson(res, 200, { ok: true, tenant: updated });
        return;
      }
      // ── Einde instellingen ────────────────────────────────────────────────────
    }

    if (url.pathname === "/api/audit") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertCan(user, "audit");
      // Platform-agents zonder 'audit'-scope mogen het platform-auditlog niet.
      if (user.role === "super_admin") assertPlatformScope(user, "audit");
      const audit = listAuditEvents(store, user, {
        tenantId: url.searchParams.get("tenantId"),
        area: url.searchParams.get("area"),
        action: url.searchParams.get("action"),
        actor: url.searchParams.get("actor"),
        since: url.searchParams.get("since"),
        from: url.searchParams.get("from"),
        to: url.searchParams.get("to"),
        limit: url.searchParams.get("limit")
      });
      if (url.searchParams.get("format") === "csv") {
        sendCsv(res, `audit-${new Date().toISOString().slice(0, 10)}.csv`, audit.rows);
        return;
      }
      sendJson(res, 200, { ok: true, ...audit });
      return;
    }

    if (url.pathname === "/api/errors") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertCan(user, "settings");
      assertInteractiveUser(user);
      const errors = listErrorEvents(store, user, {
        tenantId: url.searchParams.get("tenantId"),
        status: url.searchParams.get("status"),
        method: url.searchParams.get("method"),
        path: url.searchParams.get("path"),
        message: url.searchParams.get("message"),
        since: url.searchParams.get("since"),
        limit: url.searchParams.get("limit")
      });
      if (url.searchParams.get("format") === "csv") {
        sendCsv(res, `errors-${new Date().toISOString().slice(0, 10)}.csv`, errors.rows);
        return;
      }
      sendJson(res, 200, { ok: true, ...errors });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { ok: false, error: "Unknown API route" });
      return;
    }

    // Publieke offerte-pagina (self-contained, geen login)
    if (url.pathname.startsWith("/offerte/")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(publicQuotePage());
      return;
    }
    // Publieke (mock) betaalpagina
    if (url.pathname.startsWith("/betaal/")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(publicPayPage());
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    handleError(req, res, error, errorTenantId);
  } finally {
    // Netwerk-adapters bufferen schrijfacties (zie pg-data-adapter). Persisteer
    // ze zodra de afhandeling klaar is. Synchrone adapters (JSON) hebben al
    // geschreven en doen hier niets.
    //
    // Bekende beperking: tussen het versturen van het antwoord en het
    // afronden van deze flush zit één event-loop-tik. Crasht het proces exact
    // daarin, dan is de laatste mutatie niet bewaard. /api/ready meldt daarom
    // pendingWrites, en de shutdown-handler flusht altijd. De sluitende
    // oplossing is F-03/F-04 (echte transactionele repositories per use case).
    if (store.isDirty()) {
      try { await store.flush(); }
      catch (err) { console.error(`[store] wegschrijven mislukt: ${err.message}`); }
    }
    // Requestduur per route-klasse (handover 4.7 · P95-doelen per endpointklasse).
    // Geaggregeerd, dus dit vervuilt de logs niet.
    try {
      telemetry.metric("http.request.duration_ms", Date.now() - (res.wfpStartedAt || Date.now()), {
        method: req.method,
        // Enkel het ROUTEPATROON als dimensie. Met de tenant of record-id erin
        // zou het aantal metriekreeksen meegroeien met het aantal klanten en
        // records · dat maakt een dashboard onbruikbaar en duur. De tenant zit
        // al als eigen dimensie op logs en securityevents.
        route: routePattern(url.pathname),
        status: res.statusCode,
      });
    } catch (_) { /* telemetrie mag een request nooit breken */ }
  }
});

// Eerst de data laden (netwerk-adapter), dan pas luisteren. Zo valt er nooit
// een verzoek op een half-geïnitialiseerde store.
// Luister VOORDAT de store geladen is · zie de bootgate hierboven. Zonder dit
// zag het platform "No open ports detected" en werd de instantie nooit gezond.
httpServer.listen(config.port, () => {
  console.log(`Monargo One Fullstack luistert op poort ${config.port} · bezig met opstarten…`);
});

// CTO3-01 · verplichte bootflush. De boot-mutaties (seed + eerste backup) MOETEN
// duurzaam zijn vóór we businessverkeer openen. Een mislukte flush is een harde
// startupfout (fail-closed), geen best-effort: de fout propageert naar de outer
// catch die het proces met exitcode 1 stopt. GEEN catch(_){} · nooit stil door.
async function bootFlush() {
  // Durability-testseam: laat de verplichte bootflush GECONTROLEERD falen om de
  // fail-closed-semantiek te bewijzen. Strikt buiten productie en enkel wanneer
  // expliciet gevraagd · nooit een pad in een echte deploy.
  if (process.env.WFP_FAULT_BOOTFLUSH === "1" && !config.isProduction) {
    const e = new Error("bootflush faalde (durability-testinjectie)"); e.code = "BOOTFLUSH_FAILED"; throw e;
  }
  if (store.isDirty && store.isDirty()) await store.flush();
}

(async () => {
  if (storeNeedsAsyncLoad) {
    // Schema vóór data (CTO-review 4.3-vondst): de transactionele flush schrijft
    // óók naar outbox_events · op een VERSE database bestond die tabel pas na
    // een handmatige migratie, waardoor de eerste muterende request faalde.
    // De migratie-runner is idempotent en draait daarom altijd bij boot.
    if (storeAdapter.name === "postgres" && storeAdapter.pool) {
      setBootState("migrating");
      const { runMigrations, migrationStatus } = require("./infrastructure/postgres/migration-runner");
      await runMigrations(storeAdapter.pool);
      // Migratieversie cachen voor de readiness-samenvatting (CTO3-05).
      try {
        const st = await migrationStatus(storeAdapter.pool);
        bootMigrationVersion = { applied: st.applied.length, total: st.total, latest: st.applied.length ? st.applied[st.applied.length - 1].id || st.applied[st.applied.length - 1] : null };
      } catch (_) { /* niet-blokkerend · readiness toont dan null */ }
    }
    // initAsync neemt (bij single-writer) eerst de writer-lock en laadt daarna
    // de staat · vandaar waiting_lock → loading.
    setBootState(config.singleWriter ? "waiting_lock" : "loading");
    await store.initAsync();
    setBootState("loading");
    console.log(`  Database  : verbonden (${config.storageAdapter})`);
  }
  // Opstarttaken opzetten (incl. de eerste achtergrond-backupronde) TERWIJL de
  // bootgate nog dicht is.
  startServer();
  // Laat die eerste achtergrondronde lopen en de boot-mutaties volledig
  // wegschrijven VOORDAT we verkeer aannemen. Zonder dit kan de eerste boot-flush
  // racen met de flush van de allereerste request-write · onder een harde kill
  // vlak daarna gaat die write dan verloren. Settelen = deterministisch.
  await new Promise(res => setImmediate(res));
  setBootState("flushing");
  // Durability-testseam: een observeerbaar niet-ready venster in state=flushing,
  // om te bewijzen dat businessverkeer 503 krijgt tot state=ready. Strikt buiten
  // productie.
  if (process.env.WFP_FAULT_BOOTDELAY_MS && !config.isProduction) {
    await new Promise(res => setTimeout(res, Number(process.env.WFP_FAULT_BOOTDELAY_MS) || 0));
  }
  await bootFlush();
  // Pas nu is de staat geladen, geflusht en zijn we de enige schrijver: de
  // bootgate gaat open en het volledige verkeer wordt bediend.
  setBootState("ready");
})().catch(err => {
  setBootState("failed");
  console.error(`[start] STARTUP_FAILED code=${err.code || "STARTUP_FAILED"}: ${err.message}`);
  // Een TLS-ketenfout is bijna altijd een ONTBREKENDE root-CA, niet een defecte
  // database. Zonder deze hint leest de operator enkel "self-signed certificate
  // in certificate chain" en is niet duidelijk welke knop hij moet omzetten.
  // De single-writer-guard (CTO-03) botst met een zero-downtime deploy: het
  // platform verdraagt maar EEN schrijver op platform_state, terwijl Render en
  // vergelijkbare platformen de nieuwe instantie starten VOOR ze de oude
  // stoppen. De nieuwe wacht dan op een lock die de oude pas loslaat als de
  // nieuwe gezond is · dat loopt vast. De uitweg is een stop-eerst-deploy.
  if (/single-writer/i.test(err.message || "")) {
    console.error(
      `[start] deploy-hint: dit platform verdraagt maar EEN schrijver en deze instantie kreeg de ` +
      `lock niet binnen ${Math.round(config.singleWriterWaitMs / 1000)} s. Normaal lost dit zichzelf op: ` +
      "de server luistert al tijdens het wachten, dus de healthcheck wordt groen, het platform stopt " +
      "de oude instantie en de lock valt vrij. Blijft het hangen, dan draait er nog een oude instantie " +
      "die niet gestopt wordt: stop die expliciet (op Render: Suspend en daarna Resume, of schaal naar " +
      "0 instanties en terug naar 1). Zet SINGLE_WRITER niet uit: die guard bestaat juist omdat " +
      "overlappende schrijvers eerder stil dataverlies op platform_state veroorzaakten."
    );
  }
  if (/self[- ]signed|certificate|CERT_|unable to (get|verify)/i.test(err.message || "")) {
    console.error(
      "[start] TLS-hint: DATABASE_SSL_MODE staat in productie standaard op 'verify-full', " +
      "dus de certificaatketen van de database MOET te valideren zijn. Zet DATABASE_CA_CERT " +
      "op de PEM van de root-CA van je provider (volledige inhoud incl. BEGIN/END-regels), " +
      "of zet tijdelijk DATABASE_SSL_MODE=require om enkel te versleutelen zonder de keten " +
      "te valideren (zwakker · zie CTO-13)."
    );
  }
  process.exit(1);
});

function startServer() {
  // Luisteren gebeurt al bij het opstarten (zie de bootgate); hier draaien we
  // alleen nog de opstarttaken die een geladen store nodig hebben. Synchroon
  // (niet via setImmediate): zo draaien ze in exact dezelfde ordening t.o.v.
  // store-ready als voorheen · een extra tick liet de eerste achtergrond-flush
  // racen met een vroege request-write onder een harde kill.
  (() => {
  console.log(`Monargo One Fullstack draait op http://localhost:${config.port}`);
  console.log(`  Omgeving  : ${config.isProduction ? "production" : "development"}`);
  console.log(`  Opslag    : ${config.storageAdapter}`);
  console.log(`  Versie    : ${config.appVersion} (${config.commitSha})`);
  console.log(`  MFA-eis   : ${process.env.REQUIRE_ADMIN_MFA === "false" ? "uitgeschakeld (dev)" : "verplicht voor admins"}`);

  // Pas opgeslagen e-mailconfig toe op de mailer (DB overschrijft env)
  try { setRuntimeConfig(loadPlatformConfig(store).email); } catch (_) {}
  try { setPlanPriceOverrides(loadPlatformConfig(store).planPrices); } catch (_) {}

  // Auto-backup + retentie-opruiming (max 1 backup/dag/tenant). Bij opstart én
  // dagelijks. createBackup ruimt zelf al op volgens het bewaarbeleid; voor
  // tenants zonder nieuwe backup vandaag dwingen we het beleid alsnog af.
  const runBackupCycle = () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const tenants = store.data.tenants || [];
      let backed = 0, pruned = 0;
      tenants.forEach(t => {
        const sysActor = { email: "system@workflowpro", id: "system", role: "super_admin", tenantId: t.id };
        try {
          const existing = listBackups(t.id);
          const hasToday = existing.some(b => (b.createdAt||"").startsWith(today));
          if (!hasToday) { createBackup(store, t, sysActor); backed++; }
          else { pruned += pruneTenantBackups(store, t, sysActor) || 0; }
        } catch(_) {}
      });
      if (backed > 0 || pruned > 0) console.log(`  Backup    : ${backed} gebackupt, ${pruned} opgeruimd (retentie)`);
    } catch(_) {}
  };
  setImmediate(runBackupCycle);
  setInterval(runBackupCycle, 24 * 60 * 60 * 1000).unref();

  // Auditretentie (F-10): één expliciete opruimronde per dag, PER TENANT, met
  // een rapport. Schrijven kapt nooit af; alleen deze job verwijdert iets.
  const runAuditRetention = () => {
    try {
      const res = pruneAudit(store);
      if (res.removed > 0) {
        console.log(`  Audit     : ${res.removed} regel(s) opgeruimd volgens retentie (${res.kept} bewaard)`);
        // Het opruimen zelf is auditwaardig: anders is een gat niet te verklaren.
        store.audit({ actor: "system", tenantId: null, action: "audit_retention_applied", area: "audit",
          detail: `${res.removed} verwijderd, ${res.kept} bewaard` });
      }
    } catch (e) { console.error("[audit] retentie mislukt:", e.message); }
  };
  setTimeout(runAuditRetention, 120 * 1000).unref();
  setInterval(runAuditRetention, 24 * 60 * 60 * 1000).unref();

  // Duurzame outbox-retentie (P0-05): bezorgde events ouder dan 30 dagen.
  if (storeAdapter.name === "postgres" && typeof storeAdapter.pruneOutbox === "function") {
    const runOutboxPrune = async () => {
      try {
        const r = await storeAdapter.pruneOutbox({ keepDays: 30 });
        if (r.removed) console.log(`  Outbox    : ${r.removed} bezorgde event(s) ouder dan 30 dagen opgeruimd`);
      } catch (e) { console.error("[outbox] opruimen mislukt:", e.message); }
    };
    setTimeout(runOutboxPrune, 240 * 1000).unref();
    setInterval(runOutboxPrune, 24 * 60 * 60 * 1000).unref();
  }

  // Idempotency-sleutels (h41) verlopen na 24u; ruim ze dagelijks op.
  const runIdempotencyPrune = () => {
    try {
      const removed = idempotency.pruneExpired(store);
      if (removed > 0) console.log(`  Idempotent: ${removed} verlopen sleutel(s) opgeruimd`);
    } catch (e) { console.error("[idempotency] opruimen mislukt:", e.message); }
  };
  setTimeout(runIdempotencyPrune, 180 * 1000).unref();
  setInterval(runIdempotencyPrune, 24 * 60 * 60 * 1000).unref();

  // Trial-to-paid conversie-nudges: één keer per dag kijken welke tenant een
  // proef-mijlpaal bereikt (dag 7/3/1, verlopen, geblokkeerd) en de admins een
  // in-app melding geven. Idempotent per mijlpaal via sourceRef, dus nooit spam.
  const runTrialNudges = () => {
    try {
      let sent = 0;
      for (const tenant of store.data.tenants || []) {
        const nudge = trialNudge(tenant);
        if (!nudge) continue;
        const sourceRef = `trial:nudge:${nudge.stage}`;
        if ((store.data.notifications || []).some(n => n.tenantId === tenant.id && n.sourceRef === sourceRef)) continue;
        createNotification(store, tenant, {
          type: "billing", audience: "admins", title: nudge.title, body: nudge.body,
          priority: nudge.stage === "blocked" || nudge.stage === "d1" ? "high" : "normal",
          sourceRef,
        }, { email: "trial-nudge" });
        sent++;
      }
      if (sent > 0) console.log(`  Trial     : ${sent} conversie-nudge(s) verstuurd`);
    } catch (e) { console.error("[trial] nudges mislukt:", e.message); }
  };
  setTimeout(runTrialNudges, 150 * 1000).unref();
  setInterval(runTrialNudges, 24 * 60 * 60 * 1000).unref();

  // Metrics periodiek uitschrijven (handover 4.7). Eén regel per venster met
  // count/avg/min/max, zodat een collector of logdrain ze kan oppikken zonder
  // dat elke meting een logregel wordt.
  const flushMetrics = () => {
    try {
      const rows = telemetry.flushMetrics();
      if (rows.length) console.log(JSON.stringify({ type: "metrics", at: new Date().toISOString(), metrics: rows }));
    } catch (e) { console.error("[telemetry] metrics flush mislukt:", e.message); }
  };
  setInterval(flushMetrics, 60 * 1000).unref();

  // Support-toegang: jaarlijkse mededeling + auto-renew. Bij opstart + dagelijks.
  const reviewSupportAccess = () => { try { runSupportAccessReview(store); } catch (_) {} };
  setImmediate(reviewSupportAccess);
  setInterval(reviewSupportAccess, 24 * 60 * 60 * 1000).unref();

  // CTO3-07 · sweeper voor gedelegeerde tenanttoegang: kantelt verlopen grants
  // naar 'expired'. De weigering zelf is al fail-closed op het weigermoment
  // (delegationDecision toetst endDate), maar de sweeper houdt de administratie
  // eerlijk zodat een verlopen grant nergens nog als 'active' oogt.
  const sweepDelegatedAccess = () => {
    try {
      const r = resellerTenantsSvc.expireDelegatedAccess(store, Date.now());
      if (r && r.expired > 0) console.log(`  Delegatie: ${r.expired} verlopen grant(s) afgesloten`);
    } catch (_) { /* sweeper mag nooit de server breken */ }
  };
  setImmediate(sweepDelegatedAccess);
  setInterval(sweepDelegatedAccess, 24 * 60 * 60 * 1000).unref();

  // Automatische betaalherinneringen: opt-in per tenant, om de 6 uur een ronde.
  // Het beleid in payment-reminders (interval + max) maakt de job idempotent;
  // in dev/test verstuurt de mailer sowieso niets echts (guardrails).
  const runReminderCycle = () => {
    runPaymentReminders(store, config)
      .then(r => { if (r.sent > 0) console.log(`  Herinnering: ${r.sent} betaalherinnering(en) verstuurd`); })
      .catch(() => {});
    // Afspraak-reminders naar de klant (module appointments · submodule reminders).
    runAppointmentReminders(store, config)
      .then(r => { if (r.sent > 0) console.log(`  Herinnering: ${r.sent} afspraak-reminder(s) verstuurd`); })
      .catch(() => {});
  };
  setTimeout(runReminderCycle, 60 * 1000).unref();
  setInterval(runReminderCycle, 6 * 60 * 60 * 1000).unref();

  // Mona Prepare · proactieve dagelijkse digest (h48). Per tenant berekent Mona
  // het VOORBEREIDE werk en maakt één in-app melding ("X dingen klaargezet"),
  // zodat de gebruiker het niet eens hoeft te vragen. Idempotent per dag via
  // sourceRef; alleen actionable werk telt (anders is de melding ruis). De
  // digest draait op het rechtenniveau van een echte tenant-admin.
  const runMonaDigest = () => {
    try {
      const day = new Date().toISOString().slice(0, 10);
      for (const tenant of store.data.tenants || []) {
        const admin = (store.data.users || []).find(u => u.tenantId === tenant.id && u.role === "tenant_admin" && u.active !== false);
        if (!admin) continue;
        const sourceRef = `mona:digest:${day}`;
        const already = (store.data.notifications || []).some(n => n.tenantId === tenant.id && n.sourceRef === sourceRef);
        if (already) continue;
        const digest = buildDailyDigest(store, tenant, admin);
        if (digest.actionable < 1) continue;
        const body = `Mona heeft ${digest.actionable} ding(en) voor je klaargezet: ${digest.titles.join(" · ")}. Open "Voorbereid voor jou" om ze te bevestigen.`;
        createNotification(store, tenant, {
          type: "mona", audience: "admins", title: `${digest.actionable} ding(en) voorbereid`,
          body, priority: "normal", sourceRef,
        }, { email: "mona" });
      }
    } catch (_) { /* een digest mag nooit het proces breken */ }
  };
  setTimeout(runMonaDigest, 90 * 1000).unref();
  setInterval(runMonaDigest, 24 * 60 * 60 * 1000).unref();

  // Maandelijkse prestatiestaat-melding: begin van de maand meldt Mona dat de
  // prestatiestaat van de VORIGE maand klaarstaat om door te sturen naar het
  // sociaal secretariaat. Idempotent per maand (sourceRef). Enkel als het
  // secretariaat geconfigureerd is én er data is. Geen aangifte · een seintje.
  const runPayrollDigest = () => {
    try {
      for (const tenant of store.data.tenants || []) {
        const ss = (tenant.compliance || {}).socialSecretariat;
        if (!ss || !ss.affiliateNumber) continue;   // niet geconfigureerd → geen melding
        const digest = buildPayrollDigest(store, tenant);
        if (!digest.hasData) continue;
        const sourceRef = `payroll:digest:${digest.month}`;
        if ((store.data.notifications || []).some(n => n.tenantId === tenant.id && n.sourceRef === sourceRef)) continue;
        createNotification(store, tenant, {
          type: "mona", audience: "admins", title: `Prestatiestaat ${digest.month} klaar`,
          body: `De prestatiestaat van ${digest.month} staat klaar om door te sturen naar ${digest.providerLabel}: ${digest.exportable} werknemer(s), ${digest.workedHours} gewerkte uren, ${digest.leaveDays} verlofdag(en). Download via Rapporten · Sociaal secretariaat.`,
          priority: "normal", sourceRef,
        }, { email: "mona" });
      }
    } catch (_) { /* een digest mag nooit het proces breken */ }
  };
  setTimeout(runPayrollDigest, 120 * 1000).unref();
  setInterval(runPayrollDigest, 24 * 60 * 60 * 1000).unref();

  // Webhook-bezorging (E19/h41), gecoördineerd via de JobQueue (4.6): elke
  // minuut één cyclus over ALLE replicas samen. De idempotencyKey is het
  // minuutvenster, dus hoeveel replicas er ook publiceren, er ontstaat precies
  // één job · en wie hem reserveert, draait de ronde. Crasht die replica, dan
  // valt de job via de visibility timeout terug naar een ander.
  const workerId = `wrk_${require("os").hostname()}_${process.pid}`;
  const runWebhookDelivery = async () => {
    try {
      const minute = new Date().toISOString().slice(0, 16);   // 2026-07-20T10:15
      await jobQueue.publish({
        tenantId: "platform", type: "webhook.deliver_cycle",
        payloadVersion: 1, idempotencyKey: minute, correlationId: `cycle_${minute}`,
      });
      const [job] = await jobQueue.reserve(workerId, 1);
      if (!job) return;                                        // een andere replica heeft dit venster
      try {
        const r = await deliverPending(store, { transport: webhookTransport, limit: 50 });
        if (r.attempted > 0) console.log(`  Webhooks: ${r.delivered} bezorgd, ${r.failed} mislukt`);
        await jobQueue.acknowledge(job.id);
      } catch (err) {
        // De outbox bewaart zijn eigen retry-staat; de cyclus zelf mag opnieuw.
        await jobQueue.retry(job.id, err.message).catch(() => {});
        throw err;
      }
      // Opportunistisch oud done-werk opruimen · historie is telemetrie, geen archief.
      await jobQueue.pruneDone(7).catch(() => {});
    } catch (e) {
      console.error("[webhooks] bezorgronde mislukt:", e.message);
    }
  };
  setTimeout(runWebhookDelivery, 30 * 1000).unref();
  setInterval(runWebhookDelivery, 60 * 1000).unref();
  })();
}

// ── Graceful shutdown ─────────────────────────────────────────
// Elk container-platform (Kubernetes, Azure Container Apps, Cloud Run, Fly,
// Render, een eigen VPS) stuurt SIGTERM vóór een deploy/restart. We ronden
// lopende requests af én schrijven openstaande wijzigingen weg, zodat een
// herstart nooit stil data verliest.
function gracefulShutdown(signal) {
  console.log(`[shutdown] ${signal} ontvangen · server sluit af…`);
  const done = () => process.exit(0);
  Promise.resolve()
    .then(() => (store.isDirty() ? store.flush() : null))
    .then(() => (typeof storeAdapter.close === "function" ? storeAdapter.close() : null))
    .then(done)
    .catch(err => { console.error(`[shutdown] wegschrijven mislukt: ${err.message}`); process.exit(1); });
  // Geef lopende requests 10 s. CTO-05: loopt de flush vast terwijl er nog
  // niet-gepersisteerde wijzigingen staan, dan is dat een ZICHTBARE fout
  // (exit 1) · nooit stil afsluiten met dataverlies.
  setTimeout(() => {
    const dirty = typeof storeAdapter.isDirty === "function" ? storeAdapter.isDirty() : false;
    console.log(`[shutdown] Timeout bereikt · forceer stop${dirty ? " · WAARSCHUWING: niet-gepersisteerde wijzigingen" : ""}`);
    process.exit(dirty ? 1 : 0);
  }, 10_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", err => {
  console.error("[uncaughtException]", err.message, err.stack);
  // Niet crashen bij een onverwachte fout in een request-handler;
  // de error is al gelogd via handleError(). Alleen crashen bij echte fatale fouten.
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
