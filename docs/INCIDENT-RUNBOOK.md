# Incident-runbook + observability (CTO3-12)

Dit runbook beschrijft hoe Monargo One tijdens een betalende pilot wordt bewaakt
en hoe een incident verloopt. Het is bewust gesplitst in een **code-kant** (in
deze repo geleverd) en een **infra-kant** (acties bij de eigenaar van de
omgeving). Wat niet gemeten is, staat hier ook niet als "geregeld".

## 1. Servicedoelen (SLO)

| Fase | Beschikbaarheid | Meting |
|---|---|---|
| Betalende pilot | **99,5%** per maand | externe synthetische readiness-check |
| Commercieel | **99,9%** per maand | idem |

Aangekondigd onderhoud telt niet mee. De meting gebeurt **extern** · een check
die alleen de applicatie zelf bevraagt telt niet als bewijs.

## 2. Externe synthetische checks (code · geleverd)

```bash
SYNTHETIC_TARGET=https://<omgeving> \
  SYNTHETIC_EMAIL=<canary-account> SYNTHETIC_PASSWORD=<canary-wachtwoord> \
  node scripts/synthetic-checks.js --json
```

Controleert **liveness**, **readiness**, **deploy-identiteit** (commit-SHA +
deployment-ID), **login** en een **veilige canary-leesactie**. Exit 1 = alert.
Draai dit vanaf een externe runner (uptime-provider of geplande CI-job), nooit
vanaf dezelfde instantie.

> De canary gebruikt een **gereserveerd** account, nooit een klantaccount. De
> schrijf-canary hoort bij de deploy-evidence (CTO3-06), niet bij monitoring.

## 3. Logging en redactie (code · geleverd)

`src/platform/log-redaction.js` is de enige plek die bepaalt wat niet in een log
of alertmail mag. Elke logregel draagt:

`requestId` · **tenant-hash** (nooit het tenant-id) · `deploymentId` ·
`commitSha` · `code` · `level` · geredigeerde `message`/`context`.

Altijd gemaskeerd, ook diep genest, in arrays en in vrije tekst: wachtwoorden,
tokens/JWT's, provider- en webhooksleutels, private keys, **rijksregisternummers**,
**IBAN's/bankrekeningen** en kaartnummers. Een epoch-timestamp blijft leesbaar ·
die is nodig voor correlatie. Getest in `test/log-redaction.test.js`.

## 4. Alerts

Configureer alerts op minimaal deze signalen:

| Signaal | Bron | Ernst |
|---|---|---|
| Readiness niet 200 | synthetische check | S1 |
| 5xx-ratio boven drempel | applicatielogs | S1/S2 |
| DB-connectie faalt | readiness `checks.storage` | S1 |
| Writer-lock timeout | opstartlog `waiting_lock` → `failed` | S1 |
| Objectopslag put/get faalt | deploy-evidence / restore-drill | S2 |
| Back-up of restore faalt | `scripts/restore-drill.js` (exit 1) | S1 |
| Outbox-achterstand groeit | outbox-metriek | S2 |
| E-mail-/providerfouten | mail-log + integratiestatus | S3 |

Alertmails bevatten **nooit** klantdata · ze verwijzen naar `requestId` en
tenant-hash, en de operator zoekt daarmee in de logs.

## 5. Incidentproces

| Ernst | Betekenis | Reactietijd | Communicatie |
|---|---|---|---|
| **S1** | Platform onbereikbaar of dataverlies-risico | 15 min | direct statusbericht + update per uur |
| **S2** | Kernfunctie stuk, workaround bestaat | 1 uur | statusbericht + dagelijkse update |
| **S3** | Beperkte hinder | 1 werkdag | in de release-notities |

**Stappen bij S1/S2**

1. **Bevestig** met de synthetische check en `/api/ready` (noteer `commitSha` +
   `deploymentId`).
2. **Stabiliseer.** Is de laatste deploy de oorzaak? Rol terug naar de vorige
   SHA volgens [DEPLOY-RUNBOOK.md](DEPLOY-RUNBOOK.md) §3.1 (stop-first).
3. **Data in gevaar?** Volg [DR-RUNBOOK.md](DR-RUNBOOK.md): stop de writer,
   herstel via de provider, valideer met `scripts/restore-drill.js`.
4. **Communiceer** volgens de tabel hierboven.
5. **Post-mortem** binnen 5 werkdagen (sjabloon hieronder).

Van alert naar context: het alert draagt `requestId` + tenant-hash +
`deploymentId`; daarmee vind je de logregels, en via `deploymentId`/`commitSha`
de bijbehorende **deployment-evidencebundle** (CTO3-06).

### Post-mortem-sjabloon

```
Titel · datum · ernst · duur
Impact:            wie merkte wat, hoeveel tenants
Tijdlijn:          detectie → mitigatie → herstel (met tijdstippen)
Grondoorzaak:      technisch, niet "menselijke fout"
Wat werkte:
Wat niet werkte:
Acties:            eigenaar + deadline per actie
Bewijs:            evidencebundle-SHA, alert-ID, logquery
```

## 6. Infra-acties (NIET in deze repo · eigenaar van de omgeving)

Deze punten kan code niet leveren. Zolang ze open staan, is CTO3-12 **niet**
afgerond en mag er geen "productie geverifieerd" geclaimd worden:

- [ ] **Hostingplan** upgraden van starter naar een productiegeschikt plan met SLA (vóór elke betalende pilot).
- [ ] **Database-PITR** of gelijkwaardige provider-back-ups aanzetten; retentie documenteren.
- [ ] **Objectstorage-versioning** + lifecycle aanzetten waar de provider dat ondersteunt.
- [ ] **Externe monitoring** inrichten die `scripts/synthetic-checks.js` (of gelijkwaardig) periodiek draait, vanaf buiten de omgeving.
- [ ] **Logcollector** koppelen die de JSON-logregels centraal bewaart, met retentie die de audit- en supportperiode dekt.
- [ ] **Alertkanalen** koppelen (on-call) voor de tabel in §4.
- [ ] **Game day**: het incidentproces minstens één keer oefenen en het verslag bewaren.

Elk vinkje hoort een eigenaar en een datum te krijgen; een leeg vakje is een
open risico, geen detail.
