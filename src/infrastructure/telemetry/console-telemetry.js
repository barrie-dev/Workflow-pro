"use strict";
/**
 * Console-TelemetryProvider (handover 4.7).
 *
 * Schrijft gestructureerde JSON naar stdout/stderr. Elk container-platform
 * (Kubernetes, Azure Container Apps, Cloud Run, Fly, Docker, systemd) verzamelt
 * stdout, dus dit werkt overal zonder agent of account.
 *
 * De vorm volgt OpenTelemetry-conventies (severity, name, attributes, trace-
 * velden), zodat een OTel-collector of Azure Monitor-exporter er later
 * rechtstreeks op kan aansluiten zonder dat aanroepende code wijzigt.
 *
 * Metrics worden in het geheugen geaggregeerd en periodiek uitgeschreven: één
 * regel per meting zou de logs onbruikbaar maken.
 */

const { normalizeLogEvent, normalizeSecurityEvent, sanitizeAttributes, normalizeContext } = require("../../ports/telemetry");

class ConsoleTelemetry {
  /**
   * @param {object} opts
   * @param {"debug"|"info"|"warn"|"error"} [opts.minLevel]
   * @param {object} [opts.out]  injecteerbaar voor tests
   */
  constructor({ minLevel = "info", out = console, service = "monargo-one", environment = "development" } = {}) {
    this.name = "console";
    this.minLevel = minLevel;
    this.out = out;
    this.service = service;
    this.environment = environment;
    this.metrics = new Map();
    this.rank = { debug: 10, info: 20, warn: 30, error: 40 };
  }

  emit(record, stream = "log") {
    const line = JSON.stringify({ service: this.service, environment: this.environment, ...record });
    if (stream === "error" && typeof this.out.error === "function") this.out.error(line);
    else this.out.log(line);
  }

  log(event) {
    const e = normalizeLogEvent(event);
    if (this.rank[e.level] < this.rank[this.minLevel]) return;
    this.emit({ type: "log", severity: e.level.toUpperCase(), ...e }, e.level === "error" ? "error" : "log");
  }

  /**
   * Securityevents gaan altijd door, ongeacht minLevel: een geweigerde
   * cross-tenant toegang mag nooit wegvallen omdat iemand het logniveau
   * omhoog zette.
   */
  security(event) {
    const e = normalizeSecurityEvent(event);
    this.emit({ type: "security", severity: e.level.toUpperCase(), ...e }, "error");
  }

  metric(name, value, attributes = {}) {
    const key = `${name}|${JSON.stringify(sanitizeAttributes(attributes))}`;
    const current = this.metrics.get(key) || { name, attributes: sanitizeAttributes(attributes), count: 0, sum: 0, min: Infinity, max: -Infinity };
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    current.count += 1;
    current.sum += v;
    current.min = Math.min(current.min, v);
    current.max = Math.max(current.max, v);
    this.metrics.set(key, current);
  }

  /** Geaggregeerde metingen ophalen en de teller resetten. */
  flushMetrics() {
    const rows = [...this.metrics.values()].map(m => ({
      name: m.name, attributes: m.attributes, count: m.count,
      sum: Math.round(m.sum * 1000) / 1000,
      avg: Math.round((m.sum / m.count) * 1000) / 1000,
      min: m.min === Infinity ? null : m.min,
      max: m.max === -Infinity ? null : m.max,
    }));
    this.metrics.clear();
    return rows;
  }

  /**
   * Meet een stuk werk. Bij een fout wordt die GEMELD en doorgegooid: telemetrie
   * mag nooit een fout opslokken, want dan verdwijnt hij uit de businesslogica.
   */
  async span(name, work, attributes = {}) {
    const started = Date.now();
    const ctx = normalizeContext(attributes);
    try {
      const result = await work();
      const ms = Date.now() - started;
      this.metric(`${name}.duration_ms`, ms, attributes);
      this.log({ level: "debug", message: `${name} klaar in ${ms}ms`, ...ctx, attributes: { ...attributes, durationMs: ms, outcome: "ok" } });
      return result;
    } catch (err) {
      const ms = Date.now() - started;
      this.metric(`${name}.duration_ms`, ms, { ...attributes, outcome: "error" });
      this.log({ level: "error", message: `${name} mislukt: ${err.message}`, ...ctx, attributes: { ...attributes, durationMs: ms, outcome: "error", errorCode: err.code || null } });
      throw err;
    }
  }

  status() {
    return { adapter: this.name, minLevel: this.minLevel, pendingMetrics: this.metrics.size };
  }
}

/** No-op provider · voor tests die geen telemetrie willen zien. */
class NoopTelemetry {
  constructor() { this.name = "noop"; }
  log() {} security() {} metric() {}
  async span(name, work) { return work(); }
  flushMetrics() { return []; }
  status() { return { adapter: this.name }; }
}

module.exports = { ConsoleTelemetry, NoopTelemetry };
