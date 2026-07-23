#!/usr/bin/env node
"use strict";

// ── scripts/restore-drill.js (CTO2-12 + CTO3-03) ─────────────────────────────
// Praktische disaster-recovery-drill met gemeten RPO/RTO.
//
//  1. VOLLEDIGE database-restore (CTO3-03): herstel ALLE public-tabellen naar een
//     verse scratch-database (schema via de echte migraties) en vergelijk
//     rijtotalen + checksums per tabel. Voer functionele steekproeven uit op de
//     herstelde dataset. Valt terug op de platform_state-drill (CTO2-12) als de
//     volledige restore niet kan draaien.
//  2. OBJECTMANIFEST (CTO3-03): bouw een manifest (tenant, key, size, checksum)
//     van alle objecten en detecteer missing + orphan objects na roundtrip.
//  3. OBJECTOPSLAG-persistentie (CTO2-12): schrijf een sentinel via een vers
//     adapter-exemplaar (procesherstart-equivalent) en lees hem terug.
//
// Exit 1 zodra één deel faalt (release-/DR-gate). Geen pg_dump-binary nodig.
//
// Gebruik (productie): STORAGE_ADAPTER=postgres DATABASE_URL=... \
//   OBJECT_STORAGE_ADAPTER=s3 OBJECT_STORAGE_* ... node scripts/restore-drill.js
// Lokaal: DATABASE_URL=postgres://... node scripts/restore-drill.js [--json]

const path = require("path");
const ROOT = path.join(__dirname, "..");
const { config } = require(path.join(ROOT, "src/lib/config"));
const drill = require(path.join(ROOT, "src/modules/restore-drill"));
const { createObjectStorage } = require(path.join(ROOT, "src/infrastructure/object-storage-factory"));

async function main() {
  const jsonMode = process.argv.includes("--json");
  const report = {
    at: new Date().toISOString(),
    commitSha: config.commitSha || null,
    fullRestore: null, stateRestore: null, objectManifest: null, objectStorage: null,
    storageAdapter: config.objectStorage.adapter,
  };
  let failed = false;

  // ── 1. Volledige database-restore (CTO3-03) ──
  const dbUrl = config.database.url;
  if (/^postgres(ql)?:\/\//.test(dbUrl)) {
    const { Pool } = require("pg");
    const ssl = /localhost|127\.0\.0\.1/.test(dbUrl) ? undefined : { rejectUnauthorized: false };
    const pool = new Pool({ connectionString: dbUrl, ssl });
    try {
      report.fullRestore = await drill.pgFullRestoreDrill({ pool, connectionString: dbUrl });
      if (!report.fullRestore.ok) failed = true;
      // De platform_state-drill blijft draaien voor de RPO-meting + backward compat.
      report.stateRestore = await drill.pgRestoreDrill({ pool, connectionString: dbUrl });
      if (!report.stateRestore.ok) failed = true;
    } catch (e) { report.fullRestore = { ok: false, error: e.message }; failed = true; }
    finally { await pool.end(); }
  } else {
    report.fullRestore = { ok: false, error: "DATABASE_URL ontbreekt · DR-drill vereist PostgreSQL" };
    failed = true;
  }

  // ── 2. Objectmanifest (CTO3-03) + 3. objectopslag-persistentie (CTO2-12) ──
  try {
    const storage = createObjectStorage();
    report.objectManifest = await drill.objectManifestDrill({ storage });
    // Manifest is informatief zolang er nog geen objecten zijn; missing/orphan is hard.
    if (report.objectManifest.ok === false && (report.objectManifest.missing?.length || report.objectManifest.orphans?.length)) failed = true;
  } catch (e) { report.objectManifest = { ok: false, error: e.message }; failed = true; }

  try {
    report.objectStorage = await drill.objectStorageRestoreDrill({ makeStorage: () => createObjectStorage() });
    if (!report.objectStorage.ok) failed = true;
  } catch (e) { report.objectStorage = { ok: false, error: e.message }; failed = true; }

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const f = report.fullRestore, s = report.stateRestore, m = report.objectManifest, o = report.objectStorage;
    console.log("── Disaster-recovery-drill (CTO3-03) ───────────────────");
    if (f && f.ok) {
      console.log(`DB (volledig): HERSTELD · ${f.tableCount} tabellen, 0 mismatches · RTO ${f.rtoSeconds}s`);
      console.log(`               functioneel: ${f.functional.tenants} tenants, facturen=${f.functional.hasInvoices}, audit=${f.functional.hasAudit}`);
    } else {
      console.log(`DB (volledig): FOUT · ${f ? (f.error || `mismatches: ${JSON.stringify(f.mismatches)}`) : "niet gedraaid"}`);
    }
    if (s && s.ok) console.log(`DB (state)   : HERSTELD · revisie ${s.revision} · RPO ${s.rpoSeconds}s (snapshot ${s.snapshotAt}) · RTO ${s.rtoSeconds}s`);
    if (m) console.log(`Objectmanif. : ${m.ok ? "OK" : (m.error || "AANDACHT")} · ${m.objectCount ?? 0} objecten, missing ${m.missing?.length ?? "?"}, orphan ${m.orphans?.length ?? "?"}`);
    console.log(`Objectopslag : ${o && o.ok ? "HERSTELD" : "FOUT"} (${report.storageAdapter}) · ${o && o.ok ? `${o.bytes} bytes round-trip, RTO ${o.rtoSeconds}s` : (o && o.error)}`);
    console.log(failed ? "RESULTAAT: FAAL · herstel niet volledig bewezen." : "RESULTAAT: OK · database + bestanden aantoonbaar herstelbaar.");
  }
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
