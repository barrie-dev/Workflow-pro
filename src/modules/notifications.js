function publicNotification(row) {
  return row;
}

function hasOpenNotification(store, tenantId, sourceRef) {
  return store.list("notifications", tenantId)
    .some(row => row.sourceRef === sourceRef && row.status !== "read");
}

function createNotification(store, tenant, payload, actor) {
  const row = store.insert("notifications", {
    id: `notification_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    tenantId: tenant.id,
    type: payload.type || "info",
    channel: payload.channel || "in_app",
    audience: payload.audience || "admins",
    userId: payload.userId || null,
    title: payload.title || "Nieuwe notificatie",
    body: payload.body || "",
    status: "queued",
    priority: payload.priority || "normal",
    scheduledFor: payload.scheduledFor || new Date().toISOString(),
    sourceRef: payload.sourceRef || null,
    createdBy: actor.email,
    createdAt: new Date().toISOString(),
    readAt: null
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "notification_created", area: "notifications", detail: row.title });
  return publicNotification(row);
}

function listNotifications(store, tenantId) {
  return store.list("notifications", tenantId).slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function markNotificationRead(store, tenant, notificationId, actor) {
  const notification = store.get("notifications", notificationId);
  if (!notification || notification.tenantId !== tenant.id) {
    const error = new Error("Notificatie niet gevonden");
    error.status = 404;
    throw error;
  }
  const row = store.update("notifications", notificationId, {
    status: "read",
    readAt: new Date().toISOString(),
    readBy: actor.email
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "notification_read", area: "notifications", detail: notificationId });
  return publicNotification(row);
}

function generateReminders(store, tenant, actor) {
  const scoped = store.tenantScoped(tenant.id);
  const today = new Date().toISOString().slice(0, 10);
  const reminders = [];

  for (const shift of scoped.shifts.filter(row => row.date === today)) {
    reminders.push(createNotification(store, tenant, {
      type: "planning",
      channel: "in_app",
      audience: shift.userId || "field",
      title: "Planning vandaag",
      body: `${shift.project || "Opdracht"} start om ${shift.start || shift.startsAt || "?"}`,
      priority: "normal"
    }, actor));
  }

  for (const workorder of scoped.workorders.filter(row => !["Voltooid", "Afgewerkt"].includes(row.status))) {
    reminders.push(createNotification(store, tenant, {
      type: "workorder",
      channel: "in_app",
      audience: workorder.userId || "field",
      title: "Open werkbon",
      body: workorder.title,
      priority: "high"
    }, actor));
  }

  const failedPayments = scoped.tenant?.billingOps?.failedPayments || [];
  for (const payment of failedPayments.filter(row => row.status === "open")) {
    reminders.push(createNotification(store, tenant, {
      type: "billing",
      channel: "email",
      audience: "finance",
      title: "Betaling mislukt",
      body: payment.reason,
      priority: "high"
    }, actor));
  }

  store.audit({ actor: actor.email, tenantId: tenant.id, action: "reminders_generated", area: "notifications", detail: String(reminders.length) });
  return reminders;
}

function notificationSummary(store, tenantId) {
  const rows = listNotifications(store, tenantId);
  return {
    total: rows.length,
    queued: rows.filter(row => row.status === "queued").length,
    read: rows.filter(row => row.status === "read").length,
    highPriority: rows.filter(row => row.priority === "high").length,
    channels: rows.reduce((acc, row) => {
      acc[row.channel] = (acc[row.channel] || 0) + 1;
      return acc;
    }, {})
  };
}

module.exports = { createNotification, listNotifications, markNotificationRead, generateReminders, notificationSummary, hasOpenNotification };
