const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { config } = require("./lib/config");
const { sendJson, readBody, readRawBody, securityHeaders } = require("./lib/http");
const { checkRateLimit } = require("./lib/rate-limit");
const { Store, BUSINESS_ADMIN_PERMISSIONS, MANAGER_PERMISSIONS, EMPLOYEE_PERMISSIONS } = require("./lib/store");
const { hashPassword, assertStrongPassword, verifyPassword } = require("./lib/security");
const {
  authenticate,
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
  assertAdminMfa,
  isEmployee,
  isManager,
  isAdmin
} = require("./lib/auth");
const {
  getMyProfile, getMyPlanning, getMyClock, getMyExpenses,
  getMyLeaves, getMyWorkorders, getMyMessages, getMyDashboard,
  getManagerDashboard, getManagerTeamPlanning
} = require("./modules/me");
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
const { customerStartPayload } = require("./modules/customer-start");
const { listApiKeys, createApiKey, revokeApiKey, rotateApiKey, authenticateApiKey, recordApiKeyDenied } = require("./modules/api-keys");
const { apiKeyGovernance } = require("./modules/api-key-governance");
const { releaseInfo } = require("./modules/releases");
const { listSupportTickets, createSupportTicket, updateSupportTicket, supportSummary } = require("./modules/support");
const { pilotKpis, decisionReport } = require("./modules/pilot");
const { salesSummary, salesLaunchReadiness, advanceLead, addPartnerNote } = require("./modules/sales");
const { goLiveReadiness } = require("./modules/go-live");
const { listReports, getReport, generateStatusBundle } = require("./modules/reports");
const { listAuditEvents } = require("./modules/audit");
const { sendMail, setRuntimeConfig } = require("./lib/mailer");
const { loadPlatformConfig, publicPlatformConfig, savePlatformConfig } = require("./modules/platform-config");
const { createPaymentLink, markInvoicePaidById } = require("./modules/payments");
const { seedDemoData, clearDemoData } = require("./modules/demo-seed");
const { buildUbl, validatePeppol, sendPeppolInvoice } = require("./modules/peppol-invoice");
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
      stack: String(error.stack || "").split("\n").slice(0, 4).join("\n")
    });
  }
  sendJson(res, status, { ok: false, error: error.message || "Server error" });
}

