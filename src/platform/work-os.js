"use strict";
/**
 * Taken, formulieren, bestanden en communicatie (master-spec h39/DOC · P0).
 *
 * De Work OS-kern: samenwerking en bewijsstukken contextueel bij het juiste
 * dossier houden. Vier gedeelde platformdiensten die élke module gebruikt in
 * plaats van ze per module opnieuw te bouwen (h9: "Samenbrengen als Work
 * OS-kern"):
 *
 *  1. Formulierdesigner + gestructureerde invulling
 *  2. Taken met één primaire context en optionele relaties
 *  3. Bestanden met versies, hash en geauditeerde downloads
 *  4. Communicatietijdlijn met verzonden snapshot
 *
 * Business rules (h39):
 *  - Een taak heeft ÉÉN primaire context en optionele relaties.
 *  - Verplichte formuliervragen blokkeren inzending; de validatie is puur en
 *    dus ook offline afdwingbaar (acceptatie).
 *  - Formulierantwoorden worden GESTRUCTUREERD opgeslagen, niet enkel als PDF,
 *    zodat ze filterbaar en via de API beschikbaar zijn.
 *  - Een instantie bevriest de templateversie: een template die later wijzigt
 *    verandert nooit een reeds ingevuld formulier.
 *  - Bestanden hebben versie, type, grootte, hash en rechten; downloads worden
 *    geaudit.
 *  - Foto's uit mobiele formulieren blijven zowel gestructureerd (antwoord) als
 *    bestand beschikbaar.
 *  - Verzonden communicatie bewaart ontvangers, bijlagen en de gebruikte
 *    template als snapshot.
 *
 * Cloudblind (ADR-001): geen SDK, geen SQL, geen omgevingsvariabelen.
 */

const crypto = require("crypto");
const { newUlid } = require("./events");

// ── Formulieren ─────────────────────────────────────────────────────────────
const QUESTION_TYPES = ["text", "number", "bool", "choice", "multichoice", "date", "photo", "signature"];
const TEMPLATE_STATUSES = ["draft", "published", "archived"];
const FORM_STATUSES = ["draft", "filled", "submitted", "locked"];
const FORM_TRANSITIONS = {
  draft: ["filled", "submitted"],
  filled: ["submitted", "draft"],
  submitted: ["locked", "filled"],
  locked: [],
};

// ── Taken ───────────────────────────────────────────────────────────────────
const TASK_STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"];
const TASK_TRANSITIONS = {
  open: ["in_progress", "blocked", "done", "cancelled"],
  in_progress: ["blocked", "done", "open", "cancelled"],
  blocked: ["in_progress", "open", "cancelled"],
  done: ["open"],                      // heropenen blijft mogelijk
  cancelled: ["open"],
};
const TASK_PRIORITIES = ["laag", "normaal", "hoog", "urgent"];

// ── Bestanden ───────────────────────────────────────────────────────────────
const MAX_FILE_BYTES = 25 * 1024 * 1024;
// Uitvoerbare en scriptbare extensies worden geweigerd (h39 edge case).
const BLOCKED_EXTENSIONS = ["exe", "bat", "cmd", "com", "cpl", "dll", "js", "jse", "msi", "ps1", "scr", "sh", "vbs", "wsf", "jar", "app"];

function clean(v) { return String(v == null ? "" : v).trim(); }
function num(v, dflt = 0) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }
function isoDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : null; }
function extensionOf(name) { const m = /\.([a-z0-9]+)$/i.exec(clean(name)); return m ? m[1].toLowerCase() : ""; }
function sha256(text) { return crypto.createHash("sha256").update(String(text)).digest("hex"); }

/** Eén primaire context: entiteitstype + id (h39-business rule). */
function normalizeContext(input, { required = true } = {}) {
  const entityType = clean(input && input.entityType);
  const entityId = clean(input && input.entityId);
  if (!entityType || !entityId) {
    if (!required) return null;
    const e = new Error("Een primaire context (entityType + entityId) is verplicht"); e.status = 400; e.code = "CONTEXT_REQUIRED"; throw e;
  }
  return { entityType, entityId };
}

