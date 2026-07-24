# Deploy-runbook · elk containerplatform

Dit runbook beschrijft hoe Monargo One op een NIEUWE omgeving komt te draaien,
zonder aannames over de aanbieder. Het productiepad is overal hetzelfde:

> **container-image + standaard PostgreSQL + s3-compatibele objectopslag + omgevingsvariabelen**

Wie dit runbook volgt op Render, Azure Container Apps, Cloud Run, Fly.io,
Kubernetes of een kale VPS met Docker, krijgt exact dezelfde applicatie. De
aanbieder zit uitsluitend in de configuratiewaarden, nooit in de code
(ADR-001/ADR-002; bewaakt door `test/architecture.test.js`).

Voor incidenten en dagelijkse operatie: zie [RUNBOOK.md](RUNBOOK.md).

## 1. De drie bouwstenen

| Bouwsteen | Eis | Voorbeelden (onderling inwisselbaar) |
|---|---|---|
| Runtime | container draait de `Dockerfile` (Node 22) | elk containerplatform of Docker-host |
| Database | standaard PostgreSQL 14+, geen extensies vereist | zelfgehost, elke beheerde Postgres |
| Objectopslag | s3-compatibel endpoint, Azure Blob, of een lokaal volume | MinIO (zelfgehost), elke s3-compatibele clouddienst, Azure Blob Storage |

De applicatie heeft nul npm-runtimedependencies buiten `pg` en `node-saml`;
er is geen build-stap en geen framework dat een platform afdwingt.

## 2. Omgevingsvariabelen (kernset)

| Variabele | Verplicht | Betekenis |
|---|---|---|
| `APP_ENV` | ja | `development` / `test` / `staging` / `production` (guardrails hangen hieraan) |
| `APP_URL` | ja | publieke basis-URL van deze omgeving |
| `STORAGE_ADAPTER` | ja (prod) | `postgres` in elke echte omgeving |
| `DATABASE_URL` | ja (prod) | standaard Postgres-connectiestring; TLS wordt autogedetecteerd, `DATABASE_SSL` overschrijft |
| `JWT_SECRET` | ja | tokenondertekening; per omgeving uniek |
| `OBJECT_STORAGE_ADAPTER` | ja | `s3` (aanbevolen prod) of `local` (volume) |
| `OBJECT_STORAGE_ENDPOINT` | bij s3 | endpoint-URL van de opslag |
| `OBJECT_STORAGE_BUCKET` | bij s3 | bucketnaam (vooraf aangemaakt, zie §5) |
| `OBJECT_STORAGE_ACCESS_KEY_ID` / `OBJECT_STORAGE_SECRET_ACCESS_KEY` | bij s3 | opslagsleutels met alleen-deze-bucket-rechten |
| `OBJECT_STORAGE_REGION` | optioneel | regionaam voor de handtekening (standaard `us-east-1`; MinIO negeert dit) |
| `APP_COMMIT_SHA` | aanbevolen | zichtbaar op `/api/health`; sommige platforms zetten dit automatisch |

Overige (mail, Stripe, Peppol, SAML, AI) staan in `.env.example` en zijn per
functie optioneel; `scripts/check-production-config.js` valideert het geheel.

## 3. Standaard-deploystappen (elk platform)

1. **Bouw het image**: `docker build -t monargo-one:<versie> .` (of laat het
   platform vanaf de repo bouwen; de `Dockerfile` is de enige bron).
2. **Zet de omgevingsvariabelen** uit §2 in de omgeving, nooit in het image.
3. **Migreer expliciet vóór de app start**:
   `node scripts/run-migrations.js` als aparte stap of als startcommando-prefix
   (`node scripts/run-migrations.js && node src/server.js`, zoals compose en
   `render.yaml` doen). De runner heeft een advisory lock: meerdere replicas
   die tegelijk opkomen zijn veilig.
4. **Start de container** en richt de probes:
   - liveness → `GET /api/health` (200 zolang het proces leeft);
   - readiness → `GET /api/ready` (503 bij databaseproblemen).
   Verkeer sturen op readiness, herstarten op liveness · niet omgekeerd.
