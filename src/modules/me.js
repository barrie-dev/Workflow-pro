// src/modules/me.js
// Employee "me" endpoints — enkel eigen data ophalen/wijzigen
// Manager "team" endpoints — team-gerichte views

function apiError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// ── Employee: eigen profiel ────────────────────────────────────────────────────

function getMyProfile(store, user) {
  const u = store.getUserById(user.id);
  if (!u) throw apiError("Gebruiker niet gevonden", 404);
  const { passwordHash, mfaSecret, mfaPendingSecret, recoveryCodes, ...safe } = u;
  return safe;
}

// ── Employee: eigen planning ───────────────────────────────────────────────────

function getMyPlanning(store, tenantId, userId, options = {}) {
  let shifts = store.list("shifts", tenantId).filter(s => s.userId === userId);
  if (options.from) shifts = shifts.filter(s => s.date >= options.from);
  if (options.to) shifts = shifts.filter(s => s.date <= options.to);
  shifts = shifts.sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));

  const today = new Date().toISOString().slice(0, 10);
  const todayShifts = shifts.filter(s => s.date === today);
  const weekShifts = shifts.filter(s => {
    const d = new Date(s.date);
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay() + 1);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
    return d >= weekStart && d <= weekEnd;
  });

  return { shifts, todayShifts, weekShifts, total: shifts.length };
}

// ── Employee: eigen prikklok ───────────────────────────────────────────────────

function getMyClock(store, tenantId, userId) {
  // De opgeslagen prikklok-rij gebruikt date + clockIn/clockOut (HH:MM) en
  // status "active". We verrijken met volledige ISO-timestamps (clockedIn/
  // clockedOut) zodat de client live duur kan tonen; legacy-rijen met een ISO
  // veld blijven werken via de fallback.
  const toISO = (date, hhmm, fallback) =>
    (date && hhmm) ? new Date(`${date}T${hhmm}:00`).toISOString() : (fallback || null);

  const clocks = store.list("clocks", tenantId)
    .filter(c => c.userId === userId)
    .map(c => ({
      ...c,
      clockedIn: toISO(c.date, c.clockIn, c.clockedIn),
      clockedOut: toISO(c.date, c.clockOut, c.clockedOut),
    }))
    .sort((a, b) => String(b.clockedIn || "").localeCompare(String(a.clockedIn || "")))
    .slice(0, 30);

  const active = clocks.find(c => c.status === "active" || c.status === "in" || !c.clockedOut) || null;
  const today = new Date().toISOString().slice(0, 10);
  const todayHours = clocks
    .filter(c => (c.date || c.clockedIn || "").startsWith(today) && c.clockedIn && c.clockedOut)
    .reduce((sum, c) => sum + Math.max(0, (new Date(c.clockedOut) - new Date(c.clockedIn)) / 3600000), 0);

  return { clocks, active, todayHours: Math.round(todayHours * 10) / 10 };
}

// ── Employee: eigen onkosten ───────────────────────────────────────────────────

function getMyExpenses(store, tenantId, userId, options = {}) {
  let expenses = store.list("expenses", tenantId).filter(e => e.userId === userId);
  if (options.status) expenses = expenses.filter(e => e.status === options.status);
  expenses = expenses.sort((a, b) => b.date.localeCompare(a.date));

  const pending = expenses.filter(e => e.status === "pending" || e.status === "ingediend").length;
  const approved = expenses.filter(e => e.status === "approved" || e.status === "goedgekeurd");
  const totalApproved = approved.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  return { expenses, pending, totalApproved };
}

// ── Employee: eigen verlof ─────────────────────────────────────────────────────

