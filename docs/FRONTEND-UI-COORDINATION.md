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


## Managementrapportage — frontendintegratie 2026-07-18

De tenant-adminrapportage is frontendmatig genormaliseerd naar een rustige Monargo Intelligence-workspace. De bestaande periodefilter, KPI's, uren, onkosten, verlof, werkbonstatus, loonlijst, klantwinstgevendheid, CSV-export en het printbare beslissersrapport blijven behouden. De frontend presenteert bestaande gegevens en introduceert geen tweede financiële bron van waarheid.

| UI-flow | Bestaand contract | UI-gedrag |
| --- | --- | --- |
| Periodeoverzicht | bestaande `GET /clocks`, `/expenses`, `/leaves`, `/workorders`, `/employees` en `/facturen` | Laadt de gekozen periode en bouwt de bestaande KPI- en detailkaarten. |
| CSV-export | huidige client-side export | Exporteert alleen de reeds geladen tenantdata voor uren, onkosten, verlof, werkbonnen, loonlijst en klantwinstgevendheid. |
| Beslissersrapport | huidige printflow + `POST /reports/log` | Genereert een printbaar rapport en registreert het bestaande pilot-event. |
| Klantwinstgevendheid | bestaande facturen, werkbonnen, klokken en goedgekeurde onkosten | Toont omzet excl. btw, openstaand, uren en onkosten; loonkost wordt expliciet niet als marge voorgesteld. |

Feedback voor de backendontwikkelaar:

- Voor deze UI-release is geen nieuw endpoint nodig; behoud de bestaande responses non-breaking.
- De huidige aggregatie over meerdere endpoints is geschikt voor QA en beperkte datasets. Voor productie en grotere tenants is een tenant-scoped rapportagecontract wenselijk met server-side periodefiltering en canonieke totalen.
- Een later `GET /api/tenants/:tenantId/reports/management?from=&to=` kan stabiele `totals`, `timeByEmployee`, `expenseSummary`, `leaveSummary`, `workorderStatus`, `payrollRows` en `customerProfitability` leveren.
- Bereken omzet, btw, betaalstatus en financiële totalen uitsluitend server-side. Als echte marge wordt toegevoegd, lever dan expliciet welke kostencomponenten zijn inbegrepen; de frontend mag loonkost of marge niet schatten.
- Gebruik voor zware rapporten materialized views of vooraf berekende aggregaties met een zichtbare `generatedAt` en tijdzone. De UI moet kunnen tonen hoe recent de cijfers zijn.
- Voor PDF/CSV op grote datasets is een asynchrone exportqueue wenselijk met `jobId`, `status`, `format`, `requestedAt`, `completedAt`, veilige download-URL en vervaltijd.
- Autoriseer rapportsecties en exports server-side volgens tenant, rol en financieel recht; een verborgen kaart of knop is nooit een permissiecontrole.


## Integraties en Automation Studio — frontendintegratie 2026-07-18

Het bestaande Integratiecentrum is frontendmatig genormaliseerd rond providerstatus, verbinden, synchroniseren, Robaws-document-sync en sleutelbeheer. De UI gebruikt de bestaande integratieregistry en bouwt geen alternatieve credentialopslag of providersimulatie.

| UI-flow | Bestaand contract | UI-gedrag |
| --- | --- | --- |
| Providercatalogus | `GET /integrations` | Groepeert providers per categorie en toont verbindings- en syncstatus. |
| Verbinden/herverbinden | `POST /integrations/connect` | Verstuurt bestaande providerconfig; secrets worden nooit opnieuw zichtbaar gemaakt. |
| Synchroniseren | `POST /integrations/:id/sync` | Toont voortgang en resultaat uit de bestaande syncrespons. |
| Robaws-documenten | `POST /integrations/:id/sync-documents` | Toont bestaande project- en documenttotalen na synchronisatie. |

Feedback voor de backendontwikkelaar:

- Voor het bestaande Integratiecentrum is geen nieuw endpoint nodig; houd providerkeys, velden en statuswaarden stabiel en non-breaking.
- Laat de backend secrets versleutelen, maskeren en roteren. De frontend mag nooit opgeslagen credentials teruglezen of als verbindingsbewijs behandelen.
- Lever per sync een stabiele `runId`, `status`, `startedAt`, `completedAt`, `processed`, `failed`, foutcode en veilige samenvatting, zodat voortgang en retry betrouwbaar kunnen worden getoond.
- Automation Studio heeft nog geen stabiele route of workflowcontract en is daarom bewust niet als nepflow toegevoegd. Voor frontendimplementatie is minimaal nodig: `GET/POST/PATCH /workflows`, versie/publicatiestatus, triggers, condities, acties, validatieresultaat en tenant-scoped run logs.
- Een workflowactie moet alleen server-side toegestane actietypes en doelmodules kunnen gebruiken. Publiceren en uitvoeren vereisen auditmetadata, idempotentie en expliciete permissies.
- Voorzie voor connector- en workflowfouten canonieke codes met `requestId`; vrije providertekst mag alleen ondersteunende context zijn.


## Instellingen, rechten en security — frontendintegratie 2026-07-18

De tenantinstellingen zijn frontendmatig genormaliseerd naar één Control Center voor bedrijfsgegevens, abonnement, MFA, backupbeleid, wachtwoord, GDPR-supporttoegang, SSO en module-instellingen. De medewerkerdrawer toont de bestaande modulegebonden niveaus Geen, Lezen en Schrijven in een leesbare rechtenmatrix.

Feedback voor de backendontwikkelaar:

- Server-side rollen, entitlements en grantable permissions blijven de enige bron van waarheid. De frontend verstuurt keuzes, maar mag geen rechten escaleren of afleiden uit verborgen bediening.
- Behoud `GET /api/me`, settings-, MFA-, backup-, support-access- en SSO-responses non-breaking en lever bij fouten het bestaande `requestId`, `code` en `fieldErrors`.
- Lever bij rechten naast de grantable key een stabiel labelkey, toegestane niveaus en eventueel reden waarom een niveau niet beschikbaar is. Zo hoeft de frontend geen pakket- of rolmatrix te dupliceren.
- Mailafhankelijke toggles en acties moeten `capabilities.mail` respecteren. Wanneer mail uitstaat, moet de backend geen success claimen en een veilige setupreden teruggeven.
- Supporttoegang, MFA-enforcement, accountactivatie en SSO-configuratiewijzigingen vereisen auditmetadata en server-side herauthenticatie waar het risico dat vraagt.
- Wachtwoordloze pending accounts gebruiken de bestaande activatielinkflow; bestaande wachtwoorden worden niet impliciet gereset vanuit registratie of activatie.


## Mona AI-assistent — frontendintegratie 2026-07-18

De gedeelde assistent presenteert zich in alle zichtbare UI consequent als **Mona**. De interne module- en endpointnaam `/boden` blijft voorlopig behouden om bestaande backendcontracten niet te breken. De interface is vergroot naar een leesbaar werkpaneel, gebruikt Monargo Blue uitsluitend voor primaire acties en wordt op kleine schermen vrijwel schermvullend.

| Interactie | Bestaand contract | UI-gedrag |
| --- | --- | --- |
| Vraag stellen | `POST /api/tenants/:tenantId/boden` met `messages` | Toont het antwoord in de conversatie en bewaart alleen de beperkte recente context. |
| Navigatievoorstel | `proposal.action = navigate` met toegestane `params.view` | Opent de bestaande productview; Mona voert geen domeinmutatie uit. |
| Mutatievoorstel | Server-goedgekeurde `path`, `method` en `params` | Vereist een expliciete bevestiging en toont daarna resultaat of herstelbare fout. |

