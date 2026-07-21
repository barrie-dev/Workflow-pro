"use strict";
// PostgreSQL-unit-of-work (ADR-003 · CTO P0-01): native BEGIN/COMMIT/ROLLBACK
// op één connectie, join-semantiek per asynchrone keten en - het belangrijkste -
// bestaande repositories die zich ZONDER codewijziging bij een lopende
// transactie voegen. Live-bewijs onderaan tegen echte PostgreSQL (draait in CI).
const { test } = require("node:test");
const assert = require("node:assert");

const { makePgTransactionManager, ambientClient } = require("../src/infrastructure/postgres/pg-transaction-manager");
const { isTransactionManager } = require("../src/ports/transaction-manager");
const { withTenant } = require("../src/infrastructure/postgres/pg-customer-repository");

/** Fake pool die per connect() een verse client met eigen querylog uitgeeft. */
function fakeTxPool() {
  const clients = [];
  return {
    clients,
    async connect() {
      const client = {
        log: [],
        released: false,
        async query(sql, params) {
          this.log.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
          if (/GEFORCEERDE_FOUT/.test(String(sql))) throw new Error("query faalt hard");
          return { rows: [] };
        },
        release() { this.released = true; },
      };
      clients.push(client);
      return client;
    },
  };
}

test("pg-uow: implementeert de poort en commit in de juiste volgorde", async () => {
  const pool = fakeTxPool();
  const manager = makePgTransactionManager(pool);
  assert.ok(isTransactionManager(manager));
  assert.equal(manager.adapter, "postgres");

  const out = await manager.run(async ({ query }) => {
    await query("INSERT INTO iets VALUES (1)");
    return "klaar";
  });
  assert.equal(out, "klaar");
  const seq = pool.clients[0].log.map(q => q.sql.split(" ")[0]);
  assert.deepEqual(seq, ["BEGIN", "INSERT", "COMMIT"], "werk zit tussen BEGIN en COMMIT");
  assert.equal(pool.clients[0].released, true, "client terug naar de pool");
});

test("pg-uow: fout → ROLLBACK, fout propageert, client komt altijd vrij", async () => {
  const pool = fakeTxPool();
  const manager = makePgTransactionManager(pool);
  await assert.rejects(
    () => manager.run(async ({ query }) => { await query("INSERT GEFORCEERDE_FOUT"); }),
    /query faalt hard/);
  const seq = pool.clients[0].log.map(q => q.sql.split(" ")[0]);
  assert.equal(seq[seq.length - 1], "ROLLBACK");
  assert.equal(pool.clients[0].released, true, "ook na een fout geen connectielek");
});

test("pg-uow: genest run() joint de transactie · zelfde client, één BEGIN/COMMIT", async () => {
  const pool = fakeTxPool();
  const manager = makePgTransactionManager(pool);
  await manager.run(async ({ query, client }) => {
    await query("INSERT INTO buiten VALUES (1)");
    await manager.run(async (inner) => {
      assert.equal(inner.client, client, "genest werk draait op dezelfde connectie");
      await inner.query("INSERT INTO binnen VALUES (2)");
    });
  });
  assert.equal(pool.clients.length, 1, "één connectie voor de hele unit-of-work");
  const begins = pool.clients[0].log.filter(q => q.sql === "BEGIN").length;
  assert.equal(begins, 1, "de geneste run start geen tweede transactie");
});

test("pg-uow: fout in genest werk rolt ook het buitenste werk terug", async () => {
  const pool = fakeTxPool();
  const manager = makePgTransactionManager(pool);
  await assert.rejects(() => manager.run(async ({ query }) => {
    await query("INSERT INTO buiten VALUES (1)");
    await manager.run(async (inner) => { await inner.query("INSERT GEFORCEERDE_FOUT"); });
  }), /query faalt hard/);
  const seq = pool.clients[0].log.map(q => q.sql.split(" ")[0]);
  assert.equal(seq[seq.length - 1], "ROLLBACK", "alles-of-niets over de hele keten");
});

test("pg-uow: gelijktijdige requests krijgen elk hun EIGEN transactie (geen vermenging)", async () => {
  const pool = fakeTxPool();
  const manager = makePgTransactionManager(pool);
  // Twee 'requests' die elkaars await-vensters doorkruisen. Met een globale
  // teller (zoals de lokale adapter) zouden ze in elkaars transactie belanden;
  // met AsyncLocalStorage niet.
  await Promise.all([
    manager.run(async ({ query }) => {
      await query("INSERT INTO a VALUES (1)");
      await new Promise(r => setTimeout(r, 10));
      await query("INSERT INTO a VALUES (2)");
    }),
    manager.run(async ({ query }) => {
      await query("INSERT INTO b VALUES (1)");
      await new Promise(r => setTimeout(r, 5));
      await query("INSERT INTO b VALUES (2)");
    }),
  ]);
  assert.equal(pool.clients.length, 2, "twee transacties → twee connecties");
  for (const client of pool.clients) {
    const tables = new Set(client.log.filter(q => q.sql.startsWith("INSERT")).map(q => q.sql.split(" ")[2]));
    assert.equal(tables.size, 1, "elke connectie zag alleen zijn eigen werk");
  }
});

