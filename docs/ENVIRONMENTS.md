# Omgevingen · infra-matrix (dev/test/staging/production)

De runtime is providerneutraal (ADR-001/002): dezelfde code, andere `DATABASE_URL`
en `OBJECT_STORAGE_*`. De infra verschilt bewust per omgeving.

**Beleid:** alleen **productie** draait op Azure. **Test en dev** blijven op
Render (compute) + Supabase (PostgreSQL via `DATABASE_URL`, niet de oude
REST-bridge). Zo blijft de kritieke productiedata in België (GDPR) terwijl
test/dev goedkoop en snel blijft.

| Omgeving | `APP_ENV` | Compute | Database | Objectopslag | Externe diensten |
| --- | --- | --- | --- | --- | --- |
| dev | `dev` | lokaal / Render | Supabase Postgres of lokale JSON | `local` | mock (geen echte mail/Stripe/Peppol) |
| test | `test` | Render | Supabase Postgres | `local` (efemeer) of Supabase Storage (`s3`) | mock |
| staging | `staging` | Render + Supabase (of klein Azure) | Supabase Postgres | `local`/`s3` | sandbox waar mogelijk |
| production | `production` | Azure Container App | Azure PostgreSQL Flexible Server (Belgium Central) | Azure Blob (Belgium Central, `azure-blob`) | echt (Stripe live, mailprovider, Peppol) |

## Env-variabelen per omgeving (kern)

**Productie (Azure)** · secrets in Key Vault / Container App-secrets:
```
APP_ENV=production
STORAGE_ADAPTER=postgres
DATABASE_URL=postgresql://…@…postgres.database.azure.com:5432/monargo?sslmode=require
OBJECT_STORAGE_ADAPTER=azure-blob
OBJECT_STORAGE_ENDPOINT=https://<account>.blob.core.windows.net
OBJECT_STORAGE_BUCKET=<container>
OBJECT_STORAGE_ACCESS_KEY_ID=<accountnaam>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<accountsleutel>
```
Aanmaken/verifiëren: zie [AZURE-PROVISIONING.md](AZURE-PROVISIONING.md) en `npm run cloud:check`.

**Test/dev (Render + Supabase)** · secrets als Render-env:
```
APP_ENV=dev            # of test
STORAGE_ADAPTER=postgres
DATABASE_URL=postgresql://…@…supabase.co:5432/postgres?sslmode=require
OBJECT_STORAGE_ADAPTER=local     # of s3 met een Supabase-Storage-endpoint
```

## Guardrails

- Buiten `production` worden echte mail/Stripe-live/Peppol geblokkeerd (mock/sandbox).
- In `production` is `OBJECT_STORAGE_ADAPTER=local` niet toegestaan (bestanden horen niet op containerdisk).
- TLS wordt autogedetecteerd voor elke niet-lokale `DATABASE_URL` (Azure én Supabase).
- Legacy: de oude **Supabase-REST-bridge** is geen pad meer; Supabase wordt alleen nog als standaard-PostgreSQL via `DATABASE_URL` gebruikt (test/dev).

## Open keuzes (jouw beslissing)

- Objectopslag voor test/dev: `local` (efemeer op Render, prima voor wegwerpdata) of Supabase Storage via de `s3`-adapter (blijft bestaan bij redeploy).
- Staging: meelopen op Render+Supabase (goedkoop) of een kleine Azure-staging als pilot-bewijsomgeving (CTO-gate vraagt evidence uit een draaiende staging).
