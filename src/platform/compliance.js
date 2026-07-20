"use strict";
/**
 * Bouwcompliance-overzicht (master-spec h43.5, E12, R2-c).
 *
 * Het compliance-dashboard toont missing / pending / valid / expiring /
 * expired / rejected items over de bestaande compliance-modules:
 *  - Checkin@Work (CIAW): configuratie-readiness + mislukte aangiftes
 *  - A1/Limosa (posted workers): geldigheid van attesten
 *  - Werkongevallen: open registraties + verzekeraars-deadlines
 *  - Werven: actieve werven als context
 *
 * Pure aggregatie over de store (rechten- en modulegating gebeurt in de
 * route); geen vendor/SQL (ADR-001). Elke categorie telt alleen mee wanneer
 * de bijbehorende module in het pakket zit.
 */

const { a1Status } = require("../modules/posted-workers");
const { incidentDeadline } = require("../modules/incidents");
const { dimonaRegister } = require("../modules/dimona");
const { isModuleEnabled } = require("../modules/entitlements");

const COMPLIANCE_STATES = ["missing", "pending", "valid", "expiring", "expired", "rejected"];

function emptyCounts() {
  return { missing: 0, pending: 0, valid: 0, expiring: 0, expired: 0, rejected: 0 };
}

/**
 * @returns {{ generatedAt, categories: [{ key, enabled, counts, attention: [...] }] , attentionTotal }}
 * attention = concrete items die actie vragen (max 10 per categorie, geen PII-overdaad).
 */
function buildComplianceOverview(store, tenant, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const categories = [];

  // ── A1 / Limosa ────────────────────────────────────────────────────────────
  if (isModuleEnabled(store, tenant, "posted_workers")) {
    const counts = emptyCounts();
    const attention = [];
    for (const rec of store.list("postedWorkers", tenant.id) || []) {
      const st = a1Status(rec, now.getTime());
      const mapped = st === "unknown" ? "pending" : st;
      if (counts[mapped] !== undefined) counts[mapped] += 1;
      if (["missing", "expiring", "expired"].includes(mapped) && attention.length < 10) {
        attention.push({ type: "a1", id: rec.id, label: rec.workerName || rec.subcontractor || rec.id, status: mapped, validTo: rec.validTo || null });
      }
    }
    categories.push({ key: "posted_workers", enabled: true, counts, attention });
  } else {
    categories.push({ key: "posted_workers", enabled: false, counts: emptyCounts(), attention: [] });
  }

  // ── Checkin@Work ───────────────────────────────────────────────────────────
  if (isModuleEnabled(store, tenant, "ciaw")) {
    const counts = emptyCounts();
    const attention = [];
    const configured = !!(tenant.compliance && tenant.compliance.rszEmployerId);
    if (!configured) {
      counts.missing += 1;
      attention.push({ type: "ciaw_config", id: "rsz", label: "RSZ-werkgeversnummer ontbreekt", status: "missing" });
    } else {
      counts.valid += 1;
    }
    // Mislukte aangiftes vragen actie (h43.5: failure breekt clocking niet,
    // maar creëert een exception met retry). Aangiftes leven als clocks[].ciaw.
    const failed = (store.list("clocks", tenant.id) || []).filter(c => c.ciaw && (c.ciaw.status === "failed" || c.ciaw.error));
    for (const c of failed) {
      counts.rejected += 1;
      if (attention.length < 10) attention.push({ type: "ciaw_declaration", id: c.id, label: `Aangifte mislukt (${(c.ciaw && c.ciaw.reference) || c.date || "?"})`, status: "rejected" });
    }
    categories.push({ key: "ciaw", enabled: true, counts, attention });
  } else {
    categories.push({ key: "ciaw", enabled: false, counts: emptyCounts(), attention: [] });
  }

  // ── Dimona (RSZ · verplichte aangifte in/uit dienst) ───────────────────────
  // Geldt voor ELKE werkgever, dus geen module-gate. Hiaten = actieve interne
  // medewerkers zonder (geslaagde) Dimona-IN of uit dienst zonder OUT.
  {
    const counts = emptyCounts();
    const attention = [];
    const { rows, gaps } = dimonaRegister(store, tenant.id, today);
    for (const r of rows) {
      if (r.status === "none") continue;                    // telt via gaps als het moet
      counts[r.status === "accepted" || r.status === "submitted" ? "valid" : (r.status === "failed" || r.status === "rejected" ? "rejected" : "pending")] += 1;
    }
    for (const gap of gaps) {
      counts.missing += 1;
      if (attention.length < 10) attention.push({ type: "dimona", id: gap.employeeId, label: `${gap.name} · ${gap.reason}`, status: "missing" });
    }
    categories.push({ key: "dimona", enabled: true, counts, attention });
  }

  // ── Werkongevallen ─────────────────────────────────────────────────────────
  if (isModuleEnabled(store, tenant, "incidents")) {
    const counts = emptyCounts();
    const attention = [];
    for (const inc of store.list("incidents", tenant.id) || []) {
      const dl = incidentDeadline(inc, today);
      let mapped;
      if (dl.reported) mapped = "valid";
      else if (dl.overdue) mapped = "expired";
      else if (dl.daysLeft <= 2) mapped = "expiring";
      else mapped = "pending";
      counts[mapped] += 1;
      if (["expiring", "expired"].includes(mapped) && attention.length < 10) {
        attention.push({ type: "incident", id: inc.id, label: `${inc.date} · ${inc.severity}`, status: mapped, deadline: dl.deadline });
      }
    }
    categories.push({ key: "incidents", enabled: true, counts, attention });
  } else {
    categories.push({ key: "incidents", enabled: false, counts: emptyCounts(), attention: [] });
  }

  // ── Werven (context) ───────────────────────────────────────────────────────
  const worksites = store.list("worksites", tenant.id) || [];
  const activeWorksites = worksites.filter(w => ["preparation", "active"].includes(w.status)).length;

  const attentionTotal = categories.reduce((s, c) => s + c.attention.length, 0);
  return {
    generatedAt: now.toISOString(),
    activeWorksites,
    categories,
    attentionTotal,
  };
}

module.exports = { COMPLIANCE_STATES, buildComplianceOverview };
