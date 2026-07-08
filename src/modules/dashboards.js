"use strict";
/**
 * Configureerbare dashboards (per gebruiker + door admin gepubliceerd).
 *
 * - Elke widget heeft een data-bron + een vereist recht en module. Een gebruiker
 *   ziet/voegt enkel widgets toe waar hij recht op heeft (rechten-gating).
 * - `scope:"own"`  → persoonlijke widget (eigen data); recht via own:X of X.
 *   `scope:"tenant"`→ organisatie-brede widget; vereist het VOLLEDIGE recht X
 *   (niet enkel own:), zodat een medewerker geen org-totalen ziet.
 * - Persoonlijke config leeft op user.dashboardConfig; de admin publiceert een
 *   org-dashboard op tenant.publishedDashboard (voor iedereen, niet aanpasbaar).
 */
const { isModuleEnabled } = require("./entitlements");

// Heeft de gebruiker het VOLLEDIGE recht (niet enkel de eigen-data variant)?
function hasFull(user, perm) {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  const p = user.permissions || [];
  return p.includes("*") || p.includes(perm);
}
function hasAny(user, perm) {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  const p = user.permissions || [];
  return p.includes("*") || p.includes(perm) || p.includes(`own:${perm}`);
}

const OPEN_WO = w => !["Voltooid", "Afgewerkt", "done", "geannuleerd"].includes(w.status);
const today = () => new Date().toISOString().slice(0, 10);
const monthPrefix = () => new Date().toISOString().slice(0, 7);

// ── Widget-catalogus ─────────────────────────────────────────
// type: "kpi" (value + sub) of "list" (rows). module: entitlement-gate.
const WIDGETS = [
  // Persoonlijk (eigen data)
  { key: "my_open_workorders", label: "Mijn open opdrachten", type: "kpi", group: "Persoonlijk", scope: "own", module: "workorders", perm: "workorders",
    compute: (s, t, u) => ({ value: s.list("workorders", t.id).filter(w => w.userId === u.id && OPEN_WO(w)).length, sub: "toegewezen aan mij" }) },
  { key: "my_pending_leaves", label: "Mijn verlofaanvragen", type: "kpi", group: "Persoonlijk", scope: "own", module: "leaves", perm: "leaves",
    compute: (s, t, u) => ({ value: s.list("leaves", t.id).filter(l => l.userId === u.id && l.status === "aangevraagd").length, sub: "in behandeling" }) },
  { key: "my_pending_expenses", label: "Mijn onkosten", type: "kpi", group: "Persoonlijk", scope: "own", module: "expenses", perm: "expenses",
    compute: (s, t, u) => ({ value: s.list("expenses", t.id).filter(e => e.userId === u.id && ["pending", "ingediend"].includes(e.status)).length, sub: "ingediend" }) },
  { key: "my_hours_week", label: "Mijn uren deze week", type: "kpi", group: "Persoonlijk", scope: "own", module: "clockings", perm: "clockings",
    compute: (s, t, u) => {
      const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
      const mins = s.list("clocks", t.id).filter(c => c.userId === u.id && c.status === "out" && (c.date || "") >= since)
        .reduce((m, c) => m + (Number(c.minutes) || 0), 0);
      return { value: `${Math.round(mins / 60)}u`, sub: "laatste 7 dagen" };
    } },

  // Organisatie-breed (vereist volledig recht)
  { key: "team_size", label: "Teamgrootte", type: "kpi", group: "Team", scope: "tenant", module: "employees", perm: "employees",
    compute: (s, t) => ({ value: s.list("users", t.id).filter(u => u.active !== false && !["tenant_admin", "super_admin"].includes(u.role)).length, sub: "actieve medewerkers" }) },
  { key: "clocked_in_now", label: "Nu ingeklokt", type: "kpi", group: "Team", scope: "tenant", module: "clockings", perm: "clockings",
    compute: (s, t) => ({ value: s.list("clocks", t.id).filter(c => c.status === "in").length, sub: "aan het werk" }) },
  { key: "open_workorders", label: "Open opdrachten (team)", type: "kpi", group: "Operaties", scope: "tenant", module: "workorders", perm: "workorders",
    compute: (s, t) => ({ value: s.list("workorders", t.id).filter(OPEN_WO).length, sub: "niet afgewerkt" }) },
  { key: "pending_leaves", label: "Verlofaanvragen", type: "kpi", group: "Team", scope: "tenant", module: "leaves", perm: "leaves",
    compute: (s, t) => ({ value: s.list("leaves", t.id).filter(l => l.status === "aangevraagd").length, sub: "te beoordelen" }) },
  { key: "pending_expenses", label: "Onkosten te keuren", type: "kpi", group: "Team", scope: "tenant", module: "expenses", perm: "expenses",
    compute: (s, t) => ({ value: s.list("expenses", t.id).filter(e => ["pending", "ingediend"].includes(e.status)).length, sub: "in behandeling" }) },
  { key: "open_invoices", label: "Openstaande facturen", type: "kpi", group: "Financieel", scope: "tenant", module: "invoices", perm: "billing",
    compute: (s, t) => {
      const open = s.list("invoices", t.id).filter(i => ["open", "overdue", "verzonden"].includes(i.status));
      return { value: open.length, sub: `€${open.reduce((a, i) => a + (Number(i.total) || 0), 0).toFixed(0)} totaal` };
    } },
  { key: "revenue_month", label: "Omzet deze maand", type: "kpi", group: "Financieel", scope: "tenant", module: "invoices", perm: "billing",
    compute: (s, t) => {
      const paid = s.list("invoices", t.id).filter(i => i.status === "paid" && (i.paidAt || i.invoiceDate || "").startsWith(monthPrefix()));
      return { value: `€${paid.reduce((a, i) => a + (Number(i.total) || 0), 0).toFixed(0)}`, sub: `${paid.length} betaalde facturen` };
    } },
  { key: "open_quotes", label: "Openstaande offertes", type: "kpi", group: "Financieel", scope: "tenant", module: "offertes", perm: "billing",
    compute: (s, t) => ({ value: s.list("quotes", t.id).filter(q => q.status === "verzonden").length, sub: "verzonden, niet aanvaard" }) },
  { key: "customers_count", label: "Klanten", type: "kpi", group: "Operaties", scope: "tenant", module: "customers", perm: "customers",
    compute: (s, t) => ({ value: s.list("customers", t.id).length, sub: "totaal" }) },
];

