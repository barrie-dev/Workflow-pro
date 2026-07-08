// src/modules/leaves.js
// Verlofbeheer · aanvragen · goedkeuren/weigeren · conflictdetectie · saldo

function apiError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const LEAVE_TYPES = new Set(["vakantie", "ziekte", "overmacht", "educatie", "onbetaald", "feestdag"]);
const LEAVE_STATUSES = new Set(["aangevraagd", "goedgekeurd", "geweigerd", "geannuleerd"]);

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseDate(str) {
  const d = new Date(str);
  if (isNaN(d.getTime())) throw apiError("Ongeldige datum");
  return d.toISOString().slice(0, 10);
}

const { workingDaysBetween } = require("./be-locale");

function daysBetween(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  if (e < s) throw apiError("Einddatum moet na startdatum liggen");
  // Werkdagen excl. weekend ÉN Belgische feestdagen.
  return workingDaysBetween(start, end);
}

function leaveRecord(store, tenantId, leaveId) {
  const leave = store.get("leaves", leaveId);
  if (!leave || leave.tenantId !== tenantId) throw apiError("Verlofaanvraag niet gevonden", 404);
  return leave;
}

function detectConflicts(store, tenantId, startDate, endDate, excludeId = null) {
  const approved = store
    .list("leaves", tenantId)
    .filter(l =>
      l.id !== excludeId &&
      l.status === "goedgekeurd" &&
      l.startDate <= endDate &&
      l.endDate >= startDate
    );

  const userConflicts = {};
  for (const l of approved) {
    if (!userConflicts[l.userId]) userConflicts[l.userId] = [];
    userConflicts[l.userId].push(l);
  }
  return userConflicts;
}

// ─── lijst & samenvatting ──────────────────────────────────────────────────────

function listLeaves(store, tenantId, options = {}) {
  let items = store.list("leaves", tenantId);

  if (options.userId) items = items.filter(l => l.userId === options.userId);
  if (options.status) items = items.filter(l => l.status === options.status);
  if (options.type) items = items.filter(l => l.type === options.type);
  if (options.from) items = items.filter(l => l.endDate >= options.from);
  if (options.to) items = items.filter(l => l.startDate <= options.to);

  items = items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const today = new Date().toISOString().slice(0, 10);
  const absentToday = store
    .list("leaves", tenantId)
    .filter(l => l.status === "goedgekeurd" && l.startDate <= today && l.endDate >= today)
    .map(l => l.userId);

  const summary = {
    total: items.length,
    aangevraagd: items.filter(l => l.status === "aangevraagd").length,
    goedgekeurd: items.filter(l => l.status === "goedgekeurd").length,
    geweigerd: items.filter(l => l.status === "geweigerd").length,
    absentToday: [...new Set(absentToday)].length
  };

  return { leaves: items, summary };
}

function getLeave(store, tenantId, leaveId) {
  return leaveRecord(store, tenantId, leaveId);
}

// ─── aanmaken ─────────────────────────────────────────────────────────────────

