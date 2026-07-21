/* ============================================================
   Monargo One automation workspace
   Versioned flows, veilige simulatie en uitvoeringshistoriek.
   ============================================================ */
(function () {
  "use strict";

  const A = window.wfpAdmin;
  if (!A) return;

  const api = A.api;
  const esc = A.esc;
  const lang = () => (window.wfpI18n && window.wfpI18n.lang) || "nl";
  const l = (nl, fr, en) => ({ nl, fr, en })[lang()] || nl;
  const toast = (message, kind) => window.showToast && window.showToast(message, kind || "success");
  const state = { flows: [], runs: [], tab: "flows", search: "", onMode: null };

  const FLOW_TRANSITIONS = {
    draft: ["active", "retired"],
    active: ["paused", "retired"],
    paused: ["active", "retired"],
    retired: [],
  };
  const ACTION_TYPES = ["notify", "set_field", "log", "send_email", "generate_document", "webhook", "lock_record"];
  const CONDITION_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "exists", "in"];

  function fmtDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(lang() === "en" ? "en-GB" : `${lang()}-BE`, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }
  function statusLabel(status) {
    const labels = {
      draft: ["Concept", "Brouillon", "Draft"], active: ["Actief", "Actif", "Active"], paused: ["Gepauzeerd", "En pause", "Paused"], retired: ["Gearchiveerd", "Archivé", "Retired"],
      scheduled: ["Gepland", "Planifié", "Scheduled"], running: ["Bezig", "En cours", "Running"], waiting: ["Wacht op actie", "En attente", "Waiting"], success: ["Geslaagd", "Réussi", "Success"], partial: ["Gedeeltelijk", "Partiel", "Partial"], failed: ["Mislukt", "Échoué", "Failed"], cancelled: ["Overgeslagen", "Ignoré", "Skipped"], requires_approval: ["Goedkeuring nodig", "Approbation requise", "Approval required"], skipped: ["Overgeslagen", "Ignoré", "Skipped"],
    };
    const row = labels[status];
    return row ? row[{ nl: 0, fr: 1, en: 2 }[lang()] || 0] : String(status || "-").replaceAll("_", " ");
  }
  function tone(status) {
    if (["active", "success"].includes(status)) return "success";
    if (["draft", "scheduled", "running"].includes(status)) return "info";
    if (["paused", "waiting", "partial", "requires_approval"].includes(status)) return "warning";
    if (["failed"].includes(status)) return "danger";
    return "neutral";
  }
  const badge = status => `<span class="aws-status ${tone(status)}">${esc(statusLabel(status))}</span>`;
  const flowName = id => (state.flows.find(flow => flow.id === id) || {}).name || id || "-";

  async function load() {
    const [flows, runs] = await Promise.all([api("GET", "/automation/flows"), api("GET", "/automation/runs?limit=100")]);
    state.flows = flows.flows || [];
    state.runs = runs.runs || [];
  }

  function filterRows(rows, values) {
    const q = state.search.trim().toLowerCase();
    return q ? rows.filter(row => values(row).join(" ").toLowerCase().includes(q)) : rows;
  }

  function modeNav() {
    return `<nav class="adm-integration-mode" aria-label="${esc(l("Koppelingen, automatisaties en eigen velden", "Connexions, automatisations et champs personnalisés", "Connections, automations and custom fields"))}"><button type="button" data-aws-mode="connectors">${esc(l("Connectoren", "Connecteurs", "Connectors"))}</button><button type="button" class="active" data-aws-mode="automations">${esc(l("Automatisaties", "Automatisations", "Automations"))}</button><button type="button" data-aws-mode="fields">${esc(l("Eigen velden", "Champs personnalisés", "Custom fields"))}</button></nav>`;
  }

  function renderLoaded() {
    const active = state.flows.filter(flow => flow.status === "active");
    const paused = state.flows.filter(flow => flow.status === "paused");
    const failed = state.runs.filter(run => run.status === "failed" || run.status === "partial");
    const approvals = state.runs.reduce((sum, run) => sum + (run.steps || []).filter(step => step.status === "requires_approval").length, 0);
    const flowRows = filterRows(state.flows, flow => [flow.name, flow.trigger, flow.status, flow.description]);
    const runRows = filterRows(state.runs, run => [flowName(run.flowId), run.eventType, run.aggregateId, run.status]);
    const flowsTable = flowRows.length ? `<div class="aws-table-wrap"><table class="aws-table"><thead><tr><th>${esc(l("Flow", "Flux", "Flow"))}</th><th>${esc(l("Trigger", "Déclencheur", "Trigger"))}</th><th>${esc(l("Definitie", "Définition", "Definition"))}</th><th>${esc(l("Versie", "Version", "Version"))}</th><th>${esc(l("Status", "Statut", "Status"))}</th><th></th></tr></thead><tbody>${flowRows.map(flow => `<tr><td><strong>${esc(flow.name)}</strong><small>${esc(flow.description || l("Geen beschrijving", "Aucune description", "No description"))}</small></td><td><code>${esc(flow.trigger)}</code></td><td>${(flow.conditions || []).length} ${esc(l("voorwaarden", "conditions", "conditions"))}<small>${(flow.actions || []).length} ${esc(l("acties", "actions", "actions"))}</small></td><td>v${Number(flow.version || 1)}</td><td>${badge(flow.status)}</td><td><button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" data-aws-flow="${esc(flow.id)}">${esc(l("Openen", "Ouvrir", "Open"))}</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="aws-empty"><span>↯</span><h4>${esc(l("Nog geen automatisaties", "Aucune automatisation", "No automations yet"))}</h4><p>${esc(l("Maak een versiebeheerflow die reageert op een domeingebeurtenis. Start in concept en simuleer vóór activering.", "Créez un flux versionné qui réagit à un événement. Commencez en brouillon et simulez avant activation.", "Create a versioned flow that reacts to a domain event. Start in draft and simulate before activation."))}</p><button type="button" class="adm-btn adm-btn-primary" id="awsEmptyNew">${esc(l("Eerste flow maken", "Créer le premier flux", "Create first flow"))}</button></div>`;
    const runsTable = runRows.length ? `<div class="aws-table-wrap"><table class="aws-table"><thead><tr><th>${esc(l("Uitvoering", "Exécution", "Run"))}</th><th>${esc(l("Flow", "Flux", "Flow"))}</th><th>${esc(l("Gebeurtenis", "Événement", "Event"))}</th><th>${esc(l("Record", "Enregistrement", "Record"))}</th><th>${esc(l("Resultaat", "Résultat", "Result"))}</th><th></th></tr></thead><tbody>${runRows.map(run => `<tr><td><strong>${esc(fmtDate(run.at))}</strong><small>${esc(run.id || "")}</small></td><td>${esc(flowName(run.flowId))}<small>v${Number(run.flowVersion || 1)}</small></td><td><code>${esc(run.eventType || "-")}</code></td><td>${esc(run.aggregateId || "-")}</td><td>${badge(run.status)}</td><td><button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" data-aws-run="${esc(run.id)}">${esc(l("Details", "Détails", "Details"))}</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="aws-empty"><span>✓</span><h4>${esc(l("Nog geen uitvoeringen", "Aucune exécution", "No runs yet"))}</h4><p>${esc(l("Actieve flows verschijnen hier zodra een passende gebeurtenis optreedt.", "Les flux actifs apparaissent ici dès qu’un événement correspondant se produit.", "Active flows appear here when a matching event occurs."))}</p></div>`;
    A.content().innerHTML = `<div class="aws-workspace">${modeNav()}<section class="aws-hero"><div><span>${esc(l("Veilige workflowautomatisatie", "Automatisation sécurisée", "Safe workflow automation"))}</span><h2>${esc(l("Automatiseer zonder controle te verliezen", "Automatisez sans perdre le contrôle", "Automate without losing control"))}</h2><p>${esc(l("Bouw versiebeheerflows, test ze met een simulatie en volg iedere uitvoering per stap. Financiële en verzendacties blijven wachten op expliciete goedkeuring.", "Créez des flux versionnés, testez-les par simulation et suivez chaque étape. Les actions financières et d’envoi restent soumises à approbation.", "Build versioned flows, test them by simulation and track every step. Financial and delivery actions remain subject to explicit approval."))}</p></div><button type="button" class="adm-btn adm-btn-primary" id="awsNewFlow">+ ${esc(l("Nieuwe flow", "Nouveau flux", "New flow"))}</button></section><section class="aws-kpis"><article><span>${esc(l("Actieve flows", "Flux actifs", "Active flows"))}</span><strong>${active.length}</strong><small>${state.flows.length} ${esc(l("flows totaal", "flux au total", "flows total"))}</small></article><article><span>${esc(l("Gepauzeerd", "En pause", "Paused"))}</span><strong>${paused.length}</strong><small>${esc(l("veilig tijdelijk gestopt", "arrêtés temporairement", "safely stopped"))}</small></article><article class="${failed.length ? "attention" : ""}"><span>${esc(l("Uitvoeringen met fout", "Exécutions en erreur", "Runs with errors"))}</span><strong>${failed.length}</strong><small>${esc(l("in geladen historiek", "dans l’historique chargé", "in loaded history"))}</small></article><article class="${approvals ? "attention" : ""}"><span>${esc(l("Goedkeuring vereist", "Approbation requise", "Approval required"))}</span><strong>${approvals}</strong><small>${esc(l("bewust niet uitgevoerd", "non exécutées volontairement", "intentionally not executed"))}</small></article></section><section class="aws-panel"><div class="aws-panel-head"><div><h3>${esc(state.tab === "runs" ? l("Uitvoeringshistoriek", "Historique des exécutions", "Run history") : l("Automatisatieflows", "Flux d’automatisation", "Automation flows"))}</h3><p>${esc(l("De backend blijft eigenaar van triggering, lusdetectie, idempotentie en actieve versies.", "Le backend reste responsable du déclenchement, de la détection de boucles, de l’idempotence et des versions actives.", "The backend remains responsible for triggering, loop detection, idempotency and active versions."))}</p></div><div class="aws-tabs"><button type="button" class="${state.tab === "flows" ? "active" : ""}" data-aws-tab="flows">${esc(l("Flows", "Flux", "Flows"))} · ${state.flows.length}</button><button type="button" class="${state.tab === "runs" ? "active" : ""}" data-aws-tab="runs">${esc(l("Uitvoeringen", "Exécutions", "Runs"))} · ${state.runs.length}</button></div></div><div class="aws-toolbar"><input id="awsSearch" type="search" value="${esc(state.search)}" placeholder="${esc(l("Zoek flow, trigger of record…", "Rechercher flux, déclencheur ou enregistrement…", "Search flow, trigger or record…"))}"></div>${state.tab === "runs" ? runsTable : flowsTable}</section></div>`;
    bindMain();
  }

  function bindMain() {
    A.content().querySelectorAll("[data-aws-mode]").forEach(button => button.addEventListener("click", () => state.onMode && state.onMode(button.dataset.awsMode)));
    A.content().querySelectorAll("[data-aws-tab]").forEach(button => button.addEventListener("click", () => { state.tab = button.dataset.awsTab; renderLoaded(); }));
    document.getElementById("awsSearch")?.addEventListener("input", event => { state.search = event.target.value; renderLoaded(); });
    document.getElementById("awsNewFlow")?.addEventListener("click", () => openFlowEditor());
    document.getElementById("awsEmptyNew")?.addEventListener("click", () => openFlowEditor());
    A.content().querySelectorAll("[data-aws-flow]").forEach(button => button.addEventListener("click", () => openFlowDetail(button.dataset.awsFlow)));
    A.content().querySelectorAll("[data-aws-run]").forEach(button => button.addEventListener("click", () => openRunDetail(button.dataset.awsRun)));
  }

  function setEditor(title, context, html, kind) {
    document.getElementById("admDrawerTitle").textContent = title;
    document.getElementById("admDrawerContext").textContent = context;
    document.getElementById("admDrawerBody").innerHTML = html;
    A.openDrawer();
    document.getElementById("admDrawer").dataset.editorKind = kind || "automation";
  }
  function editorActions(label) {
    return `<div class="aws-inline-error" data-aws-error hidden></div><div class="adm-form-actions"><span></span><button type="button" class="adm-btn adm-btn-secondary" data-aws-close>${esc(l("Annuleren", "Annuler", "Cancel"))}</button><button type="submit" class="adm-btn adm-btn-primary">${esc(label || l("Opslaan", "Enregistrer", "Save"))}</button></div>`;
  }
  function bindClose(root) { root.querySelectorAll("[data-aws-close]").forEach(button => button.addEventListener("click", A.closeDrawer)); }
  function showError(error) { const box = document.querySelector("[data-aws-error]"); if (box) { box.hidden = false; box.textContent = error.message; } else toast(error.message, "error"); }

  function conditionValue(value) { return Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value); }
  function actionFields(action) {
    const p = action.params || {};
    if (action.type === "notify") return { first: p.title || "", second: p.body || "" };
    if (action.type === "set_field") return { first: p.field || "", second: p.value == null ? "" : String(p.value) };
    if (action.type === "log") return { first: p.message || "", second: "" };
    return { first: p.note || "", second: p.context || "" };
  }
  function actionLabels(type) {
    if (type === "notify") return [l("Titel van melding", "Titre de la notification", "Notification title"), l("Bericht", "Message", "Message")];
    if (type === "set_field") return [l("Toegestaan veld", "Champ autorisé", "Allowed field"), l("Nieuwe waarde", "Nouvelle valeur", "New value")];
    if (type === "log") return [l("Logbericht", "Message du journal", "Log message"), l("Optionele context", "Contexte facultatif", "Optional context")];
    return [l("Doel of omschrijving", "Cible ou description", "Target or description"), l("Context voor goedkeuring", "Contexte pour approbation", "Approval context")];
  }

  function openFlowEditor(flow) {
    const isEdit = Boolean(flow);
    let conditions = (flow && flow.conditions || []).map(row => ({ ...row }));
    let actions = (flow && flow.actions && flow.actions.length ? flow.actions : [{ type: "notify", params: {} }]).map(row => ({ ...row, params: { ...(row.params || {}) } }));
    const conditionHtml = () => conditions.map((condition, index) => `<div class="aws-builder-row condition" data-condition-row="${index}"><span class="aws-row-index">${index + 1}</span><label>${esc(l("Eventveld", "Champ événement", "Event field"))}<input data-condition-field="field" value="${esc(condition.field || "")}" placeholder="data.total"></label><label>${esc(l("Operator", "Opérateur", "Operator"))}<select data-condition-field="op">${CONDITION_OPS.map(op => `<option value="${op}" ${condition.op === op ? "selected" : ""}>${op}</option>`).join("")}</select></label><label>${esc(l("Waarde", "Valeur", "Value"))}<input data-condition-field="value" value="${esc(conditionValue(condition.value))}"></label><button type="button" data-condition-remove="${index}" aria-label="${esc(l("Voorwaarde verwijderen", "Supprimer la condition", "Remove condition"))}">×</button></div>`).join("");
    const actionHtml = () => actions.map((action, index) => { const values = actionFields(action); const labels = actionLabels(action.type); const guarded = !["notify", "set_field", "log"].includes(action.type); return `<div class="aws-builder-row action ${guarded ? "guarded" : ""}" data-action-row="${index}"><span class="aws-row-index">${index + 1}</span><label>${esc(l("Actie", "Action", "Action"))}<select data-action-field="type">${ACTION_TYPES.map(type => `<option value="${type}" ${action.type === type ? "selected" : ""}>${esc(type.replaceAll("_", " "))}</option>`).join("")}</select></label><label>${esc(labels[0])}<input data-action-field="first" value="${esc(values.first)}"></label><label>${esc(labels[1])}<input data-action-field="second" value="${esc(values.second)}"></label><button type="button" data-action-remove="${index}" aria-label="${esc(l("Actie verwijderen", "Supprimer l’action", "Remove action"))}">×</button>${guarded ? `<small>${esc(l("Deze actie wordt als goedkeuringsstap geregistreerd en niet automatisch uitgevoerd.", "Cette action est enregistrée comme étape d’approbation et n’est pas exécutée automatiquement.", "This action is recorded as an approval step and is not executed automatically."))}</small>` : ""}</div>`; }).join("");
    setEditor(isEdit ? l("Automatisatie bewerken", "Modifier l’automatisation", "Edit automation") : l("Nieuwe automatisatie", "Nouvelle automatisation", "New automation"), l("Versiebeheerde flow", "Flux versionné", "Versioned flow"), `<form id="awsFlowForm" class="aws-editor"><section class="aws-editor-intro"><span>↯</span><div><h3>${esc(l("Van gebeurtenis naar gecontroleerde actie", "De l’événement à l’action contrôlée", "From event to controlled action"))}</h3><p>${esc(l("De flow start als concept. Simuleer de serveruitvoering en activeer pas wanneer de stappen correct zijn.", "Le flux commence en brouillon. Simulez l’exécution serveur avant de l’activer.", "The flow starts as a draft. Simulate server execution before activation."))}</p></div></section><div class="aws-form-grid"><div class="adm-form-group"><label>${esc(l("Naam", "Nom", "Name"))}</label><input name="name" required value="${esc(flow && flow.name || "")}"></div><div class="adm-form-group"><label>${esc(l("Trigger-event", "Événement déclencheur", "Trigger event"))}</label><input name="trigger" required pattern="[a-z][a-z_]*\.[a-z][a-z_]*" ${isEdit ? "readonly" : ""} value="${esc(flow && flow.trigger || "")}" placeholder="customer.created"></div><div class="adm-form-group"><label>${esc(l("Herhaalstrategie", "Stratégie de répétition", "Repeat strategy"))}</label><select name="repeat"><option value="idempotent" ${!flow || flow.repeat !== "always" ? "selected" : ""}>${esc(l("Maximaal één keer per bronrecord", "Une fois par enregistrement source", "Once per source record"))}</option><option value="always" ${flow && flow.repeat === "always" ? "selected" : ""}>${esc(l("Bij iedere gebeurtenis", "À chaque événement", "On every event"))}</option></select></div><div class="adm-form-group wide"><label>${esc(l("Beschrijving", "Description", "Description"))}</label><textarea name="description">${esc(flow && flow.description || "")}</textarea></div></div><section class="aws-builder-section"><header><div><span>${esc(l("Voorwaarden", "Conditions", "Conditions"))}</span><p>${esc(l("Alle voorwaarden moeten waar zijn. Geen voorwaarden betekent: altijd uitvoeren bij deze trigger.", "Toutes les conditions doivent être vraies. Sans condition: toujours exécuter.", "All conditions must be true. No conditions means always run for this trigger."))}</p></div><button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" id="awsAddCondition">+ ${esc(l("Voorwaarde", "Condition", "Condition"))}</button></header><div id="awsConditions" class="aws-builder-list">${conditionHtml()}</div></section><section class="aws-builder-section"><header><div><span>${esc(l("Actiestappen", "Étapes d’action", "Action steps"))}</span><p>${esc(l("Veilige acties kunnen automatisch lopen. Bewaakte acties blijven wachten op menselijke goedkeuring.", "Les actions sûres peuvent s’exécuter automatiquement. Les actions surveillées attendent une approbation humaine.", "Safe actions can run automatically. Guarded actions wait for human approval."))}</p></div><button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" id="awsAddAction">+ ${esc(l("Actie", "Action", "Action"))}</button></header><div id="awsActions" class="aws-builder-list">${actionHtml()}</div></section>${editorActions()}</form>`, "automation-wide");
    const form = document.getElementById("awsFlowForm"); const conditionHost = document.getElementById("awsConditions"); const actionHost = document.getElementById("awsActions"); bindClose(form);
    const syncConditions = () => { conditionHost.querySelectorAll("[data-condition-row]").forEach((row, index) => { const field = key => row.querySelector(`[data-condition-field="${key}"]`).value; const op = field("op"); let value = field("value"); if (op === "in") value = value.split(",").map(item => item.trim()).filter(Boolean); conditions[index] = { field: field("field").trim(), op, value }; }); };
    const syncActions = () => { actionHost.querySelectorAll("[data-action-row]").forEach((row, index) => { const type = row.querySelector('[data-action-field="type"]').value; const first = row.querySelector('[data-action-field="first"]').value.trim(); const second = row.querySelector('[data-action-field="second"]').value.trim(); let params; if (type === "notify") params = { title: first, body: second, audience: "admins", priority: "normal" }; else if (type === "set_field") params = { field: first, value: second }; else if (type === "log") params = { message: first || second }; else params = { note: first, context: second }; actions[index] = { type, params }; }); };
    const redrawConditions = () => { conditionHost.innerHTML = conditionHtml(); bindBuilder(); };
    const redrawActions = () => { actionHost.innerHTML = actionHtml(); bindBuilder(); };
    const bindBuilder = () => {
      conditionHost.querySelectorAll("[data-condition-field]").forEach(input => input.addEventListener("input", syncConditions));
      conditionHost.querySelectorAll("[data-condition-remove]").forEach(button => button.addEventListener("click", () => { syncConditions(); conditions.splice(Number(button.dataset.conditionRemove), 1); redrawConditions(); }));
      actionHost.querySelectorAll("[data-action-field]").forEach(input => input.addEventListener("input", syncActions));
      actionHost.querySelectorAll('[data-action-field="type"]').forEach(input => input.addEventListener("change", () => { syncActions(); redrawActions(); }));
      actionHost.querySelectorAll("[data-action-remove]").forEach(button => button.addEventListener("click", () => { syncActions(); if (actions.length > 1) actions.splice(Number(button.dataset.actionRemove), 1); redrawActions(); }));
    };
    bindBuilder();
    document.getElementById("awsAddCondition").addEventListener("click", () => { syncConditions(); conditions.push({ field: "", op: "eq", value: "" }); redrawConditions(); });
    document.getElementById("awsAddAction").addEventListener("click", () => { syncActions(); actions.push({ type: "notify", params: {} }); redrawActions(); });
    form.addEventListener("submit", async event => { event.preventDefault(); syncConditions(); syncActions(); const data = Object.fromEntries(new FormData(form).entries()); data.conditions = conditions.filter(condition => condition.field); data.actions = actions; if (isEdit) data.expectedVersion = flow.version; try { await api(isEdit ? "PATCH" : "POST", isEdit ? `/automation/flows/${flow.id}` : "/automation/flows", data); A.closeDrawer(); await load(); renderLoaded(); toast(isEdit ? l("Automatisatie bijgewerkt", "Automatisation mise à jour", "Automation updated") : l("Automatisatie als concept aangemaakt", "Automatisation créée en brouillon", "Automation created as draft")); } catch (error) { showError(error); } });
  }

  function openFlowDetail(id) {
    const flow = state.flows.find(row => row.id === id); if (!flow) return; const next = FLOW_TRANSITIONS[flow.status] || []; const flowRuns = state.runs.filter(run => run.flowId === flow.id).slice(0, 8);
    setEditor(flow.name, `${flow.trigger} · v${flow.version || 1}`, `<div class="aws-editor"><section class="aws-detail-head"><div><span>${esc(l("Automatisatiedossier", "Dossier d’automatisation", "Automation file"))}</span><h3>${esc(flow.name)}</h3><p><code>${esc(flow.trigger)}</code> · ${badge(flow.status)}</p></div><div class="aws-detail-actions">${flow.status !== "retired" ? `<button type="button" class="adm-btn adm-btn-secondary" id="awsEditFlow">${esc(l("Bewerken", "Modifier", "Edit"))}</button><button type="button" class="adm-btn adm-btn-secondary" id="awsSimulateFlow">${esc(l("Simuleren", "Simuler", "Simulate"))}</button>` : ""}</div></section><div id="awsSimulationResult"></div><div class="aws-detail-grid"><section><h4>${esc(l("Definitie", "Définition", "Definition"))}</h4><dl><dt>${esc(l("Herhaalstrategie", "Répétition", "Repeat strategy"))}</dt><dd>${esc(flow.repeat === "always" ? l("Iedere gebeurtenis", "Chaque événement", "Every event") : l("Eén keer per bronrecord", "Une fois par enregistrement source", "Once per source record"))}</dd><dt>${esc(l("Voorwaarden", "Conditions", "Conditions"))}</dt><dd>${(flow.conditions || []).length}</dd><dt>${esc(l("Actiestappen", "Étapes", "Action steps"))}</dt><dd>${(flow.actions || []).length}</dd><dt>${esc(l("Versie", "Version", "Version"))}</dt><dd>v${Number(flow.version || 1)}</dd></dl><p>${esc(flow.description || l("Geen beschrijving", "Aucune description", "No description"))}</p></section><section><h4>${esc(l("Statusflow", "Flux de statut", "Status flow"))}</h4><div class="aws-detail-actions start">${next.map(status => `<button type="button" class="adm-btn ${status === "retired" ? "adm-btn-secondary" : "adm-btn-primary"}" data-aws-transition="${status}">${esc(statusLabel(status))}</button>`).join("") || `<span class="aws-status neutral">${esc(l("Definitief gearchiveerd", "Archivé définitivement", "Permanently retired"))}</span>`}</div></section><section class="wide"><h4>${esc(l("Actiestappen", "Étapes d’action", "Action steps"))}</h4><div class="aws-step-list">${(flow.actions || []).map((action, index) => `<article><span>${index + 1}</span><div><strong>${esc(action.type.replaceAll("_", " "))}</strong><small>${esc(JSON.stringify(action.params || {}))}</small></div>${!["notify", "set_field", "log"].includes(action.type) ? badge("requires_approval") : badge("active")}</article>`).join("")}</div></section><section class="wide"><h4>${esc(l("Recente uitvoeringen", "Exécutions récentes", "Recent runs"))}</h4>${flowRuns.length ? `<div class="aws-step-list">${flowRuns.map(run => `<article><span>↯</span><div><strong>${esc(fmtDate(run.at))}</strong><small>${esc(`${run.eventType || "-"} · ${run.aggregateId || "-"}`)}</small></div>${badge(run.status)}</article>`).join("")}</div>` : `<p>${esc(l("Nog geen uitvoeringen voor deze flow.", "Aucune exécution pour ce flux.", "No runs for this flow yet."))}</p>`}</section></div><div class="adm-form-actions"><span></span><button type="button" class="adm-btn adm-btn-secondary" data-aws-close>${esc(l("Sluiten", "Fermer", "Close"))}</button></div></div>`, "automation-wide");
    const root = document.getElementById("admDrawerBody"); bindClose(root); document.getElementById("awsEditFlow")?.addEventListener("click", () => openFlowEditor(flow));
    document.getElementById("awsSimulateFlow")?.addEventListener("click", async () => { const button = document.getElementById("awsSimulateFlow"); button.disabled = true; try { const result = await api("POST", `/automation/flows/${flow.id}/simulate`, {}); const run = result.run || {}; document.getElementById("awsSimulationResult").innerHTML = `<section class="aws-simulation"><div><span>${esc(l("Server-simulatie", "Simulation serveur", "Server simulation"))}</span><strong>${esc(statusLabel(run.status))}</strong><p>${esc(run.reason ? statusLabel(run.reason) : l("Geen productiedata gewijzigd", "Aucune donnée de production modifiée", "No production data changed"))}</p></div><div class="aws-step-list">${(run.steps || []).map((step, index) => `<article><span>${index + 1}</span><div><strong>${esc(step.type)}</strong><small>${esc(step.detail || "")}</small></div>${badge(step.status)}</article>`).join("")}</div></section>`; } catch (error) { toast(error.message, "error"); } finally { button.disabled = false; } });
    root.querySelectorAll("[data-aws-transition]").forEach(button => button.addEventListener("click", async () => { button.disabled = true; try { await api("POST", `/automation/flows/${flow.id}/transition`, { status: button.dataset.awsTransition }); A.closeDrawer(); await load(); renderLoaded(); toast(l("Flowstatus aangepast", "Statut du flux mis à jour", "Flow status updated")); } catch (error) { toast(error.message, "error"); button.disabled = false; } }));
  }

  function openRunDetail(id) {
    const run = state.runs.find(row => row.id === id); if (!run) return;
    setEditor(l("Uitvoeringsdetail", "Détail de l’exécution", "Run detail"), `${flowName(run.flowId)} · v${run.flowVersion || 1}`, `<div class="aws-editor"><section class="aws-detail-head"><div><span>${esc(l("Controleerbare uitvoering", "Exécution traçable", "Traceable run"))}</span><h3>${esc(flowName(run.flowId))}</h3><p>${esc(fmtDate(run.at))} · ${badge(run.status)}</p></div></section><div class="aws-detail-grid"><section><h4>${esc(l("Brongebeurtenis", "Événement source", "Source event"))}</h4><dl><dt>${esc(l("Event", "Événement", "Event"))}</dt><dd><code>${esc(run.eventType || "-")}</code></dd><dt>${esc(l("Record", "Enregistrement", "Record"))}</dt><dd>${esc(run.aggregateId || "-")}</dd><dt>${esc(l("Run-ID", "ID exécution", "Run ID"))}</dt><dd>${esc(run.id || "-")}</dd><dt>${esc(l("Reden", "Raison", "Reason"))}</dt><dd>${esc(run.reason || "-")}</dd></dl></section><section class="wide"><h4>${esc(l("Resultaat per stap", "Résultat par étape", "Result by step"))}</h4><div class="aws-step-list">${(run.steps || []).map((step, index) => `<article><span>${index + 1}</span><div><strong>${esc(step.type || "-")}</strong><small>${esc(step.detail || "")}</small></div>${badge(step.status)}</article>`).join("") || `<p>${esc(l("Deze uitvoering bevat geen actiestappen.", "Cette exécution ne contient aucune étape.", "This run contains no action steps."))}</p>`}</div></section></div><div class="adm-form-actions"><span></span><button type="button" class="adm-btn adm-btn-secondary" data-aws-close>${esc(l("Sluiten", "Fermer", "Close"))}</button></div></div>`, "automation-wide");
    bindClose(document.getElementById("admDrawerBody"));
  }

  async function render(options) {
    state.onMode = options && options.onMode;
    A.content().innerHTML = `<div class="adm-loading"><div class="adm-spinner"></div>${esc(l("Automatisaties laden…", "Chargement des automatisations…", "Loading automations…"))}</div>`;
    try { await load(); renderLoaded(); }
    catch (error) { A.content().innerHTML = `<div class="aws-error"><strong>${esc(l("Automatisaties konden niet worden geladen", "Impossible de charger les automatisations", "Automations could not be loaded"))}</strong><p>${esc(error.message)}</p><button type="button" class="adm-btn adm-btn-secondary" id="awsRetry">${esc(l("Opnieuw proberen", "Réessayer", "Try again"))}</button></div>`; document.getElementById("awsRetry")?.addEventListener("click", () => render(options)); }
  }

  window.wfpAutomationWorkspace = { render, openFlowEditor };
}());
