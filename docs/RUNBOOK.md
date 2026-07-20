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
