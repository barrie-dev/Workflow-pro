# ADR-002 · PostgreSQL-strategie

Status: geaccepteerd · 2026-07-17
Eigenaar: technisch eigenaar + product owner
Bron: docs/spec/vendor-independence-azure.md (F-01..F-04, h5) + docs/spec/master-specification.md (h6)

## Context
De huidige opslag laadt de volledige dataset in geheugen en schrijft bij elke
wijziging alles terug (JSON-bestand in dev, Supabase/PostgREST-bridge in
productie). Dat blokkeert horizontale schaal, replicas, transacties en
relationele integriteit voor de diepe domeinen uit de master-spec.

## Besluit
1. Standaard PostgreSQL is de portable relationele basis: geen PostgREST-,
   Supabase-RPC- of Azure-specifieke SQL in de kern; geen platformextensies
   zonder portable fallback en ADR.
2. Migratie volgt de strangler-strategie uit beide specs (M0-M6 / h5.4):
   per domein een genormaliseerd schema + repositorycontract, idempotente
   backfill met reconciliatie, shadow read, domeinmatige cutover, legacy
   read-only en pas daarna opruiming. Verboden patronen: big-bang, dual write
   zonder einddatum, willekeurig mengen van lees-paden, RLS vervangen door
   enkel backendfilters.
3. Repositories zijn tenant-verplicht (elke methode draagt tenantId of een
   tenantgebonden context), gebruiken optimistic locking (version) en draaien
   meerdere writes binnen één use case in één transactie via een
   TransactionManager.
4. Verplichte kolommen per tabel: id, tenant_id (en company_id op juridische
   documenten), created_at/by, updated_at/by, version, archived_at/by;
   FK's, CHECK-constraints en UNIQUE (tenant_id, business_number).
5. Tijdens development blijven Render + Supabase de draaiomgeving; de
   Supabase-adapter geldt als legacy-adapter. Nieuwe repositories worden tegen
   standaard PostgreSQL gebouwd (lokaal via Docker Compose) zodat de latere
   Azure PostgreSQL-adapter een configuratiewissel is, geen herbouw.

## Gevolgen
Het bestaande store-pad blijft werken tot elke migratiefase bewezen is
(compatibility repositories); back-ups zijn herstelbaar op standaard
PostgreSQL zonder provider-account; RLS + repositoryfilters + tests vormen
gescheiden verdedigingslagen.
