"use strict";
/**
 * Catalogus & materiaal · artikelen, eenheden, prijzen, samenstelling
 * (master-spec h20/E13, R-CAT · /v1/art).
 *
 * Een gedeelde bibliotheek voor materiaal, arbeid, materieel, onderaanneming,
 * samengestelde producten en vrije commerciële lijnen. Nadrukkelijk GEEN
 * verplicht kernscherm: artikelen voeden offerte, order, werkbon en factuur.
 *
 * Kernprincipes uit de business rules (h20):
 *  - Kostprijs en verkoopprijs worden AFZONDERLIJK opgeslagen (marge op verkoop
 *    is niet hetzelfde als opslag op kost · de UI maakt dat expliciet).
 *  - Prijsprioriteit is expliciet: klantspecifiek > prijsgroep > artikelstrategie
 *    > handmatig. resolvePrice() geeft altijd prijs + bron + prijsdatum terug.
 *  - Artikelprijswijzigingen wijzigen NOOIT stilzwijgend bestaande documenten:
 *    documentlijnen bewaren een snapshot (naam, prijs, btw, eenheid, kostprijs).
 *    snapshotForLine() levert die onveranderlijke kopie.
 *  - Alternatieve eenheden gebruiken een vaste conversiefactor met afronding.
 *  - Samengestelde artikels leveren een controleerbare kostopbouw (explode).
 *  - Een uitgefaseerd artikel blijft zichtbaar in historiek maar is niet
 *    standaard selecteerbaar.
 *  - Voorraad- en niet-voorraadartikels volgen verschillende boekingsregels
 *    (stockTracked-vlag · inventory/procurement lezen die).
 *
 * Compatibility-repository (ULID, version/optimistic locking, technische velden,
 * statemachine). Cloudblind (ADR-001): geen SDK, geen SQL, geen env.
 */

const { newUlid } = require("./events");
const { round2 } = require("../modules/be-locale");

const ARTICLE_TYPES = ["material", "labor", "equipment", "subcontracting", "composite", "free"];
const LINE_TYPES = ["product", "service"];
const VAT_RATES = [0, 6, 12, 21];
const COST_STRATEGIES = ["manual", "last_purchase", "average", "supplier"];
const SALES_STRATEGIES = ["manual", "margin_on_cost", "markup_on_cost", "price_list"];
const STATUSES = ["draft", "active", "temporarily_unavailable", "phased_out", "archived"];
const STATUS_TRANSITIONS = {
  draft: ["active", "archived"],
  active: ["temporarily_unavailable", "phased_out", "archived"],
  temporarily_unavailable: ["active", "phased_out", "archived"],
  phased_out: ["active", "archived"],       // reactiveerbaar; blijft in historiek
  archived: [],
};
// Alleen deze statussen zijn standaard selecteerbaar in nieuwe documenten (h20).
const SELECTABLE_STATUSES = ["active"];
const PRICE_SCOPES = ["customer", "price_group", "all"];
const MAX_COMPOSITION_DEPTH = 8;            // recursieguard voor samenstellingen

function clean(v) { return String(v == null ? "" : v).trim(); }
function isoDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : null; }
function num(v, dflt = 0) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }
function vatOf(v) { return VAT_RATES.includes(Number(v)) ? Number(v) : 21; }
function canTransition(from, to) { return (STATUS_TRANSITIONS[from] || []).includes(to); }

/**
 * Continu artikelnummer (ART-nnnn) · persistent en NIET jaargebonden (artikelen
 * resetten niet per jaar, anders botsen ART-1/2026 en ART-1/2027). Eigen reeks
 * in numberSequences met sentinel-jaar 0; seed't vanaf het hoogste bestaande
 * nummer zodat deletes nooit een nummer hergebruiken.
 */
function nextArticleNumber(store, tenantId) {
  if (!store.data || typeof store.data !== "object") store.data = {};
  if (!Array.isArray(store.data.numberSequences)) store.data.numberSequences = [];
  let row = store.data.numberSequences.find(s => s.tenantId === tenantId && s.docType === "article");
  if (!row) {
    const existing = (store.data.articles || [])
      .filter(a => a.tenantId === tenantId && /^ART-\d+$/.test(String(a.number || "")))
      .map(a => Number(String(a.number).split("-").pop()))
      .filter(Number.isFinite);
    row = { id: `seq_${newUlid()}`, tenantId, companyId: null, docType: "article", year: 0, nextSeq: (existing.length ? Math.max(...existing) : 0) + 1, updatedAt: new Date().toISOString() };
    store.data.numberSequences.push(row);
  }
  const seq = row.nextSeq;
  row.nextSeq = seq + 1;
  row.updatedAt = new Date().toISOString();
  if (typeof store.save === "function") store.save();
  return `ART-${String(seq).padStart(4, "0")}`;
}

