"use strict";
// Vendor-boundary-handhaving (infra-handover h3.4, E0 · ADR-001).
// Deze tests falen wanneer verboden imports of cloudvariabelen buiten de
// toegestane mappen opduiken · CI is de poort, niet de code review.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) {
      if (["node_modules", ".git"].includes(f.name)) continue;
      walk(p, out);
    } else if (f.name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

const rel = p => path.relative(ROOT, p).replace(/\\/g, "/");
const srcFiles = walk(path.join(ROOT, "src"));

// Legacy-adapters waar Supabase-verwijzingen (tijdelijk) zijn toegestaan (ADR-001 §4).
const SUPABASE_ALLOWED = new Set([
  "src/lib/data-adapters.js",
  "src/lib/supabase-rest-bridge.js",
  "src/lib/config.js",            // leest SUPABASE_URL voor de legacy-adapter
  "src/modules/live-services.js", // readiness-check op de legacy-configuratie
  "src/modules/production.js",    // go-live-checklist van de huidige (legacy) stack
]);

test("architectuur: geen cloud-SDK-imports (Azure/AWS/GCP/Supabase-SDK)", () => {
  const offenders = [];
  for (const f of srcFiles) {
    const s = fs.readFileSync(f, "utf8");
    if (/require\(["'](@azure\/|aws-sdk|@aws-sdk\/|@google-cloud\/|@supabase\/)/.test(s)) offenders.push(rel(f));
  }
  assert.deepEqual(offenders, [], `Vendor-SDK buiten infrastructure/: ${offenders.join(", ")}`);
});

test("architectuur: Supabase-verwijzingen alleen in de legacy-adapters", () => {
  const offenders = [];
  for (const f of srcFiles) {
    if (SUPABASE_ALLOWED.has(rel(f))) continue;
    const s = fs.readFileSync(f, "utf8");
    if (/supabase/i.test(s)) offenders.push(rel(f));
  }
  assert.deepEqual(offenders, [], `Supabase buiten legacy-adapters: ${offenders.join(", ")}`);
});

test("architectuur: src/platform is cloudblind (geen process.env, geen vendor, geen SQL)", () => {
  const platformFiles = srcFiles.filter(f => rel(f).startsWith("src/platform/"));
  assert.ok(platformFiles.length >= 3, "platform-laag bestaat");
  const offenders = [];
  for (const f of platformFiles) {
    const s = fs.readFileSync(f, "utf8");
    if (/process\.env/.test(s)) offenders.push(`${rel(f)} (process.env)`);
    if (/require\(["'](https?|node-fetch|axios)/.test(s)) offenders.push(`${rel(f)} (netwerk)`);
    if (/\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET)\b/.test(s)) offenders.push(`${rel(f)} (SQL)`);
    if (/require\(["']\.\.\/lib\/config/.test(s)) offenders.push(`${rel(f)} (config-import)`);
  }
  assert.deepEqual(offenders, [], offenders.join(", "));
});

test("architectuur: toekomstige domeinlagen zijn cloudblind zodra ze bestaan", () => {
  // h3.2: domain/application/ports mogen geen env, SDK's of HTTP kennen.
  for (const layer of ["domain", "application", "ports"]) {
    const dir = path.join(ROOT, "src", layer);
    if (!fs.existsSync(dir)) continue;
    const offenders = [];
    for (const f of walk(dir)) {
      const s = fs.readFileSync(f, "utf8");
      if (/process\.env/.test(s)) offenders.push(`${rel(f)} (process.env)`);
      if (/require\(["'](@azure\/|aws-sdk|@aws-sdk\/|@google-cloud\/|@supabase\/|https?)/.test(s)) offenders.push(`${rel(f)} (vendor/netwerk)`);
    }
    assert.deepEqual(offenders, [], offenders.join(", "));
  }
});

test("architectuur: RENDER_GIT_COMMIT alleen in de configuratielaag (S1-05)", () => {
  const offenders = [];
  for (const f of srcFiles) {
    if (rel(f) === "src/lib/config.js") continue;
    if (/RENDER_GIT_COMMIT/.test(fs.readFileSync(f, "utf8"))) offenders.push(rel(f));
  }
  assert.deepEqual(offenders, [], `Render-koppeling buiten config: ${offenders.join(", ")}`);
});

test("architectuur: generieke APP_COMMIT_SHA heeft voorrang op RENDER_GIT_COMMIT", () => {
  const cfg = fs.readFileSync(path.join(ROOT, "src/lib/config.js"), "utf8");
  const idxGeneric = cfg.indexOf("APP_COMMIT_SHA");
  const idxRender = cfg.indexOf("RENDER_GIT_COMMIT");
  assert.ok(idxGeneric > -1, "APP_COMMIT_SHA bestaat in config");
  assert.ok(idxRender === -1 || idxGeneric < idxRender, "generieke variabele komt eerst");
});
