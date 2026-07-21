# Legacy · Supabase-REST-bridge (alleen eenmalige datamigratie)

> Dit is GEEN productiepad meer. De runtime draait providerneutraal op
> PostgreSQL via `DATABASE_URL` (zie [README](../../README.md) en
> [DEPLOY-RUNBOOK](../DEPLOY-RUNBOOK.md)). Dit document bewaart de oude
> Supabase-stappen uitsluitend als hulpmiddel voor een eenmalige datamigratie
> vanuit een bestaande Supabase-omgeving. Gebruik het niet voor nieuwe
> deployments.

De historische Supabase-adapter gebruikte de Supabase REST API bovenop de
PostgreSQL-tabellen. Voor een eenmalige migratie:

1. Exporteer lokale demodata naar SQL:

```bash
node scripts/export-json-to-supabase-sql.js
```

2. Voer de gegenereerde `data/supabase-seed.sql` uit in de Supabase SQL editor.

3. Controleer de historische verbinding (legacy-script):

```bash
node scripts/check-supabase-adapter.js
```

De service-role key hoorde alleen server-side, nooit in browsercode. De
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`-variabelen zijn legacy en geen
go-live-vereiste meer; de go-live-checks draaien op `DATABASE_URL`
(providerneutraal). De canonieke migraties staan onder `migrations/sql/` en
worden toegepast met `node scripts/run-migrations.js`.
