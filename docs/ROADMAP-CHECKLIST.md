# WorkFlow Pro Roadmap Checklist

Generated: 2026-06-17T06:05:56.800Z
Tenant: Demo Bouwgroep NV (t_demo)

## Gate Summary

- Production readiness: 70% (4 P0, 2 P1 open)
- Pilot readiness: 0% (5 KPI's open)
- Commercial launch readiness: 17% (5 checks open)

## Fase 1 - Foundation

- [ ] Supabase/PostgreSQL adapter: Nog lokale JSON adapter. Zet STORAGE_ADAPTER=postgres, SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY.
- [x] Database migraties: Schema v6 is actueel.
- [ ] Admin MFA: 0/2 admin accounts hebben MFA actief en enforced.
- [x] Production secret ingesteld.
- [x] ENCRYPTION_KEY moet production-grade en minstens 32 tekens zijn.
- [x] Login, sessies, server-side permissies, tenant-scoped repositories en auditlog zijn aanwezig.

## Fase 2 - Core Operations

- [ ] Eerste planning werkt via echte endpoints.
- [x] Medewerkers en rollen bestaan voor tenant.
- [ ] Werkbonnenmodule bevat tenantdata.
- [x] Onkostenmodule is aanwezig in core data model.

## Fase 3 - Billing + Compliance

- [ ] Stripe configuratie: STRIPE_SECRET_KEY moet live zijn en STRIPE_WEBHOOK_SECRET moet geldig ingesteld zijn.
- [ ] Peppol provider: Kies echte Peppol provider en zet PEPPOL_API_KEY.
- [x] DPA/GDPR, support consent, invoice model en payment-method tokenflow zijn als platformflows aanwezig.

## Fase 4 - Pilot Launch

- [ ] Time-to-first-value: open / < 24u - Zet samen met de klant binnen 24u een eerste planning, werkbon of tijdregistratie live.
- [ ] Eerste planning: 0 / >= 1 - Maak minstens een eerste planning aan voor een echte medewerker op locatie.
- [ ] Werkbonnen: 0 / >= 10 - Laat de pilotklant minstens 10 werkbonnen verwerken in de mobiele of desktopflow.
- [ ] Afgewerkte werkbonnen: 0 / >= 1 - Werk minstens een werkbon volledig af, inclusief status naar voltooid of afgewerkt.
- [ ] Beslissersrapport: 0 / >= 1 - Genereer een beslissersrapport voor de klantreview en go/no-go evaluatie.
- [x] Integratie sync health: Geen integratie sync-fouten geregistreerd.

## Fase 5 - Commercial Launch

- [ ] Qualified leads: 0 / 20 - Vul de CRM-pipeline aan tot minstens 20 qualified leads.
- [ ] Demo calls: 0 / 10 - Plan extra demo calls met ICP-fit prospecten.
- [ ] Betalende klanten: 0 / 3 - Converteer pilots of voorstellen naar minstens 3 betalende klanten.
- [ ] Activation rate: 0% / 70% - Verhoog activatie door onboardingstappen, eerste planning en werkbon binnen dag 1 af te ronden.
- [ ] Trial-to-paid: 0% / 20% - Werk pricing, objections en opvolging uit om trial-to-paid boven 20% te krijgen.
- [x] Churn eerste 60 dagen: 0 / 0

## Open P0 Blockers

- Supabase PostgreSQL adapter: Nog lokale JSON adapter. Zet STORAGE_ADAPTER=postgres, SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY.
- Admin MFA: 0/2 admin accounts hebben MFA actief en enforced.
- Stripe test/live configuratie: STRIPE_SECRET_KEY moet live zijn en STRIPE_WEBHOOK_SECRET moet geldig ingesteld zijn.
- Peppol provider: Kies echte Peppol provider en zet PEPPOL_API_KEY.
