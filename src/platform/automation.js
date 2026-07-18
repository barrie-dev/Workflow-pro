"use strict";
/**
 * Automation engine (master-spec h13/E11, AUT).
 *
 * Versioned flows die triggeren op domain events, met een voorwaardenboom en
 * actiestappen. Business rules (h13):
 *  - iedere flow heeft een unieke versie · lopende runs blijven op hun versie;
 *  - een flow is idempotent of heeft een expliciete herhaalstrategie;
 *  - een actie die een nieuwe trigger veroorzaakt heeft LUSDETECTIE;
 *  - financiële boeking/betaling/definitieve verzending vereisen expliciet
 *    beleid en meestal menselijke goedkeuring → die acties worden hier NIET
 *    automatisch uitgevoerd (requires_approval);
 *  - elke automatische wijziging toont flow-ID, run-ID en versie in de audit.
 *
 * Veilig-uit-te-voeren acties in deze engine: notify (in-app melding),
 * set_field (whitelist op het bronrecord) en log. Overige acties worden
 * geregistreerd als requires_approval / not_implemented. Basis voor Mona
 * Actions. Geen vendor/SQL (ADR-001).
 */

const { newUlid } = require("./events");

const FLOW_STATUSES = ["draft", "active", "paused", "retired"];
const RUN_STATUSES = ["scheduled", "running", "waiting", "success", "partial", "failed", "cancelled"];
// Acties die de engine zelf mag uitvoeren (geen financiële/verzendimpact).
const SAFE_ACTIONS = ["notify", "set_field", "log"];
// Acties die menselijke goedkeuring/beleid vereisen (h13) → niet auto-uitvoeren.
const GUARDED_ACTIONS = ["send_email", "generate_document", "post_financial", "payment", "webhook", "lock_record"];
const CONDITION_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "exists", "in"];
const MAX_AUTOMATION_DEPTH = 3;
// Whitelist van velden die set_field per aggregate mag aanraken (geen status/
// financiële velden · die lopen via hun eigen statemachine + goedkeuring).
const SETTABLE_FIELDS = {
  customer: ["notes", "creditStatus"],
  project: ["notes"],
  workorder: ["priority", "notes"],
  inquiry: ["status"],
  quote: ["notes"],
};

function clean(v) { return String(v == null ? "" : v).trim(); }

function normalizeCondition(c) {
  const field = clean(c && c.field);
  const op = CONDITION_OPS.includes(c && c.op) ? c.op : "eq";
  if (!field) return null;
  return { field, op, value: c.value };
}

function normalizeAction(a) {
  const type = clean(a && a.type);
  if (!type) return null;
  return { type, params: (a && a.params && typeof a.params === "object") ? a.params : {} };
}

function normalizeFlow(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  const name = clean(merged.name);
  if (!name) { const e = new Error("Flownaam is verplicht"); e.status = 400; throw e; }
  const trigger = clean(merged.trigger);
  if (!existing && !/^[a-z][a-z_]*\.[a-z][a-z_]*$/.test(trigger)) { const e = new Error("Trigger moet een eventtype zijn (bv. invoice.created)"); e.status = 400; throw e; }
  const conditions = (Array.isArray(merged.conditions) ? merged.conditions : []).map(normalizeCondition).filter(Boolean);
  const actions = (Array.isArray(merged.actions) ? merged.actions : []).map(normalizeAction).filter(Boolean);
  if (!existing && !actions.length) { const e = new Error("Minimaal 1 actiestap vereist"); e.status = 400; throw e; }
  return {
    name,
    trigger: trigger || (existing && existing.trigger),
    description: clean(merged.description),
    conditions,
    actions,
    // Herhaalstrategie: "idempotent" (default) draait max één keer per
    // bron-aggregate; "always" mag elke keer.
    repeat: ["idempotent", "always"].includes(merged.repeat) ? merged.repeat : "idempotent",
  };
}

/** Haal een (mogelijk genest) veld uit het event, bv. "data.deliveryStatus". */
function pickField(event, field) {
  return String(field).split(".").reduce((o, k) => (o == null ? undefined : o[k]), event);
}

function evalCondition(cond, event) {
  const actual = pickField(event, cond.field);
  const v = cond.value;
  switch (cond.op) {
    case "eq": return actual === v || String(actual) === String(v);
    case "ne": return !(actual === v || String(actual) === String(v));
    case "gt": return Number(actual) > Number(v);
    case "gte": return Number(actual) >= Number(v);
    case "lt": return Number(actual) < Number(v);
    case "lte": return Number(actual) <= Number(v);
    case "contains": return String(actual || "").toLowerCase().includes(String(v || "").toLowerCase());
    case "exists": return actual != null && actual !== "";
    case "in": return Array.isArray(v) && v.some(x => String(x) === String(actual));
    default: return false;
  }
}

