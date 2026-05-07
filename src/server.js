const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { config } = require("./lib/config");
const { sendJson, readBody, readRawBody } = require("./lib/http");
const { checkRateLimit } = require("./lib/rate-limit");
const { Store, BUSINESS_ADMIN_PERMISSIONS } = require("./lib/store");
const { hashPassword } = require("./lib/security");
const {
  authenticate,
  login,
  loginWithMfa,
  safeUser,
  createMfaSetup,
  verifyMfaSetup,
  resetLoginFailures,
  assertTenant,
  assertCan,
  assertSuperAdmin
} = require("./lib/auth");
const { modules } = require("./modules/registry");
const { listModule, createModuleRow, updateModuleRow } = require("./modules/crud");
const { lookupKbo } = require("./modules/kbo");
const {
  createSetupIntent,
  billingQuote,
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
const { todayPayload, completeWorkorder, attachWorkorderPhoto, signWorkorder, syncMobileQueue } = require("./modules/mobile");
const { clockIn, clockOut, approveExpense, managementReport } = require("./modules/operations");
const { listIntegrations, connectIntegration, updateMapping, runSync, retrySync } = require("./modules/integrations");
const { tenantStatus, unlockUser, listBackups, createBackup, backupPreview, restoreBackup, publicStatus } = require("./modules/admin");
const { createNotification, listNotifications, markNotificationRead, generateReminders, notificationSummary } = require("./modules/notifications");
const { importEmployees } = require("./modules/imports");
const { portalPayload, updateOnboardingStep } = require("./modules/portal");
const { listApiKeys, createApiKey, revokeApiKey, rotateApiKey, authenticateApiKey, recordApiKeyDenied } = require("./modules/api-keys");
const { apiKeyGovernance } = require("./modules/api-key-governance");
const { releaseInfo } = require("./modules/releases");
const { listSupportTickets, createSupportTicket, updateSupportTicket, supportSummary } = require("./modules/support");
const { pilotKpis, decisionReport } = require("./modules/pilot");
const { salesSummary, salesLaunchReadiness, advanceLead, addPartnerNote } = require("./modules/sales");
const { goLiveReadiness } = require("./modules/go-live");
const { listReports, getReport, generateStatusBundle } = require("./modules/reports");
const { listAuditEvents } = require("./modules/audit");
const { listErrorEvents } = require("./modules/errors");
const { homeSuggestion } = require("./modules/suggestions");
const { openApiSpec } = require("./modules/openapi");

const store = new Store();

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
  return authenticate(req, store) || authenticateApiKey(store, req.headers["x-api-key"], requestMetadata(req));
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
      stack: String(error.stack || "").split("\n").slice(0, 4).join("\n")
    });
  }
  sendJson(res, status, { ok: false, error: error.message || "Server error" });
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
    const type = ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : "text/html";
    res.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
    res.end(data);
  });
}

