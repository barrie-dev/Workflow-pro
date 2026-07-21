"use strict";
/**
 * PostgreSQL-adapter voor de TransactionManager-poort (ADR-003 · CTO P0-01).
 *
 * Dezelfde poort-belofte als de lokale adapter, maar dan met native
 * BEGIN/COMMIT/ROLLBACK op één uitgecheckte connectie:
 *
 *  - run(work) checkt één client uit de pool, opent een transactie en voert
 *    work(ctx) uit met ctx = { client, query }.
 *  - Succes → COMMIT en de returnwaarde; fout → ROLLBACK en de fout ongewijzigd.
 *  - Genest run() binnen dezelfde asynchrone keten JOINT de lopende transactie:
 *    de buitenste run beslist commit/rollback (alles-of-niets).
 *
 * De join-administratie loopt via AsyncLocalStorage (Node-kern): elke
 * request-keten ziet alleen zijn EIGEN lopende transactie, ook als het proces
 * tientallen requests tegelijk bedient. Een tellertje zoals in de lokale
 * adapter zou hier transacties van verschillende requests door elkaar halen.
 *
 * Repositories hoeven niets te weten van deze module: withTenant() in de
 * repositorylaag vraagt via ambientClient() of er al een transactie loopt en
 * voegt zich daarbij. Zo wordt een use-case die meerdere repository-calls
 * doet atomair door hem simpelweg in manager.run(...) te wikkelen · precies
 * de poort-belofte "use-cases migreren zonder wijziging".
 */

const { AsyncLocalStorage } = require("async_hooks");

// Eén ambient-administratie per proces: een transactie is een eigenschap van
// de asynchrone keten, niet van een specifieke manager-instantie.
const ambient = new AsyncLocalStorage();

/** De client van de lopende transactie in deze asynchrone keten, of null. */
function ambientClient() {
  const held = ambient.getStore();
  return held ? held.client : null;
}

/**
 * Maakt een TransactionManager voor een gegeven pg-pool.
 * @param {{ connect: Function }} pool
 */
function makePgTransactionManager(pool) {
  async function run(work) {
    const held = ambient.getStore();
    if (held) {
      // Join: zelfde client, zelfde transactie; de buitenste run beslist.
      return work(held.ctx);
    }

    const client = await pool.connect();
    const ctx = { client, query: (sql, params) => client.query(sql, params) };
    try {
      await client.query("BEGIN");
      const result = await ambient.run({ client, ctx }, () => work(ctx));
      await client.query("COMMIT");
      return result;
    } catch (err) {
      // Rollback is best-effort: als de verbinding zelf stuk is, ruimt de
      // database de transactie op bij het sluiten van de connectie.
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** True zolang er in deze asynchrone keten een transactie loopt. */
  function inTransaction() { return !!ambient.getStore(); }

  return { run, inTransaction, adapter: "postgres" };
}

module.exports = { makePgTransactionManager, ambientClient };
