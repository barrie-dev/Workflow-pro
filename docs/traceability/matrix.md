# Monargo One · Roadmap-traceability

Bron van waarheid (DEV-01). Gegenereerd op commit `f21c762` · 2026-07-22T18:57:27.611Z.
CTO-gate: https://github.com/barrie-dev/Workflow-pro/issues/40

> De status is afgeleid uit evidence die in de repo bestaat (impl + test + migratie). Een verwijderde test maakt de betrokken epic rood. Wat niet gekoppeld is, telt als niet-bewezen.

**CI-gate (regressie): GROEN** · 0 niet-aanvaarde blocker(s) van 11 (rest in accepted-blockers-baseline).
**Readiness:** pilot (t/m R2) niet klaar · commercieel (t/m R6) niet klaar.

- Releases gate-groen: 0/8 (evidence-groen: 7/8)
- Epics evidence-verified: 22/22 (rood: 0, ongemapt: 0)
- Requirements individueel bewezen: 28/761 (mapped 0, implemented 0, tested 28, accepted 0, unproven 733)
- Definition of Done: 13/15

## Releases R0-R7

Evidence = alle epics hebben impl + test op schijf. Gate = evidence + diepe condities (cutover/tx/e2e) + dependencyvolgorde. Een release kan evidence-groen zijn en gate-rood.

| Release | Prio | Evidence | Gate | Epics | Open condities / blokkade |
| --- | --- | --- | --- | --- | --- |
| R0 Architecture foundation | P0 | GROEN | ROOD | 4/4 | Identity read-cutover naar pg bewezen; Company read-cutover naar pg bewezen; CRM read-cutover naar pg bewezen |
| R1 Complete horizontal flow | P0 | GROEN | ROOD | 7/7 | geblokkeerd door R0; 9 verplichte E2E-scenario's volledig; Finance multi-write rollback bewezen (pg-integratietest); Finance read-cutover naar pg bewezen |
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

## Definition of Done (15 criteria)

| # | Criterium | Status | Bewijs |
| --- | --- | --- | --- |
| 1 | Functional purpose and out-of-scope are documented. | GROEN | requirements + epics met outcome in spec. |
| 2 | Entities and relationships are migrated or created with constraints. | GROEN | 10 SQL-migraties met constraints in migrations/sql/. |
| 3 | State machine and transition permissions are implemented. | GROEN | status/transitie-permissies server-side getest. |
| 4 | UI includes empty, loading, error, conflict and archived states. | GROEN | UI empty/loading/error/conflict/archived via ui-*-tests. |
| 5 | API contract is documented and versioned. | GROEN | gedocumenteerd + versioneerd /v1-contract. |
| 6 | Audit and domain events are emitted. | GROEN | audit + domeinevents getest. |
| 7 | Search, filters and export respect policies. | GROEN | search/filter/export respecteren policies. |
| 8 | Custom fields, files, tasks and activity timeline are integrated where relevant. | GROEN | custom fields/files/tasks/timeline geïntegreerd. |
| 9 | Idempotency and concurrency are tested. | GROEN | idempotentie + concurrency (flush-coalescing) getest. |
| 10 | Unit, integration and end-to-end tests pass. | ROOD | test-suite-bewijs: commitSha 393bcc0 hoort niet bij huidige f21c762 |
| 11 | Tenant isolation and privilege tests pass. | ROOD | security-matrix-bewijs: commitSha 393bcc0 hoort niet bij huidige f21c762 |
| 12 | Accessibility and localization review pass. | GROEN | NL/FR/EN + accessibility-review. |
| 13 | Observability has logs, metrics, error codes and runbook. | GROEN | logs/metrics/foutcodes/runbook. |
| 14 | Migration and rollback are documented. | GROEN | migratie + rollback gedocumenteerd. |
| 15 | Product owner and domain expert accept the scenario. | GROEN | PO-acceptatie ondertekend (governance-artefact). |

## Blokkerend voor de gate

- **condition R0.identity_cutover**: cutover-identity: commitSha 393bcc0 hoort niet bij huidige f21c762 (DEV-03)
- **condition R0.company_cutover**: cutover-company: commitSha 393bcc0 hoort niet bij huidige f21c762 (DEV-03)
- **condition R0.crm_cutover**: cutover-crm: commitSha 393bcc0 hoort niet bij huidige f21c762 (DEV-03)
- **release R1**: geblokkeerd door R0 (dependencyvolgorde)
- **release R2**: geblokkeerd door R0 (dependencyvolgorde)
- **release R3**: geblokkeerd door R0 (dependencyvolgorde)
- **release R4**: geblokkeerd door R0 (dependencyvolgorde)
- **release R5**: geblokkeerd door R0 (dependencyvolgorde)
- **release R6**: geblokkeerd door R0 (dependencyvolgorde)
- **dod tests_pass**: test-suite-bewijs: commitSha 393bcc0 hoort niet bij huidige f21c762
- **dod tenant_isolation**: security-matrix-bewijs: commitSha 393bcc0 hoort niet bij huidige f21c762

## Requirements (per-ID)

761-requirements-baseline. 28/761 zijn INDIVIDUEEL bewezen (getest of aanvaard) via `docs/traceability/requirement-map.json`. Domein-associatie telt niet als bewijs; een ID zonder eigen mapping blijft 'unproven'. Niveaus: {"unproven":733,"mapped":0,"implemented":0,"tested":28,"accepted":0}.
