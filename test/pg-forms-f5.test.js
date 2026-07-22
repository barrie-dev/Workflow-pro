"use strict";
// F5 mobiel-beleid + h26 reminders/escalatie + contact-domeinhandler.
// Pure validatie draait altijd; pg-delen slaan over zonder DATABASE_URL.
const { test } = require("node:test");
const assert = require("node:assert");
const E = require("../src/platform/forms-engine");

test("puur · bijlagebeleid: allowlist, maat geklemd op platformmax, GPS-plicht", () => {
  const okFoto = E.validateAttachment({}, { mime_type: "image/jpeg", size_bytes: 1024 });
  assert.equal(okFoto.ok, true);
  const exe = E.validateAttachment({}, { mime_type: "application/x-msdownload", size_bytes: 10 });
  assert.equal(exe.ok, false, "onveilig type geweigerd");
  // Tenant vraagt 100 MB → geklemd op de platformmax van 25 MB.
  const groot = E.validateAttachment({ max_mb: 100 }, { mime_type: "image/png", size_bytes: 30 * 1024 * 1024 });
  assert.equal(groot.ok, false);
  assert.match(groot.errors.size_bytes, /25 MB/);
  // GPS verplicht → zonder (of met onzin) geweigerd, met geldige coördinaten ok.
  const zonder = E.validateAttachment({ gps_required: true }, { mime_type: "image/jpeg", size_bytes: 10 });
  assert.equal(zonder.ok, false);
  const fout = E.validateAttachment({ gps_required: true }, { mime_type: "image/jpeg", size_bytes: 10, gps: { lat: 999, lng: 4.4 } });
  assert.equal(fout.ok, false, "lat buiten bereik");
  const met = E.validateAttachment({ gps_required: true }, { mime_type: "image/jpeg", size_bytes: 10, gps: { lat: 50.85, lng: 4.35 } });
  assert.equal(met.ok, true);
});

test("puur · reminderbeleid geklemd binnen platformlimieten [1u, 720u]", () => {
  const p = E.clampReminderPolicy({ remind_after_hours: 0.2, escalate_after_hours: 9999, escalate_to: "dir@x" });
  assert.equal(p.remindAfterHours, 1, "onder minimum → 1u");
  assert.equal(p.escalateAfterHours, 720, "boven maximum → 720u");
  assert.equal(p.escalateTo, "dir@x");
  assert.equal(E.clampReminderPolicy({}).remindAfterHours, null, "geen instelling = geen reminder");
});

