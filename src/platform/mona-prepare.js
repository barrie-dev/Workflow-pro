"use strict";
/**
 * Mona Prepare (master-spec h48 · van detecteren naar VOORBEREIDEN).
 *
 * Waar Mona Signals (mona-signals.js) detecteert wat aandacht vraagt, zet deze
 * engine dat om in KANT-EN-KLARE, vooraf-ingevulde plannen die de gebruiker
 * alleen nog hoeft te bevestigen. "De persoon denkt het, Mona heeft het al
 * klaargezet."
 *
 * Kernontwerp (bewust):
 *  - DETERMINISTISCH en GRATIS: geen OpenAI-aanroep. Voorbereiden is lezen +
 *    structureren; het draait dus altijd, snel, en zonder AI-kost. De betaalde
 *    'ai_actions'-add-on geldt pas bij het UITVOEREN van een stap (zoals nu).
 *  - RECHTEN-VEILIG: elke stap wordt op de rechten van de gebruiker getoetst
 *    (recht + module + volledig-recht voor beheer-acties). Mag de gebruiker de
 *    actie niet uitvoeren, dan degradeert de stap naar 'navigate' (naar het
 *    juiste scherm) in plaats van te verdwijnen · de gebruiker ziet nog steeds
 *    wat er speelt.
 *  - UITVOEREN NOOIT ZELF: elk plan bestaat uit VOORSTELLEN. De UI toont ze en
 *    roept bij bevestiging het bestaande, reeds-beveiligde endpoint aan. De
 *    endpoints blijven de finale bewaker.
 *
 * Een plan:
 *   { id, kind, title, why, priority, source:{signalType,refId,targetView},
 *     steps: [{ action, label, params, endpoint:{method,path}?, needsConfirm,
 *               needsAddon, navigateTo? }], addonRequired }
 */

const { buildMonaSignals } = require("./mona-signals");
const { can } = require("../lib/auth");
const { isModuleEnabled } = require("../modules/entitlements");

const ACTIONS_ADDON = "ai_actions";
const PRIORITY = { critical: 3, warning: 2, info: 1 };

function money(v) { return `€${(Math.round(Number(v || 0) * 100) / 100).toFixed(2)}`; }
function hasFull(user, perm) {
  if (["tenant_admin", "manager"].includes(user.role)) return true;
  return (user.permissions || []).includes(perm);
}

/**
 * Bouw een stap. Vereist het opgegeven recht; ontbreekt dat, dan valt de stap
 * terug op 'navigate' zodat de gebruiker het zelf kan afhandelen op het scherm.
 * @returns stap-object
 */
function buildStep(store, tenant, user, { action, label, perm, full, method, path, params, navigateTo }) {
  const allowed = perm ? (full ? hasFull(user, perm) : can(user, perm)) : true;
  if (!allowed || !path) {
    return { action: "navigate", label: `Naar ${navigateTo || "scherm"}`, params: { view: navigateTo }, needsConfirm: false, needsAddon: false };
  }
  // Uitvoeren van een echte actie zit achter de add-on (zoals bij propose_action).
  const needsAddon = isModuleEnabled(store, tenant, ACTIONS_ADDON) ? false : true;
  return {
    action, label, params: params || {},
    endpoint: { method: method || "POST", path },
    needsConfirm: true, needsAddon,
    navigateTo: navigateTo || null,
  };
}

// ── Plan-builders per signaaltype ─────────────────────────────────────────────

/** Aanvaarde offerte → omzetten naar factuur (het endpoint doet de volledige conversie). */
function planFromAcceptedQuote(store, tenant, user, signal) {
  const q = store.get("quotes", signal.refId);
  if (!q) return null;
  const step = buildStep(store, tenant, user, {
    action: "convert_quote", label: `Offerte ${q.number} omzetten naar factuur`,
    perm: "billing", full: true, method: "POST", path: `offertes/${q.id}/convert`,
    params: { id: q.id, target: "invoice" }, navigateTo: "offertes",
  });
  return plan("convert_quote", `Offerte ${q.number} klaar om te factureren`,
    `Aanvaard op ${q.acceptedAt ? String(q.acceptedAt).slice(0, 10) : "?"} · ${money(q.total)}. Eén klik om te factureren.`,
    signal, [step]);
}

/** Afgewerkte werkbon zonder factuur → factuur voorbereiden met ingevulde klant + regel. */
function planFromWorkorder(store, tenant, user, signal) {
  const wo = store.get("workorders", signal.refId);
  if (!wo) return null;
  const amount = Number(wo.billableAmount ?? wo.fixedPrice ?? 0);
  const lines = amount > 0
    ? [{ description: `Werkbon ${wo.number || wo.id}${wo.title ? " · " + wo.title : ""}`, qty: 1, unitPrice: amount, vatRate: 21 }]
    : [{ description: `Werkbon ${wo.number || wo.id}${wo.title ? " · " + wo.title : ""}`, qty: Number(wo.billableHours ?? wo.clockedHours ?? wo.hours ?? 1) || 1, unitPrice: 0, vatRate: 21 }];
  const step = buildStep(store, tenant, user, {
    action: "create_invoice", label: `Factuur opmaken voor ${wo.number || wo.id}`,
    perm: "billing", full: true, method: "POST", path: "facturen",
    params: { customerId: wo.customerId || null, customerName: wo.clientName || wo.customerName || "", lines, notes: `Automatisch voorbereid uit werkbon ${wo.number || wo.id}`, sourceWorkorderId: wo.id },
    navigateTo: "workorders",
  });
  return plan("invoice_from_workorder", `Factuur klaar voor werkbon ${wo.number || wo.id}`,
    `Afgewerkt en factureerbaar${amount > 0 ? ` · ${money(amount)}` : ""}. Klant en regel zijn al ingevuld.`,
    signal, [step]);
}

