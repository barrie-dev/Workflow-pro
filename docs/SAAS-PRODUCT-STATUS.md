# Monargo One productstatus

Statusdatum: 16 juli 2026

## Wat testbaar is

- Compacte, hedendaagse workspace voor admin, manager, medewerker, reseller en superadmin.
- Operationeel dashboard met echte opdrachten en openstaande facturen.
- Klantflow van klantdossier naar offerte, werkbon, planning en factuur.
- Offerteconversie naar werkbon of factuur.
- Week-, dag- en capaciteitsplanning met medewerker- en locatiefilters.
- Verlofweergave, capaciteitsberekening en detectie van overlappende shifts.
- Prikklok, pauzes, historische registraties en correcties met auditspoor.
- Werkbonafronding met uitvoering, materiaal, checklist, bewijs en klantbevestiging.
- Onkosten, goedkeuringen, facturatie, Peppol-contract en Stripe-contract.
- Tenantisolatie, rollen, fijnmazige rechten, MFA, SSO, audit en supporttoegang.

## Aanbevolen acceptatieflow

1. Start lokaal met `REQUIRE_ADMIN_MFA=false STORAGE_ADAPTER=json npm start`.
2. Initialiseer indien nodig de lokale demoaccounts met `node scripts/reset-demo-passwords.js` en log in als admin.
3. Kies `Start klantflow` en maak een klant aan.
4. Maak vanuit het geopende klantdossier een offerte aan.
5. Aanvaard de offerte en zet deze om naar een werkbon.
6. Plan de werkbon in via week, dag of capaciteit.
7. Log in als de lokale demomedewerker, klok in en werk de werkbon af.
8. Log opnieuw in als admin en maak de factuur vanuit de afgeronde werkbon.
9. Controleer het resultaat op dashboard, klantdossier en factuuroverzicht.
10. Log in als de lokale demomanager en controleer de dagstart en uitzonderingsflows.

## Geautomatiseerde validatie

- `npm run check`: geslaagd.
- `npm test`: 346 van 346 tests geslaagd.
- Live domeinpreflights: security, planning, prikklok, onkosten, werkbonnen en operationele facturatie geslaagd.
- Productiepreflight: score 52 zolang de externe productie-infrastructuur nog niet is geconfigureerd.

## Vereist voor publieke productie

De applicatiecode is testbaar, maar een publieke productieomgeving mag niet met demo- of mockinstellingen starten. Deze eigenaarconfiguratie blijft verplicht:

| Prioriteit | Voorwaarde |
| --- | --- |
| P0 | Supabase PostgreSQL met service-role key en uitgevoerde migraties |
| P0 | MFA activeren en afdwingen voor alle adminaccounts |
| P0 | Production-grade JWT-secret en encryptiesleutel |
| P0 | Stripe live key en webhooksecret |
| P0 | E-mailprovider, afzenderdomein en providerkey |
| P0 | Echte Peppol-provider en API-key |
| P1 | Publieke HTTPS `APP_URL` |
| P1 | `COMMIT_SHA` en `RELEASE_CHANNEL=production` |

Na configuratie moet `npm run preflight:production:strict` slagen voordat er echte klantdata of betalingen worden toegelaten.
