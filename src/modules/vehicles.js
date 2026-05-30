// src/modules/vehicles.js
// Wagenparkbeheer · voertuigen · kilometerstand · onderhoud · service-alerts

function apiError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const FUEL_TYPES = new Set(["diesel", "benzine", "elektrisch", "hybride", "cng", "lpg"]);
const VEHICLE_STATUSES = new Set(["actief", "in_onderhoud", "buiten_dienst", "verkocht"]);

// ─── helpers ──────────────────────────────────────────────────────────────────

function vehicleRecord(store, tenantId, vehicleId) {
  const v = store.get("vehicles", vehicleId);
  if (!v || v.tenantId !== tenantId) throw apiError("Voertuig niet gevonden", 404);
  return v;
}

function serviceStatus(vehicle) {
  if (!vehicle.nextService) return "onbekend";
  const days = Math.ceil((new Date(vehicle.nextService).getTime() - Date.now()) / 86400000);
  if (days < 0) return "vervallen";
  if (days <= 14) return "dringend";
  if (days <= 45) return "binnenkort";
  return "ok";
}

function inspectionStatus(vehicle) {
  if (!vehicle.inspectionDate) return "onbekend";
  const days = Math.ceil((new Date(vehicle.inspectionDate).getTime() - Date.now()) / 86400000);
  if (days < 0) return "vervallen";
  if (days <= 30) return "dringend";
  if (days <= 90) return "binnenkort";
  return "ok";
}

function insuranceStatus(vehicle) {
  if (!vehicle.insuranceExpiry) return "onbekend";
  const days = Math.ceil((new Date(vehicle.insuranceExpiry).getTime() - Date.now()) / 86400000);
  if (days < 0) return "vervallen";
  if (days <= 30) return "dringend";
  return "ok";
}

function enrichVehicle(vehicle, mileageLogs = []) {
  const logs = mileageLogs
    .filter(l => l.vehicleId === vehicle.id)
    .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
  return {
    ...vehicle,
    serviceStatus: serviceStatus(vehicle),
    inspectionStatus: inspectionStatus(vehicle),
    insuranceStatus: insuranceStatus(vehicle),
    lastMileageLog: logs[0] || null,
    recentLogs: logs.slice(0, 5)
  };
}

// ─── lijst ────────────────────────────────────────────────────────────────────

function listVehicles(store, tenantId, options = {}) {
  let items = store.list("vehicles", tenantId);

  if (options.status) items = items.filter(v => v.status === options.status);
  if (options.driverId) items = items.filter(v => v.driverId === options.driverId);
  if (options.alertOnly) {
    items = items.filter(v =>
      ["vervallen", "dringend"].includes(serviceStatus(v)) ||
      ["vervallen", "dringend"].includes(inspectionStatus(v)) ||
      ["vervallen", "dringend"].includes(insuranceStatus(v))
    );
  }

  const logs = store.list("mileageLogs", tenantId);
  const enriched = items.map(v => enrichVehicle(v, logs));

  const summary = {
    total: enriched.length,
    actief: enriched.filter(v => v.status === "actief").length,
    in_onderhoud: enriched.filter(v => v.status === "in_onderhoud").length,
    serviceAlert: enriched.filter(v => ["vervallen", "dringend"].includes(v.serviceStatus)).length,
    inspectionAlert: enriched.filter(v => ["vervallen", "dringend"].includes(v.inspectionStatus)).length
  };

  return { vehicles: enriched, summary };
}

function getVehicle(store, tenantId, vehicleId) {
  const v = vehicleRecord(store, tenantId, vehicleId);
  const logs = store.list("mileageLogs", tenantId).filter(l => l.vehicleId === vehicleId).sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
  return { ...enrichVehicle(v, logs), mileageLogs: logs.slice(0, 20) };
}

// ─── aanmaken & aanpassen ─────────────────────────────────────────────────────

