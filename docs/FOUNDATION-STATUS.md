# Foundation Status

Laatste update: 2026-04-28

## Klaar in deze build

- Login met server-side sessietoken.
- MFA-ready gebruikersmodel met velden voor MFA-status en loginstatus.
- Tenant-scoped module API's voor core data.
- Tenant-admins zien via de tenant-API alleen hun eigen tenant.
- Super-admin tenantbeheer via `/api/admin/tenants`.
- Server-side rechtencontrole per module.
- Tenant-id kan niet via update-payload naar een andere tenant worden verplaatst.
- Auditlog wordt voor tenant-admins tenant-gefilterd.
- Wachtwoordhashes en MFA-secrets worden niet via de users API teruggegeven.
- Integratie-secrets worden versleuteld opgeslagen en geredigeerd in API responses.
- Supporttoegang vereist expliciete start/einde-flow met audit-events.
- KBO lookup en KBO apply flow bestaan op tenantniveau.
- Billing foundation bevat Stripe SetupIntent mock, payment method token-ref, invoice en Peppol-status mock.

## Nog niet production-complete

- JSON-opslag moet nog vervangen of aangevuld worden door PostgreSQL/Supabase migraties in runtime.
- Auth provider keuze staat nog open: Supabase Auth, Auth0, Clerk of eigen auth.
- MFA is datamodel-ready, maar nog niet actief als challenge-flow.
- Stripe draait nog als mock/test-foundation, niet met echte Stripe SDK/webhooks.
- Peppol provider is nog mock.
- Backup/restore en rate limiting ontbreken nog in runtime.

## Volgende technische stap

Week 1 afronden met een database adapter en echte migratie-runner, daarna Week 2 starten met medewerkers, rollen, venues en planning via echte formulieren en golden-path UI.