function getMyLeaves(store, tenantId, userId) {
  const leaves = store.list("leaves", tenantId)
    .filter(l => l.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const today = new Date().toISOString().slice(0, 10);
  const absentNow = leaves.find(l =>
    l.status === "goedgekeurd" && l.startDate <= today && l.endDate >= today
  );

  const upcoming = leaves.filter(l =>
    l.status === "goedgekeurd" && l.startDate > today
  ).slice(0, 3);

  return { leaves, absentNow: !!absentNow, upcoming };
}

// ── Employee: eigen werkbonnen ─────────────────────────────────────────────────

function getMyWorkorders(store, tenantId, userId, options = {}) {
  let workorders = store.list("workorders", tenantId).filter(w => w.userId === userId);
  if (options.status) workorders = workorders.filter(w => w.status === options.status);
  workorders = workorders.sort((a, b) => b.createdAt?.localeCompare(a.createdAt || "") || 0);

  const open = workorders.filter(w => !["Voltooid", "Afgewerkt"].includes(w.status));
  const urgent = open.filter(w => w.priority === "hoog" || w.urgent);

  return { workorders, open: open.length, urgent: urgent.length };
}

// ── Employee: eigen berichten ──────────────────────────────────────────────────

function getMyMessages(store, tenantId, userId) {
  const messages = store.list("messages", tenantId)
    .filter(m => !m.recipientId || m.recipientId === userId || m.senderId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);

  const unread = messages.filter(m => !m.readBy?.includes(userId) && m.senderId !== userId).length;
  return { messages, unread };
}

// ── Employee: dashboard (alles in één call) ────────────────────────────────────

function getMyDashboard(store, tenantId, user) {
  const today = new Date().toISOString().slice(0, 10);

  const myShifts = store.list("shifts", tenantId)
    .filter(s => s.userId === user.id && s.date === today);

  const activeClock = store.list("clocks", tenantId)
    .find(c => c.userId === user.id && c.status === "in");

  const pendingExpenses = store.list("expenses", tenantId)
    .filter(e => e.userId === user.id && ["pending", "ingediend"].includes(e.status)).length;

  const myWorkorders = store.list("workorders", tenantId)
    .filter(w => w.userId === user.id && !["Voltooid", "Afgewerkt", "done", "geannuleerd"].includes(w.status));

  const openWorkorders   = myWorkorders.length;
  const urgentWorkorders = myWorkorders.filter(w => w.priority === "hoog").length;

  const pendingLeaves = store.list("leaves", tenantId)
    .filter(l => l.userId === user.id && l.status === "aangevraagd").length;

  const unreadMessages = store.list("messages", tenantId)
    .filter(m => {
      if (m.senderId === user.id) return false;
      if (m.readBy?.includes(user.id)) return false;
      // targeted to this user, their role, or broadcast
      return !m.recipientId && !m.toRole
        || m.recipientId === user.id
        || m.toRole === user.role
        || m.toRole === "all";
    }).length;

  return {
    today,
    todayShifts: myShifts,
    clockedIn: !!activeClock,
    activeClock: activeClock || null,
    pendingExpenses,
    openWorkorders,
    urgentWorkorders,
    pendingLeaves,
    unreadMessages
  };
}

// ── Manager: team dashboard ────────────────────────────────────────────────────

function getManagerDashboard(store, tenantId, manager) {
  const today = new Date().toISOString().slice(0, 10);

  // team = alle medewerkers (niet-admins) van de tenant
  const team = store.list("users", tenantId)
    .filter(u => u.active !== false && !["tenant_admin", "super_admin"].includes(u.role));

  const todayShifts = store.list("shifts", tenantId).filter(s => s.date === today);
  const plannedIds = new Set(todayShifts.map(s => s.userId));
  const unplanned = team.filter(u => !plannedIds.has(u.id));

  const clockedIn = store.list("clocks", tenantId)
    .filter(c => c.status === "in" && team.some(u => u.id === c.userId));

  const pendingLeaves = store.list("leaves", tenantId)
    .filter(l => l.status === "aangevraagd");

  const pendingExpenses = store.list("expenses", tenantId)
    .filter(e => ["pending", "ingediend"].includes(e.status));

  const openWorkorders = store.list("workorders", tenantId)
    .filter(w => !["Voltooid", "Afgewerkt"].includes(w.status));

  // Wie is vandaag afwezig (goedgekeurd verlof)
  const absentToday = store.list("leaves", tenantId)
    .filter(l => l.status === "goedgekeurd" && l.startDate <= today && l.endDate >= today)
    .map(l => l.userId);

  return {
    team: team.length,
    todayShifts: todayShifts.length,
    clockedIn: clockedIn.length,
    unplanned: unplanned.length,
    absentToday: absentToday.length,
    pendingLeaves: pendingLeaves.length,
    pendingExpenses: pendingExpenses.length,
    openWorkorders: openWorkorders.length,
    teamList: team.map(u => {
      const { passwordHash, mfaSecret, ...safe } = u;
      return {
        ...safe,
        clockedIn: clockedIn.some(c => c.userId === u.id),
        absent: absentToday.includes(u.id),
        planned: plannedIds.has(u.id)
      };
    })
  };
}

function getManagerTeamPlanning(store, tenantId, options = {}) {
  let shifts = store.list("shifts", tenantId);
  if (options.from) shifts = shifts.filter(s => s.date >= options.from);
  if (options.to) shifts = shifts.filter(s => s.date <= options.to);
  return shifts.sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
}

module.exports = {
  getMyProfile,
  getMyPlanning,
  getMyClock,
  getMyExpenses,
  getMyLeaves,
  getMyWorkorders,
  getMyMessages,
  getMyDashboard,
  getManagerDashboard,
  getManagerTeamPlanning
};
