"use strict";
// FORM-05 · pg-integratie: migratie 009 (retention_policies-register + universele
// metadata-kolommen op de formuliertabellen) + RLS-isolatie. Slaat over zonder
// DATABASE_URL.
const { test } = require("node:test");
const assert = require("node:assert");

const LIVE = process.env.DATABASE_URL || "";
if (!LIVE || !/^postgres/.test(LIVE)) {
  test("pg-metadata: DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  const { Pool } = require("pg");
  const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
  const { withTenant } = require("../src/infrastructure/postgres/pg-customer-repository");

  const ssl = /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: LIVE, ssl });
  const T = "t_meta_a", T2 = "t_meta_b";

  test("setup", async () => {
    await runMigrations(pool);
    for (const t of [T, T2]) await pool.query("INSERT INTO tenants (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [t, "Meta " + t]);
    await pool.query("DELETE FROM retention_policies WHERE tenant_id = ANY($1)", [[T, T2]]);
  });

  test("universele metadata-kolommen bestaan op de formuliertabellen (h5)", async () => {
    const cols = async (table) => (await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name=$1", [table]
    )).rows.map(r => r.column_name);
    const def = await cols("form_definitions");
    for (const c of ["source", "external_reference", "tags", "notes_internal", "data_classification", "retention_policy_id"]) {
      assert.ok(def.includes(c), `form_definitions.${c} ontbreekt`);
    }
    const inst = await cols("form_instances");
    for (const c of ["data_classification", "external_reference", "retention_policy_id", "tags", "notes_internal", "source"]) {
      assert.ok(inst.includes(c), `form_instances.${c} ontbreekt`);
    }
  });

  test("retention_policies · CHECK-constraints + tenant-uniekheid van de sleutel", async () => {
    await withTenant(pool, T, async (c) => {
      await c.query(
        `INSERT INTO retention_policies (id, tenant_id, key, name, retention_days, keep_minimum, purge_strategy, legal_basis)
         VALUES ($1,$2,'gdpr-personal','GDPR persoonsgegevens',365,1,'anonymize','GDPR art. 5')`,
        ["rp_1", T]
      );
    });
    // Ongeldige purge-strategie wordt door de CHECK geweigerd.
    await assert.rejects(() => withTenant(pool, T, (c) => c.query(
      `INSERT INTO retention_policies (id, tenant_id, key, name, purge_strategy) VALUES ('rp_bad',$1,'x','X','zap')`, [T]
    )), /purge_strategy|check/i);
    // Dubbele sleutel binnen de tenant → UNIQUE-schending.
    await assert.rejects(() => withTenant(pool, T, (c) => c.query(
      `INSERT INTO retention_policies (id, tenant_id, key, name) VALUES ('rp_2',$1,'gdpr-personal','dup')`, [T]
    )), /unique|duplicate/i);
  });

  test("RLS · isolatiepolicy is gedefinieerd + FORCE (defense-in-depth voor prod)", async () => {
    // De lokale dev-rol is superuser en omzeilt RLS; de app filtert bovendien
    // expliciet op tenant_id. We bewijzen daarom dat de policy correct GEWIRED is
    // (in productie draait de app als niet-superuser en handhaaft PostgreSQL ze).
    const pol = await pool.query(
      "SELECT policyname, qual FROM pg_policies WHERE tablename='retention_policies' AND policyname='retention_policies_isolation'"
    );
    assert.equal(pol.rows.length, 1, "isolatiepolicy bestaat");
    assert.match(pol.rows[0].qual, /app\.tenant_id/, "policy scoopt op app.tenant_id");
    const rel = await pool.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='retention_policies'");
    assert.equal(rel.rows[0].relrowsecurity, true);
    assert.equal(rel.rows[0].relforcerowsecurity, true, "FORCE zodat ook de owner de policy volgt");
  });

  test("tenant-scoping · dezelfde sleutel mag per tenant, data blijft gescheiden", async () => {
    // Dezelfde sleutel in tenant B mag (uniekheid is per tenant).
    await withTenant(pool, T2, (c) => c.query(
      `INSERT INTO retention_policies (id, tenant_id, key, name) VALUES ('rp_b1',$1,'gdpr-personal','B beleid')`, [T2]
    ));
    // De app-scope (expliciete tenant_id-filter, zoals de repo) scheidt de data.
    const a = await pool.query("SELECT id FROM retention_policies WHERE tenant_id=$1", [T]);
    const b = await pool.query("SELECT id FROM retention_policies WHERE tenant_id=$1", [T2]);
    assert.deepEqual(a.rows.map(r => r.id).sort(), ["rp_1"]);
    assert.deepEqual(b.rows.map(r => r.id).sort(), ["rp_b1"]);

    await pool.query("DELETE FROM retention_policies WHERE tenant_id = ANY($1)", [[T, T2]]);
    await pool.end();
  });
}
