const { Store } = require("../src/lib/store");
const { tenantStatus } = require("../src/modules/admin");
const { billingSummary } = require("../src/modules/billing");
const { portalPayload } = require("../src/modules/portal");
const { customerStartPayload } = require("../src/modules/customer-start");

const INTERNAL_VIEWS = new Set(["portal", "sales", "mobile", "status", "json", "api", "demo"]);

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function collectViews(start) {
  const views = [];
  if (start.nextAction?.view) views.push({ source: "nextAction", view: start.nextAction.view });
  if (start.workspace?.assistant?.primary?.view) views.push({ source: "assistant.primary", view: start.workspace.assistant.primary.view });
  (start.workspace?.priorityActions || []).forEach((action, index) => {
    if (action.view) views.push({ source: `priorityActions.${index}`, view: action.view });
  });
  (start.sections || []).forEach(section => {
    (section.steps || []).forEach(step => {
      (step.actions || []).forEach((action, index) => {
        if (action.view) views.push({ source: `${section.key}.${step.key}.${index}`, view: action.view });
      });
    });
  });
  return views;
}

function fail(message, details = {}) {
  return { ok: false, message, details };
}

const tenantId = argValue("--tenant", "t_demo");
const jsonMode = process.argv.includes("--json");
const store = new Store();
const tenant = store.data.tenants.find(row => row.id === tenantId);

if (!tenant) {
  const payload = fail("Tenant niet gevonden", { tenantId });
  if (jsonMode) console.log(JSON.stringify(payload, null, 2));
  else console.error(`${payload.message}: ${tenantId}`);
  process.exit(1);
}

const status = tenantStatus(store, tenantId);
const billing = billingSummary(tenant);
const portal = portalPayload(store, tenant, status, billing);
const start = customerStartPayload(store, tenant, portal, billing);
const scoped = store.tenantScoped(tenantId);
const liveStatus = start.workspace?.liveStatus || {};
const visibleViews = collectViews(start);
const internalRoutes = visibleViews.filter(item => INTERNAL_VIEWS.has(item.view));
const hasPlanning = scoped.shifts.some(row => row.date === start.workspace?.date);
const hasOpenWorkorders = scoped.workorders.some(row => !["Voltooid", "Afgewerkt"].includes(row.status));
const expectedReady = hasPlanning && hasOpenWorkorders;

const failures = [
  typeof liveStatus.ready === "boolean" ? null : fail("liveStatus.ready ontbreekt of is geen boolean"),
  liveStatus.label ? null : fail("liveStatus.label ontbreekt"),
  liveStatus.detail ? null : fail("liveStatus.detail ontbreekt"),
  Array.isArray(liveStatus.blockers) ? null : fail("liveStatus.blockers is geen array"),
  liveStatus.ready === expectedReady ? null : fail("liveStatus.ready komt niet overeen met planning/werkbonnen", { expectedReady, hasPlanning, hasOpenWorkorders }),
  internalRoutes.length ? fail("Customer start verwijst naar verborgen interne views", { internalRoutes }) : null
].filter(Boolean);

const payload = {
  ok: failures.length === 0,
  tenant: { id: tenant.id, name: tenant.name },
  generatedAt: start.generatedAt,
  workspaceDate: start.workspace?.date,
  liveStatus,
  routeCount: visibleViews.length,
  failures
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.ok ? 0 : 1);
}

console.log(`WorkFlow Pro customer-start preflight voor ${tenant.name}`);
console.log(`Werkdatum: ${payload.workspaceDate}`);
console.log(`Live status: ${liveStatus.label} (${liveStatus.ready ? "ready" : "blocked"})`);
console.log(`Actieroutes gecontroleerd: ${visibleViews.length}`);

if (!payload.ok) {
  console.log("\nBlokkers");
  failures.forEach(row => console.log(`- ${row.message}`));
  process.exit(1);
}

console.log("\nCustomer-start preflight OK.");
