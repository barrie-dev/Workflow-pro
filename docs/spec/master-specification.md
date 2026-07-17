Monargo One
Development Master Specification
Volledig functioneel en technisch ontwikkelingsdocument voor een horizontaal operationeel platform met Construction en Service als kernverticals.
Doelgroep: product owner, functioneel analist, solution architect, UX, backend, frontend, mobile, QA, DevOps en implementatiepartners.
Besluit: behoud de huidige Monargo-basis, maar refactor naar een projectgedreven domeinmodel. Bouw eerst de volledige klantflow en Construction Core. Voeg zware bouwfuncties alleen toe wanneer de onderliggende project-, catalogus-, aankoop- en financiële modellen stabiel zijn.
Repositorybasis: barrie-dev/Workflow-pro. Onderzochte toestand: 16 en 17 juli 2026. De specificatie vervangt geen technische spike of finale security review.

# 1. Documentbeheer
Document
Monargo One Development Master Specification
Versie
1.0
Datum
17 juli 2026
Repository
barrie-dev/Workflow-pro
Status
Goedgekeurde ontwikkelbasis, te verfijnen per epic
Productpositie
Operationeel besturingssysteem voor bouw-, service- en projectgerichte kmo's
Kernverticals
Construction en Service & Assets
Talen
Nederlands, Frans en Engels
Regio
Eerst België, architectuur voorbereid op Europese uitbreiding
## 1.1 Gebruik van dit document
Gebruik hoofdstukken 7 tot en met 39 als functionele requirements per domein.
Gebruik hoofdstuk 5 en 6 als doelarchitectuur en migratiecontract.
Gebruik hoofdstuk 40 tot en met 45 voor backlog, testing, release en definition of done.
Gebruik het meegeleverde JSON-bestand voor requirementimport, traceability en geautomatiseerde storygeneratie.
Afwijkingen worden als architectuur- of productbeslissing geregistreerd en niet stilzwijgend in code verwerkt.
## 1.2 Bewijsklassen
Huidige code
Gedrag dat in de actuele Monargo-repository aanwezig of testbaar is.
Doelrequirement
Nieuwe of aangepaste werking die development moet implementeren.
Sectorpack
Configuratie en aanvullende capabilities bovenop dezelfde horizontale kern.
Later
Bewust uitgesteld om scope, risico en time-to-market te bewaken.
# 2. Productbeslissing
Monargo One wordt geen kopie van Robaws en ook geen generiek ERP voor iedere sector. Het wordt een geïntegreerd operations platform voor bedrijven die werk verkopen, plannen, uitvoeren, bewijzen en factureren.
## 2.1 Kernwaardeketen
Klantvraag, opportunity of contract.
Offerte en eventueel calculatie.
Project, job of terugkerende opdracht.
Planning van mensen, onderaannemers en assets.
Mobiele uitvoering met tijd, materiaal, formulieren en bewijs.
Review, correctie en operationele afsluiting.
Facturatie, Peppol en betaling.
Projectmarge, capaciteit, risico en managementinzichten.
## 2.2 Marktfocus
Segment
Fit
Reden
Timing
Technische service, HVAC en installateurs
Zeer hoog
De volledige kernflow klant, offerte, planning, interventie, materiaal, installatie, onderhoud en factuur past rechtstreeks.
Eerste prioriteitsmarkt
Facility, multiservice en property maintenance
Zeer hoog
Veel locaties, recurring jobs, SLA's, checklists, mobiele teams en facturatie.
Eerste prioriteitsmarkt
Schoonmaak en periodieke diensten
Hoog
Recurring planning, aanwezigheid, bewijs, vervanging, uren en contractfacturatie.
Eerste of tweede golf
Groen- en terreinonderhoud
Hoog
Combinatie van planning, werkbon, machines, locaties, recurring onderhoud en seizoen.
Tweede golf
Kleine en middelgrote aannemers
Selectief
Lichtere aannemers gebruiken vooral offerte, planning, werkbon, factuur en compliance. Zware bouwbedrijven vereisen calculatie, aankoop, stock en vorderingen.
Robaws light switchers eerst
Professionele diensten, consultancy en IT-service
Middel tot hoog
CRM, offerte, project, tijd, onkosten, contract en factuur zijn breed bruikbaar.
Na projectlaag
Inspectie, keuring en certificering
Hoog
Planning, mobiele formulieren, assets, rapporten en recurring bezoeken vormen een duidelijke workflow.
Tweede golf
Events en verhuur
Middel
Planning en teams passen, maar verhuur, beschikbaarheid, retour en schade maken het product complex.
Later
Transport en logistiek
Laag in huidige vorm
Routeoptimalisatie, CMR, tachograaf, dispatching en fleet compliance vereisen een eigen verticaal product.
Niet actief targetten
Mobiele zorg
Laag en risicovol
Patiëntgegevens, zorgplanning, medische dossiers, terugbetaling en sectorwetgeving vereisen gespecialiseerde compliance.
Uit sectorprofielen verwijderen voor nu
## 2.3 Bouw is een kernmarkt
Construction Core is onderdeel van de eerste geloofwaardige marktversie.
Doelgroep: aannemers, installateurs en gespecialiseerde bouwbedrijven met ongeveer 5 tot 50 medewerkers.
De eerste bouwrelease bevat klanten, werven, offertes, projecten, planning, werkbonnen, tijd, materiaal, meerwerken, compliance, facturatie en projectmarge.
Construction Advanced bevat later meetstaten, uitgebreide calculatie, procurement, groothandels en vorderingsstaten.
HVAC, elektriciteit, technische beveiliging en installatiewerk liggen op het kruispunt van Construction en Service & Assets en krijgen commerciële prioriteit.
## 2.4 Anti-roadmap
Geen volledige boekhouding bouwen. Facturatie, projecttoewijzing en connectoren zijn voldoende.
Geen loonmotor of volledig HRM bouwen.
Geen manufacturing, MRP of productieplanning bouwen.
Geen zwaar WMS met zones, waves en geavanceerde picking in de kern.
Geen fysieke POS of retailproduct bouwen.
Geen transportmanagementsysteem bouwen zonder aparte strategie.
Geen zorgdossier of medische workflow bouwen.
Geen uitgebreide marketing automation bouwen.
Geen vorderingsstaat of meetstaat bouwen voordat Construction Lite tractie heeft.
Geen losse AI-chat verkopen zonder betrouwbare data en concrete acties.
Geen nieuwe sector toevoegen alleen door labels te veranderen.
Geen module bouwen zonder end-to-end bron- en vervolgrelaties.
# 3. Analyse van de huidige codebasis
De huidige codebasis bevat meer productwaarde dan een prototype, maar de architectuur is nog niet geschikt om alle diepe ERP-processen veilig in generieke JSON-records te blijven bouwen.
Onderdeel
Beslissing
Analyse
Multi-tenant en rollen
Behouden
Tenant isolation, rollen, MFA, SSO, audit en support grants bestaan. Policies moeten formeler en company-aware worden.
Module-entitlements
Behouden en herstructureren
Sterke verkoop- en gatingbasis. Editions moeten volledige flow leveren; capability packs leveren sector- of procesdiepte.
Planning en tijd
Behouden en verdiepen
Conflictregels, verlof, pauzes en audit bestaan. Planning en afspraken worden één engine met multi-resource assignment.
Werkbon en mobile
Behouden en verdiepen
Checklist, foto, handtekening, geklokte uren en offline queue bestaan. Voeg conflicts, forms, material, multiple workers en correction ledger toe.
Offerte en factuur
Behouden en verdiepen
Templates, online acceptatie, invoice generation en Peppol bestaan. Voeg immutable versions, source allocation en credit flows toe.
Integraties
Architectuur behouden, connectors herwerken
Mapping, encrypted secrets en sync logs bestaan. Huidige sync is grotendeels mock en moet via jobs, outbox en provider adapters live worden.
Database
Gefaseerd vervangen
Generieke tenant_records met JSONB is geschikt voor vroege delivery, niet voor diepe relaties, constraints, queries en financiële integriteit.
Sectorprofielen
Behouden en uitbreiden
Terminologie en moduleadviezen bestaan. Packs moeten ook defaults, forms, rules, automation, KPIs en data requirements leveren.
AI
Hernoemen en governancen
Boden wordt Mona. Read-only analyse is baseline; actions en estimates werken met preview, policy, confirmation en audit.
## 3.1 Belangrijkste technische risico's
Generieke JSONB-opslag geeft onvoldoende referentiële integriteit voor project, calculatie, voorraad, purchase en finance.
Application-only tenant filtering is onvoldoende defense in depth voor een volwassen SaaS-platform.
Generic CRUD mag privileged of financieel gedrag niet beheren.
Vrije tekst voor client, project of venue veroorzaakt dubbele data en onbetrouwbare rapportering.
Modulekeys en domeinnamen zijn gemengd en moeten canonical English identifiers krijgen.
Mock providers en productiecontracts mogen niet verward worden met live operationele integraties.
Platform billing en customer contracts zijn verschillende bounded contexts en moeten worden gescheiden.
## 3.2 Wat onmiddellijk niet mag worden herschreven
Bestaande login, MFA, activation en support flows blijven werken tijdens migratie.
Bestaande demo- en pilotflow blijft bruikbaar via compatibility adapters.
Entitlement resolver blijft de commerciële source of truth tot de nieuwe edition and pack catalogus is gemigreerd.
Peppol, templates en mobile queue worden incrementeel verbeterd in plaats van verwijderd.
Huidige tests blijven regression gate en worden uitgebreid met nieuwe domain tests.
# 4. Ontwikkelprincipes
Project is de centrale context voor projectgedreven werk.
Job is de centrale uitvoeringsopdracht. Planning is de tijd- en resourceallocatie van een job.
Location is een gedeeld object, niet een optionele datasilo.
Historische commerciële en financiële documenten zijn onveranderlijke snapshots.
Financiële, voorraad- en automationmutaties zijn idempotent.
Iedere belangrijke statusovergang genereert audit en een domeinevent.
Sectoren configureren de kern en dupliceren geen codebase.
Integreren met boekhouding is prioritair boven boekhouding bouwen.
Mobile core werkt offline-first.
AI krijgt nooit meer rechten dan de uitvoerende gebruiker en toont bron, preview en audit.
Iedere KPI is herleidbaar tot bronrecords en formule.
Een module is pas klaar wanneer states, permissions, edge cases, API en tests klaar zijn.
# 5. Doelarchitectuur
## 5.1 Logische lagen
### Web workspace
Rolgerichte admin-, sales-, project-, planning-, finance- en managementworkspace.
### Mobile PWA or app
Offline-first opdrachten, tijd, formulieren, foto, materiaal, signature en sync conflicts.
### API layer
Versioned REST API met typed contracts, idempotency, optimistic concurrency en policy enforcement.
### Domain services
Afzonderlijke modules voor CRM, Quotes, Projects, Planning, Work, Finance, Construction, Service en Inventory.
### Workflow and events
Outbox, job queue, webhooks, automation runs en retries.
### PostgreSQL
Genormaliseerde core tables, constraints, indexes, tenant and company keys.
### Object storage
Bestanden, foto's, PDF, UBL en immutable document snapshots.
### Search and analytics
Search index en read models, later data warehouse.
### Integration adapters
Peppol, accounting, payments, Robaws import en andere providers.
### Mona service
Retrieval, recommendations, actions, estimates en signals met policy enforcement.
## 5.2 Backendstructuur
src/  platform/          tenancy, auth, policy, configuration, files, audit  crm/               customers, contacts, locations, opportunities  catalog/           articles, units, pricing, activities  quotes/            quotes, versions, calculation, acceptance  projects/          projects, phases, budget, forecast, risks  planning/          jobs, planning items, resources, recurrence  field/             work orders, time, material, forms, mobile sync  contracts/         customer contracts and recurring rules  finance/           invoices, credits, payments, Peppol  construction/      worksite, parties, compliance, changes  service/           assets, installations, maintenance  procurement/       suppliers, purchase orders, receipts  inventory/         stock locations, movements, reservations  integrations/      adapters, mappings, sync jobs, webhooks  mona/              context, proposals, guarded actions, signals
## 5.3 Domain service contract
Geen financieel of privileged domein gebruikt generieke CRUD als primaire implementatie.
Controller valideert transport; domain service valideert business rules; repository valideert persistence constraints.
Iedere command retourneert domain result en genereert events via transactional outbox.
Read models mogen eventual consistency hebben; financiële source of truth niet.
Alle writes bevatten tenant, company waar relevant, actor, idempotency key en expected version.
Geen domeinservice leest rechtstreeks willekeurige JSON van een ander domein. Gebruik expliciete queryservice of contract.
## 5.4 API-standaard
POST /v1/projectsIdempotency-Key: 01J... If-Match: optional-versionAuthorization: Bearer ...Success: 201 with resource, version and linksValidation: 422 with field errorsConflict: 409 with current version and recovery actionForbidden: 403 without hidden record details
Canonical identifiers zijn UUID of ULID. Businessnummers zijn aparte, leesbare sequences.
Datums gebruiken ISO 8601. Money gebruikt integer minor units of exact numeric, nooit binary float als source of truth.
Pagination gebruikt cursor voor grote resources.
Filtering gebruikt whitelist fields en typed operators.
POST, PUT en PATCH ondersteunen idempotency waar businessduplicaten schadelijk zijn.
Events en errors hebben stabiele machine codes en gelokaliseerde user messages.
# 6. Migratie van huidige architectuur naar domeintabellen
## 6.1 Beslissing
Gebruik een strangler migration. Nieuwe diepe capabilities worden onmiddellijk genormaliseerd gebouwd. Bestaande eenvoudige records blijven tijdelijk via adapters beschikbaar. Er komt geen big bang rewrite.
Fase
Naam
Resultaat
M0
Schema foundation
Maak tenant, company, identity, customer, contact, location, project en file tables. Voeg outbox en migration ledger toe.
M1
Compatibility repositories
Bouw repositories die eerst normalized tables lezen en voor legacy records gecontroleerd terugvallen op tenant_records.
M2
Dual write
Schrijf nieuwe of aangepaste records naar normalized tables en bewaar alleen noodzakelijke legacy projection.
M3
Data migration
Migreer per tenant met validation report, relation matching en rollback marker.
M4
Read cutover
Schakel module per module naar normalized read path via feature flag.
M5
Legacy freeze
Maak legacy collections read-only en verwijder dual write.
M6
Cleanup
Archiveer of verwijder legacy payloads na audit, backup en klantvalidatie.
## 6.2 Verplichte databasepatronen
tenant_id op iedere tenantresource en composite indexes op tenant plus relevante status/date.
company_id op juridische en financiële documenten.
Foreign keys voor klant, project, location, job, employee, supplier en source relations.
Check constraints voor status, positieve quantities en money rules waar mogelijk.
Soft archive als businessgedrag, hard delete alleen voor expliciet toegelaten niet-historische records.
Optimistic version column op aggregates.
Immutable ledgers voor audit, stock movement, invoice numbering en financial source allocations.
Transactional outbox in dezelfde transaction als domain write.
## 6.3 RLS en service role
De huidige RLS laat service_role alle data lezen en schrijven. Dat kan als server-only toegang blijven, maar production security vereist defense in depth: gecontroleerde database roles, tenant-scoped SQL functions of claims, aparte migration role en tests die directe tenantcrossing verhinderen.
# 7. Canoniek datamodel
Entiteit
Doel
Kernvelden
Tenant
SaaS-datapartitie
id, name, edition, status, locale, data_region
Company
Juridische onderneming
tenant_id, legal_name, vat, company_number, iban, Peppol identity
User
Loginidentiteit
tenant_id, email, status, MFA, locale
Employee
Operationele resource
user_id, supplier_id, team_id, cost rate, work schedule
Role and Policy
Toegang
resource, action, scope, conditions, fields
Customer
Klantrelatie
type, name, vat, language, payment terms, credit status
Contact
Persoon en rol
customer_id, role, communication preferences
Location
Werf, gebouw of site
customer_id, type, address, geo, access rules
Project
Centraal dossier
customer, location, company, manager, status, budget, forecast
ProjectParty
Projectpartner
party type, customer or supplier, contact
Quote and Version
Offerte en immutable revision
status, valid until, totals, document hash
QuoteLine
Scope en prijs
article, quantity, unit, price, cost, tax
CalculationComponent
Onderliggende kost
type, source, quantity, unit cost, formula
Job
Uitvoeringsopdracht
project, type, priority, status, billing strategy
PlanningItem
Tijdvenster
job, start, end, location, recurrence
ResourceAssignment
Resourcekoppeling
employee, team, vehicle, equipment, subcontractor
WorkOrder
Uitvoeringsresultaat
job, status, review, billable state, version
TimeEntry
Werkelijke tijd
employee, project, job, start, end, breaks, activity
MaterialUsage
Werkelijk materiaal
work order, article, stock location, quantity, cost snapshot
Expense
Onkost
employee, project, category, amount, tax, receipt, approval
Article
Materiaal of dienst
type, SKU, unit, price strategy, tax, stock managed
Supplier
Leverancier of onderaannemer
VAT, terms, bank, qualification
PurchaseOrder
Verplichting
supplier, project, type, status, expected date
GoodsReceipt
Ontvangst
purchase order, location, date, status
StockMovement
Immutable stocktransactie
article, location, type, quantity, source, cost
SalesInvoice
Factuur of credit
company, customer, number, status, dates, totals, Peppol
InvoiceSourceLine
Factuurbron
invoice line, source type, source id, quantity
Payment
Betaling
invoice, amount, date, reference, provider
CustomerContract
Klantcontract
customer, version, status, dates, billing rule
RecurringRule
Periodieke generatie
frequency, next run, type, idempotency
Asset
Voertuig, machine of installatie
type, serial, status, owner, location, warranty
MaintenancePlan
Onderhoud
asset, frequency, next due, checklist, contract
Task
Menselijke actie
context, assignee, due, status, priority
FormTemplate and Response
Gestructureerd formulier
version, questions, answers, submitted at
File and DocumentSnapshot
Bestand en immutable document
storage key, hash, version, template version
Automation Flow and Run
Workflow
version, trigger, conditions, actions, status
ActivityEvent
Tijdlijn en event
aggregate, event type, actor, occurred at, payload
## 7.1 Generieke technische velden
id, tenant_id, company_id waar relevant
created_at, created_by, updated_at, updated_by
version voor optimistic concurrency
archived_at en archived_by
external_ids als afzonderlijke mappingtable
custom fields via typed value model
source_type en source_id voor traceability waar passend
correlation_id en causation_id op events
# 8. Rollen en autorisatie
Rol
Primaire scope
Superadmin
Platform, tenants, packs, support, release health
Tenant admin
Eigen organisatie, users, roles, editions, integrations
Sales
Customers, opportunities, quotes, commercial files
Calculator
Catalog, cost, calculation, quote reviews
Project manager
Project, planning, budget, purchase, forecast
Planner
Jobs, planning, resources, conflicts
Field lead
Team execution, work orders, exceptions
Employee
Own planning, time, work, expense and leave
Purchaser
Suppliers, purchase, receipts
Warehouse
Stock and movements
Finance
Invoices, Peppol, credits, payments and accounting export
Management viewer
Authorized dashboards and audit
Reseller
Assigned tenant onboarding and commercial support
## 8.1 Policy scopes
own: records van de medewerker zelf
team: eigen team of teams
project: expliciete projectmembership
company: juridische onderneming
tenant: volledige tenant
assigned_customers: toegewezen customer portfolio
reseller_tenants: alleen contractueel toegewezen tenants
support_grant: tijdelijke delegated scope
## 8.2 Gevoelige velden
employee cost rate
article and quote cost price
project margin and forecast
supplier bank account
customer credit limit
confidential purchase documents
authentication and recovery secrets
Mona prompt and action context containing sensitive data

