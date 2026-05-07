const fs = require("fs");
const path = require("path");
const { Store } = require("../src/lib/store");
const { decisionReport } = require("../src/modules/pilot");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function safeName(value) {
  return String(value || "report").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function markdownReport(report) {
  const actions = report.goNoGo.actions || [];
  const kpis = report.pilot.kpis || [];
  return [
    `# Pilot Decision Report - ${report.tenant.name}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Decision: ${report.goNoGo.decision}`,
    `Pilot score: ${report.pilot.score}%`,
    `Open risks: ${report.goNoGo.openRiskCount}`,
    "",
    "## Go/No-Go",
    "",
    report.goNoGo.headline,
    "",
    "## Next Actions",
    "",
    ...(actions.length
      ? actions.map(action => `- ${action.label}: ${action.action} (${action.value} / ${action.target})`)
      : ["- No open pilot actions."]),
    "",
    "## KPI Snapshot",
    "",
    "| KPI | Value | Target | Status |",
    "| --- | --- | --- | --- |",
    ...kpis.map(kpi => `| ${kpi.label} | ${kpi.value} | ${kpi.target} | ${kpi.ok ? "OK" : "OPEN"} |`),
    "",
    "## Operations",
    "",
    `- Planning items: ${report.operations.totals.planningItems}`,
    `- Completed workorders: ${report.operations.totals.workordersCompleted}`,
    `- Clock entries: ${report.operations.totals.clockEntries}`,
    "",
    "## Billing",
    "",
    `- Plan: ${report.tenant.plan}`,
    `- Status: ${report.tenant.status}`,
    `- Annual total: EUR ${Number(report.billing.annualTotal || 0).toFixed(2)}`,
    `- Enterprise custom: ${report.billing.enterpriseCustom ? "yes" : "no"}`,
    ""
  ].join("\n");
}

const tenantId = argValue("--tenant", "t_demo");
const format = argValue("--format", "json");
const store = new Store();
const tenant = store.data.tenants.find(row => row.id === tenantId);

if (!tenant) {
  console.error(`Tenant niet gevonden: ${tenantId}`);
  process.exit(1);
}

const report = decisionReport(store, tenant, { email: "pilot-report@workflowpro.be" });
const defaultPath = path.join("data", "reports", `${safeName(tenantId)}-${safeName(report.generatedAt)}.json`);
const outputPath = argValue("--out", defaultPath);
const fullPath = path.resolve(outputPath);
const outputBase = fullPath.replace(/\.(json|md)$/i, "");
const written = [];

if (!["json", "md", "both"].includes(format)) {
  console.error("Ongeldig format. Gebruik json, md of both.");
  process.exit(1);
}

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
  decision: report.goNoGo.decision,
  openRiskCount: report.goNoGo.openRiskCount,
  score: report.pilot.score
}, null, 2));
