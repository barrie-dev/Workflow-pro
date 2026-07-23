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

test("CTO-13 · DATABASE_CA_CERT verdraagt een geplat PEM (letterlijke \\n) en witruimte", () => {
  // Aanleiding: de productie-boot faalde op "self-signed certificate in
  // certificate chain" omdat verify-full geldt maar er geen bruikbare CA was.
  // Dashboards en shells platten een meerregelige waarde vaak tot \n-reeksen;
  // dan is het PEM onleesbaar en faalt de boot met exact dezelfde melding.
  const ECHT = "-----BEGIN CERTIFICATE-----\nMIIDxDCCAqyg\nAAAA\n-----END CERTIFICATE-----";
  const GEPLAT = ECHT.replace(/\n/g, "\\n");
  const lees = ca => {
    const r = loadConfig(
      { APP_ENV: "dev", DATABASE_SSL: "true", DATABASE_SSL_MODE: "verify-full", DATABASE_CA_CERT: ca },
      "{ca:c.config.database.caCert, opts:c.databaseSslOptions()}"
    );
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim().split("\n").pop());
  };

  const echt = lees(ECHT);
  const geplat = lees(GEPLAT);
  const rommelig = lees(`  ${GEPLAT}  \n`);

  assert.equal(geplat.ca, echt.ca, "een geplat PEM levert exact hetzelfde certificaat op");
  assert.equal(rommelig.ca, echt.ca, "omringende witruimte wordt weggehaald");
  for (const v of [echt, geplat, rommelig]) {
    assert.ok(v.ca.startsWith("-----BEGIN CERTIFICATE-----"), "PEM begint met de BEGIN-regel");
    assert.ok(v.ca.endsWith("-----END CERTIFICATE-----"), "PEM eindigt met de END-regel");
    assert.equal(v.ca.split("\n").length, 4, "de regelstructuur is hersteld");
    assert.equal(v.opts.ca, v.ca, "de CA gaat mee naar de TLS-opties");
    assert.equal(v.opts.rejectUnauthorized, true, "verify-full blijft valideren");
  }

  // Zonder CA blijft verify-full staan maar is er niets om mee te valideren:
  // precies de situatie die de productie-deploy liet falen.
  const zonder = loadConfig(
    { APP_ENV: "dev", DATABASE_SSL: "true", DATABASE_SSL_MODE: "verify-full" },
    "{ca:c.config.database.caCert, opts:c.databaseSslOptions()}"
  );
  const z = JSON.parse(zonder.stdout.trim().split("\n").pop());
  assert.equal(z.ca, "");
  assert.equal(z.opts.ca, undefined);
  assert.equal(z.opts.rejectUnauthorized, true);
});

test("CTO-03 · single-writer default AAN in productie/staging, UIT in dev, expliciet overschrijfbaar", () => {
  const prod = loadConfig({ ...PROD_BASE, OBJECT_STORAGE_ADAPTER: "s3" }, "c.config.singleWriter");
  assert.equal(JSON.parse(prod.stdout.trim().split("\n").pop()), true);
  const dev = loadConfig({ APP_ENV: "dev" }, "c.config.singleWriter");
  assert.equal(JSON.parse(dev.stdout.trim().split("\n").pop()), false);
  const off = loadConfig({ ...PROD_BASE, OBJECT_STORAGE_ADAPTER: "s3", SINGLE_WRITER: "false" }, "c.config.singleWriter");
  assert.equal(JSON.parse(off.stdout.trim().split("\n").pop()), false);
});
