// src/modules/stock.js
// Voorraad per werf · min/max alerts · mutatiehistoriek · reservaties voor werkbonnen

function apiError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const MUTATION_TYPES = new Set(["aanvulling", "gebruik", "transfer", "correctie", "reservatie", "vrijgave"]);

// ─── helpers ─────────────────────────────────────────────────────────────────

function stockItem(store, tenantId, itemId) {
  const item = store.get("stock", itemId);
  if (!item || item.tenantId !== tenantId) throw apiError("Stockartikel niet gevonden", 404);
  return item;
}

function alertLevel(item) {
  if (item.qty == null) return "unknown";
  if (item.minQty != null && item.qty <= 0) return "leeg";
  if (item.minQty != null && item.qty <= item.minQty) return "kritiek";
  if (item.minQty != null && item.qty <= item.minQty * 1.5) return "laag";
  return "ok";
}

function reservedQty(store, tenantId, stockItemId) {
  return store
    .list("stockMutations", tenantId)
    .filter(m => m.stockItemId === stockItemId && m.type === "reservatie" && m.status === "actief")
    .reduce((sum, m) => sum + Math.abs(m.delta || 0), 0);
}

// ─── lijst & detail ───────────────────────────────────────────────────────────

function listStock(store, tenantId, options = {}) {
  let items = store.list("stock", tenantId);

  if (options.venueId) items = items.filter(i => i.venueId === options.venueId);
  if (options.category) items = items.filter(i => i.category === options.category);
  if (options.alertOnly) items = items.filter(i => ["kritiek", "leeg"].includes(alertLevel(i)));

  const enriched = items.map(item => ({
    ...item,
    alert: alertLevel(item),
    reserved: reservedQty(store, tenantId, item.id),
    available: Math.max(0, (item.qty || 0) - reservedQty(store, tenantId, item.id))
  }));

  const summary = {
    total: enriched.length,
    leeg: enriched.filter(i => i.alert === "leeg").length,
    kritiek: enriched.filter(i => i.alert === "kritiek").length,
    laag: enriched.filter(i => i.alert === "laag").length,
    ok: enriched.filter(i => i.alert === "ok").length
  };

  return { items: enriched, summary };
}

function getStockItem(store, tenantId, itemId) {
  const item = stockItem(store, tenantId, itemId);
  const mutations = store
    .list("stockMutations", tenantId)
    .filter(m => m.stockItemId === itemId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);
  return {
    ...item,
    alert: alertLevel(item),
    reserved: reservedQty(store, tenantId, itemId),
    available: Math.max(0, (item.qty || 0) - reservedQty(store, tenantId, itemId)),
    mutations
  };
}

// ─── aanmaken & aanpassen ─────────────────────────────────────────────────────

function createStockItem(store, tenant, payload, actor) {
  const name = String(payload.name || "").trim();
  if (name.length < 2) throw apiError("Artikelnaam is verplicht (min. 2 tekens)");

  const qty = Number(payload.qty ?? 0);
  const minQty = payload.minQty != null ? Number(payload.minQty) : null;
  const maxQty = payload.maxQty != null ? Number(payload.maxQty) : null;
  if (minQty != null && minQty < 0) throw apiError("Minimumvoorraad mag niet negatief zijn");
  if (maxQty != null && minQty != null && maxQty < minQty) throw apiError("Maximumvoorraad moet groter zijn dan minimumvoorraad");

  const item = store.insert("stock", {
    id: `stock_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    tenantId: tenant.id,
    name,
    sku: String(payload.sku || "").trim() || null,
    unit: String(payload.unit || "stuks").trim(),
    category: String(payload.category || "algemeen").trim(),
    venueId: payload.venueId || null,
    qty,
    minQty,
    maxQty,
    location: String(payload.location || "").trim() || null,
    supplier: String(payload.supplier || "").trim() || null,
    notes: String(payload.notes || "").trim() || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  if (qty !== 0) {
    store.insert("stockMutations", {
      id: `mut_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      tenantId: tenant.id,
      stockItemId: item.id,
      type: "aanvulling",
      delta: qty,
      qtyAfter: qty,
      reason: "Beginvoorraad bij aanmaken",
      actor: actor.email,
      status: "definitief",
      createdAt: new Date().toISOString()
    });
  }

  store.audit({ actor: actor.email, tenantId: tenant.id, action: "stock_item_created", area: "stock", detail: name });
  return getStockItem(store, tenant.id, item.id);
}

function updateStockItem(store, tenant, itemId, payload, actor) {
  const item = stockItem(store, tenant.id, itemId);
  const patch = {};

  if (payload.name != null) {
    const name = String(payload.name).trim();
    if (name.length < 2) throw apiError("Artikelnaam is verplicht");
    patch.name = name;
  }
  if (payload.sku !== undefined) patch.sku = String(payload.sku || "").trim() || null;
  if (payload.unit !== undefined) patch.unit = String(payload.unit || "stuks").trim();
  if (payload.category !== undefined) patch.category = String(payload.category || "algemeen").trim();
  if (payload.venueId !== undefined) patch.venueId = payload.venueId || null;
  if (payload.location !== undefined) patch.location = String(payload.location || "").trim() || null;
  if (payload.supplier !== undefined) patch.supplier = String(payload.supplier || "").trim() || null;
  if (payload.notes !== undefined) patch.notes = String(payload.notes || "").trim() || null;

  const newMin = payload.minQty !== undefined ? (payload.minQty != null ? Number(payload.minQty) : null) : item.minQty;
  const newMax = payload.maxQty !== undefined ? (payload.maxQty != null ? Number(payload.maxQty) : null) : item.maxQty;
  if (newMin != null && newMin < 0) throw apiError("Minimumvoorraad mag niet negatief zijn");
  if (newMax != null && newMin != null && newMax < newMin) throw apiError("Maximumvoorraad moet groter zijn dan minimumvoorraad");
  if (payload.minQty !== undefined) patch.minQty = newMin;
  if (payload.maxQty !== undefined) patch.maxQty = newMax;
  patch.updatedAt = new Date().toISOString();

  store.update("stock", itemId, patch);
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "stock_item_updated", area: "stock", detail: item.name });
  return getStockItem(store, tenant.id, itemId);
}