/** Alle voorwaarden (AND). Lege boom = altijd waar. */
function evaluateConditions(conditions, event) {
  return (conditions || []).every(c => evalCondition(c, event));
}

// ── Repository (versioned flows + runs) ──────────────────────────────────────
function makeAutomationRepository(store) {
  const col = "automationFlows";
  const runsCol = "automationRuns";
  return {
    list(tenantId, opts = {}) {
      let rows = (store.list(col, tenantId) || []).slice();
      if (opts.status) rows = rows.filter(f => f.status === opts.status);
      if (opts.trigger) rows = rows.filter(f => f.trigger === opts.trigger);
      return rows;
    },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(f => f.id === id) || null; },
    activeForTrigger(tenantId, trigger) { return this.list(tenantId, { status: "active", trigger }); },
    insert(tenantId, payload, actor) {
      const normalized = normalizeFlow(payload, null);
      const now = new Date().toISOString();
      return store.insert(col, { id: `flow_${newUlid()}`, tenantId, ...normalized, status: "draft", version: 1, createdAt: now, createdBy: actor || null, updatedAt: now, updatedBy: actor || null });
    },
    update(tenantId, id, patch, actor, expectedVersion) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Flow niet gevonden"); e.status = 404; throw e; }
      if (expectedVersion != null && Number(existing.version || 1) !== Number(expectedVersion)) { const e = new Error("De flow is intussen gewijzigd."); e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = existing.version || 1; throw e; }
      const normalized = normalizeFlow({ ...patch, trigger: existing.trigger }, existing);
      // Elke definitiewijziging verhoogt de versie (h13: lopende runs blijven op hun versie).
      return store.update(col, id, { ...normalized, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
    },
    transition(tenantId, id, toStatus, actor) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Flow niet gevonden"); e.status = 404; throw e; }
      if (!FLOW_STATUSES.includes(toStatus)) { const e = new Error(`Ongeldige status '${toStatus}'`); e.status = 400; throw e; }
      const allowed = { draft: ["active", "retired"], active: ["paused", "retired"], paused: ["active", "retired"], retired: [] };
      if (existing.status === toStatus) return existing;
      if (!(allowed[existing.status] || []).includes(toStatus)) { const e = new Error(`Overgang van '${existing.status}' naar '${toStatus}' is niet toegestaan`); e.status = 409; e.code = "INVALID_TRANSITION"; throw e; }
      return store.update(col, id, { status: toStatus, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
    },
    remove(tenantId, id) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Flow niet gevonden"); e.status = 404; throw e; }
      if (existing.status === "active") { const e = new Error("Een actieve flow kan niet worden verwijderd · pauzeer of trek in"); e.status = 409; throw e; }
      store.remove(col, id);
      return { ok: true };
    },
    listRuns(tenantId, opts = {}) {
      let rows = (store.list(runsCol, tenantId) || []).slice().reverse();
      if (opts.flowId) rows = rows.filter(r => r.flowId === opts.flowId);
      return rows.slice(0, Math.min(Number(opts.limit) || 50, 200));
    },
    recordRun(tenantId, run) {
      if (!Array.isArray(store.data[runsCol])) store.data[runsCol] = [];
      store.data[runsCol].push(run);
      if (store.data[runsCol].length > 3000) store.data[runsCol] = store.data[runsCol].slice(-3000);
      if (typeof store.save === "function") store.save();
      return run;
    },
  };
}

/**
 * Voer één flow uit voor een event (of dry-run). Retourneert een run-record met
 * per stap het resultaat. Veilige acties worden echt uitgevoerd; bewaakte
 * acties worden geregistreerd als requires_approval.
 * @param {object} deps { emit } - optionele domain-event-emitter voor set_field
 */
