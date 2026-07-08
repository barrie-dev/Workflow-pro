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

// Tenant-lifecycle: status-verdeling, trials (met leeftijd), recente signups,
// laatste activiteit per tenant. Enkel commerciële metadata (geen PII-inhoud).
function lifecycle(store, now = Date.now()) {
  const users = store.data.users || [];
  const lastLoginByTenant = {};
  for (const u of users) {
    if (!u.tenantId || !u.lastLoginAt) continue;
    const t = lastLoginByTenant[u.tenantId];
    if (!t || u.lastLoginAt > t) lastLoginByTenant[u.tenantId] = u.lastLoginAt;
  }
  const counts = { trial: 0, active: 0, suspended: 0, canceled: 0, other: 0 };
  const trials = [];
  let recentSignups = 0;
  for (const t of store.data.tenants || []) {
    const st = String(t.status || "").toLowerCase();
    if (counts[st] !== undefined) counts[st]++; else counts.other++;
    const created = t.createdAt ? new Date(t.createdAt).getTime() : null;
    if (created && now - created <= 30 * 86400000) recentSignups++;
    if (st === "trial") {
      const ageDays = created ? Math.floor((now - created) / 86400000) : null;
      trials.push({ tenantId: t.id, tenant: t.name || t.id, plan: t.plan || null, ageDays, lastActivityAt: lastLoginByTenant[t.id] || null });
    }
  }
  trials.sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0));
  const tot = (store.data.tenants || []).length;
  const paying = counts.active;
  return {
    counts, total: tot, recentSignups,
    conversionPct: tot ? Math.round((paying / tot) * 100) : 0,
    trials,
  };
}

// Reseller-payouts: per actieve reseller de maandcommissie + totaal verschuldigd.
function resellerPayouts(store, commissionOverview) {
  const rows = (store.data.resellers || [])
    .filter(r => r.status === "active")
    .map(r => {
      const ov = commissionOverview(store, r) || {};
      return {
        resellerId: r.id, reseller: r.name, contactEmail: r.contactEmail || "",
        clients: (ov.rows || ov.clients || []).length,
        mrr: ov.totalMrr || ov.mrr || 0,
        commissionMonthly: ov.totalCommission || ov.commission || 0,
      };
    });
  return { rows, totalMonthly: rows.reduce((s, r) => s + (r.commissionMonthly || 0), 0) };
}

// Security-center: MFA-status van admins, vergrendelde accounts, support-toegang.
// Geen PII-inhoud · enkel security-metadata die de operator nodig heeft.
function securityCenter(store, mfaRisk, now = Date.now()) {
  const users = store.data.users || [];
  const mfa = mfaRisk(users);
  const locked = users
    .filter(u => u.lockedUntil && new Date(u.lockedUntil).getTime() > now)
    .map(u => ({ id: u.id, name: u.name, email: u.email, tenantId: u.tenantId || null, lockedUntil: u.lockedUntil, failedLogins: u.failedLogins || 0 }));
  const supportTenants = (store.data.tenants || [])
    .filter(t => t.supportAccess && t.supportAccess.allowed === true)
    .map(t => ({ tenantId: t.id, tenant: t.name || t.id, allowedAt: t.supportAccess.allowedAt || null, reviewDueAt: t.supportAccess.reviewDueAt || null }));
  return {
    mfa: { totalAdmins: mfa.totalAdmins, readyAdmins: mfa.readyAdmins, missingMfa: mfa.missingMfa, notEnforced: mfa.notEnforced, rows: mfa.rows },
    locked,
    supportAccess: supportTenants,
  };
}

// GDPR/DPA-overzicht platformbreed: per tenant DPA-aanvaarding + openstaande
// betrokkene-verzoeken (export/verwijdering).
function gdprOverview(store) {
  const OPEN = new Set(["received", "draft", "processing"]);
  const rows = (store.data.tenants || []).map(t => {
    const comp = t.compliance || {};
    const reqs = comp.gdprRequests || [];
    return {
      tenantId: t.id, tenant: t.name || t.id,
      dpaAccepted: !!comp.dpaAcceptedAt,
      dpaAcceptedAt: comp.dpaAcceptedAt || null,
      openRequests: reqs.filter(r => OPEN.has(r.status)).length,
      totalRequests: reqs.length,
      supportAccess: !!(t.supportAccess && t.supportAccess.allowed === true),
    };
  });
  return {
    rows,
    tenants: rows.length,
    dpaMissing: rows.filter(r => !r.dpaAccepted).length,
    openRequests: rows.reduce((s, r) => s + r.openRequests, 0),
  };
}

module.exports = { eventLog, backupSummary, lifecycle, resellerPayouts, securityCenter, gdprOverview };
