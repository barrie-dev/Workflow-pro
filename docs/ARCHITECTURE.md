# WorkFlow Pro Full-stack Architecture

## Doel

Dit is de echte ontwikkellijn voor de volledige applicatie. De flat app in de bovenliggende map blijft de visual/prototype-zone.

## Lagen

- `public/`: tijdelijke dev UI voor API-controle
- `src/server.js`: HTTP API router
- `src/lib/auth.js`: login, sessietoken, permission checks
- `src/lib/security.js`: password hashing en secret encryption
- `src/lib/store.js`: tijdelijke JSON repository met dezelfde boundaries als de toekomstige database
- `src/modules/`: domeinservices
- `db/schema.sql`: PostgreSQL/Supabase target schema

## Productiedomeinen

- Super admin en tenants
- Klantenfiche + KBO
- Medewerkers, rollen en rechten
- Venues/werven
- Planning
- Tijdregistratie
- Werkbonnen
- Onkosten
- Stock
- Wagenpark
- Verlof
- Berichten en notificaties
- Billing, Stripe en Peppol
- Integraties
- Audit/security
- Mobile/PWA

## Securitymodel

- Elke tenant-scoped tabel heeft `tenant_id`.
- Server-side routes roepen `assertTenant()` aan voor tenant isolation.
- Routes roepen `assertCan()` aan voor rechten.
- Secrets worden encrypted opgeslagen via AES-256-GCM.
- Audit events worden bij create/update/billing/security acties gelogd.

## Volgende stap

JSON-store vervangen door PostgreSQL/Supabase adapter zonder de modulecontracten te breken.
