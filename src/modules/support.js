const SLA_HOURS = {
  high: 48,
  normal: 120,
  low: 168
};
const CATEGORIES = ["question", "bug", "onboarding", "billing"];
const PRIORITIES = ["low", "normal", "high"];
const STATUSES = ["open", "waiting", "closed"];

function ensureAllowed(value, allowed, fallback, field) {
  const normalized = String(value || fallback).trim();
  if (allowed.includes(normalized)) return normalized;
  const error = new Error(`Ongeldige support ${field}: ${normalized}`);
  error.status = 400;
  throw error;
}

function slaFor(ticket, now = new Date()) {
  const hours = SLA_HOURS[ticket.priority] || SLA_HOURS.normal;
  const createdAt = new Date(ticket.createdAt || ticket.updatedAt || now.toISOString());
  const deadlineAt = new Date(createdAt.getTime() + hours * 60 * 60 * 1000);
  const closed = ticket.status === "closed";
  const reference = closed && ticket.closedAt ? new Date(ticket.closedAt) : now;
  const remainingHours = Math.round(((deadlineAt.getTime() - reference.getTime()) / 36_000) / 100) / 100;
  return {
    hours,
    deadlineAt: deadlineAt.toISOString(),
    remainingHours,
    breached: remainingHours < 0,
    status: closed ? "closed" : remainingHours < 0 ? "breached" : remainingHours <= 24 ? "risk" : "ok"
  };
}

function escalationFor(ticket, now = new Date()) {
  const sla = ticket.sla || slaFor(ticket, now);
  if (ticket.status === "closed") {
    return { level: "none", label: "Geen escalatie", reason: "Ticket is gesloten." };
  }
  if (ticket.category === "bug" && ticket.priority === "high" && sla.breached) {
    return { level: "blocker", label: "Pilot blocker", reason: "Kritieke bug buiten 48u SLA." };
  }
  if (sla.breached) {
    return { level: "escalate", label: "Escaleren", reason: "Ticket is buiten SLA." };
  }
  if (ticket.category === "bug" && ticket.priority === "high" && sla.status === "risk") {
    return { level: "watch", label: "SLA bewaken", reason: "Kritieke bug nadert 48u SLA." };
  }
  if (sla.status === "risk") {
    return { level: "watch", label: "Opvolgen", reason: "Ticket nadert SLA-deadline." };
  }
  return { level: "none", label: "Geen escalatie", reason: "Binnen SLA." };
}

function publicTicket(ticket, now = new Date()) {
  const sla = slaFor(ticket, now);
  return { ...ticket, sla, escalation: escalationFor({ ...ticket, sla }, now) };
}

function listSupportTickets(store, tenantId) {
  const now = new Date();
  return store.list("supportTickets", tenantId)
    .map(ticket => publicTicket(ticket, now))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function createSupportTicket(store, tenant, payload, actor) {
  const ticket = {
    id: `ticket_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    tenantId: tenant.id,
    title: payload.title || "Supportvraag",
    category: ensureAllowed(payload.category, CATEGORIES, "question", "categorie"),
    priority: ensureAllowed(payload.priority, PRIORITIES, "normal", "prioriteit"),
    description: payload.description || "",
    status: "open",
    createdAt: new Date().toISOString(),
    createdBy: actor.email,
    updatedAt: new Date().toISOString(),
    comments: []
  };
  store.insert("supportTickets", ticket);
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "support_ticket_created", area: "support", detail: ticket.title });
  return publicTicket(ticket);
}

function updateSupportTicket(store, tenant, ticketId, payload, actor) {
  const existing = store.get("supportTickets", ticketId);
  if (!existing || existing.tenantId !== tenant.id) {
    const error = new Error("Supportticket niet gevonden");
    error.status = 404;
    throw error;
  }
  const comment = payload.comment
    ? { at: new Date().toISOString(), by: actor.email, text: payload.comment }
    : null;
  const nextStatus = payload.status ? ensureAllowed(payload.status, STATUSES, existing.status, "status") : null;
  const nextPriority = payload.priority ? ensureAllowed(payload.priority, PRIORITIES, existing.priority, "prioriteit") : null;
  const closing = nextStatus === "closed" && existing.status !== "closed";
  const patch = {
    ...(nextStatus ? { status: nextStatus } : {}),
    ...(nextPriority ? { priority: nextPriority } : {}),
    ...(closing ? { closedAt: new Date().toISOString(), closedBy: actor.email } : {}),
    updatedAt: new Date().toISOString(),
    updatedBy: actor.email,
    comments: comment ? [...(existing.comments || []), comment] : existing.comments || []
  };
  const row = store.update("supportTickets", ticketId, patch);
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "support_ticket_updated", area: "support", detail: ticketId });
  if (closing) {
    const sla = slaFor(row);
    store.audit({
      actor: actor.email,
      tenantId: tenant.id,
      action: sla.breached ? "support_ticket_closed_sla_breached" : "support_ticket_closed_within_sla",
      area: "support",
      detail: `${ticketId}: ${sla.remainingHours}u`
    });
  }
  return publicTicket(row);
}

function supportSummary(store, tenantId) {
  const rows = listSupportTickets(store, tenantId);
  const risk = supportRisk(rows);
  return {
    total: rows.length,
    open: rows.filter(row => row.status === "open").length,
    waiting: rows.filter(row => row.status === "waiting").length,
    closed: rows.filter(row => row.status === "closed").length,
    highPriority: rows.filter(row => row.priority === "high").length,
    ...risk
  };
}

function supportRisk(rows) {
  const tickets = rows.map(row => row.sla ? row : publicTicket(row));
  const criticalBugs = tickets.filter(row => row.status !== "closed" && row.priority === "high" && row.category === "bug");
  return {
    slaBreached: tickets.filter(row => row.status !== "closed" && row.sla.breached).length,
    slaRisk: tickets.filter(row => row.status !== "closed" && row.sla.status === "risk").length,
    criticalOpen: tickets.filter(row => row.status !== "closed" && row.priority === "high").length,
    criticalBugSlaBreached: criticalBugs.filter(row => row.sla.breached).length,
    criticalBugSlaRisk: criticalBugs.filter(row => row.sla.status === "risk").length,
    escalations: tickets.filter(row => row.escalation?.level === "escalate").length,
    blockers: tickets.filter(row => row.escalation?.level === "blocker").length
  };
}

module.exports = { listSupportTickets, createSupportTicket, updateSupportTicket, supportSummary, slaFor, escalationFor, supportRisk, ensureAllowed };
