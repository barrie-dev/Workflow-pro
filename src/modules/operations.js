function today() {
  return new Date().toISOString().slice(0, 10);
}

function durationHours(clock) {
  if (!clock.clockIn || !clock.clockOut) return 0;
  const [inHour, inMinute] = clock.clockIn.split(":").map(Number);
  const [outHour, outMinute] = clock.clockOut.split(":").map(Number);
  return Math.max(0, ((outHour * 60 + outMinute) - (inHour * 60 + inMinute)) / 60);
}

function clockIn(store, tenant, payload, actor) {
  const userId = payload.userId || actor.id;
  const date = payload.date || today();
  const existing = store.list("clocks", tenant.id).find(clock => clock.userId === userId && clock.date === date && !clock.clockOut);
  if (existing) {
    const error = new Error("Er loopt al een actieve tijdregistratie");
    error.status = 400;
    throw error;
  }
  const row = store.insert("clocks", {
    id: `clock_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    tenantId: tenant.id,
    userId,
    venueId: payload.venueId || null,
    date,
    clockIn: payload.clockIn || new Date().toTimeString().slice(0, 5),
    clockOut: null,
    note: payload.note || ""
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "clock_in", area: "clockings", detail: row.id });
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
  const row = store.update("clocks", active.id, {
    clockOut: payload.clockOut || new Date().toTimeString().slice(0, 5),
    note: payload.note || active.note || ""
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "clock_out", area: "clockings", detail: row.id });
  return row;
}

function approveExpense(store, tenant, expenseId, actor) {
  const expense = store.get("expenses", expenseId);
  if (!expense || expense.tenantId !== tenant.id) {
    const error = new Error("Onkost niet gevonden");
    error.status = 404;
    throw error;
  }
  const row = store.update("expenses", expenseId, {
    status: "approved",
    approvedBy: actor.email,
    approvedAt: new Date().toISOString()
  });
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
  return {
    tenant: { id: scoped.tenant?.id, name: scoped.tenant?.name, plan: scoped.tenant?.plan },
    totals: {
      employees: scoped.users.filter(user => user.role !== "tenant_admin").length,
      venues: scoped.venues.length,
      planningItems: scoped.shifts.length,
      clockedHours: Number(clockedHours.toFixed(2)),
      workordersOpen: openWorkorders.length,
      workordersCompleted: completedWorkorders.length,
      expensesSubmitted: scoped.expenses.length,
      expensesApproved: approvedExpenses.length,
      expenseTotal: Number(expenseTotal.toFixed(2))
    },
    finance: {
      pendingExpenseTotal: Number(scoped.expenses.filter(expense => expense.status !== "approved").reduce((sum, expense) => sum + Number(expense.amount || 0), 0).toFixed(2)),
      approvedExpenseTotal: Number(approvedExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0).toFixed(2)),
      invoices: scoped.invoices.length + (scoped.tenant?.billingOps?.invoiceHistory || []).length
    },
    generatedAt: new Date().toISOString()
  };
}

module.exports = { clockIn, clockOut, approveExpense, managementReport };
