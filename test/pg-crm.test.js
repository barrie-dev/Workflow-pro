"use strict";
// CRM op genormaliseerde tabellen (handover 4.1 + 5.4): tenantisolatie in twee
// lagen, optimistic locking, idempotente backfill en reconciliatie.
//
// De pool is injecteerbaar zodat het contract zonder database getest wordt. De
// integratietests onderaan draaien met een echte DATABASE_URL.
const { test } = require("node:test");
const assert = require("node:assert");

const { makePgCustomerRepository, withTenant, rowToCustomer } = require("../src/infrastructure/postgres/pg-customer-repository");
const { backfillCustomers, reconcileCustomers, customerFingerprint, toRow, validateLegacy } = require("../src/infrastructure/postgres/crm-backfill");

/** pg-pool-dubbel dat alle queries registreert. */
function fakePool(handler = () => ({ rows: [] })) {
  const queries = [];
  const client = {
    released: false,
    async query(sql, params) {
      const flat = String(sql).replace(/\s+/g, " ").trim();
      queries.push({ sql: flat, params });
      if (/^BEGIN|^COMMIT|^ROLLBACK|set_config/i.test(flat)) return { rows: [] };
      return handler(flat, params) || { rows: [] };
    },
    release() { this.released = true; },
  };
  return { queries, client, async connect() { return client; } };
}

const KLANT_ROW = {
  id: "cust_1", tenant_id: "t1", company_id: null, customer_number: "K-001", name: "Alfa Bouw",
  email: "a@x.be", phone: null, vat_number: "BE0123", language: "nl", status: "active",
  credit_limit: "5000.00", payment_terms_days: 30, price_group: null, notes: null, custom_fields: {},
  created_at: "2026-01-01", updated_at: "2026-01-02", created_by: "admin", updated_by: "admin",
  version: 3, archived_at: null, archived_by: null,
};

// ── Tenantisolatie in twee lagen (5.3) ──────────────────────────────────────
test("crm-repo: elke transactie zet de RLS-tenantcontext én filtert op tenant_id", async () => {
  const pool = fakePool(sql => (/FROM customers WHERE/.test(sql) ? { rows: [KLANT_ROW] } : { rows: [] }));
  const repo = makePgCustomerRepository(pool);
  await repo.findById("t1", "cust_1");

  // Laag 2: RLS-context binnen de transactie.
  const ctx = pool.queries.find(q => /set_config/.test(q.sql));
  assert.ok(ctx, "app.tenant_id wordt gezet");
  assert.deepEqual(ctx.params, ["t1"]);
  assert.ok(pool.queries[0].sql === "BEGIN", "context zit binnen een transactie, lekt niet naar de pool");
  assert.ok(pool.queries.some(q => q.sql === "COMMIT"));
  // Laag 1: tenant_id in het predicate van élke query.
  const dataQueries = pool.queries.filter(q => /FROM customers|FROM customer_/.test(q.sql));
  assert.ok(dataQueries.length >= 3);
  for (const q of dataQueries) assert.match(q.sql, /tenant_id = \$1/, `query mist het tenantpredicate: ${q.sql}`);
  assert.equal(pool.client.released, true);
});

test("crm-repo: zonder tenantId gebeurt er niets", async () => {
  const pool = fakePool();
  const repo = makePgCustomerRepository(pool);
  await assert.rejects(() => repo.findById("", "cust_1"), e => e.code === "TENANT_REQUIRED");
  assert.equal(pool.queries.length, 0, "er vertrekt geen enkele query");
});

test("crm-repo: een fout rolt terug en geeft de connectie terug", async () => {
  const pool = fakePool(sql => { if (/FROM customers WHERE/.test(sql)) throw new Error("kapot"); return { rows: [] }; });
  await assert.rejects(() => makePgCustomerRepository(pool).findById("t1", "x"), /kapot/);
  assert.ok(pool.queries.some(q => q.sql === "ROLLBACK"));
  assert.equal(pool.client.released, true, "connectie ook bij een fout vrijgegeven");
});

