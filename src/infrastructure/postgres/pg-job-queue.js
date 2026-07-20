"use strict";
/**
 * PostgresJobQueue (handover 4.6).
 *
 * Reserveren met FOR UPDATE SKIP LOCKED: meerdere workers plukken tegelijk
 * zonder elkaars jobs te raken · het canonieke queue-patroon op standaard
 * PostgreSQL, dus portable naar elke provider.
 *
 * Semantiek:
 *  - publish is idempotent: UNIQUE (tenant_id, type, idempotency_key) plus
 *    ON CONFLICT DO NOTHING. Twee replicas die dezelfde taak publiceren
 *    leveren één job op.
 *  - reserve geeft een job exclusief aan één worker, met een visibility
 *    timeout. Crasht de worker, dan valt de job daarna vanzelf terug en pakt
 *    een ander hem op · geen verloren werk.
 *  - attempts telt per RESERVERING (= bezorgpoging). retry plant opnieuw met
 *    backoff; bij max_attempts gaat de job naar dead in plaats van eeuwig te
 *    blijven draaien.
 */

const crypto = require("crypto");
const {
  normalizeEnvelope, backoffSeconds, DEFAULT_VISIBILITY_SECONDS,
} = require("../../ports/job-queue");

const JOB_COLUMNS = `id, tenant_id, type, payload, payload_version, correlation_id, idempotency_key,
  status, attempts, max_attempts, run_at, reserved_by, reserved_until, last_error, created_at, done_at`;

function rowToJob(r) {
  return {
    id: r.id, tenantId: r.tenant_id, type: r.type,
    payload: r.payload || {}, payloadVersion: Number(r.payload_version),
    correlationId: r.correlation_id, idempotencyKey: r.idempotency_key,
    status: r.status, attempts: Number(r.attempts), maxAttempts: Number(r.max_attempts),
    runAt: r.run_at, reservedBy: r.reserved_by, reservedUntil: r.reserved_until,
    lastError: r.last_error, createdAt: r.created_at, doneAt: r.done_at,
  };
}

class PostgresJobQueue {
  /**
   * @param {object} pool  pg-pool (gedeeld met de data-adapter)
   * @param {{visibilitySeconds?:number}} opts
   */
  constructor(pool, { visibilitySeconds = DEFAULT_VISIBILITY_SECONDS } = {}) {
    this.name = "postgres";
    this.pool = pool;
    this.visibilitySeconds = Number(visibilitySeconds) || DEFAULT_VISIBILITY_SECONDS;
  }

  /** Idempotente publish; geeft {published, jobId} terug. */
  async publish(input) {
    const job = normalizeEnvelope(input);
    const id = `job_${crypto.randomBytes(12).toString("hex")}`;
    const { rows } = await this.pool.query(
      `INSERT INTO jobs (id, tenant_id, type, payload, payload_version, correlation_id, idempotency_key, max_attempts, run_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, coalesce($9::timestamptz, now()))
       ON CONFLICT (tenant_id, type, idempotency_key) DO NOTHING
       RETURNING id`,
      [id, job.tenantId, job.type, JSON.stringify(job.payload), job.payloadVersion,
        job.correlationId, job.idempotencyKey, job.maxAttempts, job.runAt]);
    return { published: rows.length > 0, jobId: rows.length ? rows[0].id : null };
  }

  /**
   * Reserveer maximaal `limit` jobs voor deze worker. Pakt klaarstaand werk
   * én verlopen reserveringen (gecrashte worker) in één query.
   */
  async reserve(workerId, limit = 1) {
    const worker = String(workerId || "").trim();
    if (!worker) { const e = new Error("workerId is verplicht"); e.status = 400; e.code = "WORKER_REQUIRED"; throw e; }
    const size = Math.min(Math.max(1, Number(limit) || 1), 100);
    const { rows } = await this.pool.query(
      `WITH picked AS (
         SELECT id FROM jobs
          WHERE (status = 'pending' AND run_at <= now())
             OR (status = 'reserved' AND reserved_until < now())
          ORDER BY run_at
          LIMIT $2
          FOR UPDATE SKIP LOCKED)
       UPDATE jobs j
          SET status = 'reserved', reserved_by = $1,
              reserved_until = now() + make_interval(secs => $3),
              attempts = j.attempts + 1
         FROM picked WHERE j.id = picked.id
       RETURNING ${JOB_COLUMNS.split(",").map(c => `j.${c.trim()}`).join(", ")}`,
      [worker, size, this.visibilitySeconds]);
    return rows.map(rowToJob);
  }

  async acknowledge(jobId) {
    const { rows } = await this.pool.query(
      `UPDATE jobs SET status = 'done', done_at = now(), reserved_by = NULL, reserved_until = NULL
        WHERE id = $1 AND status = 'reserved' RETURNING id`, [jobId]);
    if (!rows.length) { const e = new Error("Job niet gevonden of niet gereserveerd"); e.status = 409; e.code = "NOT_RESERVED"; throw e; }
  }

  /** Terug in de wachtrij met backoff; bij op attempts → dead. */
  async retry(jobId, reason) {
    const { rows } = await this.pool.query(
      `SELECT attempts, max_attempts FROM jobs WHERE id = $1 AND status = 'reserved'`, [jobId]);
    if (!rows.length) { const e = new Error("Job niet gevonden of niet gereserveerd"); e.status = 409; e.code = "NOT_RESERVED"; throw e; }
    const { attempts, max_attempts } = rows[0];
    if (Number(attempts) >= Number(max_attempts)) return this.deadLetter(jobId, reason);
    await this.pool.query(
      `UPDATE jobs SET status = 'pending', reserved_by = NULL, reserved_until = NULL,
              last_error = $2, run_at = now() + make_interval(secs => $3)
        WHERE id = $1`,
      [jobId, String(reason || "").slice(0, 300), backoffSeconds(Number(attempts))]);
  }

  async deadLetter(jobId, reason) {
    const { rows } = await this.pool.query(
      `UPDATE jobs SET status = 'dead', reserved_by = NULL, reserved_until = NULL, last_error = $2
        WHERE id = $1 AND status IN ('reserved','pending') RETURNING id`,
      [jobId, String(reason || "").slice(0, 300)]);
    if (!rows.length) { const e = new Error("Job niet gevonden of al afgerond"); e.status = 409; e.code = "NOT_ACTIVE"; throw e; }
  }

  /** Dead-letter terug in de wachtrij (ops-handeling, zoals bij webhooks). */
  async requeueDead(jobId) {
    const { rows } = await this.pool.query(
      `UPDATE jobs SET status = 'pending', attempts = 0, last_error = NULL, run_at = now()
        WHERE id = $1 AND status = 'dead' RETURNING id`, [jobId]);
    return rows.length > 0;
  }

  /** Ruim afgeronde jobs op na een bewaartermijn · de historie is telemetrie,
   *  geen archief. Dead-jobs blijven staan tot een mens beslist. */
  async pruneDone(olderThanDays = 7) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM jobs WHERE status = 'done' AND done_at < now() - make_interval(days => $1)`,
      [Math.max(1, Number(olderThanDays) || 7)]);
    return rowCount;
  }

  /** Overzicht voor ops. */
  async stats() {
    const { rows } = await this.pool.query(
      `SELECT status, count(*)::int AS n FROM jobs GROUP BY status`);
    const out = { pending: 0, reserved: 0, done: 0, dead: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }
}

module.exports = { PostgresJobQueue, rowToJob };
