# ADR-003 · TransactionManager-port (unit-of-work)

Status: geaccepteerd · 2026-07-18
Eigenaar: technisch eigenaar
Bron: docs/spec/vendor-independence-azure.md (F-01, F-02, ports & adapters) + docs/spec/master-specification.md (h5.3 outbox, h6 opslag) + ADR-001, ADR-002

## Context
Meerdere use-cases schrijven binnen één handeling naar meerdere collecties: een
contractperiode genereren maakt een factuur/werkbon, werkt de generatiehistoriek
bij en emit een domeinevent naar de outbox. In de huidige in-memory/JSON-store
gebeurt elke schrijfactie los en wordt de volledige dataset per keer weggeschreven.
Zonder transactiegrens kan een fout halverwege een half-afgemaakte staat achterlaten
(bijvoorbeeld een factuur zonder historiek, wat tot dubbele generatie leidt), en de
transactional outbox (h5.3) is alleen echt atomair als event en domain-write samen
committen.

De productie gaat richting Azure PostgreSQL (ADR-002), maar tijdens development
blijven we op Render + de JSON/bridge-store. De domein- en applicatielaag mogen
daar niet van weten.

## Besluit
1. Er is één poort `src/ports/transaction-manager.js` met het contract
   `run(work): Promise<T>`:
   - voert `work(ctx)` uit met `ctx = { store }` binnen de lopende transactie;
   - commit bij succes en geeft de returnwaarde van `work` terug;
   - rollback bij een fout (opslag exact terug naar de staat vóór `run`) en
     propageert de fout onveranderd;
   - geneste `run()` binnen dezelfde manager voegt zich bij de lopende transactie
     (join-semantiek); de buitenste beslist commit/rollback, zodat samengestelde
     use-cases alles-of-niets blijven.
2. De poort is cloudblind (ADR-001): geen SDK, geen SQL, geen omgevingsvariabelen.
   Applicatie- en domeincode hangen alleen van de poort af, nooit van een adapter.
3. Adapters leven onder `src/infrastructure/`:
   - lokaal nu: `infrastructure/local/transaction-manager.js` neemt een diepe
     momentopname vóór het werk, onderdrukt tussentijdse saves (save-batching:
     één commit-write per unit-of-work) en zet de momentopname terug bij een fout;
   - productie later: een PostgreSQL-adapter komt dezelfde belofte na via
     native `BEGIN`/`COMMIT`/`ROLLBACK` op één connectie. Use-cases wijzigen niet.
4. Best-effort event-listeners (automation, E11) mogen een domain-write nooit
   terugrollen: `notifyListeners` vangt listener-fouten op. Enkel echte domein-
   fouten rollen de transactie terug.
5. Elke adapter moet de herbruikbare contracttest
   `test/transactions.test.js` (`transactionManagerContract`) halen. Zo is de
   migratie een adapter-swap zonder gedragsverschil.

## Gevolgen
- Multi-write use-cases (te beginnen met contractgeneratie) zijn atomair; de
  transactional outbox is echt atomair binnen de transactiegrens.
- Save-batching vermindert het aantal volledige serialisaties per handeling
  (relevant voor de JSON-store; verdwijnt vanzelf bij PostgreSQL).
- De liveness/readiness-split (`/api/health` blijft 200 zolang het proces leeft;
  `/api/ready` geeft 503 bij storage-uitval) laat de orchestrator (K8s/Render/
  Azure) niet onnodig herstarten bij een tijdelijke DB-hapering. `txAdapter` in
  beide endpoints maakt de actieve adapter zichtbaar voor ops.
- Beperking van de lokale adapter: transacties zijn niet concurrent-veilig op
  dezelfde store binnen hun await-venster. Onze wrapped use-cases voeren synchrone
  repository-operaties uit (venster ≈ nul); de PostgreSQL-adapter isoleert vanzelf
  via een eigen connectie per transactie.
