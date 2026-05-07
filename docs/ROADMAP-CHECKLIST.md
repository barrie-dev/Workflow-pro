# WorkFlow Pro Roadmap Checklist

Generated: 2026-04-30T13:55:01.099Z
Tenant: ABMS Consultancy BV (t_demo)

## Gate Summary

- Production readiness: 55% (6 P0, 3 P1 open)
- Pilot readiness: 71% (2 KPI's open)
- Commercial launch readiness: 17% (5 checks open)

## Open P0 Blockers

- [ ] Supabase PostgreSQL adapter: Nog lokale JSON adapter. Zet STORAGE_ADAPTER=postgres, SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY.
- [ ] Admin MFA: 0/2 admin accounts hebben MFA actief en enforced.
- [ ] JWT secret: Vervang JWT_SECRET door een lange production secret.
- [ ] Encryptiesleutel: ENCRYPTION_KEY moet production-grade en minstens 32 tekens zijn.
- [ ] Stripe test/live configuratie: STRIPE_SECRET_KEY en STRIPE_WEBHOOK_SECRET zijn nodig voor echte payment events.
- [ ] Peppol provider: Kies echte Peppol provider en zet PEPPOL_API_KEY.

## Pilot Actions

- [ ] Werkbonnen: Laat de pilotklant minstens 10 werkbonnen verwerken in de mobiele of desktopflow.
- [ ] Afgewerkte werkbonnen: Werk minstens een werkbon volledig af, inclusief status naar voltooid of afgewerkt.

## Sales Actions

- [ ] Qualified leads: Vul de CRM-pipeline aan tot minstens 20 qualified leads.
- [ ] Demo calls: Plan extra demo calls met ICP-fit prospecten.
- [ ] Betalende klanten: Converteer pilots of voorstellen naar minstens 3 betalende klanten.
- [ ] Activation rate: Verhoog activatie door onboardingstappen, eerste planning en werkbon binnen dag 1 af te ronden.
- [ ] Trial-to-paid: Werk pricing, objections en opvolging uit om trial-to-paid boven 20% te krijgen.
