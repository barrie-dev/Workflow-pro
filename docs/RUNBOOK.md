# Runbook

Operationele handleiding voor Monargo One (DoD h54 punt 13 en 14). Bedoeld voor
wie om 3 uur 's nachts gebeld wordt, dus: symptoom eerst, dan wat je doet.

## Snelle diagnose

| Endpoint | Betekenis |
|---|---|
| `GET /api/health` | **Liveness.** Blijft 200 zolang het proces leeft. Geeft `commitSha`, `storageAdapter`, `txAdapter`, `uptime`. Een 200 zegt niets over de database. |
| `GET /api/ready` | **Readiness.** 503 bij storage-uitval. Bevat `checks.pendingWrites`. |
| `GET /api/status` | Publieke status: release, migratiestatus, componentstatussen, backup-health. Geen tenantdata. |

**Belangrijk onderscheid:** een orchestrator moet `/api/ready` gebruiken om
verkeer te sturen en `/api/health` om te beslissen of hij herstart. Andersom
herstart hij bij elke database-hapering onnodig het proces.

## Logvorm

Alles gaat als JSON naar stdout, dus elk platform verzamelt het zonder agent.

| `type` | Wanneer |
|---|---|
| `log` | gewone gebeurtenissen; `severity` DEBUG/INFO/WARN/ERROR |
| `security` | geweigerde toegang, auth, sleutelrotatie, export |
| `metrics` | elke 60s één regel met geaggregeerde metingen |

Elke regel draagt `correlationId`, `requestId`, `tenantId` en `actorId`. Stuur
`x-correlation-id` mee vanaf de client om een keten over diensten te volgen;
zonder header is het requestId de correlatie. Elk antwoord geeft `x-request-id`
terug, dus een screenshot van een gebruiker leidt naar de juiste logregel.

PII en secrets worden vóór export gefilterd. Zie je `[PII]` of `[REDACTED]`, dan
werkt dat zoals bedoeld: er stond iets, en het hoort niet in telemetrie.

---

## Symptoom: `/api/ready` geeft 503

1. Kijk naar `store` in de response: `adapter`, `online`, `lastError`.
2. **JSON-adapter** · schijf vol of pad niet schrijfbaar. Controleer het volume.
3. **PostgreSQL-adapter** · database onbereikbaar of pool uitgeput.
   - `pool.waiting > 0` en `total = max` → verhoog `DATABASE_MAX_CONNECTIONS` of
     zoek de trage query.
   - `lastError` met `revisieconflict` → twee instanties schrijven tegelijk; zie
     hieronder.
4. Het proces hoeft NIET herstart: readiness herstelt vanzelf zodra de database
   terug is. Herstarten kost juist de openstaande schrijfactie.

## Symptoom: `STATE_REVISION_CONFLICT` in de logs

Twee instanties schreven naar dezelfde staat. De openstaande mutatie is bewaard,
niet weggegooid.

- Incidenteel: normaal bij een rolling deploy, lost zichzelf op.
- Aanhoudend: je draait meerdere replicas op de document-adapter. Die is daar
  niet op gebouwd. Schaal terug naar één replica tot de normalisatie (F-03/F-04)
  klaar is, of accepteer dat de laatste schrijver wint.

## Symptoom: openstaande schrijfacties bij afsluiten

`checks.pendingWrites: true` op `/api/ready`.

- De shutdown-handler flusht en sluit de pool. Geef de container **minstens 15
  seconden** `terminationGracePeriod`, anders kap je die flush af.
- Zie je in de logs `[store] wegschrijven mislukt`, dan is de laatste mutatie
  niet bewaard. Het requestId in dezelfde regel wijst naar wat verloren ging.

## Symptoom: webhooks komen niet aan

1. `GET /api/tenants/:id/webhooks` → `health.endpoints[]`.
2. `status: "error"` betekent dat de circuit breaker het endpoint uitschakelde
   na aanhoudende fouten. De events zijn NIET weg; ze staan als `backlog`.
3. Herstel de ontvanger, zet het endpoint terug op `active` (PATCH), en forceer
   een ronde met `POST /webhooks/deliver`.
4. Een event in dead-letter zet je terug met
   `POST /webhooks/events/:eventId/requeue`.
