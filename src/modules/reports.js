const fs = require("fs");
const path = require("path");
const { decisionReport } = require("./pilot");
const { salesLaunchReadiness } = require("./sales");
const { goLiveReadiness } = require("./go-live");

const REPORTS_DIR = path.resolve("data", "reports");

function reportKind(name) {
  if (name.includes("status-bundle-manifest")) return "Status bundle";
  if (name.includes("go-live")) return "Go-live";
  if (name.includes("sales-launch")) return "Commercial launch";
  if (name.includes("latest")) return "Pilot";
  return "Other";
}

function reportTitle(name) {
  return name
    .replace(/\.(json|md)$/i, "")
    .replace(/-/g, " ")
    .replace(/\bt demo\b/i, "t_demo")
    .replace(/\b\w/g, char => char.toUpperCase());
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
    format: path.extname(file).slice(1),
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
    `# Monargo One Go-Live Report - ${report.tenant.name}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Overall: ${report.ok ? "OK" : "OPEN"}`,
    "",
    "## Gate Scores",
    "",
    `- Production: ${report.gates.production.score}% (P0 ${report.gates.production.p0}, P1 ${report.gates.production.p1})`,
    `- Pilot: ${report.gates.pilot.score}% (${report.gates.pilot.openCount} open KPI's)`,
    `- Sales: ${report.gates.sales.score}% (${report.gates.sales.openCount} open checks)`,
    `- Customer start: ${report.gates.customerStart.ok ? "OK" : "OPEN"} (${report.gates.customerStart.label})`,
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
    "",
    "## Customer Start",
    "",
    ...(report.gates.customerStart.blockers.length ? report.gates.customerStart.blockers.map(row => `- ${row}`) : ["- Dagelijkse klantflow klaar."]),
    ""
  ].join("\n");
}

