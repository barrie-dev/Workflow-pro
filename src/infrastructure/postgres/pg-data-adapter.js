"use strict";
/**
 * PostgreSQL-opslagadapter (vendor-handover F-01/F-02 · ADR-002).
 *
 * Vervangt de legacy provider-adapter, die via een REST-bridge met een
 * service-role-key en een synchroon subprocess werkte. Deze adapter praat met
 * STANDAARD PostgreSQL over het pg-protocol en werkt dus op elke Postgres:
 * lokaal in Docker, Azure Database for PostgreSQL, RDS, Cloud SQL of een eigen
 * VPS. Er zit geen provider-specifieke SQL, extensie of endpoint in.
 *
 * ── Waarom een document-tabel (nog) ─────────────────────────────────────────
 * De normalisatie naar domeintabellen (F-04) is een aparte strangler-fase.
 * Deze adapter zet de bestaande dataset in één rij van `platform_state`, zodat
 * de app VANDAAG los kan van de provider zonder big-bang herschrijving. Dat is
 * exact het patroon dat ADR-002 voorschrijft: eerst portable maken, dan
 * normaliseren. De rij draagt een `revision` voor optimistic locking, zodat
 * twee replicas elkaars schrijfacties niet stil overschrijven.
 *
 * ── Sync-API met async opslag ───────────────────────────────────────────────
 * De store roept save() synchroon aan. Een netwerk-database kan dat niet
 * synchroon waarmaken. Daarom markeert save() enkel als "vuil" en persisteert
 * flush() daadwerkelijk. De HTTP-laag wacht flush() af vóór ze antwoordt op een
 * muterend verzoek, en de shutdown-handler flusht ook. Zo is er geen stil
 * dataverlies: een 2xx betekent dat de data in Postgres staat.
 */

const { Pool } = require("pg");

const STATE_TABLE = "platform_state";
const STATE_ID = "singleton";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL,
  revision    bigint NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
