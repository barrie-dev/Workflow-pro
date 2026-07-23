"use strict";
// CTO2-12 + CTO3-03 · restore-drill. Objectopslag-deel draait altijd (local-
// adapter). Het pg-deel vereist DATABASE_URL: pgRestoreDrill herstelt ALLEEN
// platform_state (procespersistentie), pgFullRestoreDrill herstelt de VOLLEDIGE
// dataset (alle tabellen) met checksums en een functionele steekproef.
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
  const makeStorage = () => ({
    async put() { return { key: "x", size: 1 }; },
    async get() { const e = new Error("niet gevonden"); e.status = 404; throw e; },
    async delete() {},
  });
  await assert.rejects(() => drill.objectStorageRestoreDrill({ makeStorage }), /niet gevonden/);
});

test("CTO3-03 · objectmanifest-drill: manifest met checksums, missing- en orphan-detectie", async () => {
  const { LocalObjectStorage } = require("../src/infrastructure/local/object-storage");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfp-manifest-"));
  const storage = new LocalObjectStorage({ basePath: dir, signingKey: "k".repeat(40), urlTtlSeconds: 900 });
  // Twee tenants, drie objecten.
  const puts = [];
  for (const [tenantId, id] of [["t1", "a"], ["t1", "b"], ["t2", "c"]]) {
    const content = Buffer.from(`bestand ${tenantId}/${id}`);
    puts.push(await storage.put({ tenantId, scope: "docs", id, extension: "txt", content, mimeType: "text/plain", size: content.length, fileName: `${id}.txt`, scanStatus: "clean" }));
  }
  // Gezond manifest: alles aanwezig, geen orphans.
  let r = await drill.objectManifestDrill({ storage });
  assert.equal(r.ok, true, `gezond manifest moet groen zijn: ${JSON.stringify(r.missing || r.orphans)}`);
  assert.equal(r.objectCount, 3);
  assert.equal(r.missing.length, 0);
  assert.equal(r.orphans.length, 0);
  assert.ok(r.manifest.every(m => m.checksum && m.tenantId && m.key));

  // Verwijder het DATABESTAND maar laat de meta staan → MISSING (drill rood).
  const objPath = storage.resolvePath(puts[0].key);
  fs.rmSync(objPath, { force: true });
  r = await drill.objectManifestDrill({ storage });
  assert.equal(r.ok, false, "een ontbrekend databestand maakt de drill rood");
  assert.ok(r.missing.includes(puts[0].key), "het ontbrekende object staat in de missing-lijst");

  // Los databestand zonder meta → ORPHAN (drill rood).
  fs.writeFileSync(storage.resolvePath(puts[1].key) + ".orphan", "wees");
  r = await drill.objectManifestDrill({ storage });
  assert.ok(r.orphans.length >= 1, "een databestand zonder meta wordt als orphan gemeld");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("CTO3-03 · DR-runbook dekt volledige restore, objectmanifest en RPO/RTO", () => {
  const p = path.join(__dirname, "..", "docs", "DR-RUNBOOK.md");
  const txt = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  assert.match(txt, /Volledige DB-restore/i, "runbook beschrijft de volledige DB-restore");
  assert.match(txt, /objectmanifest/i, "runbook beschrijft het objectmanifest");
  assert.match(txt, /missing/i);
  assert.match(txt, /orphan/i);
  assert.match(txt, /RPO/);
  assert.match(txt, /RTO/);
  assert.match(txt, /scripts\/restore-drill\.js/, "runbook wijst naar de drill-CLI");
});

const LIVE = process.env.DATABASE_URL || "";
if (!LIVE || !/^postgres/.test(LIVE)) {
  test("restore-drill pg: DATABASE_URL niet gezet · overgeslagen", { skip: true }, () => {});
} else {
  const { Pool } = require("pg");
  const { STATE_TABLE, SCHEMA_SQL } = require("../src/infrastructure/postgres/pg-data-adapter");
  const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
  const ssl = /localhost|127\.0\.0\.1/.test(LIVE) ? undefined : { rejectUnauthorized: false };
  const adminUrl = LIVE.replace(/\/[^/?]+(\?|$)/, "/postgres$1");

  test("pg-drill (ALLEEN platform_state) · herstelt de state-tabel naar een verse scratch-db met RPO/RTO", async () => {
    const admin = new Pool({ connectionString: adminUrl, ssl });
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
      assert.equal(r.ok, true, "de herstelde platform_state is byte-gelijk aan de bron");
      assert.equal(r.revision, 7);
      assert.equal(r.collections, 2);
      assert.ok(r.rpoSeconds >= 0 && r.rtoSeconds >= 0, "RPO/RTO gemeten");
    } finally {
      await src.end();
      const admin2 = new Pool({ connectionString: adminUrl, ssl });
      await admin2.query(`DROP DATABASE IF EXISTS ${SRC} WITH (FORCE)`).catch(() => {});
      await admin2.end();
    }
  });

  test("CTO3-03 · full-restore-drill: herstelt ALLE tabellen met checksums + functionele steekproef", async () => {
    const admin = new Pool({ connectionString: adminUrl, ssl });
    const SRC = "wfp_fulldr_src";
    await admin.query(`DROP DATABASE IF EXISTS ${SRC} WITH (FORCE)`).catch(() => {});
    await admin.query(`CREATE DATABASE ${SRC}`);
    await admin.end();
    const srcUrl = LIVE.replace(/\/[^/?]+(\?|$)/, `/${SRC}$1`);
    const src = new Pool({ connectionString: srcUrl, ssl });
    try {
      // Volledige productie-schemabootstrap: document-tabel (platform_state) +
      // de genummerde migraties · exact wat de app bij een verse database doet.
      await src.query(SCHEMA_SQL);
      await runMigrations(src);
      // Realistische dataset: twee tenants, facturen, audit.
      const doc = {
        tenants: [{ id: "t1", name: "Alfa" }, { id: "t2", name: "Beta" }],
        users: [{ id: "u1", tenantId: "t1" }, { id: "u2", tenantId: "t2" }],
        customers: [{ id: "c1", tenantId: "t1" }, { id: "c2", tenantId: "t2" }],
        invoices: [{ id: "i1", tenantId: "t1", total: 100 }],
        audit: [{ action: "login", tenantId: "t1" }],
      };
      await src.query(`INSERT INTO ${STATE_TABLE} (id, data, revision) VALUES ('platform', $1, 4)`, [doc]);
      // Een tweede tabel met data (outbox) zodat de drill aantoonbaar meerdere
      // tabellen dekt · kolommen generiek uit information_schema is te broos, dus
      // we vertrouwen op de per-rij-kopie van SELECT *.
      const r = await drill.pgFullRestoreDrill({ pool: src, connectionString: srcUrl, scratchDb: "wfp_fulldr_scratch", now: Date.now() });
      assert.equal(r.ok, true, `de volledige restore moet groen zijn · mismatches: ${JSON.stringify(r.mismatches)}`);
      assert.ok(r.tableCount >= 8, `alle migratietabellen meegenomen (kreeg ${r.tableCount})`);
      assert.equal(r.mismatches.length, 0, "rijtotalen + checksums matchen per tabel");
      assert.equal(r.migrationsOk, true, "schema-/migratievalidatie op leeg schema geslaagd");
      assert.equal(r.functional.tenants, 2, "functionele steekproef: twee tenants hersteld");
      assert.equal(r.functional.hasInvoices, true);
      assert.equal(r.functional.hasAudit, true);
      assert.ok(r.rpoSeconds >= 0 && r.rtoSeconds >= 0, "RPO/RTO gemeten");
    } finally {
      await src.end();
      const admin2 = new Pool({ connectionString: adminUrl, ssl });
      await admin2.query(`DROP DATABASE IF EXISTS ${SRC} WITH (FORCE)`).catch(() => {});
      await admin2.end();
    }
  });
}
