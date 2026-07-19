# ADR-004 · Platform-onafhankelijke ports

Status: geaccepteerd · 2026-07-18
Eigenaar: technisch eigenaar
Bron: docs/spec/vendor-independence-azure.md (h4 verplichte ports, F-01..F-10) + ADR-001, ADR-002, ADR-003

## Context
Dev en test verhuizen weg van de bestaande PaaS, en het platform moet op elke
omgeving kunnen draaien: een laptop, een CI-runner, een VPS, Azure Container
Apps, Cloud Run, Fly.io of Kubernetes. De handover legt in hoofdstuk 4 vast welke
ports daarvoor verplicht zijn en welke regels niet afgezwakt mogen worden.

## Besluit
Elke infrastructuurafhankelijkheid loopt via een port in `src/ports/`, met
adapters in `src/infrastructure/`. Applicatie- en domeincode importeren nooit een
adapter. Een adapterwissel is een configuratiewijziging, geen codewijziging.

| Port | Status | Adapters vandaag | Later |
|---|---|---|---|
| TransactionManager (4.1) | ADR-003 | lokaal (snapshot-rollback) | PostgreSQL BEGIN/COMMIT |
| Database (4.1 / F-01, F-02) | klaar | standaard PostgreSQL, JSON-bestand | - |
| ObjectStorage (4.2 / F-08) | klaar | lokaal filesystem | Azure Blob, S3 |
| AiProvider (4.5 / F-07) | klaar | OpenAI, Azure OpenAI, mock | - |
| Secrets (4.3) | open | omgevingsvariabelen | Azure Key Vault |
| Identity/Federation (4.4) | deels | interne auth, SAML | Entra OIDC, generiek OIDC |
| JobQueue (4.6) | open | - | PostgresJobQueue, Service Bus |
| Telemetry (4.7) | open | - | OpenTelemetry + exporters |

### Niet-onderhandelbare regels
1. **Geen providernaam in de kern.** `src/platform/`, `src/ports/` en de
   domeinlagen bevatten geen SDK, endpoint, sleutel of providernaam. Bewaakt door
   `test/architecture.test.js`.
2. **Adaptercontracten zijn gedeelde testsuites.** Elke nieuwe adapter moet
   dezelfde suite halen als de bestaande (`transactionManagerContract`,
   `objectStorageContract`, het AiProvider-contract). Zo is een migratie een
   adapter-swap zonder gedragsverschil, en niet een hoop nieuwe tests.
3. **Onbekende adapternaam faalt hard bij opstarten.** Stil terugvallen op een
   lokale adapter zou in productie data op de verkeerde plek zetten.
4. **Tenantcontext zit in de infrastructuur, niet enkel in de businesslaag.**
   Objectkeys dragen de tenant en worden server-side gebouwd; elke opslagoperatie
   verifieert het eigendom.
5. **Geen secretwaarden in logs, audit of foutmeldingen.**

## Gevolgen
- `docker compose up` start de volledige stack (app + PostgreSQL) op elke
  Docker-host, zonder account of clouddienst. Er is ook een JSON-profiel zonder
  database voor demo's en kleine zelf-hosts.
- Productie vereist enkel `STORAGE_ADAPTER=postgres` en een geldige
  `DATABASE_URL`; er zijn geen providervariabelen meer verplicht.
- De legacy provider-bridge is alleen nog bereikbaar via de expliciete waarde
  `STORAGE_ADAPTER=supabase`, uitsluitend voor een eenmalige datamigratie.

## Openstaand
- **F-03/F-04 blijven de grootste post**: de store laadt en schrijft nog één
  document in plaats van genormaliseerde tabellen met transacties per use case.
  Daardoor blijft er tussen antwoord en flush één event-loop-tik waarin een crash
  de laatste mutatie kost. `/api/ready` meldt `pendingWrites`; de shutdown flusht.
  Dit is de volgende grote stap en is bewust niet half gedaan.
- Secrets, JobQueue en Telemetry (4.3, 4.6, 4.7) staan nog open.
