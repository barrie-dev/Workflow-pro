"use strict";
/**
 * Robaws-importer · switcher-migratie (master-spec h47.1, E20, R6).
 *
 * Importeert klanten, contacten, leveranciers, artikels en locaties met
 * external_id-mapping; historische afgewerkte documenten komen binnen als
 * ONVERANDERLIJKE externe snapshots (geen bewerkbare Monargo-facturen).
 *
 * Twee fasen (h47.1):
 *  1. validateImport → validatierapport (duplicaten, ontbrekende relaties,
 *     btw-identiteit, open hoeveelheden, bestandsfouten) · GEEN writes;
 *  2. runImport → idempotente import op external_id (herstart-veilig, parallel-
 *     run-vriendelijk) met reconciliatierapport (created/skipped/errors).
 *
 * De importer schrijft via de bestaande genormaliseerde vorm (customers/
 * suppliers/stock/invoices) met een externalIds-mapping op elk record. Geen
 * vendor/SQL (ADR-001) · dit is de portable import-adapter.
 */

const { newUlid } = require("./events");

const ENTITY_KINDS = ["customers", "suppliers", "articles", "locations", "invoices"];
const SOURCE = "robaws";

function clean(v) { return String(v == null ? "" : v).trim(); }
// Losse BE-btw-check (structuur, geen mod-97): BE + 10 cijfers.
function looksLikeBeVat(v) { return /^BE0?\d{9,10}$/i.test(clean(v).replace(/[.\s]/g, "")); }

function existingByExternalId(store, tenantId, collection, externalId) {
  return (store.list(collection, tenantId) || []).find(r => r.externalIds && r.externalIds[SOURCE] === externalId) || null;
}

/**
 * Dry-run validatie. Muteert niets.
 * @returns {{ ok, summary, entities:{ [kind]: { total, valid, willCreate, willSkip, issues:[] } }, issues:[] }}
 */
function validateImport(store, tenant, payload) {
  const tenantId = tenant.id;
  const report = { ok: true, summary: {}, entities: {}, issues: [] };
  const p = payload || {};

  const seen = { customers: new Set(), suppliers: new Set(), articles: new Set(), locations: new Set(), invoices: new Set() };
  const custExt = new Set((p.customers || []).map(c => clean(c.externalId)).filter(Boolean));

  for (const kind of ENTITY_KINDS) {
    const rows = Array.isArray(p[kind]) ? p[kind] : [];
    const ent = { total: rows.length, valid: 0, willCreate: 0, willSkip: 0, issues: [] };
    const collection = kind === "articles" ? "stock" : kind === "locations" ? "venues" : kind;
    rows.forEach((row, i) => {
      const ext = clean(row.externalId);
      const ref = `${kind}[${i}]${ext ? " · " + ext : ""}`;
      let bad = false;
      if (!ext) { ent.issues.push({ ref, level: "error", msg: "external_id ontbreekt" }); bad = true; }
      else if (seen[kind].has(ext)) { ent.issues.push({ ref, level: "error", msg: "dubbel external_id in de import" }); bad = true; }
      else seen[kind].add(ext);

      const name = clean(row.name || row.number);
      if (!name) { ent.issues.push({ ref, level: "error", msg: "naam/nummer ontbreekt" }); bad = true; }

      // Btw-identiteit voor klanten/leveranciers (waarschuwing, geen blocker).
      if ((kind === "customers" || kind === "suppliers") && row.vat && !looksLikeBeVat(row.vat)) {
        ent.issues.push({ ref, level: "warning", msg: `btw-nummer '${row.vat}' lijkt ongeldig` });
      }
      // Ontbrekende relatie: factuur verwijst naar onbekende klant.
      if (kind === "invoices") {
        const cref = clean(row.customerExternalId);
        if (cref && !custExt.has(cref)) { ent.issues.push({ ref, level: "error", msg: `verwijst naar onbekende klant '${cref}'` }); bad = true; }
        if (row.finalized && Number(row.total || 0) === 0) ent.issues.push({ ref, level: "warning", msg: "afgewerkte factuur met totaal 0" });
      }
      // Bestandsfouten (h47.1): meegegeven fileError-vlag.
      if (row.fileError) ent.issues.push({ ref, level: "warning", msg: `bestandsfout: ${clean(row.fileError)}` });

      if (!bad) {
        ent.valid += 1;
        if (ext && existingByExternalId(store, tenantId, collection, ext)) ent.willSkip += 1;
        else ent.willCreate += 1;
      }
    });
    if (ent.issues.some(x => x.level === "error")) report.ok = false;
    report.entities[kind] = ent;
    report.summary[kind] = { total: ent.total, willCreate: ent.willCreate, willSkip: ent.willSkip, errors: ent.issues.filter(x => x.level === "error").length, warnings: ent.issues.filter(x => x.level === "warning").length };
  }
  report.issues = Object.values(report.entities).flatMap(e => e.issues).filter(x => x.level === "error");
  return report;
}

/**
 * Idempotente import (herstart-veilig op external_id).
 * @returns {{ report, mapping }} - reconciliatierapport + external→intern mapping
 */
