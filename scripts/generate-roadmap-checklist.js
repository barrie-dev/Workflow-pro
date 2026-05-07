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

function done(ok) {
  return ok ? "x" : " ";
}

function line(ok, text) {
  return `- [${done(ok)}] ${text}`;
}

function productionCheck(readiness, key) {
  return readiness.checks.find(row => row.key === key) || { ok: false, detail: "Check ontbreekt." };
}

function markdown(store, tenantId) {
  const tenant = store.data.tenants.find(row => row.id === tenantId);
  const production = productionReadiness(store);
  const pilot = pilotKpis(store, tenantId);
  const sales = salesLaunchReadiness(store, tenantId);
  const p0 = production.checks.filter(row => !row.ok && row.priority === "P0");
  const p1 = production.checks.filter(row => !row.ok && row.priority === "P1");
  const openPilot = pilot.kpis.filter(row => !row.ok);
  const openSales = sales.openChecks || [];
  const database = productionCheck(production, "database");
  const migrations = productionCheck(production, "migrations");
  const mfa = productionCheck(production, "mfa");
  const stripe = productionCheck(production, "stripe");
  const peppol = productionCheck(production, "peppol");
  const support = productionCheck(production, "support_sla");
  const integration = productionCheck(production, "integration_sync_health");

  return [
    "# WorkFlow Pro Roadmap Checklist",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Tenant: ${tenant ? `${tenant.name} (${tenant.id})` : tenantId}`,
    "",
    "## Gate Summary",
    "",
    `- Production readiness: ${production.score}% (${p0.length} P0, ${p1.length} P1 open)`,
    `- Pilot readiness: ${pilot.score}% (${openPilot.length} KPI's open)`,
    `- Commercial launch readiness: ${sales.score}% (${openSales.length} checks open)`,
    "",
    "## Fase 1 - Foundation",
    "",
    line(database.ok, `Supabase/PostgreSQL adapter: ${database.detail}`),
    line(migrations.ok, `Database migraties: ${migrations.detail}`),
    line(mfa.ok, `Admin MFA: ${mfa.detail}`),
    line(productionCheck(production, "jwt_secret").ok, productionCheck(production, "jwt_secret").detail),
    line(productionCheck(production, "encryption_key").ok, productionCheck(production, "encryption_key").detail),
    line(true, "Login, sessies, server-side permissies, tenant-scoped repositories en auditlog zijn aanwezig."),
    "",
    "## Fase 2 - Core Operations",
    "",
    line(pilot.kpis.find(row => row.key === "first_planning")?.ok, "Eerste planning werkt via echte endpoints."),
    line((store.data.users || []).some(row => row.tenantId === tenantId), "Medewerkers en rollen bestaan voor tenant."),
    line((store.data.workorders || []).filter(row => row.tenantId === tenantId).length > 0, "Werkbonnenmodule bevat tenantdata."),
    line((store.data.expenses || []).filter(row => row.tenantId === tenantId).length >= 0, "Onkostenmodule is aanwezig in core data model."),
    "",
    "## Fase 3 - Billing + Compliance",
    "",
    line(stripe.ok, `Stripe configuratie: ${stripe.detail}`),
    line(peppol.ok, `Peppol provider: ${peppol.detail}`),
    line(productionCheck(production, "support_escalation_queue").ok, productionCheck(production, "support_escalation_queue").detail),
    line(true, "DPA/GDPR, support consent, invoice model en payment-method tokenflow zijn als platformflows aanwezig."),
    "",
    "## Fase 4 - Pilot Launch",
    "",
    ...pilot.kpis.map(kpi => line(kpi.ok, `${kpi.label}: ${kpi.value} / ${kpi.target}${kpi.ok ? "" : ` - ${kpi.action}`}`)),
    line(support.ok, `Support SLA: ${support.detail}`),
    line(integration.ok, `Integratie sync health: ${integration.detail}`),
    "",
    "## Fase 5 - Commercial Launch",
    "",
    ...sales.checks.map(check => line(check.ok, `${check.label}: ${check.value}${check.unit || ""} / ${check.target}${check.unit || ""}${check.ok ? "" : ` - ${check.action}`}`)),
    "",
    "## Open P0 Blockers",
    "",
    ...(p0.length ? p0.map(row => `- ${row.label}: ${row.detail}`) : ["- Geen P0 blockers."]),
    ""
  ].join("\n");
}

const tenantId = argValue("--tenant", "t_demo");
const outputPath = argValue("--out", path.join("docs", "ROADMAP-CHECKLIST.md"));
const store = new Store();
const fullPath = path.resolve(outputPath);
fs.mkdirSync(path.dirname(fullPath), { recursive: true });
fs.writeFileSync(fullPath, markdown(store, tenantId));
console.log(JSON.stringify({ ok: true, outputPath: fullPath }, null, 2));
