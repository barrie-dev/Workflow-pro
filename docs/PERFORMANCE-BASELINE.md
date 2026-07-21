# Performancebaseline · 21 juli 2026

CTO Fase C-artefact ("performancebaseline en foutbudget vastleggen"),
aangescherpt door de productbeslissing van 2026-07-21:

> Zwaarste gevallen HARD onder 1 seconde; streefdoel alles onder 200 ms.

## Methode

`node scripts/loadtest.js [--postgres] [--small]` · spawnt een verse server,
seedt een zware realistische tenant VIA DE ECHTE API (alle validatie actief)
en meet daarna per scenario 40 sequentiële samples plus 5 rondes van 10
gelijktijdige gebruikers. Exitcode 1 zodra één scenario het harde budget
breekt · daarmee is dit ook een regressienet, geen eenmalige meting.

Dataset: 1.500 klanten, 1.200 facturen (2 lijnen), 1.500 werkbonnen,
1.200 planningshifts, 400 betalingen (deels toegewezen), 300 artikelen,
100 projecten, 40 medewerkers. Machine: dev-werkstation (Windows, lokale
Docker-Postgres 16); productiecijfers zullen afwijken maar de verhoudingen
en het regressienet gelden overal.

## Resultaat (P95, 10 gelijktijdige gebruikers)

| Scenario | JSON-adapter | pg-adapter | Budget |
| --- | --- | --- | --- |
| Klantenlijst (1500) | 148 ms | 157 ms | ✔ |
| Facturenlijst incl. h45-saldi | 174 ms | 155 ms | ✔ |
| Werkbonnenlijst | 103 ms | 57 ms | ✔ |
| Planning unified | 129 ms | 123 ms | ✔ |
| Betalingenlijst | 28 ms | 30 ms | ✔ |
| Grid-query klanten (filter+zoek) | 25 ms | 22 ms | ✔ |
| Grid-query facturen (sort) | 51 ms | 51 ms | ✔ |
| /v1-lijst (centen+filter) | 90 ms | 93 ms | ✔ |
| Insights-dashboard | 11 ms | 10 ms | ✔ |
| Compliance-overzicht | 8 ms | 9 ms | ✔ |
| Dimona-register | 6 ms | 7 ms | ✔ |
| Globaal zoeken | 40 ms | 39 ms | ✔ |
| Projectfinance-aggregatie | 12 ms | 10 ms | ✔ |
| POST klant (write) | 75 ms | 11 ms | ✔ |
| POST factuur (write) | 78 ms | 11 ms | ✔ |

**15/15 scenario's binnen het 200 ms-streefdoel op beide adapters.**

## Wat hiervoor gefixt is (2026-07-21)

1. **JSON-adapter schreef de volledige staat synchroon per mutatie** · onder
   10 gelijktijdige schrijvers stapelde dat op tot 3-4 s. Nu gebufferd en
   gecoalesced in server-modus (zelfde contract als de pg-adapter) + compacte
   serialisatie boven 2 MB. Losse scripts blijven synchroon schrijven.
2. **Facturenlijst rekende kwadratisch** (per factuur alle betalingen
   scannen) · nu één pas over de betalingen. Van >1 s naar 174 ms.
3. **Insights scande alles per request** · nu een 10 s-TTL-cache PER
   GEBRUIKER (rol en signalen zijn persoonlijk; spec 5.3 staat eventual
   consistency op read-models toe). Van >1 s naar 11 ms.

## Bekende grenzen (eerlijk)

- **Eén proces**: alle cijfers gelden voor één Node-instantie. Meerdere
  replicas op de huidige platform_state-runtime introduceren
  revision-conflicten op schrijfacties · dat is exact CTO P0-01
  (normalisatie) en wordt hier niet gemaskeerd.
- **Schrijfvolume**: de volledige-staat-flush groeit lineair met de
  datasetgrootte. Bij ~10× deze dataset komt het schrijfpad opnieuw in
  gevaar; de structurele oplossing is de genormaliseerde runtime, niet meer
  caching.
- **Durabiliteit**: tussen antwoord en flush zit één event-loop-tik
  (bestaand, gedocumenteerd in server.js); /api/ready meldt pendingWrites en
  de shutdown-handler flusht altijd.
- **Rate limiter uit tijdens de meting** (RATE_LIMIT_DISABLED, bestaande
  testfaciliteit) · in productie begrenst die het werkelijke volume per IP.

## Herhalen

```
node scripts/loadtest.js                # JSON-adapter, grote dataset
DATABASE_URL=... node scripts/loadtest.js --postgres   # LEGE testdatabase!
node scripts/loadtest.js --small        # snelle sanity-run
```

Draai dit minimaal vóór elke release-kandidaat en na elke wijziging aan
lijst-, aggregatie- of opslagpaden.
