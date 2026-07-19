# API-contracten · nieuwe domeinmodules (v2)

Contract voor de modules die met de master-specificatie zijn bijgebouwd. Bedoeld
als bouwinstructie voor de frontend: per endpoint staat er niet alleen wát het
teruggeeft, maar ook **welke fouten er komen en welke UI-state daarbij hoort**
(DoD h54 punt 4 en 5).

Alle endpoints staan onder `/api/tenants/:tenantId/...` en vereisen
`Authorization: Bearer <token>`.

## Conventies

| Onderdeel | Afspraak |
|---|---|
| Succes | `{ ok: true, ... }` |
| Fout | `{ ok: false, error: "leesbare tekst", code: "MACHINE_CODE" }` |
| Ontbreekt | `404` |
| Geen recht | `403` · module niet in het pakket geeft óók `403` |
| Validatie | `400` met `code` |
| Conflict | `409` met `code` en waar relevant `currentVersion` |
| Optimistic locking | stuur `expectedVersion` mee bij elke `PATCH` |

**Conflict-UI (verplicht per DoD punt 4):** bij `409 VERSION_CONFLICT` toont de
UI niet "er ging iets mis", maar: "dit record is intussen gewijzigd" met de
keuze om te herladen. `currentVersion` zit in de response.

**Lege staat:** elke lijst kan `[]` teruggeven. Dat is een normale toestand met
een uitleg plus de primaire actie, geen foutmelding.

---

## 1. Catalogus en prijzen (E13) · recht `catalog`

| Methode | Pad | Doel |
|---|---|---|
| GET | `/articles?selectable=1&includeArchived=1` | lijst |
| POST | `/articles` | aanmaken (status `draft`) |
| GET | `/articles/:id` | detail + prijsregels + kostopbouw |
| PATCH | `/articles/:id` | wijzigen (`expectedVersion`) |
| POST | `/articles/:id/transition` | `{status}` |
| POST | `/articles/:id/resolve` | artikel → documentlijn |
| GET/POST | `/price_rules` | prijsregels |
| DELETE | `/price_rules/:id` | prijsregel verwijderen |

**Statusverloop:** `draft → active → temporarily_unavailable | phased_out → archived`.
Alleen `active` is standaard selecteerbaar; `phased_out` blijft zichtbaar in
historiek. Een gearchiveerd artikel is niet meer wijzigbaar (`409 ARCHIVED`).

**`/resolve` is het endpoint dat de frontend nodig heeft** bij het samenstellen
van een offerte- of factuurlijn. Body: `{ qty, unit?, customerId?, priceGroup?, manualPrice?, at? }`.
Response `line` bevat `unitPrice`, `costPrice`, `vatRate`, `lineTotal` én
`priceSource` + `priceDate`. Toon die bron altijd: de calculator moet kunnen
zien wáárom deze prijs geldt (klantafspraak, prijsgroep, artikelstrategie).

Foutcodes: `VERSION_CONFLICT`, `ARCHIVED`, `COMPOSITION_CYCLE` (samenstelling
verwijst naar zichzelf).

---

## 2. Werkbon v2 (E07) · recht `workorders`

| Methode | Pad | Doel |
|---|---|---|
| GET | `/workorders/:id/canonical?strategy=detail\|grouped\|single` | canonieke weergave + totalen + factuurvoorstel |
| PATCH | `/workorders/:id/fields` | uren, materiaal, materieel, formulieren |
| POST | `/workorders/:id/sync` | offline synchronisatie |
| POST | `/workorders/:id/submit` | indienen |
| POST | `/workorders/:id/sign` | handtekening |
| POST | `/workorders/:id/review` | `{decision: approve\|reject, note}` |
| POST | `/workorders/:id/corrections` | correctieboeking na goedkeuring |

**Offline sync is het belangrijkste contract van deze module.** De mobiele client
stuurt `{ baseVersion, patch, clientId, clientUpdatedAt }`. Bij een versieverschil
komt er `409 SYNC_CONFLICT` mét `serverState` én `clientPatch`.

