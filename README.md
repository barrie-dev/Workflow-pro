# Monargo One SaaS

Monargo One is een multi-tenant SaaS-platform voor klanten, offertes, opdrachten, personeelsplanning, tijdregistratie, onkosten en facturatie. De interface gebruikt één compacte workspace voor admin, manager, medewerker, reseller en superadmin.

De runtime is providerneutraal: dezelfde code draait lokaal op een JSON-adapter en in productie op een echte PostgreSQL via `DATABASE_URL`. Er is geen aanbieder-specifieke SDK in de kern (ADR-001/002). Voor het gekozen productiepad op Azure: zie [docs/DEPLOY-RUNBOOK.md](docs/DEPLOY-RUNBOOK.md).

## Lokaal testen

Vereiste: Node.js 22 (de enige ondersteunde runtime voor CI, container en Azure).

```bash
npm ci
REQUIRE_ADMIN_MFA=false STORAGE_ADAPTER=json npm start
```

Open `http://localhost:4280`.

Lokale demoaccounts gebruiken uitsluitend de meegeleverde JSON-testdata. Initialiseer hun ontwikkelwachtwoord indien nodig met `node scripts/reset-demo-passwords.js`.

| Rol | E-mail | Startscherm |
| --- | --- | --- |
| Admin | `admin@demobouw.be` | Operationeel bord en klantflow |
| Manager | `manager@demobouw.be` | Dagstart en uitzonderingen |
| Medewerker | `jan@demobouw.be` | Vandaag, prikklok en werkbonnen |
| Superadmin | `super@workflowpro.be` | Platformbeheer |

`REQUIRE_ADMIN_MFA=false` is alleen bedoeld voor een lokale producttest. In staging en productie hoort MFA verplicht te blijven.

Een logische acceptatietest staat in [docs/SAAS-PRODUCT-STATUS.md](docs/SAAS-PRODUCT-STATUS.md).

## Ontwikkelcontrole

```bash
npm run check          # syntaxcheck
npm test               # unit + integratie (met DATABASE_URL ook de DB-tests)
npm run test:e2e       # end-to-end scenario's op een verse dataset
npm run gate           # roadmap-gate: R0-R7 / E01-E22 / DoD (bron van waarheid)
```

De roadmap-gate leidt de status af uit echte evidence (impl + test + migratie) en is bewust rood tot de kern sluit. De volledige matrix staat in [docs/traceability/matrix.md](docs/traceability/matrix.md) en wordt in CI opnieuw gegenereerd. Zie de CTO-gate: <https://github.com/barrie-dev/Workflow-pro/issues/40>.

## Configuratie

Kopieer `.env.example` naar `.env` en vul waarden in. De app leest `.env` automatisch zonder extra npm-package. Variabelen die al op de server bestaan, krijgen altijd voorrang op `.env`.

## PostgreSQL (productie)

De runtime praat rechtstreeks met PostgreSQL via een connectiestring. Elke aanbieder met een standaard PostgreSQL 16-endpoint werkt; er is geen aanbieder-specifieke laag.

```text
STORAGE_ADAPTER=postgres
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

Pas de migraties toe (idempotent, met advisory lock) op een lege of bestaande database:

```bash
node scripts/run-migrations.js            # past migrations/sql/*.sql toe
node scripts/run-migrations.js --status   # toont toegepast/openstaand
```

Controleer de productieblokkers voor deployment (faalt bewust zolang P0-blockers openstaan zoals DATABASE_URL, MFA, production secrets, Stripe of Peppol):

```bash
npm run preflight:production          # leesbaar
npm run preflight:production:json     # voor CI/CD
npm run preflight:production:strict   # telt ook P1-waarschuwingen mee
```

Losse gates (elk met `:json` voor CI/CD): `npm run preflight:api-keys`, `npm run preflight:pilot`, `npm run preflight:sales`, `npm run preflight:go-live`. Genereer alle status-artifacts in een keer met `node scripts/generate-status-bundle.js --tenant t_demo`.

De app, API, CLI-gate en status-bundel gebruiken dezelfde bronnen, zodat Admin UI, rapporten en CI/CD dezelfde beslissing tonen.

## Azure productie

Het gekozen productiepad (compute, PostgreSQL, Blob Storage, Key Vault, DNS/TLS, Application Insights) en de migratie-, secrets- en evidence-stappen staan in [docs/DEPLOY-RUNBOOK.md](docs/DEPLOY-RUNBOOK.md). Productie gebruikt `STORAGE_ADAPTER=postgres` en `OBJECT_STORAGE_ADAPTER=azure-blob`; lokale objectopslag is niet toegestaan in `APP_ENV=production`.

## Legacy

De eerdere Supabase-REST-bridge is niet langer het productiepad; hij blijft alleen als eenmalig datamigratie-hulpmiddel. Zie [docs/legacy/SUPABASE-MIGRATION.md](docs/legacy/SUPABASE-MIGRATION.md).