// ── Formulierdesigner ───────────────────────────────────────────────────────
function normalizeQuestion(q, index) {
  const label = clean(q && (q.label || q.question));
  if (!label) return null;
  const type = QUESTION_TYPES.includes(q.type) ? q.type : "text";
  const options = ["choice", "multichoice"].includes(type)
    ? (Array.isArray(q.options) ? q.options.map(clean).filter(Boolean).slice(0, 30) : [])
    : [];
  if (["choice", "multichoice"].includes(type) && !options.length) {
    const e = new Error(`Vraag '${label}' is van type ${type} en heeft keuzeopties nodig`); e.status = 400; e.code = "OPTIONS_REQUIRED"; throw e;
  }
  return {
    id: clean(q.id) || `q${index + 1}_${newUlid().slice(-6)}`,
    label, type,
    required: q.required === true,
    options,
    helpText: clean(q.helpText),
  };
}

function normalizeFormTemplate(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  const name = clean(merged.name);
  if (!name) { const e = new Error("Een formulier heeft een naam nodig"); e.status = 400; throw e; }
  const sections = (Array.isArray(merged.sections) ? merged.sections : [])
    .map((s, si) => ({
      id: clean(s.id) || `s${si + 1}`,
      title: clean(s.title) || `Sectie ${si + 1}`,
      questions: (Array.isArray(s.questions) ? s.questions : []).map(normalizeQuestion).filter(Boolean),
    }))
    .filter(s => s.questions.length);
  if (!sections.length) { const e = new Error("Een formulier heeft minstens één sectie met vragen nodig"); e.status = 400; e.code = "NO_QUESTIONS"; throw e; }
  return {
    key: clean(merged.key || name).toLowerCase().replace(/\s+/g, "_").slice(0, 60),
    name,
    description: clean(merged.description),
    sections,
    appliesTo: (Array.isArray(merged.appliesTo) ? merged.appliesTo : []).map(clean).filter(Boolean).slice(0, 20),
  };
}

/** Alle vragen van een template, plat (handig voor validatie en export). */
function allQuestions(template) {
  return (template.sections || []).flatMap(s => (s.questions || []).map(q => ({ ...q, sectionId: s.id, sectionTitle: s.title })));
}

/**
 * Valideer antwoorden tegen de (bevroren) template. PUUR, zodat de mobiele
 * client exact dezelfde regels offline kan afdwingen (acceptatie h39).
 * Geeft de ontbrekende verplichte vragen én typefouten terug.
 */
function validateAnswers(template, answers) {
  const missing = [], invalid = [];
  const given = answers && typeof answers === "object" ? answers : {};
  for (const q of allQuestions(template)) {
    const raw = given[q.id];
    const empty = raw === undefined || raw === null || clean(raw) === "" || (Array.isArray(raw) && !raw.length);
    if (q.required && empty) { missing.push({ id: q.id, label: q.label }); continue; }
    if (empty) continue;
    if (q.type === "number" && !Number.isFinite(Number(raw))) invalid.push({ id: q.id, label: q.label, reason: "Geen geldig getal" });
    if (q.type === "bool" && typeof raw !== "boolean") invalid.push({ id: q.id, label: q.label, reason: "Verwacht ja of nee" });
    if (q.type === "date" && !isoDate(raw)) invalid.push({ id: q.id, label: q.label, reason: "Verwacht een datum (JJJJ-MM-DD)" });
    if (q.type === "choice" && !q.options.includes(String(raw))) invalid.push({ id: q.id, label: q.label, reason: "Onbekende keuze" });
    if (q.type === "multichoice") {
      const vals = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      if (vals.some(v => !q.options.includes(v))) invalid.push({ id: q.id, label: q.label, reason: "Onbekende keuze" });
    }
  }
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

function makeFormTemplateRepository(store) {
  const col = "formTemplates";
  return {
    list(tenantId, { status, appliesTo } = {}) {
      return (store.list(col, tenantId) || [])
        .filter(t => (!status || t.status === status) && (!appliesTo || (t.appliesTo || []).includes(appliesTo)))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(t => t.id === id) || null; },
    insert(tenantId, payload, actor) {
      const normalized = normalizeFormTemplate(payload, null);
      const now = new Date().toISOString();
      return store.insert(col, {
        id: `frm_${newUlid()}`, tenantId, ...normalized,
        status: "draft", version: 1,
        createdAt: now, createdBy: actor || null, updatedAt: now, updatedBy: actor || null,
      });
    },
    /**
     * Wijzigen van een GEPUBLICEERD formulier verhoogt de versie. Bestaande
     * instanties dragen hun eigen bevroren kopie, dus die veranderen niet mee
     * (h39 edge case "formulier wijzigt na gebruik").
     */
    update(tenantId, id, payload, actor) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Formulier niet gevonden"); e.status = 404; throw e; }
      if (existing.status === "archived") { const e = new Error("Een gearchiveerd formulier kan niet gewijzigd worden"); e.status = 409; e.code = "ARCHIVED"; throw e; }
      const normalized = normalizeFormTemplate(payload, existing);
      // De sleutel ligt vast zodra er gepubliceerd is.
      if (existing.status === "published" && normalized.key !== existing.key) {
        const e = new Error("De sleutel van een gepubliceerd formulier ligt vast"); e.status = 409; e.code = "KEY_IMMUTABLE"; throw e;
      }
      return store.update(col, id, {
        ...normalized,
        key: existing.status === "published" ? existing.key : normalized.key,
        version: Number(existing.version || 1) + 1,
        updatedAt: new Date().toISOString(), updatedBy: actor || null,
      });
    },
    transition(tenantId, id, to, actor) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Formulier niet gevonden"); e.status = 404; throw e; }
      if (!TEMPLATE_STATUSES.includes(to)) { const e = new Error(`Onbekende status '${to}'`); e.status = 400; throw e; }
      if (existing.status === "archived") { const e = new Error("Een gearchiveerd formulier kan niet heropend worden"); e.status = 409; e.code = "ARCHIVED"; throw e; }
      return store.update(col, id, { status: to, updatedAt: new Date().toISOString(), updatedBy: actor || null });
    },
  };
}

