# Monargo One · Roadmap-traceability

Bron van waarheid (DEV-01). Gegenereerd op commit `52f429d` · 2026-07-21T16:23:01.672Z.
CTO-gate: https://github.com/barrie-dev/Workflow-pro/issues/40

> De status is afgeleid uit evidence die in de repo bestaat (impl + test + migratie). Een verwijderde test maakt de betrokken epic rood. Wat niet gekoppeld is, telt als niet-bewezen.

**Gate: ROOD** · P0-releases rood · DoD groen

- Releases gate-groen: 0/8 (evidence-groen: 7/8)
- Epics evidence-verified: 22/22 (rood: 0, ongemapt: 0)
- Requirements gedekt door verified epic: 693/761
- Definition of Done: 9/9

## Releases R0-R7

Evidence = alle epics hebben impl + test op schijf. Gate = evidence + diepe condities (cutover/tx/e2e) + dependencyvolgorde. Een release kan evidence-groen zijn en gate-rood.

| Release | Prio | Evidence | Gate | Epics | Open condities / blokkade |
| --- | --- | --- | --- | --- | --- |
| R0 Architecture foundation | P0 | GROEN | ROOD | 4/4 | Identity read-cutover naar pg bewezen; Company read-cutover naar pg bewezen; CRM read-cutover naar pg bewezen |
| R1 Complete horizontal flow | P0 | GROEN | ROOD | 7/7 | geblokkeerd door R0; 9 verplichte E2E-scenario's volledig; Finance-mutaties via pg TransactionManager; Finance read-cutover naar pg bewezen |
| R2 Construction Core | P0/P1 | GROEN | ROOD | 1/1 | geblokkeerd door R0 |
| R3 Service & Assets | P1 | GROEN | ROOD | 1/1 | geblokkeerd door R0 |
| R4 Project finance and contracts | P1 | GROEN | ROOD | 2/2 | geblokkeerd door R0; Projectfinance database-native transactioneel |
| R5 Procurement and inventory | P2 | GROEN | ROOD | 3/3 | geblokkeerd door R0 |
| R6 Switcher and ecosystem | P1/P2 | GROEN | ROOD | 4/4 | geblokkeerd door R0 |
| R7 Construction Advanced | P3 | ROOD | ROOD | 0/0 | Geen epics gekoppeld · bewust gated tot R0-R6 voldoen. |

## Epics E01-E22

| Epic | Release | Prio | Status | Tests | Ontbrekend bewijs | Open risico |
| --- | --- | --- | --- | --- | --- | --- |
| E01 Canonical Company and tenant context | R0 | P0 | GROEN | 3 | - | platform_state-singleton nog leidend voor schrijven |
| E02 Policy engine | R0 | P0 | GROEN | 3 | - | volledige padenscan (UI/API/export/search) nog niet uitputtend |
| E03 Normalized CRM | R0 | P0 | GROEN | 4 | - | read source staat standaard op legacy; cutover nog niet vrijgegeven |
| E04 Project aggregate | R1 | P0 | GROEN | 2 | - | project nog niet genormaliseerd als primaire runtime |
| E05 Quote versioning | R1 | P0 | GROEN | 4 | - | - |
| E06 Unified planning | R1 | P0 | GROEN | 2 | - | - |
| E07 Mobile work order v2 | R1 | P0 | GROEN | 3 | - | offline foto-upload/duplicaat/conflict nog niet volledig E2E bewezen |
| E08 Invoice v2 | R1 | P0 | GROEN | 8 | - | kritieke financiële mutaties nog niet aantoonbaar via pg TransactionManager (DEV-04) |
| E09 Work Inbox | R1 | P1 | GROEN | 4 | - | - |
| E10 Configuration platform | R0 | P0 | GROEN | 1 | - | - |
| E11 Automation engine | R6 | P1 | GROEN | 1 | - | - |
| E12 Construction Core | R2 | P0/P1 | GROEN | 5 | - | mobiele bewijsflow en project-financekoppeling verder te bewijzen |
| E13 Catalog and material | R5 | P1 | GROEN | 2 | - | - |
| E14 Project financials | R4 | P1 | GROEN | 3 | - | commitments/actuals/forecast nog niet genormaliseerd transactioneel |
| E15 Contracts and recurring | R4 | P1 | GROEN | 2 | - | - |
| E16 Assets and maintenance | R3 | P1 | GROEN | 2 | - | - |
| E17 Inventory foundation | R5 | P2 | GROEN | 2 | - | immutable stock nog niet volledig database-native |
| E18 Procurement foundation | R5 | P2 | GROEN | 2 | - | purchase-to-project-cost nog niet volledig database-native |
| E19 Integration runtime | R6 | P1 | GROEN | 5 | - | echte connectorhealth en parallel run nog af te ronden |
| E20 Robaws importer | R6 | P1 | GROEN | 2 | - | - |
| E21 Mona governance | R6 | P1 | GROEN | 5 | - | AI-governance (bron/confidence/confirmatie) verder te hardenen (DEV-12) |
| E22 Insights read models | R1 | P1 | GROEN | 1 | - | - |

## Definition of Done

| Criterium | Status | Bewijs |
| --- | --- | --- |
| Spec-baseline aanwezig | GROEN | developer-requirements.json bevat de DoD-lijst. |
| Migratiepad geïmplementeerd | GROEN | 7 SQL-migraties in migrations/sql/. |
| Server-side permissies getest | GROEN | test/policy.test.js aanwezig. |
| Audit + domeinevents getest | GROEN | test/audit-log.test.js + test/events.test.js aanwezig. |
| Cloudblinde architectuurtest | GROEN | test/architecture.test.js bewaakt de poort/adapter-grenzen. |
| E2E draait in CI | GROEN | ci.yml roept test:e2e aan. |
| NL/FR/EN aanwezig | GROEN | public/js/i18n.js met de drie taalblokken. |
| Deploy-runbook aanwezig | GROEN | docs/DEPLOY-RUNBOOK.md aanwezig. |
| Alle epics evidence-verified | GROEN | Elke E01-E22 heeft bestaande impl + test. |

## Blokkerend voor de gate

- **condition R0.identity_cutover**: cutover-identity.json ontbreekt · read source staat standaard op legacy (DEV-03).
- **condition R0.company_cutover**: cutover-company.json ontbreekt (DEV-03).
- **condition R0.crm_cutover**: cutover-crm.json ontbreekt (DEV-03).
- **release R1**: geblokkeerd door R0 (dependencyvolgorde)
- **release R2**: geblokkeerd door R0 (dependencyvolgorde)

## Requirements

761-requirements-baseline uit `docs/spec/developer-requirements.json`. 693/761 vallen onder een evidence-verified epic. De rest is nog niet individueel bewezen: Geen genormaliseerd epic; dekking via legacy-module, niet individueel bewezen.
