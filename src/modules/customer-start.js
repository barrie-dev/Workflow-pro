const { roadmapStatus } = require("./roadmap");

function action(label, view, detail) {
  return { label, view, detail };
}

function startStep(key, label, done, actions) {
  return {
    key,
    label,
    done: !!done,
    status: done ? "ready" : "open",
    actions: actions.filter(Boolean)
  };
}

function nextAction(sections) {
  for (const section of sections) {
    const openStep = section.steps.find(step => !step.done);
    if (openStep) return { section: section.key, step: openStep.key, ...openStep.actions[0] };
  }
  return action("Open Actiecentrum", "notifications", "Klant is operationeel; volg dagelijkse prioriteiten op.");
}

function hoursBetween(clock) {
  if (!clock.clockIn || !clock.clockOut) return 0;
  const [inHour, inMinute] = String(clock.clockIn).split(":").map(Number);
  const [outHour, outMinute] = String(clock.clockOut).split(":").map(Number);
  if ([inHour, inMinute, outHour, outMinute].some(Number.isNaN)) return 0;
  return Math.max(0, ((outHour * 60 + outMinute) - (inHour * 60 + inMinute)) / 60);
}

function buildWorkspace(scoped, activation, next) {
  const today = new Date().toISOString().slice(0, 10);
  const sortedShiftDates = Array.from(new Set(scoped.shifts.map(row => row.date).filter(Boolean))).sort();
  const nextShiftDate = sortedShiftDates.find(date => date >= today);
  const latestShiftDate = sortedShiftDates[sortedShiftDates.length - 1];
  const workspaceDate = scoped.shifts.some(row => row.date === today) ? today : nextShiftDate || latestShiftDate || today;
  const isDone = row => ["Voltooid", "Afgewerkt"].includes(row.status);
  const dayShifts = scoped.shifts.filter(row => row.date === workspaceDate);
  const upcomingShifts = scoped.shifts
    .filter(row => String(row.date || "") >= workspaceDate)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .slice(0, 4);
  const openWorkorders = scoped.workorders.filter(row => !isDone(row));
  const pendingExpenses = scoped.expenses.filter(row => row.status !== "approved");
  const clockedHours = scoped.clocks.reduce((sum, row) => sum + hoursBetween(row), 0);
  const dailyFlowReady = !!dayShifts.length && !!openWorkorders.length;

  const priorityActions = [];
  if (pendingExpenses.length) {
    priorityActions.push({
      label: `${pendingExpenses.length} onkosten goedkeuren`,
      detail: "Voorkom vertraging in payroll en facturatie.",
      view: "billing",
      tone: "warning"
    });
  }
  if (openWorkorders.length) {
    priorityActions.push({
      label: `${openWorkorders.length} open werkbonnen opvolgen`,
      detail: "Zet werkbonnen klaar voor uitvoering of facturatie.",
      view: "workorders",
      tone: "critical"
    });
  }
  if (!dayShifts.length) {
    priorityActions.push({
      label: "Planning nakijken",
      detail: upcomingShifts.length ? "Er is geen shift vandaag, maar wel komende planning." : "Maak de eerste planning voor een echte werf.",
      view: "planning",
      tone: "warning"
    });
  }
  if (activation.percent < 100 && next?.label) {
    priorityActions.push({
      label: next.label,
      detail: next.detail,
      view: next.view,
      tone: "info"
    });
  }

  return {
    date: workspaceDate,
    liveDate: today,
    usesLatestPlanningDay: workspaceDate !== today,
    metrics: [
      { label: workspaceDate === today ? "Planning vandaag" : "Planning demo-dag", value: dayShifts.length, detail: `${upcomingShifts.length} komende items` },
      { label: "Open werkbonnen", value: openWorkorders.length, detail: `${scoped.workorders.length} totaal` },
      { label: "Uren geregistreerd", value: `${Number(clockedHours.toFixed(1))}u`, detail: `${scoped.clocks.length} registraties` },
      { label: "Onkosten te keuren", value: pendingExpenses.length, detail: `${scoped.expenses.length} ingediend` }
    ],
    liveStatus: {
      ready: dailyFlowReady,
      label: dailyFlowReady ? "Dagelijkse flow klaar" : "Nog niet klantklaar",
      detail: dailyFlowReady
        ? "Planning en werkbonnen zijn aanwezig. Test nu de echte dagflow met kantoor en werf."
        : "Zet minstens planning en werkbonnen klaar voordat een klant zelfstandig start.",
      blockers: [
        dayShifts.length ? "" : "Geen planning voor de eerstvolgende werkdag",
        openWorkorders.length ? "" : "Geen open werkbonnen voor uitvoering"
      ].filter(Boolean)
    },
    priorityActions: priorityActions.slice(0, 3),
    upcomingShifts: upcomingShifts.map(row => ({
      id: row.id,
      date: row.date,
      start: row.start || row.startsAt,
      end: row.end || row.endsAt,
      project: row.project || row.client || "Planning",
      venueId: row.venueId
    })),
    assistant: {
      title: priorityActions[0]?.label || "Klantflow is rustig",
      detail: priorityActions[0]?.detail || "Er zijn geen dringende acties. Controleer rapportage of bereid de volgende klantactivatie voor.",
      primary: priorityActions[0] || { label: "Open Actiecentrum", view: "notifications" }
    }
  };
}

