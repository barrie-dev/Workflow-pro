MONARGO ONE
Development Handover
Vendor Independence and Azure Readiness
Opdracht aan development
Maak Monargo aantoonbaar cloud- en provideronafhankelijk. Azure wordt de eerste professionele productie-implementatie, maar nooit een afhankelijkheid van de domein- of applicatielaag.


Documenttype: technische handover en uitvoeringsblauwdruk
Repository: barrie-dev/Workflow-pro
Versie: 1.0
Datum: 17 juli 2026
Status: klaar voor refinement en uitvoering

# Documentbeheer
Veld
Waarde
Documenteigenaar
Product Owner / directie Monargo One
Technisch eigenaar
Lead developer / software architect
Security review
vCISO / security owner
Privacy review
Privacy coordinator en externe DPO
Infrastructuurreview
Azure cloud engineer / DevOps engineer
Repository
barrie-dev/Workflow-pro
Doel
Vendor-onafhankelijke architectuur realiseren en Azure-productie voorbereiden
Niet in scope
Nieuwe productfunctionaliteit die geen afhankelijkheid heeft met deze refactor
Besluitvorming
Architectural Decision Records in repository, goedkeuring door technisch eigenaar en product owner

## Leeswijzer
Dit document is een uitvoeringsdocument, geen vrijblijvende architectuurvisie. “MUST” betekent verplicht voor de Azure-productiecutover. “SHOULD” betekent sterk aanbevolen en alleen afwijkbaar via een gemotiveerde ADR. “MAY” betekent optioneel of faseerbaar.
## Definition of success
☐ Dezelfde applicatiecontainer draait lokaal, op Azure en op minstens één alternatieve containerhost zonder codewijziging.
☐ Domein- en applicatielogica importeren geen Azure-, Supabase-, Render-, AWS- of Google Cloud-SDK.
☐ De operationele data wordt niet langer als volledige snapshot in geheugen geladen en volledig teruggeschreven.
☐ PostgreSQL is de portable databasebasis, met echte transacties, repositories, tenantisolatie en schema-migraties.
☐ Alle providerinterfaces hebben contracttests en minstens twee implementaties, waarvan één lokale/testimplementatie.
☐ Back-ups kunnen zonder Azure-account worden hersteld op standaard PostgreSQL en S3-compatibele opslag.
☐ Azure-infrastructuur is volledig reproduceerbaar via Infrastructure as Code.
☐ Productiecutover kan teruggerold worden zonder dataverlies buiten het afgesproken RPO.

# 1. Executive handover
Architectuurbesluit
Monargo wordt niet “voor Azure” gebouwd. Monargo wordt gebouwd als een portable SaaS-product, waarna Azure de eerste enterprise-grade infrastructuuradapter en deploymenttarget wordt.

## 1.1 Waarom deze refactor nodig is
De huidige code bevat al meerdere goede portability-elementen, waaronder een standaard Node.js HTTP-server, een OCI-geschikte Dockerfile, een providerkeuze voor e-mail en veel pure business rules. Tegelijk bevat de productiestack nog directe Supabase- en Renderkoppelingen en gebruikt de store een volledige in-memory dataset met volledige saves. Dat model is ongeschikt voor horizontale autoscaling, meerdere replicas en een volwassen multi-tenant SaaS.
## 1.2 Kernresultaat
Na uitvoering bestaat Monargo uit een provider-onafhankelijke productkern en vervangbare infrastructuuradapters. Azure Container Apps, Azure PostgreSQL, Blob Storage, Key Vault en Azure Monitor worden concrete adapters, niet de contracten waarop het product zelf gebouwd is.
## 1.3 Niet-onderhandelbare ontwerpregels
ID
Regel
Developmentinterpretatie
P-01
Domeinlogica is cloudblind
Geen vendor-SDK of cloudresourcebegrip in domain en application.
P-02
PostgreSQL is de portable relationele basis
Geen afhankelijkheid van PostgREST, Supabase RPC of Azure-specifieke SQL in de kern.
P-03
Stateless API
Geen permanente lokale bestanden, geen process-local sessiestatus, geen volledige data-cache als bron van waarheid.
P-04
Ports and adapters
Alle externe capabilities worden benaderd via interne interfaces.
P-05
Tenant isolation by design
Tenantcontext, repositoryfilter, RLS en tests vormen afzonderlijke verdedigingslagen.
P-06
Open standaarden eerst
OCI, PostgreSQL, S3-compatibele semantics waar zinvol, OIDC, SAML, OpenTelemetry, JSON, HTTPS.
P-07
Infrastructure as Code
Geen handmatig opgebouwde productieomgeving zonder reproduceerbare code.
P-08
Reversible migration
Iedere migratiefase heeft rollback, reconciliatie en validatie.
P-09
Secure by default
Private endpoints, managed identities, least privilege, secret rotation, auditability.
P-10
FinOps by design
Budgetalerts, logfiltering, lifecycle policies en schaalgrenzen worden mee opgeleverd.


# 2. Huidige repositorybeoordeling
## 2.1 Sterke portable fundamenten
Onderdeel
Huidige implementatie
Beslissing
Container
Dockerfile op Node 20 Alpine, non-root user, healthcheck, dumb-init
Behouden en uitbreiden met readiness, graceful shutdown en SBOM.
Runtime
Node.js HTTP-server zonder frameworklock-in
Behouden. Luister op generieke PORT en vermijd platformspecifieke serverless handlers.
Business rules
Planning-, clocking-, workorder- en facturatieregels grotendeels pure modules
Behouden en onderbrengen in domain/application zonder adapterimports.
E-mail
SMTP, Resend, SendGrid en logprovider via één mailer
Formaliseren als EmailProvider-port met adaptercontracttests.
Configuratie
APP_ENV en guardrails voor staging/productie
Behouden, maar providernaamgeving generiek maken.
Authenticatie
Eigen sessie, MFA, SAML en permissionlogica
Ontkoppelen via Identity/Federation interfaces, niet volledig vervangen.

