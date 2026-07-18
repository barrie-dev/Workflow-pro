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
  const counts = { total: items.length, byType: {}, byPriority: {} };
  for (const i of items) {
    counts.byType[i.type] = (counts.byType[i.type] || 0) + 1;
    counts.byPriority[i.priority] = (counts.byPriority[i.priority] || 0) + 1;
  }
  return { generatedAt: now.toISOString(), items: items.slice(0, 80), counts };
}

module.exports = { buildWorkInbox };