// ── Artikel normalisatie ─────────────────────────────────────────────────────
function normalizeUnit(u, fallback = "st") {
  const s = clean(u).toLowerCase();
  return s || fallback;
}

/** Alternatieve eenheden: vaste conversiefactor + afrondingsregel (h20). */
function normalizeAltUnits(input) {
  return (Array.isArray(input) ? input : [])
    .map(a => {
      const unit = normalizeUnit(a && a.unit, "");
      const factor = num(a && a.factor, 0);
      if (!unit || factor <= 0) return null;
      const rounding = ["none", "up", "down", "nearest"].includes(a.rounding) ? a.rounding : "nearest";
      return { unit, factor: round2(factor), rounding };
    })
    .filter(Boolean)
    .slice(0, 12);
}

/** Leveranciersprijzen: bruto, korting, netto, prijsdatum en bron (h20). */
function normalizeSupplierRefs(input) {
  return (Array.isArray(input) ? input : [])
    .map(r => {
      const supplierId = clean(r && r.supplierId);
      if (!supplierId) return null;
      const gross = Math.max(0, num(r.grossPrice ?? r.gross, 0));
      const discountPct = Math.max(0, Math.min(100, num(r.discountPct ?? r.discount, 0)));
      const net = r.netPrice != null ? Math.max(0, num(r.netPrice)) : round2(gross * (1 - discountPct / 100));
      return {
        supplierId,
        supplierRef: clean(r.supplierRef || r.ref),
        grossPrice: round2(gross),
        discountPct: round2(discountPct),
        netPrice: round2(net),
        priceDate: isoDate(r.priceDate) || null,
        source: clean(r.source) || "manual",
      };
    })
    .filter(Boolean)
    .slice(0, 50);
}

/** Samenstelling: onderdelen met hoeveelheid (kostopbouw via explode). */
function normalizeComposition(input) {
  return (Array.isArray(input) ? input : [])
    .map(c => {
      const articleId = clean(c && c.articleId);
      const qty = num(c && c.qty, 0);
      if (!articleId || qty <= 0) return null;
      return { articleId, qty: round2(qty), optional: c.optional === true };
    })
    .filter(Boolean)
    .slice(0, 100);
}

function normalizeArticle(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  const name = clean(merged.name || merged.internalName);
  if (!name) { const e = new Error("Artikelnaam is verplicht"); e.status = 400; throw e; }
  const type = ARTICLE_TYPES.includes(merged.type) ? merged.type : "material";
  // Diensten/arbeid/onderaanneming zijn standaard niet-voorraad; materiaal wel.
  const defaultStock = type === "material" || type === "equipment";
  const stockTracked = merged.stockTracked != null ? merged.stockTracked === true : defaultStock;

  const composition = type === "composite" ? normalizeComposition(merged.composition) : [];
  if (type === "composite" && !composition.length) {
    const e = new Error("Een samengesteld artikel heeft minstens één onderdeel nodig"); e.status = 400; throw e;
  }

  return {
    name,
    salesName: clean(merged.salesName) || name,
    // Verkoopnaam per taal (optioneel) · historische lijnen snapshotten de naam.
    salesNameI18n: merged.salesNameI18n && typeof merged.salesNameI18n === "object"
      ? { nl: clean(merged.salesNameI18n.nl), fr: clean(merged.salesNameI18n.fr), en: clean(merged.salesNameI18n.en) }
      : null,
    barcode: clean(merged.barcode),
    type,
    lineType: LINE_TYPES.includes(merged.lineType) ? merged.lineType : (type === "labor" || type === "service" ? "service" : "product"),
    articleGroup: clean(merged.articleGroup),
    activity: clean(merged.activity),
    unit: normalizeUnit(merged.unit),
    altUnits: normalizeAltUnits(merged.altUnits),
    minOrderQty: Math.max(0, num(merged.minOrderQty, 0)),
    minStock: Math.max(0, num(merged.minStock, 0)),
    desiredStock: Math.max(0, num(merged.desiredStock, 0)),
    vatRate: vatOf(merged.vatRate),
    salesAccount: clean(merged.salesAccount),
    purchaseAccount: clean(merged.purchaseAccount),
    weightKg: Math.max(0, num(merged.weightKg ?? merged.weight, 0)),
    // Kost en verkoop AFZONDERLIJK (h20-acceptatie).
    costPrice: round2(Math.max(0, num(merged.costPrice, 0))),
    salesPrice: round2(Math.max(0, num(merged.salesPrice, 0))),
    costStrategy: COST_STRATEGIES.includes(merged.costStrategy) ? merged.costStrategy : "manual",
    salesStrategy: SALES_STRATEGIES.includes(merged.salesStrategy) ? merged.salesStrategy : "manual",
    marginPct: Math.max(0, num(merged.marginPct, 0)),   // voor margin_on_cost / markup_on_cost
    supplierRefs: normalizeSupplierRefs(merged.supplierRefs),
    composition,
    compositionMode: ["exploded", "merged", "both"].includes(merged.compositionMode) ? merged.compositionMode : "merged",
    stockTracked,
    serialTracked: merged.serialTracked === true,
    webshopVisible: merged.webshopVisible === true,
  };
}

