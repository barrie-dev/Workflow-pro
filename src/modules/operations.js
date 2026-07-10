const { planningInsights } = require("./planning-rules");
const { clockingInsights, normalizeClockIn, normalizeClockOut, breakMinutes } = require("./clocking-rules");
const { expenseInsights, validateExpenseForApproval } = require("./expense-rules");
const { workorderInsights } = require("./workorder-rules");
const { isModuleEnabled } = require("./entitlements");
const { loadPlatformConfig } = require("./platform-config");
const { submitCheckin } = require("./ciaw");

// CIAW / Checkin@Work: als de tenant de add-on heeft, meld aanwezigheid
// automatisch aan (RSZ/ONSS) bij in-/uitklokken. Best-effort, niet-blokkerend:
// faalt de aangifte, dan blijft de klokregistratie staan met een foutstatus.
function maybeAutoCiaw(store, tenant, clock, action) {
  try {
    if (!isModuleEnabled(store, tenant, "ciaw")) return;
    const user = clock.userId ? store.get("users", clock.userId) : null;
    const venue = clock.venueId ? store.get("venues", clock.venueId) : null;
    const config = loadPlatformConfig(store);
    Promise.resolve(submitCheckin({ config, tenant, clock, user, venue, action }))
      .then(result => {
        store.update("clocks", clock.id, { ciaw: { status: result.status, reference: result.reference || "", live: !!result.live, provider: result.provider, error: result.error || null, action: action === "out" ? "OUT" : "IN", at: new Date().toISOString() } });
      })
      .catch(() => {});
  } catch (_) { /* auto-aangifte mag het klokken nooit breken */ }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function durationHours(clock) {
  if (!clock.durationMinutes && (!clock.clockIn || !clock.clockOut)) return 0;
  if (clock.durationMinutes != null) return Number(clock.durationMinutes || 0) / 60;
  const [inHour, inMinute] = clock.clockIn.split(":").map(Number);
  const [outHour, outMinute] = clock.clockOut.split(":").map(Number);
  return Math.max(0, ((outHour * 60 + outMinute) - (inHour * 60 + inMinute)) / 60);
}

// Tenant-instelling: tellen pauzes mee als betaalde werktijd? (default: nee)
function tenantPaidBreaks(tenant) {
  return tenant?.clockingPrefs?.paidBreaks === true;
}

// Verweesde prikking (vergeten uit te klokken op een vorige dag): sluit af op
// 23:59 van die dag met status needs_review, zodat de medewerker nooit vast
// komt te zitten en de beheerder de tijd kan corrigeren.
function closeStaleClocks(store, tenant, userId, actorEmail) {
  const todayStr = today();
  // Zowel canonieke rijen (date + clockIn) als legacy-rijen (ISO clockedIn
  // zonder date) van vóór vandaag worden afgesloten.
  const stale = store.list("clocks", tenant.id).filter(c => {
    if (c.userId !== userId || c.clockOut || c.clockedOut) return false;
    const d = c.date || String(c.clockedIn || "").slice(0, 10);
    return d && d < todayStr;
  });
  stale.forEach(c => {
    const date = c.date || String(c.clockedIn || "").slice(0, 10);
    const clockInHH = c.clockIn || String(c.clockedIn || "").slice(11, 16) || "00:00";
    const [inH, inM] = clockInHH.split(":").map(Number);
    const gross = Math.max(0, (23 * 60 + 59) - (inH * 60 + inM));
    const closedBreaks = (c.breaks || []).map(b => (b.end ? b : { ...b, end: "23:59" }));
    const pauseMin = breakMinutes(closedBreaks);
    store.update("clocks", c.id, {
      date,
      clockIn: clockInHH,
      clockOut: "23:59",
      breaks: closedBreaks,
      breakMinutes: pauseMin,
      durationMinutes: tenantPaidBreaks(tenant) ? gross : Math.max(0, gross - pauseMin),
      status: "needs_review",
      autoClosed: true,
      note: [c.note, "Automatisch afgesloten: uitklokken vergeten"].filter(Boolean).join(" · ")
    });
    store.audit({ actor: actorEmail, tenantId: tenant.id, action: "clock_out_autoclose", area: "clockings", detail: c.id });
  });
  return stale.length;
}

function clockIn(store, tenant, payload, actor) {
  // Een blijven hangen prikking van gisteren mag inklokken vandaag niet blokkeren.
  closeStaleClocks(store, tenant, payload.userId || actor.id, actor.email);
  const normalized = normalizeClockIn(store, tenant.id, payload, actor, new Date().toTimeString().slice(0, 5));
  const row = store.insert("clocks", {
    id: `clock_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    tenantId: tenant.id,
    userId: normalized.userId,
    venueId: normalized.venueId,
    shiftId: normalized.shiftId,
    workorderId: normalized.workorderId,
    date: normalized.date,
    clockIn: normalized.clockIn,
    clockOut: null,
    status: "active",
    planningMatch: normalized.planningMatch,
    note: normalized.note,
    geo: normalized.geo,
    geoStatus: normalized.geoStatus,
    geoVerified: normalized.geoVerified,
    geoDistanceM: normalized.geoDistanceM
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "clock_in", area: "clockings", detail: row.id });
  maybeAutoCiaw(store, tenant, row, "in");
  return row;
}

function clockOut(store, tenant, payload, actor) {
  const userId = payload.userId || actor.id;
  const date = payload.date || today();
  const active = store.list("clocks", tenant.id).find(clock => clock.userId === userId && clock.date === date && !clock.clockOut);
  if (!active) {
    // Geen prikking van vandaag, maar mogelijk wel een verweesde van eerder:
    // sluit die netjes af zodat de knop niet in een dood spoor eindigt.
    const closed = closeStaleClocks(store, tenant, userId, actor.email);
    if (closed > 0) {
      const latest = store.list("clocks", tenant.id)
        .filter(c => c.userId === userId && c.autoClosed)
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
      return latest;
    }
    const error = new Error("Geen actieve tijdregistratie gevonden");
    error.status = 404;
    throw error;
  }
  const normalized = normalizeClockOut(store, tenant.id, active, payload, new Date().toTimeString().slice(0, 5), { paidBreaks: tenantPaidBreaks(tenant) });
  const row = store.update("clocks", active.id, normalized);
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "clock_out", area: "clockings", detail: row.id });
  maybeAutoCiaw(store, tenant, row, "out");
  return row;
}

// ── Pauzes op de actieve prikking ─────────────────────────────
function findActiveClock(store, tenantId, userId) {
  return store.list("clocks", tenantId).find(c => c.userId === userId && c.date === today() && !c.clockOut) || null;
}

function breakStart(store, tenant, payload, actor) {
  const userId = payload.userId || actor.id;
  const active = findActiveClock(store, tenant.id, userId);
  if (!active) { const e = new Error("Geen actieve tijdregistratie · klok eerst in"); e.status = 404; throw e; }
  const breaks = active.breaks || [];
  if (breaks.some(b => !b.end)) { const e = new Error("Er loopt al een pauze"); e.status = 409; throw e; }
  const row = store.update("clocks", active.id, { breaks: [...breaks, { start: new Date().toTimeString().slice(0, 5), end: null }] });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "clock_break_start", area: "clockings", detail: active.id });
  return row;
}

function breakStop(store, tenant, payload, actor) {
  const userId = payload.userId || actor.id;
  const active = findActiveClock(store, tenant.id, userId);
  if (!active) { const e = new Error("Geen actieve tijdregistratie gevonden"); e.status = 404; throw e; }
  const breaks = active.breaks || [];
  const open = breaks.find(b => !b.end);
  if (!open) { const e = new Error("Er loopt geen pauze"); e.status = 409; throw e; }
  const now = new Date().toTimeString().slice(0, 5);
  const updated = breaks.map(b => (b === open ? { ...b, end: now } : b));
  const row = store.update("clocks", active.id, { breaks: updated, breakMinutes: breakMinutes(updated) });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "clock_break_stop", area: "clockings", detail: active.id });
  return row;
}

function approveExpense(store, tenant, expenseId, actor) {
  const expense = store.get("expenses", expenseId);
  if (!expense || expense.tenantId !== tenant.id) {
    const error = new Error("Onkost niet gevonden");
    error.status = 404;
    throw error;
  }
  const row = store.update("expenses", expenseId, validateExpenseForApproval(expense, actor));
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "expense_approved", area: "expenses", detail: expenseId });
  return row;
}

function managementReport(store, tenantId) {
  const scoped = store.tenantScoped(tenantId);
  const clockedHours = scoped.clocks.reduce((sum, clock) => sum + durationHours(clock), 0);
  const expenseTotal = scoped.expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const approvedExpenses = scoped.expenses.filter(expense => expense.status === "approved");
  const openWorkorders = scoped.workorders.filter(order => !["Voltooid", "Afgewerkt"].includes(order.status));
  const completedWorkorders = scoped.workorders.filter(order => ["Voltooid", "Afgewerkt"].includes(order.status));
  const planning = planningInsights(scoped.shifts);
  const clocking = clockingInsights(scoped.clocks, scoped.shifts);
  const expenses = expenseInsights(scoped.expenses);
  const workorders = workorderInsights(scoped.workorders);
  return {
    tenant: { id: scoped.tenant?.id, name: scoped.tenant?.name, plan: scoped.tenant?.plan },
    totals: {
      employees: scoped.users.filter(user => user.role !== "tenant_admin").length,
      venues: scoped.venues.length,
      planningItems: scoped.shifts.length,
      clockedHours: Number(clockedHours.toFixed(2)),
      clockingOpen: clocking.openCount,
      clockingNeedsReview: clocking.reviewCount,
      workordersOpen: openWorkorders.length,
      workordersCompleted: completedWorkorders.length,
      workordersBlockedCompletion: workorders.counts.blockedCompletion,
      workordersReadyForInvoice: workorders.counts.readyForInvoice,
      expensesSubmitted: scoped.expenses.length,
      expensesApproved: approvedExpenses.length,
      expenseTotal: Number(expenseTotal.toFixed(2)),
      expensesNeedReceipt: expenses.counts.needsReceipt,
      expensesNeedFinanceReview: expenses.counts.needsFinanceReview,
      planningConflicts: planning.conflictCount
    },
    finance: {
      pendingExpenseTotal: Number(scoped.expenses.filter(expense => expense.status !== "approved").reduce((sum, expense) => sum + Number(expense.amount || 0), 0).toFixed(2)),
      approvedExpenseTotal: Number(approvedExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0).toFixed(2)),
      invoices: scoped.invoices.length + (scoped.tenant?.billingOps?.invoiceHistory || []).length
    },
    expenses,
    clocking,
    planning,
    workorders,
    generatedAt: new Date().toISOString()
  };
}

module.exports = { clockIn, clockOut, breakStart, breakStop, approveExpense, managementReport };
