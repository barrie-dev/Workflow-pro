"use strict";

// ── Forms-cutover (CTO2-08) ──────────────────────────────────────────────────
// De strangler-eindstap: de legacy work-os formulieren (collecties formTemplates
// + formInstances in de JSON-store) migreren naar de canonieke pg-engine, met
// een reconciliatie die de cutover POORTWACHTERT. FORMS_SOURCE=pg mag pas AAN
// nadat reconciliatie groen is (elke legacy-rij heeft een canonieke tegenhanger).
//
//   inventoryLegacyForms  → wat staat er nog in de legacy engine?
//   migrateLegacyForms    → idempotente migratie (op external_reference)
//   reconcileForms        → brondekking; ready=true pas als alles gemigreerd is
//
// De productie-flip zelf (FORMS_SOURCE=pg + write-freeze) blijft een bewuste
// operationele beslissing · deze tooling levert het bewijs dat het veilig kan.

// Legacy → canoniek: vraagtype → engine-veldtype; templatestatus → definitie-
// status; invulstatus → canonieke 13-staten-lifecycle.
const FIELD_TYPE = { number: "number", date: "date" }; // rest → text
const DEF_STATUS = { published: "enabled", draft: "available", archived: "archived" };
const INSTANCE_STATUS = { draft: "draft", filled: "draft", submitted: "submitted", locked: "completed" };

function fieldTypeFor(q) { return FIELD_TYPE[q && q.type] || "text"; }

/** Bouw de canonieke draft-structuur uit een legacy template. */
function structureFromTemplate(tpl) {
  const sections = [];
  const seen = new Set();
  const fields = [];
  for (const s of tpl.sections || []) {
    const sKey = String(s.id || "main");
    if (!seen.has(sKey)) { seen.add(sKey); sections.push({ key: sKey, title: { nl: s.title || sKey } }); }
    for (const qn of s.questions || []) {
      fields.push({
        field_key: String(qn.id),
        section_key: sKey,
        label: { nl: qn.label || qn.id },
        field_type: fieldTypeFor(qn),
        required: qn.required === true ? "required" : "optional",
        // Legacy 'signature'/'photo' zijn bewijsvelden · classificatie internal.
        data_classification: "internal",
      });
    }
  }
  return { sections, fields };
}

/** Tel legacy templates/instances per status (bron-inventaris). */
function inventoryLegacyForms(store, tenantId) {
  const templates = (store.list("formTemplates", tenantId) || []);
  const instances = (store.list("formInstances", tenantId) || []);
  const by = (rows, statuses) => {
    const out = {}; for (const s of statuses) out[s] = 0;
    for (const r of rows) out[r.status] = (out[r.status] || 0) + 1;
    return out;
  };
  return {
    tenantId,
    templates: { total: templates.length, byStatus: by(templates, ["draft", "published", "archived"]) },
    instances: { total: instances.length, byStatus: by(instances, ["draft", "filled", "submitted", "locked"]) },
  };
}

/**
 * Migreer de legacy forms van één tenant naar de canonieke engine · IDEMPOTENT:
 * een template/instance waarvan de legacy-id al als external_reference bestaat
 * wordt overgeslagen. Templates worden definitie + gepubliceerde versie; instances
 * worden canonieke instances met hun (faithful) antwoorden en gemapte status.
 */
async function migrateLegacyForms({ store, repo, tenantId, actor = "cutover" }) {
  const templates = store.list("formTemplates", tenantId) || [];
  const instances = store.list("formInstances", tenantId) || [];
  const refs = await repo.externalRefs(tenantId);

  const defByLegacyId = new Map(refs.definitions); // legacyTemplateId → canonicalDefId
  const defResult = { created: 0, skipped: 0 };
  for (const tpl of templates) {
    if (defByLegacyId.has(tpl.id)) { defResult.skipped++; continue; }
    const def = await repo.createDefinition(tenantId, {
      key: `LEGACY-${tpl.key || tpl.id}`.slice(0, 60),
      name: tpl.name || tpl.key || "Legacy formulier",
      form_type: "evidence",
      status: DEF_STATUS[tpl.status] || "available",
      external_reference: tpl.id,
      source: "migration",
      attributes: { legacy: true, legacyKey: tpl.key, legacyStatus: tpl.status, appliesTo: tpl.appliesTo || [] },
    }, actor);
    await repo.setDraftStructure(tenantId, def.id, structureFromTemplate(tpl), actor);
    // Ook draft/archived templates publiceren we (versie 1) zodat instances
    // kunnen aanhaken; de canonieke status blijft de gemapte activatiestatus.
    await repo.publishVersion(tenantId, def.id, actor);
    defByLegacyId.set(tpl.id, def.id);
    defResult.created++;
  }

  const instRefs = new Set(refs.instances.keys());
  const instResult = { created: 0, skipped: 0, unmappedTemplate: 0, unmappedFields: 0 };
  for (const fi of instances) {
    if (instRefs.has(fi.id)) { instResult.skipped++; continue; }
    const defId = defByLegacyId.get(fi.templateId);
    if (!defId) { instResult.unmappedTemplate++; continue; } // template ontbreekt · overslaan, gerapporteerd
    const r = await repo.importLegacyInstance(tenantId, {
      definitionId: defId,
      externalReference: fi.id,
      subjectType: fi.context && fi.context.entityType || null,
      subjectId: fi.context && fi.context.entityId || null,
      answers: fi.answers || {},
      status: INSTANCE_STATUS[fi.status] || "draft",
      createdBy: fi.createdBy || null,
      submittedAt: fi.submittedAt || null,
    }, actor);
    if (r.unmapped && r.unmapped.length) instResult.unmappedFields += r.unmapped.length;
    instResult.created++;
  }
  return { tenantId, definitions: defResult, instances: instResult };
}

/**
 * Reconcilieer legacy vs canoniek. ready=true betekent: ELKE legacy template en
 * instance heeft een canonieke tegenhanger (op external_reference). Zolang dat
 * niet zo is, is FORMS_SOURCE=pg onveilig (bewijs voor de cutover-gate).
 */
async function reconcileForms({ store, repo, tenantId }) {
  const inv = inventoryLegacyForms(store, tenantId);
  const refs = await repo.externalRefs(tenantId);
  const templateIds = (store.list("formTemplates", tenantId) || []).map(t => t.id);
  const instanceIds = (store.list("formInstances", tenantId) || []).map(i => i.id);
  const missingDefs = templateIds.filter(idv => !refs.definitions.has(idv));
  const missingInsts = instanceIds.filter(idv => !refs.instances.has(idv));
  const ready = missingDefs.length === 0 && missingInsts.length === 0;
  return {
    tenantId, ready,
    templates: { legacy: inv.templates.total, migrated: refs.definitions.size, missing: missingDefs },
    instances: { legacy: inv.instances.total, migrated: refs.instances.size, missing: missingInsts },
  };
}

module.exports = {
  inventoryLegacyForms, structureFromTemplate, migrateLegacyForms, reconcileForms,
  FIELD_TYPE, DEF_STATUS, INSTANCE_STATUS,
};
