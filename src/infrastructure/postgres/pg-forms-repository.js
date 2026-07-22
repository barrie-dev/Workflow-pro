"use strict";

// ── pg-forms-repository · canonieke persistentie voor de Forms-capability ────
// Schrijft naar de 14 form_-tabellen (migratie 008_forms) BINNEN de RLS-tenant-
// context (withTenant → set_config app.tenant_id). Gebruikt de pure forms-engine
// voor alle beslissingen (state-machine, immutable publish, SoD, validatie).
// Eén engine, één repository · geen tweede waarheid (finale CTO-directive).

const crypto = require("crypto");
const { withTenant } = require("./pg-customer-repository");
const engine = require("../../platform/forms-engine");
const activation = require("../../platform/forms-activation");

function id(prefix) { return `${prefix}_${crypto.randomBytes(10).toString("hex")}`; }
function sha256(v) { return crypto.createHash("sha256").update(String(v)).digest("hex"); }
function clean(v) { return String(v == null ? "" : v).trim(); }
function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }

function makePgFormsRepository(pool, { domainCommands = null } = {}) {
  const q = (client, sql, params) => client.query(sql, params);
  const { dispatchMomentFor } = require("../../platform/forms-domain-commands");

  // Dispatch een domeincommand BINNEN de lopende transactie (zelfde client): een
  // falend command draait de statusovergang mee terug (F4: transactioneel).
  async function dispatchDomain(client, tenantId, { instance, moment, actor }) {
    if (!domainCommands) return null;
    const def = (await q(client, `SELECT * FROM form_definitions WHERE tenant_id=$1 AND id=$2`, [tenantId, instance.definition_id])).rows[0];
    if (!def || dispatchMomentFor(def.form_type) !== moment) return null;
    if (!domainCommands.has(def.domain_object)) return null;
    const stored = (await q(client, `SELECT field_key, value_json FROM form_answers WHERE tenant_id=$1 AND instance_id=$2`, [tenantId, instance.id])).rows;
    const answers = {}; for (const a of stored) answers[a.field_key] = a.value_json;
    const result = await domainCommands.dispatch({ client, tenantId, definition: def, instance, answers, actor });
    if (result) {
      await appendEvent(client, tenantId, { instanceId: instance.id, definitionId: def.id, eventType: "domain.command.applied", actor, data: { domainObject: def.domain_object, result } });
    }
    return result;
  }

  async function appendEvent(client, tenantId, { instanceId = null, definitionId = null, eventType, actor = null, data = {} }) {
    await q(client, `INSERT INTO form_events (id, tenant_id, instance_id, definition_id, event_type, actor, data)
                     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id("fev"), tenantId, instanceId, definitionId, eventType, actor, JSON.stringify(data || {})]);
  }

  // ── Definities ─────────────────────────────────────────────────────────────
  async function createDefinition(tenantId, payload, actor) {
    const key = clean(payload.key);
    const name = clean(payload.name);
    if (!key) throw err(400, "FORM_KEY_REQUIRED", "key is verplicht");
    if (!name) throw err(400, "FORM_NAME_REQUIRED", "name is verplicht");
    if (payload.form_type && !engine.FORM_TYPES.includes(payload.form_type)) throw err(400, "FORM_TYPE_INVALID", "onbekend form_type");
    return withTenant(pool, tenantId, async client => {
      const defId = id("fdef");
      await q(client, `INSERT INTO form_definitions
        (id, tenant_id, company_id, key, name, form_type, category, status, domain_object, data_classification, retention_policy_id, attributes, created_by, updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
        [defId, tenantId, payload.company_id || null, key, name, payload.form_type || "domain", payload.category || null,
         payload.status && engine.DEFINITION_STATUSES.includes(payload.status) ? payload.status : "available",
         payload.domain_object || null, payload.data_classification || "internal", payload.retention_policy_id || null,
         JSON.stringify(payload.attributes || {}), actor || null]);
      // Elke definitie start met een bewerkbare draft-versie 1.
      const verId = id("fver");
      await q(client, `INSERT INTO form_versions (id, tenant_id, definition_id, version_number, published, created_by)
                       VALUES ($1,$2,$3,1,false,$4)`, [verId, tenantId, defId, actor || null]);
      await appendEvent(client, tenantId, { definitionId: defId, eventType: "form.definition.created", actor });
      return { id: defId, key, draftVersionId: verId, versionNumber: 1 };
    });
  }

  async function getDefinition(tenantId, defId) {
    return withTenant(pool, tenantId, async client => {
      const d = (await q(client, `SELECT * FROM form_definitions WHERE tenant_id=$1 AND id=$2`, [tenantId, defId])).rows[0] || null;
      if (!d) return null;
      const versions = (await q(client, `SELECT id, version_number, published, published_at FROM form_versions WHERE tenant_id=$1 AND definition_id=$2 ORDER BY version_number`, [tenantId, defId])).rows;
      return { ...d, versions };
    });
  }

  async function listDefinitions(tenantId, { status = null } = {}) {
    return withTenant(pool, tenantId, async client =>
      (await q(client, `SELECT * FROM form_definitions WHERE tenant_id=$1 ${status ? "AND status=$2" : ""} ORDER BY key`,
        status ? [tenantId, status] : [tenantId])).rows);
  }

  async function setDefinitionStatus(tenantId, defId, status, actor) {
    if (!engine.DEFINITION_STATUSES.includes(status)) throw err(400, "FORM_STATUS_INVALID", "onbekende status");
    return withTenant(pool, tenantId, async client => {
      const r = await q(client, `UPDATE form_definitions SET status=$3, updated_by=$4, version=version+1
                                 WHERE tenant_id=$1 AND id=$2 RETURNING *`, [tenantId, defId, status, actor || null]);
      if (!r.rows[0]) throw err(404, "FORM_NOT_FOUND", "definitie niet gevonden");
      await appendEvent(client, tenantId, { definitionId: defId, eventType: "form.definition.status_changed", actor, data: { status } });
      return r.rows[0];
    });
  }

  // ── Versies · draft bewerken, dan publiceren (immutable) ─────────────────────
  async function getDraftVersion(client, tenantId, defId) {
    return (await q(client, `SELECT * FROM form_versions WHERE tenant_id=$1 AND definition_id=$2 AND published=false ORDER BY version_number DESC LIMIT 1`, [tenantId, defId])).rows[0] || null;
  }

  // Zet de volledige veld/sectie/regel-structuur op de DRAFT-versie (vervangt).
  async function setDraftStructure(tenantId, defId, { sections = [], fields = [], rules = [] }, actor) {
    return withTenant(pool, tenantId, async client => {
      const ver = await getDraftVersion(client, tenantId, defId);
      if (!ver) throw err(409, "NO_DRAFT_VERSION", "Geen bewerkbare draft-versie; maak eerst een nieuwe versie.");
      engine.assertVersionEditable(ver);
      // Vervang de structuur van deze draft.
      await q(client, `DELETE FROM form_rules WHERE tenant_id=$1 AND version_id=$2`, [tenantId, ver.id]);
      await q(client, `DELETE FROM form_fields WHERE tenant_id=$1 AND version_id=$2`, [tenantId, ver.id]);
      await q(client, `DELETE FROM form_sections WHERE tenant_id=$1 AND version_id=$2`, [tenantId, ver.id]);
      const sectionIdByKey = new Map();
      let so = 0;
      for (const s of sections) {
        const sid = id("fsec");
        sectionIdByKey.set(s.key || s.section_key, sid);
        await q(client, `INSERT INTO form_sections (id, tenant_id, version_id, section_key, title, help_text, sort_order, repeatable)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [sid, tenantId, ver.id, clean(s.key || s.section_key), JSON.stringify(s.title || {}), JSON.stringify(s.help_text || {}), so++, !!s.repeatable]);
      }
      let fo = 0;
      for (const f of fields) {
        const fclass = engine.CLASSIFICATIONS.includes(f.data_classification) ? f.data_classification : "internal";
        const freq = engine.REQUIRED_LEVELS.includes(f.required) ? f.required : "optional";
        await q(client, `INSERT INTO form_fields
          (id, tenant_id, version_id, section_id, field_key, label, help_text, field_type, data_classification, required, domain_field, view_permission, edit_permission, reporting_allowed, ai_allowed, validation, sort_order, attributes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [id("ffld"), tenantId, ver.id, sectionIdByKey.get(f.section_key) || null, clean(f.field_key || f.key),
           JSON.stringify(f.label || {}), JSON.stringify(f.help_text || {}), clean(f.field_type || "text"), fclass, freq,
           f.domain_field || null, f.view_permission || null, f.edit_permission || null, !!f.reporting_allowed, !!f.ai_allowed,
           JSON.stringify(f.validation || {}), fo++, JSON.stringify(f.attributes || {})]);
      }
      let ro = 0;
      for (const r of rules) {
        await q(client, `INSERT INTO form_rules (id, tenant_id, version_id, rule_type, definition, sort_order)
                         VALUES ($1,$2,$3,$4,$5,$6)`,
          [id("frul"), tenantId, ver.id, clean(r.rule_type), JSON.stringify(r.definition || {}), ro++]);
      }
      await appendEvent(client, tenantId, { definitionId: defId, eventType: "form.draft.updated", actor, data: { versionId: ver.id } });
      return { versionId: ver.id, versionNumber: ver.version_number, sections: sections.length, fields: fields.length, rules: rules.length };
    });
  }

  async function loadVersionStructure(client, tenantId, versionId) {
    const sections = (await q(client, `SELECT * FROM form_sections WHERE tenant_id=$1 AND version_id=$2 ORDER BY sort_order`, [tenantId, versionId])).rows;
    const fields = (await q(client, `SELECT * FROM form_fields WHERE tenant_id=$1 AND version_id=$2 ORDER BY sort_order`, [tenantId, versionId])).rows;
    const rules = (await q(client, `SELECT * FROM form_rules WHERE tenant_id=$1 AND version_id=$2 ORDER BY sort_order`, [tenantId, versionId])).rows;
    return { sections, fields, rules };
  }

  // Publiceer de draft: bevries de snapshot, maak onveranderlijk, en zet current_version.
  async function publishVersion(tenantId, defId, actor) {
    return withTenant(pool, tenantId, async client => {
      const ver = await getDraftVersion(client, tenantId, defId);
      if (!ver) throw err(409, "NO_DRAFT_VERSION", "Geen draft-versie om te publiceren.");
      const struct = await loadVersionStructure(client, tenantId, ver.id);
      const snapshot = { sections: struct.sections, fields: struct.fields, rules: struct.rules, publishedAt: new Date().toISOString() };
      await q(client, `UPDATE form_versions SET published=true, published_at=now(), published_by=$3, snapshot=$4
                       WHERE tenant_id=$1 AND id=$2`, [tenantId, ver.id, actor || null, JSON.stringify(snapshot)]);
      await q(client, `UPDATE form_definitions SET current_version=$3, updated_by=$4, version=version+1
                       WHERE tenant_id=$1 AND id=$2`, [tenantId, defId, ver.version_number, actor || null]);
      await appendEvent(client, tenantId, { definitionId: defId, eventType: "form.version.published", actor, data: { versionId: ver.id, versionNumber: ver.version_number } });
      return { versionId: ver.id, versionNumber: ver.version_number, published: true };
    });
  }

  // Maak een NIEUWE draft-versie (kopie van de laatste gepubliceerde structuur).
  async function createNewVersion(tenantId, defId, actor) {
    return withTenant(pool, tenantId, async client => {
      const existing = (await q(client, `SELECT version_number FROM form_versions WHERE tenant_id=$1 AND definition_id=$2`, [tenantId, defId])).rows.map(r => r.version_number);
      if (existing.length && (await getDraftVersion(client, tenantId, defId))) throw err(409, "DRAFT_ALREADY_OPEN", "Er is al een openstaande draft-versie.");
      const nextNo = engine.nextVersionNumber(existing);
      const newVerId = id("fver");
      await q(client, `INSERT INTO form_versions (id, tenant_id, definition_id, version_number, published, created_by)
                       VALUES ($1,$2,$3,$4,false,$5)`, [newVerId, tenantId, defId, nextNo, actor || null]);
      // Kopieer de structuur van de laatst gepubliceerde versie.
      const lastPub = (await q(client, `SELECT id FROM form_versions WHERE tenant_id=$1 AND definition_id=$2 AND published=true ORDER BY version_number DESC LIMIT 1`, [tenantId, defId])).rows[0];
      if (lastPub) {
        const s = await loadVersionStructure(client, tenantId, lastPub.id);
        const secMap = new Map();
        for (const sec of s.sections) { const nid = id("fsec"); secMap.set(sec.id, nid); await q(client, `INSERT INTO form_sections (id,tenant_id,version_id,section_key,title,help_text,sort_order,repeatable) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [nid, tenantId, newVerId, sec.section_key, JSON.stringify(sec.title), JSON.stringify(sec.help_text), sec.sort_order, sec.repeatable]); }
        for (const f of s.fields) await q(client, `INSERT INTO form_fields (id,tenant_id,version_id,section_id,field_key,label,help_text,field_type,data_classification,required,domain_field,view_permission,edit_permission,reporting_allowed,ai_allowed,validation,sort_order,attributes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, [id("ffld"), tenantId, newVerId, secMap.get(f.section_id) || null, f.field_key, JSON.stringify(f.label), JSON.stringify(f.help_text), f.field_type, f.data_classification, f.required, f.domain_field, f.view_permission, f.edit_permission, f.reporting_allowed, f.ai_allowed, JSON.stringify(f.validation), f.sort_order, JSON.stringify(f.attributes)]);
        for (const r of s.rules) await q(client, `INSERT INTO form_rules (id,tenant_id,version_id,rule_type,definition,sort_order) VALUES ($1,$2,$3,$4,$5,$6)`, [id("frul"), tenantId, newVerId, r.rule_type, JSON.stringify(r.definition), r.sort_order]);
      }
      await appendEvent(client, tenantId, { definitionId: defId, eventType: "form.version.created", actor, data: { versionId: newVerId, versionNumber: nextNo } });
      return { versionId: newVerId, versionNumber: nextNo };
    });
  }

  // ── Instances · lifecycle ────────────────────────────────────────────────────
  async function createInstance(tenantId, payload, actor) {
    return withTenant(pool, tenantId, async client => {
      const def = (await q(client, `SELECT id, current_version, data_classification, retention_policy_id FROM form_definitions WHERE tenant_id=$1 AND id=$2`, [tenantId, payload.definition_id])).rows[0];
      if (!def) throw err(404, "FORM_NOT_FOUND", "definitie niet gevonden");
      if (!def.current_version) throw err(409, "FORM_NOT_PUBLISHED", "Deze definitie heeft nog geen gepubliceerde versie.");
      const ver = (await q(client, `SELECT id FROM form_versions WHERE tenant_id=$1 AND definition_id=$2 AND version_number=$3`, [tenantId, def.id, def.current_version])).rows[0];
      const instId = id("finst");
      // Universele metadata (h5): de instance erft classificatie + bewaarbeleid
      // van zijn definitie, tenzij expliciet strenger meegegeven.
      await q(client, `INSERT INTO form_instances
        (id, tenant_id, company_id, definition_id, version_id, assignment_id, subject_type, subject_id, status, assigned_to, idempotency_key, source, data_classification, retention_policy_id, created_by, updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10,$11,$12,$13,$14,$14)`,
        [instId, tenantId, payload.company_id || null, def.id, ver.id, payload.assignment_id || null,
         payload.subject_type || null, payload.subject_id || null, payload.assigned_to || actor || null,
         payload.idempotency_key || null, payload.source || "ui",
         payload.data_classification || def.data_classification || "internal",
         payload.retention_policy_id || def.retention_policy_id || null, actor || null]);
      await appendEvent(client, tenantId, { instanceId: instId, definitionId: def.id, eventType: "form.assigned", actor });
      return { id: instId, definitionId: def.id, versionId: ver.id, status: "draft" };
    });
  }

  async function getInstance(tenantId, instId) {
    return withTenant(pool, tenantId, async client => {
      const inst = (await q(client, `SELECT * FROM form_instances WHERE tenant_id=$1 AND id=$2`, [tenantId, instId])).rows[0] || null;
      if (!inst) return null;
      const answers = (await q(client, `SELECT field_key, value_json FROM form_answers WHERE tenant_id=$1 AND instance_id=$2`, [tenantId, instId])).rows;
      const struct = await loadVersionStructure(client, tenantId, inst.version_id);
      const answerMap = {};
      for (const a of answers) answerMap[a.field_key] = a.value_json;
      return { ...inst, answers: answerMap, fields: struct.fields };
    });
  }

  // Sla concept-antwoorden op (alleen in bewerkbare status, met If-Match).
  async function saveDraft(tenantId, instId, { answers = {}, expectedVersion = null }, actor) {
    return withTenant(pool, tenantId, async client => {
      const inst = (await q(client, `SELECT * FROM form_instances WHERE tenant_id=$1 AND id=$2`, [tenantId, instId])).rows[0];
      if (!inst) throw err(404, "INSTANCE_NOT_FOUND", "instance niet gevonden");
      engine.assertIfMatch(inst.version, expectedVersion);
      if (!engine.isEditable(inst.status)) throw err(409, "INSTANCE_NOT_EDITABLE", `In status ${inst.status} zijn antwoorden niet bewerkbaar.`);
      for (const [key, val] of Object.entries(answers)) {
        await q(client, `INSERT INTO form_answers (id, tenant_id, instance_id, field_key, value_json)
                         VALUES ($1,$2,$3,$4,$5)
                         ON CONFLICT (tenant_id, instance_id, field_key) DO UPDATE SET value_json=EXCLUDED.value_json, updated_at=now()`,
          [id("fans"), tenantId, instId, key, JSON.stringify(val)]);
      }
      await q(client, `UPDATE form_instances SET version=version+1, updated_by=$3 WHERE tenant_id=$1 AND id=$2`, [tenantId, instId, actor || null]);
      await appendEvent(client, tenantId, { instanceId: instId, eventType: "draft.saved", actor });
      return { ok: true, version: inst.version + 1 };
    });
  }

  // Idempotente submit: valideert, bouwt de typed index, en zet draft→submitted.
  async function submitInstance(tenantId, instId, { answers = null, idempotencyKey = null } = {}, actor) {
    return withTenant(pool, tenantId, async client => {
      const inst = (await q(client, `SELECT * FROM form_instances WHERE tenant_id=$1 AND id=$2`, [tenantId, instId])).rows[0];
      if (!inst) throw err(404, "INSTANCE_NOT_FOUND", "instance niet gevonden");
      // Idempotent: al ingediend met dezelfde sleutel → geef de bestaande terug.
      if (inst.status !== "draft" && inst.status !== "changes_requested" && inst.status !== "resubmitted") {
        if (idempotencyKey && inst.idempotency_key === idempotencyKey) return { id: instId, status: inst.status, idempotent: true };
        // Reeds ingediend en geen matchende sleutel → geen dubbele submit.
        if (inst.status === "submitted") return { id: instId, status: inst.status, idempotent: true };
      }
      if (answers) {
        for (const [key, val] of Object.entries(answers)) {
          await q(client, `INSERT INTO form_answers (id, tenant_id, instance_id, field_key, value_json) VALUES ($1,$2,$3,$4,$5)
                           ON CONFLICT (tenant_id, instance_id, field_key) DO UPDATE SET value_json=EXCLUDED.value_json, updated_at=now()`,
            [id("fans"), tenantId, instId, key, JSON.stringify(val)]);
        }
      }
      const struct = await loadVersionStructure(client, tenantId, inst.version_id);
      const stored = (await q(client, `SELECT field_key, value_json FROM form_answers WHERE tenant_id=$1 AND instance_id=$2`, [tenantId, instId])).rows;
      const answerMap = {}; for (const a of stored) answerMap[a.field_key] = a.value_json;
      const check = engine.validateAnswers(struct.fields, answerMap, { forSubmit: true });
      if (!check.ok) { const e = err(422, "VALIDATION_FAILED", "Verplichte of ongeldige velden."); e.fieldErrors = check.fieldErrors; throw e; }
      const from = inst.status === "not_started" ? "draft" : inst.status;
      const to = "submitted";
      engine.assertTransition(from === "changes_requested" || from === "resubmitted" ? from : "draft", "submitted");
      // Herbouw de typed answer-index.
      await q(client, `DELETE FROM form_answer_index WHERE tenant_id=$1 AND instance_id=$2`, [tenantId, instId]);
      for (const r of engine.buildAnswerIndex(struct.fields, answerMap)) {
        await q(client, `INSERT INTO form_answer_index (id, tenant_id, instance_id, field_key, value_text, value_num, value_date, reporting_allowed, ai_allowed)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id("fidx"), tenantId, instId, r.field_key, r.value_text, r.value_num, r.value_date, r.reporting_allowed, r.ai_allowed]);
      }
      await q(client, `UPDATE form_instances SET status='submitted', submitted_at=now(), idempotency_key=COALESCE($3, idempotency_key), version=version+1, updated_by=$4
                       WHERE tenant_id=$1 AND id=$2`, [tenantId, instId, idempotencyKey, actor || null]);
      await appendEvent(client, tenantId, { instanceId: instId, definitionId: inst.definition_id, eventType: "submitted", actor });
      // F4 · domeinformulier: de inzending schrijft transactioneel naar het
      // canonieke domeinobject (faalt het command, dan draait de submit terug).
      const domain = await dispatchDomain(client, tenantId, { instance: inst, moment: "submit", actor });
      return { id: instId, status: "submitted", idempotent: false, domain: domain || undefined };
    });
  }

  // Statusovergang (in_review/approved/rejected/…), altijd via de state-machine.
  async function transition(tenantId, instId, toStatus, actor, { expectedVersion = null } = {}) {
    return withTenant(pool, tenantId, async client => {
      const inst = (await q(client, `SELECT * FROM form_instances WHERE tenant_id=$1 AND id=$2`, [tenantId, instId])).rows[0];
      if (!inst) throw err(404, "INSTANCE_NOT_FOUND", "instance niet gevonden");
      engine.assertIfMatch(inst.version, expectedVersion);
      engine.assertTransition(inst.status, toStatus);
      const sets = ["status=$3", "version=version+1", "updated_by=$4"];
      if (toStatus === "completed") sets.push("completed_at=now()");
      if (toStatus === "archived") sets.push("archived_at=now()");
      await q(client, `UPDATE form_instances SET ${sets.join(", ")} WHERE tenant_id=$1 AND id=$2`, [tenantId, instId, toStatus, actor || null]);
      await appendEvent(client, tenantId, { instanceId: instId, eventType: toStatus, actor });
      return { id: instId, status: toStatus };
    });
  }

  // Goedkeuringsactie met segregation of duties én het h26-beleid: serial,
  // parallel en any-of/all-of via attributes.approval_policy op de definitie.
  // Zonder beleid: één goedkeuring volstaat (ongewijzigd gedrag).
  async function actOnApproval(tenantId, instId, { stepNo = 1, decision, note = null, actorRole = null }, actor) {
    return withTenant(pool, tenantId, async client => {
      const inst = (await q(client, `SELECT * FROM form_instances WHERE tenant_id=$1 AND id=$2`, [tenantId, instId])).rows[0];
      if (!inst) throw err(404, "INSTANCE_NOT_FOUND", "instance niet gevonden");
      const def = (await q(client, `SELECT attributes FROM form_definitions WHERE tenant_id=$1 AND id=$2`, [tenantId, inst.definition_id])).rows[0];
      const policy = (def && def.attributes && def.attributes.approval_policy) || null;
      const existing = (await q(client, `SELECT step_no, actor, decision FROM form_approval_actions WHERE tenant_id=$1 AND instance_id=$2`, [tenantId, instId])).rows;

      // De effectieve stap is de eerst nog-openstaande stap uit het beleid; de
      // client kan geen stap overslaan (serial). Zonder beleid telt stepNo.
      let effectiveStep = stepNo;
      let stepDef = null;
      if (policy) {
        const state = engine.evaluateApprovals(policy, existing);
        if (state.status !== "pending") throw err(409, "APPROVALS_ALREADY_DECIDED", `De goedkeuringsflow is al ${state.status}.`);
        effectiveStep = state.pendingStep;
        stepDef = (policy.steps || []).find(s => Number(s.step_no) === Number(effectiveStep)) || null;
        if (!engine.actorAllowedForStep(stepDef, actor, actorRole)) {
          throw err(403, "APPROVER_NOT_ALLOWED", "Je staat niet in de goedkeurderslijst voor deze stap.");
        }
      }
      const prior = existing.filter(a => Number(a.step_no) === Number(effectiveStep)).map(a => a.actor);
      engine.assertSegregationOfDuties({ actor, submitter: inst.created_by, priorActors: prior });
      await q(client, `INSERT INTO form_approval_actions (id, tenant_id, instance_id, step_no, actor, decision, note)
                       VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id("faca"), tenantId, instId, effectiveStep, actor, decision, note]);

      // changes_requested kortsluit het beleid (terug naar de indiener).
      if (decision === "changes_requested") {
        engine.assertTransition(inst.status, "changes_requested");
        await q(client, `UPDATE form_instances SET status='changes_requested', version=version+1, updated_by=$3 WHERE tenant_id=$1 AND id=$2`, [tenantId, instId, actor || null]);
        await appendEvent(client, tenantId, { instanceId: instId, eventType: "changes_requested", actor, data: { stepNo: effectiveStep, decision } });
        return { id: instId, status: "changes_requested", decision, step: effectiveStep };
      }

      // Evalueer het volledige beleid mét deze actie erbij.
      const after = engine.evaluateApprovals(policy, [...existing, { step_no: effectiveStep, actor, decision }]);
      if (after.status === "pending") {
        // Stap (nog) niet voldaan of volgende stap wacht → in_review, geen finale status.
        if (inst.status !== "in_review") {
          engine.assertTransition(inst.status, "in_review");
          await q(client, `UPDATE form_instances SET status='in_review', version=version+1, updated_by=$3 WHERE tenant_id=$1 AND id=$2`, [tenantId, instId, actor || null]);
        }
        await appendEvent(client, tenantId, { instanceId: instId, eventType: "approval.step", actor, data: { stepNo: effectiveStep, decision, pendingStep: after.pendingStep } });
        return { id: instId, status: "in_review", decision, step: effectiveStep, pendingStep: after.pendingStep };
      }
      const toStatus = after.status; // approved | rejected
      engine.assertTransition(inst.status, toStatus);
      await q(client, `UPDATE form_instances SET status=$3, version=version+1, updated_by=$4 WHERE tenant_id=$1 AND id=$2`, [tenantId, instId, toStatus, actor || null]);
      await appendEvent(client, tenantId, { instanceId: instId, eventType: toStatus, actor, data: { stepNo: effectiveStep, decision } });
      // F4 · workflowformulier: pas ná finale goedkeuring naar het domeinobject
      // ("form instance tot goedkeuring, daarna domeinobject").
      const domain = toStatus === "approved"
        ? await dispatchDomain(client, tenantId, { instance: inst, moment: "approve", actor })
        : null;
      return { id: instId, status: toStatus, decision, step: effectiveStep, domain: domain || undefined };
    });
  }

  // ── F2/F3 · assignments, activatie, externe tokens en handtekeningen ─────────

  // Wijs een definitie toe aan een scope (tenant/company/team/role/user/project/
  // customer/workorder/asset/supplier/external). Voor 'external' wordt een token
  // gegenereerd; enkel de HASH wordt bewaard en het ruwe token één keer geretourneerd.
  async function createAssignment(tenantId, defId, payload = {}, actor) {
    const scopeType = clean(payload.scope_type);
    const VALID = ["tenant", "company", "team", "role", "user", "project", "customer", "workorder", "asset", "supplier", "external"];
    if (!VALID.includes(scopeType)) throw err(400, "ASSIGNMENT_SCOPE_INVALID", "onbekend scope_type");
    return withTenant(pool, tenantId, async client => {
      const def = (await q(client, `SELECT id FROM form_definitions WHERE tenant_id=$1 AND id=$2`, [tenantId, defId])).rows[0];
      if (!def) throw err(404, "FORM_NOT_FOUND", "definitie niet gevonden");
      const aid = id("fasg");
      let rawToken = null, tokenHash = null, expiresAt = null;
      if (scopeType === "external") {
        rawToken = crypto.randomBytes(24).toString("base64url");
        tokenHash = sha256(rawToken);
        expiresAt = payload.token_expires_at || null;
      }
      await q(client, `INSERT INTO form_assignments (id, tenant_id, definition_id, scope_type, scope_id, active, external_token_hash, token_expires_at, created_by)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [aid, tenantId, defId, scopeType, payload.scope_id || null, payload.active !== false, tokenHash, expiresAt, actor || null]);
      await appendEvent(client, tenantId, { definitionId: defId, eventType: "form.assignment.created", actor, data: { scopeType, scopeId: payload.scope_id || null } });
      // Ruw token enkel bij aanmaak teruggeven (nooit meer opvraagbaar).
      return { id: aid, scope_type: scopeType, scope_id: payload.scope_id || null, token: rawToken, token_expires_at: expiresAt };
    });
  }

  async function listAssignments(tenantId, defId) {
    return withTenant(pool, tenantId, async client =>
      (await q(client, `SELECT id, scope_type, scope_id, active, token_expires_at, revoked_at, created_at, created_by,
                               (external_token_hash IS NOT NULL) AS has_token
                        FROM form_assignments WHERE tenant_id=$1 AND definition_id=$2 ORDER BY created_at`, [tenantId, defId])).rows);
  }

  async function revokeAssignment(tenantId, assignmentId, actor) {
    return withTenant(pool, tenantId, async client => {
      const r = await q(client, `UPDATE form_assignments SET active=false, revoked_at=now()
                                 WHERE tenant_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING definition_id`, [tenantId, assignmentId]);
      if (!r.rows[0]) throw err(404, "ASSIGNMENT_NOT_FOUND", "toewijzing niet gevonden of al ingetrokken");
      await appendEvent(client, tenantId, { definitionId: r.rows[0].definition_id, eventType: "form.assignment.revoked", actor, data: { assignmentId } });
      return { id: assignmentId, revoked: true };
    });
  }

  // Los de 8-lagen activatie op voor een definitie in een context (h2). De
  // aanroeper levert de entitlements van de tenant (uit het entitlement-systeem).
  async function resolveActivation(tenantId, defId, { user = null, context = {}, entitlements = [], now = Date.now() } = {}) {
    return withTenant(pool, tenantId, async client => {
      const def = (await q(client, `SELECT * FROM form_definitions WHERE tenant_id=$1 AND id=$2`, [tenantId, defId])).rows[0] || null;
      if (!def) return activation.resolveActivation(null, {});
      const assignments = (await q(client, `SELECT scope_type, scope_id, active, revoked_at FROM form_assignments WHERE tenant_id=$1 AND definition_id=$2`, [tenantId, defId])).rows;
      return activation.resolveActivation(def, { user, context, entitlements, assignments, now });
    });
  }

  // Valideer een extern token → de bijhorende (niet-ingetrokken, niet-verlopen)
  // assignment, of null. Vergelijkt op hash; het ruwe token verlaat de client nooit.
  async function resolveExternalToken(tenantId, defId, rawToken, { now = Date.now() } = {}) {
    if (!rawToken) return null;
    const hash = sha256(rawToken);
    return withTenant(pool, tenantId, async client => {
      const a = (await q(client, `SELECT * FROM form_assignments WHERE tenant_id=$1 AND definition_id=$2 AND scope_type='external' AND external_token_hash=$3`, [tenantId, defId, hash])).rows[0];
      if (!a) return null;
      if (a.revoked_at || a.active === false) return null;
      if (a.token_expires_at && Date.parse(a.token_expires_at) < now) return null;
      return { id: a.id, definition_id: defId, scope_id: a.scope_id };
    });
  }

  // Leg een handtekening vast, gebonden aan de instance-versie + een inhouds-hash
  // (integriteit). Optioneel schuift de instance door naar 'signed' via de machine.
  async function captureSignature(tenantId, instId, { signer_name, signer_ref = null, transitionToSigned = true }, actor) {
    if (!clean(signer_name)) throw err(400, "SIGNER_REQUIRED", "signer_name is verplicht");
    return withTenant(pool, tenantId, async client => {
      const inst = (await q(client, `SELECT * FROM form_instances WHERE tenant_id=$1 AND id=$2`, [tenantId, instId])).rows[0];
      if (!inst) throw err(404, "INSTANCE_NOT_FOUND", "instance niet gevonden");
      const boundVer = (await q(client, `SELECT version_number FROM form_versions WHERE tenant_id=$1 AND id=$2`, [tenantId, inst.version_id])).rows[0];
      const stored = (await q(client, `SELECT field_key, value_json FROM form_answers WHERE tenant_id=$1 AND instance_id=$2 ORDER BY field_key`, [tenantId, instId])).rows;
      const boundHash = sha256(JSON.stringify(stored));
      await q(client, `INSERT INTO form_signatures (id, tenant_id, instance_id, signer_name, signer_ref, bound_version, bound_hash)
                       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id("fsig"), tenantId, instId, clean(signer_name), signer_ref, boundVer ? boundVer.version_number : null, boundHash]);
      let status = inst.status;
      if (transitionToSigned && engine.canTransition(inst.status, "signed")) {
        await q(client, `UPDATE form_instances SET status='signed', version=version+1, updated_by=$3 WHERE tenant_id=$1 AND id=$2`, [tenantId, instId, actor || null]);
        status = "signed";
      }
      await appendEvent(client, tenantId, { instanceId: instId, eventType: "signed", actor, data: { signer: clean(signer_name), boundHash } });
      return { id: instId, status, boundHash, signer: clean(signer_name) };
    });
  }

  async function listEvents(tenantId, instId) {
    return withTenant(pool, tenantId, async client =>
      (await q(client, `SELECT event_type, actor, occurred_at, data FROM form_events WHERE tenant_id=$1 AND instance_id=$2 ORDER BY occurred_at`, [tenantId, instId])).rows);
  }

  // ── F4 · standaardformulieren-seed (h25 + h23 RES-001..010) ──────────────────
  // Idempotent: bestaande keys worden overgeslagen, nooit overschreven (een tenant
  // kan een standaardformulier immers zelf hebben aangepast/geherpubliceerd).
  async function seedStandardForms(tenantId, actor, { catalog = null } = {}) {
    const { STANDARD_FORMS, attributesFor } = require("../../platform/forms-catalog");
    const entries = catalog || STANDARD_FORMS;
    return withTenant(pool, tenantId, async client => {
      const existing = new Set(
        (await q(client, `SELECT key FROM form_definitions WHERE tenant_id=$1`, [tenantId])).rows.map(r => r.key));
      const created = [], skipped = [];
      for (const entry of entries) {
        if (existing.has(entry.key)) { skipped.push(entry.key); continue; }
        const defId = id("fdef");
        await q(client, `INSERT INTO form_definitions
          (id, tenant_id, key, name, form_type, category, status, domain_object, data_classification, attributes, source, created_by, updated_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'migration',$11,$11)`,
          [defId, tenantId, entry.key, entry.name, entry.form_type, entry.key.split("-")[0],
           entry.status, entry.domain_object || null, entry.data_classification || "internal",
           JSON.stringify(attributesFor(entry)), actor || "seed"]);
        await q(client, `INSERT INTO form_versions (id, tenant_id, definition_id, version_number, published, created_by)
                         VALUES ($1,$2,$3,1,false,$4)`, [id("fver"), tenantId, defId, actor || "seed"]);
        await appendEvent(client, tenantId, { definitionId: defId, eventType: "form.definition.created", actor: actor || "seed", data: { catalog: entry.key } });
        created.push(entry.key);
      }
      return { created, skipped, total: entries.length };
    });
  }

  // Geef een (gezaaide) definitie haar normatieve draft-structuur uit de
  // velddictionary (h6-h24) · attributes.dictionary_chapter wijst het hoofdstuk.
  async function applyDictionaryStructure(tenantId, defId, actor) {
    let dict;
    try { dict = require("../../platform/field-dictionary"); }
    catch { throw err(409, "DICTIONARY_NOT_BUILT", "De velddictionary is nog niet gebouwd (scripts/build-field-dictionary.js)."); }
    const def = await getDefinition(tenantId, defId);
    if (!def) throw err(404, "FORM_NOT_FOUND", "definitie niet gevonden");
    const chapter = def.attributes && def.attributes.dictionary_chapter;
    if (!chapter) throw err(400, "NO_DICTIONARY_CHAPTER", "deze definitie heeft geen dictionary_chapter");
    const struct = dict.structureFor(chapter);
    if (!struct) throw err(404, "DICTIONARY_CHAPTER_UNKNOWN", `hoofdstuk ${chapter} staat niet in de dictionary`);
    return setDraftStructure(tenantId, defId, struct, actor);
  }

  // ── F6 · reporting over de typed answer-index (h27-pariteit) ─────────────────
  // Alleen velden met reporting_allowed=true komen in het rapport; AI-consumers
  // geven aiConsumer=true mee en krijgen enkel ai_allowed=true. Dezelfde
  // veldrechten als het scherm: gevoelige velden vallen weg voor wie ze niet mag
  // zien (parity UI/API/search/export/AI, h3).
  async function reportOnDefinition(tenantId, defId, { user = null, aiConsumer = false } = {}) {
    return withTenant(pool, tenantId, async client => {
      const def = (await q(client, `SELECT * FROM form_definitions WHERE tenant_id=$1 AND id=$2`, [tenantId, defId])).rows[0];
      if (!def) throw err(404, "FORM_NOT_FOUND", "definitie niet gevonden");
      // Veldenlijst van de actuele gepubliceerde versie voor de rechten-check.
      const ver = (await q(client, `SELECT id FROM form_versions WHERE tenant_id=$1 AND definition_id=$2 AND published ORDER BY version_number DESC LIMIT 1`, [tenantId, defId])).rows[0];
      const fields = ver ? (await q(client, `SELECT field_key, data_classification, view_permission FROM form_fields WHERE tenant_id=$1 AND version_id=$2`, [tenantId, ver.id])).rows : [];
      const fieldByKey = new Map(fields.map(f => [f.field_key, f]));
      const flag = aiConsumer ? "ai_allowed" : "reporting_allowed";
      const rows = (await q(client,
        `SELECT i.field_key, i.value_text, i.value_num, i.value_date, x.status, x.submitted_at
         FROM form_answer_index i
         JOIN form_instances x ON x.tenant_id = i.tenant_id AND x.id = i.instance_id
         WHERE i.tenant_id=$1 AND x.definition_id=$2 AND i.${flag} = true`,
        [tenantId, defId])).rows;
      // Veldrechten: strip rijen waarvan de gebruiker het veld niet mag zien.
      const visible = rows.filter(r => {
        const f = fieldByKey.get(r.field_key);
        return !f || engine.canViewField(user, f);
      });
      // Compacte aggregatie per veld (count + som voor numeriek).
      const perField = {};
      for (const r of visible) {
        const agg = perField[r.field_key] || (perField[r.field_key] = { count: 0, sum: 0, numeric: false });
        agg.count += 1;
        if (r.value_num != null) { agg.numeric = true; agg.sum += Number(r.value_num); }
      }
      return { definitionId: defId, key: def.key, consumer: aiConsumer ? "ai" : "reporting", rows: visible, aggregates: perField };
    });
  }

  // ── h27 · retentie-purge: pas het bewaarbeleid toe op afgesloten instances ───
  // GDPR-lijn: nooit stil verwijderen. soft_archive → archived; anonymize →
  // antwoorden + index leeg, skelet blijft; hard_delete → weg (CASCADE), met
  // purge-event op de definitie. Legal hold (beleid of instance) blokkeert alles.
  async function applyRetention(tenantId, { now = Date.now(), dryRun = false } = {}) {
    const retention = require("../../modules/retention-policy");
    return withTenant(pool, tenantId, async client => {
      const policies = (await q(client, `SELECT * FROM retention_policies WHERE tenant_id=$1 AND active`, [tenantId])).rows;
      const outcome = [];
      for (const pol of policies) {
        const insts = (await q(client,
          `SELECT id, status, created_at, archived_at FROM form_instances
           WHERE tenant_id=$1 AND retention_policy_id=$2
             AND status IN ('completed','void','archived','rejected','withdrawn')`,
          [tenantId, pol.id])).rows;
        const { eligible, strategy } = retention.computePurgeSet(insts, pol, { now });
        for (const inst of eligible) {
          if (dryRun) { outcome.push({ policy: pol.key, instance: inst.id, strategy, applied: false }); continue; }
          if (strategy === "soft_archive") {
            if (inst.status !== "archived") {
              await q(client, `UPDATE form_instances SET status='archived', archived_at=now(), version=version+1 WHERE tenant_id=$1 AND id=$2`, [tenantId, inst.id]);
              await appendEvent(client, tenantId, { instanceId: inst.id, eventType: "retention.archived", data: { policy: pol.key } });
            }
          } else if (strategy === "anonymize") {
            await q(client, `DELETE FROM form_answers WHERE tenant_id=$1 AND instance_id=$2`, [tenantId, inst.id]);
            await q(client, `DELETE FROM form_answer_index WHERE tenant_id=$1 AND instance_id=$2`, [tenantId, inst.id]);
            await q(client, `UPDATE form_instances SET status='archived', archived_at=COALESCE(archived_at, now()), version=version+1 WHERE tenant_id=$1 AND id=$2`, [tenantId, inst.id]);
            await appendEvent(client, tenantId, { instanceId: inst.id, eventType: "retention.anonymized", data: { policy: pol.key } });
          } else if (strategy === "hard_delete") {
            // Event op de DEFINITIE (de instance verdwijnt met CASCADE).
            const d = (await q(client, `SELECT definition_id FROM form_instances WHERE tenant_id=$1 AND id=$2`, [tenantId, inst.id])).rows[0];
            await q(client, `DELETE FROM form_instances WHERE tenant_id=$1 AND id=$2`, [tenantId, inst.id]);
            await appendEvent(client, tenantId, { definitionId: d ? d.definition_id : null, eventType: "retention.purged", data: { policy: pol.key, instanceId: inst.id, legalBasis: pol.legal_basis } });
          }
          outcome.push({ policy: pol.key, instance: inst.id, strategy, applied: true });
        }
      }
      return { policies: policies.length, actions: outcome };
    });
  }

  // ── h26 · assignment-triggers: domeinevent → automatische form-instance ─────
  // Idempotent per (event, definitie): her-bezorging maakt nooit een tweede
  // instance. Ongepubliceerde definities worden overgeslagen (gerapporteerd).
  async function processDomainEvent(tenantId, event) {
    const triggersMod = require("../../platform/forms-triggers");
    const defs = await withTenant(pool, tenantId, async client =>
      (await q(client, `SELECT * FROM form_definitions
                        WHERE tenant_id=$1 AND attributes ? 'triggers'
                          AND status IN ('system_required','enabled','conditional','scheduled')`, [tenantId])).rows);
    const created = [], skipped = [];
    for (const def of defs) {
      for (const trig of triggersMod.matchTriggers(def, event)) {
        const payload = triggersMod.instancePayloadFor(def, trig, event);
        const dup = await withTenant(pool, tenantId, async client =>
          (await q(client, `SELECT id FROM form_instances WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantId, payload.idempotency_key])).rows[0]);
        if (dup) { skipped.push({ definition: def.key, reason: "duplicate", instance: dup.id }); continue; }
        try {
          const inst = await createInstance(tenantId, payload, event.actor || "automation");
          created.push({ definition: def.key, instance: inst.id, assignedTo: payload.assigned_to });
        } catch (e) {
          // FORM_NOT_PUBLISHED e.d.: trigger mag een event nooit laten falen.
          skipped.push({ definition: def.key, reason: e.code || e.message });
        }
      }
    }
    return { event: event.eventType, created, skipped };
  }

  return {
    createDefinition, getDefinition, listDefinitions, setDefinitionStatus,
    setDraftStructure, publishVersion, createNewVersion,
    createInstance, getInstance, saveDraft, submitInstance, transition, actOnApproval, listEvents,
    createAssignment, listAssignments, revokeAssignment, resolveActivation, resolveExternalToken, captureSignature,
    seedStandardForms, applyDictionaryStructure, reportOnDefinition, applyRetention, processDomainEvent,
  };
}

module.exports = { makePgFormsRepository };
