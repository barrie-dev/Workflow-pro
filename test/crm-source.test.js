"use strict";
// CRM-bronschakelaar (handover 5.4 stap 5-7): legacy passthrough, shadow met
// vergelijking en dual-write, pg-cutover met streng spiegel-faalgedrag, en een
// live doorloop van shadow → cutover → rollback tegen echte PostgreSQL.
const { test } = require("node:test");
const assert = require("node:assert");

const { makeCustomerSource } = require("../src/infrastructure/crm-source");

function fakeLegacy() {
  const rows = new Map();
  return {
    rows,
    list(tid) { return [...rows.values()].filter(r => r.tenantId === tid); },
    findById(tid, id) { return rows.get(id) || null; },
    insert(tid, payload, actor) { const row = { id: `cust_${rows.size + 1}`, tenantId: tid, version: 1, ...payload, createdBy: actor }; rows.set(row.id, row); return row; },
    update(tid, id, patch) { const row = { ...rows.get(id), ...patch, version: (rows.get(id).version || 1) + 1 }; rows.set(id, row); return row; },
    remove(tid, id) { rows.delete(id); return { ok: true }; },
  };
}
function fakePg({ failMirror = false } = {}) {
  const rows = new Map();
  const calls = { archived: [] };
  return {
    rows, calls,
    async findById(tid, id) { return rows.get(id) || null; },
    async search() { return { rows: [...rows.values()], nextCursor: null }; },
    async count(tid) { return [...rows.values()].filter(r => r.tenantId === tid).length; },
    async archive(tid, id) { calls.archived.push(id); },
    mirror: async (tid, row) => {
      if (failMirror) throw new Error("pg onbereikbaar");
      rows.set(row.id, { ...row });
    },
  };
}
function fakeTelemetry() {
  const metrics = [], logs = [];
  return { metrics, logs, metric(n, v, a) { metrics.push({ n, a }); }, log(e) { logs.push(e); }, security() {}, async span(n, w) { return w(); } };
}

test("crm-source: onbekende modus of ontbrekende pg faalt bij opstarten", () => {
  assert.throws(() => makeCustomerSource({ mode: "typo", legacyRepo: fakeLegacy() }), e => e.code === "UNKNOWN_CRM_SOURCE");
  assert.throws(() => makeCustomerSource({ mode: "shadow", legacyRepo: fakeLegacy() }), e => e.code === "CRM_SOURCE_NEEDS_PG");
  assert.throws(() => makeCustomerSource({ mode: "pg", legacyRepo: fakeLegacy() }), e => e.code === "CRM_SOURCE_NEEDS_PG");
});

test("crm-source: legacy-modus is puur passthrough, geen pg nodig", async () => {
  const legacy = fakeLegacy();
  const src = makeCustomerSource({ mode: "legacy", legacyRepo: legacy });
  const row = await src.insert("t1", { name: "Alfa" }, "admin");
  assert.equal((await src.list("t1")).length, 1);
  assert.equal((await src.findById("t1", row.id)).name, "Alfa");
  assert.deepEqual(src.status(), { source: "legacy", dualWrite: false });
});

test("crm-source: shadow schrijft dual en vergelijkt bij het lezen", async () => {
  const legacy = fakeLegacy(), pg = fakePg(), tel = fakeTelemetry();
  const src = makeCustomerSource({ mode: "shadow", legacyRepo: legacy, pgRepo: pg, mirror: pg.mirror, telemetry: tel });

  const row = await src.insert("t1", { name: "Alfa", email: "a@x.be" }, "admin");
  assert.ok(legacy.rows.has(row.id), "legacy geschreven (leidend)");
  assert.ok(pg.rows.has(row.id), "pg meegeschreven (dual-write)");

  // Detail-lees vergelijkt · gelijk → match-metriek.
  await src.findById("t1", row.id);
  assert.ok(tel.metrics.some(m => m.n === "crm.shadow.match"));

  // Maak pg afwijkend → mismatch-metriek + warn, maar legacy-antwoord blijft leidend.
  pg.rows.set(row.id, { ...pg.rows.get(row.id), name: "ANDERS" });
  const gelezen = await src.findById("t1", row.id);
  assert.equal(gelezen.name, "Alfa", "legacy blijft de waarheid in shadow");
  assert.ok(tel.metrics.some(m => m.n === "crm.shadow.mismatch"));
  assert.ok(tel.logs.some(l => /wijkt af/.test(l.message)));
});

