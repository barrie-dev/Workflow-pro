const { readiness } = require("./golden-path");
const { goLiveReadiness } = require("./go-live");
const { productionReadiness } = require("./production");

const PHASES = [
  { key: "foundation", label: "Foundation" },
  { key: "core_operations", label: "Core Operations" },
  { key: "billing_compliance", label: "Billing + Compliance" },
  { key: "pilot_launch", label: "Pilot Launch" },
  { key: "commercial_launch", label: "Commercial Launch" }
];

function pickChecks(checks, keys) {
  return keys.map(key => checks.find(row => row.key === key)).filter(Boolean);
}

function openActions(rows) {
  return rows
    .filter(row => !row.ok)
    .map(row => ({
      key: row.key,
      label: row.label,
      priority: row.priority || "P1",
      action: row.action || row.detail || "Nog af te werken."
    }));
}

function phase(key, label, score, go, actions, detail) {
  return {
    key,
    label,
    score: Math.max(0, Math.min(100, Math.round(score || 0))),
    status: go ? "go" : "no_go",
    go: !!go,
    openCount: actions.length,
    actions,
    detail
  };
}

function roadmapStatus(store, tenant) {
  const generatedAt = new Date().toISOString();
  const golden = readiness(store, tenant.id);
  const goLive = goLiveReadiness(store, tenant, { strictProduction: false });
  const allProductionChecks = productionReadiness(store).checks;

  const foundationChecks = pickChecks(allProductionChecks, [
    "database",
    "migrations",
    "mfa",
    "jwt_secret",
    "encryption_key",
    "backup_freshness"
  ]);
  const billingChecks = pickChecks(allProductionChecks, ["stripe", "peppol"]);
  const launchChecks = pickChecks(allProductionChecks, ["app_url", "release"]);

  const openGoldenSteps = (golden.steps || [])
    .filter(row => !row.done)
    .map(row => ({
      key: row.key,
      label: row.key,
      priority: "P1",
      action: "Werk deze golden-path stap af met echte tenantdata."
    }));

  const phases = [
    phase(
      "foundation",
      "Foundation",
      foundationChecks.length ? (foundationChecks.filter(row => row.ok).length / foundationChecks.length) * 100 : 0,
      foundationChecks.every(row => row.ok),
      openActions(foundationChecks),
      "Tenant isolation, auth/MFA, migraties, secrets en backupbasis."
    ),
    phase(
      "core_operations",
      "Core Operations",
      golden.percent,
      golden.percent === 100,
      openGoldenSteps,
      "Golden path: KBO, medewerkers, planning, werkbonnen, tijd en factuurconcept."
    ),
    phase(
      "billing_compliance",
      "Billing + Compliance",
      billingChecks.length ? (billingChecks.filter(row => row.ok).length / billingChecks.length) * 100 : 0,
      billingChecks.every(row => row.ok),
      openActions(billingChecks),
      "Stripe, facturatie, Peppol en compliance-ready payment flow."
    ),
    phase(
      "pilot_launch",
      "Pilot Launch",
      goLive.gates.pilot.score,
      goLive.gates.pilot.ok,
      (goLive.gates.pilot.openKpis || []).map(row => ({
        key: row.key,
        label: row.label,
        priority: "P1",
        action: row.action || "Verzamel pilotbewijs."
      })),
      "Mobiele flow, werkbonvolume, supportdruk en beslissersrapporten."
    ),
    phase(
      "commercial_launch",
      "Commercial Launch",
      Math.round(((goLive.gates.sales.score || 0) + (launchChecks.filter(row => row.ok).length / Math.max(launchChecks.length, 1)) * 100) / 2),
      goLive.gates.sales.ok && launchChecks.every(row => row.ok),
      [
        ...openActions(launchChecks),
        ...(goLive.gates.sales.openChecks || []).map(row => ({
          key: row.key,
          label: row.label,
          priority: "P1",
          action: row.action || "Werk commercial launch bewijs af."
        }))
      ],
      "Website, pipeline, production URL, release metadata en betalende klanten."
    )
  ];

  const current = phases.find(row => !row.go) || phases[phases.length - 1];
  return {
    ok: phases.every(row => row.go),
    generatedAt,
    tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan, status: tenant.status },
    currentPhase: current.key,
    phases,
    summary: {
      total: phases.length,
      go: phases.filter(row => row.go).length,
      noGo: phases.filter(row => !row.go).length,
      openActions: phases.reduce((total, row) => total + row.openCount, 0)
    }
  };
}

module.exports = { roadmapStatus, PHASES };
