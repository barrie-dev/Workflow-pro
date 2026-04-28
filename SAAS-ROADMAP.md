# WorkFlow Pro SaaS Status

## Nu gebouwd

- Werkende SaaS-app met rollen: super admin, tenant admin, werfleider en medewerker.
- Multi-tenant datamodel in de frontend.
- Lokale server met API health-check.
- Server-side opslag in `data/workflow-pro-db.json`.
- Browseropslag als fallback wanneer de app direct als HTML wordt geopend.
- Modules: tenants, venues, medewerkers, planning, prikklok, tijdregistraties, onkosten, werkbonnen, verlof, berichten, stock, wagenpark, rapportages, integraties en billing.
- Robaws integratiekaart met DPA-flow, datavelden, API-configuratie, testendpoint en sync-simulatie.
- Vrije rolcreatie: tenant-admins kunnen eigen rollen maken en per rol kiezen welke modules zichtbaar zijn.
- Auditlog: kritieke wijzigingen aan rollen, tenants, billing, instellingen en operationele data worden zichtbaar gemaakt.
- Planlimieten: Starter/Business/Enterprise tonen limieten voor gebruikers, venues, vrije rollen, integraties en auditretentie.
- Go-live checklist: instellingenpagina toont de belangrijkste stappen om een tenant verkoopklaar te maken.
- Platform beheer voor de SaaS-eigenaar: prijzen, trialdagen, BTW, jaarkorting, modules, Stripe-status, feature flags en supportbeleid.
- Klantgestuurde supporttoegang: tenant-admins kunnen tijdelijk toestemming geven; super admin kan pas dan inloggen als klantadmin.
- Onboardingmodule met bedrijfswizard, go-live checklist, CSV-preview, snelle medewerkersimport, eerste planning en integratiekoppelstap.
- Actiecentrum met operationele signalen voor finance, HR, stock, wagenpark, werkbonnen en supporttoegang.
- Datahub met CSV-export voor medewerkers, venues, onkosten, werkbonnen en stock.
- Go-live readiness cockpit met maturiteitsscore, prioriteit, owner en ontbrekende marktgang-items per productdomein.
- SaaS lifecycle cockpit met tenant health, churn risk, trial einde, payment failed, account owner, renewal en customer-success playbooks.
- Security Center met MFA/auth beleid, tenant isolation status, credential vault, GDPR/DPA, support governance en security events.
- Super-admin billing operations met facturatiecontact, enterprise maatwerkprijzen, kortingen, jaarlijkse auto-renew, tokenized kaartbetaalmethode, factuuraanmaak en Peppol-status.
- Golden path cockpit: nieuwe klant naar KBO, onboarding, medewerkers, planning, werkbon, tijdregistratie en eerste factuur.

## Lokaal gebruiken als SaaS

Start:

```powershell
.\Start WorkFlow Pro.bat
```

Open:

```text
http://localhost:4173
```

Controle:

```text
http://localhost:4173/api/health
```

Data wordt bewaard in:

```text
data/workflow-pro-db.json
```

## Productie-koppelingen die nog echte accounts nodig hebben

- Stripe Checkout, customer portal en webhook.
- Stripe SetupIntent/PaymentMethod voor echte tokenized kaartopslag en automatische jaarafhaling.
- Peppol provider/API voor echte e-facturatie, verzendbevestiging en foutafhandeling.
- Veilige server-side opslag van Stripe secrets en andere credentials.
- Server-side afdwingen van support impersonation, sessieduur en audittrail.
- Supabase/PostgreSQL met Row Level Security.
- Supabase Auth of vergelijkbare login-provider.
- Resend of andere transactional-email provider.
- Acerta, Liantis, Securex of sociaal-secretariaat API keys.
- Robaws productie API key en mapping naar echte klanten/projecten/werkbonnen/facturatie.
- Hosting op EU-regio, bijvoorbeeld Vercel + Railway/Supabase Frankfurt.

## Volgende technische stap

1. Zet dit in GitHub.
2. Vervang de lokale JSON-opslag door PostgreSQL.
3. Voeg echte login/JWT toe en dwing rollen/rechten server-side af.
4. Sluit Stripe in testmode aan.
5. Deploy naar een EU-host.
6. Vervang demo-import/export door gevalideerde CSV/XLSX flows met foutregels en preview.
