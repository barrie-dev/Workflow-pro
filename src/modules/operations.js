const { planningInsights } = require("./planning-rules");
const { clockingInsights, normalizeClockIn, normalizeClockOut } = require("./clocking-rules");
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

function clockIn(store, tenant, payload, actor) {
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
    const error = new Error("Geen actieve tijdregistratie gevonden");
    error.status = 404;
    throw error;
  }
  const normalized = normalizeClockOut(store, tenant.id, active, payload, new Date().toTimeString().slice(0, 5));
  const row = store.update("clocks", active.id, normalized);
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "clock_out", area: "clockings", detail: row.id });
  maybeAutoCiaw(store, tenant, row, "out");
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

module.exports = { clockIn, clockOut, approveExpense, managementReport };
