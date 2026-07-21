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