5. Controleer bij de ontvanger of hij de handtekening juist berekent: HMAC-SHA256
   over `${timestamp}.${body}` met het signing secret.

## Symptoom: rate limiting bij legitiem verkeer

Zichtbaar als `429` met `retryAfter`. De limiet geldt per IP en pad.

- Bij een batch-import of migratie: gebruik een API-key-account, dat heeft een
  eigen limiet, of spreid de aanroepen.
- Dit is een NFR uit h50, geen bug. Verhoog niet zomaar de limiet zonder te
  begrijpen wie er klopt.

## Symptoom: auditregels lijken te ontbreken

Sinds F-10 kapt schrijven **nooit** af. Verdwijnt er toch iets:

1. Zoek naar `audit_retention_applied` in de audit zelf; de retentiejob laat
   altijd een spoor achter met aantallen.
2. Retentie is per tenant: 400 dagen gewoon, 1095 dagen voor securityacties.
3. Securityregels worden nooit door de cap geraakt.

Ontbreekt er een regel zonder bijpassende retentie-entry, dan is dat een bug ·
escaleer, want het gaat om compliance-data.

---

## Symptoom: deploy faalt met "Exited with status 1"

De app weigert bewust te starten wanneer de productieconfiguratie onvolledig
is (fail-fast in `src/lib/config.js`). Het deploy-log bevat dan letterlijk
`Production config blokkeert start: ...` met de ontbrekende variabelen.

1. Open het deploy-log en zoek die regel. De lijst is compleet · alles in één
   keer zetten, niet per stuk proberen.
2. Vereist in productie: `APP_URL` (https), `STORAGE_ADAPTER=postgres`,
   `DATABASE_URL` (standaard PostgreSQL-URL), `JWT_SECRET` en
   `ENCRYPTION_KEY` (beide ≥ 32 tekens, geen defaults).
3. TLS naar de database wordt automatisch aangezet voor elke niet-lokale host
   (managed databases weigeren onversleuteld). Overrulen kan expliciet met
   `DATABASE_SSL=true|false`.

### Cutover van de legacy Supabase-bridge naar de pg-adapter

Bij de EERSTE start op een lege `platform_state` neemt de adapter de
bestaande dataset automatisch over van de legacy-bridge, mits `SUPABASE_URL`
en `SUPABASE_SERVICE_ROLE_KEY` nog gezet zijn. De bridge wordt daarbij alleen
GELEZEN. In het boot-log staat welke bron gebruikt is:
`Data : platform_state geïnitialiseerd vanuit legacy-import (n tenant(s))`
· staat er "vanuit seed" terwijl je bestaande data verwachtte, stop dan en
controleer de Supabase-variabelen vóór er iemand in de verse omgeving werkt
(de legacy-data is niet weg; de overname gebeurt alsnog zodra je
`platform_state` leegt en herstart).

Rollback van de hele cutover = `STORAGE_ADAPTER=supabase` terugzetten: de
bridge-data is nooit gewijzigd.

---

## Peppol via Billit activeren (sandbox → live)

Monargo genereert zelf de Peppol BIS 3.0 UBL; Billit is uitsluitend het
transport (`POST /v1/peppol/sendxml`). Volgorde bij het aansluiten:

1. **Sandbox-sleutel binnen?** Draai in een terminal (sleutel nooit in een
   bestand of chat):
   `set PEPPOL_API_KEY=... && set PEPPOL_PARTY_ID=... && npm run peppol:sandbox:check -- BE0403170701`
   Dit bewijst de sleutel (deelnemerscheck) en met `--send` gaat er ook een
   test-UBL van 1,21 euro het sandboxnetwerk op. Bij een 401: probeer
   `PEPPOL_AUTH_HEADER=Authorization` · headernaam is een env-flip.
2. **Platformbreed aanzetten (staging)**: superadmin → Integraties → Peppol:
   provider `billit`, API-sleutel, PartyID, omgeving "Sandbox". PartyID's van
   sandbox en productie VERSCHILLEN.
3. **Preflight per factuur**: `GET .../facturen/:id/peppol/check` toont
   validatiegebreken én of de ontvanger BIS v3-facturen kan ontvangen ·
   de UI hoort dit vóór het verzenden te tonen, niet de fout erna.