> De UI mag hier NOOIT stilzwijgend overschrijven. Toon beide versies naast
> elkaar en laat de gebruiker kiezen. Dit is een acceptatiecriterium (h25),
> geen suggestie.

Andere fouten: `REQUIRED_FORMS_MISSING` (met `missing[]` · markeer die vragen
rood), `SIGNATURE_REQUIRED`, `CORRECTION_REQUIRED` (na goedkeuring is direct
wijzigen geblokkeerd · leid door naar het correctieformulier), `OWN_HOURS_ONLY`
(een medewerker mag alleen eigen uren wijzigen).

Uurtarieven hoeven niet meegestuurd: die worden uit het personeelsregister
gehaald op de **uitvoeringsdatum** van de werkbon.

---

## 3. Vorderingsstaten (R7) · recht `progress_claims` · Enterprise-pack

| Methode | Pad | Doel |
|---|---|---|
| GET/POST | `/progress_claims` | lijst / nieuwe staat |
| GET/PATCH/DELETE | `/progress_claims/:id` | detail, wijzigen, verwijderen |
| POST | `/progress_claims/:id/transition` | statusovergang |
| POST | `/progress_claims/:id/invoice` | factuur uit goedgekeurde staat |

Elke response bevat `totals` met `currentAmount`, `priceRevision`,
`retentionAmount`, `advanceAmount` en `netPayable`. **Toon die vier apart** ·
prijsherziening en retentie moeten transparant zijn (acceptatie h32).
`priceRevision.formulaText` bevat de complete formule; toon die letterlijk.

Foutcodes: `CONTRACT_QTY_EXCEEDED` (met `lines[]` · markeer die regels),
`CLAIM_FROZEN` (goedgekeurd, niet meer wijzigbaar), `NOT_APPROVED`,
`ALREADY_INVOICED`, `CLAIM_IN_PROGRESS`.

---

## 4. Personeelsfiches (h16) · recht `employees`

| Methode | Pad | Doel |
|---|---|---|
| GET/POST | `/employee_records` | lijst / aanmaken |
| GET/PATCH | `/employee_records/:id` | detail / wijzigen |
| POST | `/employee_records/:id/rates` | nieuwe tariefversie |
| POST | `/employee_records/:id/transition` | statusovergang |
| GET | `/employee_records/:id/availability?date=` | beschikbaarheid |
| GET | `/employee_records/expiring-certificates?horizonDays=` | vervallende attesten |

Let op: dit staat **naast** `/employees`, dat gebruikersaccounts beheert. Een
personeelsfiche en een loginaccount zijn aparte entiteiten met een optionele
koppeling via `userId`.

`costRates` is alleen zichtbaar voor beheerders en ontbreekt in de response voor
anderen. Toon geen leeg tariefblok maar verberg de sectie.

`availability` geeft `{ available, blocking, reasons[] }`. **`blocking: false`
is een waarschuwing, geen blokkade** · bijvoorbeeld plannen buiten het
werkrooster. Toon dat als bevestigingsvraag, niet als fout.

---

## 5. Universele lijsten (h11) · recht per resource

| Methode | Pad | Doel |
|---|---|---|
| GET | `/grid/resources` | beschikbare resources + operatoren |
| POST | `/grid/:resource/query` | filteren, zoeken, sorteren, pagineren |
| POST | `/grid/:resource/bulk/preview` | vooruitblik |
| POST | `/grid/:resource/bulk` | uitvoeren |
| POST | `/grid/:resource/export` | CSV of exportjob |
| GET | `/grid/exports/:id?token=` | download |
| GET/POST/PATCH/DELETE | `/grid/views` | opgeslagen views |

**Bulk vereist altijd eerst een preview.** Die geeft `affectedCount` en
`skipped[]` met per record een reden. Toon dat als bevestigingsdialoog vóór je
`/bulk` aanroept; daarna rapporteert `job.results[]` per record succes of fout.
Een `partial` job is een geldige uitkomst: toon wat lukte én wat niet.

