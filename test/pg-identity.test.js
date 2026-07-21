"use strict";
// Identity genormaliseerd (CTO P0-01 · tweede domein langs de CRM-route).
//
// De kern-invariant: legacy-object → projectie en pg-rij → projectie moeten
// IDENTIEK uitkomen (verliesvrije heen-en-terugvertaling). Daarnaast: de sync
// is een idempotente set-sync met fingerprint-poort, de bronschakelaar kent
// dezelfde drie standen als CRM, en het live-blok bewijst alles tegen echte
// PostgreSQL (draait in CI).
const { test } = require("node:test");
const assert = require("node:assert");

const {
  projectUser, projectRow, rowToUser, userFingerprint,
  projectTenant, syncIdentity, findUserByEmail, listUsers, reconcileIdentity,
  stableStringify,
} = require("../src/infrastructure/postgres/pg-identity-repository");
const { makeIdentitySource } = require("../src/infrastructure/identity-source");

function fullUser(overrides = {}) {
  return {
    id: "usr_1", tenantId: "t1", email: "jan@bedrijf.be", name: "Jan Peeters",
    role: "tenant_admin", active: true, passwordHash: "scrypt$abc",
    lastLoginAt: "2026-07-20T09:30:00.000Z", mfaEnabled: false,
    mfaEnforced: false, mfaSecret: null, recoveryCodes: [{ hash: "h1", usedAt: null }],
    failedLoginCount: 0, lockedUntil: null,
    permissions: ["planning.read"], phone: "+32470000000", protected: true,
    updatedAt: "2026-07-19T08:00:00.000Z",
    ...overrides,
  };
}

/** Simuleer wat de database van een projectie zou teruggeven. */
function projectionToRow(p) {
  return {
    id: p.id, tenant_id: p.tenantId, email: p.email, name: p.name, role: p.role,
    active: p.active, password_hash: p.passwordHash,
    last_login_at: p.lastLoginAt ? new Date(p.lastLoginAt) : null,
    mfa_enabled: p.mfaEnabled, security: p.security, attributes: p.attributes,
  };
}

test("identity: projectie is verliesvrij · legacy → rij → projectie is identiek", () => {
  const user = fullUser();
  const p = projectUser(user);
  // Kernvelden als kolommen, internals in security, rest verbatim in attributes.
  assert.equal(p.security.mfaEnforced, false);
  assert.deepEqual(p.security.recoveryCodes, [{ hash: "h1", usedAt: null }]);
  assert.deepEqual(p.attributes.permissions, ["planning.read"]);
  assert.equal(p.attributes.passwordHash, undefined, "hash nooit dubbel in attributes");

  const roundTrip = projectRow(projectionToRow(p));
  assert.equal(stableStringify(roundTrip), stableStringify(p), "rij → projectie geeft exact dezelfde vorm");

  const reconstructed = rowToUser(projectionToRow(p));
  assert.equal(stableStringify(projectUser(reconstructed)), stableStringify(p), "gereconstrueerd object projecteert identiek");
  assert.equal(reconstructed.passwordHash, "scrypt$abc");
  assert.deepEqual(reconstructed.permissions, ["planning.read"]);
});

test("identity: null-versus-afwezig en tijdformaten geven GEEN valse afwijking", () => {
  const zonder = fullUser(); delete zonder.lastLoginAt; delete zonder.mfaEnabled;
  const met = fullUser({ lastLoginAt: null, mfaEnabled: false });
  assert.equal(userFingerprint(zonder), userFingerprint(met), "ontbrekend veld == expliciete null/default");

  const isoMet = fullUser({ lastLoginAt: "2026-07-20T09:30:00.000Z" });
  const isoAnders = fullUser({ lastLoginAt: "2026-07-20T11:30:00+02:00" });
  assert.equal(userFingerprint(isoMet), userFingerprint(isoAnders), "zelfde moment, ander formaat == gelijk");
});

test("identity: elke inhoudelijke wijziging verandert de vingerafdruk", () => {
  const basis = userFingerprint(fullUser());
  assert.notEqual(userFingerprint(fullUser({ passwordHash: "scrypt$nieuw" })), basis);
  assert.notEqual(userFingerprint(fullUser({ active: false })), basis);
  assert.notEqual(userFingerprint(fullUser({ recoveryCodes: [] })), basis);
  assert.notEqual(userFingerprint(fullUser({ permissions: [] })), basis);
});

test("identity: tenant-projectie splitst kernvelden en bewaart de rest verbatim", () => {
  const p = projectTenant({ id: "t1", name: "Demo", plan: "business", status: "active",
    billingEmail: "facturen@demo.be", moduleOverrides: { crm: true }, intake: { sector: "bouw" } });
  assert.equal(p.billingEmail, "facturen@demo.be");
  assert.deepEqual(p.attributes.moduleOverrides, { crm: true });
  assert.equal(p.attributes.billingEmail, undefined);
});

