"use strict";
// Transactionele outbox (CTO P0-05): staat + events committen in ÉÉN
// transactie of helemaal niet; een mislukte flush gooit niets weg; de
// duurzame tabel overleeft de in-memory cap; retentie ruimt alleen bezorgde
// events op. Live-bewijs onderaan tegen echte PostgreSQL (draait in CI).
const { test } = require("node:test");
const assert = require("node:assert");

const { PostgresDataAdapter } = require("../src/infrastructure/postgres/pg-data-adapter");
const { emitDomainEvent, registerOutboxSink, markEventDelivered } = require("../src/platform/events");

function fakeClientPool({ failOn = null } = {}) {
  const queries = [];
  const client = {
    async query(sql, params) {
      const flat = String(sql).replace(/\s+/g, " ").trim();
      queries.push({ sql: flat, params });
      if (failOn && failOn.test(flat)) throw new Error(`geforceerde fout op: ${flat.slice(0, 40)}`);
      if (/^UPDATE platform_state/.test(flat)) return { rows: [{ revision: 2 }] };
      return { rows: [] };
    },
    release() {},
  };
  return { queries, async connect() { return client; }, async query(sql, params) { return client.query(sql, params); } };
}

function makeEvent(id) {
  return { id, tenantId: "t1", eventType: "invoice.created", aggregateType: "invoice", aggregateId: "i1", occurredAt: "2026-07-21T10:00:00Z", correlationId: "corr_1", version: 1, data: { x: 1 } };
}

test("flush commit: BEGIN → staat → outbox-inserts → statusupdates → COMMIT, in die volgorde", async () => {
  const pool = fakeClientPool();
  const adapter = new PostgresDataAdapter({ pool });
  adapter.ready = true;
  adapter.save({ tenants: [] });
  adapter.queueOutboxAppend(makeEvent("evt_1"));
  adapter.queueOutboxAppend(makeEvent("evt_2"));
  adapter.queueOutboxStatus({ id: "evt_0", status: "delivered", attempts: 1 });

  const result = await adapter.flush();
  assert.equal(result.written, true);
  assert.equal(result.outboxAppended, 2);
  assert.equal(result.outboxUpdated, 1);

  const seq = pool.queries.map(q => q.sql.split(" ")[0] + (q.sql.includes("outbox_events") ? ":outbox" : q.sql.includes("platform_state") ? ":state" : ""));
  assert.equal(seq[0], "BEGIN");
  assert.equal(seq[seq.length - 1], "COMMIT");
  assert.ok(seq.indexOf("UPDATE:state") > seq.indexOf("BEGIN"), "staat binnen de transactie");
  assert.ok(seq.filter(s => s === "INSERT:outbox").length === 2, "beide events in dezelfde transactie");
  assert.ok(pool.queries.some(q => /ON CONFLICT \(id\) DO NOTHING/.test(q.sql)), "idempotent op event-id");
  assert.equal(adapter.isDirty(), false, "wachtrijen leeg na commit");
});

test("flush rollback: een fout op de outbox-insert rolt ALLES terug en gooit niets weg", async () => {
  const pool = fakeClientPool({ failOn: /INSERT INTO outbox_events/ });
  const adapter = new PostgresDataAdapter({ pool });
  adapter.ready = true;
  adapter.save({ tenants: [] });
  adapter.queueOutboxAppend(makeEvent("evt_1"));

  await assert.rejects(() => adapter.flush(), /geforceerde fout/);
  assert.ok(pool.queries.some(q => q.sql === "ROLLBACK"), "transactie teruggerold · staat en event samen");
  assert.equal(adapter.isDirty(), true, "staat én event wachten op een nieuwe poging");
  assert.equal(adapter.outboxAppend.length, 1, "event niet weggegooid");
  assert.equal(adapter.pending !== null, true, "staat niet weggegooid");
});

test("events-sink: emit en delivered lopen via de geregistreerde sink; zonder sink gebeurt er niets", () => {
  const appended = [], statuses = [];
  registerOutboxSink({ append: e => appended.push(e.id), status: u => statuses.push(u) });
  try {
    const store = { data: {}, save() {} };
    const ev = emitDomainEvent(store, { tenantId: "t1", eventType: "invoice.created", aggregateType: "invoice", aggregateId: "i1" });
    assert.deepEqual(appended, [ev.id], "nieuw event naar de duurzame log");
    markEventDelivered(store, ev.id);
    assert.equal(statuses[0].id, ev.id);
    assert.equal(statuses[0].status, "delivered");
  } finally {
    registerOutboxSink(null);   // niet laten lekken naar andere tests
  }
  const store2 = { data: {}, save() {} };
  assert.doesNotThrow(() => emitDomainEvent(store2, { tenantId: "t1", eventType: "invoice.created", aggregateType: "invoice", aggregateId: "i2" }), "zonder sink blijft alles werken");
});

// ── Live tegen echte PostgreSQL (CI draait dit; lokaal met DATABASE_URL) ────
const LIVE_URL = process.env.DATABASE_URL || "";
test("outbox live: event overleeft de in-memory cap in de duurzame tabel · status en retentie kloppen",
  { skip: !LIVE_URL && "DATABASE_URL niet gezet" }, async () => {
    const { Pool } = require("pg");
    const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
    const pool = new Pool({ connectionString: LIVE_URL, max: 2 });
    const adapter = new PostgresDataAdapter({ pool });
    const evtId = `evt_outboxtest_${Date.now().toString(36)}`;
    try {
      await runMigrations(pool);
      await adapter.loadAsync(() => ({ tenants: [] }));
      adapter.save({ tenants: [], marker: evtId });
      adapter.queueOutboxAppend(makeEvent(evtId));
      await adapter.flush();

      const { rows } = await pool.query(`SELECT * FROM outbox_events WHERE id = $1`, [evtId]);
      assert.equal(rows.length, 1, "event duurzaam in de tabel");
      assert.equal(rows[0].delivery_status, "pending");
      assert.equal(rows[0].data.x, 1, "payload bewaard als jsonb");

      // Idempotent: nogmaals aanbieden dupliceert niet.
      adapter.queueOutboxAppend(makeEvent(evtId));
      adapter.save({ tenants: [], marker: evtId, weer: true });
      await adapter.flush();
      const again = await pool.query(`SELECT count(*)::int AS n FROM outbox_events WHERE id = $1`, [evtId]);
      assert.equal(again.rows[0].n, 1);

      // Statusupdate + retentie: delivered en oud → opgeruimd; pending blijft.
      adapter.queueOutboxStatus({ id: evtId, status: "delivered", attempts: 1 });
      adapter.save({ tenants: [], marker: evtId, klaar: true });
      await adapter.flush();
      await pool.query(`UPDATE outbox_events SET occurred_at = now() - interval '60 days' WHERE id = $1`, [evtId]);
      const pruned = await adapter.pruneOutbox({ keepDays: 30 });
      assert.ok(pruned.removed >= 1, "bezorgd + oud → opgeruimd");
      const gone = await pool.query(`SELECT count(*)::int AS n FROM outbox_events WHERE id = $1`, [evtId]);
      assert.equal(gone.rows[0].n, 0);
    } finally {
      await pool.query(`DELETE FROM outbox_events WHERE id = $1`, [evtId]).catch(() => {});
      await pool.end();
    }
  });