# 9. Capabilitybeslissingen
## 9.1 Matrixdeel 1
Capability
Beslissing
Prioriteit
Pack
Fit
Complexiteit
Aanbeveling
Multi-tenant platform, rollen, audit en security
Behouden en verdiepen als platformkern
P0
Platform Core
5
4
Geen sectorfunctionaliteit bouwen voordat deze laag productiehard is. Voeg company-scope, veldrechten, sessiebeheer, exportaudit en policy-based authorization toe.
Universele lijsten, filters, bulkacties en export
Bouwen als gedeelde kern
P0
Platform Core
5
3
Eén generieke datagrid met opgeslagen views, bulkacties, rechten en exports. Niet per module opnieuw bouwen.
Statussen, extra velden en configureerbare templates
Bouwen als configuratieplatform
P0
Platform Core
5
4
Technische veldsleutels, versiebeheer, meertaligheid en gebruik in filters, documenten, automation en API voorzien.
Automation en goedkeuringsflows
Generaliseren en centraal bouwen
P0/P1
Automation
5
5
Triggers, voorwaarden, acties, wachttijden, approvals, retries, audit en menselijke controle. Dit wordt de basis voor Mona Actions.
Klanten, contacten en locaties
Klanten verdiepen en locaties naar gedeeld kernobject verplaatsen
P0
Business Core
5
3
Contactrollen, meerdere adressen, facturatiecontext, communicatiehistoriek, klanttarieven en creditflags toevoegen. Locaties mogen functioneel verborgen zijn, maar niet als losse datalaag ontbreken.
CRM pipeline en centrale inbox
Samenvoegen tot CRM en Work Inbox
P1
Business Core
4
3
Eén inbox voor klantvragen, taken, goedkeuringen en uitzonderingen. Basis pipeline voorzien, maar geen marketing automation bouwen.
Werknemers, teams en rechten
Behouden en verdiepen
P0
Operations
5
3
Werkroosters, kosttarieven per geldigheidsdatum, vaardigheden, certificaten en externe medewerkers toevoegen. Personeelsdossier beperkt houden.
Tijdregistratie, prikklok, pauzes en correcties
Behouden als onderscheidende horizontale capability
P0
Operations
5
3
Timesheet approval, projecttoewijzing, loondienstexport en offline synchronisatie verdiepen. Niet uitbouwen tot loonpakket.
Verlof en afwezigheden
Behouden als Operations-functie
P1
Operations
4
2
Saldo, teamapproval en planningimpact voorzien. Geen uitgebreid HRM ontwikkelen.
Onkosten en bonnetjes
Behouden en koppelen aan projecten en finance
P1
Operations
4
2
Project, klant, btw en boekhoudmapping toevoegen. Incoming expense en aankoopfactuur duidelijk onderscheiden.
Planning en afspraken
Samenvoegen tot één planningplatform
P0
Operations
5
4
Eén planningobject met types zoals afspraak, shift, opdracht, interventie en reservering. Voeg vaardigheden, resources, herhaling, routecontext en bevestigingen toe.
Werkbonnen en mobiele uitvoering
Sterk verdiepen
P0
Operations
5
5
Offline-first, meerdere medewerkers, materiaal, materieel, formulieren, garantie versus factureerbaar werk, review, correctie en volledige brontraceerbaarheid.
## 9.2 Matrixdeel 2
Capability
Beslissing
Prioriteit
Pack
Fit
Complexiteit
Aanbeveling
Projecten als centraal dossier
Nieuw centraal domeinobject bouwen
P0
Projects
5
5
Project verbindt klant, offerte, contract, planning, werkbon, tijd, kosten, facturen, documenten en forecast. Vermijd vrije tekst voor project- of klantrelaties.
Projecttaken, fasen en capaciteit
Bouwen als brede projectlaag
P1
Projects
5
4
Board, lijst, timeline, milestones en resourcecapaciteit. Geen zware CPM-engine in eerste fase.
Budget, kosten, marge en nacalculatie
Bouwen in twee niveaus
P1
Projects + Construction
5
5
Horizontale projectmarge voor uren, onkosten en facturen. Geavanceerde materiaal-, aankoop- en postnacalculatie alleen in Construction of Procurement pack.
Artikels, diensten en prijslijsten
Bouwen als gedeelde catalogus, niet als verplicht kernscherm
P1
Catalog
5
4
Diensten, materialen, eenheden, btw, prijsregels en leveranciersreferenties. Historische documentlijnen moeten snapshots blijven.
Offertes en digitale acceptatie
Diepgaand herwerken als commerciële kern
P0
Business Core
5
4
Revisies, opties, alternatieven, templates, approvals, geldigheid, signatures en betrouwbare conversie naar project, werkbon, order of factuur.
Geavanceerde calculatie en posten
Niet in de horizontale kern, wel Construction Pack
P2
Construction Pack
4
5
Start met eenvoudige kost- en margecalculatie voor iedereen. Formules, meetstaten, postenbibliotheek en onderliggende componenten pas voor bouw en installatie.
Verrekeningen, meerwerken en minderwerken
Sectorfunctie bovenop offerteversies
P2
Construction Pack
4
4
Bouwen als change order wanneer projectbudget en offerteversies stabiel zijn.
Verkooporders en uitvoeringsopdrachten
Generaliseren tot Job of Order, alleen waar nodig
P1
Projects / Operations
4
4
Niet elk bedrijf heeft een verkooporder nodig. Gebruik configureerbare jobtypes en activeer orderlogica voor levering, uitvoering of fulfilment.
Leveranciers en prijsaanvragen
Optionele Procurement Pack
P2
Procurement Pack
4
4
Leveranciersstam breed houden. Prijsaanvraag en leveranciersportaal pas bouwen wanneer calculatie en aankoop zijn gevalideerd.
Aankooporders en ontvangsten
Optionele Procurement Pack
P2
Procurement Pack
4
5
Order, ontvangst en factuurmatching vormen één pakket. Geen losse eenvoudige bestelmodule zonder ontvangsten en projectkost.
Voorraad, reservaties en magazijn
Niet verwijderen, maar herpositioneren als optionele pack
P2
Inventory Pack
4
5
Eerst betrouwbare mutaties, locaties, reservaties, telling en projectverbruik. Geen zwaar WMS, picking of lotbeheer in de kern.
Levernota's, verzending en retour
Alleen in Inventory of Fulfilment Pack
P3
Inventory Pack
3
3
Niet bouwen voor de brede markt. Nodig wanneer verkooporders en voorraad werkelijk tractie tonen.
## 9.3 Matrixdeel 3
Capability
Beslissing
Prioriteit
Pack
Fit
Complexiteit
Aanbeveling
Verkoopfacturen, Peppol, reminders en online betaling
Behouden en productiehard maken
P0
Business Core
5
5
Immutable numbering, creditnota, bronlijnen, UBL-PDF-reconciliatie, Peppolstatus, payment matching en accounting connectors.
Aankoopfacturen, OCR en three-way match
Partner-first en later lichte inkomende factuurinbox
P2
Finance Connect
3
5
Integreer eerst met boekhouding en Peppolprovider. Bouw alleen projecttoewijzing, approval en export. Volledige AP en betaling niet als vroege kern.
Vorderingsstaten en prijsherziening
Bewust uitstellen
P3
Construction Advanced
3
5
Pas bouwen na aantoonbare vraag en een volwassen construction datamodel. Geen plaats in brede marktpropositie.
Materieel, voertuigen, assets en installaties
Voertuigen refactoren naar Assets en Resources
P1
Service & Assets
5
4
Eén assetmodel voor voertuigen, machines, gereedschap en klantinstallaties met serienummer, locatie, status, documenten en planning.
Service en onderhoud
Hoge prioriteit als brede verticale pack
P1
Service & Assets
5
5
Onderhoudsschema, installatiehistoriek, interventies, checklists, onderdelen en contractdekking. Zeer relevant voor HVAC, facility, groen en technische service.
Contracten, abonnementen en recurring jobs
Bouwen als brede commerciële capability
P1
Contracts
5
4
Scheid Monargo-billing van klantcontracten. Ondersteun recurring invoice, recurring job, indexatie, pauze, pro rata en renewal.
Verhuur en beschikbaarheid
Niet bouwen in eerste productgeneraties
P3
Rental Pack
3
5
Alleen als aparte Events & Rental pack na bewezen vraag.
Formulieren, checklists, taken, bestanden en communicatie
Samenbrengen als Work OS-kern
P0
Platform Core
5
4
Form builder, gestructureerde antwoorden, taakcontext, documentversies, comment timeline en e-mailtemplates centraal bouwen.
Dashboard, rapportering en datahub
Behouden, maar KPI's herleiden tot brondata
P1
Insights
5
4
Rolgerichte exception dashboards, niet alleen totals. Projectmarge, facturatielekken, planningconflicten en activation metrics centraal.
API, integraties en marketplace
Behouden als productfundament
P0
Platform Core
5
5
Consistente resources, webhooks, idempotency, sandbox, connector health en accounting-first integraties. Geen connectoren zonder monitoring.
Belgische bouwcompliance
Behouden als duidelijke Construction Compliance Pack
P1 voor bouw, niet core
Construction Compliance
5
4
Niet in iedere bundel of hoofdmenu tonen. Activeer per sector en combineer met werf, onderaannemer, aanwezigheden en audit.
Mona, AI-analyse, AI-estimatie en acties
Herpositioneren als horizontale intelligente laag
P1
Mona
5
5
Naam Mona doorvoeren. Basisassistent inbegrepen, actie- en compute-intensieve functies met usage of add-on. Iedere actie met preview, bevestiging, bron en audit.