## 2.2 Vastgestelde vendor- en schaalafhankelijkheden
ID
Bestand / patroon
Probleem
Verplichte actie
Prioriteit
F-01
src/lib/data-adapters.js
Productieadapter heet SupabasePostgresAdapter en vereist SUPABASE_URL + service role key.
Vervang door standaard PostgreSQL repositorylaag. Behoud alleen een legacy importadapter.
P0
F-02
src/lib/supabase-rest-bridge.js
Rechtstreekse PostgREST-calls met service role en volledige load/save.
Uitfaseren. Geen gebruik in normale runtime na migratie.
P0
F-03
src/lib/store.js
Volledige dataset wordt bij start geladen en bij iedere wijziging volledig opgeslagen.
Vervang door transactionele use cases en repositories.
P0
F-04
migrations/001 en tenant_records
Generieke JSONB-records missen sterke relationele constraints en querybaarheid.
Normaliseer kerndomeinen in aparte tabellen.
P0
F-05
src/lib/config.js
Productie blokkeert zonder Supabasevariabelen en gebruikt RENDER_GIT_COMMIT.
Introduceer generieke DB-, storage-, secret- en releaseconfiguratie.
P0
F-06
render.yaml
Deploymentconfiguratie is Render-specifiek.
Behouden als tijdelijke target, maar Terraform/OpenTofu en containerdeployment toevoegen.
P1
F-07
src/lib/openai.js
OpenAI endpoint, model en payload zijn in één concrete client vastgelegd.
Introduceer AiProvider-port en afzonderlijke OpenAI/Azure OpenAI-adapters.
P1
F-08
Bestanden in records
Bestandsmetadata en payloadstrategie zijn niet via ObjectStorageProvider geabstraheerd.
Bouw objectstorage-port, signed URLs, scanstatus en versiebeheer.
P0
F-09
In-memory MAIL_LOG en overige procesbuffers
Proceslokale data verdwijnt bij restart en verschilt per replica.
Gebruik persistente audit/delivery events of externe providerstatus.
P1
F-10
Audit save per event
Auditmutatie triggert volledige save en retentie is procesgestuurd.
Append-only audit repository, aparte retentie en export.
P0

## 2.3 Beoordeling vendor-onafhankelijkheid
Domein
Score nu
Doelscore
Toelichting
Compute/container
4/5
5/5
Dockerbasis is goed; nog generieke shutdown, probes en deploymentmetadata.
Database
1/5
5/5
Adapternaam bestaat, maar implementatie en opslagmodel zijn Supabase- en snapshotgebonden.
Object storage
1/5
5/5
Nog geen formele portable opslaginterface.
Identity
3/5
4/5
Eigen auth is portable; federation en sessie moeten ports krijgen.
E-mail
4/5
5/5
Goede multi-providerbasis.
AI
2/5
5/5
Providercontract ontbreekt.
Secrets
2/5
5/5
Env werkt overal maar mist secretprovider, rotatie en managed identity.
Observability
1/5
5/5
Nog geen OpenTelemetry en vendorneutrale export.
Queue/jobs
1/5
5/5
Geen durable queue/outbox als structureel platformfundament.
CI/CD
3/5
5/5
GitHub is portable; deploymenttarget en OIDC moeten generiek worden.
Back-up/restore
2/5
5/5
Provideronafhankelijke herstelproef ontbreekt.


# 3. Doelarchitectuur
## 3.1 Laagmodel
interfaces / delivery  HTTP routes, web UI, CLI, webhooks          |application  use cases, authorization orchestration, transactions, DTO mapping          |domain  entities, value objects, invariants, policies, domain events          |ports  repositories, storage, identity, email, AI, jobs, telemetry, secrets          |infrastructure  postgres, azure, local, openai, smtp, otel, legacy migration adapters
## 3.2 Toegestane dependencyrichting
Van
Mag afhankelijk zijn van
Mag niet afhankelijk zijn van
domain
Eigen value objects, domain services, standaardtaal
HTTP, databaseclients, Azure SDK, Supabase, filesystem, process.env
application
domain, ports, DTO’s
Concrete adapters, Azure-resources, PostgREST
interfaces
application, auth middleware, request mapping
SQL en provider-SDK’s
infrastructure
ports, externe SDK’s, PostgreSQL
UI en domeinbeslissingen
bootstrap
Alle lagen voor dependency injection
Business rules implementeren

