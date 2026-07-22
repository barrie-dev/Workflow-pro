"use strict";
// CTO2-12 · restore-drill. Het objectopslag-deel draait altijd (local-adapter,
// bewijst persistentie over een vers adapter-exemplaar); het pg-deel vereist
// DATABASE_URL en herstelt platform_state naar een verse scratch-database.
const { test } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const drill = require("../src/modules/restore-drill");

test("objectstorage-drill · sentinel overleeft een vers adapter-exemplaar (local)", async () => {
  const { LocalObjectStorage } = require("../src/infrastructure/local/object-storage");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfp-restore-"));
  const makeStorage = () => new LocalObjectStorage({ basePath: dir, signingKey: "k".repeat(40), urlTtlSeconds: 900 });
  const r = await drill.objectStorageRestoreDrill({ makeStorage, now: 1_700_000_000_000 });
  assert.equal(r.ok, true, "het via de eerste adapter geschreven object komt terug via een tweede");
  assert.ok(r.bytes > 0);
  assert.ok(typeof r.rtoSeconds === "number");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("objectstorage-drill · faalt eerlijk als het object niet persisteert", async () => {
  // Een adapter die niets bewaart (get gooit) → drill.ok moet false zijn of gooien.
  const makeStorage = () => ({
    async put() { return { key: "x", size: 1 }; },
    async get() { const e = new Error("niet gevonden"); e.status = 404; throw e; },
    async delete() {},
  });
  await assert.rejects(() => drill.objectStorageRestoreDrill({ makeStorage }), /niet gevonden/);
});

const LIVE = process.env.DATABASE_URL || "";
if (!LIVE || !/^postgres/.test(LIVE)) {
  test("restore-drill pg: DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  const { Pool } = require("pg");
  const { STATE_TABLE, SCHEMA_SQL } = require("../src/infrastructure/postgres/pg-data-adapter");
  const ssl = /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false };

  test("pg-drill · herstelt platform_state naar een verse scratch-db met RPO/RTO", async () => {
    // Gebruik een EIGEN bron-database zodat de test niets van andere suites raakt.
    const admin = new Pool({ connectionString: LIVE.replace(/\/[^/?]+(\?|$)/, "/postgres$1"), ssl });
    const SRC = "wfp_drill_src";
    await admin.query(`DROP DATABASE IF EXISTS ${SRC} WITH (FORCE)`).catch(() => {});
    await admin.query(`CREATE DATABASE ${SRC}`);
    await admin.end();
    const srcUrl = LIVE.replace(/\/[^/?]+(\?|$)/, `/${SRC}$1`);
    const src = new Pool({ connectionString: srcUrl, ssl });
    try {
      await src.query(SCHEMA_SQL);
      const doc = { tenants: [{ id: "t1", name: "Bron BV" }], customers: [{ id: "c1" }, { id: "c2" }] };
      await src.query(`INSERT INTO ${STATE_TABLE} (id, data, revision) VALUES ('platform', $1, 7)`, [doc]);
      const r = await drill.pgRestoreDrill({ pool: src, connectionString: srcUrl, scratchDb: "wfp_drill_scratch", now: Date.now() });
      assert.equal(r.ok, true, "de herstelde database is byte-gelijk aan de bron");
      assert.equal(r.revision, 7);
      assert.equal(r.collections, 2);
      assert.ok(r.rpoSeconds >= 0 && r.rtoSeconds >= 0, "RPO/RTO gemeten");
    } finally {
      await src.end();
      const admin2 = new Pool({ connectionString: LIVE.replace(/\/[^/?]+(\?|$)/, "/postgres$1"), ssl });
      await admin2.query(`DROP DATABASE IF EXISTS ${SRC} WITH (FORCE)`).catch(() => {});
      await admin2.end();
    }
  });
}