# 10. Platformfundament en multi-tenant organisatie
Modulecode
PLT
Doel
Een veilige gedeelde platformlaag die alle modules op dezelfde manier laat werken en voorkomt dat iedere module eigen logica voor rechten, statussen, documenten en audit ontwikkelt.
## Gebruikers en rollen
Tenantbeheerder
Bedrijfsbeheerder
Functioneel beheerder
Eindgebruiker
API-gebruiker
Supportmedewerker met gecontroleerde toegang
## Schermen en werkruimtes
Tenantselectie en ondernemingselectie
Gebruikersbeheer
Rollenmatrix
Teams en planningsgroepen
Nummerreeksen
Algemene stamgegevens
Licentie en moduleactivatie
Audit en beveiligingslog
Integratiebeheer
## Kerngegevens
Tenant-ID en datapartitie
Ondernemings-ID
Gebruiker met unieke login
Medewerkerkoppeling
Rol en scopes
Team en hiërarchie
Taal, tijdzone en landinstellingen
Actieve modules
Nummerreeksen per documenttype
Bankrekeningen en Peppol-identiteiten
Beveiligingsbeleid
Bewaartermijnen
## Statusmodel
Tenant: proef, actief, beperkt, geschorst, beëindigd
Gebruiker: uitgenodigd, actief, geblokkeerd, gearchiveerd
Integratie: concept, actief, fout, gepauzeerd, ingetrokken
## Gebruikersacties
Gebruiker uitnodigen
Rol toekennen
MFA verplichten
SSO configureren
Team maken
Onderneming activeren
Module activeren
Nummerreeks instellen
Supporttoegang openen of sluiten
Data-export starten
## Business rules
Alle businessrecords dragen tenant_id en company_id, behalve expliciet gedeelde stamgegevens.
Een gebruiker krijgt nooit toegang enkel omdat hij een record-ID kent. Autorisatie wordt op iedere API-call toegepast.
Rollen bepalen moduletoegang, acties en dossierscope. Dossierscope ondersteunt eigen, team en alle.
API-gebruikers krijgen een afzonderlijke rol en mogen niet interactief inloggen tenzij expliciet toegestaan.
Nummerreeksen zijn per onderneming en documenttype configureerbaar. Nummering wordt pas definitief bij formele uitgifte.
Een wijziging van onderneming op een financieel document is na nummering niet toegestaan.
Supporttoegang vereist expliciete toestemming, tijdsbegrenzing en audit.
## Automatiseringen
Melding bij nieuwe beheerder
Blokkeren na herhaalde mislukte login
Taak bij verlopen integratietoken
Waarschuwing bij bijna opgebruikte nummerreeks
Automatische deactivatie na einddatum
## Edge cases
Gebruiker werkt voor meerdere ondernemingen
Medewerker bestaat zonder login
Login bestaat zonder medewerker
Fusie van twee tenants
Archivering met open financiële documenten
Overname van administratie door nieuwe onderneming
## Acceptatiecriteria
Een gebruiker ziet uitsluitend modules en records waarvoor rol en scope toegang geven.
Een API-call naar een record van een andere tenant levert geen inhoudelijke informatie op.
Nummering is uniek binnen onderneming, documenttype en boekjaar.
Alle wijzigingen aan rollen en ondernemingsinstellingen verschijnen in een onveranderbare auditlog.
Een geblokkeerde gebruiker kan geen web-, mobiele of API-sessie gebruiken.
## Latere differentiatie
SAML of OIDC SSO
SCIM-provisioning
IP-beperkingen
Contextuele rechten per project
Vier-ogenprincipe voor rechtenwijzigingen
Data residency per regio
## Development contract
Canonical API namespace: /v1/plt.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 11. Universele overzichten, zoeken en bulkacties
Modulecode
GRD
Doel
Een consistente werkomgeving waarin iedere module dezelfde verwachtingen heeft voor zoeken, filteren, selecteren, exporteren en bulkverwerking.
## Gebruikers en rollen
Alle kantoorgebruikers
Planner
Projectleider
Finance
Magazijn
Management
## Schermen en werkruimtes
Lijstweergave
Kaartweergave waar relevant
Kalenderweergave waar relevant
Analyseweergave
Opgeslagen filters
Bulkactiecentrum
Exportcentrum
## Kerngegevens
Kolomdefinitie
Dataveld of berekend veld
Filteroperator
Sortering
Groepering
Persoonlijke of gedeelde view
Snelfilter
Selectieset
Exportjob
Bulkjob en resultaat
## Statusmodel
View: privé, team, organisatie
Bulkjob: klaar, bezig, gedeeltelijk gelukt, mislukt, afgerond
## Gebruikersacties
Kolom toevoegen
Filter opslaan
View delen
Bulk status aanpassen
Bulk verantwoordelijke wijzigen
Bulk archiveren
Excel of CSV exporteren
Analyse openen
Zoekopdracht als dashboardtegel bewaren
## Business rules
Filters worden server-side uitgevoerd en respecteren dezelfde rechten als recordweergave.
Een persoonlijke view mag geen velden tonen waarvoor de gebruiker geen recht heeft.
Bulkacties tonen vooraf hoeveel records worden geraakt en welke records worden overgeslagen.
Financiële exports moeten onderneming, valuta en datumcontext vermelden.
Een export van meer dan de configureerbare limiet verloopt als achtergrondjob met downloadlink en vervaldatum.
Verwijderen en archiveren zijn aparte acties. Verwijderen is alleen mogelijk zonder beschermde relaties.
## Automatiseringen
Periodieke export
Melding bij nieuwe records in opgeslagen filter
Bulktaak na import
Geplande datakwaliteitscontrole
## Edge cases
Zeer grote datasets
Verwijderde referenties
Berekeningsvelden met vertraagde data
Gedeelde view bevat later verwijderd veld
Bulkactie wordt deels geweigerd door rechten
## Acceptatiecriteria
Dezelfde filter levert in UI en API functioneel dezelfde records op.
Een bulkactie rapporteert per record succes of fout.
Een gebruiker kan views bewaren zonder systeeminstellingen te wijzigen.
Export bevat exact de zichtbare filtercontext en tijdstip van extractie.
Gevoelige kolommen verschijnen niet in zoekresultaat, export of analyse zonder recht.
## Latere differentiatie
Globale zoekbalk over modules
Semantisch zoeken
Favorieten
Command palette
Live collaborative filters
Natural language query met controleerbare vertaling naar filters
## Development contract
Canonical API namespace: /v1/grd.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 12. Statussen, extra velden, templates en configuratie
Modulecode
CFG
Doel
Functionele beheerders moeten processen kunnen aanpassen zonder code, terwijl datakwaliteit, versiebeheer en compatibiliteit behouden blijven.
## Gebruikers en rollen
Functioneel beheerder
Tenantbeheerder
Power user
Developer via API
## Schermen en werkruimtes
Statusbeheer per module
Extra veld designer
Lijstwaarden
Documenttemplate designer
E-mailtemplate designer
Formulierdesigner
Configuratieversies
Testweergave
## Kerngegevens
Configuratie-ID
Module en entiteit
Veldtype
Technische sleutel
Weergavenaam per taal
Groep en volgorde
Verplichtheid
Standaardwaarde
Validatie
Zichtbaarheid
Documentcode
Statuskleur
Statusvolgorde
Actief vanaf en tot
## Statusmodel
Configuratie: concept, gepubliceerd, ingetrokken
Status: actief, eindstatus, gearchiveerd
## Gebruikersacties
Veld toevoegen
Veld publiceren
Lijstwaarde ordenen
Statusovergang instellen
Template testen
Voorbeeld-PDF genereren
Vertaling toevoegen
Configuratie exporteren of importeren
## Business rules
Technische sleutels zijn na publicatie onveranderlijk. De weergavenaam mag wijzigen.
Verwijderen van een gebruikt extra veld is niet toegestaan. Het veld kan worden gearchiveerd.
Een verplichte instelling mag niet retroactief bestaande records onbruikbaar maken zonder migratiepad.
Documenttemplates worden per versie bewaard. Een verzonden PDF verwijst naar de gebruikte templateversie.
Statusovergangen kunnen voorwaarden bevatten. Een eindstatus kan verdere wijzigingen blokkeren.
Vervangingscodes leveren lege waarde of configureerbare fallback, nooit een technische fout in een klantdocument.
## Automatiseringen
Bij statuswijziging taak maken
Bij extra veldwaarde e-mail sturen
Datum relatief instellen
Record vergrendelen
Gerelateerd record maken
## Edge cases
Veldtype moet veranderen
Lijstwaarde is historisch gebruikt
Template verwijst naar gearchiveerd veld
Twee configuraties gebruiken dezelfde technische sleutel
Meertalige template mist vertaling
## Acceptatiecriteria
Een gepubliceerd extra veld is beschikbaar in UI, filters, export en API volgens configuratie.
Een document kan met testdata worden gerenderd voordat de template wordt gepubliceerd.
Historische documenten blijven reproduceerbaar met hun oorspronkelijke templateversie.
Een statusovergang die niet aan voorwaarden voldoet wordt geweigerd met duidelijke reden.
Configuratiewijzigingen worden geaudit met oude en nieuwe waarde.
## Latere differentiatie
Visuele layout builder
Formulevelden
Relationele custom objects
Configuratiepromotie van test naar productie
Feature flags per tenant
Marketplace voor templates
## Development contract
Canonical API namespace: /v1/cfg.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 13. Automation en goedkeuringsflows
Modulecode
AUT
Doel
Herhaalbare administratieve stappen automatiseren zonder dat kritieke financiële of contractuele beslissingen oncontroleerbaar worden.
Productbeslissing
Generaliseren en centraal bouwen
Prioriteit en pack
P0/P1 | Automation
Monargo-aanbeveling
Triggers, voorwaarden, acties, wachttijden, approvals, retries, audit en menselijke controle. Dit wordt de basis voor Mona Actions.
## Gebruikers en rollen
Functioneel beheerder
Procesowner
Goedkeurder
Recordeigenaar
Systeemservice
## Schermen en werkruimtes
Flowoverzicht
Triggerconfiguratie
Voorwaardenbouwer
Actieconfiguratie
Goedkeuringsmatrix
Uitvoeringslog
Foutenqueue
Testsimulator
## Kerngegevens
Flow-ID en versie
Trigger
Bronentiteit
Voorwaardenboom
Actiestappen
Wachttijd
Uitvoeridentiteit
Retrybeleid
Goedkeurders
Escalatie
Resultaat en foutdetail
## Statusmodel
Flow: concept, actief, gepauzeerd, ingetrokken
Run: gepland, bezig, wacht, geslaagd, gedeeltelijk, mislukt, geannuleerd
Goedkeuring: niet gestart, open, goedgekeurd, afgewezen, vervallen
## Gebruikersacties
Flow activeren
Testrecord simuleren
Run opnieuw uitvoeren
Run annuleren
Goedkeuren
Afwijzen
Delegeren
Escaleren
## Business rules
Iedere flow heeft een unieke versie. Lopende runs blijven op hun oorspronkelijke versie.
Een flow moet idempotent zijn of een expliciete herhaalstrategie hebben.
Een actie die een nieuwe trigger veroorzaakt moet lusdetectie hebben.
Financiële boeking, betaling en definitieve verzending vereisen expliciet beleid en vaak menselijke goedkeuring.
Goedkeurders kunnen worden bepaald op rol, project, bedrag, kostenplaats, onderneming of verantwoordelijke.
Afwijzing vereist een reden wanneer de organisatie dat configureert.
Een goedkeurder mag niet zijn eigen aankoopfactuur goedkeuren wanneer het vier-ogenprincipe actief is.
## Automatiseringen
Status aanpassen
Taak maken
E-mail sturen
Document genereren
Veld bijwerken
Record vergrendelen
Webhook of API-call
Gerelateerd object maken
Melding sturen
## Edge cases
Trigger komt meerdere keren
Goedkeurder is afwezig
Record wordt gewijzigd tijdens goedkeuring
Externe API is tijdelijk niet beschikbaar
Flowversie wordt ingetrokken tijdens wachttijd
## Acceptatiecriteria
Elke automatische wijziging toont flow-ID, run-ID en gebruikte versie in de audit.
Een mislukte stap kan opnieuw worden uitgevoerd zonder dubbele factuur of dubbel record.
Een goedkeuringsflow blokkeert de geconfigureerde vervolgactie totdat de vereiste goedkeuring is bereikt.
Escalatie en vervanging worden getest met afwezigheidsscenario's.
Een functioneel beheerder kan een flow met testdata simuleren zonder productiedata te wijzigen.
## Latere differentiatie
Visuele BPMN-achtige designer
Parallelle takken
Menselijke taken
SLA-timers
Webhook callbacks
Process mining
AI-voorstel voor automatisering
## Development contract
Canonical API namespace: /v1/aut.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 14. Klanten, eindklanten en contactpersonen
Modulecode
CRM
Doel
Eén betrouwbare commerciële en administratieve waarheid voor alle klantgerelateerde processen.
## Gebruikers en rollen
Accountmanager
Calculator
Projectleider
Finance
Planner
Servicecoördinator
Beheerder
## Schermen en werkruimtes
Klantenoverzicht
Klantfiche
Contactpersonen
Adressen
Financieel
Tarieven
Gerelateerde dossiers
Communicatietijdlijn
Kredietdashboard
## Kerngegevens
Naam en rechtsvorm
Ondernemingsnummer en btw-nummer
Klanttype en eindklantrelatie
Taal
Algemene, facturatie- en Peppolkanalen
Factuuradres en werfadressen
Contactpersonen en rollen
Betaalvoorwaarde
Btw-regime
Grootboekrekening
Kredietstatus en kredietlimiet
Prijsgroep
Klantspecifieke tarieven met geldigheid
Accountmanager
Externe ID's
Klantreferenties
Inhoudingsplichtinformatie
Notities, taken en bestanden
## Statusmodel
Prospect, actief, on hold, geblokkeerd, gearchiveerd
Krediet: onbekend, kredietwaardig, waarschuwing, niet kredietwaardig
## Gebruikersacties
Klant maken
Contact toevoegen
Adres valideren
Peppol checken
Kredietstatus aanpassen
Offerte of project starten
Taak maken
Brief of e-mail sturen
Tarieven importeren
## Business rules
Een btw-nummer is uniek per tenant, met expliciete uitzondering voor duplicaatrelaties zoals vestigingen.
VIES of nationale registercontrole vult gegevens voor, maar de gebruiker blijft verantwoordelijk voor validatie.
Artikel-btw heeft voorrang op klant-btw wanneer het artikel expliciet een tarief heeft.
Facturatie-e-mail heeft voorrang op algemeen e-mailadres voor facturen.
Klantspecifiek tarief heeft voorrang op prijsgroep, binnen geldigheidsperiode.
Kredietstatus kan waarschuwen of blokkeren volgens tenantbeleid.
Archiveren is toegestaan met historiek. Verwijderen niet wanneer er transacties bestaan.
Contactpersonen kunnen per communicatietype voorkeuren hebben.
## Automatiseringen
Opvolgtaak na leadbron
Waarschuwing bij kredietlimiet
Melding bij gewijzigd btw-nummer
Periodieke klantreview
Automatische taalkeuze voor documenten
## Edge cases
Klant en eindklant verschillen
Factuur naar hoofdkantoor, werk naar vestiging
Particulier zonder btw-nummer
Klant fuseert of verandert ondernemingsnummer
Meerdere facturatiekanalen
Klant vraagt dataverwijdering met wettelijke bewaarplicht
## Acceptatiecriteria
Nieuwe offerte neemt taal, btw, betaalvoorwaarde en prijscontext correct over.
Een waarschuwing verschijnt wanneer een bestaand btw-nummer opnieuw wordt gebruikt.
Gebruikers zonder financiële rechten zien geen krediet- of bankgegevens.
Gerelateerde dossiers zijn vanuit de klant traceerbaar zonder dubbele invoer.
Historische documenten wijzigen niet wanneer klantnaam of adres later verandert.
## Latere differentiatie
Lead- en opportunitybeheer
Klantportaal
Consentmanagement
Automatische bedrijfsverrijking
Health score
Contracten en SLA's
## Development contract
Canonical API namespace: /v1/crm.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 15. Leveranciers en onderaannemers
Modulecode
SUP
Doel
Leveranciers en onderaannemers beheren als commerciële bron, uitvoeringspartner en financiële tegenpartij.
## Gebruikers en rollen
Aankoper
Calculator
Projectleider
Finance
Magazijn
Beheerder
## Schermen en werkruimtes
Leveranciersoverzicht
Leveranciersfiche
Contacten
Artikels en prijslijsten
Bestellingen
Aankoopfacturen
Onderaannemingsprestaties
Beoordelingen
## Kerngegevens
Naam, btw en ondernemingsnummer
Taal
Adressen
Contactpersonen
Betaalvoorwaarde
Bankrekening
Leverancierscategorie
Onderaannemerstatus
Webshopkoppeling
Prijsafspraken
Artikelreferenties
Kwalificaties en certificaten
Inhoudingsplicht
Externe ID
Beoordeling
Confidentialiteitsniveau
## Statusmodel
Kandidaat, actief, tijdelijk geblokkeerd, niet toegelaten, gearchiveerd
## Gebruikersacties
Leverancier maken
Artikelkoppeling toevoegen
Prijs importeren
Prijsaanvraag sturen
Bestelling maken
Certificaat toevoegen
Leverancier blokkeren
Beoordeling registreren
## Business rules
Bankrekeningwijzigingen vereisen extra controle en audit.
Een leverancier kan voor een artikel meerdere prijsrecords hebben, met één voorkeursleverancier.
Onderaannemers kunnen extra verplichte documenten hebben voor inzet op projecten.
Bestellen bij een geblokkeerde leverancier is niet toegestaan zonder override-recht.
Historische aankoopdocumenten bewaren leveranciergegevens als snapshot.
Confidentiële aankoopfacturen zijn alleen zichtbaar voor expliciet bevoegde rollen.
## Automatiseringen
Waarschuwing bij vervallend certificaat
Taak bij gewijzigd bankrekeningnummer
Melding bij te late levering
Periodieke leveranciersreview
## Edge cases
Zelfde leverancier met meerdere ondernemingen
Factoringrekening
Buitenlandse btw-regels
Onderaannemer werkt via tussenpartij
Artikelreferentie verandert
Leverancier wordt overgenomen
## Acceptatiecriteria
Voorkeursleverancier en actuele prijs worden correct voorgesteld in calculatie en aankoop.
Een bankrekeningwijziging is traceerbaar en kan een goedkeuring vereisen.
Geblokkeerde leverancier kan niet in nieuwe bestelling worden geselecteerd.
Leveranciersdocumenten zijn projectmatig herbruikbaar zonder duplicatie.
Confidentiële records blijven uitgesloten van zoekresultaten en exports zonder recht.
## Latere differentiatie
Leveranciersportaal
Vendor onboarding
ESG en risicoscore
Contractbeheer
Automatische prijsvergelijking
EDI
## Development contract
Canonical API namespace: /v1/sup.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 16. Werknemers, teams, vaardigheden en capaciteit
Modulecode
EMP
Doel
Operationele personeelsdata beheren zonder een volledig HR- of loonpakket te moeten nabouwen.
## Gebruikers en rollen
HR-beheerder
Planner
Teamleider
Medewerker
Projectleider
## Schermen en werkruimtes
Werknemersoverzicht
Werknemersfiche
Werkrooster
Vaardigheden
Tarieven
Afwezigheden
Planning
Werkbonhistoriek
Documenten
## Kerngegevens
Naam en contact
Personeelsnummer
Gebruikerskoppeling
Team en planninggroep
Functie
Actief van en tot
Werkrooster
Kosttarief
Verkooptarief of uurcode
Vaardigheden en attesten
Rijbewijs
Wappy-toegang
Kalenderkoppeling
Leverancier bij externe medewerker
Noodcontact
Documenten
## Statusmodel
Kandidaat, actief, tijdelijk afwezig, uit dienst, gearchiveerd
## Gebruikersacties
Werknemer maken
Rooster instellen
Vaardigheid toekennen
Tarief wijzigen
Wappy activeren
Afwezigheid registreren
Kalender synchroniseren
Uit dienst zetten
## Business rules
Persoonsgegevens worden afgeschermd volgens rol. Planner ziet operationele, niet noodzakelijk persoonlijke gegevens.
Kosttarieven zijn datumgebonden zodat historische nacalculatie correct blijft.
Een medewerker kan meerdere vaardigheden en planningsgroepen hebben.
Externe medewerkers kunnen aan een leverancier gekoppeld worden.
Een gebruiker en werknemer zijn aparte entiteiten met optionele één-op-éénkoppeling.
Planning buiten werkrooster geeft waarschuwing of blokkering volgens beleid.
## Automatiseringen
Taak bij vervallend attest
Melding bij overplanning
Jaarlijks verlofbudget aanmaken
Deactivatie van toegang bij einddatum
## Edge cases
Medewerker wisselt team
Tijdelijk contract
Onderbreking
Externe onderaannemer
Kosttarief wijzigt midden project
Medewerker gebruikt gedeeld toestel
## Acceptatiecriteria
Planning valideert beschikbaarheid, werkrooster en afwezigheid.
Historische werkbonkosten blijven gebaseerd op het tarief dat op uitvoeringsdatum geldig was.
Een uit dienst gezette medewerker behoudt historiek maar kan niet nieuw worden gepland.
Teamrechten beperken verlof- en werkboninzage correct.
Wappy-toegang kan los van kantoortoegang worden beheerd.
## Latere differentiatie
Competentiematrix
Certificaatbeheer
Shiftplanning
Timesheet approval
Loonexport
Resource forecasting
## Development contract
Canonical API namespace: /v1/emp.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 17. Artikels, posten, activiteiten en prijsmotor
Modulecode
ART
Doel
Een centrale bibliotheek voor materiaal, arbeid, materieel, onderaanneming, samengestelde producten en vrije commerciële lijnen.
## Gebruikers en rollen
Functioneel beheerder
Calculator
Aankoper
Magazijnier
Finance
Technieker
## Schermen en werkruimtes
Artikeloverzicht
Artikelfiche
Leveranciersprijzen
Prijsregels
Samenstelling
Voorraad
Documenten en afbeeldingen
Postenbibliotheek
Activiteiten
## Kerngegevens
Artikelnummer en barcode
Interne naam en verkoopnaam per taal
Artikeltype
Calculatietype
Lijntype
Artikelgroep
Activiteit
Eenheid en alternatieve eenheden
Conversiefactor
Minimumafname
Minimum- en gewenste voorraad
Standaard btw
Verkoop- en aankooprekening
Gewicht
Afbeeldingen
Wappy-zichtbaarheid
Bestelroute
Kostprijsstrategie
Verkoopprijsstrategie
Leveranciersreferenties, bruto prijs, korting, netto prijs en prijsdatum
Samenstellingsregels
## Statusmodel
Concept, actief, tijdelijk niet beschikbaar, uitgefaseerd, gearchiveerd
## Gebruikersacties
Artikel maken
Prijs importeren
Webshopartikel toevoegen
Leverancier koppelen
Samenstelling bouwen
Barcode genereren
Prijs herberekenen
Artikel vervangen
Voorraadparameters instellen
## Business rules
Historische documentlijnen bewaren een snapshot van naam, prijs, btw, eenheid en kostprijs.
Artikelprijswijzigingen wijzigen nooit stilzwijgend bestaande offertes.
Alternatieve eenheden gebruiken een vaste of formulematige conversie met afrondingsregel.
Samengestelde artikels kunnen calculatief uitklappen, commercieel samengevoegd tonen of beide.
Prijsprioriteit wordt expliciet vastgelegd: klantspecifiek, prijsgroep, artikelstrategie, handmatig.
Leveranciersprijs heeft geldigheidsdatum en bron.
Een uitgefaseerd artikel blijft zichtbaar in historiek maar is niet standaard selecteerbaar.
## Automatiseringen
Melding bij verouderde prijs
Herbestelvoorstel
Prijsupdate via connector
Waarschuwing bij negatieve marge
Vervangingsartikel voorstellen
## Edge cases
Verpakkingseenheid verschilt van verkoopeenheid
Prijs per honderd of duizend
Leverancierskorting op categorie
Samengesteld artikel met optionele onderdelen
Artikel met serienummer
Negatieve of retourlijn
## Acceptatiecriteria
Een artikel kan met correcte prijs, kost, btw en eenheid in offerte, order, werkbon en factuur worden gebruikt.
Bestaande documenten blijven inhoudelijk gelijk na wijziging van de artikelstam.
Prijsbron en prijsdatum zijn zichtbaar voor calculator en aankoper.
Voorraadartikels en niet-voorraadartikels volgen verschillende boekingsregels.
Samengestelde artikels leveren een controleerbare kostopbouw.
## Latere differentiatie
Prijsmatrix per klantsegment
Indexatie
Dynamische formules
Productconfigurator
Alternatieven en substitutie
CO2- of duurzaamheidsdata
## Development contract
Canonical API namespace: /v1/art.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 18. Postenbibliotheek en calculatiemotor
Modulecode
CAL
Doel
Nauwkeurig begroten van scope, hoeveelheden, kostcomponenten, risico, marge en verkoopprijs.
## Gebruikers en rollen
Calculator
Accountmanager
Projectleider
Directie
Aankoper
## Schermen en werkruimtes
Postenbibliotheek
Calculatieboom
Parameterpaneel
Meetstaatimport
Prijsanalyse
Margeanalyse
Scenariovergelijking
Calculatiecontrole
## Kerngegevens
Post-ID en versie
Hoofdstuk en structuur
Parameterdefinities
Formule
Eenheid
Hoeveelheid
Afvalpercentage
Productiviteit
Arbeidsuren
Materiaal
Materieel
Onderaanneming
Indirecte kosten
Risicoreserve
Kostprijs
Opslag
Marge
Verkoopprijs
Afronding
Bron en datum
## Statusmodel
Post: concept, goedgekeurd, gepubliceerd, ingetrokken
Calculatie: opmaak, intern te reviewen, gevalideerd, bevroren
## Gebruikersacties
Post maken
Parameter toevoegen
Formule testen
Meetstaat importeren
Prijs verversen
Scenario dupliceren
Marge vastzetten
Calculatie valideren
Bill of materials genereren
## Business rules
Berekeningen zijn deterministisch en tonen de formule en bronwaarden.
Kostprijs en verkoopprijs worden afzonderlijk opgeslagen.
Een margepercentage op verkoopprijs is niet hetzelfde als opslag op kostprijs. De UI maakt dit expliciet.
Meetstaatimport bewaart bronlijn, eenheid, hoeveelheid en mapping.
Een calculatieversie wordt bevroren wanneer ze in een verzonden offerte wordt gebruikt.
Wijziging van een parameter herberekent alleen afhankelijke lijnen.
Manuele prijsoverschrijving wordt gemarkeerd met gebruiker, datum en reden.
Indirecte kosten kunnen op lijn, post, hoofdstuk of volledige offerte worden verdeeld.
## Automatiseringen
Waarschuwing bij ontbrekende kostprijs
Review bij marge onder grens
Prijsverversing voor vervaldatum
Taak bij afwijkende meetstaateenheid
## Edge cases
Nulhoeveelheid
Negatieve verrekening
Prijs op aanvraag
Alternatief of optie
Werk met stelpost
Meerdere btw-tarieven
Rondingsverschil
Samengesteld artikel met recursie
## Acceptatiecriteria
Elke verkoopprijs is herleidbaar tot kostcomponenten, marge en eventuele overschrijving.
Een verzonden offerte blijft gekoppeld aan de exacte calculatieversie.
Formulefouten blokkeren verzending en tonen de betrokken parameter.
Meetstaatregels kunnen volledig worden gereconcilieerd met offertelijnen.
De bill of materials bevat alleen de gekozen en actieve scope.
## Latere differentiatie
AI-calculatieassistent
Historische benchmark
Risicosimulatie
Monte Carlo forecast
Regionale loon- en materiaalindex
Visuele configurator
## Development contract
Canonical API namespace: /v1/cal.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 19. Offertes, revisies en digitale goedkeuring
Modulecode
QOT
Doel
Een professioneel voorstel opmaken, intern controleren, versturen, opvolgen, laten goedkeuren en omzetten naar uitvoering.
## Gebruikers en rollen
Accountmanager
Calculator
Salesmanager
Klant
Projectleider
Finance
## Schermen en werkruimtes
Offerteoverzicht
Offertefiche
Lijnen en calculatie
Revisies
Financiële planning
Documentpreview
Verzenddialoog
Klantgoedkeuring
Analyse
## Kerngegevens
Offertenummer
Versie
Klant en eindklant
Contactpersoon
Projectadres
Datum en geldigheid
Taal
Verantwoordelijke
Klantreferentie
Intro en slottekst
Hoofdstukken en lijnen
Opties en alternatieven
Kortingen en toeslagen
Btw
Betalingsschema
Voorwaarden
Documenttemplate
Handtekening
Goedkeuringsmetadata
Slaagkans en reden verlies
## Statusmodel
Opmaak, interne review, goedgekeurd voor verzending, verzonden, gelezen, feedback, herziening gevraagd, digitaal ondertekend, gewonnen, verloren, vervallen, ingetrokken
## Gebruikersacties
Nieuwe offerte
Template kiezen
Calculatie koppelen
Revisie maken
PDF genereren
E-mail sturen
Digitaal laten ondertekenen
Order maken
Project maken
Verrekening maken
Dupliceren
Intrekken
## Business rules
Offertenummer en versienummer worden afzonderlijk beheerd.
Een verzonden versie is onveranderlijk. Wijzigingen creëren een nieuwe revisie.
Opties zijn niet opgenomen in totaal tenzij geselecteerd.
Alternatieven zijn wederzijds exclusief wanneer zo geconfigureerd.
Digitale goedkeuring bewaart naam, tijdstip, IP of technische metadata en documenthash.
Goedkeuring activeert niet automatisch alle opties zonder expliciete klantselectie.
Vervallen offertes kunnen niet worden goedgekeurd zonder heractivering.
Verliesreden is verplicht voor rapportering wanneer status verloren wordt gekozen.
## Automatiseringen
Follow-up na verzending
Status gelezen na portaalweergave
Taak bij feedback
Project starten na goedkeuring
Waarschuwing voor vervaldatum
Review bij lage marge
## Edge cases
Klant keurt slechts deel goed
Meerdere contactpersonen ondertekenen
Offerte met meerdere ondernemingen
Valuta verandert
Klant vraagt prijsherziening na vervaldatum
PDF en UBL hebben verschillende doeleinden
## Acceptatiecriteria
De klant ziet exact de verstuurde versie en kan geen niet-aangeboden scope selecteren.
Een nieuwe revisie toont verschillen met de vorige versie.
Goedkeuring kan aantoonbaar aan documenthash en versie worden gekoppeld.
Goedgekeurde scope kan zonder dubbele invoer naar project of order.
Rapportering onderscheidt offertewaarde, gekozen opties en verwachte waarde.
## Latere differentiatie
Klantportaal met opmerkingen per lijn
CPQ-regels
E-signature provider
Online betaling voorschot
Multi-party approval
AI-samenvatting en risicoanalyse
## Development contract
Canonical API namespace: /v1/qot.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 20. Verrekeningen, meerwerken en minderwerken
Modulecode
SET
Doel
Contractuele scopewijzigingen beheersen zonder het oorspronkelijke akkoord te overschrijven.
Productbeslissing
Sectorfunctie bovenop offerteversies
Prioriteit en pack
P2 | Construction Pack
Monargo-aanbeveling
Bouwen als change order wanneer projectbudget en offerteversies stabiel zijn.
## Gebruikers en rollen
Projectleider
Calculator
Accountmanager
Klant
Finance
## Schermen en werkruimtes
Verrekeningsoverzicht
Verrekeningsfiche
Relatie met basisofferte
Impactanalyse
Goedkeuring
Facturatiehistoriek
## Kerngegevens
Verrekeningsnummer
Project
Basisofferte en lijnreferentie
Reden
Type meerwerk of minderwerk
Scope en lijnen
Kost en verkoop
Impact op planning
Impact op budget
Goedkeuringsstatus
Facturatiestatus
## Statusmodel
Concept, intern te beoordelen, verzonden, goedgekeurd, afgewezen, ingetrokken, uitgevoerd, gefactureerd
## Gebruikersacties
Verrekening maken
Basislijn selecteren
Impact berekenen
Versturen
Goedkeuren
Projectbudget bijwerken
Vorderen of factureren
## Business rules
De oorspronkelijke offerte blijft onveranderd.
Een verrekening kan positief, negatief of nul zijn.
Goedgekeurde verrekeningen worden afzonderlijk aan projectbudget toegevoegd.
Uitvoering vóór klantgoedkeuring vereist expliciete risicovlag en bevoegdheid.
Minderwerken mogen bestaande facturatie niet onder nul brengen zonder creditproces.
Facturatie toont herkomst en eerdere vorderingen.
## Automatiseringen
Taak bij uitvoering zonder goedkeuring
Melding bij grote budgetimpact
Status uitgevoerd na werkbon
Facturatieherinnering
## Edge cases
Mondeling akkoord
Noodinterventie
Verrekening vervangt eerdere verrekening
Minderwerk na gedeeltelijke factuur
Meerdere opdrachtgevers
## Acceptatiecriteria
Basiscontract en wijzigingen zijn afzonderlijk traceerbaar.
Projectbudget toont oorspronkelijke scope en netto wijzigingen.
Een minderwerk wordt correct in vordering en factuur verwerkt.
Uitvoering zonder goedkeuring is zichtbaar in risicorapport.
De klantdocumenten tonen oorzaak en financiële impact.
## Latere differentiatie
Change order log
Contractuele termijnen
Claimmanagement
Planning impact baseline
Klantportaaldiscussie
## Development contract
Canonical API namespace: /v1/set.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 21. Verkooporders en uitvoeringsopdrachten
Modulecode
ORD
Doel
Goedgekeurde commerciële scope omzetten naar leverbare, planbare en factureerbare opdracht.
Productbeslissing
Generaliseren tot Job of Order, alleen waar nodig
Prioriteit en pack
P1 | Projects / Operations
Monargo-aanbeveling
Niet elk bedrijf heeft een verkooporder nodig. Gebruik configureerbare jobtypes en activeer orderlogica voor levering, uitvoering of fulfilment.
## Gebruikers en rollen
Sales
Werkvoorbereider
Planner
Projectleider
Magazijn
Finance
## Schermen en werkruimtes
Orderoverzicht
Orderfiche
Uitvoeringslijnen
Levering
Planning
Werkbonnen
Facturatie
Documentpreview
## Kerngegevens
Ordernummer
Bronofferte en versie
Klant en eindklant
Contact
Project
Orderdatum
Gewenste lever- of uitvoerdatum
Klantreferentie
Verantwoordelijke
Betaalvoorwaarde
Lijnen
Besteld, uitgevoerd, geleverd en gefactureerd aantal
Prijs en kost
Facturatiestrategie
Handtekening
## Statusmodel
Concept, bevestigd, gepland, in uitvoering, gedeeltelijk uitgevoerd, uitgevoerd, gedeeltelijk geleverd, geleverd, gedeeltelijk gefactureerd, gefactureerd, afgesloten, geannuleerd
## Gebruikersacties
Order maken
Bevestiging sturen
Plannen
Werkbon maken
Levernota maken
Pro forma genereren
Digitaal ondertekenen
Factureren
Afsluiten
## Business rules
Orderlijnen bewaren bronrelatie naar offertelijn.
Uitgevoerd, geleverd en gefactureerd aantal worden afzonderlijk bijgehouden.
Overfacturatie is niet toegestaan zonder expliciet recht.
Meerdere orders mogen worden geconsolideerd wanneer klant, onderneming, valuta en factuurcontext compatibel zijn.
Annuleren na uitvoering vereist correctie van werkbon, levering of factuur.
Pro forma is geen definitieve boekhoudkundige factuur.
## Automatiseringen
Planningtaak na bevestiging
Bestelvoorstel uit order
Factuurvoorstel na uitvoering
Melding bij achterstallige levering
## Edge cases
Deellevering
Backorder
Uitvoering wijkt af van order
Gratis vervanging
Order voor project én los verkoopproces
Retour
## Acceptatiecriteria
De voortgang per orderlijn is zichtbaar voor besteld, uitgevoerd, geleverd en gefactureerd.
Bundelfacturatie neemt alleen compatibele en nog niet gefactureerde lijnen op.
Orderuitvoering kan op werkelijke aantallen factureren.
Een levernota neemt de geselecteerde open hoeveelheden over.
Annulering laat geen verborgen open verplichtingen achter.
## Latere differentiatie
Fulfilmentregels
Backorderbeheer
Klantportaalstatus
Pick-pack-ship
RMA en retour
## Development contract
Canonical API namespace: /v1/ord.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 22. Projecten en centraal uitvoeringsdossier
Modulecode
PRJ
Doel
Alle commerciële, operationele, logistieke en financiële projectinformatie in één bestuurbaar dossier samenbrengen.
## Gebruikers en rollen
Projectleider
Werkvoorbereider
Planner
Calculator
Aankoper
Finance
Directie
Klant via portaal
## Schermen en werkruimtes
Projectoverzicht
Projectfiche
Scope en budget
Planning
Fasen en mijlpalen
Team en partners
Bestelroutes
Werkbonnen
Aankoop
Facturatie
Nacalculatie
Risico's
Documenten
## Kerngegevens
Projectnummer en naam
Klant, eindklant en werf
Projectleider en team
Start, eind en baseline
Status en type
Actieve offertes en verrekeningen
Budget per kosttype, post en activiteit
Fasen
Bestelroutes
Facturatieplan
Contractgegevens
Bouwpartners
Werfmeldingsgegevens
Risico's en issues
Documenten
Forecast
## Statusmodel
Voorbereiding, gepland, actief, tijdelijk gepauzeerd, technisch klaar, financieel af te sluiten, afgesloten, geannuleerd
## Gebruikersacties
Project maken
Team toewijzen
Offerte activeren
Fase plannen
Bestelling maken
Werkbon raadplegen
Budget aanpassen
Risico registreren
Project delen
Afsluitcontrole starten
## Business rules
Alleen actieve en goedgekeurde commerciële documenten voeden het basisbudget.
Projectstatus en financiële status zijn afzonderlijk.
Afsluiten vereist configureerbare controles op open werkbonnen, bestellingen, aankoopfacturen en facturen.
Budgetwijzigingen buiten offerte of verrekening worden als prognosecorrectie gelogd.
Projectleider kan operationele rechten krijgen zonder volledige financiële inzage.
Een project kan meerdere werflocaties en contactpersonen hebben.
De bron van iedere kost en opbrengst blijft drill-downbaar.
## Automatiseringen
Kickofftaak
Waarschuwing bij budgetoverschrijding
Melding bij open verplichting
Forecastupdate
Afsluitcheck
Periodieke projectrapportage
## Edge cases
Project zonder offerte
Meerdere klanten of betalers
Joint venture
Project wordt gesplitst
Projectleider verandert
Heropening na afsluiting
## Acceptatiecriteria
Project toont één coherent overzicht van scope, budget, uitvoering, aankoop en facturatie.
Elke KPI is herleidbaar tot bronrecords.
Afsluiten blokkeert of waarschuwt voor open transacties volgens beleid.
Gebruikersrechten kunnen operationele en financiële informatie scheiden.
Forecastwijzigingen bewaren reden, auteur en datum.
## Latere differentiatie
Risico- en issueregister
Klantportaal
Document approval
Contract milestones
Projectbaseline en earned value
AI projectcopilot
## Development contract
Canonical API namespace: /v1/prj.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 23. Budgetopvolging, nacalculatie en forecast
Modulecode
NAC
Doel
Projectrendabiliteit tijdig begrijpen, niet pas nadat het project is afgesloten.
## Gebruikers en rollen
Projectleider
Controller
Directie
Calculator
Finance
## Schermen en werkruimtes
Nacalculatiegrid
Kosttypeanalyse
Postanalyse
Activiteitenanalyse
Verplichtingen
Margeforecast
Afwijkingen
Brontransacties
## Kerngegevens
Gebudgetteerde kost en opbrengst
Gerealiseerde kost
Open bestellingen
Nog te ontvangen facturen
Werkbonkost
Interne levering
Regiekost en regieopbrengst
Prognosecorrectie
Estimate at completion
Gebudgetteerde en verwachte marge
Completeness flags
## Statusmodel
Datakwaliteit: volledig, waarschuwing, onvolledig
Forecast: concept, bevestigd, vervangen
## Gebruikersacties
Niveau kiezen
Bron openklikken
Kost uitsluiten
Prognose aanpassen
Datakwaliteitsissue markeren
Snapshot bewaren
Rapport exporteren
## Business rules
Budget komt uitsluitend uit geselecteerde actieve offerte- en verrekeningsversies.
Bestellingen zijn verplichtingen en tellen niet dubbel als gerealiseerde kost.
Aankoopfactuur en werkbon moeten via kostbronbeleid dubbele materiaalboeking vermijden.
Gerealiseerde kosten gebruiken kostprijs, niet verkoopprijs.
Prognosecorrecties zijn geen boekingen en moeten apart zichtbaar zijn.
Regiewerk wordt apart van gebudgetteerde scope getoond.
Historische rapportage gebruikt period snapshots of reproduceerbare tijdsfilters.
## Automatiseringen
Waarschuwing bij overschrijding
Melding bij negatieve eindmarge
Detectie dubbele kost
Forecastvoorstel op basis van open verplichtingen
Taak bij ontbrekende kostprijs
## Edge cases
Aankoopfactuur bevat meerdere projecten
Werkbon bevat materiaal dat later gefactureerd wordt
Retour of creditnota
Valutaverschil
Prijsherziening
Projectoverhead
## Acceptatiecriteria
De formule voor iedere kolom is zichtbaar en reproduceerbaar.
Dubbele kosten kunnen worden gedetecteerd en gecontroleerd uitgesloten.
Open bestellingen worden zichtbaar zonder gerealiseerde kost te verhogen.
Forecast en feitelijke boekingen zijn duidelijk onderscheiden.
Analyse kan minstens per kosttype, activiteit, post, artikel, order en bronrecord.
## Latere differentiatie
Earned value
AI eindmargevoorspelling
Cashflow per project
Scenarioforecast
Benchmark tussen projecten
Productiviteitsanalyse
## Development contract
Canonical API namespace: /v1/nac.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 24. Dagplanning, resources en dispatching
Modulecode
DPL
Doel
Mensen, ploegen, materieel en opdrachten op het juiste moment en de juiste plaats inzetten.
## Gebruikers en rollen
Planner
Teamleider
Projectleider
Technieker
Servicecoördinator
## Schermen en werkruimtes
Dag- en weekkalender
Lijstweergave
Wachtkamer
Resourceweergave
Kaart
Conflictenpaneel
Planningitem
Ongeplande opdrachten
## Kerngegevens
Start en einde
Tijdzone
Project, order, installatie of onderhoud
Klant en adres
Werknemers en ploeg
Materieel
Planningresource
Uitvoeringsfase
Planningtype en kleur
Regie-indicatie
Details en instructies
Benodigde items
Formulieren
Taken
Status
Reistijd
## Statusmodel
Ongepland, voorlopig, bevestigd, onderweg, gestart, gepauzeerd, afgerond, niet uitgevoerd, geannuleerd
## Gebruikersacties
Item plannen
Drag-and-drop verplaatsen
Ploeg toewijzen
Materieel reserveren
Route bekijken
Werkbon maken
Formulier koppelen
Serie maken
Medewerker vervangen
Klant informeren
## Business rules
Een planningitem kan meerdere medewerkers en materieel bevatten.
Conflictdetectie controleert overlap, afwezigheid, werkrooster, vaardigheden en materieelbeschikbaarheid.
Adres wordt voorgesteld vanuit bronrecord maar kan per opdracht afwijken.
Items op planning worden als voorstel naar werkbon meegenomen, niet automatisch als verbruik geboekt.
Terugkerende planning gebruikt een serie met uitzonderingen.
Wijzigingen aan een reeds gestarte opdracht worden aan de mobiele gebruiker gesynchroniseerd en gemarkeerd.
Planningstatus en werkbonstatus blijven gerelateerd maar zijn niet identiek.
## Automatiseringen
Herinnering aan technieker
Klantmelding vooraf
Werkbon genereren
Routevoorstel
Escalatie bij niet gestart
Herplanning bij afwezigheid
## Edge cases
Meerdere tijdzones
Nachtwerk
Opdracht over meerdere dagen
Spoedinterventie
Technieker offline
Materieelconflict
Serie met feestdagen
## Acceptatiecriteria
Overlappingen en afwezigheden worden zichtbaar vóór bevestiging.
Wijzigingen synchroniseren naar mobiele app met versiecontrole.
Een werkbon kan vanuit planning worden gemaakt zonder contextverlies.
Benodigde items en formulieren zijn zichtbaar voor de uitvoerder.
Terugkerende series kunnen per voorkomen of vanaf een datum worden aangepast.
## Latere differentiatie
Routeoptimalisatie
Skill-based dispatch
Capaciteitsheatmap
AI-planningsvoorstel
Klant self-scheduling
Live voertuiglocatie
## Development contract
Canonical API namespace: /v1/dpl.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 25. Werkbonnen en mobiele uitvoering
Modulecode
WBO
Doel
Werkelijke uitvoering betrouwbaar, snel en controleerbaar registreren op kantoor en op de werf.
Productbeslissing
Sterk verdiepen
Prioriteit en pack
P0 | Operations
Monargo-aanbeveling
Offline-first, meerdere medewerkers, materiaal, materieel, formulieren, garantie versus factureerbaar werk, review, correctie en volledige brontraceerbaarheid.
## Gebruikers en rollen
Technieker
Ploegleider
Planner
Projectleider
Backoffice
Klant
## Schermen en werkruimtes
Mobiele opdrachtenlijst
Werkbonheader
Timer en uren
Materiaal
Materieel
Kilometers
Formulieren
Foto's
Handtekening
Review en correctie
Analyse en kalender
## Kerngegevens
Werkbonnummer
Planningitem
Project, order en installatie
Klant en werf
Datum
Werknemers
Start, pauzes en einde
Uurcode en activiteit
Kilometers en mobiliteitstype
Materialen en aantallen
Materieel en duur
Omschrijving
Extra werk
Formulierantwoorden
Foto's
Handtekening
Kost en verkoop
Reviewstatus
Facturatiestatus
## Statusmodel
Concept, mobiel bezig, lokaal wachtend op sync, ingediend, te reviewen, goedgekeurd, afgewezen voor correctie, vergrendeld, gedeeltelijk gefactureerd, gefactureerd
## Gebruikersacties
Start werk
Pauze
Uren toevoegen
Materiaal scannen
Foto nemen
Formulier invullen
Klant laten tekenen
Indienen
Reviewen
Corrigeren
Factuur of order maken
## Business rules
Mobiele registratie is offline-first met lokale mutatiewachtrij.
Een medewerker kan alleen eigen uren wijzigen, tenzij ploegleiderrecht actief is.
Verplichte formulieren blokkeren inzending.
Na goedkeuring kunnen uren en materiaal alleen via correctieboeking worden gewijzigd.
Materiaalverbruik kan voorraad boeken volgens configured source of stock location.
Facturatiestrategieën ondersteunen detail, gegroepeerde lijnen en één totaalregel.
Kosttarief wordt bepaald op uitvoeringsdatum.
Handtekening wordt gekoppeld aan de exacte werkbonversie.
## Automatiseringen
Melding bij ontbrekende handtekening
Werkbonreview na inzending
Voorraadboeking na goedkeuring
Factuurvoorstel
Vervolgtaak bij niet uitgevoerd
Servicehistoriek bijwerken
## Edge cases
Offline meerdere dagen
Twee gebruikers wijzigen dezelfde werkbon
Ploeg met verschillende uren
Materiaal uit verschillende magazijnen
Klant weigert te tekenen
Werkbon bevat garantie en factureerbaar werk
## Acceptatiecriteria
Een technieker kan een volledige werkbon offline registreren en later veilig synchroniseren.
Conflicten worden niet stilzwijgend overschreven.
Goedgekeurde werkbon voedt projectkost, voorraad en facturatie volgens configureerbare regels.
Verplichte vragen en handtekeningregels worden afgedwongen.
Elke correctie na goedkeuring blijft auditbaar.
## Latere differentiatie
Spraak naar werkbon
AI serviceverslag
Fotoherkenning
NFC of barcode assets
Geofencing
Klant realtime volgen
## Development contract
Canonical API namespace: /v1/wbo.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 26. Prijsaanvragen en leveranciersportaal
Modulecode
PRQ
Doel
Marktprijzen en onderaannemingsvoorstellen gestructureerd opvragen voordat calculatie of aankoop definitief wordt.
## Gebruikers en rollen
Calculator
Aankoper
Leverancier
Projectleider
## Schermen en werkruimtes
Prijsaanvraagoverzicht
Aanvraagfiche
Geselecteerde lijnen
Leverancierslijst
Leveranciersportaal
Vergelijkingsmatrix
Goedkeuring
Terugkoppeling naar calculatie
## Kerngegevens
Aanvraagnummer
Bronofferte en lijnen
Scopebeschrijving
Hoeveelheden en eenheden
Deadline
Leveranciers
Portal token
Prijs per lijn
Alternatief
Levertermijn
Voorwaarden
Bijlagen
Gekozen leverancier
Goedkeuringsreden
## Statusmodel
Concept, verzonden, gedeeltelijk beantwoord, volledig beantwoord, in vergelijking, goedgekeurd, afgewezen, vervallen, ingetrokken
## Gebruikersacties
Lijnen selecteren
Aanvraag maken
Leveranciers toevoegen
Versturen
Herinneren
Antwoord importeren
Vergelijken
Leverancier kiezen
Prijs terugschrijven
## Business rules
Leveranciers zien alleen hun eigen aanvraag en geen concurrentiële prijzen.
Portal links zijn tijdsgebonden, intrekbaar en niet voorspelbaar.
De bronoffertelijnen blijven gekoppeld zodat prijs terugschrijven controleerbaar is.
Een leverancier kan alternatieven voorstellen zonder oorspronkelijke scope te overschrijven.
Goedkeuring kan per lijn of volledige aanvraag.
Prijsdatum en geldigheid worden bewaard.
Terugschrijven naar een verzonden offerte vereist revisie.
## Automatiseringen
Herinnering voor deadline
Melding bij antwoord
Taak bij grote prijsafwijking
Status vervallen
Goedkeuring bij bedrag boven grens
## Edge cases
Zelfde artikel komt meerdere keren voor
Leverancier antwoordt gedeeltelijk
Prijs is inclusief transport
Alternatief heeft andere eenheid
Valuta verschilt
Deadline wordt verlengd
## Acceptatiecriteria
Leveranciers hebben geen toegang tot elkaars informatie.
Prijsvergelijk toont appels met appels door eenheid en scope te normaliseren.
Goedgekeurde prijs kan met bronverwijzing naar calculatie.
Een wijziging aan verzonden offerte creëert een revisie.
Portal toegang kan onmiddellijk worden ingetrokken.
## Latere differentiatie
Reverse auction
Bid leveling
AI scopevergelijking
Leveranciersscore
Contractprijsbibliotheek
## Development contract
Canonical API namespace: /v1/prq.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 27. Aankooporders, onderaanneming, huur en transport
Modulecode
PUR
Doel
Alle externe en interne materiaal- en dienstverplichtingen controleren vanaf behoefte tot ontvangst en factuur.
## Gebruikers en rollen
Aankoper
Projectleider
Magazijnier
Finance
Leverancier
Onderaannemer
## Schermen en werkruimtes
Bestellingsoverzicht
Aankooporder
Interne order
Onderaannemingsorder
Huurorder
Transportorder
Ontvangst
Afroep
Goedkeuring
Analyse
## Kerngegevens
Bestelnummer
Type
Leverancier
Project
Besteldatum
Leverdatum
Leveradres
Lijnen
Hoeveelheid
Eenheid
Prijs en korting
Btw
Besteld, bevestigd, ontvangen en gefactureerd aantal
Projectbestelroute
Afroepplan
Transportgegevens
Huurperiode
Onderaannemingsscope
Goedkeuringsstatus
## Statusmodel
Concept, ter goedkeuring, goedgekeurd, verzonden, bevestigd, gedeeltelijk ontvangen, ontvangen, gedeeltelijk gefactureerd, gefactureerd, afgesloten, geannuleerd
## Gebruikersacties
Bestelling maken
Goedkeuren
Versturen
Bevestiging registreren
Ontvangst boeken
Afroep maken
Retour maken
Factuur matchen
Afsluiten
## Business rules
Besteltype bepaalt specifieke velden en financiële impact.
Een bestelling is een verplichting, geen gerealiseerde kost.
Ontvangst kan in delen en per locatie.
Prijs- of hoeveelheidafwijkingen boven tolerantie vereisen goedkeuring.
Afroepbestelling heeft raamhoeveelheid en individuele afroepen.
Interne order reserveert of verplaatst voorraad, afhankelijk van configuratie.
Onderaannemingsorder kan prestaties en certificaten vereisen.
Transportorder bevat laad- en losvensters.
## Automatiseringen
Goedkeuring op bedrag
Herinnering bij late levering
Ontvangstmelding
Taak bij prijsafwijking
Herbestelvoorstel
## Edge cases
Overlevering
Onderlevering
Vervangartikel
Dropship rechtstreeks naar werf
Levering zonder bestelling
Factuur vóór ontvangst
Retour na factuur
## Acceptatiecriteria
Besteld, ontvangen en gefactureerd worden per lijn afzonderlijk bijgehouden.
Ontvangstpercentage is reproduceerbaar en niet alleen een visuele indicatie.
Een bestelling kan niet volledig worden afgesloten met open hoeveelheden zonder expliciete reden.
Project en voorraadbestellingen boeken naar de juiste locatie en kostcontext.
Afwijkingen worden zichtbaar vóór factuurgoedkeuring.
## Latere differentiatie
Supplier acknowledgements
EDI
Purchase planning
Automatische tendering
Contract call-offs
Three-way match
## Development contract
Canonical API namespace: /v1/pur.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 28. Voorraad, reservaties en stockmutaties
Modulecode
STK
Doel
Fysieke voorraad betrouwbaar beheren per locatie, project, voertuig en medewerker.
## Gebruikers en rollen
Magazijnier
Aankoper
Technieker
Projectleider
Finance
## Schermen en werkruimtes
Voorraadoverzicht
Locaties
Mutatiehistoriek
Telling
Reservaties
Herbestelvoorstel
Transfers
Serienummers
## Kerngegevens
Artikel
Locatie
Beschikbaar
Fysiek
Gereserveerd
In bestelling
In transfer
Minimum en gewenst
Lot of serienummer
Mutatietype
Aantal
Kostwaarde
Bronrecord
Datum en gebruiker
## Statusmodel
Mutatie: concept, geboekt, gecorrigeerd
Telling: voorbereid, bezig, ingediend, gereconcilieerd, geboekt
## Gebruikersacties
Ontvangst boeken
Verbruik boeken
Reserveren
Vrijgeven
Transfer starten
Transfer ontvangen
Telling uitvoeren
Correctie maken
Herbestelvoorstel genereren
## Business rules
Een geboekte mutatie is onveranderlijk. Correctie gebeurt met tegenboeking.
Beschikbaar = fysiek min reservaties, rekening houdend met beleid voor inkomende voorraad.
Een telling genereert verschilmutaties in plaats van historiek te overschrijven.
Negatieve voorraad is configureerbaar per locatie of artikelgroep.
Serienummerartikels vereisen unieke eenheden.
Voorraadkostmethode wordt expliciet gekozen, bijvoorbeeld gemiddelde kost of FIFO.
Materiaal op werkbon boekt pas bij goedkeuring of configureerbaar eerder.
Transfers hebben vertrek en ontvangst als aparte gebeurtenissen.
## Automatiseringen
Herbestelvoorstel onder minimum
Waarschuwing negatieve voorraad
Taak bij open transfer
Voorraadboeking uit werkbon
Cycle count planning
## Edge cases
Telling tijdens lopende transacties
Retour van werf
Beschadigde goederen
Verschillende eenheden
Serienummer ontbreekt
Dropship zonder magazijnontvangst
## Acceptatiecriteria
Voor iedere voorraadwaarde bestaat een volledige mutatiehistoriek.
Een telling vernietigt geen historische transacties.
Reservatie voorkomt onbedoelde dubbele toewijzing.
Transfers zijn pas beschikbaar op bestemming na ontvangst.
Projectverbruik is traceerbaar naar werkbon of interne levering.
## Latere differentiatie
Mobiele magazijnapp
Picklijsten
Lot en vervaldatum
Cycle counting
Warehouse zones
Demand forecasting
## Development contract
Canonical API namespace: /v1/stk.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 29. Levernota's, verzending en bewijs van levering
Modulecode
DLV
Doel
Fysieke levering aantonen, hoeveelheden beheren en correcte facturatie of voorraaduitboeking ondersteunen.
## Gebruikers en rollen
Magazijnier
Chauffeur
Klant
Backoffice
Finance
## Schermen en werkruimtes
Levernotaoverzicht
Picklijst
Levernotafiche
Handtekening
Retour
Facturatie
## Kerngegevens
Levernotanummer
Order
Klant en afleveradres
Chauffeur
Leverdatum
Lijnen
Geleverd aantal
Serienummers
Verpakking
Opmerking
Foto
Ontvanger en handtekening
Facturatiestatus
## Statusmodel
Concept, gepickt, onderweg, geleverd, deels geleverd, geweigerd, retour, gefactureerd, geannuleerd
## Gebruikersacties
Levernota maken
Pick bevestigen
Serienummer scannen
Levering bevestigen
Klant laten tekenen
Retour registreren
Factureren
## Business rules
Levering kan niet meer bedragen dan open orderhoeveelheid zonder bevoegdheid.
Handtekening en ontvanger worden aan de leverversie gekoppeld.
Voorraaduitboeking gebeurt op bevestigde levering.
Retour maakt een afzonderlijke inkomende mutatie.
Meerdere levernota's kunnen één order afwerken.
Facturatie gebruikt alleen nog niet gefactureerde levering.
## Automatiseringen
Klantmelding bij verzending
Factuurvoorstel na levering
Taak bij geweigerde levering
Voorraadboeking
## Edge cases
Deellevering
Levering op ander adres
Geen handtekening mogelijk
Beschadiging
Retour op latere datum
Dropship
## Acceptatiecriteria
Open orderhoeveelheid wordt correct verminderd na bevestigde levering.
Voorraad en facturatie gebruiken dezelfde leverbron.
Bewijs van levering is onveranderlijk en downloadbaar.
Retour corrigeert voorraad en facturatiecontext.
Serienummers blijven traceerbaar tot klant.
## Latere differentiatie
Routeplanning
Carrier integration
Track and trace
Proof of delivery app
Pick-pack workflow
## Development contract
Canonical API namespace: /v1/dlv.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 30. Verkoopfacturen, creditnota's en betaling
Modulecode
SIV
Doel
Correcte, traceerbare en juridisch consistente verkoopfacturatie vanuit uitgevoerde of contractuele prestaties.
## Gebruikers en rollen
Finance
Projectleider
Accountmanager
Klant
Boekhouder
## Schermen en werkruimtes
Factuuroverzicht
Factuurfiche
Factuurvoorstel
Bronselectie
Verzenddialoog
Peppolstatus
Betalingen
Creditnota
Aanmaningen
## Kerngegevens
Factuurnummer
Dagboek
Klant en factuuradres
Factuurdatum en vervaldatum
Bronrecords en bronlijnen
Lijnen
Aantal, prijs, korting, btw
Valuta
Betalingsreferentie
Betaalvoorwaarde
Peppolidentiteit
Verzendkanaal
Boekhoudstatus
Openstaand bedrag
Betalingen
Creditrelatie
## Statusmodel
Concept, gecontroleerd, genummerd, verzonden, Peppol aangeboden, geleverd, geweigerd, gedeeltelijk betaald, betaald, vervallen, gecrediteerd, oninbaar
## Gebruikersacties
Voorstel maken
Bronlijnen selecteren
Controleren
Nummeren
PDF of UBL genereren
Peppol versturen
E-mail sturen
Betaling matchen
Creditnota maken
Aanmaning sturen
## Business rules
Na definitieve nummering mag inhoud alleen via creditnota en nieuwe factuur worden gecorrigeerd.
Bronlijnen houden bij hoeveel reeds is gefactureerd.
Meerdere bronnen kunnen worden geconsolideerd indien juridische context compatibel is.
Factuurdatum, btw-periode en dagboek volgen ondernemingsbeleid.
Peppol- en e-mailverzending bewaren technische status en bewijs.
Betalingen kunnen gedeeltelijk, gecombineerd of via credit worden afgepunt.
Creditnota verwijst naar originele factuur en corrigeert btw en openstaand saldo.
Factuur-PDF en UBL moeten inhoudelijk reconciliëren.
## Automatiseringen
Factuur na abonnement
Factuurvoorstel na werkbon of levering
Betalingsmatching
Aanmaning na vervaldag
Boekhoudsync
Kredietwaarschuwing
## Edge cases
Voorschot en eindfactuur
G-rekening of inhouding
Meerdere btw-regimes
Self-billing
Betaling zonder referentie
Factuur wordt door Peppol geweigerd
Klant heeft meerdere entiteiten
## Acceptatiecriteria
Definitieve facturen zijn onveranderlijk.
Elke factuurlijn is herleidbaar tot bron of gemarkeerd als manueel.
PDF en UBL hebben dezelfde totalen en btw.
Peppolstatus en bewijs zijn zichtbaar.
Creditnota corrigeert openstaand bedrag en bronfacturatie.
## Latere differentiatie
Dunning workflows
Online payment links
Revenue recognition
E-invoicing per land
Customer billing portal
Cash collection AI
## Development contract
Canonical API namespace: /v1/siv.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 31. Aankoopfacturen, OCR, matching en goedkeuring
Modulecode
PIV
Doel
Inkomende facturen efficiënt verwerken met volledige controle over leverancier, projectkost, bestelling, btw, betaling en boekhouding.
## Gebruikers en rollen
Finance
Aankoper
Projectleider
Goedkeurder
Boekhouder
Leverancier indirect
## Schermen en werkruimtes
Inbox
Documentviewer en OCR
Factuurfiche
Lijncodering
Matchingsscherm
Goedkeuring
Betaalvoorstel
Boekhoudexport
Uitzonderingen
## Kerngegevens
Leverancier
Factuurnummer leverancier
Factuur- en vervaldatum
Valuta
PDF en UBL
Lijnen
Bestelling en ontvangst
Project en activiteit
Artikel of kosttype
Btw
Grootboekrekening
Analytische dimensies
Goedkeurders
Confidentialiteit
Betalingsstatus
Boekhoudstatus
Duplicaatsleutel
## Statusmodel
Ontvangen, te herkennen, te valideren, te matchen, ter goedkeuring, afgewezen, goedgekeurd, klaar voor boekhouding, geboekt, klaar voor betaling, betaald, gecrediteerd
## Gebruikersacties
Uploaden
Peppol ontvangen
OCR uitvoeren
Leverancier matchen
Lijnen coderen
Bestelling matchen
Verdelen over projecten
Goedkeuren
Betaalbestand maken
Boekhouder doorsturen
## Business rules
Duplicaatcontrole gebruikt leverancier, factuurnummer, bedrag, datum en documenthash.
OCR is een voorstel. De gebruiker valideert kernvelden.
Three-way matching vergelijkt bestelling, ontvangst en factuur met toleranties.
Projectkost kan per lijn worden verdeeld over meerdere projecten.
Confidentiële facturen zijn uitgesloten van gewone rollen, zoekresultaten en exports.
Betaling is niet mogelijk vóór vereiste goedkeuring.
Bankrekeningwijziging op factuur ten opzichte van leverancier vereist waarschuwing.
Creditnota wordt gekoppeld aan oorspronkelijke factuur of open positie.
## Automatiseringen
Auto-codering
Goedkeuringsroute op bedrag
Melding bij mismatch
Betaalvoorstel
Boekhoudsync
Projectleidertaak
## Edge cases
Factuur vóór bestelling
Meerdere bestellingen
Vooruitbetaling
Factuur met retentie
Buitenlandse btw
Dubbel document via e-mail en Peppol
Self-billing
## Acceptatiecriteria
Duplicaten worden vóór boeking gesignaleerd.
Elke lijn heeft een controleerbare project- en boekhoudtoewijzing.
Matching toont hoeveelheid, prijs en btw-afwijkingen.
Betaling blokkeert bij ontbrekende goedkeuring.
Confidentiële facturen blijven volledig afgeschermd.
## Latere differentiatie
AI-codering
Fraudedetectie
Supplier statement reconciliation
Dynamic discounting
Continuous controls monitoring
## Development contract
Canonical API namespace: /v1/piv.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 32. Vorderingsstaten, prijsherziening en verlet
Modulecode
PRG
Doel
Projecten periodiek factureren op basis van cumulatieve voortgang, hoeveelheden, percentages en contractuele correcties.
## Gebruikers en rollen
Projectleider
Quantity surveyor
Finance
Klant of architect
Directie
## Schermen en werkruimtes
Vorderingsoverzicht
Vorderingsfiche
Bronselectie
Lijnvoortgang
Vorige en cumulatieve stand
Prijsherziening
Verletstaat
Goedkeuring
Factuur
## Kerngegevens
Vorderingsnummer
Project
Periode
Actieve offertes en verrekeningen
Lijnhoeveelheid
Vorige, huidige en cumulatieve hoeveelheid of percentage
Bedrag
Retentie
Voorschotverrekening
Prijsherzieningsformule
Verletdagen
Bijlagen
Goedkeuringsstatus
Factuurrelatie
## Statusmodel
Concept, intern gecontroleerd, verzonden, in bespreking, goedgekeurd, gedeeltelijk goedgekeurd, afgewezen, gefactureerd, afgesloten
## Gebruikersacties
Vordering maken
Bronnen kiezen
Voortgang registreren
Meetstaat importeren
Prijsherziening berekenen
Verlet toevoegen
Document sturen
Goedkeuring registreren
Factuur maken
Volgende vordering starten
## Business rules
Cumulatieve vordering mag contracthoeveelheid niet overschrijden zonder goedgekeurde wijziging.
Huidige vordering = cumulatief nieuw min cumulatief vorige.
Vorige goedgekeurde stand wordt bevroren.
Meerdere actieve offertes kunnen worden gecombineerd mits dezelfde projectcontext.
Prijsherziening is apart zichtbaar en formuleerbaar.
Retentie en voorschotten worden afzonderlijk berekend.
Factuur neemt alleen goedgekeurde huidige periode over.
## Automatiseringen
Herinnering periodieke vordering
Melding bij overschrijding
Factuurvoorstel na goedkeuring
Taak bij betwiste lijn
## Edge cases
Klant keurt slechts deel goed
Negatieve correctie
Nieuwe verrekening midden periode
Retentie vrijgave
Meerdere btw-tarieven
Project wisselt van opdrachtgever
## Acceptatiecriteria
Vorige, huidige en cumulatieve waarden zijn per lijn controleerbaar.
Een volgende vordering start vanaf de laatst goedgekeurde stand.
Factuur en vorderingsdocument reconciliëren.
Prijsherziening en retentie zijn transparant.
Betwiste lijnen kunnen worden doorgeschoven zonder historiek te verliezen.
## Latere differentiatie
Architectenportaal
Meetstaatcertificering
Contract clauses engine
Claims en penalties
Earned progress
## Development contract
Canonical API namespace: /v1/prg.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 33. Materieel, installaties en serienummers
Modulecode
AST
Doel
Volledige levenscyclus en traceerbaarheid van eigen assets en geïnstalleerde klantassets.
## Gebruikers en rollen
Magazijnier
Planner
Technieker
Servicecoördinator
Projectleider
Finance
## Schermen en werkruimtes
Materieeloverzicht
Materieelfiche
Installatieoverzicht
Installatiefiche
Serienummerhistoriek
Locatie en gebruiker
Planning
Onderhoud
Documenten
## Kerngegevens
Asset-ID
Type materieel of installatie
Artikel
Serienummer
Merk en model
Status
Eigenaar
Klant en locatie
Stocklocatie
In gebruik door
Project
Aankoopdatum en kost
Garantie
Meterstanden
Certificaten
Onderhoudsschema
Documenten
Historiek
## Statusmodel
In voorraad, gereserveerd, in gebruik, op werf, in onderhoud, defect, buiten dienst, verkocht, geïnstalleerd bij klant, gedemonteerd
## Gebruikersacties
Asset maken
Serienummer scannen
Toewijzen
Verplaatsen
Installeren
Demonteren
Meterstand registreren
Onderhoud plannen
Buiten dienst zetten
## Business rules
Serienummer is uniek binnen relevante scope.
Materieel en installatie zijn aparte domeinen, maar delen assethistoriek.
Locatie- en gebruikerswijzigingen zijn gebeurtenissen, geen overschrijving zonder historiek.
Planning controleert beschikbaarheid en onderhoudsblokkering.
Installatie bij klant kan uit voorraadontvangst of projectlevering ontstaan.
Garantie en onderhoudsdata zijn datumgebonden.
Meterstanden mogen niet dalen zonder correctieprocedure.
## Automatiseringen
Onderhoudswaarschuwing
Garantievervalmelding
Taak bij defect
Meterstandgestuurd onderhoud
Certificaatverval
## Edge cases
Serienummer dubbel aangeleverd
Asset wordt vervangen onder garantie
Installatie verhuist naar andere klantlocatie
Materieel wordt tijdelijk verhuurd
Onderdeel van samengestelde installatie
## Acceptatiecriteria
Elke locatie- en gebruikswijziging is historisch traceerbaar.
Een niet-beschikbaar asset kan niet zonder override worden gepland.
Servicehistoriek is vanuit installatie bereikbaar.
Serienummers kunnen op aankoop, voorraad, werkbon en klant worden gevolgd.
Garantiecontext is zichtbaar bij serviceopdracht.
## Latere differentiatie
IoT telemetry
Predictive maintenance
Digital twin
QR asset passport
Depreciation integration
## Development contract
Canonical API namespace: /v1/ast.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 34. Service, onderhoud en interventies
Modulecode
SRV
Doel
Periodieke en reactieve service organiseren met volledige installatiehistoriek, SLA en facturatiecontext.
## Gebruikers en rollen
Servicecoördinator
Planner
Technieker
Klant
Contractbeheerder
Finance
## Schermen en werkruimtes
Servicecockpit
Onderhoudsschema
Onderhoudsbeurt
Interventieorder
Planning
Mobiele uitvoering
Installatiehistoriek
SLA-dashboard
## Kerngegevens
Installatie
Onderhoudstype
Frequentie
Vaste of uitvoeringsafhankelijke cyclus
Volgende datum
Voorafgeneratie
Verwachte duur
Vaardigheden
Checklist
Benodigde onderdelen
Contract en dekking
SLA-prioriteit
Storing en oorzaak
Oplossing
Vervolgactie
## Statusmodel
Schema actief, gepauzeerd, beëindigd
Beurt gepland, toegewezen, onderweg, bezig, voltooid, vervolg nodig, geannuleerd, gemist
## Gebruikersacties
Schema maken
Beurt genereren
Plannen
Technieker toewijzen
Checklist uitvoeren
Onderdeel registreren
Rapport sturen
Vervolginterventie maken
Factureren
## Business rules
Volgende datum wordt berekend vanaf vaste kalenderbasis of werkelijke uitvoering volgens schema.
Een onderhoudsbeurt verwijst naar exacte installatie en contract.
Inbegrepen en factureerbare prestaties worden apart gemarkeerd.
Gemiste onderhoudsbeurt blijft zichtbaar en kan worden verplaatst.
Checklists kunnen verplicht zijn voor afronding.
Onderdelenverbruik voedt voorraad en installatiehistoriek.
Garantie, contract en SLA bepalen facturatieregel.
## Automatiseringen
Beurt vooraf genereren
Klantmelding
Escalatie SLA
Vervolgtaak
Volgende datum berekenen
Contractfacturatie
## Edge cases
Onderhoud te vroeg of te laat
Installatie buiten dienst
Contract eindigt
Technieker vindt extra defect
Klant niet aanwezig
Onderhoud gecombineerd voor meerdere installaties
## Acceptatiecriteria
Een onderhoudsschema genereert voorspelbaar de juiste toekomstige beurt.
Uitvoering actualiseert installatiehistoriek en volgende datum.
Contractdekking is zichtbaar vóór facturatie.
Verplichte checklist blokkeert afronding.
SLA-overschrijding wordt gemeten en geëscaleerd.
## Latere differentiatie
Omnichannel ticketing
Remote diagnostics
AI troubleshooting
Predictive service
Customer service portal
## Development contract
Canonical API namespace: /v1/srv.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 35. Abonnementen, contracten en terugkerende omzet
Modulecode
SUB
Doel
Terugkerende facturatie en serviceverplichtingen automatisch en controleerbaar uitvoeren.
## Gebruikers en rollen
Contractbeheerder
Finance
Servicecoördinator
Sales
Klant
## Schermen en werkruimtes
Abonnementsoverzicht
Contractfiche
Prijsregels
Planningregels
Generatiehistoriek
Indexatie
Pauze en opzegging
## Kerngegevens
Contractnummer
Klant
Installaties
Start en einde
Verlenging
Opzegtermijn
Frequentie
Volgende generatie
Type factuur of order
Template
Prijs
Indexatie
Pro rata
Inbegrepen uren en materiaal
Facturatie vooraf of achteraf
Status
## Statusmodel
Concept, actief, gepauzeerd, opgezegd, verlopen, beëindigd
## Gebruikersacties
Contract maken
Activeren
Pauzeren
Hervatten
Indexeren
Order of factuur genereren
Opzeggen
Verlengen
Contractdocument sturen
## Business rules
Elke geplande generatie heeft idempotency zodat geen dubbele factuur of order ontstaat.
Prijswijziging heeft ingangsdatum en wijzigt historische periodes niet.
Pro rata wordt expliciet berekend bij start, pauze of einde.
Opzegging bewaart laatste leverings- en facturatieverplichting.
Contract kan meerdere installaties en servicelevels bevatten.
Indexatie creëert een nieuwe prijsversie met bronindex en berekening.
Handmatige generatie toont waarom deze buiten schema gebeurt.
## Automatiseringen
Periodieke generatie
Indexatieherinnering
Opzegtermijnwaarschuwing
Melding mislukte generatie
Renewal opportunity
## Edge cases
Start midden periode
Gratis proefperiode
Prijswijziging midden jaar
Contract wordt overgedragen
Meerdere betaalfrequenties
Credit na voortijdige stop
## Acceptatiecriteria
Een periode kan nooit tweemaal worden gegenereerd.
Generatiehistoriek toont schema, bronversie en resultaat.
Pro rata en indexatie zijn reproduceerbaar.
Pauze en opzegging beïnvloeden toekomstige, niet historische documenten.
Serviceorders zijn gekoppeld aan contractdekking.
## Latere differentiatie
Usage-based billing
Tiered pricing
Contract renewal workflow
SLA credits
Revenue forecasting
## Development contract
Canonical API namespace: /v1/sub.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 36. Verhuur en beschikbaarheidsbeheer
Modulecode
RNT
Doel
Tijdgebonden beschikbaarheid, levering, retour, schade en facturatie van verhuurassets beheren.
Productbeslissing
Niet bouwen in eerste productgeneraties
Prioriteit en pack
P3 | Rental Pack
Monargo-aanbeveling
Alleen als aparte Events & Rental pack na bewezen vraag.
## Gebruikers en rollen
Verhuurplanner
Magazijnier
Klant
Chauffeur
Finance
## Schermen en werkruimtes
Beschikbaarheidskalender
Verhuurbon
Assetselectie
Uitgifte
Retourcontrole
Schade
Facturatie
## Kerngegevens
Verhuurnummer
Klant
Periode
Asset of verhuurartikel
Aantal
Tariefmodel
Minimumhuur
Borg
Transport
Reiniging
Uitgifteconditie
Retourconditie
Schade
Meterstanden
Facturatie
## Statusmodel
Optie, gereserveerd, klaargezet, uitgegeven, verlengd, gedeeltelijk retour, retour, schadecontrole, gefactureerd, afgesloten, geannuleerd
## Gebruikersacties
Beschikbaarheid zoeken
Reserveren
Contract sturen
Uitgifte bevestigen
Verlengen
Retour registreren
Schade registreren
Factureren
## Business rules
Beschikbaarheid wordt per individueel asset of capaciteit gecontroleerd.
Tariefberekening ondersteunt dag, week, weekend, minimum en overuren.
Verlenging controleert conflicten met volgende reservatie.
Uitgifte en retour bevatten conditie, foto's en handtekening.
Schade en ontbrekende onderdelen worden apart gefactureerd.
Borg is geen omzet en wordt afzonderlijk beheerd.
Assetstatus blokkeert planning bij defect of onderhoud.
## Automatiseringen
Herinnering retour
Waarschuwing conflict
Onderhoud na gebruik
Borgterugbetalingstaak
Factuur na retour
## Edge cases
Te late retour
Asset vervangen
Deelretour
Verlies
Grensoverschrijdende huur
Weersafhankelijke annulering
## Acceptatiecriteria
Dubbele reservatie van hetzelfde asset wordt voorkomen.
Tariefberekening is reproduceerbaar.
Uitgifte en retourconditie zijn bewijsbaar.
Verlenging geeft impact op volgende reservaties.
Schade en borg worden financieel apart verwerkt.
## Latere differentiatie
Online booking
Dynamic pricing
Telematics
Damage AI
Fleet utilization
## Development contract
Canonical API namespace: /v1/rnt.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 37. Verlof, afwezigheden en tijdregistratie
Modulecode
LVE
Doel
Beschikbaarheid correct voeden voor planning, zonder een volledig loonsecretariaat te worden.
## Gebruikers en rollen
Medewerker
Teamleider
HR
Planner
## Schermen en werkruimtes
Verlofkalender
Aanvraag
Goedkeuringsinbox
Saldo
Afwezigheidstypes
Tijdregistratieoverzicht
## Kerngegevens
Werknemer
Type
Start en einde
Uren of dagen
Saldojaar
Reden
Bijlage
Goedkeurders
Planningimpact
Tijdregistratie
Werkrooster
## Statusmodel
Concept, aangevraagd, goedgekeurd, afgewezen, ingetrokken, verwerkt
## Gebruikersacties
Aanvragen
Goedkeuren
Afwijzen
Intrekken
Saldo aanpassen
Afwezigheid op planning tonen
Tijd registreren
## Business rules
Uren worden berekend volgens werkrooster en feestdagen.
Saldo kan per type en jaar worden beheerd.
Goedkeuring kan teamgebaseerd zijn.
Goedgekeurde afwezigheid blokkeert planning of geeft waarschuwing.
Intrekking na start vereist HR-recht.
Medische details worden niet breder gedeeld dan nodig.
Tijdregistratie en factureerbare werkbonuren zijn aparte gegevensstromen.
## Automatiseringen
Melding aan leidinggevende
Planningupdate
Herinnering open aanvraag
Jaaroverdracht saldo
## Edge cases
Halve dag
Nachtshift
Grens over boekjaar
Negatief saldo
Collectief verlof
Ziekte tijdens verlof
## Acceptatiecriteria
Saldo en geplande afwezigheid zijn consistent.
Teamleider ziet alleen het eigen team.
Planner ziet beschikbaarheid zonder gevoelige reden.
Goedgekeurd verlof verhindert conflicterende planning volgens beleid.
Urenberekening respecteert rooster en feestdag.
## Latere differentiatie
Accrual rules
Loonexport
Shift premiums
Timesheet approval
Workforce analytics
## Development contract
Canonical API namespace: /v1/lve.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 38. Projectplanning, fasen en capaciteitsforecast
Modulecode
PPL
Doel
Middellange en lange termijn inzicht geven in projectfasen, capaciteit, omzet en uitvoeringsrisico.
## Gebruikers en rollen
Operations manager
Projectleider
Planner
Sales
Directie
## Schermen en werkruimtes
Portfolio timeline
Project Gantt
Offerteforecast
Capaciteitsheatmap
Fasenconfiguratie
Omzetforecast
## Kerngegevens
Project of offerte
Fase
Start en einde
Kleur
Waarschijnlijkheid
Capaciteitsvraag per rol
Materieelvraag
Omzetcurve
Kostencurve
Afhankelijkheden
Baseline en actuele data
## Statusmodel
Forecast, voorlopig, bevestigd, vertraagd, afgerond
## Gebruikersacties
Fase plannen
Verslepen
Baseline bewaren
Offerte toevoegen
Capaciteit toewijzen
Scenario maken
Forecast exporteren
## Business rules
Offertes worden gewogen met slaagkans en blijven visueel onderscheiden van projecten.
Fasen kunnen overlappen en afhankelijkheden hebben.
Wijziging van planning bewaart baselineverschil.
Capaciteit wordt uitgedrukt per rol, team of vaardigheid.
Dagplanning is detailuitvoering en mag projectplanning niet automatisch herschrijven zonder regel.
Financiële forecast gebruikt configureerbare spreiding per fase.
## Automatiseringen
Waarschuwing capaciteitstekort
Melding projectvertraging
Update omzetforecast
Taak bij ontbrekende fase
## Edge cases
Project zonder vaste start
Fase wacht op vergunning
Meerdere scenario's
Seizoenssluiting
Offerte wordt project
Project wordt gesplitst
## Acceptatiecriteria
Portfolio toont projecten en gewogen offertes afzonderlijk.
Baseline en actuele planning kunnen worden vergeleken.
Capaciteitstekorten zijn per periode en rol zichtbaar.
Conversie van offerte naar project behoudt forecasthistoriek.
Fasewijziging kan financiële forecast actualiseren.
## Latere differentiatie
Critical path
Resource leveling
Scenario optimizer
AI delay prediction
Portfolio prioritization
## Development contract
Canonical API namespace: /v1/ppl.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 39. Taken, formulieren, bestanden en communicatie
Modulecode
DOC
Doel
Samenwerking en bewijsstukken contextueel bij het juiste dossier houden.
## Gebruikers en rollen
Alle gebruikers
Technieker
Klant indirect
Functioneel beheerder
## Schermen en werkruimtes
Takenoverzicht
Taakfiche
Formulierdesigner
Formulierinvulling
Bestandsbrowser
Communicatietijdlijn
Documentpreview
## Kerngegevens
Taaktype
Titel
Omschrijving
Contextrecord
Verantwoordelijke
Deadline
Prioriteit
Status
Formuliertemplate
Secties en vragen
Antwoorden
Bestanden
Versies
Tags
E-mailmetadata
## Statusmodel
Taak: open, bezig, geblokkeerd, klaar, geannuleerd
Formulier: concept, ingevuld, ingediend, vergrendeld
## Gebruikersacties
Taak maken
Toewijzen
Formulier invullen
Bestand uploaden
Versie toevoegen
E-mail sturen
PDF genereren
Taak afsluiten
## Business rules
Taak heeft één primaire context en optionele relaties.
Verplichte formuliervragen blokkeren inzending.
Formulierantwoorden worden gestructureerd opgeslagen, niet uitsluitend als PDF.
Bestanden hebben versie, type, grootte, hash en rechten.
Een klantdocument wordt als verzonden snapshot bewaard.
Foto's uit mobiele formulieren blijven zowel gestructureerd als bestand beschikbaar.
E-mailtemplates gebruiken veilige vervangingscodes.
## Automatiseringen
Taak na status
Deadlineherinnering
Formulier aan planning koppelen
Document genereren
E-mail met bijlagen
## Edge cases
Bestand te groot
Onveilige extensie
Formulier wijzigt na gebruik
Taakverantwoordelijke vertrekt
Mobiele upload mislukt
Klant vraagt verwijdering
## Acceptatiecriteria
Formulierantwoorden zijn filterbaar en via API beschikbaar.
Verplichte vragen worden online en offline afgedwongen.
Bestandsversies en downloads zijn geaudit.
Taken verschijnen in persoonlijke en teamoverzichten volgens rechten.
Verzonden communicatie bewaart ontvangers, bijlagen en gebruikte template.
## Latere differentiatie
Document approval
OCR document classification
Collaborative comments
Digital signatures
Knowledge base
AI summaries
## Development contract
Canonical API namespace: /v1/doc.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 40. Dashboard, analyses en managementrapportering
Modulecode
BI
Doel
Operationele en financiële beslissingen ondersteunen met betrouwbare, verklaarbare cijfers.
## Gebruikers en rollen
Directie
Salesmanager
Operations
Finance
Projectleider
Teamleider
## Schermen en werkruimtes
Persoonlijk dashboard
Rolgericht dashboard
KPI-detail
Trend
Drill-down
Rapportbuilder
Data-export
## Kerngegevens
KPI-definitie
Databron
Filtercontext
Doelwaarde
Periode
Snapshot
Refreshstatus
Eigenaarschap
## Statusmodel
KPI: actief, experimenteel, ingetrokken
Dataset: actueel, vertraagd, fout
## Gebruikersacties
Widget toevoegen
Filter bewaren
Doel instellen
Drill-down
Rapport plannen
Exporteren
Delen
## Business rules
Elke KPI heeft formule, eigenaar, bronvelden en refreshfrequentie.
Drill-down respecteert recordrechten.
Historische trends gebruiken snapshots of reproduceerbare data.
Operationele dashboards mogen eventual consistency hebben, financiële rapporten vermelden afsluitmoment.
Filters en definities zijn deelbaar en versieerbaar.
Exports vermelden definities en datumcontext.
## Automatiseringen
Periodiek rapport
Alert op drempel
Datakwaliteitsmelding
Executive digest
## Edge cases
KPI-definitie wijzigt
Brondata is vertraagd
Project is heropend
Valutaomrekening
Gebruiker verliest recht
## Acceptatiecriteria
Een KPI is herleidbaar tot bronrecords en formule.
Dashboard en export gebruiken dezelfde filterlogica.
Rechten blijven behouden bij drill-down en gedeelde dashboards.
Historische cijfers veranderen niet ongemerkt door definitiewijziging.
Datavertraging wordt zichtbaar weergegeven.
## Latere differentiatie
Embedded analytics
Natural language BI
Predictive KPIs
Anomaly detection
Data warehouse
## Development contract
Canonical API namespace: /v1/bi.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 41. API, webhooks, import en integratieplatform
Modulecode
API
Doel
Een open ecosysteem bouwen zonder dat integraties de betrouwbaarheid of beveiliging van het kernplatform aantasten.
## Gebruikers en rollen
Integratieontwikkelaar
Tenantbeheerder
Marketplacebeheerder
Support
Data engineer
## Schermen en werkruimtes
API credentials
OAuth apps
Scopes
Webhookbeheer
Integratielog
Importwizard
Mapping
Foutenqueue
Marketplace
## Kerngegevens
Client-ID
Secret of sleutel
Scopes
Tenantinstallatie
Webhook endpoint
Eventtype
Signing secret
Delivery attempt
Importjob
Kolommapping
External ID
Sync cursor
Rate limit
## Statusmodel
App: concept, test, review, productie, geschorst
Webhook: actief, fout, gepauzeerd
Import: voorbereid, gevalideerd, bezig, gedeeltelijk, afgerond, teruggedraaid
## Gebruikersacties
API-user maken
OAuth app installeren
Webhook registreren
Secret roteren
Import uploaden
Mapping testen
Validatie uitvoeren
Committen
Fout opnieuw verwerken
## Business rules
Alle muterende endpoints ondersteunen idempotency.
OAuth tokens zijn scoped, roteerbaar en intrekbaar.
Webhooks zijn ondertekend en worden at-least-once geleverd.
Ontvanger moet events op event-ID dedupliceren.
API gebruikt cursorpaginering en consistente foutcodes.
Import valideert eerst en toont fouten vóór commit.
External IDs ondersteunen betrouwbare upsert.
Rollback van updates vereist versiehistoriek of expliciete compensatie, niet alleen verwijderen van nieuwe records.
Integraties mogen geen polling doen wanneer een passend event bestaat.
## Automatiseringen
Webhook retry
Tokenvervalmelding
Importresultaat mailen
Integratie health alert
Dead letter processing
## Edge cases
Webhook dubbel of buiten volgorde
Rate limit
Schemawijziging
Import met gedeeltelijke fouten
External ID conflict
Tenant wordt gekopieerd naar test
## Acceptatiecriteria
Een webhook is verifieerbaar met signing secret en event-ID.
Een herhaalde POST met dezelfde idempotency key creëert geen duplicaat.
Import toont een foutbestand per rij en veld.
Scopes worden op iedere endpoint afgedwongen.
Integratiebeheer toont laatste succes, laatste fout en achterstand.
## Latere differentiatie
GraphQL read API
SDK's
Connector framework
Event replay
Sandbox seed data
Marketplace billing
## Development contract
Canonical API namespace: /v1/api.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 42. Beveiliging, audit, privacy en continuïteit
Modulecode
SEC
Doel
Bedrijfs-, personeels- en financiële gegevens beschermen en tegelijk aantoonbare controle bieden.
## Gebruikers en rollen
Securitybeheerder
DPO
Auditor
Tenantbeheerder
Support
Alle gebruikers
## Schermen en werkruimtes
Securitycentrum
Auditzoekfunctie
Sessies
Dataretentie
Toestemmingen
Back-upstatus
Incidentlog
## Kerngegevens
Audit event
Actor
Tenant en onderneming
Actie
Record
Oude en nieuwe waarde
IP en device
Session-ID
Consent
Retention policy
Exportlog
Support access
## Statusmodel
Incident: open, onderzocht, beperkt, opgelost, gesloten
Data request: ontvangen, gevalideerd, uitgevoerd, geweigerd
## Gebruikersacties
MFA afdwingen
Sessie intrekken
Audit exporteren
Datarequest uitvoeren
Supporttoegang geven
Security event onderzoeken
## Business rules
MFA is verplicht voor beheerders en finance, configureerbaar voor anderen.
Gevoelige wijzigingen hebben append-only audit.
Data wordt versleuteld in transit en at rest.
Back-ups zijn tenantveilig en herstelbaar getest.
Exports en bulkdownloads zijn geaudit.
Soft delete en wettelijke bewaarplicht worden onderscheiden.
Supporttoegang is minimaal, tijdgebonden en zichtbaar.
Mobiele offline data wordt versleuteld en kan op afstand worden ingetrokken.
## Automatiseringen
Melding verdachte login
Waarschuwing bulkexport
Secret rotation
Retentiejob
Back-up restore test
## Edge cases
Medewerker vertrekt
Account compromise
Tenant vraagt volledige export
Juridische hold
Mobiel toestel verloren
Integratiesleutel gelekt
## Acceptatiecriteria
Alle financiële en rechtenwijzigingen zijn volledig auditbaar.
Een ingetrokken sessie of token kan niet verder gebruiken.
Tenantisolatie wordt geautomatiseerd getest.
Back-upherstel heeft aantoonbare RPO en RTO.
Privacyrequest verwijdert alleen data die juridisch mag worden verwijderd.
## Latere differentiatie
SIEM export
Conditional access
Customer managed keys
Data residency
SOC 2 controls
Penetration testing program
## Development contract
Canonical API namespace: /v1/sec.
Alle writes vereisen tenantcontext, actor, idempotency waar relevant en expected version.
Create, update, transition, archive en restore genereren audit en domain events.
Files, tasks, custom fields en activity timeline gebruiken gedeelde platformservices.
Permissions worden in API, export, search en Mona identiek afgedwongen.
Unit tests dekken business rules. Integration tests dekken persistence en event delivery. End-to-end tests dekken de primaire flow.

