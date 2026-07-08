"use strict";
/**
 * A1 / Limosa · detachering van (onder)aannemers en buitenlandse werknemers.
 *
 * - A1-attest: bewijst dat een gedetacheerde werknemer sociaal verzekerd blijft
 *   in het thuisland. De hoofdaannemer moet geldige A1's van onderaannemers
 *   kunnen voorleggen op de werf.
 * - Limosa: verplichte voorafgaande melding voor buitenlandse werknemers/
 *   zelfstandigen die tijdelijk in België werken.
 *
 * We bewaren records in de collectie "postedWorkers". Guarded Limosa-aangifte
 * met mock-fallback (zelfde patroon als CIAW/Peppol).
 */

const { postJson } = require("../lib/http-client");

const EXPIRY_WARN_DAYS = 30;

function apiError(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// A1-geldigheidsstatus t.o.v. nu.
function a1Status(record, now = Date.now()) {
  if (!record || !record.documentRef) return "missing";
  if (!record.validTo) return "unknown";
  const end = new Date(record.validTo).getTime();
  if (Number.isNaN(end)) return "unknown";
  if (end < now) return "expired";
  if (end - now <= EXPIRY_WARN_DAYS * 86400000) return "expiring";
  return "valid";
}

// Valideer + normaliseer een record bij het aanmaken/bijwerken.
function normalizeRecord(payload) {
  const errors = [];
  const workerName = String(payload.workerName || "").trim();
  if (!workerName) errors.push("Naam van de werknemer is verplicht");
  const subcontractor = String(payload.subcontractor || "").trim();
  const country = String(payload.country || "").trim().toUpperCase().slice(0, 2);
  if (!country) errors.push("Land van herkomst (ISO-2, bv. PL) is verplicht");
  const validFrom = payload.validFrom || null;
  const validTo = payload.validTo || null;
  if (validFrom && validTo && new Date(validTo) < new Date(validFrom)) errors.push("Einddatum ligt vóór begindatum");
  // Optionele upload van het A1-attest (PDF/afbeelding), base64 data-URL, max ~5MB.
  // Bij een update is de bestaande waarde al in payload gemerged (zie updatePostedWorker).
  const documentFile = payload.documentFile || null;
  const documentFileName = documentFile ? String(payload.documentFileName || "A1-attest").slice(0, 120) : null;
  if (documentFile) {
    if (!/^data:(application\/pdf|image\/(?:png|jpeg|jpg|webp));base64,/.test(String(documentFile))) errors.push("A1-bestand moet een PDF of afbeelding zijn");
    else if (String(documentFile).length > 7 * 1024 * 1024) errors.push("A1-bestand is te groot (max ~5MB)");
  }
  if (errors.length) throw apiError(errors.join("; "), 400);
  return {
    workerName,
    subcontractor,
    country,
    idNumber: String(payload.idNumber || "").trim(),
    documentRef: String(payload.documentRef || "").trim(),
    documentFile: documentFile || null,
    documentFileName: documentFile ? documentFileName : null,
    validFrom,
    validTo,
    note: String(payload.note || "").slice(0, 500),
  };
}

function createPostedWorker(store, tenant, payload, actor) {
  const data = normalizeRecord(payload);
  const row = store.insert("postedWorkers", {
    id: `pw_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    tenantId: tenant.id,
    ...data,
    limosa: null,
    createdAt: new Date().toISOString(),
  });
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "posted_worker_created", area: "posted_workers", detail: row.id });
  return row;
}

function updatePostedWorker(store, tenant, id, payload, actor) {
  const existing = store.get("postedWorkers", id);
  if (!existing || existing.tenantId !== tenant.id) throw apiError("Detacheringsrecord niet gevonden", 404);
  const data = normalizeRecord({ ...existing, ...payload });
  const row = store.update("postedWorkers", id, data);
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "posted_worker_updated", area: "posted_workers", detail: id });
  return row;
}

function deletePostedWorker(store, tenant, id, actor) {
  const existing = store.get("postedWorkers", id);
  if (!existing || existing.tenantId !== tenant.id) throw apiError("Detacheringsrecord niet gevonden", 404);
  store.remove("postedWorkers", id);
  store.audit({ actor: actor.email, tenantId: tenant.id, action: "posted_worker_deleted", area: "posted_workers", detail: id });
  return { ok: true };
}

// Overzicht met afgeleide A1-status + tellers (voor compliance-bewaking).
function listPostedWorkers(store, tenant, now = Date.now()) {
  // De base64-blob niet meesturen in de lijst (zwaar) · enkel of er een bestand is.
  const rows = store.list("postedWorkers", tenant.id).map(r => {
    const { documentFile, ...rest } = r;
    return { ...rest, a1Status: a1Status(r, now), hasFile: !!documentFile };
  });
  return {
    rows,
    total: rows.length,
    expired: rows.filter(r => r.a1Status === "expired").length,
    expiring: rows.filter(r => r.a1Status === "expiring").length,
    missing: rows.filter(r => r.a1Status === "missing").length,
  };
}

function isRealKey(k) {
  const s = String(k || "");
  return !!s && !/DUMMY|replace[_-]?me|changeme|xxxx/i.test(s);
}

// Bouw een Limosa-aangifte uit een record. Puur + testbaar.
function buildLimosaDeclaration({ tenant, record }) {
  const errors = [];
  if (!record || !record.workerName) errors.push("Werknemer ontbreekt");
  if (!record || !record.country) errors.push("Land van herkomst ontbreekt");
  if (!record || !record.validFrom) errors.push("Begindatum van de tewerkstelling ontbreekt");
  const declaration = {
    employer: { name: (tenant && tenant.name) || "", vat: (tenant && tenant.vat) || "" },
    worker: { name: record ? record.workerName : "", country: record ? record.country : "", idNumber: record ? record.idNumber : "" },
    period: { from: record ? record.validFrom : null, to: record ? record.validTo : null },
    a1Ref: record ? record.documentRef : null,
  };
  return { valid: errors.length === 0, errors, declaration };
}

// Dien de Limosa-melding in. Mock-fallback zonder live provider.
async function submitLimosa(store, tenant, id, { config = {}, requireLive = false } = {}, actor) {
  const record = store.get("postedWorkers", id);
  if (!record || record.tenantId !== tenant.id) throw apiError("Detacheringsrecord niet gevonden", 404);
  const built = buildLimosaDeclaration({ tenant, record });
  if (!built.valid) throw apiError(built.errors.join("; "), 400);

  const ciaw = config.ciaw || {};
  const live = ciaw.provider && ciaw.provider !== "mock" && isRealKey(ciaw.apiKey) && requireLive;
  let result;
  if (!live) {
    result = { status: "confirmed", reference: `MOCK-LIMOSA-${Date.now()}`, live: false };
  } else {
    try {
      const json = await postJson(String(ciaw.baseHost || "api.limosa.be"), "/v1/declarations", { Authorization: `Bearer ${ciaw.apiKey}` }, built.declaration);
      result = { status: json.status || "sent", reference: json.reference || json.id || "", live: true };
    } catch (err) {
      result = { status: "failed", reference: "", live: true, error: err.message };
    }
  }
  const limosa = { ...result, at: new Date().toISOString() };
  store.update("postedWorkers", id, { limosa });
  if (store.audit) store.audit({ actor: actor && actor.email, tenantId: tenant.id, action: "limosa_submitted", area: "posted_workers", detail: `${id}:${limosa.status}` });
  return { ok: result.status !== "failed", limosa };
}

module.exports = {
  a1Status, normalizeRecord, createPostedWorker, updatePostedWorker, deletePostedWorker,
  listPostedWorkers, buildLimosaDeclaration, submitLimosa, EXPIRY_WARN_DAYS,
};
