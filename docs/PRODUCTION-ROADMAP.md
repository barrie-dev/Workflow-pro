# WorkFlow Pro Production Roadmap

Rol: Product Manager + Sales Owner  
Doel: WorkFlow Pro verkoopbaar en production-ready maken voor Belgische KMO's met mensen op de baan.

## Productpositionering

WorkFlow Pro is een SaaS-platform voor Belgische KMO's met veldpersoneel.

Primaire belofte:

> Planning, werkbonnen, tijdregistratie en kostencontrole in een veilige Belgische SaaS-flow.

Kernpijlers:

- Planning
- Tijdregistratie
- Werkbonnen
- Onkosten
- Rollen en rechten
- Billing/facturatie
- Integraties
- Mobile-first veldgebruik

Niet positioneren als "alles voor iedereen". Eerst winnen in bedrijven met operationele teams op locatie.

## Go-live Strategie

De app gaat niet in 1 sprong naar productie. We werken in 5 fases:

1. Foundation
2. Core Operations
3. Billing + Compliance
4. Pilot Launch
5. Commercial Launch

Elke fase heeft een go/no-go gate.

---

## Fase 1: Foundation

Doel: echte SaaS-basis bouwen waarop alle modules veilig kunnen draaien.

Indicatieve duur: 3-5 weken

### Product scope

- Echte login
- Tenant isolation
- Rollen en rechten server-side
- Auditlog
- Super admin basis
- Klantenfiche met KBO-flow
- Basis onboarding

### Engineering deliverables

- PostgreSQL/Supabase database
- Database schema migraties
- Auth provider of eigen authlaag
- MFA-ready accountmodel
- JWT/session handling
- Server-side permission middleware
- Tenant-scoped repositories
- Encrypted credential vault
- Audit events per kritieke actie
- API contracten per module

### Sales deliverables

- ICP vastleggen
- Demo-script maken
- Prijsmodel valideren
- 5-10 pilotkandidaten lijst
- One-pager voor prospectgesprekken

### Go/no-go gate

Go wanneer:

- tenantdata server-side gescheiden is
- admin kan inloggen
- super admin tenants kan beheren
- KBO lookup flow werkt
- auditlog kritieke wijzigingen toont

No-go wanneer:

- rechten alleen frontend-side zijn
- secrets nog plain text staan
- tenantdata via API zonder check bereikbaar is

---

## Fase 2: Core Operations

Doel: de dagelijkse operationele kern volledig werkbaar maken.

Indicatieve duur: 4-6 weken

### Product scope

- Medewerkers
- Rollen/rechten
- Venues/werven
- Planning
- Tijdregistratie
- Werkbonnen
- Onkosten
- Eerste managementrapportage
- Golden path volledig klikbaar

### Engineering deliverables

- CRUD API's voor alle core modules
- Validatie per formulier
- Detailpagina's met consistente layout
- Save feedback en foutmeldingen
- Planning API
- Clock-in/clock-out API
- Werkbon API met checklist
- File upload basis voor werkbonfoto's
- Onkosten approval flow
- CSV import medewerkers
- CSV export finance/operations

### Sales deliverables

- Demo omgeving met 1 volledige klantcase
- Golden path demo:
  - KBO ophalen
  - medewerkers importeren
  - eerste planning
  - werkbon
  - tijdregistratie
  - factuurconcept
- Demo deck
- Objection handling document

### Go/no-go gate

Go wanneer:

- een nieuwe klant binnen 30 minuten operationeel kan worden gezet
- eerste planning en werkbon zonder technische hulp werken
- tijdregistratie in rapportage terechtkomt
- onkosten approval werkt

No-go wanneer:

- support nodig is voor basissetup
- gebruikers verdwaald raken tussen modules
- data niet exporteerbaar is

---

## Fase 3: Billing + Compliance

Doel: betalingen, facturatie en compliance production-ready maken.

Indicatieve duur: 4-6 weken

### Product scope

- Stripe SetupIntent
- PaymentMethods opslaan via Stripe token
- Automatische jaarlijkse betaling
- Enterprise maatwerkcontracten
- Facturen
- Peppol
- Failed payment flow
- DPA/GDPR flows
- Supporttoegang met consent

### Engineering deliverables

- Stripe customer model
- Stripe SetupIntent endpoint
- Stripe webhook handler
- Payment failed event handling
- Subscription/contract state machine
- Seat counting
- Invoice generation
- Peppol provider integratie
- Dunning flow
- GDPR export request
- GDPR delete request workflow
- DPA acceptance tracking
- Support impersonation met reden, start/einde, audit

### Sales deliverables

- Pricing page intern goedgekeurd
- Contracttemplates
- Enterprise offerteflow
- Betaalproces demo
- Factuurvoorbeeld
- Peppol uitleg voor Belgische KMO

### Go/no-go gate

Go wanneer:

- kaartgegevens nooit lokaal worden opgeslagen
- betaling via Stripe testmode werkt
- webhook status correct verwerkt wordt
- factuur en Peppol status traceerbaar zijn
- enterprise klant zonder publieke prijs geactiveerd kan worden

