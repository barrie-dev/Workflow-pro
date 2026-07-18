"use strict";
// PostgreSQL-opslagadapter (vendor-handover F-01/F-02): standaard Postgres,
// revisie-gebaseerde optimistic locking, flush-coalescing, geen dataverlies.
//
// De pool is injecteerbaar, zodat het CONTRACT hier zonder database getest
// wordt. De integratietest onderaan draait alleen met een echte DATABASE_URL.
const { test } = require("node:test");
const assert = require("node:assert");

const { PostgresDataAdapter, STATE_TABLE } = require("../src/infrastructure/postgres/pg-data-adapter");

/** Minimale pg-pool-dubbel die de queries registreert en antwoorden teruggeeft. */
function fakePool(handlers = {}) {
  const calls = [];
  return {
    calls,
    totalCount: 1, idleCount: 1, waitingCount: 0,
    async query(sql, params) {
      calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      if (/CREATE TABLE/i.test(sql)) return { rows: [] };
      if (/^SELECT/i.test(sql.trim())) return handlers.select ? handlers.select(params) : { rows: [] };
      if (/^INSERT/i.test(sql.trim())) return handlers.insert ? handlers.insert(params) : { rows: [{ revision: 1 }] };
      if (/^UPDATE/i.test(sql.trim())) return handlers.update ? handlers.update(params) : { rows: [{ revision: 2 }] };
      return { rows: [] };
    },
    async end() { this.ended = true; },
  };
}

test("pg-adapter: vereist een DATABASE_URL", () => {
  assert.throws(() => new PostgresDataAdapter({}), e => e.code === "DATABASE_URL_MISSING");
  // Met een geïnjecteerde pool mag de URL ontbreken (tests).
  assert.doesNotThrow(() => new PostgresDataAdapter({ pool: fakePool() }));
});

test("pg-adapter: verse database krijgt de seed en het schema", async () => {
  const pool = fakePool({ select: () => ({ rows: [] }), insert: () => ({ rows: [{ revision: 1 }] }) });
  const adapter = new PostgresDataAdapter({ pool });
  const seed = () => ({ tenants: [], users: [] });
  const data = await adapter.loadAsync(seed);

  assert.deepEqual(data, { tenants: [], users: [] });
  assert.equal(adapter.revision, 1);
  assert.ok(pool.calls.some(c => /CREATE TABLE IF NOT EXISTS/.test(c.sql)), "schema idempotent aangelegd");
  assert.ok(pool.calls.some(c => c.sql.startsWith("INSERT INTO")), "seed weggeschreven");
  assert.equal(adapter.status().online, true);
});

test("pg-adapter: bestaande data wordt geladen met haar revisie", async () => {
  const stored = { tenants: [{ id: "t1" }], users: [] };
  const pool = fakePool({ select: () => ({ rows: [{ data: stored, revision: 7 }] }) });
  const adapter = new PostgresDataAdapter({ pool });
  const data = await adapter.loadAsync(() => ({ tenants: [] }));
  assert.deepEqual(data, stored);
  assert.equal(adapter.revision, 7);
  assert.ok(!pool.calls.some(c => c.sql.startsWith("INSERT INTO")), "bestaande rij niet overschreven");
});

test("pg-adapter: save markeert vuil, flush schrijft en verhoogt de revisie", async () => {
  const pool = fakePool({ select: () => ({ rows: [{ data: {}, revision: 3 }] }), update: () => ({ rows: [{ revision: 4 }] }) });
  const adapter = new PostgresDataAdapter({ pool });
  await adapter.loadAsync(() => ({}));

  assert.equal(adapter.isDirty(), false);
  adapter.save({ tenants: [{ id: "t1" }] });
  assert.equal(adapter.isDirty(), true, "save schrijft niet zelf");
  assert.equal(pool.calls.filter(c => c.sql.startsWith("UPDATE")).length, 0);

  const res = await adapter.flush();
  assert.equal(res.written, true);
  assert.equal(adapter.revision, 4);
  assert.equal(adapter.isDirty(), false);
  const update = pool.calls.find(c => c.sql.startsWith("UPDATE"));
  assert.match(update.sql, new RegExp(`UPDATE ${STATE_TABLE}`));
  assert.equal(update.params[2], 3, "optimistic locking op de gelezen revisie");

  // Zonder wijzigingen schrijft flush niets.
  assert.deepEqual(await adapter.flush(), { written: false });
});

