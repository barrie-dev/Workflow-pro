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

## Backend-terugkoppeling op de handoff — 2026-07-16 (avond)

Alle P0-punten uit `Monargo-One-backend-handoff.docx` zijn geland. Non-breaking: bestaande velden en flows blijven werken; onderstaande velden zijn toegevoegd.

| Contract | Wijziging | Detail |
| --- | --- | --- |
| Error envelope | uitgebreid | Elke JSON-fout draagt naast `error` nu ook `message` (alias), `requestId` (`req_…`, ook als `x-request-id` header op elke respons) en waar van toepassing `code` en `fieldErrors`. 500-fouten loggen het `requestId` mee in de error-log. |
| `GET /api/me` | veld toegevoegd | `capabilities: { mail: boolean }` — `false` betekent: geen actieve mailprovider; verzendknoppen tonen setup-uitleg. |
| `POST /offertes/:id/send` | delivery-contract | Respons bevat `delivery: { status: disabled/sent/failed, reason?, provider?, to?, retryable? }` + `acceptUrl`. Offerte-status (`verzonden`) is de in-app-waarheid; `delivery` beschrijft uitsluitend de e-mail en liegt nooit bij ontbrekende provider (`disabled` · `mail_not_configured`) of ontbrekende klant-e-mail (`failed` · `no_recipient`). |
| `POST /offertes/:id/convert` | idempotent | Tweede conversie geeft het bestaande document terug met `alreadyConverted: true` en `code: QUOTE_ALREADY_CONVERTED` (200). Afgewezen offertes: 409 `QUOTE_REJECTED`. |
| `POST/PATCH /planning` | conflicten | Overlappende shift van dezelfde medewerker: 409 `SHIFT_OVERLAP` met `conflict: { shiftId, date, start, end, venueId }`. Verlofconflict: 409 `LEAVE_CONFLICT` met `conflict`. PATCH valideert nu ook tijdvolgorde, verplichte velden en tenant-eigendom. |
| `PATCH /facturen/:id` | statusguard | Status-whitelist `open/paid/overdue/cancelled` (400 `INVALID_STATUS`); `paid` is eindtoestand (409 `INVOICE_PAID_FINAL`). DELETE van een verzonden factuur: 409 `INVOICE_ALREADY_SENT`. |
| `POST /api/admin/users/:id/activation-link` | nieuw | Superadmin-actie (platformscope `tenants`, geauditeerd): geeft een verse activatielink voor een wachtwoordloos pending account, zonder mail-afhankelijkheid. Actieve accounts of accounts met wachtwoord: 409 `NOT_PENDING` — nooit een reset. Hiermee is o.a. `barrie@abmsconsultancy.be` op de QA-omgeving activeerbaar. |

Al gedekt, geen actie nodig: `GET /api/plans` (trialDays + catalogus), pending registratie/reseller, onboarding-persistentie, servertotalen/btw/nummering, werkbon→factuur-idempotentie (409), tenant-isolatie met server-side rollen, betaallink met expliciete `provider: stripe/mock`.

Procesafspraak na het merge-incident van vandaag: frontend-branches vóór merge rebasen op actuele `main`. De frontend-PR's (#4-#18) vertrokken van een oudere snapshot en overschreven daarbij de op 15/07 gereleasede modules Afspraken, Werkongevallen, Klantvragen-inbox en AI-estimatie (hersteld in commit 4f669bd, SW wfp-v75). Gedeelde bestanden: `public/js/platforms/*.js`, `public/js/i18n.js`, `public/sw.js`.


## Stock en wagenpark — frontendintegratie 2026-07-18

De bestaande stock- en wagenparkflows zijn frontendmatig genormaliseerd naar dezelfde rustige Monargo operations-workspace. Deze release verandert geen domeinlogica: zoeken, stockmutaties, voertuigbeheer, kilometerregistratie en onderhoud blijven de bestaande API-contracten en server-side autorisatie gebruiken.

| UI-flow | Bestaand contract | UI-gedrag |
| --- | --- | --- |
| Stockoverzicht | `GET /api/tenants/:tenantId/stock` | Toont artikel-KPI's, totale stockwaarde, lage-voorraadwaarschuwingen en een lokale zoekfilter. |
| Stockartikel beheren | `POST/PATCH/DELETE /api/tenants/:tenantId/stock/:id?` | Bestaande drawerflow; servervalidatie en tenant-eigendom blijven leidend. |
| Stockmutatie | `POST /api/tenants/:tenantId/stock/:id/mutations` | Positieve en negatieve mutaties blijven expliciete domeinacties met reden en datum. |
| Wagenparkoverzicht | `GET /api/tenants/:tenantId/vehicles` | Toont voertuigen, status, chauffeur, kilometerstand, volgende service en bestaande alerts. |
| Voertuig en kilometerstand | bestaande `/vehicles` CRUD en `POST /vehicles/:id/mileage` | Bestaande drawers blijven de enige mutatieroute; de UI voegt geen lokale statuslogica toe. |

Feedback voor de backendontwikkelaar:

- Voor deze UI-release is geen nieuw endpoint nodig; behoud de bestaande non-breaking responses.
- Geef alerts op termijn stabiele `id`, `type`, `severity`, `message`, `entityId` en optioneel `dueAt`, zodat de UI niet op vrije tekst hoeft te sturen.
- Lever canonieke voertuigstatussen en stockeenheden wanneer het datamodel stabiliseert; de frontend vertaalt labels, maar beslist geen statusovergangen.
- Bewaar stockmutaties als append-only audittrail met actor, tijdstip, delta, reden en resulterende hoeveelheid. De UI mag een actuele hoeveelheid tonen, maar niet zelf de boekhouding reconstrueren.
- Voor grotere tenants zijn server-side `query`, filters, sortering en paging wenselijk op stock en voertuigen. De huidige lokale zoekfilter is alleen geschikt voor beperkte datasets.
- Blijf onderhouds- en lage-voorraaddrempels server-side berekenen. De frontend presenteert de waarschuwing en dupliceert de bedrijfsregel niet.
