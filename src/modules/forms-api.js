"use strict";

// ── Forms-API · HTTP-dispatcher over de pg-forms-repository ──────────────────
// Pure functie (geen res-object): retourneert { status, payload, headers }.
// CTO2-01/02: tenantisolatie is GEEN objectautorisatie · elke route beslist hier
// éérst action + record-scope (forms-authz) vóór de repository-call. Fouten
// zonder detaillek (h27): een verboden of onbestaand record is één generieke 403.
//
// Routes onder /api/tenants/:tid/:
//   GET/POST  form-definitions                        lijst (activatie-gefilterd) / aanmaken (manage)
//   GET       form-definitions/:id                    definitie (manage of actief-voor-gebruiker)
//   PATCH/PUT form-definitions/:id/{status,structure} beheer (manage)
//   POST      form-definitions/:id/{publish,versions,structure/dictionary,assignments} beheer
//   GET       form-definitions/:id/{activation,report,assignments}
//   POST      form-definitions/:id/instances          starten (instance.create + activatie)
//   GET/PATCH form-instances/:id                      lezen/concept (view/edit + scope)
//   POST      form-instances/:id/{submit,transition,approve,sign,attachments}
//   GET       form-instances/:id/{events,attachments}
//   POST      form-retention/apply · form-reminders/run   (retention.manage)

const engine = require("../platform/forms-engine");
const authz = require("../platform/forms-authz");

function ok(status, payload, headers) { return { status, payload: { ok: true, ...payload }, headers: headers || {} }; }
function fail(e) {
  const status = e.status || 500;
  const payload = { ok: false, code: e.code || "ERROR", error: e.message || "Fout" };
  if (e.fieldErrors) payload.fieldErrors = e.fieldErrors;
  if (e.currentVersion !== undefined) payload.currentVersion = e.currentVersion;
  return { status, payload, headers: {} };
}
// Eén generieke weigering (h27: 403 zonder detaillek · geen ID-probing).
const DENY = { status: 403, code: "FORMS_FORBIDDEN", message: "Geen toegang tot dit formulier of deze actie." };

