"use strict";
// CTO-02 (local storage verboden in productie) + CTO-13 (TLS verify-full).
// Config draait op require-time, dus we toetsen via een kind-proces met env.
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PROD_BASE = {
  APP_ENV: "production",
  APP_URL: "https://app.example.com",
  STORAGE_ADAPTER: "postgres",
  DATABASE_URL: "postgresql://user:pw@db.example.com:5432/app",
  JWT_SECRET: "x".repeat(48),
  ENCRYPTION_KEY: "y".repeat(48),
};

function loadConfig(env, expr = "1") {
  return spawnSync(process.execPath, ["-e", `const c=require('./src/lib/config');console.log(JSON.stringify(${expr}))`], {
    cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8",
  });
}

test("CTO-02 · productie-boot faalt HARD op OBJECT_STORAGE_ADAPTER=local", () => {
  const r = loadConfig({ ...PROD_BASE, OBJECT_STORAGE_ADAPTER: "local" });
  assert.notEqual(r.status, 0, "boot moet falen");
  assert.match(r.stderr, /OBJECT_STORAGE_ADAPTER/, "foutmelding benoemt de oorzaak");
  // Met managed storage boot de config wel.
  const ok = loadConfig({ ...PROD_BASE, OBJECT_STORAGE_ADAPTER: "azure-blob" });
  assert.equal(ok.status, 0, `managed storage boot: ${ok.stderr}`);
});

test("CTO-13 · productie default = verify-full met certificaatvalidatie", () => {
  const r = loadConfig(
    { ...PROD_BASE, OBJECT_STORAGE_ADAPTER: "s3", DATABASE_SSL: "true" },
    "{mode:c.config.database.sslMode, opts:c.databaseSslOptions()}"
  );
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(d.mode, "verify-full");
  assert.equal(d.opts.rejectUnauthorized, true, "certificaatketen wordt gevalideerd");
});

test("CTO-13 · dev default = require (versleuteld, zonder validatie) en expliciet overschrijfbaar", () => {
  const dev = loadConfig({ APP_ENV: "dev", DATABASE_SSL: "true", DATABASE_URL: "postgresql://u:p@db.remote:5432/x" },
    "{mode:c.config.database.sslMode, opts:c.databaseSslOptions()}");
  const d = JSON.parse(dev.stdout.trim().split("\n").pop());
  assert.equal(d.mode, "require");
  assert.equal(d.opts.rejectUnauthorized, false);
  // Expliciete keuze wint van de omgevings-default.
  const strict = loadConfig({ APP_ENV: "dev", DATABASE_SSL: "true", DATABASE_SSL_MODE: "verify-full", DATABASE_CA_CERT: "PEMPEM" },
    "{opts:c.databaseSslOptions()}");
  const s = JSON.parse(strict.stdout.trim().split("\n").pop());
  assert.equal(s.opts.rejectUnauthorized, true);
  assert.equal(s.opts.ca, "PEMPEM", "eigen CA-bundle meegenomen");
});

test("CTO-03 · single-writer default AAN in productie/staging, UIT in dev, expliciet overschrijfbaar", () => {
  const prod = loadConfig({ ...PROD_BASE, OBJECT_STORAGE_ADAPTER: "s3" }, "c.config.singleWriter");
  assert.equal(JSON.parse(prod.stdout.trim().split("\n").pop()), true);
  const dev = loadConfig({ APP_ENV: "dev" }, "c.config.singleWriter");
  assert.equal(JSON.parse(dev.stdout.trim().split("\n").pop()), false);
  const off = loadConfig({ ...PROD_BASE, OBJECT_STORAGE_ADAPTER: "s3", SINGLE_WRITER: "false" }, "c.config.singleWriter");
  assert.equal(JSON.parse(off.stdout.trim().split("\n").pop()), false);
});
