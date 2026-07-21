"use strict";
/**
 * Voorraad-foundation · immutable mutatie-ledger (master-spec h28/E17, R5).
 *
 * Business rules (h28):
 *  - een GEBOEKTE mutatie is onveranderlijk · correctie gebeurt met een
 *    tegenboeking (nooit overschrijven);
 *  - beschikbaar = fysiek min reservaties;
 *  - een telling genereert verschilmutaties, geen overschrijving;
 *  - transfers hebben vertrek en ontvangst als APARTE gebeurtenissen;
 *  - reservatie voorkomt dubbele toewijzing.
 *
 * Voorraadwaarde is altijd herleidbaar tot de volledige mutatiehistoriek. Dit
 * is de foundation; de bestaande eenvoudige "stock"-module blijft bestaan.
 * Geen vendor/SQL (ADR-001).
 */

const { newUlid } = require("./events");
const { round2 } = require("../modules/be-locale");

// Mutatietypes met hun teken op de fysieke voorraad.
const MOVEMENT_TYPES = {
  receipt: +1,          // ontvangst (aankoop/retour in)
  consumption: -1,      // verbruik (werkbon/interne levering)
  transfer_out: -1,     // transfer vertrek
  transfer_in: +1,      // transfer aankomst
  correction: 0,        // tegenboeking/correctie (teken uit qty)
  count_adjustment: 0,  // verschilmutatie uit telling (teken uit qty)
};

function signedQty(type, qty) {
  const sign = MOVEMENT_TYPES[type];
  const n = Number(qty);
  if (sign === 0) return n;                 // correction/count: qty draagt zelf het teken
  return Math.abs(n) * sign;
}

function ensureCollections(store) {
  if (!store.data || typeof store.data !== "object") store.data = {};
  if (!Array.isArray(store.data.stockMovements)) store.data.stockMovements = [];
  if (!Array.isArray(store.data.stockReservations)) store.data.stockReservations = [];
}

/**
 * Boek een onveranderlijke voorraadmutatie.
 * @returns het movement-record
 */
function bookMovement(store, tenantId, input, actor) {
  ensureCollections(store);
  const { articleId, locationId, type, qty, unitCost = 0, sourceType = "manual", sourceId = null, lot = null } = input || {};
  if (!articleId) { const e = new Error("Artikel is verplicht"); e.status = 400; throw e; }
  if (!locationId) { const e = new Error("Locatie is verplicht"); e.status = 400; throw e; }
  if (!MOVEMENT_TYPES.hasOwnProperty(type)) { const e = new Error(`Onbekend mutatietype '${type}'`); e.status = 400; throw e; }
  const delta = signedQty(type, qty);
  if (!Number.isFinite(delta) || delta === 0) { const e = new Error("Hoeveelheid moet een geldig, niet-nul getal zijn"); e.status = 400; throw e; }

  const movement = {
    id: `mv_${newUlid()}`,
    tenantId, articleId, locationId, type,
    qty: round2(delta),
    unitCost: round2(Math.max(0, Number(unitCost) || 0)),
    value: round2(delta * (Number(unitCost) || 0)),
    sourceType, sourceId, lot,
    at: new Date().toISOString(), by: actor || null,
  };
  store.data.stockMovements.push(movement);
  if (store.data.stockMovements.length > 10000) store.data.stockMovements = store.data.stockMovements.slice(-10000);
  if (typeof store.save === "function") store.save();
  return movement;
}

/** Tegenboeking van een bestaande mutatie (h28: correctie = tegenboeking). */
function reverseMovement(store, tenantId, movementId, actor, reason) {
  ensureCollections(store);
  const orig = store.data.stockMovements.find(m => m.id === movementId && m.tenantId === tenantId);
  if (!orig) { const e = new Error("Mutatie niet gevonden"); e.status = 404; throw e; }
  return bookMovement(store, tenantId, {
    articleId: orig.articleId, locationId: orig.locationId,
    type: "correction", qty: -orig.qty, unitCost: orig.unitCost,
    sourceType: "reversal", sourceId: orig.id, lot: orig.lot,
  }, actor);
}

/** Fysiek + gereserveerd + beschikbaar voor een artikel op een locatie. */
function level(store, tenantId, articleId, locationId) {
  ensureCollections(store);
  const physical = round2(store.data.stockMovements
    .filter(m => m.tenantId === tenantId && m.articleId === articleId && m.locationId === locationId)
    .reduce((s, m) => s + Number(m.qty || 0), 0));
  const reserved = round2(store.data.stockReservations
    .filter(r => r.tenantId === tenantId && r.articleId === articleId && r.locationId === locationId && r.status === "active")
    .reduce((s, r) => s + Number(r.qty || 0), 0));
  return { articleId, locationId, physical, reserved, available: round2(physical - reserved) };
}

/**
 * Mutatiehistoriek, nieuwste eerst (frontend-coverage punt 4: detail-
 * traceerbaarheid vanuit het voorraadniveau). Tenant-gescopet leescontract
 * over de bestaande ledger · geen tweede datalaag.
 */
function listMovements(store, tenantId, { articleId, locationId, limit = 100 } = {}) {
  ensureCollections(store);
  return store.data.stockMovements
    .filter(m => m.tenantId === tenantId
      && (!articleId || m.articleId === articleId)
      && (!locationId || m.locationId === locationId))
    // Tiebreak op id (ULID = tijd-geordend): twee boekingen binnen dezelfde
    // milliseconde hebben hetzelfde `at` en zouden anders onstabiel sorteren.
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")) || String(b.id || "").localeCompare(String(a.id || "")))
    .slice(0, Math.min(Math.max(1, Number(limit) || 100), 500));
}