# 43. Construction Core development specification
Construction Core is geen labelset. Het is een verticale capability pack bovenop CRM, Catalog, Quotes, Projects, Planning, Field, Finance en Platform Core.
## 43.1 Doelgroep en grens
Aannemers, installateurs en gespecialiseerde bouwbedrijven met ongeveer 5 tot 50 medewerkers.
Eerste focus op renovatie, elektriciteit, HVAC, dak, schrijnwerk, beton, vloer, tuin- en omgevingswerken en afwerking.
De release ondersteunt dagelijkse operatie en projectmarge, niet onmiddellijk iedere zware bouwboekhouding of grote meetstaat.
## 43.2 Construction Core scope
Klanten, eindklanten, bouwheren, architecten, hoofdaannemers en onderaannemers.
Werven met adres, toegang, werfverantwoordelijke, geo, documenten en compliancecontext.
Offertes met hoofdstukken, eenvoudige kostenopbouw, materiaal, arbeid, materieel en onderaanneming.
Projectbudget uit accepted quote en approved changes.
Werfplanning met ploegen, onderaannemers, voertuigen en materieel.
Mobiele work orders met tijd, materiaal, foto, formulieren, handtekening en extra werk.
Meerwerk en minderwerk als afzonderlijke change order.
Checkin@Work, A1, Limosa, incident en certificaatopvolging.
Basisstock per magazijn, voertuig en werf.
Basisbestelling, ontvangst en projectverplichting.
Invoice, Peppol en projectmarge.
## 43.3 Projectpartijen
Type
Rol
Functionele koppeling
Bouwheer
Opdrachtgever of eigenaar
Commercial and legal contact
Eindklant
Uiteindelijke gebruiker
Location and communication
Architect
Ontwerp and approval
Documents and progress discussion
Hoofdaannemer
Contracting party
Planning, scope and billing
Onderaannemer
External execution
Purchase, compliance and time
Veiligheidscoordinator
Compliance
Documents and incidents
Leverancier
Material source
Purchase and delivery
## 43.4 Meerwerk and minderwerk
Oorspronkelijke accepted quote blijft onveranderd.
Change order verwijst naar project, basis scope, reden en initiator.
Status: draft, internal review, sent, accepted, rejected, withdrawn, executed, invoiced.
Werk vóór acceptatie vereist emergency or at-risk flag en bevoegdheid.
Accepted change wijzigt contractbudget. Forecast kan eerder worden aangepast maar blijft apart.
Negative change mag eerder invoiced amount niet stilzwijgend onder nul brengen. Gebruik credit flow.
Work order kan extra work proposal genereren met bewijs en customer confirmation.
## 43.5 Bouwcompliance
Compliance dashboard toont missing, pending, valid, expiring, expired en rejected items.
Checkin@Work submit is asynchroon. Failure breekt clocking niet, maar creëert Work Inbox exception en retry.
Posted worker mag alleen gepland worden wanneer required A1 or Limosa policy voldoet, tenzij authorized override.
Incident registration bewaart timeline, evidence, actions en statutory deadlines.
Subcontractor qualifications and insurance certificates have validity and project applicability.
Compliance data heeft aparte field permissions and retention.
## 43.6 Construction acceptance flow
Maak customer, contacts en worksite.
Maak quote met labor and material cost, sections and option.
Send and digitally accept exact quote version.
Convert to project and generate budget.
Create change order for extra work.
Plan team and vehicle on worksite.
Clock in, send Checkin@Work and execute work order offline.
Register material and photo evidence, submit and approve.
Post actual time and material to project.
Invoice original or change scope and send through Peppol.
Validate project budget, actual, commitment, to invoice and forecast.
## 43.7 Construction Advanced, later
Post library with parameters and formulas.
Large bill of quantities import and reconciliation.
Supplier price requests and bid comparison.
Full purchase orders, call-offs, subcontract orders and three-way matching.
Progress claims, price revision, retention and weather delay statements.
Wholesaler catalog and ordering integrations.
Advanced earned value and cashflow.