// ─── mutaties ─────────────────────────────────────────────────────────────────

function addMutation(store, tenant, itemId, payload, actor) {
  const item = stockItem(store, tenant.id, itemId);
  const type = String(payload.type || "").toLowerCase();
  if (!MUTATION_TYPES.has(type)) throw apiError(`Ongeldig mutatietype. Kies uit: ${[...MUTATION_TYPES].join(", ")}`);

  const delta = Number(payload.delta);
  if (!Number.isFinite(delta) || delta === 0) throw apiError("Delta moet een getal zijn (niet nul)");

  // Bij gebruik en reservatie mag de voorraad niet negatief worden
  if (["gebruik", "reservatie"].includes(type)) {
    const available = Math.max(0, (item.qty || 0) - reservedQty(store, tenant.id, itemId));
    if (Math.abs(delta) > available) {
      throw apiError(`Onvoldoende beschikbare voorraad. Beschikbaar: ${available} ${item.unit}`);
    }
  }

  const newQty = type === "reservatie"
    ? item.qty  // reservatie verlaagt beschikbaarheid maar niet de fysieke qty
    : (item.qty || 0) + delta;

  if (newQty < 0) throw apiError("Voorraad kan niet negatief worden");

  const mutation = store.insert("stockMutations", {
    id: `mut_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    tenantId: tenant.id,
    stockItemId: itemId,
    type,
    delta,
    qtyAfter: newQty,
    reason: String(payload.reason || "").trim() || null,
    workorderId: payload.workorderId || null,
    venueId: payload.venueId || item.venueId,
    actor: actor.email,
    status: type === "reservatie" ? "actief" : "definitief",
    createdAt: new Date().toISOString()
  });

  if (type !== "reservatie") {
    store.update("stock", itemId, { qty: newQty, updatedAt: new Date().toISOString() });
  }

  // Transfer: verlaag op bronnwerf, verhoog op doelwerf
  if (type === "transfer" && payload.targetStockItemId) {
    const target = store.get("stock", payload.targetStockItemId);
    if (target && target.tenantId === tenant.id) {
      const targetNewQty = (target.qty || 0) + Math.abs(delta);
      store.update("stock", target.id, { qty: targetNewQty, updatedAt: new Date().toISOString() });
      store.insert("stockMutations", {
        id: `mut_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        tenantId: tenant.id,
        stockItemId: target.id,
        type: "transfer",
        delta: Math.abs(delta),
        qtyAfter: targetNewQty,
        reason: `Transfer ontvangen van ${item.name}`,
        actor: actor.email,
        status: "definitief",
        createdAt: new Date().toISOString()
      });
    }
  }

  store.audit({
    actor: actor.email,
    tenantId: tenant.id,
    action: `stock_${type}`,
    area: "stock",
    detail: `${item.name}: ${delta > 0 ? "+" : ""}${delta} ${item.unit}`
  });

  return getStockItem(store, tenant.id, itemId);
}

function releaseReservation(store, tenant, mutationId, actor) {
  const mutation = store
    .list("stockMutations", tenant.id)
    .find(m => m.id === mutationId && m.type === "reservatie" && m.status === "actief");
  if (!mutation) throw apiError("Actieve reservatie niet gevonden", 404);

  store.update("stockMutations", mutationId, { status: "vrijgegeven", freedAt: new Date().toISOString(), freedBy: actor.email });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "stock_reservatie_vrijgegeven", area: "stock", detail: mutationId });

  return getStockItem(store, tenant.id, mutation.stockItemId);
}

// ─── alerts samenvatting ──────────────────────────────────────────────────────

function stockAlerts(store, tenantId) {
  const items = store.list("stock", tenantId);
  const alerts = items
    .map(item => ({ ...item, alert: alertLevel(item), reserved: reservedQty(store, tenantId, item.id) }))
    .filter(item => item.alert !== "ok" && item.alert !== "unknown")
    .sort((a, b) => {
      const order = { leeg: 0, kritiek: 1, laag: 2 };
      return (order[a.alert] ?? 9) - (order[b.alert] ?? 9);
    });

  return {
    alerts,
    counts: {
      leeg: alerts.filter(i => i.alert === "leeg").length,
      kritiek: alerts.filter(i => i.alert === "kritiek").length,
      laag: alerts.filter(i => i.alert === "laag").length
    }
  };
}

module.exports = {
  listStock,
  getStockItem,
  createStockItem,
  updateStockItem,
  addMutation,
  releaseReservation,
  stockAlerts
};
