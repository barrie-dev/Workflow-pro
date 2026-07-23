# Disaster-Recovery-runbook (CTO3-03)

Dit runbook beschrijft hoe Monargo One een volledige herstelbaarheid van
**database én objectopslag** aantoont en uitvoert. Het vervangt de smalle
platform_state-drill (CTO2-12) door een **volledige** restore-verificatie: alle
tabellen, rijtotalen, checksums, een objectmanifest en functionele steekproeven.

De officiële productie-deploystrategie is stop-first/recreate (zie
[DEPLOY-RUNBOOK.md](DEPLOY-RUNBOOK.md) §3.1). Dit runbook is het herstel-tegenstuk:
wat te doen als de data zelf terug moet, niet enkel het proces.

## 1. Wat de drill bewijst

`node scripts/restore-drill.js` voert vier onafhankelijke bewijzen uit en geeft
exit 1 zodra één ervan faalt (release-/DR-gate):

| Deel | Bewijst | Bron |
|---|---|---|
| **Volledige DB-restore** | Alle public-tabellen komen byte-getrouw terug in een verse database; schema via de echte migraties. | `pgFullRestoreDrill` |
| **Objectmanifest** | Elk object (tenant, key, size, checksum) is aanwezig en leesbaar; missing + orphan gedetecteerd. | `objectManifestDrill` |
| **platform_state-restore** | De procespersistentie-rij herstelt exact; levert de RPO-meting. | `pgRestoreDrill` |
| **Objectopslag-persistentie** | Een bestand overleeft een procesherstart (vers adapter-exemplaar). | `objectStorageRestoreDrill` |

### 1.1 Volledige DB-restore in detail

1. **Snapshot van de bron** · alle `public`-tabellen worden opgesomd
   (`schema_migrations` uitgesloten · dat is schema-boekhouding, geen businessdata).
2. **Fingerprint per tabel** · rijtelling + een orde-onafhankelijke checksum
   (sha256 over de gesorteerde `to_jsonb`-rijhashes). De fysieke rijvolgorde telt
   dus niet mee.
3. **Verse scratch-database** · `DROP`/`CREATE` van een wegwerp-database.
4. **Schema-/migratievalidatie** · `SCHEMA_SQL` (de `platform_state`-tabel) plus
   de genummerde SQL-migraties draaien op het lege schema · exact de
   productie-schemabootstrap. Faalt een migratie, dan faalt de drill.
5. **FK-veilige datakopie** · per tabel worden rijen via jsonb gekopieerd
   (`to_jsonb` → `jsonb_populate_record`) onder `session_replication_role = replica`.
   Door de jsonb-route passeren `timestamptz`-waarden nooit een lossy JS Date,
   zodat de checksum byte-identiek blijft.
6. **Vergelijking** · per tabel matchen rijtelling én checksum, anders komt de
   tabel in `mismatches` en faalt de drill.
7. **Functionele steekproef** · op de HERSTELDE dataset worden tenants, users,
   customers en facturen geteld (genormaliseerde tabellen én, voor JSON-mode
   snapshots, het platform_state-document · het maximum telt). `tenants > 0` is
   een harde eis.
8. **RPO/RTO** · RPO = leeftijd van de nieuwste `platform_state` (proxy voor
   backup-versheid); RTO = gemeten hersteltijd van de drill.

### 1.2 Objectmanifest in detail

- `storage.list()` levert de canonieke objectset (per object: tenant, key, size,
  checksum, en of het databestand echt bestaat).
- Per object: een **roundtrip** (get + checksumcontrole) bewijst leesbaarheid.
- **Missing** = meta zonder (leesbaar) databestand. **Orphan** = databestand
  zonder meta. Beide maken de drill rood.
- De managed adapters (`s3`, `azure-blob`) implementeren dezelfde `list()`-vorm;
  de lokale adapter loopt de `<key>.meta.json`-bestanden langs.

## 2. De drill draaien

### Lokaal / CI (tegen een echte PostgreSQL)

```bash
DATABASE_URL=postgresql://USER:PASS@HOST:5432/DB \
  STORAGE_ADAPTER=postgres node scripts/restore-drill.js
```

Voeg `--json` toe voor een machineleesbaar rapport (voor evidence-artefacten).

### Productie (read-only tegen de live database)

De drill schrijft NOOIT naar de bron · hij leest de bron en werkt verder in een
wegwerp-scratch-database. Toch draai je hem bij voorkeur tegen een **replica** of
een **hersteld backup-snapshot**, niet tegen de primaire, om leeslast te vermijden.

```bash
STORAGE_ADAPTER=postgres DATABASE_URL="$REPLICA_URL" \
  OBJECT_STORAGE_ADAPTER=s3 OBJECT_STORAGE_BUCKET=... OBJECT_STORAGE_ENDPOINT=... \
  node scripts/restore-drill.js --json > dr-evidence-$(git rev-parse --short HEAD).json
```

> Objectopslag-secrets worden NOOIT op de commandline of in het evidence-bestand
> gezet · ze komen uit de omgeving (Render-dashboard / secret-store).

## 3. Echt herstel (recovery procedure)

Wanneer productie-data terug moet:

1. **Stop de writer.** Zet de service op Suspend (Render) zodat er geen schrijf
   meer op de database plaatsvindt. Single-writer betekent: één schrijver, nooit
   twee tegelijk op dezelfde database.
2. **Herstel de database** vanuit het managed backup-snapshot van de provider
   (point-in-time recovery of de laatste dagelijkse backup). Dit is een
   provider-operatie (Supabase/Azure), geen app-operatie.
3. **Herstel de objectopslag** · de bucket heeft eigen versioning/backups bij de
   provider. Draai daarna het objectmanifest om missing/orphan te detecteren.
4. **Valideer met de drill** tegen de herstelde database + bucket:
   `node scripts/restore-drill.js`. Groen = database + bestanden aantoonbaar
   consistent hersteld.
5. **Reconcilieer DB ↔ objecten** · het manifest meldt objecten zonder
   verwijzing (orphan) en verwijzingen zonder object (missing). Onderzoek elke
   afwijking vóór je de writer weer aanzet.
6. **Hervat de writer** (Resume) en bevestig readiness op `/api/ready` met de
   verwachte `commitSha`.

## 4. Doelstellingen (RPO/RTO)

| Metriek | Doel | Bron |
|---|---|---|
| **RPO** (maximaal dataverlies) | ≤ 24 u (dagelijkse backup); ≤ enkele minuten met point-in-time recovery van de provider | gemeten als `platform_state`-leeftijd in de drill |
| **RTO** (hersteltijd) | ≤ 1 u voor een volledige provider-restore + validatie | drill-RTO is een ondergrens (logische kopie); de provider-restore domineert |

De drill meet de **logische** RTO (kopieertijd naar scratch). De werkelijke RTO
in een echt incident wordt bepaald door de provider-restore van het snapshot;
plan daar de 1-uurs-doelstelling omheen.

## 5. Gate-integratie

De drill hoort in de release-/DR-gate: exit 1 bij elke gefaalde restore, mismatch,
missing of orphan. Het `--json`-rapport wordt als commit-gebonden evidence bewaard
(`commitSha` staat in de kop). Zo is elke readiness-claim gekoppeld aan één
commit-SHA met een vers gegenereerd bewijsbundel (architectuurbeslissing 8).
