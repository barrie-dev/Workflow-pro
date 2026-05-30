# WorkFlow Pro Live Security Checklist

Gebruik deze checklist als harde go-live gate. De app mag pas publiek live wanneer alle P0-items groen zijn.

## P0 - verplicht voor live

- Zet production environment:
  - `NODE_ENV=production`
  - `RELEASE_CHANNEL=production`
  - `COMMIT_SHA=<git commit>`
  - `APP_URL=https://...`
- Gebruik Supabase/Postgres, geen lokale JSON storage:
  - `STORAGE_ADAPTER=postgres`
  - `SUPABASE_URL=...`
  - `SUPABASE_SERVICE_ROLE_KEY=...`
  - `DATABASE_URL=...pooler.supabase.com:6543...`
- Zet nieuwe random secrets:
  - `JWT_SECRET` minimaal 32 tekens, liever 64+
  - `ENCRYPTION_KEY` minimaal 32 tekens, liever 64+
- Zet echte payment en facturatie providers:
  - `STRIPE_SECRET_KEY=sk_live_...`
  - `STRIPE_WEBHOOK_SECRET=whsec_...`
  - `PEPPOL_PROVIDER` niet `mock`
  - `PEPPOL_API_KEY` gevuld met productiekey
- Draai Supabase migraties uit `database/migrations`.
- Maak de eerste productie-admin aan met een sterk wachtwoord.
- Gebruik `WORKFLOWPRO_INITIAL_ADMIN_EMAIL`, `WORKFLOWPRO_INITIAL_ADMIN_NAME` en `WORKFLOWPRO_INITIAL_ADMIN_PASSWORD` alleen tijdelijk voor bootstrap.
- Verwijder bootstrap-envs na de eerste adminrotatie en MFA-setup.
- Activeer en verifieer MFA voor elke `super_admin` en `tenant_admin`.
- Verwijder of deactiveer demo-accounts en demo-tenants uit de productie-database.
- Maak minimaal een eerste tenantbackup en controleer restore-preview.

## Commands

Gebruik de gebundelde Node runtime of je eigen Node/npm installatie:

```powershell
node scripts/check-production-config.js --strict
node scripts/check-production-readiness.js --strict
node scripts/check-auth-hardening.js
node scripts/check-api-key-governance.js --strict
```

## Verwacht gedrag

- De server weigert te starten in production mode als kritieke config ontbreekt.
- Admin-beheeracties worden geweigerd zolang MFA niet actief en enforced is.
- API keys moeten scopes en een vervaldatum hebben.
- Stripe webhooks worden alleen vertrouwd met geldige webhook-signature.
- Secrets worden niet teruggegeven in exports of publieke API responses.