4. **Live**: omgeving op "Productienetwerk", productie-PartyID invullen.
   De guardrail blokkeert sandbox-verzending in productie hard
   (`peppol_sandbox_in_production`) · echte facturen kunnen nooit stil het
   testnetwerk op.

Elke mislukte verzending laat een spoor op de factuur (peppolStatus,
peppolError, peppolAttempts); een retry is aantoonbaar poging n+1.

---

## Migratie en rollback

### Schemawijzigingen

Migraties zijn een **aparte deploystap**, niet iets dat de app bij het opstarten
doet. Anders wijzigt het schema terwijl de vorige versie nog draait.

```
npm run db:migrate:status     # wat is toegepast, wat staat open
npm run db:migrate:sql:dry    # tonen zonder toe te passen
npm run db:migrate:sql        # toepassen
```

De runner neemt een advisory lock, dus meerdere replicas tegelijk is veilig: de
tweede wacht en ziet dat het werk gedaan is. Elke migratie draait in zijn eigen
transactie.

**Wijzig nooit een migratie die al gedraaid heeft.** De runner bewaart een
checksum en stopt met `MIGRATION_CHECKSUM_MISMATCH` vóór er iets gebeurt. Maak
een nieuwe migratie.

### Rollback

Migraties hebben bewust geen automatische `down`. Een gegenereerde rollback geeft
een vals gevoel van veiligheid: hij herstelt het schema maar niet de data die
intussen is weggegooid.

Bij een mislukte uitrol:

1. **Rol de applicatie terug**, niet het schema. Alle migraties zijn additief
   (nieuwe tabellen en kolommen), dus een oudere versie draait er gewoon op.
2. Moet het schema echt terug, schrijf dan een nieuwe, expliciete migratie die
   de wijziging ongedaan maakt, en test die eerst op een kopie.
3. Herstel data uit de backup; zie `npm run production:backups`.

### CRM-cutover (5.4 stap 5-7) · CRM_READ_SOURCE

De canonieke /customers-routes hebben een bronschakelaar met drie standen.
De procedure is strikt sequentieel; sla geen stap over.

1. **Backfill + reconciliatie** (zie hieronder). Herhaal tot elke tenant
   `Cutover: GROEN` toont.
2. **`CRM_READ_SOURCE=shadow`** en herstart. Legacy blijft leidend; elke
   schrijfactie gaat naar beide bronnen en elke detail-lees vergelijkt.
   Bewaak de metriek `crm.shadow.mismatch` en de warn-logs · draai zo
   minstens een paar dagen productieverkeer.
3. Reconciliatie opnieuw. Groen + geen mismatches → **`CRM_READ_SOURCE=pg`**.
   Lezen komt nu uit PostgreSQL; schrijven blijft dual, dus:
4. **Rollback = flag terug naar `shadow` of `legacy`** en herstarten. Er gaat
   niets verloren, want legacy ontving elke schrijfactie.
5. Pas ná de afgesproken retentie- en rollbackperiode wordt legacy read-only
   (5.4 stap 8) · dat is een aparte, bewuste stap, geen automatisme.

Let op: een spiegel-fout gedraagt zich per stand anders. In shadow logt hij
(`crm.mirror.failed`) en slaagt het verzoek; in pg-modus faalt het verzoek met
503 `CRM_MIRROR_FAILED`, omdat de gebruiker anders zijn eigen schrijfactie niet
terugziet. De legacy-rij staat er dan al · opnieuw proberen of backfillen
herstelt het.

Afgeleide naam-lookups in andere domeinen (contract, asset) lezen bewust nog
legacy tot hun eigen domein migreert; dat is de per-domein-strangler, geen bug.

### Identity-cutover (P0-01 · IDENTITY_READ_SOURCE)

Tweede domein langs dezelfde route (na CRM): tenants + gebruikers. Verschil met
CRM: schrijven blijft in ALLE standen bij de legacy-store (de write-owner voor
authenticatie). In plaats van dual-write draait een **spiegel-lus** die het
volledige platform-snapshot idempotent naar de tabellen projecteert · zo worden
álle verspreide schrijfpaden (wachtwoordreset, MFA, login-tellers) in één keer
gevangen. De lus draait zodra de pg-adapter actief is, óók in legacy-stand, dus
het reconciliatiebewijs bouwt zich vanzelf op.

