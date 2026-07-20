"use strict";
// JobQueueProvider-contract (handover 4.6): verplichte envelope, idempotente
// publish, exclusieve reservering met visibility timeout, backoff, dead-letter.
// Eén gedeelde suite voor ELKE adapter; de Postgres-variant draait live zodra
// DATABASE_URL gezet is.
const { test } = require("node:test");
const assert = require("node:assert");

const { normalizeEnvelope, backoffSeconds, isJobQueueProvider } = require("../src/ports/job-queue");
const { MemoryJobQueue } = require("../src/infrastructure/local/memory-job-queue");

const ENVELOPE = { tenantId: "t1", type: "webhook.deliver", payloadVersion: 1, correlationId: "corr_1", idempotencyKey: "cyclus-2026-07-20" };

// ── Poortregels ─────────────────────────────────────────────────────────────
test("job-poort: envelope vereist tenantId, type en idempotencyKey", () => {
  assert.doesNotThrow(() => normalizeEnvelope(ENVELOPE));
  for (const veld of ["tenantId", "type", "idempotencyKey"]) {
    const kapot = { ...ENVELOPE, [veld]: "" };
    assert.throws(() => normalizeEnvelope(kapot), e => e.code === "ENVELOPE_INCOMPLETE" && e.missing.includes(veld), `${veld} is verplicht`);
  }
  assert.throws(() => normalizeEnvelope({ ...ENVELOPE, type: "geen spaties!" }), e => e.code === "INVALID_JOB_TYPE");
  const n = normalizeEnvelope(ENVELOPE);
  assert.equal(n.payloadVersion, 1);
  assert.equal(n.maxAttempts, 8);
});

test("job-poort: backoff groeit en is begrensd", () => {
  assert.equal(backoffSeconds(1), 5);
  assert.equal(backoffSeconds(2), 20);
  assert.equal(backoffSeconds(3), 45);
  assert.ok(backoffSeconds(100) <= 3600, "nooit langer dan een uur");
});

/**
 * Gedeeld adaptercontract.
 * @param {string} name
 * @param {() => Promise<{queue:object, tick?:(ms:number)=>void, cleanup?:Function}>} setup
 *   `tick` verzet de klok (memory) of is undefined (postgres · daar testen we
 *   de timeout met een korte visibilitySeconds en echte tijd).
 */
function jobQueueContract(name, setup) {
  test(`${name}: implementeert de poort`, async () => {
    const { queue, cleanup } = await setup();
    assert.ok(isJobQueueProvider(queue));
    if (cleanup) await cleanup();
  });

  test(`${name}: publish is idempotent op (tenant, type, idempotencyKey)`, async () => {
    const { queue, cleanup } = await setup();
    const eerste = await queue.publish(ENVELOPE);
    const tweede = await queue.publish(ENVELOPE);
    assert.equal(eerste.published, true);
    assert.equal(tweede.published, false, "tweede publish van dezelfde taak levert niets op");
    // Andere sleutel of andere tenant → wél een nieuwe job.
    assert.equal((await queue.publish({ ...ENVELOPE, idempotencyKey: "andere" })).published, true);
    assert.equal((await queue.publish({ ...ENVELOPE, tenantId: "t2" })).published, true);
    const st = await queue.stats();
    assert.equal(st.pending, 3);
    if (cleanup) await cleanup();
  });

  test(`${name}: reserve is exclusief · twee workers krijgen nooit dezelfde job`, async () => {
    const { queue, cleanup } = await setup();
    await queue.publish(ENVELOPE);
    await queue.publish({ ...ENVELOPE, idempotencyKey: "k2" });
    const [a, b] = await Promise.all([queue.reserve("worker-a", 5), queue.reserve("worker-b", 5)]);
    const idsA = a.map(j => j.id), idsB = b.map(j => j.id);
    assert.equal(idsA.length + idsB.length, 2, "beide jobs zijn uitgedeeld");
    assert.ok(!idsA.some(id => idsB.includes(id)), "geen overlap tussen workers");
    // Een derde reserve krijgt niets: alles is gereserveerd.
    assert.equal((await queue.reserve("worker-c", 5)).length, 0);
    if (cleanup) await cleanup();
  });

  test(`${name}: envelopevelden reizen mee naar de worker`, async () => {
    const { queue, cleanup } = await setup();
    await queue.publish({ ...ENVELOPE, payload: { eventId: "evt_1" }, correlationId: "keten-9" });
    const [job] = await queue.reserve("worker-a", 1);
    assert.equal(job.tenantId, "t1");
    assert.equal(job.type, "webhook.deliver");
    assert.equal(job.payloadVersion, 1);
    assert.equal(job.correlationId, "keten-9");
    assert.deepEqual(job.payload, { eventId: "evt_1" });
    assert.equal(job.attempts, 1, "reserveren telt als bezorgpoging");
    if (cleanup) await cleanup();
  });

  test(`${name}: acknowledge rondt af · retry plant opnieuw met backoff`, async () => {
    const { queue, cleanup } = await setup();
    await queue.publish(ENVELOPE);
    const [job] = await queue.reserve("worker-a", 1);
    await queue.acknowledge(job.id);
    assert.equal((await queue.stats()).done, 1);
    // Nogmaals acknowledgen kan niet: de job is niet meer gereserveerd.
    await assert.rejects(() => queue.acknowledge(job.id), e => e.code === "NOT_RESERVED");

    await queue.publish({ ...ENVELOPE, idempotencyKey: "k-retry" });
    const [j2] = await queue.reserve("worker-a", 1);
    await queue.retry(j2.id, "provider gaf 500");
    const st = await queue.stats();
    assert.equal(st.pending, 1, "terug in de wachtrij");
    // Maar niet METEEN beschikbaar: de backoff geldt.
    assert.equal((await queue.reserve("worker-b", 1)).length, 0, "backoff voorkomt een strakke lus");
    if (cleanup) await cleanup();
  });

  test(`${name}: na max_attempts gaat een job naar dead in plaats van eeuwig door`, async () => {
    const { queue, tick, cleanup } = await setup();
    await queue.publish({ ...ENVELOPE, idempotencyKey: "k-dead", maxAttempts: 2 });
    for (let i = 0; i < 2; i++) {
      if (tick) await tick(4000 * 1000);      // voorbij elke backoff (memory: klok · pg: run_at terugzetten)
      const jobs = await queue.reserve(`w${i}`, 1);
      assert.equal(jobs.length, 1, `poging ${i + 1} kan gereserveerd worden`);
      await queue.retry(jobs[0].id, `poging ${i + 1} mislukt`);
    }
    const st = await queue.stats();
    assert.equal(st.dead, 1, "na 2 pogingen dead");
    assert.equal(st.pending, 0);
    if (cleanup) await cleanup();
  });

  test(`${name}: expliciete deadLetter en requeue voor ops`, async () => {
    const { queue, cleanup } = await setup();
    await queue.publish({ ...ENVELOPE, idempotencyKey: "k-dl" });
    const [job] = await queue.reserve("worker-a", 1);
    await queue.deadLetter(job.id, "payload onbruikbaar");
    assert.equal((await queue.stats()).dead, 1);
    assert.equal(await queue.requeueDead(job.id), true);
    assert.equal((await queue.stats()).pending, 1);
    assert.equal(await queue.requeueDead(job.id), false, "alleen dead-jobs zijn te requeuen");
    if (cleanup) await cleanup();
  });
}

