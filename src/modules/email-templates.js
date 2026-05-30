/**
 * WorkFlow Pro – e-mailtemplates
 *
 * Elke functie geeft { subject, html, text } terug.
 * Gebruik samen met src/lib/mailer.js → sendMail({ to, ...template }).
 */

const { wrapHtml } = require("../lib/mailer");

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(val, fallback = "—") {
  return val != null && val !== "" ? String(val) : fallback;
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("nl-BE", { day: "2-digit", month: "long", year: "numeric" });
  } catch { return iso; }
}

function fmtMoney(amount, currency = "EUR") {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("nl-BE", { style: "currency", currency }).format(Number(amount));
  } catch { return `${currency} ${amount}`; }
}

function statusPill(status) {
  const map = { approved: "pill-approved", rejected: "pill-rejected", pending: "pill-pending", ingediend: "pill-pending" };
  const cls = map[status?.toLowerCase()] || "pill-pending";
  const label = { approved: "Goedgekeurd", rejected: "Afgewezen", pending: "In behandeling", ingediend: "Ingediend" }[status?.toLowerCase()] || fmt(status);
  return `<span class="pill ${cls}">${label}</span>`;
}

function detailRow(label, value) {
  return `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${value}</span></div>`;
}

// ── Verlofaanvraag ingediend (naar admin/manager) ──────────────────────────────

function leaveSubmittedToAdmin({ employee, leave, appUrl }) {
  const subject = `Nieuwe verlofaanvraag van ${fmt(employee?.name, employee?.email)}`;
  const html = wrapHtml(subject, `
    <h2>Nieuwe verlofaanvraag</h2>
    <p>
      <strong>${fmt(employee?.name, employee?.email)}</strong> heeft een verlofaanvraag ingediend
      en wacht op goedkeuring.
    </p>
    <div class="detail-box">
      ${detailRow("Medewerker", fmt(employee?.name))}
      ${detailRow("Type verlof", fmt(leave?.type, "—"))}
      ${detailRow("Van", fmtDate(leave?.startDate || leave?.from))}
      ${detailRow("Tot", fmtDate(leave?.endDate || leave?.to))}
      ${detailRow("Reden", fmt(leave?.reason))}
      ${detailRow("Status", statusPill("pending"))}
    </div>
    ${appUrl ? `<a class="cta" href="${appUrl}">Aanvraag beoordelen →</a>` : ""}
  `);
  const text = `Nieuwe verlofaanvraag van ${fmt(employee?.name)}\n\nType: ${fmt(leave?.type)}\nVan: ${fmtDate(leave?.startDate || leave?.from)}\nTot: ${fmtDate(leave?.endDate || leave?.to)}\nReden: ${fmt(leave?.reason)}\n\nMeld aan bij WorkFlow Pro om de aanvraag te beoordelen.`;
  return { subject, html, text };
}

// ── Verlofaanvraag beoordeeld (naar medewerker) ────────────────────────────────

function leaveReviewedToEmployee({ employee, leave, reviewer, appUrl }) {
  const approved = leave?.status === "approved";
  const subject = approved
    ? `Je verlofaanvraag is goedgekeurd`
    : `Je verlofaanvraag is niet goedgekeurd`;
  const html = wrapHtml(subject, `
    <h2>${approved ? "Je verlof is goedgekeurd 🎉" : "Je verlofaanvraag is afgewezen"}</h2>
    <p>
      ${approved
        ? `Je verlofaanvraag is <strong>goedgekeurd</strong> door ${fmt(reviewer?.name, reviewer?.email)}.`
        : `Je verlofaanvraag is helaas <strong>afgewezen</strong> door ${fmt(reviewer?.name, reviewer?.email)}.`}
    </p>
    <div class="detail-box">
      ${detailRow("Type verlof", fmt(leave?.type))}
      ${detailRow("Van", fmtDate(leave?.startDate || leave?.from))}
      ${detailRow("Tot", fmtDate(leave?.endDate || leave?.to))}
      ${detailRow("Status", statusPill(leave?.status))}
      ${leave?.reviewNote ? detailRow("Opmerking", fmt(leave.reviewNote)) : ""}
    </div>
    ${appUrl ? `<a class="cta" href="${appUrl}">Bekijk in WorkFlow Pro →</a>` : ""}
  `);
  const text = `${subject}\n\nType: ${fmt(leave?.type)}\nVan: ${fmtDate(leave?.startDate || leave?.from)}\nTot: ${fmtDate(leave?.endDate || leave?.to)}\nStatus: ${approved ? "Goedgekeurd" : "Afgewezen"}${leave?.reviewNote ? `\nOpmerking: ${leave.reviewNote}` : ""}`;
  return { subject, html, text };
}

// ── Onkostennota ingediend (naar admin/manager) ────────────────────────────────

