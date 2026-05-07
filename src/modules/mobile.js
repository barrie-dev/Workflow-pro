function todayPayload(store, user) {
  const tenantId = user.tenantId;
  const tenant = store.get("tenants", tenantId) || {};
  const syncState = mobileQueueState(tenant);
  const today = new Date().toISOString().slice(0, 10);
  return {
    date: today,
    user: { id: user.id, name: user.name, role: user.role },
    shifts: store.list("shifts", tenantId).filter(s => s.userId === user.id && s.date === today),
    openWorkorders: store.list("workorders", tenantId).filter(w => w.userId === user.id && !["Voltooid", "Afgewerkt"].includes(w.status)),
    activeClock: store.list("clocks", tenantId).find(c => c.userId === user.id && c.date === today && !c.clockOut) || null,
    offlineHints: {
      pwaReady: true,
      syncQueue: 0,
      nextStep: "Offline acties worden lokaal bewaard en bij verbinding gesynchroniseerd",
      lastSyncedAt: syncState.lastSyncedAt,
      processedCount: syncState.processedCount,
      retainedIds: syncState.processedIds.length
    }
  };
}

function getTenantWorkorder(store, tenantId, workorderId) {
  const workorder = store.get("workorders", workorderId);
  if (!workorder || workorder.tenantId !== tenantId) {
    const error = new Error("Werkbon niet gevonden");
    error.status = 404;
    throw error;
  }
  return workorder;
}

function completeWorkorder(store, tenant, workorderId, payload, actor) {
  const workorder = getTenantWorkorder(store, tenant.id, workorderId);
  const row = store.update("workorders", workorder.id, {
    status: "Voltooid",
    completedAt: new Date().toISOString(),
    completedBy: actor.email,
    checklist: Array.isArray(payload.checklist) ? payload.checklist : workorder.checklist || [],
    mobileNote: payload.note || workorder.mobileNote || ""
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "mobile_workorder_completed", area: "mobile", detail: workorder.id });
  return row;
}

function attachWorkorderPhoto(store, tenant, workorderId, payload, actor) {
  const workorder = getTenantWorkorder(store, tenant.id, workorderId);
  const photo = {
    id: `photo_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name: payload.name || "werkbon-foto.jpg",
    type: payload.type || "image/jpeg",
    size: Number(payload.size || 0),
    uploadedAt: new Date().toISOString(),
    uploadedBy: actor.email
  };
  const row = store.update("workorders", workorder.id, {
    files: [...(workorder.files || []), photo]
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "mobile_photo_attached", area: "mobile", detail: photo.name });
  return { row, photo };
}

function signWorkorder(store, tenant, workorderId, payload, actor) {
  const workorder = getTenantWorkorder(store, tenant.id, workorderId);
  const signature = {
    signerName: payload.signerName || "Klant",
    signedAt: new Date().toISOString(),
    signedBy: actor.email
  };
  const row = store.update("workorders", workorder.id, {
    signed: true,
    signature
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "mobile_workorder_signed", area: "mobile", detail: workorder.id });
  return row;
}

function processMobileAction(store, tenant, item, actor) {
  const action = String(item.action || "").trim();
  const workorderId = String(item.workorderId || "").trim();
  const payload = item.payload || {};
  if (!workorderId) {
    const error = new Error("Werkbon ontbreekt in offline actie");
    error.status = 400;
    throw error;
  }
  if (action === "complete") return completeWorkorder(store, tenant, workorderId, payload, actor);
  if (action === "photo") return attachWorkorderPhoto(store, tenant, workorderId, payload, actor);
  if (action === "signature") return signWorkorder(store, tenant, workorderId, payload, actor);
  const error = new Error("Onbekende mobiele actie");
  error.status = 400;
  throw error;
}

function mobileQueueState(tenant) {
  const mobileSync = tenant.mobileSync || {};
  return {
    processedIds: Array.isArray(mobileSync.processedIds) ? mobileSync.processedIds : [],
    processedCount: Number(mobileSync.processedCount || 0),
    lastSyncedAt: mobileSync.lastSyncedAt || null
  };
}

function syncMobileQueue(store, tenant, payload, actor) {
  const items = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.queue) ? payload.queue : [];
  const state = mobileQueueState(tenant);
  const processedIds = new Set(state.processedIds);
  const acceptedIds = [];
  const results = items.map((item, index) => {
    const id = item.id || item.clientId || `queue_${index + 1}`;
    if (processedIds.has(id)) {
      return {
        id,
        ok: true,
        duplicate: true,
        action: item.action,
        workorderId: item.workorderId
      };
    }
    try {
      const result = processMobileAction(store, tenant, item, actor);
      processedIds.add(id);
      acceptedIds.push(id);
      return {
        id,
        ok: true,
        action: item.action,
        workorderId: item.workorderId,
        result
      };
    } catch (error) {
      return {
        id,
        ok: false,
        action: item.action,
        workorderId: item.workorderId,
        error: error.message || "Mobiele actie mislukt"
      };
    }
  });
  const failed = results.filter(result => !result.ok).length;
  const processed = results.length - failed;
  if (acceptedIds.length) {
    store.updateTenant(tenant.id, {
      mobileSync: {
        processedIds: Array.from(processedIds).slice(-500),
        processedCount: state.processedCount + acceptedIds.length,
        lastSyncedAt: new Date().toISOString()
      }
    });
  }
  store.audit({
    actor: actor.email,
    tenantId: tenant.id,
    action: "mobile_queue_synced",
    area: "mobile",
    detail: `${processed}/${results.length} acties verwerkt, ${results.filter(result => result.duplicate).length} duplicaten genegeerd`
  });
  return {
    received: items.length,
    processed,
    failed,
    duplicates: results.filter(result => result.duplicate).length,
    results
  };
}

module.exports = {
  todayPayload,
  completeWorkorder,
  attachWorkorderPhoto,
  signWorkorder,
  processMobileAction,
  syncMobileQueue
};