/** Fake pool met client-transactie · registreert queries, geeft rijen terug. */
function fakePool(handlers = {}) {
  const queries = [];
  const runQuery = async (sql, params) => {
    const flat = String(sql).replace(/\s+/g, " ").trim();
    queries.push({ sql: flat, params });
    if (/^INSERT INTO tenants/.test(flat)) return { rows: [{ id: params[0] }] };
    if (/^INSERT INTO users/.test(flat)) return { rows: [{ id: params[0] }] };
    if (/^DELETE FROM users/.test(flat)) return { rows: handlers.deleted ? handlers.deleted() : [] };
    if (/^SELECT/.test(flat)) return { rows: handlers.select ? handlers.select(flat, params) : [] };
    return { rows: [] };
  };
  return { queries, query: runQuery, async connect() { return { query: runQuery, release() {} }; } };
}

test("identity-sync: tenants eerst (FK-anker), dan users, dan set-sync-delete · in één transactie", async () => {
  const pool = fakePool();
  const result = await syncIdentity(pool, {
    tenants: [{ id: "t1", name: "Demo" }],
    users: [fullUser(), fullUser({ id: "usr_admin", tenantId: null, email: "root@monargo.one", role: "super_admin" })],
  });
  assert.equal(result.tenantsUpserted, 1);
  assert.equal(result.usersUpserted, 2);

  const kinds = pool.queries.map(q => q.sql.split(" ")[0] + (q.sql.includes("tenants") ? ":t" : q.sql.includes("users") ? ":u" : ""));
  assert.equal(kinds[0], "BEGIN");
  assert.equal(kinds[kinds.length - 1], "COMMIT");
  assert.ok(kinds.indexOf("INSERT:t") < kinds.indexOf("INSERT:u"), "tenant vóór gebruiker (FK)");
  const del = pool.queries.find(q => q.sql.startsWith("DELETE FROM users"));
  assert.match(del.sql, /NOT \(id = ANY/, "verwijdert alleen wat uit de bron verdween");
  assert.deepEqual(del.params[0], ["usr_1", "usr_admin"]);
  // Fingerprint-poort aanwezig: ongewijzigde rijen leveren geen UPDATE op.
  assert.ok(pool.queries.some(q => /IS DISTINCT FROM excluded.fingerprint/.test(q.sql)));
});

test("identity-sync: onvolledige gebruiker wordt overgeslagen, niet gecrasht · reconcile meldt hem", async () => {
  const pool = fakePool();
  const result = await syncIdentity(pool, { tenants: [], users: [{ id: "usr_x" }, fullUser()] });
  assert.equal(result.usersUpserted, 1, "alleen de volledige rij");
  const rec = await reconcileIdentity(fakePool({ select: () => [] }), { users: [{ id: "usr_x" }] });
  assert.deepEqual(rec.missingInPg, ["usr_x"], "de overgeslagen rij valt op in de reconciliatie");
});

test("identity-source: standenvalidatie is hard (ADR-004)", () => {
  const store = { data: { users: [], tenants: [] } };
  assert.throws(() => makeIdentitySource({ mode: "vreemd", store }), e => e.code === "UNKNOWN_IDENTITY_SOURCE");
  assert.throws(() => makeIdentitySource({ mode: "shadow", store, pool: null }), e => e.code === "IDENTITY_SOURCE_NEEDS_PG");
  assert.throws(() => makeIdentitySource({ mode: "pg", store, pool: null }), e => e.code === "IDENTITY_SOURCE_NEEDS_PG");
  const legacy = makeIdentitySource({ mode: "legacy", store });
  assert.equal(legacy.mode, "legacy");
});

test("identity-source: legacy-stand leest de store en raakt pg niet aan", async () => {
  const store = { data: { tenants: [], users: [
    { id: "u1", email: "a@b.c", role: "super_admin", name: "Root" },
    { id: "u2", email: "d@e.f", role: "employee", name: "Werk Nemer" },
  ] } };
  const source = makeIdentitySource({ mode: "legacy", store });
  const users = await source.listPlatformUsers();
  assert.deepEqual(users.map(u => u.id), ["u1"], "alleen platform-accounts");
  assert.deepEqual(await source.syncNow(), { skipped: true, reason: "geen pg" });
});

test("identity-source: pg-stand leest uit de tabellen mét read-your-writes (sync vóór de lezing)", async () => {
  const superUser = fullUser({ id: "usr_admin", tenantId: null, email: "root@monargo.one", role: "super_admin" });
  const store = { data: { tenants: [], users: [superUser] } };
  const pool = fakePool({
    select: (sql) => /role = \$1/.test(sql) || /WHERE/.test(sql)
      ? [projectionToRow(projectUser(superUser))] : [],
  });
  const source = makeIdentitySource({ mode: "pg", store, pool });
  const users = await source.listPlatformUsers();
  assert.equal(users.length, 1);
  assert.equal(users[0].email, "root@monargo.one");
  const kinds = pool.queries.map(q => q.sql.split(" ")[0]);
  assert.ok(kinds.includes("BEGIN"), "sync draaide vóór de lezing (read-your-writes)");
  assert.ok(kinds.indexOf("SELECT") > kinds.indexOf("COMMIT"), "lezing ná de sync");
});

test("identity-source: snapshot-poort · tweede sync met ongewijzigde bron slaat over", async () => {
  const store = { data: { tenants: [{ id: "t1", name: "Demo" }], users: [fullUser()] } };
  const pool = fakePool();
  const source = makeIdentitySource({ mode: "legacy", store, pool });
  const eerste = await source.syncNow();
  assert.equal(eerste.usersUpserted, 1);
  const tweede = await source.syncNow();
  assert.deepEqual(tweede, { skipped: true, reason: "ongewijzigd" });
  store.data.users[0].name = "Jan Aangepast";
  const derde = await source.syncNow();
  assert.equal(derde.skipped, undefined, "wijziging → wél syncen");
});

// ── Live tegen echte PostgreSQL (CI draait dit; lokaal met DATABASE_URL) ────
const LIVE_URL = process.env.DATABASE_URL || "";
test("identity live: sync → globale login-lookup → reconciliatie → drift → set-sync-delete",
  { skip: !LIVE_URL && "DATABASE_URL niet gezet" }, async () => {
    const { Pool } = require("pg");
    const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
    const pool = new Pool({ connectionString: LIVE_URL, max: 2 });
    const stamp = Date.now().toString(36);
    const t1 = `t_idn_a_${stamp}`, t2 = `t_idn_b_${stamp}`;
    const users = [
      fullUser({ id: `usr_a_${stamp}`, tenantId: t1, email: `a_${stamp}@test.be` }),
      fullUser({ id: `usr_b_${stamp}`, tenantId: t2, email: `b_${stamp}@test.be`, role: "employee" }),
      fullUser({ id: `usr_root_${stamp}`, tenantId: null, email: `root_${stamp}@test.be`, role: "super_admin" }),
    ];
    const tenants = [{ id: t1, name: "Idn A" }, { id: t2, name: "Idn B" }];
    try {
      await runMigrations(pool);
      const first = await syncIdentity(pool, { tenants, users });
      assert.equal(first.usersUpserted, 3);

      // Globale login-lookup zonder tenantcontext + volledige terugvertaling.
      const found = await findUserByEmail(pool, `A_${stamp}@TEST.BE`);
      assert.equal(found.id, `usr_a_${stamp}`, "lookup is hoofdletterongevoelig");
      assert.equal(found.passwordHash, "scrypt$abc");
      assert.deepEqual(found.recoveryCodes, [{ hash: "h1", usedAt: null }]);
      assert.deepEqual(found.permissions, ["planning.read"]);

      // Tenantlijst: predicate-isolatie · tenant A ziet alleen zijn gebruiker.
      const vanA = await listUsers(pool, { tenantId: t1 });
      assert.deepEqual(vanA.map(u => u.id), [`usr_a_${stamp}`]);

      // Reconciliatie: alles in sync, beide richtingen.
      const rec1 = await reconcileIdentity(pool, { users });
      assert.equal(rec1.ok, true, `in sync na eerste sync: ${JSON.stringify(rec1)}`);

      // Idempotent: niets gewijzigd → nul updates, nul deletes.
      const second = await syncIdentity(pool, { tenants, users });
      assert.deepEqual([second.usersUpserted, second.usersDeleted], [0, 0], "fingerprint-poort houdt ruis tegen");

      // Drift in legacy (wachtwoordreset) → sync pakt precies die rij.
      users[0] = { ...users[0], passwordHash: "scrypt$nieuw" };
      const third = await syncIdentity(pool, { tenants, users });
      assert.equal(third.usersUpserted, 1);
      assert.equal((await findUserByEmail(pool, users[0].email)).passwordHash, "scrypt$nieuw");

      // Verwijderde gebruiker verdwijnt via de set-sync.
      const removed = users.pop();   // usr_root
      const fourth = await syncIdentity(pool, { tenants, users });
      assert.ok(fourth.usersDeleted >= 1);
      assert.equal(await findUserByEmail(pool, removed.email), null);

      // Globaal uniek e-mailadres wordt door de database afgedwongen.
      await assert.rejects(
        () => syncIdentity(pool, { tenants, users: [...users, fullUser({ id: `usr_dup_${stamp}`, tenantId: t1, email: users[0].email })] }),
        /users_email_unique|duplicate key/i);

      // RLS staat aan op de users-tabel (defense in depth, 5.3).
      const pol = await pool.query(`SELECT policyname FROM pg_policies WHERE tablename = 'users'`);
      assert.ok(pol.rows.some(r => r.policyname === "users_isolation"));
    } finally {
      await pool.query(`DELETE FROM users WHERE id LIKE $1`, [`usr_%_${stamp}`]).catch(() => {});
      await pool.query(`DELETE FROM tenants WHERE id IN ($1,$2)`, [t1, t2]).catch(() => {});
      await pool.end();
    }
  });