// ── Formulierinvulling ──────────────────────────────────────────────────────
function makeFormInstanceRepository(store, templateRepo) {
  const col = "formInstances";
  return {
    list(tenantId, { templateId, entityType, entityId, status } = {}) {
      return (store.list(col, tenantId) || [])
        .filter(f => (!templateId || f.templateId === templateId)
          && (!status || f.status === status)
          && (!entityType || (f.context && f.context.entityType === entityType))
          && (!entityId || (f.context && f.context.entityId === entityId)))
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(f => f.id === id) || null; },
    /** Start een invulling; bevriest de templatedefinitie op dat moment. */
    start(tenantId, { templateId, context, answers }, actor) {
      const template = templateRepo.findById(tenantId, templateId);
      if (!template) { const e = new Error("Formulier niet gevonden"); e.status = 404; throw e; }
      if (template.status !== "published") { const e = new Error("Alleen een gepubliceerd formulier kan ingevuld worden"); e.status = 409; e.code = "NOT_PUBLISHED"; throw e; }
      const now = new Date().toISOString();
      return store.insert(col, {
        id: `fi_${newUlid()}`, tenantId,
        templateId, templateKey: template.key, templateVersion: template.version,
        // Bevroren kopie: latere templatewijzigingen raken deze invulling niet.
        templateSnapshot: { name: template.name, sections: template.sections },
        context: normalizeContext(context),
        answers: answers && typeof answers === "object" ? answers : {},
        photos: [],
        status: "draft",
        createdAt: now, createdBy: actor || null, updatedAt: now, updatedBy: actor || null,
        submittedAt: null, submittedBy: null,
      });
    },
    saveAnswers(tenantId, id, answers, actor) {
      const inst = this.findById(tenantId, id);
      if (!inst) { const e = new Error("Formulierinvulling niet gevonden"); e.status = 404; throw e; }
      if (["submitted", "locked"].includes(inst.status)) {
        const e = new Error("Een ingediend formulier kan niet meer gewijzigd worden"); e.status = 409; e.code = "FORM_LOCKED"; throw e;
      }
      const merged = { ...(inst.answers || {}), ...(answers || {}) };
      const check = validateAnswers(inst.templateSnapshot, merged);
      return store.update(col, id, {
        answers: merged,
        status: check.ok ? "filled" : "draft",
        updatedAt: new Date().toISOString(), updatedBy: actor || null,
      });
    },
    /** Indienen: verplichte vragen blokkeren (h39-business rule). */
    submit(tenantId, id, actor) {
      const inst = this.findById(tenantId, id);
      if (!inst) { const e = new Error("Formulierinvulling niet gevonden"); e.status = 404; throw e; }
      if (inst.status === "locked") { const e = new Error("Dit formulier is vergrendeld"); e.status = 409; e.code = "FORM_LOCKED"; throw e; }
      const check = validateAnswers(inst.templateSnapshot, inst.answers);
      if (!check.ok) {
        const e = new Error(check.missing.length
          ? `Verplichte vragen ontbreken: ${check.missing.map(m => m.label).join(", ")}`
          : `Ongeldige antwoorden: ${check.invalid.map(i => `${i.label} (${i.reason})`).join(", ")}`);
        e.status = 400; e.code = check.missing.length ? "REQUIRED_MISSING" : "INVALID_ANSWERS";
        e.missing = check.missing; e.invalid = check.invalid;
        throw e;
      }
      return store.update(col, id, {
        status: "submitted", submittedAt: new Date().toISOString(), submittedBy: actor || null,
        updatedAt: new Date().toISOString(),
      });
    },
    lock(tenantId, id, actor) {
      const inst = this.findById(tenantId, id);
      if (!inst) { const e = new Error("Formulierinvulling niet gevonden"); e.status = 404; throw e; }
      if (inst.status !== "submitted") { const e = new Error("Alleen een ingediend formulier kan vergrendeld worden"); e.status = 409; e.code = "INVALID_TRANSITION"; throw e; }
      return store.update(col, id, { status: "locked", updatedAt: new Date().toISOString(), updatedBy: actor || null });
    },
    /** Koppel een foto zowel gestructureerd (antwoord) als bestand (h39). */
    attachPhoto(tenantId, id, { questionId, fileId }, actor) {
      const inst = this.findById(tenantId, id);
      if (!inst) { const e = new Error("Formulierinvulling niet gevonden"); e.status = 404; throw e; }
      if (["submitted", "locked"].includes(inst.status)) { const e = new Error("Een ingediend formulier kan niet meer gewijzigd worden"); e.status = 409; e.code = "FORM_LOCKED"; throw e; }
      const photos = [...(inst.photos || []), { questionId: clean(questionId), fileId: clean(fileId), at: new Date().toISOString() }];
      const answers = { ...(inst.answers || {}) };
      if (questionId) answers[questionId] = [...(Array.isArray(answers[questionId]) ? answers[questionId] : []), clean(fileId)];
      return store.update(col, id, { photos, answers, updatedAt: new Date().toISOString(), updatedBy: actor || null });
    },
  };
}

