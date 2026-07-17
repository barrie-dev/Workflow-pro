const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { config } = require("./lib/config");
const { sendJson, readBody, readRawBody, securityHeaders, corsHeaders } = require("./lib/http");
const { checkRateLimit } = require("./lib/rate-limit");
const { Store, BUSINESS_ADMIN_PERMISSIONS, MANAGER_PERMISSIONS, EMPLOYEE_PERMISSIONS } = require("./lib/store");
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
  projects: ["projects"],
  expenses: ["expenses"], leaves: ["leaves"], messages: ["messages"],
  customers: ["customers"], venues: ["venues"], stock: ["stock"], vehicles: ["vehicles"],
  facturen: ["invoicing", "billing"], offertes: ["invoicing", "billing"],
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
const { normalizeIncident, incidentsToCsv } = require("./modules/incidents");
const { INQUIRY_STATUSES, ensureIntake, intakeAddress, newIntakeToken, parseInboundPayload, resolveIntakeTenant, createInquiry } = require("./modules/inbox");
const { estimateFromQuestion } = require("./modules/estimator");
const { emitDomainEvent, listOutbox } = require("./platform/events");
const { ensureDefaultCompany, issueNumber } = require("./platform/companies");
const { applyScope, redactSensitive } = require("./platform/policy");
const { makeCustomerRepository } = require("./platform/crm");
const { makeProjectRepository } = require("./platform/projects");
const { freezeSentVersion, reviseQuote, computeDocumentHash } = require("./platform/quote-versions");
const { listPlanningItems, planningOverlap } = require("./platform/planning");
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
  processStripeWebhook
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
const { commissionOverview, publicReseller, commissionPctFor } = require("./modules/resellers");
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
const { sendMail, setRuntimeConfig, isMailLive, recentMail } = require("./lib/mailer");
const { productionReadiness } = require("./modules/production");
const { eventLog, backupSummary, lifecycle, resellerPayouts, securityCenter, gdprOverview } = require("./modules/platform-ops");
const { setPlanPriceOverrides, planPricing } = require("./modules/billing");
const { loadPlatformConfig, publicPlatformConfig, savePlatformConfig } = require("./modules/platform-config");
const { createPaymentLink, markInvoicePaidById } = require("./modules/payments");
const { createSubscriptionCheckout, createBillingPortalSession, applySubscriptionEvent, TRIAL_DAYS } = require("./modules/subscriptions");
const { pushConfigured, publicKey: pushPublicKey, saveSubscription: savePushSubscription, removeSubscription: removePushSubscription } = require("./modules/push");
const { verifyStripeSignature } = require("./modules/stripe-webhook");
const { seedDemoData, clearDemoData } = require("./modules/demo-seed");
const { buildUbl, validatePeppol, sendPeppolInvoice } = require("./modules/peppol-invoice");
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

const store = new Store();
const customerRepo = makeCustomerRepository(store);
const projectRepo = makeProjectRepository(store);

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

function handleError(req, res, error, tenantId = null) {
  const status = error.status || 500;
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
      (done? '<div class="banner '+(q.status==="aanvaard"?"ok":"warn")+'">'+(q.status==="aanvaard"?"✅ Offerte aanvaard · bedankt!":"Offerte geweigerd")+'</div>'
        : expired? '<div class="banner warn">Deze offerte is verlopen. Neem contact op voor een nieuwe.</div>'
        : '<div class="actions"><button class="accept" onclick="decide(\\'accept\\')">✓ Offerte aanvaarden</button><button class="reject" onclick="decide(\\'reject\\')">Weigeren</button></div>');
  }catch(e){ document.getElementById("body").innerHTML='<div class="muted">Er ging iets mis. Probeer later opnieuw.</div>'; }
}
async function decide(decision){
  if(decision==="accept" && !confirm("Offerte aanvaarden?")) return;
  if(decision==="reject" && !confirm("Offerte weigeren?")) return;
  const d = await (await fetch("/api/public/quote/"+token,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({decision})})).json();
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