function verifyStripeSignature(rawBody, signatureHeader) {
  if (!config.stripe.webhookSecret) return { ok: true, mode: "unsigned-testmode" };
  const parts = Object.fromEntries(String(signatureHeader || "").split(",").map(part => part.split("=", 2)));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return { ok: false, mode: "missing-signature" };
  const expected = crypto
    .createHmac("sha256", config.stripe.webhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const ok = Buffer.byteLength(signature) === Buffer.byteLength(expected)
    && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  return { ok, mode: "signed" };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, config.appUrl);
  let errorTenantId = url.pathname.match(/^\/api\/tenants\/([^/]+)\//)?.[1] || null;

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
      sendJson(res, 200, {
        ok: true,
        app: "WorkFlow Pro Fullstack",
        mode: "production-foundation",
        modules: modules.length,
        time: new Date().toISOString()
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

    if (url.pathname === "/api/webhooks/stripe" && req.method === "POST") {
      const rawBody = await readRawBody(req);
      const signature = verifyStripeSignature(rawBody, req.headers["stripe-signature"]);
      if (!signature.ok) return sendJson(res, 400, { ok: false, error: "Invalid Stripe signature" });
      let event;
      try {
        event = rawBody ? JSON.parse(rawBody) : {};
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
      }
      const result = processStripeWebhook(store, event);
      sendJson(res, 200, { ok: true, signature: signature.mode, result });
      return;
    }

    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      const body = await readBody(req);
      const result = body.mfaCode
        ? loginWithMfa(store, body.email, body.password, body.mfaCode)
        : login(store, body.email, body.password);
      if (!result) return sendJson(res, 401, { ok: false, error: "Invalid credentials" });
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

    if (url.pathname === "/api/me") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      sendJson(res, 200, { ok: true, user: safeUser(user) });
      return;
    }

    if (url.pathname === "/api/me/mfa/setup" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertInteractiveUser(user);
      const setup = createMfaSetup(store, user);
      sendJson(res, 201, { ok: true, setup: { secret: setup.secret, otpauth: setup.otpauth, demoCode: setup.demoCode } });
      return;
    }

    if (url.pathname === "/api/me/mfa/verify" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertInteractiveUser(user);
      const body = await readBody(req);
      const result = verifyMfaSetup(store, user, body.code);
      sendJson(res, 200, { ok: true, user: result.user, recoveryCodes: result.recoveryCodes });
      return;
    }

    if (url.pathname === "/api/modules") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertApiKeyWriteAllowed(user, req);
      sendJson(res, 200, { ok: true, modules });
      return;
    }

    const moduleMatch = url.pathname.match(/^\/api\/modules\/([^/]+)(?:\/([^/]+))?$/);
    if (moduleMatch) {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertApiKeyWriteAllowed(user, req);
      const key = moduleMatch[1];
      const id = moduleMatch[2];
      const tenantId = url.searchParams.get("tenantId") || user.tenantId;
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
      const key = exportMatch[1];
      const tenantId = url.searchParams.get("tenantId") || user.tenantId;
      const rows = listModule(store, user, key, tenantId);
      sendCsv(res, `${key}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
      return;
    }

    const adminTenantMatch = url.pathname.match(/^\/api\/admin\/tenants(?:\/([^/]+))?$/);
    if (adminTenantMatch && req.method === "GET" && !adminTenantMatch[1]) {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      const rows = store.data.tenants.map(tenant => {
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
      sendJson(res, 200, { ok: true, rows });
      return;
    }

    if (adminTenantMatch && req.method === "POST" && !adminTenantMatch[1]) {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
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
        supportAccess: { enabled: false }
      });
      let adminUser = null;
      if (body.adminEmail) {
        adminUser = store.insert("users", {
          id: `user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId: tenant.id,
          name: body.adminName || "Klant admin",
          email: String(body.adminEmail).toLowerCase(),
          passwordHash: hashPassword(body.adminPassword || "Welkom123!"),
          role: "tenant_admin",
          permissions: BUSINESS_ADMIN_PERMISSIONS,
          mfaEnabled: false,
          mfaEnforced: false,
          active: true,
          lastLoginAt: null,
          failedLoginCount: 0,
          lockedUntil: null
        });
      }
      store.audit({ actor: user.email, tenantId: tenant.id, action: "tenant_created", area: "tenants", detail: tenant.name });
      sendJson(res, 201, { ok: true, tenant, adminUser: adminUser ? { id: adminUser.id, name: adminUser.name, email: adminUser.email, role: adminUser.role } : null });
      return;
    }

    if (adminTenantMatch && req.method === "PATCH" && adminTenantMatch[1]) {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      const tenant = store.data.tenants.find(row => row.id === adminTenantMatch[1]);
      if (!tenant) return sendJson(res, 404, { ok: false, error: "Tenant not found" });
      const body = await readBody(req);
      const patch = {
        ...(body.name ? { name: body.name } : {}),
        ...(body.plan ? { plan: body.plan } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.billingEmail !== undefined ? { billingEmail: body.billingEmail } : {})
      };
      const next = store.updateTenant(tenant.id, patch);
      store.audit({ actor: user.email, tenantId: tenant.id, action: "tenant_updated", area: "tenants", detail: JSON.stringify(patch) });
      sendJson(res, 200, { ok: true, tenant: next });
      return;
    }

    if (url.pathname === "/api/kbo/lookup" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertCan(user, "tenants");
      const body = await readBody(req);
      sendJson(res, 200, { ok: true, company: lookupKbo(body.vat) });
      return;
    }

    const tenantMatch = url.pathname.match(/^\/api\/tenants\/([^/]+)\/(.+)$/);
    if (tenantMatch) {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      const tenantId = tenantMatch[1];
      errorTenantId = tenantId;
      const action = tenantMatch[2];
      assertTenant(user, tenantId);
      const tenant = store.data.tenants.find(t => t.id === tenantId);
      if (!tenant) return sendJson(res, 404, { ok: false, error: "Tenant not found" });
      assertApiKeyWriteAllowed(user, req);

      if (action === "golden-path" && req.method === "GET") {
        sendJson(res, 200, { ok: true, readiness: readiness(store, tenantId) });
        return;
      }
      if (action === "suggestions/home" && req.method === "GET") {
        sendJson(res, 200, { ok: true, suggestion: homeSuggestion(store, tenant, user) });
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
      const onboardingStepMatch = action.match(/^portal\/onboarding\/([^/]+)$/);
      if (onboardingStepMatch && req.method === "PATCH") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        const updatedTenant = updateOnboardingStep(store, tenant, onboardingStepMatch[1], await readBody(req), user);
        sendJson(res, 200, { ok: true, portal: portalPayload(store, updatedTenant, tenantStatus(store, tenantId), billingSummary(updatedTenant)) });
        return;
      }
      if (action === "support-tickets" && req.method === "GET") {
        sendJson(res, 200, { ok: true, rows: listSupportTickets(store, tenant.id), summary: supportSummary(store, tenant.id) });
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
      if (action === "reports" && req.method === "GET") {
        assertCan(user, "tenants");
        sendJson(res, 200, { ok: true, ...listReports(tenant.id, { limit: url.searchParams.get("limit") }) });
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
      if (action === "support-tickets" && req.method === "POST") {
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 201, { ok: true, row: createSupportTicket(store, tenant, await readBody(req), user) });
        return;
      }
      const supportTicketMatch = action.match(/^support-tickets\/([^/]+)$/);
      if (supportTicketMatch && req.method === "PATCH") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        sendJson(res, 200, { ok: true, row: updateSupportTicket(store, tenant, supportTicketMatch[1], await readBody(req), user) });
        return;
      }
      if (action === "admin/backups" && req.method === "GET") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        sendJson(res, 200, { ok: true, rows: listBackups(tenant.id) });
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
        sendJson(res, 201, { ok: true, result: importEmployees(store, tenant, await readBody(req), user) });
        return;
      }
      if (action === "golden-path/demo" && req.method === "POST") {
        assertCan(user, "tenants");
        assertInteractiveUser(user);
        sendJson(res, 201, { ok: true, result: createDemoGoldenPath(store, tenant, user) });
        return;
      }
      if (action === "kbo/apply" && req.method === "POST") {
        assertCan(user, "tenants");
        assertInteractiveUser(user);
        const body = await readBody(req);
        sendJson(res, 200, { ok: true, tenant: applyKbo(store, tenant, body.vat, user) });
        return;
      }
      if (action === "support-access" && req.method === "POST") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        const body = await readBody(req);
        const now = new Date();
        const expiresAt = body.expiresAt || new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
        const supportAccess = {
          enabled: body.enabled !== false,
          reason: body.reason || "Support op vraag van klant",
          grantedBy: user.email,
          grantedAt: now.toISOString(),
          expiresAt
        };
        const next = store.updateTenant(tenant.id, { supportAccess });
        store.audit({ actor: user.email, tenantId: tenant.id, action: "support_access_granted", area: "support", detail: supportAccess.reason });
        sendJson(res, 200, { ok: true, tenant: next });
        return;
      }
      if (action === "support-access/end" && req.method === "POST") {
        assertCan(user, "settings");
        assertInteractiveUser(user);
        const previous = tenant.supportAccess || {};
        const supportAccess = {
          ...previous,
          enabled: false,
          endedBy: user.email,
          endedAt: new Date().toISOString()
        };
        const next = store.updateTenant(tenant.id, { supportAccess });
        store.audit({ actor: user.email, tenantId: tenant.id, action: "support_access_ended", area: "support", detail: previous.reason || "" });
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
        assertCan(user, "workorders");
        assertApiKeyWriteAllowed(user, req);
        sendJson(res, 200, { ok: true, sync: syncMobileQueue(store, tenant, await readBody(req), user) });
        return;
      }
      if (action === "integrations" && req.method === "GET") {
        assertCan(user, "integrations");
        sendJson(res, 200, { ok: true, rows: listIntegrations(store, tenant.id) });
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
      const integrationActionMatch = action.match(/^integrations\/([^/]+)\/(mapping|sync|retry)$/);
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
        sendJson(res, 200, { ok: true, row: approveExpense(store, tenant, expenseApprovalMatch[1], user) });
        return;
      }
    }

    if (url.pathname === "/api/audit") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertCan(user, "audit");
      const audit = listAuditEvents(store, user, {
        tenantId: url.searchParams.get("tenantId"),
        area: url.searchParams.get("area"),
        action: url.searchParams.get("action"),
        actor: url.searchParams.get("actor"),
        since: url.searchParams.get("since"),
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

    serveStatic(req, res);
  } catch (error) {
    handleError(req, res, error, errorTenantId);
  }
}).listen(config.port, () => {
  console.log(`WorkFlow Pro Fullstack draait op http://localhost:${config.port}`);
});
