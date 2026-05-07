# WorkFlow Pro Fullstack

Deze map is de productiegerichte ontwikkellijn. De bestaande flat app blijft de visual/prototype-zone.

## Start

```powershell
cd "C:\Users\ABMS Consultancy\Documents\New project\WorkFlowPro-fullstack"
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" src\server.js
```

Open:

```text
http://localhost:4280
```

## Focus

- Auth en sessies
- Server-side tenant isolation
- Server-side rechten
- Auditlog
- Encrypted credentials
- Golden path API
- Stripe/Peppol-ready billing service
- Mobile-first today API

Deze versie gebruikt lokaal standaard JSON-opslag achter een adapterlaag. De productie-target is Supabase PostgreSQL.

## Configuratie

Kopieer `.env.example` naar `.env` en vul waarden in. De app leest `.env` automatisch zonder extra npm package. Variabelen die al op de server bestaan, krijgen altijd voorrang op `.env`.

## Supabase PostgreSQL

1. Maak een Supabase project in een EU-regio.
2. Open de SQL editor en voer deze migraties uit:
   - `database/migrations/001_supabase_core_schema.sql`
   - `database/migrations/002_supabase_row_level_security.sql`
   - `database/migrations/003_support_escalation_indexes.sql`
3. Exporteer lokale demodata naar SQL:

```powershell
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\export-json-to-supabase-sql.js
```

4. Voer `data/supabase-seed.sql` uit in de Supabase SQL editor om de demo-tenant te laden.

Voor runtime-configuratie:

```text
STORAGE_ADAPTER=postgres
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

De adapter gebruikt de Supabase REST API bovenop de PostgreSQL-tabellen uit `database/migrations`. De service-role key hoort alleen server-side in `.env` of hosting secrets, nooit in browsercode.

Controleer de Supabase verbinding en tabellen voor deployment:

```powershell
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\check-supabase-adapter.js
```

Controleer daarna de productieblokkers:

```powershell
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\check-production-readiness.js
```

Deze preflight faalt bewust zolang er P0-blockers openstaan, zoals ontbrekende Supabase-configuratie, MFA, production secrets, Stripe of Peppol.

Voor commercial launch kan de gate strenger:

```powershell
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\check-production-readiness.js --strict
```

Strict mode faalt ook op P1-waarschuwingen zoals release metadata of publieke HTTPS URL.

Voor CI/CD of statuspagina's kan dezelfde check JSON teruggeven:

```powershell
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\check-production-readiness.js --json
```

Controleer API-key governance apart:

```powershell
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\check-api-key-governance.js --tenant t_demo --strict
```

Deze gate controleert verlopen keys, ontbrekende read/write-scope, ontbrekende module-scope, ontbrekende vervaldatum, ongebruikte keys en herhaalde weigeringen. Voeg `--json` toe voor CI/CD.

Controleer pilot readiness per tenant:

```powershell
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\check-pilot-readiness.js --tenant t_demo --min-score 80
```

Deze gate controleert de pilot-KPI's zoals eerste planning, werkbonvolume, supportdruk, kritieke bug-SLA en beslissersrapport. Open KPI's krijgen een concrete next action. Voeg `--json` toe voor CI/CD.

Genereer een exporteerbaar pilot decision report:

```powershell
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\generate-pilot-decision-report.js --tenant t_demo
```

Het rapport wordt standaard opgeslagen onder `data/reports` en bevat operations, billing, pilot score en go/no-go acties.

Gebruik `--format both` om naast JSON ook een Markdown-samenvatting te maken voor klantreviews.

Controleer commercial launch readiness:

```powershell
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\check-sales-launch.js --tenant t_demo
```

Deze gate controleert launch-KPI's zoals 20 qualified leads, 10 demo calls, 3 betalende klanten, activation rate, trial-to-paid en churn in de eerste 60 dagen. Voeg `--json` toe voor CI/CD.

Genereer een commercial launch report:

```powershell
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\generate-sales-launch-report.js --tenant t_demo --format both
```

Controleer alles samen met de go-live gate:

```powershell
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\check-go-live.js --tenant t_demo --json
```

Genereer een deelbaar go-live rapport:

```powershell
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\generate-go-live-report.js --tenant t_demo --format both
```

Werk de roadmap-checklist bij vanuit de actuele gates:

```powershell
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\generate-roadmap-checklist.js --tenant t_demo
```

Maak een index van gegenereerde rapporten:

```powershell
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\generate-report-index.js
```

Genereer alle status-artifacts in een keer:

```powershell
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\generate-status-bundle.js --tenant t_demo
```

Gebruik voor een striktere pre-launch controle dezelfde bundel met P1-blokkades meegeteld:

```powershell
& "C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\generate-status-bundle.js --tenant t_demo --strict-production
```

De app, API en status-bundel gebruiken dezelfde go-live gate, zodat Admin UI, rapporten en CI/CD dezelfde beslissing tonen.

Lokale demo zonder Supabase:

```text
STORAGE_ADAPTER=json
```

Zo blijft de lokale demo stabiel terwijl productie naar Supabase kan schakelen.
