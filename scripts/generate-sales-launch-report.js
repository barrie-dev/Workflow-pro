const fs = require("fs");
const path = require("path");
const { Store } = require("../src/lib/store");
const { salesLaunchReadiness } = require("../src/modules/sales");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function safeName(value) {
  return String(value || "report").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function formatValue(check) {
  return `${check.value}${check.unit || ""} / ${check.target}${check.unit || ""}`;
}

function markdownReport(report) {
  const summary = report.summary || {};
  const actuals = summary.actuals || {};
  const targets = summary.targets || {};
  return [
    `# Commercial Launch Report - ${report.tenant.name}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Launch ready: ${report.ok ? "yes" : "no"}`,
    `Launch score: ${report.score}%`,
    `Open checks: ${report.openChecks.length}`,
    "",
    "## Open Actions",
    "",
    ...(report.openChecks.length
      ? report.openChecks.map(check => `- ${check.label}: ${check.action} (${formatValue(check)})`)
      : ["- No open commercial launch actions."]),
    "",
    "## Launch KPI Snapshot",
    "",
    "| KPI | Value | Target | Status |",
    "| --- | --- | --- | --- |",
    ...report.checks.map(check => `| ${check.label} | ${check.value}${check.unit || ""} | ${check.target}${check.unit || ""} | ${check.ok ? "OK" : "OPEN"} |`),
    "",
    "## Pipeline",
    "",
    `- Qualified leads: ${actuals.qualifiedLeads || 0}/${targets.qualifiedLeads || 20}`,
    `- Demo calls: ${actuals.demoCalls || 0}/${targets.demoCalls || 10}`,
    `- Paying customers: ${actuals.payingCustomers || 0}/${targets.payingCustomers || 3}`,
    `- Estimated seats: ${actuals.estimatedSeats || 0}`,
    `- Active partners: ${actuals.activePartners || 0}`,
    `- Partner leads: ${actuals.partnerLeads || 0}`,
    "",
    "## Stage Breakdown",
    "",
    "| Stage | Count |",
    "| --- | --- |",
    ...(summary.byStage || []).map(row => `| ${row.stage} | ${row.count} |`),
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

if (!["json", "md", "both"].includes(format)) {
  console.error("Ongeldig format. Gebruik json, md of both.");
  process.exit(1);
}

const readiness = salesLaunchReadiness(store, tenantId);
const report = {
  tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan, status: tenant.status },
  ...readiness
};
const defaultPath = path.join("data", "reports", `${safeName(tenantId)}-sales-launch-${safeName(report.generatedAt)}.json`);
const outputPath = argValue("--out", defaultPath);
const fullPath = path.resolve(outputPath);
const outputBase = fullPath.replace(/\.(json|md)$/i, "");
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
  launchReady: report.ok,
  openChecks: report.openChecks.length,
  score: report.score
}, null, 2));
