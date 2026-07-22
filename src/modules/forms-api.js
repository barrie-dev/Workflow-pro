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
// Lees de activatie-context uit de querystring (object_type, status, amount,
// risk, company_id, team_id) · numeriek waar het kan.
function queryContext(req) {
  const out = {};
  try {
    const u = new URL(String((req && req.url) || ""), "http://x");
    for (const [k, v] of u.searchParams) {
      const n = Number(v);
      out[k] = v !== "" && Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(v) ? n : v;
    }
  } catch { /* geen query */ }
  return out;
}

/**
 * @param {object} repo  makePgFormsRepository(pool)
 * @param {object} args  { user, tenantId, method, action, body, req }
 * @returns {Promise<{status, payload, headers}>}
 */
async function handleFormsRoute(repo, { user, tenantId, method, action, body = {}, req, entitlements = [] }) {
  const actor = (user && user.email) || null;
  try {
    // ── Definities ──
    if (action === "form-definitions" && method === "GET") {
      return ok(200, { forms: await repo.listDefinitions(tenantId, { status: body.status || null }) });
    }
    if (action === "form-definitions" && method === "POST") {
      return ok(201, { form: await repo.createDefinition(tenantId, body, actor) });
    }
    // Standaardformulieren-seed (h25 + h23): idempotent, bestaande keys blijven.
    if (action === "form-definitions/seed" && method === "POST") {
      return ok(200, { result: await repo.seedStandardForms(tenantId, actor) });
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
    // Normatieve structuur uit de velddictionary (h6-h24) op de draft zetten.
    const fDict = action.match(/^form-definitions\/([^/]+)\/structure\/dictionary$/);
    if (fDict && method === "POST") {
      return ok(200, { result: await repo.applyDictionaryStructure(tenantId, fDict[1], actor) });
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

    // ── F2/F3 · activatie, assignments, externe tokens ──
    const fActivation = action.match(/^form-definitions\/([^/]+)\/activation$/);
    if (fActivation && method === "GET") {
      const ctx = { ...queryContext(req), ...(body.context || {}) };
      const res = await repo.resolveActivation(tenantId, fActivation[1], { user, context: ctx, entitlements });
      return ok(200, { activation: res });
    }
    const fAssign = action.match(/^form-definitions\/([^/]+)\/assignments$/);
    if (fAssign && method === "GET") {
      return ok(200, { assignments: await repo.listAssignments(tenantId, fAssign[1]) });
    }
    if (fAssign && method === "POST") {
      // Externe assignments geven het ruwe token éénmalig terug (201).
      return ok(201, { assignment: await repo.createAssignment(tenantId, fAssign[1], body, actor) });
    }
    const fAssignId = action.match(/^form-definitions\/([^/]+)\/assignments\/([^/]+)$/);
    if (fAssignId && method === "DELETE") {
      return ok(200, { result: await repo.revokeAssignment(tenantId, fAssignId[2], actor) });
    }
    // F6 · reporting over de typed answer-index; ?consumer=ai → enkel ai_allowed.
    const fReport = action.match(/^form-definitions\/([^/]+)\/report$/);
    if (fReport && method === "GET") {
      const ctx = queryContext(req);
      return ok(200, { report: await repo.reportOnDefinition(tenantId, fReport[1], { user, aiConsumer: ctx.consumer === "ai" }) });
    }
    // h27 · retentie-purge (dry-run met ?dryRun=1); beheer-actie.
    if (action === "form-retention/apply" && method === "POST") {
      return ok(200, { result: await repo.applyRetention(tenantId, { dryRun: body.dryRun === true }) });
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
      const r = await repo.actOnApproval(tenantId, iApprove[1], { stepNo: body.stepNo || 1, decision: body.decision, note: body.note || null, actorRole: (user && user.role) || null }, actor);
      return ok(200, { result: r });
    }
    const iSign = action.match(/^form-instances\/([^/]+)\/sign$/);
    if (iSign && method === "POST") {
      const r = await repo.captureSignature(tenantId, iSign[1], {
        signer_name: body.signer_name || body.signerName,
        signer_ref: body.signer_ref || body.signerRef || null,
        transitionToSigned: body.transitionToSigned !== false,
      }, actor);
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
  return action === "form-definitions" || action.startsWith("form-definitions/") ||
    action.startsWith("form-instances/") || action.startsWith("form-retention/");
}

module.exports = { handleFormsRoute, isFormsAction };