// ── Prijsstrategie (verkoop) ────────────────────────────────────────────────
/** Leidt de verkoopprijs uit de strategie af zonder prijsregel/klant-context. */
function strategyPrice(article) {
  const cost = num(article.costPrice, 0);
  switch (article.salesStrategy) {
    case "margin_on_cost": {
      // Verkoop zó dat marge = marginPct van de VERKOOPPRIJS (h20: marge ≠ opslag).
      const m = Math.min(99.9, num(article.marginPct, 0)) / 100;
      return m < 1 ? round2(cost / (1 - m)) : num(article.salesPrice, 0);
    }
    case "markup_on_cost":
      return round2(cost * (1 + num(article.marginPct, 0) / 100));
    case "manual":
    case "price_list":
    default:
      return round2(num(article.salesPrice, 0));
  }
}

/**
 * Bepaal de verkoopprijs met expliciete prioriteit (h20):
 *   klantspecifiek > prijsgroep > artikelstrategie > handmatig.
 * Geeft { unitPrice, source, priceDate, priceRuleId } terug · altijd herleidbaar.
 */
function resolvePrice(store, tenant, article, { customerId = null, priceGroup = null, manualPrice = null, at = null } = {}) {
  const today = isoDate(at) || new Date().toISOString().slice(0, 10);
  const rules = (store.list("priceRules", tenant.id) || [])
    .filter(r => r.articleId === article.id && (!r.validFrom || r.validFrom <= today))
    .sort((a, b) => String(b.validFrom || "").localeCompare(String(a.validFrom || "")));

  // 1) Klantspecifiek
  if (customerId) {
    const r = rules.find(x => x.scope === "customer" && x.customerId === customerId);
    if (r) return { unitPrice: round2(num(r.price)), source: "customer", priceDate: r.validFrom || today, priceRuleId: r.id };
  }
  // 2) Prijsgroep
  if (priceGroup) {
    const r = rules.find(x => x.scope === "price_group" && x.priceGroup === priceGroup);
    if (r) return { unitPrice: round2(num(r.price)), source: "price_group", priceDate: r.validFrom || today, priceRuleId: r.id };
  }
  // 3) Algemene prijsregel
  const rAll = rules.find(x => x.scope === "all");
  if (rAll) return { unitPrice: round2(num(rAll.price)), source: "price_rule", priceDate: rAll.validFrom || today, priceRuleId: rAll.id };
  // 4) Handmatige override op het document
  if (manualPrice != null && Number.isFinite(Number(manualPrice))) {
    return { unitPrice: round2(num(manualPrice)), source: "manual", priceDate: today, priceRuleId: null };
  }
  // 5) Artikelstrategie / stamverkoopprijs
  return { unitPrice: strategyPrice(article), source: "article_strategy", priceDate: today, priceRuleId: null };
}

/**
 * Onveranderlijke documentlijn-snapshot (h20-business rule): naam, prijs, btw,
 * eenheid EN kostprijs worden vastgeklikt zodat een latere stamwijziging het
 * bestaande document nooit verandert. Deze snapshot is wat offerte/order/
 * werkbon/factuur bewaren; de artikelverwijzing is louter herkomst.
 */