// ── Taken ───────────────────────────────────────────────────────────────────
function normalizeTask(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  const title = clean(merged.title);
  if (!title) { const e = new Error("Een taak heeft een titel nodig"); e.status = 400; throw e; }
  return {
    title,
    type: clean(merged.type) || "algemeen",
    description: clean(merged.description),
    // Eén primaire context, plus optionele relaties (h39-business rule).
    context: normalizeContext(merged.context),
    relations: (Array.isArray(merged.relations) ? merged.relations : [])
      .map(r => normalizeContext(r, { required: false })).filter(Boolean).slice(0, 20),
    assigneeId: clean(merged.assigneeId) || null,
    teamId: clean(merged.teamId) || null,
    dueDate: isoDate(merged.dueDate),
    priority: TASK_PRIORITIES.includes(merged.priority) ? merged.priority : "normaal",
    tags: (Array.isArray(merged.tags) ? merged.tags : []).map(clean).filter(Boolean).slice(0, 15),
  };
}

function makeTaskRepository(store) {
  const col = "tasks";
  return {
    list(tenantId, { assigneeId, teamId, status, entityType, entityId, overdueOn } = {}) {
      return (store.list(col, tenantId) || [])
        .filter(t => (!assigneeId || String(t.assigneeId) === String(assigneeId))
          && (!teamId || t.teamId === teamId)
          && (!status || t.status === status)
          && (!entityType || (t.context && t.context.entityType === entityType))
          && (!entityId || (t.context && t.context.entityId === entityId))
          && (!overdueOn || (t.dueDate && t.dueDate < overdueOn && !["done", "cancelled"].includes(t.status))))
        .sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
    },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(t => t.id === id) || null; },
    insert(tenantId, payload, actor) {
      const normalized = normalizeTask(payload, null);
      const now = new Date().toISOString();
      return store.insert(col, {
        id: `task_${newUlid()}`, tenantId, ...normalized,
        status: "open", version: 1,
        createdAt: now, createdBy: actor || null, updatedAt: now, updatedBy: actor || null, completedAt: null,
      });
    },
    update(tenantId, id, patch, actor, expectedVersion) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Taak niet gevonden"); e.status = 404; throw e; }
      if (expectedVersion != null && Number(existing.version || 1) !== Number(expectedVersion)) {
        const e = new Error("De taak is intussen gewijzigd."); e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = existing.version; throw e;
      }
      const normalized = normalizeTask(patch, existing);
      return store.update(col, id, { ...normalized, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
    },
    transition(tenantId, id, to, actor) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Taak niet gevonden"); e.status = 404; throw e; }
      if (existing.status === to) return existing;
      if (!(TASK_TRANSITIONS[existing.status] || []).includes(to)) {
        const e = new Error(`Ongeldige statusovergang: ${existing.status} → ${to}`); e.status = 409; e.code = "INVALID_TRANSITION"; throw e;
      }
      return store.update(col, id, {
        status: to,
        completedAt: to === "done" ? new Date().toISOString() : null,
        version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null,
      });
    },
    remove(tenantId, id) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Taak niet gevonden"); e.status = 404; throw e; }
      store.remove(col, id);
      return { ok: true };
    },
  };
}

