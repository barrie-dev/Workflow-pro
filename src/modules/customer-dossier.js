"use strict";

// ── Klant 360°-dossier (#76 · module-samenhang, tweede ruggengraat) ──────────
// Naast het project (uitvoering) is de KLANT de commerciële ruggengraat: alles
// wat een klant met de organisatie deelt - projecten, offertes, facturen,
// betalingen, afspraken, contracten, werven - samengebracht in één dossier met
// een saldo-overzicht (gefactureerd vs betaald vs openstaand) en één tijdlijn.
// Zo rijgen CRM en finance zich aaneen tot één klantbeeld.
//
// Puur lezend/afgeleid. De aanroeper redigeert gevoelige velden en beslist of
// het saldo-overzicht mee mag (beheerder / costs.view).

const { firstDate } = require("./project-dossier");

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function customerDossier(store, tenantId, customer, opts = {}) {
  const list = (col) => store.list(col, tenantId) || [];
  const byCustomer = (col) => list(col).filter(r => r && r.customerId === customer.id);

  const projects = byCustomer("projects");
  const quotes = byCustomer("quotes");
  const invoices = byCustomer("invoices");
  const appointments = byCustomer("appointments");
  const contracts = byCustomer("contracts");
  const worksites = byCustomer("worksites");
  // Betalingen: direct op de klant én betalingen die op een factuur van de klant
  // zijn toegewezen (dekt betalingen zonder customerId maar met allocatie).
  const invoiceIds = new Set(invoices.map(i => i.id));
  const invoiceNumbers = new Set(invoices.map(i => i.number).filter(Boolean));
  const payments = list("payments").filter(p =>
    p.customerId === customer.id ||
    (Array.isArray(p.allocations) && p.allocations.some(a => !a.reversedAt && (invoiceIds.has(a.invoiceId) || invoiceNumbers.has(a.invoiceNumber))))
  );

  // Saldo: gefactureerd vs (niet-teruggedraaid) toegewezen betaald.
  const totalInvoiced = invoices.reduce((s, i) => s + num(i.total), 0);
  const allocatedToCustomer = payments.reduce((s, p) =>
    s + (p.allocations || []).filter(a => !a.reversedAt && (invoiceIds.has(a.invoiceId) || invoiceNumbers.has(a.invoiceNumber))).reduce((t, a) => t + num(a.amount), 0), 0);

  const tl = [];
  const add = (at, module, type, title, ref, extra) => { if (at) tl.push({ at: new Date(at).toISOString(), module, type, title, ref: ref || null, ...(extra || {}) }); };
  for (const p of projects) add(firstDate(p, ["createdAt"]), "projects", "project.created", `Project ${p.number || p.name || p.id}`, p.id, { status: p.status });
  for (const q of quotes) {
    add(firstDate(q, ["createdAt", "quoteDate"]), "quotes", "quote.created", `Offerte ${q.number || q.id}`, q.id, { status: q.status });
    if (q.acceptance && q.acceptance.at) add(q.acceptance.at, "quotes", "quote.accepted", `Offerte ${q.number || q.id} aanvaard`, q.id);
  }
  for (const inv of invoices) add(firstDate(inv, ["invoiceDate", "createdAt"]), "invoices", "invoice.issued", `Factuur ${inv.number || inv.id}`, inv.id, { total: inv.total, status: inv.status });
  for (const p of payments) add(firstDate(p, ["paidOn", "date", "createdAt"]), "payments", "payment", `Betaling ${num(p.amount) || ""}`.trim(), p.id, { status: p.status });
  for (const ap of appointments) add(firstDate(ap, ["date", "start", "createdAt"]), "appointments", "appointment", `Afspraak ${ap.title || ap.id}`, ap.id);
  for (const c of contracts) add(firstDate(c, ["createdAt", "startDate"]), "contracts", "contract", `Contract ${c.number || c.id}`, c.id, { status: c.status });
  tl.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const balance = {
    invoiced: Math.round(totalInvoiced * 100) / 100,
    paid: Math.round(allocatedToCustomer * 100) / 100,
    outstanding: Math.round((totalInvoiced - allocatedToCustomer) * 100) / 100,
  };

  return {
    customer,
    counts: {
      projects: projects.length, quotes: quotes.length, invoices: invoices.length,
      payments: payments.length, appointments: appointments.length,
      contracts: contracts.length, worksites: worksites.length,
    },
    related: { projects, quotes, invoices, payments, appointments, contracts, worksites },
    balance: opts.includeBalance === false ? null : balance,
    timeline: tl,
  };
}

module.exports = { customerDossier };