5. **Verifieer**: `GET /api/health` toont `commitSha`, `storageAdapter:
   "postgres"`, `txAdapter: "postgres"` en `objectStorageAdapter`.
6. **Leg bewijs vast**: `node scripts/generate-evidence-bundle.js` en commit
   het dossier uit `docs/evidence/`.

### 3.1 Single-writer: stop-first/recreate is de officiele productiestrategie (CTO3-02)

Dit platform verdraagt bewust maar **een** schrijver: de instantie die de
PostgreSQL advisory lock op `platform_state` houdt. Die guard bestaat omdat
overlappende schrijvers eerder stil dataverlies veroorzaakten bij een deploy.

**Officiele deploystrategie: stop-first / recreate.** Stop de oude instantie
VOOR de nieuwe traffic-ready wordt. Dit is GEEN zero-downtime: reken op een korte
onbeschikbaarheid (ordegrootte een minuut) tijdens de wissel. Zolang
`platform_state` één schrijver vereist en de runtime geen aparte liveness- en
traffic-readinessprobes met leader-handover afdwingt, wordt zero-downtime NIET
geclaimd.

**Liveness vs readiness (twee verschillende signalen):**
- `GET /api/health` en `GET /api/live` = **liveness**: het proces leeft. Blijft
  200 tijdens het opstarten (met `status`: booting/migrating/waiting_lock/
  loading/flushing/ready/failed). Een 200 hier is NOOIT een readiness-claim.
- `GET /api/ready` = **readiness**: 200 pas nadat DB, migraties, writer-lock,
  state-load en de verplichte bootflush geslaagd zijn (`status: ready`). Een
  half-opgestarte of `failed` instantie is nooit ready. Alleen readiness bepaalt
  of businessverkeer wordt toegelaten.

**Render:** `healthCheckPath: /api/ready` (in `render.yaml`) · Render routeert
pas verkeer wanneer readiness 200 geeft. Voer de deploy stop-first uit:
**Suspend** de service, wacht tot ze echt gestopt is, en **Resume** (of schaal
naar 0 instanties en daarna terug naar 1). Zo is de writer-lock vrij wanneer de
nieuwe instantie start. Health/ready/live dragen `commitSha` en `deploymentId`,
zodat je kunt bevestigen welke deploy live staat (zie CTO3-06 evidence).

**Rollback:** deploy de vorige release-tag/SHA opnieuw, opnieuw stop-first. De
oude instantie mag pas herstarten wanneer de nieuwe gestopt is (nooit twee
schrijvers). Een schema-rollback is een nieuwe forward-migratie, nooit handwerk.

**Niet doen:** `SINGLE_WRITER=false` zetten om een deploy erdoor te krijgen heft
precies de bescherming op die het eerdere dataverlies moest voorkomen. En een
HTTP 200 op liveness is geen bewijs van readiness · claim "zero downtime" niet
zonder trafficprobe- en leader-handovertest (aparte latere ADR).

### 3.2 Niet-geheim config-contract + preflight (CTO3-05)

`deploy/production-contract.json` legt de gewenste productietoestand vast: welke
bron, adapter, securitymode en featureflag actief hoort te zijn. Het bevat NOOIT
secret-waarden · alleen key-namen en niet-geheime gewenste waarden. Elke kritieke
flag staat óók expliciet in `render.yaml`, dus niets blijft een ongedocumenteerde
dashboardinstelling.

De preflight `scripts/check-production-contract.js` heeft twee modi:

- **coverage** (`node scripts/check-production-contract.js`) · draait op elke PR
  in CI. Valideert dat het contract laadt en dat `render.yaml` elke verplichte
  flag/env-key declareert. Geen secrets nodig.
- **runtime** (`node scripts/check-production-contract.js --runtime`) · draai dit
  **vóór elke productie-deploy** (in de productieomgeving, met de echte env). Het
  vergelijkt de effectieve runtime met het contract en faalt fail-closed bij:
  drift (een flag wijkt af), een verboden bron (`OBJECT_STORAGE_ADAPTER=local`),
  een ontbrekende verplichte env-key, een ontbrekende `DATABASE_CA_CERT` bij
  `verify-full`, of `FORMS_SOURCE=pg` zonder groene Forms-reconcile.

