"use strict";
/**
 * TransactionManager-contract (E1 · ADR-003).
 *
 * `transactionManagerContract` is een herbruikbare testsuite die het poort-
 * gedrag vastlegt: commit bij succes, volledige rollback bij een fout, één
 * commit-write dankzij save-batching, en join-semantiek bij nesting. Elke
 * adapter (lokaal nu, PostgreSQL later) moet exact deze suite halen - zo is
 * de migratie een adapter-swap zonder gedragsverschil.
 */
const { test } = require("node:test");
const assert = require("node:assert");

const { isTransactionManager, withTransaction } = require("../src/ports/transaction-manager");
const { makeLocalTransactionManager } = require("../src/infrastructure/local/transaction-manager");

/**
 * @param {string} name adapternaam voor de testtitels
 * @param {() => { store: object, manager: object }} setup levert verse store+manager
 */
function transactionManagerContract(name, setup) {
  test(`${name}: implementeert de port (run)`, () => {
    const { manager } = setup();
    assert.ok(isTransactionManager(manager), "manager heeft een run-methode");
  });

  test(`${name}: commit bij succes en geeft de returnwaarde terug`, async () => {
    const { store, manager } = setup();
    const out = await manager.run(async ({ store: s }) => {
      s.insert("customers", { id: "c1", tenantId: "t1", name: "Alpha" });
      s.insert("invoices", { id: "i1", tenantId: "t1", customerId: "c1", total: 100 });
      return "ok";
    });
    assert.equal(out, "ok");
    assert.equal(store.list("customers", "t1").length, 1);
    assert.equal(store.list("invoices", "t1").length, 1);
  });

  test(`${name}: rollback bij een fout - geen enkele schrijfactie blijft`, async () => {
    const { store, manager } = setup();
    store.insert("customers", { id: "c0", tenantId: "t1", name: "Bestaand" }); // vóór de tx
    await assert.rejects(
      manager.run(async ({ store: s }) => {
        s.insert("customers", { id: "c1", tenantId: "t1", name: "Alpha" });
        s.update("customers", "c0", { name: "Gewijzigd" });
        s.insert("invoices", { id: "i1", tenantId: "t1", total: 100 });
        throw new Error("boem halverwege");
      }),
      /boem halverwege/
    );
    // c1 en i1 zijn weg; c0 heeft de oude naam terug.
    assert.equal(store.get("customers", "c1"), undefined, "nieuwe klant teruggerold");
    assert.equal(store.get("invoices", "i1"), undefined, "nieuwe factuur teruggerold");
    assert.equal(store.get("customers", "c0").name, "Bestaand", "wijziging teruggerold");
    assert.equal(store.list("invoices", "t1").length, 0);
  });

  test(`${name}: remove binnen een gefaalde tx rolt terug`, async () => {
    const { store, manager } = setup();
    store.insert("customers", { id: "c0", tenantId: "t1", name: "Blijft" });
    await assert.rejects(manager.run(async ({ store: s }) => {
      s.remove("customers", "c0");
      assert.equal(s.get("customers", "c0"), undefined, "binnen tx echt verwijderd");
      throw new Error("stop");
    }), /stop/);
    assert.ok(store.get("customers", "c0"), "verwijderde rij is terug na rollback");
  });

  test(`${name}: save-batching - één commit-write voor de hele unit-of-work`, async () => {
    const { store, manager } = setup();
    let saves = 0;
    const realSave = store.save.bind(store);
    store.save = () => { saves += 1; realSave(); };
    await manager.run(async ({ store: s }) => {
      s.insert("customers", { id: "c1", tenantId: "t1" });
      s.insert("customers", { id: "c2", tenantId: "t1" });
      s.insert("customers", { id: "c3", tenantId: "t1" });
    });
    assert.equal(saves, 1, "3 inserts -> precies 1 wegschrijfactie");
  });

  test(`${name}: nesting joint de transactie (alles-of-niets)`, async () => {
    const { store, manager } = setup();
    await assert.rejects(manager.run(async ({ store: s }) => {
      s.insert("customers", { id: "cOuter", tenantId: "t1" });
      await manager.run(async ({ store: s2 }) => {
        s2.insert("customers", { id: "cInner", tenantId: "t1" });
      });
      // Beide bestaan binnen de transactie...
      assert.equal(s.list("customers", "t1").length, 2);
      throw new Error("buitenste faalt");
    }), /buitenste faalt/);
    // ...maar de buitenste rollback verwijdert ook het geneste werk.
    assert.equal(store.list("customers", "t1").length, 0, "genest werk mee teruggerold");
  });

  test(`${name}: withTransaction-helper delegeert naar run`, async () => {
    const { store, manager } = setup();
    const out = await withTransaction(manager, async ({ store: s }) => {
      s.insert("customers", { id: "cX", tenantId: "t1" });
      return 42;
    });
    assert.equal(out, 42);
    assert.ok(store.get("customers", "cX"));
  });

  test(`${name}: save blijft hersteld na een fout (geen lekkende override)`, async () => {
    const { store, manager } = setup();
    const before = store.save;
    await assert.rejects(manager.run(async () => { throw new Error("x"); }), /x/);
    assert.equal(store.save, before, "store.save is teruggezet na rollback");
    // En een gewone schrijfactie erna werkt nog.
    store.insert("customers", { id: "cAfter", tenantId: "t1" });
    assert.ok(store.get("customers", "cAfter"));
  });
}

/** Minimalistische in-memory store met dezelfde API-vorm als de echte Store. */
function makeFakeStore() {
  const data = { customers: [], invoices: [] };
  const store = {
    data,
    list(col, tid) { const r = this.data[col] || []; return tid == null ? r : r.filter(x => x.tenantId === tid); },
    get(col, id) { return (this.data[col] || []).find(x => x.id === id); },
    insert(col, row) { (this.data[col] = this.data[col] || []).push(row); this.save(); return row; },
    update(col, id, patch) { this.data[col] = (this.data[col] || []).map(x => x.id === id ? { ...x, ...patch } : x); this.save(); return this.get(col, id); },
    remove(col, id) { this.data[col] = (this.data[col] || []).filter(x => x.id !== id); this.save(); },
    save() {},
  };
  return store;
}

// Contract toegepast op de lokale adapter.
transactionManagerContract("local-memory", () => {
  const store = makeFakeStore();
  return { store, manager: makeLocalTransactionManager(store) };
});
