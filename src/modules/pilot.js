const { managementReport } = require("./operations");
const { billingQuote } = require("./billing");
const { slaFor } = require("./support");

function earliestDate(rows, field) {
  const values = rows.map(row => row[field]).filter(Boolean).sort();
  return values[0] || null;
}

function hoursBetween(start, end) {
  if (!start || !end) return null;
  return Math.round(((new Date(end).getTime() - new Date(start).getTime()) / 36_000) / 100) / 100;
}

const KPI_ACTIONS = {
  time_to_first_value: "Zet samen met de klant binnen 24u een eerste planning, werkbon of tijdregistratie live.",
  first_planning: "Maak minstens een eerste planning aan voor een echte medewerker op locatie.",
  workorders: "Laat de pilotklant minstens 10 werkbonnen verwerken in de mobiele of desktopflow.",
  support_load: "Bundel terugkerende vragen in onboardingmateriaal en los frictiepunten in de basisflow op.",
  critical_bug_sla: "Los high-priority bugs binnen 48u op of escalereer ze als pilot blocker.",
  completed_workorders: "Werk minstens een werkbon volledig af, inclusief status naar voltooid of afgewerkt.",
  decision_report: "Genereer een beslissersrapport voor de klantreview en go/no-go evaluatie."
};

function withAction(kpi) {
  return {
    ...kpi,
    action: KPI_ACTIONS[kpi.key] || "Bespreek deze KPI in de weekly success review."
  };
}

function pilotKpis(store, tenantId) {
  const scoped = store.tenantScoped(tenantId);
  const activeUsers = scoped.users.filter(user => user.active !== false && user.role !== "tenant_admin");
  const firstOperationalAt = earliestDate([
    ...scoped.shifts.map(row => ({ at: row.createdAt || row.date })),
    ...scoped.workorders.map(row => ({ at: row.createdAt || row.completedAt })),
    ...scoped.clocks.map(row => ({ at: row.clockInAt || row.date }))
  ], "at");
  const tenantCreatedAt = scoped.tenant?.createdAt || scoped.tenant?.onboarding?.kboAppliedAt || null;
  const supportTickets = scoped.supportTickets || [];
  const ticketsPerUser = activeUsers.length ? +(supportTickets.length / activeUsers.length).toFixed(2) : supportTickets.length;
  const criticalBugs = supportTickets.filter(row => row.priority === "high" && row.category === "bug");
  const criticalBugsBreached = criticalBugs.filter(row => slaFor(row).breached).length;
  const completedWorkorders = scoped.workorders.filter(row => ["Voltooid", "Afgewerkt"].includes(row.status)).length;
  const reportsGenerated = store.data.auditLogs.filter(row => row.tenantId === tenantId && row.area === "reports").length;

  const kpis = [
    {
      key: "time_to_first_value",
      label: "Time-to-first-value",
      value: firstOperationalAt ? `${hoursBetween(tenantCreatedAt, firstOperationalAt) ?? 0}u` : "open",
      target: "< 24u",
      ok: firstOperationalAt ? (hoursBetween(tenantCreatedAt, firstOperationalAt) ?? 0) <= 24 : false
    },
    {
      key: "first_planning",
      label: "Eerste planning",
      value: scoped.shifts.length,
      target: ">= 1",
      ok: scoped.shifts.length >= 1
    },
    {
      key: "workorders",
      label: "Werkbonnen",
      value: scoped.workorders.length,
      target: ">= 10",
      ok: scoped.workorders.length >= 10
    },
    {
      key: "support_load",
      label: "Supporttickets/gebruiker",
      value: ticketsPerUser,
      target: "<= 2",
      ok: ticketsPerUser <= 2
    },
    {
      key: "critical_bug_sla",
      label: "Kritieke bugs binnen SLA",
      value: `${criticalBugs.length - criticalBugsBreached}/${criticalBugs.length}`,
      target: "100% binnen 48u",
      ok: criticalBugsBreached === 0
    },
    {
      key: "completed_workorders",
      label: "Afgewerkte werkbonnen",
      value: completedWorkorders,
      target: ">= 1",
      ok: completedWorkorders >= 1
    },
    {
      key: "decision_report",
      label: "Beslissersrapport",
      value: reportsGenerated,
      target: ">= 1",
      ok: reportsGenerated >= 1
    }
  ].map(withAction);

  return {
    generatedAt: new Date().toISOString(),
    score: Math.round((kpis.filter(kpi => kpi.ok).length / kpis.length) * 100),
    kpis
  };
}

function goNoGoSummary(pilot) {
  const openKpis = (pilot.kpis || []).filter(kpi => !kpi.ok);
  const decision = openKpis.length === 0 && pilot.score >= 80 ? "go" : "no_go";
  return {
    decision,
    openRiskCount: openKpis.length,
    headline: decision === "go"
      ? "Pilot voldoet aan de go-live criteria."
      : `${openKpis.length} pilot KPI's vragen nog opvolging voor go-live.`,
    actions: openKpis.map(kpi => ({
      key: kpi.key,
      label: kpi.label,
      value: kpi.value,
      target: kpi.target,
      action: kpi.action
    }))
  };
}

function decisionReport(store, tenant, actor) {
  const reportId = `decision_report_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "decision_report_generated", area: "reports", detail: reportId });

  const pilot = pilotKpis(store, tenant.id);
  const report = {
    id: reportId,
    generatedAt: new Date().toISOString(),
    generatedBy: actor.email,
    tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan, status: tenant.status },
    operations: managementReport(store, tenant.id),
    billing: billingQuote(store, tenant),
    pilot,
    goNoGo: goNoGoSummary(pilot)
  };
  return report;
}

module.exports = { pilotKpis, decisionReport, goNoGoSummary };
