const { RELEASE_NOTES, releaseInfo } = require("./releases");
const { supportSummary } = require("./support");

const HELP_ARTICLES = [
  {
    id: "getting-started",
    title: "Eerste klantsetup",
    category: "Onboarding",
    summary: "Start met KBO-gegevens, medewerkersimport, werven en de eerste planning."
  },
  {
    id: "mobile-workorders",
    title: "Werkbonnen op mobiel",
    category: "Veldgebruik",
    summary: "Gebruik Vandaag om planning, foto's, handtekening en afronding op de werf te verwerken."
  },
  {
    id: "billing-compliance",
    title: "Billing en compliance",
    category: "Finance",
    summary: "Betaalmethode, factuurconcepten, DPA en GDPR-verzoeken worden tenant-scoped bijgehouden."
  },
  {
    id: "integrations",
    title: "ERP-koppelingen",
    category: "Integraties",
    summary: "Koppelingen gebruiken versleutelde secrets, field mapping en traceerbare sync logs."
  }
];

const ONBOARDING_BLUEPRINT = [
  { key: "kbo", label: "KBO toegepast", type: "automatic" },
  { key: "employees", label: "Medewerkers toegevoegd", type: "automatic" },
  { key: "venues", label: "Werven toegevoegd", type: "automatic" },
  { key: "planning", label: "Eerste planning gemaakt", type: "automatic" },
  { key: "workorders", label: "Werkbonnen actief", type: "automatic" },
  { key: "billing", label: "Billing voorbereid", type: "automatic" },
  { key: "pilot_agreement", label: "Pilotovereenkomst bevestigd", type: "manual" },
  { key: "weekly_review", label: "Weekly success review gepland", type: "manual" },
  { key: "decision_maker", label: "Beslisserrapport besproken", type: "manual" }
];

function automaticOnboardingDone(key, tenant, scoped, billing) {
  if (key === "kbo") return !!tenant.onboarding?.kboAppliedAt;
  if (key === "employees") return scoped.users.some(user => user.role !== "tenant_admin");
  if (key === "venues") return scoped.venues.length > 0;
  if (key === "planning") return scoped.shifts.length > 0;
  if (key === "workorders") return scoped.workorders.length > 0;
  if (key === "billing") return !!billing.paymentMethodTokenized || billing.invoices.length > 0;
  return false;
}

function onboardingSteps(store, tenant, billing) {
  const scoped = store.tenantScoped(tenant.id);
  const manual = tenant.onboarding?.manualSteps || {};
  return ONBOARDING_BLUEPRINT.map(step => {
    const done = step.type === "automatic"
      ? automaticOnboardingDone(step.key, tenant, scoped, billing)
      : !!manual[step.key]?.done;
    return {
      ...step,
      done,
      completedAt: step.type === "manual" ? manual[step.key]?.completedAt || null : null,
      completedBy: step.type === "manual" ? manual[step.key]?.completedBy || null : null
    };
  });
}

function portalPayload(store, tenant, status, billing) {
  const scoped = store.tenantScoped(tenant.id);
  const onboarding = onboardingSteps(store, tenant, billing);
  const completed = onboarding.filter(step => step.done).length;
  return {
    generatedAt: new Date().toISOString(),
    tenant: {
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
      status: tenant.status,
      billingEmail: tenant.billingEmail || ""
    },
    status: {
      app: "operational",
      api: status.health.api,
      storage: status.health.storage,
      pwa: status.health.pwa,
      release: releaseInfo(),
      supportAccess: tenant.supportAccess || { enabled: false },
      errors: status.counts.errorEvents || 0,
      supportTickets: supportSummary(store, tenant.id)
    },
    onboarding: {
      percent: Math.round((completed / onboarding.length) * 100),
      steps: onboarding
    },
    billing: {
      status: billing.billingStatus,
      paymentMethodTokenized: billing.paymentMethodTokenized,
      invoices: billing.invoices.length,
      failedPayments: billing.failedPayments.length,
      dpaAccepted: billing.dpaAccepted
    },
    helpArticles: HELP_ARTICLES,
    releaseNotes: RELEASE_NOTES
  };
}

function updateOnboardingStep(store, tenant, stepKey, payload, actor) {
  const blueprint = ONBOARDING_BLUEPRINT.find(step => step.key === stepKey);
  if (!blueprint) {
    const error = new Error("Onboardingstap niet gevonden");
    error.status = 404;
    throw error;
  }
  if (blueprint.type !== "manual") {
    const error = new Error("Deze onboardingstap wordt automatisch bepaald");
    error.status = 400;
    throw error;
  }

  const onboarding = tenant.onboarding || {};
  const manualSteps = onboarding.manualSteps || {};
  const done = payload.done !== false;
  const nextManualSteps = {
    ...manualSteps,
    [stepKey]: {
      done,
      completedAt: done ? new Date().toISOString() : null,
      completedBy: done ? actor.email : null
    }
  };
  const updatedTenant = store.updateTenant(tenant.id, {
    onboarding: {
      ...onboarding,
      manualSteps: nextManualSteps
    }
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "onboarding_step_updated", area: "portal", detail: `${stepKey}:${done}` });
  return updatedTenant;
}

module.exports = { portalPayload, updateOnboardingStep };
