"use strict";
/**
 * Configureerbare document-sjablonen (facturen, offertes, werkbon-rapporten).
 *
 * Een klant maakt per documenttype één of meer sjablonen aan: logo, accentkleur,
 * eigen kop-/inleiding-/voettekst met merge-velden ({{bedrijf.naam}} …), welke
 * kolommen getoond worden en taal. De renderer voegt het sjabloon samen met de
 * documentdata en levert print-klare HTML met de juiste velden.
 *
 * Alles hier is puur (geen store/HTTP) → testbaar.
 */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, c => ESC[c]); }
function eur(n) { return new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" }).format(Number(n || 0)); }
function dmy(iso) { return iso ? new Date(iso).toLocaleDateString("nl-BE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"; }

// Kolommen die in een regel-tabel (factuur/offerte) getoond kunnen worden.
const LINE_COLUMNS = {
  description: { label: "Omschrijving", num: false, get: l => esc(l.description || "") },
  qty:         { label: "Aantal",       num: true,  get: l => Number(l.qty || 1) },
  unitPrice:   { label: "Eenheidsprijs", num: true, get: l => eur(l.unitPrice) },
  vatRate:     { label: "Btw%",         num: true,  get: l => `${l.vatRate ?? 21}%` },
  lineSubtotal:{ label: "Subtotaal",    num: true,  get: l => eur(l.lineSubtotal) },
  lineVat:     { label: "Btw",          num: true,  get: l => eur(l.lineVat) },
  lineTotal:   { label: "Totaal",       num: true,  get: l => eur(l.lineTotal) },
};

// Documenttypes + hun beschikbare merge-velden (voor de "veld invoegen"-keuze in de editor).
const DOCUMENT_TYPES = {
  invoice: {
    label: "Factuur", docLabel: "FACTUUR", kind: "financial",
    defaultColumns: ["description", "qty", "unitPrice", "vatRate", "lineTotal"],
  },
  quote: {
    label: "Offerte", docLabel: "OFFERTE", kind: "financial",
    defaultColumns: ["description", "qty", "unitPrice", "vatRate", "lineTotal"],
  },
  workorder: {
    label: "Werkbon-rapport", docLabel: "WERKBON", kind: "report",
    defaultColumns: [],
  },
};

const COMMON_FIELDS = ["bedrijf.naam", "bedrijf.btw", "bedrijf.adres", "bedrijf.email", "bedrijf.telefoon", "bedrijf.iban", "datum.vandaag"];
const FIELD_CATALOG = {
  invoice: [...COMMON_FIELDS, "document.nummer", "document.datum", "document.vervaldatum", "document.status", "klant.naam", "klant.btw", "klant.adres", "totalen.subtotaal", "totalen.btw", "totalen.totaal"],
  quote: [...COMMON_FIELDS, "document.nummer", "document.datum", "document.geldigtot", "document.status", "klant.naam", "klant.btw", "klant.adres", "totalen.subtotaal", "totalen.btw", "totalen.totaal"],
  workorder: [...COMMON_FIELDS, "document.nummer", "document.titel", "document.datum", "klant.naam", "uitvoerder.naam", "uren.geklokt", "uren.factureerbaar"],
};

function isType(t) { return Object.prototype.hasOwnProperty.call(DOCUMENT_TYPES, t); }

/** Standaard-sjabloon voor een documenttype. */
function defaultTemplate(type) {
  const def = DOCUMENT_TYPES[type] || DOCUMENT_TYPES.invoice;
  return {
    type,
    name: `Standaard ${def.label.toLowerCase()}`,
    isDefault: true,
    accentColor: "#1e6be6",
    logo: null,
    headerText: "",
    introText: "",
    footerText: "{{bedrijf.naam}} · {{bedrijf.btw}} · {{bedrijf.email}}",
    paymentTerms: type === "invoice" ? "Gelieve te betalen voor de vervaldatum op {{bedrijf.iban}}." : "",
    columns: def.defaultColumns.slice(),
    showVat: true,
    language: "nl",
  };
}

/** Normaliseer/valideer een sjabloon-payload (server-side, vóór opslag). */
function normalizeTemplate(payload, existing = {}) {
  const type = isType(payload.type) ? payload.type : (existing.type || "invoice");
  const def = DOCUMENT_TYPES[type];
  const validCols = Object.keys(LINE_COLUMNS);
  const columns = Array.isArray(payload.columns)
    ? payload.columns.filter(c => validCols.includes(c))
    : (existing.columns || def.defaultColumns.slice());
  const hex = String(payload.accentColor || existing.accentColor || "#1e6be6");
  return {
    type,
    name: String(payload.name ?? existing.name ?? def.label).trim().slice(0, 80) || def.label,
    isDefault: payload.isDefault !== undefined ? !!payload.isDefault : !!existing.isDefault,
    accentColor: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#1e6be6",
    logo: payload.logo !== undefined ? (payload.logo ? String(payload.logo).slice(0, 700000) : null) : (existing.logo || null),
    headerText: String(payload.headerText ?? existing.headerText ?? "").slice(0, 2000),
    introText: String(payload.introText ?? existing.introText ?? "").slice(0, 2000),
    footerText: String(payload.footerText ?? existing.footerText ?? "").slice(0, 2000),
    paymentTerms: String(payload.paymentTerms ?? existing.paymentTerms ?? "").slice(0, 1000),
    columns: columns.length ? columns : def.defaultColumns.slice(),
    showVat: payload.showVat !== undefined ? !!payload.showVat : (existing.showVat !== false),
    language: ["nl", "fr"].includes(payload.language) ? payload.language : (existing.language || "nl"),
  };
}

/** Bouw de merge-veld-context (platte token→waarde map) uit document + tenant. */
function buildContext(type, doc = {}, tenant = {}) {
  const ip = tenant.invoiceProfile || {};
  const f = {
    "bedrijf.naam": tenant.name || ip.name || "",
    "bedrijf.btw": tenant.vatNumber || ip.vat || "",
    "bedrijf.adres": tenant.address || [ip.street, ip.zip, ip.city].filter(Boolean).join(", "),
    "bedrijf.email": tenant.contactEmail || tenant.billingEmail || "",
    "bedrijf.telefoon": (tenant.contact && tenant.contact.phone) || tenant.phone || "",
    "bedrijf.iban": ip.iban || tenant.iban || "",
    "datum.vandaag": dmy(new Date().toISOString()),
    "klant.naam": doc.customerName || doc.clientName || "",
    "klant.btw": doc.customerVatNumber || "",
    "klant.adres": doc.customerAddress || "",
    "document.nummer": doc.number || doc.id || "",
    "document.status": doc.status || "",
  };
  if (type === "invoice") { f["document.datum"] = dmy(doc.invoiceDate); f["document.vervaldatum"] = dmy(doc.dueDate); }
  else if (type === "quote") { f["document.datum"] = dmy(doc.quoteDate); f["document.geldigtot"] = dmy(doc.validUntil); }
  else if (type === "workorder") {
    f["document.datum"] = dmy(doc.completedAt || doc.scheduledDate);
    f["document.titel"] = doc.title || "";
    f["uitvoerder.naam"] = doc.userName || doc.completedBy || "";
    f["uren.geklokt"] = doc.clockedHours != null ? String(doc.clockedHours) : "";
    f["uren.factureerbaar"] = doc.billableHours != null ? String(doc.billableHours) : "";
  }
  f["totalen.subtotaal"] = eur(doc.subtotal);
  f["totalen.btw"] = eur(doc.vatAmount);
  f["totalen.totaal"] = eur(doc.total);
  return { fields: f, lines: doc.lines || [], doc, tenant };
}

/** Vervang {{token}} door de (geëscapete) waarde uit de context. Onbekende → leeg. */
function mergeFields(text, fields) {
  return String(text || "").replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (_, k) => esc(fields[k] != null ? fields[k] : ""));
}

function lineTable(template, ctx) {
  const cols = (template.columns && template.columns.length ? template.columns : ["description", "qty", "unitPrice", "lineTotal"])
    .filter(c => LINE_COLUMNS[c]);
  const head = cols.map(c => `<th class="${LINE_COLUMNS[c].num ? "num" : ""}">${esc(LINE_COLUMNS[c].label)}</th>`).join("");
  const body = ctx.lines.map(l => `<tr>${cols.map(c => `<td class="${LINE_COLUMNS[c].num ? "num" : ""}">${LINE_COLUMNS[c].get(l)}</td>`).join("")}</tr>`).join("")
    || `<tr><td colspan="${cols.length}" style="color:#94a3b8;padding:14px">Geen regels</td></tr>`;
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function totalsBlock(template, ctx) {
  const d = ctx.doc;
  return `<div class="totals">
    <div class="totals-row"><span>Subtotaal</span><span>${eur(d.subtotal)}</span></div>
    ${template.showVat !== false ? `<div class="totals-row"><span>Btw</span><span>${eur(d.vatAmount)}</span></div>` : ""}
    <div class="totals-row total"><span>TOTAAL</span><span>${eur(d.total)}</span></div>
  </div>`;
}

function reportBody(ctx) {
  const d = ctx.doc;
  const checklist = Array.isArray(d.checklist) ? d.checklist : [];
  const photos = Array.isArray(d.files) ? d.files.length : 0;
  return `
    ${d.description ? `<div class="block"><div class="block-h">Omschrijving</div><div>${esc(d.description)}</div></div>` : ""}
    <div class="block"><div class="block-h">Gegevens</div>
      <div class="kv"><span>Uitvoerder</span><span>${esc(ctx.fields["uitvoerder.naam"] || "—")}</span></div>
      <div class="kv"><span>Geklokte uren</span><span>${esc(ctx.fields["uren.geklokt"] || "—")}</span></div>
      <div class="kv"><span>Datum</span><span>${esc(ctx.fields["document.datum"])}</span></div>
    </div>
    ${checklist.length ? `<div class="block"><div class="block-h">Checklist</div>${checklist.map(c => `<div class="kv"><span>${esc(c.label || c.text || "")}</span><span>${c.done ? "✓" : "—"}</span></div>`).join("")}</div>` : ""}
    <div class="block"><div class="block-h">Bewijs</div>
      <div class="kv"><span>Foto's</span><span>${photos}</span></div>
      <div class="kv"><span>Handtekening klant</span><span>${d.signed ? "✓ aanwezig" : "—"}</span></div>
    </div>`;
}

/** Render een volledig print-klaar HTML-document uit sjabloon + data. */
function renderDocument(template, type, doc = {}, tenant = {}) {
  const tpl = normalizeTemplate(template || {}, { type });
  const def = DOCUMENT_TYPES[type] || DOCUMENT_TYPES.invoice;
  const ctx = buildContext(type, doc, tenant);
  const accent = tpl.accentColor;
  const f = ctx.fields;
  const headerHtml = tpl.headerText
    ? `<div class="custom-header">${mergeFields(tpl.headerText, f).replace(/\n/g, "<br>")}</div>`
    : `<div class="brand-block">
        ${tpl.logo ? `<img class="logo" src="${esc(tpl.logo)}" alt="logo">` : `<div class="brand">${esc(f["bedrijf.naam"] || "WorkFlow Pro")}</div>`}
        <div class="brand-sub">${esc(f["bedrijf.btw"])}</div>
        <div class="brand-sub">${esc(f["bedrijf.adres"])}</div>
        ${f["bedrijf.email"] ? `<div class="brand-sub">${esc(f["bedrijf.email"])}</div>` : ""}
      </div>`;
  const dateRow = type === "quote"
    ? `<div class="date-item"><div class="date-label">Datum</div><div class="date-val">${esc(f["document.datum"])}</div></div>
       <div class="date-item"><div class="date-label">Geldig tot</div><div class="date-val">${esc(f["document.geldigtot"])}</div></div>`
    : type === "workorder"
    ? `<div class="date-item"><div class="date-label">Datum</div><div class="date-val">${esc(f["document.datum"])}</div></div>`
    : `<div class="date-item"><div class="date-label">Datum</div><div class="date-val">${esc(f["document.datum"])}</div></div>
       <div class="date-item"><div class="date-label">Vervaldatum</div><div class="date-val">${esc(f["document.vervaldatum"])}</div></div>`;
  const body = def.kind === "report" ? reportBody(ctx) : `${lineTable(tpl, ctx)}${totalsBlock(tpl, ctx)}`;

  return `<!DOCTYPE html><html lang="${esc(tpl.language)}"><head><meta charset="UTF-8">
<title>${esc(def.docLabel)} ${esc(f["document.nummer"])}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1e293b;background:#fff;padding:32px 40px}
  .page{max-width:760px;margin:0 auto}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px}
  .logo{max-height:60px;max-width:240px}
  .brand{font-size:22px;font-weight:700;color:${accent}}
  .brand-sub{font-size:12px;color:#64748b;margin-top:2px}
  .custom-header{font-size:13px;color:#334155;line-height:1.6}
  .doc-meta{text-align:right}
  .doc-nr{font-size:20px;font-weight:700;color:#0f172a}
  .doc-type{font-size:11px;font-weight:700;color:${accent};letter-spacing:1px}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:24px}
  .party-label{font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
  .party-name{font-size:14px;font-weight:600;color:#0f172a;margin-bottom:3px}
  .party-detail{font-size:12px;color:#64748b;line-height:1.5}
  .dates{display:flex;gap:24px;background:#f8fafc;border-radius:8px;padding:12px 16px;margin-bottom:22px}
  .date-item{flex:1}.date-label{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}.date-val{font-size:13px;font-weight:600}
  .intro{margin-bottom:18px;font-size:12.5px;color:#334155;line-height:1.6}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  thead th{background:#f1f5f9;padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.4px;border-bottom:2px solid ${accent}}
  tbody td{padding:9px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .totals{margin-left:auto;width:280px}
  .totals-row{display:flex;justify-content:space-between;padding:5px 0;font-size:13px}
  .totals-row.total{font-weight:700;font-size:15px;border-top:2px solid ${accent};padding-top:8px;margin-top:4px;color:${accent}}
  .block{margin-bottom:16px}.block-h{font-size:11px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;border-bottom:1px solid #e2e8f0;padding-bottom:3px}
  .kv{display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0;color:#475569}
  .terms{background:#f8fafc;border-radius:8px;padding:12px 16px;margin-top:16px;font-size:12px;color:#475569}
  .footer{margin-top:34px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:14px}
  @media print{body{padding:0}@page{margin:15mm}}
</style></head><body>
<div class="page">
  <div class="header">
    ${headerHtml}
    <div class="doc-meta">
      <div class="doc-type">${esc(def.docLabel)}</div>
      <div class="doc-nr">${esc(f["document.nummer"])}</div>
    </div>
  </div>
  <div class="parties">
    <div>
      <div class="party-label">${type === "workorder" ? "Klant" : (type === "quote" ? "Voor" : "Factuuradres")}</div>
      <div class="party-name">${esc(f["klant.naam"] || "—")}</div>
      ${f["klant.btw"] ? `<div class="party-detail">Btw: ${esc(f["klant.btw"])}</div>` : ""}
      ${f["klant.adres"] ? `<div class="party-detail">${esc(f["klant.adres"])}</div>` : ""}
    </div>
    <div><div class="dates" style="margin:0">${dateRow}</div></div>
  </div>
  ${tpl.introText ? `<div class="intro">${mergeFields(tpl.introText, f).replace(/\n/g, "<br>")}</div>` : ""}
  ${body}
  ${tpl.paymentTerms ? `<div class="terms">${mergeFields(tpl.paymentTerms, f).replace(/\n/g, "<br>")}</div>` : ""}
  <div class="footer">${mergeFields(tpl.footerText, f) || esc(f["bedrijf.naam"])}</div>
</div>
<script>window.onload=function(){window.print()}</script>
</body></html>`;
}

// Sample-document voor een live preview in de editor.
function sampleDoc(type) {
  const base = {
    number: type === "quote" ? "OFF-2026-014" : type === "workorder" ? "WO-2026-031" : "2026-014",
    customerName: "Acme Bouw NV", customerVatNumber: "BE0123456789", customerAddress: "Industrieweg 12, 9000 Gent",
    status: "open",
    lines: [
      { description: "Arbeidsuren", qty: 8, unitPrice: 55, vatRate: 21, lineSubtotal: 440, lineVat: 92.4, lineTotal: 532.4 },
      { description: "Materiaal", qty: 1, unitPrice: 180, vatRate: 21, lineSubtotal: 180, lineVat: 37.8, lineTotal: 217.8 },
    ],
    subtotal: 620, vatAmount: 130.2, total: 750.2,
  };
  if (type === "quote") { base.quoteDate = "2026-06-26"; base.validUntil = "2026-07-26"; }
  else if (type === "workorder") {
    base.title = "Onderhoud verwarmingsinstallatie"; base.completedAt = "2026-06-26"; base.userName = "Jan Janssens";
    base.clockedHours = 8; base.billableHours = 8; base.description = "Jaarlijks onderhoud uitgevoerd.";
    base.checklist = [{ label: "Filter vervangen", done: true }, { label: "Druk gecontroleerd", done: true }];
    base.files = [{ name: "foto1.jpg" }]; base.signed = true;
  } else { base.invoiceDate = "2026-06-26"; base.dueDate = "2026-07-26"; }
  return base;
}

module.exports = { DOCUMENT_TYPES, FIELD_CATALOG, LINE_COLUMNS, isType, defaultTemplate, normalizeTemplate, buildContext, mergeFields, renderDocument, sampleDoc };
