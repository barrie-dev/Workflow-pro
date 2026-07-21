"use strict";
// Companies genormaliseerd (CTO P0-01 fase 4 · vierde strangler-domein).
//
// Invarianten: (1) verliesvrije projectie voor companies én nummerreeksen;
// (2) idempotente set-sync met fingerprint-poort; (3) de partiële unieke index
// "één default per tenant" en de nummerreeks-uniciteit worden door de database
// bewaakt; (4) de nummerreeks (definitieve uitgifte, PLT-BR-005) reconcilieert
// exact. Live tegen echte PostgreSQL onderaan (draait in CI).
const { test } = require("node:test");
const assert = require("node:assert");

const {
  projectCompany, projectCompanyRow, rowToCompany, companyFingerprint,
  projectSequence, projectSequenceRow, rowToSequence,
  syncCompanies, listCompanies, findDefaultCompany, reconcileCompanies, stableStringify,
} = require("../src/infrastructure/postgres/pg-company-repository");
const { makeCompanySource } = require("../src/infrastructure/company-source");

function company(overrides = {}) {
  return {
    id: "co_1", tenantId: "t1", legalName: "Demo Bouwgroep NV", vat: "BE0403170701",
    companyNumber: "0403170701", iban: "BE68539007547034", peppolId: "0208:0403170701",
    isDefault: true, createdAt: "2026-07-17T10:00:00.000Z", updatedAt: "2026-07-17T10:00:00.000Z",
    ...overrides,
  };
}
function sequence(overrides = {}) {
  return {
    id: "seq_1", tenantId: "t1", companyId: "co_1", docType: "invoice", year: 2026,
    nextSeq: 42, updatedAt: "2026-07-20T10:00:00.000Z",
    ...overrides,
  };
}

function companyRow(p) {
  return {
    id: p.id, tenant_id: p.tenantId, legal_name: p.legalName, vat: p.vat,
    company_number: p.companyNumber, iban: p.iban, peppol_id: p.peppolId,
    is_default: p.isDefault, attributes: p.attributes, fingerprint: "x",
  };
}
function seqRow(p) {
  return {
    id: p.id, tenant_id: p.tenantId, company_id: p.companyId, doc_type: p.docType,
    year: p.year, next_seq: p.nextSeq, attributes: p.attributes, fingerprint: "x",
  };
}

test("company: projectie is verliesvrij · legacy → rij → projectie identiek", () => {
  const c = company();
  const p = projectCompany(c);
  assert.equal(p.legalName, "Demo Bouwgroep NV");
  assert.equal(p.vat, "BE0403170701");
  assert.equal(p.attributes.createdAt, "2026-07-17T10:00:00.000Z", "tijdstempels reizen mee");
  assert.equal(p.attributes.legalName, undefined, "kernveld niet dubbel in attributes");

  const rebuilt = projectCompanyRow(companyRow(p));
  assert.equal(stableStringify(rebuilt), stableStringify(p), "rij → projectie identiek");
  const recon = rowToCompany(companyRow(p));
  assert.equal(stableStringify(projectCompany(recon)), stableStringify(p), "terugvertaling projecteert identiek");
  assert.equal(recon.iban, "BE68539007547034");
});

test("company: lege stringvelden blijven leeg (geen null-versus-leeg-verwarring)", () => {
  const c = company({ vat: "", companyNumber: "", iban: "", peppolId: "" });
  const p = projectCompany(c);
  const recon = rowToCompany(companyRow(p));
  assert.equal(recon.vat, "", "lege string blijft lege string, geen null");
  assert.equal(companyFingerprint(c), companyFingerprint(recon), "round-trip is stabiel");
});

test("company: elke inhoudelijke wijziging verandert de vingerafdruk", () => {
  const basis = companyFingerprint(company());
  assert.notEqual(companyFingerprint(company({ legalName: "Anders NV" })), basis);
  assert.notEqual(companyFingerprint(company({ isDefault: false })), basis);
  assert.notEqual(companyFingerprint(company({ iban: "BE00000000000000" })), basis);
});

