"use strict";
/**
 * Mona Signals (master-spec h48, E21).
 *
 * Detecteert facturatie-lekkage, planningsconflicten, margerisico, achterstallige
 * compliance en anomalieën. Read-model bovenop de bestaande data en de eerder
 * gebouwde read-models (projectfinance, compliance, planning); respecteert de
 * rechten en het pakket van de gebruiker (Mona krijgt nooit meer rechten dan de
 * gebruiker · h48). Elk signaal labelt zijn aard en verwijst naar het scherm.
 *
 * Geen vendor/SQL (ADR-001). De detectoren draaien alleen voor modules die in
 * het pakket zitten én die de gebruiker mag zien.
 */

const { can } = require("../lib/auth");
const { isModuleEnabled } = require("../modules/entitlements");
const { buildComplianceOverview } = require("./compliance");
const { buildProjectFinance } = require("./project-finance");
const { listPlanningItems } = require("./planning");

const SEVERITY = { critical: 3, warning: 2, info: 1 };

function money(n) { return `€${Number(n || 0).toFixed(2)}`; }

/**
 * @returns {{ generatedAt, signals: [{ type, severity, title, detail, targetView, refId, module }], counts }}
 */
function buildMonaSignals(store, tenant, user, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const signals = [];
  const canSee = perm => can(user, perm);
  const mod = key => isModuleEnabled(store, tenant, key);

  // ── Facturatie-lekkage ─────────────────────────────────────────────────────
  // 1) Afgewerkte werkbonnen met factureerbare inhoud maar zonder factuur.
  if (canSee("workorders") && mod("workorders") && (canSee("invoicing") || canSee("billing"))) {
    const doneStatuses = ["voltooid", "afgewerkt", "done", "completed"];
    for (const wo of store.list("workorders", tenant.id)) {
      if (!doneStatuses.includes(String(wo.status || "").toLowerCase())) continue;
      if (wo.invoiceId || wo.invoicedAt) continue;
      const billable = Number(wo.billableAmount ?? wo.fixedPrice ?? 0) > 0
        || Number(wo.billableHours ?? wo.clockedHours ?? wo.hours ?? 0) > 0;
      if (!billable) continue;
      signals.push({ type: "invoice_leakage", severity: "warning", title: `Afgewerkte werkbon nog niet gefactureerd`, detail: `${wo.number || wo.id} · ${wo.title || ""}`.trim(), targetView: "workorders", refId: wo.id, module: "workorders" });
      if (signals.filter(s => s.type === "invoice_leakage").length >= 15) break;
    }
    // 2) Aanvaarde offertes zonder conversie naar factuur of werkbon.
    for (const q of store.list("quotes", tenant.id)) {
      if (String(q.status) !== "aanvaard") continue;
      if (q.invoiceId || q.workorderId) continue;
      signals.push({ type: "invoice_leakage", severity: "info", title: "Aanvaarde offerte nog niet omgezet", detail: `${q.number} · ${money(q.total)}`, targetView: "offertes", refId: q.id, module: "offertes" });
    }
  }

  // ── Vervallen facturen (anomalie/cashflow) ─────────────────────────────────
  if (canSee("invoicing") || canSee("billing")) {
    for (const inv of store.list("invoices", tenant.id)) {
      if (inv.docType === "credit_note") continue;
      if (["paid", "gecrediteerd", "cancelled"].includes(inv.status)) continue;
      if (inv.dueDate && inv.dueDate < today) {
        signals.push({ type: "overdue_invoice", severity: "critical", title: "Factuur vervallen", detail: `${inv.number} · ${money(inv.total)} · verviel ${inv.dueDate}`, targetView: "facturen", refId: inv.id, module: "invoices" });
      }
    }
  }

  // ── Planningsconflicten ────────────────────────────────────────────────────
  if (canSee("planning") && mod("planning")) {
    const items = listPlanningItems(store, tenant.id, { from: today });
    const byResourceDay = new Map();
    for (const it of items) {
      for (const rid of it.resourceIds) {
        const key = `${rid}@${it.date}`;
        (byResourceDay.get(key) || byResourceDay.set(key, []).get(key)).push(it);
      }
    }
    let conflicts = 0;
    for (const [key, list] of byResourceDay) {
      const sorted = list.slice().sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
      for (let i = 1; i < sorted.length; i++) {
        if (String(sorted[i].start || "") < String(sorted[i - 1].end || "24:00")) {
          signals.push({ type: "planning_conflict", severity: "warning", title: "Overlappende planning", detail: `${key.split("@")[1]} · ${sorted[i - 1].start}-${sorted[i - 1].end} vs ${sorted[i].start}-${sorted[i].end}`, targetView: "planning", refId: sorted[i].id, module: "planning" });
          if (++conflicts >= 10) break;
        }
      }
      if (conflicts >= 10) break;
    }
  }

  // ── Margerisico per project ────────────────────────────────────────────────
  if (canSee("projects") && mod("projects") && ["tenant_admin", "super_admin"].includes(user.role)) {
    for (const p of store.list("projects", tenant.id)) {
      if (["closed", "cancelled"].includes(p.status)) continue;
      const fin = buildProjectFinance(store, tenant, p);
      const budget = Number(p.budgetAmount || 0);
      if (budget > 0 && fin.forecastCost > budget) {
        signals.push({ type: "margin_risk", severity: "critical", title: "Projectbudget overschreden (forecast)", detail: `${p.number} · kost+verplichting ${money(fin.forecastCost)} > budget ${money(budget)}`, targetView: "projects", refId: p.id, module: "projects" });
      } else if (budget > 0 && fin.forecastCost > budget * 0.9) {
        signals.push({ type: "margin_risk", severity: "warning", title: "Projectbudget bijna bereikt", detail: `${p.number} · ${Math.round(fin.forecastCost / budget * 100)}% van budget verbruikt (incl. verplichtingen)`, targetView: "projects", refId: p.id, module: "projects" });
      }
      if (signals.filter(s => s.type === "margin_risk").length >= 10) break;
    }
  }

  // ── Achterstallige compliance ──────────────────────────────────────────────
  if (canSee("construction") && mod("construction")) {
    const overview = buildComplianceOverview(store, tenant, now);
    for (const cat of overview.categories) {
      for (const item of cat.attention) {
        if (["expired", "overdue"].includes(item.status)) {
          signals.push({ type: "compliance_overdue", severity: "critical", title: `Compliance vervallen (${cat.key})`, detail: item.label, targetView: "worksites", refId: item.id, module: "construction" });
        } else if (item.status === "expiring") {
          signals.push({ type: "compliance_overdue", severity: "warning", title: `Compliance verloopt binnenkort (${cat.key})`, detail: item.label, targetView: "worksites", refId: item.id, module: "construction" });
        }
      }
    }
  }

  // ── Lage voorraad (anomalie) ───────────────────────────────────────────────
  if (canSee("stock") && mod("stock")) {
    for (const item of store.list("stock", tenant.id)) {
      const qty = Number(item.quantity ?? 0), min = Number(item.minQuantity ?? 0);
      if (min > 0 && qty <= min) {
        signals.push({ type: "low_stock", severity: "info", title: "Lage voorraad", detail: `${item.name} · ${qty}/${min}${item.unit ? " " + item.unit : ""}`, targetView: "stock", refId: item.id, module: "stock" });
        if (signals.filter(s => s.type === "low_stock").length >= 10) break;
      }
    }
  }

  signals.sort((a, b) => (SEVERITY[b.severity] || 0) - (SEVERITY[a.severity] || 0));
  const counts = signals.reduce((acc, s) => { acc[s.severity] = (acc[s.severity] || 0) + 1; acc.total++; return acc; }, { total: 0, critical: 0, warning: 0, info: 0 });
  return { generatedAt: now.toISOString(), signals: signals.slice(0, 60), counts };
}

module.exports = { buildMonaSignals };