function roadmapMarkdown(report) {
  return [
    "# Monargo One Roadmap Checklist",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Tenant: ${report.tenant.name} (${report.tenant.id})`,
    "",
    "## Gate Summary",
    "",
    `- Production readiness: ${report.gates.production.score}% (${report.gates.production.p0} P0, ${report.gates.production.p1} P1 open)`,
    `- Pilot readiness: ${report.gates.pilot.score}% (${report.gates.pilot.openCount} KPI's open)`,
    `- Commercial launch readiness: ${report.gates.sales.score}% (${report.gates.sales.openCount} checks open)`,
    `- Customer start readiness: ${report.gates.customerStart.ok ? "OK" : "OPEN"} (${report.gates.customerStart.label})`,
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
    "",
    "## Customer Start Actions",
    "",
    ...(report.gates.customerStart.blockers.length ? report.gates.customerStart.blockers.map(row => `- [ ] ${row}`) : ["- [x] Dagelijkse klantflow klaar."]),
    ""
  ].join("\n");
}

function reportIndex(reportsDir) {
  const rows = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir)
    .filter(name => [".json", ".md"].includes(path.extname(name)))
    .sort()
    .map(name => {
      const stat = fs.statSync(path.join(reportsDir, name));
      return `| ${reportKind(name)} | ${name} | ${path.extname(name).slice(1)} | ${stat.mtime.toISOString()} | ${stat.size} |`;
    }) : [];
  return ["# Monargo One Report Index", "", `Generated: ${new Date().toISOString()}`, "", "| Type | File | Format | Updated | Size |", "| --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
}

function listReports(tenantId, options = {}) {
  const limit = Number(options.limit || 20);
  if (!fs.existsSync(REPORTS_DIR)) {
    return { directory: REPORTS_DIR, rows: [], summary: { total: 0, latestAt: null } };
  }

  const rows = fs.readdirSync(REPORTS_DIR)
    .filter(name => name.startsWith(`${tenantId}-`))
    .filter(name => [".json", ".md"].includes(path.extname(name)))
    .map(name => {
      const fullPath = path.join(REPORTS_DIR, name);
      const stat = fs.statSync(fullPath);
      return {
        id: name,
        tenantId,
        title: reportTitle(name),
        kind: reportKind(name),
        format: path.extname(name).slice(1),
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);

  return {
    directory: REPORTS_DIR,
    rows,
    summary: {
      total: rows.length,
      latestAt: rows[0]?.updatedAt || null,
      kinds: rows.reduce((acc, row) => ({ ...acc, [row.kind]: (acc[row.kind] || 0) + 1 }), {})
    }
  };
}

function assertSafeReportId(tenantId, reportId) {
  const decoded = decodeURIComponent(String(reportId || ""));
  const allowed = new RegExp(`^${tenantId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-[a-z0-9-]+\\.(json|md)$`, "i");
  if (!allowed.test(decoded)) {
    const error = new Error("Report not found");
    error.status = 404;
    throw error;
  }
  return decoded;
}

function getReport(tenantId, reportId) {
  const safeId = assertSafeReportId(tenantId, reportId);
  const fullPath = path.join(REPORTS_DIR, safeId);
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(`${REPORTS_DIR}${path.sep}`) || !fs.existsSync(resolved)) {
    const error = new Error("Report not found");
    error.status = 404;
    throw error;
  }

  const stat = fs.statSync(resolved);
  if (stat.size > 250 * 1024) {
    const error = new Error("Report is te groot voor inline preview");
    error.status = 413;
    throw error;
  }

  const content = fs.readFileSync(resolved, "utf8");
  return {
    id: safeId,
    tenantId,
    title: reportTitle(safeId),
    kind: reportKind(safeId),
    format: path.extname(safeId).slice(1),
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    content
  };
}

function generateStatusBundle(store, tenant, user, options = {}) {
  const tenantId = tenant.id;
  const minPilotScore = Number(options.minPilotScore || 80);
  const strictProduction = !!options.strictProduction;
  const pilot = decisionReport(store, tenant, user || { email: "status-bundle@workflowpro.be" });
  const sales = { tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan, status: tenant.status }, ...salesLaunchReadiness(store, tenantId) };
  const goLive = goLiveReadiness(store, tenant, { minPilotScore, strictProduction });
  const generatedFiles = [];

  generatedFiles.push(fileInfo(writeJson(path.join(REPORTS_DIR, `${tenantId}-latest.json`), pilot), "pilot"));
  generatedFiles.push(fileInfo(writeText(path.join(REPORTS_DIR, `${tenantId}-latest.md`), pilotMarkdown(pilot)), "pilot"));
  generatedFiles.push(fileInfo(writeJson(path.join(REPORTS_DIR, `${tenantId}-sales-launch-latest.json`), sales), "sales"));
  generatedFiles.push(fileInfo(writeText(path.join(REPORTS_DIR, `${tenantId}-sales-launch-latest.md`), salesMarkdown(sales)), "sales"));
  generatedFiles.push(fileInfo(writeJson(path.join(REPORTS_DIR, `${tenantId}-go-live-latest.json`), goLive), "go-live"));
  generatedFiles.push(fileInfo(writeText(path.join(REPORTS_DIR, `${tenantId}-go-live-latest.md`), goLiveMarkdown(goLive)), "go-live"));
  generatedFiles.push(fileInfo(writeText(path.join("docs", "ROADMAP-CHECKLIST.md"), roadmapMarkdown(goLive)), "roadmap"));
  generatedFiles.push(fileInfo(writeText(path.join("docs", "REPORT-INDEX.md"), reportIndex(REPORTS_DIR)), "report-index"));

  const manifest = {
    ok: true,
    tenantId,
    generatedAt: new Date().toISOString(),
    generatedBy: user?.email || "system",
    goLiveReady: goLive.ok,
    gates: {
      production: { score: goLive.gates.production.score, p0: goLive.gates.production.p0, p1: goLive.gates.production.p1 },
      pilot: { score: goLive.gates.pilot.score, openCount: goLive.gates.pilot.openCount },
      sales: { score: goLive.gates.sales.score, openCount: goLive.gates.sales.openCount },
      customerStart: { ok: goLive.gates.customerStart.ok, blockers: goLive.gates.customerStart.blockers.length }
    },
    files: generatedFiles
  };
  generatedFiles.push(fileInfo(writeJson(path.join(REPORTS_DIR, `${tenantId}-status-bundle-manifest.json`), manifest), "manifest"));

  store.audit({
    actor: user?.email || "system",
    tenantId,
    action: "status_bundle_generated",
    area: "reports",
    detail: `${generatedFiles.length} files, go-live ${goLive.ok ? "ready" : "open"}`
  });

  return { manifest, files: generatedFiles, reports: listReports(tenantId) };
}

module.exports = { listReports, getReport, generateStatusBundle };