function customerStartPayload(store, tenant, portal, billing) {
  const scoped = store.tenantScoped(tenant.id);
  const roadmap = roadmapStatus(store, tenant);
  const onboarding = portal.onboarding || { percent: 0, steps: [] };
  const stepDone = key => !!(onboarding.steps || []).find(step => step.key === key)?.done;
  const completedWorkorders = scoped.workorders.filter(row => ["Voltooid", "Afgewerkt"].includes(row.status)).length;
  const pilot = roadmap.phases.find(row => row.key === "pilot_launch") || {};
  const foundation = roadmap.phases.find(row => row.key === "foundation") || {};

  const sections = [
    {
      key: "company",
      label: "Bedrijf klaarzetten",
      goal: "Klantgegevens, team en locaties moeten eerst juist staan.",
      steps: [
        startStep("kbo", "KBO en facturatiegegevens", stepDone("kbo"), [
          action("Open instellingen", "admin", "Controleer bedrijfsgegevens en tenantsetup.")
        ]),
        startStep("employees", "Medewerkers toegevoegd", stepDone("employees"), [
          action("Open instellingen", "admin", "Voeg planners en veldmedewerkers toe via de onboarding setup.")
        ]),
        startStep("venues", "Werven of locaties toegevoegd", stepDone("venues"), [
          action("Open instellingen", "admin", "Maak of controleer de eerste werf of klantlocatie.")
        ])
      ]
    },
    {
      key: "first_day",
      label: "Eerste werkdag testen",
      goal: "De klant moet planning, werkbon en uren zonder hulp kunnen doorlopen.",
      steps: [
        startStep("planning", "Eerste planning gemaakt", stepDone("planning"), [
          action("Maak planning", "planning", "Plan minstens een medewerker op een echte opdracht.")
        ]),
        startStep("workorders", "Werkbon actief", stepDone("workorders"), [
          action("Open werkbonnen", "workorders", "Maak of controleer de eerste werkbon.")
        ]),
        startStep("completed_workorder", "Werkbon afgewerkt", completedWorkorders > 0, [
          action("Open werkbonnen", "workorders", "Controleer mobiele bewijsstukken, foto of handtekening.")
        ])
      ]
    },
    {
      key: "go_live",
      label: "Live-afspraken",
      goal: "Billing, support en pilotbewijs maken de klant klaar voor echte activatie.",
      steps: [
        startStep("billing", "Billing voorbereid", stepDone("billing") || billing.paymentMethodTokenized, [
          action("Open billing", "billing", "Zet betaalmethode, contract of factuurconcept klaar.")
        ]),
        startStep("pilot", "Pilot KPI's boven 80%", pilot.go, [
          action("Open instellingen", "admin", "Werk open pilot-KPI's af voor go/no-go.")
        ]),
        startStep("foundation", "Production blockers opgevolgd", foundation.go, [
          action("Open admin", "admin", "Los Foundation P0-blockers op voor productie.")
        ])
      ]
    }
  ];

  const totalSteps = sections.reduce((total, section) => total + section.steps.length, 0);
  const doneSteps = sections.reduce((total, section) => total + section.steps.filter(step => step.done).length, 0);

  const next = nextAction(sections);
  const activation = {
    percent: Math.round((doneSteps / totalSteps) * 100),
    doneSteps,
    totalSteps,
    currentPhase: roadmap.currentPhase,
    readyForPilot: !!pilot.go,
    readyForProduction: roadmap.ok
  };

  return {
    generatedAt: new Date().toISOString(),
    tenant: portal.tenant,
    activation,
    nextAction: next,
    workspace: buildWorkspace(scoped, activation, next),
    sections
  };
}

module.exports = { customerStartPayload };