function createVehicle(store, tenant, payload, actor) {
  const model = String(payload.model || "").trim();
  if (model.length < 2) throw apiError("Voertuigmodel is verplicht (min. 2 tekens)");
  const plate = String(payload.plate || "").trim().toUpperCase();
  if (!plate) throw apiError("Nummerplaat is verplicht");

  // dubbele nummerplaat?
  const dupe = store.list("vehicles", tenant.id).find(v => v.plate === plate);
  if (dupe) throw apiError(`Nummerplaat ${plate} bestaat al`);

  const fuel = String(payload.fuel || "diesel").toLowerCase();
  if (!FUEL_TYPES.has(fuel)) throw apiError(`Ongeldig brandstoftype. Kies uit: ${[...FUEL_TYPES].join(", ")}`);

  const status = String(payload.status || "actief").toLowerCase();
  if (!VEHICLE_STATUSES.has(status)) throw apiError(`Ongeldige status. Kies uit: ${[...VEHICLE_STATUSES].join(", ")}`);

  const vehicle = store.insert("vehicles", {
    id: `veh_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    tenantId: tenant.id,
    model,
    plate,
    brand: String(payload.brand || "").trim() || null,
    year: payload.year ? Number(payload.year) : null,
    fuel,
    vin: String(payload.vin || "").trim() || null,
    driverId: payload.driverId || null,
    mileage: payload.mileage ? Number(payload.mileage) : 0,
    nextService: payload.nextService || null,
    inspectionDate: payload.inspectionDate || null,
    insuranceExpiry: payload.insuranceExpiry || null,
    insuranceCompany: String(payload.insuranceCompany || "").trim() || null,
    status,
    notes: String(payload.notes || "").trim() || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  store.audit({ actor: actor.email, tenantId: tenant.id, action: "vehicle_created", area: "vehicles", detail: `${model} (${plate})` });
  return getVehicle(store, tenant.id, vehicle.id);
}

function updateVehicle(store, tenant, vehicleId, payload, actor) {
  const vehicle = vehicleRecord(store, tenant.id, vehicleId);
  const patch = { updatedAt: new Date().toISOString() };

  if (payload.model != null) { const v = String(payload.model).trim(); if (v.length < 2) throw apiError("Model te kort"); patch.model = v; }
  if (payload.brand !== undefined) patch.brand = String(payload.brand || "").trim() || null;
  if (payload.year !== undefined) patch.year = payload.year ? Number(payload.year) : null;
  if (payload.fuel !== undefined) { const f = String(payload.fuel).toLowerCase(); if (!FUEL_TYPES.has(f)) throw apiError("Ongeldig brandstoftype"); patch.fuel = f; }
  if (payload.vin !== undefined) patch.vin = String(payload.vin || "").trim() || null;
  if (payload.driverId !== undefined) patch.driverId = payload.driverId || null;
  if (payload.nextService !== undefined) patch.nextService = payload.nextService || null;
  if (payload.inspectionDate !== undefined) patch.inspectionDate = payload.inspectionDate || null;
  if (payload.insuranceExpiry !== undefined) patch.insuranceExpiry = payload.insuranceExpiry || null;
  if (payload.insuranceCompany !== undefined) patch.insuranceCompany = String(payload.insuranceCompany || "").trim() || null;
  if (payload.notes !== undefined) patch.notes = String(payload.notes || "").trim() || null;
  if (payload.status !== undefined) {
    const s = String(payload.status).toLowerCase();
    if (!VEHICLE_STATUSES.has(s)) throw apiError("Ongeldige status");
    patch.status = s;
  }

  store.update("vehicles", vehicleId, patch);
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "vehicle_updated", area: "vehicles", detail: vehicle.plate });
  return getVehicle(store, tenant.id, vehicleId);
}

// ─── kilometerstand loggen ─────────────────────────────────────────────────────

function logMileage(store, tenant, vehicleId, payload, actor) {
  const vehicle = vehicleRecord(store, tenant.id, vehicleId);
  const mileage = Number(payload.mileage);
  if (!Number.isFinite(mileage) || mileage < 0) throw apiError("Kilometerstand moet een positief getal zijn");
  if (mileage < (vehicle.mileage || 0)) throw apiError(`Nieuwe kilometerstand (${mileage}) is lager dan huidige (${vehicle.mileage})`);

  const log = store.insert("mileageLogs", {
    id: `mlog_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    tenantId: tenant.id,
    vehicleId,
    mileage,
    previousMileage: vehicle.mileage || 0,
    delta: mileage - (vehicle.mileage || 0),
    note: String(payload.note || "").trim() || null,
    actor: actor.email,
    loggedAt: new Date().toISOString()
  });

  store.update("vehicles", vehicleId, { mileage, updatedAt: new Date().toISOString() });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "vehicle_mileage_logged", area: "vehicles", detail: `${vehicle.plate}: ${mileage} km` });

  return getVehicle(store, tenant.id, vehicleId);
}

// ─── service ingepland ────────────────────────────────────────────────────────

function scheduleService(store, tenant, vehicleId, payload, actor) {
  const vehicle = vehicleRecord(store, tenant.id, vehicleId);
  if (!payload.nextService) throw apiError("Volgende servicedatum is verplicht");

  store.update("vehicles", vehicleId, {
    nextService: payload.nextService,
    status: payload.inService ? "in_onderhoud" : vehicle.status,
    notes: payload.notes ? String(payload.notes).trim() : vehicle.notes,
    updatedAt: new Date().toISOString()
  });

  store.audit({ actor: actor.email, tenantId: tenant.id, action: "vehicle_service_scheduled", area: "vehicles", detail: `${vehicle.plate} → ${payload.nextService}` });
  return getVehicle(store, tenant.id, vehicleId);
}

module.exports = {
  listVehicles,
  getVehicle,
  createVehicle,
  updateVehicle,
  logMileage,
  scheduleService
};
