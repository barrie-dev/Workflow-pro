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

## Login en registratie — backendhandoff 2026-07-16

De publieke toegangservaring is frontendmatig afgerond en gebruikt de officiële Monargo One-identiteit. Voor de backendontwikkelaar gelden deze bestaande contracten als grens:

| UI-flow | Bestaand contract | Verwachting van backend |
| --- | --- | --- |
| Trial en pakketten | `GET /api/plans` | Levert `trialDays` en per plan minstens `key` en `baseMonthly`; de UI toont deze waarden als bron van waarheid. |
| Bedrijfsregistratie | `POST /api/auth/register` | Ontvangt `companyName`, `name`, `email`, `plan`, `vatNumber`, `billingPeriod`; account blijft veilig pending tot activatie. |
| Resellerregistratie | `POST /api/resellers/apply` | Ontvangt `name` en `email`; aanvraag blijft pending tot beoordeling en goedkeuring. |
| Activatie | bestaande activatieflow | Geen tijdelijk of gedeeld wachtwoord introduceren; bestaande wachtwoorden nooit resetten vanuit signup. |
| Testmail | Render QA-omgeving | Mail is momenteel niet actief. De UI meldt dit eerlijk in NL, FR en EN en belooft daar geen activatiemail. |

Nog te borgen door backend/mailbeheer:

- Houd `trialDays` centraal configureerbaar via `/api/plans`; de zichtbare fallback is 14 dagen.
- Laat planprijzen en beschikbaarheid uit dezelfde catalogus komen als checkout en facturatie.
- Publiceer de publieke prijsvergelijking op de marketingwebsite, niet op de login. De login toont alleen productwaarde en de trial-CTA; pakketkeuze volgt pas in de registratieflow.
- Laat de marketingwebsite desgewenst deep-linken met `?plan=<key>&period=<year|month>`; de registratie-UI kan die keuze al vooraf selecteren.
- Bewaar resellergoedkeuring als expliciete statusovergang; publieke aanvraag mag niet meteen kunnen inloggen.
- Activeer mail pas met een echte provider, geldige afzenderdomeinen en gecontroleerde activatie-/resettemplates.
- Geef in de testomgeving alleen een `activationLink` terug wanneer dat bewust en veilig als testhulpmiddel is ingeschakeld.

## Actiecentrum — frontendintegratie 2026-07-16

Het tenant-admin Actiecentrum is frontendmatig toegevoegd als dagelijkse cockpit. Het is bewust een shell-view en dus geen nieuw backend-entitlement: de UI toont alleen acties uit modules die al in de bestaande tenant-entitlements beschikbaar zijn. Server-side permissies op de onderliggende endpoints blijven de bron van waarheid.

De eerste versie aggregeert read-only gegevens uit bestaande contracten:

| Actietype | Bestaand contract | UI-gedrag |
| --- | --- | --- |
| Notificaties | `GET /api/tenants/:tenantId/notifications` | Ongelezen meldingen verschijnen als opvolging of kritiek op basis van bestaande prioriteit. |
| Melding afronden | `POST /api/tenants/:tenantId/notifications/:id/read` | Alleen dit type krijgt een directe knop `Klaar`; andere domeinobjecten worden niet vanuit de cockpit gemuteerd. |
| Verlofgoedkeuring | `GET /api/tenants/:tenantId/leaves?status=aangevraagd` | Opent de bestaande verlofflow voor beoordeling. |
| Onkostengoedkeuring | `GET /api/tenants/:tenantId/expenses` | Pending/ingediende onkosten openen de bestaande onkostenflow. |
| Vervallen facturen | `GET /api/tenants/:tenantId/facturen` | Vervallen of open facturen na hun vervaldag krijgen kritieke prioriteit. |
| Achterstallige werkbonnen | `GET /api/tenants/:tenantId/workorders` | Actieve werkbonnen met een verstreken plandatum openen de bestaande werkbonflow. |

Feedback voor de backendontwikkelaar:

- Voor deze UI-release is geen nieuw endpoint nodig; voorkom dubbel werk zolang de bestaande responses performant blijven.
- Een later geconsolideerd `GET /api/tenants/:tenantId/action-center` kan nuttig worden wanneer paging, SLA-prioriteiten of grote datasets nodig zijn. Laat dat endpoint dan stabiele `id`, `type`, `priority`, `title`, `context`, `dueAt`, `targetView` en optioneel toegestane `actions` leveren.
- Autoriseer elk onderliggend object server-side. `targetView` of een verborgen frontendmodule mag nooit als permissiecontrole gelden.
- Lever canonieke status- en prioriteitswaarden wanneer het datamodel wordt gestabiliseerd; de frontend normaliseert voorlopig bestaande Nederlandse en Engelse varianten voor backwards compatibility.
- Houd mutaties domeinspecifiek. Goedkeuren, weigeren, factuurstatus aanpassen en werkbon afronden blijven in hun bestaande flows met de bestaande validatie en audittrail.
