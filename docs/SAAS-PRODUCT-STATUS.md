# Monargo One productstatus

Statusdatum: 21 juli 2026

> Autoritatieve, evidence-afgeleide status: [docs/traceability/matrix.md](traceability/matrix.md) (`npm run gate`). CTO-releaseoordeel: conditional go voor een gecontroleerde pilot, no-go voor brede commerciële productie tot de kern sluit. Leidende gate: <https://github.com/barrie-dev/Workflow-pro/issues/40>. Deze pagina vat samen; de matrix is de bron van waarheid.

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
- `npm test`: 1010 tests, 999 geslaagd, 0 gefaald (11 pg-live-tests slaan over zonder lokale database).
- `npm run test:e2e`: 35/35 scenario's groen.
- `npm run gate` (R0-R7 / E01-E22 / DoD): bewust ROOD. Evidence-groen op R0-R6 (dekking bestaat, 693/761 requirements onder een verified epic), gate-rood tot de kern sluit: read-cutover naar pg (DEV-03), finance-transactiegrenzen (DEV-04) en de 9 verplichte E2E-scenario's (DEV-02) staan open.

## Vereist voor publieke productie

De applicatiecode is testbaar, maar een publieke productieomgeving mag niet met demo- of mockinstellingen starten. Deze configuratie en kern-sluiting blijven verplicht (zie de traceability-matrix voor de actuele stand):

| Prioriteit | Voorwaarde |
| --- | --- |
| P0 | PostgreSQL via `DATABASE_URL` met toegepaste migraties (`node scripts/run-migrations.js`), providerneutraal |
| P0 | Gecontroleerde read-cutover naar pg voor identity, company, CRM en finance (DEV-03) |
| P0 | Kritieke financiële mutaties via de pg TransactionManager (DEV-04) |
| P0 | Azure Blob productie-objectopslag; lokale opslag geblokkeerd in productie (DEV-05) |
| P0 | MFA activeren en afdwingen voor alle adminaccounts |
| P0 | Production-grade JWT-secret en encryptiesleutel |
| P0 | Stripe live key en webhooksecret; e-mailprovider en afzenderdomein; echte Peppol-provider en API-key |
| P0 | Geslaagde restore-test van database en bestanden (DEV-07) |
| P1 | Publieke HTTPS `APP_URL`, `APP_COMMIT_SHA` en `RELEASE_CHANNEL=production` |

Na configuratie moet zowel `npm run preflight:production:strict` als `npm run gate` slagen voordat er echte klantdata of betalingen worden toegelaten.
