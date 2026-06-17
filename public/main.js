let token = "";
let pendingMfaLogin = null;
const tenantId = "t_demo";
window.WorkFlowProApi.configure({ getToken: () => token });
const api = window.WorkFlowProApi.request;
const listModuleRows = key => window.WorkFlowProApi.listModuleRows(key, tenantId);
const createModuleRow = (key, payload) => window.WorkFlowProApi.createModuleRow(key, payload, tenantId);
const updateModuleRow = (key, id, payload) => window.WorkFlowProApi.updateModuleRow(key, id, payload, tenantId);
const { el, setText, showJson, escapeHtml, setNoticeText, statusTone } = window.WorkFlowProDom;
const { todayValue, futureDateValue, shortDateTime, optionList, personName, venueName, renderList } = window.WorkFlowProDomain;
const state = window.WorkFlowProState;
window.WorkFlowProDomain.configure({ state, el });

const stepLabels = {
  tenant: "Klantomgeving",
  kbo: "KBO-gegevens",
  employees: "Medewerkers",
  planning: "Eerste planning",
  workorders: "Werkbon",
  clockings: "Tijdregistratie",
  invoice: "Factuurconcept"
};

const moduleDescriptions = {
  tenants: "Klantbeheer en onboarding",
  users: "Teams en veldmedewerkers",
  roles: "Rollen en toegangen",
  venues: "Werven en locaties",
  customers: "Klantenfiches",
  planning: "Shifts en opdrachten",
  clockings: "Urenregistratie",
  workorders: "Werkbonnen en checklists",
  expenses: "Onkostenflow",
  stock: "Materiaalbeheer",
  vehicles: "Wagenpark",
  leaves: "Verlofaanvragen",
  messages: "Berichten",
  notifications: "Herinneringen",
  integrations: "ERP en boekhouding",
  invoices: "Facturen en Peppol",
  sales: "Leads en demo pipeline",
  partners: "Boekhouders en ERP partners",
  audit: "Auditspoor"
};

const salesStageLabels = {
  qualified_lead: "Qualified lead",
  demo_booked: "Demo gepland",
  proposal_sent: "Offerte verstuurd",
  pilot: "Pilot",
  paying_customer: "Betalende klant",
  lost: "Verloren"
};

const permissionLabels = {
  tenants: "Klantfiche",
  employees: "Medewerkers",
  venues: "Werven",
  customers: "Klanten",
  planning: "Planning",
  workorders: "Werkbonnen",
  clockings: "Tijd",
  expenses: "Onkosten",
  billing: "Billing",
  settings: "Instellingen",
  audit: "Audit",
  messages: "Berichten",
  alerts: "Notificaties",
  integrations: "Integraties",
  stock: "Stock",
  vehicles: "Wagenpark",
  leaves: "Verlof"
};

const rolePresets = {
  employee: ["workorders", "expenses", "leaves", "messages"],
  planner: ["employees", "venues", "planning", "workorders", "clockings", "expenses", "messages", "alerts"],
  tenant_admin: Object.keys(permissionLabels)
};
const allowedApiKeyScopes = ["read", "write", "planning", "workorders", "billing", "integrations"];
const moduleApiKeyScopes = ["planning", "workorders", "billing", "integrations"];
const viewConfig = window.WorkFlowProConfig?.views || {};

/**
 * Toast-meldingen. type: "success" | "error" | "warning" | "info"
 * (boolean blijft werken voor oude aanroepen: true=success, false=error).
 * Fouten blijven langer staan; meerdere toasts stapelen netjes.
 */
function showToast(message, type = "success") {
  if (type === true) type = "success";
  if (type === false) type = "error";
  if (!["success", "error", "warning", "info"].includes(type)) type = "info";

  let host = document.getElementById("appToastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "appToastHost";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }

  const icons = { success: "✓", error: "✕", warning: "⚠", info: "ℹ" };
  const toast = document.createElement("div");
  toast.className = `app-toast2 app-toast2-${type}`;
  toast.innerHTML = `<span class="app-toast2-icon">${icons[type]}</span><span class="app-toast2-msg"></span><button class="app-toast2-x" aria-label="Sluiten">×</button>`;
  toast.querySelector(".app-toast2-msg").textContent = String(message || "");
  toast.querySelector(".app-toast2-x").addEventListener("click", () => dismiss());
  host.appendChild(toast);
  while (host.children.length > 4) host.removeChild(host.firstChild);

  requestAnimationFrame(() => toast.classList.add("visible"));
  const ttl = type === "error" ? 7000 : type === "warning" ? 5000 : 3500;
  const timer = setTimeout(dismiss, ttl);
  function dismiss() {
    clearTimeout(timer);
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 250);
  }
}

// Dubbel-submit preventie: blokkeer de submit-knop van élk formulier kort
// na een submit zodat dubbelklikken geen dubbele records aanmaakt.
document.addEventListener("submit", event => {
  const btn = event.target && event.target.querySelector ? event.target.querySelector("[type=submit]") : null;
  if (btn && !btn.disabled) {
    btn.disabled = true;
    setTimeout(() => { btn.disabled = false; }, 2000);
  }
}, true);

function setShellAuthenticated(authenticated) {
  document.body.classList.toggle("guest", !authenticated);
  document.body.classList.toggle("authenticated", authenticated);
}

function setAiSuggestion(title, text, primary, secondary, meta = {}) {
  state.aiSuggestion = { title, text, primary, secondary, meta };
  setText("aiSuggestionTitle", title);
  setText("aiSuggestionText", text);
  el("aiSuggestionPrimary").textContent = primary.label;
  el("aiSuggestionSecondary").textContent = secondary.label;
  const reasons = meta.reasons || [];
  const confidenceLabels = { high: "hoog", medium: "gemiddeld", low: "laag" };
  const confidenceValue = confidenceLabels[meta.confidence] || meta.confidence;
  const confidence = confidenceValue ? `Zekerheid: ${confidenceValue}` : "Gebaseerd op live appstatus";
  el("aiSuggestionMeta").textContent = reasons.length
    ? `${confidence} - ${reasons.slice(0, 2).join(" ")}`
    : confidence;
}

function trackAiSuggestion(eventName) {
  const suggestion = state.aiSuggestion;
  if (!token || !suggestion?.meta?.key) return;
  api(`/api/tenants/${tenantId}/suggestions/home/events`, {
    method: "POST",
    body: JSON.stringify({
      key: suggestion.meta.key,
      event: eventName,
      source: suggestion.meta.source,
      priority: suggestion.meta.priority
    })
  }).catch(() => {});
}

function runAiSuggestionAction(action, eventName = "opened") {
  if (!action) return;
  trackAiSuggestion(eventName);
  if (action.type === "login") {
    el("login").click();
    return;
  }
  if (action.type === "golden") {
    el("demo").click();
    return;
  }
  if (action.type === "view") {
    setView(action.view || action.target);
  }
}

function applyApiSuggestion(suggestion) {
  if (!suggestion) return false;
  setAiSuggestion(
    suggestion.title,
    suggestion.text,
    {
      label: suggestion.primary?.label || "Open",
      type: suggestion.primary?.type || "view",
      view: suggestion.primary?.target
    },
    {
      label: suggestion.secondary?.label || "Bekijk status",
      type: suggestion.secondary?.type || "view",
      view: suggestion.secondary?.target || "status"
    },
    {
      key: suggestion.key,
      confidence: suggestion.confidence,
      reasons: suggestion.reasons,
      metrics: suggestion.metrics,
      source: suggestion.source,
      priority: suggestion.priority
    }
  );
  return true;
}

function updateHomeSuggestion(context = {}) {
  const golden = context.golden?.readiness || {};
  const today = context.today?.today || state.mobile;
  const admin = state.admin || {};
  const readiness = admin.productionReadiness || {};
  const openP0 = (readiness.checks || []).filter(row => !row.ok && row.priority === "P0");

  if (!token) {
    setAiSuggestion(
      "Start met de demo-login",
      "Login als demo admin. Daarna kan ik gericht aangeven of je eerst onboarding, mobiel werk of productieconfig moet aanpakken.",
      { label: "Login demo admin", type: "login" },
      { label: "Bekijk status", type: "view", view: "status" }
    );
    return;
  }

  const openStep = (golden.steps || []).find(step => !step.done);
  if (openStep) {
    setAiSuggestion(
      `Rond ${stepLabels[openStep.key] || openStep.key} af`,
      `De golden path staat op ${golden.percent || 0}%. Werk eerst deze stap af zodat een nieuwe klant sneller operationeel geraakt.`,
      { label: "Maak golden path", type: "golden" },
      { label: "Open Operations", type: "view", view: "ops" }
    );
    return;
  }

  const workorders = today?.openWorkorders?.length || 0;
  if (workorders > 0) {
    setAiSuggestion(
      "Pak mobiele werkbonnen op",
      `Er staan ${workorders} open werkbonnen klaar voor de mobiele flow. Test nu afronden, foto en handtekening alsof je op de werf staat.`,
      { label: "Open Mobile", type: "view", view: "mobile" },
      { label: "Bekijk Werkbonnen", type: "view", view: "workorders" }
    );
    return;
  }

  if (openP0.length) {
    setAiSuggestion(
      "Los production blockers op",
      `Er staan nog ${openP0.length} P0-blockers open. De hoogste waarde zit nu in MFA, Supabase/secrets, Stripe of Peppol configuratie.`,
      { label: "Open Admin", type: "view", view: "admin" },
      { label: "Bekijk Status", type: "view", view: "status" }
    );
    return;
  }

  setAiSuggestion(
    "Klaar voor pilotvalidatie",
    "De basisflow ziet er goed uit. De volgende beste stap is dagelijkse uitvoering blijven opvolgen en go-live blockers in instellingen afronden.",
    { label: "Open Actiecentrum", type: "view", view: "notifications" },
    { label: "Open Instellingen", type: "view", view: "admin" }
  );
}

