# /v1 · de moderne API (spec 5.4 + h41)

Canonieke Engelse namespace over de bestaande routes. `/api/...` blijft werken
(strangler); `/v1` is de voordeur voor nieuwe integraties en de toekomstige
frontend. De laag voegt geen rechten of gedrag toe: wat de legacy-route
weigert, weigert /v1 ook.

```
GET  /v1                                  → discovery: resources + conventies
GET  /v1/customers?limit=25&cursor=...    → lijst (cursor-paginatie)
GET  /v1/customers?filter=name:contains:x → whitelist-filters, typed operators
GET  /v1/customers/:id                    → detail + ETag
POST /v1/customers                        → 201 + data/version/links (+ETag)
PATCH /v1/customers/:id                   → mutatie · If-Match: "<version>"
POST /v1/projects/:id/transition          → subacties gaan mee naar de legacy-route
```

## Conventies

| Onderdeel | Afspraak |
|---|---|
| Tenantcontext | uit het token · geen tenant-id in het pad (superadmin: `X-Tenant-Id`) |
| Geld | **integer minor units (centen)** op de draad, ook in filters; intern euro's |
| Datums | ISO 8601 |
| Concurrency | `If-Match: "<version>"` → 409 met `currentVersion` + `recovery` bij conflict |
| Idempotentie | `Idempotency-Key`-header · replay draagt `Idempotency-Replayed: true` |
| Validatie | `422` met `errors[]` (`field`, `code`, `message`) |
| Paginatie | `limit` (max 100) + `cursor`; `nextCursor` in de response, `null` = einde |
| Filters | `filter=<veld>:<operator>:<waarde>` herhaalbaar; `in`/`nin`/`between` kommagescheiden |
| Sortering | `sort=veld` of `sort=-veld` |
| Fouten | stabiele machine-`code` + leesbare `message` + `requestId` |

Resources: `customers`, `quotes`, `invoices`, `work-orders`, `projects`,
`articles`, `employees`, `suppliers`, `purchase-orders`, `contracts`, `assets`,
`worksites`, `progress-claims`, `expenses`, `incidents`, `webhooks`. Zie
`GET /v1` voor de actuele lijst.

## Implementatie

`src/lib/api-v1.js` vertaalt het pad naar de legacy-route (lijsten en details
via de grid-kern van h11: zelfde scoping, veldafscherming en operators als de
UI) en transformeert de response in `sendJson`. Geldvelden staan op één
whitelist (`MONEY_FIELDS`); bewust geen dubbelzinnige namen (`rate`, `margin`).
Fouten uit de route lopen door dezelfde transformatie, dus ook een geworpen
409 draagt de recovery-aanwijzing.

Valkuil die hier is dichtgezet: de grid-routes ontsnapten aan de
module-entitlements (moduleForAction kijkt alleen naar het eerste padsegment).
`GRID_MODULE_ACTION` in server.js mapt elke grid-resource op zijn
representatieve actie zodat query/bulk/export dezelfde 403 geven als de
gewone routes.
