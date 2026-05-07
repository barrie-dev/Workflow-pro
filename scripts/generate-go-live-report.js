const fs = require("fs");
const path = require("path");
const { Store } = require("../src/lib/store");
const { productionReadiness } = require("../src/modules/production");
const { pilotKpis } = require("../src/modules/pilot");
const { salesLaunchReadiness } = require("../src/modules/sales");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function safeName(value) {
  return String(value || "report").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function buildReport(store, tenant, options) {
  const production = productionReadiness(store);
  const openP0 = production.checks.filter(row => !row.ok && row.priority === "P0");
  const openP1 = production.checks.filter(row => !row.ok && row.priority === "P1");
  const pilot = pilotKpis(store, tenant.id);
  const openPilot = pilot.kpis.filter(row => !row.ok);
  const sales = salesLaunchReadiness(store, tenant.id);
  const productionOk = openP0.length === 0 && (!options.strictProduction || openP1.length === 0);
  const pilotOk = pilot.score >= options.minPilotScore && openPilot.length === 0;
  return {
    ok: productionOk && pilotOk && sales.ok,
    tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan, status: tenant.status },
    generatedAt: new Date().toISOString(),
    gates: {
      production: { ok: productionOk, strict: options.strictProduction, score: production.score, p0: openP0.length, p1: openP1.length, openP0, openP1 },
      pilot: { ok: pilotOk, minScore: options.minPilotScore, score: pilot.score, openCount: openPilot.length, openKpis: openPilot },
      sales: { ok: sales.ok, score: sales.score, openCount: sales.openChecks.length, openChecks: sales.openChecks }
    }
  };
}

function markdownReport(report) {
  return [
    `# WorkFlow Pro Go-Live Report - ${report.tenant.name}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Overall: ${report.ok ? "OK" : "OPEN"}`,
    "",
    "## Gate Scores",
    "",
    `- Production: ${report.gates.production.score}% (P0 ${report.gates.production.p0}, P1 ${report.gates.production.p1})`,
    `- Pilot: ${report.gates.pilot.score}% (${report.gates.pilot.openCount} open KPI's)`,
    `- Sales: ${report.gates.sales.score}% (${report.gates.sales.openCount} open checks)`,
    "",
    "## Production P0 Blockers",
    "",
    ...(report.gates.production.openP0.length
      ? report.gates.production.openP0.map(row => `- ${row.label}: ${row.detail}`)
      : ["- Geen P0 blockers."]),
    "",
    "## Pilot Actions",
    "",
    ...(report.gates.pilot.openKpis.length
      ? report.gates.pilot.openKpis.map(row => `- ${row.label}: ${row.action}`)
      : ["- Geen open pilot acties."]),
    "",
    "## Sales Actions",
    "",
    ...(report.gates.sales.openChecks.length
      ? report.gates.sales.openChecks.map(row => `- ${row.label}: ${row.action}`)
      : ["- Geen open sales acties."]),
    ""
  ].join("\n");
}

const tenantId = argValue("--tenant", "t_demo");
const format = argValue("--format", "json");
const minPilotScore = Number(argValue("--min-pilot-score", "80"));
const strictProduction = process.argv.includes("--strict-production");
const store = new Store();
const tenant = store.data.tenants.find(row => row.id === tenantId);

if (!tenant) {
  console.error(`Tenant niet gevonden: ${tenantId}`);
  process.exit(1);
}
if (!["json", "md", "both"].includes(format)) {
  console.error("Ongeldig format. Gebruik json, md of both.");
  process.exit(1);
}

const report = buildReport(store, tenant, { minPilotScore, strictProduction });
const defaultPath = path.join("data", "reports", `${safeName(tenantId)}-go-live-${safeName(report.generatedAt)}.json`);
const outputPath = argValue("--out", defaultPath);
const outputBase = path.resolve(outputPath).replace(/\.(json|md)$/i, "");
const written = [];

fs.mkdirSync(path.dirname(outputBase), { recursive: true });
if (format === "json" || format === "both") {
  const jsonPath = `${outputBase}.json`;
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  written.push(jsonPath);
}
if (format === "md" || format === "both") {
  const mdPath = `${outputBase}.md`;
  fs.writeFileSync(mdPath, markdownReport(report));
  written.push(mdPath);
}

console.log(JSON.stringify({
  ok: true,
  outputPath: written[0],
  files: written,
  format,
  tenant: report.tenant,
  goLiveReady: report.ok,
  productionP0: report.gates.production.p0,
  pilotOpen: report.gates.pilot.openCount,
  salesOpen: report.gates.sales.openCount
}, null, 2));