function expenseSubmittedToAdmin({ employee, expense, appUrl }) {
  const subject = `Nieuwe onkostennota van ${fmt(employee?.name, employee?.email)}`;
  const html = wrapHtml(subject, `
    <h2>Nieuwe onkostennota</h2>
    <p>
      <strong>${fmt(employee?.name, employee?.email)}</strong> heeft een onkostennota ingediend
      ter waarde van <strong>${fmtMoney(expense?.amount, expense?.currency)}</strong>.
    </p>
    <div class="detail-box">
      ${detailRow("Medewerker", fmt(employee?.name))}
      ${detailRow("Categorie", fmt(expense?.category))}
      ${detailRow("Bedrag", fmtMoney(expense?.amount, expense?.currency))}
      ${detailRow("Datum", fmtDate(expense?.date))}
      ${detailRow("Beschrijving", fmt(expense?.description))}
      ${detailRow("Status", statusPill("ingediend"))}
    </div>
    ${appUrl ? `<a class="cta" href="${appUrl}">Onkostennota beoordelen →</a>` : ""}
  `);
  const text = `Nieuwe onkostennota van ${fmt(employee?.name)}\n\nCategorie: ${fmt(expense?.category)}\nBedrag: ${fmtMoney(expense?.amount, expense?.currency)}\nDatum: ${fmtDate(expense?.date)}\nBeschrijving: ${fmt(expense?.description)}\n\nMeld aan bij WorkFlow Pro om de nota te beoordelen.`;
  return { subject, html, text };
}

// ── Onkostennota beoordeeld (naar medewerker) ──────────────────────────────────

function expenseReviewedToEmployee({ employee, expense, reviewer, appUrl }) {
  const approved = expense?.status === "approved";
  const subject = approved
    ? `Je onkostennota is goedgekeurd`
    : `Je onkostennota is niet goedgekeurd`;
  const html = wrapHtml(subject, `
    <h2>${approved ? "Je onkostennota is goedgekeurd 🎉" : "Je onkostennota is afgewezen"}</h2>
    <p>
      ${approved
        ? `Je onkostennota is <strong>goedgekeurd</strong> door ${fmt(reviewer?.name, reviewer?.email)}.`
        : `Je onkostennota is helaas <strong>afgewezen</strong> door ${fmt(reviewer?.name, reviewer?.email)}.`}
    </p>
    <div class="detail-box">
      ${detailRow("Categorie", fmt(expense?.category))}
      ${detailRow("Bedrag", fmtMoney(expense?.amount, expense?.currency))}
      ${detailRow("Datum", fmtDate(expense?.date))}
      ${detailRow("Status", statusPill(expense?.status))}
      ${expense?.reviewNote ? detailRow("Opmerking", fmt(expense.reviewNote)) : ""}
    </div>
    ${appUrl ? `<a class="cta" href="${appUrl}">Bekijk in WorkFlow Pro →</a>` : ""}
  `);
  const text = `${subject}\n\nCategorie: ${fmt(expense?.category)}\nBedrag: ${fmtMoney(expense?.amount, expense?.currency)}\nStatus: ${approved ? "Goedgekeurd" : "Afgewezen"}${expense?.reviewNote ? `\nOpmerking: ${expense.reviewNote}` : ""}`;
  return { subject, html, text };
}

// ── Welkom nieuwe medewerker ───────────────────────────────────────────────────

function welcomeEmployee({ employee, tempPassword, appUrl }) {
  const subject = `Welkom bij WorkFlow Pro – je account is klaar`;
  const html = wrapHtml(subject, `
    <h2>Welkom bij WorkFlow Pro! 👋</h2>
    <p>
      Hallo <strong>${fmt(employee?.name, employee?.email)}</strong>,<br>
      je account is aangemaakt. Je kunt direct inloggen met onderstaande gegevens.
    </p>
    <div class="detail-box">
      ${detailRow("E-mail", fmt(employee?.email))}
      ${tempPassword ? detailRow("Tijdelijk wachtwoord", `<code>${tempPassword}</code>`) : ""}
    </div>
    <p style="color:#64748b;font-size:13px;">
      Wijzig je wachtwoord na de eerste aanmelding via Instellingen&nbsp;→&nbsp;Beveiliging.
    </p>
    ${appUrl ? `<a class="cta" href="${appUrl}">Inloggen →</a>` : ""}
  `);
  const text = `Welkom bij WorkFlow Pro!\n\nE-mail: ${fmt(employee?.email)}\n${tempPassword ? `Tijdelijk wachtwoord: ${tempPassword}\n\nWijzig je wachtwoord na de eerste aanmelding.\n` : ""}${appUrl ? `\nInloggen: ${appUrl}` : ""}`;
  return { subject, html, text };
}

module.exports = {
  leaveSubmittedToAdmin,
  leaveReviewedToEmployee,
  expenseSubmittedToAdmin,
  expenseReviewedToEmployee,
  welcomeEmployee
};
