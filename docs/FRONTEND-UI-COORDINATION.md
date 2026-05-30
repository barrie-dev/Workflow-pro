# Frontend UI Coordination

Doel: frontend-werk afstemmen op de sessie "Ontwikkel app roadmap", zodat design, app-roadmap en technische foundation elkaar versterken zonder dubbel werk.

## Rolafbakening

### Roadmap / fullstack sessie

Eigenaarschap:

- Productiefoundation: auth, MFA, JWT, tenant isolation en server-side permissies.
- Datafoundation: Supabase/PostgreSQL adapter, migraties en tenant-scoped repositories.
- Integraties: Stripe, Peppol, webhooks, credential vault en echte providerkoppelingen.
- Go-live rapportage: readiness checks, roadmap status, productiegates en technische blockers.
- API-contracten en backend-validatie.

### Frontend sessie

Eigenaarschap:

- SaaS UI-richting uit de aangeleverde mockups vertalen naar consistente schermen.
- Design system: sidebar, topbar, tabs, KPI-kaarten, tabellen, statusbadges, drawers en contextpanelen.
- UX flows voor bestaande roadmapdoelen: actiecentrum, rapportage, stock/wagenpark, tijd/onkosten, integraties en instellingen.
- Visuele prototypes tonen voordat grotere UI-wijzigingen worden geimplementeerd.
- Frontend aansluiten op bestaande of geplande API-contracten zonder backendlogica te dupliceren.

## Geen Dubbel Werk

- Geen nieuwe roadmapchecks bouwen in de frontend als ze al uit `src/modules/roadmap.js`, `src/modules/go-live.js` of reports komen.
- Geen fake-auth of alternatieve permissielogica toevoegen buiten bestaande rolcontexten; echte afdwinging hoort bij de fullstack sessie.
- Geen tweede data-adapter of lokale opslaglaag maken voor nieuwe UI.
- Geen Stripe, Peppol of KBO simulaties uitbreiden tenzij de roadmap-sessie daar expliciet een frontend contract voor oplevert.
- Geen aparte componentstijl per scherm: nieuwe schermen gebruiken gedeelde layoutpatronen.

## Mockup Mapping Naar Roadmap

| Mockup | Scherm | Roadmapfase | Frontend prioriteit |
| --- | --- | --- | --- |
| 1 | Instellingen, rollen & rechten | Fase 1 Foundation / Fase 2 Core Operations | Rechtenmatrix UI en security contextpanel |
| 2 | Integraties & automatisaties | Fase 3 Billing + Compliance / P2 Integraties | Connector detail, sync logs en automation table |
| 3 | Rapportage | Fase 2 Core Operations / Sales blocker | Managementrapport voor demo en beslisserrapport |
| 4 | Stock & wagenpark | Fase 2 Core Operations | Voorraad, reservering, bestelvoorstel en onderhoudsoverzicht |
| 5 | Tijd & onkosten | Fase 2 Core Operations | Approval flow, payroll readiness en detailpaneel |
| 6 | Actiecentrum | Fase 2 Core Operations / Golden path | Dagelijkse actielijst en assistentprioriteiten |
| 7 | Login | Fase 1 Foundation / Demo mode | Login/demo role selector, later koppelen aan echte auth |

## Frontend Werkvolgorde

1. UI audit: bestaande schermen vergelijken met mockups en roadmapdoelen.
2. Design system normaliseren: layout, kleur, spacing, iconen, badges, tables en panels.
3. Actiecentrum als eerste operationele cockpit uitwerken, omdat dit de meeste roadmapflows samenbrengt.
4. Tijd & onkosten en stock/wagenpark daarna, omdat die direct bijdragen aan pilot readiness.
5. Rapportage aanscherpen voor sales/demo en beslisserrapport.
6. Integraties, instellingen en login pas groter aanpassen wanneer de roadmap-sessie API/auth-contracten stabiliseert.

## Visuele Beslisregel

Bij grotere afwijkingen van de aangeleverde UI-plannen toont de frontend sessie eerst een visueel voorstel of compacte mockup. Kleine consistentieverbeteringen, responsive fixes en componentnormalisatie mogen direct worden uitgevoerd.

## Open Afhankelijkheden

- Definitieve auth provider en login-flow.
- Definitieve permission API voor rollen en rechten.
- API-contracten voor action queue, reports, stock, fleet, expenses en integrations.
- Keuze voor Supabase/PostgreSQL schema en tenant scoping.
- Beslissing over eerste pilotsector, omdat dat labels, lege toestanden en demo-data beinvloedt.