test("nummerreeks: verliesvrije projectie · next_seq exact bewaard", () => {
  const s = sequence();
  const p = projectSequence(s);
  assert.equal(p.nextSeq, 42);
  assert.equal(p.year, 2026);
  const recon = rowToSequence(seqRow(p));
  assert.equal(recon.nextSeq, 42);
  assert.equal(stableStringify(projectSequence(recon)), stableStringify(p));
});

/** Fake pool met client-transactie. */
function fakePool() {
  const queries = [];
  const runQuery = async (sql, params) => {
    const flat = String(sql).replace(/\s+/g, " ").trim();
    queries.push({ sql: flat, params });
    if (/^INSERT INTO companies/.test(flat)) return { rows: [{ id: params[0] }] };
    if (/^INSERT INTO number_sequences/.test(flat)) return { rows: [{ id: params[0] }] };
    if (/^INSERT INTO tenants/.test(flat)) return { rows: [] };
    if (/^DELETE/.test(flat)) return { rows: [] };
    return { rows: [] };
  };
  return { queries, query: runQuery, async connect() { return { query: runQuery, release() {} }; } };
}

test("company-sync: tenant-anker, verwijderen-eerst, companies vóór sequences, in één tx", async () => {
  const pool = fakePool();
  const result = await syncCompanies(pool, { companies: [company()], numberSequences: [sequence()] });
  assert.equal(result.companiesUpserted, 1);
  assert.equal(result.sequencesUpserted, 1);
  const kinds = pool.queries.map(q => q.sql.split(" ").slice(0, 2).join(" "));
  assert.equal(pool.queries[0].sql, "BEGIN");
  assert.equal(pool.queries[pool.queries.length - 1].sql, "COMMIT");
  assert.ok(pool.queries.some(q => /INSERT INTO tenants .* ON CONFLICT \(id\) DO NOTHING/.test(q.sql)), "tenant-anker");
  const delCompanyIdx = pool.queries.findIndex(q => /DELETE FROM companies/.test(q.sql));
  const insCompanyIdx = pool.queries.findIndex(q => /INSERT INTO companies/.test(q.sql));
  const insSeqIdx = pool.queries.findIndex(q => /INSERT INTO number_sequences/.test(q.sql));
  assert.ok(delCompanyIdx < insCompanyIdx, "verwijderen vóór upsert");
  assert.ok(insCompanyIdx < insSeqIdx, "company vóór nummerreeks (FK)");
  assert.ok(pool.queries.some(q => /IS DISTINCT FROM excluded.fingerprint/.test(q.sql)), "fingerprint-poort");
});

test("company-source: standenvalidatie is hard (ADR-004)", () => {
  const store = { data: { companies: [], numberSequences: [] } };
  assert.throws(() => makeCompanySource({ mode: "raar", store }), e => e.code === "UNKNOWN_COMPANY_SOURCE");
  assert.throws(() => makeCompanySource({ mode: "shadow", store, pool: null }), e => e.code === "COMPANY_SOURCE_NEEDS_PG");
  assert.equal(makeCompanySource({ mode: "legacy", store }).mode, "legacy");
});

test("company-source: legacy-stand geeft de thunk terug en raakt pg niet aan", async () => {
  const store = { data: { companies: [], numberSequences: [] } };
  const source = makeCompanySource({ mode: "legacy", store });
  const legacyCompany = { id: "co_x", legalName: "Legacy NV" };
  assert.deepEqual(await source.readDefaultCompany("t1", () => legacyCompany), legacyCompany);
  assert.deepEqual(await source.syncNow(), { skipped: true, reason: "geen pg" });
});

