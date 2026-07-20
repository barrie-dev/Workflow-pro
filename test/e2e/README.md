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
| 3 | Offline werkbon met foto, materiaal en handtekening, incl. dubbel queue-item | `workorder` (sync-conflict, handtekening aan versie, materiaal) | **deels** · foto-upload en dubbel queue-item ontbreken |
| 4 | Servicecontract genereert onderhoudsbeurt, assethistoriek en facturatie | `contracts` (generatie) + `assets` (historiek, beurten) | gedekt |
| 5 | Inkooporder deelontvangst + projectverplichting, zonder dubbele kost | `proc` | gedekt |
| 6 | Factuurnummering, PDF/UBL-reconciliatie, Peppol-fout en retry | `credit` + `finance` (nummering, bronnen) | **GAT** · PDF-vs-UBL-reconciliatie en Peppol-retry zijn niet getest (Peppol is een mock-provider) |
| 7 | Tenant A probeert elk pad naar data van tenant B | `policy` + unittests (grid, pg-crm cross-tenant) | **deels** · geen uitputtende padenscan als één scenario |
| 8 | Rol zonder kostprijsrecht probeert UI, API, export, zoeken en Mona | `policy` + `grid` (hiddenColumns) + `signals` | **deels** · UI- en Mona-pad niet in één scenario |
| 9 | Legacy-migratie klant/project/werkbon met external ID en bestanden | `robaws` (external_id, idempotent, snapshots) | **deels** · bestanden migreren niet mee |

**Eerlijke stand: 3 volledig, 5 deels, 1 gat.** De "deels"-scenario's zijn per
schakel bewezen maar niet als één doorlopende keten; scenario 6 vereist eerst
een echte Peppol-testomgeving.

## Overige smokes

`catalog`, `emp`, `grid`, `workos`, `portfolio`, `webhook`, `crm`, `company`,
`events`, `signals`, `claims` dekken de acceptatiecriteria van hun module
(API-CONTRACTS-V2) en draaien mee als regressienet. `idempotency` bewijst het
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
