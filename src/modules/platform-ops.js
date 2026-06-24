"use strict";
/**
 * Platform-operations aggregaties voor de superadmin-console. Pure read-helpers
 * die over álle tenants kijken (operatorzicht), zonder tenant-PII te lekken:
 * enkel commerciële/technische metadata.
 */

// Webhook-/betaal-events platformbreed (uit elke tenant.billingOps.stripeEvents),
// nieuwste eerst, gecapt.
function eventLog(store, limit = 60) {
  const out = [];
  for (const t of store.data.tenants || []) {
    const evs = (t.billingOps && t.billingOps.stripeEvents) || [];
    for (const e of evs) {
      out.push({ tenantId: t.id, tenant: t.name || t.id, id: e.id, type: e.type, status: e.status, action: e.action, at: e.at });
    }
  }
  out.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  const failed = out.filter(e => e.status === "failed" || e.action === "payment_failed").length;
  return { total: out.length, failed, events: out.slice(0, limit) };
}

// Lichte samenvatting van back-ups per tenant (vers/oud/ontbrekend).
function backupSummary(store, listBackups, staleDays = 7) {
  const now = Date.now();
  const rows = (store.data.tenants || []).map(t => {
    const backups = listBackups(t.id);
    const latest = backups[0] || null;
    const ageDays = latest ? Math.floor((now - new Date(latest.createdAt).getTime()) / 86400000) : null;
    return {
      tenantId: t.id, tenant: t.name || t.id,
      count: backups.length,
      latestAt: latest ? latest.createdAt : null,
      ageDays,
      status: !latest ? "missing" : (ageDays > staleDays ? "stale" : "ok"),
    };
  });
  return {
    rows,
    tenants: rows.length,
    missing: rows.filter(r => r.status === "missing").length,
    stale: rows.filter(r => r.status === "stale").length,
  };
}

module.exports = { eventLog, backupSummary };
