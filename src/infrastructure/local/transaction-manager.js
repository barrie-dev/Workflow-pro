"use strict";
/**
 * Lokale TransactionManager-adapter (E1 · ADR-003).
 *
 * Implementeert de TransactionManager-port bovenop de in-memory/JSON-store die
 * we tijdens de ontwikkeling gebruiken. Werkwijze:
 *
 *  - vóór het werk: een diepe momentopname (structuredClone) van store.data;
 *  - tijdens het werk: tussentijdse store.save()-aanroepen worden onderdrukt
 *    (save-batching) zodat een unit-of-work als één commit wegschrijft i.p.v. N;
 *  - bij succes: store.save() herstellen en één keer bewaren (commit);
 *  - bij een fout: de momentopname terugzetten (rollback) en die staat bewaren.
 *
 * De momentopname is diep, dus ook onverhoopte in-place mutaties rollen correct
 * terug. Dat is bewust duurder dan de productie-adapter: PostgreSQL gebruikt
 * native BEGIN/COMMIT/ROLLBACK op één connectie i.p.v. een geheugensnapshot.
 * De poort-belofte (run(work)) is identiek, dus use-cases migreren zonder
 * wijziging (ADR-001/ADR-002).
 *
 * Nesting: een run() binnen een lopende run() voegt zich bij die transactie
 * (join) - de buitenste beslist commit/rollback. Zo blijven samengestelde
 * use-cases alles-of-niets.
 *
 * Aanname (lokale adapter): transacties overlappen niet met andere schrijvers
 * op dezelfde store tijdens hun await-venster. Onze wrapped use-cases voeren
 * synchrone repository-operaties uit, dus dat venster is effectief nul. De
 * PostgreSQL-adapter isoleert vanzelf via een eigen connectie per transactie.
 */

function snapshot(data) {
  // structuredClone is beschikbaar op Node 18+ (de runtime van dit project).
  return structuredClone(data);
}

/**
 * Maakt een TransactionManager voor een gegeven store.
 * @param {{ data: object, save: Function }} store
 */
function makeLocalTransactionManager(store) {
  let depth = 0;

  async function run(work) {
    // Genest: join de lopende transactie; buitenste beslist commit/rollback.
    if (depth > 0) {
      return work({ store });
    }

    depth += 1;
    const before = snapshot(store.data);
    const originalSave = store.save;     // exacte referentie bewaren en herstellen
    let sawWrite = false;
    store.save = () => { sawWrite = true; };

    try {
      const result = await work({ store });
      store.save = originalSave;
      if (sawWrite) store.save();        // commit: één keer wegschrijven
      return result;
    } catch (err) {
      store.save = originalSave;
      store.data = before;               // rollback: exacte staat vóór run
      store.save();                      // teruggezette staat persisteren
      throw err;
    } finally {
      depth -= 1;
      // Vangnet: save mag nooit onderdrukt achterblijven.
      if (depth === 0 && store.save !== originalSave) store.save = originalSave;
    }
  }

  /** True zolang er een transactie loopt (voor diagnostiek/guards). */
  function inTransaction() { return depth > 0; }

  return { run, inTransaction, adapter: "local-memory" };
}

module.exports = { makeLocalTransactionManager };
