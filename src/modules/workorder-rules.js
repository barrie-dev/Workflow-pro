const COMPLETED_STATUSES = new Set(["Voltooid", "Afgewerkt"]);
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function apiError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeChecklist(input, fallback = []) {
  const items = Array.isArray(input) ? input : Array.isArray(fallback) ? fallback : [];
  return items.map((item, index) => {
    if (typeof item === "string") return { id: `item_${index + 1}`, label: item, done: true };
    return {
      id: item.id || `item_${index + 1}`,
      label: item.label || item.title || `Checklist ${index + 1}`,
      done: item.done === true || item.checked === true || item.completed === true,
      note: item.note || ""
    };
  });
}

function checklistDone(checklist) {
  return checklist.length === 0 || checklist.every(item => item.done === true);
}

function isCompleted(workorder) {
  return COMPLETED_STATUSES.has(workorder.status);
}

function validatePhotoPayload(payload) {
  const size = Number(payload.size || 0);
  const type = payload.type || "image/jpeg";
  if (!ALLOWED_PHOTO_TYPES.has(type)) throw apiError("Werkbonfoto moet jpeg, png of webp zijn", 415);
  if (size < 0 || size > PHOTO_MAX_BYTES) throw apiError("Werkbonfoto mag maximaal 8 MB zijn", 413);
  return {
    id: `photo_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name: payload.name || "werkbon-foto.jpg",
    type,
    size
  };
}

function validateSignaturePayload(payload) {
  const signerName = String(payload.signerName || "").trim();
  if (signerName.length < 2) throw apiError("Naam van ondertekenaar is verplicht", 422);
  return { signerName };
}

function buildCompletionPatch(workorder, payload, actor) {
  if (isCompleted(workorder)) throw apiError("Werkbon is al afgerond", 409);

  const checklist = normalizeChecklist(payload.checklist, workorder.checklist);
  if (workorder.checklistRequired && checklist.length === 0) throw apiError("Checklist is verplicht voor deze werkbon", 422);
  if (!checklistDone(checklist)) throw apiError("Alle checklistpunten moeten afgerond zijn", 422);
  if (workorder.requiresPhoto && !(workorder.files || []).length) throw apiError("Minstens een foto is verplicht voor deze werkbon", 422);
  if (workorder.requiresSignature && !workorder.signed) throw apiError("Handtekening is verplicht voor deze werkbon", 422);

  return {
    status: "Voltooid",
    completedAt: new Date().toISOString(),
    completedBy: actor.email,
    checklist,
    billableStatus: workorder.billable === false ? "not_billable" : "ready_for_invoice",
    mobileNote: payload.note || workorder.mobileNote || ""
  };
}

function workorderInsights(workorders) {
  const counts = {
    open: 0,
    completed: 0,
    needsPhoto: 0,
    needsSignature: 0,
    readyForInvoice: 0,
    blockedCompletion: 0
  };

  for (const workorder of workorders) {
    const completed = isCompleted(workorder);
    if (completed) counts.completed += 1;
    else counts.open += 1;

    const missingPhoto = !!workorder.requiresPhoto && !(workorder.files || []).length;
    const missingSignature = !!workorder.requiresSignature && !workorder.signed;
    if (missingPhoto) counts.needsPhoto += 1;
    if (missingSignature) counts.needsSignature += 1;
    if (!completed && (missingPhoto || missingSignature)) counts.blockedCompletion += 1;
    if (workorder.billableStatus === "ready_for_invoice") counts.readyForInvoice += 1;
  }

  return {
    counts,
    completionRate: workorders.length ? Number(((counts.completed / workorders.length) * 100).toFixed(1)) : 0,
    mobileEvidenceReady: counts.needsPhoto === 0 && counts.needsSignature === 0
  };
}

module.exports = {
  buildCompletionPatch,
  validatePhotoPayload,
  validateSignaturePayload,
  workorderInsights
};
