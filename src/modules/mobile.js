const {
  buildCompletionPatch,
  validatePhotoPayload,
  validateSignaturePayload
} = require("./workorder-rules");

function todayPayload(store, user) {
  const tenantId = user.tenantId;
  const tenant = store.get("tenants", tenantId) || {};
  const syncState = mobileQueueState(tenant);
  const today = new Date().toISOString().slice(0, 10);
  const shifts = store.list("shifts", tenantId);
  const workorders = store.list("workorders", tenantId);
  const canPreviewFieldUser = ["tenant_admin", "planner", "super_admin"].includes(user.role);
  const fieldUserId = canPreviewFieldUser
    ? shifts.find(shift => shift.date === today)?.userId
      || workorders.find(row => !["Voltooid", "Afgewerkt"].includes(row.status))?.userId
      || shifts[0]?.userId
      || user.id
    : user.id;
  const fieldUser = store.get("users", fieldUserId) || user;
  const sortedDates = Array.from(new Set(shifts.filter(shift => shift.userId === fieldUserId).map(shift => shift.date).filter(Boolean))).sort();
  const nextDate = sortedDates.find(date => date >= today) || sortedDates[sortedDates.length - 1] || today;
  const activeDate = sortedDates.includes(today) ? today : nextDate;
  return {
    date: activeDate,
    liveDate: today,
    preview: fieldUserId !== user.id,
    user: { id: fieldUser.id, name: fieldUser.name, role: fieldUser.role },
    requestedBy: { id: user.id, name: user.name, role: user.role },
    shifts: shifts.filter(s => s.userId === fieldUserId && s.date === activeDate),
    openWorkorders: workorders.filter(w => w.userId === fieldUserId && !["Voltooid", "Afgewerkt"].includes(w.status)),
    activeClock: store.list("clocks", tenantId).find(c => c.userId === fieldUserId && c.date === activeDate && !c.clockOut) || null,
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
  const row = store.update("workorders", workorder.id, buildCompletionPatch(workorder, payload, actor));
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "mobile_workorder_completed", area: "mobile", detail: workorder.id });
  return row;
}

function attachWorkorderPhoto(store, tenant, workorderId, payload, actor) {
  const workorder = getTenantWorkorder(store, tenant.id, workorderId);
  const photo = {
    ...validatePhotoPayload(payload),
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
  const signaturePayload = validateSignaturePayload(payload);
  const signature = {
    signerName: signaturePayload.signerName,
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
