let token = "";
let pendingMfaLogin = null;
const tenantId = "t_demo";
const state = {
  users: [],
  venues: [],
  planning: [],
  workorders: [],
  expenses: [],
  report: null,
  billing: null,
  billingQuote: null,
  mobile: null,
  integrations: [],
  notifications: [],
  notificationSummary: null,
  admin: null,
  auditRows: [],
  auditSummary: null,
  errorRows: [],
  errorSummary: null,
  goLive: null,
  reports: [],
  reportsSummary: null,
  reportPreview: null,
  portal: null,
  supportTickets: [],
  supportTicketSummary: null,
  pilot: null,
  decisionReport: null,
  sales: [],
  salesSummary: null,
  salesLaunch: null,
  partners: [],
  publicStatus: null,
  tenants: [],
  apiKeys: [],
  apiKeyGovernance: null,
  backups: [],
  aiSuggestion: null,
  queue: JSON.parse(localStorage.getItem("workflowProQueue") || "[]")
};

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

function el(id) {
  return document.getElementById(id);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Actie mislukt");
  return data;
}

function setText(id, value) {
  el(id).textContent = value;
}

function showJson(id, data) {
  el(id).textContent = JSON.stringify(data, null, 2);
}

function setAiSuggestion(title, text, primary, secondary) {
  state.aiSuggestion = { title, text, primary, secondary };
  setText("aiSuggestionTitle", title);
  setText("aiSuggestionText", text);
  el("aiSuggestionPrimary").textContent = primary.label;
  el("aiSuggestionSecondary").textContent = secondary.label;
}

function runAiSuggestionAction(action) {
  if (!action) return;
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
      { label: "Bekijk API docs", type: "view", view: "api" }
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
    "De basisflow ziet er goed uit. De volgende beste stap is pilotdata verzamelen: planning, werkbonvolume, supporttickets en beslissersrapport.",
    { label: "Open Portal", type: "view", view: "portal" },
    { label: "Open Sales", type: "view", view: "sales" }
  );
}

