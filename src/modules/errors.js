function parseLimit(value, fallback = 100) {
  const limit = Number(value || fallback);
  if (!Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(Math.round(limit), 500);
}

function parseSince(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error("Ongeldige since filter voor foutregistratie");
    error.status = 400;
    throw error;
  }
  return date.getTime();
}

function safeError(row) {
  const { stack, ...safe } = row;
  return safe;
}

function listErrorEvents(store, user, filters = {}) {
  const requestedTenantId = filters.tenantId || "";
  const tenantId = user.role === "super_admin" ? requestedTenantId : user.tenantId;
  const since = parseSince(filters.since);
  const limit = parseLimit(filters.limit);
  let rows = store.data.errorEvents || [];

  if (tenantId) rows = rows.filter(row => !row.tenantId || row.tenantId === tenantId);
  if (filters.status) rows = rows.filter(row => String(row.status || "") === String(filters.status));
  if (filters.method) rows = rows.filter(row => String(row.method || "").toUpperCase() === String(filters.method).toUpperCase());
  if (filters.path) rows = rows.filter(row => String(row.path || "").toLowerCase().includes(String(filters.path).toLowerCase()));
  if (filters.message) rows = rows.filter(row => String(row.message || "").toLowerCase().includes(String(filters.message).toLowerCase()));
  if (since) rows = rows.filter(row => new Date(row.at).getTime() >= since);

  const sorted = rows
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, limit)
    .map(safeError);

  return {
    rows: sorted,
    summary: {
      totalMatched: rows.length,
      returned: sorted.length,
      limit,
      tenantId: tenantId || null,
      statuses: sorted.reduce((acc, row) => ({ ...acc, [row.status || "unknown"]: (acc[row.status || "unknown"] || 0) + 1 }), {}),
      paths: sorted.reduce((acc, row) => ({ ...acc, [row.path || "unknown"]: (acc[row.path || "unknown"] || 0) + 1 }), {})
    }
  };
}

module.exports = { listErrorEvents };