1. Draai op `postgres` met de standaard `IDENTITY_READ_SOURCE=legacy`. De
   spiegel-lus vult de tabellen. Controleer met
   `POST /api/admin/identity/reconcile` (superadmin): `reconcile.ok` moet true
   zijn, `mismatches`/`missingInPg`/`extraInPg` leeg.
2. **`IDENTITY_READ_SOURCE=shadow`** en herstart. De login-lookup en de
   platform-gebruikerslijst vergelijken legacy met pg; afwijkingen gaan naar
   `identity.shadow.mismatch`. Bewaak `GET /api/admin/identity/status`.
3. Reconciliatie opnieuw groen → **`IDENTITY_READ_SOURCE=pg`**. De geschakelde
   leesroutes (`/api/admin/users`) lezen nu uit de tabellen; login-verificatie
   blijft bewust op legacy (fase 1).
4. **Rollback = flag terug naar `shadow` of `legacy`** en herstarten. Er gaat
   niets verloren, want legacy is en blijft de write-owner.

Een pg-leesfout in pg-stand faalt eerlijk met 503 `IDENTITY_SOURCE_UNAVAILABLE`
in plaats van stil terug te vallen. De sync is snapshot-gepoort: een
ongewijzigd platform levert geen schrijfwerk op.

### Finance-cutover (P0-01 · FINANCE_READ_SOURCE)

Derde en zwaarste domein: facturen + betalingen. Zelfde route en spiegel-lus
als identity; schrijven blijft bij legacy (nummering, allocatie en de
saldo-invarianten). Verschil: de genormaliseerde tabellen dragen harde
financiële invarianten die de database mede bewaakt.

1. Op `postgres` met `FINANCE_READ_SOURCE=legacy` vult de spiegel-lus de
   tabellen. Controleer met `POST /api/admin/finance/reconcile` (superadmin):
   `reconcile.ok` én in het bijzonder `saldoMismatches: []` · dat laatste is de
   financiële poortwachter (het openstaande saldo uit de allocatie-rijen moet
   gelijk zijn aan de legacy-berekening).
2. **`FINANCE_READ_SOURCE=shadow`** en herstart. De facturenlijst blijft uit
   het (performance-getunede) legacy-pad komen; een achtergrondlezing
   vergelijkt de saldi met pg (`finance.shadow.mismatch`).
3. Reconciliatie groen → **`FINANCE_READ_SOURCE=pg`**. De facturen- en
   betalingenlijst komen nu uit de tabellen, waar het saldo een SOM over de
   allocatie-rijen is. Het `invoiceId`-filter op betalingen blijft bewust nog
   op het legacy-pad tot dat filter ook genormaliseerd is.
4. **Rollback = flag terug naar `shadow` of `legacy`** en herstarten.

Strangler-detail (bewust): de finance-tabellen hebben GEEN database-FK naar
companies/customers · die domeinen migreren onafhankelijk en een harde FK zou
een big-bang eisen (5.5). De referentie-integriteit blijft in de applicatie tot
die domeinen co-migreren; tenant-FK + RLS gelden onverkort. De sync plaatst
zelf een minimaal tenant-anker zodat finance niet afhangt van de
migratievolgorde van identity.

### Datamigratie (CRM naar genormaliseerde tabellen)

```
npm run db:backfill:crm:dry   # tonen wat er zou gebeuren
npm run db:backfill:crm       # uitvoeren (idempotent)
npm run db:reconcile:crm      # alleen vergelijken
```

De backfill verwijdert nooit iets en kan zonder gevolgen herhaald worden. De
reconciliatie is de poortwachter: `readyForCutover` moet voor élke tenant groen
zijn voordat je omschakelt. Rijen die alleen in Postgres staan worden gemeld,
niet automatisch opgeruimd · beslis dat met een mens.

---

## Wat dit runbook nog niet dekt

- Geen P95-drempels per endpointklasse vastgelegd (h50 vraagt die wel). De
  metrics worden verzameld; de doelen moeten nog bepaald worden op echte cijfers.
- Geen RPO/RTO vastgelegd. Dat is een productbeslissing, geen technische.
- Geen alerting-regels. De logvorm ondersteunt ze, maar er is nog geen
  collector aangesloten.