function ifMatch(req) {
  const raw = String((req && req.headers && req.headers["if-match"]) || "").replace(/^W\//, "").replace(/"/g, "").trim();
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function idempotencyKey(req) {
  return String((req && req.headers && req.headers["idempotency-key"]) || "").trim() || null;
}
// Activatie-context uit de querystring · numeriek waar het kan.
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
 * @param {object} args  { user, tenantId, method, action, body, req, entitlements, ctx }
 *   ctx = autorisatiecontext van de server: { teamEmails: Set<string> }.
 */
async function handleFormsRoute(repo, { user, tenantId, method, action, body = {}, req, entitlements = [], ctx = {} }) {
  const actor = (user && user.email) || null;
  const manage = authz.canManageDefinitions(user);
  const deny = () => fail(DENY);
  // Laad + autoriseer een instance in één beweging; null = geweigerd/onbestaand.
  const guardedInstance = async (instId, instAction) => {
    const inst = await repo.getInstance(tenantId, instId);
    if (!inst) return null;
    return authz.canInstance(user, inst, instAction, ctx) ? inst : null;
  };
  try {
    // ── Definities ──
    if (action === "form-definitions" && method === "GET") {
      const all = await repo.listDefinitions(tenantId, { status: body.status || null });
      if (manage) return ok(200, { forms: all });
      // Eindgebruikers zien uitsluitend formulieren die voor HEN actief zijn
      // (CTO2-02): geen catalogusbrede inzage zonder beheerrecht.
      const visible = [];
      for (const def of all) {
        const act = await repo.resolveActivation(tenantId, def.id, { user, entitlements });
        if (act.active) visible.push(def);
      }
      return ok(200, { forms: visible });
    }
    if (action === "form-definitions" && method === "POST") {
      if (!manage) return deny();
      return ok(201, { form: await repo.createDefinition(tenantId, body, actor) });
    }
    if (action === "form-definitions/seed" && method === "POST") {
      if (!manage) return deny();
      return ok(200, { result: await repo.seedStandardForms(tenantId, actor) });
    }
    const fMatch = action.match(/^form-definitions\/([^/]+)$/);
    if (fMatch && method === "GET") {
      const def = await repo.getDefinition(tenantId, fMatch[1]);
      if (!def) return deny();
      if (!manage) {
        const act = await repo.resolveActivation(tenantId, def.id, { user, entitlements });
        if (!act.active) return deny();
      }
      return ok(200, { form: def });
    }
    const fStatus = action.match(/^form-definitions\/([^/]+)\/status$/);
    if (fStatus && method === "PATCH") {
      if (!manage) return deny();
      return ok(200, { form: await repo.setDefinitionStatus(tenantId, fStatus[1], body.status, actor) });
    }
    const fStruct = action.match(/^form-definitions\/([^/]+)\/structure$/);
    if (fStruct && (method === "PUT" || method === "PATCH")) {
      if (!manage) return deny();
      return ok(200, { result: await repo.setDraftStructure(tenantId, fStruct[1], body, actor) });
    }
    const fDict = action.match(/^form-definitions\/([^/]+)\/structure\/dictionary$/);
    if (fDict && method === "POST") {
      if (!manage) return deny();
      return ok(200, { result: await repo.applyDictionaryStructure(tenantId, fDict[1], actor) });
    }
    const fPublish = action.match(/^form-definitions\/([^/]+)\/publish$/);
    if (fPublish && method === "POST") {
      if (!authz.canPublish(user)) return deny();
      return ok(200, { version: await repo.publishVersion(tenantId, fPublish[1], actor) });
    }
    const fVersions = action.match(/^form-definitions\/([^/]+)\/versions$/);
    if (fVersions && method === "POST") {
      if (!manage) return deny();
      return ok(201, { version: await repo.createNewVersion(tenantId, fVersions[1], actor) });
    }
    // Instance starten (CTO2-02): een EIGEN recht + activatie · nooit 'settings'.
    const fInstances = action.match(/^form-definitions\/([^/]+)\/instances$/);
    if (fInstances && method === "POST") {
      if (!authz.grantFor(user, "forms.instance.create")) return deny();
      const act = await repo.resolveActivation(tenantId, fInstances[1], { user, context: body.context || {}, entitlements });
      if (!act.active) return fail({ status: 403, code: "FORM_NOT_ACTIVE", message: `Formulier niet actief (${act.blockedBy}): ${act.reason}` });
      const created = await repo.createInstance(tenantId, { ...body, definition_id: fInstances[1] }, actor);
      return ok(201, { instance: created }, { ETag: '"1"' });
    }

    // ── Activatie, assignments, reporting (definitie-niveau) ──
    const fActivation = action.match(/^form-definitions\/([^/]+)\/activation$/);
    if (fActivation && method === "GET") {
      const ctxQ = { ...queryContext(req), ...(body.context || {}) };
      const res = await repo.resolveActivation(tenantId, fActivation[1], { user, context: ctxQ, entitlements });
      return ok(200, { activation: res });
    }
    const fAssign = action.match(/^form-definitions\/([^/]+)\/assignments$/);
    if (fAssign && method === "GET") {
      if (!manage && !authz.grantFor(user, "forms.assign")) return deny();
      return ok(200, { assignments: await repo.listAssignments(tenantId, fAssign[1]) });
    }
    if (fAssign && method === "POST") {
      if (!manage && !authz.grantFor(user, "forms.assign")) return deny();
      return ok(201, { assignment: await repo.createAssignment(tenantId, fAssign[1], body, actor) });
    }
    const fAssignId = action.match(/^form-definitions\/([^/]+)\/assignments\/([^/]+)$/);
    if (fAssignId && method === "DELETE") {
      if (!manage && !authz.grantFor(user, "forms.assign")) return deny();
      return ok(200, { result: await repo.revokeAssignment(tenantId, fAssignId[2], actor) });
    }
    const fReport = action.match(/^form-definitions\/([^/]+)\/report$/);
    if (fReport && method === "GET") {
      if (!manage && !authz.grantFor(user, "forms.report")) return deny();
      const ctxQ = queryContext(req);
      return ok(200, { report: await repo.reportOnDefinition(tenantId, fReport[1], { user, aiConsumer: ctxQ.consumer === "ai" }) });
    }
    if (action === "form-retention/apply" && method === "POST") {
      if (!authz.grantFor(user, "forms.retention.manage")) return deny();
      return ok(200, { result: await repo.applyRetention(tenantId, { dryRun: body.dryRun === true, executor: actor }) });
    }
    if (action === "form-reminders/run" && method === "POST") {
      if (!authz.grantFor(user, "forms.retention.manage")) return deny();
      return ok(200, { result: await repo.processReminders(tenantId) });
    }

    // ── Instances · altijd action + record-scope vóór de repository-call ──
    const iGet = action.match(/^form-instances\/([^/]+)$/);
    if (iGet && method === "GET") {
      const inst = await guardedInstance(iGet[1], "view");
      if (!inst) return deny();
      const answers = engine.redactAnswers(user, inst.fields, inst.answers);
      const visibleFields = (inst.fields || []).filter(f => engine.canViewField(user, f));
      const { fields, answers: _a, ...rest } = inst;
      return ok(200, { instance: { ...rest, answers, fields: visibleFields } }, { ETag: `"${inst.version}"` });
    }
    if (iGet && (method === "PATCH" || method === "PUT")) {
      if (!(await guardedInstance(iGet[1], "edit"))) return deny();
      const r = await repo.saveDraft(tenantId, iGet[1], { answers: body.answers || {}, expectedVersion: body.expectedVersion || ifMatch(req), user }, actor);
      return ok(200, { result: r }, { ETag: `"${r.version}"` });
    }
    const iSubmit = action.match(/^form-instances\/([^/]+)\/submit$/);
    if (iSubmit && method === "POST") {
      if (!(await guardedInstance(iSubmit[1], "submit"))) return deny();
      const r = await repo.submitInstance(tenantId, iSubmit[1], { answers: body.answers || null, idempotencyKey: body.idempotencyKey || idempotencyKey(req), user }, actor);
      return ok(200, { result: r });
    }
    const iTrans = action.match(/^form-instances\/([^/]+)\/transition$/);
    if (iTrans && method === "POST") {
      // De DOELstatus bepaalt het vereiste recht (withdraw/approve/manage/...).
      const inst = await repo.getInstance(tenantId, iTrans[1]);
      if (!inst || !authz.canInstance(user, inst, authz.rightForTransition(body.status), ctx)) return deny();
      const r = await repo.transition(tenantId, iTrans[1], body.status, actor, { expectedVersion: body.expectedVersion || ifMatch(req) });
      return ok(200, { result: r });
    }
    const iApprove = action.match(/^form-instances\/([^/]+)\/approve$/);
    if (iApprove && method === "POST") {
      // CTO2-04: goedkeuren vraagt het goedkeuringsrecht binnen de juiste scope;
      // een approval-policy met approverslijst blijft daarbovenop bindend (repo).
      if (!(await guardedInstance(iApprove[1], "forms.approve"))) return deny();
      const r = await repo.actOnApproval(tenantId, iApprove[1], {
        stepNo: body.stepNo || 1, decision: body.decision, note: body.note || null,
        actorRole: (user && user.role) || null, hasApproveRight: true,
      }, actor);
      return ok(200, { result: r });
    }
    const iAtt = action.match(/^form-instances\/([^/]+)\/attachments$/);
    if (iAtt && method === "GET") {
      const inst = await guardedInstance(iAtt[1], "view");
      if (!inst) return deny();
      const rows = await repo.listAttachments(tenantId, iAtt[1]);
      // CTO2-06: interne object keys niet lekken zonder download-/exportrecht.
      const mayDownload = manage || authz.grantFor(user, "forms.export");
      return ok(200, { attachments: rows.map(a => (mayDownload ? a : { ...a, object_key: undefined })) });
    }
    if (iAtt && method === "POST") {
      if (!(await guardedInstance(iAtt[1], "edit"))) return deny();
      // CTO2-06: de SERVER geeft de object key uit · client-geleverde keys genegeerd.
      const r = await repo.addAttachment(tenantId, iAtt[1], {
        field_key: body.field_key || null,
        file_name: body.file_name || null, mime_type: body.mime_type || null,
        size_bytes: body.size_bytes || 0, gps: body.gps || null,
      }, actor);
      return ok(201, { attachment: r });
    }
    const iSign = action.match(/^form-instances\/([^/]+)\/sign$/);
    if (iSign && method === "POST") {
      // CTO2-05: intern tekenen vraagt forms.sign + scope; externe ondertekening
      // loopt UITSLUITEND via het publieke token-pad (server.js), nooit hier.
      if (!(await guardedInstance(iSign[1], "forms.sign"))) return deny();
      const r = await repo.captureSignature(tenantId, iSign[1], {
        signer_name: body.signer_name || body.signerName,
        signer_ref: body.signer_ref || body.signerRef || null,
        transitionToSigned: body.transitionToSigned !== false,
        evidence: { type: "internal", permission: "forms.sign", actor },
      }, actor);
      return ok(200, { result: r });
    }
    const iEvents = action.match(/^form-instances\/([^/]+)\/events$/);
    if (iEvents && method === "GET") {
      if (!(await guardedInstance(iEvents[1], "view"))) return deny();
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
    action.startsWith("form-instances/") || action.startsWith("form-retention/") ||
    action.startsWith("form-reminders/");
}

module.exports = { handleFormsRoute, isFormsAction };