/** Alle vervallen facturen → één plan om herinneringen te versturen. */
function planForOverdue(store, tenant, user, overdueSignals) {
  if (!overdueSignals.length) return null;
  const total = overdueSignals.reduce((s, sig) => {
    const inv = store.get("invoices", sig.refId);
    return s + Number(inv && inv.total || 0);
  }, 0);
  const step = buildStep(store, tenant, user, {
    action: "send_reminders", label: `Herinneringen versturen (${overdueSignals.length})`,
    perm: "alerts", full: true, method: "POST", path: "notifications/reminders",
    params: {}, navigateTo: "facturen",
  });
  const p = plan("send_reminders", `${overdueSignals.length} vervallen factu${overdueSignals.length === 1 ? "ur" : "ren"} · herinnering klaar`,
    `Samen ${money(total)} openstaand en vervallen. Eén klik verstuurt de herinneringen.`,
    { type: "overdue_invoice", severity: "critical", targetView: "facturen", refId: null }, [step]);
  p.priority = PRIORITY.critical;
  return p;
}

/** Signaal zonder directe actie → een 'ga fixen'-plan (navigate met context). */
function planNavigate(signal) {
  return plan(`review_${signal.type}`, signal.title, signal.detail || "Vraagt je aandacht.", signal,
    [{ action: "navigate", label: `Naar ${signal.targetView}`, params: { view: signal.targetView }, needsConfirm: false, needsAddon: false }]);
}

function plan(kind, title, why, signal, steps) {
  return {
    id: `plan_${kind}_${signal && signal.refId ? signal.refId : Math.abs(hashStr(title))}`,
    kind, title, why,
    priority: PRIORITY[signal && signal.severity] || PRIORITY.info,
    source: signal ? { signalType: signal.type, refId: signal.refId || null, targetView: signal.targetView || null } : null,
    steps,
    addonRequired: steps.some(s => s.needsAddon),
  };
}
function hashStr(s) { let h = 0; for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) | 0; return h; }

/**
 * Bouw alle voorbereide plannen voor deze gebruiker, deterministisch en
 * rechten-gescoped. Dit is de proactieve "Voorbereid voor jou"-surface.
 */
function buildPreparedWork(store, tenant, user, now = new Date()) {
  const { signals } = buildMonaSignals(store, tenant, user, now);
  const plans = [];
  const overdue = [];

  for (const sig of signals) {
    let p = null;
    if (sig.type === "invoice_leakage" && sig.module === "offertes") p = planFromAcceptedQuote(store, tenant, user, sig);
    else if (sig.type === "invoice_leakage" && sig.module === "workorders") p = planFromWorkorder(store, tenant, user, sig);
    else if (sig.type === "overdue_invoice") { overdue.push(sig); continue; }
    else p = planNavigate(sig);
    if (p) plans.push(p);
  }
  const overduePlan = planForOverdue(store, tenant, user, overdue);
  if (overduePlan) plans.push(overduePlan);

  plans.sort((a, b) => b.priority - a.priority);
  const capped = plans.slice(0, 20);
  return {
    generatedAt: now.toISOString(),
    counts: {
      total: capped.length,
      actionable: capped.filter(p => p.steps.some(s => s.action !== "navigate")).length,
      addonRequired: capped.filter(p => p.addonRequired).length,
    },
    plans: capped,
  };
}

/**
 * Bereid een VOLLEDIG project voor uit een bestaande klant (op verzoek van de
 * gebruiker of van Mona). Levert een meerstaps-plan: project + kickoff-afspraak.
 * Rechten-gescoped; ontbreekt een recht, dan degradeert die stap naar navigate.
 */
function prepareProject(store, tenant, user, { customerId = null, customerName = "", projectName = "", type = "", startDate = null } = {}, now = new Date()) {
  const cust = customerId ? store.get("customers", customerId) : null;
  if (customerId && (!cust || cust.tenantId !== tenant.id)) {
    const e = new Error("Klant niet gevonden"); e.status = 404; e.code = "CUSTOMER_NOT_FOUND"; throw e;
  }
  const name = String(projectName || "").trim() || (cust ? `Project ${cust.name}` : (customerName ? `Project ${customerName}` : "Nieuw project"));
  const start = startDate || now.toISOString().slice(0, 10);
  const custName = cust ? cust.name : customerName;

  const steps = [
    buildStep(store, tenant, user, {
      action: "create_project", label: `Project "${name}" aanmaken`,
      perm: "projects", full: true, method: "POST", path: "projects",
      params: { name, customerId: cust ? cust.id : null, customerName: custName, type: String(type || ""), startDate: start },
      navigateTo: "projects",
    }),
    buildStep(store, tenant, user, {
      action: "create_appointment", label: "Kickoff-afspraak inplannen",
      perm: "planning", full: true, method: "POST", path: "appointments",
      params: { customerName: custName, customerEmail: cust ? cust.email : "", date: start, note: `Kickoff ${name}`, reminderDays: 1 },
      navigateTo: "planning",
    }),
  ];
  return {
    id: `plan_project_${cust ? cust.id : Math.abs(hashStr(name))}`,
    kind: "prepare_project",
    title: `Project voorbereid: ${name}`,
    why: custName ? `Alles klaargezet voor ${custName}: het projectdossier en een kickoff-afspraak.` : "Projectdossier en kickoff-afspraak klaargezet.",
    priority: PRIORITY.info,
    source: null,
    steps,
    addonRequired: steps.some(s => s.needsAddon),
  };
}

module.exports = { buildPreparedWork, prepareProject };
