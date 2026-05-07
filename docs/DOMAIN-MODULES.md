# Domain Modules

Elke module volgt hetzelfde patroon:

- database tabel of collectie
- tenant scope
- permission key
- API list/create/update
- audit events
- frontend scherm
- validatie

## Modules

- `tenants`: SaaS klanten, KBO, facturatieprofiel, supporttoegang
- `users`: medewerkers en login identities
- `roles`: vrije rollen, acties, scope, datagevoeligheid
- `venues`: locaties/werven
- `customers`: klant/projectklanten binnen tenant
- `planning`: shifts en taken
- `clockings`: tijdregistratie
- `workorders`: werkbonnen, foto's, handtekening, materialen
- `expenses`: onkosten en approval
- `stock`: voorraad en min/max
- `vehicles`: wagenpark
- `leaves`: verlofaanvragen
- `messages`: berichten
- `notifications`: workflow alerts
- `integrations`: Robaws, sociaal secretariaat, ERP, webhooks
- `invoices`: facturen, Peppol, payment status
- `audit`: auditlog

## Build order

1. Auth + tenant isolation + permissions
2. Tenant/KBO + medewerkers/rollen
3. Planning + tijd + werkbonnen
4. Billing + Stripe + Peppol
5. Mobile today + offline queue
6. Integraties + sync logs
7. Rapportage + exports