No-go wanneer:

- payment status handmatig moet worden bijgewerkt
- Peppol geen foutstatus heeft
- supporttoegang niet volledig gelogd wordt

---

## Fase 4: Pilot Launch

Doel: 3-5 echte pilotklanten gecontroleerd onboarden.

Indicatieve duur: 6-8 weken

### Product scope

- Mobile-first "Vandaag"
- PWA installatie
- Werkbon mobiel
- Foto upload
- Handtekening
- Offline queue basis
- Notificaties/reminders
- Integratiecentrum
- Robaws of eerste ERP integratie

### Engineering deliverables

- Mobile today API
- Responsive mobile UI
- PWA manifest + service worker
- IndexedDB/offline queue
- Foto upload compressie
- Signature capture
- Notification engine
- Integration sync logs
- Retry mechanisme
- Field mapping UI

### Sales deliverables

- Pilotovereenkomst
- Onboarding checklist per klant
- Weekly success review
- Feedbacklog
- ROI case verzamelen
- Referentiecase voorbereiden

### Pilot KPI's

- Time-to-first-value: < 1 dag
- Eerste planning aangemaakt: 100%
- Minstens 10 werkbonnen per pilot
- Minder dan 2 supporttickets per actieve gebruiker in week 2
- Minstens 1 beslisserrapport per klant

### Go/no-go gate

Go wanneer:

- pilotklanten zelfstandig dagelijkse taken uitvoeren
- mobiele flow bruikbaar is op werf
- kritieke bugs binnen 48u opgelost worden
- billing en supportprocessen werken

No-go wanneer:

- veldmedewerkers desktop nodig hebben
- offline of fotoflow onbetrouwbaar is
- onboarding support te zwaar blijft

---

## Fase 5: Commercial Launch

Doel: gecontroleerde verkoopstart.

Indicatieve duur: 4 weken na pilots

### Product scope

- Stabiele SaaS onboarding
- Self-serve trial of assisted onboarding
- Customer portal
- Helpcentrum
- Release notes
- Statuspagina
- Sales demo mode

### Engineering deliverables

- Production hosting EU
- Monitoring
- Error tracking
- Backup/restore
- Rate limiting
- Status page
- Admin tooling
- Release process
- CI/CD pipeline

### Sales deliverables

- Website/landing page
- Demo booking flow
- CRM pipeline
- Sales scripts
- Pricing packaging
- Case study
- Launch email sequence
- Partnerlijst boekhouders/ERP consultants

### Launch KPI's

- 20 qualified leads
- 10 demo calls
- 3 paying customers
- Activation rate > 70%
- Trial-to-paid > 20%
- Churn in eerste 60 dagen: 0

---

## Prioriteiten Per Domein

### P0: Production blockers

- Auth/MFA
- Tenant isolation
- Server-side permissions
- PostgreSQL/Supabase
- Encrypted secrets
- Stripe SetupIntent + webhooks
- Peppol provider
- Auditlog
- Support consent
- Backup/restore

### P1: Sales blockers

- Golden path demo
- KBO onboarding
- Medewerkersimport
- Mobile today flow
- Werkbon mobiel
- Managementrapport
- Pricing/contracting
- Pilot onboarding playbook

### P2: Scale blockers

- Integratie marketplace
- Advanced reporting
- Notifications engine
- Offline queue hardening
- API keys per tenant
- Partner portal

---

## Sales Packaging

### Starter

Voor kleine teams die planning en tijd willen starten.

- Planning
- Tijdregistratie
- Berichten
- Basis klanten/venues

### Business

Hoofdpakket voor KMO's met mensen op de baan.

- Alles in Starter
- Werkbonnen
- Onkosten
- Rollen/rechten
- Rapportage
- Datahub export

### Enterprise

Maatwerk zonder publieke prijs.

- Alles in Business
- Custom pricing
- Jaarcontract
- Peppol/facturatieafspraken
- Integraties
- Support SLA
- Account manager

---

## Eerste 30 Dagen Vanaf Nu

Week 1:

- Full-stack foundation afronden
- Auth + tenant middleware
- Database adapter voorbereiden
- Tenant/KBO API production-ready maken

Week 2:

- Medewerkers, rollen, venues en planning API + UI
- CSV import medewerkers
- Golden path volledig door echte endpoints laten lopen

Week 3:

- Werkbonnen, tijdregistratie en onkosten API + UI
- Mobile today eerste versie
- Audit events uitbreiden

Week 4:

- Billing foundation
- Stripe SetupIntent testmode
- Invoice model
- Peppol provider keuze voorbereiden
- Pilotdemo stabiel maken

## Beslissingen Nodig

- Supabase of eigen PostgreSQL hosting?
- Auth provider: Supabase Auth, Auth0, Clerk of eigen auth?
- Peppol provider keuze
- Stripe account beschikbaar?
- Eerste pilotsector: bouw, installatie, logistiek of schoonmaak?
- Pricing definitief maken
- Enterprise contractvoorwaarden