De runtime toont deze niet-geheime samenvatting op `/api/ready` (`checks`):
`sources` per domein, `singleWriter`, `databaseSslMode`, `databaseCaCertPresent`,
`releaseChannel`, `migrationVersion` en `commitSha` · nooit secrets.

**Cutover-sequence per domein** (idempotent, fail-closed). Flip een bronflag
nooit zonder reconcilebewijs:

1. **inventory** · stel vast wat er te migreren valt.
2. **shadow/mirror** · zet `<DOMEIN>_READ_SOURCE=shadow`: legacy blijft leidend,
   pg leest mee; afwijkingen lopen naar telemetrie.
3. **reconcile** · bewijs dat legacy en pg sluitend zijn
   (`node scripts/check-cutover.js`); een afwijking blokkeert de cutover.
4. **cutover** · zet `<DOMEIN>_READ_SOURCE=pg`. Voor Forms geldt de extra
   poortwachter: `node scripts/forms-cutover.js reconcile` moet groen zijn (exit
   0) én de legacy-schrijfweg geeft daarna 410 vóór `FORMS_SOURCE=pg`.
5. **rollbackcheck** · een rollback is een flag-flip terug naar `shadow`/`legacy`;
   de data blijft (dual-write), en de preflight rapporteert de bron per domein.
6. **evidence** · bewaar de preflight- en reconcile-output commit-gebonden.

## 4. Rollback

- **Applicatie**: het vorige image-tag (of de vorige commit) opnieuw uitrollen;
  de app is stateless, sessies staan in de database.
- **Migraties**: migraties zijn additief geschreven; een oudere app-versie
  draait door op een nieuwer schema. Een schema-rollback is een nieuwe
  (herstel)migratie, nooit handwerk in productie.
- **Data**: herstel volgens het backupbeleid (zie RUNBOOK.md · backups); de
  outbox-tabel maakt event-replay mogelijk via `/api/admin/outbox`.

## 5. Objectopslag inrichten (eenmalig per omgeving)

1. Maak de bucket aan bij de gekozen aanbieder of op de eigen MinIO
   (`docker compose --profile storage up -d storage` voor dev/test).
2. Maak een sleutelpaar met rechten op ALLEEN die bucket.
3. Zet bij de aanbieder het bewaarbeleid: versiebeheer aan (herstel van
   overschreven objecten) en een lifecycle-regel die verwijderde versies na de
   afgesproken bewaartermijn opruimt. Dit beleid is aanbiedersconfiguratie;
   de applicatie zelf blijft er bewust blind voor.
4. `OBJECT_STORAGE_*`-variabelen zetten (§2) en herstarten; `/api/health`
   toont `objectStorageAdapter: "s3"`.
5. **Restore-bewijs**: upload een testbestand, verwijder het, herstel het uit
   de versiegeschiedenis van de aanbieder en download het via de app. Leg het
   resultaat vast in de evidence bundle van de omgeving.

Geen publieke bucket, nooit: alle toegang loopt via kortlevende ondertekende
URL's die de app uitgeeft (poortcontract, handover 4.2).

## 6. Aanbiedersnotities (mapping, geen afhankelijkheid)

**Huidig productieplatform (Render)** · `render.yaml` is de bronconfiguratie:
build vanaf de repo, startcommando met migratiestap, envs in het dashboard.

**Azure (gekozen productie-infrastructuur)** · concreet stappenplan; elke stap
is de generieke stap uit §3 met een Azure-dienst ingevuld:

1. **Registry + image**: maak een Azure Container Registry, push het image
   (`docker build` → `docker push`) of laat een GitHub Action dat doen.
2. **Database**: maak een *Azure Database for PostgreSQL - Flexible Server*
   (kleinste burstable tier volstaat om te starten; TLS staat standaard aan).
   Zet `DATABASE_URL` op de connectiestring; de app autodetecteert TLS.
