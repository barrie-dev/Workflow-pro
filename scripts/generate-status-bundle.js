const fs = require("fs");
const path = require("path");
const { Store } = require("../src/lib/store");
const { decisionReport } = require("../src/modules/pilot");
const { salesLaunchReadiness } = require("../src/modules/sales");
const { goLiveReadiness } = require("../src/modules/go-live");
const { generateStatusBundle } = require("../src/modules/reports");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

function fileInfo(file, type) {
  const stat = fs.statSync(file);
  return {
    type,
    path: file,
    format: path.extname(file).replace(".", ""),
    size: stat.size,
    updatedAt: stat.mtime.toISOString()
  };
}

function pilotMarkdown(report) {
  return [
    `# Pilot Decision Report - ${report.tenant.name}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Decision: ${report.goNoGo.decision}`,
    `Pilot score: ${report.pilot.score}%`,
    "",
    "## Next Actions",
    "",
    ...(report.goNoGo.actions.length ? report.goNoGo.actions.map(row => `- ${row.label}: ${row.action}`) : ["- Geen open pilot acties."]),
    ""
  ].join("\n");
}

function salesMarkdown(report) {
  return [
    `# Commercial Launch Report - ${report.tenant.name}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Launch ready: ${report.ok ? "yes" : "no"}`,
    `Launch score: ${report.score}%`,
    "",
    "## Open Actions",
    "",
    ...(report.openChecks.length ? report.openChecks.map(row => `- ${row.label}: ${row.action}`) : ["- Geen open sales acties."]),
    ""
  ].join("\n");
}

function goLiveMarkdown(report) {
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
    ...(report.gates.production.openP0.length ? report.gates.production.openP0.map(row => `- ${row.label}: ${row.detail}`) : ["- Geen P0 blockers."]),
    "",
    "## Pilot Actions",
    "",
    ...(report.gates.pilot.openKpis.length ? report.gates.pilot.openKpis.map(row => `- ${row.label}: ${row.action}`) : ["- Geen open pilot acties."]),
    "",
    "## Sales Actions",
    "",
    ...(report.gates.sales.openChecks.length ? report.gates.sales.openChecks.map(row => `- ${row.label}: ${row.action}`) : ["- Geen open sales acties."]),
    ""
  ].join("\n");
}

function roadmapMarkdown(report) {
  return [
    "# WorkFlow Pro Roadmap Checklist",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Tenant: ${report.tenant.name} (${report.tenant.id})`,
    "",
    "## Gate Summary",
    "",
    `- Production readiness: ${report.gates.production.score}% (${report.gates.production.p0} P0, ${report.gates.production.p1} P1 open)`,
    `- Pilot readiness: ${report.gates.pilot.score}% (${report.gates.pilot.openCount} KPI's open)`,
    `- Commercial launch readiness: ${report.gates.sales.score}% (${report.gates.sales.openCount} checks open)`,
    "",
    "## Open P0 Blockers",
    "",
    ...(report.gates.production.openP0.length ? report.gates.production.openP0.map(row => `- [ ] ${row.label}: ${row.detail}`) : ["- [x] Geen P0 blockers."]),
    "",
    "## Pilot Actions",
    "",
    ...(report.gates.pilot.openKpis.length ? report.gates.pilot.openKpis.map(row => `- [ ] ${row.label}: ${row.action}`) : ["- [x] Geen open pilot acties."]),
    "",
    "## Sales Actions",
    "",
    ...(report.gates.sales.openChecks.length ? report.gates.sales.openChecks.map(row => `- [ ] ${row.label}: ${row.action}`) : ["- [x] Geen open sales acties."]),
    ""
  ].join("\n");
}

function reportIndex(reportsDir) {
  const rows = fs.readdirSync(reportsDir)
    .filter(name => [".json", ".md"].includes(path.extname(name)))
    .sort()
    .map(name => {
      const stat = fs.statSync(path.join(reportsDir, name));
      return `| ${name.includes("go-live") ? "Go-live" : name.includes("sales") ? "Commercial launch" : "Pilot"} | ${name} | ${path.extname(name).slice(1)} | ${stat.mtime.toISOString()} | ${stat.size} |`;
    });
  return ["# WorkFlow Pro Report Index", "", `Generated: ${new Date().toISOString()}`, "", "| Type | File | Format | Updated | Size |", "| --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
}

const tenantId = argValue("--tenant", "t_demo");
const minPilotScore = Number(argValue("--min-pilot-score", "80"));
const strictProduction = process.argv.includes("--strict-production");
const store = new Store();
const tenant = store.data.tenants.find(row => row.id === tenantId);
if (!tenant) {
  console.error(`Tenant niet gevonden: ${tenantId}`);
  process.exit(1);
}

const bundle = generateStatusBundle(store, tenant, { email: "status-bundle@workflowpro.be" }, { minPilotScore, strictProduction });

console.log(JSON.stringify({
  ok: true,
  tenantId,
  generated: ["pilot", "sales", "go-live", "roadmap", "report-index"],
  goLiveReady: bundle.manifest.goLiveReady,
  manifest: path.join("data", "reports", `${tenantId}-status-bundle-manifest.json`),
  files: bundle.files.length
}, null, 2));