const WIDGET_MAP = Object.fromEntries(WIDGETS.map(w => [w.key, w]));

// Mag deze gebruiker deze widget zien? (recht + module-entitlement)
function allowed(store, tenant, user, w) {
  if (!w) return false;
  if (!isModuleEnabled(store, tenant, w.module)) return false;
  return w.scope === "own" ? hasAny(user, w.perm) : hasFull(user, w.perm);
}

// Catalogus van widgets die deze gebruiker mag toevoegen.
function availableWidgets(store, tenant, user) {
  return WIDGETS.filter(w => allowed(store, tenant, user, w))
    .map(w => ({ key: w.key, label: w.label, type: w.type, group: w.group, scope: w.scope }));
}

// Bereken de data voor een lijst widget-keys (stilletjes weggefilterd wat niet mag).
function renderWidgets(store, tenant, user, keys) {
  return (Array.isArray(keys) ? keys : [])
    .map(k => WIDGET_MAP[k])
    .filter(w => allowed(store, tenant, user, w))
    .map(w => {
      let data; try { data = w.compute(store, tenant, user); } catch (_) { data = { value: "-", sub: "" }; }
      return { key: w.key, label: w.label, type: w.type, group: w.group, ...data };
    });
}

// Houd enkel geldige + toegestane keys over (sanitatie bij opslaan).
function sanitizeKeys(store, tenant, user, keys) {
  const seen = new Set();
  return (Array.isArray(keys) ? keys : [])
    .filter(k => WIDGET_MAP[k] && allowed(store, tenant, user, k && WIDGET_MAP[k]) && !seen.has(k) && seen.add(k))
    .slice(0, 24);
}

module.exports = { WIDGETS, availableWidgets, renderWidgets, sanitizeKeys, allowed, hasFull, hasAny };
