"use strict";
/**
 * Work Inbox (master-spec E09/GRID, h11-contract · GRD).
 *
 * Eén geconsolideerde werklijst: openstaande taken, goedkeuringen (verlof,
 * onkosten, inkooporders), klantvragen, achterstallige documenten en de
 * kritieke Mona-signals. Rechten-gescoped (h11: "filters respecteren dezelfde
 * rechten als recordweergave"); elk item is genormaliseerd naar
 * { id, type, priority, title, context, dueAt, targetView, refId, actions }.
 *
 * Read-model bovenop bestaande bronnen; geen vendor/SQL (ADR-001). Dit is het
 * geconsolideerde backend-equivalent van het frontend-Actiecentrum.
 */

const { can } = require("../lib/auth");
const { isModuleEnabled } = require("../modules/entitlements");
const { buildMonaSignals } = require("./mona-signals");

const PRIORITY_RANK = { critical: 3, high: 2, normal: 1, low: 0 };
const MAX_ITEMS = 80;

function item(o) {
  return {
    id: o.id, type: o.type, priority: o.priority || "normal",
    title: o.title, context: o.context || "", dueAt: o.dueAt || null,
    targetView: o.targetView || null, refId: o.refId || null,
    actions: o.actions || [],
  };
}

/**
 * @returns {{ generatedAt, items:[...], counts:{ total, byType, byPriority } }}
 */