function createLeave(store, tenant, payload, actor) {
  // Employees kunnen enkel voor zichzelf aanvragen; manager/admin ook voor teamleden.
  const userId = actor.role === "employee" ? actor.id : (payload.userId || actor.id);
  const type = String(payload.type || "vakantie").toLowerCase();
  if (!LEAVE_TYPES.has(type)) throw apiError(`Ongeldig type. Kies uit: ${[...LEAVE_TYPES].join(", ")}`);

  const startDate = parseDate(payload.startDate);
  const endDate = parseDate(payload.endDate || payload.startDate);
  if (endDate < startDate) throw apiError("Einddatum moet na startdatum liggen");

  const days = daysBetween(startDate, endDate);
  if (days === 0) throw apiError("Geen werkdagen in de geselecteerde periode (weekend)");

  // Overlapping eigen verlof?
  const existing = store
    .list("leaves", tenant.id)
    .filter(l =>
      l.userId === userId &&
      !["geweigerd", "geannuleerd"].includes(l.status) &&
      l.startDate <= endDate &&
      l.endDate >= startDate
    );
  if (existing.length > 0) throw apiError("Medewerker heeft al een verlofaanvraag in deze periode");

  const autoApproved = ["tenant_admin", "super_admin"].includes(actor.role)
    || (actor.role === "manager" && userId !== actor.id);

  const leave = store.insert("leaves", {
    id: `leave_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    tenantId: tenant.id,
    userId,
    type,
    startDate,
    endDate,
    days,
    reason: String(payload.reason || "").trim() || null,
    // Auto-goedgekeurd wanneer een goedkeurder het zelf registreert: admin altijd;
    // manager wanneer hij het voor een TEAMLID invoert (bv. ziektemelding) — zijn
    // eigen verlof blijft "aangevraagd" (goedkeuring door de admin).
    status: autoApproved ? "goedgekeurd" : "aangevraagd",
    reviewedBy: autoApproved ? actor.email : null,
    reviewedAt: autoApproved ? new Date().toISOString() : null,
    reviewNote: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  store.audit({
    actor: actor.email,
    tenantId: tenant.id,
    action: "leave_created",
    area: "leaves",
    detail: `${type} ${startDate}→${endDate} (${days} dagen)`
  });

  return leave;
}

// ─── goedkeuren / weigeren / annuleren ────────────────────────────────────────

function reviewLeave(store, tenant, leaveId, payload, actor) {
  const leave = leaveRecord(store, tenant.id, leaveId);
  // Accept both `decision` (canonical) and `status` (legacy callers)
  const decision = String(payload.decision || payload.status || "").toLowerCase();

  if (!["goedgekeurd", "geweigerd", "geannuleerd"].includes(decision)) {
    throw apiError("Beslissing moet 'goedgekeurd', 'geweigerd' of 'geannuleerd' zijn");
  }
  if (leave.status === "geannuleerd") throw apiError("Geannuleerde aanvragen kunnen niet meer gewijzigd worden");

  // Annuleren mag de aanvrager zelf; goedkeuren/weigeren: admin of manager
  if (["goedgekeurd", "geweigerd"].includes(decision)) {
    if (!["tenant_admin", "super_admin", "manager"].includes(actor.role)) {
      throw apiError("Enkel admins en managers kunnen verlofaanvragen goed- of afkeuren", 403);
    }
  }

  const updated = store.update("leaves", leaveId, {
    status: decision,
    reviewedBy: actor.email,
    reviewedAt: new Date().toISOString(),
    reviewNote: String(payload.reviewNote || "").trim() || null,
    updatedAt: new Date().toISOString()
  });

  store.audit({
    actor: actor.email,
    tenantId: tenant.id,
    action: `leave_${decision}`,
    area: "leaves",
    detail: `${leave.type} ${leave.startDate}→${leave.endDate}`
  });

  return updated;
}

// ─── conflicten ───────────────────────────────────────────────────────────────

function leaveConflicts(store, tenantId, startDate, endDate) {
  const conflicts = detectConflicts(store, tenantId, startDate, endDate);
  return {
    conflicts: Object.entries(conflicts).map(([userId, leaves]) => ({ userId, leaves })),
    count: Object.keys(conflicts).length
  };
}

// ─── verlofkalender (per maand) ───────────────────────────────────────────────

function leaveCalendar(store, tenantId, year, month) {
  const pad = n => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${pad(month)}-${pad(lastDay)}`;

  const leaves = store
    .list("leaves", tenantId)
    .filter(l => l.status === "goedgekeurd" && l.startDate <= to && l.endDate >= from);

  const days = {};
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${pad(month)}-${pad(d)}`;
    days[dateStr] = leaves.filter(l => l.startDate <= dateStr && l.endDate >= dateStr).map(l => l.userId);
  }

  return { year, month, days, leaves };
}

module.exports = {
  listLeaves,
  getLeave,
  createLeave,
  reviewLeave,
  leaveConflicts,
  leaveCalendar
};