test("pg-adapter: revisieconflict overschrijft niet en bewaart de mutatie", async () => {
  // Een andere replica schreef tussentijds → de UPDATE raakt 0 rijen.
  const pool = fakePool({ select: () => ({ rows: [{ data: {}, revision: 3 }] }), update: () => ({ rows: [] }) });
  const adapter = new PostgresDataAdapter({ pool });
  await adapter.loadAsync(() => ({}));
  adapter.save({ tenants: [{ id: "nieuw" }] });

  await assert.rejects(() => adapter.flush(), e => e.code === "STATE_REVISION_CONFLICT");
  // De mutatie is NIET weggegooid: ze staat klaar voor een retry na herladen.
  assert.equal(adapter.isDirty(), true, "openstaande mutatie behouden");
  assert.match(adapter.status().lastError, /revisieconflict/);
  assert.equal(adapter.status().online, false, "conflict maakt de adapter niet-gezond");
});

test("pg-adapter: schrijffout gooit de mutatie niet weg", async () => {
  const pool = fakePool({
    select: () => ({ rows: [{ data: {}, revision: 1 }] }),
    update: () => { throw new Error("connection terminated"); },
  });
  const adapter = new PostgresDataAdapter({ pool });
  await adapter.loadAsync(() => ({}));
  adapter.save({ a: 1 });
  await assert.rejects(() => adapter.flush(), /connection terminated/);
  assert.equal(adapter.isDirty(), true, "mutatie blijft staan voor een nieuwe poging");
  assert.match(adapter.status().lastError, /connection terminated/);
});

test("pg-adapter: gelijktijdige flushes worden samengevoegd tot één schrijfactie", async () => {
  let updates = 0;
  const pool = fakePool({
    select: () => ({ rows: [{ data: {}, revision: 1 }] }),
    update: () => { updates++; return { rows: [{ revision: 2 }] }; },
  });
  const adapter = new PostgresDataAdapter({ pool });
  await adapter.loadAsync(() => ({}));
  adapter.save({ a: 1 });
  const [r1, r2, r3] = await Promise.all([adapter.flush(), adapter.flush(), adapter.flush()]);
  assert.equal(updates, 1, "drie aanroepen, één schrijfactie");
  assert.equal(r1.written, true);
  assert.deepEqual([r2.written, r3.written], [true, true]);
});

test("pg-adapter: status meldt openstaande schrijfacties en poolgebruik", async () => {
  const pool = fakePool({ select: () => ({ rows: [{ data: {}, revision: 1 }] }) });
  const adapter = new PostgresDataAdapter({ pool });
  await adapter.loadAsync(() => ({}));
  const idle = adapter.status();
  assert.equal(idle.adapter, "postgres");
  assert.equal(idle.mode, "postgres");
  assert.equal(idle.pendingWrites, false);
  assert.ok(idle.pool && typeof idle.pool.total === "number");
  // Bewust geen providernaam in de status: dit draait op elke Postgres.
  assert.ok(!/supabase|azure|aws|render/i.test(JSON.stringify(idle)));
  adapter.save({ a: 1 });
  assert.equal(adapter.status().pendingWrites, true);
});

test("pg-adapter: close flusht eerst en sluit dan de pool", async () => {
  const pool = fakePool({ select: () => ({ rows: [{ data: {}, revision: 1 }] }), update: () => ({ rows: [{ revision: 2 }] }) });
  const adapter = new PostgresDataAdapter({ pool });
  await adapter.loadAsync(() => ({}));
  adapter.save({ a: 1 });
  await adapter.close();
  assert.equal(adapter.isDirty(), false, "openstaande data bewaard vóór het sluiten");
  assert.equal(pool.ended, true);
});

// ── Integratietest · draait alleen met een echte database ────────────────────
// Zet DATABASE_URL (bv. via docker compose) om deze mee te draaien:
//   DATABASE_URL=postgresql://wfp:wfp@localhost:5432/wfp node --test test/pg-data-adapter.test.js
const LIVE_URL = process.env.DATABASE_URL || "";
test("pg-adapter: integratie tegen een echte PostgreSQL", { skip: !LIVE_URL && "DATABASE_URL niet gezet" }, async () => {
  const adapter = new PostgresDataAdapter({ connectionString: LIVE_URL, ssl: String(process.env.DATABASE_SSL) === "true" });
  try {
    const seed = () => ({ tenants: [], users: [], marker: "seed" });
    const loaded = await adapter.loadAsync(seed);
    assert.ok(loaded && typeof loaded === "object");

    const marker = `test_${Date.now()}`;
    adapter.save({ ...loaded, marker });
    const res = await adapter.flush();
    assert.equal(res.written, true);

    // Een tweede adapter ziet dezelfde data · bewijst echte persistentie.
    const second = new PostgresDataAdapter({ connectionString: LIVE_URL, ssl: String(process.env.DATABASE_SSL) === "true" });
    const reread = await second.loadAsync(seed);
    assert.equal(reread.marker, marker);
    await second.close();
  } finally {
    await adapter.close();
  }
});
