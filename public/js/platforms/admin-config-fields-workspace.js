/* ============================================================
   Monargo One custom fields workspace
   Functioneel configureren zonder code of lokale domeinlogica.
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
  const state = { fields: [], entity: "all", status: "all", search: "", onMode: null };
  const ENTITIES = ["customer", "project", "workorder", "quote", "invoice", "asset", "supplier", "worksite"];
  const FIELD_TYPES = ["text", "number", "date", "boolean", "select", "multiselect"];
  const FIELD_TRANSITIONS = { draft: ["published", "archived"], published: ["archived"], archived: [] };
  const publishedCache = new Map();

  function entityLabel(entity) {
    const labels = {
      customer: ["Klant", "Client", "Customer"], project: ["Project", "Projet", "Project"], workorder: ["Werkbon", "Bon de travail", "Work order"], quote: ["Offerte", "Offre", "Quote"], invoice: ["Factuur", "Facture", "Invoice"], asset: ["Asset", "Actif", "Asset"], supplier: ["Leverancier", "Fournisseur", "Supplier"], worksite: ["Werf", "Chantier", "Worksite"],
    };
    const row = labels[entity]; return row ? row[{ nl: 0, fr: 1, en: 2 }[lang()] || 0] : entity;
  }
  function typeLabel(type) {
    const labels = { text: ["Tekst", "Texte", "Text"], number: ["Getal", "Nombre", "Number"], date: ["Datum", "Date", "Date"], boolean: ["Ja of nee", "Oui ou non", "Yes or no"], select: ["Eén keuze", "Choix unique", "Single select"], multiselect: ["Meerdere keuzes", "Choix multiples", "Multi-select"] };
    const row = labels[type]; return row ? row[{ nl: 0, fr: 1, en: 2 }[lang()] || 0] : type;
  }
  function statusLabel(status) {
    const labels = { draft: ["Concept", "Brouillon", "Draft"], published: ["Gepubliceerd", "Publié", "Published"], archived: ["Gearchiveerd", "Archivé", "Archived"] };
    const row = labels[status]; return row ? row[{ nl: 0, fr: 1, en: 2 }[lang()] || 0] : status;
  }
  function tone(status) { return status === "published" ? "success" : status === "draft" ? "info" : "neutral"; }
  const badge = status => `<span class="aws-status ${tone(status)}">${esc(statusLabel(status))}</span>`;
  function fmtDate(value) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(lang() === "en" ? "en-GB" : `${lang()}-BE`, { dateStyle: "medium", timeStyle: "short" }).format(date); }

  async function load() {
    const result = await api("GET", "/config/fields");
    state.fields = result.fields || [];
  }
  function filteredFields() {
    const q = state.search.trim().toLowerCase();
    return state.fields.filter(field => (state.entity === "all" || field.entity === state.entity) && (state.status === "all" || field.status === state.status) && (!q || [field.key, field.labels && field.labels.nl, field.labels && field.labels.fr, field.labels && field.labels.en, field.group, field.entity, field.type].join(" ").toLowerCase().includes(q)));
  }
  function modeNav() {
    return `<nav class="adm-integration-mode" aria-label="${esc(l("Koppelingen, automatisaties en eigen velden", "Connexions, automatisations et champs personnalisés", "Connections, automations and custom fields"))}"><button type="button" data-cfw-mode="connectors">${esc(l("Connectoren", "Connecteurs", "Connectors"))}</button><button type="button" data-cfw-mode="automations">${esc(l("Automatisaties", "Automatisations", "Automations"))}</button><button type="button" class="active" data-cfw-mode="fields">${esc(l("Eigen velden", "Champs personnalisés", "Custom fields"))}</button></nav>`;
  }

  function renderLoaded() {
    const rows = filteredFields();
    const published = state.fields.filter(field => field.status === "published");
    const drafts = state.fields.filter(field => field.status === "draft");
    const required = published.filter(field => field.required);
    const entities = new Set(published.map(field => field.entity));
    const table = rows.length ? `<div class="aws-table-wrap"><table class="aws-table"><thead><tr><th>${esc(l("Veld", "Champ", "Field"))}</th><th>${esc(l("Entiteit", "Entité", "Entity"))}</th><th>${esc(l("Type", "Type", "Type"))}</th><th>${esc(l("Groep", "Groupe", "Group"))}</th><th>${esc(l("Volgorde", "Ordre", "Order"))}</th><th>${esc(l("Status", "Statut", "Status"))}</th><th></th></tr></thead><tbody>${rows.map(field => `<tr><td><strong>${esc((field.labels && (field.labels[lang()] || field.labels.nl)) || field.key)}</strong><small>${esc(field.key)}${field.required ? ` · ${esc(l("verplicht", "obligatoire", "required"))}` : ""}</small></td><td>${esc(entityLabel(field.entity))}</td><td>${esc(typeLabel(field.type))}</td><td>${esc(field.group || "-")}</td><td>${Number(field.order == null ? 99 : field.order)}</td><td>${badge(field.status)}</td><td><button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" data-cfw-open="${esc(field.id)}">${esc(l("Openen", "Ouvrir", "Open"))}</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="aws-empty"><span>＋</span><h4>${esc(l("Geen velden in deze selectie", "Aucun champ dans cette sélection", "No fields in this selection"))}</h4><p>${esc(l("Voeg een eigen veld toe aan een ondersteund dossier. Publiceer pas nadat labels, type en validatie gecontroleerd zijn.", "Ajoutez un champ personnalisé à un dossier pris en charge. Publiez après contrôle des libellés, du type et de la validation.", "Add a custom field to a supported record. Publish after checking labels, type and validation."))}</p><button type="button" class="adm-btn adm-btn-primary" id="cfwEmptyNew">${esc(l("Nieuw veld", "Nouveau champ", "New field"))}</button></div>`;
    A.content().innerHTML = `<div class="aws-workspace cfw-workspace">${modeNav()}<section class="aws-hero cfw-hero"><div><span>${esc(l("Functionele configuratie", "Configuration fonctionnelle", "Functional configuration"))}</span><h2>${esc(l("Eigen velden zonder maatwerkcode", "Des champs personnalisés sans code spécifique", "Custom fields without custom code"))}</h2><p>${esc(l("Breid klanten, projecten, werkbonnen en andere dossiers gecontroleerd uit. Technische sleutels en veldtypes worden na publicatie beschermd door de backend.", "Étendez les clients, projets, bons de travail et autres dossiers de manière contrôlée. Les clés et types sont protégés après publication.", "Extend customers, projects, work orders and other records in a controlled way. Technical keys and field types are protected by the backend after publication."))}</p></div><button type="button" class="adm-btn adm-btn-primary" id="cfwNewField">+ ${esc(l("Nieuw veld", "Nouveau champ", "New field"))}</button></section><section class="aws-kpis"><article><span>${esc(l("Gepubliceerd", "Publiés", "Published"))}</span><strong>${published.length}</strong><small>${esc(l("actief in nieuwe writes", "actifs pour les nouvelles écritures", "active for new writes"))}</small></article><article><span>${esc(l("Concepten", "Brouillons", "Drafts"))}</span><strong>${drafts.length}</strong><small>${esc(l("nog veilig aanpasbaar", "encore modifiables", "still safely editable"))}</small></article><article><span>${esc(l("Verplichte velden", "Champs obligatoires", "Required fields"))}</span><strong>${required.length}</strong><small>${esc(l("niet retroactief toegepast", "non rétroactifs", "not applied retroactively"))}</small></article><article><span>${esc(l("Uitgebreide dossiers", "Dossiers étendus", "Extended records"))}</span><strong>${entities.size}</strong><small>${esc(l("ondersteunde entiteiten actief", "entités prises en charge actives", "supported entities active"))}</small></article></section><section class="aws-panel"><div class="aws-panel-head"><div><h3>${esc(l("Velddefinities", "Définitions des champs", "Field definitions"))}</h3><p>${esc(l("Filter op dossier of status. De backend bewaakt unieke sleutels, lifecycle, types en validatie.", "Filtrez par dossier ou statut. Le backend contrôle les clés uniques, le cycle de vie, les types et la validation.", "Filter by record or status. The backend enforces unique keys, lifecycle, types and validation."))}</p></div></div><div class="cfw-toolbar"><input id="cfwSearch" type="search" value="${esc(state.search)}" placeholder="${esc(l("Zoek naam, sleutel of groep…", "Rechercher nom, clé ou groupe…", "Search name, key or group…"))}"><select id="cfwEntity"><option value="all">${esc(l("Alle dossiers", "Tous les dossiers", "All records"))}</option>${ENTITIES.map(entity => `<option value="${entity}" ${state.entity === entity ? "selected" : ""}>${esc(entityLabel(entity))}</option>`).join("")}</select><select id="cfwStatus"><option value="all">${esc(l("Alle statussen", "Tous les statuts", "All statuses"))}</option>${["draft", "published", "archived"].map(status => `<option value="${status}" ${state.status === status ? "selected" : ""}>${esc(statusLabel(status))}</option>`).join("")}</select></div>${table}</section></div>`;
    bindMain();
  }

  function bindMain() {
    A.content().querySelectorAll("[data-cfw-mode]").forEach(button => button.addEventListener("click", () => state.onMode && state.onMode(button.dataset.cfwMode)));
    document.getElementById("cfwSearch")?.addEventListener("input", event => { state.search = event.target.value; renderLoaded(); });
    document.getElementById("cfwEntity")?.addEventListener("change", event => { state.entity = event.target.value; renderLoaded(); });
    document.getElementById("cfwStatus")?.addEventListener("change", event => { state.status = event.target.value; renderLoaded(); });
    document.getElementById("cfwNewField")?.addEventListener("click", () => openFieldEditor());
    document.getElementById("cfwEmptyNew")?.addEventListener("click", () => openFieldEditor());
    A.content().querySelectorAll("[data-cfw-open]").forEach(button => button.addEventListener("click", () => openFieldDetail(button.dataset.cfwOpen)));
  }

  function setEditor(title, context, html) {
    document.getElementById("admDrawerTitle").textContent = title;
    document.getElementById("admDrawerContext").textContent = context;
    document.getElementById("admDrawerBody").innerHTML = html;
    A.openDrawer();
    document.getElementById("admDrawer").dataset.editorKind = "config-field";
  }
  function bindClose(root) { root.querySelectorAll("[data-cfw-close]").forEach(button => button.addEventListener("click", A.closeDrawer)); }
  function actions(label) { return `<div class="aws-inline-error" data-cfw-error hidden></div><div class="adm-form-actions"><span></span><button type="button" class="adm-btn adm-btn-secondary" data-cfw-close>${esc(l("Annuleren", "Annuler", "Cancel"))}</button><button type="submit" class="adm-btn adm-btn-primary">${esc(label || l("Opslaan", "Enregistrer", "Save"))}</button></div>`; }
  function showError(error) { const box = document.querySelector("[data-cfw-error]"); if (box) { box.hidden = false; box.textContent = error.message; } else toast(error.message, "error"); }
  function optionsToText(options) { return (options || []).map(option => `${option.value}${option.label && option.label !== option.value ? ` | ${option.label}` : ""}`).join("\n"); }
  function parseOptions(text) { return String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => { const [value, ...label] = line.split("|"); return { value: value.trim(), label: (label.join("|").trim() || value.trim()) }; }); }

  async function published(entity, refresh) {
    if (!refresh && publishedCache.has(entity)) return publishedCache.get(entity);
    const result = await api("GET", `/config/fields?entity=${encodeURIComponent(entity)}&status=published`);
    const fields = (result.fields || []).filter(field => field.entity === entity && field.status === "published");
    publishedCache.set(entity, fields);
    return fields;
  }
  function runtimeLabel(field) { return field.labels && (field.labels[lang()] || field.labels.nl) || field.key; }
  function runtimeValue(field, values) {
    return values && Object.prototype.hasOwnProperty.call(values, field.key) ? values[field.key] : field.defaultValue;
  }
  function runtimeInput(field, values) {
    const value = runtimeValue(field, values); const required = field.required && field.type !== "boolean" ? "required" : ""; const id = `cf_${field.id}`;
    const common = `id="${esc(id)}" data-cfw-input="${esc(field.key)}" ${required}`;
    if (field.type === "boolean") return `<label class="cfw-runtime-toggle"><input type="checkbox" ${common} ${value === true || value === "true" ? "checked" : ""}><span>${esc(l("Ja", "Oui", "Yes"))}</span></label>`;
    if (field.type === "select") return `<select ${common}><option value="">${esc(l("Maak een keuze…", "Faites un choix…", "Select…"))}</option>${(field.options || []).map(option => `<option value="${esc(option.value)}" ${String(value == null ? "" : value) === String(option.value) ? "selected" : ""}>${esc(option.label || option.value)}</option>`).join("")}</select>`;
    if (field.type === "multiselect") { const selected = new Set(Array.isArray(value) ? value.map(String) : value == null || value === "" ? [] : [String(value)]); return `<select ${common} multiple size="${Math.min(6, Math.max(3, (field.options || []).length))}">${(field.options || []).map(option => `<option value="${esc(option.value)}" ${selected.has(String(option.value)) ? "selected" : ""}>${esc(option.label || option.value)}</option>`).join("")}</select>`; }
    const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
    const validation = field.validation || {}; const constraints = `${validation.min != null && field.type === "number" ? `min="${esc(validation.min)}"` : ""} ${validation.max != null && field.type === "number" ? `max="${esc(validation.max)}"` : ""} ${validation.pattern && field.type === "text" ? `pattern="${esc(validation.pattern)}"` : ""}`;
    return `<input type="${inputType}" ${common} ${field.type === "number" ? "step=\"any\"" : ""} ${constraints} value="${esc(value == null ? "" : value)}">`;
  }
  function renderRuntimeFields(fields, values) {
    if (!fields || !fields.length) return "";
    const groups = new Map();
    fields.forEach(field => { const group = field.group || l("Extra gegevens", "Données supplémentaires", "Additional information"); if (!groups.has(group)) groups.set(group, []); groups.get(group).push(field); });
    return `<section class="cfw-runtime"><header><span>${esc(l("Eigen velden", "Champs personnalisés", "Custom fields"))}</span><small>${esc(l("Beheerd via Koppelingen en eigen velden", "Gérés via Connexions et champs personnalisés", "Managed through Connections and custom fields"))}</small></header>${Array.from(groups, ([group, rows]) => `<div class="cfw-runtime-group"><h4>${esc(group)}</h4><div class="cfw-runtime-grid">${rows.map(field => `<div class="adm-form-group" data-cfw-field="${esc(field.key)}"><label for="cf_${esc(field.id)}">${esc(runtimeLabel(field))}${field.required ? " *" : ""}</label>${runtimeInput(field, values)}<div class="cfw-runtime-error" hidden></div></div>`).join("")}</div></div>`).join("")}</section>`;
  }
  function collectRuntimeValues(form, fields) {
    const values = {};
    (fields || []).forEach(field => { const input = Array.from(form.querySelectorAll("[data-cfw-input]")).find(node => node.dataset.cfwInput === field.key); if (!input) return; if (field.type === "boolean") values[field.key] = input.checked; else if (field.type === "multiselect") values[field.key] = Array.from(input.selectedOptions).map(option => option.value); else if (input.value !== "") values[field.key] = input.value; });
    return values;
  }
  function showRuntimeErrors(form, errors) {
    form.querySelectorAll(".cfw-runtime-error").forEach(node => { node.hidden = true; node.textContent = ""; });
    let shown = false;
    (errors || []).forEach(item => { const field = Array.from(form.querySelectorAll("[data-cfw-field]")).find(node => node.dataset.cfwField === item.key); const box = field && field.querySelector(".cfw-runtime-error"); if (box) { box.textContent = item.error || item.message || String(item); box.hidden = false; shown = true; } });
    return shown;
  }
  function renderRuntimeValues(fields, values) {
    const rows = (fields || []).filter(field => values && Object.prototype.hasOwnProperty.call(values, field.key));
    if (!rows.length) return "";
    return `<div class="cfw-runtime-values"><h4>${esc(l("Eigen velden", "Champs personnalisés", "Custom fields"))}</h4>${rows.map(field => { const raw = values[field.key]; const display = field.type === "boolean" ? (raw === true || raw === "true" ? l("Ja", "Oui", "Yes") : l("Nee", "Non", "No")) : Array.isArray(raw) ? raw.map(value => (field.options || []).find(option => option.value === value)?.label || value).join(", ") : (field.options || []).find(option => option.value === raw)?.label || raw; return `<div><span>${esc(runtimeLabel(field))}</span><strong>${esc(display == null || display === "" ? "-" : display)}</strong></div>`; }).join("")}</div>`;
  }

  function openFieldEditor(field) {
    const isEdit = Boolean(field); const immutable = field && field.status !== "draft"; const keyLocked = Boolean(field); const labels = field && field.labels || {}; const validation = field && field.validation || {};
    setEditor(isEdit ? l("Eigen veld bewerken", "Modifier le champ", "Edit custom field") : l("Nieuw eigen veld", "Nouveau champ", "New custom field"), isEdit ? `${entityLabel(field.entity)} · ${field.key}` : l("Functionele configuratie", "Configuration fonctionnelle", "Functional configuration"), `<form id="cfwFieldForm" class="aws-editor"><section class="aws-editor-intro"><span>＋</span><div><h3>${esc(l("Velddefinitie met lifecycle", "Définition avec cycle de vie", "Field definition with lifecycle"))}</h3><p>${esc(l("Een veld start als concept. Na publicatie blijven de technische sleutel en het type onveranderlijk om bestaande data te beschermen.", "Un champ commence en brouillon. Après publication, la clé et le type deviennent immuables pour protéger les données.", "A field starts in draft. After publication, its technical key and type become immutable to protect existing data."))}</p></div></section><div class="aws-form-grid"><div class="adm-form-group"><label>${esc(l("Dossier", "Dossier", "Record"))}</label><select name="entity" ${isEdit ? "disabled" : ""}>${ENTITIES.map(entity => `<option value="${entity}" ${field && field.entity === entity ? "selected" : ""}>${esc(entityLabel(entity))}</option>`).join("")}</select></div><div class="adm-form-group"><label>${esc(l("Technische sleutel", "Clé technique", "Technical key"))}</label><input name="key" required ${keyLocked ? "readonly" : ""} value="${esc(field && field.key || "")}" placeholder="project_type"><div class="adm-form-hint">${esc(isEdit ? l("De backend bewaart de sleutel na aanmaak. Maak voor een andere sleutel een nieuw veld.", "Le backend conserve la clé après création. Créez un nouveau champ pour une autre clé.", "The backend preserves the key after creation. Create a new field for a different key.") : l("Kleine letters, cijfers en underscore.", "Minuscules, chiffres et underscore.", "Lowercase letters, numbers and underscore."))}</div></div><div class="adm-form-group"><label>${esc(l("Veldtype", "Type de champ", "Field type"))}</label><select name="type" ${immutable ? "disabled" : ""}>${FIELD_TYPES.map(type => `<option value="${type}" ${field && field.type === type ? "selected" : ""}>${esc(typeLabel(type))}</option>`).join("")}</select></div><div class="adm-form-group"><label>${esc(l("Groep", "Groupe", "Group"))}</label><input name="group" value="${esc(field && field.group || "")}" placeholder="${esc(l("Bijvoorbeeld Commercieel", "Par exemple Commercial", "For example Commercial"))}"></div><div class="adm-form-group"><label>${esc(l("Label Nederlands", "Libellé néerlandais", "Dutch label"))}</label><input name="labelNl" required value="${esc(labels.nl || "")}"></div><div class="adm-form-group"><label>${esc(l("Label Frans", "Libellé français", "French label"))}</label><input name="labelFr" value="${esc(labels.fr || "")}"></div><div class="adm-form-group"><label>${esc(l("Label Engels", "Libellé anglais", "English label"))}</label><input name="labelEn" value="${esc(labels.en || "")}"></div><div class="adm-form-group"><label>${esc(l("Volgorde", "Ordre", "Order"))}</label><input name="order" type="number" min="0" step="1" value="${Number(field && field.order != null ? field.order : 99)}"></div><div class="adm-form-group wide"><label class="cfw-required"><input name="required" type="checkbox" ${field && field.required ? "checked" : ""}><span>${esc(l("Verplicht bij nieuwe en gewijzigde dossiers. Bestaande dossiers worden niet retroactief geblokkeerd.", "Obligatoire pour les nouveaux dossiers et les modifications. Les dossiers existants ne sont pas bloqués rétroactivement.", "Required for new and updated records. Existing records are not blocked retroactively."))}</span></label></div><div class="adm-form-group"><label>${esc(l("Standaardwaarde", "Valeur par défaut", "Default value"))}</label><input name="defaultValue" value="${esc(field && field.defaultValue == null ? "" : field.defaultValue)}"></div><div class="adm-form-group"><label>${esc(l("Minimum", "Minimum", "Minimum"))}</label><input name="validationMin" type="number" step="any" value="${validation.min == null ? "" : esc(validation.min)}"></div><div class="adm-form-group"><label>${esc(l("Maximum", "Maximum", "Maximum"))}</label><input name="validationMax" type="number" step="any" value="${validation.max == null ? "" : esc(validation.max)}"></div><div class="adm-form-group"><label>${esc(l("Tekstpatroon", "Motif de texte", "Text pattern"))}</label><input name="validationPattern" value="${esc(validation.pattern || "")}" placeholder="^[A-Z]{2}"></div><div class="adm-form-group wide cfw-options"><label>${esc(l("Keuzeopties", "Options", "Options"))}</label><textarea name="optionsText" placeholder="retail | Retail\nb2b | B2B">${esc(optionsToText(field && field.options))}</textarea><div class="adm-form-hint">${esc(l("Alleen voor één keuze of meerdere keuzes. Eén optie per regel: waarde | label.", "Uniquement pour les champs de choix. Une option par ligne: valeur | libellé.", "Only for select fields. One option per line: value | label."))}</div></div></div>${actions()}</form>`);
    const form = document.getElementById("cfwFieldForm"); bindClose(form);
    const syncOptionVisibility = () => { const type = form.elements.type.value; form.querySelector(".cfw-options").hidden = !["select", "multiselect"].includes(type); };
    form.elements.type.addEventListener("change", syncOptionVisibility); syncOptionVisibility();
    form.addEventListener("submit", async event => { event.preventDefault(); const raw = Object.fromEntries(new FormData(form).entries()); const data = { entity: field && field.entity || raw.entity, key: raw.key, type: field && immutable ? field.type : raw.type, labels: { nl: raw.labelNl, fr: raw.labelFr, en: raw.labelEn }, required: form.elements.required.checked, defaultValue: raw.defaultValue === "" ? null : raw.defaultValue, group: raw.group, order: Number(raw.order), validation: { min: raw.validationMin === "" ? null : Number(raw.validationMin), max: raw.validationMax === "" ? null : Number(raw.validationMax), pattern: raw.validationPattern || null }, options: parseOptions(raw.optionsText) }; if (isEdit) data.expectedVersion = field.version; try { await api(isEdit ? "PATCH" : "POST", isEdit ? `/config/fields/${field.id}` : "/config/fields", data); publishedCache.clear(); A.closeDrawer(); await load(); renderLoaded(); toast(isEdit ? l("Velddefinitie bijgewerkt", "Définition mise à jour", "Field definition updated") : l("Veld als concept aangemaakt", "Champ créé en brouillon", "Field created as draft")); } catch (error) { showError(error); } });
  }

  function openFieldDetail(id) {
    const field = state.fields.find(row => row.id === id); if (!field) return; const labels = field.labels || {}; const validation = field.validation || {}; const next = FIELD_TRANSITIONS[field.status] || [];
    setEditor(labels[lang()] || labels.nl || field.key, `${entityLabel(field.entity)} · ${field.key}`, `<div class="aws-editor"><section class="aws-detail-head"><div><span>${esc(l("Velddefinitie", "Définition de champ", "Field definition"))}</span><h3>${esc(labels[lang()] || labels.nl || field.key)}</h3><p><code>${esc(field.entity)}.${esc(field.key)}</code> · ${badge(field.status)}</p></div><div class="aws-detail-actions">${field.status !== "archived" ? `<button type="button" class="adm-btn adm-btn-secondary" id="cfwEditField">${esc(l("Bewerken", "Modifier", "Edit"))}</button>` : ""}</div></section><div class="aws-detail-grid"><section><h4>${esc(l("Gedrag", "Comportement", "Behaviour"))}</h4><dl><dt>${esc(l("Type", "Type", "Type"))}</dt><dd>${esc(typeLabel(field.type))}</dd><dt>${esc(l("Verplicht", "Obligatoire", "Required"))}</dt><dd>${esc(field.required ? l("Ja", "Oui", "Yes") : l("Nee", "Non", "No"))}</dd><dt>${esc(l("Standaardwaarde", "Valeur par défaut", "Default value"))}</dt><dd>${esc(field.defaultValue == null ? "-" : String(field.defaultValue))}</dd><dt>${esc(l("Groep en volgorde", "Groupe et ordre", "Group and order"))}</dt><dd>${esc(`${field.group || "-"} · ${field.order == null ? 99 : field.order}`)}</dd></dl></section><section><h4>${esc(l("Validatie", "Validation", "Validation"))}</h4><dl><dt>${esc(l("Minimum", "Minimum", "Minimum"))}</dt><dd>${validation.min == null ? "-" : esc(validation.min)}</dd><dt>${esc(l("Maximum", "Maximum", "Maximum"))}</dt><dd>${validation.max == null ? "-" : esc(validation.max)}</dd><dt>${esc(l("Patroon", "Motif", "Pattern"))}</dt><dd>${esc(validation.pattern || "-")}</dd><dt>${esc(l("Versie", "Version", "Version"))}</dt><dd>v${Number(field.version || 1)}</dd></dl></section><section class="wide"><h4>${esc(l("Taalvarianten", "Variantes linguistiques", "Language variants"))}</h4><div class="cfw-labels"><article><span>NL</span><strong>${esc(labels.nl || "-")}</strong></article><article><span>FR</span><strong>${esc(labels.fr || "-")}</strong></article><article><span>EN</span><strong>${esc(labels.en || "-")}</strong></article></div></section>${["select", "multiselect"].includes(field.type) ? `<section class="wide"><h4>${esc(l("Keuzeopties", "Options", "Options"))}</h4><div class="cfw-option-list">${(field.options || []).map(option => `<article><code>${esc(option.value)}</code><strong>${esc(option.label || option.value)}</strong></article>`).join("")}</div></section>` : ""}<section class="wide"><h4>${esc(l("Lifecycle", "Cycle de vie", "Lifecycle"))}</h4><div class="aws-detail-actions start">${next.map(status => `<button type="button" class="adm-btn ${status === "archived" ? "adm-btn-secondary" : "adm-btn-primary"}" data-cfw-transition="${status}">${esc(statusLabel(status))}</button>`).join("") || `<span class="aws-status neutral">${esc(l("Definitief gearchiveerd", "Archivé définitivement", "Permanently archived"))}</span>`}</div><p>${esc(field.status === "draft" ? l("Publiceren activeert de validatie voor nieuwe writes. Controleer eerst labels, type en opties.", "La publication active la validation pour les nouvelles écritures. Contrôlez les libellés, le type et les options.", "Publishing activates validation for new writes. Check labels, type and options first.") : l("Technische sleutel en veldtype zijn beschermd. Archiveren verbergt het veld voor nieuwe invoer zonder bestaande data te verwijderen.", "La clé et le type sont protégés. L’archivage masque le champ sans supprimer les données existantes.", "Technical key and field type are protected. Archiving hides the field from new input without deleting existing data."))}</p></section><section class="wide"><h4>${esc(l("Historiek", "Historique", "History"))}</h4><dl><dt>${esc(l("Aangemaakt", "Créé", "Created"))}</dt><dd>${esc(fmtDate(field.createdAt))} · ${esc(field.createdBy || "-")}</dd><dt>${esc(l("Laatst gewijzigd", "Dernière modification", "Last updated"))}</dt><dd>${esc(fmtDate(field.updatedAt))} · ${esc(field.updatedBy || "-")}</dd></dl></section></div><div class="adm-form-actions"><span></span><button type="button" class="adm-btn adm-btn-secondary" data-cfw-close>${esc(l("Sluiten", "Fermer", "Close"))}</button></div></div>`);
    const root = document.getElementById("admDrawerBody"); bindClose(root); document.getElementById("cfwEditField")?.addEventListener("click", () => openFieldEditor(field));
    root.querySelectorAll("[data-cfw-transition]").forEach(button => button.addEventListener("click", async () => { button.disabled = true; try { await api("POST", `/config/fields/${field.id}/transition`, { status: button.dataset.cfwTransition }); publishedCache.clear(); A.closeDrawer(); await load(); renderLoaded(); toast(l("Veldstatus aangepast", "Statut du champ mis à jour", "Field status updated")); } catch (error) { toast(error.message, "error"); button.disabled = false; } }));
  }

  async function render(options) {
    state.onMode = options && options.onMode;
    A.content().innerHTML = `<div class="adm-loading"><div class="adm-spinner"></div>${esc(l("Eigen velden laden…", "Chargement des champs…", "Loading custom fields…"))}</div>`;
    try { await load(); renderLoaded(); }
    catch (error) { A.content().innerHTML = `<div class="aws-error"><strong>${esc(l("Eigen velden konden niet worden geladen", "Impossible de charger les champs", "Custom fields could not be loaded"))}</strong><p>${esc(error.message)}</p><button type="button" class="adm-btn adm-btn-secondary" id="cfwRetry">${esc(l("Opnieuw proberen", "Réessayer", "Try again"))}</button></div>`; document.getElementById("cfwRetry")?.addEventListener("click", () => render(options)); }
  }

  window.wfpConfigFieldsWorkspace = { render, openFieldEditor, published, renderRuntimeFields, collectRuntimeValues, showRuntimeErrors, renderRuntimeValues };
}());
