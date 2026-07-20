"use strict";
// Productie-cutover naar de pg-adapter (deploy-fix 2026-07-20):
// 1) TLS-autodetectie: managed databases weigeren onversleutelde verbindingen;
//    zonder detectie crasht een productie-boot terwijl dev gewoon werkt.
// 2) Eenmalige data-overname: een LEGE platform_state neemt eerst de dataset
//    van de vorige opslag over · nooit een verse seed naast echte klantdata.
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("child_process");
const path = require("path");

const { PostgresDataAdapter } = require("../src/infrastructure/postgres/pg-data-adapter");

function sslFor(env) {
  // config.js leest process.env bij require · dus per geval een subprocess.
  const out = execFileSync(process.execPath, ["-e", "console.log(JSON.stringify(require('./src/lib/config').config.database.ssl))"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, APP_ENV: "development", NODE_ENV: "development", DATABASE_SSL: "", DATABASE_URL: "", ...env },
    encoding: "utf8",
  });
  return JSON.parse(out.trim());
}

test("TLS-autodetectie: lokaal uit, managed host aan, sslmode en expliciete keuze winnen", () => {
  assert.strictEqual(sslFor({ DATABASE_URL: "postgresql://u:p@localhost:5432/db" }), false, "localhost → geen TLS");
  assert.strictEqual(sslFor({ DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db" }), false);
  assert.strictEqual(sslFor({ DATABASE_URL: "postgresql://u:p@db:5432/monargo" }), false, "compose-service 'db' → geen TLS");
  assert.strictEqual(sslFor({ DATABASE_URL: "postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" }), true, "managed host → TLS aan");
  assert.strictEqual(sslFor({ DATABASE_URL: "postgresql://u:p@localhost:5432/db?sslmode=require" }), true, "sslmode=require wint van localhost");
  assert.strictEqual(sslFor({ DATABASE_URL: "postgresql://u:p@managed.example.com:5432/db", DATABASE_SSL: "false" }), false, "expliciet uit wint altijd");
  assert.strictEqual(sslFor({ DATABASE_URL: "postgresql://u:p@localhost:5432/db", DATABASE_SSL: "true" }), true, "expliciet aan wint altijd");
  assert.strictEqual(sslFor({}), false, "zonder DATABASE_URL geen TLS-vlag");
});

// Fake pool: leeg platform_state, registreert wat er ingevoegd wordt.
function fakePool() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (/SELECT data, revision/.test(sql)) return { rows: [] };          // lege database
      if (/INSERT INTO/.test(sql)) return { rows: [{ revision: 1 }] };
      return { rows: [] };
    },
  };
}

test("lege database + legacy-import → bestaande dataset wordt overgenomen, niet de seed", async () => {
  const legacyData = { tenants: [{ id: "t1", name: "Echte Klant BV" }], users: [{ id: "u1" }] };
  const pool = fakePool();
  const adapter = new PostgresDataAdapter({ pool, initialImport: async () => legacyData });
  const data = await adapter.loadAsync(() => ({ tenants: [], seeded: true }));
  assert.strictEqual(data.tenants[0].name, "Echte Klant BV", "legacy-dataset is de beginstaat");
  const insert = pool.calls.find(c => /INSERT INTO/.test(c.sql));
  assert.strictEqual(insert.params[1].tenants[0].id, "t1", "en wordt zo weggeschreven");
});

test("lege database + legacy zonder data (of falend) → verse seed als terugval", async () => {
  const leeg = new PostgresDataAdapter({ pool: fakePool(), initialImport: async () => null });
  assert.strictEqual((await leeg.loadAsync(() => ({ tenants: [], seeded: true }))).seeded, true, "null-import → seed");

  const zonderTenants = new PostgresDataAdapter({ pool: fakePool(), initialImport: async () => ({ tenants: [] }) });
  assert.strictEqual((await zonderTenants.loadAsync(() => ({ tenants: [], seeded: true }))).seeded, true, "lege import → seed");

  const falend = new PostgresDataAdapter({ pool: fakePool(), initialImport: async () => { throw new Error("bridge onbereikbaar"); } });
  assert.strictEqual((await falend.loadAsync(() => ({ tenants: [], seeded: true }))).seeded, true, "falende import blokkeert de boot niet");
});

test("gevulde database negeert de legacy-import volledig (eenmalig karakter)", async () => {
  let importCalls = 0;
  const pool = {
    async query(sql) {
      if (/SELECT data, revision/.test(sql)) return { rows: [{ data: { tenants: [{ id: "bestaand" }] }, revision: 7 }] };
      return { rows: [] };
    },
  };
  const adapter = new PostgresDataAdapter({ pool, initialImport: async () => { importCalls++; return { tenants: [{ id: "x" }] }; } });
  const data = await adapter.loadAsync(() => ({ tenants: [] }));
  assert.strictEqual(data.tenants[0].id, "bestaand", "platform_state blijft de enige waarheid");
  assert.strictEqual(importCalls, 0, "import wordt niet eens aangeroepen");
  assert.strictEqual(adapter.revision, 7);
});