test("crm-repo: rij wordt naar de canonieke klantvorm gemapt", () => {
  const c = rowToCustomer(KLANT_ROW,
    [{ id: "ct1", first_name: "Jan", last_name: "Peeters", is_primary: true }],
    [{ id: "ad1", type: "invoice", city: "Gent", country: "BE", is_primary: true }]);
  assert.equal(c.name, "Alfa Bouw");
  assert.equal(c.creditLimit, 5000, "numeric komt als getal terug, niet als string");
  assert.equal(c.version, 3);
  assert.equal(c.contacts[0].firstName, "Jan");
  assert.equal(c.addresses[0].city, "Gent");
  assert.equal(rowToCustomer(null), null);
});

// ── Optimistic locking (4.1) ────────────────────────────────────────────────
test("crm-repo: update gebruikt optimistic locking en onderscheidt 404 van conflict", async () => {
  // UPDATE raakt niets; de klant bestaat wél → versieconflict.
  const conflictPool = fakePool(sql => {
    if (/^UPDATE customers/.test(sql)) return { rows: [] };
    if (/SELECT version FROM customers/.test(sql)) return { rows: [{ version: 7 }] };
    return { rows: [] };
  });
  await assert.rejects(
    () => makePgCustomerRepository(conflictPool).update("t1", "cust_1", { name: "X" }, "admin", 3),
    e => e.code === "VERSION_CONFLICT" && e.status === 409 && e.currentVersion === 7);
  const upd = conflictPool.queries.find(q => /^UPDATE customers/.test(q.sql));
  assert.match(upd.sql, /version = version \+ 1/, "versie wordt opgehoogd");
  assert.match(upd.sql, /AND version = \$\d+/, "verwachte versie in het predicate");

  // UPDATE raakt niets en de klant bestaat niet → 404.
  const missingPool = fakePool(() => ({ rows: [] }));
  await assert.rejects(
    () => makePgCustomerRepository(missingPool).update("t1", "weg", { name: "X" }, "admin", 1),
    e => e.status === 404);
});

test("crm-repo: zonder expectedVersion geen versiepredicate, wel ophoging", async () => {
  const pool = fakePool(sql => (/^UPDATE customers/.test(sql) ? { rows: [KLANT_ROW] } : { rows: [] }));
  await makePgCustomerRepository(pool).update("t1", "cust_1", { name: "Alfa" }, "admin");
  const upd = pool.queries.find(q => /^UPDATE customers/.test(q.sql));
  assert.ok(!/AND version = \$/.test(upd.sql));
  assert.match(upd.sql, /version = version \+ 1/);
});

test("crm-repo: contacten blijven staan als de patch ze niet meestuurt", async () => {
  const pool = fakePool(sql => (/^UPDATE customers/.test(sql) ? { rows: [KLANT_ROW] } : { rows: [] }));
  await makePgCustomerRepository(pool).update("t1", "cust_1", { name: "Alfa" }, "admin");
  assert.ok(!pool.queries.some(q => /DELETE FROM customer_contacts/.test(q.sql)), "geen stille verwijdering");

  const pool2 = fakePool(sql => (/^UPDATE customers/.test(sql) ? { rows: [KLANT_ROW] } : { rows: [] }));
  await makePgCustomerRepository(pool2).update("t1", "cust_1", { name: "Alfa", contacts: [{ firstName: "Jan" }] }, "admin");
  assert.ok(pool2.queries.some(q => /DELETE FROM customer_contacts/.test(q.sql)), "expliciet meegestuurd → vervangen");
  assert.ok(pool2.queries.some(q => /INSERT INTO customer_contacts/.test(q.sql)));
});

test("crm-repo: zoeken pagineert op cursor en vraagt één rij extra", async () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ ...KLANT_ROW, id: `cust_${i}` }));
  const pool = fakePool(sql => (/FROM customers WHERE/.test(sql) ? { rows } : { rows: [] }));
  const res = await makePgCustomerRepository(pool).search("t1", { limit: 5, query: "alfa", status: "active" });
  assert.equal(res.rows.length, 5, "de extra rij is enkel om te weten of er meer is");
  assert.equal(res.nextCursor, "cust_4");
  const q = pool.queries.find(x => /FROM customers WHERE/.test(x.sql));
  assert.match(q.sql, /archived_at IS NULL/, "gearchiveerd standaard verborgen");
  assert.match(q.sql, /lower\(name\) LIKE/, "hoofdletterongevoelig zoeken");
  assert.match(q.sql, /ORDER BY id ASC LIMIT/);
});

