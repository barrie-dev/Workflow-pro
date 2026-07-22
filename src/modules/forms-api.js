"use strict";

// ── Forms-API · HTTP-dispatcher over de pg-forms-repository (F1) ─────────────
// Pure functie (geen res-object): retourneert { status, payload, headers } zodat
// ze los testbaar is en server.js ze enkel doorgeeft aan sendJson. Rechten,
// If-Match, Idempotency-Key en veldredactie leven hier; de repo doet persistentie.
//
// Distincte canonieke paden (naast de legacy work-os forms/templates|instances;
// de strangler unificeert later). Routes onder /api/tenants/:tid/:
//   GET/POST  form-definitions                        lijst / definitie aanmaken
//   GET       form-definitions/:id                    definitie + versies
//   PATCH     form-definitions/:id/status             activatiestatus
//   PUT       form-definitions/:id/structure          draft-structuur zetten
//   POST      form-definitions/:id/publish | /versions publiceren / nieuwe versie
//   POST      form-definitions/:id/instances          instance starten
//   GET       form-instances/:id                      instance (veldgeredigeerd)
//   PATCH     form-instances/:id                      concept opslaan (If-Match)
//   POST      form-instances/:id/submit               indienen (Idempotency-Key)
//   POST      form-instances/:id/transition           statusovergang
//   POST      form-instances/:id/approve              goedkeuren (SoD)
//   GET       form-instances/:id/events               lifecycle-log

const engine = require("../platform/forms-engine");

function ok(status, payload, headers) { return { status, payload: { ok: true, ...payload }, headers: headers || {} }; }
function fail(e) {
  const status = e.status || 500;
  const payload = { ok: false, code: e.code || "ERROR", error: e.message || "Fout" };
  if (e.fieldErrors) payload.fieldErrors = e.fieldErrors;
  if (e.currentVersion !== undefined) payload.currentVersion = e.currentVersion;
  return { status, payload, headers: {} };
}

function ifMatch(req) {
  const raw = String((req && req.headers && req.headers["if-match"]) || "").replace(/^W\//, "").replace(/"/g, "").trim();
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function idempotencyKey(req) {
  return String((req && req.headers && req.headers["idempotency-key"]) || "").trim() || null;
}

/**
 * @param {object} repo  makePgFormsRepository(pool)
 * @param {object} args  { user, tenantId, method, action, body, req }
 * @returns {Promise<{status, payload, headers}>}
 */
async function handleFormsRoute(repo, { user, tenantId, method, action, body = {}, req }) {
  const actor = (user && user.email) || null;
  try {
    // ── Definities ──
    if (action === "form-definitions" && method === "GET") {
      return ok(200, { forms: await repo.listDefinitions(tenantId, { status: body.status || null }) });
    }
    if (action === "form-definitions" && method === "POST") {
      return ok(201, { form: await repo.createDefinition(tenantId, body, actor) });
    }
    const fMatch = action.match(/^form-definitions\/([^/]+)$/);
    if (fMatch && method === "GET") {
      const def = await repo.getDefinition(tenantId, fMatch[1]);
      if (!def) return fail({ status: 404, code: "FORM_NOT_FOUND", message: "definitie niet gevonden" });
      return ok(200, { form: def });
    }
    const fStatus = action.match(/^form-definitions\/([^/]+)\/status$/);
    if (fStatus && method === "PATCH") {
      return ok(200, { form: await repo.setDefinitionStatus(tenantId, fStatus[1], body.status, actor) });
    }
    const fStruct = action.match(/^form-definitions\/([^/]+)\/structure$/);
    if (fStruct && (method === "PUT" || method === "PATCH")) {
      return ok(200, { result: await repo.setDraftStructure(tenantId, fStruct[1], body, actor) });
    }
    const fPublish = action.match(/^form-definitions\/([^/]+)\/publish$/);
    if (fPublish && method === "POST") {
      return ok(200, { version: await repo.publishVersion(tenantId, fPublish[1], actor) });
    }
    const fVersions = action.match(/^form-definitions\/([^/]+)\/versions$/);
    if (fVersions && method === "POST") {
      return ok(201, { version: await repo.createNewVersion(tenantId, fVersions[1], actor) });
    }
    const fInstances = action.match(/^form-definitions\/([^/]+)\/instances$/);
    if (fInstances && method === "POST") {
      const created = await repo.createInstance(tenantId, { ...body, definition_id: fInstances[1] }, actor);
      return ok(201, { instance: created }, { ETag: '"1"' });
    }

    // ── Instances ──
    const iGet = action.match(/^form-instances\/([^/]+)$/);
    if (iGet && method === "GET") {
      const inst = await repo.getInstance(tenantId, iGet[1]);
      if (!inst) return fail({ status: 404, code: "INSTANCE_NOT_FOUND", message: "instance niet gevonden" });
      // Veldredactie (FORM-05): strip antwoorden die de gebruiker niet mag zien.
      const answers = engine.redactAnswers(user, inst.fields, inst.answers);
      const visibleFields = (inst.fields || []).filter(f => engine.canViewField(user, f));
      const { fields, answers: _a, ...rest } = inst;
      return ok(200, { instance: { ...rest, answers, fields: visibleFields } }, { ETag: `"${inst.version}"` });
    }
    if (iGet && (method === "PATCH" || method === "PUT")) {
      const r = await repo.saveDraft(tenantId, iGet[1], { answers: body.answers || {}, expectedVersion: body.expectedVersion || ifMatch(req) }, actor);
      return ok(200, { result: r }, { ETag: `"${r.version}"` });
    }
    const iSubmit = action.match(/^form-instances\/([^/]+)\/submit$/);
    if (iSubmit && method === "POST") {
      const r = await repo.submitInstance(tenantId, iSubmit[1], { answers: body.answers || null, idempotencyKey: body.idempotencyKey || idempotencyKey(req) }, actor);
      return ok(200, { result: r });
    }
    const iTrans = action.match(/^form-instances\/([^/]+)\/transition$/);
    if (iTrans && method === "POST") {
      const r = await repo.transition(tenantId, iTrans[1], body.status, actor, { expectedVersion: body.expectedVersion || ifMatch(req) });
      return ok(200, { result: r });
    }
    const iApprove = action.match(/^form-instances\/([^/]+)\/approve$/);
    if (iApprove && method === "POST") {
      const r = await repo.actOnApproval(tenantId, iApprove[1], { stepNo: body.stepNo || 1, decision: body.decision, note: body.note || null }, actor);
      return ok(200, { result: r });
    }
    const iEvents = action.match(/^form-instances\/([^/]+)\/events$/);
    if (iEvents && method === "GET") {
      return ok(200, { events: await repo.listEvents(tenantId, iEvents[1]) });
    }

    return null; // geen forms-route → laat server.js verder zoeken
  } catch (e) {
    return fail(e);
  }
}

// Herkent of een actie een canonieke forms-route is (voor snelle dispatch in
// server.js). Bewust NIET de legacy work-os paden forms/templates|instances.
function isFormsAction(action) {
  return action === "form-definitions" || action.startsWith("form-definitions/") || action.startsWith("form-instances/");
}

module.exports = { handleFormsRoute, isFormsAction };