// ── Bestanden ───────────────────────────────────────────────────────────────
/**
 * Bestandsmetadata met versieketen. De inhoud zelf leeft in de opslagadapter;
 * hier bewaren we versie, type, grootte, hash en rechten (h39-business rule).
 */
function normalizeFileMeta(payload) {
  const name = clean(payload && payload.name);
  if (!name) { const e = new Error("Bestandsnaam is verplicht"); e.status = 400; throw e; }
  const ext = extensionOf(name);
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    const e = new Error(`Bestandstype '.${ext}' is niet toegestaan`); e.status = 400; e.code = "UNSAFE_EXTENSION"; throw e;
  }
  const size = num(payload.size, 0);
  if (size > MAX_FILE_BYTES) {
    const e = new Error(`Bestand is te groot (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB)`); e.status = 413; e.code = "FILE_TOO_LARGE"; throw e;
  }
  return {
    name, extension: ext,
    mimeType: clean(payload.mimeType) || "application/octet-stream",
    size,
    // Hash identificeert de inhoud; meegegeven of afgeleid van de referentie.
    hash: clean(payload.hash) || sha256(`${name}:${size}:${clean(payload.storageRef)}`),
    storageRef: clean(payload.storageRef) || null,
  };
}

function makeFileRepository(store) {
  const col = "files";
  return {
    list(tenantId, { entityType, entityId } = {}) {
      return (store.list(col, tenantId) || [])
        .filter(f => (!entityType || (f.context && f.context.entityType === entityType))
          && (!entityId || (f.context && f.context.entityId === entityId)))
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(f => f.id === id) || null; },
    insert(tenantId, payload, actor) {
      const meta = normalizeFileMeta(payload);
      const now = new Date().toISOString();
      const version = { version: 1, hash: meta.hash, size: meta.size, storageRef: meta.storageRef, uploadedAt: now, uploadedBy: actor || null };
      return store.insert(col, {
        id: `file_${newUlid()}`, tenantId,
        ...meta,
        context: normalizeContext(payload.context, { required: false }),
        visibility: ["internal", "customer"].includes(payload.visibility) ? payload.visibility : "internal",
        currentVersion: 1,
        versions: [version],
        downloads: [],
        createdAt: now, createdBy: actor || null,
      });
    },
    /** Nieuwe versie · vervangt nooit de vorige (h39: bestanden hebben versies). */
    addVersion(tenantId, id, payload, actor) {
      const file = this.findById(tenantId, id);
      if (!file) { const e = new Error("Bestand niet gevonden"); e.status = 404; throw e; }
      const meta = normalizeFileMeta({ ...payload, name: payload.name || file.name });
      const nextVersion = Number(file.currentVersion || 1) + 1;
      const version = { version: nextVersion, hash: meta.hash, size: meta.size, storageRef: meta.storageRef, uploadedAt: new Date().toISOString(), uploadedBy: actor || null };
      return store.update(col, id, {
        size: meta.size, hash: meta.hash, mimeType: meta.mimeType, storageRef: meta.storageRef,
        currentVersion: nextVersion,
        versions: [...(file.versions || []), version],
      });
    },
    /**
     * Registreer een download. Downloads worden geaudit (acceptatie h39); de
     * aanroeper schrijft daarnaast een auditregel via store.audit.
     */
    recordDownload(tenantId, id, { version, actor, ip } = {}) {
      const file = this.findById(tenantId, id);
      if (!file) { const e = new Error("Bestand niet gevonden"); e.status = 404; throw e; }
      const v = Number(version) || file.currentVersion;
      if (!(file.versions || []).some(x => x.version === v)) { const e = new Error(`Versie ${v} bestaat niet`); e.status = 404; e.code = "VERSION_NOT_FOUND"; throw e; }
      const entry = { at: new Date().toISOString(), version: v, by: actor || null, ip: ip || null };
      // Ringbuffer: de laatste 200 downloads volstaan voor traceerbaarheid.
      const downloads = [...(file.downloads || []), entry].slice(-200);
      store.update(col, id, { downloads });
      return entry;
    },
    remove(tenantId, id) {
      const file = this.findById(tenantId, id);
      if (!file) { const e = new Error("Bestand niet gevonden"); e.status = 404; throw e; }
      store.remove(col, id);
      return { ok: true };
    },
  };
}