function snapshotForLine(store, tenant, article, { qty = 1, unit = null, customerId = null, priceGroup = null, manualPrice = null, at = null } = {}) {
  const resolved = resolvePrice(store, tenant, article, { customerId, priceGroup, manualPrice, at });
  const usedUnit = normalizeUnit(unit || article.unit);
  const quantity = round2(Math.max(0, num(qty, 1)));
  return {
    articleId: article.id,
    articleNumber: article.number,
    description: article.salesName || article.name,
    type: article.type,
    lineType: article.lineType,
    qty: quantity,
    unit: usedUnit,
    unitPrice: resolved.unitPrice,
    vatRate: article.vatRate,
    // Gerealiseerde kosten gebruiken kostprijs, niet verkoopprijs (h20/h35).
    costPrice: round2(num(article.costPrice, 0)),
    lineTotal: round2(quantity * resolved.unitPrice),
    lineCost: round2(quantity * num(article.costPrice, 0)),
    // Herleidbaarheid voor calculator én aankoper (acceptatie h20).
    priceSource: resolved.source,
    priceDate: resolved.priceDate,
    priceRuleId: resolved.priceRuleId,
    stockTracked: article.stockTracked === true,
    snapshotAt: new Date().toISOString(),
  };
}

/**
 * Kostopbouw van een (samengesteld) artikel · controleerbaar (h20-acceptatie).
 * Klapt onderdelen recursief uit met kostprijs en totaal; guard tegen cycli.
 */
function explodeComposition(store, tenant, article, qty = 1, depth = 0, seen = new Set()) {
  const quantity = round2(Math.max(0, num(qty, 1)));
  if (article.type !== "composite" || !Array.isArray(article.composition) || !article.composition.length) {
    const unitCost = round2(num(article.costPrice, 0));
    return { articleId: article.id, number: article.number, name: article.name, qty: quantity, unitCost, totalCost: round2(unitCost * quantity), components: [] };
  }
  if (depth >= MAX_COMPOSITION_DEPTH || seen.has(article.id)) {
    const e = new Error("Samenstelling bevat een cyclus of is te diep genest"); e.status = 409; e.code = "COMPOSITION_CYCLE"; throw e;
  }
  const nextSeen = new Set(seen); nextSeen.add(article.id);
  const components = [];
  let unitCost = 0;
  for (const part of article.composition) {
    const child = (store.list("articles", tenant.id) || []).find(a => a.id === part.articleId);
    if (!child) { components.push({ articleId: part.articleId, name: "(onbekend artikel)", qty: part.qty, unitCost: 0, totalCost: 0, missing: true }); continue; }
    const sub = explodeComposition(store, tenant, child, part.qty, depth + 1, nextSeen);
    unitCost = round2(unitCost + sub.totalCost);
    components.push(sub);
  }
  return { articleId: article.id, number: article.number, name: article.name, qty: quantity, unitCost, totalCost: round2(unitCost * quantity), components };
}

/** Eenheidsconversie via vaste factor + afrondingsregel (h20). */
function convertQuantity(article, qty, fromUnit, toUnit) {
  const from = normalizeUnit(fromUnit, article.unit);
  const to = normalizeUnit(toUnit, article.unit);
  if (from === to) return round2(num(qty));
  const base = article.unit;
  const factorTo = u => (u === base ? 1 : (article.altUnits.find(a => a.unit === u) || {}).factor);
  const fFrom = factorTo(from), fTo = factorTo(to);
  if (!fFrom || !fTo) { const e = new Error(`Geen conversie tussen '${from}' en '${to}'`); e.status = 400; throw e; }
  const round = (val, rule) => rule === "up" ? Math.ceil(val) : rule === "down" ? Math.floor(val) : rule === "nearest" ? Math.round(val) : val;
  const rule = to === base ? "none" : (article.altUnits.find(a => a.unit === to) || {}).rounding || "nearest";
  // qty[from] → basis → to
  const inBase = num(qty) * fFrom;
  return round2(round(inBase / fTo, rule));
}