const LIVE = process.env.DATABASE_URL || "";
if (!LIVE || !/^postgres/.test(LIVE)) {
  test("pg-forms-f5: DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  const { Pool } = require("pg");
  const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
  const { makePgFormsRepository } = require("../src/infrastructure/postgres/pg-forms-repository");
  const { makeDomainCommandRouter } = require("../src/platform/forms-domain-commands");

  const ssl = /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: LIVE, ssl });
  const T = "t_formsf5";

  // Zelfde contact-handler als server.js (pg-canoniek op customer_contacts).
  const router = makeDomainCommandRouter();
  router.register("contact", async ({ client, tenantId, instance, payload, actor }) => {
    const customerId = payload.customer_id || (instance.subject_type === "customer" ? instance.subject_id : null);
    if (!customerId) { const e = new Error("customer_id verplicht"); e.status = 422; throw e; }
    const cid = "ctc_test_" + Math.random().toString(16).slice(2, 10);
    await client.query(
      `INSERT INTO customer_contacts (id, tenant_id, customer_id, first_name, last_name, email, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
      [cid, tenantId, customerId, payload.first_name || null, payload.last_name || null, payload.email || null, actor || null]);
    return { domainObject: "contact", domainId: cid };
  });
  const repo = makePgFormsRepository(pool, { domainCommands: router });

  const STRUCT = (extra = []) => ({
    sections: [{ key: "main", title: { nl: "Hoofd" } }],
    fields: [{ field_key: "first_name", section_key: "main", field_type: "text", required: "required" }, ...extra],
  });

  test("setup", async () => {
    await runMigrations(pool);
    await pool.query("INSERT INTO tenants (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [T, "Forms F5"]);
    await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [T]);
    await pool.query("DELETE FROM customers WHERE tenant_id=$1", [T]);
  });

  test("contact-handler · CRM-003-submit maakt een contact aan zijn klant (tenant-veilig)", async () => {
    await pool.query(`INSERT INTO customers (id, tenant_id, name) VALUES ('cus_f5', $1, 'Klant F5')`, [T]);
    const def = await repo.createDefinition(T, { key: "CRM-003T", name: "Contact", form_type: "domain", domain_object: "contact" }, "admin@f");
    await repo.setDraftStructure(T, def.id, STRUCT([{ field_key: "email", section_key: "main", field_type: "text", required: "optional" }]), "admin@f");
    await repo.publishVersion(T, def.id, "admin@f");
    const inst = await repo.createInstance(T, { definition_id: def.id, subject_type: "customer", subject_id: "cus_f5" }, "emp@f");
    const r = await repo.submitInstance(T, inst.id, { answers: { first_name: "Anna", email: "anna@x.be" } }, "emp@f");
    assert.ok(r.domain && r.domain.domainId, "contact aangemaakt");
    const c = await pool.query(`SELECT customer_id, first_name, email FROM customer_contacts WHERE tenant_id=$1 AND id=$2`, [T, r.domain.domainId]);
    assert.equal(c.rows[0].customer_id, "cus_f5");
    assert.equal(c.rows[0].first_name, "Anna");
  });

  test("F5 · bijlage met GPS-plicht: zonder GPS 422, met GPS opgeslagen (malware pending)", async () => {
    const def = await repo.createDefinition(T, {
      key: "OPS-F5", name: "Werffoto", form_type: "evidence",
      attributes: { mobile_policy: { gps_required: true, max_mb: 5 } },
    }, "admin@f");
    await repo.setDraftStructure(T, def.id, STRUCT(), "admin@f");
    await repo.publishVersion(T, def.id, "admin@f");
    const inst = await repo.createInstance(T, { definition_id: def.id }, "emp@f");

    await assert.rejects(() => repo.addAttachment(T, inst.id, { object_key: "t/x.jpg", mime_type: "image/jpeg", size_bytes: 100 }, "emp@f"),
      e => e.code === "ATTACHMENT_INVALID" && !!e.fieldErrors.gps);
    const att = await repo.addAttachment(T, inst.id, { object_key: "t/x.jpg", file_name: "werf.jpg", mime_type: "image/jpeg", size_bytes: 100, gps: { lat: 51.05, lng: 3.72 } }, "emp@f");
    assert.equal(att.malware_status, "pending");
    const list = await repo.listAttachments(T, inst.id);
    assert.equal(list.length, 1);
    // Na submit is de instance niet meer bewerkbaar → bijlage geweigerd.
    await repo.submitInstance(T, inst.id, { answers: { first_name: "x" } }, "emp@f");
    await assert.rejects(() => repo.addAttachment(T, inst.id, { object_key: "t/y.jpg", mime_type: "image/jpeg", size_bytes: 10, gps: { lat: 51, lng: 3.7 } }, "emp@f"),
      e => e.code === "INSTANCE_NOT_EDITABLE");
    // GPS-stempel zit in het lifecycle-event (audit).
    const events = await repo.listEvents(T, inst.id);
    const ev = events.find(e => e.event_type === "attachment.added");
    assert.ok(ev && ev.data.gps && Number(ev.data.gps.lat) === 51.05);
  });

  test("h26 · reminder + escalatie exact één keer; run is idempotent", async () => {
    const def = await repo.createDefinition(T, {
      key: "REM-F5", name: "Trage goedkeuring", form_type: "workflow",
      attributes: { reminders: { remind_after_hours: 24, escalate_after_hours: 72, escalate_to: "dir@f" } },
    }, "admin@f");
    await repo.setDraftStructure(T, def.id, STRUCT(), "admin@f");
    await repo.publishVersion(T, def.id, "admin@f");
    const inst = await repo.createInstance(T, { definition_id: def.id }, "emp@f");
    await repo.submitInstance(T, inst.id, { answers: { first_name: "x" } }, "emp@f");
    // 4 dagen oud maken → reminder én escalatie verschuldigd.
    await pool.query(`UPDATE form_instances SET submitted_at = now() - interval '4 days' WHERE tenant_id=$1 AND id=$2`, [T, inst.id]);
    const run1 = await repo.processReminders(T);
    assert.equal(run1.reminders.length, 1);
    assert.equal(run1.escalations.length, 1);
    assert.equal(run1.escalations[0].notify, "dir@f");
    // Tweede run: niets nieuws (dedup op events).
    const run2 = await repo.processReminders(T);
    assert.equal(run2.reminders.length + run2.escalations.length, 0, "idempotent");

    await pool.query("DELETE FROM form_definitions WHERE tenant_id=$1", [T]);
    await pool.query("DELETE FROM customers WHERE tenant_id=$1", [T]);
    await pool.end();
  });
}