/** Reservatiehistoriek · standaard alleen actieve, met status-filter. */
function listReservations(store, tenantId, { articleId, locationId, status = "active" } = {}) {
  ensureCollections(store);
  return store.data.stockReservations
    .filter(r => r.tenantId === tenantId
      && (!articleId || r.articleId === articleId)
      && (!locationId || r.locationId === locationId)
      && (status === "all" || r.status === status))
    .sort((a, b) => String(b.at || b.createdAt || "").localeCompare(String(a.at || a.createdAt || "")) || String(b.id || "").localeCompare(String(a.id || "")));
}

/** Geaggregeerde voorraad per artikel+locatie (uit de ledger). */
function listLevels(store, tenantId, opts = {}) {
  ensureCollections(store);
  const keys = new Map();
  for (const m of store.data.stockMovements.filter(m => m.tenantId === tenantId)) {
    if (opts.articleId && m.articleId !== opts.articleId) continue;
    if (opts.locationId && m.locationId !== opts.locationId) continue;
    keys.set(`${m.articleId}@${m.locationId}`, { articleId: m.articleId, locationId: m.locationId });
  }
  return [...keys.values()].map(k => level(store, tenantId, k.articleId, k.locationId));
}

/**
 * Reserveer voorraad (voorkomt dubbele toewijzing, h28). Faalt als er
 * onvoldoende beschikbaar is (tenzij negatieve voorraad expliciet toegestaan).
 */
function reserve(store, tenantId, input, actor) {
  ensureCollections(store);
  const { articleId, locationId, qty, sourceType = "manual", sourceId = null, allowNegative = false } = input || {};
  if (!articleId || !locationId) { const e = new Error("Artikel en locatie zijn verplicht"); e.status = 400; throw e; }
  const amount = Math.abs(Number(qty) || 0);
  if (!amount) { const e = new Error("Hoeveelheid moet groter dan nul zijn"); e.status = 400; throw e; }
  const { available } = level(store, tenantId, articleId, locationId);
  if (amount > available && !allowNegative) {
    const e = new Error(`Onvoldoende beschikbaar (${available}) om ${amount} te reserveren`); e.status = 409; e.code = "INSUFFICIENT_STOCK"; e.available = available; throw e;
  }
  const reservation = {
    id: `rs_${newUlid()}`, tenantId, articleId, locationId,
    qty: round2(amount), status: "active", sourceType, sourceId,
    at: new Date().toISOString(), by: actor || null,
  };
  store.data.stockReservations.push(reservation);
  if (typeof store.save === "function") store.save();
  return reservation;
}

/** Geef een reservatie vrij (of boek ze om naar verbruik via de route). */
function release(store, tenantId, reservationId) {
  ensureCollections(store);
  const r = store.data.stockReservations.find(x => x.id === reservationId && x.tenantId === tenantId);
  if (!r) { const e = new Error("Reservatie niet gevonden"); e.status = 404; throw e; }
  if (r.status !== "active") return r;
  r.status = "released"; r.releasedAt = new Date().toISOString();
  if (typeof store.save === "function") store.save();
  return r;
}

/** Transfer als twee aparte gebeurtenissen (h28): vertrek + aankomst. */
function transfer(store, tenantId, input, actor) {
  const { articleId, fromLocationId, toLocationId, qty, unitCost = 0, allowNegative = false } = input || {};
  if (!fromLocationId || !toLocationId) { const e = new Error("Van- en naar-locatie zijn verplicht"); e.status = 400; throw e; }
  if (fromLocationId === toLocationId) { const e = new Error("Van- en naar-locatie mogen niet gelijk zijn"); e.status = 400; throw e; }
  const amount = Math.abs(Number(qty) || 0);
  const { available } = level(store, tenantId, articleId, fromLocationId);
  if (amount > available && !allowNegative) { const e = new Error(`Onvoldoende beschikbaar (${available}) om ${amount} te transfereren`); e.status = 409; e.code = "INSUFFICIENT_STOCK"; throw e; }
  const transferId = `tr_${newUlid()}`;
  const out = bookMovement(store, tenantId, { articleId, locationId: fromLocationId, type: "transfer_out", qty: amount, unitCost, sourceType: "transfer", sourceId: transferId }, actor);
  const inn = bookMovement(store, tenantId, { articleId, locationId: toLocationId, type: "transfer_in", qty: amount, unitCost, sourceType: "transfer", sourceId: transferId }, actor);
  return { transferId, out, in: inn };
}

/**
 * Telling: boek verschilmutaties t.o.v. de getelde hoeveelheid (h28: telling
 * genereert verschilmutaties, geen overschrijving). @param counts [{articleId, locationId, countedQty}]
 */
function bookCount(store, tenantId, counts, actor) {
  const adjustments = [];
  for (const c of Array.isArray(counts) ? counts : []) {
    const { physical } = level(store, tenantId, c.articleId, c.locationId);
    const diff = round2(Number(c.countedQty) - physical);
    if (diff !== 0) {
      adjustments.push(bookMovement(store, tenantId, { articleId: c.articleId, locationId: c.locationId, type: "count_adjustment", qty: diff, sourceType: "count", sourceId: c.countId || null }, actor));
    }
  }
  return { adjustments, count: adjustments.length };
}

module.exports = {
  MOVEMENT_TYPES, signedQty,
  bookMovement, reverseMovement, level, listLevels, listMovements, listReservations,
  reserve, release, transfer, bookCount,
};
