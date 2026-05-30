# Frontend Architecture

Doel: de SaaS-frontend stap voor stap uit de huidige monolithische `public/main.js` halen zonder gedrag te breken.

## Huidige Status

De frontend is een vanilla JS prototype. Dat is snel gebouwd, maar `main.js` bevat nu te veel verantwoordelijkheden:

- globale state
- API-calls
- view-routing
- rendering
- form submit handlers
- domeinacties
- kleine businessregels

Dit maakt schermen moeilijk te onderhouden en zorgt ervoor dat nieuwe UI snel door elkaar begint te lopen.

## Eerste Scheiding Die Nu Is Ingezet

### View Config

Alle hoofdschermen staan in `public/js/app-config.js`.

Elke view definieert:

- `pageId`: welk DOM-paneel zichtbaar wordt
- `tabId`: welke navigatieknop actief wordt
- `refresh`: welke refreshfunctie data laadt

Nieuwe schermen mogen niet meer handmatig in `setView` worden toegevoegd. Voeg ze toe aan `WorkFlowProConfig.views`.

### Module API Laag

Generieke API-calls staan in `public/js/api-client.js`.

In `main.js` worden ze gebruikt als:

- `listModuleRows(key)`
- `createModuleRow(key, payload)`
- `updateModuleRow(key, id, payload)`

Schermen bouwen dus niet zelf meer URLs zoals `/api/modules/users?tenantId=...`.

### DOM Utilities

Kleine DOM helpers staan in `public/js/dom-utils.js`:

- `el`
- `setText`
- `showJson`
- `escapeHtml`
- `setNoticeText`
- `statusTone`

### Domein Utilities

Kleine gedeelde business/UI helpers staan in `public/js/domain-utils.js`:

- `todayValue`
- `futureDateValue`
- `shortDateTime`
- `optionList`
- `personName`
- `venueName`
- `renderList`

Deze helpers mogen lichte presentatielogica bevatten, maar geen API-calls of schermspecifieke state-mutaties.

### App State

De gedeelde runtime-state staat in `public/js/app-state.js`.

`main.js` gebruikt deze via:

```js
const state = window.WorkFlowProState;
```

Nieuwe statevelden worden daar toegevoegd, niet meer bovenaan `main.js`.

### Eerste Domeinmodules

`public/js/modules/customer-start.js` bevat de frontendlogica voor Werkruimte/Klantstart:

- zichtbare view-redirects
- volgende actie uitvoeren
- klantstart renderen
- klantstart refreshen

`public/js/modules/operations.js` bevat de frontendlogica voor de dagelijkse veldflow:

- planning experience renderen
- werkbonnen experience renderen
- veldflow navigatie naar werkbonnen en mobile

`public/js/modules/assets.js` bevat de frontendlogica voor Stock & wagenpark:

- service due berekening
- asset render
- asset refresh
- asset submit

`public/js/modules/billing.js` bevat de frontendlogica voor Onkosten/Billing:

- billing readiness renderen
- pricing quote renderen
- SetupIntent starten
- betaalmethode, factuur, DPA en GDPR submits
- Peppol factuurstatus bijwerken
- failed payment en dunning acties

`public/js/modules/reports.js` bevat de frontendlogica voor Rapportage:

- dashboard KPI's
- inzichten
- uren per werf
- werkbonstatus
- stockrisico
- projectoverzicht

`public/js/modules/action-center.js` bevat de frontendlogica voor Actiecentrum:

- prioriteitskaarten
- actiequeue
- assistentpaneel
- notificaties laden
- notificatie aanmaken
- reminders genereren
- notificatie gelezen markeren

`public/js/modules/mobile.js` bevat de frontendlogica voor de mobiele/PWA-flow:

- mobiele planning renderen
- open werkbonnen renderen
- offline wachtrij opslaan
- foto/handtekening/afronden acties uitvoeren
- wachtrij synchroniseren

`public/js/modules/integrations.js` bevat de frontendlogica voor Integraties & automatisaties:

- connector health renderen
- mapping tekst parseren
- koppeling verbinden
- mapping opslaan
- sync uitvoeren
- retry uitvoeren

`main.js` houdt nog dunne wrapperfuncties zodat bestaande event handlers en rapportagecode blijven werken.

## Gewenste Volgende Stap

Splits `public/main.js` daarna in deze lagen:

```text
public/js/
  app-state.js
  api-client.js
  app-config.js
  view-router.js
  dom-utils.js
  domain-utils.js
  modules/
    customer-start.js
    operations.js
    billing.js
    assets.js
    action-center.js
    integrations.js
    mobile.js
    operations.js
    reports.js
    integrations.js
    admin.js
  boot.js
```

## Regels Voor Nieuwe Frontend

- Een renderfunctie mag HTML maken, maar geen fetch uitvoeren.
- Een refreshfunctie mag data ophalen en state zetten, maar zo weinig mogelijk HTML bouwen.
- Een submit/action functie mag API-calls doen, daarna refreshen.
- View-routing blijft centraal in `viewConfig`.
- Nieuwe domeinen krijgen eerst een eigen render/refresh/action blok, daarna pas een eigen bestand.
- Backend-roadmaplogica blijft backend/API-eigendom; frontend toont en orkestreert alleen.
