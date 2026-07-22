"use strict";
// CTO-03 single-writer-guard + CTO-05 shutdown durability.
// De DIRTY_SHUTDOWN-unit draait altijd (fake pool); de advisory-lock-test
// vraagt een echte PostgreSQL en slaat zonder DATABASE_URL over.
const { test } = require("node:test");
const assert = require("node:assert");
const { PostgresDataAdapter, WRITER_LOCK_KEY } = require("../src/infrastructure/postgres/pg-data-adapter");

test("CTO-05 · close() gooit DIRTY_SHUTDOWN als de flush blijft falen (geen stil dataverlies)", async () => {
  // Fake pool: elke verbinding faalt (database onbereikbaar), end() lukt wel.
  const fakePool = {
    connect: async () => { throw new Error("database onbereikbaar"); },
    query: async () => { throw new Error("database onbereikbaar"); },
    end: async () => {},
  };
  const adapter = new PostgresDataAdapter({ pool: fakePool, connectionString: "postgresql://x" });
  adapter.save({ tenants: [{ id: "t1" }] }); // dirty maken
  assert.equal(adapter.isDirty(), true);
  await assert.rejects(() => adapter.close(), e => e.code === "DIRTY_SHUTDOWN");
  // force bestaat voor tests/noodpaden en gooit dan niet.
  const adapter2 = new PostgresDataAdapter({ pool: { ...fakePool }, connectionString: "postgresql://x" });
  adapter2.save({ tenants: [] });
  await adapter2.close({ force: true }); // geen throw
});

test("CTO-05 · schone close() gooit niet", async () => {
  const fakePool = { connect: async () => { throw new Error("nooit nodig"); }, end: async () => {} };
  const adapter = new PostgresDataAdapter({ pool: fakePool, connectionString: "postgresql://x" });
  await adapter.close(); // niet dirty → geen flush nodig → geen throw
});

const LIVE = process.env.DATABASE_URL || "";
if (!LIVE || !/^postgres/.test(LIVE)) {
  test("pg-writer-lock: DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  test("CTO-03 · tweede instantie krijgt de writer-lock NIET zolang de eerste hem houdt", async () => {
    const { Pool } = require("pg");
    const ssl = /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false };
    const a = new PostgresDataAdapter({ pool: new Pool({ connectionString: LIVE, ssl }), connectionString: LIVE });
    const b = new PostgresDataAdapter({ pool: new Pool({ connectionString: LIVE, ssl }), connectionString: LIVE });
    try {
      assert.equal(await a.acquireWriterLock({ waitMs: 5000, retryMs: 200 }), true, "eerste writer krijgt de lock");
      // Idempotent voor dezelfde instantie.
      assert.equal(await a.acquireWriterLock(), true);
      // De tweede instantie faalt hard binnen zijn wachtvenster.
      await assert.rejects(
        () => b.acquireWriterLock({ waitMs: 1200, retryMs: 250 }),
        e => e.code === "WRITER_LOCK_TIMEOUT",
        "geen tweede schrijver zolang de eerste leeft"
      );
      // Na vrijgave (rolling deploy: oude instantie sluit af) neemt B hem over.
      await a.releaseWriterLock();
      assert.equal(await b.acquireWriterLock({ waitMs: 5000, retryMs: 200 }), true, "opvolger neemt de lock over");
    } finally {
      await a.close({ force: true }).catch(() => {});
      await b.close({ force: true }).catch(() => {});
    }
  });
}