function executeFlow(store, tenant, flow, event, opts = {}, deps = {}) {
  const dryRun = !!opts.dryRun;
  const runId = `run_${newUlid()}`;
  const steps = [];
  const depth = Number((event && event.data && event.data._automationDepth) || 0);

  const matched = evaluateConditions(flow.conditions, event);
  if (!matched) {
    return { id: runId, tenantId: tenant.id, flowId: flow.id, flowVersion: flow.version, eventType: event.eventType, aggregateId: event.aggregateId, status: "cancelled", reason: "conditions_not_met", steps, at: new Date().toISOString(), dryRun };
  }
  // Lusdetectie (h13): een actie-geïnduceerd event mag niet oneindig hertriggeren.
  if (depth >= MAX_AUTOMATION_DEPTH) {
    return { id: runId, tenantId: tenant.id, flowId: flow.id, flowVersion: flow.version, eventType: event.eventType, aggregateId: event.aggregateId, status: "cancelled", reason: "loop_guard", steps, at: new Date().toISOString(), dryRun };
  }

  let ok = 0, failed = 0;
  for (const action of flow.actions) {
    const step = { type: action.type, status: "pending" };
    try {
      if (GUARDED_ACTIONS.includes(action.type)) {
        step.status = "requires_approval";
        step.detail = "Actie vereist beleid/goedkeuring · niet automatisch uitgevoerd";
      } else if (action.type === "log") {
        step.status = "success"; step.detail = clean(action.params.message) || "log";
      } else if (action.type === "notify") {
        if (!dryRun) {
          if (!Array.isArray(store.data.notifications)) store.data.notifications = [];
          store.data.notifications.push({
            id: `notif_${newUlid()}`, tenantId: tenant.id,
            type: "automation", channel: "in_app",
            audience: clean(action.params.audience) || "admins",
            title: clean(action.params.title) || flow.name,
            body: clean(action.params.body) || `Automatische melding (${event.eventType})`,
            priority: ["high", "normal", "low"].includes(action.params.priority) ? action.params.priority : "normal",
            sourceRef: `automation:${flow.id}:${event.aggregateId}`,
            createdAt: new Date().toISOString(), readAt: null,
          });
          if (typeof store.save === "function") store.save();
        }
        step.status = "success";
      } else if (action.type === "set_field") {
        const aggregate = event.aggregateType;
        const collection = { customer: "customers", project: "projects", workorder: "workorders", inquiry: "inquiries", quote: "quotes" }[aggregate];
        const allowed = SETTABLE_FIELDS[aggregate] || [];
        const field = clean(action.params.field);
        if (!collection || !allowed.includes(field)) {
          step.status = "skipped"; step.detail = `veld '${field}' op '${aggregate}' niet toegestaan`;
        } else {
          if (!dryRun) {
            const rec = (store.list(collection, tenant.id) || []).find(r => r.id === event.aggregateId);
            if (rec) { store.update(collection, rec.id, { [field]: action.params.value, updatedAt: new Date().toISOString() }); }
          }
          step.status = "success"; step.detail = `${field} = ${action.params.value}`;
        }
      } else {
        step.status = "skipped"; step.detail = "onbekende actie";
      }
    } catch (e) {
      step.status = "failed"; step.detail = e.message;
    }
    if (step.status === "success") ok += 1;
    else if (step.status === "failed") failed += 1;
    steps.push(step);
  }

  const status = failed ? (ok ? "partial" : "failed") : "success";
  const run = { id: runId, tenantId: tenant.id, flowId: flow.id, flowVersion: flow.version, eventType: event.eventType, aggregateId: event.aggregateId, status, steps, at: new Date().toISOString(), dryRun };
  return run;
}

/**
 * Dispatcher voor de event-listener: draait alle actieve flows die op het
 * eventtype matchen. Idempotent-flows draaien max één keer per bron-aggregate.
 */
function makeDispatcher(store, deps = {}) {
  return function dispatch(evStore, event) {
    const s = evStore || store;
    const tenant = (s.data.tenants || []).find(t => t.id === event.tenantId);
    if (!tenant) return;
    const repo = makeAutomationRepository(s);
    for (const flow of repo.activeForTrigger(event.tenantId, event.eventType)) {
      if (flow.repeat === "idempotent") {
        const prior = repo.listRuns(event.tenantId, { flowId: flow.id, limit: 200 })
          .find(r => r.aggregateId === event.aggregateId && r.status !== "cancelled");
        if (prior) continue;
      }
      const run = executeFlow(s, tenant, flow, event, {}, deps);
      repo.recordRun(event.tenantId, run);
    }
  };
}

module.exports = {
  FLOW_STATUSES, RUN_STATUSES, SAFE_ACTIONS, GUARDED_ACTIONS, CONDITION_OPS, MAX_AUTOMATION_DEPTH,
  normalizeFlow, evaluateConditions, evalCondition, executeFlow,
  makeAutomationRepository, makeDispatcher,
};
