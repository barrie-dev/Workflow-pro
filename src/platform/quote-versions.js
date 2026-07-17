"use strict";
/**
 * Offerteversies · onveranderlijke revisies (master-spec h19/E05, R1-b).
 *
 * Business rules (h19):
 *  - Offertenummer en versienummer worden afzonderlijk beheerd.
 *  - Een verzonden versie is ONVERANDERLIJK. Wijzigingen creëren een nieuwe
 *    revisie (nieuw versienummer, zelfde offertenummer).
 *  - Digitale goedkeuring bewaart naam, tijdstip, technische metadata én de
 *    documenthash, en is aantoonbaar te koppelen aan versie + hash.
 *
 * Deze module levert pure functies bovenop de bestaande "quotes"-collectie
 * (compatibility): een quote krijgt version (int) en versions[] (immutable
 * snapshots). Geen vendor/SQL hier (ADR-001); de latere pg-repository gebruikt
 * dezelfde datavorm.
 */

const crypto = require("crypto");
const { round2 } = require("../modules/be-locale");

/**
 * Deterministische documenthash over de commercieel bindende inhoud.
 * Onafhankelijk van sleutelvolgorde en van niet-bindende velden (id, timestamps).
 */
function computeDocumentHash(content) {
  const canonical = {
    number: content.number || "",
    version: Number(content.version || 1),
    customerName: content.customerName || "",
    customerVatNumber: content.customerVatNumber || "",
    lines: (content.lines || []).map(l => ({
      description: l.description || "",
      qty: Number(l.qty || 0),
      unitPrice: Number(l.unitPrice || 0),
      vatRate: Number(l.vatRate ?? 21),
    })),
    subtotal: Number(content.subtotal || 0),
    vatAmount: Number(content.vatAmount || 0),
    total: Number(content.total || 0),
    notes: content.notes || "",
  };
  return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Herbereken lijnen + totalen (zelfde regels als de offerte-route). */
function computeTotals(rawLines) {
  const lines = (Array.isArray(rawLines) ? rawLines : []).map(l => {
    const qty = Number(l.qty || 1);
    const unitPrice = Number(l.unitPrice || 0);
    const vatRate = Number(l.vatRate ?? 21);
    const lineSubtotal = round2(qty * unitPrice);
    const lineVat = round2(lineSubtotal * vatRate / 100);
    return { description: l.description || "", qty, unitPrice, vatRate, lineSubtotal, lineVat, lineTotal: round2(lineSubtotal + lineVat) };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.lineSubtotal, 0));
  const vatAmount = round2(lines.reduce((s, l) => s + l.lineVat, 0));
  const total = round2(subtotal + vatAmount);
  return { lines, subtotal, vatAmount, total };
}

/** Bevries de huidige inhoud van een quote als onveranderlijke versie-snapshot. */
function buildVersionSnapshot(quote, at = new Date().toISOString()) {
  const version = Number(quote.version || 1);
  const hash = computeDocumentHash(quote);
  return {
    version,
    hash,
    sentAt: at,
    lines: (quote.lines || []).map(l => ({ ...l })),
    subtotal: quote.subtotal,
    vatAmount: quote.vatAmount,
    total: quote.total,
    notes: quote.notes || "",
  };
}

/**
 * Verzend-patch: voegt (idempotent) de huidige versie toe aan versions[] met
 * hash en sentAt. Een reeds bevroren versienummer wordt niet gedupliceerd.
 * @returns {{ patch, snapshot }}
 */
function freezeSentVersion(quote, at = new Date().toISOString()) {
  const version = Number(quote.version || 1);
  const versions = Array.isArray(quote.versions) ? quote.versions.slice() : [];
  const already = versions.find(v => v.version === version);
  const snapshot = already || buildVersionSnapshot(quote, at);
  if (!already) versions.push(snapshot);
  return { patch: { versions, documentHash: snapshot.hash }, snapshot };
}

/**
 * Revisie-patch: maak een nieuwe, bewerkbare versie (version+1) met nieuwe
 * lijnen. De vorige verzonden versie blijft onveranderd in versions[].
 * Alleen toegestaan als de offerte al minstens één keer verzonden is.
 * @returns nieuwe quote-velden (merge-patch)
 */
function reviseQuote(quote, newLines) {
  if (!quote.sentAt && !(quote.versions || []).length) {
    const e = new Error("Een offerte die nog niet verzonden is, kun je gewoon bewerken zonder revisie.");
    e.status = 409; e.code = "NO_SENT_VERSION"; throw e;
  }
  const { lines, subtotal, vatAmount, total } = computeTotals(newLines);
  if (!lines.length) { const e = new Error("Minimaal 1 offerteregel vereist"); e.status = 400; throw e; }
  // Bevries eerst de nog niet-bevroren huidige versie (defensief).
  const frozen = freezeSentVersion(quote);
  return {
    version: Number(quote.version || 1) + 1,
    versions: frozen.patch.versions,
    lines, subtotal, vatAmount, total,
    status: "concept",
    sentAt: null,
    // Nieuwe revisie is nog niet goedgekeurd/geweigerd.
    acceptedAt: null, rejectedAt: null,
    documentHash: null,
    updatedAt: new Date().toISOString(),
  };
}

/** Verschil tussen twee versies (voor "revisie toont verschillen", acceptatiecriterium). */
function diffVersions(a, b) {
  if (!a || !b) return null;
  return {
    fromVersion: a.version,
    toVersion: b.version,
    totalDelta: round2(Number(b.total || 0) - Number(a.total || 0)),
    lineCountDelta: (b.lines || []).length - (a.lines || []).length,
  };
}

module.exports = {
  computeDocumentHash,
  computeTotals,
  buildVersionSnapshot,
  freezeSentVersion,
  reviseQuote,
  diffVersions,
};