function setView(view) {
  window.WorkFlowProRouter.setView(view);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setNotice(message, good = true) {
  setNoticeText("opsNotice", message, good);
}

function setBillingNotice(message, good = true) {
  setNoticeText("billingNotice", message, good);
}

function setAssetNotice(message, good = true) {
  setNoticeText("assetNotice", message, good);
}

function setReportNotice(message, good = true) {
  setNoticeText("reportNotice", message, good);
}

function setIntegrationNotice(message, good = true) {
  setNoticeText("integrationNotice", message, good);
}

function setNotificationNotice(message, good = true) {
  setNoticeText("notificationNotice", message, good);
}

function setAdminNotice(message, good = true) {
  setNoticeText("adminNotice", message, good);
}

function isSuperAdmin() {
  return el("sessionState").dataset.role === "super_admin";
}

function renderSteps(readiness) {
  const steps = readiness?.steps || [];
  el("steps").innerHTML = steps.map(step => `
    <div class="step ${step.done ? "done" : ""}">
      <span class="step-mark">${step.done ? "OK" : "-"}</span>
      <div>
        <strong>${stepLabels[step.key] || step.key}</strong>
        <small>${step.done ? "Klaar" : "Nog te voltooien"}</small>
      </div>
    </div>
  `).join("");
  setText("readinessScore", `${readiness?.percent || 0}%`);
  if (readiness?.tenant) {
    setText("tenantName", readiness.tenant.name || "Demo klant");
    setText("tenantPlan", `${readiness.tenant.plan || "business"} - ${readiness.tenant.status || "trial"}`);
  }
}

function renderModules(modules) {
  setText("moduleCount", String(modules.length));
  el("modules").innerHTML = modules.map(mod => `
    <div class="module">
      <strong>${mod.label}</strong>
      <small>${moduleDescriptions[mod.key] || "Beschikbaar in de API"}</small>
    </div>
  `).join("");
}

function renderToday(today) {
  if (!today) {
    el("todayList").innerHTML = `
      <div class="today-item warning">
        <strong>Nog niet ingelogd</strong>
        <small>Login met de demo admin om de mobiele flow te laden.</small>
      </div>
    `;
    return;
  }

  setText("mobileDate", today.date || "-");
  setText("mobileUser", today.user?.name || "Vandaag-flow");

  const shifts = today.shifts?.length || 0;
  const workorders = today.openWorkorders?.length || 0;
  const offline = today.offlineHints?.nextStep || "Offline wachtrij klaarzetten";

  el("todayList").innerHTML = `
    <div class="today-item">
      <strong>${shifts} planningitems vandaag</strong>
      <small>De mobiele startpagina haalt planning tenant-scoped op.</small>
    </div>
    <div class="today-item">
      <strong>${workorders} open werkbonnen</strong>
      <small>Werkbonnen worden klaargezet voor veldgebruik.</small>
    </div>
    <div class="today-item warning">
      <strong>Volgende stap</strong>
      <small>${offline}</small>
    </div>
  `;
}

function saveQueue() {
  window.WorkFlowProMobile.saveQueue();
}

function fillSelects() {
  const users = state.users.filter(user => user.role !== "tenant_admin");
  const userOptions = optionList(users.length ? users : state.users, "Voeg eerst een medewerker toe");
  const allUserOptions = optionList(state.users, "Voeg eerst een medewerker toe");
  const venueOptions = optionList(state.venues, "Voeg eerst een werf toe");
  ["planningUser", "workorderUser", "expenseUser"].forEach(id => { el(id).innerHTML = userOptions; });
  ["planningVenue", "workorderVenue"].forEach(id => { el(id).innerHTML = venueOptions; });
  el("clockUser").innerHTML = userOptions;
  el("permissionUser").innerHTML = allUserOptions;
  el("clockVenue").innerHTML = `<option value="">Geen werf</option>${state.venues.map(row => `<option value="${row.id}">${row.name}</option>`).join("")}`;
}

function renderStatusPage(status) {
  state.publicStatus = status;
  const readiness = status.productionReadiness || {};
  const storage = status.storage || {};
  const release = status.release || {};
  const blockers = readiness.blockers || [];
  const operational = status.ok && status.status === "operational";
  const badge = el("statusBadge");
  badge.textContent = operational ? "Operationeel" : "Aandacht nodig";
  badge.classList.toggle("muted", !operational);
  setText("statusPlatform", status.status || "-");
  setText("statusGenerated", status.generatedAt ? `Laatste controle ${status.generatedAt}` : "Laatste controle onbekend");
  setText("statusRelease", release.version || "-");
  setText("statusChannel", release.channel || "Kanaal onbekend");
  setText("statusStorage", storage.adapter || "-");
  setText("statusMigrations", storage.migrations || "-");
  setText("statusReadiness", `${readiness.score ?? 0}%`);
  setText("statusBlockers", blockers.length ? `${blockers.length} blocker(s)` : "Geen publieke blocker");
  el("statusFocus").innerHTML = `
    <article class="status-focus-card primary">
      <p class="eyebrow">Monitoring</p>
      <h2>${operational ? "Platform operationeel" : blockers[0]?.label || "Aandacht nodig"}</h2>
      <p>${escapeHtml(operational ? "Publieke status is gezond. Deze pagina bevat geen tenantdata." : blockers[0]?.detail || "Controleer componentstatus en readiness voordat klanten live gaan.")}</p>
    </article>
    <article class="status-focus-card">
      <span>Componenten</span>
      <strong>${(status.modules || []).filter(row => row.status === "operational").length}/${(status.modules || []).length}</strong>
      <small>operationeel</small>
    </article>
    <article class="status-focus-card">
      <span>Release</span>
      <strong>${escapeHtml(release.version || "-")}</strong>
      <small>${escapeHtml(release.channel || "kanaal onbekend")}</small>
    </article>
    <article class="status-focus-card">
      <span>Readiness</span>
      <strong>${readiness.score ?? 0}%</strong>
      <small>${blockers.length} publieke blocker(s)</small>
    </article>
  `;
  renderList("statusModules", status.modules || [], row => `
    <div class="data-row">
      <strong>${escapeHtml(row.name)}</strong>
      <span class="status-badge ${statusTone(row.status)}">${escapeHtml(row.status)}</span>
    </div>
  `, "Nog geen componentstatus.");
  showJson("statusJson", status);
}

function renderPlanningExperience() {
  if (window.calendarRender) {
    window.calendarRender();
  } else {
    window.WorkFlowProOperations.renderPlanningExperience();
  }
}

function renderWorkorderExperience() {
  window.WorkFlowProOperations.renderWorkorderExperience();
}

function renderOpsFocus() {
  const totals = state.report?.totals || {};
  const finance = state.report?.finance || {};
  const pendingExpenses = state.expenses.filter(expense => expense.status !== "approved");
  const approvedExpenses = state.expenses.filter(expense => expense.status === "approved");
  const openWorkorders = state.workorders.filter(workorder => !["Voltooid", "Afgewerkt"].includes(workorder.status));
  const payrollReady = pendingExpenses.length === 0 && Number(totals.clockedHours || 0) > 0;
  const selectedExpense = pendingExpenses[0] || state.expenses[0] || null;
  const selectedAmount = Number(selectedExpense?.amount || 0);
  const policyLimit = 75;
  const policyChecks = selectedExpense ? [
    ["Categorie geldig", Boolean(selectedExpense.category)],
    [`Bedrag binnen limiet (< EUR ${policyLimit.toFixed(2)})`, selectedAmount <= policyLimit],
    ["Medewerker gekoppeld", Boolean(selectedExpense.userId)],
    ["Klaar voor finance review", selectedExpense.status !== "approved"]
  ] : [];
  const nextAction = pendingExpenses.length
    ? { label: `${pendingExpenses.length} onkosten goedkeuren`, detail: "Controleer bedrag, categorie en bon voordat finance exporteert.", tone: "warning" }
    : openWorkorders.length
      ? { label: `${openWorkorders.length} werkbonnen opvolgen`, detail: "Werkbonnen moeten afgerond zijn voor volledige facturatie.", tone: "info" }
      : { label: "Export voorbereiden", detail: "Uren en onkosten zijn klaar om naar finance te gaan.", tone: "success" };

  el("opsFocus").innerHTML = `
    <section class="ops-focus-grid">
      <article class="ops-focus-card primary">
        <p class="eyebrow">Tijd & onkosten</p>
        <h2>${escapeHtml(nextAction.label)}</h2>
        <p>${escapeHtml(nextAction.detail)}</p>
        <span class="status-badge ${payrollReady ? "success" : nextAction.tone}">${payrollReady ? "Klaar voor export" : "Actie nodig"}</span>
      </article>
      <article class="ops-focus-card">
        <span>Geklokte uren</span>
        <strong>${Number(totals.clockedHours || 0).toFixed(1)}u</strong>
        <small>${totals.planningItems || 0} planningen</small>
      </article>
      <article class="ops-focus-card">
        <span>Onkosten open</span>
        <strong>${pendingExpenses.length}</strong>
        <small>EUR ${Number(finance.pendingExpenseTotal || 0).toFixed(2)} te keuren</small>
      </article>
      <article class="ops-focus-card">
        <span>Goedgekeurd</span>
        <strong>${approvedExpenses.length}</strong>
        <small>EUR ${Number(finance.approvedExpenseTotal || 0).toFixed(2)} finance-ready</small>
      </article>
    </section>
    <section class="ops-review-layout">
      <article class="ops-approval-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Goedkeuring</p>
            <h2>Onkosten die finance blokkeren</h2>
          </div>
          <button class="secondary-action small-action" data-export="expenses" type="button">CSV export</button>
        </div>
        <div class="ops-approval-list">
          ${pendingExpenses.length ? pendingExpenses.map(expense => `
            <div class="ops-approval-row ${selectedExpense?.id === expense.id ? "active" : ""}">
              <div>
                <strong>${escapeHtml(expense.title)} - EUR ${Number(expense.amount || 0).toFixed(2)}</strong>
                <small>${escapeHtml(expense.category || "Onkost")} - ${escapeHtml(personName(expense.userId))}</small>
              </div>
              <button class="small-action" data-approve-expense="${expense.id}" type="button">Goedkeuren</button>
            </div>
          `).join("") : `<div class="empty">Geen open onkosten. Finance kan exporteren wanneer de uren gecontroleerd zijn.</div>`}
        </div>
      </article>
      <aside class="ops-detail-panel">
        <div class="ops-detail-card">
          <div class="panel-head compact">
            <div>
              <p class="eyebrow">Detail</p>
              <h2>${selectedExpense ? escapeHtml(personName(selectedExpense.userId)) : "Geen selectie"}</h2>
            </div>
            ${selectedExpense ? `<span class="status-badge ${selectedExpense.status === "approved" ? "success" : "warning"}">${escapeHtml(selectedExpense.status || "submitted")}</span>` : ""}
          </div>
          ${selectedExpense ? `
            <div class="expense-receipt">
              <span>TOTAAL</span>
              <strong>EUR ${selectedAmount.toFixed(2)}</strong>
              <small>${escapeHtml(selectedExpense.title || "Onkost")} - ${escapeHtml(selectedExpense.category || "Categorie")}</small>
            </div>
            <dl class="ops-detail-list">
              <div><dt>Medewerker</dt><dd>${escapeHtml(personName(selectedExpense.userId))}</dd></div>
              <div><dt>Categorie</dt><dd>${escapeHtml(selectedExpense.category || "-")}</dd></div>
              <div><dt>Status</dt><dd>${escapeHtml(selectedExpense.status || "submitted")}</dd></div>
            </dl>
          ` : `<div class="empty">Selecteer of dien een onkost in om detail te zien.</div>`}
        </div>
        <div class="ops-detail-card">
          <div class="panel-head compact">
            <div>
              <p class="eyebrow">Beleidscheck</p>
              <h2>Finance controle</h2>
            </div>
          </div>
          <div class="policy-list">
            ${policyChecks.length ? policyChecks.map(([label, ok]) => `
              <div class="policy-row ${ok ? "ok" : "warning"}">
                <span>${ok ? "OK" : "!"}</span>
                <strong>${escapeHtml(label)}</strong>
              </div>
            `).join("") : `<div class="empty">Geen onkost om te controleren.</div>`}
          </div>
        </div>
        <div class="ops-detail-card assistant-card">
          <p class="eyebrow">Payroll readiness</p>
          <strong>${payrollReady ? "Klaar voor export" : "Nog niet exporteren"}</strong>
          <small>${payrollReady ? "Tijdregistraties en onkosten zijn klaar voor finance." : `${pendingExpenses.length} open onkosten en ${openWorkorders.length} open werkbonnen blijven zichtbaar.`}</small>
          <button class="secondary-action small-action" data-export="expenses" type="button">Exporteer naar payroll</button>
        </div>
      </aside>
    </section>
  `;
}

function renderOps() {
  fillSelects();
  renderReport();
  renderPermissionForm();
  renderPlanningExperience();
  renderWorkorderExperience();
  renderOpsFocus();
  renderList("employeeRows", state.users, user => `
    <div class="data-row">
      <strong>${user.name}</strong>
      <small>${user.email} - ${user.role}${user.jobTitle ? ` - ${user.jobTitle}` : ""} - ${(user.permissions || []).length} rechten</small>
    </div>
  `, "Nog geen medewerkers.");
  renderList("planningRows", state.planning, shift => `
    <div class="data-row">
      <strong>${shift.date} - ${personName(shift.userId)}</strong>
      <small>${shift.start || shift.startsAt} tot ${shift.end || shift.endsAt} - ${venueName(shift.venueId)}</small>
    </div>
  `, "Nog geen planning.");
  renderList("workorderRows", state.workorders, workorder => `
    <div class="data-row">
      <strong>${workorder.title}</strong>
      <small>${workorder.status || "Nieuw"} - ${personName(workorder.userId)} - ${venueName(workorder.venueId)}</small>
    </div>
  `, "Nog geen werkbonnen.");
  renderList("expenseRows", state.expenses, expense => `
    <div class="data-row">
      <strong>${expense.title} - EUR ${Number(expense.amount || 0).toFixed(2)}</strong>
      <small>${expense.category} - ${expense.status || "submitted"} - ${personName(expense.userId)}</small>
      ${expense.status === "approved" ? "" : `<div class="row-actions"><button class="small-action" data-approve-expense="${expense.id}" type="button">Goedkeuren</button></div>`}
    </div>
  `, "Nog geen onkosten.");
  document.querySelectorAll("[data-approve-expense]").forEach(button => {
    button.addEventListener("click", () => approveExpense(button.dataset.approveExpense));
  });
}

function selectedPermissionUser() {
  const userId = el("permissionUser").value;
  return state.users.find(user => user.id === userId) || state.users[0] || null;
}

function renderPermissionForm() {
  const user = selectedPermissionUser();
  if (!user) {
    el("permissionChecks").innerHTML = `<div class="empty">Maak eerst een medewerker aan.</div>`;
    return;
  }
  el("permissionRole").value = user.role || "employee";
  const granted = new Set(user.permissions || []);
  el("permissionChecks").innerHTML = Object.entries(permissionLabels).map(([key, label]) => `
    <label class="check-row">
      <input type="checkbox" name="permissions" value="${key}" ${granted.has(key) ? "checked" : ""}>
      <span>${label}</span>
    </label>
  `).join("");
}

function applyRolePreset(role) {
  const preset = new Set(rolePresets[role] || rolePresets.employee);
  document.querySelectorAll('#permissionChecks input[name="permissions"]').forEach(input => {
    input.checked = preset.has(input.value);
  });
}

function renderReport() {
  const totals = state.report?.totals || {};
  const finance = state.report?.finance || {};
  const cards = [
    ["Medewerkers", totals.employees || 0],
    ["Geplande items", totals.planningItems || 0],
    ["Geklokte uren", totals.clockedHours || 0],
    ["Open werkbonnen", totals.workordersOpen || 0],
    ["Onkosten", `EUR ${Number(totals.expenseTotal || 0).toFixed(2)}`],
    ["Goedgekeurd", `EUR ${Number(finance.approvedExpenseTotal || 0).toFixed(2)}`]
  ];
  el("reportCards").innerHTML = cards.map(([label, value]) => `
    <div class="report-card">
      <strong>${value}</strong>
      <small>${label}</small>
    </div>
  `).join("");
}

async function refreshCustomerStart() {
  await window.WorkFlowProCustomerStart.refresh();
}

async function refresh() {
  try {
    const health = await api("/api/health");
    showJson("jsonHealth", health);
    setText("apiStatus", health.ok ? "Online" : "Niet klaar");
    setText("apiDetail", `${health.mode} - ${health.modules} modules`);

    if (!token) {
      renderToday(null);
      window.WorkFlowProCustomerStart.render(null);
      updateHomeSuggestion({ health });
      return;
    }

    const [modules, golden, today] = await Promise.all([
      api("/api/modules"),
      api(`/api/tenants/${tenantId}/golden-path`),
      api(`/api/tenants/${tenantId}/mobile/today`)
    ]);
    const suggestion = await api(`/api/tenants/${tenantId}/suggestions/home`).catch(() => null);

    showJson("jsonModules", modules);
    showJson("jsonGolden", golden);
    showJson("jsonToday", today);
    renderModules(modules.modules || []);
    renderSteps(golden.readiness);
    renderToday(today.today);
    await refreshCustomerStart();
    if (!applyApiSuggestion(suggestion?.suggestion)) updateHomeSuggestion({ health, golden, today });
  } catch (error) {
    setText("apiStatus", "Fout");
    setText("apiDetail", error.message);
    setAiSuggestion(
      "Controleer de API",
      `De homepage kan de backend niet bereiken: ${error.message}`,
      { label: "Bekijk Status", type: "view", view: "status" },
      { label: "Bekijk JSON", type: "view", view: "json" }
    );
  }
}

async function refreshStatus() {
  try {
    const status = await api("/api/status");
    renderStatusPage(status);
  } catch (error) {
    const badge = el("statusBadge");
    badge.textContent = "Niet bereikbaar";
    badge.classList.add("muted");
    setText("statusPlatform", "Fout");
    setText("statusGenerated", error.message);
    showJson("statusJson", { ok: false, error: error.message });
  }
}

async function refreshOps() {
  if (!token) {
    setNotice("Login met de demo admin om operationele data te beheren.", false);
    renderPlanningExperience();
    renderWorkorderExperience();
    return;
  }
  const [users, venues, planning, workorders, expenses, report] = await Promise.all([
    listModuleRows("users"),
    listModuleRows("venues"),
    listModuleRows("planning"),
    listModuleRows("workorders"),
    listModuleRows("expenses"),
    api(`/api/tenants/${tenantId}/management-report`)
  ]);
  state.users = users;
  state.venues = venues;
  state.planning = planning;
  state.workorders = workorders;
  state.expenses = expenses;
  state.report = report.report || null;
  renderOps();
  setNotice("Operationele data is bijgewerkt.");
}

function renderBilling() {
  window.WorkFlowProBilling.render();
}

async function refreshBilling() {
  await window.WorkFlowProBilling.refresh();
}

function serviceDueSoon(vehicle) {
  return window.WorkFlowProAssets.serviceDueSoon(vehicle);
}

function renderAssets() {
  window.WorkFlowProAssets.render();
}

async function refreshAssets() {
  await window.WorkFlowProAssets.refresh();
}

async function refreshStock() {
  if (window.stockLoad) await window.stockLoad();
}

async function refreshVerlof() {
  if (window.verlofLoad) await window.verlofLoad();
}

async function refreshWagenpark() {
  if (window.wagenparkLoad) await window.wagenparkLoad();
}

async function submitAssetModule(form, key, mapper) {
  await window.WorkFlowProAssets.submit(form, key, mapper);
}

function renderReportsDashboard() {
  window.WorkFlowProReports.render();
}

async function refreshReportsDashboard() {
  await window.WorkFlowProReports.refresh();
}

async function refreshMobile() {
  await window.WorkFlowProMobile.refresh();
}

function renderIntegrations() {
  window.WorkFlowProIntegrations.render();
}

async function refreshIntegrations() {
  await window.WorkFlowProIntegrations.refresh();
}

async function connectIntegration(form) {
  await window.WorkFlowProIntegrations.connect(form);
}

async function saveMapping(form) {
  await window.WorkFlowProIntegrations.saveMapping(form);
}

function renderNotifications() {
  window.WorkFlowProActionCenter.render();
}

async function refreshNotifications() {
  await window.WorkFlowProActionCenter.refresh();
}

async function createNotificationFromForm(form) {
  await window.WorkFlowProActionCenter.createFromForm(form);
}

async function generateReminders() {
  await window.WorkFlowProActionCenter.generate();
}

async function markNotificationRead(notificationId) {
  await window.WorkFlowProActionCenter.markRead(notificationId);
}

function renderAdmin() {
  const status = state.admin || {};
  const counts = status.counts || {};
  const health = status.health || {};
  const support = status.tenant?.supportAccess || {};
  const storage = status.storage || {};
  const config = status.config || {};
  const readiness = status.productionReadiness || {};
  const configRisk = readiness.configRisk || {};
  const keyRisk = status.apiKeyRisk || {};
  const mfaRisk = status.mfaRisk || {};
  const integrationRisk = status.integrationRisk || {};
  const rateLimits = status.rateLimits || {};
  const backupHealth = status.backupHealth || {};
  const goLive = state.goLive || {};
  const roadmap = state.roadmap || {};
  const gates = goLive.gates || {};
  const productionGate = gates.production || {};
  const pilotGate = gates.pilot || {};
  const salesGate = gates.sales || {};
  const customerStartGate = gates.customerStart || {};
  const cards = [
    ["API", health.api || "-"],
    ["Storage", health.storage || "-"],
    ["Go-live", goLive.ok ? "Klaar" : "Open"],
    ["Roadmapfase", roadmap.currentPhase || "-"],
    ["Roadmap go", `${roadmap.summary?.go || 0}/${roadmap.summary?.total || 0}`],
    ["Production", `${readiness.score || 0}%`],
    ["P0 blockers", productionGate.p0 ?? readiness.blockers ?? 0],
    ["Pilot gate", `${pilotGate.score || 0}%`],
    ["Sales gate", `${salesGate.score || 0}%`],
    ["Klantstart", customerStartGate.ok ? "Klaar" : "Open"],
    ["Rapporten", state.reportsSummary?.total || 0],
    ["Schema", `${storage.schemaVersion || "-"} / ${storage.latestSchemaVersion || "-"}`],
    ["Migraties", health.migrations || "-"],
    [".env", config.envLoaded ? "Geladen" : "Niet geladen"],
    ["Config klaar", `${configRisk.ready || 0}/${configRisk.total || 0}`],
    ["Config open", configRisk.missing || 0],
    ["Admin MFA", mfaRisk.ok ? "Klaar" : "Open"],
    ["MFA klaar", `${mfaRisk.readyAdmins || 0}/${mfaRisk.totalAdmins || 0}`],
    ["MFA ontbreekt", mfaRisk.missingMfa || 0],
    ["Backup", health.backup || "-"],
    ["Backup health", backupHealth.ok ? "Klaar" : "Open"],
    ["Backup ontbreekt", backupHealth.missing || 0],
    ["Backup te oud", backupHealth.stale || 0],
    ["Gebruikers", counts.users || 0],
    ["Geblokkeerd", counts.lockedUsers || 0],
    ["Werkbonnen", counts.workorders || 0],
    ["Sales leads", counts.salesLeads || 0],
    ["Partners", counts.partners || 0],
    ["Audit events", counts.auditEvents || 0],
    ["Fouten", counts.errorEvents || 0],
    ["API keys", counts.apiKeys || 0],
    ["Keys verlopen", keyRisk.expired || 0],
    ["Keys zonder verval", keyRisk.noExpiry || 0],
    ["Keys nooit gebruikt", keyRisk.neverUsed || 0],
    ["Keys zonder read", keyRisk.missingReadScope || 0],
    ["Keys zonder module", keyRisk.missingModuleScope || 0],
    ["Keys vervallen snel", keyRisk.expiringSoon || 0],
    ["Key denials", keyRisk.deniedRequests || 0],
    ["Keys herhaald geweigerd", keyRisk.repeatedDenials || 0],
    ["Koppelingen aandacht", integrationRisk.needsAttention || 0],
    ["Koppelingen zonder secret", integrationRisk.missingSecrets || 0],
    ["Sync fouten", integrationRisk.syncFailures || 0],
    ["Retrybaar", integrationRisk.retryableFailures || 0],
    ["Mapping issues", integrationRisk.mappingsNeedAttention || 0],
    ["Foutcode secret", integrationRisk.errorCodes?.missing_secret || 0],
    ["Foutcode mapping", integrationRisk.errorCodes?.invalid_mapping || 0],
    ["Rate limit", health.rateLimiting || "-"],
    ["Rate buckets", rateLimits.activeBuckets || 0],
    ["Release", status.release?.version || "-"],
    ["Support", support.allowed ? "Open" : "Gesloten"]
  ];
  el("adminCards").innerHTML = cards.map(([label, value]) => `
    <article class="metric">
      <span class="metric-label">${label}</span>
      <strong>${value}</strong>
      <small>${status.tenant?.name || "Tenant"}</small>
    </article>
  `).join("");

  const firstGoLiveBlocker = (productionGate.openP0 || [])[0]
    || (pilotGate.openKpis || [])[0]
    || (salesGate.openChecks || [])[0]
    || (customerStartGate.blockers || []).map(label => ({ label, detail: customerStartGate.detail }))[0]
    || null;
  el("goLiveFocus").innerHTML = `
    <section class="go-live-focus-grid">
      <article class="go-live-focus-card primary">
        <p class="eyebrow">Go-live cockpit</p>
        <h2>${goLive.ok ? "Klaar voor gecontroleerde livegang" : firstGoLiveBlocker?.label || "Go-live nog open"}</h2>
        <p>${escapeHtml(goLive.ok ? "Production, pilot, sales en klantstart staan groen." : firstGoLiveBlocker?.detail || firstGoLiveBlocker?.action || "Werk de open gates af voordat echte klanten live gaan.")}</p>
        <button id="goLiveGenerateReports" type="button">Rapporten genereren</button>
      </article>
      <article class="go-live-focus-card">
        <span>Production</span>
        <strong>${productionGate.score || 0}%</strong>
        <small>${productionGate.p0 ?? 0} P0 open</small>
      </article>
      <article class="go-live-focus-card">
        <span>Pilot</span>
        <strong>${pilotGate.score || 0}%</strong>
        <small>${pilotGate.openCount || 0} KPI open</small>
      </article>
      <article class="go-live-focus-card">
        <span>Sales</span>
        <strong>${salesGate.score || 0}%</strong>
        <small>${salesGate.openCount || 0} checks open</small>
      </article>
      <article class="go-live-focus-card">
        <span>Klantstart</span>
        <strong>${customerStartGate.ok ? "Go" : "Open"}</strong>
        <small>${customerStartGate.ready ? customerStartGate.label || "dagflow klaar" : (customerStartGate.blockers || []).length + " blocker(s)"}</small>
      </article>
    </section>
  `;
  const goLiveGenerateReports = el("goLiveGenerateReports");
  if (goLiveGenerateReports) goLiveGenerateReports.addEventListener("click", generateReports);

  const securityOpen = [
    mfaRisk.ok ? "" : `${mfaRisk.missingMfa || 0} admin MFA open`,
    support.allowed ? "Supporttoegang staat open" : "",
    backupHealth.ok ? "" : `${backupHealth.missing || 0} backup issue(s)`,
    Number(counts.errorEvents || 0) ? `${counts.errorEvents} fout-events` : ""
  ].filter(Boolean);
  const securityReady = !securityOpen.length;
  const setupCounts = status.counts || {};
  const setupOpen = [
    setupCounts.users ? "" : "Medewerkers ontbreken",
    setupCounts.venues ? "" : "Werven ontbreken",
    setupCounts.workorders ? "" : "Werkbonnen ontbreken"
  ].filter(Boolean);
  el("setupFocus").innerHTML = `
    <section class="setup-focus-grid">
      <article class="setup-focus-card primary">
        <p class="eyebrow">Klantsetup</p>
        <h2>${setupOpen.length ? setupOpen[0] : "Basis klantsetup staat klaar"}</h2>
        <p>${setupOpen.length ? "Gebruik setup-acties alleen tijdens onboarding; dagelijkse gebruikers zien deze formulieren niet." : "Medewerkers, werven en werkbonnen zijn aanwezig. Dagelijkse flow blijft schoon."}</p>
      </article>
      <article class="setup-focus-card">
        <span>Gebruikers</span>
        <strong>${setupCounts.users || 0}</strong>
        <small>tenant accounts</small>
      </article>
      <article class="setup-focus-card">
        <span>Werven</span>
        <strong>${setupCounts.venues || 0}</strong>
        <small>locaties</small>
      </article>
      <article class="setup-focus-card">
        <span>Werkbonnen</span>
        <strong>${setupCounts.workorders || 0}</strong>
        <small>operationeel</small>
      </article>
    </section>
  `;
  el("adminFocus").innerHTML = `
    <section class="admin-focus-grid">
      <article class="admin-focus-card primary">
        <p class="eyebrow">Security readiness</p>
        <h2>${securityReady ? "Security klaar voor pilot" : securityOpen[0]}</h2>
        <p>${securityReady ? "MFA, backup, audit en supporttoegang staan onder controle." : "Los deze blocker eerst op voordat echte klanten live gaan."}</p>
        <span class="status-badge ${securityReady ? "success" : "warning"}">${securityReady ? "Go" : "Actie nodig"}</span>
      </article>
      <article class="admin-focus-card">
        <span>MFA admins</span>
        <strong>${mfaRisk.readyAdmins || 0}/${mfaRisk.totalAdmins || 0}</strong>
        <small>${mfaRisk.missingMfa || 0} ontbreekt</small>
      </article>
      <article class="admin-focus-card">
        <span>Support</span>
        <strong>${support.allowed ? "Open" : "Gesloten"}</strong>
        <small>${support.allowed ? support.reason || "consent actief" : "geen actieve toegang"}</small>
      </article>
      <article class="admin-focus-card">
        <span>Backup</span>
        <strong>${backupHealth.ok ? "Klaar" : "Open"}</strong>
        <small>${backupHealth.stale || 0} te oud, ${backupHealth.missing || 0} ontbreekt</small>
      </article>
    </section>
  `;

  const auditRows = state.auditRows.length ? state.auditRows : (status.latestAudit || []);
  renderList("adminAuditRows", auditRows, row => `
    <div class="data-row">
      <strong>${row.area} - ${row.action}</strong>
      <small>${row.at} - ${row.actor || "system"} - tenant ${row.tenantId || "platform"} - ${row.detail || ""}</small>
    </div>
  `, "Nog geen audit-events.");
  if (state.auditSummary) {
    el("auditFilterNotice").textContent = `${state.auditSummary.returned} audit-events getoond van ${state.auditSummary.totalMatched} matches.`;
  }

  const errorRows = state.errorRows.length ? state.errorRows : (status.latestErrors || []);
  renderList("adminErrorRows", errorRows, row => `
    <div class="data-row">
      <strong>${row.status || 500} - ${row.path || "onbekende route"}</strong>
      <small>${row.at} - ${row.method || "GET"} - ${row.message || "Serverfout"}</small>
    </div>
  `, "Nog geen fouten geregistreerd.");
  if (state.errorSummary) {
    el("errorFilterNotice").textContent = `${state.errorSummary.returned} fout-events getoond van ${state.errorSummary.totalMatched} matches.`;
  }

  renderList("mfaRiskRows", mfaRisk.rows || [], row => `
    <div class="data-row ${row.ready ? "kpi-ok" : "kpi-open"}">
      <strong>${row.ready ? "Klaar" : "Actie"} - ${row.name || row.email}</strong>
      <small>${row.email} - ${row.role} - MFA ${row.mfaEnabled ? "actief" : "ontbreekt"} - enforced ${row.mfaEnforced ? "ja" : "nee"} - ${row.action}</small>
    </div>
  `, "Nog geen MFA-risk geladen.");

  const policies = rateLimits.policies || [];
  const rateRows = policies.map(policy => ({
    ...policy,
    runtime: rateLimits.byPolicy?.[policy.name] || {}
  }));
  renderList("rateLimitRows", rateRows, row => `
    <div class="data-row">
      <strong>${row.name} - ${row.limit} requests/${row.windowSeconds}s</strong>
      <small>${row.runtime.activeBuckets || 0} actieve buckets - ${row.runtime.currentRequests || 0} requests in huidig venster - piek ${row.runtime.maxBucketCount || 0}</small>
    </div>
  `, "Nog geen rate-limit policies geladen.");

  renderList("productionReadinessRows", readiness.checks || [], row => `
    <div class="data-row ${row.ok ? "kpi-ok" : "kpi-open"}">
      <strong>${row.ok ? "Klaar" : "Open"} - ${row.label}</strong>
      <small>${row.priority} - ${row.detail}</small>
    </div>
  `, "Nog geen production readiness check geladen.");

  renderList("productionConfigRows", configRisk.rows || [], row => `
    <div class="data-row ${row.ok ? "kpi-ok" : "kpi-open"}">
      <strong>${row.ok ? "Klaar" : "Open"} - ${row.label}</strong>
      <small>${row.required} - ${row.value} - ${row.action}</small>
    </div>
  `, "Nog geen production config geladen.");

  const goLiveRows = [
    ...(productionGate.openP0 || []).map(row => ({
      label: `P0 - ${row.label}`,
      detail: row.detail,
      group: "Production"
    })),
    ...(pilotGate.openKpis || []).map(row => ({
      label: `Pilot - ${row.label}`,
      detail: row.action || row.detail,
      group: "Pilot"
    })),
    ...(salesGate.openChecks || []).map(row => ({
      label: `Sales - ${row.label}`,
      detail: row.action || row.detail,
      group: "Commercial"
    })),
    ...(customerStartGate.blockers || []).map(row => ({
      label: `Klantstart - ${row}`,
      detail: customerStartGate.detail || "Maak de dagelijkse klantflow klaar voor live gebruik.",
      group: "Customer start"
    }))
  ];
  renderList("goLiveRows", goLiveRows, row => `
    <div class="data-row kpi-open">
      <strong>${row.group} - ${row.label}</strong>
      <small>${row.detail || "Nog te vervolledigen voor go-live."}</small>
    </div>
  `, goLive.ok ? "Alle go-live gates staan groen." : "Nog geen go-live gate geladen.");

  renderList("roadmapRows", roadmap.phases || [], row => {
    const firstAction = (row.actions || [])[0];
    return `
      <div class="data-row ${row.go ? "kpi-ok" : "kpi-open"}">
        <strong>${row.go ? "Go" : "No-go"} - ${row.label} - ${row.score}%</strong>
        <small>${row.detail || "Roadmapfase"} ${row.openCount ? `- ${row.openCount} open acties` : ""}</small>
        <small>${firstAction ? `Volgende actie: ${firstAction.label} - ${firstAction.action}` : "Geen open acties voor deze fase."}</small>
      </div>
    `;
  }, "Nog geen roadmapstatus geladen.");

  renderList("reportRows", state.reports, row => `
    <div class="data-row">
      <strong>${row.kind} - ${row.title}</strong>
      <small>${row.format.toUpperCase()} - ${row.updatedAt} - ${Math.round(row.size / 1024)} KB</small>
      <div class="row-actions">
        <button class="small-action" data-report-preview="${row.id}" type="button">Preview</button>
      </div>
    </div>
  `, "Nog geen readinessrapporten gegenereerd.");
  document.querySelectorAll("[data-report-preview]").forEach(button => {
    button.addEventListener("click", () => previewReport(button.dataset.reportPreview));
  });
  renderReportPreview();

  const apiKeyGate = state.apiKeyGovernance || {};
  const apiKeyIssues = [
    ...(apiKeyGate.openP0 || []).map(row => ({ ...row, marker: "P0" })),
    ...(apiKeyGate.openP1 || []).map(row => ({ ...row, marker: "P1" }))
  ];
  renderList("apiKeyGovernanceRows", apiKeyIssues, row => `
    <div class="data-row ${row.priority === "P0" ? "kpi-open" : ""}">
      <strong>${row.marker} - ${row.key?.label || "API key"} - ${row.code}</strong>
      <small>${row.detail} ${row.key?.prefix ? `(${row.key.prefix}...)` : ""}</small>
      <small>Actie: ${row.action || "Controleer deze key."}</small>
    </div>
  `, apiKeyGate.ok ? "API-key governance staat groen." : "Nog geen API-key governance geladen.");

  renderList("lockedUserRows", status.lockedUsers || [], row => `
    <div class="data-row">
      <strong>${row.name} - ${row.email}</strong>
      <small>${row.role} - ${row.failedLoginCount || 0} mislukte pogingen - geblokkeerd tot ${row.lockedUntil}</small>
      <div class="row-actions">
        <button class="small-action" data-unlock-user="${row.id}" type="button">Deblokkeer</button>
      </div>
    </div>
  `, "Geen geblokkeerde accounts.");
  document.querySelectorAll("[data-unlock-user]").forEach(button => {
    button.addEventListener("click", () => unlockUser(button.dataset.unlockUser));
  });

  if (config.envLoaded) {
    el("adminNotice").textContent = `Adminstatus is bijgewerkt. .env keys: ${(config.envKeys || []).join(", ") || "geen nieuwe keys"}.`;
  }

  renderList("migrationRows", storage.migrationHistory || [], row => `
    <div class="data-row">
      <strong>v${row.version} - ${row.name}</strong>
      <small>${row.appliedAt}</small>
    </div>
  `, (storage.pendingMigrations || []).length
    ? `Pending: ${(storage.pendingMigrations || []).map(row => `v${row.version} ${row.name}`).join(", ")}`
    : "Nog geen migratiegeschiedenis voor deze lokale database.");

  renderList("backupRows", state.backups, row => `
    <div class="data-row">
      <strong>${row.name}</strong>
      <small>${row.createdAt} - tenant ${row.tenantId || tenantId} - schema ${row.schemaVersion || "-"} - integriteit ${row.checksumValid === true ? "geverifieerd" : row.checksumPresent ? "ongeldig" : "legacy"} - ${Math.round(row.size / 1024)} KB</small>
      <div class="row-actions">
        <button class="small-action" data-backup-preview="${row.id}" type="button">Preview</button>
        <button class="small-action" data-backup-restore="${row.id}" type="button">Herstel</button>
      </div>
    </div>
  `, "Nog geen backups.");
  renderList("backupHealthRows", backupHealth.rows || [], row => `
    <div class="data-row ${row.stale ? "kpi-open" : "kpi-ok"}">
      <strong>${row.stale ? "Aandacht" : "Klaar"} - ${row.tenantName || row.tenantId}</strong>
      <small>${row.latestBackupAt ? `Laatste backup ${row.latestBackupAt}, ${row.ageDays} dagen oud` : "Nog geen backup"} - ${row.count || 0} backup(s)</small>
    </div>
  `, "Nog geen backup-health geladen.");
  document.querySelectorAll("[data-backup-preview]").forEach(button => {
    button.addEventListener("click", () => previewBackup(button.dataset.backupPreview));
  });
  document.querySelectorAll("[data-backup-restore]").forEach(button => {
    button.addEventListener("click", () => restoreBackup(button.dataset.backupRestore));
  });

  renderTenants();
  renderApiKeys();
  renderSupportAccess();
  renderMfaStatus();
}

function renderReportPreview() {
  const preview = state.reportPreview;
  const target = el("reportPreview");
  if (!preview) {
    target.textContent = "Kies een readinessrapport om de inhoud te bekijken.";
    return;
  }
  target.textContent = `${preview.kind} - ${preview.title}\n${preview.updatedAt}\n\n${preview.content}`;
}

async function previewReport(reportId) {
  if (!token) return setAdminNotice("Login eerst met de demo admin.", false);
  try {
    const result = await api(`/api/tenants/${tenantId}/reports/${encodeURIComponent(reportId)}`);
    state.reportPreview = result.report;
    renderReportPreview();
    setAdminNotice(`Rapportpreview geladen: ${result.report.title}`);
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

async function generateReports() {
  if (!token) return setAdminNotice("Login eerst met de demo admin.", false);
  try {
    setAdminNotice("Readinessrapporten worden opnieuw gegenereerd...");
    const result = await api(`/api/tenants/${tenantId}/reports/generate`, {
      method: "POST",
      body: JSON.stringify({ strictProduction: true, minPilotScore: 80 })
    });
    state.reports = result.bundle.reports.rows || [];
    state.reportsSummary = result.bundle.reports.summary || null;
    state.reportPreview = result.bundle.manifest ? {
      kind: "Status bundle",
      title: "Nieuwste status bundle",
      updatedAt: result.bundle.manifest.generatedAt,
      content: JSON.stringify(result.bundle.manifest, null, 2)
    } : state.reportPreview;
    renderAdmin();
    setAdminNotice(`Readinessrapporten bijgewerkt: ${result.bundle.files.length} artifacts.`);
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

function renderMfaStatus() {
  const role = el("sessionState").dataset.role || "";
  const label = token ? `Ingelogd als ${el("sessionState").textContent}. MFA kan hier worden geactiveerd.` : "Login om MFA voor je account te beheren.";
  el("mfaStatus").textContent = role ? label : "Login om MFA voor je account te beheren.";
  el("mfaStatus").classList.toggle("bad", !token);
}

function renderSupportAccess() {
  const support = state.admin?.tenant?.supportAccess || {};
  const status = support.allowed ? "Supporttoegang is open." : "Supporttoegang is gesloten.";
  const detail = support.allowed
    ? `${support.reason || "Geen reden"} - tot ${support.expiresAt || "onbekend"} - door ${support.grantedBy || "onbekend"}`
    : support.endedAt ? `Gesloten op ${support.endedAt} door ${support.endedBy || "onbekend"}` : "Geen actieve toestemming.";
  el("supportAccessStatus").textContent = `${status} ${detail}`;
  el("supportAccessStatus").classList.toggle("bad", !support.allowed);
}

async function refreshAdmin() {
  if (!token) {
    setAdminNotice("Login met de demo admin om adminstatus te laden.", false);
    return;
  }
  const requests = [
    api(`/api/tenants/${tenantId}/admin/status`),
    api(`/api/tenants/${tenantId}/admin/backups`),
    api(`/api/tenants/${tenantId}/api-keys`),
    api(`/api/tenants/${tenantId}/api-keys/governance?strict=true`),
    api(`/api/tenants/${tenantId}/go-live`),
    api(`/api/tenants/${tenantId}/roadmap`),
    api(`/api/tenants/${tenantId}/reports`)
  ];
  if (isSuperAdmin()) requests.push(api("/api/admin/tenants"));
  const [status, backups, apiKeys, apiKeyGovernance, goLive, roadmap, reports, tenants] = await Promise.all(requests);
  state.admin = status.status;
  state.backups = backups.rows || [];
  state.apiKeys = apiKeys.rows || [];
  state.apiKeyGovernance = apiKeyGovernance.governance || null;
  state.goLive = goLive.readiness || {};
  state.roadmap = roadmap.roadmap || null;
  state.reports = reports.rows || [];
  state.reportsSummary = reports.summary || null;
  state.tenants = tenants?.rows || state.tenants;
  renderAdmin();
  updateHomeSuggestion();
  const config = state.admin?.config || {};
  setAdminNotice(config.envLoaded
    ? `Adminstatus is bijgewerkt. .env keys: ${(config.envKeys || []).join(", ") || "geen nieuwe keys"}.`
    : "Adminstatus is bijgewerkt.");
}

async function refreshAuditFilters(form) {
  if (!token) return setAdminNotice("Login eerst met de demo admin.", false);
  try {
    const data = formData(form);
    const params = new URLSearchParams({ tenantId, limit: data.limit || "50" });
    if (data.area) params.set("area", data.area);
    if (data.action) params.set("action", data.action);
    if (data.actor) params.set("actor", data.actor);
    const result = await api(`/api/audit?${params.toString()}`);
    state.auditRows = result.rows || [];
    state.auditSummary = result.summary || null;
    renderAdmin();
    setAdminNotice(`Auditfilter toegepast: ${auditFilterLabel()}.`);
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

function auditFilterParams(format = "") {
  const data = formData(el("auditFilterForm"));
  const params = new URLSearchParams({ tenantId, limit: data.limit || "50" });
  if (data.area) params.set("area", data.area);
  if (data.action) params.set("action", data.action);
  if (data.actor) params.set("actor", data.actor);
  if (data.since) params.set("since", localDateTimeToIso(data.since));
  if (format) params.set("format", format);
  return params;
}

function auditFilterLabel() {
  const data = formData(el("auditFilterForm"));
  const parts = [];
  if (data.area) parts.push(`area=${data.area}`);
  if (data.action) parts.push(`actie=${data.action}`);
  if (data.actor) parts.push(`actor=${data.actor}`);
  if (data.since) parts.push(`vanaf=${localDateTimeToIso(data.since)}`);
  parts.push(`limit=${data.limit || "50"}`);
  return parts.join(", ");
}

async function exportAuditCsv() {
  if (!token) return setAdminNotice("Login eerst met de demo admin.", false);
  try {
    const res = await fetch(`/api/audit?${auditFilterParams("csv").toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Audit CSV export mislukt.");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `workflowpro-audit-${todayValue()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setAdminNotice(`Audit CSV geexporteerd met filter: ${auditFilterLabel()}.`);
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

function resetAuditFilter() {
  const form = el("auditFilterForm");
  form.reset();
  state.auditRows = [];
  state.auditSummary = null;
  el("auditFilterNotice").textContent = "Toont standaard de laatste audit-events.";
  renderAdmin();
  setAdminNotice("Auditfilter gereset.");
}

function errorFilterParams(format = "") {
  const data = formData(el("errorFilterForm"));
  const params = new URLSearchParams({ tenantId, limit: data.limit || "50" });
  if (data.status) params.set("status", data.status);
  if (data.method) params.set("method", data.method);
  if (data.path) params.set("path", data.path);
  if (data.since) params.set("since", localDateTimeToIso(data.since));
  if (format) params.set("format", format);
  return params;
}

function errorFilterLabel() {
  const data = formData(el("errorFilterForm"));
  const parts = [];
  if (data.status) parts.push(`status=${data.status}`);
  if (data.method) parts.push(`methode=${data.method}`);
  if (data.path) parts.push(`pad=${data.path}`);
  if (data.since) parts.push(`vanaf=${localDateTimeToIso(data.since)}`);
  parts.push(`limit=${data.limit || "50"}`);
  return parts.join(", ");
}

async function refreshErrorFilters() {
  if (!token) return setAdminNotice("Login eerst met de demo admin.", false);
  try {
    const result = await api(`/api/errors?${errorFilterParams().toString()}`);
    state.errorRows = result.rows || [];
    state.errorSummary = result.summary || null;
    renderAdmin();
    setAdminNotice(`Foutfilter toegepast: ${errorFilterLabel()}.`);
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

async function exportErrorsCsv() {
  if (!token) return setAdminNotice("Login eerst met de demo admin.", false);
  try {
    const res = await fetch(`/api/errors?${errorFilterParams("csv").toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Fouten CSV export mislukt.");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `workflowpro-errors-${todayValue()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setAdminNotice(`Fouten CSV geexporteerd met filter: ${errorFilterLabel()}.`);
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

function resetErrorFilter() {
  const form = el("errorFilterForm");
  form.reset();
  state.errorRows = [];
  state.errorSummary = null;
  el("errorFilterNotice").textContent = "Toont standaard de laatste fout-events.";
  renderAdmin();
  setAdminNotice("Foutfilter gereset.");
}

async function unlockUser(userId) {
  if (!token) return setAdminNotice("Login eerst met de demo admin.", false);
  try {
    const result = await api(`/api/tenants/${tenantId}/admin/users/${userId}/unlock`, { method: "POST", body: "{}" });
    state.admin = result.status;
    renderAdmin();
    setAdminNotice(`Account gedeblokkeerd: ${result.user.email}`);
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

function scopeList(value) {
  return Array.from(new Set(String(value || "").split(",").map(scope => scope.trim()).filter(Boolean)));
}

function validateApiKeyScopes(scopes) {
  const invalid = scopes.filter(scope => !allowedApiKeyScopes.includes(scope));
  if (invalid.length) return `Onbekende scopes: ${invalid.join(", ")}.`;
  if (!scopes.some(scope => ["read", "write"].includes(scope))) return "Kies minstens read of write.";
  if (!scopes.some(scope => moduleApiKeyScopes.includes(scope))) return "Kies minstens een module-scope: planning, workorders, billing of integrations.";
  return "";
}

function renderApiKeys() {
  renderList("apiKeyRows", state.apiKeys, row => `
    <div class="data-row ${row.expired || apiKeyScopeWarning(row) ? "kpi-open" : ""}">
      <strong>${row.label}</strong>
      <small>${row.prefix}... - ${row.status} - scopes: ${(row.scopes || []).join(", ")} - gemaakt door ${row.createdBy}</small>
      <small>${apiKeyScopeWarning(row) || "Scopecombinatie klaar voor externe connecties."}</small>
      <small>Vervalt: ${shortDateTime(row.expiresAt)}${row.expired ? " - verlopen" : ""}</small>
      <small>Gebruik: ${row.usageCount || 0}x - laatst ${shortDateTime(row.lastUsedAt)}${row.lastUsedPath ? ` - ${row.lastUsedMethod || "GET"} ${row.lastUsedPath}` : ""}</small>
      <small>Geweigerd: ${row.deniedCount || 0}x${row.lastDeniedPath ? ` - ${row.lastDeniedReason || "denied"} - ${row.lastDeniedMethod || "GET"} ${row.lastDeniedPath}` : ""}</small>
      <div class="row-actions">
        ${row.status === "revoked" ? "" : `
          <button class="small-action" data-rotate-api-key="${row.id}" type="button">Roteer</button>
          <button class="small-action" data-revoke-api-key="${row.id}" type="button">Intrekken</button>
        `}
      </div>
    </div>
  `, "Nog geen API keys.");
  document.querySelectorAll("[data-rotate-api-key]").forEach(button => {
    button.addEventListener("click", () => rotateApiKey(button.dataset.rotateApiKey));
  });
  document.querySelectorAll("[data-revoke-api-key]").forEach(button => {
    button.addEventListener("click", () => revokeApiKey(button.dataset.revokeApiKey));
  });
}

function apiKeyScopeWarning(row) {
  const scopes = row.scopes || [];
  if (!scopes.includes("read")) return "Mist read-scope voor GET requests.";
  if (!scopes.some(scope => moduleApiKeyScopes.includes(scope))) return "Mist concrete module-scope.";
  return "";
}

async function refreshApiKeys() {
  if (!token) return setAdminNotice("Login eerst met de demo admin.", false);
  try {
    const [result, governance] = await Promise.all([
      api(`/api/tenants/${tenantId}/api-keys`),
      api(`/api/tenants/${tenantId}/api-keys/governance?strict=true`)
    ]);
    state.apiKeys = result.rows || [];
    state.apiKeyGovernance = governance.governance || null;
    renderApiKeys();
    renderAdmin();
    setAdminNotice("API keys zijn bijgewerkt.");
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

async function runApiKeyGovernance() {
  if (!token) return setAdminNotice("Login eerst met de demo admin.", false);
  try {
    const result = await api(`/api/tenants/${tenantId}/api-keys/governance/run`, { method: "POST", body: "{}" });
    state.apiKeyGovernance = result.governance;
    await refreshAdmin();
    setAdminNotice(`API-key governance gelogd: ${result.governance.blockers} blockers, ${result.governance.warnings} warnings.`);
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

async function createApiKey(form) {
  if (!token) return setAdminNotice("Login eerst met de demo admin.", false);
  try {
    const data = formData(form);
    const scopes = scopeList(data.scopes);
    const scopeError = validateApiKeyScopes(scopes);
    if (scopeError) return setAdminNotice(scopeError, false);
    const result = await api(`/api/tenants/${tenantId}/api-keys`, {
      method: "POST",
      body: JSON.stringify({ label: data.label, scopes, expiresAt: data.expiresAt || futureDateValue(90) })
    });
    el("apiKeyToken").innerHTML = `<strong>${result.result.token}</strong><small>Bewaar deze token nu. Later tonen we enkel de prefix.</small>`;
    setAdminNotice("API key aangemaakt.");
    await refreshAdmin();
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

async function revokeApiKey(keyId) {
  try {
    await api(`/api/tenants/${tenantId}/api-keys/${keyId}/revoke`, { method: "POST", body: "{}" });
    setAdminNotice("API key ingetrokken.");
    await refreshAdmin();
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

async function rotateApiKey(keyId) {
  try {
    const current = state.apiKeys.find(row => row.id === keyId);
    const suggestedScopes = apiKeyScopeWarning(current || {})
      ? "read,planning"
      : (current?.scopes || ["read", "planning"]).join(",");
    const scopeText = window.prompt("Nieuwe scopes voor geroteerde key", suggestedScopes);
    if (!scopeText) return;
    const scopes = scopeList(scopeText);
    const scopeError = validateApiKeyScopes(scopes);
    if (scopeError) return setAdminNotice(scopeError, false);
    const result = await api(`/api/tenants/${tenantId}/api-keys/${keyId}/rotate`, {
      method: "POST",
      body: JSON.stringify({ scopes })
    });
    el("apiKeyToken").innerHTML = `<strong>${result.result.token}</strong><small>Nieuwe geroteerde token. De oude key is ingetrokken.</small>`;
    setAdminNotice(`API key geroteerd met scopes: ${result.result.rotatedTo.scopes.join(", ")}.`);
    await refreshAdmin();
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

function renderTenants() {
  if (!isSuperAdmin()) {
    el("tenantRows").innerHTML = `<div class="empty">Login als super admin om tenants te beheren.</div>`;
    return;
  }
  renderList("tenantRows", state.tenants, tenant => `
    <div class="data-row">
      <strong>${tenant.name}</strong>
      <small>${tenant.id} - ${tenant.plan} - ${tenant.status} - ${tenant.billingEmail || "geen billing e-mail"} - ${tenant.counts?.users || 0} gebruikers</small>
      <div class="row-actions">
        <button class="small-action" data-tenant-status="${tenant.id}" data-status="active" type="button">Activeer</button>
        <button class="small-action" data-tenant-status="${tenant.id}" data-status="paused" type="button">Pauzeer</button>
      </div>
    </div>
  `, "Nog geen tenants.");
  document.querySelectorAll("[data-tenant-status]").forEach(button => {
    button.addEventListener("click", () => updateTenantStatus(button.dataset.tenantStatus, button.dataset.status));
  });
}

async function refreshTenants() {
  if (!token || !isSuperAdmin()) {
    setAdminNotice("Login als super admin om tenants te beheren.", false);
    renderTenants();
    return;
  }
  try {
    const result = await api("/api/admin/tenants");
    state.tenants = result.rows || [];
    renderTenants();
    setAdminNotice("Tenantlijst is bijgewerkt.");
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

async function createTenant(form) {
  if (!token || !isSuperAdmin()) {
    setAdminNotice("Login als super admin om tenants aan te maken.", false);
    return;
  }
  try {
    const result = await api("/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify(formData(form))
    });
    form.reset();
    setAdminNotice(`Tenant aangemaakt: ${result.tenant.name}`);
    await refreshTenants();
    await refresh();
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

async function updateTenantStatus(id, status) {
  try {
    await api(`/api/admin/tenants/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    setAdminNotice(`Tenantstatus bijgewerkt naar ${status}.`);
    await refreshTenants();
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

async function createBackup() {
  if (!token) return setAdminNotice("Login eerst met de demo admin.", false);
  try {
    const result = await api(`/api/tenants/${tenantId}/admin/backups`, { method: "POST", body: "{}" });
    setAdminNotice(`Backup aangemaakt: ${result.backup.name}`);
    await refreshAdmin();
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

function formatCounts(counts) {
  return Object.entries(counts || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ") || "geen tenantdata";
}

async function previewBackup(backupId) {
  try {
    const result = await api(`/api/tenants/${tenantId}/admin/backups/${backupId}/preview`);
    el("backupPreview").innerHTML = `
      <strong>Backup ${result.preview.id}</strong>
      <small>Nu: ${formatCounts(result.preview.currentCounts)}</small>
      <small>Backup: ${formatCounts(result.preview.backupCounts)}</small>
      <small>Integriteit: ${result.preview.integrity.checksumValid === true ? "geverifieerd" : result.preview.integrity.checksumPresent ? "ongeldig" : "legacy zonder checksum"}</small>
    `;
    el("backupPreview").classList.remove("bad");
  } catch (error) {
    el("backupPreview").textContent = error.message;
    el("backupPreview").classList.add("bad");
  }
}

async function restoreBackup(backupId) {
  try {
    await previewBackup(backupId);
    const confirmed = window.confirm("Herstel deze tenant vanuit de gekozen backup? Dit overschrijft tenantdata.");
    if (!confirmed) return;
    const result = await api(`/api/tenants/${tenantId}/admin/backups/${backupId}/restore`, {
      method: "POST",
      body: JSON.stringify({ confirm: "RESTORE" })
    });
    setAdminNotice(`Backup hersteld: ${result.result.backup.id}`);
    await refreshAdmin();
    await refresh();
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

function localDateTimeToIso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

async function openSupportAccess(form) {
  if (!token) return setAdminNotice("Login eerst met de demo admin.", false);
  try {
    const data = formData(form);
    await api(`/api/tenants/${tenantId}/support-access`, {
      method: "POST",
      body: JSON.stringify({ allowed: true, reason: data.reason })
    });
    setAdminNotice("Supporttoegang is geopend en gelogd.");
    await refreshAdmin();
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

async function endSupportAccess() {
  if (!token) return setAdminNotice("Login eerst met de demo admin.", false);
  try {
    await api(`/api/tenants/${tenantId}/support-access/end`, { method: "POST", body: "{}" });
    setAdminNotice("Supporttoegang is gesloten en gelogd.");
    await refreshAdmin();
  } catch (error) {
    setAdminNotice(error.message, false);
  }
}

async function startMfaSetup() {
  if (!token) return setAdminNotice("Login eerst met de demo admin.", false);
  try {
    const result = await api("/api/me/mfa/setup", { method: "POST", body: "{}" });
    el("mfaStatus").innerHTML = `
      <strong>MFA setup gestart</strong>
      <small>Secret: ${result.setup.secret}</small>
      <small>Scan de secret in je authenticator en vul de actuele code hieronder in.</small>
    `;
    el("mfaStatus").classList.remove("bad");
    setAdminNotice("MFA setup gestart. Bevestig met de code.");
  } catch (error) {
    el("mfaStatus").textContent = error.message;
    el("mfaStatus").classList.add("bad");
  }
}

async function verifyMfaSetup(form) {
  if (!token) return setAdminNotice("Login eerst met de demo admin.", false);
  try {
    const result = await api("/api/me/mfa/verify", {
      method: "POST",
      body: JSON.stringify(formData(form))
    });
    form.reset();
    el("mfaStatus").innerHTML = `
      <strong>MFA is actief</strong>
      <small>Recovery codes, eenmalig bewaren:</small>
      <small>${(result.recoveryCodes || []).join(" ")}</small>
    `;
    el("mfaStatus").classList.remove("bad");
    setAdminNotice("MFA is geactiveerd en audit gelogd.");
    await refreshAdmin();
  } catch (error) {
    el("mfaStatus").textContent = error.message;
    el("mfaStatus").classList.add("bad");
  }
}

function renderPortal() {
  const portal = state.portal;
  if (!portal) {
    setText("portalTenantName", "Klantportaal");
    setText("portalIntro", "Login om klantstatus, onboarding, hulp en release notes te laden.");
    el("portalCards").innerHTML = "";
    el("portalSteps").innerHTML = `<div class="empty">Nog geen portaldata.</div>`;
    el("helpRows").innerHTML = `<div class="empty">Nog geen helpartikels geladen.</div>`;
    el("releaseRows").innerHTML = `<div class="empty">Nog geen release notes geladen.</div>`;
    return;
  }

  setText("portalTenantName", portal.tenant.name);
  setText("portalIntro", `${portal.tenant.plan} - ${portal.tenant.status} - ${portal.tenant.billingEmail || "geen billing e-mail"}`);
  setText("portalOnboardingScore", `${portal.onboarding.percent}%`);

  const cards = [
    ["App", portal.status.app],
    ["API", portal.status.api],
    ["PWA", portal.status.pwa],
    ["Release", portal.status.release?.version || "-"],
    ["Support", portal.status.supportAccess?.allowed ? "Open" : "Gesloten"],
    ["Billing", portal.billing.status || "trial"],
    ["Facturen", portal.billing.invoices || 0],
    ["DPA", portal.billing.dpaAccepted ? "Klaar" : "Open"],
    ["Fouten", portal.status.errors || 0]
  ];
  el("portalCards").innerHTML = cards.map(([label, value]) => `
    <article class="metric">
      <span class="metric-label">${label}</span>
      <strong>${value}</strong>
      <small>${portal.tenant.name}</small>
    </article>
  `).join("");

  const pilot = state.pilot || {};
  const openPilotKpis = (pilot.kpis || []).filter(kpi => !kpi.ok);
  const onboardingOpen = (portal.onboarding.steps || []).filter(step => !step.done);
  const pilotReady = (pilot.score || 0) >= 80 && portal.onboarding.percent >= 70;
  const portalAction = openPilotKpis[0]?.action || onboardingOpen[0]?.label || "Genereer beslissersrapport voor go/no-go.";
  el("portalFocus").innerHTML = `
    <article class="portal-focus-card primary">
      <p class="eyebrow">Pilot readiness</p>
      <h2>${pilotReady ? "Pilot kan richting go/no-go" : "Pilot heeft nog actie nodig"}</h2>
      <p>${escapeHtml(pilotReady ? "De belangrijkste onboarding- en pilotindicatoren zijn klaar om met de beslisser te bespreken." : portalAction)}</p>
      <button id="portalDecisionAction" type="button">${pilotReady ? "Rapport genereren" : "Volgende actie opvolgen"}</button>
    </article>
    <article class="portal-focus-card">
      <span>Onboarding</span>
      <strong>${portal.onboarding.percent}%</strong>
      <small>${onboardingOpen.length} open stappen</small>
    </article>
    <article class="portal-focus-card">
      <span>Pilot KPI</span>
      <strong>${pilot.score || 0}%</strong>
      <small>${openPilotKpis.length} open KPI's</small>
    </article>
  `;
  const portalDecisionAction = el("portalDecisionAction");
  if (portalDecisionAction) portalDecisionAction.addEventListener("click", () => {
    if (pilotReady) generateDecisionReport();
    else setView("notifications");
  });

  el("portalSteps").innerHTML = (portal.onboarding.steps || []).map(step => `
    <div class="step ${step.done ? "done" : ""}">
      <span class="step-mark">${step.done ? "OK" : "-"}</span>
      <div>
        <strong>${step.label}</strong>
        <small>${step.done ? "Klaar" : "Nog open"} - ${step.type === "manual" ? "handmatig" : "automatisch"}</small>
        ${step.type === "manual" ? `
          <div class="row-actions">
            <button class="small-action" data-onboarding-step="${step.key}" data-onboarding-done="${step.done ? "false" : "true"}" type="button">
              ${step.done ? "Heropenen" : "Afronden"}
            </button>
          </div>
        ` : ""}
      </div>
    </div>
  `).join("");
  document.querySelectorAll("[data-onboarding-step]").forEach(button => {
    button.addEventListener("click", () => updateOnboardingStep(button.dataset.onboardingStep, button.dataset.onboardingDone === "true"));
  });

  renderList("helpRows", portal.helpArticles || [], article => `
    <div class="data-row">
      <strong>${article.title}</strong>
      <small>${article.category} - ${article.summary}</small>
    </div>
  `, "Nog geen helpartikels.");

  renderList("releaseRows", portal.releaseNotes || [], note => `
    <div class="release-row">
      <div>
        <strong>${note.version} - ${note.title}</strong>
        <small>${note.date}</small>
      </div>
      <ul>${(note.changes || []).map(change => `<li>${change}</li>`).join("")}</ul>
    </div>
  `, "Nog geen release notes.");

  renderPilot();
}

async function refreshPortal() {
  if (!token) {
    renderPortal();
    return;
  }
  try {
    const result = await api(`/api/tenants/${tenantId}/portal`);
    state.portal = result.portal;
    await refreshPilot(false);
    renderPortal();
  } catch (error) {
    setText("portalIntro", error.message);
  }
}

function renderPilot() {
  const pilot = state.pilot || {};
  setText("pilotScore", `${pilot.score || 0}%`);
  el("pilotKpiRows").innerHTML = (pilot.kpis || []).map(kpi => `
    <div class="module ${kpi.ok ? "kpi-ok" : "kpi-open"}">
      <strong>${kpi.label}</strong>
      <small>${kpi.value} / ${kpi.target}</small>
      <small>${kpi.ok ? "Volgende stap" : "Actie nodig"}: ${kpi.action || "Bespreek in de weekly success review."}</small>
    </div>
  `).join("") || `<div class="empty">Nog geen pilot KPI's geladen.</div>`;
}

async function refreshPilot(render = true) {
  if (!token) return;
  const result = await api(`/api/tenants/${tenantId}/pilot/kpis`);
  state.pilot = result.pilot;
  if (render) renderPilot();
}

function renderDecisionReport(report) {
  if (!report) return;
  const actions = report.goNoGo?.actions || [];
  el("decisionReportPreview").innerHTML = `
    <strong>${report.tenant.name} - ${report.generatedAt}</strong>
    <small>Operations: ${report.operations.totals.planningItems} planningen, ${report.operations.totals.workordersCompleted} werkbonnen klaar</small>
    <small>Billing: ${report.billing.enterpriseCustom ? "maatwerk" : `EUR ${Number(report.billing.annualTotal || 0).toFixed(2)}`} - Pilot score ${report.pilot.score}%</small>
    <small>Go/no-go: ${report.goNoGo?.decision || "open"} - ${report.goNoGo?.headline || ""}</small>
    ${actions.length ? `<ul class="compact-list">${actions.map(action => `<li><strong>${action.label}</strong>: ${action.action}</li>`).join("")}</ul>` : ""}
  `;
  el("decisionReportPreview").classList.remove("bad");
}

async function generateDecisionReport() {
  if (!token) return;
  try {
    const result = await api(`/api/tenants/${tenantId}/pilot/decision-report`, { method: "POST", body: "{}" });
    state.decisionReport = result.report;
    renderDecisionReport(result.report);
    await refreshPilot(true);
  } catch (error) {
    el("decisionReportPreview").textContent = error.message;
    el("decisionReportPreview").classList.add("bad");
  }
}

async function updateOnboardingStep(stepKey, done) {
  if (!token) return;
  try {
    const result = await api(`/api/tenants/${tenantId}/portal/onboarding/${stepKey}`, {
      method: "PATCH",
      body: JSON.stringify({ done })
    });
    state.portal = result.portal;
    renderPortal();
  } catch (error) {
    setText("portalIntro", error.message);
  }
}

function renderSales() {
  const summary = state.salesSummary || {};
  const launch = state.salesLaunch || {};
  const actuals = summary.actuals || {};
  const targets = summary.targets || {};
  const cards = [
    ["Launch score", `${launch.score || 0}%`, launch.ok ? "Klaar" : `${launch.openChecks?.length || 0} open`],
    ["Qualified leads", `${actuals.qualifiedLeads || 0}/${targets.qualifiedLeads || 20}`, `${summary.activation?.leadProgress || 0}%`],
    ["Demo calls", `${actuals.demoCalls || 0}/${targets.demoCalls || 10}`, `${summary.activation?.demoProgress || 0}%`],
    ["Betalende klanten", `${actuals.payingCustomers || 0}/${targets.payingCustomers || 3}`, `${summary.activation?.paidProgress || 0}%`],
    ["Geschatte seats", actuals.estimatedSeats || 0, "Pipeline volume"],
    ["Partners", actuals.activePartners || 0, `${actuals.partnerLeads || 0} partnerleads`]
  ];
  el("salesCards").innerHTML = cards.map(([label, value, detail]) => `
    <article class="metric">
      <span class="metric-label">${label}</span>
      <strong>${value}</strong>
      <small>${detail}</small>
    </article>
  `).join("");

  const activeLeads = state.sales.filter(lead => !["paying_customer", "lost"].includes(lead.stage));
  const nextLead = activeLeads.slice().sort((a, b) => String(a.nextActionAt || "9999-12-31").localeCompare(String(b.nextActionAt || "9999-12-31")))[0];
  const openChecks = launch.openChecks || (launch.checks || []).filter(check => !check.ok);
  el("salesFocus").innerHTML = `
    <article class="sales-focus-card primary">
      <p class="eyebrow">Commercial launch</p>
      <h2>${launch.ok ? "Klaar voor gecontroleerde verkoop" : `${openChecks.length} launch checks open`}</h2>
      <p>${escapeHtml(nextLead ? `Volg ${nextLead.company} op voor ${nextLead.nextActionAt || "de volgende actie"}.` : openChecks[0]?.action || "Voeg qualified leads en demo calls toe om launchvalidatie op te bouwen.")}</p>
      <button id="salesFocusAction" type="button">${nextLead ? "Lead opvolgen" : "Launch checks bekijken"}</button>
    </article>
    <article class="sales-focus-card">
      <span>Actieve leads</span>
      <strong>${activeLeads.length}</strong>
      <small>${actuals.qualifiedLeads || 0} qualified</small>
    </article>
    <article class="sales-focus-card">
      <span>Demo calls</span>
      <strong>${actuals.demoCalls || 0}</strong>
      <small>target ${targets.demoCalls || 10}</small>
    </article>
    <article class="sales-focus-card">
      <span>Trial-to-paid</span>
      <strong>${summary.activation?.paidProgress || 0}%</strong>
      <small>${actuals.payingCustomers || 0}/${targets.payingCustomers || 3} klanten</small>
    </article>
  `;
  const salesFocusAction = el("salesFocusAction");
  if (salesFocusAction) salesFocusAction.addEventListener("click", () => {
    document.getElementById("salesRows")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  renderList("salesLaunchRows", launch.checks || [], check => `
    <div class="data-row ${check.ok ? "kpi-ok" : "kpi-open"}">
      <strong>${check.label}</strong>
      <small>${check.value}${check.unit || ""} / ${check.target}${check.unit || ""}</small>
      <small>${check.ok ? "Klaar" : "Actie"}: ${check.action}</small>
    </div>
  `, "Login om commercial launch readiness te laden.");

  renderList("salesRows", state.sales, lead => `
    <div class="data-row">
      <strong>${lead.company}</strong>
      <small>${lead.contactEmail} - ${lead.sector || "sector open"} - ${salesStageLabels[lead.stage] || lead.stage || "Qualified lead"}</small>
      <small>Kanaal: ${partnerName(lead.partnerId) || lead.source || "direct"}</small>
      <small>${Number(lead.seats || 0)} seats - volgende actie: ${lead.nextActionAt || "nog te plannen"}</small>
      <div class="row-actions">
        ${lead.stage === "paying_customer" || lead.stage === "lost" ? "" : `<button class="small-action" data-advance-lead="${lead.id}" type="button">Volgende fase</button>`}
      </div>
    </div>
  `, "Nog geen salesleads.");

  document.querySelectorAll("[data-advance-lead]").forEach(button => {
    button.addEventListener("click", () => advanceSalesLead(button.dataset.advanceLead));
  });

  el("salesPartnerSelect").innerHTML = `
    <option value="">Direct kanaal</option>
    ${state.partners.filter(partner => partner.status !== "paused").map(partner => `<option value="${partner.id}">${partner.name}</option>`).join("")}
  `;

  renderList("partnerRows", state.partners, partner => {
    const stats = (summary.byPartner || []).find(row => row.id === partner.id) || {};
    const latestNote = (partner.notes || []).slice(-1)[0];
    return `
      <div class="data-row">
        <strong>${partner.name}</strong>
        <small>${partner.type} - ${partner.region || "regio open"} - ${partner.status || "active"}</small>
        <small>${stats.leads || 0} leads - ${stats.demoCalls || 0} demo's - ${stats.payingCustomers || 0} klanten</small>
        <small>Volgende actie: ${partner.nextActionAt || "nog te plannen"}</small>
        ${latestNote ? `<small>Laatste notitie: ${latestNote.text}</small>` : ""}
        <div class="row-actions">
          <button class="small-action" data-partner-status="${partner.id}" data-status="${partner.status === "paused" ? "active" : "paused"}" type="button">
            ${partner.status === "paused" ? "Activeren" : "Pauzeren"}
          </button>
          <button class="small-action" data-partner-note="${partner.id}" type="button">Notitie</button>
        </div>
      </div>
    `;
  }, "Nog geen partners.");
  document.querySelectorAll("[data-partner-status]").forEach(button => {
    button.addEventListener("click", () => updatePartnerStatus(button.dataset.partnerStatus, button.dataset.status));
  });
  document.querySelectorAll("[data-partner-note]").forEach(button => {
    button.addEventListener("click", () => addPartnerNote(button.dataset.partnerNote));
  });
}

function partnerName(partnerId) {
  if (!partnerId) return "";
  return state.partners.find(partner => partner.id === partnerId)?.name || "";
}

async function refreshSales() {
  if (!token) {
    el("salesRows").innerHTML = `<div class="empty">Login om de sales pipeline te laden.</div>`;
    return;
  }
  try {
    const [rowsResult, partnersResult, summaryResult, readinessResult] = await Promise.all([
      listModuleRows("sales"),
      listModuleRows("partners"),
      api(`/api/tenants/${tenantId}/sales/summary`),
      api(`/api/tenants/${tenantId}/sales/readiness`)
    ]);
    state.sales = rowsResult;
    state.partners = partnersResult;
    state.salesSummary = summaryResult.summary || {};
    state.salesLaunch = readinessResult.readiness || {};
    renderSales();
  } catch (error) {
    setText("salesIntro", error.message);
  }
}

async function createSalesLead(form) {
  if (!token) return;
  try {
    const data = formData(form);
    if (!data.partnerId) delete data.partnerId;
    await createModuleRow("sales", { ...data, stage: "qualified_lead", source: data.partnerId ? "partner" : "demo_booking" });
    form.reset();
    form.elements.seats.value = 12;
    await refreshSales();
  } catch (error) {
    setText("salesIntro", error.message);
  }
}

async function createPartner(form) {
  if (!token) return;
  try {
    await createModuleRow("partners", formData(form));
    form.reset();
    await refreshSales();
  } catch (error) {
    setText("salesIntro", error.message);
  }
}

async function updatePartnerStatus(partnerId, status) {
  if (!token) return;
  try {
    await updateModuleRow("partners", partnerId, { status });
    await refreshSales();
  } catch (error) {
    setText("salesIntro", error.message);
  }
}

async function addPartnerNote(partnerId) {
  if (!token) return;
  const note = window.prompt("Partnernotitie");
  if (!note) return;
  try {
    const result = await api(`/api/tenants/${tenantId}/partners/${partnerId}/notes`, {
      method: "POST",
      body: JSON.stringify({ note })
    });
    state.partners = state.partners.map(partner => (partner.id === partnerId ? result.row : partner));
    state.salesSummary = result.summary;
    state.salesLaunch = result.readiness || state.salesLaunch;
    renderSales();
  } catch (error) {
    setText("salesIntro", error.message);
  }
}

async function advanceSalesLead(leadId) {
  if (!token) return;
  try {
    const result = await api(`/api/tenants/${tenantId}/sales/${leadId}/advance`, { method: "POST", body: "{}" });
    state.sales = state.sales.map(lead => (lead.id === leadId ? result.row : lead));
    state.salesSummary = result.summary;
    state.salesLaunch = result.readiness || state.salesLaunch;
    renderSales();
  } catch (error) {
    setText("salesIntro", error.message);
  }
}

async function syncQueue() {
  await window.WorkFlowProMobile.syncQueue();
}

async function refreshJson() {
  try {
    showJson("jsonHealth", await api("/api/health"));
    if (!token) {
      setText("jsonModules", "Login om modules te laden.");
      setText("jsonGolden", "Login om readiness te laden.");
      setText("jsonToday", "Login om vandaag-flow te laden.");
      return;
    }
    const [modules, golden, today] = await Promise.all([
      api("/api/modules"),
      api(`/api/tenants/${tenantId}/golden-path`),
      api(`/api/tenants/${tenantId}/mobile/today`)
    ]);
    showJson("jsonModules", modules);
    showJson("jsonGolden", golden);
    showJson("jsonToday", today);
  } catch (error) {
    setText("jsonHealth", error.message);
  }
}

async function submitModule(form, key, mapper) {
  if (!token) {
    setNotice("Login eerst met de demo admin.", false);
    showToast("Login eerst met de demo admin.", false);
    return;
  }
  try {
    const payload = mapper(formData(form));
    await createModuleRow(key, payload);
    form.reset();
    if (form.id === "planningForm") {
      form.elements.date.value = todayValue();
      form.elements.start.value = "08:00";
      form.elements.end.value = "16:30";
    }
    setNotice("Opgeslagen.");
    await refreshOps();
    await refresh();
  } catch (error) {
    setNotice(error.message, false);
  }
}

async function downloadExport(key) {
  if (!token) {
    setNotice("Login eerst met de demo admin.", false);
    return;
  }
  const res = await fetch(`/api/exports/${key}.csv?tenantId=${tenantId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    setNotice("CSV export mislukt.", false);
    showToast("CSV export mislukt.", false);
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${key}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setNotice("CSV export is aangemaakt.");
  showToast("CSV export is aangemaakt.");
}

function visibleNavigationTarget(label) {
  const key = String(label || "").trim().toLowerCase();
  return {
    werkruimte: "start",
    actiecentrum: "notifications",
    planning: "planning",
    werkbonnen: "workorders",
    tijd: "ops",
    onkosten: "billing",
    stock: "stock",
    wagenpark: "assets",
    verlof: "verlof",
    integraties: "integrations",
    instellingen: "admin",
    rapportage: "reports"
  }[key] || "";
}

async function ensureOpsData() {
  if (!state.users.length || !state.venues.length) await refreshOps();
}

async function quickCreateShift() {
  if (!token) {
    showToast("Login eerst om een shift aan te maken.", false);
    el("login").click();
    return;
  }
  try {
    await ensureOpsData();
    const user = state.users.find(row => row.role !== "tenant_admin") || state.users[0];
    const venue = state.venues[0];
    if (!user || !venue) {
      setView("admin");
      showToast("Maak eerst minstens een medewerker en werf aan in klantsetup.", false);
      return;
    }
    await createModuleRow("planning", {
      userId: user.id,
      venueId: venue.id,
      date: todayValue(),
      start: "08:00",
      end: "16:30",
      project: "Nieuwe opdracht",
      billable: true
    });
    await refreshOps();
    await refreshCustomerStart();
    setView("planning");
    showToast("Nieuwe shift aangemaakt.");
  } catch (error) {
    showToast(error.message, false);
  }
}

async function quickCreateWorkorder() {
  if (!token) {
    showToast("Login eerst om een werkbon aan te maken.", false);
    el("login").click();
    return;
  }
  try {
    await ensureOpsData();
    const user = state.users.find(row => row.role !== "tenant_admin") || state.users[0];
    const venue = state.venues[0];
    if (!user || !venue) {
      setView("admin");
      showToast("Maak eerst minstens een medewerker en werf aan in klantsetup.", false);
      return;
    }
    await createModuleRow("workorders", {
      title: "Nieuwe werkbon",
      userId: user.id,
      venueId: venue.id,
      status: "Te starten",
      checklist: [
        { label: "Werf controleren", done: false },
        { label: "Foto of handtekening toevoegen", done: false }
      ]
    });
    await refreshOps();
    await refreshCustomerStart();
    setView("workorders");
    showToast("Nieuwe werkbon aangemaakt.");
  } catch (error) {
    showToast(error.message, false);
  }
}

function handlePassiveProductButton(button) {
  if (button.dataset.jumpView || button.dataset.startView || button.id || button.type === "submit") return false;
  const label = button.textContent.trim();
  if (button.classList.contains("environment-chip")) {
    showToast("Je werkt in de live demo-omgeving. Alle data blijft tenant-scoped.");
    return true;
  }
  if (button.getAttribute("aria-label") === "Help") {
    setView("notifications");
    showToast("Helpvragen en acties worden via het Actiecentrum opgevolgd.");
    return true;
  }
  const sideNav = button.closest(".side-nav");
  if (sideNav) {
    const view = visibleNavigationTarget(label);
    if (!view) return false;
    setView(view);
    if (["Stock", "Rapportage", "Wagenpark"].includes(label)) {
      showToast(`${label} wordt nu via het operationele overzicht opgevolgd.`);
    }
    return true;
  }

  if (button.closest(".commandbar") && button.classList.contains("icon-button")) {
    setView("notifications");
    showToast("Actiecentrum geopend.");
    return true;
  }

  if (button.closest(".view-switch")) {
    button.parentElement.querySelectorAll("button").forEach(row => row.classList.toggle("active", row === button));
    showToast(`${label} weergave actief.`);
    return true;
  }

  if (button.closest(".action-row")) {
    if (label === "Nieuwe shift") {
      quickCreateShift();
      return true;
    }
    if (label === "Nieuwe werkbon") {
      quickCreateWorkorder();
      return true;
    }
    if (label === "Importeer") {
      setView("admin");
      showToast("Import en klantsetup staan onder Instellingen.");
      return true;
    }
    if (label === "Filters") {
      showToast("Gebruik de zoekbalk bovenaan om deze lijst direct te filteren.");
      return true;
    }
  }
  return false;
}

function renderImportResult(result) {
  const lines = [
    `${result.created?.length || 0} aangemaakt`,
    `${result.updated?.length || 0} bijgewerkt`,
    `${result.skipped?.length || 0} overgeslagen`
  ];
  el("importResult").innerHTML = `
    <strong>${lines.join(" - ")}</strong>
    ${(result.skipped || []).length ? `<small>${result.skipped.map(row => `lijn ${row.line}: ${row.reason}`).join(" | ")}</small>` : "<small>Import klaar voor gebruik in planning en werkbonnen.</small>"}
  `;
}

async function importEmployees(form) {
  if (!token) {
    setNotice("Login eerst met de demo admin.", false);
    return;
  }
  try {
    const data = formData(form);
    const result = await api(`/api/tenants/${tenantId}/imports/employees`, {
      method: "POST",
      body: JSON.stringify({ csv: data.csv, defaultPassword: data.defaultPassword })
    });
    renderImportResult(result.result || {});
    setNotice("Medewerkersimport is verwerkt.");
    await refreshOps();
    await refresh();
  } catch (error) {
    setNotice(error.message, false);
  }
}

async function applyKboFromForm(form) {
  if (!token) {
    setNotice("Login eerst met de demo admin.", false);
    return;
  }
  try {
    await api(`/api/tenants/${tenantId}/kbo/apply`, {
      method: "POST",
      body: JSON.stringify(formData(form))
    });
    setNotice("KBO gegevens toegepast op de tenant.");
    await refresh();
    await refreshOps();
  } catch (error) {
    setNotice(error.message, false);
  }
}

async function clock(action) {
  if (!token) {
    setNotice("Login eerst met de demo admin.", false);
    return;
  }
  try {
    const data = formData(el("clockForm"));
    await api(`/api/tenants/${tenantId}/clock/${action}`, {
      method: "POST",
      body: JSON.stringify(data)
    });
    setNotice(action === "in" ? "Tijdregistratie gestart." : "Tijdregistratie gestopt.");
    await refresh();
    await refreshOps();
  } catch (error) {
    setNotice(error.message, false);
  }
}

async function approveExpense(expenseId) {
  try {
    await api(`/api/tenants/${tenantId}/expenses/${expenseId}/approve`, { method: "POST", body: "{}" });
    setNotice("Onkost goedgekeurd.");
    await refreshOps();
  } catch (error) {
    setNotice(error.message, false);
  }
}

async function savePermissions(form) {
  if (!token) {
    setNotice("Login eerst met de demo admin.", false);
    return;
  }
  const data = formData(form);
  if (!data.userId) {
    setNotice("Kies eerst een medewerker.", false);
    return;
  }
  const permissions = Array.from(form.querySelectorAll('input[name="permissions"]:checked')).map(input => input.value);
  try {
    await updateModuleRow("users", data.userId, { role: data.role, permissions });
    setNotice("Rollen en rechten zijn opgeslagen.");
    await refreshOps();
    await refresh();
  } catch (error) {
    setNotice(error.message, false);
  }
}

async function createSetupIntent() {
  await window.WorkFlowProBilling.createSetupIntent();
}

async function submitBilling(form, endpoint, successMessage) {
  await window.WorkFlowProBilling.submit(form, endpoint, successMessage);
}

async function transitionContract(form) {
  await window.WorkFlowProBilling.transitionContract(form);
}

async function loginAs(email, password, intro) {
  el("loginNotice").textContent = "Inloggen...";
  el("loginNotice").classList.remove("bad");
  const payload = { email, password };
  if (pendingMfaLogin?.email === email && pendingMfaLogin.code) payload.mfaCode = pendingMfaLogin.code;
  const result = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  if (result.mfaRequired) {
    setText("sessionState", "MFA vereist");
    el("sessionState").classList.add("muted");
    const code = window.prompt("MFA code");
    if (!code) return;
    pendingMfaLogin = { email, password, intro, code };
    return loginAs(email, password, intro);
  }
  pendingMfaLogin = null;
  token = result.token || "";
  localStorage.setItem("wfp_token", token);
  window._wfpCurrentUser = result.user || null;
  setShellAuthenticated(true);
  setText("sessionState", result.user?.name || "Ingelogd");
  el("sessionState").dataset.role = result.user?.role || "";
  el("sessionState").classList.remove("muted");
  el("demo").disabled = false;
  setText("introText", intro);
  await refresh();
  await refreshOps();
  await refreshMobile();
  await refreshAdmin();
}

async function submitLoginForm(form) {
  const data = formData(form);
  el("loginNotice").textContent = "";
  el("loginNotice").classList.remove("bad");

  try {
    // Stap 1: authenticeer en haal token op
    const payload = { email: data.email, password: data.password };
    if (data.mfaCode && data.mfaCode.trim()) payload.mfaCode = data.mfaCode.trim();
    const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });

    if (!result.ok && !result.token) {
      throw new Error(result.error || "Inloggen mislukt");
    }

    // MFA vereist → toon inline codeveld (geen prompt). Tweede submit stuurt de code mee.
    if (result.mfaRequired && !data.mfaCode) {
      const mfaField = el("loginMfaField");
      if (mfaField) {
        mfaField.style.display = "";
        const input = mfaField.querySelector("input");
        if (input) { input.value = ""; setTimeout(() => input.focus(), 50); }
      }
      el("loginNotice").textContent = "Voer je authenticator-code in om in te loggen.";
      return;
    }

    // Stap 2: token opslaan en state zetten
    token = result.token || "";
    localStorage.setItem("wfp_token", token);
    window._wfpCurrentUser = result.user || null;
    setShellAuthenticated(true);
    if (el("sessionState")) {
      el("sessionState").textContent = result.user?.name || "Ingelogd";
      el("sessionState").dataset.role = result.user?.role || "";
      el("sessionState").classList.remove("muted");
    }

    const role = result.user?.role || "";

    // Stap 3: verberg login en toon platform
    const loginPage = document.getElementById("loginPage");
    if (loginPage) loginPage.classList.add("hidden");

    if (window.WorkFlowProPlatformRouter) {
      window.WorkFlowProPlatformRouter.showPlatform(role);
    } else {
      setView("start");
    }

    // Stap 4: achtergrond refresh (fouten hier crashen de UI niet)
    Promise.all([
      refresh().catch(() => {}),
      refreshOps ? refreshOps().catch(() => {}) : Promise.resolve(),
    ]).catch(() => {});

  } catch (error) {
    el("loginNotice").textContent = error.message || "Inloggen mislukt";
    el("loginNotice").classList.add("bad");
  }
}

el("login").addEventListener("click", () => {
  setShellAuthenticated(false);
});

// Wachtwoord vergeten — eerlijke uitleg i.p.v. dode link (geen e-mail reset flow)
document.getElementById("loginForgot")?.addEventListener("click", event => {
  event.preventDefault();
  showToast("Wachtwoord vergeten? Vraag je beheerder om het te resetten via Medewerkers. Beheerders nemen contact op met support.", "info");
});

// Taalkeuze — EN is voorbereid maar nog niet beschikbaar (eerlijk i.p.v. dode knop)
document.getElementById("langEN")?.addEventListener("click", () => {
  showToast("De Engelstalige interface komt binnenkort. De app is momenteel in het Nederlands.", "info");
});

// Demo-rol knoppen (CSP blokkeert inline onclick → hier via addEventListener)
document.querySelectorAll(".login-role-btn[data-demo-email]").forEach(btn => {
  btn.addEventListener("click", () => {
    const emailInput = el("loginForm").elements.email;
    emailInput.value = btn.dataset.demoEmail;
    el("loginForm").elements.password.focus();
  });
});

el("loginSuper").addEventListener("click", () => {
  el("loginForm").elements.email.value = "super@workflowpro.be";
  el("loginForm").elements.password.focus();
  el("loginNotice").textContent = "Vul het super-admin wachtwoord en MFA-code in.";
  el("loginNotice").classList.remove("bad");
});

el("loginForm").addEventListener("submit", event => {
  event.preventDefault();
  submitLoginForm(event.currentTarget);
});

el("demo").addEventListener("click", async () => {
  if (!token) return;
  el("demo").disabled = true;
  el("demo").textContent = "Demo wordt gemaakt";
  await api(`/api/tenants/${tenantId}/golden-path/demo`, { method: "POST", body: "{}" });
  el("demo").textContent = "Demo golden path klaar";
  await refresh();
  await refreshOps();
});

el("employeeForm").addEventListener("submit", event => {
  event.preventDefault();
  submitModule(event.currentTarget, "users", data => ({
    name: data.name,
    email: data.email,
    role: data.role,
    password: data.password,
    permissions: data.role === "tenant_admin"
      ? ["tenants", "employees", "venues", "customers", "planning", "workorders", "clockings", "expenses", "billing", "settings", "audit"]
      : ["workorders", "expenses", "leaves", "messages"]
  }));
});

el("employeeImportForm").addEventListener("submit", event => {
  event.preventDefault();
  importEmployees(event.currentTarget);
});

el("employeeImportFile").addEventListener("change", event => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    el("employeeImportForm").elements.csv.value = String(reader.result || "");
  };
  reader.readAsText(file);
});

el("permissionUser").addEventListener("change", renderPermissionForm);
el("permissionRole").addEventListener("change", event => applyRolePreset(event.currentTarget.value));
el("permissionForm").addEventListener("submit", event => {
  event.preventDefault();
  savePermissions(event.currentTarget);
});

el("venueForm").addEventListener("submit", event => {
  event.preventDefault();
  submitModule(event.currentTarget, "venues", data => ({ ...data, active: true }));
});

el("planningForm").addEventListener("submit", event => {
  event.preventDefault();
  submitModule(event.currentTarget, "planning", data => ({ ...data, billable: true }));
});

el("workorderForm").addEventListener("submit", event => {
  event.preventDefault();
  submitModule(event.currentTarget, "workorders", data => ({
    title: data.title,
    userId: data.userId,
    venueId: data.venueId,
    status: data.status,
    checklist: String(data.checklistText || "").split(/\r?\n/).filter(Boolean).map(label => ({ label, done: false }))
  }));
});

el("expenseForm").addEventListener("submit", event => {
  event.preventDefault();
  submitModule(event.currentTarget, "expenses", data => ({
    ...data,
    amount: Number(data.amount),
    status: "submitted",
    billable: false
  }));
});

el("stockForm").addEventListener("submit", event => {
  event.preventDefault();
  submitAssetModule(event.currentTarget, "stock", data => ({
    ...data,
    quantity: Number(data.quantity || 0),
    minLevel: Number(data.minLevel || 0),
    reserved: 0,
    status: Number(data.quantity || 0) < Number(data.minLevel || 0) ? "low" : "ok"
  }));
});

el("vehicleForm").addEventListener("submit", event => {
  event.preventDefault();
  submitAssetModule(event.currentTarget, "vehicles", data => ({
    ...data,
    mileage: Number(data.mileage || 0),
    status: serviceDueSoon(data) ? "service_due" : "ok"
  }));
});

el("kboForm").addEventListener("submit", event => {
  event.preventDefault();
  applyKboFromForm(event.currentTarget);
});

el("clockIn").addEventListener("click", () => clock("in"));
el("clockOut").addEventListener("click", () => clock("out"));

el("setupIntent").addEventListener("click", createSetupIntent);
el("paymentForm").addEventListener("submit", event => {
  event.preventDefault();
  submitBilling(event.currentTarget, `/api/tenants/${tenantId}/billing/payment-method`, "Betaalmethode tokenized opgeslagen.");
});
el("invoiceForm").addEventListener("submit", event => {
  event.preventDefault();
  submitBilling(event.currentTarget, `/api/tenants/${tenantId}/billing/invoices`, "Factuurconcept aangemaakt.");
});
el("dpaForm").addEventListener("submit", event => {
  event.preventDefault();
  submitBilling(event.currentTarget, `/api/tenants/${tenantId}/compliance/dpa`, "DPA geaccepteerd.");
});
el("gdprForm").addEventListener("submit", event => {
  event.preventDefault();
  submitBilling(event.currentTarget, `/api/tenants/${tenantId}/compliance/gdpr-requests`, "GDPR verzoek geregistreerd.");
});
el("contractForm").addEventListener("submit", event => {
  event.preventDefault();
  transitionContract(event.currentTarget);
});

el("integrationForm").addEventListener("submit", event => {
  event.preventDefault();
  connectIntegration(event.currentTarget);
});
el("mappingForm").addEventListener("submit", event => {
  event.preventDefault();
  saveMapping(event.currentTarget);
});
el("notificationForm").addEventListener("submit", event => {
  event.preventDefault();
  createNotificationFromForm(event.currentTarget);
});
el("generateReminders").addEventListener("click", generateReminders);

window.WorkFlowProRouter.configure({
  views: viewConfig,
  el,
  refreshHandlers: {
    refreshCustomerStart,
    refreshOps,
    refreshBilling,
    refreshAssets,
    refreshStock,
    refreshVerlof,
    refreshWagenpark,
    refreshReportsDashboard,
    refreshMobile,
    refreshIntegrations,
    refreshNotifications,
    refreshAdmin,
    refreshPortal,
    refreshSales,
    refreshStatus,
    refreshJson,
    // Nieuwe domeinschermen
    refreshCustomers:  () => window.refreshCustomers?.(),
    refreshEmployees:  () => window.refreshEmployees?.(),
    refreshClockings:  () => window.refreshClockings?.(),
    refreshExpenses:   () => window.refreshExpenses?.(),
    refreshInvoices:   () => window.refreshInvoices?.()
  }
});
window.WorkFlowProCustomerStart.configure({
  token: () => token,
  api,
  tenantId,
  state,
  el,
  setText,
  escapeHtml,
  venueName,
  setView
});
window.WorkFlowProOperations.configure({
  token: () => token,
  state,
  el,
  escapeHtml,
  personName,
  venueName,
  statusTone,
  todayValue,
  setView
});
window.WorkFlowProBilling.configure({
  token: () => token,
  api,
  tenantId,
  state,
  el,
  escapeHtml,
  renderList,
  formData,
  setBillingNotice,
  refreshPortal,
  refreshAdmin
});
window.WorkFlowProAssets.configure({
  token: () => token,
  state,
  el,
  escapeHtml,
  personName,
  optionList,
  renderList,
  listModuleRows,
  createModuleRow,
  setAssetNotice,
  futureDateValue
});
window.WorkFlowProReports.configure({
  token: () => token,
  state,
  el,
  escapeHtml,
  renderList,
  venueName,
  personName,
  serviceDueSoon,
  refreshOps,
  listModuleRows,
  setReportNotice
});
window.WorkFlowProIntegrations.configure({
  token: () => token,
  api,
  tenantId,
  state,
  el,
  escapeHtml,
  renderList,
  formData,
  setIntegrationNotice
});
window.WorkFlowProActionCenter.configure({
  token: () => token,
  api,
  tenantId,
  state,
  el,
  escapeHtml,
  renderList,
  formData,
  setNotificationNotice,
  setView
});
window.WorkFlowProMobile.configure({
  token: () => token,
  api,
  tenantId,
  state,
  el,
  setText,
  escapeHtml,
  statusTone,
  shortDateTime,
  venueName,
  renderList,
  refreshOps,
  refreshAll: refresh
});
window.WorkFlowProRouter.bindNavigation();

// ── Globale helpers voor nieuwe modules (calendar, werkbon-detail, stock) ──────
window.showToast = showToast;
window.renderWorkorderExperience = renderWorkorderExperience;
el("refreshJson").addEventListener("click", refreshJson);
el("refreshStatus").addEventListener("click", refreshStatus);
el("aiSuggestionPrimary").addEventListener("click", () => runAiSuggestionAction(state.aiSuggestion?.primary, "primary"));
el("aiSuggestionSecondary").addEventListener("click", () => runAiSuggestionAction(state.aiSuggestion?.secondary, "secondary"));
el("startNextAction").addEventListener("click", () => {
  window.WorkFlowProCustomerStart.runAction(state.customerStart?.workspace?.assistant?.primary || state.customerStart?.nextAction);
});
el("refreshOps").addEventListener("click", refreshOps);
el("refreshBilling").addEventListener("click", refreshBilling);
el("refreshAssets").addEventListener("click", refreshAssets);
el("refreshReportsDashboard").addEventListener("click", refreshReportsDashboard);
el("refreshMobile").addEventListener("click", refreshMobile);
el("syncMobileQueue").addEventListener("click", syncQueue);
el("refreshIntegrations").addEventListener("click", refreshIntegrations);
el("refreshNotifications").addEventListener("click", refreshNotifications);
el("refreshAdmin").addEventListener("click", refreshAdmin);
el("refreshApiKeys").addEventListener("click", refreshApiKeys);
el("runApiKeyGovernance").addEventListener("click", runApiKeyGovernance);
el("apiKeyForm").addEventListener("submit", event => {
  event.preventDefault();
  createApiKey(event.currentTarget);
});
el("auditFilterForm").addEventListener("submit", event => {
  event.preventDefault();
  refreshAuditFilters(event.currentTarget);
});
el("exportAuditCsv").addEventListener("click", exportAuditCsv);
el("resetAuditFilter").addEventListener("click", resetAuditFilter);
el("errorFilterForm").addEventListener("submit", event => {
  event.preventDefault();
  refreshErrorFilters();
});
el("exportErrorsCsv").addEventListener("click", exportErrorsCsv);
el("resetErrorFilter").addEventListener("click", resetErrorFilter);
el("refreshPortal").addEventListener("click", refreshPortal);
el("refreshSales").addEventListener("click", refreshSales);
el("salesLeadForm").addEventListener("submit", event => {
  event.preventDefault();
  createSalesLead(event.currentTarget);
});
el("partnerForm").addEventListener("submit", event => {
  event.preventDefault();
  createPartner(event.currentTarget);
});
el("generateDecisionReport").addEventListener("click", generateDecisionReport);
el("createBackup").addEventListener("click", createBackup);
el("generateReports").addEventListener("click", generateReports);
el("supportAccessForm").addEventListener("submit", event => {
  event.preventDefault();
  openSupportAccess(event.currentTarget);
});
el("endSupportAccess").addEventListener("click", endSupportAccess);
el("startMfaSetup").addEventListener("click", startMfaSetup);
el("mfaVerifyForm").addEventListener("submit", event => {
  event.preventDefault();
  verifyMfaSetup(event.currentTarget);
});
el("refreshTenants").addEventListener("click", refreshTenants);
el("tenantForm").addEventListener("submit", event => {
  event.preventDefault();
  createTenant(event.currentTarget);
});
document.querySelectorAll("[data-jump-view]").forEach(button => {
  button.addEventListener("click", () => setView(button.dataset.jumpView));
});
document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.export) {
    event.preventDefault();
    downloadExport(button.dataset.export);
    return;
  }
  if (handlePassiveProductButton(button)) event.preventDefault();
});

if ("serviceWorker" in navigator) {
  // Zodra een nieuwe service worker de controle overneemt (na een deploy),
  // herlaadt de pagina één keer zodat de gebruiker meteen de verse code krijgt.
  // Zonder dit bleef een mobiel toestel op een oude shell hangen (stale/"dubbel").
  let _wfpReloadedForSw = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (_wfpReloadedForSw) return;
    _wfpReloadedForSw = true;
    window.location.reload();
  });
  navigator.serviceWorker.register("/sw.js")
    .then(reg => {
      setText("pwaStatus", "Actief");
      setText("pwaDetail", "Service worker geregistreerd");
      // Controleer meteen op een nieuwere versie (deploy terwijl tab open stond).
      try { reg.update(); } catch (_) {}
    })
    .catch(() => {
      setText("pwaStatus", "Niet actief");
      setText("pwaDetail", "Service worker kon niet registreren");
    });
}

window.addEventListener("online", syncQueue);

el("planningForm").elements.date.value = todayValue();
el("vehicleForm").elements.nextService.value = futureDateValue(14);
el("apiKeyExpiresAt").value = futureDateValue(90);

// ── Nieuwe domeinschermen — knoppen binden ──────────────────────────────────
[
  ["refreshCustomers",  () => window.refreshCustomers?.()],
  ["refreshEmployees",  () => window.refreshEmployees?.()],
  ["refreshClockings",  () => window.refreshClockings?.()],
  ["refreshExpenses",   () => window.refreshExpenses?.()],
  ["refreshInvoices",   () => window.refreshInvoices?.()],
].forEach(([id, fn]) => el(id)?.addEventListener("click", fn));

// Tab-knoppen via event delegation (werkt altijd, ook na DOM-wijzigingen)
document.addEventListener("click", event => {
  const btn = event.target.closest("button");
  if (!btn) return;
  if (btn.dataset.invoiceTab !== undefined) {
    document.querySelectorAll("[data-invoice-tab]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    window.refreshInvoices?.();
    return;
  }
  if (btn.dataset.expenseTab !== undefined) {
    document.querySelectorAll("[data-expense-tab]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    window.refreshExpenses?.();
    return;
  }
});

// + Nieuwe klant / medewerker / onkost / factuur knoppen → scrollen naar form
el("addCustomerBtn")?.addEventListener("click", () => el("customerForm")?.scrollIntoView({behavior:"smooth"}));
el("addEmployeeBtn")?.addEventListener("click", () => el("employeeAddForm")?.scrollIntoView({behavior:"smooth"}));
el("addExpenseBtn")?.addEventListener("click", () => el("expenseSubmitForm")?.scrollIntoView({behavior:"smooth"}));
el("createInvoiceBtn")?.addEventListener("click", () => el("invoiceCreateForm")?.scrollIntoView({behavior:"smooth"}));
el("exportClockings")?.addEventListener("click", () => downloadExport("clockings"));

saveQueue();
refresh();

// ── Support-impersonatie: agent komt automatisch binnen via #support_token=… ──
// De superadmin opent de support-sessie in een nieuw tabblad met het sessietoken
// in de URL-hash (hash gaat niet naar de server/logs). We pikken het op, loggen
// in als de overgenomen gebruiker en tonen meteen het juiste platform — de agent
// hoeft dus niet uit zijn eigen profiel te loggen en opnieuw in te loggen.
(function supportEnterBootstrap() {
  const match = (location.hash || "").match(/support_token=([^&]+)/);
  if (!match) return;
  const supportToken = decodeURIComponent(match[1]);
  // Token meteen uit de URL halen zodat het niet in history/bookmarks blijft.
  history.replaceState(null, "", location.pathname + location.search);
  token = supportToken;
  localStorage.setItem("wfp_token", supportToken);
  api("/api/me")
    .then(me => {
      if (!me || !me.ok || !me.user) throw new Error("Support-sessie ongeldig of verlopen");
      window._wfpCurrentUser = me.user;
      setShellAuthenticated(true);
      const loginPage = document.getElementById("loginPage");
      if (loginPage) loginPage.classList.add("hidden");
      if (window.WorkFlowProPlatformRouter) {
        window.WorkFlowProPlatformRouter.showPlatform(me.user.role);
      }
    })
    .catch(err => {
      localStorage.removeItem("wfp_token");
      token = "";
      const notice = el("loginNotice");
      if (notice) { notice.textContent = err.message || "Support-sessie kon niet starten"; notice.classList.add("bad"); }
    });
})();
