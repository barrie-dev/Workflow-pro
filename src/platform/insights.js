"use strict";
/**
 * Insights read-models (master-spec h40/E22, BI).
 *
 * Rol-dashboards en managementcijfers waarbij ELKE KPI herleidbaar is tot
 * bronrecords en formule (ontwikkelprincipe + h40-acceptatie). Drill-down
 * respecteert recordrechten; financiële KPI's zijn voorbehouden aan beheerders.
 *
 * Read-model bovenop bestaande data en eerdere read-models (projectfinance,
 * mona-signals). Operationele cijfers mogen eventual consistency hebben;
 * financiële cijfers dragen een expliciete bron. Geen vendor/SQL (ADR-001).
 */

const { can } = require("../lib/auth");
const { isModuleEnabled } = require("../modules/entitlements");
const { buildProjectFinance } = require("./project-finance");
const { buildMonaSignals } = require("./mona-signals");
const { round2 } = require("../modules/be-locale");

function kpi(o) {
  // Elke KPI draagt formule + bron zodat ze herleidbaar en verklaarbaar is.
  return { key: o.key, label: o.label, value: o.value, unit: o.unit || null, formula: o.formula, source: o.source, group: o.group || "algemeen", drilldown: o.drilldown || null };
}

function buildInsights(store, tenant, user, now = new Date()) {
  const tenantId = tenant.id;
  const today = now.toISOString().slice(0, 10);
  const kpis = [];
  const canSee = perm => can(user, perm);
  const mod = key => isModuleEnabled(store, tenant, key);
  const isAdmin = ["tenant_admin", "super_admin"].includes(user.role);

  // ── Commercieel / financieel (beheerders) ──────────────────────────────────
  if (isAdmin && (canSee("invoicing") || canSee("billing"))) {
    const invoices = (store.list("invoices", tenantId) || []).filter(i => i.docType !== "external_snapshot");
    const open = invoices.filter(i => !["paid", "gecrediteerd", "cancelled"].includes(i.status));
    const openAmount = round2(open.reduce((s, i) => s + Number(i.total || 0), 0));
    const overdue = open.filter(i => i.dueDate && i.dueDate < today);
    const overdueAmount = round2(overdue.reduce((s, i) => s + Number(i.total || 0), 0));
    kpis.push(kpi({ key: "open_invoices_amount", label: "Openstaand factuurbedrag", value: openAmount, unit: "EUR", group: "financieel",
      formula: "Σ total van facturen met status ≠ paid/gecrediteerd/cancelled", source: { collection: "invoices", count: open.length },
      drilldown: open.slice(0, 50).map(i => ({ id: i.id, number: i.number, amount: i.total, status: i.status, dueDate: i.dueDate })) }));
    kpis.push(kpi({ key: "overdue_invoices_amount", label: "Vervallen factuurbedrag", value: overdueAmount, unit: "EUR", group: "financieel",
      formula: "Σ total van openstaande facturen met vervaldatum < vandaag", source: { collection: "invoices", count: overdue.length },
      drilldown: overdue.slice(0, 50).map(i => ({ id: i.id, number: i.number, amount: i.total, dueDate: i.dueDate })) }));
    const paidThisYear = invoices.filter(i => i.status === "paid" && String(i.invoiceDate || "").startsWith(String(now.getFullYear())));
    kpis.push(kpi({ key: "revenue_ytd", label: "Omzet (betaald, dit jaar)", value: round2(paidThisYear.reduce((s, i) => s + Number(i.subtotal ?? i.total ?? 0), 0)), unit: "EUR", group: "financieel",
      formula: "Σ subtotaal (excl. btw) van betaalde facturen met factuurdatum in het lopende jaar", source: { collection: "invoices", count: paidThisYear.length } }));
  }

  // ── Sales pipeline ─────────────────────────────────────────────────────────
  if (canSee("invoicing") || canSee("billing")) {
    const quotes = store.list("quotes", tenantId) || [];
    const openQuotes = quotes.filter(q => ["verzonden", "concept"].includes(q.status));
    kpis.push(kpi({ key: "pipeline_open_value", label: "Openstaande offertewaarde", value: round2(openQuotes.reduce((s, q) => s + Number(q.total || 0), 0)), unit: "EUR", group: "commercieel",
      formula: "Σ total van offertes met status concept/verzonden", source: { collection: "quotes", count: openQuotes.length } }));
    const won = quotes.filter(q => q.status === "aanvaard");
    kpis.push(kpi({ key: "quotes_won_value", label: "Gewonnen offertewaarde", value: round2(won.reduce((s, q) => s + Number(q.total || 0), 0)), unit: "EUR", group: "commercieel",
      formula: "Σ total van aanvaarde offertes", source: { collection: "quotes", count: won.length } }));
  }

  // ── Projectmarge (beheerders) ──────────────────────────────────────────────
  const projectMargins = [];
  if (isAdmin && canSee("projects") && mod("projects")) {
    let totalMargin = 0, totalInvoiced = 0, totalCost = 0;
    for (const p of store.list("projects", tenantId) || []) {
      if (["cancelled"].includes(p.status)) continue;
      const fin = buildProjectFinance(store, tenant, p);
      totalMargin = round2(totalMargin + fin.margin);
      totalInvoiced = round2(totalInvoiced + fin.invoiced.total);
      totalCost = round2(totalCost + fin.actual.total);
      projectMargins.push({ projectId: p.id, number: p.number, name: p.name, status: p.status, budget: fin.budget.total, invoiced: fin.invoiced.total, actualCost: fin.actual.total, commitment: fin.commitment.total, margin: fin.margin, forecastCost: fin.forecastCost });
    }
    kpis.push(kpi({ key: "project_margin_total", label: "Projectmarge (totaal)", value: totalMargin, unit: "EUR", group: "projecten",
      formula: "Σ (gefactureerd excl. btw − werkelijke kost) over niet-geannuleerde projecten", source: { collection: "projects", count: projectMargins.length },
      drilldown: projectMargins.slice(0, 50) }));
  }

  // ── Operationeel ───────────────────────────────────────────────────────────
  if (canSee("workorders") && mod("workorders")) {
    const wos = store.list("workorders", tenantId) || [];
    const openWo = wos.filter(w => ["open", "in_progress", "gepland", "planned"].includes(String(w.status || "").toLowerCase()));
    kpis.push(kpi({ key: "open_workorders", label: "Open werkbonnen", value: openWo.length, group: "operationeel",
      formula: "aantal werkbonnen met status open/in_progress/gepland", source: { collection: "workorders", count: openWo.length } }));
  }
  if (canSee("projects") && mod("projects")) {
    const active = (store.list("projects", tenantId) || []).filter(p => p.status === "active");
    kpis.push(kpi({ key: "active_projects", label: "Actieve projecten", value: active.length, group: "operationeel",
      formula: "aantal projecten met status active", source: { collection: "projects", count: active.length } }));
  }
  if (canSee("employees")) {
    const team = (store.list("users", tenantId) || []).filter(u => u.role !== "super_admin" && u.active !== false);
    kpis.push(kpi({ key: "team_size", label: "Teamgrootte", value: team.length, group: "operationeel",
      formula: "aantal actieve gebruikers (excl. super_admin)", source: { collection: "users", count: team.length } }));
  }

  // ── Exception-signaal (uit Mona Signals) ───────────────────────────────────
  const signals = buildMonaSignals(store, tenant, user, now);
  kpis.push(kpi({ key: "open_exceptions", label: "Openstaande aandachtspunten", value: signals.counts.total, group: "signalen",
    formula: "aantal Mona-signalen (facturatie-lekkage, vervallen facturen, planningsconflict, margerisico, compliance, lage voorraad)", source: { readModel: "mona-signals", critical: signals.counts.critical } }));

  return {
    generatedAt: now.toISOString(),
    consistency: "eventual",     // operationele cijfers · financiële dragen bron (h40)
    role: user.role,
    kpis,
    projectMargins: isAdmin ? projectMargins : [],
    exceptions: { total: signals.counts.total, critical: signals.counts.critical },
  };
}

module.exports = { buildInsights };