`hiddenColumns` in de query-response vertelt welke kolommen zijn weggelaten
omdat de gebruiker er geen recht op heeft. Verberg die kolommen, toon geen lege
cellen.

Export boven de limiet geeft `202` met een job plus `downloadPath` en
`expiresAt`. Toon de vervaltijd; na verval geeft de download `410 EXPIRED`.

---

## 6. Work OS: formulieren, taken, bestanden, communicatie (h39)

| Methode | Pad | Doel |
|---|---|---|
| GET/POST | `/forms/templates` | formulierdesigner |
| PATCH/POST | `/forms/templates/:id[/transition]` | wijzigen / publiceren |
| GET/POST | `/forms/instances` | invullingen |
| PATCH | `/forms/instances/:id` | antwoorden opslaan |
| POST | `/forms/instances/:id/{submit,lock,photo}` | indienen, vergrendelen, foto |
| GET/POST | `/tasks` · POST `/tasks/:id/transition` | taken |
| GET/POST | `/docfiles` · POST `/docfiles/:id/versions` | bestanden |
| POST | `/docfiles/upload-url` | vooraf-ondertekende upload |
| POST | `/docfiles/:id/download` | ondertekende download |
| GET/POST | `/communications` | communicatietijdlijn |

Een invulling bevriest de templateversie: een template die later wijzigt
verandert een reeds ingevuld formulier niet. Toon bij een oude invulling dus
`templateSnapshot`, niet de huidige template.

`submit` geeft bij ontbrekende verplichte vragen `400 REQUIRED_MISSING` met
`missing[]`, en bij typefouten `400 INVALID_ANSWERS` met `invalid[]` inclusief
reden per vraag. Markeer per vraag.

Grote bestanden gaan via `/docfiles/upload-url`: de client uploadt rechtstreeks
naar de ondertekende URL. Downloads leveren `url` met een `expiresAt`; een
besmet bestand geeft `403 FILE_INFECTED`.

---

## 7. Portfolio en capaciteit (h38) · rechten `projects` / `planning`

| Methode | Pad | Doel |
|---|---|---|
| GET | `/portfolio` | projecten + gewogen offertes |
| GET | `/portfolio/capacity?from=&to=&bucket=month\|week` | capaciteitstekorten |
| GET/POST | `/projects/:id/baseline` | vergelijking / vastleggen |
| GET/POST | `/projects/:id/forecast` | historiek / regel toevoegen |

**Toon `projects` en `weightedQuotes` nooit als één omzetcijfer.** De totalen
staan bewust apart: vastgelegd werk en pipeline mogen niet opgeteld worden.

`capacity.shortfalls[]` wijst periode én rol aan. De rol `onbekend` betekent dat
er gepland is op iemand zonder personeelsfiche · toon dat als datakwaliteits-
signaal, niet als capaciteitstekort.

---

## 8. Webhooks (E19) · recht `integrations`

| Methode | Pad | Doel |
|---|---|---|
| GET/POST | `/webhooks` | endpoints + health |
| PATCH/DELETE | `/webhooks/:id` | wijzigen / verwijderen |
| POST | `/webhooks/:id/rotate-secret` | secret roteren |
| POST | `/webhooks/deliver` | bezorgronde forceren |
| POST | `/webhooks/events/:eventId/requeue` | opnieuw in de wachtrij |

Het signing secret komt **eenmalig** terug bij aanmaken en roteren. Toon het met
een kopieerknop en de waarschuwing dat het niet opnieuw getoond wordt; daarna is
alleen `secretHint` beschikbaar.

`health.endpoints[]` geeft `lastSuccessAt`, `lastErrorAt`, `lastError` en
`backlog`. Een endpoint met status `error` is door de circuit breaker
uitgeschakeld en levert niets meer af; de events blijven wél als achterstand
staan. Toon een hervat-actie.

---

## Nog niet in dit contract

Deze modules hebben nog **geen UI en geen vertaalsleutels**. Dat is bewust
zichtbaar gemaakt: volgens de Definition of Done (h54 punt 4 en 12) zijn ze
daarmee nog niet opgeleverd, ongeacht dat de API compleet en getest is.
