# API Contracts

## Auth

- `POST /api/auth/login`
- `GET /api/me`

Demo credentials:

- `admin@demobouw.be`
- `admin123`

## Public status

- `GET /api/health`
- `GET /api/status`
- `GET /api/openapi.json`

`/api/status` is publieke monitoringinformatie zonder tenantdata: release, storage adapter, migratiestatus, production readiness score, componentstatussen en rate-limit policies.
De response bevat ook een samenvatting van backup-health: ontbrekende backups, verouderde backups en de gehanteerde freshness-grens.
De publieke status bevat alleen MFA-aantallen. De tenant Admin UI toont de concrete adminaccounts die MFA nog moeten afronden.
Production readiness bevat een config-risk checklist voor Supabase, JWT, encryptie, Stripe, Peppol, APP_URL en release metadata. Secretwaarden worden nooit teruggegeven.
Dezelfde controle is beschikbaar als deployment-preflight via `npm run preflight:config` en `npm run preflight:config:json`.

## Module CRUD

- `GET /api/modules`
- `GET /api/modules/:moduleKey?tenantId=:tenantId`
- `POST /api/modules/:moduleKey`
- `PATCH /api/modules/:moduleKey/:id`

Module keys staan in `src/modules/registry.js`.

## Tenant actions

- `POST /api/kbo/lookup`
- `POST /api/tenants/:tenantId/kbo/apply`
- `GET /api/tenants/:tenantId/golden-path`
- `POST /api/tenants/:tenantId/golden-path/demo`
- `GET /api/tenants/:tenantId/mobile/today`
- `POST /api/tenants/:tenantId/mobile/sync`
- `GET /api/tenants/:tenantId/suggestions/home`
- `GET /api/tenants/:tenantId/go-live`
- `GET /api/tenants/:tenantId/reports`
- `POST /api/tenants/:tenantId/reports/generate`

`/suggestions/home` geeft de volgende beste actie voor de huidige gebruiker terug. Admins kunnen productie- of pilotadvies krijgen; veldgebruikers krijgen operationele suggesties zonder production-configdetails.

## Billing

- `POST /api/tenants/:tenantId/billing/setup-intent`
- `POST /api/tenants/:tenantId/billing/payment-method`
- `POST /api/tenants/:tenantId/billing/invoices`
- `POST /api/tenants/:tenantId/billing/peppol/:invoiceId`

## Audit

- `GET /api/audit`
- `GET /api/audit?tenantId=:tenantId&area=:area&limit=50`
- `GET /api/audit?tenantId=:tenantId&format=csv`
- `GET /api/errors`
- `GET /api/errors?tenantId=:tenantId&status=500&limit=50`
- `GET /api/errors?tenantId=:tenantId&format=csv`

Audit en fouten zijn tenant-safe. Tenant-admins blijven beperkt tot hun eigen tenant. Error responses tonen geen stacktraces.

## Backups

- `GET /api/tenants/:tenantId/admin/backups`
- `POST /api/tenants/:tenantId/admin/backups`
- `GET /api/tenants/:tenantId/admin/backups/:backupId/preview`
- `POST /api/tenants/:tenantId/admin/backups/:backupId/restore`

Backup listings, previews en restores zijn tenant-scoped. Nieuwe backups bevatten alleen de tenantrecord en tenantgebonden collecties, niet de volledige platformstore.
Adminstatus toont daarnaast per tenant of de laatste backup nog binnen de freshness-grens valt.
Nieuwe backups krijgen een SHA-256 integriteitscontrole. Preview toont of de checksum aanwezig en geldig is; restore stopt met `409` wanneer een aanwezige checksum niet meer klopt.

## API keys

- `GET /api/tenants/:tenantId/api-keys`
- `POST /api/tenants/:tenantId/api-keys`
- `GET /api/tenants/:tenantId/api-keys/governance`
- `POST /api/tenants/:tenantId/api-keys/governance/run`
- `POST /api/tenants/:tenantId/api-keys/:keyId/rotate`
- `POST /api/tenants/:tenantId/api-keys/:keyId/revoke`

Nieuwe keys vereisen minstens `read` of `write` en minstens een module-scope: `planning`, `workorders`, `billing` of `integrations`.