test("crm-repo: archiveren in plaats van verwijderen", async () => {
  const pool = fakePool(sql => (/^UPDATE customers SET archived_at/.test(sql) ? { rows: [{ ...KLANT_ROW, archived_at: "2026-07-18" }] } : { rows: [] }));
  const c = await makePgCustomerRepository(pool).archive("t1", "cust_1", "admin");
  assert.ok(c.archivedAt);
  assert.ok(!pool.queries.some(q => /DELETE FROM customers/.test(q.sql)), "nooit een harde delete");
});

// ── Backfill (5.4 stap 3) ───────────────────────────────────────────────────
test("backfill: vertaalt legacy naar kolommen met veilige defaults", () => {
  const r = toRow({ id: "cust_1", name: "Alfa", vat: "BE0123", status: "onbekend", language: "de" }, "t1");
  assert.equal(r.vatNumber, "BE0123", "legacy-veldnaam 'vat' wordt herkend");
  assert.equal(r.status, "active", "onbekende status valt terug op een toegestane waarde");
  assert.equal(r.language, "nl", "onbekende taal valt terug");
  assert.equal(r.paymentTermsDays, 30);
  assert.deepEqual(r.customFields, {});
});

test("backfill: onmigreerbare rijen worden overgeslagen en gerapporteerd", async () => {
  assert.deepEqual(validateLegacy({ id: "x", name: "Alfa" }), []);
  assert.equal(validateLegacy({ id: "", name: "" }).length, 2);
  const pool = fakePool();
  const res = await backfillCustomers(pool, "t1", [
    { id: "cust_1", name: "Alfa" },
    { id: "cust_2", name: "" },       // naam is NOT NULL in het schema
    { name: "Geen id" },
  ], { dryRun: true });
  assert.equal(res.wouldMigrate, 1);
  assert.equal(res.skipped.length, 2);
  assert.match(res.skipped[0].reasons[0], /naam ontbreekt/);
  assert.equal(pool.queries.length, 0, "dry-run wijzigt niets");
});

test("backfill: is idempotent via UPSERT op de bestaande id", async () => {
  const pool = fakePool();
  await backfillCustomers(pool, "t1", [{ id: "cust_1", name: "Alfa" }, { id: "cust_2", name: "Beta" }]);
  const inserts = pool.queries.filter(q => /INSERT INTO customers/.test(q.sql));
  assert.equal(inserts.length, 2);
  assert.match(inserts[0].sql, /ON CONFLICT \(id\) DO UPDATE SET/, "meermaals draaien geeft hetzelfde resultaat");
  assert.match(inserts[0].sql, /WHERE customers\.tenant_id = EXCLUDED\.tenant_id/, "een id van een andere tenant wordt nooit overschreven");
  // De id uit legacy blijft behouden · anders is reconciliatie onmogelijk.
  assert.equal(inserts[0].params[0], "cust_1");
  // version wordt niet opgehoogd door een backfill.
  assert.ok(!/version = version \+ 1/.test(inserts[0].sql));
});

// ── Reconciliatie (5.4 stap 4) ──────────────────────────────────────────────
test("reconciliatie: vingerafdruk vindt inhoudelijke afwijkingen", () => {
  const basis = { name: "Alfa", email: "a@x.be", vatNumber: "BE1", status: "active", language: "nl", creditLimit: 100, contacts: [1], addresses: [1] };
  assert.equal(customerFingerprint(basis), customerFingerprint({ ...basis }), "zelfde inhoud → zelfde hash");
  assert.notEqual(customerFingerprint(basis), customerFingerprint({ ...basis, email: "b@x.be" }));
  assert.notEqual(customerFingerprint(basis), customerFingerprint({ ...basis, contacts: [] }), "ontbrekend contact valt op");
  // Hoofdletters en spaties mogen geen valse afwijking geven.
  assert.equal(customerFingerprint(basis), customerFingerprint({ ...basis, name: " ALFA ", email: "A@X.BE" }));
});