# 44. Service and Assets development specification
Generic Asset model replaces vehicle-only thinking.
Asset types include vehicle, machine, tool, customer installation and component.
Installation keeps customer, location, serial, warranty, documents, service history and contract.
Maintenance plan creates recurring job based on calendar, usage or meter.
Service contract determines included, billable, warranty and SLA work.
Technician receives history, checklist, manuals and parts in mobile context.
Completion updates service history, material, meter, next due and invoice proposal.
Facility, HVAC, security installation, green maintenance and inspection use the same model with sector templates.
## 44.1 Service states
Asset
in_stock, assigned, installed, active, maintenance, defective, retired, sold
Maintenance plan
draft, active, paused, ended
Service job
new, triaged, planned, dispatched, in_progress, waiting_parts, completed, follow_up, canceled
SLA
within_target, warning, breached, paused_by_customer
## 44.2 Service acceptance flow
Register installation with serial and warranty.
Activate maintenance plan and customer contract.
Generate next service job idempotently.
Plan skilled technician and required asset or parts.
Execute checklist and register parts, photos and meter.
Approve work order and update installation history.
Determine contract-covered and billable work.
Generate report, invoice proposal and next maintenance date.

# 45. End-to-end workflow contracts
## Lead to cash
Customer or inquiry
Quote version
Acceptance
Project or job
Planning
Work order
Invoice proposal
Numbered invoice
Peppol or email
Payment allocation
## Project to margin
Accepted quote and changes
Budget
Approved time and material
Expenses and purchase actuals
Commitments
Invoiced and to invoice
Forecast
Margin signal
## Purchase to project cost
Need
Supplier or price request
Purchase order
Approval
Receipt
Purchase invoice integration
Actual cost
Project reconciliation
## Service contract
Contract version
Recurring rule
Generated maintenance job
Planning
Work order
Service history
Contract or extra billing
Next due
## Mobile offline
Download assigned context
Local commands
Queue with client IDs
Sync
Deduplication
Version conflict handling
Server approval
Read model refresh
# 46. Domeinevents en webhooks
{  "event_id": "evt_ULID",  "event_type": "customer.created",  "tenant_id": "tenant_ULID",  "company_id": "company_ULID or null",  "aggregate_type": "resource",  "aggregate_id": "resource_ULID",  "occurred_at": "ISO-8601",  "correlation_id": "corr_ULID",  "version": 1,  "data": {    "changed_fields": [      "example"    ]  }}
{  "event_id": "evt_ULID",  "event_type": "customer.updated",  "tenant_id": "tenant_ULID",  "company_id": "company_ULID or null",  "aggregate_type": "resource",  "aggregate_id": "resource_ULID",  "occurred_at": "ISO-8601",  "correlation_id": "corr_ULID",  "version": 1,  "data": {    "changed_fields": [      "example"    ]  }}
{  "event_id": "evt_ULID",  "event_type": "location.created",  "tenant_id": "tenant_ULID",  "company_id": "company_ULID or null",  "aggregate_type": "resource",  "aggregate_id": "resource_ULID",  "occurred_at": "ISO-8601",  "correlation_id": "corr_ULID",  "version": 1,  "data": {    "changed_fields": [      "example"    ]  }}
{  "event_id": "evt_ULID",  "event_type": "quote.version_sent",  "tenant_id": "tenant_ULID",  "company_id": "company_ULID or null",  "aggregate_type": "resource",  "aggregate_id": "resource_ULID",  "occurred_at": "ISO-8601",  "correlation_id": "corr_ULID",  "version": 1,  "data": {    "changed_fields": [      "example"    ]  }}
{  "event_id": "evt_ULID",  "event_type": "quote.accepted",  "tenant_id": "tenant_ULID",  "company_id": "company_ULID or null",  "aggregate_type": "resource",  "aggregate_id": "resource_ULID",  "occurred_at": "ISO-8601",  "correlation_id": "corr_ULID",  "version": 1,  "data": {    "changed_fields": [      "example"    ]  }}
Dezelfde envelope geldt voor alle events. In productie wordt het schema per eventtype versieerbaar vastgelegd.
Webhook delivery is at least once. Consumers dedupliceren op event_id.
Delivery gebruikt signature, attempts, exponential backoff en dead-letter state.
Events bevatten geen secrets en zo weinig mogelijk persoonsgegevens.
Event replay is beschikbaar voor enterprise integrations binnen retention policy.
# 47. Integratiearchitectuur
De bestaande integration registry, encrypted credentials, field mapping en sync logs worden behouden als concept. Live connectors krijgen een provider adapter, OAuth lifecycle, async jobs, cursors en health monitoring.
Connector
Prioriteit
Scope
Contract
Peppol
P0
Outbound invoice and status
Provider adapter, UBL validation, retries
Accounting
P0/P1
Customers, invoices, credits, payments, expenses
Start with Exact and one Belgian accountant-friendly connector
Robaws import
P1
Switcher migration
Import first, optional temporary sync
Payments
P1
Payment links and matching
Stripe for online; bank data via partner
KBO/VAT
P0
Onboarding and validation
Cached provider with manual override
Email
P0
Invitations, quote, documents, reminders
Verified domain and delivery status
Wholesalers
P3
Catalog and ordering
Only Construction Advanced
Maps
P1
Address, route context and geo validation
Provider abstraction
## 47.1 Robaws migration
Import customers, contacts, suppliers, employees, articles and locations with external_id mapping.
Import active quotes, projects, jobs, work orders and open invoices where source API permits.
Historical finalized documents enter as immutable external snapshots, not editable Monargo invoices.
Run validation report for duplicates, missing relations, tax identity, open quantities and file failures.
Offer parallel-run comparison for planning, work orders, invoicing and project totals.
Do not promise switch for Construction Heavy before required calculation, purchasing and progress claim capabilities exist.
# 48. Mona functional and technical contract
Mona Assist
Search, summarize, explain, check and propose next actions. Included baseline.
Mona Actions
Execute approved commands through existing domain APIs. Add-on or usage based.
Mona Estimate
Generate quote draft from catalog, history and inquiry. Never sends automatically.
Mona Signals
Detect invoice leakage, planning conflict, margin risk, overdue compliance and anomalies.
Mona Governance
Policy, source citations, confidence, preview, confirmation and audit.
## 48.1 Rules
Mona uses the user identity and cannot bypass policy.
Tools call domain commands, not direct database writes.
Every action returns a preview and requires confirmation unless a narrow automation policy explicitly permits it.
Financial and contractual actions always require policy checks and generally human confirmation.
Prompt and retrieved data follow tenant, company, project and field scopes.
Mona output labels facts, inference and suggestion.
Actions log model, tool, actor, input references, output, confirmation and final domain result.
Customer data is not used to train cross-customer models without explicit lawful agreement.
# 49. UX and navigation contract
Navigatie
Inhoud
Home
Role dashboard and exceptions
Work Inbox
Tasks, inquiries, approvals and signals
CRM
Customers, contacts, locations and opportunities
Sales
Quotes and contracts
Projects
Projects, jobs, changes, budget and forecast
Planning
Calendar, resources, capacity and map
Work
Work orders, time, forms and expenses
Construction
Werven, compliance, subcontractors and construction-specific tools
Service & Assets
Assets, installations and maintenance
Inventory & Purchase
Articles, stock, suppliers, orders and receipts
Finance
Invoice proposals, invoices, credits, payments and exports
Insights
KPIs and reports
Settings
Organization, users, packs, templates, automation and integrations
Navigation is role and entitlement aware. Empty or irrelevant modules are not shown.
One compact page hierarchy. Avoid nested sidebars for every object.
Detail pages use summary, activity timeline, tasks and related records consistently.
Actions use predictable placement and distinguish draft, send, approve, post and reverse.
Mobile uses Today, Inbox, Time and More as primary navigation.
# 50. Niet-functionele requirements
## Security
MFA for privileged roles
Tenant isolation tests in CI
Secrets in managed secret store
Encryption at rest and in transit
Audit for exports, policy, finance and support
OWASP controls and rate limits
## Reliability
Transactional financial and stock mutations
Outbox and retry for async integration
Idempotency for commands
Backup restore tests
Defined RPO and RTO
No silent data loss in mobile sync
## Performance
Server-side filtering
Cursor pagination
Async export/import
Search index for global search
Read models for dashboards
P95 targets per endpoint class
## Availability
Graceful provider degradation
Status and health endpoints
Circuit breaker for providers
Maintenance and incident communication
Feature flags for risky releases
## Localization
NL, FR and EN UI
Localized documents
Belgian tax and structured communication
Timezone-aware planning
Currency abstraction although EUR first
## Accessibility
Keyboard navigation
Semantic headings and labels
Contrast and focus
No color-only status
Accessible generated customer portals
## Privacy
Retention policies
GDPR export and deletion workflow
Data minimization
Support consent
Sensitive field policies
Processor register and DPA operations
## 50.1 Initial service targets
Metric
Target for pilot
Target for commercial production
API availability
99.5%
99.9%
Interactive read P95
< 800 ms
< 500 ms
Interactive write P95
< 1500 ms
< 900 ms
Mobile queue success
> 99% without manual retry
> 99.8%
Webhook first attempt
< 60 sec
< 30 sec
Critical data RPO
24 h pilot backup plus export
<= 1 h target
Critical RTO
Best effort pilot
<= 4 h target
# 51. Teststrategie
Testlaag
Inhoud
Unit
Pure business rules, calculations, transitions, tax, price and validation.
Repository
Constraints, tenant and company scope, concurrency, migrations.
Domain integration
Commands, outbox, events, file snapshots and cross-domain contracts.
API contract
Schema, error codes, idempotency, authorization and pagination.
End-to-end
Golden paths for Construction, Service, Sales, Field and Finance.
Mobile offline
Queue, duplicate, conflict, reconnect, partial failure and large files.
Security
Tenant isolation, privilege escalation, export leakage, support grant and secret handling.
Financial reconciliation
Invoice PDF versus UBL, credit, payment, source quantities, rounding and tax.
Migration
Legacy data conversion, validation, repeatability and rollback.
Performance
Large tenants, planning density, search, reports and exports.
## 51.1 Verplichte end-to-end scenarios
Construction quote to project to planning to work order to invoice and margin.
Change order with partial acceptance and separate invoice source.
Offline work order with photo, material and signature, including duplicate queue item.
Service contract generates maintenance job, updates asset history and billing.
Purchase order partial receipt and project commitment, without double actual cost.
Invoice numbering, PDF and UBL reconciliation, Peppol failure and retry.
Tenant A user attempts every supported access path to Tenant B data.
Role without cost policy attempts UI, API, export, search and Mona access.
Legacy customer, project and work order migration with external ID and files.
# 52. Delivery roadmap and epics
Release
Naam
Prioriteit
Resultaat
R0
Architecture foundation
P0
Company, normalized identity and CRM tables, policy service, outbox, file storage, API conventions, compatibility repositories.
R1
Complete horizontal flow
P0
Customer, quote versions, project, job, planning, work order, time, invoice, Peppol, credit and basic project actuals.
R2
Construction Core
P0/P1
Worksites, project parties, change orders, construction forms, compliance, material usage and basic stock.
R3
Service & Assets
P1
Assets, installations, maintenance plans, service contracts and history.
R4
Project finance and contracts
P1
Budget, actual, commitments, forecast, customer contracts and recurring rules.
R5
Procurement and inventory
P2
Suppliers, purchase orders, receipts, reservations and deeper stock.
R6
Switcher and ecosystem
P1/P2
Robaws importer, accounting connectors, integration health, customer and supplier portal.
R7
Construction Advanced
P3
Advanced calculation, price requests, wholesaler integrations, progress claims and price revision.
## 52.1 Dependency rules
No project finance before canonical project, time, material and invoice sources.
No procurement without article, supplier, project and receipt models.
No progress claims before immutable quote versions, changes, project scope and invoice source allocation.
No Mona actions before domain commands, policies and audit are stable.
No Robaws Heavy targeting before Construction Advanced readiness is demonstrable.
# 53. Initial development backlog
Epic
Titel
Prioriteit
Domein
Resultaat
E01
Canonical Company and tenant context
P0
PLT
Add companies, company context, number sequences and migration.
E02
Policy engine
P0
IAM
Role, scope, field and company policies.
E03
Normalized CRM
P0
CRM
Customer, contacts, addresses and locations.
E04
Project aggregate
P0
PRJ
Project, parties, phases, tasks and relations.
E05
Quote versioning
P0
QTE
Immutable revisions, acceptance and conversion.
E06
Unified planning
P0
PLN
Merge appointments and shifts into jobs and planning items.
E07
Mobile work order v2
P0
JOB
Offline, multi-worker, forms, material, conflicts and review.
E08
Invoice v2
P0
FIN
Immutable numbering, sources, credit and Peppol reconciliation.
E09
Work Inbox
P1
GRID
Unified tasks, exceptions, approvals and inquiries.
E10
Configuration platform
P0
CFG
Custom fields, statuses and sector packs.
E11
Automation engine
P1
AUT
Versioned flows, approvals, runs and retries.
E12
Construction Core
P0/P1
CST
Worksites, parties, changes, compliance and templates.
E13
Catalog and material
P1
CAT
Article, units, costs, prices and usage.
E14
Project financials
P1
PFI
Budget, actual, commitments and forecast.
E15
Contracts and recurring
P1
CTR
Customer contracts and recurring generation.
E16
Assets and maintenance
P1
SRV
Asset lifecycle and maintenance.
E17
Inventory foundation
P2
STK
Locations, movements, reservations and counts.
E18
Procurement foundation
P2
PUR
Supplier, purchase order and receipt.
E19
Integration runtime
P1
API
Provider adapters, OAuth, jobs and health.
E20
Robaws importer
P1
API
Import, validation, external mapping and parallel run.
E21
Mona governance
P1
MONA
Context policy, preview, confirmation and action audit.
E22
Insights read models
P1
BI
Role dashboards, project margin and exception signals.
# 54. Definition of Done
Functional purpose and out-of-scope are documented.
Entities and relationships are migrated or created with constraints.
State machine and transition permissions are implemented.
UI includes empty, loading, error, conflict and archived states.
API contract is documented and versioned.
Audit and domain events are emitted.
Search, filters and export respect policies.
Custom fields, files, tasks and activity timeline are integrated where relevant.
Idempotency and concurrency are tested.
Unit, integration and end-to-end tests pass.
Tenant isolation and privilege tests pass.
Accessibility and localization review pass.
Observability has logs, metrics, error codes and runbook.
Migration and rollback are documented.
Product owner and domain expert accept the scenario.
# 55. Source register
Repository README
Product status
Module catalog
Sector profiles
Bundles
Entitlements
Registry and generic CRUD
Core database schema
RLS migration
Authentication
Planning rules
Work order rules
Mobile sync
Templates
Billing
Peppol
Integrations
Robaws module overview
Robaws support
# 56. Final development directive
Development should not continue by adding isolated menu modules. The next milestone is a normalized, policy-safe, project-driven core that closes the complete customer flow. Construction Core is developed alongside the horizontal foundation, while Construction Advanced remains gated by product validation and architectural readiness.
This document and the companion requirement catalog form the baseline for architecture decisions, epics, acceptance, release gates and supplier handover.