// ── Communicatietijdlijn ────────────────────────────────────────────────────
/**
 * Veilige vervangingscodes (h39-business rule): alleen expliciet toegelaten
 * merge-velden worden vervangen; onbekende codes blijven zichtbaar staan in
 * plaats van stilzwijgend te verdwijnen, en waarden worden nooit als code
 * geïnterpreteerd (geen recursieve vervanging).
 */
function renderTemplate(text, values = {}) {
  const used = [], unknown = [];
  const out = String(text || "").replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, code) => {
    if (Object.prototype.hasOwnProperty.call(values, code)) {
      used.push(code);
      return String(values[code] == null ? "" : values[code]);
    }
    unknown.push(code);
    return match;
  });
  return { text: out, used, unknown };
}

function makeCommunicationRepository(store) {
  const col = "communications";
  return {
    list(tenantId, { entityType, entityId, channel } = {}) {
      return (store.list(col, tenantId) || [])
        .filter(c => (!channel || c.channel === channel)
          && (!entityType || (c.context && c.context.entityType === entityType))
          && (!entityId || (c.context && c.context.entityId === entityId)))
        .sort((a, b) => String(b.sentAt || "").localeCompare(String(a.sentAt || "")));
    },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(c => c.id === id) || null; },
    /**
     * Leg verzonden communicatie vast als SNAPSHOT: ontvangers, bijlagen en de
     * gebruikte template blijven bewaard, ook als template of klantgegevens
     * later wijzigen (acceptatie h39).
     */
    record(tenantId, payload, actor) {
      const to = (Array.isArray(payload.to) ? payload.to : [payload.to]).map(clean).filter(Boolean);
      if (!to.length) { const e = new Error("Minstens één ontvanger is vereist"); e.status = 400; e.code = "NO_RECIPIENTS"; throw e; }
      const subject = clean(payload.subject);
      if (!subject) { const e = new Error("Een onderwerp is vereist"); e.status = 400; throw e; }
      const now = new Date().toISOString();
      return store.insert(col, {
        id: `comm_${newUlid()}`, tenantId,
        channel: ["email", "sms", "portal", "note"].includes(payload.channel) ? payload.channel : "email",
        context: normalizeContext(payload.context, { required: false }),
        to, cc: (Array.isArray(payload.cc) ? payload.cc : []).map(clean).filter(Boolean),
        subject,
        body: clean(payload.body),
        // Snapshot van de gebruikte template (sleutel + versie + gerenderde tekst).
        template: payload.templateKey ? { key: clean(payload.templateKey), version: payload.templateVersion || null } : null,
        attachments: (Array.isArray(payload.attachments) ? payload.attachments : [])
          .map(a => ({ fileId: clean(a.fileId), name: clean(a.name), version: a.version || null }))
          .filter(a => a.fileId || a.name),
        status: "sent",
        sentAt: now, sentBy: actor || null,
      });
    },
  };
}

module.exports = {
  QUESTION_TYPES, TEMPLATE_STATUSES, FORM_STATUSES, FORM_TRANSITIONS,
  TASK_STATUSES, TASK_TRANSITIONS, TASK_PRIORITIES,
  MAX_FILE_BYTES, BLOCKED_EXTENSIONS,
  normalizeContext, normalizeFormTemplate, normalizeTask, normalizeFileMeta,
  allQuestions, validateAnswers, renderTemplate, sha256,
  makeFormTemplateRepository, makeFormInstanceRepository, makeTaskRepository,
  makeFileRepository, makeCommunicationRepository,
};