// ── Live tegen echte PostgreSQL (CI draait dit; lokaal met DATABASE_URL) ────
const LIVE_URL = process.env.DATABASE_URL || "";
test("company live: sync → default-lookup → reconciliatie → één-default-index → nummeruitgifte → drift",
  { skip: !LIVE_URL && "DATABASE_URL niet gezet" }, async () => {
    const { Pool } = require("pg");
    const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
    const pool = new Pool({ connectionString: LIVE_URL, max: 3 });
    const stamp = Date.now().toString(36);
    const t1 = `t_co_${stamp}`;
    const co1 = company({ id: `co_a_${stamp}`, tenantId: t1 });
    const co2 = company({ id: `co_b_${stamp}`, tenantId: t1, legalName: "Tweede NV", isDefault: false });
    const seq1 = sequence({ id: `seq_a_${stamp}`, tenantId: t1, companyId: co1.id });
    try {
      await runMigrations(pool);
      const first = await syncCompanies(pool, { companies: [co1, co2], numberSequences: [seq1] });
      assert.equal(first.companiesUpserted, 2);
      assert.equal(first.sequencesUpserted, 1);

      // Default-lookup uit de tabel.
      const def = await findDefaultCompany(pool, t1);
      assert.equal(def.id, co1.id, "de default-company wordt gevonden");
      assert.equal(def.legalName, "Demo Bouwgroep NV");
      assert.equal(def.vat, "BE0403170701");

      // Tenant-lijst: predicate-isolatie, default eerst.
      const list = await listCompanies(pool, t1);
      assert.equal(list.length, 2);
      assert.equal(list[0].isDefault, true);

      // Reconciliatie sluitend incl. nummerreeks.
      const rec1 = await reconcileCompanies(pool, { companies: [co1, co2], numberSequences: [seq1] });
      assert.equal(rec1.ok, true, `sluitend: ${JSON.stringify(rec1)}`);

      // Idempotent: fingerprint-poort houdt ruis tegen.
      const second = await syncCompanies(pool, { companies: [co1, co2], numberSequences: [seq1] });
      assert.deepEqual([second.companiesUpserted, second.sequencesUpserted], [0, 0]);

      // Eén-default-per-tenant afgedwongen door de partiële unieke index.
      await assert.rejects(
        () => pool.query(`INSERT INTO companies (id, tenant_id, legal_name, is_default, fingerprint) VALUES ($1,$2,'X',true,'y')`,
          [`co_dup_${stamp}`, t1]),
        /companies_one_default_per_tenant|duplicate key/i);

      // Nummerreeks-uniciteit (tenant+company+doctype+jaar) afgedwongen.
      await assert.rejects(
        () => pool.query(`INSERT INTO number_sequences (id, tenant_id, company_id, doc_type, year, next_seq, fingerprint) VALUES ($1,$2,$3,'invoice',2026,1,'y')`,
          [`seq_dup_${stamp}`, t1, co1.id]),
        /number_sequences_tenant|duplicate key/i);

      // Definitieve uitgifte: next_seq loopt op · drift wordt exact gespiegeld.
      const advanced = sequence({ id: seq1.id, tenantId: t1, companyId: co1.id, nextSeq: 43 });
      const third = await syncCompanies(pool, { companies: [co1, co2], numberSequences: [advanced] });
      assert.equal(third.sequencesUpserted, 1);
      const seqCheck = await pool.query(`SELECT next_seq FROM number_sequences WHERE id=$1`, [seq1.id]);
      assert.equal(Number(seqCheck.rows[0].next_seq), 43, "opgehoogde reeks gespiegeld");

      // Verwijderde company verdwijnt via de set-sync.
      const fourth = await syncCompanies(pool, { companies: [co1], numberSequences: [advanced] });
      assert.ok(fourth.companiesDeleted >= 1);
      assert.equal((await listCompanies(pool, t1)).length, 1);

      // RLS aan op beide tabellen.
      const pol = await pool.query(`SELECT tablename FROM pg_policies WHERE tablename IN ('companies','number_sequences')`);
      assert.equal(new Set(pol.rows.map(r => r.tablename)).size, 2);
    } finally {
      await pool.query(`DELETE FROM number_sequences WHERE tenant_id=$1`, [t1]).catch(() => {});
      await pool.query(`DELETE FROM companies WHERE tenant_id=$1`, [t1]).catch(() => {});
      await pool.query(`DELETE FROM tenants WHERE id=$1`, [t1]).catch(() => {});
      await pool.end();
    }
  });