test("pg-uow: buiten een transactie is er geen ambient client", async () => {
  assert.equal(ambientClient(), null);
  const manager = makePgTransactionManager(fakeTxPool());
  assert.equal(manager.inTransaction(), false);
  await manager.run(async () => { assert.equal(manager.inTransaction(), true); });
  assert.equal(manager.inTransaction(), false, "administratie opgeruimd na afloop");
});

test("pg-uow: withTenant() joint een lopende transactie zonder eigen BEGIN", async () => {
  const pool = fakeTxPool();
  const manager = makePgTransactionManager(pool);
  await manager.run(async ({ client }) => {
    const result = await withTenant(pool, "t1", async c => {
      assert.equal(c, client, "repository-werk draait op de transactie-connectie");
      return "repo-resultaat";
    });
    assert.equal(result, "repo-resultaat");
  });
  assert.equal(pool.clients.length, 1, "withTenant checkte GEEN eigen connectie uit");
  const log = pool.clients[0].log;
  assert.ok(log.some(q => /set_config\('app.tenant_id'/.test(q.sql) && q.params[0] === "t1"),
    "tenantcontext (RLS) gezet binnen de gejoinde transactie");
  assert.equal(log.filter(q => q.sql === "BEGIN").length, 1, "geen tweede BEGIN vanuit de repository");
});

test("pg-uow: withTenant() zonder lopende transactie werkt zoals voorheen (eigen tx)", async () => {
  const pool = fakeTxPool();
  const out = await withTenant(pool, "t1", async () => "solo");
  assert.equal(out, "solo");
  const seq = pool.clients[0].log.map(q => q.sql.split(" ")[0]);
  assert.equal(seq[0], "BEGIN");
  assert.equal(seq[seq.length - 1], "COMMIT");
  assert.equal(pool.clients[0].released, true);
});

// ── Live tegen echte PostgreSQL (CI draait dit; lokaal met DATABASE_URL) ────
const LIVE_URL = process.env.DATABASE_URL || "";
test("pg-uow live: repository-calls binnen één run() zijn alles-of-niets",
  { skip: !LIVE_URL && "DATABASE_URL niet gezet" }, async () => {
    const { Pool } = require("pg");
    const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
    const { makePgCustomerRepository } = require("../src/infrastructure/postgres/pg-customer-repository");
    const pool = new Pool({ connectionString: LIVE_URL, max: 3 });
    const tenant = `t_uow_${Date.now().toString(36)}`;
    try {
      await runMigrations(pool);
      await pool.query("INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [tenant, "UoW-test"]);
      const manager = makePgTransactionManager(pool);
      const repo = makePgCustomerRepository(pool);

      // 1. Commit: twee repository-calls in één transactie, beide zichtbaar.
      await manager.run(async () => {
        await repo.insert(tenant, { name: "Klant Een", email: "een@test.be" }, "uow-test");
        await repo.insert(tenant, { name: "Klant Twee", email: "twee@test.be" }, "uow-test");
      });
      let found = await repo.search(tenant, { limit: 10 });
      assert.equal(found.rows.length, 2, "beide klanten gecommit");

      // 2. Rollback: de eerste create slaagt binnen de tx, dan knalt het werk.
      //    Zonder unit-of-work zou 'Klant Drie' blijven staan; mét niet.
      await assert.rejects(() => manager.run(async () => {
        await repo.insert(tenant, { name: "Klant Drie", email: "drie@test.be" }, "uow-test");
        throw new Error("use-case faalt na de eerste write");
      }), /use-case faalt/);
      found = await repo.search(tenant, { limit: 10 });
      assert.equal(found.rows.length, 2, "de teruggerolde klant bestaat niet · alles-of-niets");
      assert.ok(!found.rows.some(c => c.name === "Klant Drie"));
    } finally {
      await pool.query("DELETE FROM customer_addresses WHERE tenant_id = $1", [tenant]).catch(() => {});
      await pool.query("DELETE FROM customer_contacts WHERE tenant_id = $1", [tenant]).catch(() => {});
      await pool.query("DELETE FROM customers WHERE tenant_id = $1", [tenant]).catch(() => {});
      await pool.query("DELETE FROM tenants WHERE id = $1", [tenant]).catch(() => {});
      await pool.end();
    }
  });
