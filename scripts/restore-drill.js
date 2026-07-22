#!/usr/bin/env node
"use strict";

// ── scripts/restore-drill.js (CTO2-12) ───────────────────────────────────────
// Praktische restore-drill met gemeten RPO/RTO. Herstelt platform_state naar een
// verse scratch-database en bewijst dat de objectopslag een procesherstart
// overleeft. Exit 1 als een van beide drills faalt (release-gate).
//
// Gebruik (productie): STORAGE_ADAPTER=postgres DATABASE_URL=... \
//   OBJECT_STORAGE_ADAPTER=s3 OBJECT_STORAGE_* ... node scripts/restore-drill.js
//
// Draait ook lokaal: DATABASE_URL=postgres://... node scripts/restore-drill.js

const path = require("path");
const ROOT = path.join(__dirname, "..");
const { config } = require(path.join(ROOT, "src/lib/config"));
const drill = require(path.join(ROOT, "src/modules/restore-drill"));
const { createObjectStorage } = require(path.join(ROOT, "src/infrastructure/object-storage-factory"));

async function main() {
  const jsonMode = process.argv.includes("--json");
  const report = { at: new Date().toISOString(), pg: null, objectStorage: null, storageAdapter: config.objectStorage.adapter };
  let failed = false;

  // ── Database ──
  const dbUrl = config.database.url;
  if (/^postgres(ql)?:\/\//.test(dbUrl)) {
    const { Pool } = require("pg");
    const ssl = /localhost|127\.0\.0\.1/.test(dbUrl) ? undefined : { rejectUnauthorized: false };
    const pool = new Pool({ connectionString: dbUrl, ssl });
    try {
      report.pg = await drill.pgRestoreDrill({ pool, connectionString: dbUrl });
      if (!report.pg.ok) failed = true;
    } catch (e) { report.pg = { ok: false, error: e.message }; failed = true; }
    finally { await pool.end(); }
  } else {
    report.pg = { ok: false, error: "DATABASE_URL ontbreekt · restore-drill vereist PostgreSQL" };
    failed = true;
  }

  // ── Objectopslag ── (local is toegestaan voor de drill zelf; productie draait s3)
  try {
    report.objectStorage = await drill.objectStorageRestoreDrill({ makeStorage: () => createObjectStorage() });
    if (!report.objectStorage.ok) failed = true;
  } catch (e) { report.objectStorage = { ok: false, error: e.message }; failed = true; }

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const p = report.pg, o = report.objectStorage;
    console.log("── Restore-drill (CTO2-12) ─────────────────────────────");
    console.log(`Database    : ${p.ok ? "HERSTELD" : "FOUT"} · ${p.ok ? `${p.collections} collecties, revisie ${p.revision}` : p.error}`);
    if (p.ok) console.log(`              RPO ${p.rpoSeconds}s (snapshot ${p.snapshotAt}) · RTO ${p.rtoSeconds}s`);
    console.log(`Objectopslag: ${o.ok ? "HERSTELD" : "FOUT"} (${report.storageAdapter}) · ${o.ok ? `${o.bytes} bytes round-trip, RTO ${o.rtoSeconds}s` : o.error}`);
    console.log(failed ? "RESULTAAT: FAAL · herstel niet bewezen." : "RESULTAAT: OK · database + bestanden aantoonbaar herstelbaar.");
  }
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