`;

// Maximaal aantal merge-herstelpogingen bij een revisieconflict voor we opgeven.
// In de praktijk volstaat 1 (deploy-overlap van twee instanties); meer alleen
// bij aanhoudende hoge gelijktijdigheid.
const MAX_MERGE_RETRIES = 5;

// Vaste advisory-lock-sleutel voor de platform_state-writer (CTO-03). Eén
// constante voor het hele platform · twee instanties met dezelfde database
// concurreren per definitie om dezelfde lock.
const WRITER_LOCK_KEY = 727270031;

function isIdRow(r) { return r && typeof r === "object" && !Array.isArray(r) && "id" in r; }

// Tombstones (CTO-04): het document draagt onder _tombstones per collectie een
// map { id → deletedAtISO }. Zo weet de merge dat een ontbrekende rij VERWIJDERD
// is en niet "nog niet gezien" · verwijderde records keren niet terug bij een
// revisieconflict, en een delete wint van een gelijktijdige update op die rij.
const TOMBSTONES_KEY = "_tombstones";
const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // ruim voorbij elk overlap-venster

function pruneTombstones(map, now = Date.now()) {
  if (!map || typeof map !== "object") return map;
  for (const coll of Object.keys(map)) {
    for (const [id, at] of Object.entries(map[coll] || {})) {
      const ms = Date.parse(at);
      if (!Number.isFinite(ms) || now - ms > TOMBSTONE_TTL_MS) delete map[coll][id];
    }
    if (!Object.keys(map[coll]).length) delete map[coll];
  }
  return map;
}

/**
 * Voeg de HUIDIGE database-staat (`incoming`) samen IN `target` (onze staat),
 * zodat een revisieconflict niet leidt tot dataverlies maar tot een merge:
 *  - collecties van rijen-met-id worden verenigd op id · rijen die alleen de
 *    andere instantie toevoegde blijven behouden (append-veilig);
 *  - bij dezelfde id wint onze versie (last-writer-wins per rij) · onder de
 *    single-writer-guard (CTO-03) komt dit pad in productie niet meer voor;
 *  - tombstones (CTO-04): een rij die één van beide kanten verwijderde blijft
 *    verwijderd · geen resurrectie, delete wint van een gelijktijdige update;
 *  - sleutels die enkel in de database bestaan worden overgenomen;
 *  - scalars en niet-id-arrays houden onze waarde.
 * Muteert `target` in-place (dat is de referentie naar de store-data, dus de
 * in-memory leesweergave loopt mee).
 */
function mergeStateInto(target, incoming) {
  if (!target || !incoming || typeof incoming !== "object") return target;
  // Tombstones eerst verenigen: beide kanten hun deletes tellen mee.
  const incTomb = incoming[TOMBSTONES_KEY] || {};
  const tgtTomb = target[TOMBSTONES_KEY] = target[TOMBSTONES_KEY] || {};
  for (const coll of Object.keys(incTomb)) {
    tgtTomb[coll] = { ...(incTomb[coll] || {}), ...(tgtTomb[coll] || {}) };
  }
  pruneTombstones(tgtTomb);
  const deadIn = coll => tgtTomb[coll] || {};

  for (const key of Object.keys(incoming)) {
    if (key === TOMBSTONES_KEY) continue;
    const inc = incoming[key];
    if (!(key in target)) { target[key] = inc; continue; }
    const tgt = target[key];
    if (Array.isArray(inc) && Array.isArray(tgt) && inc.every(isIdRow) && tgt.every(isIdRow)) {
      const dead = deadIn(key);
      // Delete wint: rijen die (door één van beide kanten) getombstoned zijn
      // verdwijnen ook uit onze staat, zelfs als wij ze intussen wijzigden.
      if (Object.keys(dead).length) {
        for (let i = tgt.length - 1; i >= 0; i--) if (dead[tgt[i].id]) tgt.splice(i, 1);
      }
      const seen = new Set(tgt.map(r => r.id));
      for (const row of inc) if (!seen.has(row.id) && !dead[row.id]) tgt.push(row);
    }
    // anders: onze waarde blijft (last-writer-wins).
  }
  return target;
}

class PostgresDataAdapter {
  /**
   * @param {object} opts
   * @param {string} opts.connectionString  standaard PostgreSQL-URL
   * @param {boolean} [opts.ssl]            TLS afdwingen (managed providers)
   * @param {object} [opts.pool]            injecteerbare pool (tests)
   */
  constructor({ connectionString, ssl = false, pool = null, maxConnections = 10, statementTimeoutMs = 15000, initialImport = null } = {}) {
    this.name = "postgres";
    this.connectionString = connectionString || "";
    // Eenmalige data-overname bij een LEGE database: een injecteerbare functie
    // die de bestaande dataset uit een vorige opslag oplevert, of null. Welke
    // opslag dat is beslist de samensteller (data-adapters.js) · deze adapter
    // blijft providerblind. Alleen gebruikt als platform_state nog geen rij
    // heeft; daarna is deze adapter de enige waarheid.
    this.initialImport = initialImport;
    if (!this.connectionString && !pool) {
      const e = new Error("DATABASE_URL is vereist voor de PostgreSQL-adapter");
      e.status = 500; e.code = "DATABASE_URL_MISSING";
      throw e;
    }
    // CTO-13 · TLS: `ssl` mag een boolean zijn (legacy: require zonder
    // validatie) of een compleet opties-object van databaseSslOptions()
    // (verify-full met certificaatvalidatie in productie).
    const sslOptions = ssl && typeof ssl === "object" ? ssl : (ssl ? { rejectUnauthorized: false } : undefined);
    this.pool = pool || new Pool({
      connectionString: this.connectionString,
      max: maxConnections,
      ssl: sslOptions,
      statement_timeout: statementTimeoutMs,
      idle_in_transaction_session_timeout: statementTimeoutMs,
    });
    this.revision = 0;
    this.pending = null;        // laatst bekende staat die nog niet bewaard is
    this.flushing = null;       // lopende flush-promise (coalescing)
    this.lastError = null;
    this.lastFlushAt = null;
    this.ready = false;
    this.outboxAppend = [];     // events die met de volgende flush mee-committen
    this.outboxStatus = [];     // deliverystatus-updates voor de duurzame log
    this.mergeRecoveries = 0;   // aantal herstelde revisieconflicten (observability)
  }

  /**
   * Legt de document-tabel aan die deze adapter zelf gebruikt. Idempotent, dus
   * veilig bij elke start.
   *
   * De genummerde SQL-migraties met het genormaliseerde schema (handover 5.4)
   * draaien hier BEWUST NIET. Schemawijzigingen horen een gecontroleerde
   * deploystap te zijn (`npm run db:migrate:sql`), vóór de nieuwe versie
   * uitrolt. Zou elke replica bij het opstarten migreren, dan wijzigt het
   * schema terwijl de oude versie nog draait.
   */
  async migrate() {
    await this.pool.query(SCHEMA_SQL);
  }

  /** Expliciete uitvoering van de SQL-migraties (deploystap of dev-gemak). */
  async runSqlMigrations({ log = () => {} } = {}) {
    const { runMigrations } = require("./migration-runner");
    return runMigrations(this.pool, { log });
  }

  /**
   * Laad de dataset. Async: de server roept dit één keer aan vóór hij luistert.
   * Zonder rij wordt de seed weggeschreven, zodat een verse database meteen
   * bruikbaar is.
   */
  async loadAsync(seed) {
    await this.migrate();
    const { rows } = await this.pool.query(
      `SELECT data, revision FROM ${STATE_TABLE} WHERE id = $1`, [STATE_ID]);
    if (rows.length) {
      this.revision = Number(rows[0].revision);
      this.ready = true;
      return rows[0].data;
    }
    // Lege database: eerst proberen de bestaande dataset over te nemen uit de
    // vorige opslag (strangler-cutover zonder dataverlies) · pas als dat niets
    // oplevert een verse seed. Zonder deze stap zou een productie-omschakeling
    // naar deze adapter opstarten met een lege omgeving NAAST de echte data.
    let initial = null;
    let source = "seed";
    if (this.initialImport) {
      try {
        const imported = await this.initialImport();
        if (imported && Array.isArray(imported.tenants) && imported.tenants.length) {
          initial = imported;
          source = `legacy-import (${imported.tenants.length} tenant(s))`;
        }
      } catch (e) {
        console.error(`[pg-adapter] legacy-import mislukt · verse seed als terugval: ${e.message}`);
      }
    }
    if (!initial) initial = seed();
    const inserted = await this.pool.query(
      `INSERT INTO ${STATE_TABLE} (id, data, revision) VALUES ($1, $2, 1)
       ON CONFLICT (id) DO NOTHING
       RETURNING revision`, [STATE_ID, initial]);
    this.revision = inserted.rows.length ? Number(inserted.rows[0].revision) : 1;
    this.ready = true;
    console.log(`  Data      : platform_state geïnitialiseerd vanuit ${source}`);
    return initial;
  }

  /** Synchrone store-API: markeert vuil, schrijft niet zelf. */
  save(data) {
    this.pending = data;
  }

  /** True zolang er niet-bewaarde wijzigingen zijn. */
  isDirty() {
    return this.pending !== null || this.outboxAppend.length > 0 || this.outboxStatus.length > 0;
  }

  /**
   * Transactionele outbox (CTO P0-05): nieuwe events en statuswijzigingen
   * worden hier in de wachtrij gezet en committen in DEZELFDE transactie als
   * de staat. Faalt de flush, dan blijven ze staan voor de volgende poging ·
   * een commit bevat de domeinwijziging én zijn events, of geen van beide.
   */
  queueOutboxAppend(event) {
    if (event && event.id) this.outboxAppend.push(event);
  }

  queueOutboxStatus(update) {
    if (update && update.id) this.outboxStatus.push(update);
  }

  /**
   * Persisteer de openstaande staat. Coalesceert gelijktijdige aanroepen tot
   * één schrijfactie. Optimistic locking op `revision`: als een andere replica
   * intussen schreef, faalt de update en geven we een expliciete fout in
   * plaats van stil te overschrijven.
   */
  async flush() {
    // Eerst aansluiten bij een LOPENDE schrijfactie, pas daarna de vuil-check.
    // Andersom zou een aanroeper tijdens een lopende write {written:false}
    // krijgen en denken dat alles bewaard is, terwijl de schrijfactie nog liep.
    // De shutdown-handler zou dan te vroeg kunnen afsluiten.
    if (this.flushing) return this.flushing;
    if (!this.isDirty()) return { written: false };
    const data = this.pending;
    this.pending = null;
    const appendBatch = this.outboxAppend.splice(0);
    const statusBatch = this.outboxStatus.splice(0);
    const requeue = () => {
      // Niets weggooien bij een fout: staat én events wachten samen op retry.
      if (this.pending === null && data !== null) this.pending = data;
      this.outboxAppend.unshift(...appendBatch);
      this.outboxStatus.unshift(...statusBatch);
    };
    this.flushing = (async () => {
      const client = await this.pool.connect();
      let attempt = 0;
      try {
        // ÉÉN transactie: staat + outbox-events + statusupdates committen
        // samen of helemaal niet (CTO P0-05 · transactionele outbox).
        //
        // Revisieconflict-HERSTEL: schreef een andere instantie tussentijds
        // (typisch de deploy-overlap van twee replicas op de ene state-rij),
        // dan herladen we de actuele staat, MERGEN we onze wijzigingen erin
        // (adds van beide kanten blijven) en proberen opnieuw. Zo lopen writes
        // niet meer stil verloren doordat een instantie op een oude revisie
        // blijft botsen.
        for (;;) {
          await client.query("BEGIN");
          if (data !== null) {
            const { rows } = await client.query(
              `UPDATE ${STATE_TABLE}
                  SET data = $2, revision = revision + 1, updated_at = now()
                WHERE id = $1 AND revision = $3
            RETURNING revision`,
              [STATE_ID, data, this.revision]);
            if (!rows.length) {
              await client.query("ROLLBACK");
              attempt++;
              if (attempt > MAX_MERGE_RETRIES) {
                requeue();
                const e = new Error("De opslag is door een andere instantie gewijzigd (revisieconflict)");
                e.code = "STATE_REVISION_CONFLICT";
                throw e;
              }
              const cur = await client.query(
                `SELECT data, revision FROM ${STATE_TABLE} WHERE id = $1`, [STATE_ID]);
              if (cur.rows.length) {
                mergeStateInto(data, cur.rows[0].data);   // muteert data (== store-data)
                this.revision = Number(cur.rows[0].revision);
              }
              this.mergeRecoveries++;
              console.warn(`[pg-adapter] revisieconflict hersteld via merge (poging ${attempt}, revisie→${this.revision})`);
              continue;                                    // opnieuw met gemergede staat
            }
            this.revision = Number(rows[0].revision);
          }
          break;                                           // staat weg (of geen staatwijziging)
        }
        for (const ev of appendBatch) {
          // Idempotent op id: een her-flush na een netwerkfout dupliceert niets.
          await client.query(
            `INSERT INTO outbox_events (id, tenant_id, company_id, event_type, aggregate_type, aggregate_id,
               occurred_at, correlation_id, version, data)
             VALUES ($1,$2,$3,$4,$5,$6,coalesce($7::timestamptz, now()),$8,$9,$10)
             ON CONFLICT (id) DO NOTHING`,
            [ev.id, ev.tenantId, ev.companyId || null, ev.eventType, ev.aggregateType || "unknown", String(ev.aggregateId || ""),
              ev.occurredAt || null, ev.correlationId || null, Number(ev.version) || 1, JSON.stringify(ev.data || {})]);
        }
        for (const up of statusBatch) {
          await client.query(
            `UPDATE outbox_events
                SET delivery_status = $2, attempts = coalesce($3, attempts),
                    last_error = $4, delivered_at = CASE WHEN $2 = 'delivered' THEN now() ELSE delivered_at END
              WHERE id = $1`,
            [up.id, up.status, up.attempts == null ? null : Number(up.attempts), up.lastError || null]);
        }
        await client.query("COMMIT");
        this.lastFlushAt = new Date().toISOString();
        this.lastError = null;
        return { written: true, revision: this.revision, outboxAppended: appendBatch.length, outboxUpdated: statusBatch.length };
      } catch (err) {
        if (err.code !== "STATE_REVISION_CONFLICT") {
          await client.query("ROLLBACK").catch(() => {});
          requeue();
        }
        this.lastError = String((err && err.message) || err).slice(0, 300);
        throw err;
      } finally {
        client.release();
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  /** Retentie duurzame outbox: bezorgde events ouder dan N dagen opruimen. */
  async pruneOutbox({ keepDays = 30 } = {}) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM outbox_events
        WHERE delivery_status = 'delivered' AND occurred_at < now() - ($1 || ' days')::interval`,
      [String(Math.max(1, Number(keepDays) || 30))]);
    return { removed: rowCount || 0 };
  }

  /** Duurzame log lezen (replay/inspectie · superadmin). */
  async listOutboxEvents({ tenantId, status, eventType, limit = 100 } = {}) {
    const cond = ["1=1"], params = [];
    if (tenantId) { params.push(tenantId); cond.push(`tenant_id = $${params.length}`); }
    if (status) { params.push(status); cond.push(`delivery_status = $${params.length}`); }
    if (eventType) { params.push(eventType); cond.push(`event_type = $${params.length}`); }
    params.push(Math.min(Number(limit) || 100, 500));
    const { rows } = await this.pool.query(
      `SELECT * FROM outbox_events WHERE ${cond.join(" AND ")} ORDER BY occurred_at DESC LIMIT $${params.length}`, params);
    return rows;
  }

  /** Herlaad na een revisieconflict, zodat de aanroeper kan hersynchroniseren. */
  async reload() {
    const { rows } = await this.pool.query(
      `SELECT data, revision FROM ${STATE_TABLE} WHERE id = $1`, [STATE_ID]);
    if (!rows.length) return null;
    this.revision = Number(rows[0].revision);
    return rows[0].data;
  }

  status() {
    return {
      adapter: this.name,
      mode: "postgres",
      // Bewust GEEN providernaam: dit werkt op elke standaard PostgreSQL.
      online: this.ready && !this.lastError,
      revision: this.revision,
      pendingWrites: this.isDirty(),
      lastFlushAt: this.lastFlushAt,
      lastError: this.lastError,
      mergeRecoveries: this.mergeRecoveries,
      pool: { total: this.pool.totalCount, idle: this.pool.idleCount, waiting: this.pool.waitingCount },
    };
  }

  /**
   * CTO-03 · single-writer-guard: neem een PostgreSQL advisory lock zodat er
   * nooit twee schrijvende instanties tegelijk op platform_state staan. Een
   * nieuwe instantie wacht maximaal `waitMs` op de oude (rolling deploy) en
   * faalt daarna HARD · liever geen tweede writer dan een stil merge-risico.
   */
  async acquireWriterLock({ waitMs = 60000, retryMs = 2000 } = {}) {
    if (this.lockClient) return true; // idempotent
    const client = await this.pool.connect();
    const deadline = Date.now() + waitMs;
    try {
      for (;;) {
        const r = await client.query("SELECT pg_try_advisory_lock($1) AS got", [WRITER_LOCK_KEY]);
        if (r.rows[0] && r.rows[0].got === true) { this.lockClient = client; return true; }
        if (Date.now() >= deadline) {
          const e = new Error("Single-writer-lock niet verkregen: een andere instantie schrijft nog naar platform_state.");
          e.code = "WRITER_LOCK_TIMEOUT"; e.status = 503;
          throw e;
        }
        await new Promise(res => setTimeout(res, retryMs));
      }
    } catch (err) {
      client.release();
      throw err;
    }
  }

  async releaseWriterLock() {
    if (!this.lockClient) return;
    const client = this.lockClient;
    this.lockClient = null;
    try { await client.query("SELECT pg_advisory_unlock($1)", [WRITER_LOCK_KEY]); } catch (_) { /* sessie-einde geeft hem sowieso vrij */ }
    client.release();
  }

  /**
   * CTO-05 · shutdown durability: afsluiten met niet-gepersisteerde writes is
   * een FOUT, geen stilte. We flushen; blijft er een schrijffout of dirty staat
   * over, dan gooit close() DIRTY_SHUTDOWN zodat de shutdown-handler non-zero
   * kan eindigen en monitoring het ziet. `force` bestaat voor tests/noodpaden.
   */
  async close({ force = false } = {}) {
    let flushError = null;
    try { await this.flush(); } catch (e) { flushError = e; }
    const dirty = this.isDirty();
    await this.releaseWriterLock();
    await this.pool.end();
    if ((flushError || dirty) && !force) {
      const e = new Error("Afsluiten met niet-gepersisteerde wijzigingen" + (flushError ? `: ${flushError.message}` : " (pending writes)"));
      e.code = "DIRTY_SHUTDOWN";
      e.cause = flushError || undefined;
      throw e;
    }
  }
}

module.exports = { PostgresDataAdapter, STATE_TABLE, SCHEMA_SQL, mergeStateInto, TOMBSTONES_KEY, WRITER_LOCK_KEY, pruneTombstones };
