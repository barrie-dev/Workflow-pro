"use strict";
// Persistentie-veerkracht: een revisieconflict (typisch de deploy-overlap van
// twee replicas op de ene platform_state-rij) mag NIET stil writes droppen.
// De adapter herlaadt, mergt onze wijzigingen erin (adds van beide instanties
// blijven) en schrijft opnieuw. Getest zonder database via een geïnjecteerde
// pool, plus pure unit-tests op de merge.
const { test } = require("node:test");
const assert = require("node:assert");

const { PostgresDataAdapter, mergeStateInto } = require("../src/infrastructure/postgres/pg-data-adapter");

// ── Merge-logica (puur) ─────────────────────────────────────────────────────
test("merge: rijen-met-id worden verenigd · adds van beide kanten blijven", () => {
  const target = { customers: [{ id: "a", v: "mine" }, { id: "b" }] };
  const incoming = { customers: [{ id: "a", v: "theirs" }, { id: "c" }] };
  mergeStateInto(target, incoming);
  const ids = target.customers.map(r => r.id).sort();
  assert.deepEqual(ids, ["a", "b", "c"], "c (van de andere instantie) toegevoegd, a+b behouden");
  assert.equal(target.customers.find(r => r.id === "a").v, "mine", "bij dezelfde id wint onze versie");
});

test("merge: sleutel die enkel in de database bestaat wordt overgenomen", () => {
  const target = { customers: [] };
  const incoming = { customers: [], invoices: [{ id: "i1" }] };
  mergeStateInto(target, incoming);
  assert.deepEqual(target.invoices, [{ id: "i1" }]);
});

test("merge: scalars en niet-id-arrays houden onze waarde (last-writer-wins)", () => {
  const target = { schemaVersion: 15, tags: ["mine"] };
  const incoming = { schemaVersion: 10, tags: ["theirs"] };
  mergeStateInto(target, incoming);
  assert.equal(target.schemaVersion, 15);
  assert.deepEqual(target.tags, ["mine"]);
});

// ── Herstel via de flush-adapter (geïnjecteerde pool) ────────────────────────
// Pool die de EERSTE state-UPDATE laat conflicteren (0 rijen), daarna slaagt;
// de tussentijdse SELECT levert de staat van de "andere instantie" met een
// extra rij, zodat we kunnen bewijzen dat die rij ná de merge bewaard blijft.
function conflictOncePool() {
  let selects = 0, stateUpdates = 0;
  let written = null;
  const calls = [];
  const runQuery = async (sql, params) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    calls.push({ sql: s, params });
    if (/^CREATE TABLE/i.test(s) || /^BEGIN|^COMMIT|^ROLLBACK/i.test(s)) return { rows: [] };
    if (/^SELECT/i.test(s)) {
      selects++;
      // 1e SELECT = loadAsync: alleen de basisrij. 2e SELECT = conflict-reload:
      // de andere instantie heeft intussen "theirs" toegevoegd.
      const data = selects === 1
        ? { customers: [{ id: "base" }] }
        : { customers: [{ id: "base" }, { id: "theirs" }] };
      return { rows: [{ data, revision: 4 }] };
    }
    if (/^INSERT INTO outbox/i.test(s)) return { rows: [] };
    if (/SET data =/.test(s)) {                             // state-UPDATE
      stateUpdates++;
      if (stateUpdates === 1) return { rows: [] };          // eerste poging: conflict
      written = params[1];                                  // tweede poging slaagt
      return { rows: [{ revision: 5 }] };
    }
    return { rows: [] };
  };
  return {
    calls, totalCount: 1, idleCount: 1, waitingCount: 0,
    query: runQuery,
    async connect() { return { query: runQuery, release() {} }; },
    async end() {},
    _written: () => written,
  };
}

test("flush: revisieconflict wordt hersteld · onze én hun rij blijven bewaard", async () => {
  const pool = conflictOncePool();
  const adapter = new PostgresDataAdapter({ pool });
  const data = await adapter.loadAsync(() => ({ customers: [] }));   // laadt {customers:[{id:base}]} @rev 4

  // Onze instantie voegt een klant toe (op basis van de geladen staat).
  data.customers.push({ id: "mine" });
  adapter.save(data);
  const res = await adapter.flush();

  assert.equal(res.written, true, "flush slaagt na herstel i.p.v. te droppen");
  assert.equal(adapter.mergeRecoveries, 1, "precies één merge-herstel");
  assert.equal(adapter.revision, 5);
  const finalIds = pool._written().customers.map(r => r.id).sort();
  assert.deepEqual(finalIds, ["base", "mine", "theirs"], "geschreven staat bevat onze (mine) én hun (theirs) toevoeging");
  assert.equal(adapter.isDirty(), false, "niets blijft hangen");
});