function buildWorkInbox(store, tenant, user, now = new Date()) {
  const tenantId = tenant.id;
  const today = now.toISOString().slice(0, 10);
  const items = [];
  const canSee = perm => can(user, perm);
  const mod = key => isModuleEnabled(store, tenant, key);

  // ── Notificaties (ongelezen) ───────────────────────────────────────────────
  for (const n of store.list("notifications", tenantId) || []) {
    const forMe = n.audience === "admins" ? ["tenant_admin", "super_admin"].includes(user.role)
      : n.audience === user.id || n.userId === user.id || n.audience === "all";
    if (!forMe || n.readAt || n.status === "read") continue;
    items.push(item({ id: `notif:${n.id}`, type: "notification", priority: n.priority === "high" ? "high" : "normal", title: n.title || "Melding", context: n.body || "", refId: n.id, targetView: null, actions: ["mark_read"] }));
    if (items.filter(i => i.type === "notification").length >= 20) break;
  }

  // ── Verlofgoedkeuringen ────────────────────────────────────────────────────
  if (canSee("leaves") && mod("leaves") && ["tenant_admin", "manager"].includes(user.role)) {
    for (const l of store.list("leaves", tenantId) || []) {
      if (!["aangevraagd", "requested", "pending"].includes(String(l.status || "").toLowerCase())) continue;
      items.push(item({ id: `leave:${l.id}`, type: "leave_approval", priority: "high", title: "Verlofaanvraag te beoordelen", context: `${l.userName || l.userId || ""} · ${l.startDate || ""}${l.endDate ? " t/m " + l.endDate : ""}`.trim(), targetView: "leaves", refId: l.id, actions: ["approve", "reject"] }));
    }
  }

  // ── Onkostengoedkeuringen ──────────────────────────────────────────────────
  if (canSee("expenses") && mod("expenses") && ["tenant_admin", "manager"].includes(user.role)) {
    for (const e of store.list("expenses", tenantId) || []) {
      if (!["ingediend", "submitted", "pending"].includes(String(e.status || "").toLowerCase())) continue;
      items.push(item({ id: `expense:${e.id}`, type: "expense_approval", priority: "high", title: "Onkost te beoordelen", context: `${e.userName || e.userId || ""} · €${Number(e.amount || 0).toFixed(2)} · ${e.category || ""}`.trim(), targetView: "expenses", refId: e.id, actions: ["approve", "reject"] }));
    }
  }

  // ── Inkooporder-goedkeuringen ──────────────────────────────────────────────
  if (canSee("procurement") && mod("procurement")) {
    for (const po of store.list("purchaseOrders", tenantId) || []) {
      if (po.status !== "for_approval") continue;
      const total = (po.lines || []).reduce((s, l) => s + Number(l.orderedQty || 0) * Number(l.unitPrice || 0), 0);
      items.push(item({ id: `po:${po.id}`, type: "po_approval", priority: "high", title: "Bestelling te keuren", context: `${po.number} · €${total.toFixed(2)}`, targetView: "purchasing", refId: po.id, actions: ["approve"] }));
    }
  }

  // ── Klantvragen (nieuw) ────────────────────────────────────────────────────
  if (canSee("customers") && mod("inbox")) {
    for (const q of store.list("inquiries", tenantId) || []) {
      if (q.status !== "nieuw") continue;
      items.push(item({ id: `inquiry:${q.id}`, type: "inquiry", priority: "normal", title: "Nieuwe klantvraag", context: `${q.fromName || q.fromEmail || ""} · ${q.subject || ""}`.trim(), targetView: "inbox", refId: q.id, actions: ["open"] }));
      if (items.filter(i => i.type === "inquiry").length >= 15) break;
    }
  }

  // ── Achterstallige werkbonnen (actief, plandatum verstreken) ───────────────
  if (canSee("workorders") && mod("workorders")) {
    for (const wo of store.list("workorders", tenantId) || []) {
      const active = ["open", "in_progress", "gepland", "planned"].includes(String(wo.status || "").toLowerCase());
      if (active && wo.date && wo.date < today) {
        items.push(item({ id: `wo:${wo.id}`, type: "overdue_workorder", priority: "normal", title: "Werkbon over datum", context: `${wo.number || wo.id} · gepland ${wo.date}`, dueAt: wo.date, targetView: "workorders", refId: wo.id, actions: ["open"] }));
        if (items.filter(i => i.type === "overdue_workorder").length >= 15) break;
      }
    }
  }

  // ── Kritieke Mona-signals (facturatie-lekkage, vervallen facturen, ...) ─────
  const sig = buildMonaSignals(store, tenant, user, now);
  for (const s of sig.signals) {
    if (s.severity !== "critical") continue;
    items.push(item({ id: `signal:${s.type}:${s.refId}`, type: `signal_${s.type}`, priority: "critical", title: s.title, context: s.detail, targetView: s.targetView, refId: s.refId, actions: ["open"] }));
    if (items.filter(i => i.priority === "critical").length >= 20) break;
  }

  items.sort((a, b) => (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0));
  // De telling beschrijft wat er WORDT TERUGGEGEVEN. Eerst afkappen, dan tellen ·
  // andersom zegt de badge 120 terwijl het scherm er 80 toont (IA-04: "counts
  // reconcile"). Hoeveel er wegviel staat er expliciet bij.
  const shown = items.slice(0, MAX_ITEMS);
  const counts = { total: shown.length, byType: {}, byPriority: {}, truncated: items.length - shown.length };
  for (const i of shown) {
    counts.byType[i.type] = (counts.byType[i.type] || 0) + 1;
    counts.byPriority[i.priority] = (counts.byPriority[i.priority] || 0) + 1;
  }
  return { generatedAt: now.toISOString(), items: shown, counts };
}

// ── IA-04 · genormaliseerd model met gescheiden stromen ──────────────────────
// De handover (D-05) scheidt Work Inbox, Notifications en Messages in drie
// capabilities. Een melding is geen werk: je kunt ze niet "afsluiten", alleen
// wegklikken. Ze samen in één lijst tonen maakt de badge betekenisloos, want
// dan telt "3 openstaand" twee meldingen en één goedkeuring.
//
// Deze bouwer levert het canonieke model uit §9 ("Normalise source type,
// source ID, action type, priority, due date, assignee and resolution state").
// v1 hierboven blijft ongewijzigd draaien tot de UI gemigreerd is (D-11).

const WORK_KIND_BY_TYPE = {
  leave_approval: "approval",
  expense_approval: "approval",
  po_approval: "approval",
  inquiry: "task",
  overdue_workorder: "exception",
};

const ROUTE_BY_TYPE = {
  leave_approval: { routeId: "team.leave", route: id => `/app/team/leave/${id}` },
  expense_approval: { routeId: "finance.expenses", route: id => `/app/finance/expenses/${id}` },
  po_approval: { routeId: "resources.purchasing", route: id => `/app/resources/purchasing/${id}` },
  inquiry: { routeId: "customers.requests", route: id => `/app/customers/requests/${id}` },
  overdue_workorder: { routeId: "work-orders", route: id => `/app/work-orders/${id}/overview` },
};