// ── Memory-adapter · klok injecteerbaar ─────────────────────────────────────
function memorySetup() {
  let clock = 1_000_000;
  const queue = new MemoryJobQueue({ visibilitySeconds: 60, now: () => clock });
  return { queue, tick: ms => { clock += ms; } };
}
jobQueueContract("memory", async () => memorySetup());

test("memory: visibility timeout · gecrashte worker verliest zijn reservering", async () => {
  const { queue, tick } = memorySetup();
  await queue.publish(ENVELOPE);
  const [job] = await queue.reserve("crashte-worker", 1);
  assert.equal((await queue.reserve("worker-b", 1)).length, 0, "binnen de timeout exclusief");
  tick(61 * 1000);                             // timeout verstrijkt
  const [herpakt] = await queue.reserve("worker-b", 1);
  assert.equal(herpakt.id, job.id, "dezelfde job valt terug naar een andere worker");
  assert.equal(herpakt.attempts, 2, "de herovername telt als nieuwe poging");
});

// ── Postgres-adapter · draait live met DATABASE_URL ─────────────────────────
const LIVE_URL = process.env.DATABASE_URL || "";
async function pgSetup() {
  const { Pool } = require("pg");
  const { PostgresJobQueue } = require("../src/infrastructure/postgres/pg-job-queue");
  const { runMigrations } = require("../src/infrastructure/postgres/migration-runner");
  const pool = new Pool({ connectionString: LIVE_URL, max: 4 });
  await runMigrations(pool);
  await pool.query("DELETE FROM jobs WHERE tenant_id IN ('t1','t2')");   // schone lei per test
  const queue = new PostgresJobQueue(pool, { visibilitySeconds: 2 });    // korte timeout voor de echte-tijd-test
  return {
    queue,
    // "Klok verzetten" op Postgres = de backoff in de data terugdraaien.
    tick: async () => { await pool.query("UPDATE jobs SET run_at = now() - interval '1 second' WHERE status = 'pending' AND tenant_id IN ('t1','t2')"); },
    cleanup: async () => { await pool.query("DELETE FROM jobs WHERE tenant_id IN ('t1','t2')"); await pool.end(); },
  };
}
if (LIVE_URL) {
  jobQueueContract("postgres", pgSetup);

  test("postgres: visibility timeout met echte tijd", async () => {
    const { queue, cleanup } = await pgSetup();
    await queue.publish(ENVELOPE);
    const [job] = await queue.reserve("crashte-worker", 1);
    assert.equal((await queue.reserve("worker-b", 1)).length, 0, "binnen de timeout exclusief");
    await new Promise(r => setTimeout(r, 2500));   // visibilitySeconds = 2
    const [herpakt] = await queue.reserve("worker-b", 1);
    assert.ok(herpakt && herpakt.id === job.id, "job valt na de timeout terug");
    assert.equal(herpakt.attempts, 2);
    await cleanup();
  });
} else {
  test("postgres-jobqueue: integratie", { skip: "DATABASE_URL niet gezet" }, () => {});
}
