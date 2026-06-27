# Portabiliteit & migratie

WorkFlow Pro is een **modulaire monolith in één container**. Doel van dit document:
de app draait identiek op om het even welke omgeving — geen vendor lock-in op het
platform-niveau. Migreren = dezelfde image bouwen + env-vars zetten.

## Waarom geen microservices
De app is bewust één deploybare unit (60 nette modules intern). Dat houdt migratie
en uitbating eenvoudig: één image, één healthcheck, één logstream. Microservices
zouden hier portabiliteit net verlagen (orchestratie, netwerk, gedistribueerde
data). Schaal je later organisatorisch op, dan kan je aan duidelijke naden
(bv. async taken, AI-worker) een service afsplitsen — de modulestructuur laat dat toe.

## Wat maakt het portabel
- **Eén container** (`Dockerfile`, node:20-alpine, non-root, `dumb-init`, HEALTHCHECK).
- **Alle config via env-vars** (`src/lib/config.js`); volledige lijst in `.env.example`.
- **Geabstraheerde datalaag** (`STORAGE_ADAPTER`): `json` (self-host, geen externe DB)
  of `postgres` (managed). Zie "Datastrategie".
- **Health/ready endpoints**: `GET /api/health` (liveness), `GET /api/ready`
  (readiness incl. store-status), `GET /api/status`.
- **Slechts 2 runtime-dependencies** → snelle, reproduceerbare builds.

## Lokaal / zelf-host (één commando)
```bash
cp .env.example .env        # vul minstens JWT_SECRET + ENCRYPTION_KEY in
docker compose up --build   # → http://localhost:4280   (JSON-adapter + volume)
```
Data leeft in het named volume `wfp-data` (`/app/data`). Back-up = volume kopiëren.

## Deployen op een andere omgeving
Dezelfde image draait overal; geef de env-vars uit `.env.example` mee.

| Omgeving | Hoe |
|---|---|
| **Render** | Blueprint via `render.yaml` (al aanwezig), of Docker-runtime |
| **Fly.io** | `fly launch` (detecteert Dockerfile) + `fly secrets set ...` |
| **Google Cloud Run** | `gcloud run deploy --source .` (gebruikt de Dockerfile) |
| **AWS App Runner / ECS** | push image naar ECR, env-vars als taskdef-secrets |
| **Kubernetes** | Deployment met de image; `livenessProbe: /api/health`, `readinessProbe: /api/ready` |
| **VPS** | `docker compose up -d` of `node src/server.js` met de env-vars |

Vereiste secrets bij élke omgeving: `JWT_SECRET`, `ENCRYPTION_KEY` (min. 32 tekens),
en — afhankelijk van features — Stripe/Peppol/e-mail/CIAW-keys.

## Datastrategie (de enige plek met restbeperking)
- `STORAGE_ADAPTER=json` — volledig portabel, geen externe DB. Geschikt voor
  self-host/kleine tenants. Migreren = het JSON-bestand meenemen.
- `STORAGE_ADAPTER=postgres` — vandaag via een **Supabase REST-bridge**
  (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`). Dit is de enige component die
  aan Supabase gekoppeld is.
  - **Migratie tussen Supabase-projecten**: `npm run db:migrate` (zie `scripts/`).
  - **Volledig los van Supabase** (eigen/managed Postgres via `DATABASE_URL`):
    vraagt een generieke `pg`-adapter naast de huidige bridge — nog te bouwen
    (zie "Openstaand").

## Openstaand (om lock-in volledig te elimineren)
Een **generieke Postgres-adapter** (`pg` + `DATABASE_URL`) zodat `postgres`-opslag
op elke Postgres draait (Neon, RDS, Cloud SQL, self-host) i.p.v. enkel Supabase.
De store-interface (`list/get/insert/update/remove/updateTenant/audit`) is
adapter-agnostisch, dus dit is een geïsoleerde toevoeging.