http.createServer(async (req, res) => {
  const url = new URL(req.url, config.appUrl);
  let errorTenantId = url.pathname.match(/^\/api\/tenants\/([^/]+)\//)?.[1] || null;
  // Correlatie-id (backend-handoff): elk antwoord draagt een requestId zodat een
  // testerscreenshot naar de juiste serverlog leidt. Geen gevoelige data.
  res.wfpRequestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  res.setHeader("x-request-id", res.wfpRequestId);

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

    if (url.pathname === "/api/health") {
      const storeStatus = store.storageStatus ? store.storageStatus() : { ok: true };
      sendJson(res, 200, {
        ok: true,
        app: "Monargo One Fullstack",
        appEnv: config.appEnv,
        version: config.appVersion,
        releaseChannel: config.releaseChannel,
        commitSha: config.commitSha,
        storageAdapter: config.storageAdapter,
        storeReady: storeStatus?.ok !== false,
        modules: modules.length,
        uptime: Math.floor(process.uptime()),
        time: new Date().toISOString()
      });
      return;
    }

    // Kubernetes/Render/Railway liveness probe
    if (url.pathname === "/api/ready") {
      const storeStatus = store.storageStatus ? store.storageStatus() : { ok: true };
      const ready = storeStatus?.ok !== false;
      sendJson(res, ready ? 200 : 503, { ok: ready, store: storeStatus });
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
    if (pubQuoteMatch && req.method === "POST") {
      const token = pubQuoteMatch[1];
      const body = await readBody(req).catch(() => ({}));
      for (const t of store.data.tenants || []) {
        const q = store.list("quotes", t.id).find(x => x.publicToken === token);
        if (q) {
          if (["aanvaard", "geweigerd"].includes(q.status)) return sendJson(res, 409, { ok: false, error: "Offerte is al verwerkt" });
          const decision = body.decision === "reject" ? "geweigerd" : "aanvaard";
          const patch = { status: decision, updatedAt: new Date().toISOString() };
          if (decision === "aanvaard") {
            patch.acceptedAt = new Date().toISOString();
            // Digitale goedkeuring (h19): bind aan versie + documenthash + metadata.
            patch.acceptance = {
              name: String(body.name || q.customerName || "klant").slice(0, 120),
              at: patch.acceptedAt,
              version: q.version || 1,
              documentHash: q.documentHash || computeDocumentHash({ ...q, version: q.version || 1 }),
              ip: (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || null,
              userAgent: String(req.headers["user-agent"] || "").slice(0, 200),
            };
          } else {
            patch.rejectedAt = new Date().toISOString();
          }
          store.update("quotes", q.id, patch);
          store.audit({ actor: q.customerName || "klant", tenantId: t.id, action: `quote_${decision}_public`, area: "offertes", detail: q.number });
          emitDomainEvent(store, { tenantId: t.id, eventType: decision === "aanvaard" ? "quote.accepted" : "quote.rejected", aggregateType: "quote", aggregateId: q.id, actor: "public-accept", correlationId: res.wfpRequestId });
          return sendJson(res, 200, { ok: true, status: decision });
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
      // KBO-gegevens meteen in het facturatieprofiel zetten (volledige onboarding-start).
      const invoiceProfile = kbo
        ? { vat: kbo.vat, companyNumber: kbo.companyNumber, name: kbo.name, street: kbo.street || "", zip: kbo.zip || "", city: kbo.city || "" }
        : {};
      const tenant = store.insert("tenants", {
        id: `tenant_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name: companyName, plan: bundle.key, status: "trial", billingEmail: email,
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
      // goedkeuring ontvangt de aanvrager de activatiemail om zijn wachtwoord te kiezen.
      store.insert("users", {
        id: `reseller_user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        tenantId: null, name, email, passwordHash: "",
        role: "reseller", permissions: [], resellerId: reseller.id,
        mfaEnabled: false, mfaEnforced: false, active: false, createdAt: now
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
      sendJson(res, 200, { ok: true, user: safeUser(user), entitlements, supportSession, platform, onboarding, terminology, capabilities });
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
      // MRR schatting per plan
      const MRR_PLAN = { starter: 9, business: 18, enterprise: 29 };
      let mrr = 0;
      tenants.filter(t => t.status === "active").forEach(t => {
        const users = store.list("users", t.id).length;
        mrr += (MRR_PLAN[t.plan] || 18) * Math.max(users, 1);
      });
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
      const users = store.data.users.filter(u => u.role === "super_admin").map(safe);
      sendJson(res, 200, { ok: true, users });
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
      const reseller = store.insert("resellers", {
        id: `reseller_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        tenantId: null, name, contactEmail: String(body.contactEmail || loginEmail),
        status: "active", defaultCommissionPct: pct, createdBy: user.email, createdAt: now
      });
      // Geen wachtwoord door de aanmaker: de reseller ontvangt een activatiemail.
      const { user: loginUser, activationLink } = provisionPendingUser({
        id: `reseller_user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        tenantId: null, name, email: loginEmail,
        role: "reseller", permissions: [], resellerId: reseller.id,
        mfaEnabled: false, mfaEnforced: false
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
      const patch = {};
      if (typeof body.status === "string" && ["active", "paused"].includes(body.status)) patch.status = body.status;
      if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
      if (body.defaultCommissionPct !== undefined) patch.defaultCommissionPct = Math.min(Math.max(Number(body.defaultCommissionPct) || 0, 0), 100);
      const updated = store.update("resellers", reseller.id, { ...patch, updatedAt: new Date().toISOString() });
      let activationLink = null;
      if (patch.status) {
        (store.data.users || []).filter(u => u.role === "reseller" && u.resellerId === reseller.id)
          .forEach(u => {
            if (patch.status === "active") {
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
      store.audit({ actor: user.email, tenantId: null, action: "reseller_updated", area: "resellers", detail: `${reseller.name} ${JSON.stringify(patch)}` });
      sendJson(res, 200, { ok: true, reseller: publicReseller(updated, store), activationLink });
      return;
    }

    // ── Reseller-portaal: enkel commerciële data van EIGEN klanten ─────────────
    if (url.pathname === "/api/reseller/clients" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller || reseller.status !== "active") return sendJson(res, 403, { ok: false, error: "Reseller-account niet actief" });
      sendJson(res, 200, { ok: true, reseller: { name: reseller.name, defaultCommissionPct: reseller.defaultCommissionPct }, ...commissionOverview(store, reseller) });
      return;
    }
    if (url.pathname === "/api/reseller/clients" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertReseller(user);
      const reseller = store.get("resellers", user.resellerId);
      if (!reseller || reseller.status !== "active") return sendJson(res, 403, { ok: false, error: "Reseller-account niet actief" });
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      const adminEmail = String(body.adminEmail || "").trim().toLowerCase();
      if (!name) return sendJson(res, 400, { ok: false, error: "Klantnaam is verplicht" });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) return sendJson(res, 400, { ok: false, error: "Geldig admin-e-mailadres is verplicht" });
      if (store.getUserByEmail(adminEmail)) return sendJson(res, 409, { ok: false, error: "Er bestaat al een gebruiker met dit e-mailadres" });
      const plan = ["starter", "business", "enterprise"].includes(body.plan) ? body.plan : "business";
      const now = new Date().toISOString();
      const tenant = store.insert("tenants", {
        id: `tenant_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name, plan, status: "trial", billingEmail: adminEmail,
        invoiceProfile: {}, onboarding: {}, billingOps: { invoiceHistory: [] },
        supportAccess: { allowed: false }, resellerId: reseller.id, createdAt: now
      });
      // Geen wachtwoord door de reseller: de klant-admin ontvangt een activatiemail.
      const { activationLink } = provisionPendingUser({
        id: `user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        tenantId: tenant.id, name: body.adminName || "Klant admin", email: adminEmail,
        role: "tenant_admin", permissions: BUSINESS_ADMIN_PERMISSIONS,
        mfaEnabled: false, mfaEnforced: false
      });
      store.audit({ actor: user.email, tenantId: tenant.id, action: "reseller_client_created", area: "resellers", detail: `${reseller.name} → ${name}` });
      sendJson(res, 201, { ok: true, client: { tenantId: tenant.id, name: tenant.name, plan: tenant.plan, status: tenant.status, commissionPct: commissionPctFor(tenant, reseller) }, activationLink });
      return;
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
      const MRR_PLAN = { starter: 9, business: 18, enterprise: 29 };
      const rows = store.data.tenants.map(t => {
        const users = store.list("users", t.id).length;
        const mrrUnit = MRR_PLAN[t.plan] || 18;
        const mrr = t.status === "active" ? mrrUnit * Math.max(users, 1) : 0;
        return { id: t.id, name: t.name, plan: t.plan, status: t.status,
          users, mrrUnit, mrr, arr: mrr * 12, billingEmail: t.billingEmail || "" };
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

      // ── Mona AI-assistent (route-naam boden blijft voor compatibiliteit) (beschikbaar voor elke ingelogde tenant-gebruiker;
      //    de tools binnen Mona bewaken zelf de data-rechten) ──
      if (action === "boden" && req.method === "POST") {
        assertInteractiveUser(user);
        const body = await readBody(req);
        try {
          const result = await bodenChat(store, tenant, user, body.messages || []);
          sendJson(res, 200, { ok: true, ...result });
        } catch (e) {
          sendJson(res, e.status || 500, { ok: false, error: e.message });
        }
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
        sendJson(res, 201, { ok: true, shift });
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
        sendJson(res, 200, { ok: true, projects: redactSensitive(user, "projects", projectRepo.list(tenantId)) });
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

      // ── Klanten (customers) ───────────────────────────────────────────────────
      if (action === "customers" && req.method === "GET") {
        assertCan(user, "customers");
        // Compatibility read (E03/M1): legacy platte records worden naar het
        // canonieke model getild; gevoelige velden (creditLimit) gered. voor niet-beheerders.
        sendJson(res, 200, { ok: true, customers: redactSensitive(user, "customers", customerRepo.list(tenantId)) });
        return;
      }
      if (action === "customers" && req.method === "POST") {
        assertCan(user, "customers");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = customerRepo.insert(tenantId, body, user.email); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code }); }
        store.audit({ actor: user.email, tenantId, action: "customer_created", area: "customers", detail: row.name });
        emitDomainEvent(store, { tenantId, eventType: "customer.created", aggregateType: "customer", aggregateId: row.id, actor: user.email, correlationId: res.wfpRequestId });
        sendJson(res, 201, { ok: true, customer: row });
        return;
      }
      const customerMatch = action.match(/^customers\/([^/]+)$/);
      if (customerMatch && req.method === "PATCH") {
        assertCan(user, "customers");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        let row;
        try { row = customerRepo.update(tenantId, customerMatch[1], body, user.email, body.expectedVersion); }
        catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.message, code: e.code, currentVersion: e.currentVersion }); }
        store.audit({ actor: user.email, tenantId, action: "customer_updated", area: "customers", detail: customerMatch[1] });
        emitDomainEvent(store, { tenantId, eventType: "customer.updated", aggregateType: "customer", aggregateId: customerMatch[1], actor: user.email, correlationId: res.wfpRequestId, data: { changedFields: Object.keys(body) } });
        sendJson(res, 200, { ok: true, customer: row });
        return;
      }
      if (customerMatch && req.method === "DELETE") {
        assertCan(user, "customers");
        assertInteractiveUser(user);
        store.remove("customers", customerMatch[1]);
        store.audit({ actor: user.email, tenantId, action: "customer_deleted", area: "customers", detail: customerMatch[1] });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Facturen (klantfacturen) ──────────────────────────────────────────────
      if (action === "facturen" && req.method === "GET") {
        assertInvoicing(user);
        const rows = store.list("invoices", tenantId);
        // Mark overdue: open invoices past due date
        const today = new Date().toISOString().slice(0, 10);
        const enriched = rows.map(inv => {
          if (inv.status === "open" && inv.dueDate && inv.dueDate < today) {
            return { ...inv, status: "overdue" };
          }
          return inv;
        });
        sendJson(res, 200, { ok: true, invoices: enriched });
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
        const company = ensureDefaultCompany(store, tenant);
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
        const { passwordHash, mfaSecret, mfaPendingSecret, recoveryCodes, newPassword, role: bodyRole, permissions: bodyPerms, ...safe } = body;
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
        // Geen wachtwoord door de aanmaker: de medewerker ontvangt een activatiemail
        // en stelt binnen de geldigheidsperiode zelf zijn wachtwoord in.
        const { user: newUser, activationLink } = provisionPendingUser({
          id: `user_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
          tenantId,
          name: String(body.name || "").trim() || email,
          email,
          role,
          permissions,
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
        // Auto-generate sequential workorder number (WO-YYYY-NNN)
        const existingWOs = store.list("workorders", tenantId);
        const year = new Date().getFullYear();
        const yearWOs = existingWOs.filter(w => (w.number||"").startsWith(`WO-${year}-`));
        const seq = yearWOs.length + 1;
        const woNumber = `WO-${year}-${String(seq).padStart(3, "0")}`;
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
  }
}).listen(config.port, () => {
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

  // Support-toegang: jaarlijkse mededeling + auto-renew. Bij opstart + dagelijks.
  const reviewSupportAccess = () => { try { runSupportAccessReview(store); } catch (_) {} };
  setImmediate(reviewSupportAccess);
  setInterval(reviewSupportAccess, 24 * 60 * 60 * 1000).unref();

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
});

// ── Graceful shutdown ─────────────────────────────────────────
// PaaS-platforms (Render, Railway, Heroku) sturen SIGTERM vóór een deploy/restart.
// We geven lopende requests maximaal 10 s om af te ronden vóór we stoppen.
function gracefulShutdown(signal) {
  console.log(`[shutdown] ${signal} ontvangen · server sluit af…`);
  // Geef lopende requests 10 s
  setTimeout(() => {
    console.log("[shutdown] Timeout bereikt · forceer stop");
    process.exit(0);
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