Feedback voor de backendontwikkelaar:

- Lever per voorstel een stabiele `id`, `label`, `action`, `risk`, `confirmation`, `path`, `method`, `params`, vereiste permissie en `expiresAt`.
- Accepteer nooit willekeurige clientpaden. Gebruik een server-side allowlist, tenant-scoping en dezelfde autorisatie als de onderliggende domeinactie.
- Maak mutaties idempotent, registreer actor, voorstel en resultaat in de audittrail en geef een `requestId` terug bij fouten.
- Onderscheid in het responsecontract expliciet een informatief antwoord, navigatie en mutatie; alleen mutaties krijgen een bevestigingsactie.
- Geef geen secrets of onnodige persoonsgegevens mee in promptcontext of foutmeldingen. De backend blijft bron van waarheid voor rechten en datascoping.
- Streaming kan later als progressieve verbetering worden toegevoegd; het huidige JSON-contract moet bruikbaar blijven als fallback.


## Ruime create- en editworkspaces — frontendintegratie 2026-07-18

De gedeelde tenant-admin drawer is vervangen door een ruime werkruimte. Reguliere formulieren gebruiken tot 820 px; document- en personeelsflows zoals facturen, offertes, werkbonnen en medewerkers gebruiken tot 1080 px. Op mobiel worden deze flows volledig schermvullend. Hierdoor blijven labels, documentregels, totalen en acties leesbaar zonder de onderliggende domeinlogica te wijzigen.

Frontendregel:

- Een korte bevestiging of enkelvoudige mutatie mag compact blijven.
- Een aanmaak- of bewerkflow met meerdere secties, documentregels of rechten opent als ruime workspace.
- Primaire acties blijven zichtbaar onderaan; velden worden op mobiel één kolom.
- Nieuwe complexe formulieren moeten een herkenbaar formulier-id of workspacevariant gebruiken, zodat ze automatisch dezelfde breedte en responsive regels krijgen.

Feedback voor de backendontwikkelaar:

- Er wijzigen geen endpoints, payloads, validaties of permissies door deze UI-release.
- Blijf veldfouten leveren via `fieldErrors` met `code` en `requestId`, zodat langere formulieren de fout bij de juiste sectie kunnen tonen.
- Voor conceptdocumenten is later server-side draftopslag/autosave wenselijk; de frontend simuleert dit nu bewust niet.
- Documenttotalen, btw-regimes, nummering en eindstatus blijven uitsluitend server-side bron van waarheid.


## Manager, medewerker en mobiel — frontendintegratie 2026-07-18

De rolomgevingen zijn opnieuw op een leesbare productschaal gebracht. De managercockpit gebruikt minimaal 12–14 px voor dagelijkse context, KPI-labels, tabellen en acties; de eerdere microtekst van 7,5–10 px is verwijderd uit de kerncomponenten. Managerformulieren gebruiken tot 760 px. Medewerkerkaarten, werkbonstappen, formulieren en statusinformatie zijn vergroot; desktop-sheets gebruiken tot 720 px en mobiele sheets benutten de volledige schermbreedte.

Dagelijkse flows die expliciet zijn geborgd:

- Manager: dagstart, uitzonderingen, team, planning, prikcorrecties, verlof, onkosten en werkbonopvolging.
- Medewerker: vandaag, inklokken/pauzeren/uitklokken, planning, werkbon starten en afronden, klantbevestiging, verlof en onkosten.
- Mobiel: éénkolomsformulieren, volledige breedte voor sheets, grotere touchdoelen en een horizontaal scrollbare maar leesbare werkbonstatus.

Feedback voor de backendontwikkelaar:

- Deze release verandert geen endpoints of autorisatie; server-side rol- en tenant-scoping blijven leidend.
- Houd manageroverzichten compact in aantal requests. Een toekomstig tenant-scoped dagstartcontract kan uitzonderingen server-side prioriteren zonder dat de frontend bedrijfsregels dupliceert.
- Lever klok-, verlof-, onkosten- en werkbonconflicten met canonieke `code`, `fieldErrors`, conflictcontext en `requestId`.
- Mobiele mutaties moeten idempotent blijven en dezelfde offline-sync-id accepteren; de UI mag bij een netwerkherhaling geen dubbele registratie veroorzaken.


## Frontendroadmap visueel afgerond — functionele audit actief · status 2026-07-18

De afgesproken SaaS-UI-roadmap is visueel en structureel afgerond. Dit betekent nog niet dat elke domeinflow als volledige browser-E2E is bewezen. De functionele audit controleert daarom expliciet of schermacties dezelfde klant-, offerte-, werkbon-, planning- en factuur-ID's blijven doorgeven.

| Roadmapgebied | Visuele/structurele status |
| --- | --- |
| Login, trial, registratie en reseller | Afgerond |
| Dagstart, actiecentrum en planning | Afgerond |
| Klanten, offertes, werkbonnen en facturen | Afgerond |
| Tijd, onkosten en verlofgoedkeuring | Afgerond |
| Stock en wagenpark | Afgerond |
| Managementrapportage | Afgerond |
| Integratiecentrum | Afgerond |
| Instellingen, rechten en securitypresentatie | Afgerond |
| Mona AI-assistent | Afgerond |
| Manager-, medewerker- en mobiele flows | Afgerond |
| Ruime create/editworkspaces en leesbaarheidsaudit | Afgerond |

Backend-/providerafhankelijkheden die geen onafgewerkte frontend voorstellen:

- Echte mailprovider en afzenderdomeinen.
- Stabiel Automation Studio workflow- en runlogcontract.
- Definitieve productie-auth, data-adapter, tenantmigratie en providercredentials.
- Eventuele server-side rapportageaggregaties, asynchrone exports en AI-streaming.
- Productievalidatie van Stripe, Peppol, SSO en externe connectors.

Eindvalidatie van de vorige visuele release: de volledige Node-testsuite sloeg met **391/391 tests**. Dit zijn regressie- en contracttests, geen volledige geauthenticeerde browser-E2E. Nieuwe UI mag deze regressies niet omzeilen; gedeelde bestanden blijven eerst vergelijken met actuele `main` om parallel backendwerk te behouden.

## Functionele golden-flowkoppelingen — frontendintegratie 2026-07-18

De eerste functionele audit heeft drie losgekoppelde schermovergangen hersteld:

- Een factuur die vanuit een klantdossier wordt gestart, bewaart nu ook de `customerId`; de klantnaam alleen is niet langer de enige koppeling.
- Een nieuwe werkbon die met “meteen inplannen” wordt opgeslagen, gebruikt de door de server teruggegeven werkbon-ID en geeft die als `workorderId` mee aan de shift.
- Factureren vanuit een afgeronde werkbon gebruikt het canonieke `POST /workorders/{id}/invoice`-contract. Daardoor worden factuur, werkbon, materiaal en factureerbare onkosten server-side in één domeinactie gekoppeld.

Frontendcontract:

- UI-prefill is nooit de bron van waarheid voor IDs; de serverresponse van de create-actie bepaalt de vervolgkoppeling.
- De planningeditor bewaart een bestaande `workorderId` ook bij bewerken.
- De factuurklantselector ondersteunt zowel bestaande facturen als een prefill vanuit het klantdossier.
- Bij een mislukte vervolgactie blijft de fout zichtbaar in de actieve editor en wordt de actieknop opnieuw bruikbaar.
- De volledige domeinketen wordt als HTTP-smoketest uitgevoerd met echte create-, convert-, planning- en invoice-endpoints; de test controleert beide richtingen van de werkbon/factuurkoppeling.

Feedback voor de backendontwikkelaar:

- Behoud in `POST /workorders` de responsevorm `{ workorder: { id } }`; de frontend accepteert tijdelijk ook `row` als compatibiliteitsfallback.
- Behoud `workorderId` op planning create/update en laat klokregistraties deze koppeling erven.
- `POST /workorders/{id}/invoice` blijft de enige canonieke werkbonfacturatieactie, inclusief idempotentie/conflict bij reeds gefactureerde werkbonnen.
- Lever bij 409/422 een stabiele `code`, `fieldErrors` en `requestId`, zodat de editor de oorzaak kan tonen zonder tekstinterpretatie.



## Medewerkerafronding en bewijs — frontendintegratie 2026-07-18

De functionele audit toonde dat de medewerkereditor velden voor materiaal en klantbevestiging naar `PATCH /me/workorders/{id}` stuurde, terwijl dat contract alleen status, `completionNote` en foto's bewaart. De UI gebruikt nu het bestaande handtekeningcontract `POST /mobile/workorders/{id}/signature` voor de klantnaam en bewaart gebruikt materiaal samen met de uitvoeringsnotitie. De afgeronde werkbon toont zowel de bestaande `completionNote` als de mobiele `mobileNote`-fallback.

Frontendcontract:

- Een ingevulde klantnaam kan alleen met expliciete bevestiging worden doorgestuurd.
- De handtekening wordt eerst bewaard; pas daarna wordt de werkbon afgerond.
- Een fout in een van beide stappen blijft zichtbaar in de afrondingseditor.
- Materiaaltekst gaat niet meer stil verloren en blijft voorlopig leesbaar in de uitvoeringsnotitie.

Feedback voor de backendontwikkelaar:

- Voeg voor definitieve materiaalrapportage een tenant-scoped gestructureerd contract toe, bijvoorbeeld `completionMaterials[]` met omschrijving, hoeveelheid en eenheid.
- Overweeg één canonieke transactie voor bewijs + afronding, zodat handtekening en status niet gedeeltelijk kunnen slagen. Tot dan voert de frontend de handtekening bewust eerst uit.
- Retourneer bij dubbele afronding of ontbrekende rechten een stabiele `code`, `requestId` en bruikbare foutmelding.
- Laat documentrendering zowel `completionNote/mobileNote` als de bestaande `signature.signerName` tonen; de backend blijft bron van waarheid voor het auditspoor.


## Tijdregistratie, rapportage en export — frontendintegratie 2026-07-18

De functionele audit vond twee geldige klokvormen in het platform: self-service prikklok gebruikt ISO-velden `clockedIn/clockedOut`, terwijl beheer- en correctieflows datum + `clockIn/clockOut` gebruiken. Rapportages, loonlijsten en CSV-export lazen niet overal beide vormen en konden daardoor uren als nul of leeg tonen.

Frontendoplossing:

- Eén gedeelde `wfpTime`-normalisatielaag bepaalt werkdatum, begin/eindtijd, actieve status, minuten en uren.
- Een serverberekende `durationMinutes` blijft bron van waarheid; tijdsverschil is alleen fallback.
- Adminrapporten, loonlijst, beslissersrapport, klokoverzicht en CSV-export gebruiken hetzelfde contract.
- De medewerkermaandstaat, dagdetail en persoonlijke CSV gebruiken dezelfde normalisatie.
- Lopende prikkingen tellen niet als afgesloten factureerbare of loonuren.

Feedback voor de backendontwikkelaar:

- Kies op termijn één canoniek klokcontract voor alle endpoints en documenteer de overgang; de frontend ondersteunt beide vormen zolang migratie loopt.
- Lever altijd `date`, `durationMinutes` en expliciete actieve status of `clockOut:null`.
- Serverberekende duur blijft leidend voor loon, facturatie en audit; de browser mag nooit de definitieve duur bepalen.
- Vermeld tijdzone/UTC-semantiek in het contract en retourneer een stabiele foutcode bij ongeldige of overlappende correcties.
