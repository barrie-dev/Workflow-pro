/* ============================================================
   IA-14 · Resources-domein (IA handover §7/§8)

   Contract: "Consolidate stock/inventory, fleet and assets."
   Acceptatie: "Movement-led stock; no parallel quantity source."

   De acceptatie-eis benoemt de klassieke voorraadfout: twee bronnen voor
   dezelfde hoeveelheid.

   Zodra er ergens een veld `quantityOnHand` bestaat DAT LOS BIJGEWERKT
   WORDT, heb je twee waarheden. De ene komt uit de bewegingen (ontvangst,
   verbruik, correctie), de andere uit dat veld. Die twee lopen uit elkaar
   zodra er één beweging misgaat, en dan weet niemand meer welk getal
   klopt. Het is bovendien de fout die je pas maanden later ziet.

   De regel: DE BEWEGINGEN ZIJN DE WAARHEID. De voorraad is hun som, en
   verder niets. Een cachewaarde mag bestaan voor snelheid, maar moet
   afleidbaar en controleerbaar zijn · en als hij afwijkt, wint de som.

   Wagenpark en assets komen hier samen omdat ze dezelfde vragen stellen:
   waar is het, wie gebruikt het, wanneer moet het onderhouden worden.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpWorkspaces = root.wfpWorkspaces || {}; root.wfpWorkspaces.resources = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const DEFINITION = {
    id: "resources.catalog",
    recordBase: "/app/resources/catalog",
    idParam: "articleId",
    defaultTab: "overview",
    tabs: [
      { id: "overview", labelKey: "article.tab.overview", permission: "inventory.view" },
      { id: "stock", labelKey: "article.tab.stock", permission: "inventory.view", countSource: "article.stock" },
      { id: "movements", labelKey: "article.tab.movements", permission: "inventory.view", countSource: "article.movements" },
      { id: "suppliers", labelKey: "article.tab.suppliers", permission: "procurement.view", entitlement: "procurement", countSource: "article.suppliers" },
      // Inkoopprijs en marge zijn kostinformatie · eigen recht.
      { id: "pricing", labelKey: "article.tab.pricing", permission: "costs.view" },
      { id: "activity", labelKey: "article.tab.activity", permission: "inventory.view" },
    ],
  };

  const ASSET_DEFINITION = {
    id: "resources.assets",
    recordBase: "/app/resources/assets",
    idParam: "assetId",
    defaultTab: "overview",
    tabs: [
      { id: "overview", labelKey: "asset.tab.overview", permission: "assets.view" },
      { id: "assignment", labelKey: "asset.tab.assignment", permission: "assets.view", countSource: "asset.assignment" },
      { id: "maintenance", labelKey: "asset.tab.maintenance", permission: "assets.view", countSource: "asset.maintenance" },
      { id: "documents", labelKey: "asset.tab.documents", permission: "assets.view", countSource: "asset.documents" },
      { id: "costs", labelKey: "asset.tab.costs", permission: "costs.view" },
      { id: "activity", labelKey: "asset.tab.activity", permission: "assets.view" },
    ],
  };

  // Bewegingssoorten en hun teken. Alles wat de voorraad verandert is een
  // beweging · er is geen andere weg naar binnen of naar buiten.
  const MOVEMENT_TYPES = {
    receipt: 1,          // ontvangst van een leverancier
    return_in: 1,        // retour van een werf
    adjustment_in: 1,    // telcorrectie omhoog
    transfer_in: 1,      // van een ander magazijn
    consumption: -1,     // verbruikt op een werkbon
    return_out: -1,      // retour naar de leverancier
    adjustment_out: -1,  // telcorrectie omlaag
    transfer_out: -1,    // naar een ander magazijn
    scrap: -1,           // afgeschreven
  };

  /**
   * De voorraad is de SOM van de bewegingen. Deze functie is de enige
   * bron van het getal.
   */
  function stockFromMovements(movements, { articleId, warehouseId } = {}) {
    let som = 0;
    for (const m of movements || []) {
      if (articleId && m.articleId !== articleId) continue;
      if (warehouseId && m.warehouseId !== warehouseId) continue;
      const teken = MOVEMENT_TYPES[m.type];
      if (teken === undefined) continue;
      som += teken * Math.abs(Number(m.quantity) || 0);
    }
    return Math.round(som * 1000) / 1000;
  }

  /**
   * Elke beweging draagt zijn herkomst · anders kun je een verschil niet
   * uitzoeken. "Waar is die twintig meter kabel gebleven" moet altijd te
   * beantwoorden zijn.
   */
  const MOVEMENT_SOURCES = ["work_order", "purchase_order", "stock_count", "transfer", "manual_correction", "return"];

  function checkMovement(m) {
    const overtredingen = [];
    if (!m || !m.articleId) overtredingen.push({ field: "articleId", reason: "MISSING_CANONICAL_LINK" });
    if (!m || !m.warehouseId) overtredingen.push({ field: "warehouseId", reason: "MISSING_WAREHOUSE" });
    if (!m || MOVEMENT_TYPES[m.type] === undefined) overtredingen.push({ field: "type", reason: "UNKNOWN_MOVEMENT_TYPE" });
    if (!m || !Number(m.quantity)) overtredingen.push({ field: "quantity", reason: "ZERO_QUANTITY" });
    if (!m || !m.sourceType) overtredingen.push({ field: "sourceType", reason: "MISSING_SOURCE" });
    else if (!MOVEMENT_SOURCES.includes(m.sourceType)) overtredingen.push({ field: "sourceType", reason: "UNKNOWN_SOURCE" });
    // Een handmatige correctie MOET een reden dragen · anders is het een
    // getal dat iemand goed uitkwam.
    if (m && m.sourceType === "manual_correction" && !m.reason) {
      overtredingen.push({ field: "reason", reason: "CORRECTION_NEEDS_REASON" });
    }
    return { ok: overtredingen.length === 0, violations: overtredingen };
  }

  /**
   * Verifieer een gecachte voorraadwaarde tegen de bewegingen.
   *
   * Een cache mag bestaan voor snelheid, maar hij is nooit de waarheid.
   * Wijkt hij af, dan wint de som en is er iets te onderzoeken.
   */
  function reconcileStock(cached, movements, scope) {
    const berekend = stockFromMovements(movements, scope);
    const verschil = Math.round((Number(cached) - berekend) * 1000) / 1000;
    return {
      calculated: berekend,
      cached: Number(cached),
      drift: verschil,
      ok: verschil === 0,
      // De som wint altijd · de UI toont dit getal, niet de cache.
      authoritative: berekend,
    };
  }

  /**
   * Controleer dat een artikelrecord geen eigen hoeveelheidsveld draagt.
   * Dit is de acceptatie-eis "no parallel quantity source", afdwingbaar
   * gemaakt: zodra iemand `quantityOnHand` op het artikel zet, faalt dit.
   */
  const FORBIDDEN_QUANTITY_FIELDS = ["quantityOnHand", "stockLevel", "currentStock", "voorraad", "qtyInStock"];

  function checkNoParallelQuantity(article) {
    const gevonden = FORBIDDEN_QUANTITY_FIELDS.filter(f => article && article[f] !== undefined);
    return {
      ok: gevonden.length === 0,
      violations: gevonden.map(f => ({ field: f, reason: "PARALLEL_QUANTITY_SOURCE" })),
    };
  }

  /**
   * Onderhoudsstatus van een asset of voertuig. Één berekening voor beide,
   * want het is dezelfde vraag: wanneer moet dit ding weer gekeurd worden.
   */
  function maintenanceState(asset, now) {
    const nu = new Date(now).getTime();
    const due = asset && asset.nextMaintenanceAt ? new Date(asset.nextMaintenanceAt).getTime() : null;
    if (!due) return { state: "unknown", daysLeft: null };
    const dagen = Math.floor((due - nu) / 86400000);
    if (dagen < 0) return { state: "overdue", daysLeft: dagen };
    if (dagen <= 30) return { state: "due_soon", daysLeft: dagen };
    return { state: "ok", daysLeft: dagen };
  }

  return {
    DEFINITION, ASSET_DEFINITION, MOVEMENT_TYPES, MOVEMENT_SOURCES, FORBIDDEN_QUANTITY_FIELDS,
    stockFromMovements, checkMovement, reconcileStock, checkNoParallelQuantity, maintenanceState,
  };
});