test("crm-source: spiegel-fout breekt shadow NIET maar pg-modus WEL", async () => {
  // Shadow: legacy is de waarheid · verzoek slaagt, fout wordt gemeten.
  const telS = fakeTelemetry();
  const pgS = fakePg({ failMirror: true });
  const shadow = makeCustomerSource({ mode: "shadow", legacyRepo: fakeLegacy(), pgRepo: pgS, mirror: pgS.mirror, telemetry: telS });
  const row = await shadow.insert("t1", { name: "Alfa" }, "admin");
  assert.ok(row.id, "shadow-insert slaagt ondanks pg-fout");
  assert.ok(telS.metrics.some(m => m.n === "crm.mirror.failed"));

  // pg-modus: de gebruiker leest uit pg · een onzichtbare schrijfactie is erger
  // dan een fout, dus 503.
  const pgP = fakePg({ failMirror: true });
  const cutover = makeCustomerSource({ mode: "pg", legacyRepo: fakeLegacy(), pgRepo: pgP, mirror: pgP.mirror, telemetry: fakeTelemetry() });
  await assert.rejects(() => cutover.insert("t1", { name: "Alfa" }, "admin"), e => e.code === "CRM_MIRROR_FAILED" && e.status === 503);
});

test("crm-source: pg-modus leest uit pg en spiegelt remove als archiveren", async () => {
  const legacy = fakeLegacy(), pg = fakePg();
  const src = makeCustomerSource({ mode: "pg", legacyRepo: legacy, pgRepo: pg, mirror: pg.mirror, telemetry: fakeTelemetry() });
  const row = await src.insert("t1", { name: "Alfa" }, "admin");
  // Bewijs dat de lees uit pg komt: wijzig pg buitenom.
  pg.rows.set(row.id, { ...pg.rows.get(row.id), name: "Uit PG" });
  assert.equal((await src.findById("t1", row.id)).name, "Uit PG");
  await src.remove("t1", row.id);
  assert.ok(!legacy.rows.has(row.id), "legacy hard verwijderd (huidig gedrag)");
  assert.deepEqual(pg.calls.archived, [row.id], "pg archiveert · historiek blijft");
  assert.deepEqual(src.status(), { source: "pg", dualWrite: true });
});

// ── Live · volledige 5.4-doorloop tegen echte PostgreSQL ────────────────────
const LIVE_URL = process.env.DATABASE_URL || "";
test("crm-source: shadow → reconciliatie groen → cutover → rollback (live)",
  { skip: !LIVE_URL && "DATABASE_URL niet gezet" }, async () => {
    const { Pool } = require("pg");
    const { makePgCustomerRepository } = require("../src/infrastructure/postgres/pg-customer-repository");
    const { backfillCustomers, reconcileCustomers } = require("../src/infrastructure/postgres/crm-backfill");
    const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
    const pool = new Pool({ connectionString: LIVE_URL, max: 4 });
    const tenantId = `t_cut_${Date.now()}`;
    try {
      await runMigrations(pool);
      await pool.query("INSERT INTO tenants (id, name) VALUES ($1,$1) ON CONFLICT (id) DO NOTHING", [tenantId]);
      const legacy = fakeLegacy();
      const pgRepo = makePgCustomerRepository(pool);
      const mirror = async (tid, row) => backfillCustomers(pool, tid, [row]);

      // Stap 5/6 · shadow: schrijf via de façade, beide bronnen gevuld.
      const shadow = makeCustomerSource({ mode: "shadow", legacyRepo: legacy, pgRepo, mirror, telemetry: fakeTelemetry() });
      const a = await shadow.insert(tenantId, { name: "Cutover Klant", email: "c@x.be", vatNumber: "BE0777" }, "test");
      await shadow.update(tenantId, a.id, { name: "Cutover Klant BV", email: "c@x.be", vatNumber: "BE0777" }, "test");
      assert.equal((await pgRepo.findById(tenantId, a.id)).name, "Cutover Klant BV", "update gespiegeld naar pg");

      // Stap 4-poort: reconciliatie moet groen zijn vóór de flip.
      const rec = await reconcileCustomers(pool, tenantId, legacy.list(tenantId));
      assert.equal(rec.readyForCutover, true, `reconciliatie groen (${JSON.stringify({ m: rec.missing, e: rec.extra, d: rec.differences.length })})`);

      // Stap 7 · cutover: lees uit pg. Bewijs door pg buitenom te wijzigen.
      const cutover = makeCustomerSource({ mode: "pg", legacyRepo: legacy, pgRepo, mirror, telemetry: fakeTelemetry() });
      await pool.query("BEGIN"); await pool.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      await pool.query("UPDATE customers SET name = 'Bewijs uit PG' WHERE tenant_id = $1 AND id = $2", [tenantId, a.id]);
      await pool.query("COMMIT");
      assert.equal((await cutover.findById(tenantId, a.id)).name, "Bewijs uit PG", "API leest na de flip echt uit pg");

      // Rollback = flag terug: legacy heeft alles nog (dual-write), dus lezen werkt meteen.
      const terug = makeCustomerSource({ mode: "legacy", legacyRepo: legacy });
      assert.equal((await terug.findById(tenantId, a.id)).name, "Cutover Klant BV", "rollback verliest niets");
    } finally {
      await pool.query("DELETE FROM tenants WHERE id = $1", [tenantId]).catch(() => {});
      await pool.end();
    }
  });