function setView(view) {
  const planning = view === "planning";
  const workorders = view === "workorders";
  const ops = view === "ops";
  const billing = view === "billing";
  const mobile = view === "mobile";
  const integrations = view === "integrations";
  const notifications = view === "notifications";
  const admin = view === "admin";
  const portal = view === "portal";
  const sales = view === "sales";
  const status = view === "status";
  const json = view === "json";
  const apiDocs = view === "api";
  el("demoPage").classList.toggle("hidden", planning || workorders || ops || billing || mobile || integrations || notifications || admin || portal || sales || status || json || apiDocs);
  el("planningPage").classList.toggle("hidden", !planning);
  el("workordersPage").classList.toggle("hidden", !workorders);
  el("opsPage").classList.toggle("hidden", !ops);
  el("billingPage").classList.toggle("hidden", !billing);
  el("mobilePage").classList.toggle("hidden", !mobile);
  el("integrationsPage").classList.toggle("hidden", !integrations);
  el("notificationsPage").classList.toggle("hidden", !notifications);
  el("adminPage").classList.toggle("hidden", !admin);
  el("portalPage").classList.toggle("hidden", !portal);
  el("salesPage").classList.toggle("hidden", !sales);
  el("statusPage").classList.toggle("hidden", !status);
  el("jsonPage").classList.toggle("hidden", !json);
  el("apiPage").classList.toggle("hidden", !apiDocs);
  el("viewDemo").classList.toggle("active", !planning && !workorders && !ops && !billing && !mobile && !integrations && !notifications && !admin && !portal && !sales && !status && !json && !apiDocs);
  el("viewPlanning").classList.toggle("active", planning);
  el("viewWorkorders").classList.toggle("active", workorders);
  el("viewOps").classList.toggle("active", ops);
  el("viewBilling").classList.toggle("active", billing);
  el("viewMobile").classList.toggle("active", mobile);
  el("viewIntegrations").classList.toggle("active", integrations);
  el("viewNotifications").classList.toggle("active", notifications);
  el("viewAdmin").classList.toggle("active", admin);
  el("viewPortal").classList.toggle("active", portal);
  el("viewSales").classList.toggle("active", sales);
  el("viewStatus").classList.toggle("active", status);
  el("viewJson").classList.toggle("active", json);
  el("viewApi").classList.toggle("active", apiDocs);
  if (planning || workorders) refreshOps();
  if (ops) refreshOps();
  if (billing) refreshBilling();
  if (mobile) refreshMobile();
  if (integrations) refreshIntegrations();
  if (notifications) refreshNotifications();
  if (admin) refreshAdmin();
  if (portal) refreshPortal();
  if (sales) refreshSales();
  if (status) refreshStatus();
  if (json) refreshJson();
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function futureDateValue(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function shortDateTime(value) {
  if (!value) return "Nog niet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Onbekend";
  return date.toLocaleString("nl-BE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function setNotice(message, good = true) {
  const notice = el("opsNotice");
  notice.textContent = message;
  notice.classList.toggle("bad", !good);
}

function setBillingNotice(message, good = true) {
  const notice = el("billingNotice");
  notice.textContent = message;
  notice.classList.toggle("bad", !good);
}

function setIntegrationNotice(message, good = true) {
  const notice = el("integrationNotice");
  notice.textContent = message;
  notice.classList.toggle("bad", !good);
}

function setNotificationNotice(message, good = true) {
  const notice = el("notificationNotice");
  notice.textContent = message;
  notice.classList.toggle("bad", !good);
}

function setAdminNotice(message, good = true) {
  const notice = el("adminNotice");
  notice.textContent = message;
  notice.classList.toggle("bad", !good);
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
  localStorage.setItem("workflowProQueue", JSON.stringify(state.queue));
  setText("queueCount", String(state.queue.length));
}

function optionList(rows, emptyLabel) {
  if (!rows.length) return `<option value="">${emptyLabel}</option>`;
  return rows.map(row => `<option value="${row.id}">${row.name || row.title || row.id}</option>`).join("");
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

function personName(id) {
  return state.users.find(user => user.id === id)?.name || "Onbekend";
}

function venueName(id) {
  return state.venues.find(venue => venue.id === id)?.name || "Geen werf";
}

function renderList(id, rows, template, empty) {
  el(id).innerHTML = rows.length ? rows.map(template).join("") : `<div class="empty">${empty}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function statusTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (["voltooid", "afgerond", "klaar", "approved"].includes(normalized)) return "success";
  if (["operational", "online", "up-to-date"].includes(normalized)) return "success";
  if (["bezig", "review"].includes(normalized)) return "info";
  if (["pending", "mock-ready", "testmode"].includes(normalized)) return "warning";
  if (["overdue", "te laat", "risico"].includes(normalized)) return "danger";
  if (["degraded", "error", "offline"].includes(normalized)) return "danger";
  return "warning";
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
  renderList("statusModules", status.modules || [], row => `
    <div class="data-row">
      <strong>${escapeHtml(row.name)}</strong>
      <span class="status-badge ${statusTone(row.status)}">${escapeHtml(row.status)}</span>
    </div>
  `, "Nog geen componentstatus.");
  showJson("statusJson", status);
}

function renderPlanningExperience() {
  const users = state.users.filter(user => user.role !== "tenant_admin").slice(0, 6);
  const shifts = state.planning.slice(0, 10);
  const linkedWorkorders = state.workorders.length;
  const today = todayValue();
  const activeToday = shifts.filter(shift => shift.date === today).length || shifts.length;
  const absent = Math.max(1, state.users.filter(user => user.role === "employee").length - users.length);
  const conflicts = shifts.length > users.length ? 1 : 0;
  const days = ["Ma 29", "Di 30", "Wo 1", "Do 2", "Vr 3"];

  if (!token) {
    el("planningExperience").innerHTML = `
      <div class="experience-empty">
        <strong>Login om de nieuwe planning-look te testen.</strong>
        <small>Gebruik bovenaan "Login demo admin" en open daarna opnieuw Planning.</small>
      </div>
    `;
    return;
  }

  const planningRows = (users.length ? users : state.users.slice(0, 4)).map((user, index) => {
    const userShifts = shifts.filter(shift => shift.userId === user.id);
    const cells = days.map((day, dayIndex) => {
      const shift = userShifts[dayIndex % Math.max(userShifts.length, 1)];
      if (!shift && (index + dayIndex) % 3 === 0) {
        return `<div class="planner-cell muted-cell">Beschikbaar</div>`;
      }
      if (!shift) return `<div class="planner-cell empty-cell">-</div>`;
      return `
        <div class="planner-cell shift-cell">
          <strong>${escapeHtml(shift.start || shift.startsAt || "08:00")} - ${escapeHtml(shift.end || shift.endsAt || "16:30")}</strong>
          <small>${escapeHtml(shift.project || venueName(shift.venueId))}</small>
        </div>
      `;
    }).join("");

    return `
      <div class="planner-row">
        <div class="planner-person">
          <span>${escapeHtml(user.name?.slice(0, 2).toUpperCase() || "WF")}</span>
          <div>
            <strong>${escapeHtml(user.name || "Medewerker")}</strong>
            <small>${escapeHtml(user.jobTitle || user.role || "Veldteam")}</small>
          </div>
        </div>
        ${cells}
      </div>
    `;
  }).join("");

  el("planningExperience").innerHTML = `
    <div class="experience-kpis">
      <article><span>Beschikbaar</span><strong>${users.length || state.users.length}</strong><small>medewerkers</small></article>
      <article><span>Overboekt</span><strong>${conflicts}</strong><small>conflict</small></article>
      <article><span>Afwezig</span><strong>${absent}</strong><small>vandaag</small></article>
      <article><span>Werkbonnen</span><strong>${linkedWorkorders}</strong><small>gekoppeld</small></article>
    </div>
    <div class="experience-layout">
      <section class="experience-panel planning-board">
        <div class="experience-panel-head">
          <div>
            <h3>29 apr - 5 mei 2026</h3>
            <p>${activeToday} planningitems actief, ${conflicts} aandachtspunt.</p>
          </div>
          <span class="status-badge success">OK Bevestigd</span>
        </div>
        <div class="planner-grid" role="table" aria-label="Weekplanning">
          <div class="planner-header">
            <span>Medewerker</span>
            ${days.map(day => `<span>${day}</span>`).join("")}
          </div>
          ${planningRows || `<div class="experience-empty">Nog geen planning. Maak eerst demo-data aan.</div>`}
        </div>
      </section>
      <aside class="experience-panel assistant-panel">
        <h3>Conflicten</h3>
        <div class="assistant-item warning"><strong>Capaciteit bewaken</strong><small>${conflicts ? "Een medewerker heeft overlappende shifts." : "Geen harde conflicten gevonden."}</small></div>
        <h3>Aanbevolen acties</h3>
        <div class="assistant-item info"><strong>Werkbon koppelen</strong><small>Koppel open werkbonnen aan de planning voor mobiele voorbereiding.</small></div>
        <div class="assistant-item success"><strong>Offline klaarzetten</strong><small>Veldteams kunnen planning en werkbonnen vooraf synchroniseren.</small></div>
      </aside>
    </div>
  `;
}

function renderWorkorderExperience() {
  if (!token) {
    el("workorderExperience").innerHTML = `
      <div class="experience-empty">
        <strong>Login om de nieuwe werkbonnen-look te testen.</strong>
        <small>Gebruik bovenaan "Login demo admin" en open daarna opnieuw Werkbonnen.</small>
      </div>
    `;
    return;
  }

  const columns = [
    ["Te starten", ["Nieuw", "Open"]],
    ["Bezig", ["Bezig"]],
    ["Review", ["Review", "Voltooid"]],
    ["Klaar voor facturatie", ["Klaar voor facturatie", "Afgerond"]]
  ];
  const selected = state.workorders[0] || {};
  const workorders = state.workorders.length ? state.workorders : [];
  const openCount = workorders.filter(row => (row.status || "Nieuw") !== "Voltooid").length;
  const reviewCount = workorders.filter(row => ["Review", "Voltooid"].includes(row.status)).length;

  const columnMarkup = columns.map(([label, statuses], index) => {
    const rows = workorders.filter(row => statuses.includes(row.status || "Nieuw"));
    const fallbackRows = index === 0 && !workorders.length ? [] : rows;
    return `
      <section class="kanban-column">
        <div class="kanban-title">
          <strong>${label}</strong>
          <span>${fallbackRows.length}</span>
        </div>
        ${fallbackRows.map(row => {
          const checklistDone = (row.checklist || []).filter(item => item.done).length;
          const checklistTotal = (row.checklist || []).length;
          return `
            <article class="workorder-card">
              <div class="card-topline">
                <span class="status-badge ${statusTone(row.status)}">${escapeHtml(row.status || "Nieuw")}</span>
                <small>${escapeHtml(row.id || "WB")}</small>
              </div>
              <strong>${escapeHtml(row.title || "Werkbon")}</strong>
              <small>${escapeHtml(venueName(row.venueId))} - ${escapeHtml(personName(row.userId))}</small>
              <div class="card-meta">
                <span>Checklist ${checklistDone}/${checklistTotal || 3}</span>
                <span>${row.files?.length || 0} foto's</span>
              </div>
            </article>
          `;
        }).join("") || `<div class="kanban-empty">Geen werkbonnen</div>`}
      </section>
    `;
  }).join("");

  el("workorderExperience").innerHTML = `
    <div class="experience-kpis">
      <article><span>Open</span><strong>${openCount}</strong><small>werkbonnen</small></article>
      <article><span>Review</span><strong>${reviewCount}</strong><small>wacht op controle</small></article>
      <article><span>Foto's</span><strong>${workorders.reduce((sum, row) => sum + (row.files?.length || 0), 0)}</strong><small>bewijsstukken</small></article>
      <article><span>SLA risico</span><strong>${openCount > 3 ? 2 : 0}</strong><small>aandacht</small></article>
    </div>
    <div class="workorder-layout">
      <section class="kanban-board">${columnMarkup}</section>
      <aside class="experience-panel detail-panel">
        <p class="eyebrow">Geselecteerd</p>
        <h3>${escapeHtml(selected.title || "Geen werkbon geselecteerd")}</h3>
        <div class="detail-stack">
          <div><span>Klant / werf</span><strong>${escapeHtml(venueName(selected.venueId))}</strong></div>
          <div><span>Uitvoerder</span><strong>${escapeHtml(personName(selected.userId))}</strong></div>
          <div><span>Status</span><strong>${escapeHtml(selected.status || "Nieuw")}</strong></div>
          <div><span>Handtekening</span><strong>${selected.signed ? "Ontvangen" : "Nog nodig"}</strong></div>
        </div>
        <h3>Assistent</h3>
        <div class="assistant-item info"><strong>Uren controleren</strong><small>Controleer of tijdregistratie gekoppeld is voor facturatie.</small></div>
        <div class="assistant-item warning"><strong>Materiaal reserveren</strong><small>Stock kan automatisch dalen na afronding.</small></div>
      </aside>
    </div>
  `;
}

function renderOps() {
  fillSelects();
  renderReport();
  renderPermissionForm();
  renderPlanningExperience();
  renderWorkorderExperience();
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

async function refresh() {
  try {
    const health = await api("/api/health");
    showJson("jsonHealth", health);
    setText("apiStatus", health.ok ? "Online" : "Niet klaar");
    setText("apiDetail", `${health.mode} - ${health.modules} modules`);

    if (!token) {
      renderToday(null);
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
    api(`/api/modules/users?tenantId=${tenantId}`),
    api(`/api/modules/venues?tenantId=${tenantId}`),
    api(`/api/modules/planning?tenantId=${tenantId}`),
    api(`/api/modules/workorders?tenantId=${tenantId}`),
    api(`/api/modules/expenses?tenantId=${tenantId}`),
    api(`/api/tenants/${tenantId}/management-report`)
  ]);
  state.users = users.rows || [];
  state.venues = venues.rows || [];
  state.planning = planning.rows || [];
  state.workorders = workorders.rows || [];
  state.expenses = expenses.rows || [];
  state.report = report.report || null;
  renderOps();
  setNotice("Operationele data is bijgewerkt.");
}

function renderBilling() {
  const billing = state.billing || {};
  const quote = state.billingQuote || {};
  const cards = [
    ["Status", billing.billingStatus || "trial"],
    ["Plan", quote.planLabel || billing.plan || "business"],
    ["Seats", quote.seats ?? "-"],
    ["Betaalmethode", billing.paymentMethodTokenized ? "Tokenized" : "Ontbreekt"],
    ["Auto-charge", billing.autoCharge ? "Actief" : "Niet actief"],
    ["Facturen", billing.invoices?.length || 0],
    ["Peppol", billing.peppolProvider || "mock"],
    ["DPA", billing.dpaAccepted ? "Geaccepteerd" : "Open"],
    ["Jaarprijs", quote.enterpriseCustom ? "Maatwerk" : `EUR ${Number(quote.annualTotal || 0).toFixed(2)}`]
  ];
  el("billingCards").innerHTML = cards.map(([label, value]) => `
    <article class="metric">
      <span class="metric-label">${label}</span>
      <strong>${value}</strong>
      <small>Tenant ${billing.tenantId || tenantId}</small>
    </article>
  `).join("");

  renderPricingQuote(quote);

  renderList("invoiceRows", billing.invoices || [], invoice => `
    <div class="data-row">
      <strong>${invoice.id} - EUR ${Number(invoice.net || 0).toFixed(2)}</strong>
      <small>${invoice.status} - Peppol: ${invoice.peppolStatus} - pogingen ${invoice.peppolAttempts || 0} - vervalt ${invoice.dueDate}</small>
      ${invoice.peppolError ? `<small>Peppol fout: ${invoice.peppolError}</small>` : ""}
      <div class="row-actions">
        <button class="small-action" data-peppol="${invoice.id}" type="button">Peppol versturen</button>
        <button class="small-action" data-payment-failed="${invoice.id}" type="button">Payment failed</button>
      </div>
    </div>
  `, "Nog geen facturen.");

  renderList("contractRows", billing.contractEvents || [], event => `
    <div class="data-row">
      <strong>${event.label}</strong>
      <small>${event.from} naar ${event.to} - ${event.at} - ${event.by}</small>
      ${event.reason ? `<small>${event.reason}</small>` : ""}
    </div>
  `, "Nog geen contract events.");

  const complianceRows = [
    ...(billing.dpaAccepted ? [{ kind: "dpa", title: "DPA geaccepteerd", detail: billing.dpaAcceptedAt }] : [{ kind: "dpa", title: "DPA nog open", detail: "Nog niet geaccepteerd" }]),
    ...(billing.gdprRequests || []).map(request => ({
      kind: "gdpr",
      id: request.id,
      title: `GDPR ${request.type}`,
      detail: `${request.subjectEmail} - ${request.status}${request.processedAt ? ` - verwerkt ${request.processedAt}` : ""}`,
      status: request.status,
      result: request.result
    })),
    ...(billing.failedPayments || []).map(payment => ({
      kind: "payment",
      id: payment.id,
      title: "Failed payment",
      detail: `${payment.reason} - ${payment.status} - stage ${payment.dunningStage || 1}`,
      status: payment.status,
      nextActionAt: payment.nextActionAt,
      events: payment.events || []
    }))
  ];
  renderList("complianceRows", complianceRows, row => `
    <div class="data-row">
      <strong>${row.title}</strong>
      <small>${row.detail}</small>
      ${row.result?.export?.counts ? `<small>Export: ${Object.entries(row.result.export.counts).map(([key, value]) => `${key} ${value}`).join(", ")}</small>` : ""}
      ${row.result?.anonymizedUsers !== undefined ? `<small>Geanonimiseerd: ${row.result.anonymizedUsers} gebruiker(s)</small>` : ""}
      ${row.nextActionAt ? `<small>Volgende actie: ${row.nextActionAt}</small>` : ""}
      ${row.kind === "gdpr" && row.status !== "completed" ? `<div class="row-actions"><button class="small-action" data-gdpr-process="${row.id}" type="button">Verwerk verzoek</button></div>` : ""}
      ${row.kind === "payment" && row.status === "open" ? `<div class="row-actions">
        <button class="small-action" data-dunning-action="reminder" data-dunning-id="${row.id}" type="button">Reminder</button>
        <button class="small-action" data-dunning-action="retry" data-dunning-id="${row.id}" type="button">Retry</button>
        <button class="small-action" data-dunning-action="resolve" data-dunning-id="${row.id}" type="button">Opgelost</button>
      </div>` : ""}
    </div>
  `, "Nog geen compliance events.");

  renderList("peppolEventRows", billing.peppolEvents || [], event => `
    <div class="data-row">
      <strong>${event.invoiceId} - ${event.status}</strong>
      <small>${event.at} - ${event.provider} - ${event.message || event.providerReference || ""}</small>
    </div>
  `, "Nog geen Peppol events.");

  renderList("stripeEventRows", billing.stripeEvents || [], event => `
    <div class="data-row">
      <strong>${event.type} - ${event.status}</strong>
      <small>${event.at} - ${event.action} - ${event.id}</small>
    </div>
  `, "Nog geen Stripe events.");

  document.querySelectorAll("[data-peppol]").forEach(button => {
    button.addEventListener("click", () => sendPeppolInvoice(button.dataset.peppol));
  });
  document.querySelectorAll("[data-payment-failed]").forEach(button => {
    button.addEventListener("click", () => markPaymentFailed(button.dataset.paymentFailed));
  });
  document.querySelectorAll("[data-gdpr-process]").forEach(button => {
    button.addEventListener("click", () => processGdprRequest(button.dataset.gdprProcess));
  });
  document.querySelectorAll("[data-dunning-id]").forEach(button => {
    button.addEventListener("click", () => advanceDunning(button.dataset.dunningId, button.dataset.dunningAction));
  });
}

function renderPricingQuote(quote) {
  if (!quote.planLabel) {
    el("pricingQuote").innerHTML = "";
    return;
  }
  el("pricingQuote").innerHTML = `
    <article class="quote-card">
      <div>
        <p class="eyebrow">Pricing package</p>
        <h3>${quote.planLabel}</h3>
        <small>${quote.seats} billable seats - ${quote.includedSeats} inbegrepen - ${quote.extraSeats} extra</small>
      </div>
      <div class="quote-price">
        <strong>${quote.enterpriseCustom ? "Maatwerk" : `EUR ${Number(quote.annualTotal || 0).toFixed(2)}`}</strong>
        <small>${quote.enterpriseCustom ? "Jaarcontract op offerte" : `incl. ${Math.round((quote.vatRate || 0) * 100)}% btw`}</small>
      </div>
    </article>
    <div class="quote-features">
      ${(quote.features || []).map(feature => `<span>${feature}</span>`).join("")}
    </div>
  `;
}

async function refreshBilling() {
  if (!token) {
    setBillingNotice("Login met de demo admin om billing te beheren.", false);
    return;
  }
  const [summary, quote] = await Promise.all([
    api(`/api/tenants/${tenantId}/billing/summary`),
    api(`/api/tenants/${tenantId}/billing/quote`)
  ]);
  state.billing = summary.billing;
  state.billingQuote = quote.quote;
  renderBilling();
  setBillingNotice("Billing data is bijgewerkt.");
}

function renderMobile(today) {
  if (!today) {
    el("mobileShiftRows").innerHTML = `<div class="empty">Login om mobiele planning te laden.</div>`;
    el("mobileWorkorderRows").innerHTML = `<div class="empty">Login om werkbonnen te laden.</div>`;
    setText("queueCount", String(state.queue.length));
    setText("mobileLastSync", "Nog niet");
    setText("mobileSyncDetail", "0 acties verwerkt");
    return;
  }

  const offlineHints = today.offlineHints || {};
  setText("mobileTodayDate", today.date || "-");
  setText("mobileTodayUser", today.user?.name || "Veldteam");
  setText("mobileIntro", "Mobiele flow geladen met planning, werkbonnen, PWA-status en offline wachtrij.");
  setText("queueCount", String(state.queue.length));
  setText("mobileLastSync", shortDateTime(offlineHints.lastSyncedAt));
  setText("mobileSyncDetail", `${offlineHints.processedCount || 0} acties verwerkt`);

  renderList("mobileShiftRows", today.shifts || [], shift => `
    <div class="data-row">
      <strong>${shift.start || shift.startsAt || "?"} tot ${shift.end || shift.endsAt || "?"}</strong>
      <small>${shift.project || "Planning"} - ${venueName(shift.venueId)}</small>
    </div>
  `, "Geen planning voor vandaag.");

  renderList("mobileWorkorderRows", today.openWorkorders || [], workorder => `
    <div class="mobile-workorder">
      <strong>${workorder.title}</strong>
      <small>${workorder.status || "Nieuw"} - ${venueName(workorder.venueId)} - ${workorder.files?.length || 0} foto's - ${workorder.signed ? "getekend" : "niet getekend"}</small>
      <div class="mobile-actions">
        <button class="small-action" data-mobile-photo="${workorder.id}" type="button">Foto</button>
        <button class="small-action" data-mobile-sign="${workorder.id}" type="button">Handtekening</button>
        <button class="small-action" data-mobile-complete="${workorder.id}" type="button">Afronden</button>
      </div>
    </div>
  `, "Geen open werkbonnen.");

  document.querySelectorAll("[data-mobile-photo]").forEach(button => {
    button.addEventListener("click", () => mobileWorkorderAction(button.dataset.mobilePhoto, "photo"));
  });
  document.querySelectorAll("[data-mobile-sign]").forEach(button => {
    button.addEventListener("click", () => mobileWorkorderAction(button.dataset.mobileSign, "signature"));
  });
  document.querySelectorAll("[data-mobile-complete]").forEach(button => {
    button.addEventListener("click", () => mobileWorkorderAction(button.dataset.mobileComplete, "complete"));
  });
}

async function refreshMobile() {
  setText("pwaStatus", "Controle");
  setText("pwaDetail", "Manifest actief, service worker wordt nagekeken");
  if (!token) {
    renderMobile(null);
    return;
  }
  await refreshOps();
  const result = await api(`/api/tenants/${tenantId}/mobile/today`);
  state.mobile = result.today;
  renderMobile(result.today);
}

function mappingTextToRows(text) {
  return String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [local, remote] = line.split("=>").map(part => part.trim());
    return { local, remote, direction: "both" };
  });
}

function mappingRowsToText(rows) {
  return (rows || []).map(row => `${row.local} => ${row.remote}`).join("\n");
}

function renderIntegrations() {
  const options = state.integrations.length
    ? state.integrations.map(row => `<option value="${row.id}">${row.label || row.provider}</option>`).join("")
    : `<option value="">Maak eerst een koppeling</option>`;
  el("mappingIntegration").innerHTML = options;
  const first = state.integrations[0];
  if (first) el("mappingForm").elements.mappingText.value = mappingRowsToText(first.config?.fieldMapping || []);

  renderList("integrationCards", state.integrations, row => `
    <div class="data-row ${row.syncSummary?.needsAttention || row.mappingSummary?.needsAttention ? "kpi-open" : ""}">
      <strong>${row.label || row.provider}</strong>
      <small>${row.status} - ${row.syncSummary?.lastSyncAt || "nog niet gesynchroniseerd"} - secret: ${row.hasSecret ? "aanwezig" : "ontbreekt"}</small>
      <small>Syncs: ${row.syncSummary?.success || 0} OK, ${row.syncSummary?.failed || 0} fouten, ${row.syncSummary?.retryableFailures || 0} retrybaar, ${row.syncSummary?.retries || 0} retries</small>
      <small>Mappings: ${row.mappingSummary?.valid || 0} geldig, ${row.mappingSummary?.invalid || 0} ongeldig</small>
    </div>
  `, "Nog geen koppelingen.");

  renderList("integrationRows", state.integrations, row => `
    <div class="data-row">
      <strong>${row.label || row.provider}</strong>
      <small>${row.provider} - ${row.config?.environment || "test"} - ${row.config?.fieldMapping?.length || 0} mappings</small>
      <small>Mappingstatus: ${row.mappingSummary?.needsAttention ? "nakijken" : "klaar"}</small>
      <small>Laatste sync: ${row.syncSummary?.lastStatus || "never"}${row.syncSummary?.lastErrorCode ? ` (${row.syncSummary.lastErrorCode})` : ""}${row.syncSummary?.lastMessage ? ` - ${row.syncSummary.lastMessage}` : ""}</small>
      <small>Open foutcodes: ${(row.syncSummary?.openErrorCodes || []).join(", ") || "geen"}</small>
      <div class="row-actions">
        <button class="small-action" data-sync-integration="${row.id}" type="button">Sync nu</button>
      </div>
    </div>
  `, "Nog geen koppelingen.");

  const logs = state.integrations.flatMap(row => (row.syncLogs || []).map(log => ({ ...log, provider: row.provider, integrationId: row.id })));
  renderList("syncLogRows", logs, log => `
    <div class="data-row ${log.retryable ? "kpi-open" : ""}">
      <strong>${log.provider} - ${log.status}${log.resolved ? " - opgelost" : ""}</strong>
      <small>${log.at}${log.errorCode ? ` - ${log.errorCode}` : ""} - push werkbonnen ${log.pushed?.workorders || 0}, facturen ${log.pushed?.invoices || 0}</small>
      <div class="row-actions">
        ${log.retryable ? `<button class="small-action" data-retry-sync="${log.integrationId}" data-sync-id="${log.id}" type="button">Retry</button>` : ""}
      </div>
    </div>
  `, "Nog geen sync logs.");

  document.querySelectorAll("[data-sync-integration]").forEach(button => {
    button.addEventListener("click", () => runIntegrationSync(button.dataset.syncIntegration));
  });
  document.querySelectorAll("[data-retry-sync]").forEach(button => {
    button.addEventListener("click", () => retryIntegrationSync(button.dataset.retrySync, button.dataset.syncId));
  });
}

async function refreshIntegrations() {
  if (!token) {
    setIntegrationNotice("Login met de demo admin om integraties te beheren.", false);
    return;
  }
  const result = await api(`/api/tenants/${tenantId}/integrations`);
  state.integrations = result.rows || [];
  renderIntegrations();
  setIntegrationNotice("Integraties zijn bijgewerkt.");
}

async function connectIntegration(form) {
  if (!token) return setIntegrationNotice("Login eerst met de demo admin.", false);
  try {
    await api(`/api/tenants/${tenantId}/integrations/connect`, { method: "POST", body: JSON.stringify(formData(form)) });
    setIntegrationNotice("Koppeling opgeslagen.");
    await refreshIntegrations();
  } catch (error) {
    setIntegrationNotice(error.message, false);
  }
}

async function saveMapping(form) {
  if (!token) return setIntegrationNotice("Login eerst met de demo admin.", false);
  const data = formData(form);
  if (!data.integrationId) return setIntegrationNotice("Kies eerst een integratie.", false);
  try {
    await api(`/api/tenants/${tenantId}/integrations/${data.integrationId}/mapping`, {
      method: "POST",
      body: JSON.stringify({ fieldMapping: mappingTextToRows(data.mappingText) })
    });
    setIntegrationNotice("Mapping opgeslagen.");
    await refreshIntegrations();
  } catch (error) {
    setIntegrationNotice(error.message, false);
  }
}

async function runIntegrationSync(integrationId) {
  try {
    await api(`/api/tenants/${tenantId}/integrations/${integrationId}/sync`, { method: "POST", body: "{}" });
    setIntegrationNotice("Sync uitgevoerd.");
    await refreshIntegrations();
  } catch (error) {
    setIntegrationNotice(error.message, false);
  }
}

async function retryIntegrationSync(integrationId, syncId) {
  try {
    const result = await api(`/api/tenants/${tenantId}/integrations/${integrationId}/retry`, {
      method: "POST",
      body: JSON.stringify({ syncId })
    });
    setIntegrationNotice(result.result?.duplicate ? "Retry was al verwerkt." : "Retry uitgevoerd.");
    await refreshIntegrations();
  } catch (error) {
    setIntegrationNotice(error.message, false);
  }
}

function renderNotifications() {
  const summary = state.notificationSummary || {};
  const cards = [
    ["Totaal", summary.total || 0],
    ["In wachtrij", summary.queued || 0],
    ["Gelezen", summary.read || 0],
    ["Hoge prioriteit", summary.highPriority || 0],
    ["Support escalaties", summary.supportEscalations || 0]
  ];
  el("notificationCards").innerHTML = cards.map(([label, value]) => `
    <article class="metric">
      <span class="metric-label">${label}</span>
      <strong>${value}</strong>
      <small>Notificaties</small>
    </article>
  `).join("");

  renderList("notificationRows", state.notifications, row => `
    <div class="data-row">
      <strong>${row.title}</strong>
      <small>${row.type} - ${row.channel} - ${row.audience} - ${row.status} - ${row.priority}</small>
      <small>${row.body || ""}${row.sourceRef ? ` - bron ${row.sourceRef}` : ""}</small>
      <div class="row-actions">
        ${row.status === "read" ? "" : `<button class="small-action" data-read-notification="${row.id}" type="button">Markeer gelezen</button>`}
      </div>
    </div>
  `, "Nog geen notificaties.");

  document.querySelectorAll("[data-read-notification]").forEach(button => {
    button.addEventListener("click", () => markNotificationRead(button.dataset.readNotification));
  });
}

async function refreshNotifications() {
  if (!token) {
    setNotificationNotice("Login met de demo admin om notificaties te beheren.", false);
    return;
  }
  const result = await api(`/api/tenants/${tenantId}/notifications`);
  state.notifications = result.rows || [];
  state.notificationSummary = result.summary || {};
  renderNotifications();
  setNotificationNotice("Notificaties zijn bijgewerkt.");
}

async function createNotificationFromForm(form) {
  if (!token) return setNotificationNotice("Login eerst met de demo admin.", false);
  try {
    await api(`/api/tenants/${tenantId}/notifications`, {
      method: "POST",
      body: JSON.stringify(formData(form))
    });
    setNotificationNotice("Notificatie aangemaakt.");
    await refreshNotifications();
  } catch (error) {
    setNotificationNotice(error.message, false);
  }
}

async function generateReminders() {
  if (!token) return setNotificationNotice("Login eerst met de demo admin.", false);
  try {
    const result = await api(`/api/tenants/${tenantId}/notifications/reminders`, { method: "POST", body: "{}" });
    setNotificationNotice(`${result.rows.length} reminders aangemaakt.`);
    await refreshNotifications();
  } catch (error) {
    setNotificationNotice(error.message, false);
  }
}

async function markNotificationRead(notificationId) {
  try {
    await api(`/api/tenants/${tenantId}/notifications/${notificationId}/read`, { method: "POST", body: "{}" });
    setNotificationNotice("Notificatie gemarkeerd als gelezen.");
    await refreshNotifications();
  } catch (error) {
    setNotificationNotice(error.message, false);
  }
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
  const supportRisk = status.supportRisk || {};
  const rateLimits = status.rateLimits || {};
  const backupHealth = status.backupHealth || {};
  const goLive = state.goLive || {};
  const gates = goLive.gates || {};
  const productionGate = gates.production || {};
  const pilotGate = gates.pilot || {};
  const salesGate = gates.sales || {};
  const cards = [
    ["API", health.api || "-"],
    ["Storage", health.storage || "-"],
    ["Go-live", goLive.ok ? "Klaar" : "Open"],
    ["Production", `${readiness.score || 0}%`],
    ["P0 blockers", productionGate.p0 ?? readiness.blockers ?? 0],
    ["Pilot gate", `${pilotGate.score || 0}%`],
    ["Sales gate", `${salesGate.score || 0}%`],
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
    ["Support SLA verlopen", supportRisk.slaBreached || 0],
    ["Support SLA risico", supportRisk.slaRisk || 0],
    ["Kritieke bug SLA", supportRisk.criticalBugSlaBreached || 0],
    ["Support escalaties", supportRisk.escalations || 0],
    ["Pilot blockers", supportRisk.blockers || 0],
    ["Rate limit", health.rateLimiting || "-"],
    ["Rate buckets", rateLimits.activeBuckets || 0],
    ["Release", status.release?.version || "-"],
    ["Support", support.enabled ? "Open" : "Gesloten"]
  ];
  el("adminCards").innerHTML = cards.map(([label, value]) => `
    <article class="metric">
      <span class="metric-label">${label}</span>
      <strong>${value}</strong>
      <small>${status.tenant?.name || "Tenant"}</small>
    </article>
  `).join("");

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
    }))
  ];
  renderList("goLiveRows", goLiveRows, row => `
    <div class="data-row kpi-open">
      <strong>${row.group} - ${row.label}</strong>
      <small>${row.detail || "Nog te vervolledigen voor go-live."}</small>
    </div>
  `, goLive.ok ? "Alle go-live gates staan groen." : "Nog geen go-live gate geladen.");

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
  const status = support.enabled ? "Supporttoegang is open." : "Supporttoegang is gesloten.";
  const detail = support.enabled
    ? `${support.reason || "Geen reden"} - tot ${support.expiresAt || "onbekend"} - door ${support.grantedBy || "onbekend"}`
    : support.endedAt ? `Gesloten op ${support.endedAt} door ${support.endedBy || "onbekend"}` : "Geen actieve toestemming.";
  el("supportAccessStatus").textContent = `${status} ${detail}`;
  el("supportAccessStatus").classList.toggle("bad", !support.enabled);
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
    api(`/api/tenants/${tenantId}/reports`)
  ];
  if (isSuperAdmin()) requests.push(api("/api/admin/tenants"));
  const [status, backups, apiKeys, apiKeyGovernance, goLive, reports, tenants] = await Promise.all(requests);
  state.admin = status.status;
  state.backups = backups.rows || [];
  state.apiKeys = apiKeys.rows || [];
  state.apiKeyGovernance = apiKeyGovernance.governance || null;
  state.goLive = goLive.readiness || {};
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
      body: JSON.stringify({
        reason: data.reason,
        expiresAt: localDateTimeToIso(data.expiresAt)
      })
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
      <small>Demo code: ${result.setup.demoCode}</small>
    `;
    el("mfaVerifyForm").elements.code.value = result.setup.demoCode;
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
    ["Support", portal.status.supportAccess?.enabled ? "Open" : "Gesloten"],
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
  renderSupportTickets();
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
    await refreshSupportTickets(false);
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

function renderSupportTickets() {
  const summary = state.supportTicketSummary || state.portal?.status?.supportTickets || {};
  const cards = [
    ["Totaal", summary.total || 0],
    ["Open", summary.open || 0],
    ["Wachtend", summary.waiting || 0],
    ["Gesloten", summary.closed || 0],
    ["SLA risico", summary.slaRisk || 0],
    ["SLA verlopen", summary.slaBreached || 0],
    ["Kritieke bugs", summary.criticalBugSlaBreached || 0],
    ["Escalaties", (summary.escalations || 0) + (summary.blockers || 0)]
  ];
  el("supportTicketCards").innerHTML = cards.map(([label, value]) => `
    <article class="metric">
      <span class="metric-label">${label}</span>
      <strong>${value}</strong>
      <small>Supporttickets</small>
    </article>
  `).join("");

  renderList("supportTicketRows", state.supportTickets, ticket => `
    <div class="data-row ${ticket.sla?.status === "breached" ? "kpi-open" : ""}">
      <strong>${ticket.title}</strong>
      <small>${ticket.category} - ${ticket.priority} - ${ticket.status} - ${ticket.createdAt}</small>
      <small>SLA: ${ticket.sla?.status || "ok"} - deadline ${shortDateTime(ticket.sla?.deadlineAt)} - ${ticket.sla?.status === "closed" ? "gesloten" : `${ticket.sla?.remainingHours ?? "-"}u resterend`}</small>
      <small>Escalatie: ${ticket.escalation?.label || "Geen escalatie"} - ${ticket.escalation?.reason || "Binnen SLA."}</small>
      <small>${ticket.description || ""}</small>
      <div class="row-actions">
        ${ticket.status === "closed" ? "" : `
          ${ticket.status === "waiting" ? "" : `<button class="small-action" data-wait-ticket="${ticket.id}" type="button">Wachtend</button>`}
          <button class="small-action" data-close-ticket="${ticket.id}" type="button">Sluiten</button>
        `}
      </div>
    </div>
  `, "Nog geen supporttickets.");
  document.querySelectorAll("[data-wait-ticket]").forEach(button => {
    button.addEventListener("click", () => updateSupportTicket(button.dataset.waitTicket, { status: "waiting", comment: "Wacht op klant of externe input" }));
  });
  document.querySelectorAll("[data-close-ticket]").forEach(button => {
    button.addEventListener("click", () => updateSupportTicket(button.dataset.closeTicket, { status: "closed", comment: "Gesloten via portal" }));
  });
}

async function refreshSupportTickets(render = true) {
  if (!token) return;
  const result = await api(`/api/tenants/${tenantId}/support-tickets`);
  state.supportTickets = result.rows || [];
  state.supportTicketSummary = result.summary || {};
  if (render) renderSupportTickets();
}

async function createSupportTicket(form) {
  if (!token) return;
  try {
    await api(`/api/tenants/${tenantId}/support-tickets`, {
      method: "POST",
      body: JSON.stringify(formData(form))
    });
    form.reset();
    await refreshPortal();
  } catch (error) {
    setText("portalIntro", error.message);
  }
}

async function updateSupportTicket(ticketId, patch) {
  try {
    await api(`/api/tenants/${tenantId}/support-tickets/${ticketId}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    await refreshPortal();
  } catch (error) {
    setText("portalIntro", error.message);
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
      api(`/api/modules/sales?tenantId=${tenantId}`),
      api(`/api/modules/partners?tenantId=${tenantId}`),
      api(`/api/tenants/${tenantId}/sales/summary`),
      api(`/api/tenants/${tenantId}/sales/readiness`)
    ]);
    state.sales = rowsResult.rows || [];
    state.partners = partnersResult.rows || [];
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
    await api(`/api/modules/sales?tenantId=${tenantId}`, {
      method: "POST",
      body: JSON.stringify({ ...data, stage: "qualified_lead", source: data.partnerId ? "partner" : "demo_booking" })
    });
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
    await api(`/api/modules/partners?tenantId=${tenantId}`, {
      method: "POST",
      body: JSON.stringify(formData(form))
    });
    form.reset();
    await refreshSales();
  } catch (error) {
    setText("salesIntro", error.message);
  }
}

async function updatePartnerStatus(partnerId, status) {
  if (!token) return;
  try {
    await api(`/api/modules/partners/${partnerId}?tenantId=${tenantId}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
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

function mobilePayload(action) {
  if (action === "photo") return { name: `werf-foto-${Date.now()}.jpg`, type: "image/jpeg", size: 420000 };
  if (action === "signature") return { signerName: "Klant akkoord" };
  return { note: "Afgerond via mobiele flow" };
}

function queueId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `queue_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function mobileWorkorderAction(workorderId, action) {
  const queued = { id: queueId(), workorderId, action, payload: mobilePayload(action), at: new Date().toISOString(), attempts: 0 };
  if (!navigator.onLine) {
    state.queue.push(queued);
    saveQueue();
    setText("mobileIntro", "Geen verbinding. Actie lokaal bewaard voor sync.");
    return;
  }
  try {
    await api(`/api/tenants/${tenantId}/mobile/workorders/${workorderId}/${action}`, {
      method: "POST",
      body: JSON.stringify(queued.payload)
    });
    setText("mobileIntro", "Mobiele actie opgeslagen.");
    await refreshMobile();
    await refresh();
  } catch (error) {
    state.queue.push(queued);
    saveQueue();
    setText("mobileIntro", `Actie in offline wachtrij geplaatst: ${error.message}`);
  }
}

async function syncQueue() {
  if (!token || !navigator.onLine || !state.queue.length) return;
  const pending = state.queue.map(item => ({ ...item, id: item.id || queueId(), attempts: Number(item.attempts || 0) + 1 }));
  state.queue = [];
  saveQueue();
  try {
    const result = await api(`/api/tenants/${tenantId}/mobile/sync`, {
      method: "POST",
      body: JSON.stringify({ items: pending })
    });
    const failedIds = new Set((result.sync?.results || []).filter(row => !row.ok).map(row => row.id));
    state.queue = pending.filter(item => failedIds.has(item.id));
    saveQueue();
    const processed = result.sync?.processed || 0;
    const failed = result.sync?.failed || 0;
    setText("mobileIntro", failed
      ? `${processed} mobiele acties gesynchroniseerd, ${failed} blijven in de wachtrij.`
      : `${processed} mobiele acties gesynchroniseerd.`);
  } catch (error) {
    state.queue = pending;
    saveQueue();
    setText("mobileIntro", `Sync tijdelijk niet gelukt: ${error.message}`);
    return;
  }
  if (!state.queue.length) await refreshMobile();
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
    return;
  }
  try {
    const payload = mapper(formData(form));
    await api(`/api/modules/${key}?tenantId=${tenantId}`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
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
      body: JSON.stringify({ csv: data.csv, defaultPassword: "Welkom123!" })
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
    await api(`/api/modules/users/${data.userId}?tenantId=${tenantId}`, {
      method: "PATCH",
      body: JSON.stringify({ role: data.role, permissions })
    });
    setNotice("Rollen en rechten zijn opgeslagen.");
    await refreshOps();
    await refresh();
  } catch (error) {
    setNotice(error.message, false);
  }
}

async function createSetupIntent() {
  if (!token) {
    setBillingNotice("Login eerst met de demo admin.", false);
    return;
  }
  const result = await api(`/api/tenants/${tenantId}/billing/setup-intent`, { method: "POST", body: "{}" });
  setBillingNotice(`SetupIntent klaar: ${result.setupIntent.status}`);
}

async function submitBilling(form, endpoint, successMessage) {
  if (!token) {
    setBillingNotice("Login eerst met de demo admin.", false);
    return;
  }
  try {
    await api(endpoint, { method: "POST", body: JSON.stringify(formData(form)) });
    form.reset();
    setBillingNotice(successMessage);
    await refreshBilling();
  } catch (error) {
    setBillingNotice(error.message, false);
  }
}

async function transitionContract(form) {
  if (!token) {
    setBillingNotice("Login eerst met de demo admin.", false);
    return;
  }
  try {
    const result = await api(`/api/tenants/${tenantId}/billing/contract-state`, {
      method: "POST",
      body: JSON.stringify(formData(form))
    });
    setBillingNotice(`Contractstatus: ${result.result.event.from} naar ${result.result.event.to}`);
    await refreshBilling();
    await refreshPortal();
  } catch (error) {
    setBillingNotice(error.message, false);
  }
}

async function sendPeppolInvoice(invoiceId) {
  try {
    const result = await api(`/api/tenants/${tenantId}/billing/peppol/${invoiceId}`, { method: "POST", body: "{}" });
    setBillingNotice(result.result.event.ok ? "Peppol status bijgewerkt." : `Peppol fout: ${result.result.event.message}`, result.result.event.ok);
    await refreshBilling();
  } catch (error) {
    setBillingNotice(error.message, false);
  }
}

async function markPaymentFailed(invoiceId) {
  try {
    await api(`/api/tenants/${tenantId}/billing/payment-failed`, {
      method: "POST",
      body: JSON.stringify({ invoiceId, reason: "Stripe test failure" })
    });
    setBillingNotice("Failed payment geregistreerd.");
    await refreshBilling();
  } catch (error) {
    setBillingNotice(error.message, false);
  }
}

async function processGdprRequest(requestId) {
  try {
    await api(`/api/tenants/${tenantId}/compliance/gdpr-requests/${requestId}/process`, { method: "POST", body: "{}" });
    setBillingNotice("GDPR verzoek verwerkt.");
    await refreshBilling();
    await refreshAdmin();
  } catch (error) {
    setBillingNotice(error.message, false);
  }
}

async function advanceDunning(paymentId, action) {
  try {
    await api(`/api/tenants/${tenantId}/billing/failed-payments/${paymentId}/dunning`, {
      method: "POST",
      body: JSON.stringify({ action, note: `Actie via billing scherm: ${action}` })
    });
    setBillingNotice(`Dunning actie verwerkt: ${action}`);
    await refreshBilling();
    await refreshPortal();
  } catch (error) {
    setBillingNotice(error.message, false);
  }
}

async function loginAs(email, password, intro) {
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

el("login").addEventListener("click", () => {
  loginAs("admin@demobouw.be", "admin123", "Demo admin is ingelogd. Je test nu tenant-isolatie, rechten, audit en de golden path via echte endpoints.");
});

el("loginSuper").addEventListener("click", () => {
  loginAs("super@workflowpro.be", "admin123", "Super admin is ingelogd. Je kan nu tenants aanmaken, pauzeren en activeren.");
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
    password: "Welkom123!",
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

el("viewDemo").addEventListener("click", () => setView("demo"));
el("viewPlanning").addEventListener("click", () => setView("planning"));
el("viewWorkorders").addEventListener("click", () => setView("workorders"));
el("viewOps").addEventListener("click", () => setView("ops"));
el("viewBilling").addEventListener("click", () => setView("billing"));
el("viewMobile").addEventListener("click", () => setView("mobile"));
el("viewIntegrations").addEventListener("click", () => setView("integrations"));
el("viewNotifications").addEventListener("click", () => setView("notifications"));
el("viewAdmin").addEventListener("click", () => setView("admin"));
el("viewPortal").addEventListener("click", () => setView("portal"));
el("viewSales").addEventListener("click", () => setView("sales"));
el("viewStatus").addEventListener("click", () => setView("status"));
el("viewJson").addEventListener("click", () => setView("json"));
el("viewApi").addEventListener("click", () => setView("api"));
el("refreshJson").addEventListener("click", refreshJson);
el("refreshStatus").addEventListener("click", refreshStatus);
el("aiSuggestionPrimary").addEventListener("click", () => runAiSuggestionAction(state.aiSuggestion?.primary));
el("aiSuggestionSecondary").addEventListener("click", () => runAiSuggestionAction(state.aiSuggestion?.secondary));
el("refreshOps").addEventListener("click", refreshOps);
el("refreshBilling").addEventListener("click", refreshBilling);
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
el("refreshSupportTickets").addEventListener("click", () => refreshSupportTickets(true));
el("generateDecisionReport").addEventListener("click", generateDecisionReport);
el("supportTicketForm").addEventListener("submit", event => {
  event.preventDefault();
  createSupportTicket(event.currentTarget);
});
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
document.querySelectorAll("[data-export]").forEach(button => {
  button.addEventListener("click", () => downloadExport(button.dataset.export));
});
document.querySelectorAll("[data-jump-view]").forEach(button => {
  button.addEventListener("click", () => setView(button.dataset.jumpView));
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js")
    .then(() => {
      setText("pwaStatus", "Actief");
      setText("pwaDetail", "Service worker geregistreerd");
    })
    .catch(() => {
      setText("pwaStatus", "Niet actief");
      setText("pwaDetail", "Service worker kon niet registreren");
    });
}

window.addEventListener("online", syncQueue);

el("planningForm").elements.date.value = todayValue();
el("apiKeyExpiresAt").value = futureDateValue(90);
saveQueue();
refresh();
