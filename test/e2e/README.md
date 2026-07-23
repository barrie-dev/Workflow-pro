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
| 1 | Construction: offerte → project → planning → werkbon → factuur → marge | `chain` (één doorlopende keten) + `quoteversion` + `projects` + `planning` + `workorder` + `finance` | **volledig** · `chain-smoke` bewijst de hele keten als één scenario: klant → offerte → verzenden + geverifieerd ondertekenen → factuur (draagt projectId) → planning → werkbon (uren/materiaal/handtekening/goedkeuring) → betaling (allocatie) → projectfinance (budget/arbeid/gefactureerd, bron traceerbaar) |
| 2 | Meerwerk met gedeeltelijke acceptatie en aparte factuurbron | `construction` (change orders) + `claims` (betwiste lijnen, aparte bron) | gedekt |
| 3 | Offline werkbon met materiaal en handtekening, incl. dubbel queue-item | `offline-workorder-chain` (materiaalverbruik → handtekening aan versie → dubbel queue-item = exact één domeinmutatie → audit → negatieve autorisatie → teruglezing) | **volledig** (CTO3-04) |
| 4 | Servicecontract genereert onderhoudsbeurt, assethistoriek en facturatie | `contracts` (generatie) + `assets` (historiek, beurten) | gedekt |
| 5 | Inkooporder deelontvangst + projectverplichting, zonder dubbele kost | `proc` | gedekt |
| 6 | Factuurnummering, UBL-reconciliatie, Peppol-fout en retry | `peppol-billing-chain` (nummering → UBL sluitend → provider-fout met spoor → fix+retry poging 2 → ZELFDE nummer → EXACT ÉÉN billable event, idempotente retry → negatieve autorisatie) | **volledig** (CTO3-04) |
| 7 | Tenant A probeert elk pad naar data van tenant B | `cross-tenant-chain` (echt geprovisioneerde tweede tenant · lezen/wijzigen/exporteren/attachments/transitions → generieke weigering, geen bestaan-oracle, A ongewijzigd) | **volledig** (CTO3-04) |
| 8 | Rol zonder kostprijsrecht probeert UI, API, export, zoeken, rapport en Mona | `field-rights-chain` (verborgen kostprijs over UI-contract/API/zoeken/export/rapport/Mona · positieve controle met costs.view) | **volledig** (CTO3-04) |
| 9 | Legacy-migratie met external ID en bestanden | `legacy-import-chain` (idempotente import → external IDs → onbewerkbare snapshot = source_of_truth → gekoppelde attachment overleeft herhaalde import → negatieve autorisatie) | **volledig** (CTO3-04) |

**Eerlijke stand: 9 volledig, 0 deels, 0 harde gaten (CTO3-04).** Alle negen
verplichte scenario's zijn nu als ÉÉN doorlopende keten bewezen (positieve
output + negatieve autorisatie + idempotentie + audit + teruglezing), met alle
IDs uit serverresponses en zonder mocks voor domeinrepositories. Daarbovenop
bewijst de gate één echte **restart-persistentie** (records overleven een
stop+herstart tegen hetzelfde databestand). Het executing evidence-artefact
`docs/traceability/evidence/e2e-scenarios.json` legt dit per scenario vast
(green + fullChain + restartPersistence), en `scripts/check-e2e-scenarios.js` is
de harde gate (exit 1 bij één rode keten, een niet-volledige keten of een
gefaalde restart).

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
