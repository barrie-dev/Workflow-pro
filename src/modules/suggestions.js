const { can } = require("../lib/auth");
const { readiness } = require("./golden-path");
const { todayPayload } = require("./mobile");
const { goLiveReadiness } = require("./go-live");

const STEP_LABELS = {
  tenant: "klantomgeving",
  kbo: "KBO-gegevens",
  employees: "medewerkers",
  planning: "eerste planning",
  workorders: "werkbon",
  clockings: "tijdregistratie",
  invoice: "factuurconcept"
};

function action(label, type, target) {
  return { label, type, target };
}

function homeSuggestion(store, tenant, user) {
  const golden = readiness(store, tenant.id);
  const today = todayPayload(store, user);
  const openStep = (golden.steps || []).find(step => !step.done);
  const isAdmin = can(user, "settings") || can(user, "tenants");
  const goLive = isAdmin ? goLiveReadiness(store, tenant, { strictProduction: false }) : null;
  const openP0 = goLive?.gates?.production?.openP0 || [];
  const openPilot = goLive?.gates?.pilot?.openKpis || [];
  const workorders = today.openWorkorders?.length || 0;

  if (openStep) {
    return {
      key: `golden_${openStep.key}`,
      title: `Rond ${STEP_LABELS[openStep.key] || openStep.key} af`,
      text: `De onboarding staat op ${golden.percent}%. Werk eerst deze stap af zodat een nieuwe klant sneller operationeel raakt.`,
      priority: "P1",
      source: "golden_path",
      primary: action("Maak golden path", "golden", "demo"),
      secondary: action("Open Operations", "view", "ops")
    };
  }

  if (workorders > 0) {
    return {
      key: "mobile_workorders",
      title: "Pak mobiele werkbonnen op",
      text: `Er staan ${workorders} open werkbonnen klaar. Test afronden, foto en handtekening in de mobiele flow.`,
      priority: "P1",
      source: "mobile_today",
      primary: action("Open Mobile", "view", "mobile"),
      secondary: action("Bekijk Werkbonnen", "view", "workorders")
    };
  }

  if (isAdmin && openP0.length) {
    return {
      key: "production_blockers",
      title: "Los production blockers op",
      text: `Er staan nog ${openP0.length} P0-blockers open. Begin met ${openP0[0].label.toLowerCase()}.`,
      priority: "P0",
      source: "go_live",
      primary: action("Open Admin", "view", "admin"),
      secondary: action("Bekijk Status", "view", "status")
    };
  }

  if (isAdmin && openPilot.length) {
    return {
      key: "pilot_kpis",
      title: "Verzamel pilotbewijs",
      text: `De productieflow is bruikbaar, maar ${openPilot.length} pilot-KPI's vragen nog bewijs met echte data.`,
      priority: "P1",
      source: "pilot",
      primary: action("Open Portal", "view", "portal"),
      secondary: action("Open Sales", "view", "sales")
    };
  }

  return {
    key: "ready_next",
    title: "Klaar voor de volgende validatie",
    text: "De belangrijkste appflow staat klaar. Ga verder met pilotdata, beslissersrapporten en verkoopopvolging.",
    priority: "P2",
    source: "app",
    primary: action("Open Portal", "view", "portal"),
    secondary: action("Open Sales", "view", "sales")
  };
}

module.exports = { homeSuggestion };
