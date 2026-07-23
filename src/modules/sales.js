const STAGES = [
  "qualified_lead",
  "demo_booked",
  "proposal_sent",
  "pilot",
  "paying_customer",
  "lost"
];

function salesSummary(store, tenantId) {
  const rows = store.list("salesLeads", tenantId);
  const partners = store.list("partners", tenantId);
  const activeRows = rows.filter(row => row.stage !== "lost");
  const partnerRows = rows.filter(row => row.partnerId);
  const byStage = STAGES.map(stage => ({
    stage,
    count: rows.filter(row => row.stage === stage).length
  }));
  const byPartner = partners.map(partner => {
    const referred = rows.filter(row => row.partnerId === partner.id);
    return {
      id: partner.id,
      name: partner.name,
      type: partner.type,
      status: partner.status,
      leads: referred.length,
      demoCalls: referred.filter(row => ["demo_booked", "proposal_sent", "pilot", "paying_customer"].includes(row.stage)).length,
      payingCustomers: referred.filter(row => row.stage === "paying_customer").length
    };
  });
  const qualifiedLeads = rows.filter(row => row.stage !== "lost").length;
  const demoCalls = rows.filter(row => ["demo_booked", "proposal_sent", "pilot", "paying_customer"].includes(row.stage)).length;
  const payingCustomers = rows.filter(row => row.stage === "paying_customer").length;
  return {
    generatedAt: new Date().toISOString(),
    targets: {
      qualifiedLeads: 20,
      demoCalls: 10,
      payingCustomers: 3
    },
    actuals: {
      qualifiedLeads,
      demoCalls,
      payingCustomers,
      estimatedSeats: activeRows.reduce((total, row) => total + Number(row.seats || 0), 0),
      // "paused" bestond alleen in het legacy-resellerpad en is genormaliseerd
      // naar de 23.14-status "suspended"; een gesuspendeerde of beeindigde
      // partner telt niet als actieve partner.
      activePartners: partners.filter(row => !["paused", "suspended", "terminated"].includes(row.status)).length,
      partnerLeads: partnerRows.length
    },
    activation: {
      leadProgress: Math.min(100, Math.round((qualifiedLeads / 20) * 100)),
      demoProgress: Math.min(100, Math.round((demoCalls / 10) * 100)),
      paidProgress: Math.min(100, Math.round((payingCustomers / 3) * 100))
    },
    byStage,
    byPartner
  };
}

const LAUNCH_ACTIONS = {
  qualified_leads: "Vul de CRM-pipeline aan tot minstens 20 qualified leads.",
  demo_calls: "Plan extra demo calls met ICP-fit prospecten.",
  paying_customers: "Converteer pilots of voorstellen naar minstens 3 betalende klanten.",
  activation_rate: "Verhoog activatie door onboardingstappen, eerste planning en werkbon binnen dag 1 af te ronden.",
  trial_to_paid: "Werk pricing, objections en opvolging uit om trial-to-paid boven 20% te krijgen.",
  churn_60d: "Onderzoek recente churn en blokkeer commercial launch zolang eerste 60 dagen churn boven 0 ligt."
};

function salesLaunchReadiness(store, tenantId) {
  const summary = salesSummary(store, tenantId);
  const rows = store.list("salesLeads", tenantId);
  const activeRows = rows.filter(row => row.stage !== "lost");
  const activatedRows = activeRows.filter(row => row.activatedAt || ["pilot", "paying_customer"].includes(row.stage));
  const trialRows = rows.filter(row => ["pilot", "paying_customer"].includes(row.stage));
  const payingRows = rows.filter(row => row.stage === "paying_customer");
  const churnedRows = rows.filter(row => row.churnedAt || row.stage === "lost_after_paid");
  const activationRate = activeRows.length ? Math.round((activatedRows.length / activeRows.length) * 100) : 0;
  const trialToPaid = trialRows.length ? Math.round((payingRows.length / trialRows.length) * 100) : 0;
  const churn60d = churnedRows.length;
  const checks = [
    {
      key: "qualified_leads",
      label: "Qualified leads",
      value: summary.actuals.qualifiedLeads,
      target: summary.targets.qualifiedLeads,
      ok: summary.actuals.qualifiedLeads >= summary.targets.qualifiedLeads,
      action: LAUNCH_ACTIONS.qualified_leads
    },
    {
      key: "demo_calls",
      label: "Demo calls",
      value: summary.actuals.demoCalls,
      target: summary.targets.demoCalls,
      ok: summary.actuals.demoCalls >= summary.targets.demoCalls,
      action: LAUNCH_ACTIONS.demo_calls
    },
    {
      key: "paying_customers",
      label: "Betalende klanten",
      value: summary.actuals.payingCustomers,
      target: summary.targets.payingCustomers,
      ok: summary.actuals.payingCustomers >= summary.targets.payingCustomers,
      action: LAUNCH_ACTIONS.paying_customers
    },
    {
      key: "activation_rate",
      label: "Activation rate",
      value: activationRate,
      target: 70,
      unit: "%",
      ok: activationRate >= 70,
      action: LAUNCH_ACTIONS.activation_rate
    },
    {
      key: "trial_to_paid",
      label: "Trial-to-paid",
      value: trialToPaid,
      target: 20,
      unit: "%",
      ok: trialToPaid >= 20,
      action: LAUNCH_ACTIONS.trial_to_paid
    },
    {
      key: "churn_60d",
      label: "Churn eerste 60 dagen",
      value: churn60d,
      target: 0,
      ok: churn60d === 0,
      action: LAUNCH_ACTIONS.churn_60d
    }
  ];
  return {
    generatedAt: new Date().toISOString(),
    score: Math.round((checks.filter(check => check.ok).length / checks.length) * 100),
    ok: checks.every(check => check.ok),
    summary,
    checks,
    openChecks: checks.filter(check => !check.ok)
  };
}

function nextStage(currentStage) {
  const index = STAGES.indexOf(currentStage || "qualified_lead");
  return STAGES[Math.min(index + 1, STAGES.indexOf("paying_customer"))] || "qualified_lead";
}

function advanceLead(store, tenant, leadId, actor) {
  const lead = store.get("salesLeads", leadId);
  if (!lead || lead.tenantId !== tenant.id) {
    const error = new Error("Lead niet gevonden");
    error.status = 404;
    throw error;
  }
  const from = lead.stage || "qualified_lead";
  const to = nextStage(from);
  const row = store.update("salesLeads", leadId, {
    stage: to,
    updatedAt: new Date().toISOString(),
    lastStageChangeAt: new Date().toISOString()
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "sales_stage_advanced", area: "sales", detail: `${leadId}:${from}->${to}` });
  return row;
}

function addPartnerNote(store, tenant, partnerId, payload, actor) {
  const partner = store.get("partners", partnerId);
  if (!partner || partner.tenantId !== tenant.id) {
    const error = new Error("Partner niet gevonden");
    error.status = 404;
    throw error;
  }
  const text = String(payload.note || "").trim();
  if (!text) {
    const error = new Error("Notitie is verplicht");
    error.status = 400;
    throw error;
  }
  const note = {
    at: new Date().toISOString(),
    by: actor.email,
    text
  };
  const row = store.update("partners", partnerId, {
    notes: [...(partner.notes || []), note],
    nextActionAt: payload.nextActionAt || partner.nextActionAt || "",
    updatedAt: new Date().toISOString()
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "partner_note_added", area: "sales", detail: partnerId });
  return row;
}

module.exports = { salesSummary, salesLaunchReadiness, advanceLead, addPartnerNote, STAGES };
