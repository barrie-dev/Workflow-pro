"use strict";
/**
 * TransactionManager-PORT (E1 · ADR-003).
 *
 * Definieert het contract voor atomaire multi-writes (unit-of-work) los van de
 * opslagtechnologie. De applicatie- en domeinlaag hangen ALLEEN van deze port
 * af; adapters (lokaal/JSON nu, PostgreSQL in productie) implementeren hem.
 * Cloudblind (ADR-001): geen SDK, geen SQL, geen omgevingsvariabelen hier.
 *
 * Contract:
 *   run(work): Promise<T>
 *     - Voert work(ctx) uit. ctx = { store } binnen de lopende transactie.
 *     - Bij succes: commit (alle schrijfacties blijven, worden één keer bewaard)
 *       en geeft de returnwaarde van work terug.
 *     - Bij een fout: rollback (opslag exact terug naar de staat vóór run) en
 *       propageert de fout onveranderd.
 *     - Genest run() binnen dezelfde manager voegt zich bij de lopende
 *       transactie (join): de buitenste run beslist commit/rollback. Zo blijven
 *       samengestelde use-cases alles-of-niets.
 *
 * De PostgreSQL-adapter komt dezelfde belofte na via BEGIN/COMMIT/ROLLBACK op
 * één connectie; use-cases hoeven daarvoor niet te wijzigen (poort-belofte).
 */

/**
 * Bevestigt dat een object de TransactionManager-port implementeert.
 * Puur structureel (duck-typing) zodat elke adapter valideerbaar is zonder
 * overerving of framework.
 */
function isTransactionManager(candidate) {
  return !!candidate && typeof candidate.run === "function";
}

/**
 * Voert een unit-of-work uit tegen een manager; kleine helper zodat aanroepers
 * niet hoeven te weten of ze een echte manager of een no-op hebben.
 */
async function withTransaction(manager, work) {
  if (!isTransactionManager(manager)) {
    throw new Error("withTransaction vereist een TransactionManager (run-methode)");
  }
  return manager.run(work);
}

module.exports = { isTransactionManager, withTransaction };
