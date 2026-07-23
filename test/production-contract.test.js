"use strict";
// CTO3-05 · production config-contract. De EVALUATIE (src/lib/production-contract)
// is puur en dus met synthetische runtime-waarden te toetsen · geen echte
// productie-secrets nodig. De 5 verplichte scenario's uit de handover staan
// hieronder, plus blueprint-dekking en een groene basislijn.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const C = require("../src/lib/production-contract");

const ROOT = path.join(__dirname, "..");
const contract = C.loadContract();

// Een volledig CONFORM productie-runtime + de aanwezige verplichte env-keys.
function baseActual(over = {}) {
  return {
    RELEASE_CHANNEL: "production", STORAGE_ADAPTER: "postgres", OBJECT_STORAGE_ADAPTER: "s3",
    DATABASE_SSL_MODE: "verify-full", DATABASE_CA_CERT_PRESENT: true, SINGLE_WRITER: true,
    CRM_READ_SOURCE: "pg", IDENTITY_READ_SOURCE: "pg", FINANCE_READ_SOURCE: "pg",
    COMPANY_READ_SOURCE: "pg", FORMS_SOURCE: "legacy", ...over,
  };
}
function baseEnv(over = {}) {
  const e = {
    APP_URL: "https://app", DATABASE_URL: "postgres://x", JWT_SECRET: "x".repeat(40),
    ENCRYPTION_KEY: "y".repeat(40), OBJECT_STORAGE_ENDPOINT: "https://s3", OBJECT_STORAGE_BUCKET: "b",
    OBJECT_STORAGE_ACCESS_KEY_ID: "k", OBJECT_STORAGE_SECRET_ACCESS_KEY: "s", DATABASE_CA_CERT: "-----CA-----",
  };
  for (const [k, v] of Object.entries(over)) { if (v === undefined) delete e[k]; else e[k] = v; }
  return e;
}
const evalRt = (actual, env, opts = {}) => C.evaluateRuntime(contract, actual, { env, formsReconcileReady: true, now: "2026-07-24T00:00:00Z", ...opts });

test("basislijn: een volledig conforme productie-runtime is groen", () => {
  const r = evalRt(baseActual(), baseEnv());
  assert.equal(r.ok, true, JSON.stringify({ drift: r.drift, missingEnv: r.missingEnv, forbidden: r.forbidden, formsGuard: r.formsGuard }));
  assert.deepEqual(r.summary.sourceOfTruth, { CRM_READ_SOURCE: "pg", IDENTITY_READ_SOURCE: "pg", FINANCE_READ_SOURCE: "pg", COMPANY_READ_SOURCE: "pg", FORMS_SOURCE: "legacy" });
});

test("1· ontbrekende DATABASE_CA_CERT bij verify-full → preflight rood", () => {
  const r = evalRt(baseActual({ DATABASE_CA_CERT_PRESENT: false }), baseEnv({ DATABASE_CA_CERT: undefined }));
  assert.equal(r.ok, false);
  assert.ok(r.missingEnv.includes("DATABASE_CA_CERT"), JSON.stringify(r.missingEnv));
});

test("2· OBJECT_STORAGE_ADAPTER=local in productie → preflight rood (verboden bron)", () => {
  const r = evalRt(baseActual({ OBJECT_STORAGE_ADAPTER: "local" }), baseEnv());
  assert.equal(r.ok, false);
  assert.ok(r.forbidden.some(f => f.key === "OBJECT_STORAGE_ADAPTER" && f.value === "local"), JSON.stringify(r.forbidden));
});

test("3· FORMS_SOURCE=pg zonder groene reconcile → poortwachter weigert", () => {
  const rood = evalRt(baseActual({ FORMS_SOURCE: "pg" }), baseEnv(), { formsReconcileReady: false });
  assert.equal(rood.ok, false);
  assert.ok(rood.formsGuard.length >= 1, JSON.stringify(rood.formsGuard));
  // Mét groene reconcile mag pg wél.
  const groen = evalRt(baseActual({ FORMS_SOURCE: "pg" }), baseEnv(), { formsReconcileReady: true });
  assert.equal(groen.ok, true, JSON.stringify(groen));
});

test("4· runtimeflag wijkt af van het contract → releasegate rood", () => {
  const r = evalRt(baseActual({ RELEASE_CHANNEL: "pilot", SINGLE_WRITER: false }), baseEnv());
  assert.equal(r.ok, false);
  assert.ok(r.drift.some(d => d.key === "RELEASE_CHANNEL"), "release-kanaal drift gemeld");
  assert.ok(r.drift.some(d => d.key === "SINGLE_WRITER"), "single-writer drift gemeld");
});

test("5· rollback naar een vorige read-source: toegestane flip is groen, ongeldige bron wordt gerapporteerd", () => {
  // Rollback pg → shadow (een geldige vorige stand): geen drift, en de veilige
  // samenvatting rapporteert de nieuwe bron per domein (data blijft, flag flipt).
  const back = evalRt(baseActual({ FINANCE_READ_SOURCE: "shadow" }), baseEnv());
  assert.equal(back.ok, true, JSON.stringify(back.drift));
  assert.equal(back.summary.sourceOfTruth.FINANCE_READ_SOURCE, "shadow");
  // Een ongeldige bron wordt WEL als afwijking gerapporteerd (geen stille flip).
  const bogus = evalRt(baseActual({ FINANCE_READ_SOURCE: "bogus" }), baseEnv());
  assert.equal(bogus.ok, false);
  assert.ok(bogus.drift.some(d => d.key === "FINANCE_READ_SOURCE"), JSON.stringify(bogus.drift));
});

test("blueprint-dekking: render.yaml declareert elke verplichte flag en env-key", () => {
  const yaml = fs.readFileSync(path.join(ROOT, "render.yaml"), "utf8");
  const cov = C.evaluateBlueprintCoverage(contract, yaml);
  assert.equal(cov.ok, true, `ontbreekt in render.yaml: ${cov.missing.join(", ")}`);
});

test("blueprint-dekking faalt als een verplichte key niet in de blueprint staat", () => {
  const synthetic = { ...contract, requiredEnvKeys: [...contract.requiredEnvKeys, "NIEUWE_VERPLICHTE_KEY"] };
  const cov = C.evaluateBlueprintCoverage(synthetic, "services:\n  - key: JWT_SECRET\n");
  assert.equal(cov.ok, false);
  assert.ok(cov.missing.includes("NIEUWE_VERPLICHTE_KEY"));
});

test("geen secret-WAARDEN in het contractbestand (alleen key-namen)", () => {
  const raw = fs.readFileSync(C.CONTRACT_PATH, "utf8");
  // Herkenbare secret-WAARDE-patronen mogen nergens voorkomen (key-NAMEN zoals
  // SUPABASE_SERVICE_ROLE_KEY zijn toegestaan · dat zijn namen, geen waarden).
  assert.ok(!/sk_live_|whsec_|-----BEGIN|postgres(ql)?:\/\/|xoxb-/i.test(raw), "contract bevat een secret-achtige waarde");
});

test("CLI coverage-modus draait CI-veilig (geen secrets) en is groen", () => {
  // Exit 0 = render.yaml dekt het echte contract. execFileSync gooit bij exit≠0.
  const out = execFileSync(process.execPath, [path.join(ROOT, "scripts/check-production-contract.js")], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /RESULTAAT: OK/);
});