const SOURCE_BY_TYPE = {
  leave_approval: "leave",
  expense_approval: "expense",
  po_approval: "purchase_order",
  inquiry: "customer_request",
  overdue_workorder: "work_order",
};

/** Leid het canonieke item af uit een v1-item. Null = hoort niet in de Work Inbox. */
function toCanonical(v1, now) {
  const kind = v1.type.startsWith("signal_") ? "exception" : WORK_KIND_BY_TYPE[v1.type];
  if (!kind) return null;
  const sourceType = v1.type.startsWith("signal_") ? v1.type.slice(7) : SOURCE_BY_TYPE[v1.type];
  const sourceId = String(v1.refId || "");
  if (!sourceType || !sourceId) return null;
  const r = ROUTE_BY_TYPE[v1.type];
  return {
    id: `${sourceType}:${sourceId}:${v1.actions[0] || kind}`,
    kind, sourceType, sourceId,
    actionType: v1.actions[0] || null,
    routeId: r ? r.routeId : null,
    route: r ? r.route(sourceId) : null,
    priority: v1.priority,
    titleKey: null, title: v1.title, context: v1.context,
    dueAt: v1.dueAt, slaAt: v1.dueAt,
    assigneeId: null, state: "open", resolution: null,
    createdAt: now.toISOString(),
  };
}

/**
 * Work Inbox v2 · drie gescheiden stromen, tellingen die kloppen, geen dubbels.
 *
 * @returns {{ generatedAt, work:{items,counts}, notifications:{items,count}, messages:{items,count} }}
 */
function buildWorkInboxV2(store, tenant, user, now = new Date()) {
  const v1 = buildWorkInbox(store, tenant, user, now);

  const meldingen = v1.items.filter(i => i.type === "notification");
  const kandidaten = v1.items.filter(i => i.type !== "notification");

  // Ontdubbelen op BRON: een Mona-signal en een achterstallige-scan die naar
  // hetzelfde record wijzen zijn één stuk werk, geen twee.
  const perBron = new Map();
  for (const i of kandidaten) {
    const c = toCanonical(i, now);
    if (!c) continue;
    const bestaand = perBron.get(c.id);
    if (!bestaand || (PRIORITY_RANK[c.priority] || 0) > (PRIORITY_RANK[bestaand.priority] || 0)) perBron.set(c.id, c);
  }
  const werk = [...perBron.values()].sort((a, b) =>
    (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0) || a.id.localeCompare(b.id));

  const counts = { total: werk.length, byKind: {}, byPriority: {}, unassigned: 0, truncated: 0 };
  for (const i of werk) {
    counts.byKind[i.kind] = (counts.byKind[i.kind] || 0) + 1;
    counts.byPriority[i.priority] = (counts.byPriority[i.priority] || 0) + 1;
    if (!i.assigneeId) counts.unassigned += 1;
  }

  return {
    generatedAt: now.toISOString(),
    work: { items: werk, counts },
    // Meldingen blijven beschikbaar, maar als EIGEN stroom naast de werklijst.
    notifications: { items: meldingen, count: meldingen.length },
    messages: { items: [], count: 0 },
  };
}

/**
 * Kies de versie op basis van de URL. Deze keuze hoort HIER en niet in
 * server.js: de route blijft één regel en de strangler-schakelaar zit bij de
 * code die hij schakelt.
 *
 *   ?v=2 · genormaliseerd model met gescheiden stromen (IA-04)
 *   anders · het bestaande antwoord, tot de UI gemigreerd is (D-11)
 */
function buildWorkInboxFor(store, tenant, user, url, now = new Date()) {
  const v2 = url && url.searchParams && url.searchParams.get("v") === "2";
  return v2 ? buildWorkInboxV2(store, tenant, user, now) : buildWorkInbox(store, tenant, user, now);
}

module.exports = { buildWorkInbox, buildWorkInboxV2, buildWorkInboxFor, toCanonical, WORK_KIND_BY_TYPE };