## 3.3 Voorgestelde repositorystructuur
src/  domain/    shared/    tenants/ customers/ projects/ quotes/ planning/ workorders/ invoicing/  application/    commands/ queries/ services/ authorization/ dto/  ports/    repositories/ storage/ identity/ email/ ai/ jobs/ telemetry/ secrets/ clock/  infrastructure/    postgres/    local/    azure/    providers/    legacy/  interfaces/    http/ webhooks/ cli/  bootstrap/    container.js configuration.js server.jsinfra/  modules/ environments/ policies/ dashboards/migrations/  sql/ verification/ rollback/test/  unit/ integration/ contract/ security/ migration/ e2e/
## 3.4 Vendor-boundary enforcement
☐ ESLint/import rule: packages uit @azure/* zijn alleen toegestaan onder src/infrastructure/azure.
☐ Supabaseverwijzingen zijn alleen toegestaan onder src/infrastructure/legacy en migratiescripts.
☐ process.env wordt alleen gelezen in bootstrap/configuration, niet in domain of application.
☐ SQL staat uitsluitend in PostgreSQL-adapters en migraties.
☐ Alle provideradapters worden via dependency injection geregistreerd.
☐ CI faalt wanneer een verboden import of cloudvariabele buiten de toegestane map voorkomt.
☐ Architecture tests worden onderdeel van de verplichte PR-checks.

# 4. Verplichte ports en adaptercontracten
Onderstaande interfaces zijn richtinggevend. Development mag types verfijnen, maar de verantwoordelijkheidsgrenzen en provider-onafhankelijkheid mogen niet worden afgezwakt.
## 4.1 Database en transacties
interface TransactionManager {  run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;}interface ProjectRepository {  findById(ctx, tenantId, projectId): Promise<Project | null>;  search(ctx, tenantId, criteria): Promise<Page<Project>>;  insert(ctx, project): Promise<void>;  update(ctx, project, expectedVersion): Promise<void>;}
• Iedere methode vereist tenantId of een tenantgebonden context.
• Geen repositorymethode mag tenantloos operationele data lezen.
• Updates gebruiken optimistic locking.
• Meerdere writes binnen één use case verlopen in één transactie.
• SQL-adapter ondersteunt standaard PostgreSQL zonder platformextensies die migratie blokkeren.
## 4.2 Object storage
interface ObjectStorageProvider {  put(input: PutObject): Promise<StoredObject>;  get(key: ObjectKey): Promise<Readable>;  delete(key: ObjectKey): Promise<void>;  createUploadUrl(input: SignedUploadRequest): Promise<SignedUrl>;  createDownloadUrl(input: SignedDownloadRequest): Promise<SignedUrl>;  metadata(key: ObjectKey): Promise<ObjectMetadata>;}
• Objectkeys bevatten tenantcontext en worden server-side opgebouwd.
• Geen publieke containers/buckets.
• Uploadvalidatie, grootte, MIME, checksum en malwarestatus worden apart vastgelegd.
• Adaptercontract wordt getest tegen LocalStorage en AzureBlobStorage.
• S3-compatibele adapter blijft mogelijk zonder domeinwijziging.
## 4.3 Secrets
interface SecretProvider {  get(name: SecretName): Promise<SecretValue>;  getVersion(name: SecretName): Promise<SecretVersion>;  invalidate(name?: SecretName): void;}
• Geen secretwaarden in logs, auditdetail of foutmeldingen.
• EnvironmentSecretProvider is beschikbaar voor lokaal en CI.
• AzureKeyVaultProvider gebruikt managed identity.
• Secretrotatie vereist geen image rebuild.
## 4.4 Identity en federation
interface IdentityProvider {  authenticate(credentials): Promise<AuthenticationResult>;  verifySession(token): Promise<Principal>;  revokeSession(sessionId): Promise<void>;}interface FederationProvider {  begin(request): Promise<Redirect>;  complete(callback): Promise<FederatedIdentity>;}
• Interne auth blijft bruikbaar voor kmo-klanten.
• Entra OIDC en generieke OIDC/SAML worden adapters.
• Productrollen en tenantpermissions blijven Monargo-verantwoordelijkheid.
• Cloud-IAM mag nooit rechtstreeks productautorisatie vervangen.
## 4.5 AI
interface AiProvider {  complete(request: AiCompletionRequest): Promise<AiCompletion>;  runTools(request: AiToolRequest): Promise<AiToolResult>;  health(): Promise<ProviderHealth>;}
• Mona gebruikt een intern message- en toolmodel.
• OpenAI- of Azure OpenAI-payloadmapping zit in de adapter.
• Modelnamen staan in configuratie, niet in business rules.
• Consent, logging, confidence en action approval zijn provideronafhankelijk.
## 4.6 Jobs en events
interface JobQueueProvider {  publish(job: JobEnvelope): Promise<void>;  reserve(worker: WorkerId, limit: number): Promise<Job[]>;  acknowledge(jobId: JobId): Promise<void>;  retry(jobId: JobId, reason: string): Promise<void>;  deadLetter(jobId: JobId, reason: string): Promise<void>;}
• Start met PostgresJobQueue voor portability.
• Azure Service Bus is een latere adapter, geen P0-verplichting.
• Iedere job heeft tenantId, type, payloadVersion, correlationId en idempotencyKey.
• Transactional outbox voorkomt events zonder bijhorende databasecommit.

## 4.7 Telemetry
interface TelemetryProvider {  log(event: StructuredLog): void;  security(event: SecurityEvent): void;  metric(name: string, value: number, attributes?: Attributes): void;  span<T>(name: string, work: () => Promise<T>, attributes?: Attributes): Promise<T>;}
• OpenTelemetry is de primaire implementatiestandaard.
• Azure Monitor is een exporter, geen applicatiecontract.
• PII en secrets worden voor export gefilterd.
• CorrelationId, requestId, tenantId en actorId volgen iedere use case.
# 5. Data-architectuur en normalisatie
## 5.1 Doelmodel
De generieke tenant_records-opslag mag nog tijdelijk bestaan als legacybron, maar wordt niet verder uitgebreid. Nieuwe developmentepics schrijven uitsluitend naar genormaliseerde tabellen nadat de repositorylaag actief is.
Domein
Kernentiteiten
Eerste tabellen
Platform
Tenant, user, role, entitlement
tenants, users, roles, role_permissions, tenant_entitlements
CRM
Customer, contact, address, location
customers, contacts, addresses, locations
Project
Project, phase, participant, budget
projects, project_phases, project_participants, project_budgets
Sales
Quote, version, section, line, approval
quotes, quote_versions, quote_sections, quote_lines, quote_approvals
Planning
Planning entry, assignment, resource
planning_entries, planning_assignments, resources
Execution
Workorder, checklist, evidence, signature
workorders, workorder_checklist_items, workorder_evidence, signatures
Time and cost
Time entry, expense, material use
time_entries, expenses, material_usages
Inventory
Article, stock location, movement
articles, stock_locations, stock_movements
Procurement
Supplier, purchase order, receipt
suppliers, purchase_orders, purchase_order_lines, goods_receipts
Finance
Invoice, line, payment, Peppol event
invoices, invoice_lines, payments, e_invoice_events
Documents
Document, object, version, scan result
documents, document_versions, stored_objects, malware_scan_results
Platform operations
Audit, outbox, job, error
audit_events, outbox_events, jobs, dead_letters, error_events

## 5.2 Verplichte kolommen en constraints
tenant_id UUID NOT NULLid UUID PRIMARY KEYcreated_at TIMESTAMPTZ NOT NULL DEFAULT now()updated_at TIMESTAMPTZ NOT NULL DEFAULT now()created_by UUID NULLupdated_by UUID NULLversion INTEGER NOT NULL DEFAULT 1UNIQUE (tenant_id, business_number)FOREIGN KEY (..., tenant_id) REFERENCES ...CHECK (status IN (...))
## 5.3 Tenantisolatie
Laag
Controle
Test
Principal
JWT/session bevat tenantId en actorId
Manipulatie van tenantclaim wordt geweigerd.
Application
Use case maakt TenantContext en valideert actorrechten
Geen use case zonder TenantContext voor tenantdata.
Repository
Iedere query bevat tenant_id in predicate of RLS-context
Contracttest probeert ID van andere tenant.
Database
RLS-policy en tenant-aware foreign keys
Directe SQL met verkeerde tenant levert nul of policy violation.
Audit
Cross-tenant denial wordt als securityevent vastgelegd
SOC-test ziet event met correlationId zonder gevoelige payload.

## 5.4 Migratiestrategie legacy JSONB
1. Bevries de uitbreiding van tenant_records voor nieuwe domeinen.
2. Maak per domein het nieuwe schema en repositorycontract.
3. Bouw een idempotente backfill die legacy records naar genormaliseerde tabellen vertaalt.
4. Valideer aantallen, tenantverdeling, financiële totalen, hashes en referenties.
5. Activeer dual write alleen wanneer noodzakelijk en tijdelijk, met reconciliatierapport.
6. Activeer shadow read in staging en vergelijk oud versus nieuw resultaat.
7. Schakel één domein tegelijk over naar nieuwe repositories.
8. Maak legacydata read-only, archiveer en verwijder pas na afgesproken retentie en rollbackperiode.
## 5.5 Verboden migratiepatronen
• Big-bang migratie van alle domeinen zonder domeinmatige cutover.
• Dual write zonder idempotency, reconciliatie en einddatum.
• Productiequery’s die willekeurig tussen legacy en nieuw kiezen.
• Azure-specifieke databasefeatures zonder portable fallback of ADR.
• RLS vervangen door uitsluitend backendfilters.
• Financiële records migreren zonder totalen- en btwreconciliatie.

# 6. Azure-doelarchitectuur
## 6.1 Azure is een adapterset
Cloudflare edge  -> Azure Container Apps ingress      -> monargo-api      -> monargo-worker      -> monargo-scheduler / jobs          -> Azure Database for PostgreSQL Flexible Server          -> Azure Blob Storage          -> Azure Key Vault          -> Azure Monitor via OpenTelemetry          -> externe diensten: Stripe, Peppol, e-mail, AI, KBOGitHub Actions via OIDC  -> Azure Container Registry  -> migration job  -> new revision  -> canary / rollback
## 6.2 Azure-resourcemapping
Capability
Azure-keuze
Portable contract
Opmerking
API/web
Azure Container Apps
OCI container + HTTP
Minimaal één replica in productie.
Workers
Azure Container Apps
OCI worker + JobQueueProvider
Onafhankelijk schalen van API.
Scheduled jobs
Container Apps Jobs
CLI/job entrypoint
Cron is infrastructuurconfiguratie.
Database
Azure PostgreSQL Flexible Server
PostgreSQL 16/17 compatibel
Geen Azure SQL/Cosmos DB.
Files
Azure Blob Storage
ObjectStorageProvider
Geen publieke blob URLs als permanente referentie.
Secrets
Azure Key Vault
SecretProvider
Managed identity.
Telemetry
Azure Monitor/Application Insights
OpenTelemetry
OTLP blijft alternatieve exporter.
Container registry
Azure Container Registry
OCI registry
Image kan ook naar andere registry.
Identity infra
Microsoft Entra ID
OIDC/OAuth2
Productautorisatie blijft intern.
Edge
Cloudflare
HTTPS reverse proxy
Bewust buiten Azure voor portability en kost.
IaC
OpenTofu/Terraform
HCL modules
Geen portal-only resources.

## 6.3 Workloads
Workload
Verantwoordelijkheid
Scaling
State
monargo-api
HTTP, UI, auth orchestration, commands/queries
1-3 replicas initieel, HTTP concurrency
Volledig stateless
monargo-worker
Mail, Peppol, imports, exports, AI, sync, documentgeneratie
Queue depth / CPU
Durable jobs in DB/queue
monargo-scheduler
Periodieke triggers en housekeeping
Job per schema
Geen proceslokale planning
monargo-migration
Schema en gecontroleerde data-upgrades
Eenmalig per release
Advisory lock + migration table
monargo-backup
Portable dump en objectmanifest
Dagelijks/wekelijks
Schrijft versleuteld naar tweede locatie

## 6.4 Netwerk en private access
☐ Azure PostgreSQL, Blob Storage, Key Vault en ACR krijgen geen onbeperkte publieke toegang.
☐ Container Apps gebruikt VNet-integratie en private endpoints waar ondersteund en operationeel verantwoord.
☐ Uitgaand verkeer gebruikt een voorspelbaar pad en, wanneer allowlisting vereist is, een vaste egress via NAT Gateway.
☐ Cloudflare is de publieke edge. Origin-toegang wordt beperkt tot Cloudflare of een aanvullende origin-authenticatie.
☐ Beheerinterfaces worden achter Entra, MFA, least privilege en eventueel Cloudflare Access geplaatst.
☐ DNS-, TLS- en originwijzigingen worden als code of gecontroleerde configuratie beheerd.
## 6.5 Azure PostgreSQL-profiel
Voor staging mag een burstable profiel worden gebruikt. Productie met hoge beschikbaarheid vereist General Purpose of Memory Optimized; Azure ondersteunt HA niet op de Burstable tier. Back-upretentie wordt op 35 dagen gezet, met PITR en een aanvullende portable pg_dump buiten de primaire omgeving.
## 6.6 Blobprofiel
Container
Data
Bescherming
tenant-files
Klantdocumenten en bijlagen
Private, versioning, soft delete, lifecycle
workorder-evidence
Foto’s, checklists, handtekeningbewijs
Malware scan, checksum, signed URLs
generated-documents
Offertes, werkbonrapporten, facturen
Versioning, immutable bij definitieve status
temporary-uploads
Nog niet bevestigde uploads
Korte lifecycle, scan vóór promotie
audit-archive
Auditexports
WORM/immutability en langere retentie
database-backups
Portable pg_dump en manifests
Versleuteld, immutable, cross-provider kopie


# 7. Security requirements
## 7.1 Identity en toegang
Actor
Toegang
Controle
Developer
Nonprod via Entra-groep
MFA, least privilege, geen prod secrets
Lead developer
Beperkte prod deploymentrechten
PIM/JIT, goedkeuring, audit
Cloud engineer
Infrastructure changes
PR op IaC, PIM, change logging
Support
Product support access
Klantconsent, tijdsgebonden impersonation, audit
SOC
Read-only securitytelemetry en responsplaybooks
Geen businessdatatoegang zonder incidentnoodzaak
CI/CD
Federated workload identity
Geen client secret, beperkte scope per environment
Workload
Managed identity
Alleen specifieke Key Vault/Storage/ACR-rechten

## 7.2 Secretbeleid
☐ Productiesecrets staan niet in GitHub, Dockerimages, repositorybestanden of application database records in plaintext.
☐ GitHub Actions gebruikt OIDC workload federation en tijdelijke tokens.
☐ Secrets hebben eigenaar, doel, rotatiefrequentie, laatste rotatie en noodprocedure.
☐ De applicatie logt nooit secretwaarden of volledige headers.
☐ Key Vault soft delete en purge protection zijn verplicht.
☐ Break-glass accounts worden afzonderlijk beheerd, getest en bewaakt.
## 7.3 Uploadsecurity
1. Client vraagt een korte signed upload URL aan.
2. Server valideert tenant, domein, maximale grootte en toegestaan MIME-type.
3. Upload komt in temporary-uploads met status pending_scan.
4. Checksum en werkelijk bestandstype worden bepaald.
5. Defender for Storage of een portable scanneradapter scant het object.
6. Alleen clean objecten worden naar definitieve storage gepromoveerd.
7. Malicious of failed_scan objecten worden geblokkeerd en securityevent wordt aangemaakt.
## 7.4 Applicatiesecurity
Controle
Implementatie
Acceptatie
Tenantisolatie
RLS + repository + principal
Cross-tenant suite groen voor iedere repository.
Autorisatie
Use-case policy en operationele permission
Geen route-only authorization.
Rate limiting
Edge en applicatie
Login, reset, API keys, uploads en AI apart.
Idempotency
Header/key op muterende integratie- en mobiele endpoints
Herhaling maakt geen dubbel record.
CSRF/CORS
Same-site strategie en allowlist
Geen wildcard in productie.
Security headers
CSP, HSTS, frame, referrer, permissions
Automatische security-header test.
Dependency security
Lockfile, SCA, container scan
Geen critical/high zonder risicoacceptatie.
Audit
Append-only events met actor, tenant, action, target, timestamp
Geen secrets of overbodige persoonsgegevens.


# 8. Observability, SOC en operations
## 8.1 OpenTelemetry-instrumentatie
Signaal
Minimale attributen
Voorbeelden
Trace
service, environment, version, correlationId, route, status
HTTP request, DB query, external API
Metric
service, environment, tenant tier zonder klantnaam
Latency, error rate, queue depth, DB pool
App log
timestamp, level, eventName, correlationId
Use-case failure, provider outage
Security event
eventType, severity, actorId, tenantId, source, outcome
Login failure, access denied, secret change
Audit event
actor, tenant, action, entityType, entityId, before/after summary
Invoice finalised, role changed
Business event
eventType, aggregate, version
QuoteAccepted, WorkorderCompleted

## 8.2 Verboden logging
• Wachtwoorden, tokens, API keys, cookies, authorization headers.
• Volledige factuur-, medische, identiteits- of personeelsdocumenten.
• Volledige request bodies als standaardproductielog.
• AI-prompts en outputs zonder classificatie, doelbinding en retentiebeleid.
• Klantnamen als metric labels met hoge cardinaliteit.
• Database connection strings of providerresponses met credentials.
## 8.3 SLO-startset
SLO
Pilot
Commerciële productie
Meetmethode
API availability
99,5%
99,9%
Synthetic check + request success
P95 API latency
< 1,5 s
< 800 ms
OpenTelemetry HTTP histogram
Critical job success
> 98%
> 99,5%
Queue result metrics
Peppol handoff
< 15 min
< 5 min
Event timestamps
Security alert triage
Werkuren
Volgens SOC SLA
Alert lifecycle
Backup success
Dagelijks
Dagelijks
Backup manifest + alert
Restore test
Kwartaal
Maandelijks/kwartaal volgens tier
Documented restore drill

## 8.4 Runbooks
☐ Database connection exhaustion
☐ Azure Container Apps revision failure en rollback
☐ Cross-tenant access suspicion
☐ Compromised GitHub or deployment identity
☐ Secret leakage en rotation
☐ Malicious upload
☐ Peppol outage
☐ Stripe webhook replay of failure
☐ AI-provider outage of unsafe action
☐ Database PITR en portable restore
☐ Region outage en DNS cutover
☐ Customer offboarding en data export/deletion

# 9. CI/CD en Infrastructure as Code
## 9.1 Verplichte pipeline
PR checks  1. formatting / lint / syntax  2. unit tests  3. architecture boundary tests  4. repository contract tests  5. tenant isolation tests  6. dependency and license scan  7. secret scan  8. SAST  9. build OCI image 10. container vulnerability scan 11. generate SBOM and provenancemain / release 12. push immutable image tag 13. deploy nonprod 14. migration dry-run and backup gate 15. smoke, integration and e2e 16. approval for production 17. execute migration job 18. deploy canary revision 19. evaluate health gates 20. promote or rollback
## 9.2 Image- en releasebeleid
☐ Images worden getagd met semver, volledige commit SHA en environment-neutral build metadata.
☐ Productie gebruikt immutable digest, niet alleen latest of branchnaam.
☐ Hetzelfde image dat staging doorloopt wordt naar productie gepromoveerd.
☐ Geen environment-specific secrets of config in de image.
☐ Release bevat schema compatibility range en rollbackinstructie.
☐ Databasewijzigingen volgen expand-migrate-contract en blijven minstens één release backward compatible waar haalbaar.
## 9.3 IaC-modules
Module
Resources
Output
landing-zone
subscriptions, resource groups, RBAC, policy assignments
subscription IDs, scopes
network
VNet, subnets, private DNS, NAT, private endpoints
subnet IDs, DNS zones
container-platform
Container Apps environment, apps, jobs, ACR
endpoints, identities
database
PostgreSQL, private DNS, parameters, locks, backup config
connection endpoint, identity refs
storage
Storage accounts, containers, lifecycle, versioning, immutability
container endpoints
security
Key Vault, Defender settings, diagnostic settings
vault URI, policies
observability
Log Analytics, Application Insights, alerts, dashboards
OTel endpoints, alert groups
edge-origin
origin auth, DNS records, health endpoints
origin hostname

## 9.4 Environmentstrategie
Omgeving
Doel
Data
Azure isolatie
local
Snelle development
Synthetisch
Docker Compose / lokale adapters
test
CI-integratie
Synthetisch
Ephemeral services of gedeelde testsubscription
staging
Productierepresentatieve validatie
Geanonimiseerd of synthetisch
Nonprod subscription, eigen DB en storage
production
Klantgebruik
Echte klantdata
Aparte prod subscription en policies
DR restore
Herstelproef
Backupkopie
Tijdelijke geïsoleerde omgeving


# 10. Uitvoeringsbacklog
Onderstaande epics vormen de minimale volgorde. Productfeatures mogen parallel lopen zolang zij de nieuwe architectuur gebruiken en geen extra legacykoppeling introduceren.
Epic
Naam
Resultaat
Prio
Indicatie
E0
Architecture guardrails
Leg directory boundaries, ADR-template, dependency injection, importregels en architecture tests vast.
P0
1 sprint
E1
PostgreSQL foundation
Databaseclient, pooling, TransactionManager, migration framework, repository base en health checks.
P0
2 sprints
E2
Tenant and identity repositories
Normaliseer tenants, users, roles, permissions en sessions met RLS.
P0
2 sprints
E3
CRM and project repositories
Customers, contacts, locations en projects naar relationeel model.
P0
2-3 sprints
E4
Operational flow repositories
Planning, workorders, clocks, expenses en audit naar transactionele repositories.
P0
3-4 sprints
E5
Sales and invoicing repositories
Quotes, lines, invoices, Peppol events en financial reconciliation.
P0
3 sprints
E6
Object storage port
Local en Azure Blob adapters, signed URLs, checksum, metadata en scanstatus.
P0
2 sprints
E7
Durable jobs and outbox
Transactional outbox, Postgres queue, worker en idempotent jobs.
P0
2-3 sprints
E8
Provider ports
Secrets, AI, email, identity federation en telemetry formeel als ports.
P1
2 sprints
E9
OpenTelemetry and SOC events
Traces, metrics, logs, audit/security taxonomy, exporters en dashboards.
P1
2 sprints
E10
Portable backup and restore
pg_dump, object manifest, encryption, cross-provider copy en restore drill.
P0
1-2 sprints
E11
Azure landing zone IaC
Subscriptions, RBAC, policy, VNet, Key Vault, logging en budgets.
P1
2 sprints
E12
Azure staging platform
ACR, Container Apps, jobs, PostgreSQL staging, Blob en OIDC pipeline.
P1
2 sprints
E13
Legacy migration tooling
Backfill, dual-write where required, shadow read, reconciliation en rollback.
P0
3 sprints
E14
Production hardening
Private endpoints, Defender, WAF origin restriction, alerts, runbooks en load tests.
P1
2-3 sprints
E15
Production cutover
Freeze, final sync, validation, DNS, smoke, hypercare en decommission.
P0
1 sprint + hypercare

## 10.1 Epic E0 acceptance criteria
☐ CI blokkeert @azure imports buiten src/infrastructure/azure.
☐ CI blokkeert supabase references buiten legacy/migration folders.
☐ Domain- en applicationtests draaien zonder cloudcredentials.
☐ Dependency injection maakt een local testcomposition en Azure composition mogelijk.
☐ Minstens ADR-001 Vendor independence en ADR-002 PostgreSQL strategy zijn gemerged.
## 10.2 Epic E1 acceptance criteria
☐ Connection pooling heeft begrensde poolgrootte en timeouts.
☐ TransactionManager rolt volledig terug bij failure.
☐ Migration job is idempotent en gebruikt een lock.
☐ Health endpoint onderscheidt liveness en readiness.
☐ Applicatie kan met standaard PostgreSQL in Docker Compose draaien.
☐ Geen volledige datasetload of volledige save in het nieuwe pad.
## 10.3 Epic E6 acceptance criteria
☐ Dezelfde contracttest draait tegen LocalStorage en Azure Blob.
☐ Uploads zijn tenantgescoped, private en voorzien van checksum.
☐ Signed upload- en downloadlinks verlopen correct.
☐ Malicious en failed_scan bestanden zijn niet downloadbaar.
☐ Objectmetadata bevat providerneutrale key, versie, grootte, MIME, hash en status.
## 10.4 Epic E13 acceptance criteria
☐ Backfill kan veilig opnieuw worden gestart.
☐ Per domein bestaat een reconciliatierapport met aantallen, bedragen en fouten.
☐ Cross-tenant of orphan records blokkeren cutover.
☐ Shadow-readverschillen zijn verklaard of opgelost.
☐ Rollback naar legacy readpad is geoefend vóór productie.

# 11. Eerste drie sprints
## Sprint 1: architectuurgrenzen en technische spike
Story
Taak
Acceptatie
S1-01
Maak ADR-001 Vendor Independence
Besluit bevat grenzen, uitzonderingsproces en reviewer.
S1-02
Introduceer src/domain, application, ports, infrastructure, bootstrap
Bestaande pure workorder rule wordt als eerste slice verplaatst zonder gedragwijziging.
S1-03
Dependency injection bootstrap
Local composition start volledige app met huidige adapter.
S1-04
Architecture import tests
Verboden providerimports laten test aantoonbaar falen.
S1-05
Generieke releasemetadata
APP_COMMIT_SHA vervangt primaire RENDER_GIT_COMMIT-koppeling.
S1-06
PostgreSQL client spike
Transactie, pool, timeout en cancellation bewezen tegen lokale PostgreSQL.
S1-07
Azure Container Apps smoke spike
Bestaand image draait in nonprod en geeft health response.

## Sprint 2: databasebasis
Story
Taak
Acceptatie
S2-01
Migration runner
Version table, lock, up/down of forward-only rollbackstrategie gedocumenteerd.
S2-02
TransactionManager
Unit en integration rollbacktests groen.
S2-03
TenantRepository
CRUD met tenantconstraints en optimistic locking.
S2-04
UserRepository
E-mailnormalisatie, tenant uniqueness en securityvelden.
S2-05
RLS context
Databasepolicy weigert cross-tenant SQL.
S2-06
Liveness/readiness
Readiness faalt bij DB-outage zonder proceskill.
S2-07
Connection budget
Poollimieten afgestemd op Container Apps max replicas en DB-capaciteit.

## Sprint 3: eerste vertical slice
Story
Taak
Acceptatie
S3-01
Customer schema en repository
Customers worden relationeel opgeslagen met tenantfilter.
S3-02
Customer command/query
HTTP routes gebruiken application use cases, niet Store direct.
S3-03
Legacy customer backfill
Herhaalbaar en reconciliatierapport beschikbaar.
S3-04
Shadow read
Oud en nieuw resultaat worden in staging vergeleken.
S3-05
Cross-tenant suite
Create/read/update/delete met vreemde IDs wordt geweigerd.
S3-06
Telemetry slice
Trace, DB-span, audit en security denial zichtbaar via OTLP.
S3-07
Performance baseline
P95 en querycount gedocumenteerd voor customer list/detail.


# 12. Teststrategie
Testlaag
Doel
Verplicht in PR
Unit
Domeinregels en value objects
Ja
Application
Use-case orchestration met fake ports
Ja
Repository integration
SQL, transacties, constraints en RLS
Ja
Adapter contract
Zelfde contract tegen local en provideradapter
Ja
Architecture
Dependencyrichtingen en verboden imports
Ja
Security
Tenantisolatie, authz, idempotency, upload abuse
Ja voor relevante changes
Migration
Backfill, rerun, reconciliation, malformed legacy data
Ja
E2E
Klant -> offerte -> project -> planning -> workorder -> factuur
Ja op main/staging
Resilience
Provider outage, timeout, retry, duplicate event
Staging/release
Restore
DB en objectstorage herstel
Periodiek
Load
API, DB pool, queue en file upload
Voor productiecutover

## 12.1 Verplichte vendor-portabilitytests
☐ Start dezelfde image met Local/Environment providers.
☐ Start dezelfde image op Azure met Azure adapters.
☐ Draai database integrationtests tegen standaard PostgreSQLcontainer.
☐ Draai storage contracttests tegen local filesystem en Azure Blob.
☐ Draai AI-contracttests tegen mock en OpenAI/Azure OpenAI adapter zonder domeinwijziging.
☐ Exporteer een productieachtige database en herstel naar niet-Azure PostgreSQL.
☐ Exporteer objectmanifest en herstel minimaal één tenant naar S3-compatibele testopslag.
## 12.2 Kritieke E2E-scenario’s
☐ Nieuwe tenant, adminactivatie, MFA en eerste configuratie.
☐ Klant en werf aanmaken, offerte opstellen en accepteren.
☐ Project creëren, planning maken en medewerker toewijzen.
☐ Mobiel offline starten, tijd registreren, foto uploaden en later synchroniseren.
☐ Werkbon afronden met checklist en handtekening.
☐ Meerwerk registreren, goedkeuren en factureren.
☐ Factuur genereren, Peppolvalideren en providerhandoff.
☐ Cross-tenant ID manipuleren en toegang geweigerd zien.
☐ Storage-upload met malware simuleren en blokkering valideren.
☐ Worker stoppen en opnieuw starten zonder jobverlies.
☐ Nieuwe release met database-expandmigratie en rollback van apprevision.
☐ PITR/portable restore en functionele smoke op herstelde omgeving.

# 13. Migratie en productiecutover
## 13.1 Fasen en gates
Fase
Activiteiten
Exit gate
0. Guardrails
Architecture tests, ports, DI, generieke config
Geen nieuwe vendor coupling.
1. Data foundation
Postgres repositories, RLS, transactions
Eerste vertical slice volledig nieuw pad.
2. Provider foundation
Storage, secrets, AI, jobs, telemetry ports
Contracttests groen.
3. Azure nonprod
Landing zone, Container Apps, DB, Blob, Key Vault, OTel
Staging functioneel en SOC-zichtbaar.
4. Domain migration
Domein-per-domein backfill en cutover
Reconciliatie groen, rollback geoefend.
5. Production rehearsal
Load, security, backup, restore, DR, cutoverrepetitie
Go-live committee akkoord.
6. Cutover
Freeze, final sync, DNS, smoke, monitoring
Geen sev-1/2, financiële controle groen.
7. Hypercare
Intensieve monitoring, dagelijks review, rollbackvenster
Stabiele SLO en incidenttrend.
8. Decommission
Legacy read-only beëindigen en secrets intrekken
Exitbewijs en dataretentie uitgevoerd.

## 13.2 Cutoverrunbook
1. Bevestig change freeze en stakeholders.
2. Maak portable database- en objectbackup en verifieer checksums.
3. Zet oude omgeving in gecontroleerde read-onlymodus.
4. Voer laatste incrementele migratie uit.
5. Draai reconciliatie: records, tenants, financial totals, documents en audit.
6. Voer schema-migratiejob uit op Azure.
7. Activeer nieuwe revision zonder volledig extern verkeer.
8. Draai smoke, tenantisolatie, auth, upload, worker, invoice en Peppoltests.
9. Wijzig Cloudflare origin/DNS en monitor error budget.
10. Houd rollbackcommand, oude origin en final backup beschikbaar.
11. Start hypercare en communiceer status.
12. Sluit rollbackvenster alleen na formele go/no-go review.
## 13.3 Rollbacktriggers
• Cross-tenant toegang of vermoeden daarvan.
• Financiële reconciliatieverschillen boven nul zonder verklaarde afronding.
• Onherstelbare auth- of MFA-fout voor meerdere tenants.
• Aanhoudende 5xx boven afgesproken foutbudget.
• Jobverlies, dubbele facturatie of dubbele Peppolhandoff.
• Databasecorruptie of migratie die niet binnen maintenance window herstelt.
• Onvoldoende observability om impact betrouwbaar te beoordelen.

# 14. Go/no-go checklist
Domein
Controle
Status
Architecture
Geen provider-SDK buiten adaptermap
☐
Architecture
Domain/application draaien zonder cloudconfig
☐
Compute
OCI-image draait lokaal en Azure
☐
Compute
API is stateless en graceful shutdown getest
☐
Database
Geen volledige snapshotload/save in actief productiepad
☐
Database
Alle kerntabellen hebben tenant_id, constraints en RLS
☐
Database
Transactionele workflows en optimistic locking actief
☐
Storage
ObjectStorageProvider en twee adapters contractgetest
☐
Storage
Versioning, soft delete, scan en lifecycle actief
☐
Secrets
Key Vault via managed identity, env fallback alleen nonprod
☐
Identity
OIDC/SAML adapters, productrollen intern
☐
AI
Mona gebruikt AiProvider, geen OpenAI payload in application
☐
Jobs
Durable queue, outbox, retry, DLQ en idempotency
☐
Telemetry
OpenTelemetry en SOC-securityevents zichtbaar
☐
CI/CD
GitHub OIDC, immutable image, SBOM en scans
☐
IaC
Prod kan from scratch worden opgebouwd
☐
Backup
PITR en portable dump succesvol hersteld
☐
DR
Objectdata naar tweede provider herstelbaar
☐
Security
Tenant isolation suite volledig groen
☐
Performance
Loadtest binnen SLO en DB connection budget
☐
Operations
Runbooks, alerts, on-call en owners toegewezen
☐
Privacy
Retentie, audit, DPA en DPO-review afgerond
☐
Cutover
Rehearsal en rollback bewezen
☐

## 14.1 Formele no-go’s
No-go
Geen Azure-productie wanneer tenantisolatie, financiële reconciliatie, portable restore, durable jobs of providergrenzen niet aantoonbaar werken. Een handmatige workaround of “we lossen het na go-live op” is voor deze controles niet aanvaardbaar.


# 15. Handover per functie
Functie
Accountable voor
Concrete deliverables
Handover naar
Product Owner
Scope, prioriteit, acceptatie en klantimpact
Besluiten, epicvolgorde, cutovervenster, klantcommunicatie
Lead developer, customer success
Software architect / lead dev
Architectuurgrenzen en technische kwaliteit
ADR’s, ports, target structure, reviews, go/no-go evidence
Developmentteam, cloud engineer
Backend developer
Repositories, use cases, migrations, jobs
Code, tests, migration scripts, reconciliatie
QA, lead dev
Frontend/mobile developer
API-contracten, uploads, offline sync, error handling
Client changes, idempotency, signed upload flow
QA, backend
DevOps/cloud engineer
Azure landing zone, IaC, CI/CD, networking
OpenTofu/Terraform, pipelines, runbooks, budget alerts
Operations, SOC
Database engineer
Schema, RLS, performance, backup, restore
DDL, migrations, indexes, PITR/restore bewijs
Backend, operations
Security owner/vCISO
Threat model, controls, incident readiness
Security requirements, risk acceptance, pentest scope
SOC, DPO, management
SOC/MDR
Monitoring en incidenttriage
Use cases, alert routes, SLA, evidence
Security owner, incident commander
Privacy coordinator/DPO
Privacy by design en verwerking
DPIA input, retention, subprocessors, incident criteria
Product owner, security
QA engineer
Functionele, security-, migration- en resiliencevalidatie
Testplan, reports, release evidence
Go-live committee
Customer success/support
Supportproces en klantimpact
Support runbook, tenant validation, communication templates
Product owner, operations
Finance/operations
Kosten, facturatie-impact en budget
FinOps baseline, alerts, monthly review
Management

## 15.1 Developmenthandoverpakket
☐ Dit handoverdocument.
☐ ADR-001 Vendor Independence.
☐ ADR-002 PostgreSQL and Tenant Isolation.
☐ ADR-003 Object Storage and Upload Security.
☐ ADR-004 Durable Jobs and Transactional Outbox.
☐ ADR-005 OpenTelemetry and Audit Taxonomy.
☐ C4 context, container en componentdiagrammen.
☐ ERD per gemigreerd domein.
☐ OpenAPI-contracten en versioningbeleid.
☐ Migration mapping legacy -> new schema.
☐ Infrastructure as Code repositorystructuur.
☐ Threat model en dataflowdiagram.
☐ Cutover-, rollback-, backup- en restorerunbooks.
☐ Go/no-go evidence pack.
## 15.2 PR-template toevoegingen
Architecture impact:- [ ] Geen nieuwe vendor coupling- [ ] Port/interface gewijzigd en contracttests bijgewerkt- [ ] Tenant isolation gecontroleerd- [ ] Database migration backward compatible- [ ] Telemetry/security events toegevoegd- [ ] Rollbackimpact beschreven- [ ] Cost/log-volume impact beoordeeld- [ ] Privacy/data retention impact beoordeeld

# 16. Risicoregister
Risico
Impact
Kans
Mitigatie
Owner
Refactor duurt langer dan productroadmap
Hoog
Hoog
Vertical slices, strangler pattern, geen big bang
Product + lead dev
Dual-write inconsistentie
Hoog
Middel
Kortdurend, idempotent, reconciliatie en end date
Backend lead
Cross-tenant lek
Kritiek
Laag/middel
Vier isolatielagen, securitytests, pentest
Security + backend
DB connection exhaustion door autoscaling
Hoog
Middel
Poolbudget, max replicas, PgBouncer indien nodig
DB/cloud engineer
Logkosten lopen op
Middel
Hoog
Sampling, filtering, retention tiers, budget alerts
Cloud/FinOps
Azure-specifieke shortcuts ontstaan
Hoog
Middel
Import rules, ADR en adaptercontracttests
Architect
Bestandsmigratie mist objecten
Hoog
Middel
Manifest, checksums, count reconciliation, replay
Backend/cloud
Jobs worden dubbel uitgevoerd
Hoog
Middel
Idempotency key, locks, exactly-once effect design
Backend
Authmigratie blokkeert gebruikers
Hoog
Laag/middel
Interne auth behouden, staged federation, recovery path
Identity owner
Back-up bestaat maar herstel faalt
Kritiek
Middel
Periodieke restore drill naar andere omgeving/provider
Operations
Onvoldoende Azurekennis
Middel
Middel
IaC review, externe Azure architect voor design gate
Management
Productfeatures omzeilen nieuwe laag
Hoog
Hoog
No new legacy rule en architecture CI
Lead dev

## 16.1 Open beslissingen
Beslissing
Uiterlijk nodig
Aanbevolen default
PostgreSQL versie
Voor E1
Nieuwste door Azure en lokaal breed ondersteunde major, vastgelegd per release.
Database migration tool
Sprint 1
Portable SQL-first tool met lock en CI dry-run.
Postgres queue versus Azure Service Bus
Voor E7
Start Postgres queue, voeg Service Bus alleen bij bewezen schaal/noodzaak toe.
Cloudflare originbeveiliging
Voor staging
Origin secret/mTLS of IP strategy, afhankelijk van Cloudflareplan.
Belgium Central versus West Europe DR
Voor landing zone
Primair Belgium Central, herstelstrategie naar West Europe en tweede provider.
OpenAI versus Azure OpenAI
Voor E8
Beide adapters, keuze per tenant/platformconfig en compliance.
AKS nodig?
Niet nu
Nee. Container Apps tot concrete technische grens bewezen is.
Supabase Auth behouden?
Voor identity roadmap
Niet als nieuwe kern. Legacy alleen via adapter/migratie.


# 17. Definition of Done
Een story of epic binnen dit programma is pas klaar wanneer alle relevante onderstaande punten voldaan zijn.
☐ Code volgt de laag- en importgrenzen.
☐ Unit-, integration-, contract-, architecture- en securitytests zijn groen.
☐ Tenantisolatie is expliciet getest.
☐ Databasewijziging bevat migration, rollback/forward plan en datareconciliatie.
☐ Nieuwe externe capability gebruikt een port en adapter.
☐ Geen secrets, PII of tokens in logs.
☐ Telemetry en operationele foutdiagnose zijn aanwezig.
☐ Idempotency en retrygedrag zijn beschreven voor mutaties en jobs.
☐ Performance- en connectionimpact zijn beoordeeld.
☐ IaC en environmentconfig zijn bijgewerkt.
☐ Runbook of supportdocumentatie is bijgewerkt wanneer operationeel relevant.
☐ ADR is toegevoegd of bijgewerkt wanneer een architectuurbesluit is genomen.
☐ Product owner en technisch eigenaar accepteren het resultaat.
☐ Geen nieuwe technical debt die Azure of een andere provider noodzakelijk maakt.
## 17.1 Program completion
Programma afgerond wanneer
De volledige actieve productflow gebruikt genormaliseerde PostgreSQL-repositories, portable providerinterfaces, durable jobs en OpenTelemetry; de OCI-image draait op Azure; de Azure-infrastructuur is reproduceerbaar; portable restore en rollback zijn bewezen; en alle go/no-go-controles zijn groen.


# 18. Bronnen en codebasis
## 18.1 Repositorybronnen
Pad
Relevantie
package.json
Node runtime, scripts en dependencies.
Dockerfile
Portable containerbasis, non-root en healthcheck.
render.yaml
Huidige Renderdeployment en environmentvariabelen.
src/lib/config.js
Omgevingsguardrails, Supabase- en Renderkoppelingen.
src/lib/data-adapters.js
JsonDataAdapter en SupabasePostgresAdapter.
src/lib/supabase-rest-bridge.js
PostgREST load/save en service-role gebruik.
src/lib/store.js
Volledige datasetload/save, in-memory collections en tenantfilters.
migrations/001_supabase_core.sql
tenants, tenant_records, global_records en audit/error schema.
migrations/002_supabase_rls.sql
Huidige service-role RLS-policies.
src/lib/mailer.js
Multi-provider e-mailbasis.
src/lib/openai.js
Huidige directe OpenAI-koppeling.
src/modules/mobile.js
Offline queue en idempotencyfundament.
src/modules/workorder-rules.js
Pure business rules als voorbeeld van gewenste domainlaag.
src/modules/entitlements.js
Module- en permissiongating.

## 18.2 Officiële Azurebronnen
Bron
URL
Azure Container Apps security
https://learn.microsoft.com/en-us/azure/container-apps/security
Azure Container Apps scaling
https://learn.microsoft.com/en-us/azure/container-apps/scale-app
Azure PostgreSQL backup and restore
https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore
Azure PostgreSQL high availability
https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-high-availability
Azure Blob data protection
https://learn.microsoft.com/en-us/azure/storage/blobs/data-protection-overview
Azure Blob soft delete
https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-blob-overview
Azure Blob immutable storage
https://learn.microsoft.com/en-us/azure/storage/blobs/immutable-storage-overview
Defender for Storage malware remediation
https://learn.microsoft.com/en-us/azure/defender-for-cloud/defender-for-storage-configure-malware-scan
Azure Monitor OpenTelemetry
https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable
GitHub Actions workload identity federation
https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation
Azure Landing Zones
https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/landing-zone/
Azure deployment stamps
https://learn.microsoft.com/en-us/azure/architecture/patterns/deployment-stamp

## 18.3 Interpretatienota
Azure-producteigenschappen en prijzen wijzigen. Development en cloud engineering moeten vóór provisioning de actuele regionale beschikbaarheid, quota, SKU’s, private-linkondersteuning, Defenderkosten en PostgreSQL-capabilities opnieuw controleren. De architectuurprincipes en portability-eisen in dit document blijven leidend, ook wanneer een Azure-productdetail wijzigt.

# 19. Handover acceptance
Ondertekening bevestigt niet dat alle development uitgevoerd is. Zij bevestigt dat scope, architectuurregels, eigenaarschap, prioriteiten en go/no-go-voorwaarden zijn begrepen en als uitvoeringsbasis worden aanvaard.
Rol
Naam
Datum
Akkoord / opmerkingen
Product Owner



Lead developer / architect



Cloud / DevOps engineer



Security owner / vCISO



QA owner



Privacy coordinator / DPO




Eerste actie na handover
Plan een technische refinement van Epic E0 en E1. Maak tijdens die sessie ADR-001, de directorygrenzen, het PostgreSQL-clientbesluit, het migration framework en de eerste customer vertical slice definitief.
