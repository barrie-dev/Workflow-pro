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

function cleanValue(value, fallback = "") {
  return String(value || fallback).replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 80);
}

function suggestion(payload) {
  return {
    confidence: payload.confidence || "medium",
    reasons: payload.reasons || [],
    metrics: payload.metrics || {},
    ...payload
  };
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
    return suggestion({
      key: `golden_${openStep.key}`,
      title: `Rond ${STEP_LABELS[openStep.key] || openStep.key} af`,
      text: `De onboarding staat op ${golden.percent}%. Werk eerst deze stap af zodat een nieuwe klant sneller operationeel raakt.`,
      priority: "P1",
      source: "golden_path",
      confidence: "high",
      reasons: [
        "Golden path is nog niet volledig klaar.",
        `${STEP_LABELS[openStep.key] || openStep.key} is de eerste open stap.`
      ],
      metrics: {
        goldenPathPercent: golden.percent,
        openStep: openStep.key
      },
      primary: action("Maak golden path", "golden", "demo"),
      secondary: action("Open Operations", "view", "ops")
    });
  }

  if (workorders > 0) {
    return suggestion({
      key: "mobile_workorders",
      title: "Pak mobiele werkbonnen op",
      text: `Er staan ${workorders} open werkbonnen klaar. Test afronden, foto en handtekening in de mobiele flow.`,
      priority: "P1",
      source: "mobile_today",
      confidence: "high",
      reasons: [
        "Er zijn open werkbonnen voor de ingelogde gebruiker.",
        "Mobiele werkbonnen zijn kritisch voor pilotgebruik op locatie."
      ],
      metrics: {
        openWorkorders: workorders,
        shiftsToday: today.shifts?.length || 0
      },
      primary: action("Open Mobile", "view", "mobile"),
      secondary: action("Bekijk Werkbonnen", "view", "workorders")
    });
  }

  if (isAdmin && openP0.length) {
    return suggestion({
      key: "production_blockers",
      title: "Los production blockers op",
      text: `Er staan nog ${openP0.length} P0-blockers open. Begin met ${openP0[0].label.toLowerCase()}.`,
      priority: "P0",
      source: "go_live",
      confidence: "high",
      reasons: [
        "Production readiness heeft open P0-blockers.",
        `${openP0[0].label} is het eerste blocker-item in de gate.`
      ],
      metrics: {
        productionScore: goLive.gates.production.score,
        openP0: openP0.length,
        firstBlocker: openP0[0].key
      },
      primary: action("Open Admin", "view", "admin"),
      secondary: action("Bekijk Status", "view", "status")
    });
  }

  if (isAdmin && openPilot.length) {
    return suggestion({
      key: "pilot_kpis",
      title: "Verzamel pilotbewijs",
      text: `De productieflow is bruikbaar, maar ${openPilot.length} pilot-KPI's vragen nog bewijs met echte data.`,
      priority: "P1",
      source: "pilot",
      confidence: "medium",
      reasons: [
        "Pilot KPI's zijn nog niet volledig afgevinkt.",
        "De volgende stap is bewijs uit echte klantflow verzamelen."
      ],
      metrics: {
        pilotScore: goLive.gates.pilot.score,
        openPilotKpis: openPilot.length
      },
      primary: action("Open Portal", "view", "portal"),
      secondary: action("Open Sales", "view", "sales")
    });
  }

  return suggestion({
    key: "ready_next",
    title: "Klaar voor de volgende validatie",
    text: "De belangrijkste appflow staat klaar. Ga verder met pilotdata, beslissersrapporten en verkoopopvolging.",
    priority: "P2",
    source: "app",
    confidence: "medium",
    reasons: [
      "Er is geen dringender open onboarding-, mobile- of productionadvies gevonden.",
      "Pilot- en salesvalidatie zijn de logische volgende stap."
    ],
    metrics: {
      goldenPathPercent: golden.percent,
      openWorkorders: workorders
    },
    primary: action("Open Portal", "view", "portal"),
    secondary: action("Open Sales", "view", "sales")
  });
}

function recordSuggestionEvent(store, tenant, user, payload = {}) {
  const key = cleanValue(payload.key, "unknown");
  const event = cleanValue(payload.event, "opened");
  const source = cleanValue(payload.source, "homepage");
  const priority = cleanValue(payload.priority, "unrated");
  const detail = `${key}:${event}:${source}:${priority}`;
  store.audit({
    actor: user.email,
    tenantId: tenant.id,
    action: "suggestion_interaction",
    area: "suggestions",
    detail
  });
  return { key, event, source, priority, recordedAt: new Date().toISOString() };
}

module.exports = { homeSuggestion, recordSuggestionEvent };
