"use strict";
/**
 * In-memory JobQueue (handover 4.6) · zelfde contract als PostgresJobQueue.
 *
 * Voor de JSON-modus (één instantie) en voor tests. De semantiek is bewust
 * identiek: idempotente publish, exclusieve reservering met visibility
 * timeout, backoff, dead-letter. De klok is injecteerbaar zodat tests de
 * timeout kunnen verstrijken zonder te slapen.
 */

const crypto = require("crypto");
const {
  normalizeEnvelope, backoffSeconds, DEFAULT_VISIBILITY_SECONDS,
} = require("../../ports/job-queue");

class MemoryJobQueue {
  constructor({ visibilitySeconds = DEFAULT_VISIBILITY_SECONDS, now = () => Date.now() } = {}) {
    this.name = "memory";
    this.visibilitySeconds = Number(visibilitySeconds) || DEFAULT_VISIBILITY_SECONDS;
    this.now = now;
    this.jobs = new Map();          // id → job
    this.byKey = new Map();         // tenant|type|key → id
  }

  keyOf(job) { return `${job.tenantId}|${job.type}|${job.idempotencyKey}`; }

  async publish(input) {
    const job = normalizeEnvelope(input);
    const key = this.keyOf(job);
    if (this.byKey.has(key)) return { published: false, jobId: null };
    const id = `job_${crypto.randomBytes(12).toString("hex")}`;
    this.jobs.set(id, {
      id, ...job,
      status: "pending", attempts: 0,
      runAt: job.runAt ? new Date(job.runAt).getTime() : this.now(),
      reservedBy: null, reservedUntil: null, lastError: null,
      createdAt: this.now(), doneAt: null,
    });
    this.byKey.set(key, id);
    return { published: true, jobId: id };
  }

  async reserve(workerId, limit = 1) {
    const worker = String(workerId || "").trim();
    if (!worker) { const e = new Error("workerId is verplicht"); e.status = 400; e.code = "WORKER_REQUIRED"; throw e; }
    const t = this.now();
    const ready = [...this.jobs.values()]
      .filter(j => (j.status === "pending" && j.runAt <= t)
        || (j.status === "reserved" && j.reservedUntil < t))
      .sort((a, b) => a.runAt - b.runAt)
      .slice(0, Math.min(Math.max(1, Number(limit) || 1), 100));
    for (const j of ready) {
      j.status = "reserved";
      j.reservedBy = worker;
      j.reservedUntil = t + this.visibilitySeconds * 1000;
      j.attempts += 1;
    }
    return ready.map(j => ({ ...j }));
  }

  async acknowledge(jobId) {
    const j = this.jobs.get(jobId);
    if (!j || j.status !== "reserved") { const e = new Error("Job niet gevonden of niet gereserveerd"); e.status = 409; e.code = "NOT_RESERVED"; throw e; }
    j.status = "done"; j.doneAt = this.now(); j.reservedBy = null; j.reservedUntil = null;
  }

  async retry(jobId, reason) {
    const j = this.jobs.get(jobId);
    if (!j || j.status !== "reserved") { const e = new Error("Job niet gevonden of niet gereserveerd"); e.status = 409; e.code = "NOT_RESERVED"; throw e; }
    if (j.attempts >= j.maxAttempts) return this.deadLetter(jobId, reason);
    j.status = "pending"; j.reservedBy = null; j.reservedUntil = null;
    j.lastError = String(reason || "").slice(0, 300);
    j.runAt = this.now() + backoffSeconds(j.attempts) * 1000;
  }

  async deadLetter(jobId, reason) {
    const j = this.jobs.get(jobId);
    if (!j || !["reserved", "pending"].includes(j.status)) { const e = new Error("Job niet gevonden of al afgerond"); e.status = 409; e.code = "NOT_ACTIVE"; throw e; }
    j.status = "dead"; j.reservedBy = null; j.reservedUntil = null;
    j.lastError = String(reason || "").slice(0, 300);
  }

  async requeueDead(jobId) {
    const j = this.jobs.get(jobId);
    if (!j || j.status !== "dead") return false;
    j.status = "pending"; j.attempts = 0; j.lastError = null; j.runAt = this.now();
    return true;
  }

  async pruneDone(olderThanDays = 7) {
    const cutoff = this.now() - Math.max(1, Number(olderThanDays) || 7) * 86400000;
    let removed = 0;
    for (const [id, j] of this.jobs) {
      if (j.status === "done" && j.doneAt != null && j.doneAt < cutoff) {
        this.jobs.delete(id);
        this.byKey.delete(this.keyOf(j));
        removed++;
      }
    }
    return removed;
  }

  async stats() {
    const out = { pending: 0, reserved: 0, done: 0, dead: 0 };
    for (const j of this.jobs.values()) out[j.status] += 1;
    return out;
  }
}

module.exports = { MemoryJobQueue };
