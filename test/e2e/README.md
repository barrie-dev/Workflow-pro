# End-to-end-scenario's (h51)

Standalone smokes die tegen een draaiende server (poort 4299) lopen en met
exitcode ≠ 0 falen. Draai ze via de runner, die per smoke een verse server met
een eigen tijdelijk databestand start:

```
npm run test:e2e              # alles
npm run test:e2e -- catalog   # filter op naam
```

Deze scripts zijn tijdens de bouw per module ontstaan en daarna hierheen
gepromoveerd; eerder leefden ze buiten de repo en verdampte het bewijs met de
sessie. Dat is precies wat h51 verbiedt.

## Mapping op de negen verplichte scenario's (h51.1)

| # | Verplicht scenario | Gedekt door | Status |
|---|---|---|---|
| 1 | Construction: offerte → project → planning → werkbon → factuur → marge | `quoteversion` + `projects` + `planning` + `workorder` + `finance` | **deels** · de keten is per schakel gedekt, niet als één doorlopend scenario |
| 2 | Meerwerk met gedeeltelijke acceptatie en aparte factuurbron | `construction` (change orders) + `claims` (betwiste lijnen, aparte bron) | gedekt |
| 3 | Offline werkbon met foto, materiaal en handtekening, incl. dubbel queue-item | `workorder` (sync-conflict, handtekening aan versie, materiaal) + `mobile-offline` (dubbel queue-item → replay op commandId, geen dubbele toepassing) | **deels** · foto-upload ontbreekt nog |
| 4 | Servicecontract genereert onderhoudsbeurt, assethistoriek en facturatie | `contracts` (generatie) + `assets` (historiek, beurten) | gedekt |
| 5 | Inkooporder deelontvangst + projectverplichting, zonder dubbele kost | `proc` | gedekt |
| 6 | Factuurnummering, PDF/UBL-reconciliatie, Peppol-fout en retry | `credit` + `finance` (nummering, bronnen) + `reconciliation` (factuur ⟷ UBL sluitend per tarief, Peppol-fout met zichtbaar spoor, retry = poging n+1 → afgeleverd) + unittests document ⟷ factuur ⟷ UBL | **deels** · gedrag van een echte Peppol-provider vereist een testomgeving |
| 7 | Tenant A probeert elk pad naar data van tenant B | `policy` + unittests (grid, pg-crm cross-tenant) | **deels** · geen uitputtende padenscan als één scenario |
| 8 | Rol zonder kostprijsrecht probeert UI, API, export, zoeken en Mona | `policy` + `grid` (hiddenColumns) + `signals` | **deels** · UI- en Mona-pad niet in één scenario |
| 9 | Legacy-migratie klant/project/werkbon met external ID en bestanden | `robaws` (external_id, idempotent, snapshots) | **deels** · bestanden migreren niet mee |

**Eerlijke stand: 3 volledig, 6 deels, 0 harde gaten.** De "deels"-scenario's
zijn per schakel bewezen maar niet als één doorlopende keten; de restpunten
zijn foto-upload op de werkbon en het gedrag van een echte Peppol-provider.

Daarnaast draait `perf` het h50.1-budget als regressienet: P95 per
endpointklasse (read < 800 ms, write < 1500 ms · pilotdoelen) op een gevulde
dataset, binnen het rate-limit-budget.

## Overige smokes

`catalog`, `emp`, `grid`, `workos`, `portfolio`, `webhook`, `crm`, `company`,
`events`, `signals`, `claims`, `payments`, `v1` dekken de acceptatiecriteria
van hun module (API-CONTRACTS-V2 / API-V1) en draaien mee als regressienet. `idempotency` bewijst het
h41-acceptatiecriterium tegen de echte server: een herhaalde POST met dezelfde
Idempotency-Key creëert geen duplicaat maar speelt de eerste response terug.

## Conventies

- Elke smoke logt `OK · …` / `FOUT · …` per controle en eindigt met
  `SMOKE OK` of `SMOKE FAALT: n`.
- Afsluiten via `exitSoft` uit `_exit.js`, nooit rechtstreeks `process.exit`:
  een harde exit racet op Windows met sluitende fetch-sockets en laat een
  geslaagde smoke dan als gefaald eindigen (libuv-assert in win/async.c).
- Demo-login: `admin@demobouw.be` (dev-seed). De runner geeft elke smoke een
  verse dataset, dus smokes mogen vrij data aanmaken.
- Nieuwe module? Schrijf de smoke tegen de acceptatiecriteria van het
  spec-hoofdstuk, niet tegen de implementatie.