function runImport(store, tenant, payload, actor, opts = {}) {
  const tenantId = tenant.id;
  const p = payload || {};
  const now = new Date().toISOString();
  const report = {};
  const mapping = { customers: {}, suppliers: {}, articles: {}, locations: {}, invoices: {} };

  const importOne = (kind, collection, rows, build) => {
    const r = { created: 0, skipped: 0, errors: 0, errorRefs: [] };
    for (const row of Array.isArray(rows) ? rows : []) {
      const ext = clean(row.externalId);
      if (!ext || !clean(row.name || row.number)) { r.errors += 1; r.errorRefs.push(ext || "(zonder id)"); continue; }
      const existing = existingByExternalId(store, tenantId, collection, ext);
      if (existing) { mapping[kind][ext] = existing.id; r.skipped += 1; continue; }
      const id = build(ext, row);
      mapping[kind][ext] = id;
      r.created += 1;
    }
    report[kind] = r;
  };

  // ── Klanten ────────────────────────────────────────────────────────────────
  importOne("customers", "customers", p.customers, (ext, row) => {
    const id = `cust_${newUlid()}`;
    store.insert("customers", {
      id, tenantId, externalIds: { [SOURCE]: ext },
      type: "company", name: clean(row.name), vatNumber: clean(row.vat),
      email: clean(row.email).toLowerCase(), phone: clean(row.phone),
      address: clean(row.address), city: clean(row.city), zip: clean(row.zip),
      contacts: [], addresses: [], schemaVersion: 2,
      version: 1, createdAt: now, createdBy: actor || "robaws-import", updatedAt: now,
      importSource: SOURCE,
    });
    return id;
  });

  // ── Leveranciers ───────────────────────────────────────────────────────────
  importOne("suppliers", "suppliers", p.suppliers, (ext, row) => {
    const id = `sup_${newUlid()}`;
    store.insert("suppliers", {
      id, tenantId, externalIds: { [SOURCE]: ext },
      type: clean(row.type) === "subcontractor" ? "subcontractor" : "supplier",
      name: clean(row.name), vatNumber: clean(row.vat), email: clean(row.email).toLowerCase(),
      phone: clean(row.phone), iban: clean(row.iban), paymentTermsDays: 30,
      version: 1, createdAt: now, createdBy: actor || "robaws-import", updatedAt: now, importSource: SOURCE,
    });
    return id;
  });

  // ── Artikels (bestaande eenvoudige stock-vorm) ─────────────────────────────
  importOne("articles", "stock", p.articles, (ext, row) => {
    const id = `stock_${newUlid()}`;
    store.insert("stock", {
      id, tenantId, externalIds: { [SOURCE]: ext },
      name: clean(row.name), sku: clean(row.sku), unit: clean(row.unit) || "st",
      unitPrice: Math.max(0, Number(row.unitPrice) || 0), quantity: 0, minQuantity: 0,
      createdAt: now, createdBy: actor || "robaws-import", importSource: SOURCE,
    });
    return id;
  });

  // ── Locaties (gedeeld venue-object) ────────────────────────────────────────
  importOne("locations", "venues", p.locations, (ext, row) => {
    const id = `venue_${newUlid()}`;
    store.insert("venues", {
      id, tenantId, externalIds: { [SOURCE]: ext },
      name: clean(row.name), address: clean(row.address), city: clean(row.city), zip: clean(row.zip),
      active: true, createdAt: now, createdBy: actor || "robaws-import", importSource: SOURCE,
    });
    return id;
  });

  // ── Historische facturen = onveranderlijke externe snapshots (h47.1) ────────
  {
    const r = { created: 0, skipped: 0, errors: 0, errorRefs: [] };
    for (const row of Array.isArray(p.invoices) ? p.invoices : []) {
      const ext = clean(row.externalId);
      if (!ext) { r.errors += 1; continue; }
      if (existingByExternalId(store, tenantId, "invoices", ext)) { r.skipped += 1; mapping.invoices[ext] = existingByExternalId(store, tenantId, "invoices", ext).id; continue; }
      const id = `ext_${newUlid()}`;
      store.insert("invoices", {
        id, tenantId, externalIds: { [SOURCE]: ext },
        docType: "external_snapshot", editable: false,      // niet bewerkbaar (h47.1)
        number: clean(row.number) || ext,
        customerId: row.customerExternalId ? (mapping.customers[clean(row.customerExternalId)] || null) : null,
        customerName: clean(row.customerName),
        status: row.paid ? "paid" : "external",
        total: Number(row.total) || 0, subtotal: Number(row.subtotal ?? row.total) || 0,
        invoiceDate: clean(row.invoiceDate) || null,
        lines: Array.isArray(row.lines) ? row.lines : [],
        importSource: SOURCE, snapshotAt: now, createdAt: now, createdBy: actor || "robaws-import",
      });
      mapping.invoices[ext] = id;
      r.created += 1;
    }
    report.invoices = r;
  }

  if (typeof store.save === "function") store.save();
  const totals = Object.values(report).reduce((a, r) => ({ created: a.created + r.created, skipped: a.skipped + r.skipped, errors: a.errors + r.errors }), { created: 0, skipped: 0, errors: 0 });
  return { report: { ...report, totals, at: now, dryRun: !!opts.dryRun }, mapping };
}

module.exports = { ENTITY_KINDS, SOURCE, validateImport, runImport, looksLikeBeVat };
