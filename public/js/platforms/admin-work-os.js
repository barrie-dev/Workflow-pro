/* ============================================================
   Monargo One – Work OS workspace
   Taken, formulieren, bestanden en contextuele communicatie.
   ============================================================ */
(function () {
  "use strict";

  const A = window.wfpAdmin;
  if (!A) return;

  const api = A.api;
  const esc = A.esc;
  const TASK_COLUMNS = [
    { key: "open", label: "Open", hint: "Nog te starten" },
    { key: "in_progress", label: "Bezig", hint: "Wordt uitgevoerd" },
    { key: "blocked", label: "Geblokkeerd", hint: "Wacht op actie" },
    { key: "done", label: "Afgerond", hint: "Klaar of geannuleerd" },
  ];
  const TASK_TRANSITIONS = {
    open: ["in_progress", "blocked", "done", "cancelled"],
    in_progress: ["blocked", "done", "open", "cancelled"],
    blocked: ["in_progress", "open", "cancelled"],
    done: ["open"],
    cancelled: ["open"],
  };
  const QUESTION_TYPES = [
    ["text", "Korte tekst"], ["number", "Getal"], ["bool", "Ja / nee"],
    ["choice", "Eén keuze"], ["multichoice", "Meerdere keuzes"],
    ["date", "Datum"], ["photo", "Foto"], ["signature", "Ondertekening"],
  ];
  const CONTEXT_TYPES = [
    ["tenant", "Organisatie"], ["customer", "Klant"], ["workorder", "Werkbon"],
    ["project", "Project"], ["venue", "Locatie / werf"], ["employee", "Medewerker"],
  ];
  const ALLOWED_FILE_TYPES = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.txt,.csv,.xlsx,.docx,.doc,.xls";

  let activeTab = "tasks";
  let formsSection = "templates";
  let taskFilter = "active";
  let taskSearch = "";
  let fileSearch = "";
  let communicationFilter = "all";
  let contextCatalog = null;
  let currentData = null;

  function fmtDate(value) {
    if (!value) return "Geen datum";
    const date = new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "short", year: "numeric" }).format(date);
  }

  function fmtDateTime(value) {
    if (!value) return "–";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function bytes(value) {
    const size = Number(value || 0);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
    return `${Math.round(size / 1024 / 102.4) / 10} MB`;
  }

  function todayIso() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function statusLabel(status) {
    return ({
      open: "Open", in_progress: "Bezig", blocked: "Geblokkeerd", done: "Afgerond", cancelled: "Geannuleerd",
      draft: "Concept", filled: "Ingevuld", submitted: "Ingediend", locked: "Vergrendeld",
      published: "Gepubliceerd", archived: "Gearchiveerd", sent: "Vastgelegd",
    })[status] || status || "Onbekend";
  }

  function statusTone(status) {
    if (["done", "published", "submitted", "sent"].includes(status)) return "success";
    if (["blocked", "archived", "cancelled"].includes(status)) return "danger";
    if (["in_progress", "filled"].includes(status)) return "info";
    if (status === "locked") return "neutral";
    return "warning";
  }

  function priorityLabel(priority) {
    return ({ laag: "Laag", normaal: "Normaal", hoog: "Hoog", urgent: "Urgent" })[priority] || "Normaal";
  }

  async function safeGet(path, fallback) {
    try { return await api("GET", path); }
    catch (error) { return { ...fallback, _error: error.message }; }
  }

  function rowsOf(data, keys) {
    for (const key of keys) if (Array.isArray(data && data[key])) return data[key];
    return Array.isArray(data) ? data : [];
  }

  function contextTypeLabel(type) {
    return (CONTEXT_TYPES.find(row => row[0] === type) || [null, type || "Dossier"])[1];
  }

  function recordLabel(type, row) {
    if (type === "customer") return row.name || row.companyName || row.email || "Klant";
    if (type === "workorder") return [row.number, row.title || row.description].filter(Boolean).join(" · ") || "Werkbon";
    if (type === "project") return [row.number, row.name].filter(Boolean).join(" · ") || "Project";
    if (type === "venue") return row.name || row.address || "Locatie";
    if (type === "employee") return row.name || row.email || "Medewerker";
    return row.label || row.name || "Organisatie";
  }

  async function loadContextCatalog(force) {
    if (contextCatalog && !force) return contextCatalog;
    const [employees, customers, workorders, projects, venues] = await Promise.all([
      safeGet("/employees?includeInactive=false", { employees: [] }),
      safeGet("/customers", { customers: [] }),
      safeGet("/workorders", { workorders: [] }),
      safeGet("/projects", { projects: [] }),
      safeGet("/venues", { venues: [] }),
    ]);
    contextCatalog = {
      tenant: [{ id: A.tenantId(), label: "Mijn organisatie" }],
      customer: rowsOf(customers, ["customers"]),
      workorder: rowsOf(workorders, ["workorders"]),
      project: rowsOf(projects, ["projects"]),
      venue: rowsOf(venues, ["venues"]),
      employee: rowsOf(employees, ["employees"]).filter(row => row.active !== false),
    };
    return contextCatalog;
  }

  function contextLabel(context) {
    if (!context || !context.entityType) return "Geen dossiercontext";
    const rows = (contextCatalog && contextCatalog[context.entityType]) || [];
    const found = rows.find(row => String(row.id) === String(context.entityId));
    return found ? `${contextTypeLabel(context.entityType)} · ${recordLabel(context.entityType, found)}` : contextTypeLabel(context.entityType);
  }

  function contextValueControl(type, value, prefix, allowNone) {
    const rows = (contextCatalog && contextCatalog[type]) || [];
    if (!type && allowNone) return `<input name="${prefix}Id" value="" disabled placeholder="Geen gerelateerd dossier">`;
    if (rows.length) return `<select name="${prefix}Id" required>
      <option value="">Kies ${esc(contextTypeLabel(type).toLowerCase())}…</option>
      ${rows.map(row => `<option value="${esc(row.id)}" ${String(row.id) === String(value || "") ? "selected" : ""}>${esc(recordLabel(type, row))}</option>`).join("")}
    </select>`;
    return `<input name="${prefix}Id" value="${esc(value || "")}" placeholder="Dossierreferentie" ${allowNone ? "" : "required"}>`;
  }

  function contextPicker(context, prefix, label, allowNone, allowedTypes) {
    const allowed = (allowedTypes && allowedTypes.length ? allowedTypes : CONTEXT_TYPES.map(row => row[0]));
    const currentType = context && allowed.includes(context.entityType) ? context.entityType : (allowNone ? "" : allowed[0]);
    return `<div class="workos-context-picker" data-context-picker="${esc(prefix)}">
      <div class="adm-form-group"><label>${esc(label)}</label><select name="${prefix}Type" data-context-type="${esc(prefix)}" ${allowNone ? "" : "required"}>
        ${allowNone ? '<option value="">Geen extra relatie</option>' : ""}
        ${allowed.map(type => `<option value="${esc(type)}" ${type === currentType ? "selected" : ""}>${esc(contextTypeLabel(type))}</option>`).join("")}
      </select></div>
      <div class="adm-form-group" data-context-target="${esc(prefix)}"><label>Gekoppeld dossier</label>${contextValueControl(currentType, context && context.entityId, prefix, allowNone)}</div>
    </div>`;
  }

  function bindContextPicker(root, prefix, allowNone) {
    const type = root.querySelector(`[name="${prefix}Type"]`);
    const target = root.querySelector(`[data-context-target="${prefix}"]`);
    if (!type || !target) return;
    type.addEventListener("change", () => {
      target.innerHTML = `<label>Gekoppeld dossier</label>${contextValueControl(type.value, "", prefix, allowNone)}`;
    });
  }

  function readContext(form, prefix, required) {
    const type = form.elements[`${prefix}Type`]?.value || "";
    const id = form.elements[`${prefix}Id`]?.value || "";
    if (!type || !id) return required ? { entityType: type, entityId: id } : null;
    return { entityType: type, entityId: id };
  }

  function setEditor({ title, context, body, kind = "workos" }) {
    document.getElementById("admDrawerTitle").textContent = title;
    document.getElementById("admDrawerContext").textContent = context || "Werkruimte";
    document.getElementById("admDrawerBody").innerHTML = body;
    A.openDrawer();
    document.getElementById("admDrawer").dataset.editorKind = kind;
  }

  function inlineError(error) {
    return `<div class="workos-inline-error" role="alert">${esc(error || "Er ging iets mis.")}</div>`;
  }

  async function loadWorkOsData() {
    const [tasksData, templateData, instanceData, fileData, communicationData] = await Promise.all([
      safeGet("/tasks", { tasks: [] }),
      safeGet("/forms/templates", { templates: [] }),
      safeGet("/forms/instances", { instances: [] }),
      safeGet("/docfiles", { files: [] }),
      safeGet("/communications", { communications: [] }),
    ]);
    return {
      tasks: rowsOf(tasksData, ["tasks"]),
      templates: rowsOf(templateData, ["templates"]),
      instances: rowsOf(instanceData, ["instances"]),
      files: rowsOf(fileData, ["files"]),
      communications: rowsOf(communicationData, ["communications"]),
      errors: [tasksData._error, templateData._error, instanceData._error, fileData._error, communicationData._error].filter(Boolean),
    };
  }

  function activeTasks(tasks) { return tasks.filter(task => !["done", "cancelled"].includes(task.status)); }
  function overdueTasks(tasks) { const today = todayIso(); return activeTasks(tasks).filter(task => task.dueDate && task.dueDate < today); }

  function shellHtml(data) {
    const open = activeTasks(data.tasks).length;
    const overdue = overdueTasks(data.tasks).length;
    return `<div class="workos-workspace">
      <section class="workos-hero">
        <div><span class="workos-eyebrow">Work OS · contextueel samenwerken</span><h2>Alles rond het werk, op één plek.</h2><p>Taken, formulieren, bewijsstukken en contactmomenten blijven gekoppeld aan het juiste dossier.</p></div>
        <div class="workos-hero-actions" aria-label="Snel aanmaken">
          <button type="button" class="adm-btn adm-btn-primary" id="workOsNewTask">Nieuwe taak</button>
          <button type="button" class="adm-btn adm-btn-secondary" id="workOsNewTemplate">Formulier ontwerpen</button>
          <button type="button" class="adm-btn adm-btn-secondary" id="workOsUploadFile">Bestand uploaden</button>
          <button type="button" class="adm-btn adm-btn-secondary" id="workOsNewCommunication">Contactmoment</button>
        </div>
      </section>
      ${data.errors.length ? `<div class="workos-service-note"><span>!</span><p>Niet alle onderdelen konden laden. ${esc(data.errors[0])}</p></div>` : ""}
      <section class="workos-summary" aria-label="Werkruimte overzicht">
        <button type="button" data-workos-tab="tasks"><span>Open taken</span><strong>${open}</strong><small>${overdue ? `${overdue} over tijd` : "Planning onder controle"}</small></button>
        <button type="button" data-workos-tab="forms"><span>Formulieren</span><strong>${data.instances.length}</strong><small>${data.templates.filter(row => row.status === "published").length} gepubliceerd</small></button>
        <button type="button" data-workos-tab="files"><span>Bestanden</span><strong>${data.files.length}</strong><small>${data.files.reduce((sum, row) => sum + Number(row.currentVersion || 1), 0)} versies bewaard</small></button>
        <button type="button" data-workos-tab="communications"><span>Tijdlijn</span><strong>${data.communications.length}</strong><small>Traceerbare contactmomenten</small></button>
      </section>
      <nav class="workos-tabs" aria-label="Werkruimte onderdelen">
        ${[["tasks", "Taken", open], ["forms", "Formulieren", data.instances.length], ["files", "Bestanden", data.files.length], ["communications", "Tijdlijn", data.communications.length]].map(([key, label, count]) => `<button type="button" data-workos-tab="${key}" class="${activeTab === key ? "active" : ""}" aria-current="${activeTab === key ? "page" : "false"}"><span>${label}</span><small>${count}</small></button>`).join("")}
      </nav>
      <section id="workOsPanel" class="workos-panel"></section>
    </div>`;
  }

  function renderPanel() {
    const panel = document.getElementById("workOsPanel");
    if (!panel || !currentData) return;
    if (activeTab === "tasks") panel.innerHTML = tasksPanelHtml(currentData.tasks);
    if (activeTab === "forms") panel.innerHTML = formsPanelHtml(currentData.templates, currentData.instances);
    if (activeTab === "files") panel.innerHTML = filesPanelHtml(currentData.files);
    if (activeTab === "communications") panel.innerHTML = communicationsPanelHtml(currentData.communications);
    bindPanel();
  }

  function bindPanel() {
    if (activeTab === "tasks") bindTasksPanel();
    if (activeTab === "forms") bindFormsPanel();
    if (activeTab === "files") bindFilesPanel();
    if (activeTab === "communications") bindCommunicationsPanel();
  }

  async function renderWorkOs() {
    const content = A.content();
    content.innerHTML = `<div class="adm-loading"><div class="adm-spinner"></div>Werkruimte samenstellen…</div>`;
    await loadContextCatalog();
    currentData = await loadWorkOsData();
    content.innerHTML = shellHtml(currentData);
    content.querySelectorAll("[data-workos-tab]").forEach(button => button.addEventListener("click", () => {
      activeTab = button.dataset.workosTab;
      content.querySelectorAll(".workos-tabs [data-workos-tab]").forEach(tab => {
        tab.classList.toggle("active", tab.dataset.workosTab === activeTab);
        tab.setAttribute("aria-current", tab.dataset.workosTab === activeTab ? "page" : "false");
      });
      renderPanel();
    }));
    document.getElementById("workOsNewTask")?.addEventListener("click", () => { activeTab = "tasks"; openTaskEditor(null); });
    document.getElementById("workOsNewTemplate")?.addEventListener("click", () => { activeTab = "forms"; formsSection = "templates"; openTemplateEditor(null); });
    document.getElementById("workOsUploadFile")?.addEventListener("click", () => { activeTab = "files"; openFileUpload(); });
    document.getElementById("workOsNewCommunication")?.addEventListener("click", () => { activeTab = "communications"; openCommunicationEditor(); });
    renderPanel();
  }

  // ── Taken ────────────────────────────────────────────────────────────────
  function taskMatches(task) {
    const me = window._wfpCurrentUser && window._wfpCurrentUser.id;
    const today = todayIso();
    if (taskFilter === "active" && ["done", "cancelled"].includes(task.status)) return false;
    if (taskFilter === "mine" && (!me || String(task.assigneeId) !== String(me))) return false;
    if (taskFilter === "overdue" && (!task.dueDate || task.dueDate >= today || ["done", "cancelled"].includes(task.status))) return false;
    if (taskFilter === "done" && !["done", "cancelled"].includes(task.status)) return false;
    const query = taskSearch.trim().toLowerCase();
    return !query || [task.title, task.description, contextLabel(task.context), (task.tags || []).join(" ")].join(" ").toLowerCase().includes(query);
  }

  function taskCardHtml(task) {
    const isDone = ["done", "cancelled"].includes(task.status);
    const overdue = !isDone && task.dueDate && task.dueDate < todayIso();
    const assignee = ((contextCatalog && contextCatalog.employee) || []).find(row => String(row.id) === String(task.assigneeId));
    const next = task.status === "open" ? ["in_progress", "Start"] : task.status === "in_progress" ? ["done", "Afronden"] : task.status === "blocked" ? ["in_progress", "Hervatten"] : ["open", "Heropenen"];
    return `<article class="workos-task-card priority-${esc(task.priority || "normaal")}" data-task-card="${esc(task.id)}">
      <button type="button" class="workos-task-main" data-task-open="${esc(task.id)}">
        <span class="workos-task-meta"><i>${esc(priorityLabel(task.priority))}</i>${overdue ? "<b>Over tijd</b>" : ""}</span>
        <strong>${esc(task.title)}</strong>
        <p>${esc(task.description || "Geen extra omschrijving")}</p>
        <span class="workos-context-line">${esc(contextLabel(task.context))}</span>
        <span class="workos-task-footer"><span>${esc(assignee ? recordLabel("employee", assignee) : "Nog toe te wijzen")}</span><time>${esc(task.dueDate ? fmtDate(task.dueDate) : "Geen deadline")}</time></span>
      </button>
      <button type="button" class="workos-task-next" data-task-transition="${esc(task.id)}" data-status="${next[0]}">${next[1]}</button>
    </article>`;
  }

  function tasksPanelHtml(tasks) {
    const filtered = tasks.filter(taskMatches);
    return `<div class="workos-panel-head"><div><span>Dagelijks werk</span><h3>Taken die vooruit helpen</h3><p>Elke taak heeft één duidelijke hoofdcontext, eigenaar en volgende stap.</p></div><button type="button" class="adm-btn adm-btn-primary" id="workOsPanelNewTask">Nieuwe taak</button></div>
      <div class="workos-toolbar">
        <label class="workos-search"><span class="sr-only">Taken zoeken</span><input id="workOsTaskSearch" type="search" value="${esc(taskSearch)}" placeholder="Zoek titel, context of label…"></label>
        <div class="workos-filter-chips" aria-label="Taakfilter">${[["active", "Actief"], ["mine", "Van mij"], ["overdue", "Over tijd"], ["done", "Afgerond"], ["all", "Alles"]].map(([key, label]) => `<button type="button" data-task-filter="${key}" class="${taskFilter === key ? "active" : ""}">${label}</button>`).join("")}</div>
      </div>
      <div class="workos-task-board">
        ${TASK_COLUMNS.map(column => {
          const rows = filtered.filter(task => column.key === "done" ? ["done", "cancelled"].includes(task.status) : task.status === column.key);
          return `<section class="workos-task-column" data-task-column="${column.key}"><header><div><h4>${column.label}</h4><p>${column.hint}</p></div><span>${rows.length}</span></header><div>${rows.map(taskCardHtml).join("") || `<div class="workos-column-empty">Geen taken in deze fase.</div>`}</div></section>`;
        }).join("")}
      </div>`;
  }

  function bindTasksPanel() {
    document.getElementById("workOsPanelNewTask")?.addEventListener("click", () => openTaskEditor(null));
    document.getElementById("workOsTaskSearch")?.addEventListener("input", event => { taskSearch = event.target.value; renderPanel(); document.getElementById("workOsTaskSearch")?.focus(); });
    document.querySelectorAll("[data-task-filter]").forEach(button => button.addEventListener("click", () => { taskFilter = button.dataset.taskFilter; renderPanel(); }));
    document.querySelectorAll("[data-task-open]").forEach(button => button.addEventListener("click", () => openTaskEditor(currentData.tasks.find(task => task.id === button.dataset.taskOpen))));
    document.querySelectorAll("[data-task-transition]").forEach(button => button.addEventListener("click", async () => {
      const old = button.textContent; button.disabled = true; button.textContent = "Bijwerken…";
      try { await api("POST", `/tasks/${button.dataset.taskTransition}/transition`, { status: button.dataset.status }); await renderWorkOs(); }
      catch (error) { window.showToast && window.showToast(error.message, "error"); button.disabled = false; button.textContent = old; }
    }));
  }

  async function openTaskEditor(task) {
    await loadContextCatalog();
    const employees = (contextCatalog.employee || []).filter(row => row.active !== false);
    const relation = (task && task.relations && task.relations[0]) || null;
    setEditor({
      title: task ? "Taak bijwerken" : "Nieuwe taak",
      context: task ? contextLabel(task.context) : "Taakwerkruimte",
      body: `<form id="workOsTaskForm" class="workos-editor-form">
        <div class="workos-editor-intro"><span>T</span><div><h3>${task ? "Breng de volgende stap scherp" : "Maak werk meteen uitvoerbaar"}</h3><p>Een duidelijke titel, één primaire context en een eigenaar voorkomen losse taken zonder dossier.</p></div></div>
        <div class="adm-form-row"><div class="adm-form-group"><label>Titel</label><input name="title" value="${esc(task && task.title || "")}" required autofocus placeholder="Wat moet er gebeuren?"></div><div class="adm-form-group"><label>Type</label><input name="type" value="${esc(task && task.type || "algemeen")}" placeholder="bv. opvolging, keuring, administratie"></div></div>
        <div class="adm-form-group"><label>Omschrijving</label><textarea name="description" rows="4" placeholder="Welke uitkomst verwacht je?">${esc(task && task.description || "")}</textarea></div>
        <div class="adm-form-row"><div class="adm-form-group"><label>Prioriteit</label><select name="priority">${["laag", "normaal", "hoog", "urgent"].map(value => `<option value="${value}" ${(task && task.priority || "normaal") === value ? "selected" : ""}>${priorityLabel(value)}</option>`).join("")}</select></div><div class="adm-form-group"><label>Deadline</label><input name="dueDate" type="date" value="${esc(task && task.dueDate || "")}"></div></div>
        <div class="adm-form-group"><label>Eigenaar</label><select name="assigneeId"><option value="">Nog toe te wijzen</option>${employees.map(row => `<option value="${esc(row.id)}" ${String(task && task.assigneeId || "") === String(row.id) ? "selected" : ""}>${esc(recordLabel("employee", row))}</option>`).join("")}</select></div>
        <div class="adm-form-section">Dossiercontext</div>
        ${contextPicker(task && task.context || { entityType: "tenant", entityId: A.tenantId() }, "taskContext", "Primaire context", false)}
        ${contextPicker(relation, "taskRelation", "Optionele relatie", true)}
        <div class="adm-form-group"><label>Labels</label><input name="tags" value="${esc((task && task.tags || []).join(", "))}" placeholder="bv. dringend, klantbelofte, werf"><div class="adm-form-hint">Scheid labels met een komma.</div></div>
        <div id="workOsTaskError" hidden></div>
        <div class="adm-form-actions workos-editor-actions">
          ${task ? `<button type="button" class="adm-btn adm-btn-ghost workos-danger-action" id="workOsDeleteTask">Taak verwijderen</button>` : ""}
          <span></span><button type="button" class="adm-btn adm-btn-secondary" id="workOsTaskCancel">Annuleren</button>
          ${task ? `<select id="workOsTaskStatus" aria-label="Taakstatus"><option value="">Status wijzigen…</option>${(TASK_TRANSITIONS[task.status] || []).map(value => `<option value="${value}">${statusLabel(value)}</option>`).join("")}</select>` : ""}
          <button type="submit" class="adm-btn adm-btn-primary">${task ? "Wijzigingen opslaan" : "Taak aanmaken"}</button>
        </div>
      </form>`,
    });
    const form = document.getElementById("workOsTaskForm");
    bindContextPicker(form, "taskContext", false);
    bindContextPicker(form, "taskRelation", true);
    document.getElementById("workOsTaskCancel")?.addEventListener("click", A.closeDrawer);
    document.getElementById("workOsTaskStatus")?.addEventListener("change", async event => {
      if (!event.target.value) return;
      event.target.disabled = true;
      try { await api("POST", `/tasks/${task.id}/transition`, { status: event.target.value }); A.closeDrawer(); await renderWorkOs(); }
      catch (error) { document.getElementById("workOsTaskError").hidden = false; document.getElementById("workOsTaskError").innerHTML = inlineError(error.message); event.target.disabled = false; }
    });
    let deleteArmed = false;
    document.getElementById("workOsDeleteTask")?.addEventListener("click", async event => {
      if (!deleteArmed) { deleteArmed = true; event.target.textContent = "Nogmaals klikken om te verwijderen"; setTimeout(() => { deleteArmed = false; if (event.target) event.target.textContent = "Taak verwijderen"; }, 4000); return; }
      event.target.disabled = true;
      try { await api("DELETE", `/tasks/${task.id}`); A.closeDrawer(); await renderWorkOs(); }
      catch (error) { event.target.disabled = false; document.getElementById("workOsTaskError").hidden = false; document.getElementById("workOsTaskError").innerHTML = inlineError(error.message); }
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const submit = event.submitter; const old = submit.textContent;
      const relationContext = readContext(form, "taskRelation", false);
      const payload = {
        title: form.elements.title.value.trim(), type: form.elements.type.value.trim(), description: form.elements.description.value.trim(),
        priority: form.elements.priority.value, dueDate: form.elements.dueDate.value || null, assigneeId: form.elements.assigneeId.value || null,
        context: readContext(form, "taskContext", true), relations: relationContext ? [relationContext] : [],
        tags: form.elements.tags.value.split(",").map(value => value.trim()).filter(Boolean),
      };
      if (task) payload.expectedVersion = task.version;
      submit.disabled = true; submit.textContent = "Opslaan…";
      try { await api(task ? "PATCH" : "POST", task ? `/tasks/${task.id}` : "/tasks", payload); A.closeDrawer(); await renderWorkOs(); window.showToast && window.showToast("Taak opgeslagen", "success"); }
      catch (error) { submit.disabled = false; submit.textContent = old; const box = document.getElementById("workOsTaskError"); box.hidden = false; box.innerHTML = inlineError(error.message); }
    });
  }

  // ── Formulieren ──────────────────────────────────────────────────────────
  function questionCount(template) {
    return (template.sections || []).reduce((sum, section) => sum + (section.questions || []).length, 0);
  }

  function templateCardHtml(template) {
    const canFill = template.status === "published";
    return `<article class="workos-template-card">
      <header><span class="workos-form-mark">F</span><span class="workos-status ${statusTone(template.status)}">${esc(statusLabel(template.status))}</span></header>
      <h4>${esc(template.name)}</h4><p>${esc(template.description || "Geen omschrijving toegevoegd.")}</p>
      <div class="workos-template-meta"><span>v${Number(template.version || 1)}</span><span>${questionCount(template)} vragen</span><span>${(template.appliesTo || []).map(contextTypeLabel).join(", ") || "Alle dossiers"}</span></div>
      <footer>
        <button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" data-template-edit="${esc(template.id)}" ${template.status === "archived" ? "disabled" : ""}>Bewerken</button>
        ${canFill ? `<button type="button" class="adm-btn adm-btn-primary adm-btn-sm" data-template-fill="${esc(template.id)}">Invullen</button>` : ""}
        ${template.status === "draft" ? `<button type="button" class="adm-btn adm-btn-ghost adm-btn-sm" data-template-transition="${esc(template.id)}" data-status="published">Publiceren</button>` : ""}
        ${template.status !== "archived" ? `<button type="button" class="adm-btn adm-btn-ghost adm-btn-sm workos-template-archive" data-template-transition="${esc(template.id)}" data-status="archived">Archiveren</button>` : ""}
      </footer>
    </article>`;
  }

  function instanceCardHtml(instance) {
    const name = instance.templateSnapshot && instance.templateSnapshot.name || instance.templateKey || "Formulier";
    const answered = Object.keys(instance.answers || {}).length;
    const total = questionCount(instance.templateSnapshot || {});
    return `<button type="button" class="workos-instance-row" data-instance-open="${esc(instance.id)}">
      <span class="workos-form-mark compact">F</span><span class="workos-instance-copy"><strong>${esc(name)}</strong><small>${esc(contextLabel(instance.context))} · template v${Number(instance.templateVersion || 1)}</small></span>
      <span class="workos-instance-progress"><b>${answered}/${total}</b><small>beantwoord</small></span>
      <span class="workos-status ${statusTone(instance.status)}">${esc(statusLabel(instance.status))}</span>
      <time>${esc(fmtDateTime(instance.updatedAt || instance.createdAt))}</time><i aria-hidden="true">›</i>
    </button>`;
  }

  function formsPanelHtml(templates, instances) {
    return `<div class="workos-panel-head"><div><span>Gestructureerde informatie</span><h3>Formulieren die mee evolueren</h3><p>Ontwerp één keer, vul contextueel in en bewaar elke gebruikte templateversie.</p></div><button type="button" class="adm-btn adm-btn-primary" id="workOsPanelNewTemplate">Formulier ontwerpen</button></div>
      <div class="workos-subtabs" role="tablist"><button type="button" data-forms-section="templates" class="${formsSection === "templates" ? "active" : ""}">Templates <span>${templates.length}</span></button><button type="button" data-forms-section="instances" class="${formsSection === "instances" ? "active" : ""}">Invullingen <span>${instances.length}</span></button></div>
      ${formsSection === "templates" ? `<div class="workos-template-grid">${templates.map(templateCardHtml).join("") || `<div class="workos-rich-empty"><span>F</span><h4>Nog geen formuliertemplates</h4><p>Bouw een keuring, checklist of opleverformulier met gestructureerde vragen.</p><button type="button" class="adm-btn adm-btn-primary" id="workOsEmptyTemplate">Eerste formulier ontwerpen</button></div>`}</div>` : `<div class="workos-instance-list">${instances.map(instanceCardHtml).join("") || `<div class="workos-rich-empty"><span>✓</span><h4>Nog geen invullingen</h4><p>Publiceer een template en start de eerste contextuele invulling.</p></div>`}</div>`}`;
  }

  function bindFormsPanel() {
    document.querySelectorAll("[data-forms-section]").forEach(button => button.addEventListener("click", () => { formsSection = button.dataset.formsSection; renderPanel(); }));
    document.getElementById("workOsPanelNewTemplate")?.addEventListener("click", () => openTemplateEditor(null));
    document.getElementById("workOsEmptyTemplate")?.addEventListener("click", () => openTemplateEditor(null));
    document.querySelectorAll("[data-template-edit]").forEach(button => button.addEventListener("click", () => openTemplateEditor(currentData.templates.find(row => row.id === button.dataset.templateEdit))));
    document.querySelectorAll("[data-template-fill]").forEach(button => button.addEventListener("click", () => openFormInstanceEditor(null, currentData.templates.find(row => row.id === button.dataset.templateFill))));
    document.querySelectorAll("[data-instance-open]").forEach(button => button.addEventListener("click", () => openFormInstanceEditor(currentData.instances.find(row => row.id === button.dataset.instanceOpen), null)));
    document.querySelectorAll("[data-template-transition]").forEach(button => button.addEventListener("click", async () => {
      if (button.dataset.status === "archived" && button.dataset.armed !== "1") {
        button.dataset.armed = "1"; button.textContent = "Nogmaals klikken";
        setTimeout(() => { if (button) { button.dataset.armed = "0"; button.textContent = "Archiveren"; } }, 4000);
        return;
      }
      const old = button.textContent; button.disabled = true; button.textContent = "Bijwerken…";
      try { await api("POST", `/forms/templates/${button.dataset.templateTransition}/transition`, { status: button.dataset.status }); await renderWorkOs(); }
      catch (error) { window.showToast && window.showToast(error.message, "error"); button.disabled = false; button.textContent = old; }
    }));
  }

  function newBuilderQuestion() { return { id: "", label: "", type: "text", required: false, options: [], helpText: "" }; }
  function newBuilderSection(index) { return { id: `s${index + 1}`, title: `Sectie ${index + 1}`, questions: [newBuilderQuestion()] }; }

  async function openTemplateEditor(template) {
    let sections = JSON.parse(JSON.stringify(template && template.sections && template.sections.length ? template.sections : [newBuilderSection(0)]));
    const applies = new Set(template && template.appliesTo || ["workorder"]);
    setEditor({
      title: template ? "Formulier bijwerken" : "Formulier ontwerpen",
      context: "Formulierdesigner",
      kind: "workos-builder",
      body: `<form id="workOsTemplateForm" class="workos-editor-form workos-builder-form">
        <div class="workos-editor-intro"><span>F</span><div><h3>Maak informatie bruikbaar, niet alleen zichtbaar</h3><p>Verplichte vragen worden bij het indienen gecontroleerd. Bestaande invullingen behouden altijd hun oorspronkelijke templateversie.</p></div></div>
        <div class="workos-builder-basics"><div class="adm-form-group"><label>Naam</label><input name="name" value="${esc(template && template.name || "")}" required autofocus placeholder="bv. Oplevering warmtepomp"></div><div class="adm-form-group"><label>Interne sleutel</label><input value="${esc(template && template.key || "Wordt automatisch aangemaakt")}" disabled></div></div>
        <div class="adm-form-group"><label>Omschrijving</label><textarea name="description" rows="3" placeholder="Wanneer gebruikt je team dit formulier?">${esc(template && template.description || "")}</textarea></div>
        <fieldset class="workos-applies"><legend>Beschikbaar bij</legend>${CONTEXT_TYPES.map(([type, label]) => `<label><input type="checkbox" name="appliesTo" value="${type}" ${applies.has(type) ? "checked" : ""}><span>${esc(label)}</span></label>`).join("")}</fieldset>
        <div class="workos-builder-heading"><div><span>Opbouw</span><h4>Secties en vragen</h4></div><button type="button" class="adm-btn adm-btn-secondary" id="workOsAddSection">Sectie toevoegen</button></div>
        <div id="workOsBuilderSections"></div>
        <div id="workOsTemplateError" hidden></div>
        <div class="adm-form-actions workos-editor-actions"><span></span><button type="button" class="adm-btn adm-btn-secondary" id="workOsTemplateCancel">Annuleren</button><button type="submit" class="adm-btn adm-btn-primary">${template ? "Nieuwe versie opslaan" : "Concept aanmaken"}</button></div>
      </form>`,
    });
    const form = document.getElementById("workOsTemplateForm");
    const host = document.getElementById("workOsBuilderSections");

    const collect = () => {
      sections = [...host.querySelectorAll(".workos-builder-section")].map(section => ({
        id: section.dataset.sectionId || "",
        title: section.querySelector(".workos-section-title").value.trim(),
        questions: [...section.querySelectorAll(".workos-question-row")].map(row => ({
          id: row.dataset.questionId || "", label: row.querySelector(".workos-question-label").value.trim(),
          type: row.querySelector(".workos-question-type").value, required: row.querySelector(".workos-question-required").checked,
          helpText: row.querySelector(".workos-question-help").value.trim(),
          options: row.querySelector(".workos-question-options").value.split("\n").map(value => value.trim()).filter(Boolean),
        })),
      }));
    };

    const paint = () => {
      host.innerHTML = sections.map((section, sectionIndex) => `<section class="workos-builder-section" data-section-index="${sectionIndex}" data-section-id="${esc(section.id || "")}">
        <header><div class="adm-form-group"><label>Sectienaam</label><input class="workos-section-title" value="${esc(section.title || `Sectie ${sectionIndex + 1}`)}" required></div><button type="button" class="workos-icon-button" data-remove-section="${sectionIndex}" aria-label="Sectie verwijderen" ${sections.length === 1 ? "disabled" : ""}>×</button></header>
        <div class="workos-question-list">${(section.questions || []).map((question, questionIndex) => `<article class="workos-question-row" data-question-index="${questionIndex}" data-question-id="${esc(question.id || "")}">
          <span class="workos-question-index">${questionIndex + 1}</span>
          <div class="workos-question-main"><div class="adm-form-group"><label>Vraag</label><input class="workos-question-label" value="${esc(question.label || "")}" placeholder="Wat wil je weten?" required></div><div class="adm-form-group"><label>Hulptekst</label><input class="workos-question-help" value="${esc(question.helpText || "")}" placeholder="Optionele uitleg voor de invuller"></div></div>
          <div class="workos-question-settings"><div class="adm-form-group"><label>Antwoordtype</label><select class="workos-question-type">${QUESTION_TYPES.map(([type, label]) => `<option value="${type}" ${question.type === type ? "selected" : ""}>${label}</option>`).join("")}</select></div><label class="workos-required-toggle"><input type="checkbox" class="workos-question-required" ${question.required ? "checked" : ""}><span>Verplicht</span></label></div>
          <div class="adm-form-group workos-options-field ${["choice", "multichoice"].includes(question.type) ? "" : "hidden"}"><label>Keuzes · één per regel</label><textarea class="workos-question-options" rows="3" placeholder="Goed\nMatig\nSlecht">${esc((question.options || []).join("\n"))}</textarea></div>
          <button type="button" class="workos-icon-button" data-remove-question="${questionIndex}" data-section="${sectionIndex}" aria-label="Vraag verwijderen">×</button>
        </article>`).join("")}</div>
        <button type="button" class="workos-add-question" data-add-question="${sectionIndex}">+ Vraag toevoegen</button>
      </section>`).join("");
      host.querySelectorAll(".workos-question-type").forEach(select => select.addEventListener("change", () => select.closest(".workos-question-row").querySelector(".workos-options-field").classList.toggle("hidden", !["choice", "multichoice"].includes(select.value))));
      host.querySelectorAll("[data-add-question]").forEach(button => button.addEventListener("click", () => { collect(); sections[Number(button.dataset.addQuestion)].questions.push(newBuilderQuestion()); paint(); }));
      host.querySelectorAll("[data-remove-question]").forEach(button => button.addEventListener("click", () => { collect(); const s = sections[Number(button.dataset.section)]; s.questions.splice(Number(button.dataset.removeQuestion), 1); if (!s.questions.length) s.questions.push(newBuilderQuestion()); paint(); }));
      host.querySelectorAll("[data-remove-section]").forEach(button => button.addEventListener("click", () => { collect(); sections.splice(Number(button.dataset.removeSection), 1); paint(); }));
    };
    paint();
    document.getElementById("workOsAddSection").addEventListener("click", () => { collect(); sections.push(newBuilderSection(sections.length)); paint(); });
    document.getElementById("workOsTemplateCancel").addEventListener("click", A.closeDrawer);
    form.addEventListener("submit", async event => {
      event.preventDefault(); collect();
      const box = document.getElementById("workOsTemplateError");
      if (!sections.some(section => section.questions.some(question => question.label))) { box.hidden = false; box.innerHTML = inlineError("Voeg minstens één vraag toe."); return; }
      const badChoice = sections.flatMap(section => section.questions).find(question => ["choice", "multichoice"].includes(question.type) && !question.options.length);
      if (badChoice) { box.hidden = false; box.innerHTML = inlineError(`Voeg keuzeopties toe bij '${badChoice.label || "de keuzevraag"}'.`); return; }
      const submit = event.submitter; const old = submit.textContent; submit.disabled = true; submit.textContent = "Opslaan…";
      const payload = { name: form.elements.name.value.trim(), description: form.elements.description.value.trim(), appliesTo: [...form.querySelectorAll('[name="appliesTo"]:checked')].map(input => input.value), sections };
      try { await api(template ? "PATCH" : "POST", template ? `/forms/templates/${template.id}` : "/forms/templates", payload); A.closeDrawer(); await renderWorkOs(); window.showToast && window.showToast("Formulier opgeslagen", "success"); }
      catch (error) { submit.disabled = false; submit.textContent = old; box.hidden = false; box.innerHTML = inlineError(error.message); }
    });
  }

  function questionInputHtml(question, answer, readonly) {
    const id = `workOsAnswer_${question.id}`;
    if (readonly) {
      const shown = Array.isArray(answer) ? answer.join(", ") : typeof answer === "boolean" ? (answer ? "Ja" : "Nee") : (answer == null || answer === "" ? "Niet ingevuld" : String(answer));
      return `<div class="workos-readonly-answer ${answer == null || answer === "" ? "empty" : ""}">${esc(shown)}</div>`;
    }
    if (question.type === "bool") return `<select id="${esc(id)}" data-answer-control><option value="">Kies…</option><option value="true" ${answer === true ? "selected" : ""}>Ja</option><option value="false" ${answer === false ? "selected" : ""}>Nee</option></select>`;
    if (question.type === "choice") return `<select id="${esc(id)}" data-answer-control><option value="">Kies…</option>${(question.options || []).map(value => `<option value="${esc(value)}" ${String(answer || "") === String(value) ? "selected" : ""}>${esc(value)}</option>`).join("")}</select>`;
    if (question.type === "multichoice") return `<div class="workos-answer-options">${(question.options || []).map(value => `<label><input type="checkbox" value="${esc(value)}" ${(Array.isArray(answer) ? answer : []).includes(value) ? "checked" : ""}><span>${esc(value)}</span></label>`).join("")}</div>`;
    if (question.type === "photo") return `<input id="${esc(id)}" type="file" accept="image/jpeg,image/png,image/webp,image/heic" data-photo-question="${esc(question.id)}"><div class="adm-form-hint">Foto's worden ook als versieerbaar dossierbestand bewaard.${Array.isArray(answer) && answer.length ? ` · ${answer.length} foto('s) aanwezig` : ""}</div>`;
    if (question.type === "signature") return `<input id="${esc(id)}" data-answer-control value="${esc(answer || "")}" placeholder="Naam van de ondertekenaar">`;
    return `<input id="${esc(id)}" data-answer-control type="${question.type === "number" ? "number" : question.type === "date" ? "date" : "text"}" value="${esc(answer == null ? "" : answer)}">`;
  }

  async function fileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").split(",").pop());
      reader.onerror = () => reject(new Error("Het bestand kon niet gelezen worden."));
      reader.readAsDataURL(file);
    });
  }

  async function openFormInstanceEditor(instance, template) {
    await loadContextCatalog();
    const snapshot = instance ? instance.templateSnapshot : template;
    const readonly = instance && ["submitted", "locked"].includes(instance.status);
    const questions = (snapshot.sections || []).flatMap(section => (section.questions || []).map(question => ({ ...question, sectionTitle: section.title })));
    const allowed = ((template && template.appliesTo) || []).filter(type => CONTEXT_TYPES.some(row => row[0] === type));
    const defaultType = allowed[0] || "tenant";
    setEditor({
      title: instance ? (readonly ? "Formulier bekijken" : "Invulling vervolledigen") : "Formulier invullen",
      context: `${snapshot.name || "Formulier"} · v${Number(instance && instance.templateVersion || template && template.version || 1)}`,
      kind: "workos-form",
      body: `<form id="workOsInstanceForm" class="workos-editor-form workos-instance-form">
        <div class="workos-editor-intro"><span>✓</span><div><h3>${esc(snapshot.name || "Formulier")}</h3><p>${readonly ? "Deze invulling is ingediend en blijft als vaste momentopname bewaard." : "Bewaar als concept of dien in wanneer alle verplichte informatie compleet is."}</p></div><span class="workos-status ${statusTone(instance && instance.status || "draft")}">${statusLabel(instance && instance.status || "draft")}</span></div>
        ${instance ? `<div class="workos-context-banner"><span>Gekoppeld aan</span><strong>${esc(contextLabel(instance.context))}</strong></div>` : contextPicker({ entityType: defaultType, entityId: defaultType === "tenant" ? A.tenantId() : "" }, "formContext", "Dossiercontext", false, allowed.length ? allowed : undefined)}
        <div class="workos-instance-sections">${(snapshot.sections || []).map(section => `<section><header><span>Sectie</span><h4>${esc(section.title)}</h4></header>${(section.questions || []).map(question => `<div class="workos-answer-field" data-answer-question="${esc(question.id)}" data-answer-type="${esc(question.type)}"><label for="workOsAnswer_${esc(question.id)}">${esc(question.label)}${question.required ? " <b>*</b>" : ""}</label>${question.helpText ? `<p>${esc(question.helpText)}</p>` : ""}${questionInputHtml(question, instance && instance.answers && instance.answers[question.id], readonly)}</div>`).join("")}</section>`).join("")}</div>
        <div id="workOsInstanceError" hidden></div>
        <div class="adm-form-actions workos-editor-actions"><span></span><button type="button" class="adm-btn adm-btn-secondary" id="workOsInstanceCancel">Sluiten</button>${instance && instance.status === "submitted" ? `<button type="button" class="adm-btn adm-btn-secondary" id="workOsInstanceLock">Definitief vergrendelen</button>` : ""}${readonly ? "" : `<button type="submit" class="adm-btn adm-btn-secondary" data-instance-mode="save">Concept bewaren</button><button type="submit" class="adm-btn adm-btn-primary" data-instance-mode="submit">Indienen</button>`}</div>
      </form>`,
    });
    const form = document.getElementById("workOsInstanceForm");
    if (!instance) bindContextPicker(form, "formContext", false);
    document.getElementById("workOsInstanceCancel").addEventListener("click", A.closeDrawer);
    document.getElementById("workOsInstanceLock")?.addEventListener("click", async event => {
      event.target.disabled = true; event.target.textContent = "Vergrendelen…";
      try { await api("POST", `/forms/instances/${instance.id}/lock`, {}); A.closeDrawer(); await renderWorkOs(); }
      catch (error) { const box = document.getElementById("workOsInstanceError"); box.hidden = false; box.innerHTML = inlineError(error.message); event.target.disabled = false; event.target.textContent = "Definitief vergrendelen"; }
    });
    if (readonly) return;
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const mode = event.submitter.dataset.instanceMode;
      const submit = event.submitter; const old = submit.textContent; submit.disabled = true; submit.textContent = mode === "submit" ? "Indienen…" : "Bewaren…";
      const answers = {};
      form.querySelectorAll("[data-answer-question]").forEach(field => {
        const id = field.dataset.answerQuestion, type = field.dataset.answerType;
        if (type === "photo") return;
        if (type === "multichoice") { const values = [...field.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value); if (values.length) answers[id] = values; return; }
        const control = field.querySelector("[data-answer-control]");
        if (!control || control.value === "") return;
        answers[id] = type === "bool" ? control.value === "true" : type === "number" ? Number(control.value) : control.value;
      });
      const context = instance ? instance.context : readContext(form, "formContext", true);
      const box = document.getElementById("workOsInstanceError");
      try {
        let saved = instance;
        if (!saved) saved = (await api("POST", "/forms/instances", { templateId: template.id, context, answers })).instance;
        else saved = (await api("PATCH", `/forms/instances/${saved.id}`, { answers })).instance;
        for (const input of form.querySelectorAll("[data-photo-question]")) {
          const file = input.files && input.files[0]; if (!file) continue;
          if (file.size > 25 * 1024 * 1024) throw new Error("Een foto mag maximaal 25 MB groot zijn.");
          const uploaded = await api("POST", "/docfiles", { name: file.name, mimeType: file.type, size: file.size, encoding: "base64", content: await fileAsBase64(file), context, visibility: "internal" });
          await api("POST", `/forms/instances/${saved.id}/photo`, { questionId: input.dataset.photoQuestion, fileId: uploaded.file.id });
        }
        if (mode === "submit") await api("POST", `/forms/instances/${saved.id}/submit`, {});
        A.closeDrawer(); await renderWorkOs(); window.showToast && window.showToast(mode === "submit" ? "Formulier ingediend" : "Concept bewaard", "success");
      } catch (error) { submit.disabled = false; submit.textContent = old; box.hidden = false; box.innerHTML = inlineError(error.message); }
    });
  }

  // ── Bestanden ────────────────────────────────────────────────────────────
  function fileIcon(file) {
    const ext = String(file.extension || file.name && file.name.split(".").pop() || "").toUpperCase();
    return ext.slice(0, 4) || "FILE";
  }

  function filesPanelHtml(files) {
    const query = fileSearch.trim().toLowerCase();
    const filtered = files.filter(file => !query || [file.name, file.extension, contextLabel(file.context)].join(" ").toLowerCase().includes(query));
    return `<div class="workos-panel-head"><div><span>Bewijs en documenten</span><h3>Bestanden met een echte historiek</h3><p>Elke download wordt geaudit; oudere versies blijven herkenbaar bij het dossier.</p></div><button type="button" class="adm-btn adm-btn-primary" id="workOsPanelUploadFile">Bestand uploaden</button></div>
      <div class="workos-toolbar"><label class="workos-search"><span class="sr-only">Bestanden zoeken</span><input id="workOsFileSearch" type="search" value="${esc(fileSearch)}" placeholder="Zoek bestand of dossier…"></label><span class="workos-toolbar-note">Maximaal 25 MB · veilige bestandstypes</span></div>
      <div class="workos-file-list" role="list">
        ${filtered.map(file => `<article role="listitem" class="workos-file-row">
          <button type="button" class="workos-file-main" data-file-open="${esc(file.id)}"><span class="workos-file-icon">${esc(fileIcon(file))}</span><span><strong>${esc(file.name)}</strong><small>${esc(contextLabel(file.context))}</small></span></button>
          <span class="workos-file-version"><b>v${Number(file.currentVersion || 1)}</b><small>${(file.versions || []).length} versie(s)</small></span>
          <span class="workos-file-size"><b>${esc(bytes(file.size))}</b><small>${file.visibility === "customer" ? "Klant zichtbaar" : "Intern"}</small></span>
          <time>${esc(fmtDate(file.createdAt))}</time>
          <button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" data-file-download="${esc(file.id)}" data-version="${Number(file.currentVersion || 1)}">Download</button>
        </article>`).join("") || `<div class="workos-rich-empty"><span>↑</span><h4>Nog geen dossierbestanden</h4><p>Upload een plan, foto, verslag of spreadsheet en koppel het meteen aan de juiste context.</p><button type="button" class="adm-btn adm-btn-primary" id="workOsEmptyUpload">Eerste bestand uploaden</button></div>`}
      </div>`;
  }

  function bindFilesPanel() {
    document.getElementById("workOsPanelUploadFile")?.addEventListener("click", openFileUpload);
    document.getElementById("workOsEmptyUpload")?.addEventListener("click", openFileUpload);
    document.getElementById("workOsFileSearch")?.addEventListener("input", event => { fileSearch = event.target.value; renderPanel(); document.getElementById("workOsFileSearch")?.focus(); });
    document.querySelectorAll("[data-file-open]").forEach(button => button.addEventListener("click", () => openFileDetail(currentData.files.find(file => file.id === button.dataset.fileOpen))));
    document.querySelectorAll("[data-file-download]").forEach(button => button.addEventListener("click", () => downloadFile(currentData.files.find(file => file.id === button.dataset.fileDownload), Number(button.dataset.version), button)));
  }

  function mimeFor(file) {
    if (file.type) return file.type;
    const ext = String(file.name || "").split(".").pop().toLowerCase();
    return ({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", txt: "text/plain", csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword", xls: "application/vnd.ms-excel" })[ext] || "application/octet-stream";
  }

  async function openFileUpload() {
    await loadContextCatalog();
    setEditor({
      title: "Bestand uploaden", context: "Dossierbestand", body: `<form id="workOsFileForm" class="workos-editor-form">
        <div class="workos-editor-intro"><span>↑</span><div><h3>Bewaar het bewijs bij het werk</h3><p>Het bestand krijgt een inhoudshash, versie 1 en een auditbare koppeling met het gekozen dossier.</p></div></div>
        <label class="workos-file-drop" for="workOsFileInput"><input id="workOsFileInput" name="file" type="file" accept="${ALLOWED_FILE_TYPES}" required><span>Sleep een bestand hierheen of kies vanaf je toestel</span><small>PDF, afbeeldingen, Office, tekst of CSV · maximaal 25 MB</small></label>
        <div id="workOsSelectedFile" class="workos-selected-file" hidden></div>
        ${contextPicker({ entityType: "tenant", entityId: A.tenantId() }, "fileContext", "Gekoppeld dossier", false)}
        <div class="adm-form-group"><label>Zichtbaarheid</label><select name="visibility"><option value="internal">Alleen intern</option><option value="customer">Ook zichtbaar voor klant</option></select><div class="adm-form-hint">Klantzichtbaarheid bepaalt het dossierbeleid; downloaden blijft via een kortlevende, geauditeerde link verlopen.</div></div>
        <div id="workOsFileError" hidden></div>
        <div class="adm-form-actions workos-editor-actions"><span></span><button type="button" class="adm-btn adm-btn-secondary" id="workOsFileCancel">Annuleren</button><button type="submit" class="adm-btn adm-btn-primary">Veilig uploaden</button></div>
      </form>`,
    });
    const form = document.getElementById("workOsFileForm");
    const input = document.getElementById("workOsFileInput");
    const selected = document.getElementById("workOsSelectedFile");
    bindContextPicker(form, "fileContext", false);
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      selected.hidden = !file;
      if (file) selected.innerHTML = `<span class="workos-file-icon">${esc(file.name.split(".").pop().toUpperCase().slice(0, 4))}</span><span><strong>${esc(file.name)}</strong><small>${esc(bytes(file.size))} · ${esc(mimeFor(file))}</small></span>`;
    });
    document.getElementById("workOsFileCancel").addEventListener("click", A.closeDrawer);
    form.addEventListener("submit", async event => {
      event.preventDefault(); const file = input.files && input.files[0]; const box = document.getElementById("workOsFileError");
      if (!file) { box.hidden = false; box.innerHTML = inlineError("Kies eerst een bestand."); return; }
      if (file.size > 25 * 1024 * 1024) { box.hidden = false; box.innerHTML = inlineError("Dit bestand is groter dan 25 MB."); return; }
      const submit = event.submitter; submit.disabled = true; submit.textContent = "Uploaden…";
      try {
        await api("POST", "/docfiles", { name: file.name, mimeType: mimeFor(file), size: file.size, encoding: "base64", content: await fileAsBase64(file), context: readContext(form, "fileContext", true), visibility: form.elements.visibility.value });
        A.closeDrawer(); await renderWorkOs(); window.showToast && window.showToast("Bestand veilig toegevoegd", "success");
      } catch (error) { submit.disabled = false; submit.textContent = "Veilig uploaden"; box.hidden = false; box.innerHTML = inlineError(error.message); }
    });
  }

  async function downloadFile(file, version, button) {
    if (!file) return;
    const old = button && button.textContent; if (button) { button.disabled = true; button.textContent = "Link maken…"; }
    try {
      const result = await api("POST", `/docfiles/${file.id}/download?version=${Number(version || file.currentVersion || 1)}`, {});
      const signed = result.url && (result.url.url || result.url);
      if (!signed) throw new Error("Voor deze versie is nog geen downloadbare inhoud beschikbaar.");
      window.open(new URL(signed, window.location.origin).href, "_blank", "noopener");
      if (button) { button.disabled = false; button.textContent = old; }
    } catch (error) { window.showToast && window.showToast(error.message, "error"); if (button) { button.disabled = false; button.textContent = old; } }
  }

  function openFileDetail(file) {
    if (!file) return;
    setEditor({
      title: file.name, context: contextLabel(file.context), body: `<div class="workos-file-detail">
        <div class="workos-file-detail-head"><span class="workos-file-icon large">${esc(fileIcon(file))}</span><div><span>Dossierbestand</span><h3>${esc(file.name)}</h3><p>${esc(bytes(file.size))} · ${esc(file.mimeType || "onbekend type")} · ${file.visibility === "customer" ? "klant zichtbaar" : "intern"}</p></div><button type="button" class="adm-btn adm-btn-primary" id="workOsDownloadCurrent">Download v${Number(file.currentVersion || 1)}</button></div>
        <section class="workos-version-section"><header><span>Onveranderlijke historiek</span><h4>${(file.versions || []).length} bewaarde versie(s)</h4></header><div>${[...(file.versions || [])].reverse().map(version => `<article><span class="workos-version-number">v${Number(version.version)}</span><span><strong>${esc(version.version === file.currentVersion ? "Huidige versie" : "Eerdere versie")}</strong><small>${esc(bytes(version.size))} · hash ${esc(String(version.hash || "").slice(0, 12) || "niet beschikbaar")}</small></span><time>${esc(fmtDateTime(version.uploadedAt))}</time><button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" data-detail-download="${Number(version.version)}">Download</button></article>`).join("")}</div></section>
        <div class="workos-audit-note"><span>✓</span><p>Elke download wordt per versie geregistreerd. Oude versies worden nooit overschreven.</p></div>
        <div class="adm-form-actions"><span></span><button type="button" class="adm-btn adm-btn-secondary" id="workOsFileDetailClose">Sluiten</button></div>
      </div>`,
    });
    document.getElementById("workOsFileDetailClose").addEventListener("click", A.closeDrawer);
    document.getElementById("workOsDownloadCurrent").addEventListener("click", event => downloadFile(file, file.currentVersion, event.target));
    document.querySelectorAll("[data-detail-download]").forEach(button => button.addEventListener("click", () => downloadFile(file, Number(button.dataset.detailDownload), button)));
  }

  // ── Communicatietijdlijn ─────────────────────────────────────────────────
  function channelLabel(channel) { return ({ email: "E-mail", sms: "Sms", portal: "Portaal", note: "Interne notitie" })[channel] || channel || "Contact"; }
  function channelIcon(channel) { return ({ email: "@", sms: "SMS", portal: "P", note: "N" })[channel] || "C"; }

  function communicationsPanelHtml(rows) {
    const filtered = communicationFilter === "all" ? rows : rows.filter(row => row.channel === communicationFilter);
    return `<div class="workos-panel-head"><div><span>Traceerbare communicatie</span><h3>De volledige dossiertijdlijn</h3><p>Ontvangers, tekst, bijlagen en templateversie blijven als verzonden snapshot bewaard.</p></div><button type="button" class="adm-btn adm-btn-primary" id="workOsPanelNewCommunication">Contactmoment vastleggen</button></div>
      <div class="workos-toolbar"><div class="workos-filter-chips" aria-label="Kanaalfilter">${[["all", "Alle kanalen"], ["email", "E-mail"], ["sms", "Sms"], ["portal", "Portaal"], ["note", "Notities"]].map(([key, label]) => `<button type="button" data-communication-filter="${key}" class="${communicationFilter === key ? "active" : ""}">${label}</button>`).join("")}</div><span class="workos-toolbar-note">Momentopnames kunnen achteraf niet stilzwijgend wijzigen</span></div>
      <div class="workos-timeline">${filtered.map(row => `<article class="workos-timeline-item"><span class="workos-channel-icon ${esc(row.channel)}">${esc(channelIcon(row.channel))}</span><div class="workos-timeline-card"><header><div><span>${esc(channelLabel(row.channel))} · ${esc(contextLabel(row.context))}</span><h4>${esc(row.subject)}</h4></div><time>${esc(fmtDateTime(row.sentAt))}</time></header><p>${esc(row.body || "Geen inhoud vastgelegd.")}</p><footer><span>Aan: ${esc((row.to || []).join(", "))}</span>${row.cc && row.cc.length ? `<span>CC: ${esc(row.cc.join(", "))}</span>` : ""}${row.attachments && row.attachments.length ? `<span>${row.attachments.length} bijlage(n)</span>` : ""}${row.template ? `<span>Template ${esc(row.template.key)} v${esc(row.template.version || "–")}</span>` : ""}</footer></div></article>`).join("") || `<div class="workos-rich-empty"><span>↗</span><h4>Nog geen contactmomenten</h4><p>Leg een gesprek, portaalbericht, e-mail of interne notitie vast bij het juiste dossier.</p><button type="button" class="adm-btn adm-btn-primary" id="workOsEmptyCommunication">Eerste contactmoment</button></div>`}</div>`;
  }

  function bindCommunicationsPanel() {
    document.getElementById("workOsPanelNewCommunication")?.addEventListener("click", openCommunicationEditor);
    document.getElementById("workOsEmptyCommunication")?.addEventListener("click", openCommunicationEditor);
    document.querySelectorAll("[data-communication-filter]").forEach(button => button.addEventListener("click", () => { communicationFilter = button.dataset.communicationFilter; renderPanel(); }));
  }

  async function openCommunicationEditor() {
    await loadContextCatalog();
    const files = currentData && currentData.files || [];
    setEditor({
      title: "Contactmoment vastleggen", context: "Communicatietijdlijn", body: `<form id="workOsCommunicationForm" class="workos-editor-form">
        <div class="workos-editor-intro"><span>↗</span><div><h3>Bewaar exact wat werd gecommuniceerd</h3><p>Monargo legt de momentopname auditbaar vast. Externe aflevering gebeurt alleen wanneer het gekozen kanaal door de backendprovider is geconfigureerd.</p></div></div>
        <div class="workos-delivery-note" id="workOsDeliveryNote"><span>i</span><p>Je registreert hier de dossiertijdlijn; dit scherm simuleert geen e-mail- of sms-verzending.</p></div>
        <div class="adm-form-row"><div class="adm-form-group"><label>Kanaal</label><select name="channel" id="workOsChannel"><option value="email">E-mail</option><option value="sms">Sms</option><option value="portal">Klantportaal</option><option value="note">Interne notitie</option></select></div><div class="adm-form-group"><label>Ontvanger(s)</label><input name="to" placeholder="naam@bedrijf.be · meerdere met komma" required></div></div>
        <div class="adm-form-group"><label>CC</label><input name="cc" placeholder="Optionele extra ontvangers"></div>
        ${contextPicker({ entityType: "tenant", entityId: A.tenantId() }, "communicationContext", "Gekoppeld dossier", false)}
        <div class="adm-form-group"><label>Onderwerp</label><input name="subject" required placeholder="Waarover ging dit contactmoment?"></div>
        <div class="adm-form-group"><label>Inhoud</label><textarea name="body" rows="8" placeholder="Leg de boodschap of gespreksnotitie vast."></textarea></div>
        <div class="adm-form-group"><label>Bijlagen</label><select name="attachments" multiple size="${Math.min(6, Math.max(3, files.length || 3))}">${files.map(file => `<option value="${esc(file.id)}" data-name="${esc(file.name)}" data-version="${Number(file.currentVersion || 1)}">${esc(file.name)} · v${Number(file.currentVersion || 1)}</option>`).join("")}</select><div class="adm-form-hint">Gebruik Ctrl/Cmd om meerdere dossierbestanden te kiezen.${files.length ? "" : " Er zijn nog geen bestanden beschikbaar."}</div></div>
        <div id="workOsCommunicationError" hidden></div>
        <div class="adm-form-actions workos-editor-actions"><span></span><button type="button" class="adm-btn adm-btn-secondary" id="workOsCommunicationCancel">Annuleren</button><button type="submit" class="adm-btn adm-btn-primary">Contactmoment vastleggen</button></div>
      </form>`,
    });
    const form = document.getElementById("workOsCommunicationForm");
    const channel = document.getElementById("workOsChannel");
    bindContextPicker(form, "communicationContext", false);
    channel.addEventListener("change", () => {
      const to = form.elements.to;
      if (channel.value === "note") { to.required = false; to.placeholder = "Optioneel bij een interne notitie"; }
      else { to.required = true; to.placeholder = channel.value === "sms" ? "+32 … · meerdere met komma" : "naam@bedrijf.be · meerdere met komma"; }
    });
    document.getElementById("workOsCommunicationCancel").addEventListener("click", A.closeDrawer);
    form.addEventListener("submit", async event => {
      event.preventDefault(); const submit = event.submitter; submit.disabled = true; submit.textContent = "Vastleggen…";
      const split = value => String(value || "").split(/[;,]/).map(item => item.trim()).filter(Boolean);
      const to = split(form.elements.to.value); if (channel.value === "note" && !to.length) to.push("Intern team");
      const attachments = [...form.elements.attachments.selectedOptions].map(option => ({ fileId: option.value, name: option.dataset.name, version: Number(option.dataset.version) }));
      const payload = { channel: channel.value, context: readContext(form, "communicationContext", true), to, cc: split(form.elements.cc.value), subject: form.elements.subject.value.trim(), body: form.elements.body.value.trim(), attachments };
      const box = document.getElementById("workOsCommunicationError");
      try { await api("POST", "/communications", payload); A.closeDrawer(); await renderWorkOs(); window.showToast && window.showToast("Contactmoment vastgelegd", "success"); }
      catch (error) { submit.disabled = false; submit.textContent = "Contactmoment vastleggen"; box.hidden = false; box.innerHTML = inlineError(error.message); }
    });
  }

  A.views.workos = renderWorkOs;
  A.drawers.workosTask = openTaskEditor;
  A.drawers.workosTemplate = openTemplateEditor;
  A.drawers.workosFile = openFileUpload;
  A.drawers.workosCommunication = openCommunicationEditor;
}());
