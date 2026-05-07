function parseLimit(value, fallback = 100) {
  const limit = Number(value || fallback);
  if (!Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(Math.round(limit), 500);
}

function parseSince(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error("Ongeldige since filter voor auditlog");
    error.status = 400;
    throw error;
  }
  return date.getTime();
}

function listAuditEvents(store, user, filters = {}) {
  const requestedTenantId = filters.tenantId || "";
  const tenantId = user.role === "super_admin" ? requestedTenantId : user.tenantId;
  const since = parseSince(filters.since);
  const limit = parseLimit(filters.limit);
  let rows = store.data.auditLogs || [];

  if (tenantId) rows = rows.filter(row => row.tenantId === tenantId);
  if (filters.area) rows = rows.filter(row => row.area === filters.area);
  if (filters.action) rows = rows.filter(row => row.action === filters.action);
  if (filters.actor) rows = rows.filter(row => String(row.actor || "").toLowerCase().includes(String(filters.actor).toLowerCase()));
  if (since) rows = rows.filter(row => new Date(row.at).getTime() >= since);

  const sorted = rows
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, limit);

  return {
    rows: sorted,
    summary: {
      totalMatched: rows.length,
      returned: sorted.length,
      limit,
      tenantId: tenantId || null,
      areas: sorted.reduce((acc, row) => ({ ...acc, [row.area || "unknown"]: (acc[row.area || "unknown"] || 0) + 1 }), {}),
      actions: sorted.reduce((acc, row) => ({ ...acc, [row.action || "unknown"]: (acc[row.action || "unknown"] || 0) + 1 }), {})
    }
  };
}

module.exports = { listAuditEvents };
