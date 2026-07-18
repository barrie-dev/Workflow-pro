# Master-specificatie · baseline v1.0 (2026-07-17)

Dit is de bindende baseline voor architectuurbeslissingen, epics, acceptatie en release-gates van Monargo One ("tot de letter volgen, zonder focus of uniekheid te verliezen").

- `master-specification.md` - volledige tekst-extractie van `Monargo_One_Development_Master_Specification1.docx` (bron: OneDrive/Monargo/Development/Robows). 56 hoofdstukken: productbeslissing, doelarchitectuur, strangler-migratie M0-M6, canoniek datamodel, 33 modulespecificaties, workflow-contracten, Mona-contract (h48), roadmap R0-R7 met 22 epics, Definition of Done.
- `developer-requirements.json` - de requirements-catalogus: 36 capability-beslissingen, 761 requirements (business rules, acceptatiecriteria, automatiseringen, edge cases) per module, doelsegmenten en Construction Core-scope.
- `vendor-independence-azure.md` - de infra-handover (v1.0, 2026-07-17): vendor-onafhankelijke architectuur (ports & adapters, cloudblinde domeinlaag), PostgreSQL als portable basis, Azure als eerste productie-adapterset. Tijdens development blijven Render + Supabase de draaiomgeving. Besluiten: `../adr/ADR-001` (vendor independence), `../adr/ADR-002` (PostgreSQL-strategie) en `../adr/ADR-003` (TransactionManager-port / unit-of-work); handhaving via `test/architecture.test.js` en `test/transactions.test.js`.

Werkafspraken:
- Elk nieuw werk wordt getoetst aan roadmapfase, epic en het relevante modulehoofdstuk + requirements.
- Nieuwe domeincode gebruikt Engelse canonical identifiers en genormaliseerde opslag; bestaande flows blijven werken via compatibility-adapters (geen big-bang rewrite).
- Einddirectief (h56): geen geisoleerde menumodules meer; de volgende mijlpaal is de genormaliseerde, policy-veilige, projectgedreven kern.