test("reconciliatie: meldt ontbrekend, extra en afwijkend, en poortwachtert de cutover", async () => {
  const legacy = [
    { id: "cust_1", name: "Alfa", email: "a@x.be" },
    { id: "cust_2", name: "Beta" },
    { id: "cust_3", name: "Gamma" },
  ];
  const pool = fakePool(sql => {
    if (/FROM customers c WHERE/.test(sql)) {
      return { rows: [
        { id: "cust_1", name: "Alfa", email: "a@x.be", vat_number: null, status: "active", language: "nl", credit_limit: null, contact_count: 0, address_count: 0 },
        { id: "cust_2", name: "Beta ANDERS", email: null, vat_number: null, status: "active", language: "nl", credit_limit: null, contact_count: 0, address_count: 0 },
        { id: "cust_9", name: "Alleen in pg", email: null, vat_number: null, status: "active", language: "nl", credit_limit: null, contact_count: 0, address_count: 0 },
      ] };
    }
    return { rows: [] };
  });
  const rec = await reconcileCustomers(pool, "t1", legacy);
  assert.equal(rec.legacyCount, 3);
  assert.equal(rec.targetCount, 3);
  assert.equal(rec.countsMatch, true, "aantallen kunnen kloppen terwijl de inhoud dat niet doet");
  assert.deepEqual(rec.missing, ["cust_3"], "in legacy, niet gemigreerd");
  assert.deepEqual(rec.extra, ["cust_9"], "alleen in pg · wordt gemeld, niet opgeruimd");
  assert.equal(rec.differences.length, 1);
  assert.equal(rec.differences[0].id, "cust_2");
  assert.equal(rec.readyForCutover, false, "cutover geblokkeerd tot alles klopt");
});

test("reconciliatie: schone migratie geeft groen licht voor cutover", async () => {
  const legacy = [{ id: "cust_1", name: "Alfa", email: "a@x.be" }];
  const pool = fakePool(sql => (/FROM customers c WHERE/.test(sql)
    ? { rows: [{ id: "cust_1", name: "Alfa", email: "a@x.be", vat_number: null, status: "active", language: "nl", credit_limit: null, contact_count: 0, address_count: 0 }] }
    : { rows: [] }));
  const rec = await reconcileCustomers(pool, "t1", legacy);
  assert.equal(rec.readyForCutover, true);
  assert.deepEqual([rec.missing, rec.extra, rec.differences], [[], [], []]);
});