// ── Repository ───────────────────────────────────────────────────────────────
function makeCatalogRepository(store) {
  const col = "articles";
  const repo = {
    list(tenantId, { includeArchived = false, selectableOnly = false } = {}) {
      let rows = (store.list(col, tenantId) || []).slice();
      if (selectableOnly) rows = rows.filter(a => SELECTABLE_STATUSES.includes(a.status));
      else if (!includeArchived) rows = rows.filter(a => a.status !== "archived");
      return rows.sort((a, b) => String(a.number || "").localeCompare(String(b.number || "")));
    },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(a => a.id === id) || null; },
    insert(tenantId, payload, actor) {
      const normalized = normalizeArticle(payload, null);
      const number = nextArticleNumber(store, tenantId);
      const now = new Date().toISOString();
      const row = store.insert(col, {
        id: `art_${newUlid()}`, tenantId, number,
        ...normalized,
        status: "draft",
        version: 1, createdAt: now, createdBy: actor || null, updatedAt: now, updatedBy: actor || null, archivedAt: null, archivedBy: null,
      });
      return row;
    },
    update(tenantId, id, patch, actor, expectedVersion) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Artikel niet gevonden"); e.status = 404; throw e; }
      if (existing.status === "archived") { const e = new Error("Een gearchiveerd artikel kan niet worden gewijzigd"); e.status = 409; e.code = "ARCHIVED"; throw e; }
      if (expectedVersion != null && Number(existing.version || 1) !== Number(expectedVersion)) {
        const e = new Error("Het artikel is intussen gewijzigd."); e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = existing.version || 1; throw e;
      }
      const normalized = normalizeArticle(patch, existing);
      const priceChanged = round2(num(normalized.salesPrice)) !== round2(num(existing.salesPrice)) || round2(num(normalized.costPrice)) !== round2(num(existing.costPrice));
      const updated = store.update(col, id, { ...normalized, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
      return { article: updated, priceChanged };
    },
    transition(tenantId, id, to, actor) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Artikel niet gevonden"); e.status = 404; throw e; }
      const from = existing.status || "draft";
      if (from === to) return existing;
      if (!canTransition(from, to)) { const e = new Error(`Ongeldige statusovergang: ${from} → ${to}`); e.status = 409; e.code = "INVALID_TRANSITION"; throw e; }
      const patch = { status: to, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null };
      if (to === "archived") { patch.archivedAt = new Date().toISOString(); patch.archivedBy = actor || null; }
      return store.update(col, id, patch);
    },
    // Prijsregels (prijslijst) ──────────────────────────────────────────────
    listPriceRules(tenantId, articleId = null) {
      return (store.list("priceRules", tenantId) || [])
        .filter(r => !articleId || r.articleId === articleId)
        .sort((a, b) => String(b.validFrom || "").localeCompare(String(a.validFrom || "")));
    },
    addPriceRule(tenantId, payload, actor) {
      const articleId = clean(payload && payload.articleId);
      if (!articleId || !this.findById(tenantId, articleId)) { const e = new Error("Geldig articleId is vereist"); e.status = 400; throw e; }
      const scope = PRICE_SCOPES.includes(payload.scope) ? payload.scope : "all";
      if (scope === "customer" && !clean(payload.customerId)) { const e = new Error("Klantspecifieke prijsregel vereist customerId"); e.status = 400; throw e; }
      if (scope === "price_group" && !clean(payload.priceGroup)) { const e = new Error("Prijsgroepregel vereist priceGroup"); e.status = 400; throw e; }
      const price = num(payload.price, NaN);
      if (!Number.isFinite(price) || price < 0) { const e = new Error("Geldige prijs is vereist"); e.status = 400; throw e; }
      const now = new Date().toISOString();
      return store.insert("priceRules", {
        id: `pr_${newUlid()}`, tenantId, articleId, scope,
        customerId: scope === "customer" ? clean(payload.customerId) : null,
        priceGroup: scope === "price_group" ? clean(payload.priceGroup) : null,
        price: round2(price),
        validFrom: isoDate(payload.validFrom) || now.slice(0, 10),
        note: clean(payload.note),
        version: 1, createdAt: now, createdBy: actor || null,
      });
    },
    removePriceRule(tenantId, id) {
      const r = (store.list("priceRules", tenantId) || []).find(x => x.id === id);
      if (!r) { const e = new Error("Prijsregel niet gevonden"); e.status = 404; throw e; }
      store.remove("priceRules", id);
      return { ok: true };
    },
  };
  return repo;
}

module.exports = {
  ARTICLE_TYPES, LINE_TYPES, STATUSES, PRICE_SCOPES, SELECTABLE_STATUSES,
  normalizeArticle, strategyPrice, resolvePrice, snapshotForLine, explodeComposition, convertQuantity,
  makeCatalogRepository,
};
