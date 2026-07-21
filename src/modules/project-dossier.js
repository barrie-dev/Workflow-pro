"use strict";

// ── Project 360°-dossier (#76 · module-samenhang) ────────────────────────────
// De modules bestonden los naast elkaar; de kloof ertussen was te groot. Dit
// leesaggregaat brengt ALLE modulesporen van één project samen in één dossier
// met één chronologische tijdlijn: offertes, werven, planning, werkbonnen,
// meerwerk, facturen, betalingen, vorderingsstaten, onkosten, afspraken en
// werfongevallen. Zo wordt het project - zoals de spec bedoelt (E04, "centraal
// dossier") - de RUGGENGRAAT die de modules aan elkaar rijgt.
//
// Puur lezend en afgeleid: geen eigen opslag. De aanroeper past de rechten-
// redactie toe op de deellijsten (gevoelige velden) en beslist of de financiele
// samenvatting mee mag (beheerder / costs.view).

function firstDate(row, keys) {
  for (const k of keys) { const v = row && row[k]; if (v) return v; }
  return null;
}

/**
 * Bouw het dossier voor één project.
 * @param {object} store
 * @param {string} tenantId
 * @param {object} project
 * @param {{ finance?: object|null }} [opts] finance-samenvatting (of null als niet toegestaan)
 */
function projectDossier(store, tenantId, project, opts = {}) {
  const list = (col) => store.list(col, tenantId) || [];
  const byProject = (col) => list(col).filter(r => r && r.projectId === project.id);

  const quotes = byProject("quotes");
  const worksites = byProject("worksites");
  const shifts = byProject("shifts");
  const workorders = byProject("workorders");
  const changeOrders = byProject("changeOrders");
  const invoices = byProject("invoices");
  const appointments = byProject("appointments");
  const incidents = byProject("incidents");
  const expenses = byProject("expenses");
  const progressClaims = byProject("progressClaims");

  // Betalingen hangen aan facturen via allocaties: neem de betalingen mee die
  // (deels) op een factuur van dit project zijn toegewezen.
  const invoiceIds = new Set(invoices.map(i => i.id));
  const invoiceNumbers = new Set(invoices.map(i => i.number).filter(Boolean));
  const payments = list("payments").filter(p =>
    Array.isArray(p.allocations) && p.allocations.some(a => !a.reversedAt && (invoiceIds.has(a.invoiceId) || invoiceNumbers.has(a.invoiceNumber)))
  );

  // ── Chronologische tijdlijn · één verhaal over alle modules heen ──────────
  const tl = [];
  const add = (at, module, type, title, ref, extra) => { if (at) tl.push({ at: new Date(at).toISOString(), module, type, title, ref: ref || null, ...(extra || {}) }); };

  add(project.createdAt, "projects", "project.created", `Project ${project.number || ""} aangemaakt`.trim(), project.id);
  for (const q of quotes) {
    add(firstDate(q, ["createdAt", "quoteDate", "date"]), "quotes", "quote.created", `Offerte ${q.number || q.id} opgesteld`, q.id, { status: q.status });
    if (q.sentAt) add(q.sentAt, "quotes", "quote.sent", `Offerte ${q.number || q.id} verzonden`, q.id);
    if (q.acceptance && q.acceptance.at) add(q.acceptance.at, "quotes", "quote.accepted", `Offerte ${q.number || q.id} aanvaard`, q.id, { by: q.acceptance.name });
  }
  for (const w of worksites) add(firstDate(w, ["createdAt"]), "worksites", "worksite.created", `Werf ${w.name || w.id}`, w.id);
  for (const s of shifts) add(firstDate(s, ["date", "createdAt"]), "planning", "planning.shift", `Planning ${s.date || ""} ${s.start || ""}-${s.end || ""}`.trim(), s.id, { userId: s.userId });
  for (const wo of workorders) {
    add(firstDate(wo, ["createdAt", "date"]), "workorders", "workorder.created", `Werkbon ${wo.number || wo.id}`, wo.id, { status: wo.status });
    if (wo.approvedAt) add(wo.approvedAt, "workorders", "workorder.approved", `Werkbon ${wo.number || wo.id} goedgekeurd`, wo.id);
  }
  for (const co of changeOrders) add(firstDate(co, ["createdAt"]), "changeOrders", "changeorder", `Meerwerk ${co.number || co.id} (${co.status})`, co.id, { total: co.total });
  for (const inv of invoices) add(firstDate(inv, ["invoiceDate", "createdAt", "date"]), "invoices", "invoice.issued", `Factuur ${inv.number || inv.id}`, inv.id, { total: inv.total, status: inv.status });
  for (const p of payments) for (const a of (p.allocations || [])) {
    if (!a.reversedAt && (invoiceIds.has(a.invoiceId) || invoiceNumbers.has(a.invoiceNumber))) {
      add(firstDate(p, ["paidOn", "date", "createdAt"]), "payments", "payment.allocated", `Betaling toegewezen aan ${a.invoiceNumber || a.invoiceId}`, p.id, { amount: a.amount });
    }
  }
  for (const pc of progressClaims) add(firstDate(pc, ["createdAt", "periodEnd"]), "progressClaims", "progressclaim", `Vorderingsstaat ${pc.number || pc.id}`, pc.id, { status: pc.status });
  for (const ap of appointments) add(firstDate(ap, ["date", "start", "createdAt"]), "appointments", "appointment", `Afspraak ${ap.title || ap.id}`, ap.id);
  for (const ic of incidents) add(firstDate(ic, ["date", "createdAt"]), "incidents", "incident", `Werkongeval ${ic.reference || ic.id}`, ic.id, { severity: ic.severity });

  tl.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // nieuwste eerst

  return {
    project,
    counts: {
      quotes: quotes.length, worksites: worksites.length, planning: shifts.length,
      workorders: workorders.length, changeOrders: changeOrders.length,
      invoices: invoices.length, payments: payments.length,
      progressClaims: progressClaims.length, appointments: appointments.length,
      incidents: incidents.length, expenses: expenses.length,
    },
    related: { quotes, worksites, shifts, workorders, changeOrders, invoices, payments, progressClaims, appointments, incidents, expenses },
    timeline: tl,
    finance: opts.finance || null,
  };
}

module.exports = { projectDossier };