3. **Objectopslag**: maak een *Storage Account* (LRS volstaat, geen publieke
   blob-toegang) + één container. Zet:
   `OBJECT_STORAGE_ADAPTER=azure-blob`,
   `OBJECT_STORAGE_ENDPOINT=https://<account>.blob.core.windows.net`,
   `OBJECT_STORAGE_BUCKET=<container>`,
   `OBJECT_STORAGE_ACCESS_KEY_ID=<accountnaam>`,
   `OBJECT_STORAGE_SECRET_ACCESS_KEY=<accountsleutel>`.
   Bewaarbeleid (§5 stap 3): zet *blob soft delete* en *versioning* aan op het
   account · dat is het herstelvangnet bij overschrijven of verwijderen.
4. **Container App**: maak een *Container App* met het image; minimaal 1
   replica; ingress op poort 4280. Zet alle envs uit §2 als secrets/app-vars.
   Startcommando laten staan (migratie zit in het image-startpad) of de
   migratie als init-stap draaien.
5. **Probes**: liveness → `/api/health`, readiness → `/api/ready` (§3 stap 4).
6. **Verifieer**: `/api/health` toont `storageAdapter: "postgres"`,
   `txAdapter: "postgres"` en `objectStorageAdapter: "azure-blob"`; draai
   daarna het restore-bewijs uit §5 stap 5 en `npm run evidence`.

Dev/test blijven lokaal: Azurite (de officiële emulator) draait via
`docker compose --profile storage-azure up -d storage-azure` en valideert
handtekeningen exact zoals de echte dienst · CI bewijst dat elke build.

De onafhankelijkheidsgarantie blijft van kracht: geen enkele Azure-dienst
hierboven is een harde afhankelijkheid. Terug naar (of parallel draaien op)
een s3-compatibele of zelfgehoste stack is dezelfde app met andere
configuratiewaarden.

**Kubernetes / VPS**: compose-bestand als referentie; db + storage als
services of extern; migratie als init-container respectievelijk pre-startstap.

De toets blijft altijd: **geen enkele stap hierboven vereist een specifieke
aanbieder**. Zodra een deploy-instructie dat wel doet, hoort hij in deze
sectie als mapping, en moet het generieke pad blijven werken.

---

## CTO2 · productiehardening: Supabase Storage, restore-drill en Forms-cutover

Deze sectie hoort bij de CTO Development Review v2 (2026-07-22). De code-guardrails
staan al in main: productie weigert te booten met `OBJECT_STORAGE_ADAPTER=local`
(bestanden overleven een deploy niet). Onderstaande stappen deblokkeren de
productie-deploy en leveren het herstelbewijs.

### 1. Managed object storage · Supabase Storage (S3-compatibel)

Supabase Storage spreekt het S3-protocol, dus onze bestaande s3-adapter werkt
zonder codewijziging. In het Supabase-project:

1. **Storage → Buckets**: maak een *private* bucket, bv. `monargo-prod-files`
   (nooit public · toegang loopt via ondertekende URL's).
2. **Project Settings → Storage → S3 connection**: noteer het **S3-endpoint**
   (`https://<project-ref>.storage.supabase.co/storage/v1/s3`) en de **regio**.
3. **Storage access keys**: genereer een S3 **Access key ID** + **Secret access key**.

Zet in de **Render**-service (Environment) exact deze variabelen:

```
OBJECT_STORAGE_ADAPTER=s3
OBJECT_STORAGE_ENDPOINT=https://<project-ref>.storage.supabase.co/storage/v1/s3
OBJECT_STORAGE_BUCKET=monargo-prod-files
OBJECT_STORAGE_REGION=<regio, bv. eu-central-1>
OBJECT_STORAGE_ACCESS_KEY_ID=<S3 access key id>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<S3 secret>
OBJECT_STORAGE_PATH_STYLE=true
```

`OBJECT_STORAGE_SIGNING_KEY` valt terug op `JWT_SECRET` · zet hem enkel apart als
je de download-URL-ondertekening van de app-secret wil scheiden.

TLS-databasevalidatie staat sinds CTO-13 op `verify-full`. Weigert Supabase de
certificaatketen, zet dan tijdelijk `DATABASE_SSL_MODE=require` of lever de CA via
`DATABASE_CA_CERT`.

### 2. Deploy + verificatie

Na het zetten van de vars deployt Render `main` (guardrail laat nu door). Toets:

- `/api/health` toont `objectStorageAdapter: "s3"` (niet meer `local`).
- Upload/download/delete een bestand via een echte formulierbijlage of
  `npm run production:restore-drill` (zie §3).

### 3. Restore-drill (CTO2-12) · met gemeten RPO/RTO

```bash
STORAGE_ADAPTER=postgres DATABASE_URL=<prod-url> \
OBJECT_STORAGE_ADAPTER=s3 OBJECT_STORAGE_ENDPOINT=... OBJECT_STORAGE_BUCKET=... \
OBJECT_STORAGE_ACCESS_KEY_ID=... OBJECT_STORAGE_SECRET_ACCESS_KEY=... \
npm run production:restore-drill
```

De drill (1) herstelt `platform_state` naar een verse **scratch-database** en
verifieert byte-gelijkheid + meet **RPO** (leeftijd snapshot) en **RTO**
(hersteltijd); (2) schrijft een sentinel-bestand en leest het terug via een
**vers adapter-exemplaar** (bewijst dat bestanden een procesherstart overleven).
Exit 1 = herstel niet bewezen (release-gate). Leg de RPO/RTO-uitslag vast bij het
release-bewijs.

### 4. Forms-cutover (CTO2-08) · optioneel, ná storage

De legacy work-os formulieren migreren naar de canonieke engine:

```bash
node scripts/forms-cutover.js inventory   # wat staat er nog in legacy?
node scripts/forms-cutover.js migrate     # idempotente migratie
node scripts/forms-cutover.js reconcile   # exit 1 zolang niet alles gemigreerd is
```

Pas **nadat reconcile groen is**, zet `FORMS_SOURCE=pg` in Render. Dat bevriest
het legacy schrijfpad (410) en maakt de canonieke engine de enige waarheid;
lezen van historiek blijft werken.

## CTO3-06 · Deployment evidence + P0 pilotgate

Voor elke kandidaat-release bestaat één automatisch gegenereerde, **SHA-specifieke**
evidencebundle (`docs/traceability/evidence/deploy-evidence.json` + `.md`) waaruit
de CTO de volledige releasebeslissing kan nemen. Geen handmatige "production
verified"-tekst · alles is machineleesbaar met timestamp.

De bundle bevat: commit-SHA, deployment-ID, buildtijd, migratieversie, liveness,
readiness, DB TLS-modus, CA-presentie, writer-lock, objectstorageadapter,
source_of_truth per domein, forms-bron, backupstatus en het **canary**-resultaat.

**De P0 pilotgate wordt automatisch berekend uit CTO3-01 t/m CTO3-06** en is
fail-closed: ontbrekend of stale sub-bewijs (e2e-manifest, restore-drill) houdt de
gate rood.

### In CI (elke PR)

De `test`-job draait, ná het e2e-manifest en de restore-drill:

```bash
node scripts/generate-deploy-evidence.js --self-check --require-pilot
```

`--self-check` start een verse server, voert een **veilige canary** uit
(create → **echte** stop+herstart → read) in een **gereserveerde** canarytenant,
bewijst objectopslag met put/get (geïsoleerd van klantbestanden) en gate't op de
exacte HEAD-SHA. De server + het databestand zijn efemeer · dat is meteen het
cleanupbewijs. `--require-pilot` faalt hard bij een rode pilotgate.

### Vóór een staging-/productie-release

Draai de bundle tegen de LIVE omgeving met de productie-contractverwachtingen:

```bash
CANARY_TENANT_ID=<gereserveerde tenant> CANARY_TOKEN=<canary-token> \
  node scripts/generate-deploy-evidence.js \
  --target https://<staging-of-prod-host> --candidate-sha <git-sha> --require-pilot
```

De gate eindigt **rood** wanneer de gerapporteerde commit-SHA niet exact de
kandidaat is, readiness 503 geeft, de adapter/TLS/CA afwijkt, de canarymutatie de
restart niet overleeft, of een sub-gate (CTO3-01..05) niet groen is. Gebruik NOOIT
een echte klanttenant voor de canary. Archiveer de bundle bij de release-tag,
buiten de efemere runtime, en laat de CTO het sign-off-veld in het Markdownrapport
aftekenen.