// ── Integratie · alleen met een echte database ──────────────────────────────
const LIVE_URL = process.env.DATABASE_URL || "";
test("crm: integratie tegen echte PostgreSQL (schema, RLS, locking, backfill)",
  { skip: !LIVE_URL && "DATABASE_URL niet gezet" }, async () => {
    const { Pool } = require("pg");
    const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
    const pool = new Pool({ connectionString: LIVE_URL, max: 4 });
    const tenantA = `t_test_a_${Date.now()}`;
    const tenantB = `t_test_b_${Date.now()}`;
    try {
      await runMigrations(pool);
      for (const t of [tenantA, tenantB]) {
        await pool.query("INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [t, `Test ${t}`]);
      }
      const repo = makePgCustomerRepository(pool);

      // Aanmaken met contacten en adressen.
      const gemaakt = await repo.insert(tenantA, {
        name: "Integratie Klant", email: "i@x.be", vatNumber: "BE0999", customerNumber: "K-001",
        contacts: [{ firstName: "Jan", lastName: "Peeters", isPrimary: true }],
        addresses: [{ type: "invoice", city: "Gent", isPrimary: true }],
      }, "test");
      assert.equal(gemaakt.name, "Integratie Klant");
      assert.equal(gemaakt.contacts.length, 1);
      assert.equal(gemaakt.addresses[0].city, "Gent");
      assert.equal(gemaakt.version, 1);

      // Optimistic locking: tweede update met de oude versie faalt.
      const bijgewerkt = await repo.update(tenantA, gemaakt.id, { ...gemaakt, name: "Gewijzigd" }, "test", 1);
      assert.equal(bijgewerkt.version, 2);
      await assert.rejects(() => repo.update(tenantA, gemaakt.id, { ...gemaakt, name: "Nogmaals" }, "test", 1),
        e => e.code === "VERSION_CONFLICT");

      // Tenantisolatie: tenant B ziet de klant van A niet.
      assert.equal(await repo.findById(tenantB, gemaakt.id), null, "cross-tenant lees geeft niets");
      assert.equal(await repo.count(tenantB), 0);

      // UNIQUE (tenant_id, customer_number): zelfde nummer mag bij een andere tenant.
      const bijB = await repo.insert(tenantB, { name: "Andere tenant", customerNumber: "K-001" }, "test");
      assert.ok(bijB.id);
      await assert.rejects(() => repo.insert(tenantA, { name: "Dubbel", customerNumber: "K-001" }, "test"),
        /duplicate key|unique/i, "binnen dezelfde tenant is het nummer uniek");

      // Backfill is idempotent en reconciliatie ziet dat het klopt.
      const legacy = [{ id: gemaakt.id, name: "Gewijzigd", email: "i@x.be", vatNumber: "BE0999" }];
      await backfillCustomers(pool, tenantA, legacy);
      await backfillCustomers(pool, tenantA, legacy);
      assert.equal(await repo.count(tenantA), 1, "tweemaal draaien maakt geen duplicaat");

      // ── P0-07: KINDEREN migreren mee en de reconciliatie ziet inhoudsdrift ──
      const metKinderen = [{
        id: gemaakt.id, name: "Gewijzigd", email: "i@x.be", vatNumber: "BE0999",
        contacts: [
          { id: "ct_bf_1", name: "Jan Peeters", email: "jan@x.be", phone: "0470", role: "zaakvoerder", isPrimary: true },
          { id: "ct_bf_2", name: "An", email: "an@x.be" },
        ],
        addresses: [
          { id: "ad_bf_1", type: "billing", line: "Dorpstraat 1", zip: "9000", city: "Gent", country: "BE" },
          { id: "ad_bf_2", type: "site", line: "Werfweg 7", city: "Aalst" },
        ],
      }];
      const bf = await backfillCustomers(pool, tenantA, metKinderen);
      assert.equal(bf.contactRows, 2, "beide contacten gemigreerd");
      assert.equal(bf.addressRows, 2, "beide adressen gemigreerd");
      let rec = await reconcileCustomers(pool, tenantA, metKinderen);
      assert.equal(rec.readyForCutover, true, `kinderen sluitend: ${JSON.stringify(rec.differences)}`);

      // Inhoudsdrift op een KIND blokkeert de cutover (aantallen kloppen dan nog).
      const drift = JSON.parse(JSON.stringify(metKinderen));
      drift[0].contacts[0].email = "ander@x.be";
      rec = await reconcileCustomers(pool, tenantA, drift);
      assert.equal(rec.readyForCutover, false, "kind-inhoudsdrift moet opvallen");
      assert.equal(rec.differences.length, 1);

      // Kind geschrapt in legacy → set-sync ruimt de genormaliseerde rij op.
      const minder = JSON.parse(JSON.stringify(metKinderen));
      minder[0].contacts = [minder[0].contacts[0]];
      await backfillCustomers(pool, tenantA, minder);
      rec = await reconcileCustomers(pool, tenantA, minder);
      assert.equal(rec.readyForCutover, true, "na set-sync weer sluitend");

      // Archiveren verbergt maar bewaart.
      await repo.archive(tenantA, gemaakt.id, "test");
      assert.equal((await repo.search(tenantA, {})).rows.length, 0);
      assert.equal((await repo.search(tenantA, { includeArchived: true })).rows.length, 1);
    } finally {
      for (const t of [tenantB, tenantA]) {
        await pool.query("DELETE FROM tenants WHERE id = $1", [t]).catch(() => {});
      }
      await pool.end();
    }
  });