function publicQuotePage() {
  // Self-contained publieke offerte-pagina. Leest token uit de URL en praat
  // met /api/public/quote/:token. Geen login, geen externe assets.
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offerte — WorkFlow Pro</title>
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
</div><div class="foot">Aangeboden via WorkFlow Pro</div></div>
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
      '<div class="meta"><span>Datum: '+esc(q.quoteDate||"—")+'</span><span>Geldig tot: '+esc(q.validUntil||"—")+'</span></div>'+
      '<table><thead><tr><th>Omschrijving</th><th class="num">Aantal</th><th class="num">Prijs</th><th class="num">Btw</th><th class="num">Totaal</th></tr></thead><tbody>'+
      (q.lines||[]).map(l=>'<tr><td>'+esc(l.description)+'</td><td class="num">'+esc(l.qty)+'</td><td class="num">'+eur(l.unitPrice)+'</td><td class="num">'+esc(l.vatRate)+'%</td><td class="num">'+eur(l.lineTotal)+'</td></tr>').join("")+
      '</tbody></table>'+
      '<div class="tot"><div class="row"><span>Subtotaal</span><span>'+eur(q.subtotal)+'</span></div><div class="row"><span>Btw</span><span>'+eur(q.vatAmount)+'</span></div><div class="row grand"><span>Totaal</span><span>'+eur(q.total)+'</span></div></div>'+
      (q.notes?'<p style="font-size:13px;color:#64748B;margin-top:14px">'+esc(q.notes)+'</p>':"")+
      (done? '<div class="banner '+(q.status==="aanvaard"?"ok":"warn")+'">'+(q.status==="aanvaard"?"✅ Offerte aanvaard — bedankt!":"Offerte geweigerd")+'</div>'
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
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Betaling — WorkFlow Pro</title>
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
</div><div class="foot">Beveiligde betaling via WorkFlow Pro</div></div>
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
    if(inv.status==="paid"){ document.getElementById("body").innerHTML='<div class="banner">✅ Deze factuur is reeds betaald — bedankt!</div>'; return; }
    document.getElementById("body").innerHTML=
      '<div class="amount">'+eur(inv.total)+'</div><div class="muted">Factuur '+esc(inv.number)+' · '+esc(inv.customerName||"")+'</div>'+
      '<button onclick="pay()">Betaal nu</button><div class="demo">Demo-betaling — markeert de factuur als betaald.</div>';
  }catch(e){ document.getElementById("body").innerHTML='<div class="muted">Er ging iets mis.</div>'; }
}
async function pay(){
  const d = await (await fetch("/api/public/pay/"+token,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
  load();
}
load();
</script></body></html>`;
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
    res.writeHead(200, securityHeaders({
      "Content-Type": isText ? `${type}; charset=utf-8` : type,
      "Cache-Control": cacheControl
    }));
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
      const storeStatus = store.storageStatus ? store.storageStatus() : { ok: true };
      sendJson(res, 200, {
        ok: true,
        app: "WorkFlow Pro Fullstack",
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
      const result = processStripeWebhook(store, event);
      sendJson(res, 200, { ok: true, signature: signature.mode, result });
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
      }, company: { name: foundTenant.name || "WorkFlow Pro", vat: foundTenant.invoiceProfile?.vat || "" } });
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
          if (decision === "aanvaard") patch.acceptedAt = new Date().toISOString(); else patch.rejectedAt = new Date().toISOString();
          store.update("quotes", q.id, patch);
          store.audit({ actor: q.customerName || "klant", tenantId: t.id, action: `quote_${decision}_public`, area: "offertes", detail: q.number });
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
        return sendJson(res, 200, { ok: true, invoice: { number: inv.number, customerName: inv.customerName, total: inv.total, status: inv.status, invoiceDate: inv.invoiceDate, dueDate: inv.dueDate, lines: inv.lines }, company: { name: invTenant.name || "WorkFlow Pro" } });
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
      const result = verifyMfaSetup(store, user, body.code);
      sendJson(res, 200, { ok: true, user: result.user, recoveryCodes: result.recoveryCodes });
      return;
    }

    // Platform-brede MFA-afdwinging (super_admin): schrijft alle admin-accounts
    // (tenant_admin + super_admin) zonder MFA in. Retourneert secrets + recovery codes.
    // Platform-integraties (super-admin console): Stripe / Peppol / e-mail / KBO
    if (url.pathname === "/api/admin/integrations" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      sendJson(res, 200, { ok: true, config: publicPlatformConfig(store) });
      return;
    }
    if (url.pathname === "/api/admin/integrations" && req.method === "PUT") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      const body = await readBody(req);
      const config2 = savePlatformConfig(store, body, user);
      // Pas e-mailconfig meteen toe op de mailer
      try { setRuntimeConfig(loadPlatformConfig(store).email); } catch (_) {}
      sendJson(res, 200, { ok: true, config: config2 });
      return;
    }

    if (url.pathname === "/api/admin/mfa/enforce" && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
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
      assertAdminMfa(user);
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
      assertSuperAdmin(user);
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
        supportAccess: { enabled: false }
      });
      let adminUser = null;
      if (body.adminEmail) {
        assertStrongPassword(body.adminPassword);
        adminUser = store.insert("users", {
          id: `user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId: tenant.id,
          name: body.adminName || "Klant admin",
          email: String(body.adminEmail).toLowerCase(),
          passwordHash: hashPassword(body.adminPassword),
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
      assertInteractiveUser(user);
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
      const users = store.data.users.map(safe);
      sendJson(res, 200, { ok: true, users });
      return;
    }

    // ── Super-admin: gebruiker bijwerken (deactiveren / rol) ──────────────────
    const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (adminUserMatch && req.method === "PATCH") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      const body = await readBody(req);
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
      assertSuperAdmin(user);
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
      assertSuperAdmin(user);
      const limit = Number(url.searchParams.get("limit") || 100);
      const errors = (store.data.errorEvents || []).slice().reverse().slice(0, limit);
      sendJson(res, 200, { ok: true, errors });
      return;
    }

    // ── Super-admin: alle support tickets ─────────────────────────────────────
    if (url.pathname === "/api/admin/support" && req.method === "GET") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
      const limit = Number(url.searchParams.get("limit") || 100);
      const tickets = store.data.tenants.flatMap(t =>
        (store.list("supportTickets", t.id) || []).map(tk => ({ ...tk, tenantName: t.name }))
      ).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, limit);
      sendJson(res, 200, { ok: true, tickets });
      return;
    }

    // ── Super-admin: suspend/activate tenant ──────────────────────────────────
    const adminTenantActionMatch = url.pathname.match(/^\/api\/admin\/tenants\/([^/]+)\/(suspend|activate)$/);
    if (adminTenantActionMatch && req.method === "POST") {
      const user = actor(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      assertSuperAdmin(user);
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
      sendJson(res, 200, { ok: true, company: lookupKbo(body.vat) });
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

      if (action === "golden-path" && req.method === "GET") {
        sendJson(res, 200, { ok: true, readiness: readiness(store, tenantId) });
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
      if (action === "roadmap" && req.method === "GET") {
        assertCan(user, "tenants");
        sendJson(res, 200, { ok: true, roadmap: roadmapStatus(store, tenant) });
        return;
      }
      // GET /search?q= — globale zoek over klanten, werkbonnen, facturen, medewerkers
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
              results.push({ type: "Factuur", view: "facturen", id: inv.id, label: `${inv.number || "Factuur"} · ${inv.customerName || ""}`, sub: `€ ${Number(inv.total || 0).toFixed(2)} — ${inv.status || ""}` });
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
      // POST /reports/log — registreert rapportgeneratie voor pilot-KPI tracking
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
      // POST /admin/backfill — data quality fixes (nummers, notificaties, etc.)
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
          let days = 0; const cur = new Date(l.startDate), end = new Date(l.endDate);
          while (cur <= end) { const d = cur.getDay(); if (d!==0&&d!==6) days++; cur.setDate(cur.getDate()+1); }
          if (days > 0) store.update("leaves", l.id, { days });
        });
        results.leaveDays = leavesNoDays.length;
        store.audit({ actor: user.email, tenantId, action: "data_backfill", area: "admin", detail: JSON.stringify(results) });
        sendJson(res, 200, { ok: true, results });
        return;
      }
      // POST /admin/backfill-wo-numbers — vult lege werkbon-nummers in
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
        sendJson(res, 200, { ok: true, company: lookupKbo(body.vat || body.name) });
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
          userId: url.searchParams.get("userId"),
          status: url.searchParams.get("status"),
          type: url.searchParams.get("type"),
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to")
        };
        const leaveResult = listLeaves(store, tenantId, opts);
        const uCache1 = {};
        leaveResult.leaves = leaveResult.leaves.map(l => {
          if (l.userName) return l;
          if (!uCache1[l.userId]) { const u = store.getUserById(l.userId); uCache1[l.userId] = u ? (u.name || u.email) : l.userId; }
          return { ...l, userName: uCache1[l.userId] };
        });
        sendJson(res, 200, { ok: true, ...leaveResult });
        return;
      }

      if (action === "leaves/calendar" && req.method === "GET") {
        assertCan(user, "leaves");
        const year = Number(url.searchParams.get("year") || new Date().getFullYear());
        const month = Number(url.searchParams.get("month") || new Date().getMonth() + 1);
        const calResult = leaveCalendar(store, tenantId, year, month);
        const uCache2 = {};
        calResult.leaves = calResult.leaves.map(l => {
          if (l.userName) return l;
          if (!uCache2[l.userId]) { const u = store.getUserById(l.userId); uCache2[l.userId] = u ? (u.name || u.email) : l.userId; }
          return { ...l, userName: uCache2[l.userId] };
        });
        sendJson(res, 200, { ok: true, ...calResult });
        return;
      }

      // GET /leaves/balance — verlof saldo per medewerker voor dit jaar
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

      // GET /me/leaves/balance — eigen verlof saldo
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
        // Alleen veilige velden bijwerken — geen rol, geen rechten, geen wachtwoord
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

      if (action === "me/planning" && req.method === "GET") {
        const opts = { from: url.searchParams.get("from"), to: url.searchParams.get("to") };
        sendJson(res, 200, { ok: true, ...getMyPlanning(store, tenantId, user.id, opts) });
        return;
      }

      if (action === "me/clock" && req.method === "GET") {
        sendJson(res, 200, { ok: true, ...getMyClock(store, tenantId, user.id) });
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

      // GET /me/notifications — persoonlijke notificaties voor medewerker
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

      // PATCH /me/messages/:id/read — markeer als gelezen
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

      // me/clock/in en me/clock/out — medewerker klokt zichzelf in/uit
      if (action === "me/clock/in" && req.method === "POST") {
        sendJson(res, 201, { ok: true, row: clockIn(store, tenant, { userId: user.id }, user) });
        return;
      }
      if (action === "me/clock/out" && req.method === "POST") {
        sendJson(res, 200, { ok: true, row: clockOut(store, tenant, { userId: user.id }, user) });
        return;
      }

      // me/expenses POST — medewerker dient onkosten in
      if (action === "me/expenses" && req.method === "POST") {
        const body = await readBody(req);
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount <= 0) return sendJson(res, 400, { ok: false, error: "Bedrag moet groter zijn dan €0" });
        if (amount > 100000) return sendJson(res, 400, { ok: false, error: "Bedrag is onrealistisch hoog — controleer de invoer" });
        const row = store.insert("expenses", {
          id: `exp_${Date.now()}_${require("crypto").randomBytes(4).toString("hex")}`,
          tenantId,
          userId: user.id,
          userName: user.name || user.email,
          date: body.date || new Date().toISOString().slice(0, 10),
          amount,
          category: body.category || "overig",
          description: body.description || "",
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

      // me/leaves POST — medewerker vraagt verlof aan
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
        // Bereken werkdagen
        let days = 0;
        const cur = new Date(body.startDate);
        const end = new Date(body.endDate);
        while (cur <= end) { const d = cur.getDay(); if (d !== 0 && d !== 6) days++; cur.setDate(cur.getDate()+1); }
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

      // me/leaves/:id DELETE — medewerker trekt eigen aanvraag in
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

      // me/expenses/:id DELETE — medewerker verwijdert eigen openstaande declaratie
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
        sendJson(res, 200, { ok: true, shifts: getManagerTeamPlanning(store, tenantId, opts) });
        return;
      }

      // ── Planning shift aanmaken ────────────────────────────────────────────────
      if (action === "planning" && req.method === "POST") {
        assertCan(user, "planning");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        if (!body.userId) return sendJson(res, 400, { ok: false, error: "Medewerker (userId) is verplicht" });
        if (!body.date)   return sendJson(res, 400, { ok: false, error: "Datum is verplicht" });
        if (!body.start)  return sendJson(res, 400, { ok: false, error: "Starttijd is verplicht" });
        if (!body.end)    return sendJson(res, 400, { ok: false, error: "Eindtijd is verplicht" });
        if (String(body.end) <= String(body.start)) return sendJson(res, 400, { ok: false, error: "Eindtijd moet na de starttijd liggen" });
        const shift = store.insert("shifts", {
          id: `shift_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId,
          userId: body.userId,
          date: body.date,
          start: body.start,
          end: body.end,
          venueId: body.venueId || null,
          note: body.note || "",
          createdBy: user.id,
          createdAt: new Date().toISOString()
        });
        store.audit({ actor: user.email, tenantId, action: "shift_created", area: "planning", detail: `${body.date} ${body.start}–${body.end}` });
        sendJson(res, 201, { ok: true, shift });
        return;
      }

      // ── Planning shift bijwerken / verwijderen ────────────────────────────────
      const planningItemMatch = action.match(/^planning\/([^/]+)$/);
      if (planningItemMatch && req.method === "PATCH") {
        assertCan(user, "planning");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const shift = store.update("shifts", planningItemMatch[1], { ...body, updatedAt: new Date().toISOString() });
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

      // ── Klanten (customers) ───────────────────────────────────────────────────
      if (action === "customers" && req.method === "GET") {
        assertCan(user, "customers");
        sendJson(res, 200, { ok: true, customers: store.list("customers", tenantId) });
        return;
      }
      if (action === "customers" && req.method === "POST") {
        assertCan(user, "customers");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        if (!String(body.name||"").trim()) return sendJson(res, 400, { ok: false, error: "Naam is verplicht" });
        const row = store.insert("customers", {
          id: `cust_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId, ...body, createdAt: new Date().toISOString()
        });
        store.audit({ actor: user.email, tenantId, action: "customer_created", area: "customers", detail: body.name });
        sendJson(res, 201, { ok: true, customer: row });
        return;
      }
      const customerMatch = action.match(/^customers\/([^/]+)$/);
      if (customerMatch && req.method === "PATCH") {
        assertCan(user, "customers");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const row = store.update("customers", customerMatch[1], { ...body, updatedAt: new Date().toISOString() });
        store.audit({ actor: user.email, tenantId, action: "customer_updated", area: "customers", detail: customerMatch[1] });
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
        assertCan(user, "billing");
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
        assertCan(user, "billing");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        if (!body.customerName && !body.customerId) return sendJson(res, 400, { ok: false, error: "Klant is verplicht" });
        if (!Array.isArray(body.lines) || !body.lines.length) return sendJson(res, 400, { ok: false, error: "Minimaal 1 factuurregel vereist" });
        // Auto-generate invoice number
        const existing = store.list("invoices", tenantId);
        const year = new Date().getFullYear();
        const seq = existing.filter(i => String(i.number||"").startsWith(String(year))).length + 1;
        const number = `${year}-${String(seq).padStart(3, "0")}`;
        // Calculate totals from lines
        const lines = body.lines.map(l => {
          const qty = Number(l.qty || 1);
          const unitPrice = Number(l.unitPrice || 0);
          const vatRate = Number(l.vatRate ?? 21);
          const lineSubtotal = qty * unitPrice;
          const lineVat = lineSubtotal * vatRate / 100;
          return { description: l.description || "", qty, unitPrice, vatRate, lineSubtotal, lineVat, lineTotal: lineSubtotal + lineVat };
        });
        const subtotal = lines.reduce((s, l) => s + l.lineSubtotal, 0);
        const vatAmount = lines.reduce((s, l) => s + l.lineVat, 0);
        const total = subtotal + vatAmount;
        const invoice = store.insert("invoices", {
          id: `inv_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId,
          number,
          customerId: body.customerId || null,
          customerName: body.customerName || "",
          customerAddress: body.customerAddress || "",
          customerVatNumber: body.customerVatNumber || "",
          status: "open",
          invoiceDate: body.invoiceDate || new Date().toISOString().slice(0, 10),
          dueDate: body.dueDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
          lines,
          subtotal,
          vatAmount,
          total,
          notes: body.notes || "",
          workorderId: body.workorderId || null,
          paidAt: null,
          sentAt: null,
          createdBy: user.email,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        store.audit({ actor: user.email, tenantId, action: "invoice_created", area: "facturen", detail: `${number} — €${total.toFixed(2)}` });
        sendJson(res, 201, { ok: true, invoice });
        return;
      }
      // Peppol e-facturatie verzenden
      const invoicePeppolMatch = action.match(/^facturen\/([^/]+)\/peppol$/);
      if (invoicePeppolMatch && req.method === "POST") {
        assertCan(user, "billing");
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
        assertCan(user, "billing");
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
        assertCan(user, "billing");
        const inv = store.get("invoices", invoicePayMatch[1]);
        if (!inv || inv.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Factuur niet gevonden" });
        const link = await createPaymentLink(store, tenant, inv);
        store.audit({ actor: user.email, tenantId, action: "payment_link_created", area: "facturen", detail: `${inv.number} (${link.provider})` });
        sendJson(res, 200, { ok: true, url: link.url, provider: link.provider });
        return;
      }
      const invoiceItemMatch = action.match(/^facturen\/([^/]+)$/);
      if (invoiceItemMatch && req.method === "PATCH") {
        assertCan(user, "billing");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const inv = store.get("invoices", invoiceItemMatch[1]);
        if (!inv || inv.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Factuur niet gevonden" });
        const patch = { updatedAt: new Date().toISOString() };
        const allowedFields = ["status", "notes", "dueDate", "invoiceDate", "customerAddress", "customerVatNumber"];
        allowedFields.forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
        if (body.status === "paid" && !inv.paidAt) patch.paidAt = new Date().toISOString();
        const updated = store.update("invoices", invoiceItemMatch[1], patch);
        store.audit({ actor: user.email, tenantId, action: `invoice_${patch.status||"updated"}`, area: "facturen", detail: inv.number });
        sendJson(res, 200, { ok: true, invoice: updated });
        return;
      }
      if (invoiceItemMatch && req.method === "DELETE") {
        assertCan(user, "billing");
        assertInteractiveUser(user);
        const inv = store.get("invoices", invoiceItemMatch[1]);
        if (!inv || inv.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Factuur niet gevonden" });
        if (inv.status === "paid") return sendJson(res, 400, { ok: false, error: "Betaalde facturen kunnen niet worden verwijderd" });
        store.remove("invoices", invoiceItemMatch[1]);
        store.audit({ actor: user.email, tenantId, action: "invoice_deleted", area: "facturen", detail: inv.number });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Offertes (quotes) ─────────────────────────────────────────────────────
      if (action === "offertes" && req.method === "GET") {
        assertCan(user, "billing");
        const today = new Date().toISOString().slice(0, 10);
        const rows = store.list("quotes", tenantId).map(q => {
          if (q.status === "verzonden" && q.validUntil && q.validUntil < today) return { ...q, status: "verlopen" };
          return q;
        });
        sendJson(res, 200, { ok: true, quotes: rows });
        return;
      }
      if (action === "offertes" && req.method === "POST") {
        assertCan(user, "billing");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        if (!body.customerName && !body.customerId) return sendJson(res, 400, { ok: false, error: "Klant is verplicht" });
        if (!Array.isArray(body.lines) || !body.lines.length) return sendJson(res, 400, { ok: false, error: "Minimaal 1 offerteregel vereist" });
        const existing = store.list("quotes", tenantId);
        const year = new Date().getFullYear();
        const seq = existing.filter(q => String(q.number || "").startsWith(`OFF-${year}-`)).length + 1;
        const number = `OFF-${year}-${String(seq).padStart(3, "0")}`;
        const lines = body.lines.map(l => {
          const qty = Number(l.qty || 1);
          const unitPrice = Number(l.unitPrice || 0);
          const vatRate = Number(l.vatRate ?? 21);
          const lineSubtotal = qty * unitPrice;
          const lineVat = lineSubtotal * vatRate / 100;
          return { description: l.description || "", qty, unitPrice, vatRate, lineSubtotal, lineVat, lineTotal: lineSubtotal + lineVat };
        });
        const subtotal = lines.reduce((s, l) => s + l.lineSubtotal, 0);
        const vatAmount = lines.reduce((s, l) => s + l.lineVat, 0);
        const total = subtotal + vatAmount;
        const quote = store.insert("quotes", {
          id: `quote_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId,
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
          sentAt: null, acceptedAt: null, rejectedAt: null,
          invoiceId: null, workorderId: null,
          createdBy: user.email,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        store.audit({ actor: user.email, tenantId, action: "quote_created", area: "offertes", detail: `${number} — €${total.toFixed(2)}` });
        sendJson(res, 201, { ok: true, quote });
        return;
      }
      const quoteSendMatch = action.match(/^offertes\/([^/]+)\/send$/);
      if (quoteSendMatch && req.method === "POST") {
        assertCan(user, "billing");
        const q = store.get("quotes", quoteSendMatch[1]);
        if (!q || q.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Offerte niet gevonden" });
        const updated = store.update("quotes", q.id, { status: q.status === "concept" ? "verzonden" : q.status, sentAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        const acceptUrl = `${config.appUrl}/offerte/${q.publicToken}`;
        // E-mail (log-fallback tot echte provider geconfigureerd is)
        try {
          const cust = q.customerId ? store.get("customers", q.customerId) : null;
          const to = cust?.email;
          if (to) sendMail({ to, subject: `Offerte ${q.number} van ${tenant.name || "WorkFlow Pro"}`, text: `Bekijk en aanvaard je offerte: ${acceptUrl}`, html: `<p>Beste,</p><p>Uw offerte <strong>${q.number}</strong> (totaal €${q.total.toFixed(2)}) staat klaar.</p><p><a href="${acceptUrl}">Bekijk en aanvaard de offerte</a></p>` });
        } catch (_) {}
        store.audit({ actor: user.email, tenantId, action: "quote_sent", area: "offertes", detail: q.number });
        sendJson(res, 200, { ok: true, quote: updated, acceptUrl });
        return;
      }
      const quoteConvertMatch = action.match(/^offertes\/([^/]+)\/convert$/);
      if (quoteConvertMatch && req.method === "POST") {
        assertCan(user, "billing");
        const body = await readBody(req);
        const q = store.get("quotes", quoteConvertMatch[1]);
        if (!q || q.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Offerte niet gevonden" });
        if (body.target === "workorder") {
          const wos = store.list("workorders", tenantId);
          const yr = new Date().getFullYear();
          const woNum = `WO-${yr}-${String(wos.filter(w => (w.number||"").startsWith(`WO-${yr}-`)).length + 1).padStart(3, "0")}`;
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
          sendJson(res, 201, { ok: true, workorder: wo });
          return;
        }
        // default: naar factuur
        const inv = store.list("invoices", tenantId);
        const yr = new Date().getFullYear();
        const invNum = `${yr}-${String(inv.filter(i => String(i.number||"").startsWith(String(yr))).length + 1).padStart(3, "0")}`;
        const invoice = store.insert("invoices", {
          id: `inv_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          tenantId, number: invNum,
          customerId: q.customerId || null, customerName: q.customerName,
          customerAddress: q.customerAddress, customerVatNumber: q.customerVatNumber,
          status: "open",
          invoiceDate: new Date().toISOString().slice(0, 10),
          dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
          lines: q.lines, subtotal: q.subtotal, vatAmount: q.vatAmount, total: q.total,
          notes: `Op basis van offerte ${q.number}`, quoteId: q.id,
          paidAt: null, sentAt: null, createdBy: user.email,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        });
        store.update("quotes", q.id, { invoiceId: invoice.id, updatedAt: new Date().toISOString() });
        store.audit({ actor: user.email, tenantId, action: "quote_to_invoice", area: "offertes", detail: `${q.number} → ${invNum}` });
        sendJson(res, 201, { ok: true, invoice });
        return;
      }
      const quoteItemMatch = action.match(/^offertes\/([^/]+)$/);
      if (quoteItemMatch && req.method === "PATCH") {
        assertCan(user, "billing");
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
        assertCan(user, "billing");
        assertInteractiveUser(user);
        const q = store.get("quotes", quoteItemMatch[1]);
        if (!q || q.tenantId !== tenantId) return sendJson(res, 404, { ok: false, error: "Offerte niet gevonden" });
        store.remove("quotes", q.id);
        store.audit({ actor: user.email, tenantId, action: "quote_deleted", area: "offertes", detail: q.number });
        sendJson(res, 200, { ok: true });
        return;
      }

      // ── Locaties / Venues ─────────────────────────────────────────────────────
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
        sendJson(res, 200, { ok: true, employees: users });
        return;
      }

      // ── Medewerker bijwerken ──────────────────────────────────────────────────
      const employeePatchMatch = action.match(/^employees\/([^/]+)$/);
      if (employeePatchMatch && req.method === "PATCH") {
        assertCan(user, "employees");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const { passwordHash, mfaSecret, mfaPendingSecret, recoveryCodes, newPassword, ...safe } = body;
        if (newPassword) {
          assertStrongPassword(newPassword);
          safe.passwordHash = hashPassword(newPassword);
          store.audit({ actor: user.email, tenantId, action: "admin_password_reset", area: "users", detail: employeePatchMatch[1] });
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
        const permissions = role === "manager" ? MANAGER_PERMISSIONS : EMPLOYEE_PERMISSIONS;
        const tempPassword = body.password || body.tempPassword || crypto.randomBytes(12).toString("base64url");
        const newUser = store.insert("users", {
          id: `user_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
          tenantId,
          name: String(body.name || "").trim() || email,
          email,
          passwordHash: hashPassword(tempPassword),
          role,
          permissions,
          mfaEnabled: false,
          mfaEnforced: false,
          active: true,
          function: body.function || null,
          phone: body.phone || null,
          createdAt: new Date().toISOString()
        });
        store.audit({ actor: user.email, tenantId, action: "employee_created", area: "employees", detail: `${email} (${role})` });
        // Welkomstmail naar nieuwe medewerker (alleen als er een tijdelijk wachtwoord is)
        const sendWelcome = !body.password; // enkel bij auto-gegenereerd ww
        if (sendWelcome && email) {
          const tpl = welcomeEmployee({ employee: newUser, tempPassword, appUrl: config.appUrl });
          sendMail({ to: email, ...tpl });
        }
        sendJson(res, 201, { ok: true, user: { ...newUser, passwordHash: undefined }, tempPassword });
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
        const expenses = store.list("expenses", tenantId)
          .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        sendJson(res, 200, { ok: true, expenses });
        return;
      }

      // PATCH /expenses/:id — status bijwerken (goedgekeurd/geweigerd)
      const expPatchMatch = action.match(/^expenses\/([^/]+)$/);
      if (expPatchMatch && req.method === "PATCH") {
        assertCan(user, "expenses");
        const body = await readBody(req);
        // Whitelist: only allow specific fields to be updated via this route
        const allowed = ["status", "reviewNote", "reviewedBy", "reviewedAt", "amount", "category", "description", "date"];
        const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
        if (patch.status === "goedgekeurd" || patch.status === "geweigerd") {
          patch.reviewedBy = user.email;
          patch.reviewedAt = new Date().toISOString();
        }
        const row = store.update("expenses", expPatchMatch[1], { ...patch, updatedAt: new Date().toISOString() });
        store.audit({ actor: user.email, tenantId, action: `expense_${patch.status||"updated"}`, area: "expenses", detail: `€${row?.amount} — ${row?.category}` });
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
      if (action === "clocks" && req.method === "GET") {
        assertCan(user, "clockings");
        const fromQ = url.searchParams.get("from");
        const toQ   = url.searchParams.get("to");
        let clocks = store.list("clocks", tenantId)
          .sort((a, b) => (b.clockedIn || "").localeCompare(a.clockedIn || ""));
        const dateFilter = url.searchParams.get("date");
        if (dateFilter) clocks = clocks.filter(c => c.clockedIn?.startsWith(dateFilter));
        if (fromQ) clocks = clocks.filter(c => (c.clockedIn || "").slice(0,10) >= fromQ);
        if (toQ)   clocks = clocks.filter(c => (c.clockedIn || "").slice(0,10) <= toQ);
        sendJson(res, 200, { ok: true, clocks });
        return;
      }

      // Handmatige klokregistratie aanmaken (admin correctie)
      if (action === "clocks/manual" && req.method === "POST") {
        assertCan(user, "clockings");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const row = store.insert("clocks", {
          id: `clk_${Date.now()}_${require("crypto").randomBytes(4).toString("hex")}`,
          tenantId,
          userId: body.userId,
          userName: body.userName || body.userId,
          clockedIn: body.clockedIn,
          clockedOut: body.clockedOut || null,
          status: body.clockedOut ? "out" : "in",
          note: body.note || "Handmatige correctie",
          manual: true,
          createdBy: user.email,
          createdAt: new Date().toISOString()
        });
        store.audit({ actor: user.email, tenantId, action: "clock_manual_created", area: "clockings",
          detail: `${body.userName||body.userId} ${body.clockedIn?.slice(0,10)}` });
        sendJson(res, 201, { ok: true, row });
        return;
      }

      // Klokregistratie bijwerken (correctie)
      const clockItemMatch = action.match(/^clocks\/([^/]+)$/);
      if (clockItemMatch && req.method === "PATCH") {
        assertCan(user, "clockings");
        assertApiKeyWriteAllowed(user, req);
        const body = await readBody(req);
        const allowed = ["clockedIn", "clockedOut", "status", "note"];
        const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
        const updated = store.update("clocks", clockItemMatch[1], { ...patch, updatedAt: new Date().toISOString() });
        store.audit({ actor: user.email, tenantId, action: "clock_corrected", area: "clockings", detail: clockItemMatch[1] });
        sendJson(res, 200, { ok: true, row: updated });
        return;
      }

      // ── Berichten lijst (admin/manager) ──────────────────────────────────────
      if (action === "messages" && req.method === "GET") {
        assertCan(user, "messages");
        const messages = store.list("messages", tenantId)
          .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
          .slice(0, 100);
        sendJson(res, 200, { ok: true, messages });
        return;
      }

      // POST /messages — nieuw bericht versturen
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
          subject: body.subject || "",
          body: body.body || "",
          readBy: [],
          createdAt: new Date().toISOString()
        });
        sendJson(res, 201, { ok: true, row });
        return;
      }

      // DELETE /messages/:id — bericht verwijderen (admin/manager)
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
        const workorders = store.list("workorders", tenantId)
          .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
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
        const { billingOps, supportAccess, ...safeTenant } = t;
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
  console.log(`WorkFlow Pro Fullstack draait op http://localhost:${config.port}`);
  console.log(`  Omgeving  : ${config.isProduction ? "production" : "development"}`);
  console.log(`  Opslag    : ${config.storageAdapter}`);
  console.log(`  Versie    : ${config.appVersion} (${config.commitSha})`);
  console.log(`  MFA-eis   : ${process.env.REQUIRE_ADMIN_MFA === "false" ? "uitgeschakeld (dev)" : "verplicht voor admins"}`);

  // Pas opgeslagen e-mailconfig toe op de mailer (DB overschrijft env)
  try { setRuntimeConfig(loadPlatformConfig(store).email); } catch (_) {}

  // Auto-backup bij opstarten (max 1 per dag per tenant)
  setImmediate(() => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const tenants = store.data.tenants || [];
      let backed = 0;
      tenants.forEach(t => {
        try {
          const existing = listBackups(t.id);
          const hasToday = existing.some(b => (b.createdAt||"").startsWith(today));
          if (!hasToday) {
            const sysActor = { email: "system@workflowpro", id: "system", role: "super_admin", tenantId: t.id };
            createBackup(store, t, sysActor);
            backed++;
          }
        } catch(_) {}
      });
      if (backed > 0) console.log(`  Backup    : ${backed} tenant(s) automatisch gebackupt`);
    } catch(_) {}
  });
});

// ── Graceful shutdown ─────────────────────────────────────────
// PaaS-platforms (Render, Railway, Heroku) sturen SIGTERM vóór een deploy/restart.
// We geven lopende requests maximaal 10 s om af te ronden vóór we stoppen.
function gracefulShutdown(signal) {
  console.log(`[shutdown] ${signal} ontvangen — server sluit af…`);
  // Geef lopende requests 10 s
  setTimeout(() => {
    console.log("[shutdown] Timeout bereikt — forceer stop");
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
