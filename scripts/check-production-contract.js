#!/usr/bin/env node
"use strict";

// ── scripts/check-production-contract.js (CTO3-05) ───────────────────────────
// Preflight voor het niet-geheime production config-contract. Twee modi:
//
//   node scripts/check-production-contract.js            (coverage · CI-veilig)
//     Valideert dat het contract laadt EN dat render.yaml elke verplichte flag/
//     env-key declareert (waarde of sync:false). Geen secrets nodig. Draait op
//     elke PR zodat geen kritieke flag een ongedocumenteerde dashboardinstelling
//     wordt.
//
//   node scripts/check-production-contract.js --runtime  (drift · vóór deploy)
//     Vergelijkt daarbovenop de EFFECTIEVE runtime (uit src/lib/config) met de
//     gewenste toestand en faalt fail-closed bij afwijking, een verboden bron
//     (bv. OBJECT_STORAGE_ADAPTER=local), een ontbrekende verplichte env-key,
//     een ontbrekende CA bij verify-full, of FORMS_SOURCE=pg zonder groene
//     reconcile. Draait ook vóór de productie-deploy.
//
// Exit 1 bij elke afwijking (release-/deploygate). De uitvoer bevat NOOIT
// secret-waarden · alleen key-namen en een veilige runtime-samenvatting.

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "src/lib/production-contract"));

function formsReconcileReady() {
  // Aantoonbaar groene Forms-reconcile: het executing evidence-artefact met
  // status "pass"/ready. Zonder bewijs is de poortwachter dicht (fail-closed).
  const p = path.join(ROOT, "docs", "traceability", "evidence", "forms-reconcile.json");
  try {
    const ev = JSON.parse(fs.readFileSync(p, "utf8"));
    return ev && (ev.ready === true || ev.status === "pass");
  } catch (_) { return false; }
}

function main() {
  const runtime = process.argv.includes("--runtime");
  const jsonMode = process.argv.includes("--json");
  const contract = C.loadContract();
  const report = { at: new Date().toISOString(), environment: contract.environment, mode: runtime ? "runtime" : "coverage" };
  let failed = false;

  // ── Coverage: render.yaml declareert elke flag/env-key ──
  const renderYaml = fs.readFileSync(path.join(ROOT, "render.yaml"), "utf8");
  const cov = C.evaluateBlueprintCoverage(contract, renderYaml);
  report.coverage = cov;
  if (!cov.ok) failed = true;

  // ── Runtime-drift (alleen met --runtime) ──
  if (runtime) {
    const { config } = require(path.join(ROOT, "src/lib/config"));
    const actual = C.actualFromConfig(config);
    const evalResult = C.evaluateRuntime(contract, actual, {
      env: process.env,
      formsReconcileReady: formsReconcileReady(),
      now: report.at,
    });
    report.runtime = evalResult;
    if (!evalResult.ok) failed = true;
  }

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`── Production config-contract (CTO3-05) · ${report.mode} ─────────`);
    console.log(`Blueprint-dekking: ${cov.ok ? "OK" : "GATEN"}${cov.ok ? "" : " · ontbreekt in render.yaml: " + cov.missing.join(", ")}`);
    if (runtime) {
      const r = report.runtime;
      const S = r.summary;
      console.log(`Runtime           : ${r.ok ? "OK" : "AFWIJKING"}`);
      console.log(`  source_of_truth : ${JSON.stringify(S.sourceOfTruth)}`);
      console.log(`  adapters/modi   : storage=${S.storageAdapter} object=${S.objectStorageAdapter} ssl=${S.databaseSslMode} ca=${S.databaseCaCertPresent} single_writer=${S.singleWriter} forms=${S.formsSource}`);
      if (r.drift.length) console.log(`  drift           : ${r.drift.map(d => `${d.key}=${d.actual} (gewenst ${JSON.stringify(d.desired)})`).join("; ")}`);
      if (r.forbidden.length) console.log(`  verboden        : ${r.forbidden.map(f => `${f.key}=${f.value} · ${f.reason}`).join("; ")}`);
      if (r.missingEnv.length) console.log(`  ontbrekende env : ${r.missingEnv.join(", ")}`);
      if (r.formsGuard.length) console.log(`  forms-guard     : ${r.formsGuard.join("; ")}`);
      if (r.exceptionsApplied.length) console.log(`  uitzonderingen  : ${r.exceptionsApplied.join(", ")}`);
    }
    console.log(failed ? "RESULTAAT: FAAL · contract niet gedekt of runtime wijkt af." : "RESULTAAT: OK · configuratie reproduceerbaar en conform het contract.");
  }
  process.exit(failed ? 1 : 0);
}

main();
